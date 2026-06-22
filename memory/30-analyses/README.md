# 30 · Analyses — point-in-time investigations

Investigations, comparisons, and audits. Lower load priority — useful for "why did we
conclude X?" but not needed to understand the current plan.

Two shapes live here:

1. **Single analyses** — `analysis_<topic>.md`. A focused write-up: question, method,
   result, verdict. Deliver findings as short bullets + tables, not prose.

2. **Versioned audit rounds** — a folder per round for repeatable cycles, never overwritten:
   ```
   <topic>-review-v{N}/
   ├── 00-mission.md            # trigger, inputs, hypotheses
   ├── 01..09-*.md              # individual audits (one per angle/agent)
   ├── 10-implementation-log.md # what shipped (file:line + rationale)
   ├── 20-results-comparison.md # verdicts + ROI-ranked next steps
   └── evidence/                # IMMUTABLE snapshots — never edit; re-runs go in evidence-v{N}/
   ```
   When a finding recurs across rounds, promote it to a `00-strategy/`/`10-reference/` page.
