# Capacity Planning v2 — Proposal

> **Status:** Proposal. Lives alongside existing dashboards, no touches to current
> data or UI. New route `/capacity-planning`, new tables prefixed `cp2_`, trivially
> removable.

## Design principles

- **Plan monthly, measure weekly.** Monthly is how the team plans, contracts,
  and reports. Weekly only exists on the *actuals* side (pulled from
  `goals_vs_delivery`) and is rolled up to month/quarter for display.
- **Dim + fact separation.** Things that exist (dims) are edited rarely; numbers
  per month (facts) are edited often. Derived totals live in SQL views — never
  stored, always fresh.
- **Manual always wins.** Every computed value can be overridden; every override
  is a row with a reason and author.
- **Month rows copy forward.** The maintainer only edits deltas. Membership and
  allocation are month-scoped rows, not mutations.

## ERD

```mermaid
erDiagram
    CP2_DIM_TEAM_MEMBER ||--o{ CP2_FACT_POD_MEMBERSHIP : "assigned to"
    CP2_DIM_POD ||--o{ CP2_FACT_POD_MEMBERSHIP : "has members"
    CP2_DIM_MONTH ||--o{ CP2_FACT_POD_MEMBERSHIP : "for month"

    CP2_DIM_POD ||--o{ CP2_FACT_CLIENT_ALLOCATION : "owns clients"
    CP2_DIM_CLIENT ||--o{ CP2_FACT_CLIENT_ALLOCATION : "allocated to pod"
    CP2_DIM_MONTH ||--o{ CP2_FACT_CLIENT_ALLOCATION : "for month"

    CP2_DIM_TEAM_MEMBER ||--o{ CP2_FACT_MEMBER_LEAVE : "takes leave"
    CP2_DIM_MONTH ||--o{ CP2_FACT_MEMBER_LEAVE : "affects month"

    CP2_DIM_TEAM_MEMBER ||--o{ CP2_FACT_CAPACITY_OVERRIDE : "override on"
    CP2_DIM_POD ||--o{ CP2_FACT_CAPACITY_OVERRIDE : "override on"

    CP2_DIM_POD ||--o{ CP2_FACT_ACTUALS_WEEKLY : "delivers"
    CP2_DIM_CLIENT ||--o{ CP2_FACT_ACTUALS_WEEKLY : "receives"
    CP2_DIM_WEEK ||--o{ CP2_FACT_ACTUALS_WEEKLY : "in week"
    CP2_DIM_MONTH ||--o{ CP2_DIM_WEEK : "contains"

    CP2_DIM_CLIENT ||--o{ CP2_DIM_ENGAGEMENT_TIER : "has tier"

    CP2_DIM_TEAM_MEMBER {
        int id PK
        string full_name
        string email
        enum role_default "SE|ED|WR|AD|PM"
        float default_monthly_capacity_articles
        date start_month
        date end_month "nullable"
        bool is_active
        text notes
    }
    CP2_DIM_POD {
        int id PK
        int pod_number
        string display_name
        date active_from
        date active_to "nullable"
        text notes
    }
    CP2_DIM_CLIENT {
        int id PK
        int client_id_fk FK "existing clients.id"
        int engagement_tier_id FK "nullable"
        int sow_articles_per_month
        date contract_start
        date contract_end
        bool is_active_in_cp2
    }
    CP2_DIM_ENGAGEMENT_TIER {
        int id PK
        string name "Premium|Standard|Custom"
        text description
    }
    CP2_DIM_MONTH {
        string month_key PK "YYYY-MM"
        int year
        int month_num
        string quarter
        bool is_current
        bool is_forecast
    }
    CP2_DIM_WEEK {
        string week_key PK "YYYY-Www"
        string month_key FK
        date week_start
        date week_end
        int iso_year
        int iso_week
    }
    CP2_FACT_POD_MEMBERSHIP {
        int id PK
        string month_key FK
        int pod_id FK
        int team_member_id FK
        enum role_in_pod "SE|ED|WR|AD|PM"
        float capacity_share "0.0 to 1.0"
        text notes
    }
    CP2_FACT_CLIENT_ALLOCATION {
        int id PK
        string month_key FK
        int pod_id FK
        int client_id FK
        int projected_articles
        enum projected_source "manual|operating_model|sow"
        int projected_articles_manual "nullable"
        text notes
    }
    CP2_FACT_MEMBER_LEAVE {
        int id PK
        int team_member_id FK
        string month_key FK
        float leave_share "0.0 to 1.0 of the month"
        string reason "PTO|Parental|Sick|Other"
        text notes
    }
    CP2_FACT_CAPACITY_OVERRIDE {
        int id PK
        string month_key FK
        int team_member_id FK "nullable"
        int pod_id FK "nullable"
        int delta_articles "signed"
        text reason
        string created_by
        timestamp created_at
    }
    CP2_FACT_ACTUALS_WEEKLY {
        int id PK
        string week_key FK
        int pod_id FK
        int client_id FK
        int delivered_articles
        int goal_articles
        timestamp ingested_at
    }
```

