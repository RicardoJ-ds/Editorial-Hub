---
name: metrics-capacity-utilization
description: "Capacity: % Util Real/Weighted/Spare, the 3 per-pod rates, fallback-as-distribution per-member model, ×1.4 SPEC_WEIGHT, ramp-up, Pod-1 May golden numbers. Supersedes the 30-analyses file on the post-0.3.25 tab."
metadata:
  node_type: memory
  type: reference
  originSessionId: 3fa962ac-9be0-4852-8c63-16ff918094cb
---

# Capacity Utilization

All math centralized in `backend/app/services/capacity_calc.py` — shared **verbatim** by the API
router and the ETL `editorial_int_member_months` mart, so they can't drift. Plain-language spec:
`etl/CAPACITY_CALCULATION_for_DaniQ.md`. See also [[analysis-capacity-utilization]] (the original
2026-06-09 derivation) + [[decision-2026-06-09-capacity-util-model]]. **This file supersedes the
analysis on anything post-0.3.25** (the merged Capacity tab, Jun 10).

## 1. "At a glance" cards (pod-aggregate, one closed month) — `team-kpis/page.tsx:650-733`
- **% Capacity Utilization (Real)** = `Σ actual_used ÷ Σ total_capacity` → "how busy vs maximum." Null until month closes. Green 80–105, red >105.
- **% Capacity Utilization (Weighted)** = `Σ actual_used ÷ Σ projected_used` → "did they hit plan." Green 80–110. >100 = delivered more than planned.
- **Spare capacity** = `Σ total_capacity − Σ projected_used` (a raw article count, not %). Green ≥0.

