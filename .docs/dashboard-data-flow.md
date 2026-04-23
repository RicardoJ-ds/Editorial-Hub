# Dashboard Data Flow & CP v2 Migration Plan

> **Last reviewed:** 2026-04-23
>
> **Purpose.** One document to answer three questions:
> 1. Where does each dashboard metric come from today (sheet → table → endpoint → component)?
> 2. Where is the same metric duplicated across sheets/tables, and which one is authoritative?
> 3. When the CP v2 schema lands, which metrics migrate first and which wait?
>
> **Audience.** Anyone asking "why are we ingesting this sheet?" or "how do I stop
> editing the spreadsheet and start editing the app?".
>
> Companion docs: [`CAPACITY_PLANNING_V2.md`](../CAPACITY_PLANNING_V2.md) (ERD),
> [`CP2_COVERAGE_AUDIT.md`](../CP2_COVERAGE_AUDIT.md) (column-level coverage),
> [`sheet-inventory.md`](sheet-inventory.md) (raw sheet list),
> [`../frontend/docs/SHEETS_DOCUMENTATION.md`](../frontend/docs/SHEETS_DOCUMENTATION.md) (per-sheet column reference).

---

## 1. Today's flow (per dashboard section)

### Editorial Clients — `/editorial-clients`

**Layout on Dashboard 1** (two tabs, h2-sectioned):

- *Contract & Timeline* tab → `Time-to Metrics` section + `Contract & Timeline` parent section (Client Engagement Timeline + Contract & Timeline Detail children).
- *Deliverables vs SOW* tab → `Delivery Overview` + `Cumulative Pipeline` + `Monthly Goals vs Delivery` sections.

| Dashboard section | Component | Endpoint | DB table | Source sheet |
|---|---|---|---|---|
| Filter bar (client search + editorial/growth pod + status + date range) | `FilterBar` | `GET /api/clients/` | `clients` | Editorial SOW overview |
| **Time-to Metrics** (8 milestone delta cards + per-client breakdown bar chart + Milestone Journey waterfall) | `TimeToMetrics` | `GET /api/clients/` (client-side deltas) | `clients` (milestone date cols) | Editorial SOW overview |
| **Client Engagement Timeline** (per-client article cadence, monthly/quarterly toggle, actual+projected bars, totals sidebar) | `ClientEngagementTimeline` (inlined in page) | `GET /api/dashboard/client-production` | `clients`, `production_history` | SOW overview + Editorial Operating Model |
| **Contract & Timeline Detail** (flat table, 9 cols; "Open source sheet" button links to Master Tracker) | table in `editorial-clients/page.tsx` | `GET /api/clients/` | `clients` | SOW overview |
| **Delivery Overview** (5 summary cards: Client Status / Approval-progress mix, Total Delivered vs SOW, Invoiced, Variance, Avg Completion %) | `DeliverablesSOWTab` (inlined) + `FilterContextCard` + `SummaryCard` | `GET /api/deliverables/` + `GET /api/dashboard/pacing` | `deliverables_monthly`, `delivery_templates`, `clients` | Delivered vs Invoiced v2 + Delivery Schedules |
| Production History chart (inside Delivery Overview) | `ProductionTrendChart` | `GET /api/dashboard/client-production` (filtered) | `production_history` | Editorial Operating Model |
| Client Notes panel (inside Delivery Overview, only when any filtered client has notes) | `ClientNotesPanel` | reads `Client.comments` from `/api/clients/` | `clients.comments` | SOW overview comments col |
| Client Delivery At a Glance (per-client cards grouped by editorial pod; monthly-detail popover) | `ClientDeliveryCards` | same as Delivery Overview | `deliverables_monthly`, `clients` | Delivered vs Invoiced v2 + SOW overview |
| Delivery vs Invoicing % heatmap (optional, embedded) | `DeliveryTrendChart` | `GET /api/deliverables/?limit=1000` | `deliverables_monthly`, `clients` | Delivered vs Invoiced v2 |
| **Cumulative Pipeline** (5 summary cards: Approval Progress mix + Topics/CBs/Articles/Published vs SOW) | `CumulativePipelineSection` | `GET /api/goals-delivery/cumulative` | `cumulative_metrics` | Master Tracker — Cumulative |
| Pipeline by Editorial Pod (SOW-relative heatmap) | `PipelineFunnelChart` | same | `cumulative_metrics` | Master Tracker — Cumulative |
| Per-client pipeline cards (grouped by editorial pod) | `ClientPipelineCard` | same | `cumulative_metrics` | Master Tracker — Cumulative |
| **Monthly Goals vs Delivery** (4 summary cards + pod-aggregate gauges + unified month-range table with expandable weekly breakdown) | `GoalsVsDeliverySection`, `GoalsMonthTable`, `PodGoalsRow` | `GET /api/goals-delivery/all` (range-aware) | `goals_vs_delivery` | Master Tracker — Goals vs Delivery (×9) |
| Pacing badges (inside per-client cards) | `PacingBadge` | `GET /api/dashboard/pacing` | `delivery_templates`, `deliverables_monthly`, `clients` | Delivery Schedules + Delivered vs Invoiced v2 |

