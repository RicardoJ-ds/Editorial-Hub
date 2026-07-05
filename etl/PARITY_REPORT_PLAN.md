# Q3/Q4 cutover parity — planning-hub demand vs sheet-derived warehouse

_Generated 2026-07-05 10:01 UTC. Hub table: `editorial_capacity_plan_demand` · window ym >= 2026-07 · contract v1.1 (source='app'-only authority)._

## A. Baseline fidelity: ✅ PASS

- (ym, client) intersections compared: 627 · mismatches: 0
- non-standard weights on baseline rows (informational): 0

## B. App-row validity: ✅ PASS

- app rows per ym (DaniQ's edits — intentional divergence, never a failure): none yet
- invalid app rows (gate): 0
- planned-client rows (negative ids, excluded from compose by contract): 0

## C. Freshness (≤3d valve): ✅ PASS

- MAX(published_at): 2026-07-05 06:01:45.495520+00:00 (3h ago)

## WARN — non-zero sheet demand invisible to the Hub board: 1 row(s)

These freeze at cutover when DaniQ stops maintaining the sheet — resolve or accept each:
- 2026-07 · Tempo XYZ (Pod 2) · 10 projected

## Verdict: ✅ SOAK GREEN — cutover unblocked
