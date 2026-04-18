# Editorial Hub — Source Sheets Reference

> **Last reviewed:** 2026-04-18
> **Companion docs:**
> - [`/.docs/dashboard-data-flow.md`](../../.docs/dashboard-data-flow.md) — dashboard → source mapping + CP v2 migration plan
> - [`/.docs/sheet-inventory.md`](../../.docs/sheet-inventory.md) — which sheets we use vs skip
> - [`/CAPACITY_PLANNING_V2.md`](../../CAPACITY_PLANNING_V2.md) — target `cp2_*` schema

Field-by-field explanation of every Google Sheet that feeds the Hub. When an
entry says "derived," that column is a formula in the sheet and should become a
SQL view in the Hub.

**Ingestion model (2026-04-18):** all sheet ingest is one-time via CSV seed
(`backend/scripts/seed_data.py`). The app is the source of truth going forward.
Sheet rewrites DO NOT propagate to the DB unless someone reseeds or enters the
change through `/data-management/*`.

> ⚠️ Some column descriptions are inferred from schema + screenshots. Where I'm
> guessing, I've marked it with **[verify]**.

---

## Spreadsheet 1 — Editorial Capacity Planning

**ID:** `1I6fNQMjs2y4l6IyOxd9QL-QBjB2zGi0mcoV840JDmkI`
**Purpose:** Planning workbook. Contracts, staffing, capacity projections, and
reference data for how editorial is delivered.
**Maintained by:** Editorial Ops / CP maintainer.
**Update cadence:** Monthly (roster & capacity), per-client SOW changes.

### 1.1 · Editorial SOW overview → `clients`

The contracts table. Source of truth for who we have engagements with.

| Column | Meaning | Type | Notes |
|---|---|---|---|
| Client name | Client display name | text | Primary join key used across the Hub |
| Engagement type | Premium / Standard / Custom | enum | **[verify]** drives pod tiering |
| SOW articles / month | Contracted articles per month | int | Basis for the SOW projection source |
| Contract start | When the engagement begins | date | |
| Contract end | When the engagement ends | date | null if open-ended |
| Account Director | AD assigned | text | |
| Status | Active / paused / off-boarding | enum | **[verify]** |
| Notes | Free-form | text | |

**Feeds:** `clients` table, every dashboard that filters by client.
**Pain point:** Status transitions are manual; an ended SOW often stays "Active"
until someone notices.

### 1.2 · Delivered vs Invoiced v2 → `deliverables_monthly`

Monthly actuals of what we delivered vs. what we billed. Used to detect
delivery drift and contract under/over-consumption.

| Column | Meaning | Type |
|---|---|---|
| Client | FK to Editorial SOW overview | text |
| Month | Reporting month | YYYY-MM |
| SOW allotment | Contracted articles for the month | int |
| Delivered | Articles actually delivered | int |
| Invoiced | Articles billed for | int |
| Carryover | Unused SOW rolled forward | int, derived |
| Status | On-pace / under / over | enum, derived |

**Feeds:** Editorial Clients Dashboard (Deliverables vs SOW card),
`deliverables_monthly` table.
**Pain point:** "Carryover" is a formula that breaks when rows are moved or
inserted mid-year.

### 1.3 · ET CP 2026 [V11 Mar 2026] → `team_members` + `capacity_projections`

The core capacity planning workbook. This is the one Capacity Planning v2 is
designed to replace. Three logical sections stacked vertically in a single tab:

#### Section A — Current Pods & Team Assignments (image #3)

| Column | Meaning |
|---|---|
| Pod number | 1..N |
| Pod members | Names of SE + Editors + Writers on the pod |
| Client | Client assigned to this pod |
| Ending Y/N | Whether the engagement is winding down |
| Project type | Premium / Standard / Custom |
| Account Director | AD for the client |
| Senior Editor | SE leading the pod |

**Maintained by:** CP maintainer, edited as pods/clients shuffle.

#### Section B — Editorial Team (image #4)

Sub-roster showing who's in which pod and their role.

| Column | Meaning |
|---|---|
| Pod number | 1..N |
| Pod members | Role breakdown (SE, Editor 1, Editor 2, Writer) |
| Client | Which clients the pod owns |
| Senior Editor | Pod SE |
| Editor 1 / 2 | Editors on the pod |
| Writer | Writers assigned |

