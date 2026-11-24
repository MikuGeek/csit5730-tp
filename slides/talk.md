# TraceTriage · ten-minute speaker guide

Use PDF pages (including the cover). Pointing cues are in italics. Finish on page 13; pages 14–16 are display-only. Times include pauses to let the audience follow the arrows.

### 01 · 0:00–0:20 · TraceTriage

Imagine getting a warning that one process just contacted eight different destinations. Would you wake someone up? On a small server we can establish that the connections were attempted. What we cannot read from the kernel is whether someone approved the job. That distinction drives this project.

### 02 · 0:20–0:50 · Project brief

Suggestion 2 asks for a working eBPF intrusion detector. We have to observe system events, combine them into one detector, warn a user, and measure what that costs. Our target is a Debian host with about a gigabyte of RAM. The assignment does not require a language model. So our starting point was a useful local detector; any extra analysis has to earn its place.

### 03 · 0:50–1:30 · Two causes, one alert

*Trace both arrows into the middle node.* In the top case, an approved promotion job reaches eight peers. In the bottom case, a process makes the same attempts without authorization. If I hide the labels on the left, the detector gets the same signal in both cases. Raising the threshold just moves the point at which both jobs trigger. It does not answer the authorization question. To answer that, we need a record from outside this particular observation. The interesting decision is which record to open.

### 04 · 1:30–2:10 · Give ordinary code the first chance

We tried the easy version first. A frozen service profile names the relevant check: either who launched the executable or which destinations it contacted. Always inspecting ancestry leaves two routine alerts open and explicitly flags only two anomalies. But once ordinary code reads the profile field, it clears all four routine cases and flags all four anomalies. Pi ties it. *Pause on the last two rows.* That is a useful negative result: if the policy is a field, follow the field. The harder test removes that field.

### 05 · 2:10–3:05 · Which branch of the bulletin ran?

*Start at the bulletin; follow the top path.* Suppose an ordinary promotion is authorized for a specific build. An emergency override is also possible, but only with delegated sign-off. The handoff says the override paperwork was discarded and promotion went ahead normally. Fetching an approval receipt because the word “override” appears would check the wrong thing: we need the deployed revision. *Trace the middle path.* If the override actually governed the release, even the right build cannot prove that someone signed for it. Now the approval receipt matters. If the record only says that paperwork exists, neither path is established. The useful action is to stop. That is the whole task we give Pi: select evidence, or hold.

### 06 · 3:05–4:10 · Two machines and a one-way boundary

*Follow the three arrows into the ring, then move right.* Three kernel probes observe successful executions, connection attempts and opens at a reserved canary path. The ring buffers events; a libbpf reader drains them. The Python detector combines observations into rules and emits the warning right here on the VPS. A parent-policy violation or a canary warning stops on this row. *Point to the dashed arrow.* A fan-out case can also be exported: identifiers are pseudonymized, and the analyst replays a case rather than logging into the server. Read the lower row from right to left. For the semantic experiment, the analyst adds the bulletin and handoff, Pi selects a record, and shared code checks it. The VPS neither hosts a model nor waits for an API. Disconnect the analyst and local warnings still work.

### 07 · 4:10–4:55 · Follow the clock

*Trace the top row, pausing at peer eight.* Counting calls would mislead us: a retry to one endpoint is different from contacting a new endpoint. We count distinct address-and-port pairs for one process within ten seconds. At the eighth pair the rule emits a local warning. It does not wait until the window closes. The detector can still gather peer information for the snapshot. When the window closes, that snapshot carries the same case ID. The two lower boxes are outputs at different times: something to act on now, and something to investigate later.

### 08 · 4:55–5:55 · Follow a receipt to a verdict

*Trace the upper branch.* The semantic selector has a budget: the handoff is the first read; one verifier is the last. Return to our ordinary promotion. Pi selects the deployment ledger. First, code checks that the receipt belongs to this authorization. Then it checks conformance. A bound receipt for the approved build yields “expected”; a bound receipt showing a different build yields “suspicious.” *Point to the two routes into review.* A perfectly good receipt for some other promotion cannot close this one. And if the handoff is unresolved or the model times out, the alert stays open. This distinction matters: a wrong source costs us an opportunity to resolve the case, but an eloquent answer from the model cannot substitute for the receipt.

### 09 · 5:55–6:25 · Did the local IDS work?

On the Debian VPS we exercised all three rules with isolated fixture processes. Nineteen executions produced two unexpected-parent warnings; seventy-two connection attempts produced eight fan-out warnings; the reserved-path open produced one canary warning. The repeated two-endpoint workload stayed quiet. We saw no ring drops in that run. So we have positive controls, a negative control for fan-out, and a local warning independent of the analyst.

### 10 · 6:25–7:00 · What did observation cost?

*Read the bars from left to right.* We rotated three modes over five trials per mode, with the same 120 workload invocations each time. At P95 the workload took 18.90 milliseconds with the sensor off. Draining probes alone brought it to 19.43; running the full detector brought it to 23.04. That is an extra 4.14 milliseconds, about 22 percent end to end. These are workload timings, including process startup. The seconds spent on a remote model call belong to a different path.

### 11 · 7:00–8:00 · Why 80 decisions but 144 incidents?

*Point left, then follow the fork.* We calibrated ordinary code on eight development families and held out sixteen whole families. The comparison gives code and Pi the same text, the same read budget, and the same verifier. Take one of the 64 resolvable handoffs. We copy the text unchanged and attach two different receipts: one conforms and one deviates. A good selector should choose the same record both times, even though the final verdicts must be opposites. That is one source choice but two incidents. Sixteen additional ambiguous handoffs each require a hold. So accuracy counts eighty decisions, while the right side contains 144 incidents. Each has a real VPS fan-out alert. The narratives, receipts and labels are controlled fixtures so we can change the evidence without changing the question.

### 12 · 8:00–9:15 · Did the model earn its place?

*Start at the left bar.* This baseline is more than a keyword list: it combines word and character similarity, clause matching, uncertainty rules and a tuned abstention threshold. It picked the right source or hold on 46 of 80 views. DeepSeek got 68. On the same individual views, DeepSeek succeeded where code failed 27 times, and code succeeded where DeepSeek failed five times. The net is 22 more correct choices, or 27.5 percentage points. We resampled families rather than counting small paraphrases as independent evidence; the interval stayed above zero. GPT got all eighty on this same holdout. What changed for an analyst? With DeepSeek, routine alerts left open fell from 31 to eight, and explicit anomaly flags rose from 33 to 56. The price was time: 3.43 seconds at P95 against less than a millisecond for code. That trade makes sense for optional replay, not for the immediate warning.

### 13 · 9:15–10:00 · Answer the original brief

*Return to the first three rows.* We built the requested host IDS: three event types observed, three working warning rules, and measured overhead on the target machine. The last row answers a narrower question. If policy explicitly names a record, deterministic routing already solves it. If a human handoff determines which policy applied, the model chose evidence more accurately in our controlled test. The next useful test would use independently collected operator handoffs and real authorization records. The design decision I would keep is the boundary: use the kernel to observe, use rules to warn, and use Pi only to decide which proof to ask for. *Stop here for questions.*

### Display only · outside the ten minutes

- **14 · Review workload:** use for questions about cleared routine cases versus explicitly flagged anomalies.
- **15 · Triage cost:** use for the latency comparison and unnecessary reads on ambiguous views.
- **16 · Verifier catalog:** use when someone asks which system could supply a particular kind of proof.
