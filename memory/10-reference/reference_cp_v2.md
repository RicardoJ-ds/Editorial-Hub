---
name: reference-cp-v2
description: "Capacity Planning v2 prototype: Phases 1-8 shipped but ALL localStorage + mock (zero cp2_* tables exist); the dim-fact target model that collapses 5+ legacy tables; the 0.4.x → 1.0 DB-migration go-live sequence."
metadata:
  node_type: memory
  type: reference
  originSessionId: 3fa962ac-9be0-4852-8c63-16ff918094cb
---

# Capacity Planning v2 (prototype)

The next phase (`0.4.x` = CP v2 → DB migration; `1.0` = CP v2 wired to DB + RBAC sign-off).
Spec: `CAPACITY_PLANNING_V2.md`; coverage proof: `CP2_COVERAGE_AUDIT.md`; authoritative ERD:
`frontend/src/app/(app)/capacity-planning/_erd.ts`. Sidebar label = **"Capacity Maintenance"**.

## Status (the key fact)
**Phases 1-8 shipped to production, ENTIRELY `localStorage` + mock data. ZERO `cp2_*` tables exist** in `backend/app/models.py`. No Alembic migration, no ETL, no `/api/cp2/*` routers, no dashboard rewiring (Editorial Clients + Team KPIs still read legacy `clients`/`deliverables_monthly`/`goals_vs_delivery`/`cumulative_metrics`).

## Why it exists
Today's dashboards read 5+ legacy tables fed by 3 spreadsheets with **overlapping/duplicated metrics** (e.g. `articles_delivered` lives in BOTH `clients` cumulative AND `deliverables_monthly`). The `cp2_*` ERD collapses these into a **single dim-fact model** to kill sheet duplication.

## Target dim-fact model (design principles)
"Plan monthly, measure weekly." Dims (rarely edited) + facts (per-month, often edited); **all totals are SQL views, never stored**; "manual always wins" (every computed value overridable with reason+author); "month rows copy forward" (maintainer edits deltas only).
- **Dims:** `cp2_dim_{team_member, pod, client (13→36 fields), engagement_tier, month, week, delivery_template, engagement_rule, model_assumption}`.
- **Facts:** `cp2_fact_{pod_membership, client_allocation, member_leave, capacity_override, actuals_weekly (21 CB+AD cols), kpi_score, delivery_monthly, production_history, pipeline_snapshot, ai_scan, surfer_api_usage, article}`.
- **Views:** `cp2_v_{member_effective_capacity, pod_monthly, pod_monthly_actuals}`.
- Coverage: `CP2_COVERAGE_AUDIT.md` (2026-04-18) proves all **18 dashboard sections** of D1+D2 are covered.

## What's LIVE (localStorage-backed UI)
Overview Board (+ override modal), Roster, Allocation (kanban), Leave, Overrides, Weekly Actuals, Quarter rollup, Gantt, Migration Validator (dry-run), Global Search (⌘K), Month Diff, Schema (React-Flow ERD + click-highlight), Tables (browse every `cp2_*` with mock rows), Glossary (KPI→ERD column map), read-only Pipeline/Delivery/Articles/KPI/AI/Surfer pages, Admin dim CRUD for 5 dim tables.

## 0.4.x → 1.0 go-live sequence (post-approval)
1. Alembic migration for all dims/facts/views → 2. one-time ETL backfill from ~11 legacy tables → 3. CP2 routers + rewire `_store.tsx` off `localStorage` → 4. parallel run (A/B vs legacy, one sprint) → 5. per-dashboard cutover (sequence in `dashboard-data-flow.md`) → 6. decommission sheet seeds (deliverables/capacity/kpi first; cumulative + goals last).
The UI store already models the `cp2_*` shape, so steps 3-4 are mostly swapping `localStorage.getItem()` for `apiGet()`.

## Open threads
- **The dominant gap to 1.0** — nothing is DB-backed; the whole 0.4.x phase is unstarted.
- `cp2_dim_content_type` weighting is still code-side (`contentTypeRatio()`), not data-driven — flagged optional in the Apr-27 alignment audit. See [[metrics-goals-content-weighting]].