### Team KPIs — `/team-kpis`

| Dashboard section | Component | Endpoint | DB table | Source sheet |
|---|---|---|---|---|
| 9-KPI heatmap (per member × KPI) | `TeamKpisPage` | `GET /api/kpis/?team_member_id=X&month=Y&client_id=Z` | `kpi_scores` | Monthly KPI Scores (manual entry) + Notion (Revision / Turnaround / Second Reviews) |
| Per-client breakdown cards | `KpiCard` expandable | same (grouped by `client_id`) | `kpi_scores` | same |
| Pod rollups (Quality, Utilization) | summary cards | aggregation of `/api/kpis/` + `/api/capacity/` | `kpi_scores`, `capacity_projections`, `team_members` | KPI Scores + ET CP 2026 |
| Capacity Projections tab | `TeamKpisPage` tab 2 | `GET /api/capacity/` + `/api/dashboard/kpis/capacity-summary` | `capacity_projections` | ET CP 2026 [V11 Mar 2026] |
| AI Compliance summary | `AIComplianceTab` | `GET /api/ai-monitoring/summary` | `ai_monitoring_records` | Writer AI Monitoring — Data |
| AI Flagged + Rewrites tables | same | `GET /api/ai-monitoring/records?filters` | `ai_monitoring_records` (is_flagged / is_rewrite) | Yellow-Red Flags v2 / Rewrites |
| Surfer API Usage | same | `GET /api/surfer-api/usage` | `surfer_api_usage` | Writer AI Monitoring — Surfer's API usage |

### CP v2 prototype — `/capacity-planning`

**Entirely mock + `localStorage` today.** No metric on any of the 19 routes reads
from the DB. The front-end store (`_store.tsx`) models the `cp2_*` shape so that
phases 1–8 can keep working unchanged once the backend is ready.

---

## 2. Duplication map — same metric, multiple sources

| Metric | Source A | Source B | Today's winner | Risk |
|---|---|---|---|---|
| `articles_delivered` (per client, cumulative) | `clients.articles_delivered` (from SOW overview, one-time seed) | `SUM(deliverables_monthly.articles_delivered)` (per-month, from Delivered vs Invoiced v2) | Frontend prefers the monthly sum when available; falls back to client cumulative. | **HIGH** — two sources drift as soon as anyone edits one without the other. |
| `articles_invoiced` | `clients.articles_invoiced` (cumulative) | `deliverables_monthly.articles_invoiced` (monthly) | Monthly. | MEDIUM |
| `articles_sow` | `clients.articles_sow` (total contracted) | `SUM(deliverables_monthly.articles_sow_target)` | Client total. | LOW — by design; monthly is just a distribution. |
| Pod assignment per client | `clients.editorial_pod` / `clients.growth_pod` (static string) | `goals_vs_delivery.editorial_team_pod` / `growth_team_pod` (per-week denorm) | `clients.*_pod`. | MEDIUM — stale when mid-year reshuffles happen. |
| Pod assignment per team member | `team_members.pod` (static) | future: `cp2_fact_pod_membership` (per-month) | `team_members.pod`. | **HIGH** once CP v2 lands — legacy string can't express multi-pod / fractional. |
| Articles delivered for a month | `deliverables_monthly.articles_delivered` | `production_history.articles_actual` (Operating Model) + `is_actual` flag | Both live; the Production History chart uses `production_history`, the delivery heatmap uses `deliverables_monthly`. | MEDIUM — different rounding / cutoff dates. |
| Content Briefs delivered (per month) | `deliverables_monthly.content_briefs_delivered` (optional) | `goals_vs_delivery.cb_delivered_to_date` (weekly cumulative) | Goals vs Delivery (latest week per month). | LOW — schemas don't overlap often. |
| Articles published | `cumulative_metrics.published_live` | Notion `notion_articles.published_date` | Notion is richer (per article). Cumulative is all-time count. | LOW |
| Revisions | `cumulative_metrics.articles_approved - articles_sent`? implicit | `notion_articles.revision_count` | Notion. | LOW |
| Time-to-milestone dates | `clients.first_*_date` (hand-entered on SOW overview) | Notion `cb_delivered_date`, `article_delivered_date`, `published_date` (per article) | Client fields (SOW overview). | LOW — Notion is per-article; SOW is per-client first milestone. |
| Pod capacity | `capacity_projections.total_capacity` (pre-computed in ET CP 2026) | Computed from `team_members.monthly_capacity` × pod membership | Pre-computed. | MEDIUM — if roster changes mid-month, projections lag. |

