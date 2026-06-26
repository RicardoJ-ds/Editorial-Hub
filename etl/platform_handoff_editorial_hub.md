# Platform Handoff — Editorial Hub

**How to pull, from BigQuery, every number the Hub shows.** Audience: anyone with read access
to the warehouse (analysts, BI, teammates) who wants to reproduce a dashboard figure or build
their own report without going through the app.

- **Project:** `graphite-data`
- **Dataset:** `graphite_bi_sandbox`
- **Service account (app):** `graphite-bi-sa@graphite-data.iam.gserviceaccount.com`
- Query from the BigQuery console, `bq`, Connected Sheets, or any client with `BigQuery Job User` on `graphite-data`.

> **Golden rule:** for anything a dashboard shows, **read the `v_editorial_*` views** — they
> carry the business math (variance, tiers, weighting, utilization) already applied. The
> `editorial_raw_*` tables are faithful mirrors of the source sheets; the `editorial_int_*`
> tables are where the math is computed; the views are the clean public surface. Read raw only
> when you need an un-aggregated source value.

---

## 1. The layered model

```
Google Sheets / Notion  ──►  editorial_raw_*   (1:1 mirrors of the source)
                                   │
                                   ▼  business rules applied (billing periods, variance,
                              editorial_int_*    content-type weighting, capacity model)
                                   │
                                   ▼  clean public surface (read these)
                              v_editorial_dim_*  (dimensions)
                              v_editorial_fct_*  (facts)
                                   │
                                   ▼
                              The Hub dashboards
```

The whole warehouse is rebuilt in one ~20s publish, **dual-sink** to Postgres schema `warehouse`
and BigQuery `graphite_bi_sandbox` from the same in-memory rows. Prod dashboards serve from
BigQuery, fronted by an in-process cache (so neither BQ nor Neon is hit per request). A SYNC
bumps the cache token, so fresh numbers appear within one poll interval. **Querying BQ directly
always gives you the latest published numbers.**

---

## 2. Join keys & ID spaces — read this first

This is the #1 source of wrong answers. There are **two different client-id spaces**:

| Use this | Not this |
|---|---|
| `editorial_raw_clients.id` (1–84) — the app's client id | `editorial_clients.id` (463+) — a **stale, renumbered** copy; do not join to it |

- **`editorial_raw_clients.id`** is the canonical client key. `editorial_raw_production`,
  `editorial_raw_deliverables`, `editorial_raw_articles`, `editorial_raw_client_pod_history`,
  and `editorial_int_*` all join on `client_id = editorial_raw_clients.id`. Verified 100% match.
- **Name-keyed sources** (`editorial_raw_goals`, `editorial_raw_cumulative`) join by
  `client_name` (fuzzy) — a few rows may be unmatched.
- **`editorial_raw_articles`** grain is **one row per (article, editor)** — collaboration
  articles (editor cell contains "/") explode into one row per editor. ~16k rows ≈ ~14.7k
  unique articles. ~4k rows have `client_id IS NULL` (article tab name didn't resolve to a Hub
  client — those carry no pod).
