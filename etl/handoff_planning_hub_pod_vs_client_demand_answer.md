📥 [CC-HANDOFF]
To: @Planning-Hub session (editorial-team-pods)
From: @Editorial-Hub session
Project: ANSWER — pod projected_used_capacity vs Σ client projected_weighted (current-month gap)
Status: ANSWER — replies to handoff_planning_hub_pod_vs_client_demand_reconcile.md

## UPDATE 2026-07-05 — TWO layers; the rounding layer is now FIXED + LIVE
Investigating further split the gap into two independent causes:
1. **Rounding (±1, every month) — FIXED, deployed, verified.** `capacity_projections`
   used-capacity was INTEGER and the ET-CP importer read the tab FORMATTED, so a pod's
   fractional "Projected Used" (e.g. 109.4) was truncated to 109 before storage → pod rollup
   drifted ±1 from the float per-client sum. Fix: FLOAT columns (commit d958284) + read those
   numeric cells UNFORMATTED (commit a19201e). After deploy + ET-CP re-ingest + warehouse
   publish, BQ is FLOAT64 and **Mar/May/Jun reconcile exactly** (386.8=386.8, 407.2, 458.2).
2. **Non-client rows (the residual) — cutover fix.** The only remaining gaps are breakdown
   rows with no real Hub client_id: Feb `WL/SG support (Feb)` (+17 w/ a misc line), Apr
   `[test] Credit Karma` (+1), Jul `[New client] KO #1/#2` (+9). Pod headline sums them; the
   per-client mart drops them. Fixed at the Aug 1 cutover (below) — or immediately for the
   test/support ones by removing them from the ET-CP breakdown (sheet hygiene).

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

## 2025 gaps — investigated: NOT a normalization/pre-normalization issue (2026-07-05)
Q raised: are the large 2025 pod-vs-client gaps (±5 to ±97, mixed sign) caused by data that
predates the client-name normalization? **Answer: no — disproven by direct evidence.**

`incomplete_clients` records every ET-CP breakdown name that `_resolve_client()` fails to
match at ingest. Live check: **36 rows, all still unresolved, and every 2025-origin one is a
placeholder or support line** — 20× `[New client] <Month> KO #N`, plus `AI Articles (support)`
and `Rox (support)`. **Zero real client names failed to resolve.** So the real clients all map
fine (this actually validates the ≥2025 normalization scope); the only "unresolved" names are
intentional non-clients.

The 2025 gaps are therefore structural, two causes:
- **Positive gaps** (rollup > client): the SAME non-client rows as 2026, just more of them —
  2025 was heavy pipeline-building, so many `[New client] KO` + support placeholders are summed
  in the pod headline but not itemized (e.g. Mar 2025 +97).
- **Negative gaps** (client > rollup): a **2025-only pod-structure change** — Pod 5 has client
  demand in late 2025 but NO capacity headline in the Nov-2025 block (`rollup = None`); it was
  added later (e.g. Nov 2025 −45, Pod 5 clientΣ 54.6 vs no rollup).

**Decision:** do NOT re-normalize or past-resync to "fix" 2025 — normalization has nothing to
resolve, and a past-resync would only recover cosmetic rounding fractions, not close these
structural gaps. 2025 is historical / outside the active planning window; its numbers are each
individually correct. Focus stays on 2026 (fixed + verified). Minor hygiene: the 36
`incomplete_clients` are all placeholders/support that will never resolve — worth a one-time
dismissal so the DQ "Missing from Hub" tab isn't permanently showing non-actionable rows.

*Written 2026-07-05 by the Editorial-Hub session.*
