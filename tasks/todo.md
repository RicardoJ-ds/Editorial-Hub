# Editorial Hub — Task Tracker

> **Last reviewed:** 2026-04-26
> **Related docs:**
> - [`/CAPACITY_PLANNING_V2.md`](../CAPACITY_PLANNING_V2.md) — CP v2 schema + phase status
> - [`/.docs/dashboard-data-flow.md`](../.docs/dashboard-data-flow.md) — migration plan
> - [`/.docs/prd-compliance-audit.md`](../.docs/prd-compliance-audit.md) — PRD coverage
> - [`/CLAUDE.md`](../CLAUDE.md) — project overview

---

## ✅ Completed

### Foundation
- [x] Phase 0: Scaffolding (Next.js + FastAPI + PostgreSQL + Docker Compose)
- [x] Phase 1: Seed DB from CSVs (77 clients, 394 deliverables, 12 team, 65 capacity, 528 KPIs)
- [x] Phase 1: Data Management CRUD UI (Clients, Deliverables, Capacity, KPI Entry)
- [x] Phase 2: Dashboard 1 — Editorial Clients (Contract & Timeline + Deliverables vs SOW)
- [x] Phase 3: Dashboard 2 — Team KPIs (KPI Performance + Capacity Projections + AI Compliance)
- [x] Phase 4: BigQuery sync service + Home page + Admin endpoints
- [x] UI/UX: Graphite DS, logo, dark theme, sidebar/header
- [x] Chart library: donut, area, bar, heatmap, sparklines, pacing badges
- [x] Google Sheets Import Wizard — 5-step flow over Sheets API
- [x] Operating Model, Delivery Schedules, Engagement Requirements, Meta Deliveries sheets integrated
- [x] Handoff documentation
- [x] CLAUDE.md + PRD compliance audit

### Auth (Apr 9)
- [x] Google OAuth shipped (`e1ae4bf`) — domain-restricted to `@graphitehq.com`, JWT cookie via `AUTH_SECRET`. **Role-based access still deferred.**

### Dashboard refinements (Apr 14–18)
- [x] Contract & Timeline table: 17 → 9 columns + source sheet link (`dc278ae`, `6667d67`, `3a9aa13`)
- [x] Client Delivery Detail table removed — duplicated by cards above (`4e3e14a`)
- [x] Deliverables vs SOW: per-client cards above the detail section (`51413cb`, `e2dbb16`)
- [x] Pod-grouped layout with pod aggregate sitting directly above per-client cards (`8f42a75`, `58ead94`, `e631c0d`)
- [x] Pod Matrix moved from Contract to Deliverables tab; pod labels normalized end-to-end (`50e3028`, `91e4235`, `969c998`)
- [x] DeliveryTrendChart refactored to heatmap; formula flipped to Delivered ÷ Invoiced with Month/Quarter toggle (`34867f4`, `3a07fa2`)
- [x] Pipeline by Pod redesigned as compact approval-rate grid (`df158a0`)
- [x] Cumulative Pipeline + Weekly Breakdown Matrix surface every CB / AD column (`6796be3`)
- [x] Client Engagement Timeline: % Delivered view + totals sidebar (`9dc6996`)
- [x] Time-to Metrics: MoM trend + 8-option metric selector + outlier y-cap (`f57960c`, `9090b1f`, `044b4dc`)
- [x] FilterBar: month-range slider default current ±6, month-granular only (`beb3b76`, `9e5587d`)
- [x] Tooltip explicit dark surfaces, Diff tooltip rewritten (`7aa4771`, `708575d`, `14ce0bc`)
- [x] New backend endpoint `GET /api/dashboard/client-production` (`bb5af44`)

