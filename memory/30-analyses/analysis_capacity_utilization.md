---
name: analysis-capacity-utilization
description: "The capacity-utilization-per-editor model — exact formulas, data origins, code locations, verification against Ricardo's sheet."
metadata: 
  node_type: memory
  type: project
  originSessionId: 16aec1b2-de33-466e-9e21-3d91480b6a82
---

# Capacity Utilization per Editor — model + implementation

Source of truth: Ricardo's sheet **"Editorial - Capacity Utilization exercise"**
(`1ToFMpuJJoto35KW6y3afEcs9VRP_zp00tPGaJ_bY2BU`). Formulas were read directly
(valueRenderOption=FORMULA) and confirmed — our endpoint reproduces every number.

## The math (per member, per pod, per month)
Sheet cells → our fields:
- `%dist` (H) `= G/G15` → member articles ÷ pod total articles.
- `actual_used` (I, "Fallback") `= H × N15` → **%dist × pod RAW actual** (N15=98).
  Articles are only a *distribution key*; magnitude comes from the authoritative
  pod actual, because the article log under-counts ([[analysis_article_count_data_quality]]).
- `%alloc` (O) `= F/F15` → capacity ÷ pod total capacity.
- `projected_used` (P) `= M15 × O` → **%alloc × pod RAW projected** (M15=99).
- **`%Util Real` (Q) `= I/F`** → actual_used ÷ capacity (use of max capacity).
- **`%Util Weighted` (R) `= I/P`** → actual_used ÷ projected_used (delivery vs plan).
- Pod-level reference util (row 16): `K15/F15`, `L15/F15` → pod **weighted** projected/actual ÷ total cap (= the ET CP sheet's 83.33% / 82.54%).

Note on "weighted": Q/R both use **RAW** pod totals (98/99). The category-weighted
totals (specialized ×1.4 → 105/104) are carried only for the pod-level reference
util. "Weighted" in R means "vs the projected/planned allocation", NOT specialized-weighted.

## Data origins (joins-only; nothing stored/duplicated)
- member capacity + pod total cap (Σ members) → `editorial_member_capacity` (expand `member_breakdown` into one row per person).
- pod RAW projected (99) / actual (98) → `production_history.projected_original` / `articles_actual` ⨝ `client_pod_history` (group by as-of pod). Weighted (105/104) = ×1.4 where `category='specialized'`.
- member articles (distribution) → `article_records` count per editor (matched by name) ⨝ nothing for raw.
- `capacity_projections` = validation cache only (its pod Total/Proj/Act equal the recompute; kept to detect drift, not an origin).

## Code
- Backend: `backend/app/routers/capacity.py` → `GET /api/capacity/member-utilization` (`MemberUtilizationRow`, two-pass: gather people → pod article totals → derive). Also `GET /api/capacity/pod-summary` (latest ET CP version per pod/month).
- Frontend: `frontend/src/app/(app)/team-kpis/page.tsx` → `CapacityByPodTab` (pod matrix + month picker) + `MemberUtilizationSection` (the per-editor table).

## Verified (Pod 1, May 2026)
cap 126 · articles 45 · projRaw 99 · actRaw 98 · projWtd 105 · actWtd 104 · pod wtd util 83.33%/82.54%.
Robert 60/20 → Real 72.59% Wtd 92.39% · Jimmy 46/20 → 94.69% / 120.51% · Nina 20/5 → 54.44% / 69.29%. **All match the sheet exactly.**

## Known weaknesses
- Editor↔member **name matching** is first-name/prefix best-effort (Sam↔Samantha). Unmatched members → 0 articles, flagged "no match".
- Article %distribution assumes under-counting is ~proportional across editors in a pod (reasonable, unproven).
- Month basis (editorial vs calendar) for the article distribution vs the pod actual is unresolved — see [[now]] next steps.
