# TraceTriage — Semantic Evidence Selection

## Question

When a human-written change bulletin and operator handoff determine which verification record matters, does an LLM select that record more accurately than a calibrated non-LLM policy? The task is **selecting evidence**, not guessing “normal” or “anomalous” from prose.

For example, a bulletin says a normal preview is constrained to the deployed revision, but a withdrawn preview replaced by a rescue utility is constrained to the executable that launched it. A handoff saying “the withdrawal notice was retracted before use” calls for the deployment ledger, even though it mentions withdrawal. The same bulletin with “the original track stopped before publication” instead calls for kernel-observed ancestry. An unconfirmed handoff calls for review.

## Protocol

- Hold out whole scenario families, not random sentences: 8 development families (40 unique views) and 16 test families (80 unique views). The fixture catalogs and gold routes are not given to the model as examples. The model sees only the source catalog, bulletin, handoff, and common fan-out metadata for the current view.
- Cover kernel ancestry, destination ownership, release state, workload identity, recovery provenance, job scheduling, change windows, and delegated exceptions. Handoffs include paraphrases, cancelled or superseded plans, unconfirmed execution, and conflicting accounts.
- Use 64 resolvable test views. Pair each with two receipts using identical prose: one conforms, one does not. The decision is reused for the pair so accuracy and uncertainty do not count the same prompt twice. Include 16 additional ambiguous views with no bound receipt. Total: 144 test incidents.
- Each routing arm spends one evidence read on the handoff and at most one on a verifier. The same code checks the selected receipt binding and compares conformance in every arm. Wrong or unbound receipts, missing data, and tool failures retain the alert; provider failures do not earn credit as correctly selected `hold` actions.
- **Controls:** raw IDS rules, fixed source selected on development data, and a deterministic router calibrated by leave-one-family-out validation over word/character TF-IDF, clause similarity, a curated vocabulary, negation/uncertainty heuristics, nearest-neighbor variants, and abstention thresholds. A gold-source oracle isolates the ceiling of selection under the fixture's read budget; it is not a deployable baseline.
- **Primary metric:** correct source or correct `hold` on unique views. Compare paired outcomes; bootstrap by family, not by individual incident. Secondary metrics: retained routine alerts, explicitly flagged anomalies, retained-alert recall (including reviews), safe handling of ambiguous cases, and selection latency.

## Held-Out Results

| Router | Correct selection | Routine alerts retained | Anomalies explicitly flagged | Ambiguous views held without a verifier read | Selection P95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| IDS rules only | — | 64/64 | 64/64 | — | — |
| Fixed source | 8/80 | 56/64 | 8/64 | 0/16 | <1 ms |
| Calibrated deterministic policy | 46/80 (57.5%) | 31/64 | 33/64 | 13/16 | 0.69 ms |
| Pi + DeepSeek V4.1 Flash | 68/80 (85.0%) | 8/64 | 56/64 | 12/16 | 3.43 s |
| Pi + GPT-6.2 Sol (rerun) | 80/80 (100%) | 0/64 | 64/64 | 16/16 | 4.70 s |
| Gold-source oracle | 80/80 | 0/64 | 64/64 | 16/16 | — |

Compared with the calibrated deterministic policy, DeepSeek's selection improved **27.5 percentage points** on the same 80 views: 27 model-only successes and five baseline-only successes. The family-resampled 95% interval is **+16.25 to +37.5 points**, conditional on these 16 fixture families. Routine alerts still requiring review fell from 31 to eight (74% fewer) while explicit anomaly flags rose from 33 to 56. All routing arms retained all 64 anomalies at least for review by construction; that retained recall is not the same as explicit detection.

DeepSeek did not dominate every slice: it unnecessarily queried a verifier for four ambiguous views versus three for the deterministic policy. All remained under review, because no matching receipt existed. No provider, timeout, or tool-protocol failures occurred. P95 includes the live gateway, at up to eight concurrent decisions. The holdout fingerprint is `54056c73bcf77690a306d082a56db0698b1b27a600c894bac9f98bcb4be22362`.

The GPT-6.2 Sol rerun used the identical prompt, corpus, selection budget, and verifier, with **+42.5 percentage points** over the deterministic policy (family bootstrap: **+37.5 to +47.5 points**). It resolved all 64 unambiguous views and held all 16 ambiguous ones without an unnecessary read. It had no provider or protocol failures. This is a second provider/model on the **same** held-out corpus, not another 144 cases or an independent external replication. The perfect score is specific to this run.

## Scope

The VPS generated 144 complete loopback fan-out cases: 288 exec events, 1,152 connection attempts (576 IPv4 and 576 IPv6), and zero dropped ring events. Each test incident was attached to a different captured alert. The prose, receipt binding, conformance, and ground truth are authored analyst-side fixtures. No live rollout, approval, credential, calendar, or backup services were contacted. The model performed no network or shell actions.

The fixture tests conditional language grounding and attribution, not the prevalence of those conditions in real incidents. It is not an external benchmark, a guarantee against prompt injection, or evidence of general IDS detection performance. A correctly designed structured authorization API can avoid natural-language routing; the expected advantage is where the policy is already expressed in prose and evidence acquisition is constrained.

## Reproduce

See the [capture and replay commands](./README.md#semantic-routing-benchmark). Holdout and calibration inputs are fingerprinted in the JSON report. Use `--split dev` for integration and prompt exploration; do not tune the selectors to the holdout. The checked-in synthetic corpus is for reproducibility, not model training.
