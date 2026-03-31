# PRD Compliance Tracker — Editorial Hub

> **Last updated:** 2026-03-27 (v5 — full re-audit after Master Tracker + AI Monitoring integration)
> **PRD Source:** [PRD Input Template v3](https://docs.google.com/document/d/1tus6wvrQIrQf-ygXQxtogv6QOocv8PMsRN8xnNp6fJQ/edit?tab=t.0)
> **Overall Coverage:** ~92% of UI requirements (excluding auth + remaining TBD KPI data sources)
> **Sheet inventory:** See [sheet-inventory.md](sheet-inventory.md) for complete mapping of all 3 spreadsheets
> **Data source indicators:** All visualizations have live/simulated badges with hover tooltips explaining data origin

---

## Dashboard 1 — Editorial Client Data

### Tab 1: Contract & Timeline

| # | PRD Requirement | Status | Notes |
|---|----------------|--------|-------|
| 1 | Client name | DONE | |
| 2 | Growth Team Pod | DONE | Plain text column |
| 3 | Editorial Team Pod | DONE | Colored badge |
| 4 | Start date | DONE | MMM DD, YYYY format |
| 5 | End date | DONE | |
| 6 | Term (months) | DONE | "Xmo" format |
| 7 | Cadence | DONE | Mono text, hover tooltip for full cadence string |
| 8 | Number of articles SOW | DONE | |
| 9 | Word count | DONE | "min-max" range |
| 10 | SOW link(s) | DONE | Clickable badge linking to Google Docs SOW. Hyperlinks extracted from spreadsheet cells during import (fixed 2026-03-27) |
| 11 | Consulting KO date | DONE | |
| 12 | Editorial KO date | DONE | |
| 13 | First approved CB date | DONE | |
| 14 | First article delivered date | DONE | |
| 15 | First feedback from client | DONE | |
| 16 | First article published date | DONE | |

### Tab 2: Deliverables vs SOW

| # | PRD Requirement | Status | Notes |
|---|----------------|--------|-------|
| 1 | Articles delivered vs SOW | DONE | Progress bar + count |
| 2 | Articles invoiced vs SOW | DONE | |
| 3 | Balance (delivered - invoiced) | DONE | Color-coded green/red |
| 4 | Content briefs delivered vs SOW | DONE | CBs Delivered + CBs Goal columns added |
| 5 | Content briefs vs goals vs contract | DONE | Same columns |
| 6 | Time-to metrics (KO → each milestone) | DONE | Avg + min/max in summary cards + per-client KO→Article and CB→Article columns in table |
| 7 | Time from CB to first article | DONE | In TimeToMetrics + table column |

### Time-To Metrics — Full List

| Metric | Implemented | Formula | Display |
|--------|-------------|---------|---------|
| KO → First CB Approved | DONE | `editorial_ko_date → first_cb_approved_date` | Avg + Min/Max in summary card |
| KO → First Article Delivered | DONE | `editorial_ko_date → first_article_delivered_date` | Avg + Min/Max in summary card + per-client column |
| KO → First Feedback | DONE | `editorial_ko_date → first_feedback_date` | Avg + Min/Max in summary card |
| KO → First Published | DONE | `editorial_ko_date → first_article_published_date` | In backend endpoint, not in frontend summary cards |
| CB → First Article Delivered | DONE | `first_cb_approved_date → first_article_delivered_date` | Avg + Min/Max in summary card + per-client column |

### Dashboard 1 Filters

| # | PRD Requirement | Status | Notes |
|---|----------------|--------|-------|
| 1 | Search bar for clients | DONE | |
| 2 | Filter by Growth Team pod | DONE | |
| 3 | Filter by Editorial Team pod | DONE | |
| 4 | Filter by active/inactive | DONE | Chip toggle |
| 5 | Date pickers (month/quarter/year) | MISSING | No date range filter. Would filter deliverables by period |

### Dashboard 1 Key Questions

| Question (from PRD) | Answered? | How |
|---------------------|-----------|-----|
| Are we aligned on delivered vs invoiced for X client? | YES | Tab 2 Balance column (green/red) |
| How much of contracted articles completed for X client? | YES | Tab 2 % Complete + progress bar |
| Longest/shortest time to first article? | YES | TimeToMetrics shows avg + min/max |
| When did X client start/end? | YES | Tab 1 Start/End columns |

### Tab 3: Goals vs Delivery (NEW 2026-03-27)

| # | PRD Requirement | Status | Notes |
|---|----------------|--------|-------|
| 1 | Weekly CB delivery vs monthly goals | DONE | From Master Tracker "[Month] Goals vs Delivery" sheets |
| 2 | Weekly article delivery vs monthly goals | DONE | Same source, Articles columns |
| 3 | Monthly goal tracking | DONE | Month selector dropdown, 9 months available (Aug 2025 — Apr 2026) |
| 4 | CB backlog tracking | DONE | CB Backlog column in table |
| 5 | Revision count per client per week | DONE | Revisions column |
| 6 | Percent of goal achievement | DONE | Color-coded % columns (green ≥75%, yellow 50-74%, red <50%) |

### Tab 4: Cumulative Pipeline (NEW 2026-03-27)

| # | PRD Requirement | Status | Notes |
|---|----------------|--------|-------|
| 1 | All-time topics sent/approved | DONE | From Master Tracker "Cumulative" sheet |
| 2 | All-time CBs sent/approved | DONE | Per-client breakdown |
| 3 | All-time articles sent/approved | DONE | With difference column |
| 4 | Published articles tracking | DONE | Live count + % live |
| 5 | Pipeline summary stats | DONE | Total Clients, Topics, CBs, Articles, Approval Rate |

### Dashboard 1 — Extra Features (beyond PRD)
- Status Distribution donut chart (client status breakdown)
- Production History area chart (monthly output Oct 2022→present)
- Delivery Trend area chart (delivered vs invoiced over time)
- Pacing Badges (ahead/on track/behind/at risk per client)
- Engagement Health scores (compliance against 10 Commandments)

---

## Dashboard 2 — Editorial Team KPIs

### Tab 1: KPI Performance — All KPI Types

| # | KPI Name | In App | PRD Data Source | Current Data | What's Needed for Real Data |
|---|----------|--------|----------------|-------------|---------------------------|
| 1 | **Internal Quality** | DONE | [TBD] Existing scoring framework | MOCK (target: 85) | Need to define scoring rubric. SEs score articles 0-100. Add to KPI Entry form |
| 2 | **External Quality** | DONE | [TBD] Once-a-month client poll/form/live call | MOCK (target: 85) | Build client feedback form (Google Form or in-app). No system exists yet |
| 3 | **Revision Rate** | DONE | [Notion] Personal tracking + "Client Revisions Needed" tasks | MOCK (target: ≤15%, lower is better) | Notion API integration to count revision tasks. Currently "not adequately tracked" per PRD |
| 4 | **Capacity Utilization** | DONE | [Google Sheets] Editorial CP Model 2026 | MOCK in KPI cards / REAL in Capacity tab | **Confusing**: KPI card shows mock score, Capacity tab shows real data from CP sheet. Should link KPI card to real utilization |
| 5 | **Second Reviews** (SE only) | DONE | [TBD] Could be Notion but not tracked | MOCK (target: ≥5) | Notion integration or manual tracking. Not tracked anywhere currently |
| 6 | **Turnaround Time** | DONE | [TBD] Could be Notion but not tracked exactly | MOCK (target: ≤14 days, lower is better) | Need task timestamp tracking. Calculate days from CB approval to article delivery per article |
| 7 | **AI Compliance** | DONE | [Google Sheets] Writer AI Percentage Monitoring 2.0 | **REAL DATA** from `ai_monitoring_records` (1,168 records). Full Pass rate: 85.4% | Integrated 2026-03-27. Dedicated "AI Compliance" tab on D2 with 4 stacked bar charts, flags/rewrites tables, Surfer API usage |
| 8 | **Mentorship** (SE only) | DONE | [TBD] Monthly form for SEs to fill for their Editors | MOCK (target: ≥80) | Build monthly SE→Editor feedback form. Nothing exists yet |
| 9 | **Feedback Adoption** (Editor only) | DONE | Not explicitly in PRD | MOCK (target: ≥80) | Define metric. Possibly track from editorial feedback loop |

**KPI Tooltip Status:** All 9 KPIs have info icon + hover tooltip explaining formula, scale, and target.

### Tab 1: Per-Client Metrics

| # | PRD Requirement | Status | Notes |
|---|----------------|--------|-------|
| 1 | Revision rate per client | DONE | Expandable "Per Client" accordion in KPI cards |
| 2 | Internal quality per client | DONE | Same — client_id FK on kpi_scores supports this |
| 3 | External quality per client | DONE | Same |

### Tab 2: Capacity Projections

| # | PRD Requirement | Status | How Calculated | Notes |
|---|----------------|--------|---------------|-------|
| 1 | Projected article output per pod/month | DONE | Column "Projected Articles" = `projected_used_capacity` from CP sheet | Real data from ET CP 2026 |
| 2 | Projected used capacity % per pod/month | DONE | `projected_used / total_capacity × 100` | Correct |
| 3 | Available vs projected used capacity | DONE | "Available" column = `total_capacity - projected_used` | Red if negative |
| 4 | Variance (demand vs available) | DONE | "Variance" column = `projected_used - total_capacity` | Red when over capacity |
| 5 | Visual indicators (over/at/under) | DONE | Badges: Optimal 80-85%, Warning 85-100%, Under <80%, Over >100% | Per model assumptions |

**Summary cards:** Overall Avg Utilization, Pods At Optimal, Pods Over Capacity, Total Available Bandwidth

### Dashboard 2 Filters

| # | PRD Requirement | Status | Notes |
|---|----------------|--------|-------|
| 1 | Filter by team member | DONE | Member dropdown |
| 2 | Filter by Editorial Team pod | DONE | |
| 3 | Filter by client | DONE | Client dropdown filtering KPI scores |
| 4 | Month picker | DONE | |
| 5 | Year picker | DONE | |
| 6 | Quarter picker | MISSING | Only month/year available |
| 7 | Search bar | DONE | Filters by member name |

### Dashboard 2 Key Questions

| Question (from PRD) | Answered? | How |
|---------------------|-----------|-----|
| Internal quality for X Client or Pod X? | YES | Per-member cards + per-client accordion + client filter |
| External quality for X Client or Pod X? | YES | Same |
| Turnaround time for Client X or Pod X? | YES | Same |
| Revision rate for X Client? | YES | Per-client breakdown in cards + client filter |
| Revision rate in Pod X? | YES | Pod avg in header + per-member view |
| Capacity for team/Pod X last month? | YES | Capacity tab with real data |
| Projected capacity for Pod X next month? | YES | Forward months in capacity table |
| Which pods over/under capacity? | YES | Status badges + summary cards |
| Where do we have available bandwidth? | YES | "Available" column + "Total Available Bandwidth" card |
| AI compliance for X Client or Pod X? | YES | Per-member + per-client accordion |
| How many second reviews did X SE do? | YES | In SE KPI cards |

### Tab 3: AI Compliance (NEW 2026-03-27)

| # | PRD Requirement | Status | Notes |
|---|----------------|--------|-------|
| 1 | AI compliance per pod | DONE | Stacked bar chart: FULL PASS / PARTIAL PASS / REVIEW/REWRITE |
| 2 | AI compliance per client | DONE | Stacked bar chart (top 20 clients) |
| 3 | AI compliance per writer | DONE | Stacked bar chart (top 20 writers) |
| 4 | AI compliance trend by month | DONE | Stacked bar chart (Oct 2025 — Mar 2026) |
| 5 | Flagged articles visibility | DONE | Yellow/Red Flags table with filtering |
| 6 | Rewrites tracking | DONE | Rewrites table |
| 7 | Surfer API usage monitoring | DONE | Usage table with pod-level breakdown |
| 8 | Overall compliance summary | DONE | Summary cards: Total scanned, Full Pass rate, Partial Pass, Review/Rewrite, API calls |

### Dashboard 2 — Extra Features (beyond PRD)
- KPI Heatmap overview (12 members × 9 KPIs, color-coded, clickable)
- Pod-level avg utilization and quality stats
- Capacity bar chart with 85% optimal reference line
- Per-client expandable KPI breakdown in cards
- AI Compliance dedicated tab with 4 stacked bar charts matching the original dashboard design

---

## Data Sources

| # | PRD Source | Status | Sheet/System | Notes |
|---|-----------|--------|-------------|-------|
| 1 | Editorial SOW overview | DONE | Google Sheet → `clients` table | Imported via migration |
| 2 | Delivered vs Invoiced | DONE | Google Sheet → `deliverables_monthly` | Imported via migration |
| 3 | Editorial Operating Model | DONE | Google Sheet → `production_history` | 3,816 records Oct 2022→Feb 2027 |
| 4 | ET CP 2026 [V11 Mar 2026] | DONE | Google Sheet → `team_members` + `capacity_projections` | Real capacity data |
| 5 | Model Assumptions | DONE | Google Sheet → `model_assumptions` | 14 operating parameters |
| 6 | Delivery Schedules | DONE | Google Sheet → `delivery_templates` | 60 template entries |
| 7 | Engagement Requirements | DONE | Google Sheet → `engagement_rules` | 10 Commandments |
| 8 | Meta Calendar Deliveries | DONE | Google Sheet → `deliverables_monthly` | 36 Meta records |
| 9 | **Master Tracker** | DONE | Google Sheet `1dtZIiTKPEkhc0qrlWdlvd-n8qAn5-lhVcPkgHNgoLAY` → `cumulative_metrics` + `goals_vs_delivery` | Integrated 2026-03-27. Cumulative (42 clients) + Goals vs Delivery (389 rows, 9 months). Feeds D1 Tab 3 + Tab 4 |
| 10 | **Writer AI Monitoring 2.0** | DONE | Google Sheet `13kl0_6YuzsJ3xEzNLzDZeR-sHMaNJNw6oJGmwb-CBOU` → `ai_monitoring_records` + `surfer_api_usage` | Integrated 2026-03-27. 1,168 AI scan records + 25 Surfer API usage rows + 169 flags + 11 rewrites. Feeds D2 AI Compliance tab |
| 11 | **Notion** (multiple sources) | NOT CONNECTED | Revision Rate, Turnaround Time, Second Reviews | PRD marks all as [TBD]. Needs Notion API integration |
| 12 | **Client feedback forms** | NOT BUILT | External Quality, Mentorship | No collection mechanism exists. Needs Google Form or in-app form |

---

## Authentication & Permissions (DEFERRED for MVP)

| # | PRD Requirement | Status | Notes |
|---|----------------|--------|-------|
| 1 | Editors: view own metrics only | DEFERRED | No auth system |
| 2 | SEs: view own + pod + client metrics | DEFERRED | |
| 3 | CP & Leadership: view all | DEFERRED | |
| 4 | Account Team excluded from KPIs | DEFERRED | |
| 5 | Read-only for Editorial/Account | DEFERRED | Dashboards are read-only anyway |

---

## Design & UX

| # | PRD Requirement | Status |
|---|----------------|--------|
| 1 | Dark mode by default | DONE |
| 2 | Graphite color palette | DONE |
| 3 | Graphite logo | DONE |
| 4 | JetBrains Mono + IBM Plex Sans | DONE |
| 5 | Last-updated timestamps | DONE |
| 6 | ≤3 clicks to any dashboard | DONE |
| 7 | Executive-friendly aesthetic | DONE |
| 8 | Responsive desktop layout | DONE |
| 9 | Graceful missing data ("—") | DONE |
| 10 | KPI tooltips with formulas | DONE |

---

## KPI Data Acquisition Plan

**8 of 9 KPIs use mock data** (generated by `seed_data.py` with `random.seed(42)`). AI Compliance now uses **real data** from Writer AI Monitoring 2.0. Plan to get real data for the remaining:

| KPI | Current Source | Real Source | Acquisition Plan | Priority |
|-----|---------------|-------------|-----------------|----------|
| **Internal Quality** | Mock (0-100, target 85) | SE scoring rubric | 1) Define rubric. 2) SEs enter monthly scores via KPI Entry form. 3) No external integration needed | HIGH — can start immediately via KPI Entry form |
| **External Quality** | Mock (0-100, target 85) | Client feedback | 1) Create monthly client feedback form (Google Form or in-app). 2) Collect 1 score per client per month. 3) Import into kpi_scores | MEDIUM — needs form creation |
| **Revision Rate** | Mock (0-25%, target ≤15%) | Notion "Client Revisions Needed" | 1) Get Notion API key. 2) Query tasks with "Client Revisions Needed" status. 3) Calculate % of articles requiring revisions. 4) Import monthly | MEDIUM — needs Notion access |
| **Capacity Utilization** | Mock in KPI card / Real in Capacity tab | CP sheet (already imported) | **FIX**: Link KPI card to real utilization from capacity_projections instead of mock score. Calculate: `actual_used / total_capacity × 100` per team member | HIGH — data exists, just needs wiring |
| **Second Reviews** | Mock (0-10, target ≥5) | Notion or manual tracking | 1) SEs track review count. 2) Enter via KPI Entry form monthly. 3) Or integrate Notion task counts | LOW — manual entry for now |
| **Turnaround Time** | Mock (7-21 days, target ≤14) | Notion task timestamps | 1) Get Notion API key. 2) Calculate avg days from CB approval → article delivery per article. 3) Aggregate monthly | MEDIUM — needs Notion access |
| **AI Compliance** | **REAL DATA** (85.4% full pass rate) | Writer AI Monitoring 2.0 sheet | DONE 2026-03-27. Imported 1,168 records. Dedicated AI Compliance tab with charts + tables | COMPLETED |
| **Mentorship** | Mock (60-95, target ≥80) | Monthly SE form | 1) Create form for SEs to rate their Editors monthly. 2) Import scores. 3) No system exists yet | LOW — needs form creation |
| **Feedback Adoption** | Mock (60-95, target ≥80) | Not defined in PRD | 1) Define metric. 2) Possibly track from editorial feedback loop. 3) Manual entry via KPI Entry form | LOW |

