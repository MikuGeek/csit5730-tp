import argparse
import json
import os
import random
import resource
import shutil
import subprocess
import sys
import tempfile
import time
from collections import defaultdict
from contextlib import contextmanager
from pathlib import Path
from statistics import median
from ipaddress import ip_address

from ids.detector import CONNECT, EXEC, THRESHOLD, WINDOW_NS, WIRE, load_profiles


SERVICES = {"tt-ancestry": "ancestry", "tt-destinations": "destinations"}
APPROVED, ALTERNATE = "tt-approved", "tt-alternate"
CANARY = Path("/run/tracetriage-canary")
MODES = ("off", "probes_only", "full")


def write_json(path, document):
    path.write_text(json.dumps(document, indent=2) + "\n")


@contextmanager
def sensor(command, output, error_log):
    with output.open("wb") as stdout, error_log.open("wb") as stderr:
        process = subprocess.Popen(command, stdout=stdout, stderr=stderr, start_new_session=True)
        try:
            deadline = time.monotonic() + 8
            while "READY" not in error_log.read_text().splitlines():
                if process.poll() is not None or time.monotonic() >= deadline:
                    raise RuntimeError(f"sensor did not start: {error_log.read_text()}")
                time.sleep(0.02)
            yield
        finally:
            if process.poll() is None:
                process.terminate()
            try:
                status = process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, 9)
                process.kill()
                process.wait()
                raise
            if status:
                raise RuntimeError(f"sensor failed ({status}): {error_log.read_text()}")


def sensor_metrics(path):
    return {key: value for line in path.read_text().splitlines() if line.startswith("{")
            for key, value in json.loads(line).items()}


@contextmanager
def isolated_cgroup(parent):
    group = Path(tempfile.mkdtemp(prefix="tracetriage-", dir=parent))
    try:
        yield group
    finally:
        group.rmdir()


def launch(group, fixtures, launcher, service, behavior):
    def enter_group():
        (group / "cgroup.procs").write_text(str(os.getpid()))

    command = [str(fixtures / launcher)]
    command.extend(["launch", str(fixtures / service), behavior] if service else [behavior])
    subprocess.run(command, check=True, timeout=5, preexec_fn=enter_group)


def calibrate(reader, group, fixtures, temporary, output):
    events_file, error_log = temporary / "training.bin", temporary / "training.log"
    with sensor([str(reader), "--cgroup", str(group.stat().st_ino)], events_file, error_log):
        for service in SERVICES:
            for trial in range(2):
                launch(group, fixtures, APPROVED, service, "routine")

    metrics = sensor_metrics(error_log)
    if metrics.get("drops") != 0 or metrics.get("exec") != 8 or metrics.get("connect") != 32:
        raise RuntimeError(f"unexpected calibration telemetry: {metrics}")
    service_processes = {}
    parents = defaultdict(set)
    endpoints = defaultdict(set)
    for _, start, _, kind, pid, _, family, port, address, image, parent in WIRE.iter_unpack(events_file.read_bytes()):
        lifetime = pid, start
        if kind == EXEC:
            name = image.split(b"\0", 1)[0].decode()
            if name in SERVICES:
                if not start:
                    raise RuntimeError("training lost a process lifetime")
                service_processes[lifetime] = name
                parents[name].add(parent.split(b"\0", 1)[0].decode())
        elif kind == CONNECT and lifetime in service_processes:
            endpoint = str(ip_address(address[:4] if family == 2 else address)), port
            endpoints[service_processes[lifetime]].add(endpoint)
    if any(parents[service] != {APPROVED} or len(endpoints[service]) != THRESHOLD for service in SERVICES):
        raise RuntimeError("training did not observe the expected ancestry and destinations")
    profiles = {"services": {service: {"check": check, "parents": sorted(parents[service]),
                                         "destinations": sorted(endpoints[service])}
                             for service, check in SERVICES.items()}}
    load_profiles(profiles)
    path = temporary / "profiles.json"
    write_json(path, profiles)
    path.chmod(0o400)
    write_json(output / "training-summary.json", {
        "services": len(SERVICES), "routine_runs_per_service": 2, "exec_events": metrics["exec"],
        "connection_attempts": metrics["connect"], "drops": metrics["drops"],
    })
    return path


def full_command(reader, group, profiles):
    return [sys.executable, "-m", "ids.collect", "--reader", str(reader), "--cgroup", str(group),
            "--profiles", str(profiles)]