### Capacity Planning v2 prototype (Apr 9–18) — all frontend/`localStorage`
- [x] Phase 1 — Unified month context (`ac9834c`)
- [x] Phase 2 — Copy-forward + validation + close-month (`e103c0c`)
- [x] Phase 3 — Leave + Overrides editors (`32bca76`)
- [x] Phase 4 — Weekly actuals grid (`edd52d7`)
- [x] Phase 5 — Admin CRUD for 5 dim tables (`e076ad6`)
- [x] Phase 6 + 7 — Migration validator, diff view, global search, quarter rollup (`23d1020`)
- [x] Phase 8 — All dashboard-feeding tables editable in Maintain (`c675fbd`)
- [x] Schema page: fullscreen toggle + click-to-highlight table + its joins (`5f5bb42`)
- [x] Left-rail nav, sticky chrome (`54153af`, `83dcc69`, `1fd7b75`, `bb1c5e1`)

### Infra
- [x] Notion import: paginate + bulk upsert (`612c854`)
- [x] Railway Dockerfile COPY paths fixed (`6ce65ff`, `99fb796`)

### Dashboard 1 UX overhaul (Apr 19–26)
- [x] Scope-aware overview cards on all three Tab 2 sections — `DeliveryOverviewCards`, `CumulativePipelineCards`, `GoalsOverviewCards` (single client / pod / portfolio modes)
- [x] Removed legacy `PipelineFunnelChart` (its job is done by per-pod cards inside `CumulativePipelineCards`)
- [x] Per-client + per-pod pacing chips (Behind / On-Pace / Ahead) — SOW-weighted
- [x] Pacing-aware lifetime % colors via shared `pacingColor()` (no more "new client looks bad" bias)
- [x] Pipeline stage palette retuned to strictly Graphite DS swatches: P3 → P2 → P1 + WN1 (Topics → CBs → Articles → Published)
- [x] Sticky h2 section headers (`top-[160px]`) + `SectionIndex` left-side anchor nav with scroll-spy + click-to-jump (xl+)
- [x] Per-client gauges in pod subsections — always-visible grid (no dropdown), reuses `ClientMiniGauge`
- [x] Content-type weighting (article ×1, jumbo ×2, LP ×0.5) applied via 3-step aggregation (max-of-week per CMC → weighted client/month → pod totals) — changes published totals vs. before
- [x] "As of" labels derived from latest data row (Operating Model / scopedRows), not calendar-now
- [x] `FilterBar`: zero-match fallback to "All Time" when filters yield no clients
- [x] `TimeToMetrics` tooltip now shows From/To dates alongside Δ days
- [x] AI Compliance tab on D2: 3 `SectionIndex` subsections (AI Flagged / Rewrites / Surfer API)
- [x] `GoalsMonthTable`: sticky h3 column headers, sticky client cells, per-client expand to per-content-type sub-rows
- [x] Auto-fit date range on filter changes (`FilterBar`)
- [x] Data-quality warning banner on Monthly Goals — flags pre-Aug/Sep 2025 sparseness
- [x] Tooltip standardization — every metric tooltip now uses `TooltipBody` (uppercase mono title + 2–3 bullets) with tight triggers
- [x] `framer-motion` (12.38.0) added for layout animations on scope-aware swaps
- [x] AI Compliance tab on D2 wired to the same `SectionIndex` + sticky h3 pattern

---

## 🚧 Pending — P1

### CP v2 — backend + cutover (this is the big one)

Ship the UI's promise. Everything below is a no-UI-change swap: `localStorage`
→ DB. See `.docs/dashboard-data-flow.md` for the sequence.

**Phase A — Schema foundation**
- [ ] Alembic migration: all `cp2_dim_*` + `cp2_dim_month` + `cp2_dim_week`. Seed `cp2_dim_month` (2022-01 → 2028-12) and `cp2_dim_week`.
- [ ] Alembic migration: all `cp2_fact_*` tables
- [ ] Alembic migration: SQL views `cp2_v_member_effective_capacity`, `cp2_v_pod_monthly`, `cp2_v_pod_monthly_actuals`
- [ ] `backend/scripts/cp2_backfill.py` — one function per legacy → cp2 mapping, idempotent

