# TraceTriage

CSIT5730 Suggestion 2: a host IDS for a 1 GiB Debian VPS, with an optional off-host triage agent. See the [assignment](./PROJECT.md), [project outline](./OUTLINE.md), [initial VPS results](./EVALUATION.md), and [semantic routing evaluation](./SEMANTIC-EVALUATION.md).

Course presentation: [Pre Alpha PDF](./slides/exports/tracetriage-pre-alpha.pdf) · [Touying slides](./slides/main.typ) · [ten-minute speaker guide](./slides/talk.md) · [build instructions](./ENVIRONMENT.md#build-the-slides).

## Data Flow

- Three CO-RE tracepoints → 1 MiB eBPF ring buffer → libbpf reader → local detector. The VPS needs neither Node.js nor inference access.
- A known service with an unapproved parent → `unexpected_exec`; eight distinct IP/port destinations attempted by one process in ten seconds → `fanout`; exact absolute canary path opened via `openat` → `canary`.
- A fan-out alert appears immediately → the detector exports a pseudonymized case when the window closes. Only these fan-out cases enter Pi; other rules remain local-only.
- Pi starts with just the alert envelope → selects up to two evidence records → submits a structured verdict → the host verifies the citations and their support. Missing evidence, loss, invalid output, and timeouts retain the case for review. No tools have shell, network, or SSH access.

## Build and Test

The recommended development path is [the pinned devenv environment](./ENVIRONMENT.md). On an x86-64 Linux analyst machine with Nix and devenv installed:

```sh
devenv test
devenv shell -- tt-bundle
```

The first command compiles the local tools and runs the deterministic tests. The second builds a separate Debian-compatible archive; do not copy the native Nix binaries to the VPS. Neither command needs VPS credentials or an LLM endpoint. See the [deployment checklist](./ENVIRONMENT.md#target-checklist) for the external host requirements.

### Without devenv

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

## Semantic Routing Benchmark

The follow-up removes the machine-readable “check this source” field. A prose change bulletin and a current operator handoff determine which of eight verifiers is relevant. Pi and a calibrated lexical/TF-IDF router see the same text and choose at most one verifier. Identical deterministic code checks that the selected receipt is bound to the applicable authorization; the model cannot clear the alert itself.

Use the same off-host build and target prerequisites as above. On the target, run as root in an isolated test environment, then copy the capture to the analyst machine:

```sh
python3 -m ids.corpus_capture --cases 144 --output results/semantic-vps
```

On the analyst machine, use the checked-in textual corpus and generated receipt fixtures:

```sh
node analyst/semantic-replay.mjs --capture results/semantic-vps/capture.jsonl > baseline.json
# Set TRIAGE_BASE_URL, TRIAGE_MODEL, and TRIAGE_API_KEY as in Analyst Replay.
node analyst/semantic-replay.mjs --capture results/semantic-vps/capture.jsonl \
  --live --concurrency 8 > heldout-live.json
```

Use `--split dev` (no capture needed) to try a provider without using the holdout. The default holdout includes 16 disjoint scenario families; use the reported corpus fingerprint to reproduce the same labels. The VPS alerts are real, but the incident narratives, labels, and the eight verifier receipts are controlled analyst-side fixtures, not real infrastructure integrations. The original local detection path is unchanged.

## Multi-Verifier Handoff Experiment

Pi makes one selection call per synthetic handoff and returns a set of verifier names. The host checks the corresponding receipt fixtures against the case authorization. Every required check needs a conforming, bound receipt for an `expected` verdict. A bound receipt that fails its check yields `suspicious`. Cases with missing evidence or no established requirements go to review.

```sh
npm run --silent semantic:multi > multi-baseline.json
# Set TRIAGE_BASE_URL, TRIAGE_MODEL, and TRIAGE_API_KEY as for live Analyst Replay.
npm run --silent semantic:multi -- --live > multi-live.json
```

The offline command runs the all-eight control. The live command adds Pi's results for the same 32 handoffs. Each of the 24 resolvable handoffs has two receipt variants with the same model input. The remaining eight have insufficient information. The report scores exact set matches, extra and missing checks, and verdict accuracy. It distinguishes anomalies sent to review from anomalies marked `expected`. These are simulated triage outcomes on authored handoffs. The experiment runs on the analyst machine.

In one run with DeepSeek V4 Pro (`deepseek-v4-pro`, thinking disabled in the API request), Pi exactly matched the required set in **17/32** handoffs: 5/12 single-check, 8/12 compound, and 4/8 with insufficient information. It selected 21 extra checks across 15 handoffs and omitted zero required checks. Receipt verification produced 56/56 correct verdicts, including 24/24 explicit suspicious verdicts. The all-eight control also reached 56/56 correct verdicts, with 0/32 exact set matches. Four handoffs with insufficient information still elicited tool selections from Pi. Receipt verification sent all eight such cases to review.

## Limitations

- The detector sees successful execs and syscall attempts, not connection outcomes or file contents. It does not cover relative canary paths, other open APIs, or processes outside the configured cgroup. Basename matching is a policy heuristic, not executable identity verification.
- Ancestry is best effort beyond the direct parent. Fan-out state is bounded (4,096 process entries, 64 endpoints per incident). Incomplete and unlinked cases are not eligible for an `expected` verdict; offline replay invalidates cases if the session reports capture loss.
- The workload is intentionally small and controlled. Treat the measurements as a VPS smoke test, not production performance or a general intrusion-detection benchmark.