These totals come from `capacity_projections` (the ET CP sheet's pre-computed pod columns, latest V## per pod/month) — kept as a **validation cache**, not the recomputed member model.

## 2. The three per-pod rates (Pods table) — `team-kpis/page.tsx:968-997`
Read the member-utilization recompute (weighted pod totals):
- **% Projected** = `pod_util_projected_weighted` = pod **weighted** projected ÷ total capacity.
- **% Real** = `pod_util_actual_weighted` = pod **weighted** actual ÷ total capacity.
- **% Weighted** = weighted actual ÷ weighted projected.
Pods-table "Projected/Actual Used" columns show the ×1.4-**weighted** pod totals; per-member rows below use **RAW** totals (§3/§4).

## 3. Fallback-as-distribution (per-member, the operative path) — `compute_member_utilization` `capacity_calc.py:75-191`
Joins-only over **4 origins** for one (year, month); nothing stored:
- `%allocation` = member capacity ÷ pod total capacity — from `editorial_member_capacity`.
- `%distribution` = member's article count ÷ pod's total articles — from `article_records`.
- `projected_used` (member) = `%allocation × pod RAW projected`.
- **`actual_used` (member) = `%distribution × pod RAW actual`** ← the FALLBACK. Articles are a **distribution key only**, never the magnitude (the log under-counts: missing tabs, month-edge shifts). Assumption: under-logging is roughly even across a pod's editors.
- `%util_real = actual_used ÷ capacity` · `%util_weighted = actual_used ÷ projected_used`.
- Pod RAW totals = `production_history.projected_original` / `articles_actual` ⨝ `client_pod_history` grouped by as-of-month editorial pod. Unmatched member name → 0 articles, `matched=false`. No fallback to current pod → uncovered (client,month) → pod NULL → "Unassigned" in DQ → Pod coverage.

## 4. ×1.4 SPEC_WEIGHT
`SPEC_WEIGHT = 1.4` is a **module constant** (`capacity_calc.py:27`), **NOT in `model_assumptions`** (which only carries the 70/30 standard/specialized mix). Specialized clients cost ~40% more (a demand multiplier matching the ET CP sheet). Applied where `client_pod_history.category == "specialized"`:
- Carried **only** on pod-level *weighted* totals (`pw`/`aw` in `aggregate_pod_production`) — used by pod-reference util + the Pods table.
- **Per-member split uses RAW pod totals** (no ×1.4) so a person's number isn't distorted by which of their clients are specialized.
- Client mix: **70% standard / 30% specialized** (from `editorial_raw_model_assumptions`).

## 5. Ramp-up model (from `model_assumptions`, mirrored to BQ)
- **Senior Editor:** M1 80% · M2 100%. **Editor:** M1 0–33% · M2 80% · M3 100%.
- Weekly/monthly cap: SE 3–5/wk, 20/mo; Editor 12–15/wk, 60/mo (+5-week bumps). Ideal-capacity flags 80–85 green / 85–100 yellow / <80 & >100 red. New-clients-per-pod min 1 / max 2.
- Ramp-up consumed by the **Planning Hub** (editorial-team-pods), not editorial-hub's capacity tab. Gap: ramp-up *article* sub-rows (SE 16/20/20; Editor 0–28/44–48/60) captured only as percentages (derivable).

## 6. Golden verification numbers
**Pod 1, May 2026** (vs Ricardo's exercise sheet `1ToFMpuJJoto35KW6y3afEcs9VRP_zp00tPGaJ_bY2BU`, FORMULA render — reproduced exactly): pod cap **126**, projRaw **99**, actRaw **98**, projWtd **105**, actWtd **104**, 45 articles, pod weighted util **83.33 / 82.54**.

| Editor | Cap | Articles | %Util Real | %Util Weighted |
|---|--:|--:|--:|--:|
| Nina Denison | 20 | 5 | **54.44** | **69.29** |
| Robert Thorpe | 60 | 20 | **72.59** | **92.39** |
| Jimmy Bunes | 46 | 20 | **94.69** | **120.51** |

**May 2026 pod-level util** (post DaniQ name validation): **P1 83 · P2 88 · P3 77 · P5 99**. Unchanged by collaboration-cell handling (proven capacity-immaterial — pod totals follow OM, worst-case per-member swing ≈2–3 pts). Only unmatched member = placeholder "support from Pod 1".

## 7. Origins + endpoints
- ET CP sheet → `editorial_member_capacity` (+ `member_breakdown` JSONB splitting "Lauren K (28) + Anabelle (15)") + `capacity_projections`; latest V## = truth (ranks by int after "V": V13 > V9). Combined-cell splitter bug fixed 2026-06-10 (≥2 numeric parens → secondary split).
- Router `backend/app/routers/capacity.py`: `/pod-summary` `:74` · `/member-utilization` `:220` · `/member-utilization-matrix` `:246` · `/client-contributions` `:288`. All BQ-routed when `DASHBOARD_SOURCE=bq`.
- Warehouse: `editorial_int_capacity_pod_months` / `_member_months` / `_client_pod_months` → views `v_editorial_fct_capacity_pods` / `_member_utilization` / `_client_contributions` (`WAREHOUSE_DESIGN.md:119-128, 156-158`).

## 8. Dated decisions
| Date | What |
|---|---|
| 2026-06-09 | Model = facts/dims joins-only; articles = distribution key; RAW drives per-member, ×1.4 only pod-reference; `capacity_projections` = validation cache. Off-by-one pod-column bug fixed ([[decision-2026-06-09-capacity-util-model]]) |
| 2026-06-10 (0.3.25) | **Merged Capacity tab** (At a glance · By Pod · Trend · By Editor · By Client); per-editor utilization shipped; SPEC_WEIGHT ×1.4 |
| 2026-06-15 | Editors 29/29 vs Rippling; OM↔MAC Jan–May 92.2% (~98% real); confirmed ×1.4 is a constant not in model_assumptions; Model Assumptions → BQ. See [[analysis-normalization-proposal]] |

## 9. Open threads / caveats
- **Future months:** supply (capacity) + per-client demand (`editorial_raw_production`) exist through Dec 2026, but pre-rolled per-pod demand (`editorial_int_client_pod_months`) + per-member `projected_used` STOP at June (pod attribution uses the `client_pod_history` join that ends there). Future = show **projected** only (actual legitimately 0). To get future per-pod demand: roll up `editorial_raw_production × editorial_raw_clients.editorial_pod × 1.4(specialized)` directly.
- **Month-basis (D7):** article distribution = editorial-month, pod actual = calendar-month — cross-blending forbidden pending DaniQ.
- **Planning Hub architecture** (Ricardo): editorial-team-pods owns the interactive capacity tool (its Neon = editable layer for hires/leaves/pod-moves/re-distribution); editorial-hub's BQ = read-only baseline; daily reconcile. Don't edit the Hub repo from here; handoff via `editorial-team-pods/docs/capacity-tab-spec.md`.
- Name-matching residue: ~1,471 "/" collab cells; Meta family (~118 articles, no tab) = the lone true logging gap. See [[analysis-normalization-proposal]].
