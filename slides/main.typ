#import "theme.typ": deck, cover, claim, card, flow, ledger, comparison, note, evidence, excerpt
#import "maps.typ" as maps
#show: deck
#let version = "Pre Alpha"
#set document(title: "TraceTriage — " + version)

#cover(version)[TraceTriage][An eBPF intrusion detector for a small Debian host][One process attempts eight distinct destinations in ten seconds.][Would you wake up the operator?][Kernel events → local warning → evidence check]

= Our design question
#claim[What can a 1 GiB host decide on its own?]
#flow(
  card([KERNEL SIGNAL], [Count peers], [One process, ten seconds.]),
  card([LOCAL RULE], [Raise an alert], [Eight distinct peers.]),
  card([OPEN QUESTION], [Check authority], [Was this job approved?]),
)
#ledger(([Design choice], [How we test it]),
  ([Keep warnings on the VPS], [Run all three rules without an analyst.]),
  ([Measure the host cost], [Compare sensor off, probes only and full IDS.]),
  ([Justify the extra read], [Give code and Pi the same evidence budget.]),
)
#excerpt([WORKING HYPOTHESIS], [A connection count can trigger a warning. It cannot establish authorization.])

= Why an agent?  /  1 of 3
#claim[One alert can have two explanations.]
#maps.ambiguity
#excerpt([ALERT ENVELOPE], [Rule: fan-out   ·   Distinct destinations: 8])
#evidence(([WHAT BOTH CASES SHARE], [The kernel records attempted connections. A higher threshold still measures the same behavior.]),
  ([WHAT SEPARATES THEM], [A matching authorization can explain the job. The alert alone cannot supply that record.]))

= Why an agent?  /  2 of 3
#claim[When policy names the check, code suffices.]
#ledger(([Evidence strategy], [Routine kept], [Anomalies flagged], [Triage P95]),
  ([Rules only], [4 of 4], [4 of 4], [\<1 ms]),
  ([Fixed ancestry], [2 of 4], [2 of 4], [9.88 s]),
  ([Fixed destinations], [2 of 4], [2 of 4], [8.95 s]),
  ([Follow the profile field], [0 of 4], [4 of 4], [\<1 ms]),
  ([Pi follows the profile], [0 of 4], [4 of 4], [8.82 s]),
)
#evidence(([MATCHED CONTROL], [Eight frozen alerts; up to two reads per case.]),
  ([WHY THEY TIED], [The profile named ancestry in four cases and destinations in four.]))

= Why an agent?  /  3 of 3
#claim[Which policy actually governed the release?]
#maps.promotion
#excerpt([HELD-OUT HANDOFF], [“The override paperwork was discarded. Promotion crossed quarantine normally.”])

= System architecture
#claim[Alerts stay local. Triage runs off-host.]
#maps.architecture
#evidence(([SOLID PATH  /  DEBIAN VPS], [Parent, canary and fan-out rules warn without a model.]),
  ([DASHED EXPORT  /  ANALYST], [Only fan-out crosses this boundary. Pi reads case data; it has no shell or SSH tool.]))

= A case in time
#claim[The warning comes before the full record.]
#maps.window
#ledger(([Window example], [Distinct peers], [Local result]),
  ([Repeated attempts to A and B], [2], [No fan-out warning]),
  ([Seven peers, then a retry], [7], [Still below threshold]),
  ([A through H within ten seconds], [8], [Warn at H; export at close]),
)

= Who decides?
#claim[Pi asks the question. Code checks the proof.]
#maps.receipt-gate
#evidence(([BINDING  /  WHICH CASE?], [Right build, different promotion → unrelated receipt. Keep the alert open.]),
  ([CONFORMANCE  /  WHICH BUILD?], [Right promotion, different build → verified deviation. Flag the case.]))

= Test 1  /  Local detection
#claim[All three anomaly rules fired on Debian.]
#ledger(([Captured event], [Count], [Rule], [Warnings]),
  ([Successful exec], [19], [Unexpected parent], [2]),
  ([Connection attempt], [72], [8 destinations in 10 s], [8]),
  ([Canary open attempt], [1], [Exact canary path], [1]),
)
#evidence(([TEST HOST], [Debian 13.7 · 967 MiB visible RAM. An isolated cgroup kept fixture traffic separate.]),
  ([CAPTURE CHECK], [36 IPv4 + 36 IPv6 attempts; zero ring drops.]),
  ([NEGATIVE CONTROL], [Repeated calls to the same two endpoints never triggered fan-out.]))
#note[Profiles were frozen before the held-out trials. The fixture schedule supplied the labels.]