## Derived views

All totals are computed, never stored.

```sql
-- Effective monthly capacity per member (respects splits, leave, overrides)
CREATE VIEW cp2_v_member_effective_capacity AS
SELECT
  tm.id AS team_member_id,
  m.month_key,
  tm.default_monthly_capacity_articles
    * COALESCE(SUM(pm.capacity_share), 0)
    * (1 - COALESCE(ml.leave_share, 0))
    + COALESCE(ov.delta, 0) AS effective_capacity
FROM cp2_dim_team_member tm
CROSS JOIN cp2_dim_month m
LEFT JOIN cp2_fact_pod_membership pm
  ON pm.team_member_id = tm.id AND pm.month_key = m.month_key
LEFT JOIN cp2_fact_member_leave ml
  ON ml.team_member_id = tm.id AND ml.month_key = m.month_key
LEFT JOIN (
  SELECT team_member_id, month_key, SUM(delta_articles) AS delta
  FROM cp2_fact_capacity_override
  WHERE team_member_id IS NOT NULL
  GROUP BY 1, 2
) ov ON ov.team_member_id = tm.id AND ov.month_key = m.month_key
GROUP BY tm.id, m.month_key, ml.leave_share, ov.delta;

-- Pod monthly capacity + projected use + variance
CREATE VIEW cp2_v_pod_monthly AS
SELECT
  p.id AS pod_id,
  m.month_key,
  SUM(mc.effective_capacity * pm.capacity_share) AS total_capacity,
  (SELECT SUM(COALESCE(projected_articles_manual, projected_articles))
     FROM cp2_fact_client_allocation
     WHERE pod_id = p.id AND month_key = m.month_key) AS projected_use
FROM cp2_dim_pod p
CROSS JOIN cp2_dim_month m
LEFT JOIN cp2_fact_pod_membership pm
  ON pm.pod_id = p.id AND pm.month_key = m.month_key
LEFT JOIN cp2_v_member_effective_capacity mc
  ON mc.team_member_id = pm.team_member_id AND mc.month_key = m.month_key
GROUP BY p.id, m.month_key;

-- Actuals rolled up from weekly to monthly
CREATE VIEW cp2_v_pod_monthly_actuals AS
SELECT a.pod_id, w.month_key, SUM(a.delivered_articles) AS actual_delivered
FROM cp2_fact_actuals_weekly a
JOIN cp2_dim_week w ON w.week_key = a.week_key
GROUP BY a.pod_id, w.month_key;
```

## Routes (all under `/capacity-planning`, new sidebar "Proposal" section)

| Route | Purpose | Editable? |
|---|---|---|
| `/capacity-planning` | Overview Board | Read-only + override modal |
| `/capacity-planning/roster` | Roster editor (member × month matrix) | Drag & drop members across pods/months |
| `/capacity-planning/allocation` | Client → Pod kanban | Drag & drop clients |
| `/capacity-planning/schema` | Interactive ERD viewer (React Flow) | Read-only |
| `/capacity-planning/tables` | Browse every `cp2_*` table with mock rows | Read-only |
| `/capacity-planning/glossary` | Dashboard-KPI → ERD column mapping | Read-only |
| `/capacity-planning/members` | Team member CRUD *(phase 2)* | Yes |
| `/capacity-planning/pods` | Pod CRUD *(phase 2)* | Yes |
| `/capacity-planning/leave` | PTO / leave entry *(phase 2)* | Yes |