---

## Fix Priority — Remaining Items

### P0 — All completed 2026-03-25
All P0 items (missing columns, capacity metrics, tooltips) are done.

### P1 — Mostly completed
- [x] Add team member filter to D2
- [x] Add client filter to D2
- [x] Add search input to D2
- [x] Add per-client KPI breakdown
- [x] ~~Make SOW link clickable~~ DONE 2026-03-27 — hyperlinks extracted from Google Sheets cells
- [x] ~~Integrate Master Tracker sheet~~ DONE 2026-03-27
- [x] ~~Import Writer AI Monitoring 2.0 sheet~~ DONE 2026-03-27
- [x] ~~Add data source indicators (live/mock badges)~~ DONE 2026-03-27
- [ ] Add date range picker to D1 (month/quarter/year filter)
- [ ] Add quarter-based date selection to D2
- [ ] Wire Capacity Utilization KPI card to real data from capacity_projections

### P2 — External dependencies (data sources for mock KPIs)
- [ ] **Internal Quality** — define SE scoring rubric, SEs enter via KPI Entry form (no external integration needed)
- [ ] **External Quality** — build client feedback form (Google Form or in-app), collect 1 score per client per month
- [ ] **Revision Rate** — Notion API integration (query "Client Revisions Needed" tasks) OR use Master Tracker Notion Database export (13K rows)
- [ ] **Turnaround Time** — Notion API integration (calculate days from CB approval → article delivery)
- [ ] **Second Reviews** — SEs enter count via KPI Entry form, or Notion API
- [ ] **Mentorship** — build monthly SE→Editor feedback form
- [ ] **Capacity Utilization KPI card** — wire to real data from capacity_projections (data exists, just needs linkage)
- [ ] Auth system with role-based permissions (Editors: own metrics, SEs: pod+client, CP/Leadership: all)
- [ ] Dynamic forecast month detection (auto-detect latest CP version)

