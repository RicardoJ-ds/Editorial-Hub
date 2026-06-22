---
name: now
description: Live status + next-session handoff. Read FIRST each session.
metadata: 
  node_type: memory
  type: project
  originSessionId: 23c6899d-f043-4d1c-9662-68a72342385a
---

# NOW — handoff (2026-06-13)

## ✅ MIGRATION DEPLOYED TO PROD (2026-06-12 20:24 UTC)
Everything merged (539d264) + pushed + verified live: dual-sink warehouse
(Neon schema warehouse: 12 tables/20 views + BQ), Hub cutover (RBAC + history
from team_pod_assignments_editorial_history), daily cron 09:00 UTC, new sheet
origins, ET CP V14 auto-ingested, Felt 2026-04=11 exact in prod.
Manual full resyncs in prod: use the UI Re-sync button (proxy kills one-shot
/sync-run at 300s; thread completes anyway). Open: Team KPIs capacity
iteration · drop_legacy --confirm · DaniQ leftovers (Meta/Mirage, "/" list,
jessjadesm@, Anabelle) · capacity-planning-brief.md sent to other session.


## FINAL ARCHITECTURE: DUAL-SINK (2026-06-11, branch `feature/etl-warehouse-refactor`, NOT merged)
Ricardo audited the BQ-only repoint and chose (and we implemented) **dual-sink**:
the warehouse publish writes the SAME in-memory processed rows to BOTH

1. **Postgres schema `warehouse`** (11 tables + all 19 views in PG dialect via
   `etl/warehouse/pg_sink.py`) — **the app serves this**:
   `DASHBOARD_SOURCE=postgres` (default), ~10–20ms/endpoint.
2. **BigQuery `graphite_bi_sandbox`** (25 tables + 19 views) — always-fresh
   analytics mirror for other projects + backup.

One ~20s parallel publish (ThreadPoolExecutor×8, `pg_advisory_lock(815001)`,
per-table failure isolation, single `_BUILD_TS`). `X-Data-Source` per-request
override gated by `DATA_SOURCE_OVERRIDE_ENABLED` (true in local compose for
parity harness, **false/OFF in prod**). Backend Dockerfile now `COPY etl/` +
railway.toml watches `etl/**` (critical prod fix).

**Verification ALL GREEN (re-run 2026-06-11 after audit fixes):**
- `python -m etl.warehouse.parity`: FULL PARITY — 3,612 snapshot fields +
  NEW 1,233 per-month period-map check (`compare_client_months`) + goals +
  capacity/articles replays, all vs REAL frontend TS fns (parity-dump.ts now
  also emits published_live/pct_published + ovr/d1 period maps).
- `python -m etl.warehouse.endpoint_parity`: **53/53 cases** (37 original +
  16 new: skip>0 pagination exact-sequence + filter params) PG vs BQ identical.
- App default (Postgres) serves real pod rollups in ~13ms.

**4-agent adversarial audit (2 critical, 14 major) — ALL FIXED**, incl.:
prod-image etl/ gap, deliveryMeta end-date fold dedent, flush partial-failure,
wizard publish 500→failed-step, ungated header override, id tiebreaks both
paths, synthetic flag plumbing (backend `ImportResultResponse.synthetic` +
`SyncResultDetail`), month-rollover escalation in warehouse/run.py, pg_sink
execute_values + month-name regex, bq readers consume passthrough views,
NEW `v_editorial_fct_goals_client_totals` (step-3 goal-gating in SQL, both
dialects).

**Docs updated:** WAREHOUSE_DESIGN.md (Final architecture — dual-sink section;
counts 17 raw/8 int/25 physical/19 views/24 routes; delivery_templates
re-added for /api/dashboard/pacing; collation note), etl/README.md
(phase-1 deprecation banner), CLAUDE.md (Architecture warehouse bullet +
sync `@warehouse-publish` step), frontend/AGENTS.md (Sync UX synthetic steps).

**AWAITING RICARDO'S VALIDATION before merge** (his explicit gate). After
merge: phase 2 = thin-reader endpoints (SELECT the views directly), then
decommission phase-1 flat `editorial_hub_*` tables. Bug-register fixes
(glossary ratio etc.) = DaniQ decisions, separate.

Refresh = `./etl/refresh.sh [current|past|full]` (= SYNC / Re-sync / both).
SYNC button / Re-sync / wizard publish automatically via manifest steps
`@warehouse-publish[-past]` (full scope publishes exactly once at end).
Backend uvicorn: NO --reload — `docker compose restart backend` after edits.

## WAREHOUSE LAYERS (what exists)
- 17 `editorial_raw_<topic>` + 8 `editorial_int_*` + 19 `v_editorial_dim_/fct_*`.
  Build: `python -m etl.warehouse.run [--scope ...] [--layers raw,int,views]`.
- `etl/warehouse/pyrules.py` = line-faithful ports of the frontend math
  (billing periods BOTH variants, computeCurrentQ/LastFullQ, quarterMeta,
  varianceTier, deliveryMeta override, goals 3-step, js_round).
- `etl/WAREHOUSE_DESIGN.md` = schema + semantics + 12-entry bug register
  (replicated bug-for-bug; fixes are a SEPARATE DaniQ decision).
- 24 dashboard routes branch on `Depends(get_data_source)` →
  `app/services/bq_dashboard.py` (reads warehouse views, either sink).

## Open / next session
- **Ricardo validates the branch → merge** (standing rule: don't merge/push
  without his OK; push auto-deploys Railway+Vercel).
- Prod rollout needs: Neon gets the `warehouse` schema on first publish;
  Railway env `DASHBOARD_SOURCE=postgres` (default already) +
  `DATA_SOURCE_OVERRIDE_ENABLED` unset (defaults false).
- **DaniQ decisions D1–D8** gate: editor Lauren/Sam, 2022 names, client calls
  (ChatGPT→OpenAI?, Tempo XYZ, splits), 20 add-to-Hub tabs, month basis (D7).
- **Code-side DQ fixes still pending**: date-parse (Vimeo/Webflow/GoPuff 471
  NULL-month), Felt header detection, jumbo/LP weighting via title tags.
- Keep the Gantt sheet updated as a living doc (NOT a release).

## Standing facts
- ETL runs INSIDE the backend container: `docker compose exec -T backend
  python -m etl.warehouse.run [...]` · `python -m etl.warehouse.parity` ·
  `python -m etl.warehouse.endpoint_parity` · legacy phase-1: `python -m
  etl.run` / `etl.parity` (deprecated, see etl/README.md banner).
- BQ: project graphite-data, dataset graphite_bi_sandbox, tables `editorial_*`;
  SA key /app/sa-key.json; legacy `editorial_hub_*` flat tables = phase-1,
  deprecated, decommission post-merge.
- Golden capacity check: Pod 1 May 2026 Real 54.44/72.59/94.69 · Wtd
  69.29/92.39/120.51 (`/api/capacity/member-utilization?year=2026&month=5`).
- Parity dump: `cd frontend && npx tsx scripts/parity-dump.ts` then
  `docker cp /tmp/parity_frontend_dump.json editorial-hub-backend-1:/tmp/`.
- DaniQ-facing CSVs regenerate via `python -m etl.reports`; reports in
  `etl/reports/`, explainers `etl/DATA_QUALITY_CAVEATS_for_DaniQ.md` +
  `etl/CAPACITY_CALCULATION_for_DaniQ.md`.
- D3 carets: confirmed = linked sub-articles in COPY column (not duplicates) —
  do NOT "copy row above". Jumbo/LP weighting from `[jumbo]`/`(LP)` title
  tags, pending. Awaiting DaniQ confirmation.
