# Capacity Planning v2 — Dashboard Coverage Audit

> **Last reviewed:** 2026-04-18
>
> **Purpose.** Prove that the proposed `cp2_*` schema can feed every metric on the
> two current production dashboards (Editorial Clients, Team KPIs). Written
> against the live source of truth: `backend/app/models.py` and the frontend
> pages under `frontend/src/app/(app)/editorial-clients/` +
> `frontend/src/app/(app)/team-kpis/`.
>
> **Method.** Three parallel audits:
> 1. Enumerate every field / chart / filter on the Editorial Clients dashboard.
> 2. Same for Team KPIs (3 tabs).
> 3. Dump the full backend SQLAlchemy schema (16 tables, 250+ columns).
> 4. Cross-check against the current cp2_* ERD (`_erd.ts`).
>
> **Reality check (2026-04-18).** This audit remains the canonical coverage
> spec. What has changed since it was first written:
> - **Zero `cp2_*` tables exist yet** in `backend/app/models.py` — phases 1–8
>   of the CP v2 UI are shipped but entirely `localStorage`-backed.
> - The ERD source of truth is split between this file +
>   [`/CAPACITY_PLANNING_V2.md`](CAPACITY_PLANNING_V2.md) +
>   `frontend/src/app/(app)/capacity-planning/_erd.ts` — they are consistent.
> - The **Contract & Timeline detail table was reduced from 17 → 9 columns**
>   (commit `dc278ae`, Apr 16). The 9-column shape is still fully covered by
>   `cp2_dim_client`; the extra 8 columns remain on `cp2_dim_client` for
>   optional future re-expansion.
> - The **Client Delivery Detail table** under Deliverables vs SOW was removed
>   (commit `4e3e14a`) because the per-client cards above it carry the same
>   data. No coverage impact — same fields, different UI.
> - The **Delivery-vs-Invoicing chart** was flipped to `Delivered ÷ Invoiced`
>   (commit `3a07fa2`). `cp2_fact_delivery_monthly` exposes both numerator and
>   denominator, so the direction is a UI choice; coverage unchanged.
> - See [`.docs/dashboard-data-flow.md`](.docs/dashboard-data-flow.md) for the
>   per-metric migration sequence from today's legacy tables onto `cp2_*`.

---

## 1. Coverage summary

| Dashboard section | Covered by cp2_* before audit? | Covered after audit? |
|---|---|---|
| **Editorial Clients — SOW Overview** | Partial (only 11 client fields) | ✅ Full (36 client fields) |
| **Editorial Clients — Time-to metrics (8 date deltas)** | Partial (3 of 6 milestones) | ✅ Full (all 6 milestones) |
| **Editorial Clients — Client Engagement Timeline** | Missing term_months, cadence_q1..q4, word_count_min/max | ✅ Added |
| **Editorial Clients — Contract & Timeline Detail table** | Missing sow_link, growth_pod string, project_type, MD/AD/AM/JrAM/CS | ✅ Added |
| **Editorial Clients — Delivery Overview** | Partial (no sow_target, paid, CBs) | ✅ Full |
| **Editorial Clients — Production Trend** | Missing | ✅ New table `cp2_fact_production_history` |
| **Editorial Clients — Client Delivery Matrix** | Partial | ✅ Full (CB columns + projected added) |
| **Editorial Clients — Cumulative Pipeline** | Partial (no denorm fields, no pct strings, no comments) | ✅ Full |
| **Editorial Clients — Weekly Goals vs Delivery** | Under-spec'd (only delivered/goal ints) | ✅ Full (21 CB+AD columns) |
| **Editorial Clients — Pacing** | Missing | ✅ New table `cp2_dim_delivery_template` |
| **Team KPIs — 9 KPI heatmap** | Partial (no client_id per-score) | ✅ `client_id` added |
| **Team KPIs — Per-client breakdown cards** | Missing | ✅ Supported via `client_id` on score |
| **Team KPIs — Pod groupings (Avg Utilization / Quality)** | Derivable from pod_membership + kpi_score | ✅ OK |
| **Team KPIs — Capacity Projections tab** | Partial (no version field, no actual vs projected distinction) | ✅ Version added, actual tracked |
| **Team KPIs — AI Compliance summary** | Covered by `cp2_fact_ai_scan` | ✅ Strengthened with denorm fields |
| **Team KPIs — AI Compliance breakdowns (by pod/client/writer/month)** | Covered | ✅ OK |
| **Team KPIs — Flagged + Rewrites tables** | Missing topic_title, article_link, manual review notes, action, date_processed | ✅ Added |
| **Team KPIs — Surfer API Usage table** | Missing | ✅ New table `cp2_fact_surfer_api_usage` |

**Verdict:** all 18 dashboard sections are now covered by the expanded cp2_* ERD.

