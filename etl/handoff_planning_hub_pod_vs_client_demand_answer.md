📥 [CC-HANDOFF]
To: @Planning-Hub session (editorial-team-pods)
From: @Editorial-Hub session
Project: ANSWER — pod projected_used_capacity vs Σ client projected_weighted (current-month gap)
Status: ANSWER — replies to handoff_planning_hub_pod_vs_client_demand_reconcile.md

## Verdict: EXPECTED — the gap is planned/unsigned "[New client]" demand, NOT a mart bug
Confirmed against the LIVE `ET CP 2026 [V15 Jul 2026]` sheet (not just the raw mirror). The
current-month gap is entirely **placeholder demand for expected-but-unsigned clients** that
the pod headline sums in but the per-client mart can't itemize. (My first take — "pod headline
advanced ahead of the client lines" — was superseded by reading the actual sheet cells.)

## Root cause (sheet-verified, exact to the article)
Pod "Projected Used Capacity" (CAPACITY block) sums ALL article-breakdown rows for the pod,
INCLUDING `[New client]` placeholder rows. The warehouse client mart
(`editorial_int_client_pod_months`) itemizes only rows that map to a real Hub `client_id`, so
it DROPS the placeholders. The gap = Σ placeholder demand for the planning month:

| Pod (Jul V15) | real-client Σ (×1.4) | placeholder row | pod headline (BF) |
|---|---|---|---|
| Pod 1 | 157.6 | `[New client] July KO #2` = 7.0 | 164.6 |
| Pod 5 | 90.0 | `[New client] July KO #1` = 2.0 | 92.0 |
| Pod 2 / Pod 3 | 128.2 / 142.0 | none | 128.2 / 142.0 (match) |
| Jun (closed), all pods | — | none | reconciles ±0.4 |

So: pod headline INCLUDES planned demand; client itemization EXCLUDES it (no real client_id).
Closed months reconcile because placeholders either sign (become a real client) or are removed.
`projected_used_capacity` in the pod mart is a verbatim copy of the sheet headline
(`build_capacity_pod_mart` does no math), and the client mart honestly sums real clients —
both correct.

## This is the SAME planned-client semantics as the Q3/Q4 cutover contract
`[New client]` placeholders are exactly the NEGATIVE-`client_id` rows in
`editorial_capacity_plan_demand`: "summed into the total, dropped by any client_id join
(intended — future demand)." So this divergence is the pod-vs-client view of that same
already-agreed behavior — and it will PERSIST (correctly) after cutover. The pod rollup SHOULD
keep counting planned demand (it's real capacity pressure); the per-client footer SHOULD keep
excluding unsigned clients. Don't try to force them equal by dropping planned demand from the
pod side.

## How to see it in the sheet (`ET CP 2026 [V15 Jul 2026]`)
1. CAPACITY block: month labels row 81 → July = column group starting **AZ**; Pod 1
   "Projected Used Capacity" = cell **BF84 = 164.6**.
2. ARTICLE BREAKDOWN block (row 114+): month labels row 123, headers row 124 → July Projected =
   column **BD**, client names col **C**, Pod col **AZ**. Scan Pod 1 July: 7 real clients + a row
   literally named **`[New client] July KO #2` (Projected 7)** → ×1.4-weighted sum = 164.6 = the
   headline. The Hub footer omits that row → 157.6. Same for Pod 5 (`[New client] July KO #1` = 2).

## Labeling
Label the current-month footer gap: *"pod projection includes planned/unsigned [New client]
demand; the client footer itemizes signed clients only — reconciles as KOs sign or drop."*
Both numbers are individually correct (matrix % uses the pod headline incl. planned demand; the
client footer honestly sums the mappable rows).

*Written 2026-07-05 by the Editorial-Hub session.*
