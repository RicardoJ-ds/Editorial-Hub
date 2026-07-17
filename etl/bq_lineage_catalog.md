# BQ lineage catalog — `graphite-data.graphite_bi_sandbox` (editorial warehouse)

**Auto-generated** by `etl/gen_bq_lineage_catalog.py` — do not hand-edit. Structural facts (grain / columns / rows / freshness) are live from BigQuery; lineage (origin / pipeline / processing / consumers) is the curated `LINEAGE` map in that script. Re-run after any ETL surface change; edit `LINEAGE` when origin/processing/consumers move.

- **Dataset:** `graphite-data.graphite_bi_sandbox` (everything is `graphite-data.graphite_bi_sandbox.<name>`)
- **Generated:** 2026-07-16 23:48:36 UTC
- **Source:** live BigQuery `INFORMATION_SCHEMA` + curated lineage
- **Inventory:** 39 tables · 22 views · 12 read by the Planning Hub

> Each entry answers: *this number came from **that** source, via **these** steps, with **this** math, and is read **here**.* `editorial_raw_*` = faithful sheet mirrors · `editorial_int_*` = where the business math is computed · `v_editorial_*` = the public read contract (mostly thin passthroughs of int).

**Companion:** `bq_schema_catalog.md` (columns/rows) · `WAREHOUSE_DESIGN.md` (design + bug register).

## RAW — source-sheet mirrors (`editorial_raw_*`)

