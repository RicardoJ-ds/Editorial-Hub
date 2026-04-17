# Editorial Hub — Task Tracker

## Completed
- [x] Phase 0: Project scaffolding (Next.js + FastAPI + PostgreSQL + Docker Compose)
- [x] Phase 1: Seed database from CSVs (77 clients, 394 deliverables, 12 team, 65 capacity, 528 KPIs)
- [x] Phase 1: Data Management CRUD UI (Clients, Deliverables, Capacity, KPI Entry)
- [x] Phase 2: Dashboard 1 — Editorial Clients (Contract & Timeline + Deliverables vs SOW)
- [x] Phase 3: Dashboard 2 — Team KPIs (KPI Performance + Capacity Projections)
- [x] Phase 4: BigQuery sync service + Home page + Admin endpoints
- [x] UI/UX Overhaul — Graphite DS, logo, dark theme, redesigned sidebar/header
- [x] Enhanced dashboards — Charts (donut, area, bar, heatmap), sparklines, pacing badges
- [x] Google Sheets Import Wizard — 5-step wizard pulling from Sheets API (8 sheets)
- [x] Missing sheets integration — Operating Model, Delivery Schedules, Engagement Requirements, Meta Deliveries
- [x] PRD gap fixes — All P0 items (missing columns, capacity metrics, tooltips, filters, per-client KPIs)
- [x] PRD compliance tracker created and maintained
- [x] CLAUDE.md with project links and architecture
- [x] Handoff documentation
- [x] Apr 17 — Editorial Clients / Contract & Timeline facelift:
  - Removed SOW Overview cards (Active / Articles SOW / Delivered)
  - Added per-client monthly-goal gauges + cumulative-pipeline bars (grouped alphabetically, FilterBar-aware) via `ContractClientProgress`
  - Added MoM trend chart to Time-to Metrics with a 8-option metric selector and overall-average reference line

## Pending — P1

### Notion Database import failure (Apr 16) — ✅ shipped in `612c854`
- [x] Paginate Sheets API read for "Notion" tab (5K-row chunks)
- [x] Bulk `INSERT ... ON CONFLICT DO UPDATE` for upsert
- [ ] Deploy to Railway and verify rows_imported > 20,000

### CP v2 — maintenance UX overhaul (Apr 16, planning)
Goal: everything a maintainer needs to keep monthly + weekly data current, with minimum clicks and maximum clarity. Each phase is independently shippable.

**Phase 1 — Unified month context & navigation (small, high leverage)**
- [ ] Lift month selection into the store; persist in localStorage + URL (`?m=2026-04`)
- [ ] Shared `MonthPicker` component in the SubNav header (Feb-Jun chips + "next month" / "prev month" arrows)
- [ ] Breadcrumb shows current month in all CP v2 pages
- [ ] Extend month range to ±6 months relative to "today" (computed, not hardcoded)
- [ ] "Go to current month" button

**Phase 2 — Copy-forward + validation (monthly close workflow)**
- [ ] "Copy from previous month" button on Roster, Allocation, Leave (carry memberships, allocations, leave patterns)
- [ ] "Copy to next 1/3/6 months" bulk propagate
- [ ] Inline validation banners per page:
  - Pod over-capacity (projected > effective) — red
  - Member share total > 1.0 across pods — red
  - Client unallocated for the month — yellow
  - Leave > 0.5 without a backup on the pod — yellow
- [ ] "Close month" action: snapshot the current month into an immutable snapshot record; subsequent edits require an override rather than overwriting history

**Phase 3 — Leave + Override dedicated editors**
- [ ] `/capacity-planning/leave` — team-wide PTO grid (members × months). Click a cell to set leave_share + reason.
- [ ] `/capacity-planning/overrides` — list all capacity overrides for the current month, with reason + author. New-override modal with "delta preview" (shows before/after effective capacity).
- [ ] Overrides on Overview page: inline-create without leaving the row.

**Phase 4 — Weekly actuals grid**
- [ ] `/capacity-planning/weekly` — grid of client × week for the selected month. Editable cells: `delivered_articles`, `goal_articles`. Auto-row-total and auto-pod-total.
- [ ] "Import actuals from Goals vs Delivery sheet" button (reuses existing backend pipeline but writes to `cp2_fact_actuals_weekly` instead).
- [ ] Sparkline per client showing 8-week trend inline.
- [ ] Variance highlighting (delivered < goal by >1 = red, ≥ goal = green).

**Phase 5 — Admin / dim CRUD screens**
- [ ] `/capacity-planning/admin/members` — team roster CRUD (join/leave dates, default capacity, role).
- [ ] `/capacity-planning/admin/pods` — pod lifecycle (active_from, active_to, display name).
- [ ] `/capacity-planning/admin/clients` — cp2 client extensions (cadence, SOW total, engagement tier).
- [ ] `/capacity-planning/admin/engagement-tiers` — tier list CRUD.
- [ ] `/capacity-planning/admin/kpi-metrics` — targets + formulas (edit rarely; audit-logged).

**Phase 6 — Migration path (read-only validator, not destructive)**
- [ ] `/capacity-planning/migration` — side-by-side view of existing tables vs proposed `cp2_*`. Shows row-count diffs and flags mismatches.
- [ ] One-click dry-run populate from existing tables into `cp2_*` (backend endpoint, writes to a scratch schema).
- [ ] Approval gate: "Promote to production schema" only after validator is all-green.

**Phase 7 — Polish + review tooling**
- [ ] Diff view: "what changed between this month and last month" (additions, removals, share deltas).
- [ ] Search / filter bar across all CP v2 pages (by member name, pod, client, role).
- [ ] Quarterly roll-up dashboard at `/capacity-planning?view=quarter`.
- [ ] Keyboard shortcuts: `j/k` to navigate months, `e` to edit the focused row, `/` to search.

**Out of scope for this overhaul (split into separate Linear tickets if needed):**
- Real database migrations and ingestion ETL — that's the phase-2 work in `CAPACITY_PLANNING_V2.md`
- Dashboard rewiring to read from `cp2_*` — only after migration lands
- External feedback form for External Quality scoring

- [ ] Init git repo + push to GitHub (exclude sa-key.json, .env)
- [ ] Deploy to AWS using existing template
- [ ] Date range picker for Dashboard 1
- [ ] Wire Capacity Utilization KPI card to real capacity data
- [ ] Make SOW links clickable (add URL field or mapping)


## Pending — P2 (External Dependencies)
- [ ] Identify and integrate Master Tracker sheet
- [ ] Import Writer AI Monitoring 2.0 sheet (AI Compliance real data)
- [ ] Notion API integration (Revision Rate, Turnaround, Second Reviews)
- [ ] Build client feedback form (External Quality)
- [ ] Build SE mentorship form (Mentorship)
- [ ] Auth system with role-based permissions
- [ ] Quarter-based date selection
- [ ] Dynamic forecast month detection