**Pain point:** Duplicates data from Section A. If you update one you must
update the other.

#### Section C — Capacity Table (image #5) → `capacity_projections`

| Column | Meaning | Computed? |
|---|---|---|
| Pod | Pod number | — |
| Role | SE / ED / WR | — |
| Team | Member name | — |
| Capacity | Default monthly capacity (articles) | From Model Assumptions |
| Total Capacity | Σ capacity of pod members | Derived |
| Projected Capacity | Expected use this month | Pulled from Operating Model |
| Actual Capacity | What was actually delivered | Pulled from Goals vs Delivery |
| Comments | Free-form explanations | — |
| Color coding | Green = healthy, Red = over, Amber = under | Derived |

**This is the table Capacity Planning v2 replaces.** See
`CAPACITY_PLANNING_V2.md` for how each of these columns maps to `cp2_*` tables.

### 1.4 · Editorial Operating Model (image #6)

The projection matrix — rows = clients, columns = months, values = projected
article output. The Hub reads this to pre-fill `projected_articles` in the
allocation table when source = `operating_model`.

| Column | Meaning |
|---|---|
| Client | Client name |
| Jan 2026 .. Dec 2026 | Projected articles for each month |
| Total | Sum across the year, derived |

**Maintained by:** Manual entry + some formula-based projections.
**Current month (April)** is a projection because the month hasn't ended. Future
months are all projections.
**Pain point:** Numbers scattered across sheets get pasted here manually.

### 1.5 · Model Assumptions

Tuning parameters used by every other sheet's formulas.

| Column | Meaning |
|---|---|
| SE monthly capacity | Default cap for Senior Editors |
| Editor monthly capacity | Default cap for Editors |
| Writer monthly capacity | Default cap for Writers |
| Weeks per month (effective) | Typically 4.2 or similar |
| PTO assumption | Default leave % |

**Feeds:** The `default_monthly_capacity_articles` column of
`cp2_dim_team_member`.

### 1.6 · Meta Calendar Month Deliveries

Calendar-aware deliveries per month (accounts for months with holidays,
production closures).

| Column | Meaning |
|---|---|
| Month | YYYY-MM |
| Working weeks | Effective weeks in the month |
| Holiday adjustment | Days lost to holidays |

**[verify]** — exact shape from screenshot.

### 1.7 · Editorial Engagement Requirements

Per-engagement-type SLAs and content requirements.

| Column | Meaning |
|---|---|
| Engagement type | Premium / Standard / Custom |
| Article depth | Word count bands |
| SEO requirements | Keyword count, structured data needs |
| Second review required? | bool |
| Turnaround SLA | Days |

**Feeds:** Reference for KPI thresholds, second-review logic.

### 1.8 · Delivery Schedules

Weekly / monthly deliverable calendar per client.

| Column | Meaning |
|---|---|
| Client | Client name |
| Week of | ISO week start |
| Scheduled articles | Planned deliveries for the week |
| Status | Scheduled / in-flight / delivered |

**[verify]** — exact shape.

---

## Spreadsheet 2 — Master Tracker

**ID:** `1dtZIiTKPEkhc0qrlWdlvd-n8qAn5-lhVcPkgHNgoLAY`
**Purpose:** Weekly delivery tracking and all-time pipeline per client.
**Maintained by:** Editorial team, weekly.
**Update cadence:** Weekly, monthly rollups.

### 2.1 · Cumulative → `cumulative_metrics`

All-time pipeline snapshot per client. One row per client, running totals.

| Column | Meaning |
|---|---|
| Client | Client name |
| Total articles delivered | Running count since engagement start |
| Total second reviews | Count of articles that went through second review |
| Total revisions | Count of revision cycles |
| First delivery date | When the engagement's first article shipped |
| Last delivery date | Most recent delivery |

**Feeds:** Editorial Clients Dashboard lifetime metrics, KPI baselines.

### 2.2 · [Month Year] Goals vs Delivery (x9 sheets) → `goals_vs_delivery`

One sheet per month; each has weekly rows. This is where **"Actual Delivered"**
numbers on the Capacity Planning v2 board come from.

