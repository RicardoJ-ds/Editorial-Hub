# Catalog — Editorial Hub memory

Full content catalog. One line per file, grouped by folder. **Update on every ingest.**
Folder numbers = load priority (lower = read earlier). Mark obsolete files
`> ⚠️ STALE as of YYYY-MM-DD — <reason>` in place; move to `90-archive/` on the next lint.

> Migrated in-repo from the global memory folder on 2026-06-21. Frontmatter `type` values may
> still use the old `project`/`metadata.type` form — a `/memory lint` pass can normalize them
> to the bi-forge schema (`strategy|reference|decision|analysis|archive`). Folder = source of truth.

## When to put what where

| Situation | Action |
|---|---|
| New durable learning | Append to an existing topic file if aligned; else a new file in the right folder |
| A decision was made/changed | New `20-decisions/decision_YYYY-MM-DD_<name>.md`; mark the old one STALE + link forward |
| Ran an analysis / investigation | New file in `30-analyses/` |
| Strategy/framework evolved | Update `00-strategy/` in place; let `log.md` carry the history |
| Topic resolved (shipped / answered) | Mark STALE; move to `90-archive/` next lint pass |

## 00 · Strategy
- `open_workstream_capacity_utilization.md` — live state + next steps of the per-editor capacity-utilization workstream (was the global `now.md`).
- `project_normalization_scope.md` — scope rule: ≥2025 capacity-model coverage must be clean; pre-2025 accepted; open threads ("/" pairs, 26 tabs, Honey/Tempo).
- `plan_pod_history_and_dq_selfheal.md` — full plan: DQ self-heal UI, ET CP pod-history ingestion, incomplete-client tracking, null-pod fallback.

