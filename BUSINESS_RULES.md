# Editorial Hub — Business Rules

> Single source of truth for non-obvious domain logic. **Engineers, agents,
> and reviewers — read this before changing an importer, a dashboard
> aggregation, or anything that touches Goals vs Delivery numbers.**
>
> `CLAUDE.md` (root) and `frontend/AGENTS.md` carry one-line summaries
> with pointers back here. This file is the authoritative version.

## Contents

1. [Goals vs Delivery — content-type weighting + ingestion rules](#1-goals-vs-delivery--content-type-weighting--ingestion-rules)
2. *Planned: KPI definitions (D2 heatmap)*
3. *Planned: Tier thresholds (Healthy / Within Limit / Behind / 1st Q)*
4. *Planned: Sync semantics & idempotency keys*

---

## 1. Goals vs Delivery — content-type weighting + ingestion rules

### Why this is non-obvious

The Editorial team's Master Tracker sheet has one row per
`(client, week, content_type)`. The same client can have an Article row,
a Jumbo row, and an LP row in the same week. **Each content type
represents a different amount of editorial effort**, so the Hub's
"Overall" row weights them differently when summing across types.

On top of that, the team **changed how they entered LP rows** in
May 2026 — from "weighted half-units" to "physical units". To preserve
the historical meaning of the Overall row, the importer applies a
content-type-specific transformation at ingestion time, and the
frontend applies a separate weighting at display time. **The two stages
together determine what the Overall row shows.**

A new content type, **Glossary**, lands in June 2026 with a third
variation on the pattern.

### The rule matrix

| Content type | Ingestion transform | DB stored value | Per-type row in Goals popover | Overall row weight | Net Overall = sheet × |
|---|---|---|---|---|---|
| **Article** | none (× 1) | raw | raw | × 1 | × 1 |
| **Jumbo** | none (× 1) | raw | raw | × 2 | × 2 |
| **LP** *(≤ April 2026)* | none (× 1) | raw | raw | × 0.5 | × 0.5 |
| **LP** *(May 2026 →)* | **× 2** at ingestion | doubled | doubled (e.g. `8 / 12`) | × 0.5 | **× 1** (the doublings cancel) |
| **Glossary** *(June 2026 →)* | none (× 1) | raw | raw | × 0.5 | × 0.5 |

**Why LP needs the May-2026 split:** before May, the team entered LP
rows as already-weighted half-units. From May, they switched to
entering *physical counts* (one row per actual LP delivered). To keep
the sheet's apparent total and the Hub's Overall row reading the same
number, the importer doubles the LP CB + AR columns from May onward,
and the display-time × 0.5 brings the Overall row back to the original
physical count.

**Why Glossary is simpler:** the team will enter physical counts, but
they want Glossary to *count as half an article* in the Overall row
(same effort weighting as LP-pre-May). So: ingest raw, weight × 0.5 at
display.

### Worked examples

For each content type, assume the sheet shows `CB del/goal = 4 / 6` in
May 2026.

| Content type | DB row after ingestion | Per-type row renders | Overall contribution (CB) |
|---|---|---|---|
| Article | `cb_delivered=4, cb_goal=6` | `4 / 6 (67%)` | **4 / 6** |
| Jumbo | `cb_delivered=4, cb_goal=6` | `4 / 6 (67%)` | **8 / 12** (×2) |
| LP *(prior to May 2026 same date hypothetical)* | `cb_delivered=4, cb_goal=6` | `4 / 6 (67%)` | **2 / 3** (×0.5) |
| LP *(May 2026 →)* | `cb_delivered=8, cb_goal=12` *(doubled)* | `8 / 12 (67%)` ← shows the doubled value | **4 / 6** (8 × 0.5) |
| Glossary *(June 2026 →)* | `cb_delivered=4, cb_goal=6` | `4 / 6 (67%)` | **2 / 3** (×0.5) |

The `(67%)` per-type completion stays the same across all rows — that's
intentional: the per-type row is meant to show progress against goal,
which is a unit-free ratio. The weighting only matters when summing
*across* types into the Overall row.

### How the Overall row is computed (frontend)

Three-step aggregation, applied consistently in `GoalsVsDeliverySection`,
`aggregateGoalsByPod`, and `GoalsMonthTable`:

1. **Max-of-week per (client, month, content_type)** — collapses the
   weekly rows down to a single value per content type per month.
2. **Apply `contentTypeRatio()` weight** at the per-client-per-month
   stage — `article × 1`, `jumbo × 2`, `lp × 0.5`, `glossary × 0.5`.
3. **Sum across content types and clients** for the pod-level
   aggregate.

Doing the weighting in step 2 (not earlier or later) is what keeps the
totals consistent across every aggregator. The `ratios` column from
the source sheet is **fallback only** — the content-type table above
is authoritative because the sheet column's direction (`1:2` vs `2:1`)
has been historically inconsistent.

### Cutover dates — what rule applies when

| Period | Article | Jumbo | LP | Glossary |
|---|---|---|---|---|
| April 2026 and earlier | × 1 / × 1 | × 1 / × 2 | × 1 / × 0.5 | n/a |
| May 2026 → present | × 1 / × 1 | × 1 / × 2 | **× 2 / × 0.5** | n/a |
| June 2026 onward | × 1 / × 1 | × 1 / × 2 | × 2 / × 0.5 | **× 1 / × 0.5** |

*Format: `ingestion / display`. Each column reads as "ingestion
transform / display weight".*

The importer's `month_year` check is what guarantees historical months
stay untouched — re-running a past-months re-sync on April 2026 LP
rows will still ingest them as `× 1`. Only May 2026 and later sheet
tabs apply the LP pre-treatment.

### Where each rule lives in code

| Layer | File | Function / variable |
|---|---|---|
| Ingestion (LP pre-treatment, content-type recognition) | `backend/app/services/migration_service.py` | `lp_mult` + the Goals importer |
| Upsert key (the natural key that prevents duplicates) | `backend/app/models.py` | `uq_goals_vs_delivery_mw_client_ctype` |
| Frontend display weight | `frontend/src/components/dashboard/shared-helpers.tsx` | `contentTypeRatio()` |
| Per-content-type × per-month grid | `frontend/src/components/dashboard/ClientDetailPopover.tsx` *(goals variant)* | `StackedCell`, the row list |
| Pod / cross-pod aggregation | `frontend/src/components/dashboard/PeriodSnapshotSection.tsx` | `aggregateGoalsByPod` |
| D1 Goals summary | `frontend/src/components/dashboard/GoalsVsDeliverySection.tsx` | `GoalsMonthTable` + section header math |

### How to add a new content type

Checklist when a new content type lands (e.g., the way Glossary will
ship in June 2026):

1. **Decide the weighting** — what should it count as in the Overall
   row? (`× 1` like Article, `× 2` like Jumbo, `× 0.5` like LP /
   Glossary, or a new value?) Add a row to the matrix above.
2. **Decide if any ingestion transform is needed** — does the team
   enter rows as physical units or already-weighted? If physical and
   the display weight is `× 0.5`, no transform is needed (Glossary
   pattern). If physical and the team wants the Overall row to read
   the sheet number, apply the inverse transform at ingestion (LP-May
   pattern).
3. **Add to the importer** — update `migration_service.py` to
   recognise the new content-type label from the sheet, apply the
   ingestion transform if any, and store the row.
4. **Add to `contentTypeRatio()`** — return the display weight for the
   new content type from `shared-helpers.tsx`.
5. **Add a row to the Goals popover** — the per-content-type × per-month
   grid in `ClientDetailPopover` reads from a content-type list; add
   the new label there so the row renders.
6. **Smoke-test the Overall row** — pick one client that has the new
   content type and verify the Overall row matches what the team
   expects (the sheet's own total, if they compute one, is the
   ground-truth oracle).
7. **Update this doc** — add the new row to the rule matrix + worked
   examples + cutover-dates table.
8. **Update the changelog** — note the new content type, the cutover
   month, and any user-visible effect on the Overall row.

---

*Last reviewed: 2026-05-29. Bump this line whenever the file is touched.*
