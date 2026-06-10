# ETL inventory — what to port (from `backend/app/services/migration_service.py`)

Catalog of every importer + transform currently in the dashboard ingestion layer, to
be lifted into `etl/`. Line numbers as of 2026-06-09 (re-verified vs code 2026-06-10).
21 importers + 2 computed steps, 22 destination tables, ~40 helpers.

## Importers (source → dest, key transforms, natural key)
| Fn (line) | Source (id const) | Dest table | Key transforms | Natural key |
|---|---|---|---|---|
| import_sow_overview (776) | Editorial SOW overview (SPREADSHEET_ID) | clients | cadence-quarter parse, date parse w/ regex fallback, hyperlink/rich-text→markdown, word-count range | name |
| import_delivered_invoiced (896) | Delivered vs Invoiced v2 | deliverables_monthly | 6-row/client groups, month-offset from start, fuzzy client resolve | (client_id,year,month) |
| import_operating_model (1781) | Editorial Operating Model | production_history | row0 Actual/Projection labels, row1 month headers, in-memory upsert, fuzzy client | (client_id,year,month) |
| import_capacity_plan (1371) | ET CP 2026 [V##] | team_members, capacity_projections, clients.editorial_pod, production_history.projected_original | latest-V## detect, calls _ingest_et_cp_year, rightmost-non-empty pod | per-table |
| _ingest_et_cp_year (1125) | ET CP version tab | editorial_member_capacity, capacity_projections, production_history | header-derived month↔col, member_breakdown split, category, clears stale by version | (year,month,pod,slot) |
| import_et_cp_pod_history (4446) | all ET CP version tabs | client_pod_history, incomplete_clients | reads ONLY each tab's own-month col (header-derived — fixed off-by-one), pod+category normalize, null-id stubs | (client_id,year,month) |
| backfill_editorial_pod_from_history (4783) | computed | clients.editorial_pod | latest (y,m) pod per null-pod client | — |
| import_goals_vs_delivery (3289) | Master Tracker monthly tabs | goals_vs_delivery | fan-out all month tabs, forward-fill client/pod on continuation rows, **LP ×2 from May 2026**, weekly block parse, sheet_sync_history freeze | (month_year,week,client,content_type) |
| import_week_distribution (2702) | Master Tracker `<YYYY> Week Distribution` tabs | editorial_weeks | year from tab name, row-2 month headers, `Week N: MM/DD - MM/DD` cell regex; drives the "As Of" badge + editorial-month bucketing. NOT in IMPORT_DISPATCH (past-scope only, comment at 2671) | (year,month,week_number) |
| import_monthly_article_count (5500) | Monthly Article Count (ARTICLE_COUNT_ID, ~94 tabs) | article_records, article_revisions | chunked batchGet(25)+retry, header aliasing, multi-format date parse + editorial-month map, as-of-month pod (no fallback→Unassigned), slash-pair editor explode, revision parse, Notion match, **full rebuild** | article_uid (sha256 tab|row) |
| import_team_pods (2998) | Team Pods (TEAM_PODS_ID) | pod_assignments | people-chip email extract, role-tag canonical, wipe+rewrite per kind, RBAC group refresh | (email,client,kind,role) |
| import_growth_pods (4246) | BQ team_pod_assignments ⋈ salesforce_int_Account (app/sql/growth_pods_from_bq.sql) | clients.growth_pod, pod_import_issues | collapse per-member→pod, fuzzy client, override dict, conflict flagging | — |
| import_notion_database (3811) | Notion export | notion_articles | 5000-row pages, pg_insert ON CONFLICT, 38-col map | case_id |
| import_monthly_kpi_scores (3617) | Monthly KPI Scores | kpi_scores | "Month Year"→(y,m), member+client resolve, 4 KPI types + targets | (member,year,month,kpi_type,client) |
| import_cumulative (2603) | Master Tracker Cumulative | cumulative_metrics | pipeline counts+pcts | client_name |
| import_meta_deliveries (2152) | Meta Calendar Month Deliveries | deliverables_monthly | 4 fixed Meta rows, overwrite delivered | (client_id,year,month) |
| import_delivery_schedules (1930) | Delivery Schedules | delivery_templates | 5 hardcoded SOW sizes × M1–M12 | (sow_size,month) |
| import_engagement_requirements (2038) | Engagement Requirements | engagement_rules | dynamic header find, 10 rules | rule_number |
| import_model_assumptions (1620) | Model Assumptions | model_assumptions | 5 category blocks | (category,key) |
| import_ai_monitoring_{data,rewrites,flags,surfer} (2280/2369/2453/2539) | Writer AI Monitoring | ai_monitoring_records, surfer_api_usage | surfer pct parse, recommendation normalize, flag-merge | per-importer |
| refresh_computed_kpis (≈5044) | computed (notion_articles + capacity_projections) | kpi_scores | recompute revision_rate/turnaround/second_reviews/capacity_util, 36-mo cap | — |

## Transform helpers to lift (pure functions)
- **Client resolve:** `_name_key` (alphanumeric lower), `_build_client_name_lookup` (+`_CLIENT_NAME_ALIASES` + user `article_name_aliases`), `_resolve_client` (exact→alias→key→None), `_add_user_client_aliases`.
- **Names/pods:** `_normalize_editorial_pod`/`_normalize_growth_pod` ('Pod 1'), `_normalize_category` (standard/specialized).
- **Dates:** `parse_date`, `parse_month_str`, `_article_parse_full` (copy-name YYMMDD→month-word→m/d/y→Excel serial), `_article_parse_year_month`, `_article_parse_excel_serial`, `_article_two_digit_year`, `_build_editorial_weeks` + `_editorial_month_for` (calendar→editorial month via `editorial_weeks`).
- **ET CP:** `_detect_capacity_sheet_name` (latest V##), `_parse_et_cp_month_header`, `_parse_member_breakdown`.
- **Articles:** `_article_build_header_map` (+`_ARTICLE_HDR_ALIASES`), `_split_editors` (slash/and), `_clean_editor`, `_parse_revisions`, `_apply_notion_published` (TASK-ID→title fallback), `_reconcile_article_unmapped`.
- **Team pods:** `_emails_for_cell` (chips), `_role_tag_for_chip`, `_canonical_role_from_header`, `_pick_latest_team_tab`.
- **Sheets I/O:** `get_sheets_client`, `_cell`, `_extract_hyperlinks`, `_cell_to_markdown`, `_extract_rich_text_column`, `_article_retry` (backoff).
- **Numbers:** `safe_int`, `safe_pct`, `parse_word_count`, `parse_cadence_quarters`, `map_status`.

## Business rules to preserve (the "considerations")
- Content-type weighting: article ×1, **jumbo ×2, LP ×0.5, glossary ×0.5** (BUSINESS_RULES.md §1); **LP pre-doubled at ingestion from May 2026**; glossary from June 2026.
- Specialized client **×1.4** in pod used-capacity.
- Capacity utilization per member = articles-as-distribution × pod RAW actual (see `analysis_capacity_utilization` memory).
- Editorial month = `editorial_weeks` (week 1 ~the 6th) — distinct from calendar + from OpModel's delivered/calendar basis. **Month-basis alignment is an open question.**
- Self-healing audit tables: incomplete_clients, pod_import_issues, article_unmapped_names, article_name_aliases.

## Sync orchestration — SYNC vs RE-SYNC (the manifest) ★ must be preserved
`backend/app/services/sync_manifest.py` is the **single source of truth for what
gets synced** (the "recent addition to better handle updates"). Every trigger reads
its plan from here; add an importer ONCE (tagged a scope) and it flows into the SYNC
modal, the Re-sync UI, `/sync-plan`, `/sync-step`, `/sync-run`, month-rollover + cron.
The ETL must keep this scope model + extensibility, not lose it.

**Scopes (= what SYNC vs RE-SYNC mean):**
- **`current` = the SYNC button** — refreshed on every click (this month's live sheets).
  Steps (`CURRENT_STEPS`): Editorial SOW overview · Delivered vs Invoiced v2 · Editorial
  Operating Model · AI Monitoring ×4 · Master Tracker Cumulative · **Goals vs Delivery
  (current month only — default mode; closed months frozen via `sheet_sync_history`)** ·
  Notion Database · Growth Pods · Monthly Article Count · `@et-cp` (dynamic → live "ET CP
  2026 [V##]" tab) · `@kpi-scores` (dynamic) · `@kpi-scores-mock` (dynamic →
  "[Mock] Monthly KPI Scores", "[Mock] " prefix stripped at dispatch,
  migration_service.py:4893) · synthetic **`@refresh-kpis`** (recompute
  Notion-derived KPIs). Upsert/idempotent; full-rebuild for article + team-pods.
- **`past` = "Re-sync Past Months"** — the heavier pass that re-reads what `current`
  freezes (`PAST_STEPS`): **goals-vs-delivery (mode="all" — every month tab)** ·
  **week-distribution** (`import_week_distribution` — drives the "As Of" badge;
  *this importer was missing from the table above*) · **team-pods** · **et-cp-history**
  (all version tabs → `client_pod_history`) · **backfill-editorial-pod**. Run when someone
  retroactively edits old numbers, or at year start when next-year weeks are locked.
- **`full` = current + past** = "click SYNC then Re-sync Past Months." Used by the
  month-rollover trigger, cron, and headless/agent runs.

**Month-rollover due-check** (`current_editorial_month` + `monthly_resync_due`): compares
the Goals sheet's latest `synced_at` against the current editorial month's Week-1 start —
if a new month rolled over and last month's finals weren't pulled, a `past`/`full` resync
is flagged **due** (`GET /api/migrate/monthly-resync-status`). Editorial month boundaries
come from `editorial_weeks` (week 1 ~the 6th) — same boundary that causes the month-basis
caveat (#14).

**Endpoints** (`backend/app/routers/migration.py`): `GET /sync-plan?scope=` (ordered steps,
expands dynamic-prefix tabs via `list_available_sheets`) · `POST /sync-step` (one key) ·
`POST /sync-run?scope=` (whole scope server-side) · back-compat `POST /resync/{step}`
(delegates to manifest `run_step`) + `POST /refresh-kpis` · legacy `POST /sync-all`
(**NOT manifest-current** — imports ALL `IMPORT_DISPATCH` keys + ET CP prefix tabs, a
superset that also runs past-scope importers AND the wizard-only seed importers) +
`POST /goals-historical-resync` (past) · `GET /status` (the "Synced …" badge, from the
audit-log row `import_all` writes) · `monthly-resync-status`.

**Wizard-only importers (in `IMPORT_DISPATCH` but in NEITHER sync scope):**
`import_model_assumptions` · `import_delivery_schedules` ·
`import_engagement_requirements` · `import_meta_deliveries`. They run only via the
manual Import Wizard (`POST /import`) or legacy `/sync-all` — never via SYNC (current)
or Re-sync (past). The ETL must carry them as a third scope (`seed`/`manual`), not
assume they're synced.
**Frontend:** `SyncControls` + `SyncAllModal` render from `/sync-plan` (no hardcoded lists);
Import page = Import Wizard (manual single-sheet w/ preview) + Re-sync Past Months tab.

**Adding a NEW source/origin (extensibility the ETL must keep):** declare one
`ManifestStep(key, label, scope, run=…)` (or `dynamic_prefix=…` for versioned tabs) in
`sync_manifest.py` → it appears in the right scope's plan + every trigger automatically.
The ETL should mirror this: a declarative manifest of extract→transform→load steps tagged
`current`/`past`, so adding an origin is one declaration, and SYNC vs RE-SYNC stays meaningful.

## Startup migrations (main.py `_run_data_migrations`) — fold into BQ DDL/load
production_history dedupe + unique (client_id,year,month); access_views.dashboard_label; goals_vs_delivery unique key; client_pod_history.category; usage_events 6-mo retention; etc.
