# Editorial Hub — memory index

> Slim auto-loaded pointer (keep ≤200 lines). One line per entry; link deeper.
> Read order at session start: **this file → `NOW.md` → `index.md` → drill in.**
> Full convention: see the toolkit's `memory-system/README.md`.

## Start here
- [NOW.md](NOW.md) — where we are + the single next action.
- [index.md](index.md) — full catalog of everything in `memory/`.
- [log.md](log.md) — append-only journal (`grep '^## \[' log.md` for the timeline).

## 00 · Strategy (load first)
- [00-strategy/open_workstream_capacity_utilization.md](00-strategy/open_workstream_capacity_utilization.md) — live state + next steps of the per-editor capacity-utilization work.
- [00-strategy/project_normalization_scope.md](00-strategy/project_normalization_scope.md) — scope rule: capacity-model coverage (≥2025) must be clean; pre-2025 accepted.
- [00-strategy/plan_pod_history_and_dq_selfheal.md](00-strategy/plan_pod_history_and_dq_selfheal.md) — plan for the Data Quality self-heal UI + ET CP pod-history ingestion.

## 40 · Metrics & Calculations (canonical formulas — read for "how is this number computed?")
- [40-metrics/metrics_goals_content_weighting.md](40-metrics/metrics_goals_content_weighting.md) — goals roll-up + content-type weighting (×1/×2/×0.5), LP-doubling May'26, glossary Jun'26, %SOW/%Published, pacingColor.
- [40-metrics/metrics_end_of_q_variance_tiers.md](40-metrics/metrics_end_of_q_variance_tiers.md) — billing periods; **bar=actual, chip=projected**; the 5 variance tiers (±5).
- [40-metrics/metrics_capacity_utilization.md](40-metrics/metrics_capacity_utilization.md) — Real/Weighted/Spare, 3 pod rates, fallback-as-distribution, ×1.4 SPEC_WEIGHT, ramp-up, golden numbers.
- [40-metrics/metrics_monthly_articles.md](40-metrics/metrics_monthly_articles.md) — Articles/Revision-rate%/Revisions, num·den pooling, Notion published ref, pod attribution.
- [40-metrics/metrics_overview_ttm.md](40-metrics/metrics_overview_ttm.md) — Pod Delivery card, 6 milestones + 8 transitions, negative-day B5, Production History.
- [40-metrics/metrics_warehouse_int_layer.md](40-metrics/metrics_warehouse_int_layer.md) — serving map (`editorial_int_*`) + the **B1–B12 bug register** + parity proofs.

