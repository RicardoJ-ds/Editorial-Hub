# Warehouse parity report (raw → int → views refactor)

_Generated 2026-06-10 21:44 UTC by `python -m etl.warehouse.parity`. Frontend dump from
`frontend/scripts/parity-dump.ts` (the REAL exported dashboard functions
run on live API data) + live API replays, diffed against the new
`graphite_bi_sandbox` int tables._

## Verdict: ✅ FULL PARITY

| Check | Rows / fields | Match |
|---|---:|---|
| client_q_snapshot vs REAL frontend functions | 3,444 | ✅ identical |
| goals 3-step aggregation vs REAL aggregateGoalsSummary | 76 | ✅ identical |
| member-utilization replay (all months) | 302 | ✅ identical |
| pod-summary replay | 105 | ✅ identical |
| articles/monthly replay (pod_axis=editorial) | 2,248 | ✅ identical |
| articles/monthly replay (pod_axis=growth) | 2,248 | ✅ identical |

## What this proves
- The variance brain (billing periods, current/last Q, cumulative
  end-of-Q variance, symmetric tiers, 1st-Q escape, BOTH Overview and
  D1 variants) computed in the warehouse equals the dashboard's own
  TypeScript output for every client, every field.
- The goals 3-step aggregation (max-of-week → content-type weighting →
  goal-gated totals) matches `aggregateGoalsSummary` exactly.
- Capacity (per-pod latest-version, per-member utilization for every
  month) and Monthly Articles (both pod axes) replays are byte-identical.