**Phase B — Editable tables move first** (already app-managed, no UX regressions)
- [ ] Backfill `cp2_dim_{client,team_member,pod,engagement_tier}` from existing tables
- [ ] Backfill `cp2_fact_delivery_monthly` from `deliverables_monthly` + `production_history` (union on `client_id × month`)
- [ ] Backfill `cp2_fact_{pod_membership,client_allocation}` from `team_members.pod` + `clients.editorial_pod`
- [ ] Backfill `cp2_fact_kpi_score` from `kpi_scores` (1:1 + nullable `client_id`)
- [ ] New routers `/api/cp2/{dims,facts,views}/*`
- [ ] Rewire `_store.tsx` from `localStorage` to `apiGet` / `apiPost`

**Phase C — Dashboard cutover** (A/B against legacy endpoints for one sprint)
- [ ] `/api/dashboard/client-production` → read from `cp2_fact_production_history` + `cp2_fact_delivery_monthly`
- [ ] `/api/deliverables/` → `cp2_fact_delivery_monthly`
- [ ] `/api/capacity/` → `cp2_v_pod_monthly`
- [ ] `/api/kpis/` → `cp2_fact_kpi_score`
- [ ] Diff responses in prod for 1 sprint; flip the reader

**Phase D — Move the read-only sources**
- [ ] Build Maintain UI for `cp2_fact_pipeline_snapshot` (monthly pipeline). Backfill from `cumulative_metrics`
- [ ] Build Maintain UI for `cp2_fact_actuals_weekly`. Backfill from `goals_vs_delivery`
- [ ] Retire Master Tracker ingestion

**Phase E — Long tail**
- [ ] `cp2_fact_article` backfill from `notion_articles` (writer/editor string → FK)
- [ ] `cp2_fact_{ai_scan,surfer_api_usage}` — rename + add FKs
- [ ] Drop legacy tables from `models.py` + `seed_data.py`

**Decisions blocking Phase A** (see `.docs/dashboard-data-flow.md` §6)
- [ ] Confirm month/week key format (`YYYY-MM` / `YYYY-Www`)
- [ ] Keep `production_history` separate or merge into `delivery_monthly.is_actual`?
- [ ] Notion string → FK: fuzzy matcher, or store `raw_writer_name` + null FK?
- [ ] External sheet edits after cutover: hard-stop or audit-only ingest for 1 quarter?

### Small P1 items (unrelated to CP v2)
- [ ] Quarter picker on D2 (PRD §5 D2 Filters) — ~2h
- [ ] Auto-detect latest CP version (PRD §5 D2 Data Sources) — ~3h
- [ ] Revision Rate accuracy — needs daily snapshot infra
- [ ] Article browser (PRD §11 nice-to-have) — ~4h; data already in DB
- [ ] Deploy to Railway with the Notion pagination fix and verify rows_imported > 20,000

---

## ⏳ Pending — P2 (external deps)

- [ ] External feedback form for External Quality scoring
- [ ] SE mentorship form (Mentorship KPI)
- [ ] Auth: role-based permissions (Editor sees own / SE sees pod+clients / CP+Leadership sees all)
- [ ] Audit logs for dashboard access/usage
- [ ] Notifications for broken links or metric changes

---

## 🧊 Deferred / icebox

- Editable `team_members` CRUD (currently hardcoded in `seed_data.py`)
- `engagement_rules`, `delivery_templates`, `model_assumptions` CRUD (rarely change)
- Daily article-status snapshots (for accurate Revision Rate)

---

## How to work with this file

Mark items `[x]` the moment they land in `main`. When a task spans multiple
commits, list them inline (e.g. `(e103c0c, 32bca76)`). Re-review every other
Friday; archive completed sections older than a month into a `tasks/archive/`
folder when they crowd the top.
