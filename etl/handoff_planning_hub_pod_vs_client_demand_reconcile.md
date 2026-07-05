📥 [CC-HANDOFF]
To: @Editorial-Hub session
From: @Ricardo (Planning-Hub / editorial-team-pods)
Project: reconciliation Q — pod projected_used_capacity vs Σ per-client projected_weighted (current month only)
Status: QUESTION / NEEDS-REVIEW (please check the ET-CP sheet)

## Summary
Our new capacity client-table footer sums the per-client demand; the matrix "ALL PODS" total uses the pod rollup. They **don't match for the current month** and I expected them to. I checked past months (per Ricardo) and they DO match — so this is a **current-month-only** reconciliation gap between two of your INT marts. Please confirm whether it's expected (and, if you can, eyeball the ET-CP sheet).

## The two numbers
- **Pod rollup** = `editorial_int_capacity_pod_months.projected_used_capacity` (grain pod×month×version; latest = "V15 Jul 2026").
- **Client itemization** = Σ `editorial_int_client_pod_months.projected_weighted` (grain client×pod×month).

## Evidence (BigQuery, 2026, latest version)
PROJECTED — rollup Σ vs client Σ:
| month | rollup | Σ clients | Δ |
|---|---|---|---|
| Mar 2026 | 386 | 386.8 | −0.8 |
| Apr 2026 | 395 | 394.2 | +0.8 |
| May 2026 | 407 | 407.2 | −0.2 |
| Jun 2026 | 457 | 458.2 | −1.2 |
| **Jul 2026 (current)** | **527** | **517.8** | **+9.2** |

ACTUAL (closed months) reconciles too: Mar −0.8 · Apr +1.2 · May −1.0 · Jun −1.0 (rollup `actual_used_capacity` vs Σ `actual_weighted`).

So **every closed/near month reconciles to ±~1 (rounding); only the current month is off by ~9.** Jul gap is concentrated in **Pod 1 (rollup 165 vs clients 157.6, +7.4)** and **Pod 5 (92 vs 90, +2)**; Pod 3 matches exactly, Pod 2 ~0. No orphan client rows (every client pod maps to a rollup pod).

## Question
Why does the **current month's pod-level projected_used_capacity not equal its per-client itemization**, when every prior month does? Both trace to the same ET-CP version (V15). Hypothesis: in the live-month planning block the **pod-level "Projected Used" is a manual/pod-level figure that's been advanced ahead of the per-client lines** (client rows not yet fully updated for the current month), whereas closed months get reconciled. Is that the intended behavior, or a mart bug in how the current month is built?

## Please check the spreadsheet
In **`ET CP 2026 [V15 Jul 2026]`**, compare, for the **current month column**: the EDITORIAL TEAM CAPACITY block's per-pod **Projected Used** vs the **sum of the per-client Projected** in the ARTICLE BREAKDOWN block (×1.4 on specialized). If they differ in the sheet itself for Jul but agree for May/Jun, that confirms it's a source-sheet current-month artifact (not an ETL bug) and we can stop worrying — it self-reconciles as the month closes, and fully converges after the Q3/Q4 Hub-first cutover.

## Impact on us (low)
Not blocking. Both numbers are individually correct for their block (matrix % must use the authoritative pod rollup; the client footer honestly sums the visible rows) — same two-footer split your sheet has. We just want to know if the current-month divergence is expected so we can label it / stop treating it as a bug.

## Next step
Hub session: confirm expected-vs-bug for the current-month pod-vs-client reconciliation, ideally after a quick look at the ET-CP current-month columns.

*Written 2026-07-05 by the Planning-Hub session.*
