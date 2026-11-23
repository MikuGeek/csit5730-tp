import argparse
import json
import shutil
import sys
import tempfile
import time
from pathlib import Path

from ids.detector import WINDOW_NS
from ids.experiment import APPROVED, ALTERNATE, SERVICES, isolated_cgroup, launch, sensor, write_json


def main():
    parser = argparse.ArgumentParser(description="Capture isolated loopback fan-out cases for analyst replay")
    parser.add_argument("--build", type=Path, default=Path("build"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cgroup-root", type=Path, default=Path("/sys/fs/cgroup"))
    parser.add_argument("--cases", type=int, default=144)
    args = parser.parse_args()
    if not 1 <= args.cases <= 512:
        parser.error("cases must be 1–512")
    args.output.mkdir(parents=True, exist_ok=False)
    build = args.build.resolve()
    capture = args.output / "capture.jsonl"
    with tempfile.TemporaryDirectory(prefix="tracetriage-corpus-") as directory, isolated_cgroup(args.cgroup_root) as group:
        fixtures = Path(directory)
        for image in (*SERVICES, APPROVED, ALTERNATE):
            shutil.copy2(build / "workload", fixtures / image)
        command = [sys.executable, "-m", "ids.collect", "--reader", str(build / "reader"), "--cgroup", str(group)]
        with sensor(command, capture, fixtures / "sensor.log"):
            for index in range(args.cases):
                launcher = (APPROVED, ALTERNATE)[index % 2]
                service = tuple(SERVICES)[index // 2 % 2]
                behavior = ("routine", "alternate")[index // 4 % 2]
                launch(group, fixtures, launcher, service, behavior)
            time.sleep(WINDOW_NS / 1_000_000_000 + 0.45)

    rows = [json.loads(line) for line in capture.read_text().splitlines()]
    cases = [row for row in rows if row["kind"] == "case"]
    summary = rows[-1]
    if (len(cases) != args.cases or not all(case["complete"] for case in cases) or
            summary["alerts"] != {"fanout": args.cases, "unexpected_exec": 0, "canary": 0} or
            summary["events"] != {"exec": 2 * args.cases, "connect": 8 * args.cases, "canary": 0} or
            summary["families"] != {"ipv4": 4 * args.cases, "ipv6": 4 * args.cases} or
            any(summary[field] for field in ("drops", "uncorrelated", "evictions")) or not summary["clean"]):
        raise RuntimeError(f"corpus capture did not match the fixture workload: {summary}")
    write_json(args.output / "summary.json", summary)
    print(f"Captured {len(cases)} complete fan-out cases", file=sys.stderr)


if __name__ == "__main__":
    main()
