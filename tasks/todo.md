# ▶ TASK — 2026-07-13: two ETL integrations (Delivery Schedules + writer_desired)

## A · Delivery Schedules → recurring ETL (past scope)
Importer, model, RAW→BQ table ALL already exist; it was only ever a one-time seed +
manual Import-Wizard import. Just wire it into the manifest so it refreshes on the
recurring passes.
- [ ] Add `import_delivery_schedules` to `sync_manifest.PAST_STEPS` (scope=past — "changes rarely")
- [ ] Verify: `resolve_plan("past"/"full")` lists it; `run_step("delivery-schedules")` dispatches
- [ ] Verify BQ `editorial_raw_delivery_templates` still 60 rows after a publish
- Scope note: only the 5 canonical templates (240/220/180/120/125) are ingested (existing
  importer). The per-client special blocks (ADP, Rivian note, "180 w/ prev cadence") are NOT
  parsed — flag as optional follow-up.

## B · writer_desired mini-ETL (adopt planning-hub's seed) → daily/current scope
Port `editorial-team-pods/scripts/seed_writer_desired.mjs` to Python; run on the daily trigger.
- [ ] New `etl/build_writer_desired.py` → `publish_writer_desired_from_sheet()` (sheet read +
      transforms + reconcile + CREATE-OR-REPLACE BQ `editorial_writer_desired`, exact 15-col contract)
- [ ] Reconcile via central `editorial_name_map`(writer) + `v_editorial_roster`; fallback alias
      `{dan pelberg → Daniel Pelberg}` (map covers linda/rich/tessina already, verified)
- [ ] Manifest step `@writer-desired` in CURRENT_STEPS, right after `@name-mappings` (daily)
- [ ] Catalog: add `editorial_writer_desired` to schema HUB_PUBLISHED+GRAIN and lineage LINEAGE
      (consumers.planning_hub = getWriterDesired); regenerate both catalogs
