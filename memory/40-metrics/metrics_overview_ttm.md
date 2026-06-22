---
name: metrics-overview-ttm
description: "Overview dashboard: Pod Delivery Progress card columns, the 6 lifecycle milestones + 8 time-to transitions (legend-only numbering), negative-day Bug B5 handling, Production History (actual/projected/projected_original)."
metadata:
  node_type: memory
  type: reference
  originSessionId: 3fa962ac-9be0-4852-8c63-16ff918094cb
---

# Overview Dashboard Metrics

`/overview`, `PeriodSnapshotSection.tsx` + `ProductionTrendChart.tsx`, one `FilterBar`. Warehouse
(`pyrules.py`) ports every FE math fn byte-for-byte; dashboards read the warehouse views.
Variance/tiers live in their own file → [[metrics-end-of-q-variance-tiers]].

## 1. Pod Delivery Progress card (`PodDeliveryProgressCard` `:618`)
Per-pod rows, expandable to per-client. Columns: `chevron · name · Goals · Current Quarter · %SOW · %Published` (Last Q hidden from the grid in 0.3.17, still in popover).
| Column | Shows | Source |
|---|---|---|
| **Goals** | CBs+Articles vs monthly goal, content-type-weighted. **Only period-scoped column** (own `goalsPeriod`, default 1m) | `v_editorial_fct_goals_monthly` — see [[metrics-goals-content-weighting]] |
| **Current Quarter** | Delivered + Invoiced bars + variance/tier chip (**bar=actual, chip=projected**) | `computeCurrentQ` — see [[metrics-end-of-q-variance-tiers]] |
| **%SOW** | lifetime delivered ÷ contracted SOW | `int_client_q_snapshot.lifetime` |
| **%Published** | `published_live ÷ SOW` (`published_live` from `cumulative_metrics` joined by name) | cumulative ⨝ snapshot |

## 2. The 6 lifecycle milestones (`MILESTONE_NUM_BY_FIELD` `shared-helpers.tsx:162`)
| # | Milestone | Field |
|---|---|---|
| 1 | Consulting KO | `consulting_ko_date` |
| 2 | Editorial KO | `editorial_ko_date` |
| 3 | First CB Approved | `first_cb_approved_date` |
| 4 | First Article | `first_article_delivered_date` |
| 5 | First Feedback | `first_feedback_date` |
| 6 | First Published | `first_article_published_date` |

## 3. The 8 time-to-milestone transitions (`TTM_METRICS` `:2014`; view `v_editorial_fct_milestone_transitions`)
Each = `DATE_DIFF` in calendar days: `cko_eko` (1→2), `cko_cb` (1→3), `cko_art` (1→4), `cko_fb` (1→5), `cb_art` (3→4), `cko_pub` (1→6), `art_fb` (4→5), `fb_pub` (5→6).
- `PodTTMStatsCard` (`:2032`) = avg/min/max/count per transition.
- `PodMilestoneJourneyCard` (`:2393`) = per-client timelines on a unified day-axis from Consulting KO (Day 0). `TimeToTrendChart` = per-client days bar + metric dropdown.
- **Numbering placement (0.3.22, Jun 8):** the `N→M` prefix appears **ONLY in the Pod Timelines legend**. Stripped from stat-card titles, contributor/journey tooltips, and the dropdown (readable name only). `milestonePairPrefix` (`:173`) still serves the LEGACY `TimeToMetrics` cards on Editorial Clients — don't touch it. **Don't re-add the prefix to cards/tooltips.**

## 4. Negative day-deltas — Bug B5 (decision: SHOW everywhere)
A milestone can be logged before its predecessor (e.g. CB approved 2 days before the Consulting KO date) → negative delta = a **real data anomaly**.
**Decision (0.3.27, Jun 18): show negatives on ALL surfaces** so cards agree. Previously `PodTTMStatsCard` filtered `days >= 0` and read "—"/0 while timelines + Per-Client Days (which only null-filter) showed the value. Now the stat card keeps negatives (`d !== null`, `:2058-2074`); a pre-CKO dot gets a **red ring** + signed `{days}d` label in red mono (`:3363,:3440`).
⚠️ Stale comment: `views.py:156` / `WAREHOUSE_DESIGN.md:215` still say "stats-card filters days >= 0" — the FE stopped in 0.3.27; the warehouse view emits negatives regardless, so numbers still match.

## 5. Production History (`ProductionTrendChart.tsx`, `production_history` → `v_editorial_fct_production_monthly`)
Upsert key `(client_id, year, month)`.
| Field | Meaning |
|---|---|
| `articles_actual` | delivered actuals (past) |
| `articles_projected` | live projection |
| `is_actual` | month closed/actual (default True) |
| `projected_original` | the ET CP per-month client-block "Projected" for ALL months: **past = the projection frozen before the month closed**; future = mirrors live. Filled by `_ingest_et_cp_year()`, never touches actual/projected. Foundation for future %-utilization-per-editor |
**Three views:** All (combined line + gradient) · Per pod · **Per client** (only when filter narrows to one pod). Tooltip rendered outside Recharts (`position:fixed`, viewport-clamped). ⚠️ **B11**: client delivered falls back to `clients.articles_delivered` only when Σactual=0; all-zero clients skipped.

## 6. Dated decisions
| Date | Ver | What |
|---|---|---|
| May 4 | 0.3.2 | New `/overview` dashboard; milestone journey grouped by Growth Pod |
| May 25 | 0.3.15 | Overview rebuilt: Pod Snapshot + **Time to Milestones** + Production History; milestone numbering 1–6 introduced |
| Jun 1 | 0.3.20 | Time-to-Milestones section + 8-transition metrics + Per-Client Days |
| Jun 8 | 0.3.22 | Milestone numbers → **legend only**; dates forced to English |
| Jun 18 | 0.3.27 | **Negative TTM days shown on all surfaces** (B5) with red ring |

## 7. Open threads
- Stale `days>=0` doc comment (above). B3 billing-period divergence + B12 %SOW denominator → [[metrics-end-of-q-variance-tiers]], [[metrics-goals-content-weighting]].
- Warehouse-serving map + full bug register → [[metrics-warehouse-int-layer]].
