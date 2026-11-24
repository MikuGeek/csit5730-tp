---
name: tracetriage-slides
description: Create, update, or verify the TraceTriage course presentation in Typst using Touying. Use for slides about the eBPF sensor, Pi evidence routing, and the VPS and semantic evaluations.
---

# TraceTriage Slides

- Give each slide one focus. State it as a claim or question; split unrelated measurements rather than shrinking the type. Prefer a flow diagram for decisions and a labeled, zero-based chart for quantitative comparisons.
- Start with Suggestion 2’s deliverables; spend two or three slides on the decision to add an agent, then show system boundaries and stack, tests, and a final requirement-to-evidence ledger.
- Apply the semantic components in `slides/theme.typ`. Keep IBM Plex Serif, Material 3 color roles, spacing, connectors, and Lilaq chart geometry there; `slides/main.typ` owns the English narrative and data. Use short parallel labels that fit on one line; state scope once in the test design instead of repeating caveats.
- Edit `slides/main.typ` from the repository root. Use the pinned [Touying](https://typst.app/universe/package/touying/) theme, concise English notes, and arrows where one decision or measurement leads to the next.
- Read `README.md` for the implemented boundaries, `EVALUATION.md` for capture, overhead, and the structured-profile tie, and `SEMANTIC-EVALUATION.md` for the held-out evidence-routing protocol and results. Use `PROJECT.md` for the assignment; `OUTLINE.md` describes the plan, not proof of what shipped.
- Tell the experimental story in order: local alert → structured router ties Pi → prose changes the relevant evidence → Pi chooses a source or holds → shared code verifies the receipt. Keep the model off the alert path and do not give it credit for deciding ground truth.
- Score selection on the 80 unique held-out views, not the 144 replay incidents. Separate explicit anomaly flags from retention for review. Report latency and ambiguous-case behavior alongside the gains. Label the captured VPS alerts as real, their prose and receipts as synthetic, and the second provider run as the same holdout, not independent replication.
- Run `devenv shell -- tt-slides` from the repo root to build `build/slides/tracetriage.pdf`. Check PDF fonts, render every page, and inspect titles, labels, and the final ledger for wraps or clipping. Building the deck does not require a VPS, live model calls, or raw captures.
