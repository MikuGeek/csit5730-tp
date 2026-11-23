import argparse
import ctypes
import os
import platform
import sys
from pathlib import Path


TRACEPOINTS = ("sched/sched_process_exec", "syscalls/sys_enter_connect", "syscalls/sys_enter_openat")


def main():
    parser = argparse.ArgumentParser(description="Check prerequisites on a Linux capture target without loading BPF")
    parser.add_argument("--build", type=Path, default=Path("build"))
    args = parser.parse_args()
    checks = []

    def require(condition, description):
        checks.append(bool(condition))
        print(f"{'OK' if condition else 'FAIL'}: {description}")

    require(platform.system() == "Linux", "Linux kernel")
    require(sys.version_info >= (3, 10), "Python 3.10 or newer")
    require(os.geteuid() == 0, "root for the scoped capture and cgroup setup")
    require(os.access("/sys/kernel/btf/vmlinux", os.R_OK), "readable kernel BTF")
    tracefs = next((root for root in (Path("/sys/kernel/tracing"), Path("/sys/kernel/debug/tracing"))
                    if (root / "events").is_dir()), None)
    for name in TRACEPOINTS:
        require(tracefs and os.access(tracefs / "events" / name / "id", os.R_OK), f"tracepoint {name}")
    cgroup = Path("/sys/fs/cgroup")
    require((cgroup / "cgroup.controllers").exists() and not (os.statvfs(cgroup).f_flag & os.ST_RDONLY)
            and os.access(cgroup, os.W_OK), "writable cgroup v2 at /sys/fs/cgroup")
    try:
        ctypes.CDLL("libbpf.so.1")
        available = True
    except OSError:
        available = False
    require(available, "loadable Debian runtime library libbpf.so.1")
    for name in ("reader", "workload"):
        binary = args.build / name
        require(binary.is_file() and os.access(binary, os.X_OK), f"executable {binary}")
    if all(checks):
        print("Prerequisites available; run the scoped experiment to verify actual probe loading.")
    return 0 if all(checks) else 1


if __name__ == "__main__":
    sys.exit(main())