---

## 2. Gaps closed — field-by-field

### 2.1 `cp2_dim_client` — expanded from 13 → 36 fields

| Added field | Type | Source today | Why it's needed |
|---|---|---|---|
| `name` | string | `clients.name` | Display everywhere; currently only `client_id_fk` |
| `domain` | string | `clients.domain` | Client profile pages, email attribution |
| `status` | enum | `clients.status` | Filter bar + status badges |
| `growth_pod` | string | `clients.growth_pod` | Pod column on Contract & Timeline Detail |
| `editorial_pod` | string | `clients.editorial_pod` | Pod column + timeline bar color |
| `term_months` | int | `clients.term_months` | "12mo" badge in timeline |
| `cadence_q1..cadence_q4` | int × 4 | `clients.cadence_q*` | Quarterly cadence bars in engagement timeline |
| `word_count_min/max` | int × 2 | `clients.word_count_min/max` | "1000–2000" word count column |
| `sow_link` | text | `clients.sow_link` | Clickable badge in detail table |
| `project_type` | string | `clients.project_type` | Filters + metadata |
| `consulting_ko_date` | date | `clients.consulting_ko_date` | Milestone waterfall start anchor |
| `editorial_ko_date` | date | `clients.editorial_ko_date` | Time-to-EKO delta |
| `first_feedback_date` | date | `clients.first_feedback_date` | Time-to-Feedback delta |
| `managing_director`/`account_director`/`account_manager`/`jr_am` | string × 4 | `clients.*` | Staffing columns |
| `cs_team` | text | `clients.cs_team` | CS team roster |
| `comments` | text | `clients.comments` | Free-form notes |
| `articles_delivered`/`articles_invoiced`/`articles_paid` | int × 3 | `clients.*` | Cumulative totals shown as summary cards |

### 2.2 `cp2_fact_kpi_score` — added `client_id`

The Team KPIs page renders two sets of KPIs per member:
- Aggregate (across all clients): `WHERE client_id IS NULL`
- Per-client breakdown cards: `GROUP BY client_id`

The original `cp2_fact_kpi_score` only had `(team_member_id, metric_id, month_key)` as the grain. Added nullable `client_id` FK so both views are possible with the same table.

### 2.3 `cp2_fact_delivery_monthly` — added 5 fields

| Added field | Type | Why |
|---|---|---|
| `articles_sow_target` | int | Displayed next to delivered in the Client Delivery Matrix |
| `articles_paid` | int | Per-month paid count (today only cumulative on `clients`) |
| `articles_projected` | int | Monthly projection from operating model (was going into `production_history`) |
| `is_actual` | bool | Distinguishes actual vs projected rows (from `production_history`) |
| `content_briefs_delivered` / `content_briefs_goal` | int × 2 | CB metrics in the Client Delivery Matrix |

### 2.4 `cp2_fact_actuals_weekly` — full CB + AD tracking

Original had only `delivered_articles` + `goal_articles`. The real `GoalsVsDelivery` table has **23 columns** covering both CB and AD workflows. Expanded to match:

- Week identity: `week_key`, `month_year_key`, `week_number`, `week_date`, `client_id`, `pod_id`
- Denormalized context: `growth_team_pod`, `editorial_team_pod`, `client_type`, `content_type`, `ratios`
- **CB metrics**: `cb_delivered_today`, `cb_projection`, `cb_delivered_to_date`, `cb_monthly_goal`, `cb_pct_of_goal`, `cb_comments`
- **AD metrics**: `ad_revisions`, `ad_delivered_today`, `ad_projection`, `ad_cb_backlog`, `ad_delivered_to_date`, `ad_monthly_goal`, `ad_pct_of_goal`, `ad_comments`
- Audit: `ingested_at`

### 2.5 `cp2_fact_ai_scan` — added 8 denorm fields

Flagged Articles and Rewrites tables need per-article detail that the current shape didn't expose:

- `topic_title`, `topic_content`, `article_link` — display columns
- `writer_name`, `editor_name` — string denorm for legacy display before writer_id/editor_id are fully wired
- `manual_review_notes`, `action` — human-review metadata
- `date_processed` — scan date for sorting

### 2.6 `cp2_fact_pipeline_snapshot` — added 7 denorm fields

Cumulative Pipeline section shows per-client metadata alongside approval counts:

- `status`, `account_team_pod`, `client_type`, `content_type` — denorm for filter/display
- `articles_difference` — signed delta that's stored not derived
- `last_update`, `comments` — audit metadata
- `topics_pct_approved`, `cbs_pct_approved`, `articles_pct_approved`, `published_pct_live` — percentage strings (e.g., "85%") stored as strings to match source data

### 2.7 New tables