### `editorial_raw_ai_monitoring`
*one row per monitored article · 3,372 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** Writer AI Monitoring sheet › Data / Rewrites / Yellow-Red Flags_v2 tabs
- **Pipeline:** build.py RAW_TABLES ← Neon ai_monitoring_records ← import_ai_monitoring_{data,rewrites,flags}()
- **Processing:** Faithful mirror; recommendation normalized + flag-merge applied at ingestion (record grain).
- **Editorial Hub:** Team KPIs → AI Compliance via GET /api/ai-monitoring/*; backs the two AI views
- **Planning Hub:** —
- **Columns:** `id`, `pod`, `writer_name`, `editor_name`, `date_processed`, `month`, `updated_at`, `client` …

### `editorial_raw_article_revisions`
*one row per revision · 3,709 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** Monthly Article Count sheet (per-client tabs) + Meta Editorial Tracker
- **Pipeline:** build.py RAW_TABLES ← Neon article_revisions ← import_monthly_article_count()
- **Processing:** One row per article-editor-revision event, bucketed by each revision's OWN editorial month (year inferred from submitted date).
- **Editorial Hub:** internal (upstream of editorial_int_articles_revisions)
- **Planning Hub:** —
- **Columns:** `id`, `article_uid`, `client_name`, `editor_name`, `writer_name`, `editorial_pod`, `growth_pod`, `revision_date` …

### `editorial_raw_articles`
*article × editor · 16,312 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** Monthly Article Count sheet (per-client tabs) + Meta Editorial Tracker
- **Pipeline:** build.py RAW_TABLES ← Neon article_records ← import_monthly_article_count(); transform.add_article_canonicals()
- **Processing:** One row per (article, editor); slash-pair editors exploded; editor/writer canonicalized via name-map; pod denormalized from client's current pod; Notion published match.
- **Editorial Hub:** GET /api/articles/editors (editor dropdown); upstream of editorial_int_articles_creation
- **Planning Hub:** getWriterDelivered() → delivered per writer×month×client (24mo) → writer bandwidth + 12-month drawer
- **Columns:** `id`, `article_uid`, `client_name`, `client_id`, `editor_name`, `writer_name`, `editorial_pod`, `growth_pod` …

### `editorial_raw_calendar`
*year × month × week · 52 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** Master Tracker sheet › '<YYYY> Week Distribution' tabs
- **Pipeline:** build.py RAW_TABLES ← Neon editorial_weeks ← import_week_distribution()
- **Processing:** Faithful mirror (year × month × week); defines when each editorial month begins.
- **Editorial Hub:** GET /api/migrate/editorial-weeks → 'As of' badge + editorial-month bucketing; backs v_editorial_dim_calendar
- **Planning Hub:** —
- **Columns:** `id`, `year`, `month`, `start_date`, `end_date`, `updated_at`, `week_number`, `created_at`

### `editorial_raw_capacity`
*pod × month × version · 305 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** Editorial Capacity Planning › 'ET CP 2026 [V##]' sheet, EDITORIAL TEAM CAPACITY block (all versions)
- **Pipeline:** build.py RAW_TABLES ← Neon capacity_projections ← import_capacity_plan()/_ingest_et_cp_year()
- **Processing:** Faithful mirror; pod-level Total/Projected/Actual used at pod × month × version (all versions retained).
- **Editorial Hub:** internal (upstream of editorial_int_capacity_pod_months)
- **Planning Hub:** —
- **Columns:** `id`, `pod`, `year`, `month`, `updated_at`, `updated_by`, `total_capacity`, `projected_used_capacity` …

### `editorial_raw_capacity_members`
*member × month · 417 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** Editorial Capacity Planning › 'ET CP 2026 [V##]' sheet, EDITORIAL TEAM CAPACITY block
- **Pipeline:** build.py RAW_TABLES ← Neon editorial_member_capacity ← _ingest_et_cp_year()
- **Processing:** Per (year,month,pod,slot): role·member·capacity; member_breakdown JSON splits combined cells ('Lauren K (28) + Anabelle (15)').
- **Editorial Hub:** internal (upstream of editorial_int_member_months)
- **Planning Hub:** —
- **Columns:** `id`, `year`, `month`, `pod`, `role`, `updated_at`, `slot`, `member_raw` …

### `editorial_raw_client_pod_history`
*client × month · 513 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** Editorial Capacity Planning › all 'ET CP 2026 [V##]' version tabs (each tab's own-month column)
- **Pipeline:** build.py RAW_TABLES ← Neon client_pod_history ← import_et_cp_pod_history()
- **Processing:** Per-month editorial pod + category (standard/specialized) from each version's own-month col; null-id stubs for unmatched clients.
- **Editorial Hub:** Data Quality → Pod History; upstream of editorial_int_client_pod_months
- **Planning Hub:** —
- **Columns:** `id`, `client_id`, `client_name_raw`, `year`, `month`, `editorial_pod`, `updated_at`, `category` …

### `editorial_raw_clients`
*one row per client · 85 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** Editorial Capacity Planning › 'Editorial SOW overview' sheet
- **Pipeline:** build.py RAW_TABLES ← Neon clients ← import_sow_overview(); transform.add_client_canonicals()
- **Processing:** Client master; adds Salesforce identity (sf_client_name/sf_account_id/sf_match_status) via the hub→SF alias map (SF-identity join).
- **Editorial Hub:** GET /api/clients/; FilterBar + dims everywhere; backs v_editorial_dim_client + production/pipeline/milestone views
- **Planning Hub:** getCapacityData() → JOIN on editorial_raw_production for future demand (client id/name + current editorial_pod)
- **Columns:** `id`, `name`, `status`, `growth_pod`, `editorial_pod`, `start_date`, `end_date`, `term_months` …

### `editorial_raw_cumulative`
*one row per client · 51 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** Master Tracker sheet › 'Cumulative' sheet
- **Pipeline:** build.py RAW_TABLES ← Neon cumulative_metrics ← import_cumulative()
- **Processing:** Faithful mirror; pipeline-stage counts + pcts + published_live at client all-time grain.
- **Editorial Hub:** GET /api/goals-delivery/cumulative; Cumulative Pipeline cards via v_editorial_fct_pipeline
- **Planning Hub:** —
- **Columns:** `id`, `status`, `account_team_pod`, `client_name`, `last_update`, `updated_at`, `client_type`, `content_type` …

### `editorial_raw_deliverables`
*client × month · 653 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** Editorial Capacity Planning › 'Delivered vs Invoiced v2' (+ Meta Calendar Month Deliveries subset)
- **Pipeline:** build.py RAW_TABLES ← Neon deliverables_monthly ← import_delivered_invoiced()/import_meta_deliveries()
- **Processing:** Faithful mirror; client × month delivered/invoiced/sow_target (self-heals blanked months at ingestion).
- **Editorial Hub:** GET /api/deliverables/; upstream of editorial_int_client_months; Editorial Clients → Deliverables vs SOW
- **Planning Hub:** —
- **Columns:** `id`, `client_id`, `year`, `month`, `updated_at`, `updated_by`, `articles_sow_target`, `articles_delivered` …

### `editorial_raw_delivery_templates`
*delivery template rows · 60 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** Editorial Capacity Planning › 'Delivery Schedules' sheet (5 SOW sizes × M1–M12)
- **Pipeline:** build.py RAW_TABLES ← Neon delivery_templates ← import_delivery_schedules() (manifest 'delivery-schedules', past scope — refreshes on Re-sync Past Months / rollover)
- **Processing:** Faithful mirror (template × month_index).
- **Editorial Hub:** GET /api/dashboard/pacing (Pacing badge; currently unrendered)
- **Planning Hub:** —
- **Columns:** `id`, `month_number`, `sow_size`, `invoicing_target`, `invoicing_cumulative`, `delivery_target`, `delivery_cumulative`, `created_at`

### `editorial_raw_goals`
*client × month × week × content_type · 2,212 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** Master Tracker sheet › '[Month Year] Goals vs Delivery' tabs (x9)
- **Pipeline:** build.py RAW_TABLES ← Neon goals_vs_delivery ← import_goals_vs_delivery()
- **Processing:** Faithful mirror; ingestion forward-fills client/pod on continuation rows and pre-doubles LP ×2 from May 2026 (month × week × client × content_type).
- **Editorial Hub:** GET /api/goals-delivery/all; GoalsMonthTable weekly deltas; upstream of editorial_int_goals_month_ct
- **Planning Hub:** —
- **Columns:** `id`, `month_year`, `week_date`, `client_name`, `growth_team_pod`, `editorial_team_pod`, `cb_delivered_to_date`, `cb_monthly_goal` …

### `editorial_raw_kpi_scores`
*member × month × kpi_type · 1,481 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** Master Tracker 'Monthly KPI Scores' sheet + computed KPIs (Notion-derived + capacity util)
- **Pipeline:** build.py RAW_TABLES ← Neon kpi_scores ← import_monthly_kpi_scores() + refresh_computed_kpis()
- **Processing:** Faithful mirror; raw grain is final (member × month × kpi_type); sync-time recompute is upstream.
- **Editorial Hub:** GET /api/kpis/; Team KPIs → KPI heatmap + KpiCards via v_editorial_fct_kpi_scores
- **Planning Hub:** —
- **Columns:** `id`, `team_member_id`, `year`, `month`, `client_id`, `updated_at`, `updated_by`, `kpi_type` …

### `editorial_raw_model_assumptions`
*model assumption rows · 14 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** Editorial Capacity Planning › 'Model Assumptions' sheet (5 category blocks)
- **Pipeline:** build.py RAW_TABLES ← Neon model_assumptions ← import_model_assumptions()
- **Processing:** Faithful mirror (categorisation 70/30, ramp-up %, weekly/monthly capacity, ideal-capacity flags, new-clients-per-pod).
- **Editorial Hub:** internal (no Hub dashboard reads it directly)
- **Planning Hub:** getModelAssumptions() → capacity flag bands (IDEAL_CAPACITY), ramp-up, client mix
- **Columns:** `id`, `updated_at`, `category`, `key`, `value`, `description`

### `editorial_raw_name_mappings`
*kind × raw_name · 471 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** The 3 alias dictionaries (editor/writer from BQ editorial_name_map; client hub→Salesforce map)
- **Pipeline:** build.py build_raw() ← transform.mapping_table_rows() (3 dicts collapsed into one `kind` column)
- **Processing:** Union of the editor/writer/client maps flattened to (kind, raw_name, canonical_name, status, note) — convenience mirror of the name canon.
- **Editorial Hub:** internal / Data Quality convenience mirror; not read by dashboards
- **Planning Hub:** —
- **Columns:** `kind`, `raw_name`, `canonical_name`, `status`, `note`

### `editorial_raw_pod_history`
*year × month × kind × pod × client × role × person · 17,328 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** Team Pods sheet › all monthly tabs (Editorial/Growth/legacy Account Team); editorial Hub-first from BQ team_pod_assignments_editorial_history
- **Pipeline:** build.py RAW_TABLES ← Neon pod_assignment_history ← import_pod_history()
- **Processing:** Faithful mirror; per-month member↔pod↔client rows, emails from people-chips (text fallback pre-chip), writer rows kept raw.
- **Editorial Hub:** internal (upstream of editorial_int_pod_assignments)
- **Planning Hub:** —
- **Columns:** `id`, `year`, `month`, `pod_kind`, `pod_number`, `client_name`, `role`, `display_name` …

### `editorial_raw_production`
*client × month · 4,560 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** Editorial Capacity Planning › 'Editorial Operating Model' sheet (+ projected_original & projected_comment from ET CP ARTICLE BREAKDOWN)
- **Pipeline:** build.py RAW_TABLES ← Neon production_history ← import_operating_model() (projected_original + projected_comment ← _ingest_et_cp_year())
- **Processing:** Faithful mirror; client × month articles_actual/projected/projected_original/is_actual; projected_comment = the ET-CP breakdown per-(client,month) Comments note ('missed by 5', 'move to Pod 5').
- **Editorial Hub:** GET /api/dashboard/production-trend + client-production; upstream of int marts; v_editorial_fct_production_monthly
- **Planning Hub:** getCapacityData() → future per-client demand (articles_projected × weight) + reads articles_actual (current-month delivered) and projected_original (Δ-vs-original on future months)
- **Columns:** `id`, `client_id`, `year`, `month`, `updated_at`, `articles_actual`, `articles_projected`, `projected_original` …

### `editorial_raw_surfer_usage`
*Surfer API usage rows · 25 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** Writer AI Monitoring sheet › "Surfer's API usage" tab
- **Pipeline:** build.py RAW_TABLES ← Neon surfer_api_usage ← import_ai_monitoring_surfer()
- **Processing:** Faithful mirror (year_month grain; surfer pct parsed at ingestion).
- **Editorial Hub:** GET /api/ai-monitoring/surfer-usage
- **Planning Hub:** —
- **Columns:** `id`, `year_month`, `start_date`, `end_date`, `pod_1`, `pod_2`, `pod_3`, `pod_4` …

### `editorial_raw_team_members`
*one row per team member · 12 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** ET CP 2026 roster; team_members list hardcoded in seed_data.py
- **Pipeline:** build.py RAW_TABLES ← Neon team_members ← seed_data.py / import_capacity_plan()
- **Processing:** Faithful mirror of the seeded roster (member grain: name/role/pod/monthly_capacity/email).
- **Editorial Hub:** GET /api/team-members/; backs v_editorial_dim_member; joined into v_editorial_fct_kpi_scores
- **Planning Hub:** —
- **Columns:** `id`, `name`, `role`, `pod`, `monthly_capacity`, `updated_at`, `is_active`, `email` …

## INT — computed intermediates (`editorial_int_*`)

### `editorial_int_articles_creation`
*editor × client × creation-month · 1,834 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_raw_articles
- **Pipeline:** build.py build_int_capacity_articles() → transform.build_articles_monthly_mart()
- **Processing:** Aggregates to (creation editorial-month × editorial_pod × growth_pod × client × editor); editor-credit count + revised/second_reviews/published (num/den kept for pooled rates).
- **Editorial Hub:** GET /api/articles/monthly; Team KPIs → Monthly Articles chart+matrix via v_editorial_fct_articles_monthly
- **Planning Hub:** —
- **Columns:** `month_year`, `editorial_pod`, `growth_pod`, `client_name`, `editor_name`, `count`, `revised`, `second_reviews` …

### `editorial_int_articles_revisions`
*revision × month · 778 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_raw_article_revisions
- **Pipeline:** build.py build_int_capacity_articles() → transform.build_revisions_monthly_mart()
- **Processing:** Revision-event counts at the same dims but bucketed by each revision's OWN editorial month (vs creation-month for the articles mart).
- **Editorial Hub:** GET /api/articles/monthly (revisions array) via v_editorial_fct_article_revisions
- **Planning Hub:** —
- **Columns:** `month_year`, `editorial_pod`, `growth_pod`, `client_name`, `editor_name`, `revisions`

### `editorial_int_capacity_pod_months`
*pod × month × version · 105 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_raw_capacity
- **Pipeline:** build.py build_int_capacity_articles() → transform.build_capacity_pod_mart()
- **Processing:** Latest-V## collapse per (pod,year,month) — ranks by the integer after 'V' (alphabetical is wrong); keeps total/projected/actual used capacity.
- **Editorial Hub:** GET /api/capacity/pod-summary; Team KPIs → Capacity At-a-glance/By Pod/Trend via v_editorial_fct_capacity_pods
- **Planning Hub:** getCapacityData() → pod×month capacity rollup (supply + projected/actual demand) driving pod utilization
- **Columns:** `year`, `month`, `pod`, `version`, `total_capacity`, `projected_used_capacity`, `actual_used_capacity`

### `editorial_int_client_months`
*client × month · 4,561 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_raw_deliverables + editorial_raw_production (+ editorial_raw_clients)
- **Pipeline:** build.py build_int_delivery()
- **Processing:** Merges delivered/invoiced/sow_target + production actual/projected/original; computes is_future and assigns billing periods under BOTH detectors (Overview summary + D1 with post-contract truncation).
- **Editorial Hub:** Overview / Editorial Clients monthly breakdown popovers + lifetime bars via v_editorial_fct_client_months
- **Planning Hub:** —
- **Columns:** `client_id`, `client_name`, `year`, `month`, `ovr_period_idx`, `d1_period_idx`, `as_of_date`, `delivered` …

### `editorial_int_client_pod_months`
*client × pod × month · 425 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_raw_client_pod_history + editorial_raw_production
- **Pipeline:** build.py build_int_capacity_articles() → transform.build_client_contributions_mart()
- **Processing:** Per (year,month,pod,client) contributions; category weight ×1.0 standard / ×1.4 specialized; projected_raw/actual_raw + weighted versions.
- **Editorial Hub:** GET /api/capacity/client-contributions; Team KPIs → Capacity By Client via v_editorial_fct_client_contributions
- **Planning Hub:** getCapacityData() → per-client demand drawer + latest-category; reads projected_raw/actual_raw (client-table delivered + variance)
- **Columns:** `year`, `month`, `pod`, `client_id`, `client_name`, `sf_client_name`, `category`, `weight` …

### `editorial_int_client_q_snapshot`
*one row per client · 85 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_raw_deliverables + editorial_raw_production + editorial_raw_cumulative + editorial_raw_clients
- **Pipeline:** build.py build_int_delivery() (ports pyrules computeCurrentQ/LastFullQ/quarterMetaFromPeriods/varianceTier)
- **Processing:** The variance brain: end-of-Q projected_variance = projected_end − cum_invoiced; tiers (new/on_track/within_limit/ahead/behind); lifetime delivered/invoiced/sow/%; published_live join; D1 twin columns.
- **Editorial Hub:** Overview → Pod Snapshot Current Q cells, D1 client cards, tiers via v_editorial_fct_client_q_snapshot + _pod_snapshot
- **Planning Hub:** —
- **Columns:** `client_id`, `client_name`, `status`, `editorial_pod`, `growth_pod`, `ovr_q_month_in_q`, `d1_term_months`, `d1_q_month_in_q` …

### `editorial_int_goals_month_ct`
*client × month × content_type · 509 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_raw_goals
- **Pipeline:** build.py build_int_goals() → pyrules.goals_month_ct_rows()
- **Processing:** Client × month × content_type: cb/ad goal+delivered = MAX over weekly rows; ratio = contentTypeRatio (article×1, jumbo×2, LP×0.5); weighted w_* = value×ratio.
- **Editorial Hub:** Overview Pod Snapshot Goals + Monthly Goals gauges/table via v_editorial_fct_goals_monthly / _goals_client_totals
- **Planning Hub:** —
- **Columns:** `client_name`, `month_year`, `content_type`, `ratio`, `cb_goal`, `cb_delivered`, `ad_goal`, `ad_delivered` …

### `editorial_int_member_months`
*member × pod × month · 303 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_raw_capacity_members + editorial_raw_client_pod_history + editorial_raw_production + editorial_raw_articles
- **Pipeline:** build.py build_int_capacity_articles() → transform.build_member_utilization_mart() (shared capacity_calc.py)
- **Processing:** Per (year,month,pod,role,member): projected_used = capacity-share × pod projected; actual_used = article-share × pod actual (articles as distribution key); ×1.4 specialized; canonical name. A shared editor (staffed in >1 pod) has their article count SPLIT across pods by capacity share (not credited in full to each), so pod totals aren't inflated.
- **Editorial Hub:** GET /api/capacity/member-utilization(+matrix); Team KPIs → Capacity By Editor + Editors heat matrix
- **Planning Hub:** getCapacityData() → member×pod×month capacity + utilization feeding the move/leave what-if math
- **Columns:** `year`, `month`, `pod`, `role`, `member_match_status`, `pod_total_capacity`, `pod_total_articles`, `pod_projected_raw` …

### `editorial_int_pod_assignments`
*year × month × kind × pod × client × role × person · 17,328 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_raw_pod_history
- **Pipeline:** build.py build_int_pod_assignments()
- **Processing:** Resolves (year,month,kind,pod,client,role,person): client via fuzzy resolver + windowed identity (Tempo); person via date-windowed editor aliases (Sam/Lauren); writer blobs split greedy longest-first + curated writer→email map.
- **Editorial Hub:** Backfill surface; v_editorial_fct_pod_assignments (editorial-only) feeds RBAC group auto-population
- **Planning Hub:** —
- **Columns:** `year`, `month`, `pod_kind`, `pod`, `client_id`, `client_name`, `role`, `person_raw` …

## VIEWS — public read contract (`v_editorial_*`)

### `v_editorial_dim_calendar`
*year × month × week · 52 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_raw_calendar
- **Pipeline:** views.py VIEWS entry (thin passthrough)
- **Processing:** Column projection only (year/month/week_number/start_date/end_date).
- **Editorial Hub:** Editorial week/month mapping + 'As of' badge across dashboards
- **Planning Hub:** —
- **Columns:** `year`, `month`, `start_date`, `end_date`, `week_number`

### `v_editorial_dim_client`
*one row per client · 85 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_raw_clients
- **Pipeline:** views.py VIEWS entry (thin passthrough)
- **Processing:** Column projection/rename only (client_id, both pods, 6 milestone dates, SF identity).
- **Editorial Hub:** The client master read by every dashboard; FilterBar + dims; GET /api/clients/ path
- **Planning Hub:** getActiveClients() → assignable-clients picker; getClientDirectory() → writer-capacity directory + sf_account_id bridge
- **Columns:** `client_id`, `client_name`, `status`, `editorial_pod`, `growth_pod`, `start_date`, `end_date`, `term_months` …

### `v_editorial_dim_member`
*one row per member · 12 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_raw_team_members
- **Pipeline:** views.py VIEWS entry (thin passthrough)
- **Processing:** Column projection/rename only (member_id, name, role, pod, monthly_capacity, email).
- **Editorial Hub:** Team KPIs roster; GET /api/team-members/ (legacy seeded roster — v_editorial_roster preferred for live)
- **Planning Hub:** —
- **Columns:** `member_id`, `name`, `role`, `pod`, `monthly_capacity`, `is_active`, `email`

### `v_editorial_fct_ai_flagged`
*one row per flagged/rewrite article · 378 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_raw_ai_monitoring
- **Pipeline:** views.py VIEWS entry
- **Processing:** Filters detail rows to is_flagged = TRUE OR is_rewrite = TRUE; no aggregation.
- **Editorial Hub:** Team KPIs → AI Compliance flags + rewrites detail (GET /api/ai-monitoring/flags,rewrites)
- **Planning Hub:** —
- **Columns:** `id`, `pod`, `writer_name`, `editor_name`, `date_processed`, `month`, `updated_at`, `client` …

### `v_editorial_fct_ai_recommendations`
*pod × client × writer × editor × month · 802 rows*

- **Origin:** editorial_raw_ai_monitoring
- **Pipeline:** views.py VIEWS entry
- **Processing:** Counts recommendations (full/partial/review) at pod×client×writer×editor×month, rewrites EXCLUDED; adds parsed month_date for chronological order.
- **Editorial Hub:** Team KPIs → AI Compliance rollups (every tab rollup is a SUM over this)
- **Planning Hub:** —
- **Columns:** `pod`, `writer_name`, `editor_name`, `month`, `month_date`, `client`, `total`, `full_pass` …

### `v_editorial_fct_article_revisions`
*revision × month · 778 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_int_articles_revisions
- **Pipeline:** views.py VIEWS entry (thin passthrough)
- **Processing:** Passthrough; revision-own-month basis already applied upstream.
- **Editorial Hub:** Team KPIs → Monthly Articles 'Revisions' metric; GET /api/articles/monthly
- **Planning Hub:** —
- **Columns:** `month_year`, `editorial_pod`, `growth_pod`, `client_name`, `editor_name`, `revisions`

### `v_editorial_fct_articles_monthly`
*editor × client × creation-month · 1,834 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_int_articles_creation
- **Pipeline:** views.py VIEWS entry (thin passthrough)
- **Processing:** Passthrough; creation editorial-month basis, editor-credit grain, both pod axes applied upstream.
- **Editorial Hub:** Team KPIs → Monthly Articles chart+matrix; GET /api/articles/monthly
- **Planning Hub:** —
- **Columns:** `month_year`, `editorial_pod`, `growth_pod`, `client_name`, `editor_name`, `count`, `revised`, `second_reviews` …

### `v_editorial_fct_capacity_pods`
*pod × month × version · 105 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_int_capacity_pod_months
- **Pipeline:** views.py VIEWS entry (thin passthrough)
- **Processing:** Passthrough; latest-V## collapse applied upstream.
- **Editorial Hub:** Team KPIs → Capacity At-a-glance / By Pod / Trend(Pods); GET /api/capacity/pod-summary
- **Planning Hub:** —
- **Columns:** `year`, `month`, `pod`, `version`, `total_capacity`, `projected_used_capacity`, `actual_used_capacity`

### `v_editorial_fct_client_contributions`
*client × pod × month · 425 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_int_client_pod_months
- **Pipeline:** views.py VIEWS entry (thin passthrough)
- **Processing:** Passthrough; ×1.4 specialized weighting applied upstream.
- **Editorial Hub:** Team KPIs → Capacity By Client (per-pod Clients drawer); GET /api/capacity/client-contributions
- **Planning Hub:** —
- **Columns:** `year`, `month`, `pod`, `client_id`, `client_name`, `sf_client_name`, `category`, `weight` …

### `v_editorial_fct_client_months`
*client × month · 4,561 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_int_client_months
- **Pipeline:** views.py VIEWS entry (thin passthrough)
- **Processing:** Passthrough; is_future + dual billing-period assignment applied upstream.
- **Editorial Hub:** Overview / Editorial Clients monthly breakdown popovers + lifetime bars
- **Planning Hub:** —
- **Columns:** `client_id`, `client_name`, `year`, `month`, `ovr_period_idx`, `d1_period_idx`, `as_of_date`, `delivered` …

### `v_editorial_fct_client_q_snapshot`
*one row per client · 85 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_int_client_q_snapshot
- **Pipeline:** views.py VIEWS entry (thin passthrough)
- **Processing:** Passthrough; end-of-Q variance + tiers + lifetime computed upstream.
- **Editorial Hub:** Overview → Pod Snapshot Current Q cells, D1 client cards, End-of-Q chips + tiers
- **Planning Hub:** —
- **Columns:** `client_id`, `client_name`, `status`, `editorial_pod`, `growth_pod`, `ovr_q_month_in_q`, `d1_term_months`, `d1_q_month_in_q` …

### `v_editorial_fct_goals_client_totals`
*one row per client · 76 rows*

- **Origin:** editorial_int_goals_month_ct
- **Pipeline:** views.py VIEWS entry
- **Processing:** Step-3 goals aggregation in SQL: per client, month totals gated on that month's weighted goal > 0 (CB and AD independently), then summed — matches aggregateGoalsSummary.
- **Editorial Hub:** Overview → Pod Snapshot / GoalsVsDelivery goal-gated client %-complete totals
- **Planning Hub:** —
- **Columns:** `client_name`, `cb_goal`, `cb_delivered`, `ad_goal`, `ad_delivered`

### `v_editorial_fct_goals_monthly`
*client × month × content_type · 509 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_int_goals_month_ct
- **Pipeline:** views.py VIEWS entry (thin passthrough)
- **Processing:** Passthrough; max-of-week + contentTypeRatio weighting applied — exposes both raw and weighted measures.
- **Editorial Hub:** Overview Pod Snapshot Goals; Monthly Goals gauges + GoalsMonthTable
- **Planning Hub:** —
- **Columns:** `client_name`, `month_year`, `content_type`, `ratio`, `cb_goal`, `cb_delivered`, `ad_goal`, `ad_delivered` …

### `v_editorial_fct_kpi_scores`
*member × month × kpi_type · 1,481 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_raw_kpi_scores + editorial_raw_team_members
- **Pipeline:** views.py VIEWS entry (LEFT JOIN member name/role/pod)
- **Processing:** Joins member name/role/pod onto the KPI rows; no recompute (raw grain is final).
- **Editorial Hub:** Team KPIs → KPI heatmap + KpiCards
- **Planning Hub:** —
- **Columns:** `team_member_id`, `member_name`, `role`, `pod`, `year`, `month`, `client_id`, `kpi_type` …

### `v_editorial_fct_member_utilization`
*member × month · 303 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_int_member_months
- **Pipeline:** views.py VIEWS entry (thin passthrough)
- **Processing:** Passthrough; allocation/distribution utilization model + ×1.4 weighting + canonical names applied upstream.
- **Editorial Hub:** Team KPIs → Capacity By Editor + Editors heat matrix; GET /api/capacity/member-utilization(+matrix)
- **Planning Hub:** —
- **Columns:** `year`, `month`, `pod`, `role`, `member_match_status`, `pod_total_capacity`, `pod_total_articles`, `pod_projected_raw` …

### `v_editorial_fct_milestone_transitions`
*client × transition · 492 rows*

- **Origin:** editorial_raw_clients
- **Pipeline:** views.py VIEWS entry
- **Processing:** Computes the 8 audited milestone transitions as calendar-day DATE_DIFFs via UNNEST; negatives included (stats card filters days≥0 at read time).
- **Editorial Hub:** Overview → Time to Milestones cards, Pod Timelines, Per-Client Days chart
- **Planning Hub:** —
- **Columns:** `client_id`, `client_name`, `editorial_pod`, `growth_pod`, `transition`, `days`

### `v_editorial_fct_pipeline`
*one row per client · 51 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_raw_cumulative + editorial_raw_clients
- **Pipeline:** views.py VIEWS entry (LEFT JOIN on client name)
- **Processing:** Joins client dims; audited stage fields (Topics/CBs = approved, Articles = sent, Published = published_live); keeps articles_approved for approval-rate.
- **Editorial Hub:** Editorial Clients / Overview → Cumulative Pipeline header + cards
- **Planning Hub:** —
- **Columns:** `client_name`, `client_id`, `editorial_pod`, `growth_pod`, `sheet_status`, `articles_sow`, `topics_sent`, `topics_approved` …

### `v_editorial_fct_pod_assignments`
*year × month × pod × client × role × person · 2,551 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_int_pod_assignments
- **Pipeline:** views.py VIEWS entry
- **Processing:** Filters editorial_int_pod_assignments to pod_kind='editorial' (writer rows kept, distinguishable via role; filter confidence='unparsed' for fully-identified only).
- **Editorial Hub:** Editorial-only staffing / RBAC group feed
- **Planning Hub:** —
- **Columns:** `year`, `month`, `pod_kind`, `pod`, `client_id`, `client_name`, `role`, `person_raw` …

### `v_editorial_fct_pod_snapshot`
*pod_axis × pod · 15 rows*

- **Origin:** editorial_int_client_q_snapshot (rolled up onto both pod axes)
- **Pipeline:** views.py VIEWS entry (CROSS JOIN UNNEST both pod axes + GROUP BY)
- **Processing:** Pod rollups on editorial+growth axes: delivered/invoiced/projected_end sums INCLUDE 1st-Q clients; variance sum EXCLUDES them (counted in new_count); no-current-Q or invoiced≤0 dropped from Q sums.
- **Editorial Hub:** Overview → Pod Snapshot pod rows (Goals / Last Q / Current Q / %SOW / %Published)
- **Planning Hub:** —
- **Columns:** `pod_axis`, `pod`, `as_of_date`, `client_count`, `new_count`, `q_actual_delivered`, `q_projected_end`, `q_invoiced` …

### `v_editorial_fct_production_monthly`
*client × month · 4,560 rows · fresh 2026-07-16 09:09:04 UTC*

- **Origin:** editorial_raw_production + editorial_raw_clients
- **Pipeline:** views.py VIEWS entry (LEFT JOIN client name + both pods)
- **Processing:** Joins client name + pods onto production rows (actual/projected/projected_original/projected_comment/is_actual); no math.
- **Editorial Hub:** Overview → Production History chart (All / Per pod / Per client); GET /api/dashboard/production-trend
- **Planning Hub:** getClientGoals() → writer 'Goals per month'; getClientLastActiveMonth() → firstYm/lastYm; projected_comment → per-(client,month) planning note for the client table
- **Columns:** `client_id`, `client_name`, `editorial_pod`, `growth_pod`, `year`, `month`, `articles_actual`, `articles_projected` …

### `v_editorial_roster`
*one row per person × role · 141 rows*

- **Origin:** Rippling v_headcount (title LIKE '%editor%') + Slack slack_raw_users (ext.writing email) + editorial_name_map, minus editorial_roster_exclusions
- **Pipeline:** etl/warehouse/v_editorial_roster.sql (standalone CREATE VIEW; refreshed on the @name-mappings SYNC step)
- **Processing:** Unions Rippling editors (Sr/Lead/Director/VP→sr_editor) + Slack writers + legacy name-map canonicals; canonicalizes via editorial_name_map; subtracts role-aware exclusions; carries source IDs + work_email; always-live.
- **Editorial Hub:** Single source of truth → master Roster tab → MAC editor/writer dropdowns (Apps Script roster_refresh)
- **Planning Hub:** getRoster() → roster picker (add SE/Editor/Writer) + writers-capacity rail; SoT for canonical_name/role/is_active/slack_id/work_email
- **Columns:** `canonical_name`, `role`, `source_id`, `slack_id`, `status`, `hire_date`, `term_date`, `source` …

## HUB-PUBLISHED — written by the planning-hub app, not this ETL

### `editorial_capacity_plan`
*ym × pod · 92 rows*

- **Origin:** editorial-team-pods app (capacity board) → src/lib/sync-to-bq.ts publish
- **Pipeline:** planning-hub publish (NOT this ETL)
- **Processing:** Pod-month rollup of the Hub's capacity model: supply, projected/actual demand, utilization — composed WITH the demand-edit overlay.
- **Editorial Hub:** none today (reviewed 2026-07-04 — no Editorial-Hub reader; candidate INT input at the Q3/Q4 cutover)
- **Planning Hub:** —
- **Columns:** `pod`, `ym`, `supply`, `projected_demand`, `actual_demand`, `util_projected`, `util_actual`, `source` …

### `editorial_capacity_plan_demand`
*ym × pod × client_id (NEGATIVE ids = planned/unsigned clients) · 934 rows*

- **Origin:** editorial-team-pods app (client table edits: articles, pod moves, ×1.4 category, note, status_override) → sync-to-bq.ts
- **Pipeline:** planning-hub publish (NOT this ETL)
- **Processing:** Per-client demand incl. Hub edits. NEGATIVE client_id = planned/unsigned clients (no dim_client match by construction) — joins drop them, SUMs include them (intended).
- **Editorial Hub:** none today (reviewed 2026-07-04); designated Hub-first source for client→pod attribution + future projected articles at the Q3/Q4 cutover
- **Planning Hub:** —
- **Columns:** `pod`, `client_id`, `client_name`, `status_override`, `ym`, `articles`, `weight`, `projected_weighted` …

### `editorial_capacity_plan_members`
*ym × pod × member · 260 rows*

- **Origin:** editorial-team-pods app (member capacity edits) → sync-to-bq.ts
- **Pipeline:** planning-hub publish (NOT this ETL)
- **Processing:** Per-member capacity (base + effective) behind the Hub's supply numbers.
- **Editorial Hub:** none today (reviewed 2026-07-04)
- **Planning Hub:** —
- **Columns:** `pod`, `role`, `ym`, `member`, `email`, `capacity`, `base_capacity`, `source` …

### `editorial_writer_desired`
*writer × ym (latest submission wins) · 280 rows*

- **Origin:** Writers' 'desired article total' Google Form (sheet 1SprAkq…) — current 'Form Responses' + legacy 'Responses up to April 2026' tabs
- **Pipeline:** THIS ETL: build_writer_desired.publish_writer_desired_from_sheet() (manifest '@writer-desired', current scope → daily) → CREATE-OR-REPLACE (WRITE_TRUNCATE)
- **Processing:** ym resolution (explicit year on current tab, timestamp-inferred + wrap on legacy), desired=first int, name reconciliation via editorial_name_map(writer)+v_editorial_roster (+Dan Pelberg fallback), dedup latest-per-(writer_canonical, ym).
- **Editorial Hub:** internal (EH publishes it; no EH dashboard reads it)
- **Planning Hub:** getWriterDesired(fromYm) → the capacity BASIS in the Writers model (self-reported desired bw; fallback to computed-from-history when absent)
- **Columns:** `raw_name`, `year`, `month`, `writer_canonical`, `ym`, `desired`, `clients`, `days` …

### `editorial_writer_plan`
*ym × writer · 1,350 rows*

- **Origin:** editorial-team-pods app (Writers tab) → sync-to-bq.ts
- **Pipeline:** planning-hub publish (NOT this ETL)
- **Processing:** Writer bandwidth plan: computed/override/effective bw, allocated vs delivered, roster membership.
- **Editorial Hub:** none today (reviewed 2026-07-04)
- **Planning Hub:** —
- **Columns:** `override_bw`, `status`, `ym`, `writer`, `computed_bw`, `effective_bw`, `allocated`, `delivered` …

### `editorial_writer_plan_allocations`
*ym × writer × client · 0 rows*

- **Origin:** editorial-team-pods app (Writers tab allocations) → sync-to-bq.ts
- **Pipeline:** planning-hub publish (NOT this ETL)
- **Processing:** Writer→client article allocations; goals composed WITH the demand overlay, so they intentionally diverge from editorial_raw_production.articles_projected where DaniQ edited in the Hub.
- **Editorial Hub:** none today (reviewed 2026-07-04)
- **Planning Hub:** —
- **Columns:** `client_id`, `client_name`, `ym`, `writer`, `articles`, `note`, `source`, `reason` …

### `editorial_writer_plan_client_verticals`
*one row per client · 33 rows*

- **Origin:** editorial-team-pods app (client vertical tags) → sync-to-bq.ts
- **Pipeline:** planning-hub publish (NOT this ETL)
- **Processing:** Client vertical tags for writer↔client matching.
- **Editorial Hub:** none today (reviewed 2026-07-04)
- **Planning Hub:** —
- **Columns:** `client_id`, `client_name`, `sf_account_id`, `vertical_name`, `vertical`, `note`, `ym`, `published_at`

### `editorial_writer_plan_verticals`
*writer × vertical · 144 rows*

- **Origin:** editorial-team-pods app (writer skills) → sync-to-bq.ts
- **Pipeline:** planning-hub publish (NOT this ETL)
- **Processing:** Writer vertical skills + difficulty for allocation matching.
- **Editorial Hub:** none today (reviewed 2026-07-04)
- **Planning Hub:** —
- **Columns:** `vertical_name`, `writer`, `vertical`, `vertical_group`, `difficulty`, `ym`, `published_at`

### `team_pod_assignments`
*one row per assignment (growth, current) · 391 rows*

- **Origin:** editorial-team-pods app (growth Team tab) → publish
- **Pipeline:** planning-hub publish (NOT this ETL)
- **Processing:** Growth Team-tab current assignments (growth pod import stays sheet/BQ-Salesforce-based on the EH side — not read from here).
- **Editorial Hub:** none today (reviewed 2026-07-04)
- **Planning Hub:** —
- **Columns:** `id`, `account_id`, `worker_id`, `display_name`, `role`, `slack_id`, `sr_growth_director_slack_id`, `growth_director_slack_id` …

### `team_pod_assignments_editorial`
*one row per assignment (editorial, current) · 117 rows*

- **Origin:** editorial-team-pods app (editorial Team tab; capacity-initiated current-month pod moves fan out here too) → publish
- **Pipeline:** planning-hub publish (NOT this ETL)
- **Processing:** Editorial Team-tab current assignments (the _history table is the canonical per-month record).
- **Editorial Hub:** none directly (the ETL reads the _history table)
- **Planning Hub:** —
- **Columns:** `id`, `account_id`, `pod`, `client_name`, `worker_id`, `display_name`, `role`, `slack_id` …

### `team_pod_assignments_editorial_history`
*ym × pod × client × role × person (soft-delete via deleted_at) · 2,551 rows*

- **Origin:** editorial-team-pods app (editorial pod_accounts upsert — Team tab AND capacity-initiated moves) → publish
- **Pipeline:** planning-hub publish (NOT this ETL); soft-delete via deleted_at
- **Processing:** Canonical per-month editorial member↔pod↔client history. PEOPLE-loop cutover 2026-06-12: this table is Hub-first source of truth; sheet is fallback. Gate: python -m etl.warehouse.hub_parity.
- **Editorial Hub:** import_team_pods()/_import_editorial_pods_from_hub() → pod_assignments (RBAC); import_pod_history()/_import_editorial_history_from_hub() → pod_assignment_history → editorial_raw_pod_history
- **Planning Hub:** —
- **Columns:** `pod`, `client_id`, `client_name`, `role`, `display_name`, `confidence`, `ym`, `email` …

### `v_company_roster`
*person × role · 424 rows*

- **Origin:** v_headcount (ALL Rippling employees, every dept) + slack_raw_users (ext.writing writers) + editorial_name_map (legacy canonicals + canonicalization)
- **Pipeline:** etl/warehouse/v_company_roster.sql (standalone always-live CREATE VIEW; applied manually like v_editorial_roster — recomputes on read, no populate job)
- **Processing:** Same union + canonicalization as v_editorial_roster but WITHOUT the editor-title filter and WITHOUT editorial exclusions; adds role (editor/sr_editor/writer/employee), is_editorial, title, department. Grain person × role.
- **Editorial Hub:** internal (superset of v_editorial_roster; EH keeps reading v_editorial_roster)
- **Planning Hub:** all-company member picker / dropdown (select employees + writer contractors); filter is_active / is_editorial as needed
- **Columns:** `canonical_name`, `role`, `source_id`, `slack_id`, `status`, `hire_date`, `term_date`, `is_editorial` …