### KPI Implementation Summary

| # | KPI | Shown? | Data | Role | Real Source Needed |
|---|-----|--------|------|------|-------------------|
| 1 | Internal Quality | YES | MOCK | SE + Editor | SE scoring rubric → KPI Entry form |
| 2 | External Quality | YES | MOCK | SE + Editor | Client feedback form |
| 3 | Revision Rate | YES | MOCK | SE + Editor | Notion API or Master Tracker Notion DB |
| 4 | Capacity Utilization | YES | MOCK card / REAL tab | SE + Editor | Wire card to capacity_projections |
| 5 | Second Reviews | YES | MOCK | SE only | KPI Entry form or Notion API |
| 6 | Turnaround Time | YES | MOCK | SE + Editor | Notion API task timestamps |
| 7 | AI Compliance | YES | **REAL** | SE + Editor | Writer AI Monitoring 2.0 ✓ |
| 8 | Mentorship | YES | MOCK | SE only | Monthly SE→Editor form |
| 9 | Feedback Adoption | YES | MOCK | Editor only | Define metric, manual entry |

### Nice-to-Haves (PRD Section 11)
- [ ] Additional tabs to browse all articles per client with doc links
- [ ] Weekly deliverable numbers for month-aggregate visualization
- [ ] Audit logs for dashboard access/usage
- [ ] Anomaly/trend highlighting on KPIs
- [ ] Light annotations on metrics ("Production paused this week")
- [ ] Saved filter states
- [ ] Notifications for broken links or metric changes
