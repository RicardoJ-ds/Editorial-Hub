# 40 · Metrics & Calculations — the canonical definitions

One file per **domain**. Each answers: *what is this number, exactly?* — the formula,
where it's computed (`file:line`), its origins, the dated decisions that shaped it, worked
results, and the open threads/bugs that affect it. This is the place to **re-derive any
dashboard number** and to **update a calculation** when the rule changes.

Read this folder when you need the math, not the architecture (architecture → `10-reference/`).

## Files
- `metrics_goals_content_weighting.md` — Goals roll-up, content-type weighting (×1/×2/×0.5), LP-doubling (May'26), glossary (Jun'26), %SOW / %Published, `pacingColor`.
- `metrics_end_of_q_variance_tiers.md` — billing periods, Current-Q **actual bar vs projected variance**, the 5 variance tiers + thresholds.
- `metrics_capacity_utilization.md` — Real / Weighted / Spare, the three per-pod rates, fallback-as-distribution, ×1.4 SPEC_WEIGHT, ramp-up, Pod-1 golden numbers.
- `metrics_monthly_articles.md` — Articles / Revision-rate% / Revisions, num·den pooling, creation-vs-own-month bucketing, Notion published reference, pod attribution, editor resolution.
- `metrics_overview_ttm.md` — Pod Delivery card, the 6 milestones + 8 transitions, negative-day (B5) handling, Production History.
- `metrics_warehouse_int_layer.md` — where each calculation is **re-computed for serving** (the `editorial_int_*` map) + the B1–B12 bug-for-bug register.

## Conventions in this folder
- **Two-source rule**: every formula cites BOTH the frontend (`file:line`) AND its warehouse
  port (`etl/warehouse/pyrules.py`), because the dashboards serve from the warehouse but the
  TS is the spec. They are proven byte-identical (`etl/PARITY_REPORT_WAREHOUSE.md`).
- **Bug register**: known frontend↔doc↔warehouse divergences are tracked as `Bxx` in
  `etl/WAREHOUSE_DESIGN.md` and replicated bug-for-bug; see `metrics_warehouse_int_layer.md`.
- When a rule changes, update the domain file **in place** and add a dated line to `../log.md`
  (and a `20-decisions/` file if it's a real decision).
