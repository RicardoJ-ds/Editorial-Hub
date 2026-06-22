# NOW — Editorial Hub

> **Last updated: 2026-06-21**
> The living "you are here." Overwrite this at the end of each session; its history lives
> in `log.md`. Keep it short — phase, what's done, the ONE next thing.

## Phase
`0.3.x` — **UI maturity**, version `0.3.28`. Prod dashboards now **serve from BigQuery + an
in-process cache** (`DASHBOARD_SOURCE=bq`), with Neon thinned to writes/RBAC/comments/DQ.
Next focus area (`0.4.x`) = CP v2 → DB migration.

## Done (recent)
- **Full knowledge-capture pass (today)** — distilled all calculation/metric/architecture work into
  **16 new dated memory files**, incl. the new `40-metrics/` calculation canon (goals-weighting,
  variance/tiers, capacity, monthly-articles, TTM, warehouse-int) + normalization-proposal analysis.
  Surfaced 4 doc-drift items (esp. **B1**: glossary ×0.5 doc'd but not in code). See `log.md` top entry.
- **BQ-serving cutover live in prod** — BQ read cache + RBAC resolve cache (`c7cb29d`), 52/52
  endpoint parity verified, token invalidation working. See [[bq-serving-cutover]].
- Case-insensitive RBAC client-scope match (n8n / Growth Pod 3) — `5565230`.
- Dr Squatch goals fixed: sheet rename + 18 orphan rows deleted on prod. See [[goals-rename-orphan]].
- `0.3.28` — Help is glossary-only; changelog hidden.
- **Memory system moved in-repo** (bi-forge bootstrap) — knowledge migrated from the global folder.

## Uncommitted in the working tree
`etl/PARITY_REPORT_ENDPOINTS.md`, `etl/reports/mappings_{clients,editors,writers}.csv`,
`tasks/todo.md` — decide whether these get committed.

## Iteration targets (Ricardo, ongoing)
Keep iterating on three fronts — each now has a canonical memory home to update in place:
1. **Monthly Articles** → [[metrics-monthly-articles]] (+ [[analysis-article-count-data-quality]]).
2. **Spreadsheet normalization proposal** → [[analysis-normalization-proposal]] (+ [[normalization-scope-2025]]).
3. **The Hub** → [[reference-cp-v2]] (0.4.x DB migration) + the `40-metrics/` calc files.

## ▶ Single next action
Validate the BQ cutover paid off: measure **7-day Neon egress**; if it dropped as expected,
plan **Phase 2 — retire the Neon warehouse sink** (the dual-sink publish currently writes
both). Loose ends to confirm: n8n Railway deploy green; inactive-clients "last ended Q".

## Read-first order
1. `MEMORY.md`
2. this file (`NOW.md`)
3. `index.md`
4. `00-strategy/` → drill into the named file
