---
name: decision-2026-06-09-capacity-util-model
description: "Decisions for the capacity-utilization-per-editor build — facts/dims, fallback-as-distribution, raw-vs-weighted, capacity_projections as cache, defer name-matching."
metadata: 
  node_type: memory
  type: project
  originSessionId: 16aec1b2-de33-466e-9e21-3d91480b6a82
---

# Decisions — Capacity Utilization model (2026-06-09)

1. **Facts/dims, joins-only, no duplication** (Ricardo's rule). Each concept has one
   origin; bring data together via joins at read time. No new columns, no denormalizing
   `category` onto `article_records`, no per-member projected/actual stored.
   → 4 origins: `editorial_member_capacity`, `production_history`, `client_pod_history`, `article_records`.

2. **Articles = distribution key, not absolute (FALLBACK is the operative path).**
   The article log under-counts and bucket-shifts by month, so member `actual_used` =
   `%distribution × authoritative pod RAW actual`, never the raw article sum.

3. **RAW pod totals drive per-member math** (proj 99 / act 98). Category-weighted
   (specialized ×1.4 → 105/104) is shown only as the **pod-level** reference util.

4. **`capacity_projections` = validation cache, NOT retired.** It equals the
   `production_history × client_pod_history` recompute today, but the recompute depends
   on pod + category coverage; keep the sheet's pre-computed number as a drift check.
   Re-point the pod matrix to origins only after coverage is proven.

5. **No fallback to current pod for article attribution** — uncovered (client,month) →
   `editorial_pod = NULL` → "Unassigned", surfaced in Data Quality → Pod coverage. Gap is
   shown, not hidden.

6. **Name matching deferred** — first-name/prefix best-effort now (Sam↔Samantha);
   Ricardo: "resolve all the matching problems later." Unmatched flagged "no match".

7. **Source gaps are not code-fixable** — Meta (no tab), College HUNKS/Eventbrite
   (un-logged rows). Hand to the team; importer fixes only recover ingestion losses.

8. **Pre-existing bug fixed earlier in branch:** `import_et_cp_pod_history` picked the
   pod column positionally (13-month Dec→Dec assumption) but the client block is 12 cols
   (Jan→Dec) → read the NEXT month's pod. Switched to header-derived column (mirrors
   `_ingest_et_cp_year`); deleted dead `_et_cp_sheet_months`.

Open / pending: month-basis alignment (calendar vs editorial vs delivered) for MAC↔OpModel;
importer DQ fixes (date-parse, header, alias, jumbo content-type). See [[now]].
