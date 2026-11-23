# TraceTriage

CSIT5730 Suggestion 2: a host IDS for a 1 GiB Debian VPS, with an optional off-host triage agent. See the [assignment](./PROJECT.md), [project outline](./OUTLINE.md), and [measured results](./EVALUATION.md).

## Data Flow

- Three CO-RE tracepoints → 1 MiB eBPF ring buffer → libbpf reader → local detector. The VPS needs neither Node.js nor inference access.
- A known service with an unapproved parent → `unexpected_exec`; eight distinct IP/port destinations attempted by one process in ten seconds → `fanout`; exact absolute canary path opened via `openat` → `canary`.
- A fan-out alert appears immediately → the detector exports a pseudonymized case when the window closes. Only these fan-out cases enter Pi; other rules remain local-only.
- Pi starts with just the alert envelope → selects up to two evidence records → submits a structured verdict → the host verifies the citations and their support. Missing evidence, loss, invalid output, and timeouts retain the case for review. No tools have shell, network, or SSH access.

## Build and Test

Build on a Debian machine with the same architecture as the target. Native build dependencies: `clang`, `bpftool`, `gcc`, `libc6-dev`, `libbpf-dev`, `linux-libc-dev`, `make`.

```sh
make all
# Or build off-host without installing those packages on the VPS:
podman build -t tracetriage-builder -f Containerfile .
podman run --rm -v "$PWD:/src" tracetriage-builder

# Local tests: Python 3.10+ and Node.js 22.19+
npm ci --ignore-scripts
make test
```

Copy `build/reader`, `build/workload`, and `ids/*.py` to the target, preserving their directories. The target needs Linux BTF at `/sys/kernel/btf/vmlinux`, the three tracepoints, cgroup v2, Python 3.10+, and `libbpf1`. Run as root in an isolated test environment:

```sh
python3 -m ids.experiment --output results/vps --rounds 5 --iterations 120
```

The output directory must not exist. The experiment uses a temporary cgroup, trains profiles from routine runs, freezes them before the held-out trials, and benchmarks an identical loopback workload with the sensor off, probes draining only, and the full detector. The canary test checks an attempt at a reserved path and refuses to run if the path already exists. No external destinations, exploit code, or live attack traffic are used. Use `--functional-only` to skip benchmarking.

For a manual capture, use `sudo python3 -m ids.collect --cgroup /sys/fs/cgroup/YOUR_GROUP --profiles profiles.json > capture.jsonl` and stop it cleanly with `Ctrl-C`. A profile is `{"services":{"client":{"check":"ancestry","parents":["approved-launcher"],"destinations":[]}}}`. Destination entries are `["IP", port]` pairs; use `destinations` or `both` to require destination evidence. The optional cgroup filter matches the exact cgroup, not descendants. Omitting profiles leaves fan-out and canary detection active but disables the parent policy.

## Analyst Replay

Move the capture and labels to the analyst machine; the VPS private key is not an input. To run the repeatable test double or the real model:

```sh
npm run replay -- --capture results/vps/capture.jsonl --labels results/vps/labels.json

# Set TRIAGE_API_KEY outside the repository for an endpoint that requires it.
TRIAGE_BASE_URL=https://your-model-endpoint.example/v1 TRIAGE_MODEL=your-model \
  npm run replay -- --capture results/vps/capture.jsonl --labels results/vps/labels.json --backend live
```

The same frozen cases and two-read limit apply to fixed ancestry, fixed destinations, and adaptive Pi. A deterministic profile router is an additional control: matching it is not evidence that a model is necessary. The report distinguishes retained-alert recall (including manual review) from explicit suspicious recall; a routine case sent to review still counts as a retained false alert. Without a labels file, replay returns verdicts but does not estimate labeled performance.

## Limitations

- The detector sees successful execs and syscall attempts, not connection outcomes or file contents. It does not cover relative canary paths, other open APIs, or processes outside the configured cgroup. Basename matching is a policy heuristic, not executable identity verification.
- Ancestry is best effort beyond the direct parent. Fan-out state is bounded (4,096 process entries, 64 endpoints per incident). Incomplete and unlinked cases are not eligible for an `expected` verdict; offline replay invalidates cases if the session reports capture loss.
- The workload is intentionally small and controlled. Treat the measurements as a VPS smoke test, not production performance or a general intrusion-detection benchmark.