| Column | Meaning |
|---|---|
| Week of | ISO week start (Mon) |
| Client | Client name |
| Pod | Pod assigned (redundant w/ CP sheet) |
| Goal | Planned articles for the week |
| Delivered | Actual articles delivered |
| Variance | Delivered − Goal, derived |
| Notes | Why variance exists |

**Feeds:** `cp2_fact_actuals_weekly` (in CP v2), KPI dashboards.
**Pain point:** Nine separate sheets means nine places to edit; inconsistent
column order between months.

---

## Spreadsheet 3 — Writer AI Monitoring 2.0

**ID:** `13kl0_6YuzsJ3xEzNLzDZeR-sHMaNJNw6oJGmwb-CBOU`
**Purpose:** Track AI content scanning results for every article to detect
AI-generated drafts and manage rewrites.
**Maintained by:** QA team + automated Surfer API ingestion.
**Status:** Currently **paused** per your latest update.

### 3.1 · Data → `ai_monitoring_records`

One row per article scan.

| Column | Meaning |
|---|---|
| Article title | Title / slug |
| Client | Client name |
| Writer | Writer name |
| Scan date | When the article was scanned |
| AI score | % confidence it's AI-generated |
| Status | Green / Yellow / Red (threshold bands) |
| Scanner | Tool that produced the score (Surfer, GPTZero, etc.) |
| Rewrite required? | bool |

**Feeds:** AI Compliance KPI card on Team KPIs dashboard.

### 3.2 · Rewrites → `ai_monitoring_records` (is_rewrite=True)

Subset of 3.1 where the article was flagged and rewritten.

| Column | Meaning |
|---|---|
| Original article | FK to Data |
| Rewrite date | When the rewrite was submitted |
| New AI score | Post-rewrite score |
| Rewrite writer | Who did the rewrite |
| Status after rewrite | Should be Green |

### 3.3 · Yellow/Red Flags v2 → `ai_monitoring_records` (is_flagged=True)

Subset of 3.1 that's Yellow or Red. Essentially a filtered view.

| Column | Meaning |
|---|---|
| Article title | Article name |
| Client | Client name |
| Writer | Writer name |
| AI score | % |
| Flag level | Yellow / Red |
| Action taken | Rewrite / warning / fired |

### 3.4 · Surfer's API usage → `surfer_api_usage`

API cost/quota tracking.

| Column | Meaning |
|---|---|
| Date | Day |
| Calls | Count of API calls |
| Cost | Estimated $ cost |
| Quota remaining | Budget left |

**Feeds:** Internal ops, not a dashboard KPI.

---

## Spreadsheet 4 — Notion Database (direct API, not a sheet anymore)

**Purpose:** Every article from ideation → publication.
**Source:** Direct Notion API via `backend/app/services/notion_import.py`
(paginated read + bulk upsert — fix landed `612c854`, Apr 16).
**Maintained by:** Automated import triggered on seed + manual rerun.
**Update cadence:** On-demand (no scheduler yet).
**Row count:** ~23,143 rows, 38 columns.

### 4.1 · Notion tab → `notion_articles`

Comprehensive article workflow tracking. Only the columns actively used by the
Hub are documented here; the full 38-column schema lives in the Notion export.

| Column | Meaning | Used for |
|---|---|---|
| Article ID | Notion UUID | Primary key |
| Title | Article title | Display |
| Client | Client name | Join to `clients` |
| Writer | Assigned writer | Team KPIs |
| Editor | Assigned editor | Team KPIs |
| Senior Editor | Reviewing SE | Second Review KPI |
| Status | Outline / Draft / Review / Published | Pipeline |
| First draft date | When the first draft was submitted | Turnaround KPI |
| Published date | When the article went live | Turnaround KPI |
| Revisions count | Number of revision cycles | Revision Rate KPI |
| Second review? | Did it go through second review | Second Reviews KPI |
| Word count | Final word count | — |
| SEO score | Surfer score | — |

**Feeds:** 3 KPIs on the Team KPIs dashboard (Revision Rate, Turnaround Time,
Second Reviews). This is your **cleanest data source** — it's the only one
that's fully automated end-to-end.

---

## Summary Matrix — maintenance burden & automation status