def functional(reader, group, fixtures, temporary, profiles, output):
    trials = [
        ("approved-launcher", APPROVED, "tt-ancestry", "routine", "expected", ("fanout",)),
        ("alternate-launcher", ALTERNATE, "tt-ancestry", "routine", "suspicious", ("unexpected_exec", "fanout")),
        ("approved-endpoints", APPROVED, "tt-destinations", "routine", "expected", ("fanout",)),
        ("alternate-endpoints", APPROVED, "tt-destinations", "alternate", "suspicious", ("fanout",)),
    ] * 2
    random.Random(5730).shuffle(trials)
    trials.extend([("canary", APPROVED, None, "canary", None, ("canary",)),
                   ("duplicate-destinations", APPROVED, "tt-destinations", "duplicates", None, ())])
    expected = [(scenario, label, rule) for scenario, _, _, _, label, rules in trials for rule in rules]
    capture, log = output / "capture.jsonl", temporary / "functional.log"
    with sensor(full_command(reader, group, profiles), capture, log):
        for _, launcher, service, behavior, _, _ in trials:
            launch(group, fixtures, launcher, service, behavior)
        time.sleep(WINDOW_NS / 1_000_000_000 + 0.45)

    records = [json.loads(line) for line in capture.read_text().splitlines()]
    alerts = [entry for entry in records if entry["kind"] == "alert"]
    cases = [entry for entry in records if entry["kind"] == "case"]
    summary = records[-1]
    if [entry["rule"] for entry in alerts] != [rule for _, _, rule in expected]:
        raise RuntimeError(f"alerts did not match independent trial schedule: {alerts}")
    if len(cases) != 8 or not all(entry["complete"] for entry in cases) or not summary["clean"] or summary["drops"]:
        raise RuntimeError(f"incomplete functional capture: {summary}")
    if (summary["events"] != {"exec": 19, "connect": 72, "canary": 1} or
            summary["families"] != {"ipv4": 36, "ipv6": 36} or summary["uncorrelated"]):
        raise RuntimeError(f"functional probe counts do not match workload: {summary}")
    write_json(output / "labels.json", {"cases": [{"id": alert["id"], "label": label, "scenario": scenario}
                                                for alert, (scenario, label, rule) in zip(alerts, expected, strict=True)
                                                if rule == "fanout"]})
    write_json(output / "functional.json", {"course_rules_covered": 3, "trial_count": len(trials), **summary,
                                           "sensor": sensor_metrics(log)})


def workload_metrics(group, fixtures, iterations):
    samples = []
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    start = time.monotonic_ns()
    for trial in range(iterations):
        trial_start = time.monotonic_ns()
        launch(group, fixtures, APPROVED, "tt-destinations", "routine")
        samples.append((time.monotonic_ns() - trial_start) / 1_000_000)
    wall_ms = (time.monotonic_ns() - start) / 1_000_000
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    return {"workload_ms": wall_ms,
            "workload_cpu_ms": 1000 * (after.ru_utime - before.ru_utime + after.ru_stime - before.ru_stime),
            "p95_workload_ms": sorted(samples)[(95 * iterations + 99) // 100 - 1]}


def benchmark(reader, group, fixtures, profiles, temporary, rounds, iterations, output):
    result = []
    for round_index in range(rounds):
        for mode_index in range(len(MODES)):
            mode = MODES[(round_index + mode_index) % len(MODES)]
            if mode == "off":
                trial = {**workload_metrics(group, fixtures, iterations), "bpf_map_payload_bytes": 0}
            else:
                stdout, stderr = temporary / "perf.out", temporary / "perf.err"
                command = ([str(reader), "--cgroup", str(group.stat().st_ino), "--drain"] if mode == "probes_only"
                           else full_command(reader, group, profiles))
                with sensor(command, stdout, stderr):
                    trial = workload_metrics(group, fixtures, iterations)
                trial.update(sensor_metrics(stderr))
                if (trial.get("exec") != 2 * iterations or trial.get("connect") != 8 * iterations or
                        trial.get("canary") or trial.get("drops")):
                    raise RuntimeError(f"benchmark telemetry incomplete: {trial}")
                if mode == "full":
                    summary = json.loads(stdout.read_text().splitlines()[-1])
                    if summary["alerts"]["fanout"] != iterations:
                        raise RuntimeError(f"benchmark local alerts incomplete: {summary}")
            trial["sensor_cpu_ms"] = trial.get("reader_cpu_ms", 0) + trial.get("detector_cpu_ms", 0)
            trial.update(mode=mode, round=round_index + 1)
            result.append(trial)
    medians = {}
    for mode in MODES:
        trials = [trial for trial in result if trial["mode"] == mode]
        medians[mode] = {key: median(trial[key] for trial in trials) for key in trials[0] if key not in {"mode", "round"}}
    write_json(output / "benchmark.json", {"rounds": rounds, "iterations_per_trial": iterations,
                                          "system": os.uname().release, "median_by_mode": medians, "trials": result})


def main():
    parser = argparse.ArgumentParser(description="Scoped TraceTriage integration test and workload benchmark")
    parser.add_argument("--build", type=Path, default=Path("build"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cgroup-root", type=Path, default=Path("/sys/fs/cgroup"))
    parser.add_argument("--rounds", type=int, default=5)
    parser.add_argument("--iterations", type=int, default=120)
    parser.add_argument("--functional-only", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.rounds <= 30 or not 1 <= args.iterations <= 1000:
        parser.error("rounds must be 1–30 and iterations must be 1–1000")
    if os.path.lexists(CANARY):
        parser.error(f"reserved canary already exists: {CANARY}; refusing to open it")
    args.output.mkdir(parents=True, exist_ok=False)
    build = args.build.resolve()
    with tempfile.TemporaryDirectory(prefix="tracetriage-") as directory, isolated_cgroup(args.cgroup_root) as group:
        temporary = Path(directory)
        for image in (*SERVICES, APPROVED, ALTERNATE):
            shutil.copy2(build / "workload", temporary / image)
        profiles = calibrate(build / "reader", group, temporary, temporary, args.output)
        functional(build / "reader", group, temporary, temporary, profiles, args.output)
        if not args.functional_only:
            benchmark(build / "reader", group, temporary, profiles, temporary, args.rounds, args.iterations, args.output)
    print("TraceTriage integration passed", file=sys.stderr)


if __name__ == "__main__":
    main()