## Coverage for current dashboards

The ERD is sized to feed *every* metric on today's two production dashboards — not just capacity. A full column-level audit is in [`CP2_COVERAGE_AUDIT.md`](CP2_COVERAGE_AUDIT.md).

**Dashboards covered:** Editorial Clients (SOW Overview, Time-to metrics, Engagement Timeline, Contract & Timeline Detail, Delivery Overview, Production Trend, Client Delivery Matrix, Cumulative Pipeline, Weekly Goals vs Delivery, Pacing) and Team KPIs (9-KPI heatmap, per-client breakdown, Pod rollups, Capacity Projections tab, AI Compliance summary + breakdowns + flagged + rewrites + Surfer usage).

| Dashboard metric | Source table | Key columns |
|---|---|---|
| Internal / External Quality, Mentorship, Feedback Adoption | `cp2_fact_kpi_score` | `score`, `metric_id`, `client_id` (per-client breakdown) |
| Revision Rate, Turnaround Time, Second Reviews | `cp2_fact_article` | `revision_count`, `turnaround_days`, `had_second_review`, `writer_id`, `editor_id`, `sr_editor_id` |
| AI Compliance | `cp2_fact_ai_scan` | `recommendation`, `is_flagged`, `is_rewrite`, `surfer_v1_score`, `surfer_v2_score` |
| AI Flagged / Rewrites tables | `cp2_fact_ai_scan` | `topic_title`, `article_link`, `writer_name`, `editor_name`, `action`, `manual_review_notes`, `date_processed` |
| Surfer API Usage | `cp2_fact_surfer_api_usage` | `pod_1..pod_5`, `auditioning_writers`, `rewrites`, `total_spent`, `remaining_calls` |
| Capacity Utilization | `cp2_v_pod_monthly` (view) | `projected_use / total_capacity` |
| Articles Delivered / Invoiced / Paid (monthly) | `cp2_fact_delivery_monthly` | `articles_sow_target`, `articles_delivered`, `articles_invoiced`, `articles_paid`, `variance` |
| Content Briefs (monthly) | `cp2_fact_delivery_monthly` | `content_briefs_delivered`, `content_briefs_goal` |
| Production Trend (projected vs actual) | `cp2_fact_production_history` | `articles_actual`, `articles_projected`, `is_actual` |
| Weekly CB + AD Goals vs Delivery | `cp2_fact_actuals_weekly` | `cb_*` (7 cols), `ad_*` (8 cols), `ratios`, `client_type`, `content_type` |
| Cumulative Pipeline | `cp2_fact_pipeline_snapshot` | `topics_submitted/approved`, `cbs_submitted/approved`, `articles_sent/approved/delivered/published/killed`, `*_pct_*`, `comments` |
| Pacing (vs template) | `cp2_dim_delivery_template` + `cp2_fact_delivery_monthly` | `delivery_cumulative` vs `sum(articles_delivered)` |
| Time-to Milestones (8 date deltas) | `cp2_dim_client` | 6 milestone dates from `consulting_ko_date` to `first_article_published_date` |
| Client Engagement Timeline | `cp2_dim_client` | `contract_start/end`, `term_months`, `cadence`, `cadence_q1..q4`, `sow_articles_total`, `word_count_min/max`, pod |
| Contract & Timeline Detail (17 columns) | `cp2_dim_client` | `name`, `status`, `editorial_pod`, `growth_pod`, `sow_link`, `word_count_*`, all milestone dates, staffing (`managing_director` / `account_director` / `account_manager` / `jr_am` / `cs_team`) |

See `/capacity-planning/glossary` in-app for the authoritative mapping (including formulas and direction).

## Status

- **Phase 1 (this commit):** Read-only prototype of the Overview Board with mock
  data. No schema changes, no ingestion.
- **Phase 2:** Apply migrations for `cp2_*` tables + views; build admin editors
  (Roster, Allocation, Members, Pods, Leave).
- **Phase 3:** One-time ingestion from existing Sheets to populate dims.
- **Phase 4:** Wire actuals-weekly ETL from Master Tracker `goals_vs_delivery`.
- **Phase 5:** User testing with maintainer; iterate.
- **Phase 6:** Approval gate → decide whether to retire the spreadsheet.