**The big one:** `articles_delivered` split across `clients` (cumulative) +
`deliverables_monthly` (monthly) + `production_history` (monthly with projected).
Three tables, three ingestion paths, one number. CP v2's `cp2_fact_delivery_monthly`
+ `cp2_fact_production_history` collapses this into a single fact with an
`is_actual` flag.

---

## 3. Canonical source, per metric

| Metric | Canonical source today | Long-term (post-CP2) |
|---|---|---|
| `articles_delivered` (monthly) | `deliverables_monthly` | `cp2_fact_delivery_monthly` |
| `articles_delivered` (cumulative) | `clients` | SQL view over `cp2_fact_delivery_monthly` |
| `articles_invoiced` (monthly) | `deliverables_monthly` | `cp2_fact_delivery_monthly` |
| `articles_sow_target` (monthly) | `deliverables_monthly` | `cp2_fact_delivery_monthly` |
| `articles_projected` (monthly) | `production_history` | `cp2_fact_production_history` |
| Content Briefs weekly + monthly | `goals_vs_delivery` | `cp2_fact_actuals_weekly` |
| Cumulative pipeline (topics / CBs / articles / published) | `cumulative_metrics` | `cp2_fact_pipeline_snapshot` (month-scoped) |
| Pod membership (per team member) | `team_members.pod` | `cp2_fact_pod_membership` |
| Client → pod allocation (per month) | `clients.editorial_pod` | `cp2_fact_client_allocation` |
| Pod capacity (total / projected / actual) | `capacity_projections` | `cp2_v_pod_monthly` (view) |
| KPI scores | `kpi_scores` | `cp2_fact_kpi_score` (adds nullable `client_id` — already modeled) |
| Per-article QA (revisions, turnaround, second reviews) | `notion_articles` | `cp2_fact_article` |
| AI scan per article | `ai_monitoring_records` | `cp2_fact_ai_scan` |
| Surfer API usage | `surfer_api_usage` | `cp2_fact_surfer_api_usage` |
| Pacing vs template | `delivery_templates` + `deliverables_monthly` | `cp2_dim_delivery_template` + `cp2_fact_delivery_monthly` |
| Engagement rules | `engagement_rules` | `cp2_dim_engagement_rule` |
| Model assumptions | `model_assumptions` | `cp2_dim_model_assumption` |
| Editorial Engagement Requirements | `engagement_rules` | `cp2_dim_engagement_rule` |
| Meta Calendar months | `deliverables_monthly` (subset) | `cp2_fact_delivery_monthly` |
| Delivery Schedules | `delivery_templates` | `cp2_dim_delivery_template` |

---

## 4. Editable today? (matters for migration order)

A table that the app already lets the user edit can stop syncing from the sheet
sooner — because the app is the source of truth as soon as anyone POSTs a row.

| Table | POST | PUT | Used by which Maintain screen | Migration priority |
|---|---|---|---|---|
| `clients` | ✅ | ✅ | Data Management → Clients | **First** — already app-managed |
| `deliverables_monthly` | ✅ | ✅ | Data Management → Deliverables | **First** |
| `capacity_projections` | ✅ | ✅ | Data Management → Capacity | **First** |
| `kpi_scores` | ✅ | ✅ | Data Management → KPI Entry | **First** |
| `team_members` | — (read-only) | — | — | Second — need to add CRUD, then migrate |
| `engagement_rules`, `delivery_templates`, `model_assumptions` | — | — | — | Low — rarely change; lift-and-shift as dims |
| `cumulative_metrics` | — | — | — | **Blocker** — no edit path; if the Master Tracker sheet is deprecated, corrections need a new backfill flow |
| `goals_vs_delivery` | — | — | — | **Blocker** — same as above |
| `ai_monitoring_records`, `surfer_api_usage` | — | — | — | Second — upstream ingest is paused; low immediate pressure |
| `notion_articles` | — | — | — | Second — Notion is the authoritative source; app only reads |