## 10 · Reference
- [10-reference/project_editorial_hub.md](10-reference/project_editorial_hub.md) — what the Hub is (BI dashboard replacing the Editorial Google Sheets).
- [10-reference/reference_warehouse_layered_model.md](10-reference/reference_warehouse_layered_model.md) — dual-sink layered warehouse (19 raw + 9 int + 20 views; Postgres + BigQuery) + BQ cache + 4 flags.
- [10-reference/reference_sync_architecture.md](10-reference/reference_sync_architecture.md) — Sync Manifest, current/past/full scopes, self-healing month rollover, daily cron.
- [10-reference/reference_data_sources.md](10-reference/reference_data_sources.md) — the 5 spreadsheets + Notion DB; ingest status; doc-drift flags.
- [10-reference/reference_data_quality_selfheal.md](10-reference/reference_data_quality_selfheal.md) — DQ tabs + self-heal mechanics (aliases/overrides) + `get_db()` commit gotcha.
- [10-reference/reference_cp_v2.md](10-reference/reference_cp_v2.md) — CP v2: localStorage prototype (zero `cp2_*` tables); dim-fact target; 0.4.x→1.0 plan.
- [10-reference/reference_neon_company_migration.md](10-reference/reference_neon_company_migration.md) — runbook (unexecuted) to move Postgres onto company Neon.
- [10-reference/reference_bq_serving_cutover.md](10-reference/reference_bq_serving_cutover.md) — **prod serves from BigQuery + cache** (since 2026-06-19); rollback + residual risk.
- [10-reference/project_monthly_article_count.md](10-reference/project_monthly_article_count.md) — Monthly Article Count ingestion + per-month pod + category.
- [10-reference/project_ai_impact_analysis.md](10-reference/project_ai_impact_analysis.md) — "Time Saving & Cost" deliverable for Ethan & Rafa.
- [10-reference/project_access_control_v1_spec.md](10-reference/project_access_control_v1_spec.md) — RBAC v0.5 spec (Team Pods, pod-aware filtering, comments).
- [10-reference/project_access_control_v1_original_prompt.md](10-reference/project_access_control_v1_original_prompt.md) — verbatim source prompt for the RBAC milestone.
- [10-reference/project_access_control_v1_delivery.md](10-reference/project_access_control_v1_delivery.md) — what shipped on 2026-05-08.
- [10-reference/reference_railway_backend.md](10-reference/reference_railway_backend.md) — Railway backend URL, prod DB, manual deploy command.
- [10-reference/reference_vercel_project.md](10-reference/reference_vercel_project.md) — Vercel team/project IDs, prod alias, CLI commands.
- [10-reference/reference_get_db_no_commit.md](10-reference/reference_get_db_no_commit.md) — `get_db()` never commits; mutations must `db.commit()`.
- [10-reference/reference_goals_rename_orphan.md](10-reference/reference_goals_rename_orphan.md) — renaming a client orphans goals rows (upsert-only) → double-count; delete + republish.
- [10-reference/reference_importer_bare_month_skip.md](10-reference/reference_importer_bare_month_skip.md) — Delivered-vs-Invoiced importer drops clients whose "Month 1" lacks a year.
- [10-reference/reference_team_pods_sheet.md](10-reference/reference_team_pods_sheet.md) — Team Pods sheet ID provenance.
- [10-reference/reference_gantt_chart.md](10-reference/reference_gantt_chart.md) — project Gantt is a living planning doc; how to edit via SA.
- [10-reference/reference_prd_tracker.md](10-reference/reference_prd_tracker.md) — PRD/compliance tracker pointer.

## 20 · Decisions
- [20-decisions/decision_2026-05-27_content_type_weighting.md](20-decisions/decision_2026-05-27_content_type_weighting.md) — content-type weighting two-stage; LP doubled at ingestion May'26; glossary B1.
- [20-decisions/decision_2026-06-09_capacity_util_model.md](20-decisions/decision_2026-06-09_capacity_util_model.md) — facts/dims joins-only, fallback-as-distribution, capacity_projections as cache.
- [20-decisions/decision_2026-06-09_etl_bq_migration.md](20-decisions/decision_2026-06-09_etl_bq_migration.md) — ETL → BigQuery migration decision.
- [20-decisions/decision_2026-06-11_dual_sink_warehouse.md](20-decisions/decision_2026-06-11_dual_sink_warehouse.md) — dual-sink (Postgres + BigQuery) over BQ-only, after a 4-agent audit.

## 30 · Analyses
- [30-analyses/analysis_capacity_utilization.md](30-analyses/analysis_capacity_utilization.md) — per-editor utilization model: formulas, origins, code, verification vs Ricardo's sheet.
- [30-analyses/analysis_article_count_data_quality.md](30-analyses/analysis_article_count_data_quality.md) — why article log < Operating Model (month-definition + ingestion losses).
- [30-analyses/analysis_normalization_proposal.md](30-analyses/analysis_normalization_proposal.md) — spreadsheet normalization for DaniQ: standardization, name dictionaries, OM↔MAC, 12 client decisions + D1–D8. **Top iteration area.**

## 50 · Sources (raw founding inputs — read-only; see [50-sources/README.md](50-sources/README.md))
- `50-sources/specs/` — founding PRDs + build prompt + CP v2 spec + coverage audit.
- `50-sources/seed-data/` — initial Mar-2026 CSV exports (⚠️ sensitive, gitignored).
- `50-sources/design-system/` — Graphite Internal DS reference.
- Detailed docs now in 10-reference: `sheet-inventory.md`, `dashboard-data-flow.md`, `sync-architecture.md`.

## 90 · Archive (point-in-time, superseded — gitignored)
- `90-archive/access-control-handoff.md` · `prd-compliance-audit.md` · `neon-company-migration.md`.

## Lives in the global memory (not here)
Working-style **feedback** (version-bump rule, tooltip style, Notion changelog format, no
ongoing Sheets sync, no Co-Authored-By, plan-first, separate folders, shadcn) stays in
`~/.claude/projects/.../memory/` — cross-project prefs, not project knowledge.
