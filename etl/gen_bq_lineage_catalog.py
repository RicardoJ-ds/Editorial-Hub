"""Generate the BQ **lineage** catalog for the downstream planning-hub.

Companion to ``gen_bq_schema_catalog.py``. Where the schema catalog answers
*"what columns / how many rows"*, the lineage catalog answers
*"where did this number come from, what math was applied, and who reads it"* —
for every editorial object in ``graphite-data.graphite_bi_sandbox``.

It emits two artifacts and copies BOTH into the sibling planning-hub repo's
``docs/`` folder (same sync mechanism as the schema catalog):

  * ``etl/bq_lineage_catalog.json`` — machine-readable: schema fields (grain,
    columns, row_count, synced_at — live from BQ) PLUS lineage fields
    (origin, pipeline_step, processing, consumers.{editorial_hub,planning_hub}).
  * ``etl/bq_lineage_catalog.md``   — human-readable, grouped raw / int / views.

Design notes
------------
* **Reuses the schema generator's introspection** (``_get_bq`` / ``introspect``)
  so columns / row counts / freshness are always live from BigQuery, and the
  two catalogs never disagree about the structural facts.
* **Lineage is a curated map, not auto-derived.** ``LINEAGE`` below is the
  single source for origin / pipeline_step / processing / consumers — authored
  from ``etl/ETL_INVENTORY.md``, ``etl/WAREHOUSE_DESIGN.md``,
  ``etl/warehouse/build.py`` + ``views.py``, and the two consumers' read layers.
  Edit it when the ETL changes (same discipline as ``GRAIN`` in the schema gen).
  Anchor each ``processing`` note to its ``pipeline_step`` function so the prose
  stays verifiable against code.
* **``consumers.planning_hub`` is curated but drift-checked live.** On each run
  we scan the sibling ``editorial-team-pods/src/lib/{bq,data}.ts`` for the
  objects it actually references and warn if the curated map has drifted (an
  object the Hub now reads but we don't credit, or vice versa). Best-effort —
  if the sibling checkout is absent the check is skipped, never fails the run.

Run (from the repo root):
    .venv/bin/python -m etl.gen_bq_lineage_catalog
    .venv/bin/python -m etl.gen_bq_lineage_catalog --no-sync    # skip the copy
    .venv/bin/python -m etl.gen_bq_lineage_catalog --no-counts  # skip row counts
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone

# Reuse the schema generator's config + introspection so the two catalogs share
# one source of structural truth (columns / counts / freshness / grain).
from etl.gen_bq_schema_catalog import (
    DS,
    FAMILY_ORDER,
    FAMILY_TITLE,
    PLANNING_HUB_DOCS,
    REPO_ROOT,
    _key_columns,
    introspect,
    seed_catalog,
)

OUT_JSON = REPO_ROOT / "etl" / "bq_lineage_catalog.json"
OUT_MD = REPO_ROOT / "etl" / "bq_lineage_catalog.md"

# Sibling read layer we drift-check consumers.planning_hub against.
PLANNING_HUB_READ_LAYER = [
    REPO_ROOT.parent / "editorial-team-pods" / "src" / "lib" / "bq.ts",
    REPO_ROOT.parent / "editorial-team-pods" / "src" / "lib" / "data.ts",
]

# ──────────────────────────────────────────────────────────────────────────────
# LINEAGE — the curated source of origin → processing → consumers, one entry per
# object. Hand-authored from the ETL docs + build/views code + both Hubs' read
# layers. EDIT THIS when the ETL surface changes; columns/counts stay live.
#
#   origin        — the true source (raw: source sheet/tab or system; int/view:
#                   the upstream warehouse table(s) it derives from).
#   pipeline_step — the script + function that produces it.
#   processing    — the transformation/business-math in plain language (the part
#                   raw SQL doesn't reveal). "faithful mirror …" for raw copies.
#   eh            — consumers.editorial_hub: which EH page/endpoint/metric reads it.
#   ph            — consumers.planning_hub: which editorial-team-pods reader reads
#                   it + the number it feeds ("" = not read by the Planning Hub).
# ──────────────────────────────────────────────────────────────────────────────
LINEAGE: dict[str, dict[str, str]] = {
    # ── RAW ──────────────────────────────────────────────────────────────────
    "editorial_raw_ai_monitoring": {
        "origin": "Writer AI Monitoring sheet › Data / Rewrites / Yellow-Red Flags_v2 tabs",
        "pipeline_step": "build.py RAW_TABLES ← Neon ai_monitoring_records ← import_ai_monitoring_{data,rewrites,flags}()",
        "processing": "Faithful mirror; recommendation normalized + flag-merge applied at ingestion (record grain).",
        "eh": "Team KPIs → AI Compliance via GET /api/ai-monitoring/*; backs the two AI views",
        "ph": "",
    },
    "editorial_raw_article_revisions": {
        "origin": "Monthly Article Count sheet (per-client tabs) + Meta Editorial Tracker",
        "pipeline_step": "build.py RAW_TABLES ← Neon article_revisions ← import_monthly_article_count()",
        "processing": "One row per article-editor-revision event, bucketed by each revision's OWN editorial month (year inferred from submitted date).",
        "eh": "internal (upstream of editorial_int_articles_revisions)",
        "ph": "",
    },
    "editorial_raw_articles": {
        "origin": "Monthly Article Count sheet (per-client tabs) + Meta Editorial Tracker",
        "pipeline_step": "build.py RAW_TABLES ← Neon article_records ← import_monthly_article_count(); transform.add_article_canonicals()",
        "processing": "One row per (article, editor); slash-pair editors exploded; editor/writer canonicalized via name-map; pod denormalized from client's current pod; Notion published match.",
        "eh": "GET /api/articles/editors (editor dropdown); upstream of editorial_int_articles_creation",
        "ph": "getWriterDelivered() → delivered per writer×month×client (24mo) → writer bandwidth + 12-month drawer",
    },
    "editorial_raw_calendar": {
        "origin": "Master Tracker sheet › '<YYYY> Week Distribution' tabs",
        "pipeline_step": "build.py RAW_TABLES ← Neon editorial_weeks ← import_week_distribution()",
        "processing": "Faithful mirror (year × month × week); defines when each editorial month begins.",
        "eh": "GET /api/migrate/editorial-weeks → 'As of' badge + editorial-month bucketing; backs v_editorial_dim_calendar",
        "ph": "",
    },
    "editorial_raw_capacity": {
        "origin": "Editorial Capacity Planning › 'ET CP 2026 [V##]' sheet, EDITORIAL TEAM CAPACITY block (all versions)",
        "pipeline_step": "build.py RAW_TABLES ← Neon capacity_projections ← import_capacity_plan()/_ingest_et_cp_year()",
        "processing": "Faithful mirror; pod-level Total/Projected/Actual used at pod × month × version (all versions retained).",
        "eh": "internal (upstream of editorial_int_capacity_pod_months)",
        "ph": "",
    },
    "editorial_raw_capacity_members": {
        "origin": "Editorial Capacity Planning › 'ET CP 2026 [V##]' sheet, EDITORIAL TEAM CAPACITY block",
        "pipeline_step": "build.py RAW_TABLES ← Neon editorial_member_capacity ← _ingest_et_cp_year()",
        "processing": "Per (year,month,pod,slot): role·member·capacity; member_breakdown JSON splits combined cells ('Lauren K (28) + Anabelle (15)').",
        "eh": "internal (upstream of editorial_int_member_months)",
        "ph": "",
    },
    "editorial_raw_client_pod_history": {
        "origin": "Editorial Capacity Planning › all 'ET CP 2026 [V##]' version tabs (each tab's own-month column)",
        "pipeline_step": "build.py RAW_TABLES ← Neon client_pod_history ← import_et_cp_pod_history()",
        "processing": "Per-month editorial pod + category (standard/specialized) from each version's own-month col; null-id stubs for unmatched clients.",
        "eh": "Data Quality → Pod History; upstream of editorial_int_client_pod_months",
        "ph": "",
    },
    "editorial_raw_clients": {
        "origin": "Editorial Capacity Planning › 'Editorial SOW overview' sheet",
        "pipeline_step": "build.py RAW_TABLES ← Neon clients ← import_sow_overview(); transform.add_client_canonicals()",
        "processing": "Client master; adds Salesforce identity (sf_client_name/sf_account_id/sf_match_status) via the hub→SF alias map (SF-identity join).",
        "eh": "GET /api/clients/; FilterBar + dims everywhere; backs v_editorial_dim_client + production/pipeline/milestone views",
        "ph": "getCapacityData() → JOIN on editorial_raw_production for future demand (client id/name + current editorial_pod)",
    },
    "editorial_raw_cumulative": {
        "origin": "Master Tracker sheet › 'Cumulative' sheet",
        "pipeline_step": "build.py RAW_TABLES ← Neon cumulative_metrics ← import_cumulative()",
        "processing": "Faithful mirror; pipeline-stage counts + pcts + published_live at client all-time grain.",
        "eh": "GET /api/goals-delivery/cumulative; Cumulative Pipeline cards via v_editorial_fct_pipeline",
        "ph": "",
    },
    "editorial_raw_deliverables": {
        "origin": "Editorial Capacity Planning › 'Delivered vs Invoiced v2' (+ Meta Calendar Month Deliveries subset)",
        "pipeline_step": "build.py RAW_TABLES ← Neon deliverables_monthly ← import_delivered_invoiced()/import_meta_deliveries()",
        "processing": "Faithful mirror; client × month delivered/invoiced/sow_target (self-heals blanked months at ingestion).",
        "eh": "GET /api/deliverables/; upstream of editorial_int_client_months; Editorial Clients → Deliverables vs SOW",
        "ph": "",
    },
    "editorial_raw_delivery_templates": {
        "origin": "Editorial Capacity Planning › 'Delivery Schedules' sheet (5 SOW sizes × M1–M12)",
        "pipeline_step": "build.py RAW_TABLES ← Neon delivery_templates ← import_delivery_schedules()",
        "processing": "Faithful mirror (template × month_index).",
        "eh": "GET /api/dashboard/pacing (Pacing badge; currently unrendered)",
        "ph": "",
    },
    "editorial_raw_goals": {
        "origin": "Master Tracker sheet › '[Month Year] Goals vs Delivery' tabs (x9)",
        "pipeline_step": "build.py RAW_TABLES ← Neon goals_vs_delivery ← import_goals_vs_delivery()",
        "processing": "Faithful mirror; ingestion forward-fills client/pod on continuation rows and pre-doubles LP ×2 from May 2026 (month × week × client × content_type).",
        "eh": "GET /api/goals-delivery/all; GoalsMonthTable weekly deltas; upstream of editorial_int_goals_month_ct",
        "ph": "",
    },
    "editorial_raw_kpi_scores": {
        "origin": "Master Tracker 'Monthly KPI Scores' sheet + computed KPIs (Notion-derived + capacity util)",
        "pipeline_step": "build.py RAW_TABLES ← Neon kpi_scores ← import_monthly_kpi_scores() + refresh_computed_kpis()",
        "processing": "Faithful mirror; raw grain is final (member × month × kpi_type); sync-time recompute is upstream.",
        "eh": "GET /api/kpis/; Team KPIs → KPI heatmap + KpiCards via v_editorial_fct_kpi_scores",
        "ph": "",
    },
    "editorial_raw_model_assumptions": {
        "origin": "Editorial Capacity Planning › 'Model Assumptions' sheet (5 category blocks)",
        "pipeline_step": "build.py RAW_TABLES ← Neon model_assumptions ← import_model_assumptions()",
        "processing": "Faithful mirror (categorisation 70/30, ramp-up %, weekly/monthly capacity, ideal-capacity flags, new-clients-per-pod).",
        "eh": "internal (no Hub dashboard reads it directly)",
        "ph": "getModelAssumptions() → capacity flag bands (IDEAL_CAPACITY), ramp-up, client mix",
    },
    "editorial_raw_name_mappings": {
        "origin": "The 3 alias dictionaries (editor/writer from BQ editorial_name_map; client hub→Salesforce map)",
        "pipeline_step": "build.py build_raw() ← transform.mapping_table_rows() (3 dicts collapsed into one `kind` column)",
        "processing": "Union of the editor/writer/client maps flattened to (kind, raw_name, canonical_name, status, note) — convenience mirror of the name canon.",
        "eh": "internal / Data Quality convenience mirror; not read by dashboards",
        "ph": "",
    },
    "editorial_raw_pod_history": {
        "origin": "Team Pods sheet › all monthly tabs (Editorial/Growth/legacy Account Team); editorial Hub-first from BQ team_pod_assignments_editorial_history",
        "pipeline_step": "build.py RAW_TABLES ← Neon pod_assignment_history ← import_pod_history()",
        "processing": "Faithful mirror; per-month member↔pod↔client rows, emails from people-chips (text fallback pre-chip), writer rows kept raw.",
        "eh": "internal (upstream of editorial_int_pod_assignments)",
        "ph": "",
    },
    "editorial_raw_production": {
        "origin": "Editorial Capacity Planning › 'Editorial Operating Model' sheet (+ projected_original & projected_comment from ET CP ARTICLE BREAKDOWN)",
        "pipeline_step": "build.py RAW_TABLES ← Neon production_history ← import_operating_model() (projected_original + projected_comment ← _ingest_et_cp_year())",
        "processing": "Faithful mirror; client × month articles_actual/projected/projected_original/is_actual; projected_comment = the ET-CP breakdown per-(client,month) Comments note ('missed by 5', 'move to Pod 5').",
        "eh": "GET /api/dashboard/production-trend + client-production; upstream of int marts; v_editorial_fct_production_monthly",
        "ph": "getCapacityData() → future per-client demand (articles_projected × weight) + reads articles_actual (current-month delivered) and projected_original (Δ-vs-original on future months)",
    },
    "editorial_raw_surfer_usage": {
        "origin": 'Writer AI Monitoring sheet › "Surfer\'s API usage" tab',
        "pipeline_step": "build.py RAW_TABLES ← Neon surfer_api_usage ← import_ai_monitoring_surfer()",
        "processing": "Faithful mirror (year_month grain; surfer pct parsed at ingestion).",
        "eh": "GET /api/ai-monitoring/surfer-usage",
        "ph": "",
    },
    "editorial_raw_team_members": {
        "origin": "ET CP 2026 roster; team_members list hardcoded in seed_data.py",
        "pipeline_step": "build.py RAW_TABLES ← Neon team_members ← seed_data.py / import_capacity_plan()",
        "processing": "Faithful mirror of the seeded roster (member grain: name/role/pod/monthly_capacity/email).",
        "eh": "GET /api/team-members/; backs v_editorial_dim_member; joined into v_editorial_fct_kpi_scores",
        "ph": "",
    },
    # ── INT ──────────────────────────────────────────────────────────────────
    "editorial_int_articles_creation": {
        "origin": "editorial_raw_articles",
        "pipeline_step": "build.py build_int_capacity_articles() → transform.build_articles_monthly_mart()",
        "processing": "Aggregates to (creation editorial-month × editorial_pod × growth_pod × client × editor); editor-credit count + revised/second_reviews/published (num/den kept for pooled rates).",
        "eh": "GET /api/articles/monthly; Team KPIs → Monthly Articles chart+matrix via v_editorial_fct_articles_monthly",
        "ph": "",
    },
    "editorial_int_articles_revisions": {
        "origin": "editorial_raw_article_revisions",
        "pipeline_step": "build.py build_int_capacity_articles() → transform.build_revisions_monthly_mart()",
        "processing": "Revision-event counts at the same dims but bucketed by each revision's OWN editorial month (vs creation-month for the articles mart).",
        "eh": "GET /api/articles/monthly (revisions array) via v_editorial_fct_article_revisions",
        "ph": "",
    },
    "editorial_int_capacity_pod_months": {
        "origin": "editorial_raw_capacity",
        "pipeline_step": "build.py build_int_capacity_articles() → transform.build_capacity_pod_mart()",
        "processing": "Latest-V## collapse per (pod,year,month) — ranks by the integer after 'V' (alphabetical is wrong); keeps total/projected/actual used capacity.",
        "eh": "GET /api/capacity/pod-summary; Team KPIs → Capacity At-a-glance/By Pod/Trend via v_editorial_fct_capacity_pods",
        "ph": "getCapacityData() → pod×month capacity rollup (supply + projected/actual demand) driving pod utilization",
    },
    "editorial_int_client_months": {
        "origin": "editorial_raw_deliverables + editorial_raw_production (+ editorial_raw_clients)",
        "pipeline_step": "build.py build_int_delivery()",
        "processing": "Merges delivered/invoiced/sow_target + production actual/projected/original; computes is_future and assigns billing periods under BOTH detectors (Overview summary + D1 with post-contract truncation).",
        "eh": "Overview / Editorial Clients monthly breakdown popovers + lifetime bars via v_editorial_fct_client_months",
        "ph": "",
    },
    "editorial_int_client_pod_months": {
        "origin": "editorial_raw_client_pod_history + editorial_raw_production",
        "pipeline_step": "build.py build_int_capacity_articles() → transform.build_client_contributions_mart()",
        "processing": "Per (year,month,pod,client) contributions; category weight ×1.0 standard / ×1.4 specialized; projected_raw/actual_raw + weighted versions.",
        "eh": "GET /api/capacity/client-contributions; Team KPIs → Capacity By Client via v_editorial_fct_client_contributions",
        "ph": "getCapacityData() → per-client demand drawer + latest-category; reads projected_raw/actual_raw (client-table delivered + variance)",
    },
    "editorial_int_client_q_snapshot": {
        "origin": "editorial_raw_deliverables + editorial_raw_production + editorial_raw_cumulative + editorial_raw_clients",
        "pipeline_step": "build.py build_int_delivery() (ports pyrules computeCurrentQ/LastFullQ/quarterMetaFromPeriods/varianceTier)",
        "processing": "The variance brain: end-of-Q projected_variance = projected_end − cum_invoiced; tiers (new/on_track/within_limit/ahead/behind); lifetime delivered/invoiced/sow/%; published_live join; D1 twin columns.",
        "eh": "Overview → Pod Snapshot Current Q cells, D1 client cards, tiers via v_editorial_fct_client_q_snapshot + _pod_snapshot",
        "ph": "",
    },
    "editorial_int_goals_month_ct": {
        "origin": "editorial_raw_goals",
        "pipeline_step": "build.py build_int_goals() → pyrules.goals_month_ct_rows()",
        "processing": "Client × month × content_type: cb/ad goal+delivered = MAX over weekly rows; ratio = contentTypeRatio (article×1, jumbo×2, LP×0.5); weighted w_* = value×ratio.",
        "eh": "Overview Pod Snapshot Goals + Monthly Goals gauges/table via v_editorial_fct_goals_monthly / _goals_client_totals",
        "ph": "",
    },
    "editorial_int_member_months": {
        "origin": "editorial_raw_capacity_members + editorial_raw_client_pod_history + editorial_raw_production + editorial_raw_articles",
        "pipeline_step": "build.py build_int_capacity_articles() → transform.build_member_utilization_mart() (shared capacity_calc.py)",
        "processing": "Per (year,month,pod,role,member): projected_used = capacity-share × pod projected; actual_used = article-share × pod actual (articles as distribution key); ×1.4 specialized; canonical name.",
        "eh": "GET /api/capacity/member-utilization(+matrix); Team KPIs → Capacity By Editor + Editors heat matrix",
        "ph": "getCapacityData() → member×pod×month capacity + utilization feeding the move/leave what-if math",
    },
    "editorial_int_pod_assignments": {
        "origin": "editorial_raw_pod_history",
        "pipeline_step": "build.py build_int_pod_assignments()",
        "processing": "Resolves (year,month,kind,pod,client,role,person): client via fuzzy resolver + windowed identity (Tempo); person via date-windowed editor aliases (Sam/Lauren); writer blobs split greedy longest-first + curated writer→email map.",
        "eh": "Backfill surface; v_editorial_fct_pod_assignments (editorial-only) feeds RBAC group auto-population",
        "ph": "",
    },
    # ── VIEWS ──────────────────────────────────────────────────────────────────
    "v_editorial_dim_calendar": {
        "origin": "editorial_raw_calendar",
        "pipeline_step": "views.py VIEWS entry (thin passthrough)",
        "processing": "Column projection only (year/month/week_number/start_date/end_date).",
        "eh": "Editorial week/month mapping + 'As of' badge across dashboards",
        "ph": "",
    },
    "v_editorial_dim_client": {
        "origin": "editorial_raw_clients",
        "pipeline_step": "views.py VIEWS entry (thin passthrough)",
        "processing": "Column projection/rename only (client_id, both pods, 6 milestone dates, SF identity).",
        "eh": "The client master read by every dashboard; FilterBar + dims; GET /api/clients/ path",
        "ph": "getActiveClients() → assignable-clients picker; getClientDirectory() → writer-capacity directory + sf_account_id bridge",
    },
    "v_editorial_dim_member": {
        "origin": "editorial_raw_team_members",
        "pipeline_step": "views.py VIEWS entry (thin passthrough)",
        "processing": "Column projection/rename only (member_id, name, role, pod, monthly_capacity, email).",
        "eh": "Team KPIs roster; GET /api/team-members/ (legacy seeded roster — v_editorial_roster preferred for live)",
        "ph": "",  # 2026-07-04: getRoster no longer joins it (email now from roster.work_email)
    },
    "v_editorial_fct_ai_flagged": {
        "origin": "editorial_raw_ai_monitoring",
        "pipeline_step": "views.py VIEWS entry",
        "processing": "Filters detail rows to is_flagged = TRUE OR is_rewrite = TRUE; no aggregation.",
        "eh": "Team KPIs → AI Compliance flags + rewrites detail (GET /api/ai-monitoring/flags,rewrites)",
        "ph": "",
    },
    "v_editorial_fct_ai_recommendations": {
        "origin": "editorial_raw_ai_monitoring",
        "pipeline_step": "views.py VIEWS entry",
        "processing": "Counts recommendations (full/partial/review) at pod×client×writer×editor×month, rewrites EXCLUDED; adds parsed month_date for chronological order.",
        "eh": "Team KPIs → AI Compliance rollups (every tab rollup is a SUM over this)",
        "ph": "",
    },
    "v_editorial_fct_article_revisions": {
        "origin": "editorial_int_articles_revisions",
        "pipeline_step": "views.py VIEWS entry (thin passthrough)",
        "processing": "Passthrough; revision-own-month basis already applied upstream.",
        "eh": "Team KPIs → Monthly Articles 'Revisions' metric; GET /api/articles/monthly",
        "ph": "",
    },
    "v_editorial_fct_articles_monthly": {
        "origin": "editorial_int_articles_creation",
        "pipeline_step": "views.py VIEWS entry (thin passthrough)",
        "processing": "Passthrough; creation editorial-month basis, editor-credit grain, both pod axes applied upstream.",
        "eh": "Team KPIs → Monthly Articles chart+matrix; GET /api/articles/monthly",
        "ph": "",
    },
    "v_editorial_fct_capacity_pods": {
        "origin": "editorial_int_capacity_pod_months",
        "pipeline_step": "views.py VIEWS entry (thin passthrough)",
        "processing": "Passthrough; latest-V## collapse applied upstream.",
        "eh": "Team KPIs → Capacity At-a-glance / By Pod / Trend(Pods); GET /api/capacity/pod-summary",
        "ph": "",
    },
    "v_editorial_fct_client_contributions": {
        "origin": "editorial_int_client_pod_months",
        "pipeline_step": "views.py VIEWS entry (thin passthrough)",
        "processing": "Passthrough; ×1.4 specialized weighting applied upstream.",
        "eh": "Team KPIs → Capacity By Client (per-pod Clients drawer); GET /api/capacity/client-contributions",
        "ph": "",
    },
    "v_editorial_fct_client_months": {
        "origin": "editorial_int_client_months",
        "pipeline_step": "views.py VIEWS entry (thin passthrough)",
        "processing": "Passthrough; is_future + dual billing-period assignment applied upstream.",
        "eh": "Overview / Editorial Clients monthly breakdown popovers + lifetime bars",
        "ph": "",
    },
    "v_editorial_fct_client_q_snapshot": {
        "origin": "editorial_int_client_q_snapshot",
        "pipeline_step": "views.py VIEWS entry (thin passthrough)",
        "processing": "Passthrough; end-of-Q variance + tiers + lifetime computed upstream.",
        "eh": "Overview → Pod Snapshot Current Q cells, D1 client cards, End-of-Q chips + tiers",
        "ph": "",
    },
    "v_editorial_fct_goals_client_totals": {
        "origin": "editorial_int_goals_month_ct",
        "pipeline_step": "views.py VIEWS entry",
        "processing": "Step-3 goals aggregation in SQL: per client, month totals gated on that month's weighted goal > 0 (CB and AD independently), then summed — matches aggregateGoalsSummary.",
        "eh": "Overview → Pod Snapshot / GoalsVsDelivery goal-gated client %-complete totals",
        "ph": "",
    },
    "v_editorial_fct_goals_monthly": {
        "origin": "editorial_int_goals_month_ct",
        "pipeline_step": "views.py VIEWS entry (thin passthrough)",
        "processing": "Passthrough; max-of-week + contentTypeRatio weighting applied — exposes both raw and weighted measures.",
        "eh": "Overview Pod Snapshot Goals; Monthly Goals gauges + GoalsMonthTable",
        "ph": "",
    },
    "v_editorial_fct_kpi_scores": {
        "origin": "editorial_raw_kpi_scores + editorial_raw_team_members",
        "pipeline_step": "views.py VIEWS entry (LEFT JOIN member name/role/pod)",
        "processing": "Joins member name/role/pod onto the KPI rows; no recompute (raw grain is final).",
        "eh": "Team KPIs → KPI heatmap + KpiCards",
        "ph": "",
    },
    "v_editorial_fct_member_utilization": {
        "origin": "editorial_int_member_months",
        "pipeline_step": "views.py VIEWS entry (thin passthrough)",
        "processing": "Passthrough; allocation/distribution utilization model + ×1.4 weighting + canonical names applied upstream.",
        "eh": "Team KPIs → Capacity By Editor + Editors heat matrix; GET /api/capacity/member-utilization(+matrix)",
        "ph": "",
    },
    "v_editorial_fct_milestone_transitions": {
        "origin": "editorial_raw_clients",
        "pipeline_step": "views.py VIEWS entry",
        "processing": "Computes the 8 audited milestone transitions as calendar-day DATE_DIFFs via UNNEST; negatives included (stats card filters days≥0 at read time).",
        "eh": "Overview → Time to Milestones cards, Pod Timelines, Per-Client Days chart",
        "ph": "",
    },
    "v_editorial_fct_pipeline": {
        "origin": "editorial_raw_cumulative + editorial_raw_clients",
        "pipeline_step": "views.py VIEWS entry (LEFT JOIN on client name)",
        "processing": "Joins client dims; audited stage fields (Topics/CBs = approved, Articles = sent, Published = published_live); keeps articles_approved for approval-rate.",
        "eh": "Editorial Clients / Overview → Cumulative Pipeline header + cards",
        "ph": "",
    },
    "v_editorial_fct_pod_assignments": {
        "origin": "editorial_int_pod_assignments",
        "pipeline_step": "views.py VIEWS entry",
        "processing": "Filters editorial_int_pod_assignments to pod_kind='editorial' (writer rows kept, distinguishable via role; filter confidence='unparsed' for fully-identified only).",
        "eh": "Editorial-only staffing / RBAC group feed",
        "ph": "",  # 2026-07-04: getRoster no longer joins it (workerId = canonical_name)
    },
    "v_editorial_fct_pod_snapshot": {
        "origin": "editorial_int_client_q_snapshot (rolled up onto both pod axes)",
        "pipeline_step": "views.py VIEWS entry (CROSS JOIN UNNEST both pod axes + GROUP BY)",
        "processing": "Pod rollups on editorial+growth axes: delivered/invoiced/projected_end sums INCLUDE 1st-Q clients; variance sum EXCLUDES them (counted in new_count); no-current-Q or invoiced≤0 dropped from Q sums.",
        "eh": "Overview → Pod Snapshot pod rows (Goals / Last Q / Current Q / %SOW / %Published)",
        "ph": "",
    },
    "v_editorial_fct_production_monthly": {
        "origin": "editorial_raw_production + editorial_raw_clients",
        "pipeline_step": "views.py VIEWS entry (LEFT JOIN client name + both pods)",
        "processing": "Joins client name + pods onto production rows (actual/projected/projected_original/projected_comment/is_actual); no math.",
        "eh": "Overview → Production History chart (All / Per pod / Per client); GET /api/dashboard/production-trend",
        "ph": "getClientGoals() → writer 'Goals per month'; getClientLastActiveMonth() → firstYm/lastYm; projected_comment → per-(client,month) planning note for the client table",
    },
    "v_editorial_roster": {
        "origin": "Rippling v_headcount (title LIKE '%editor%') + Slack slack_raw_users (ext.writing email) + editorial_name_map, minus editorial_roster_exclusions",
        "pipeline_step": "etl/warehouse/v_editorial_roster.sql (standalone CREATE VIEW; refreshed on the @name-mappings SYNC step)",
        "processing": "Unions Rippling editors (Sr/Lead/Director/VP→sr_editor) + Slack writers + legacy name-map canonicals; canonicalizes via editorial_name_map; subtracts role-aware exclusions; carries source IDs + work_email; always-live.",
        "eh": "Single source of truth → master Roster tab → MAC editor/writer dropdowns (Apps Script roster_refresh)",
        "ph": "getRoster() → roster picker (add SE/Editor/Writer) + writers-capacity rail; SoT for canonical_name/role/is_active/slack_id/work_email",
    },
    # ── HUB-PUBLISHED (origin = planning-hub app; this ETL does NOT write these) ─
    # Contract: editorial-team-pods/docs/capacity-plan-contract.md. `ph` is for
    # READS of these tables (the planning-hub WRITES them — that's the origin);
    # its read layer doesn't read them back, so ph stays "" (drift check clean).
    "editorial_capacity_plan": {
        "origin": "editorial-team-pods app (capacity board) → src/lib/sync-to-bq.ts publish",
        "pipeline_step": "planning-hub publish (NOT this ETL)",
        "processing": "Pod-month rollup of the Hub's capacity model: supply, projected/actual demand, utilization — composed WITH the demand-edit overlay.",
        "eh": "none today (reviewed 2026-07-04 — no Editorial-Hub reader; candidate INT input at the Q3/Q4 cutover)",
        "ph": "",
    },
    "editorial_capacity_plan_demand": {
        "origin": "editorial-team-pods app (client table edits: articles, pod moves, ×1.4 category, note, status_override) → sync-to-bq.ts",
        "pipeline_step": "planning-hub publish (NOT this ETL)",
        "processing": "Per-client demand incl. Hub edits. NEGATIVE client_id = planned/unsigned clients (no dim_client match by construction) — joins drop them, SUMs include them (intended).",
        "eh": "none today (reviewed 2026-07-04); designated Hub-first source for client→pod attribution + future projected articles at the Q3/Q4 cutover",
        "ph": "",
    },
    "editorial_capacity_plan_members": {
        "origin": "editorial-team-pods app (member capacity edits) → sync-to-bq.ts",
        "pipeline_step": "planning-hub publish (NOT this ETL)",
        "processing": "Per-member capacity (base + effective) behind the Hub's supply numbers.",
        "eh": "none today (reviewed 2026-07-04)",
        "ph": "",
    },
    "editorial_writer_plan": {
        "origin": "editorial-team-pods app (Writers tab) → sync-to-bq.ts",
        "pipeline_step": "planning-hub publish (NOT this ETL)",
        "processing": "Writer bandwidth plan: computed/override/effective bw, allocated vs delivered, roster membership.",
        "eh": "none today (reviewed 2026-07-04)",
        "ph": "",
    },
    "editorial_writer_plan_allocations": {
        "origin": "editorial-team-pods app (Writers tab allocations) → sync-to-bq.ts",
        "pipeline_step": "planning-hub publish (NOT this ETL)",
        "processing": "Writer→client article allocations; goals composed WITH the demand overlay, so they intentionally diverge from editorial_raw_production.articles_projected where DaniQ edited in the Hub.",
        "eh": "none today (reviewed 2026-07-04)",
        "ph": "",
    },
    "editorial_writer_plan_client_verticals": {
        "origin": "editorial-team-pods app (client vertical tags) → sync-to-bq.ts",
        "pipeline_step": "planning-hub publish (NOT this ETL)",
        "processing": "Client vertical tags for writer↔client matching.",
        "eh": "none today (reviewed 2026-07-04)",
        "ph": "",
    },
    "editorial_writer_plan_verticals": {
        "origin": "editorial-team-pods app (writer skills) → sync-to-bq.ts",
        "pipeline_step": "planning-hub publish (NOT this ETL)",
        "processing": "Writer vertical skills + difficulty for allocation matching.",
        "eh": "none today (reviewed 2026-07-04)",
        "ph": "",
    },
    "team_pod_assignments": {
        "origin": "editorial-team-pods app (growth Team tab) → publish",
        "pipeline_step": "planning-hub publish (NOT this ETL)",
        "processing": "Growth Team-tab current assignments (growth pod import stays sheet/BQ-Salesforce-based on the EH side — not read from here).",
        "eh": "none today (reviewed 2026-07-04)",
        "ph": "",
    },
    "team_pod_assignments_editorial": {
        "origin": "editorial-team-pods app (editorial Team tab; capacity-initiated current-month pod moves fan out here too) → publish",
        "pipeline_step": "planning-hub publish (NOT this ETL)",
        "processing": "Editorial Team-tab current assignments (the _history table is the canonical per-month record).",
        "eh": "none directly (the ETL reads the _history table)",
        "ph": "",
    },
    "team_pod_assignments_editorial_history": {
        "origin": "editorial-team-pods app (editorial pod_accounts upsert — Team tab AND capacity-initiated moves) → publish",
        "pipeline_step": "planning-hub publish (NOT this ETL); soft-delete via deleted_at",
        "processing": "Canonical per-month editorial member↔pod↔client history. PEOPLE-loop cutover 2026-06-12: this table is Hub-first source of truth; sheet is fallback. Gate: python -m etl.warehouse.hub_parity.",
        "eh": "import_team_pods()/_import_editorial_pods_from_hub() → pod_assignments (RBAC); import_pod_history()/_import_editorial_history_from_hub() → pod_assignment_history → editorial_raw_pod_history",
        "ph": "",
    },
}

# Object-name pattern for the sibling drift scan.
_OBJ_RE = re.compile(r"\b((?:editorial_raw|editorial_int|v_editorial)_[a-z0-9_]+)\b")


def detect_planning_hub_objects() -> set[str] | None:
    """Best-effort: which editorial objects the Planning Hub actually references,
    scanned from its read layer. Returns None if the sibling checkout is absent
    (check skipped, never fails the run)."""
    found: set[str] = set()
    seen_any = False
    for path in PLANNING_HUB_READ_LAYER:
        if not path.exists():
            continue
        seen_any = True
        found |= set(_OBJ_RE.findall(path.read_text()))
    return found if seen_any else None


def _drift_warnings(catalog: list[dict]) -> list[str]:
    """Compare curated consumers.planning_hub against what the sibling actually
    reads, and surface any disagreement so the LINEAGE map gets updated."""
    detected = detect_planning_hub_objects()
    if detected is None:
        return [
            "planning-hub read layer not found — consumers.planning_hub drift check skipped"
        ]
    credited = {e["name"] for e in catalog if e["consumers"]["planning_hub"]}
    catalogued = {e["name"] for e in catalog}
    warns = []
    for name in sorted(detected & catalogued - credited):
        warns.append(
            f"DRIFT: planning-hub reads `{name}` but LINEAGE has no consumers.planning_hub — add it"
        )
    for name in sorted(credited - detected):
        warns.append(
            f"DRIFT: LINEAGE credits planning-hub for `{name}` but its read layer no longer references it"
        )
    for name in sorted(detected - catalogued):
        warns.append(
            f"DRIFT: planning-hub reads `{name}` which is not in the catalog surface"
        )
    return warns


def build_catalog(with_counts: bool = True, live: bool = True) -> list[dict]:
    """Merge live structural facts (introspect) with the curated LINEAGE map."""
    base = introspect(with_counts=with_counts) if live else seed_catalog()
    out = []
    for e in base:
        lin = LINEAGE.get(e["name"], {})
        out.append(
            {
                **e,
                "origin": lin.get("origin", ""),
                "pipeline_step": lin.get("pipeline_step", ""),
                "processing": lin.get("processing", ""),
                "consumers": {
                    "editorial_hub": lin.get("eh", ""),
                    "planning_hub": lin.get("ph", ""),
                },
            }
        )
    return out


# ──────────────────────────────────────────────────────────────────────────────
# Emit
# ──────────────────────────────────────────────────────────────────────────────
def _sorted(catalog: list[dict]) -> list[dict]:
    return sorted(catalog, key=lambda e: (FAMILY_ORDER.get(e["family"], 9), e["name"]))


def write_json(catalog: list[dict], generated_at: str, live: bool) -> None:
    payload = {
        "dataset": DS,
        "generated_at": generated_at,
        "kind": "lineage",
        "source": "live BigQuery INFORMATION_SCHEMA + curated LINEAGE map"
        if live
        else "SEED (BQ unreachable) + curated LINEAGE map",
        "counts": {
            "tables": sum(1 for e in catalog if e["type"] == "TABLE"),
            "views": sum(1 for e in catalog if e["type"] == "VIEW"),
            "with_planning_hub_consumer": sum(
                1 for e in catalog if e["consumers"]["planning_hub"]
            ),
        },
        "objects": _sorted(catalog),
    }
    OUT_JSON.write_text(json.dumps(payload, indent=2) + "\n")


def write_md(catalog: list[dict], generated_at: str, live: bool) -> None:
    tables = sum(1 for e in catalog if e["type"] == "TABLE")
    views = sum(1 for e in catalog if e["type"] == "VIEW")
    ph = sum(1 for e in catalog if e["consumers"]["planning_hub"])

    L: list[str] = []
    L.append(
        "# BQ lineage catalog — `graphite-data.graphite_bi_sandbox` (editorial warehouse)"
    )
    L.append("")
    L.append(
        "**Auto-generated** by `etl/gen_bq_lineage_catalog.py` — do not hand-edit. "
        "Structural facts (grain / columns / rows / freshness) are live from BigQuery; "
        "lineage (origin / pipeline / processing / consumers) is the curated `LINEAGE` map in that script. "
        "Re-run after any ETL surface change; edit `LINEAGE` when origin/processing/consumers move."
    )
    L.append("")
    L.append(f"- **Dataset:** `{DS}` (everything is `{DS}.<name>`)")
    L.append(f"- **Generated:** {generated_at}")
    src = (
        "live BigQuery `INFORMATION_SCHEMA` + curated lineage"
        if live
        else "⚠️ **SEED** — BQ unreachable; columns/counts omitted"
    )
    L.append(f"- **Source:** {src}")
    L.append(
        f"- **Inventory:** {tables} tables · {views} views · {ph} read by the Planning Hub"
    )
    L.append("")
    L.append(
        "> Each entry answers: *this number came from **that** source, via **these** steps, with **this** math, "
        "and is read **here**.* `editorial_raw_*` = faithful sheet mirrors · `editorial_int_*` = where the "
        "business math is computed · `v_editorial_*` = the public read contract (mostly thin passthroughs of int)."
    )
    L.append("")
    L.append(
        "**Companion:** `bq_schema_catalog.md` (columns/rows) · `WAREHOUSE_DESIGN.md` (design + bug register)."
    )
    L.append("")

    by_family: dict[str, list[dict]] = {}
    for e in _sorted(catalog):
        by_family.setdefault(e["family"], []).append(e)

    for fam in sorted(by_family, key=lambda f: FAMILY_ORDER.get(f, 9)):
        L.append(f"## {FAMILY_TITLE.get(fam, fam)}")
        L.append("")
        for e in by_family[fam]:
            rows = "—" if e["row_count"] is None else f"{e['row_count']:,} rows"
            fresh = ""
            if e["synced_at"]:
                fresh = (
                    " · fresh "
                    + e["synced_at"].replace("T", " ").split(".")[0]
                    + " UTC"
                )
            L.append(f"### `{e['name']}`")
            L.append(f"*{e['grain']} · {rows}{fresh}*")
            L.append("")
            if e["origin"]:
                L.append(f"- **Origin:** {e['origin']}")
            if e["pipeline_step"]:
                L.append(f"- **Pipeline:** {e['pipeline_step']}")
            if e["processing"]:
                L.append(f"- **Processing:** {e['processing']}")
            L.append(f"- **Editorial Hub:** {e['consumers']['editorial_hub'] or '—'}")
            L.append(f"- **Planning Hub:** {e['consumers']['planning_hub'] or '—'}")
            L.append(f"- **Columns:** {_key_columns(e['columns'])}")
            L.append("")

    OUT_MD.write_text("\n".join(L) + "\n")


def sync_to_planning_hub() -> list[str]:
    """Copy both artifacts into the sibling planning-hub docs/ folder."""
    import shutil

    if not PLANNING_HUB_DOCS.exists():
        print(
            f"  ! planning-hub docs dir not found: {PLANNING_HUB_DOCS} — skipping sync"
        )
        return []
    copied = []
    for src in (OUT_JSON, OUT_MD):
        dst = PLANNING_HUB_DOCS / src.name
        shutil.copyfile(src, dst)
        copied.append(str(dst))
    return copied


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Generate the BQ lineage catalog for the planning-hub."
    )
    ap.add_argument(
        "--no-sync",
        action="store_true",
        help="don't copy artifacts into the planning-hub docs/ folder",
    )
    ap.add_argument(
        "--no-counts", action="store_true", help="skip per-table row counts / freshness"
    )
    args = ap.parse_args()

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    live = True
    try:
        catalog = build_catalog(with_counts=not args.no_counts, live=True)
        if not catalog:
            raise RuntimeError("no editorial objects returned")
    except Exception as exc:  # noqa: BLE001 — fall back to the seed catalog
        print(f"⚠️  Live BQ introspection failed ({type(exc).__name__}: {exc}).")
        print(
            "    Emitting SEED lineage catalog (curated lineage only, no live columns/counts)."
        )
        catalog = build_catalog(with_counts=False, live=False)
        live = False

    # Coverage: any catalogued object missing curated lineage (added but undocumented)?
    missing = [e["name"] for e in catalog if not e["origin"]]

    write_json(catalog, generated_at, live)
    write_md(catalog, generated_at, live)

    copied = [] if args.no_sync else sync_to_planning_hub()

    tables = sum(1 for e in catalog if e["type"] == "TABLE")
    views = sum(1 for e in catalog if e["type"] == "VIEW")
    ph = sum(1 for e in catalog if e["consumers"]["planning_hub"])
    print("─" * 60)
    print(f"BQ lineage catalog {'(LIVE)' if live else '(SEED — BQ unreachable)'}")
    print(f"  {tables} tables · {views} views · {ph} read by the Planning Hub")
    print(f"  → {OUT_JSON.relative_to(REPO_ROOT)}")
    print(f"  → {OUT_MD.relative_to(REPO_ROOT)}")
    for c in copied:
        print(f"  → synced: {c}")
    if not copied and not args.no_sync:
        print("  (planning-hub sync skipped)")
    if missing:
        print(
            f"  ! {len(missing)} object(s) missing curated lineage — add to LINEAGE: {', '.join(missing)}"
        )
    for w in _drift_warnings(catalog):
        print(f"  ! {w}")


if __name__ == "__main__":
    main()
