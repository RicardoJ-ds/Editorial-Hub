---
name: metrics-goals-content-weighting
description: "Goals vs Delivery roll-up + content-type weighting (article×1 / jumbo×2 / LP×0.5 / glossary×0.5), LP-doubling cutover May 2026, glossary Jun 2026, %SOW / %Published, pacingColor — formulas, code, dates, bugs."
metadata:
  node_type: memory
  type: reference
  originSessionId: 3fa962ac-9be0-4852-8c63-16ff918094cb
---

# Goals & Content-Type Weighting

Source grain: `goals_vs_delivery` — one row per **(client × month_year × week × content_type)**.
Weekly rows carry running cumulatives. Served via `v_editorial_fct_goals_monthly` (gauges/Pod
Snapshot) + `v_editorial_fct_goals_client_totals` (goal-gated totals).

## 1. Content-type weighting matrix — TWO stages

Weighting is split across an **ingestion transform** AND a **display ratio**. Net Overall = product of both.

| Content type | Ingestion | Stored | `contentTypeRatio()` display | **Net Overall ×** |
|---|---|---|---|---|
| Article / "articles" | none | raw | ×1 | **×1** |
| **Jumbo** | none | raw | **×2** | **×2** |
| LP / "landing page(s)" *(≤ Apr 2026)* | none | raw | ×0.5 | ×0.5 |
| **LP** *(May 2026 →)* | **×2 at ingestion** | doubled | ×0.5 | **×1** (doublings cancel) |
| **Glossary** *(Jun 2026, doc'd)* | none | raw | ×0.5 *(per docs — **NOT in code**, see B1)* | ×0.5 *(intended)* |

- **Why two stages for LP**: from **May 2026** the team enters LP as **physical counts** (one row per LP). The importer doubles LP's CB+AR columns so the display-side ×0.5 cancels → Overall row reads the sheet's physical total. Per-type LP rows render the **doubled** value by design (the "weighted-unit" view — expect `8/12` where the sheet shows `4/6`).
- **Jumbo's ×2 is purely display-time** (no ingestion transform). Article = ×1 both stages.
- **`ratios` column is fallback only**: the sheet's `"2:1"`/`"1:2"` string is directionally inconsistent (produced inverted weights). The **hardcoded content-type table is authoritative**; the string is parsed (`a/b`) only for *unknown* types, then defaults to ×1.

## 2. Cutover dates (hard)
- **LP ×2 ingestion = May 2026 onward** — guarded by `month_year >= 2026*12+5` in `import_goals_vs_delivery` (`backend/app/services/migration_service.py:4034-4046`). April-and-earlier stay ×1 even on a re-sync.
- **Glossary = June 2026 onward** — ingest ×1, display ×0.5 (documented `BUSINESS_RULES.md` §1 + CHANGELOG 0.3.19, May 29). **⚠️ importer + ratio not shipped yet (B1).**

## 3. %SOW and %Published (Pod Snapshot, per pod summed over clients)
`PeriodSnapshotSection.tsx:1309-1381`:
- **%SOW** = `lifetimeDelivered ÷ lifetimeSow × 100` — `Σ articles_delivered` ÷ `Σ articles_sow` (contracted SOW). "—" when `lifetimeSow==0`.
- **%Published** = `lifetimePublished ÷ lifetimeSow × 100` — `lifetimePublished = Σ published_live` from `cumulative_metrics` joined by `client_name` (`publishedByName` map, `:642-654`). Denominator is **contracted SOW**, not published-able count.
- ⚠️ **B12**: the date-scoped %SOW numerator can divide by `clients.articles_sow` while lifetime bars use `lifetimeSow = Σ sow_target` — two SOW denominators in play.

## 4. pacingColor — elapsed% vs actual% (`shared-helpers.tsx:199-215`)
Compares actual progress to **expected** (elapsed contract time) so a brand-new client at 5% isn't flagged red. Defaults `minElapsedPct=8`, `warnPp=10`, `riskPp=25`:
```
delta = actualPct − elapsedPct
elapsedPct null  → absolute: ≥75 green / ≥50 yellow / else red
elapsedPct < 8   → green   (too early to judge)
delta ≥ −10      → green  #42CA80
delta ≥ −25      → yellow #F5C542
else             → red    #ED6958
```
`elapsedContractPct()` (`:219-235`) derives elapsed% from `start_date` + (`end_date` | `term_months`); null when it can't honestly compute. Absolute companion = `pctColor`/`pctColorNum` (75/50).

## 5. Goals 3-step roll-up (identical in 3 FE aggregators + warehouse)
1. **Max-of-week** per `(client, month, content_type)` — weekly cumulatives → `MAX` = end-of-month. Empty content_type → key `"default"`.
2. **Apply `contentTypeRatio()` weight**, collapse to `(client × month)`: `w_* = value × ratio`.
3. **Per-client sums GATED on `month goal > 0`** (independently for CB and AD), then grand totals. `cbPct = round(cbDel/cbGoal×100)` if `cbGoal>0` else 0. On-track = `cbPct≥75 AND adPct≥75` (null-goal dims pass); zero-goal-in-both clients excluded.

Doing the weight at **step 2** is what keeps every aggregator consistent.

**FE implementations (must stay in sync):** `aggregateGoalsSummary()` `GoalsVsDeliverySection.tsx:40-148` · `aggregatePodDelivery()` `PeriodSnapshotSection.tsx:1083-1294` · `aggregateGoalsByPod` `ContractClientProgress.tsx` (D1).
**Warehouse port:** `etl/warehouse/pyrules.py` — `content_type_ratio()` `:47-62` (byte-mirror incl. the B1 gap), `goals_month_ct_rows()` `:435-473` (steps 1-2 → `editorial_int_goals_month_ct`), `goals_grand_totals()` `:476-509` (steps 2-3). Step-3 goal-gating lives in SQL view `v_editorial_fct_goals_client_totals`.

## 6. Worked example (sheet CB del/goal = 4/6, May 2026)
| Type | DB after ingest | Per-type renders | Overall (CB) |
|---|---|---|---|
| Article | 4/6 | 4/6 (67%) | 4/6 |
| Jumbo | 4/6 | 4/6 (67%) | 8/12 (×2) |
| LP (≤Apr) | 4/6 | 4/6 (67%) | 2/3 (×0.5) |
| LP (May→) | **8/12** (doubled) | 8/12 (67%) | 4/6 (8×0.5) |
| Glossary (Jun→) | 4/6 | 4/6 (67%) | 2/3 (×0.5, when B1 fixed) |
Per-type `(67%)` is identical by design — weighting only matters summing **across** types.

## 7. Dated decisions
| Date | Ver | What | Why |
|---|---|---|---|
| May 25 | 0.3.16 | Importer **forward-fill** of client/pods on blank-Column-A continuation rows; `content_type` added to upsert key + DB constraint `uq_goals_vs_delivery_mw_client_ctype` | Blank Col-A dropped LP/Jumbo rows; LP & Article overwrote each other |
| May 27 | 0.3.17 | **LP ingestion ×2** (May 2026+); Pod-Snapshot Overall row made **weighted**; `arRowRatio` helper added then reverted | Sheet switched LP to physical counts; keep table single source of truth |
| May 29 | 0.3.19 | **`BUSINESS_RULES.md` created**; glossary documented (Jun 2026, ×1/×0.5) | Consolidate all goals rules in one authoritative doc |
| Jun 8 | 0.3.21 | Symmetric variance tiers (see [[metrics-end-of-q-variance-tiers]]) | Over-delivered work isn't billed |

## 8. Open threads / caveats
- **B1 (most important): glossary ×0.5 is documented but NOT in code.** No glossary branch in `contentTypeRatio()` (FE or `pyrules.py`) → a glossary row falls to the `ratios` parse, defaults to **×1**, not ×0.5. Importer recognition + FE ratio both still to ship. Tracked `etl/WAREHOUSE_DESIGN.md:211`.
- **B2**: CLAUDE.md/older changelog say the Goals popover "Overall" sums **raw**; since 0.3.17 the code makes it **weighted**. Don't trust the "raw" phrasing.
- **Goals-rename orphan double-count** ([[goals-rename-orphan]]): `import_goals_vs_delivery` is **upsert-only** — renaming a client in the Master Tracker leaves old-name rows as orphans that bucket into "Unassigned" and **double-count** the portfolio. A plain SYNC does NOT clean it. Fix = re-sync goals (mode=all) → `DELETE FROM goals_vs_delivery WHERE client_name='<old>'` → `@warehouse-publish` LAST.
- Authoritative rules doc: `BUSINESS_RULES.md` §1 (full matrix + add-a-content-type checklist). Warehouse-serving map: [[metrics-warehouse-int-layer]].
