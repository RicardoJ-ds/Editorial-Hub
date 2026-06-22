# Plan — Retire Neon for ingested/analytical data → BigQuery-native Hub

**Approved all-in (Phases 1–5), 2026-06-23.**
Goal: **Neon = thin app-state only**; **BigQuery = all ingested/analytical data + warehouse + mappings → feeds dashboards**. Remove CP v2 + deprecated. ETL writes BQ; dashboards read BQ.
(The other session's Content-Machine→BQ + Writers→Slack work — preserved below — is part of the Phase 0 baseline and folds into Phase 1.)

## End-state ownership
- **Neon (stays):** `access_*` (RBAC) · overview comments · `usage_events` · `cache_version` · `audit_log` · `sheet_sync_history` · DQ review queues (`incomplete_clients`, `article_unmapped_names`, `pod_import_issues`).
- **BigQuery (moves):** clients · deliverables_monthly · goals_vs_delivery · production_history · cumulative_metrics · article_records · article_revisions · team_members · capacity_projections · editorial_member_capacity · pod_assignments · pod_assignment_history · client_pod_history · ai_monitoring_records · surfer_api_usage · model_assumptions · editorial_weeks · delivery_templates · engagement_rules · **`editorial_name_map`** (mappings).
- **Deleted:** CP v2 · phase-1 flat mirror (`editorial_hub_*`) · Postgres `warehouse` sink · `notion_articles` remnants · manual-edit alias tables + UI.

## Invariants (don't break anything)
- **BQ-read added BEFORE any Neon-read removed** — importer never stops resolving.
- Each phase shippable + reversible. Parity gate (`etl.warehouse.endpoint_parity`) green before merge.
- **BQ is not transactional** → single in-memory ingestion pass, no intra-sync round-trips.
- Two active sessions on the repo — coordinate before committing/pushing.

## Phase 0 — baseline ✅ DONE (2026-06-23)
- [x] Commit uncommitted tree (clean baseline, no push) — `c41dbe7` (84 files; gate: ruff/format/mypy/tsc green, semgrep 11 pre-existing skipped)
- [x] Plan → this file

## /GOAL (2026-06-23) — deliver the whole plan, validated, without breaking the Hub
Ship the normalization to prod NOW (existing Neon mechanism), validate end-to-end, then migrate
mappings to BigQuery and only THEN delete the Neon things — **ETL verified before any deletion.**
Finish the other session's plan (writers→Slack propagation + sheet refresh). CP v2 = removable.

## Phase 1 — SHIP normalization to prod NOW (existing Neon mechanism)
- [x] Writer loader exists (`build_mappings --apply-writer-aliases`)
- [ ] Add `--apply-editor-aliases` (confirmed + windowed) loader  ← editors (Tiffany→Tiffany Anderson, Sam windows)
- [ ] (clients: handle separately w/ confirmation — higher blast radius)
- [ ] Regen mappings (`build_mappings`, prod env, Slack-fed) → apply writers+editors to prod `article_name_aliases`
- [ ] Re-sync Monthly Article Count on prod + warehouse publish → `article_records` canonical
- [ ] `sheet_standardize --apply` → proposal sheet STANDARD columns show canonical names
- [ ] VALIDATE: Fivetran spot-check (Aysenur→Aysenur Zaza, Tiffany→Tiffany Anderson) + parity gate + dashboards

## Phase 1b — Migrate mappings to BigQuery (then drop Neon — GATED on validation)
- [ ] Design `editorial_name_map` (BQ): kind · raw_value · canonical_value · canonical_id · valid_from/to · status · source · note
- [ ] Builder: origin-fed (Slack/Rippling/SF) + port ALL aliases (zero loss)
- [ ] `name_map_bq.py` reader (`fetch_name_map(kind)`, windowed) — `notion_bq` pattern
- [ ] Repoint importer + warehouse `build.py:543/548` reads → BQ (ADD read, keep Neon fallback)
- [ ] Google Sheet "Editorial Name Mappings" → BQ sync (manifest step) — the maintenance path
- [ ] **GATE: validate ETL + dashboards on BQ map (parity green) BEFORE deleting anything**
- [ ] Retire 3 manual-edit endpoints; DQ tabs → read-only pointers
- [ ] Drop Neon alias/override tables (startup migration)

## Phase 2 — Delete CP v2 + deprecated
- [ ] Remove `frontend/(app)/capacity-planning/*` + `_store` + `_erd` + sidebar entry + docs
- [ ] Remove phase-1 flat mirror (`etl/manifest.py` mirror, `editorial_hub_*`, `drop_legacy`)
- [ ] Remove `notion_articles` remnants (verify none) + the CP v2 ERD docs that still label old notion source
- [ ] Update CLAUDE.md / memory / version

## Phase 3 — Retire Postgres `warehouse` sink
- [ ] Confirm nothing reads `warehouse` schema at request time (`DASHBOARD_SOURCE=bq`)
- [ ] Stop dual-sink to PG `warehouse`; BQ-only publish
- [ ] Define new rollback path

## Phase 4 — Ingestion → BigQuery (the big lift)
- [ ] Design single in-memory ingestion pass → raw BQ tables (no Neon landing zone)
- [ ] Per-domain migrate importers (emit rows; self-heal reads from BQ)
- [ ] Repoint warehouse build to read BQ raw (not Neon `public`)
- [ ] Parity gate per domain
- [ ] Remove Neon `public` ingested tables

## Phase 5 — Verify + document
- [ ] Confirm Neon = app-state only
- [ ] Docs + memory + version bump

## Review
_(append outcomes per phase here)_

---
---

# PRIOR SESSION PLAN (preserved) — Content Machine → BQ + Writers → Slack (IMPLEMENTED)
> From the other active session; this work is in the Phase 0 baseline and folds into Phase 1.

# Plan — move Content Machine to BigQuery + Writers source of truth → Slack

Two migrations (PLAN ONLY — not implementing yet):
- **A.** Stop the Neon ETL ingestion of the **content machine**; read it from BQ
  `graphite-data.graphite_bi.notion_raw_revenue_content`.
- **B.** Make BQ `graphite-data.graphite_bi.slack_raw_users` the **source of truth for writer mappings**.

## Grounding facts (verified)
- The "content machine" ingestion is NOT a Notion API connector — `import_notion_database()`
  reads a **Google Sheet export of the `revenue-content-machine-etl` Cloud Function**, the SAME
  function that now fills the BQ table. → clean same-source swap.
- BQ table: 10,000 newest rows · **`Case_ID` 100% `ID-NNNN`** (the existing join key) ·
  **`Topic` = the article title** (verified) · published = `CMS_Workflow_Status` LIKE 'Published%'
  OR `Published_URL` present.
- Cross-dataset reads of `graphite_bi` from the warehouse SA already work in-repo
  (`reports.py`, `build_mappings.py` read `graphite_bi.salesforce_int_Account`); both datasets
  `us-central1`. No region blocker.
- The warehouse does **not** publish Notion. Notion is consumed at Neon-ingest time and **baked
  into `article_records`** (`is_published`/`notion_matched`/`published_url` via
  `_apply_notion_published`) + `kpi_scores` (via `refresh_notion_kpis`); those flow to the
  warehouse → views → dashboards. Editors/Monthly-Articles read the warehouse, NOT notion directly.
- Only consumers of Neon `notion_articles`: (1) `_apply_notion_published` (MAC import),
  (2) `refresh_notion_kpis` + `notion_kpi_service` (D2 KPIs: Revision Rate / Turnaround / Second
  Reviews), (3) `routers/notion_articles.py` (`/api/notion-articles/*` — **no frontend consumer**),
  (4) `build_mappings.py` (reads `.writer`). No frontend reads notion directly.

## Design decision
Keep the existing "bake Notion into `article_records` + `kpi_scores` at sync time" architecture;
only swap the **data source** of the two real consumers from Neon `notion_articles` → a BQ query of
`notion_raw_revenue_content`. The whole warehouse → view → bq_cache → endpoint path downstream is
unchanged. Lowest-impact, preserves all current dashboard numbers.

## Phase A — Content machine → BigQuery
- [ ] Add `fetch_notion_content(bq)` (e.g. in `migration_service` or a small `notion_bq.py`):
      `SELECT … FROM \`graphite-data.graphite_bi.notion_raw_revenue_content\`` via `get_bq()`,
      column-mapped to the fields the consumers need:
      `Case_ID→case_id · Topic→title · CMS_Workflow_Status→cms_status · Published_URL→published_url
       · Editor→editor · Sr_Editor→sr_editor · Article_Workflow_Status→article_status
       · CB_Delivered_Date→cb_delivered_date · Article_Delivered_Date→article_delivered_date
       · Created_time→created_date · Editorial_Team_POD→editorial_pod · Client→client_name
       · Writer→writer · Month→month`.
- [ ] Rewire `_apply_notion_published` to read from the BQ source (match logic unchanged:
      MAC `task_id` ID-NNNN → `Case_ID`, then normalized-`Topic` title fallback).
- [ ] Rewire `refresh_notion_kpis` + `notion_kpi_service` (3 KPIs) to compute from the BQ source.
- [ ] Remove `import_notion_database` + the `Notion Database` manifest step + Import Wizard entry.
- [ ] Decide `notion_articles` table/model + `/api/notion-articles/*` router fate (unused by FE):
      drop the Neon table+ingestion; delete the router OR repoint it to BQ. (Recommend: drop table,
      delete router — nothing consumes it.)
- [ ] `build_mappings.py`: drop the `notion_articles.writer` source (writers move to Slack — Phase B).
- [ ] Parity: confirm Revision Rate / Turnaround / Second Reviews + the Monthly-Articles published
      reference match current numbers. If they drift, apply the old sheet filter
      (`Topic` + `Client` + `Account_Team_POD` present) to mirror the legacy view.

## Phase B — Writers source of truth → slack_raw_users
- [ ] New `canonical_writers.json` pulled from `slack_raw_users` (mirror `canonical_editors.json`):
      `real_name` + `JSON_VALUE(profile,'$.email')` + title; filter `deleted=false`/`is_bot=false`;
      keep `@ext.writing.graphitehq.com` contractors (+ relevant staff).
- [ ] `build_mappings.py`: add a canonical-writers match layer BEFORE the live-Postgres fallback;
      replace the runtime roster (pod_assignments/ai_monitoring/notion) + `WRITER_VARIANT_OVERRIDES`
      + the 50-entry `WRITER_EMAIL_CURATED` in `warehouse/build.py` with the Slack-derived roster+emails.
- [ ] Keep `daniq_writer_confirmations.json` as the **disambiguation layer** — Slack gives a clean
      roster + emails but does NOT resolve first-name-only collisions (204/286 raw names are
      single-token; 122 have no source at all).
- [ ] `sheet_standardize.py`: WRITERS (validation) roster sources from `canonical_writers` (Slack),
      augmented by DaniQ confirmations (as today).

## Open questions for Ricardo
1. **KPI parity filter** — apply the legacy `Topic+Client+Account_Team_POD` filter to match prior
   KPI numbers, or use the full superset? (10k-newest cap matches the old sheet either way.)
2. **`/api/notion-articles/*`** has no frontend consumer — delete it, or keep it BQ-backed?
3. **Writer ambiguity** — OK to keep DaniQ confirmations as the tie-break on top of the Slack
   roster (Slack can't disambiguate first-name-only writers)?

## Sequencing / rollback
- Phase A first; verify KPI + published parity; then Phase B.
- Keep `import_notion_database` behind a flag for one release so the BQ read is additive until cutover.

## Review — Phase A IMPLEMENTED + Phase B (writers) wired additively

### Phase A — content machine ETL into Neon: DELETED; now reads BQ
- New `app/services/notion_bq.py` → `fetch_notion_content()` reads
  `graphite_bi.notion_raw_revenue_content` (column-mapped, date-parsed, legacy
  Topic+Client+Account_Team_POD filter for parity).
- `_apply_notion_published` (published flags on article_records) + `refresh_notion_kpis`
  / `refresh_computed_kpis` (the 3 D2 KPIs) now source from BQ. Notion fetched ONCE
  per refresh and reused across months.
- DELETED: `import_notion_database`, its manifest step (`Notion Database`), IMPORT_DISPATCH
  + SHEET_DESCRIPTIONS entries, list_available_sheets block, file-resolution block,
  the `notion_articles` router (`/api/notion-articles/*`, no FE consumer) + main.py
  registration, NotionArticleResponse/NotionSummaryResponse schemas, the `NotionArticle`
  model, the deprecated flat-mirror `editorial_notion_articles`, and the compute_* KPI fns.
- `notion_articles` Neon table dropped via idempotent startup migration (main.py 0b).
- Frontend Import Wizard: removed the "Notion Database" entry + refreshed the KPI-step copy.
- ALL sync variants updated via the manifest (verified: current/past/full carry no Notion step).

### Phase B — writers: additive Slack enrichment (nothing broken)
- `build_mappings.py`: removed the dead `notion_articles.writer` source; added
  `_fetch_slack_writers()` pulling the 26 `@ext.writing.graphitehq.com` contractors
  (real_name + email) from `slack_raw_users` into the writer roster as a high-priority
  source. DaniQ confirmations, variant-overrides, first-name resolution, pod-sheet +
  AI-monitoring sources all unchanged.

### Verified (Docker + BQ, live)
- app imports clean; manifest current=12/past=8/full=19 steps, zero Notion.
- `fetch_notion_content()` → 9,550 rows; dates parsed (created=datetime, delivered=date).
- `_apply_notion_published`: 3 real Case_IDs matched, junk rejected.
- `refresh_computed_kpis`: 23 months, 798 scores written from BQ notion.
- `_fetch_slack_writers()`: 26 contractors, all with real_name + email.
- py_compile · ruff · ruff format · mypy · tsc all clean. No backend tests reference notion.

### Follow-ups (out of scope, noted)
- CP v2 proposal ERD/migration docs (`_erd.ts`, `migration/page.tsx`) still label the
  old `notion_articles` / `/api/notion-articles/` as "current source" — cosmetic, the
  prototype is unwired (localStorage). Refresh when CP v2 is built.
- `config.notion_database_id` left in place (unused, harmless).