- [ ] Dry-run vs the live table (should match ~279 rows, ym 202509..202607, 0 unmatched)
- Decisions confirmed (their #1–4): single CREATE-OR-REPLACE table · keep SE free-text cols ·
      daily cadence · centralize name reconciliation via my map (they drop local aliases)

---

# ▶ CURRENT STATUS — 2026-07-01

**Three active threads. Detailed migration plan is further down (Phases 0–5 / Stages 0–7) + full
design in `etl/NEON_RETIREMENT_PLAN.md`; Neon end-state ownership at "End-state ownership" below.**

## 1. Neon → BigQuery-native ETL migration (the big one — NOT yet started building)
**Shape confirmed with Ricardo 2026-07-01:** the ETL should *work exactly as today* — same
sheet pulling, same cleaning, same processing/business math — **but land the tables in BigQuery
instead of Neon.** Only two things move; nothing about behavior changes (dashboards already read BQ):
- **Ingest stage:** importers (`migration_service.py`) parse+clean sheets → today write **Neon
  `public`** → target write **BQ raw** (`WRITE_TRUNCATE` load, since BQ has no upsert/PK).
- **Transform stage:** warehouse build reads **Neon `public`** (`fetch_model_rows`) → target read
  **BQ raw**; int/view math is already pure fns of in-memory dicts → just "change where the raw
  dicts come from." Then drop the Neon `warehouse` schema + `public` ingested tables.

**Watch-items (the "don't break anything"):** (a) importers rely on Neon upsert+transactions → become
full-rebuild loads; (b) DQ self-heal tables (bucket C) are read *during* import — keep them on Neon
for now; (c) RBAC + comments + analytics stay on Neon. Full stage list below (Stages 0–7).

### Neon `public` inventory — what moves vs stays (verified 2026-07-01, mirrors "End-state ownership")
- **A · Ingested (→ BigQuery, ~19):** clients · deliverables_monthly · production_history ·
  goals_vs_delivery · cumulative_metrics · capacity_projections · editorial_member_capacity ·
  article_records · article_revisions · editorial_weeks · pod_assignments · pod_assignment_history ·
  client_pod_history · kpi_scores · model_assumptions · team_members · delivery_templates ·
  engagement_rules · ai_monitoring_records · surfer_api_usage. *(notion_articles already dropped.)*
- **B · App-state (STAY on Neon, ~11):** access_* (5 RBAC) · overview_comments · usage_events ·
  cache_version · audit_log · sheet_sync_history.
- **C · DQ / self-heal hybrid (judgment):** incomplete_clients · pod_import_issues ·
  article_unmapped_names STAY (Neon write). alias/override tables (article_name_aliases ·
  client_name_aliases · pod_name_overrides) → DROP once resolution is in-memory/BQ (Phase 1b Step 5).

## 2. Planning-hub handoff — ✅ DONE
- Doc: `etl/handoff_planning_hub_capacity_data.md` (clients+SF, pods, members canonical/raw,
  capacity, revisions — exact BQ schemas + recipes). Companion: `etl/platform_handoff_editorial_hub.md`.
- Ricardo is notifying the other session directly. (Not committed yet — decide whether to commit.)

## 3. "As of" close-grace = +2 days → advances on the first Thursday after the Tue close
- [x] **As-of badge** — `lastClosedEditorialMonth()` grace primitive; shipped **v0.3.48**.
- [x] **Goals numbers + Overview goals selector** (DaniQ's follow-up) — `currentEditorialMonth`
      now = last-closed +1 (grace-aware, affects D1 Monthly Goals gauges too); Overview Pod-Snapshot
      Goals column anchors on `useLastClosedEditorialMonth` (was calendar month−1). All surfaces flip
      together (verified: hold May/June through Wed Jul 1 → June/July on Thu Jul 2). **Pending release → 0.3.49.**

## 4. Q3/Q4 capacity cutover — planning-hub `editorial_capacity_plan_demand` → INT compose (contract v1.1, target Aug 1 2026)
Contract confirmed 2026-07-05 (see `etl/handoff_planning_hub_cutover_proposal.md` + our answers
doc). Authority rule: compose ONLY `source='app' AND ym >= current calendar month AND client_id > 0`;
app-zero = deliberate zero (row-presence COALESCE, never NULLIF); full-table replace = tombstone-free
reverts; **3-day `published_at` staleness valve** (fall back to sheet wholesale + log). Validated
live 2026-07-05: baseline↔sheet parity perfect on intersection (627 rows, 0 diffs); sheet-only gap
is 241 zero-projection rows + 1 Tempo-XYZ identity dup (flagged to planning-hub).
- [x] Parity gate `etl/warehouse/plan_parity.py` (hub_parity pattern; soak Jul 20–31, green ≥1wk gates the flip)
- [ ] Raw mirror **`editorial_raw_capacity_plan_demand`** — build.py job: BQ hub table → faithful
      snapshot (all rows incl. baseline) → both sinks; tolerate future note/status_override columns
- [ ] INT compose behind flag `CAPACITY_HUB_CUTOVER` (default OFF): `editorial_int_client_pod_months`
      (pod + weight + projected articles) + `v_editorial_fct_production_monthly` future months —
      `COALESCE(hub app-rows, sheet)`; staleness valve at compose time
- [x] **Rounding half SHIPPED (2026-07-05, d958284 + a19201e)**: capacity used-capacity now FLOAT +
      ET-CP numeric cells read UNFORMATTED (were truncated by display format). Deployed + re-synced +
      published; Mar/May/Jun now reconcile exactly (386.8=386.8 etc.). Residual gaps are ONLY non-client
      rows (Feb WL/SG support, Apr [test] Credit Karma, Jul [New client] KOs) → cutover / sheet hygiene.
- [ ] **Pod-vs-client reconciliation (2026-07-05 finding)**: today `editorial_int_capacity_pod_months.
      projected_used_capacity` COPIES the ET-CP capacity headline (counts non-client breakdown rows:
      planned "[New client] KO"s, ad-hoc "WL/SG support" lines) while `editorial_int_client_pod_months`
      drops any row without a real client_id → Hub pod-total ≠ DEMAND×1.4 (Jul +9, Feb +17; sheet
      reconciles because its headline is the breakdown column-sum). FIX at cutover: source per-client
      demand from `editorial_capacity_plan_demand` incl. negative-id planned rows, and REBUILD the pod
      mart's projected/actual_used as Σ(client_pod_months) so pod ≡ Σ client ≡ sheet by construction
      (stop copying the headline). See `etl/handoff_planning_hub_pod_vs_client_demand_answer.md`.
- [ ] Aug 1 flip: enable flag + one-time snapshot-freeze `projected_original` per (client, month) +
      lineage catalog entries for the mirror (`/bq-schema-catalog`)

## Next up
- [ ] Release the goals-grace change (→ `0.3.49`).
- [ ] Decide: commit the planning-hub handoff doc?
- [ ] Migration Stage 0 (isolated `graphite_bi_migration` dataset + BQ-raw seam) — see Stages below.
- [ ] Phase 1b Step 5: drop Neon alias/override tables (UNBLOCKED — confirm daily cron stays clean first).

---

# Plan — Root-cause roster: `v_editorial_roster` (single source of truth)

**Goal:** replace the hand-regenerated roster with a BigQuery **view** unioning all editorial
headcount (Rippling editors + Slack writers + legacy/mapped canonicals), carrying source IDs
(`worker_id`/`slack_id`), applying the same name normalization, filtered by a DaniQ-editable
**Exclusions** list — so "not an editor" removals are permanent and survive every regen. A daily
**Apps Script** materializes it into the master Roster tab → MAC dropdowns via IMPORTRANGE.
Decisions locked: **View** (always live) · **Apps Script daily**.

Facts: editors = `v_headcount` `title LIKE '%editor%'` (has worker_id+slack_id); writers = Slack
`ext.writing` (27 active/42); legacy gap = 8 editors + 111 writers in the log but not in
Rippling/Slack; exclusions needed because Jose Maria Sosa + Andres Rojas both carry title
"Editorial Lead" (no filter can drop them).

Steps:
- [x] 1. Exclusions tab in the mappings sheet (NAME·ROLE·SOURCE_ID·REASON·DATE) + seed (Jose, Andres, Miles-as-editor).
- [x] 2. `publish_roster_exclusions_from_sheet()` → BQ `editorial_roster_exclusions`; wired into `@name-mappings`.
- [x] 3. View `v_editorial_roster` (committed SQL `etl/warehouse/v_editorial_roster.sql`): Rippling editors + Slack writers + legacy, name-map override, role-aware exclusions, junk filter.
- [x] 4. Verified view: 33 editors / 9 sr / 101 writers / 41 active; exclusions applied; reproduces current roster exactly + correctly adds Bryan Clark + Chrissy Woods to SR.
- [x] 5. `roster_refresh.gs` written + simulation-verified (membership identical; order normalized to active-first/alphabetical).
- [~] 6. Docs DONE (root + backend CLAUDE.md, memory). **Commit HELD — Ricardo validating the Apps Script first.** Install instructions handed off.

---

# Plan — Retire Neon for ingested/analytical data → BigQuery-native Hub

**Approved all-in (Phases 1–5), 2026-06-23.**

> **SHIPPED 2026-06-23 — `v0.3.29` deployed to prod** (Vercel + Railway both green on `dad406d`).
> Verified live: removed DQ write endpoints → 404/405, kept reads → 200, dashboards serve (84 clients from BQ),
> sync plan = 11 steps with `@name-mappings` before MAC + AI-monitoring absent, BQ `editorial_name_map` = 121 rows,
> `fetch_name_map` resolves with windowing. Full gate green (ruff/mypy/pytest/tsc/build/semgrep).
> **Phase 1b name-map BQ read is now baking in prod** — next SYNC exercises it; then Step 5 (drop Neon alias/override tables) is unblocked.
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

## Phase 1 — SHIP normalization to prod (existing Neon mechanism) ✅ writers+editors DONE (2026-06-23)
- [x] Writer + editor loaders (`build_mappings --apply-writer-aliases` / `--apply-editor-aliases` / `--apply-aliases`) — `7a8ab34`
- [x] Applied writers+editors to prod `article_name_aliases` (113: 78 wr + 35 ed, incl. windowed Sam)
- [x] Re-synced MAC on prod + warehouse published → `article_records` canonical (editor 14,475/14,926, writer 10,529; was 0)
- [x] `sheet_standardize --apply` → proposal sheet STANDARD columns canonical
- [x] VALIDATED: Fivetran Aysenur→Aysenur Zaza, Tiffany→Tiffany Anderson; backend healthy; web report updated
- [x] **Clients:** `--apply-client-aliases` (`118d2a2`) → 8 confirmed tab→Hub aliases applied to prod + re-synced → 7-8 tabs resolved (Genstore→GenstoreAI, Workleap/ShareGate, Orderful I/II, Neiman, FRC, Men's W). All 3 entities now canonical in prod.
- [ ] **Residual (NOT code-fixable — DaniQ data decision):** 18 tabs genuinely **not in the Hub** `clients` table (Mirage, Curology, Gopuff, Credit Karma, …) → add to the Editorial SOW overview sheet (then they sync in) OR accept out-of-scope · EarnIn + Athena2 = **ambiguous** (EarnIn is split B2B/B2C) → need DaniQ to pick the target. All tracked in DQ → Missing from Hub.

## Phase 1b — Migrate mappings to BigQuery (then drop Neon — GATED on validation)
- [x] `editorial_name_map` (BQ) + builder (`build_mappings --build-name-map`) — `a7de7b5`; published == Neon (78/35/8=121)
- [x] `name_map_bq.py::fetch_name_map(kind)` (windowed, Neon fallback) + repoint importer + warehouse — `ae77671`; **validated identical** (editor 14,475 / writer 10,529 / 7 client tabs from BQ)
- [x] Google Sheet "Editorial Name Mappings" → BQ sync — `433c9c8`. Sheet (Writers/Editors/Clients, 121 rows) = DaniQ-editable source; `@name-mappings` manifest step (runs before MAC) publishes `editorial_name_map`. Verified round-trip sheet→BQ→importer.
- [x] **DQ section → READ-ONLY** (Ricardo's ask, refined: "fix at the source, no UI mapping in all kinds"). Article-mappings tab read-only + "Edit in the sheet" link — `a68946e`. Missing-from-Hub + Pod-issues tabs read-only (map/dismiss/undo/override controls gone; "How to fix (at the source)" framing + Status badge) — `d9c54fc`. Backend writes removed: admin.py missing-clients map/dismiss/reopen + pod-import-issues reopen + pod-name-overrides create/delete; articles.py POST /aliases. **Existing aliases/overrides still consulted** (nothing currently resolving breaks) — only new-from-UI creation stops. Reads (`/discrepancies`, `/unmapped`, GET `/pod-name-overrides`) intact. **Shipped in `v0.3.29` (`dad406d`, 2026-06-23) — prod-verified** (write endpoints 404/405 live).
- [x] **GATE PASSED — manual prod SYNC 2026-06-23 09:1x UTC resolved cleanly via `editorial_name_map`.** Post-SYNC == baseline (20 unmapped clients / 40 editors / 208 writers / 121 aliases), BQ map 121, warehouse republished 09:20:41 UTC, dashboards serve (84 clients). MAC 14,926 rows all_ok. (Note: full `sync-run` over external HTTP hits a 300s proxy 502 but completes server-side; per-step or the in-process cron avoid it.)
- [ ] **Step 5 now UNBLOCKED:** drop Neon alias/override tables (`article_name_aliases`, `client_name_aliases`/`ClientNameAlias`, `pod_name_overrides`) + remove their consultation, via startup migration. Keep the read-only DQ surfaces. Do after confirming the daily cron run also stays clean.

## Phase 2 — Delete CP v2 + deprecated
- [x] Remove `frontend/(app)/capacity-planning/*` + sidebar entry + cp2 RBAC view + docs — `c606568` (49 files, −11,403)
- [x] Remove phase-1 flat mirror `editorial_hub_*` — **already gone** (0 tables in `graphite_bi_sandbox`, verified 2026-06-23)
- [ ] PG `warehouse` sink retirement → folded into **Neon-Retirement Stage 7** below
- [ ] (in-app changelog forward-note still says "0.4.x CP v2 → DB" — hidden doc, refresh later)

## Phases 3+4 — NEON RETIREMENT (ingestion → BigQuery) — full design in `etl/NEON_RETIREMENT_PLAN.md`
> **Grounded analysis 2026-06-23.** Multi-session re-architecture, NOT a flag. Four Neon-`public`
> readers must move: importer fuzzy client-resolution (`_resolve_client`, **8 importers**) · warehouse
> `fetch_model_rows` · the `pg_advisory_lock(815001)` publish lock · DQ admin discrepancy reads (29 q's).
> Importers: **10 easy / 6 medium / 2 hard** (Growth Pods, Monthly Article Count). No BQ upsert → each
> importer becomes a full-rebuild `WRITE_TRUNCATE` load. The int/view math is already source-agnostic
> (pure fns of in-memory dicts) → migration = "change where the raw dicts come from."

**⚠️ SAFETY GATES (read before any session):**
- Local + prod SHARE BQ dataset `graphite_bi_sandbox`. **All dev/validation MUST set
  `BQ_DATASET=graphite_bi_migration`** or you overwrite what prod serves.
- Work on branch `feature/neon-to-bq-ingestion`. Prod stays on `0.3.29` until Stage 4 parity is GREEN.
- Validation = `python -m etl.warehouse.parity` + `python -m etl.warehouse.endpoint_parity` (53 endpoints,
  `X-Data-Source` postgres-vs-bq). **Zero diff required before any prod cutover.**

**Legend:** ☀️ = safe anytime (isolated dataset / branch, prod untouched) · 🌙 = do in a LOW-TRAFFIC
window (touches prod / runs a SYNC; avoid 09:00 UTC daily cron + editorial working hours).

- [ ] **Stage 0 ☀️** — create `graphite_bi_migration` dataset; add `BQ_DATASET` override path; run a local
      warehouse build into it from local Neon; wire both parity harnesses against it.
- [ ] **Stage 1 ☀️** — add `WAREHOUSE_RAW_SOURCE=neon|bq` + `fetch_model_rows_from_bq(table)`; int builders
      read `editorial_raw_*` from BQ when `bq`. Validate: int/views from Neon == from BQ-raw (identical).
- [ ] **Stage 2 ☀️** — refactor `_resolve_client` / `_build_client_name_lookup` to use an in-memory
      clients+aliases lookup (built from the SOW pass); Neon-backed shim behind a flag for rollback.
- [ ] **Stage 3 ☀️** — importer output → `editorial_raw_*` (truncate+load), DUAL-WRITE (keep Neon too).
      Order: easy 10 → medium 6 → hard 2 (Growth Pods, Monthly Article Count). Parity-gate EACH domain.
- [ ] **Stage 4 🌙** — prod cutover: flip `WAREHOUSE_RAW_SOURCE=bq`; warehouse builds int/views from
      importer-written BQ raw. Full 53-endpoint parity gate first. Bake ≥1 daily cron cycle.
- [ ] **Stage 5 🌙** — stop Neon `public` writes (BQ-only ingestion). DQ queues (`incomplete_clients`,
      `article_unmapped_names`, `pod_import_issues`) STILL write Neon. Also drop Step-5 alias tables
      (`article_name_aliases`, `client_name_aliases`, `pod_name_overrides`) once resolution is in-memory/BQ.
- [ ] **Stage 6 🌙** — migrate publish lock (`pg_advisory_lock` → tiny Neon app-state lock row) + repoint
      `admin.py` discrepancy detection to read BQ raw.
- [ ] **Stage 7 🌙** — flag-gate + remove `pg_sink` data writes; drop Neon `public` ingested tables +
      `warehouse` schema. New rollback = re-enable + republish (minutes) / BQ serve-stale-on-error.

## Phase 5 — Verify + document
- [ ] Confirm Neon = app-state only (RBAC, comments, usage_events, cache_version, audit_log,
      sheet_sync_history, DQ queues, publish-lock row)
- [ ] Full audit + endpoint parity + version bump (→ likely `0.4.0`, PHASE bump — needs confirmation)
- [ ] Docs + memory (`reference_*_cutover`, `NOW.md`) + CHANGELOG

## Suggested execution sessions (off-hours plan)
- **Session A (anytime ☀️):** Stages 0–1 — isolated dataset + the BQ-raw seam + parity. Low risk, reviewable.
- **Session B (anytime ☀️):** Stage 2 — in-memory resolution. The trickiest refactor; parity per importer.
- **Session C (anytime ☀️):** Stage 3 — dual-write all importers to BQ raw, domain-by-domain parity.
- **Session D (off-hours 🌙):** Stage 4 cutover + bake.
- **Session E (off-hours 🌙):** Stages 5–7 — stop Neon writes, migrate lock/DQ, drop schemas, version bump.
> Most of the build (A–C) is prod-safe and can happen during the day on the branch/isolated dataset.
> Only D–E touch prod and should run in a low-traffic window (not ~09:00 UTC cron, not editorial hours).

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

---

# Plan — Editorial Name Mappings everywhere + proposal-sheet columns (2026-06-23)

**Decisions (locked with Ricardo):** 2nd Review = STRICT (Sr Editors only) · columns on BOTH MAC + Meta · apply mappings in ALL places (incl. Notion + Capacity).

Context: DaniQ reviewed the Editorial Name Mappings sheet; her changes were Writers-only (16 raws → "Auditioning Writer"). The article importer already reads the live BQ `editorial_name_map`, but the proposal standardizer + warehouse + Notion-KPI + capacity still use stale local JSON / first-name matching.

## Phase A — mappings take effect in ALL places
- [ ] Add shared windowed resolver `resolve(name_map, raw, ym)` to `name_map_bq.py` (mirror `migration_service._alias_resolve`).
- [ ] `sheet_standardize.py`: replace local-JSON writer source (`daniq_writer_confirmations.json` + `writer_aliases.json`) with live BQ `editorial_name_map` (writer + editor); roster + WRITER/EDITOR (STANDARD) fill reflect DaniQ's sheet incl. Auditioning Writer.
- [ ] `warehouse/build.py`: writer canon from BQ `editorial_name_map`, not local JSON.
- [ ] `notion_kpi_service.py`: canonicalize Notion editor + sr_editor names through the editor map before matching.
- [ ] `capacity_calc.py`: route the editor matcher through canonical names (assess; article side already canonical).

## Phase B — proposal-sheet columns (MAC main path + standardize_meta)
- [ ] `3RD REVISION (STANDARD)` date column on both sheets (REV3_STD); structure-insert (idempotent add to already-structured tabs), fill 3rd parsed revision date, strict-date validation.
- [ ] `2ND REVIEW (STANDARD)` column on both sheets; Sr Editor roster (titles `Sr. Editor` + `Sr. Editor II`, active-at-top); STRICT dropdown.

## Phase C — gate + apply + verify + release
- [ ] ruff/format/mypy on changed backend + etl.
- [ ] Re-sync `@name-mappings` so BQ is fresh; dry-run both standardizers; review; `--apply`.
- [ ] Verify: 16 Auditioning Writers flow to article_records + Monthly Articles; Hub numbers unchanged; columns + dropdowns present.
- [ ] Resolve DaniQ's "Sarah H" comment (does it have 2025/2026 rows?).
- [ ] Version bump + changelog + commit + push.