---

## 5. CP v2 migration sequence

Small, shippable units. Each step retires one spreadsheet column or one legacy
read path — nothing is a long-running branch.

### Phase A — Schema foundation (1–2 days)

1. Alembic migration: create all `cp2_dim_*` tables + `cp2_dim_month` + `cp2_dim_week`. Seed `cp2_dim_month` for 2022-01 → 2028-12 and `cp2_dim_week` for the same span.
2. Alembic migration: create all `cp2_fact_*` tables.
3. Alembic migration: create the three SQL views (`cp2_v_member_effective_capacity`, `cp2_v_pod_monthly`, `cp2_v_pod_monthly_actuals`).
4. Write `backend/scripts/cp2_backfill.py` — one function per legacy → cp2 mapping. Idempotent.

### Phase B — Lift the editable tables first (3–4 days)

5. Backfill `cp2_dim_client`, `cp2_dim_team_member`, `cp2_dim_pod`, `cp2_dim_engagement_tier` from existing tables.
6. Backfill `cp2_fact_delivery_monthly` from `deliverables_monthly` + `production_history` (union on `client_id × month`).
7. Backfill `cp2_fact_pod_membership` + `cp2_fact_client_allocation` from `team_members.pod` + `clients.editorial_pod` (one row per member/month for the current quarter).
8. Backfill `cp2_fact_kpi_score` from `kpi_scores` (1:1, add nullable `client_id`).
9. New routers: `/api/cp2/dims/*`, `/api/cp2/facts/*`, `/api/cp2/views/*`. Mirror the Maintain screens; each endpoint writes through to the DB and returns the updated row.
10. Rewire `_store.tsx` to hit the new endpoints instead of `localStorage`. Phases 1–8 UI does not change.

### Phase C — Dashboard cutover (1 week)

Cut each dashboard section one at a time, behind the same endpoint name.
Validation: A/B the old vs new endpoint on the same request for one sprint;
diff the response bodies in the network tab.

11. `/api/dashboard/client-production` → read from `cp2_fact_production_history` + `cp2_fact_delivery_monthly`. Retire `production_history` seed.
12. `/api/deliverables/` → read from `cp2_fact_delivery_monthly`. Retire `deliverables_monthly` seed.
13. `/api/capacity/` → read from `cp2_v_pod_monthly`. Retire `capacity_projections` seed.
14. `/api/kpis/` → read from `cp2_fact_kpi_score`. Keep the table name (rename is cosmetic).

### Phase D — Move the read-only sources (2 weeks, blocked on edit UI)

15. Build a Maintain screen for `cp2_fact_pipeline_snapshot` (monthly pipeline). Backfill from `cumulative_metrics`.
16. Build a Maintain screen for `cp2_fact_actuals_weekly`. Backfill from `goals_vs_delivery`.
17. Retire the Master Tracker ingestion.

### Phase E — Long tail

18. `cp2_fact_article` backfill from `notion_articles` (writer/editor name → FK lookup).
19. `cp2_fact_ai_scan` + `cp2_fact_surfer_api_usage` — straight rename, add FKs.
20. Drop legacy tables from `backend/app/models.py` + `seed_data.py`.

---

## 6. Decisions to make before Phase A

- **Month/week key format.** Spec says `YYYY-MM` / `YYYY-Www`. Confirm — affects FK shape everywhere.
- **Keep `production_history` separate from `delivery_monthly`?** CP2_COVERAGE_AUDIT.md §2.3 leans toward keeping them separate with an `is_actual` flag. Decide.
- **Notion string → FK resolution.** Writer/editor names on `notion_articles` don't always match `team_members.name`. Ship a fuzzy matcher, or store unmatched as `null` + a `raw_writer_name` column?
- **What happens when a sheet is still edited externally after cutover?** Hard-stop (revoke service-account write access) or keep ingesting as a read-only audit feed for 1 quarter?
- **Who holds the keys during parallel run?** CP maintainer, BI team, both?

Until these are answered the plan above is directional, not scheduled.
