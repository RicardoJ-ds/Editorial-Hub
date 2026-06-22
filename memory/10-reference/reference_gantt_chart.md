---
name: reference-gantt-chart
description: The project Gantt (Google Sheet) — a LIVING planning doc Ricardo wants kept updated; not a software release. How to reach + edit it.
metadata: 
  node_type: memory
  type: reference
  originSessionId: 23c6899d-f043-4d1c-9662-68a72342385a
---

# Gantt chart — living planning doc

Ricardo's request (2026-06-10): **keep this Gantt updated each session** as work
progresses (real weeks worked, bar colors, % complete, statuses, add/adjust rows).
**Gantt + PM updates are NOT software releases** — never bump the app version
(`version.ts` / CHANGELOG) for Gantt or iterative-planning changes. Same goes for
small iterative dashboard tweaks unless Ricardo explicitly asks for a release.

## How to edit it
- **Spreadsheet ID:** `1rL1cTWgAROxCV1NKO-tuW5bebgk7dn2oQVrHsgRg19w` · tab "Gantt Chart" (sheetId `1115838130`).
- Shared with the service account `graphite-bi-sa@graphite-data.iam.gserviceaccount.com` (Editor). Edit via the **Sheets API** from inside the backend container:
  `get_google_credentials(scopes=["https://www.googleapis.com/auth/spreadsheets"])` → `build("sheets","v4")` → `spreadsheets().batchUpdate` / `.values().batchUpdate`. `google-api-python-client` is installed there. Use a SCRATCH script in `etl/` and **delete it after** (don't commit it).

## Structure (as of 2026-06-10)
- Row 8 = PHASE banners; row 9 = MONTH headers (merged per month); row 10 = week labels `WK16..WK71` (**ISO weeks**: WK16 Mon = 2026-04-13; col I=WK16, each WK = one column, col index = 8 + (WK-16)).
- Tasks start row 12. Cols B=WBS, C=task, D=owner, E=start, F=due, G=duration, H=%complete (green via a pre-existing gradient CF on H — just set the value).
- Bars = cell background on the task's week columns: **solid blue (0.36,0.61,0.84)** = done/in-progress, **light blue (0.74,0.85,0.95)** = planned.
- **Months must align to the ISO weeks** (a week belongs to the month of its Thursday). The template originally had them mis-grouped; fixed 2026-06-10.
- **Current-week auto-highlight:** `C6` shows `=...ISOWEEKNUM(TODAY())...`; a CUSTOM_FORMULA conditional-format rule on `I10:BL36` highlights the column whose WK label matches `ISOWEEKNUM(TODAY())` (amber) — self-updating, leave it.

## Project structure reflected in the Gantt
Section 1 "Editorial Hub": Editorial Clients · Overview · Team KPIs · Data
cleaned+mapped→BigQuery (done) · **1.5 Origin-sheet normalization + data
validation, post-DaniQ (IN PROGRESS, ~10%, depends on DaniQ sign-off)**.
Section 2 "Editorial Planning Hub": Team pods · Historical pod record (dep:
swap the TEMP Team Pods sheet for the real one) · Capacity planning Writers/
Editors (future, dep: 0.4.x DB migration). See [[now]].