| Table | Purpose |
|---|---|
| `cp2_dim_delivery_template` | SOW-size × month-number cadence table used by Pacing calc. Fields: `sow_size`, `month_number`, `invoicing_target`, `invoicing_cumulative`, `delivery_target`, `delivery_cumulative`. |
| `cp2_fact_surfer_api_usage` | Per-pod-per-month API spend. Fields: `year_month_key`, `start_date`, `end_date`, `pod_1..pod_5`, `auditioning_writers`, `rewrites`, `total_spent`, `remaining_calls`. |
| `cp2_fact_production_history` | Per-client-per-month projected vs actual. Fields: `client_id`, `month_key`, `articles_actual`, `articles_projected`, `is_actual`, `source`. Kept separate from `cp2_fact_delivery_monthly` so we can preserve the operating-model projections alongside actualized deliveries without overwriting. |
| `cp2_dim_engagement_rule` | The "10 Commandments" rule catalog used today for compliance scoring. Fields: `rule_number`, `area`, `rule_name`, `description`, `owner`, `timing`, `consequences`. |
| `cp2_dim_model_assumption` | Key-value business assumptions (ramp-up periods, thresholds, etc.). Fields: `category`, `key`, `value`, `description`. |

---

## 3. Derived metrics — confirmed computable from the ERD

For each metric that is **computed**, not stored, we verified the required inputs exist.

| Metric | Formula | Inputs live in |
|---|---|---|
| Time-to-EKO / -CB / -Article / -Feedback / -Published (8 deltas) | Date subtraction | `cp2_dim_client.*_date` |
| % complete | `articles_delivered / articles_sow_total × 100` | `cp2_dim_client` + `cp2_fact_delivery_monthly` |
| Variance (month) | `articles_delivered - articles_sow_target` | `cp2_fact_delivery_monthly` |
| Variance (all-time) | `Σ variance` | `cp2_fact_delivery_monthly` |
| Avg Completion % | avg across clients | `cp2_dim_client` |
| Pacing status | cumulative delivered vs template.delivery_cumulative for months_elapsed | `cp2_dim_delivery_template` + `cp2_fact_delivery_monthly` + `cp2_dim_client.contract_start` |
| AI Full Pass % | `count(recommendation=FULL_PASS) / count(*) × 100` | `cp2_fact_ai_scan` |
| Revision Rate | `count(revision_count > 0) / count(*) × 100` grouped by writer/month | `cp2_fact_article` |
| Turnaround Time | `avg(turnaround_days)` grouped by editor/month | `cp2_fact_article` |
| Second Reviews | `count(had_second_review = true)` grouped by sr_editor/month | `cp2_fact_article` |
| Capacity Utilization | `projected_use / total_capacity × 100` from `cp2_v_pod_monthly` | view over `cp2_fact_pod_membership` + `cp2_fact_client_allocation` + `cp2_fact_member_leave` + `cp2_fact_capacity_override` |
| Pod Over/Optimal/Under | utilization buckets (<80 / 80–85 / 85–100 / >100) | same view |
| Avg Quality (pod rollup) | `avg(internal_quality + external_quality)` for members in pod | `cp2_fact_kpi_score` + `cp2_fact_pod_membership` |
| Avg Utilization (pod rollup) | same | same |

---

## 4. What to do next (outside this audit's scope)

- Write real Alembic migrations for every new column / table (post-approval).
- Create a seed / ETL script that populates `cp2_*` from today's tables. The `/capacity-planning/migration` dry-run already demonstrates the happy path for `cp2_dim_client` + `cp2_dim_team_member`; extend to the other 17 dim/fact tables.
- Backfill `cp2_fact_article` from `notion_articles` (direct map, `notion_case_id` → `case_id`, writer/editor strings → lookup on `cp2_dim_team_member.full_name`).
- Decide whether `production_history` lives as its own fact or merges into `delivery_monthly.articles_projected + is_actual`. Audit currently keeps both.
- Decide how to handle Notion articles whose `client_name` string doesn't match any `cp2_dim_client.name` — today's fallback is to skip.

---

## 5. Ground-truth references (for reviewers)

- Editorial Clients page: `frontend/src/app/(app)/editorial-clients/page.tsx`
- Team KPIs page: `frontend/src/app/(app)/team-kpis/page.tsx`
- KPI card component: `frontend/src/components/dashboard/KpiCard.tsx`
- Backend models: `backend/app/models.py`
- Backend routers: `backend/app/routers/{clients,deliverables,kpis,capacity,ai_monitoring,goals_delivery,dashboard,notion_articles,team_members}.py`
- CP v2 ERD (this repo): `frontend/src/app/(app)/capacity-planning/_erd.ts`
- CP v2 proposal: `CAPACITY_PLANNING_V2.md`
