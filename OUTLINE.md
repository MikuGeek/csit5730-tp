# TraceTriage: An eBPF IDS for a 1 GB Debian VPS

- **Topic** → [Suggestion 2: eBPF-based Intrusion Detection System](./PROJECT.md#suggestion-2-ebpf-based-intrusion-detection-system).
- **Research question** → When two processes trigger the same rule, can an agent choose the evidence that distinguishes routine work from an anomaly? Compare against fixed rules at matched recall.

## 1. What the IDS detects

- Successful process execution (`sched_process_exec`) → link executable to parent → flag a parent–child pair absent from the service baseline.
- IPv4/IPv6 connection attempts (`sys_enter_connect`) → count distinct destinations per process in 10 seconds → flag unusual fan-out. An attempt does not imply a successful connection.
- File-open attempts (`sys_enter_openat`) → match an absolute path reserved for a test canary → warn immediately; no model may suppress this alert. Relative paths and other open APIs are out of scope.

## 2. What runs where

- **Debian VPS** → verify BTF, tracepoints and BPF privileges → load three small C/libbpf probes → one collector joins events by process lifetime and emits local alerts. Build off-host; run no Node.js service or model on the VPS.
- **Bounded capture** → fixed-size maps + 1 MiB ring buffer → export compact incident windows, not raw logs. Count dropped events → mark incomplete windows rather than interpreting missing evidence as normal.
- **Analyst machine** → replay pseudonymized windows → run the triage agent. No SSH key, command arguments or file contents enter model context; inference failure leaves the local warning intact.

## 3. What the agent decides

- **Pi’s agent core, not its coding agent** → one case per state machine: `candidate → evidence request → observation → verdict`. The model chooses *which fact to inspect next*; host code owns transitions and budgets. No shell, skills or live-host access.
- **Example** → the same client contacts eight loopback test endpoints under two launchers → fan-out alone cannot distinguish the runs → agent requests ancestry → compares launcher and destination set against a frozen service profile → returns `expected`, `suspicious` or `insufficient evidence`.
- **Evidence contract** → at most two requests from `{process ancestry, destination summary, service profile}` → verdict must cite returned record IDs. Invalid IDs, missing evidence or timeout → retain candidate for review. “Expected” is a triage label, not proof of safety.

## 4. How to test it

- **Ground truth** → collect normal service runs → freeze profiles and thresholds → run held-out, labeled fixtures: routine maintenance, alternate launcher, loopback fan-out and canary access. Labels come from the fixture manifest, not the detector.
- **Agent value** → replay identical windows through rules only, fixed-order evidence lookup and adaptive lookup → give both lookup variants the same model and two-request budget → compare false alerts at matched recall; also report abstentions, requests per case and verdict latency.
- **Course metrics** → report event types captured and anomaly classes detected out of the three planned → repeat one workload with IDS off, probes only and full local detection → report CPU, collector peak RSS, BPF map memory, p95 workload latency and event drops. Treat 1 GB as a constraint, not a performance result.

## 5. Milestones and deliverables

- **M1** → load probes → demonstrate one canary warning with the analyst machine disconnected.
- **M2** → add process correlation, fan-out counters and labeled fixtures → establish rules-only results.
- **M3** → implement bounded Pi triage → replay the paired-launcher test → report where adaptive lookup helps or fails.
- **Submission** → probe and collector source + agent state machine + replay fixtures + benchmark script → slides with one incident trace and measured trade-offs.