## 10 · Reference
- `project_editorial_hub.md` — Hub overview: BI dashboard for Graphite's Editorial Team replacing 3 Google Sheets.
- `reference_warehouse_layered_model.md` — the dual-sink layered warehouse (19 raw + 9 int + 20 views → Postgres `warehouse` + BigQuery in one ~20s pass) + the BQ serving cache + 4 flags.
- `reference_sync_architecture.md` — the Sync Manifest (declare an importer once with a scope → flows everywhere); current/past/full; self-healing month rollover; daily cron.
- `reference_data_sources.md` — the 5 source spreadsheets + Notion DB, ingest status + mechanics; doc-drift flags (`notion_import.py` doesn't exist; `ARTICLE_COUNT_ID` default mismatch).
- `reference_data_quality_selfheal.md` — `/admin/data-quality` current state: the tabs + the write→lookup→resolves-next-sync self-heal (ClientNameAlias / PodNameOverride / article aliases) + `get_db()`-must-commit gotcha.
- `reference_cp_v2.md` — Capacity Planning v2: Phases 1-8 shipped but ALL localStorage (zero `cp2_*` tables); the dim-fact target; the 0.4.x→1.0 migration sequence.
- `reference_neon_company_migration.md` — runbook (not yet executed) to move Postgres off personal Neon onto company Neon; pooled-vs-direct gotcha; one-var rollback.
- `reference_bq_serving_cutover.md` — prod dashboards serve from BigQuery + in-process cache (2026-06-19); cache_version token; rollback = `DASHBOARD_SOURCE=postgres`.
- `project_monthly_article_count.md` — Monthly Article Count ingestion, per-month pod attribution, category model.
- `project_ai_impact_analysis.md` — "Time Saving & Cost" deliverable for Ethan & Rafa; numbers, sources, Drive blocker.
- `project_access_control_v1_spec.md` — May 8 2026 RBAC v0.5 spec: Team Pods importer, pod-aware filtering, Overview comments.
- `project_access_control_v1_original_prompt.md` — verbatim user prompt + clarifications for the RBAC milestone (source-of-truth).
- `project_access_control_v1_delivery.md` — checklist of what shipped 2026-05-08 across all 5 buckets.
- `reference_railway_backend.md` — Railway backend URL, prod DB, manual deploy fallback command.
- `reference_vercel_project.md` — Vercel team/project IDs, prod alias, Root Directory, CLI commands.
- `reference_get_db_no_commit.md` — `get_db()` never commits; mutation endpoints must `db.commit()` (flush alone rolls back).
- `reference_goals_rename_orphan.md` — renaming a client in the Master Tracker orphans goals rows → double-count; delete + republish.
- `reference_importer_bare_month_skip.md` — Delivered-vs-Invoiced importer silently drops clients whose "Month 1" lacks a year; targeted prod sync notes.
- `reference_team_pods_sheet.md` — Team Pods sheet ID provenance (was a temp copy).
- `reference_gantt_chart.md` — project Gantt (Google Sheet) is a living planning doc; how to reach/edit via the SA.
- `reference_prd_tracker.md` — PRD / compliance tracker pointer.
- **Detailed source docs** (moved from the old `.docs/` on 2026-06-22; the wiki notes above summarize these):
  - `sheet-inventory.md` — cross-sheet inventory + ingestion status (detail behind `reference_data_sources.md`).
  - `dashboard-data-flow.md` — dashboard → source mapping + CP v2 cutover sequence.
  - `sync-architecture.md` — detailed sync runbook (detail behind `reference_sync_architecture.md`).

## 20 · Decisions
- `decision_2026-05-27_content_type_weighting.md` — content-type weighting is two-stage (ingest + display); LP doubled at ingestion May 2026; glossary doc'd but ratio not shipped (B1).
- `decision_2026-06-09_capacity_util_model.md` — facts/dims joins-only, fallback-as-distribution, capacity_projections as cache, off-by-one fix.
- `decision_2026-06-09_etl_bq_migration.md` — ETL → BigQuery migration decision.
- `decision_2026-06-11_dual_sink_warehouse.md` — publish to BOTH Postgres `warehouse` (app serves) + BigQuery (mirror) from one row set; chosen over BQ-only after a 4-agent audit.

## 30 · Analyses
- `analysis_capacity_utilization.md` — per-editor utilization model: exact formulas, data origins, code locations, verification vs Ricardo's sheet (predates 0.3.25 tab — see metrics file).
- `analysis_article_count_data_quality.md` — why the article log < Operating Model: month-definition (the big one) + ingestion losses + source gaps.
- `analysis_normalization_proposal.md` — spreadsheet normalization for DaniQ: additive standardization, the 4 name dictionaries, OM↔MAC reconciliation (92.2%/~98%), 12 client decisions + D1–D8, open threads. **Top iteration area.**

## 40 · Metrics & Calculations — the canonical definitions
> One file per domain — *what is this number, exactly?* Formula + `file:line` + origins + dated decisions + worked results + bugs. See `40-metrics/README.md`.
- `metrics_goals_content_weighting.md` — goals 3-step roll-up, content-type weighting (×1/×2/×0.5), LP-doubling/glossary cutovers, %SOW / %Published, `pacingColor`.
- `metrics_end_of_q_variance_tiers.md` — billing periods; Current-Q **bar=actual vs chip=projected**; the 5 variance tiers + ±5 thresholds; 1st-Q escape hatch.
- `metrics_capacity_utilization.md` — Real / Weighted / Spare, the 3 per-pod rates, fallback-as-distribution, ×1.4 SPEC_WEIGHT, ramp-up, Pod-1 golden numbers.
- `metrics_monthly_articles.md` — Articles / Revision-rate% / Revisions (creation-vs-own-month bucketing), num·den pooling, Notion published reference, pod attribution, editor resolution.
- `metrics_overview_ttm.md` — Pod Delivery card, the 6 milestones + 8 transitions (legend-only numbering), negative-day B5 handling, Production History.
- `metrics_warehouse_int_layer.md` — where each calc is re-computed for serving (the `editorial_int_*` map) + the **B1–B12 bug-for-bug register** + parity proofs.

## 50 · Sources — raw founding inputs (immutable)
> Read-only source material the wiki distills. See `50-sources/README.md`. Consolidated 2026-06-22 from the old `data/` + `.docs/` + repo root.
- `specs/` — founding PRDs + build prompt (`fetch_docs.py` output, gitignored) + `CAPACITY_PLANNING_V2.md` (CP v2 spec) + `CP2_COVERAGE_AUDIT.md` (coverage proof). Distilled → [[reference-cp-v2]].
- `seed-data/` — initial Mar-2026 CSV sheet exports (⚠️ sensitive client/revenue/SOW — **gitignored**). Historical snapshot; live data now flows sheets → warehouse.
- `design-system/` — `Graphite-Interal-DS.html` (Graphite Internal DS reference).

## 90 · Archive
> Point-in-time reports/plans, superseded or fully distilled into the wiki. Kept for traceability (gitignored).
- `access-control-handoff.md` — the May-2026 RBAC handoff doc (the work shipped; see the `project_access_control_v1_*` references).
- `prd-compliance-audit.md` — the Apr-2026 PRD compliance audit snapshot (~98%).
- `neon-company-migration.md` — the Neon migration runbook; living version distilled into [[reference-neon-company-migration]].