- **Names are normalized** through `editorial_name_map` (raw → canonical). Editors store the
  canonical directly in `editor_name` (`editor_canonical` is **always NULL** — don't use it);
  writers carry both `writer_name` (canonical/display) and `writer_canonical`.

```sql
-- the canonical client join (production → name)
SELECT cl.name AS client, p.year, p.month, p.articles_actual
FROM `graphite-data.graphite_bi_sandbox.editorial_raw_production` p
JOIN `graphite-data.graphite_bi_sandbox.editorial_raw_clients` cl ON cl.id = p.client_id;
```

---

## 3. Table & view catalog

### Dimensions (`v_editorial_dim_*`)
| View | Grain | Key columns | For |
|---|---|---|---|
| `v_editorial_dim_client` | one client | `client_id`, `client_name`, `status`, `editorial_pod`, `growth_pod`, `articles_sow`, milestone dates | client master |
| `v_editorial_dim_member` | one team member | `member_id`, `name`, `role`, `pod`, `monthly_capacity` | roster dimension |
| `v_editorial_dim_calendar` | (year, month, week) | `year`, `month`, `week_number`, `start_date`, `end_date` | editorial-month boundaries |

### Facts (`v_editorial_fct_*`) — the dashboard surface
| View | Grain | Feeds |
|---|---|---|
| `v_editorial_fct_production_monthly` | (client, year, month) | Overview → Production History |
| `v_editorial_fct_client_months` | (client, year, month) | Editorial Clients → Deliverables vs SOW (+ period indexing) |
| `v_editorial_fct_client_q_snapshot` | one client | Overview pod cards; lifetime + current-Q + last-Q metrics |
| `v_editorial_fct_pod_snapshot` | (pod_axis, pod) | Overview → Pod Snapshot |
| `v_editorial_fct_milestone_transitions` | (client, transition) | Overview → Time to Milestones |
| `v_editorial_fct_pipeline` | one client | Editorial Clients → cumulative pipeline (Topics→CBs→Articles→Published) |
| `v_editorial_fct_goals_monthly` | (month, client, content_type) | Editorial Clients → Goals vs Delivery (weighted) |
| `v_editorial_fct_goals_client_totals` | one client | cumulative goals scorecard |
| `v_editorial_fct_articles_monthly` | (month, pod, client, editor) | Team KPIs → Revisions/Monthly Articles (count, revised, second_reviews, published, matched) |
| `v_editorial_fct_article_revisions` | (revision-month, pod, client, editor) | Team KPIs → revision-event counts |
| `v_editorial_fct_capacity_pods` | (year, month, pod) | Team KPIs → Capacity (pod totals) |
| `v_editorial_fct_member_utilization` | (year, month, pod, member) | Team KPIs → Capacity → By Editor |
| `v_editorial_fct_client_contributions` | (year, month, pod, client) | Team KPIs → Capacity → per-pod client breakdown |
| `v_editorial_fct_pod_assignments` | (year, month, pod, person) — editorial only | RBAC group auto-population |
| `v_editorial_kpi_scores` | (member, year, month, kpi_type) | Team KPIs → KPI heatmap |
| `v_editorial_fct_ai_flagged` / `v_editorial_fct_ai_recommendations` | per AI scan | Team KPIs → AI Compliance |
| `v_editorial_roster` | (canonical_name, role) | editor/writer/2nd-review dropdowns (single source of truth) |

### Raw tables (`editorial_raw_*`) — source mirrors
`clients` (84) · `articles` (16k, grain article×editor) · `article_revisions` (7.7k, one per revision event) ·
`production` (4.4k, client×month actual/projected) · `deliverables` (623, client×month delivered/invoiced) ·
`goals` (2.2k, week×client×content_type) · `cumulative` (52, lifetime pipeline) · `capacity` (245, pod×month) ·
`capacity_members` (417, pod×slot×role) · `team_members` (12) · `pod_history` (17k) · `client_pod_history` (484) ·
`calendar` (52) · `kpi_scores` (1.5k) · `model_assumptions` (14) · `delivery_templates` (60, pacing curve) ·
`ai_monitoring` (3.4k) · `surfer_usage` (25).

### Reference tables
- `editorial_name_map` (209) — raw → canonical name mapping (kind = editor/writer/client), with optional `valid_from`/`valid_to` windows. DaniQ-editable via sheet → BQ.
- `editorial_roster_exclusions` (3) — role-aware "this person is not an editor/writer" list; subtracted by `v_editorial_roster`.

---

## 4. Dashboard → source map

| Hub surface | API endpoint | Read this |
|---|---|---|
| Overview · Production History | `/api/dashboard/production-trend` | `editorial_raw_production` (SUM actual/projected by month, split on `is_actual`) |
| Overview · Pod Snapshot | `/api/dashboard/client-production` | `v_editorial_fct_client_q_snapshot` + `editorial_raw_production` |
| Overview · pacing badge | `/api/dashboard/pacing` | `editorial_raw_clients` + `editorial_raw_delivery_templates` + `editorial_raw_deliverables` |
| Overview · Time to Milestones | (snapshot) | `v_editorial_fct_milestone_transitions` |
| Editorial Clients · Contract & Timeline | `/api/clients/` | `editorial_raw_clients` (+ latest production month) |
| Editorial Clients · Deliverables vs SOW | `/api/deliverables/`, `/api/goals-delivery/*` | `editorial_raw_deliverables`, `v_editorial_fct_goals_monthly`, `editorial_raw_cumulative` |
| Team KPIs · KPI heatmap | `/api/kpis/` | `v_editorial_kpi_scores` |
| Team KPIs · Capacity (pods) | `/api/capacity/pod-summary` | `v_editorial_fct_capacity_pods` |
| Team KPIs · Capacity (by editor) | `/api/capacity/member-utilization[-matrix]` | `v_editorial_fct_member_utilization` |
| Team KPIs · Capacity (client breakdown) | `/api/capacity/client-contributions` | `v_editorial_fct_client_contributions` |
| Team KPIs · Revisions / Monthly Articles | `/api/articles/monthly` | `v_editorial_fct_articles_monthly` (creation) + `v_editorial_fct_article_revisions` (revisions) |
| Team KPIs · AI Compliance | `/api/ai-monitoring/*` | `editorial_raw_ai_monitoring` |

---

## 5. How each metric is calculated

The business math lives in the **int layer** (shared by the warehouse build and the backend
service `app/services/capacity_calc.py` / `calculations.py`) and, for triage coloring, in the
frontend `shared-helpers.tsx`. The formulas:

### Contract quarters & billing periods
- Month-of-contract = months since `clients.start_date`; year index = `floor((months−1)/12)` (suffix Y2/Y3…).
- A month with `invoiced > 0` opens a new billing period; `invoiced = 0` months join the prior one; months before the first invoice are the "prelude".
- Materialized on `editorial_int_client_months` as `ovr_period_*` (Operating-Model review period) and `d1_period_*` (effective contract period), and rolled to `editorial_int_client_q_snapshot` (one row/client).

### End-of-Q variance + tier (symmetric)
```
variance = (Σ delivered + Σ remaining-month projections, this Q) − (Σ invoiced through end of this Q)
v = round(variance)
1st contract Q → "1st Q" (blue) · v=0 → On track (green) · |v|≤5 → Within limit (amber)
v>5 → Ahead (red) · v<−5 → Behind (red)
```
Catch-up over-delivery nets against earlier deficits (cumulative). Threshold `±5`. Tiers on
`editorial_int_client_q_snapshot.{ovr_tier,d1_tier}`; frontend mirror `varianceTier()`.

### Goals content-type weighting
- Display weights: **article ×1 · jumbo ×2 · LP ×0.5 · glossary ×0.5**.
- 3-step aggregation: max-of-week per (client, month, content_type) → apply weight → sum to pod.
- **LP rows from 2026-05 are pre-doubled at ingestion** (so the display ×0.5 cancels and the sheet stays in physical units); **glossary (2026-06+) ingests raw, weights ×0.5 at display**.
- Materialized on `editorial_int_goals_month_ct` (`ratio`, `w_cb_*`, `w_ad_*`) → `v_editorial_fct_goals_monthly`.

### Capacity utilization
```
% Real     = actual_used ÷ capacity
% Weighted = actual_used ÷ projected_used
Spare      = pod_total_capacity − Σ projected_used
member projected_used = (capacity ÷ pod_capacity) × pod_projected_raw   -- allocation key
member actual_used    = (articles ÷ pod_articles) × pod_actual_raw      -- distribution key
```
Articles are only a *distribution* key (magnitude comes from the pod's Operating-Model actual).
Pod-level reference weights specialized-category work ×1.4. Engine: `app/services/capacity_calc.py`
(shared with the ETL); tables `editorial_int_member_months`, `editorial_int_capacity_pod_months`.

### Revision rate % / revision events / 2nd review %
```
revision rate %  = articles with revision_count>0 ÷ articles      (by CREATION month)
revisions        = count of revision events                       (by each revision's OWN month)
2nd review %      = articles with a non-empty 2ND REVIEW Sr-editor ÷ articles  (by CREATION month)
```
Rates are **pooled** (`Σ num ÷ Σ den`), never an average of rates. Columns: `count`, `revised`,
`second_reviews` on `v_editorial_fct_articles_monthly`; `revisions` on `v_editorial_fct_article_revisions`.

### %SOW · %Published · pacing color
```
%SOW       = delivered ÷ articles_sow
%Published = published_live ÷ delivered
pacing: green if actual% within −10pp of elapsed%; yellow within −25pp; red beyond; always green if elapsed% < 8% (new client)
```
On `editorial_int_client_q_snapshot` (`pct_complete`, `published_live`); frontend `pacingColor()`.

### Time to Milestones
`v_editorial_fct_milestone_transitions` precomputes `DATE_DIFF` for 8 lifecycle transitions per
client: `cko_eko` (Consulting→Editorial KO), `cko_cb`, `cko_art`, `cko_fb`, `cb_art`, `cko_pub`,
`art_fb`, `fb_pub`. One row per (client, transition) with `days`.

---

## 6. Copy-paste recipes

```sql
-- A) Production trend, all clients by month (Overview → Production History)
SELECT year, month, SUM(articles_actual) actual, SUM(articles_projected) projected, is_actual
FROM `graphite-data.graphite_bi_sandbox.editorial_raw_production`
GROUP BY year, month, is_actual ORDER BY year, month;

-- B) Per-client lifetime SOW progress + published
SELECT client_name, articles_sow, lifetime_delivered, lifetime_invoiced, published_live,
       ROUND(lifetime_delivered / NULLIF(articles_sow,0) * 100, 1) AS pct_sow
FROM `graphite-data.graphite_bi_sandbox.v_editorial_fct_client_q_snapshot`
ORDER BY client_name;

-- C) Monthly articles per editor (Team KPIs → Monthly Articles)
SELECT month_year, editorial_pod, client_name, editor_name,
       count AS articles, revised, second_reviews, published, matched
FROM `graphite-data.graphite_bi_sandbox.v_editorial_fct_articles_monthly`
ORDER BY month_year, editorial_pod, client_name;

-- D) Revision rate % + 2nd review % (pooled, by pod & creation month)
SELECT month_year, editorial_pod,
       SUM(count) articles, SUM(revised) revised,
       ROUND(SUM(revised)        / NULLIF(SUM(count),0) * 100, 1) AS revision_rate_pct,
       ROUND(SUM(second_reviews) / NULLIF(SUM(count),0) * 100, 1) AS second_review_pct
FROM `graphite-data.graphite_bi_sandbox.v_editorial_fct_articles_monthly`
GROUP BY month_year, editorial_pod ORDER BY month_year, editorial_pod;

-- E) Revision events by their own month
SELECT month_year, editorial_pod, SUM(revisions) revisions
FROM `graphite-data.graphite_bi_sandbox.v_editorial_fct_article_revisions`
GROUP BY month_year, editorial_pod ORDER BY month_year;

-- F) Capacity utilization by pod & month
SELECT year, month, pod, total_capacity, projected_used_capacity, actual_used_capacity,
       ROUND(actual_used_capacity / NULLIF(total_capacity,0)        * 100, 1) AS pct_util_real,
       ROUND(actual_used_capacity / NULLIF(projected_used_capacity,0) * 100, 1) AS pct_util_weighted,
       total_capacity - projected_used_capacity AS spare
FROM `graphite-data.graphite_bi_sandbox.v_editorial_fct_capacity_pods`
ORDER BY year, month, pod;

-- G) Per-editor utilization for one month
SELECT pod, member, capacity, articles, pct_util_real, pct_util_weighted
FROM `graphite-data.graphite_bi_sandbox.v_editorial_fct_member_utilization`
WHERE year = 2026 AND month = 5 ORDER BY pod, member;

-- H) Pod Snapshot (Overview), editorial axis
SELECT pod, client_count, q_actual_delivered, q_projected_end, q_invoiced,
       q_variance_excl_new, lifetime_delivered, articles_sow, published_live
FROM `graphite-data.graphite_bi_sandbox.v_editorial_fct_pod_snapshot`
WHERE pod_axis = 'editorial' ORDER BY pod;

-- I) Average days per lifecycle milestone transition
SELECT transition, ROUND(AVG(days),1) avg_days, COUNT(*) n
FROM `graphite-data.graphite_bi_sandbox.v_editorial_fct_milestone_transitions`
GROUP BY transition ORDER BY transition;

-- J) Cumulative pipeline per client (Topics → CBs → Articles → Published)
SELECT client_name, topics_approved, cbs_sent, articles_sent, published_live
FROM `graphite-data.graphite_bi_sandbox.v_editorial_fct_pipeline`
ORDER BY client_name;

-- K) Current editor/writer roster
SELECT canonical_name, role, source, status, is_active
FROM `graphite-data.graphite_bi_sandbox.v_editorial_roster`
ORDER BY role, is_active DESC, canonical_name;
```

---

## 7. Gotchas (the things that bite)

1. **Client id space** — join production/deliverables/articles on `editorial_raw_clients.id`, never `editorial_clients` (renumbered 463+, stale).
2. **`editor_canonical` is always NULL** — the editor canonical lives in `editor_name`. Only writers use `writer_canonical`.
3. **`editorial_raw_articles` grain is article×editor** — `COUNT(DISTINCT article_uid)` for article counts, `COUNT(*)` for editor credits.
4. **~4k articles have NULL `client_id`** (unresolved tab names) — they carry no pod; exclude or treat as "Unassigned".
5. **Goals/cumulative join by name** (fuzzy) — a few rows won't match a client; don't assume 100%.
6. **Rates are pooled, not averaged** — always `Σ num ÷ Σ den` across rows, never `AVG(rate)`.
7. **Revisions bucket two ways** — revision *rate* is by article creation month; revision *events* are by each revision's own month (different views).
8. **Names normalize at the source** — unmapped first-name fragments ("James", "Nicholas") stay raw and are *not* in the roster; they surface in Data Quality → Article mappings until mapped. Map once in the Editorial Name Mappings sheet → flows to BQ → the view → the roster automatically.
9. **`is_actual` splits production** — `TRUE` = closed/historical actuals, `FALSE` = forecast; `projected_original` keeps the pre-close projection for trend analysis.
10. **Freshness** — the warehouse republishes on each SYNC (button or daily cron ~09:00 UTC); querying BQ always returns the latest published rows.

---

*Generated 2026-06-26 against `graphite_bi_sandbox`. Schema/grain verified live. Companion docs:
`etl/WAREHOUSE_DESIGN.md` (design + bug register), `BUSINESS_RULES.md` (content-type matrix +
worked examples), root `CLAUDE.md` (architecture + sync manifest).*
