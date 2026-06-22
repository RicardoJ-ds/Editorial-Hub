---
name: metrics-end-of-q-variance-tiers
description: "Billing periods + Current-Q metric: the bar reads ACTUAL delivered-to-date but variance/tier come from PROJECTED end-of-Q. The 5 variance tiers + ±5 thresholds, billing-period detection, 1st-Q escape hatch."
metadata:
  node_type: memory
  type: reference
  originSessionId: 3fa962ac-9be0-4852-8c63-16ff918094cb
---

# End-of-Q Variance + Tiers

The single most-misread Overview mechanic. Computed in `pyrules.py` (warehouse) ←→
`shared-helpers.tsx` (FE), proven identical (`PARITY_REPORT_WAREHOUSE.md`: 3,612 snapshot fields).
Stored per client per `as_of_date` in `editorial_int_client_q_snapshot` (the "variance brain").

## 1. The dual semantic — bar ≠ variance (the key gotcha)
In EVERY Current-Q surface (`QTile` pod tile, `ClientQCell`, popover `QSummaryBars`, `QuarterRow`):
- **Progress BAR numerator = ACTUAL cumulative delivered through the last completed month** (`cq.delivered` / `actual_cum_delivered`). Denominator = cumulative invoiced through end-of-Q.
- **Variance NUMBER + tier chip = PROJECTED end-of-Q outcome.**

So the bar shows real progress-to-date while the chip judges where the quarter will *land*. Shipped 0.3.15 (May 25, bar→actual) / 0.3.18 (May 28, restated).

⚠️ Seam in the pod aggregator (`PeriodSnapshotSection.tsx:1199-1215`): the row object's `delivered` field is set to `cq.projectedEnd`, while `actualDelivered`/`currentQActualDelivered` holds `cq.delivered`. The bar consumes actual; the chip consumes projected.

## 2. Projected end-of-Q + variance (`compute_current_q`, `pyrules.py:274-312`)
```
actual_cum_delivered = Σ delivered for non-future months (contract start → now)
projected_remaining  = Σ delivered for FUTURE months IN the current Q only
projected_end        = actual_cum_delivered + projected_remaining
projected_variance   = projected_end − end_of_q_cum_invoiced     # CUMULATIVE from contract start
```
Variance is **cumulative from start**, so over-delivery that catches up nets earlier-Q deficits (e.g. `−14 last Q + 14 this Q` reads **0**).

## 3. Variance tiers (`varianceTier`, `shared-helpers.tsx:409` ←→ `variance_tier`, `pyrules.py:72`)
Classifies on `Math.round(v)` (JS half-up `js_round`, so color matches the displayed integer). `VARIANCE_WITHIN_LIMIT = 5`:

| Condition | Key | Label | Color |
|---|---|---|---|
| `isNew` (1st contract Q) | `new` | **1st Q** | `#8FB5D9` blue |
| `v === 0` | `onTrack` | **On track** | `#42CA80` green |
| `1 ≤ \|v\| ≤ 5` | `withinLimit` | **Within limit** | `#F5BC4E` amber |
| `v > 5` | `ahead` | **Ahead** | `#ED6958` red |
| `v < −5` | `behind` | **Behind** | `#ED6958` red |

- **Symmetric / magnitude-based since 0.3.21 (Jun 8)** — being far ahead is flagged red like far behind, because over-delivered work isn't billed yet.
- `isOffTarget(v,isNew)` = key ∈ {ahead, behind} → drives "Needs Attention" + Pod Attention.
- Single source of truth: every chip/cell routes through `varianceTier`/`varianceTierColor`/`varianceTierBg` (`varianceTierBg` composites at α=0.16 **opaque** to avoid muddy brown over the green current-Q highlight).
- Plain-English subline (`varianceSubline`, 0.3.22): `0 → "matches invoiced"`, `+15 → "15 more than invoiced"`, `−5 → "5 fewer than invoiced"`.

## 4. Billing periods
**Rule** (`detect_summary_billing_periods` `:174` Overview; `detect_d1_billing_periods` `:209` D1):
- A month with **invoiced > 0 OPENS** a billing period (quarter); `invoiced == 0` months join the open period; months before first invoicing = **prelude** (`is_prelude`, unlabeled).
- **Labels** (`_label_periods` `:150`): `Q1..Qn` per contract year; `yearIdx = floor((monthsSinceStart−1)/12)`; year 2+ append `" Y{n}"` (e.g. `"Q1 Y2"`).
- `is_future` = month > `last_completed_calendar_month` (`pyrules.py:33`).
- **Calendar-month basis** (like all of deliverables/production/goals/variance); never blended with the editorial-month article basis.

⚠️ **B3**: the Overview detector has NO post-contract handling; D1's truncates finished clients (status COMPLETED/INACTIVE/PAUSED) past `end_date` into `is_post_contract`. So a finished client can tier differently across `/overview` vs Editorial Clients. Warehouse keeps BOTH: `editorial_int_client_months` carries `ovr_period_*` + `d1_period_*`.

## 5. 1st-Q escape hatch
Pod-aggregate Current-Q **delivered/invoiced bars INCLUDE 1st-Q clients** (their delivered is real and must reconcile with %SOW). Only the pod-level **variance + pace-weight** skip 1st-Q clients (`PeriodSnapshotSection.tsx:1208-1224`). Shipped 0.3.15.

## 6. Dated decisions
| Date | Ver | What |
|---|---|---|
| May 4 | 0.3.2 | Articles stage counts **Sent**, not Approved (what the Master Tracker bills); %=Sent÷SOW |
| May 13 | 0.3.7 | **Cumulative-through-end-of-Q** variance everywhere; 1st-Q clients excluded from triage |
| May 25 | 0.3.15 | **Current-Q bar = actual delivered-to-date**; variance still projected end-of-Q; pod bars include 1st-Q |
| Jun 8 | 0.3.21 | **Variance tiers made symmetric** (±5; "Ahead" red); one shared classifier (had drifted across 5 components) |

## 7. Open threads
- **B4**: D1 popover `cum_delivered` includes future projections; `compute_last_full_q` doesn't (`pyrules.py:367`) — replicated deliberately.
- `as_of_date` snapshots depend on "today" (browser clock); int tables stamp the build date so parity runs same-day.
- Goals weighting that feeds the Goals column → [[metrics-goals-content-weighting]]. Warehouse-serving map → [[metrics-warehouse-int-layer]].
