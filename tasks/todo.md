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

## Pending — P1

### Notion Database import failure (Apr 16)
- [ ] Paginate Sheets API read for "Notion" tab (5K-row chunks instead of whole sheet at once)
- [ ] Replace per-row SELECT + UPDATE/INSERT with bulk `INSERT ... ON CONFLICT DO UPDATE` (PostgreSQL)
- [ ] Commit / deploy to Railway; re-run import and verify rows_imported > 20,000

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
