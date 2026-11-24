#import "theme.typ": deck, cover, claim, card, flow, ledger, comparison, note
#import "maps.typ" as maps
#show: deck
#set document(title: "TraceTriage — An eBPF IDS for a small Debian host")

#cover[TraceTriage][An eBPF intrusion detector for a small Debian host]

= Project brief
#claim[What does Suggestion 2 ask us to build?]
#flow(
  card([01 / OBSERVE], [Capture events], [Run eBPF in the kernel.]),
  card([02 / DETECT], [Warn the user], [One IDS, local alerts.]),
  card([03 / EVALUATE], [Test the IDS], [Coverage and overhead.]),
)
#note[Deployment target: a Debian VPS with 1 GiB of RAM.]

= Why an agent?  /  1 of 3
#claim[One alert can have two explanations.]
#maps.ambiguity
#note[The threshold captures behavior. Triage asks whether that behavior was authorized.]

= Why an agent?  /  2 of 3
#claim[When policy names the check, code suffices.]
#ledger(([Evidence strategy], [Routine alerts kept], [Anomalies flagged]),
  ([Always read ancestry], [2 of 4], [2 of 4]),
  ([Follow the profile field], [0 of 4], [4 of 4]),
  ([Let Pi follow the profile], [0 of 4], [4 of 4]),
)
#note[Structured control: the same eight fan-out alerts; at most two reads per case.]

= Why an agent?  /  3 of 3
#claim[Which policy actually governed the release?]
#maps.promotion
#note[Held-out example: an operator mentions an “override” in all three handoffs.]

= System architecture
#claim[Alerts stay local. Triage runs off-host.]
#maps.architecture
#note[Kernel probes → host detector. Only the dashed fan-out export crosses to the analyst machine.]

= A case in time
#claim[The warning comes before the full record.]
#maps.window
#note[Distinct IP/port pairs count once. A repeat visit to the same peer does not advance the threshold.]

= Who decides?
#claim[Pi asks the question. Code checks the proof.]
#maps.receipt-gate
#note[Binding asks: “Does this record belong to this authorization?”]

= Test 1  /  Local detection
#claim[All three anomaly rules fired on Debian.]
#ledger(([Captured event], [Count], [Rule], [Warnings]),
  ([Successful exec], [19], [Unexpected parent], [2]),
  ([Connection attempt], [72], [8 destinations in 10 s], [8]),
  ([Canary open attempt], [1], [Exact canary path], [1]),
)
#note[967 MiB visible RAM · zero ring drops · repeated use of two endpoints produced no fan-out alert.]

= Test 2  /  Runtime cost
#claim[Full detection added 4.14 ms at P95.]
#comparison([Workload P95 latency (ms)], (0, 10, 20, 25), (
  ([Sensor off], 18.90, [18.90]), ([Probes only], 19.43, [19.43]), ([Full IDS], 23.04, [23.04]),
), [+22%], [versus sensor off])
#note[Five rotating trials per mode × 120 invocations; bars show the median trial P95.]

= Test 3  /  Evidence selection
#claim[Hold the verifier fixed. Vary the router.]
#maps.paired-test
#note[Real VPS alerts; synthetic handoffs, receipts and labels. Calibration used eight separate families.]

= Test 3  /  Routing accuracy
#claim[Both models chose evidence more accurately.]
#comparison([Correct source or hold (80 unique test views)], (0, 20, 40, 60, 80), (
  ([TF-IDF policy], 46, [46/80]), ([Pi · DeepSeek], 68, [68/80]), ([Pi · GPT], 80, [80/80]),
), [+27.5 pp], [DeepSeek over code])
#note[Family-bootstrap 95% interval: +16.25 to +37.5 points. GPT used the same holdout.]

= Project verdict
#claim[TraceTriage met the Suggestion 2 brief.]
#ledger(([Goal], [Evidence], [Status]),
  ([Monitor events], [3 eBPF event types], [Met]),
  ([Warn on anomalies], [3 of 3 rules fired], [Met]),
  ([Measure overhead], [Workload P95: +4.14 ms], [Met]),
  ([Extend triage with Pi], [DeepSeek: 68/80 vs. 46/80], [Gain on holdout]),
)
#note[Keep the warning on the host. Spend a model call only when prose determines the next check.]

= Reference A  /  Display only
#claim[Better routing left fewer routine alerts open.]
#comparison([Routine alerts retained (64 routine incidents)], (0, 16, 32, 48, 64), (
  ([TF-IDF policy], 31, [31]), ([Pi · DeepSeek], 8, [8]), ([Pi · GPT], 0, [0]),
), [23 fewer], [left for review])
#note[Explicit anomaly flags rose from 33 to 56 of 64 with DeepSeek. Unverified cases stayed in review.]

= Reference B  /  Display only
#claim[Model selection takes seconds off-host.]
#ledger(([Router], [Selection P95], [Correct holds on ambiguous views]),
  ([Calibrated TF-IDF], [0.69 ms], [13 of 16]),
  ([DeepSeek V4.1 Flash], [3.43 s], [12 of 16]),
  ([GPT-6.2 Sol], [4.70 s], [16 of 16]),
)
#note[Live timings include the model gateway. All 16 ambiguous cases remained open in every arm.]

= Reference C  /  Display only
#claim[Which record can answer which question?]
#ledger(([Verifier], [What it proves], [Verifier], [What it proves]),
  ([Ancestry], [Launching executable], [Identity], [Acting principal]),
  ([Network], [Destination owner], [Backup], [Snapshot origin]),
  ([Rollout], [Deployed revision], [Calendar], [Effective window]),
  ([Scheduler], [Queue reservation], [Approval], [Delegated sign-off]),
)
#note[The semantic replay models these sources with fixtures. Each decision can open at most one.]
