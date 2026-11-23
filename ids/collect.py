import argparse
import json
import resource
import signal
import subprocess
import sys
from pathlib import Path

from ids.detector import Detector, WIRE, load_profiles


def emit(record):
    print(json.dumps(record, separators=(",", ":")), flush=True)


def main():
    parser = argparse.ArgumentParser(description="Local TraceTriage detector; emits alerts and replay cases as NDJSON.")
    parser.add_argument("--reader", type=Path, default=Path("build/reader"))
    parser.add_argument("--profiles", type=Path)
    parser.add_argument("--cgroup", type=Path, help="exact cgroup v2 directory (not descendants)")
    args = parser.parse_args()
    profiles = load_profiles(json.loads(args.profiles.read_text())) if args.profiles else {}
    detector = Detector(profiles, emit)
    command = [str(args.reader.resolve())]
    if args.cgroup:
        command.extend(["--cgroup", str(args.cgroup.stat().st_ino)])
    reader = subprocess.Popen(command, stdout=subprocess.PIPE, start_new_session=True)

    def stop(signum, frame):
        reader.terminate()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    emit({"kind": "session", "version": 1})
    clean = False
    try:
        with reader.stdout as stream:
            while frame := stream.read(WIRE.size):
                detector.feed(frame)
        clean = reader.wait() == 0
    finally:
        if reader.poll() is None:
            reader.terminate()
            try:
                reader.wait(timeout=2)
            except subprocess.TimeoutExpired:
                reader.kill()
                reader.wait()
        detector.finish(clean)
        usage = resource.getrusage(resource.RUSAGE_SELF)
        print(json.dumps({"detector_cpu_ms": 1000 * (usage.ru_utime + usage.ru_stime),
                          "detector_peak_rss_kib": usage.ru_maxrss}), file=sys.stderr, flush=True)
    return 0 if clean else 1


if __name__ == "__main__":
    sys.exit(main())