= Test 2  /  Runtime cost
#claim[Full detection added 4.14 ms at P95.]
#comparison([Workload P95 latency (ms)], (0, 10, 20, 25), (
  ([Sensor off], 18.90, [18.90]), ([Probes only], 19.43, [19.43]), ([Full IDS], 23.04, [23.04]),
), [+22%], [versus sensor off])
#evidence(([TRIAL DESIGN], [Five rotating rounds × 120 invocations. Bars show the median trial P95.]),
  ([FULL-DETECTOR FOOTPRINT], [Peak RSS: 19.4 MiB for the reader; 20.8 MiB for the detector.]))

= Test 3  /  Evidence selection
#claim[Hold the verifier fixed. Vary the router.]
#maps.paired-test
#evidence(([CAPTURED ON THE VPS], [288 execs · 1,152 connection attempts · 144 complete fan-out cases.]),
  ([CONTROLLED OFF-HOST], [Synthetic text, receipts and labels. Eight separate families for calibration.]))

= Test 3  /  Routing accuracy
#claim[Both models chose evidence more accurately.]
#comparison([Correct source or hold (80 unique test views)], (0, 20, 40, 60, 80), (
  ([TF-IDF policy], 46, [46/80]), ([Pi · DeepSeek], 68, [68/80]), ([Pi · GPT], 80, [80/80]),
), [+27.5 pp], [DeepSeek over code])
#evidence(([PAIRED WINS], [DeepSeek alone: 27 views. Code alone: 5. Net gain: 22 of 80.]),
  ([UNCERTAINTY], [Family-bootstrap 95% interval: +16.25 to +37.5 points. GPT reused the holdout.]))

= Project verdict
#claim[Warn locally. Check authorization off-host.]
#ledger(([Goal], [Evidence], [Status]),
  ([Monitor events], [3 eBPF event types], [Met]),
  ([Warn on anomalies], [3 of 3 rules fired], [Met]),
  ([Measure overhead], [Workload P95: +4.14 ms], [Met]),
  ([Extend triage with Pi], [DeepSeek: 68/80 vs. 46/80], [Gain on holdout]),
)
#evidence(([DEPLOYMENT CHOICE], [Use code for an explicit policy field. Use Pi when the handoff determines which record matters.]),
  ([NEXT VALIDATION], [Repeat the paired comparison on independent operator handoffs and real authorization records.]))

= Reference A  /  Display only
#claim[Better routing left fewer routine alerts open.]
#comparison([Routine alerts retained (64 routine incidents)], (0, 16, 32, 48, 64), (
  ([TF-IDF policy], 31, [31]), ([Pi · DeepSeek], 8, [8]), ([Pi · GPT], 0, [0]),
), [23 fewer], [left for review])
#evidence(([OTHER HALF OF EACH PAIR], [Explicit flags out of 64 anomalies: code 33, DeepSeek 56, GPT 64.]),
  ([READ THE DENOMINATOR], [All 64 anomalies stayed flagged or in review. Only a verified deviation counts as an explicit flag.]))

= Reference B  /  Display only
#claim[Model selection takes seconds off-host.]
#ledger(([Router], [Selection P95], [Holds], [Unnecessary reads]),
  ([Calibrated TF-IDF], [0.69 ms], [13 of 16], [3]),
  ([DeepSeek V4.1 Flash], [3.43 s], [12 of 16], [4]),
  ([GPT-6.2 Sol], [4.70 s], [16 of 16], [0]),
)
#excerpt([AMBIGUOUS HANDOFF], [“An override exists on paper, but the transcript doesn't say if it was exercised.”])
#evidence(([COST OF A GUESS], [No receipt was bound. All 16 stayed open even when a verifier was queried.]),
  ([TIMING BOUNDARY], [Live gateway included; up to eight decisions in flight. The host warning was already out.]))

= Reference C  /  Display only
#claim[Which record can answer which question?]
#ledger(([Verifier], [What it proves], [Verifier], [What it proves]),
  ([Ancestry], [Launching executable], [Identity], [Acting principal]),
  ([Network], [Destination owner], [Backup], [Snapshot origin]),
  ([Rollout], [Deployed revision], [Calendar], [Effective window]),
  ([Scheduler], [Queue reservation], [Approval], [Delegated sign-off]),
)
#evidence(([SCHEDULER OR CALENDAR?], [An actual queue reservation proves dispatch. A calendar entry proves only the permitted time.]),
  ([ANCESTRY OR IDENTITY?], [The parent tells us what launched the process. Credentials tell us which principal acted.]))
