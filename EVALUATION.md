# TraceTriage — VPS Evaluation

## Setup

- Debian 13.7, x86-64, Linux `6.12.101+deb13-amd64`, 967 MiB visible RAM.
- Debian container build → deploy reader/workload binaries and Python source → temporary cgroup v2; only fixture processes are monitored. No daemon or package installation on the VPS.
- Two training runs per service → record 32 routine connection attempts → freeze two profiles → run ten held-out trials. Labels come from the fixture schedule, not the detector. Repeated trials use the same fixture families; they are not independent samples of production behavior.
- Analyst runs Pi with `bean/auto/deepseek-v4.1-flash-1017` via an OpenAI-compatible gateway. The model receives only the case envelope and requested pseudonymized records, never the labels.

## Detection Coverage

| Signal | Captured | Local rule alerts |
| --- | ---: | ---: |
| Successful exec | 19 | 2 unexpected parents |
| Connection attempts | 72: 36 IPv4, 36 IPv6 | 8 fan-out cases |
| Exact canary `openat` attempts | 1 | 1 canary alert |

Zero ring drops; all three planned rules fired. A fixture that repeatedly contacted the same two endpoints did not trigger fan-out. A standalone canary smoke test also fired with no analyst process involved.

## Replay

All five arms got the same eight fan-out cases: four routine and four anomalous. Retained alert recall was 4/4 for all arms; this includes abstentions sent to review. The three non-fan-out alerts stayed local and were excluded from this comparison.

| Mode | Routine cases retained | Anomalies explicitly flagged | Abstentions | Reads/case | P95 triage |
| --- | ---: | ---: | ---: | ---: | ---: |
| Rules only | 4/4 | 4/4 | 0 | 0 | <1 ms |
| Pi, fixed ancestry | 2/4 | 2/4 | 4 | 1.75 | 9.88 s |
| Pi, fixed destinations | 2/4 | 2/4 | 4 | 2 | 8.95 s |
| Deterministic profile router | 0/4 | 4/4 | 0 | 2 | <1 ms |
| Pi, adaptive | 0/4 | 4/4 | 0 | 2 | 8.82 s |

The adaptive agent read the profile first in all eight cases, then chose ancestry four times and destinations four times. Adaptive lookup beat fixed lookup at matched retained recall, but the profile already declares the right check: a deterministic policy router tied on accuracy and ran substantially faster. **The experiment demonstrates the value of context-sensitive evidence selection, not a need for an LLM on these fixtures.** Model calls ran off-host, four cases in flight; P95 is the maximum of eight observations and includes provider latency. A free-text pilot chose the correct evidence 8/8 times but produced only one validated verdict; the reported run uses the structured verdict tool.

## VPS Overhead

Five rotating rounds per mode, 120 identical fixture invocations per trial; values are medians of per-trial results. P95 invocation latency includes launcher startup. CPU values are total CPU milliseconds per trial (including sensor setup/teardown); RSS values are per-process peaks, not simultaneous totals.

| Mode | Trial wall | Invocation P95 | Workload CPU | Sensor CPU | Reader / detector RSS | Map payload | Drops |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Off | 1.118 s | 18.90 ms | 540 ms | 0 ms | — | 0 | — |
| Probes + drain | 1.168 s | 19.43 ms | 564 ms | 52 ms | 20.8 / — MiB | 1,048,592 B | 0 |
| Full detector | 1.435 s | 23.04 ms | 589 ms | 228 ms | 19.4 / 20.8 MiB | 1,048,592 B | 0 |

The full detector's invocation P95 rose about **22%** versus off in this short workload. The map payload includes configured ring/storage capacities, not kernel metadata or virtual mapping overhead. The benchmark stops the sensor after the workload, so windows not yet expired are exported as incomplete at shutdown; the separate functional run waits for all eight windows to expire. The workload includes process creation and syscall overhead; it is not a microbenchmark of an individual probe.

## Reproduce

- [Build and test instructions](./README.md#build-and-test) generate `training-summary.json`, `functional.json`, `capture.jsonl`, `labels.json`, and `benchmark.json`.
- [Analyst replay](./README.md#analyst-replay) emits per-case evidence requests, verdicts, abstentions, and matched-recall comparisons. The default scripted backend verifies plumbing; use `--backend live` to test a real model.
