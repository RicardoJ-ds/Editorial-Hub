📥 [CC-HANDOFF]
To: @planning-hub session   From: @editorial-hub session (Ricardo)
Project: Source-of-truth model for per-client monthly articles — the behavior the Planning Hub should land
Status: CONTEXT / DESIGN  (foundation for the Option-(b) forecast ownership; pairs with client_future_forecast_answer.md)

## Why this doc
So the Planning Hub can decide + build the forecast store correctly, here is the definitive model
of *where per-client monthly article numbers come from, what each column means, when they should
match, and the time-behavior the Hub must replicate*. Everything below is verified against the code
+ live BQ (2026-07-14).

────────────────────────────────────────────────────────────────────────
## 1. The mental model (Ricardo — the intended design)
- **Operating Model (OM) monthly articles per client is the MAIN source of truth.** One number per
  client × month. **Past months = "actual"** (delivered). **Current/future months = "projection".**
- Delivered-articles-by-month everywhere else (Delivered-vs-Invoiced, MAC per-member, pipeline)
  are secondary and **should reconcile back to the OM**.
- **ET CP capacity sheet** (the July version carries all 12 months). Its client breakdown has, per
  month, a **Projected** and a **Delivered** column. Why two, when the OM already has the number?
  Because when an OM cell flips projection→actual at month close, the team **edits it in place** —
  so the original projection is lost. The ET CP **Projected** column **freezes what the projection
  was at the beginning of the month**; its **Delivered** column is the actual. So:
  - **Past months:** ET CP Delivered ≈ OM actual; ET CP Projected = the frozen beginning-of-month projection.
  - **Future months:** OM projection SHOULD equal ET CP Projected **by definition**. If they don't,
    it's a **spreadsheet-maintenance mismatch** — exactly the class of problem the Planning Hub exists to kill.
- **MAC** (Monthly Article Count) = per-member delivered breakdown — a further reconciliation, not central here.

────────────────────────────────────────────────────────────────────────
## 2. The tables + columns (exact, as they exist today)
**`editorial_raw_production`** (← Neon `production_history`; fed by the OM tab AND the ET CP client block):
| Column | Fed from | Meaning | Populated |
|---|---|---|---|
| `articles_actual` | **OM tab** (rows where `is_actual`) | actual delivered | **past/closed months only** |
| `articles_projected` | **OM tab** (rows where NOT `is_actual`) | the **live** projection | current + future (empty for past) — **tapers** for far-out months with no confirmed SOW |
| `projected_original` | **ET CP client block, `Projected` col (offset +4)** via `_ingest_et_cp_year` | the **projection frozen at the beginning of the month** | **all 12 months** |
| `projected_comment` | ET CP client block, `Comments` col (+6) | free-text note | where present |
| `is_actual` | OM | past-vs-future flag | all |

> The ET CP **`Delivered` col (+5) is intentionally NOT ingested** — it's redundant with the OM's
> `articles_actual`. So the Hub keeps the OM actual + the ET-CP *frozen projection*, nothing doubled.

Supporting tables (for reconciliation, not the forecast itself):
- **`editorial_raw_articles`** (← MAC per-client tabs + Meta Tracker) — per-article delivered, the member breakdown.
- **`deliverables_monthly`** (← Delivered-vs-Invoiced v2) — the delivered/invoiced the D1 variance dashboards use.
- **`editorial_int_capacity_pod_months.projected_used_capacity`** (← ET CP **pod-level capacity block**, category-weighted ×1.4) — the pod headline Σ (full Jan–Dec, matches the sheet).

────────────────────────────────────────────────────────────────────────
## 3. When they match / when they differ (verified 2026-07-14)
Per-month Σ, `articles_projected` (OM) vs `projected_original` (ET CP block), 2026:
| | Jan–Jun | Jul | Aug | Sep | Oct | Nov | Dec |
|---|---|---|---|---|---|---|---|
| OM (`articles_projected`) | ∅ (past→actual) | 453 | 458 | 439 | 424 | 340 | 275 |
| ET CP (`projected_original`) | 288–395 | 443 | 448 | 464 | 464 | 405 | 363 |
| clients differing | — | 1 | 1 | 3 | 4 | 6 | 8 |

- **Most clients match exactly** (Sep: Maven 20/20, Boulevard 16/16, Honey 38/38…).
- **Divergences** are: (a) **OM tapers** — clients with no confirmed future SOW go to 0 in OM while
  ET CP keeps the manual goal (Photoroom 0 vs 20, Mistplay 0 vs 15); (b) **naming drift** (Tempo XYZ
  vs Tempo.io — one block has the client under a different row); (c) past months (OM shows actuals,
  not projections). **These divergences ARE the sheet-maintenance mismatches Ricardo described** —
  by definition OM-future should equal ET-CP-projected, and where they don't, the sheet drifted.

────────────────────────────────────────────────────────────────────────
## 4. The behavior the Planning Hub must land (same rule, iterating)
Model the store exactly like the OM + the ET-CP two-column freeze, unified in ONE app-owned place:

**Grain:** one row per (client × month), including planned/unsigned (KO) clients. Columns:
`projected`, `actual`, plus `status`, `category`, `pod`, `is_planned`.

**The rule (this is the whole thing):**
- **Future/current month:** `projected` is **live + editable in-app**; `actual` accumulates as
  delivery lands (0 for not-yet-started future months).
- **At month close:** **freeze** `projected` → it becomes the immutable "beginning-of-month
  projection" (never edited again — this is why ET CP kept a 2nd column); **finalize** `actual`.
  The month flips to *past*.
- **Past month:** `actual` = final delivered; `projected` = the frozen value.
- **Roll forward** each close; the next month becomes current; the same rule repeats forever.

**Consequences (the payoff):**
- Editing a projection happens **once in the Hub** and propagates everywhere — no OM tab edit, no ET
  CP client-block edit. Both sheet areas become redundant.
- The OM→ET-CP mismatch **can't happen** anymore — there's one projection value, frozen once.
- Planned/KO clients live here too (app-managed, negative ids) — no sheet placeholder rows.

────────────────────────────────────────────────────────────────────────
## 5. Practical guidance for the read path NOW (bridge to the above)
- **Future-month projection:** read **`projected_original`** (ET CP block — steady, reconciles to the
  pod headline), NOT `articles_projected` (OM — tapers). This is the column swap that already fixes
  the resolved-client footer; the only remaining gap is the KO rows (not in this table at all).
- **Past-month actual (delivered):** `articles_actual` (OM) is the anchor; MAC / Delivered-vs-Invoiced reconcile to it.
- **Beginning-of-month projection (past):** `projected_original` already holds it.
- **KO / planned clients:** your Neon store (interim seed → in-app editing).

## 6. Reconciliation authority (which wins on mismatch)
- Delivered (past): the **OM actual** is truth; others reconcile to it.
- Projection: the **Planning-Hub-owned** value becomes truth once (b) lands; until then, ET-CP
  `projected_original` is the reference (not OM `articles_projected`).
- Pod headline: `projected_used_capacity` (ET-CP pod block) stays the Σ parity check; end-state it's
  **derived from Σ(Hub client projections)** and the sheet retires.

## Next step (for the Planning Hub)
Confirm the store models §4 (projected + actual per client×month, freeze-at-close, roll-forward,
incl. KO). That's the behavior that makes the Hub the single source and dissolves the OM/ET-CP split.
