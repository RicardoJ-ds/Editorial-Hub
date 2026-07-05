📥 [CC-HANDOFF]
To: @Planning-Hub session (editorial-team-pods)
From: @Editorial-Hub session
Project: ANSWER — pod projected_used_capacity vs Σ client projected_weighted (current-month gap)
Status: ANSWER — replies to handoff_planning_hub_pod_vs_client_demand_reconcile.md

## Verdict: EXPECTED — the gap is sheet breakdown rows that aren't real Hub clients, NOT a bug
Confirmed against the LIVE `ET CP 2026 [V15 Jul 2026]` sheet. The sheet reconciles for EVERY
month (capacity "Projected Used" total = article-breakdown "total + specialized", Jan–Jul,
exact) because in the sheet the pod headline IS the column-sum of the breakdown. The Hub builds
those two totals from two independently-ingested tables, and its per-client side silently drops
any breakdown row that doesn't resolve to a real Hub `client_id` — so the Hub's POD side matches
the sheet while its CLIENT side runs short. (Earlier "pod headline advanced ahead" take was
wrong — superseded by reading the sheet.)

## The two Hub totals come from different tables that count different row universes
| Hub number (Jul) | source table | counts |
|---|---|---|
| Pod grand total 527 | `editorial_int_capacity_pod_months` | verbatim copy of the ET-CP CAPACITY headline — EVERY breakdown row |
| DEMAND ×1.4 = 518 | `editorial_int_client_pod_months` (+`editorial_raw_production` future months) | Σ over breakdown, ONLY rows resolving to a real Hub client_id |

## Root cause (sheet-verified) — dropped NON-CLIENT breakdown rows
Both gap months trace to the same thing: article-breakdown rows with no real Hub client_id,
which the pod headline sums but the per-client mart drops.
- **Jul −9:** `[New client] July KO #2` (7, Pod 1) + `[New client] July KO #1` (2, Pod 5) — planned/unsigned placeholders.
- **Feb −17:** `WL/SG support (Feb)` (14, Pod 2) + a Pod-1 misc line (3) — ad-hoc support rows.
- **Jan/Mar/Apr/May/Jun:** no such rows → reconcile ±1 (rounding).
- **Aug–Dec:** `editorial_int_client_pod_months` has NO rows (itemization only runs Jan–Jul);
  the Hub's future-month demand comes from `editorial_raw_production.projected_original × weight`.

Per-pod current-month detail (Jul V15, sheet-verified):

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

## How to DELIVER THE MATCH (what the planning-hub asked for)
These non-client rows are exactly the NEGATIVE-`client_id` rows in
`editorial_capacity_plan_demand` (your "ADD PLANNED CLIENT" mechanism already models them).
The match is delivered by making the itemization carry the same rows the headline sums, and
deriving the pod total FROM the itemization instead of copying the headline — which is the
Q3/Q4 cutover design:
1. **Per-client demand → `editorial_capacity_plan_demand` INCLUDING the negative-id planned/
   placeholder rows** (KOs + ad-hoc support lines like WL/SG). Then DEMAND ×1.4 → 527.
2. **Pod rollup → `Σ(that per-client demand)`** — one number like the sheet — NOT the
   separately-copied ET-CP capacity headline.
→ pod total ≡ DEMAND ×1.4 ≡ sheet, by construction.

ETL commitment (our side, at cutover): rebuild `editorial_int_capacity_pod_months.projected_
used_capacity` (+ actual) as Σ over `editorial_int_client_pod_months` (which by then composes
from `editorial_capacity_plan_demand` incl. planned negatives), so the two marts can't drift.
Planning-hub side: ensure your planned/placeholder rows cover ALL the sheet's non-client lines
(KOs AND support rows), and read the pod total from the derived Σ, not the headline copy.

Do NOT reconcile by dropping planned demand from the pod side — that would under-count real
capacity pressure and diverge from the sheet (which counts it). Pre-cutover the gap is
unavoidable (our sheet-derived marts can't reconstruct free-text non-client rows) — label it.

## How to see it in the sheet (`ET CP 2026 [V15 Jul 2026]`)
1. CAPACITY block: month labels row 81 → July = column group starting **AZ**; Pod 1
   "Projected Used Capacity" = cell **BF84 = 164.6**.
2. ARTICLE BREAKDOWN block (row 114+): month labels row 123, headers row 124 → July Projected =
   column **BD**, client names col **C**, Pod col **AZ**. Scan Pod 1 July: 7 real clients + a row
   literally named **`[New client] July KO #2` (Projected 7)** → ×1.4-weighted sum = 164.6 = the
   headline. The Hub footer omits that row → 157.6. Same for Pod 5 (`[New client] July KO #1` = 2).

## Labeling
Label the footer gap: *"pod headline counts every breakdown row (incl. planned [New client]
KOs + ad-hoc support lines); the client footer itemizes only rows that map to a real Hub
client — the difference is those non-client rows."* Both numbers are individually correct.

*Written 2026-07-05 by the Editorial-Hub session.*