| Sheet | Rows | Update cadence | Manual work | Automation | Pain level |
|---|---|---|---|---|---|
| Editorial SOW overview | ~80 | Monthly | Medium | ❌ | Medium |
| Delivered vs Invoiced v2 | Monthly × clients | Monthly | High (formulas) | ❌ | High |
| ET CP 2026 (the CP sheet) | ~30 × months | Monthly | **Very high** | ❌ | **Very high** |
| Editorial Operating Model | Clients × months | Monthly | High | ❌ | High |
| Model Assumptions | ~10 | Quarterly | Low | ❌ | Low |
| Meta Calendar Month Deliveries | 12 | Yearly | Low | ❌ | Low |
| Editorial Engagement Requirements | ~3 tiers | Rarely | Low | ❌ | Low |
| Delivery Schedules | Weekly × clients | Weekly | Medium | ❌ | Medium |
| Cumulative (Master Tracker) | ~80 | Weekly (rollup) | Low | Partial | Low |
| Goals vs Delivery × 9 | Weekly × 9 months | Weekly | **Very high** | ❌ | **High** |
| Writer AI Monitoring — Data | 1,168 | **Paused** | — | Surfer API | Paused |
| Writer AI — Rewrites / Flags | subsets | **Paused** | — | Formula views | Paused |
| Notion Database | 23,143 | Continuous | None | ✅ ETL | Low |

### Priority order for automation (my read)

1. **ET CP 2026** — already being replaced by Capacity Planning v2.
2. **Goals vs Delivery (x9 → 1 table)** — collapse to a single `goals_vs_delivery`
   table, Weekly ETL. Feeds CP v2 actuals.
3. **Delivered vs Invoiced v2** — straightforward monthly ETL.
4. **Editorial Operating Model** — becomes an editable view of
   `cp2_fact_client_allocation` once CP v2 lands.
5. **Editorial SOW overview** — small, stable; migrate when touching CP v2.
6. **Writer AI Monitoring** — resume when/if the QA pipeline restarts.
7. **Master Tracker Cumulative** — derive from `notion_articles` +
   `goals_vs_delivery` rollup, skip the sheet entirely.

---

## CP v2 migration map (where each sheet goes)

When the `cp2_*` tables land (see `CAPACITY_PLANNING_V2.md` Status section),
each sheet above gets one canonical destination:

| Sheet | Legacy table | Target `cp2_*` table | Notes |
|---|---|---|---|
| Editorial SOW overview | `clients` | `cp2_dim_client` (+ retain `clients`) | Dim + denorm of staffing cols |
| Delivered vs Invoiced v2 | `deliverables_monthly` | `cp2_fact_delivery_monthly` | Monthly grain |
| ET CP 2026 | `team_members` + `capacity_projections` | `cp2_dim_team_member` + `cp2_fact_pod_membership` + `cp2_fact_capacity_override` | Pod is now per-month, not a static string |
| Model Assumptions | `model_assumptions` | `cp2_dim_model_assumption` | Rename-only |
| Editorial Operating Model | `production_history` | `cp2_fact_production_history` | Keep separate from delivery_monthly via `is_actual` |
| Delivery Schedules | `delivery_templates` | `cp2_dim_delivery_template` | Rename-only |
| Editorial Engagement Requirements | `engagement_rules` | `cp2_dim_engagement_rule` | Rename-only |
| Meta Calendar Month Deliveries | `deliverables_monthly` (subset) | `cp2_fact_delivery_monthly` | Merges cleanly |
| Master Tracker Cumulative | `cumulative_metrics` | `cp2_fact_pipeline_snapshot` | Month-scoped (was all-time) |
| Master Tracker Goals vs Delivery (×9) | `goals_vs_delivery` | `cp2_fact_actuals_weekly` | Add `week_key` FK |
| Writer AI Monitoring | `ai_monitoring_records`, `surfer_api_usage` | `cp2_fact_ai_scan`, `cp2_fact_surfer_api_usage` | Add writer/editor FKs |
| Notion Database | `notion_articles` | `cp2_fact_article` | Fuzzy-match writer/editor names to FK |

See [`/.docs/dashboard-data-flow.md`](../../.docs/dashboard-data-flow.md) for the phased cutover order.

## How to update this doc

When you add/rename columns in any sheet, update the matching table here and
bump the **[verify]** markers to remove them as columns get confirmed. This is
the single reference for anyone ramping on how the Hub ingests data.
