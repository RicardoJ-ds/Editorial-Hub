📥 [CC-HANDOFF]
To: @Planning-Hub session (editorial-team-pods)
From: @Editorial-Hub session
Project: Q3/Q4 cutover — contract v1.1 CONFIRMED · Aug 1 CONFIRMED · parity gate LIVE (first run GREEN)
Status: ANSWER / IN-PROGRESS — replies to handoff_planning_hub_cutover_proposal.md

## Ask 1 — Contract v1.1: ✅ CONFIRMED (validated against your live table, 2 clarifications)
The authority rule (`source='app'` AND `ym >= current` only), app-zero = deliberate zero
(row-presence compose, never NULLIF), full-table-replace revert semantics, and the 3-day
`published_at` staleness valve are all accepted as written. Validated live 2026-07-05:

- **Baseline fidelity is already perfect**: 627 (ym ≥ 2026-07, client_id > 0) intersections,
  **0 article diffs, 0 pod diffs**. Your baseline echo is a faithful roundtrip of our sheet data.
- Freshness healthy: published 3h before check (06:00 UTC cron → our ~09:09 UTC build works).
- No negative ids / no app rows yet (expected — client table not shipped).

Two clarifications baked into our implementation (tell us if either surprises you):
1. **"Current month" = current CALENDAR month, UTC, evaluated at build time** (your ym is
   calendar; capacity planning is calendar-month based — NOT the editorial-week month).
2. **Compose scope includes `v_editorial_fct_production_monthly` future months** (not just the
   capacity marts). Post-cutover the sheet's Operating Model future months freeze, so the
   Production History chart must read the composed value or it goes stale. Your
   `getClientGoals()` reads that view — you'll get your own accepted edits roundtripped,
   which is exactly the closed loop we want.

## Ask 2 — Aug 1, 2026: ✅ CONFIRMED
Jul 6–17 build window is comfortable on our side. Agreed sequence unchanged: soak Jul 20–31,
hard cutover (both loops + category, one flag) Aug 1; slip to Sep 1 rather than mid-month.
Our flag: `CAPACITY_HUB_CUTOVER` (default OFF). At the flip we also snapshot-freeze
`projected_original` per (client, month) — one-time, kills the Δ-vs-original drift.

## Ask 3 — Raw-mirror table name: **`editorial_raw_capacity_plan_demand`**
Faithful full snapshot of your `editorial_capacity_plan_demand` (ALL rows incl. baseline +
negative ids — raw stays pure; the authority rule is applied in the INT compose, not the
mirror). Tolerates the upcoming note/status_override columns. Lands in both sinks (Postgres
`warehouse` + BQ) during Jul 6–17; lineage-catalog entries (origin = your app → our mirror →
INT compose) regenerate when it ships, closing the loop.

## Parity gate — BUILT + FIRST RUN GREEN (soak-ready ahead of Jul 20)
`python -m etl.warehouse.plan_parity` (standalone, no Docker) → `etl/PARITY_REPORT_PLAN.md`:
- **A. Baseline fidelity** (gate): 627 compared · 0 mismatches → ✅
- **B. App-row validity** (gate): app rows are never a failure to exist; invalid ones
  (no dim_client match, weight ∉ (0, 2]) fail. None yet → ✅
- **C. Freshness** (gate): ≤ 3d valve → ✅ (3h)
- **WARN (non-gating): exactly 1 non-zero sheet demand row invisible to your board —
  `2026-07 · Tempo XYZ (Pod 2) · 10 projected`.** The known windowed-identity dup (your board
  models it as "Tempo"). Resolve on your side (map the board to one client_id) or have DaniQ
  zero the old sheet row — otherwise it freezes at cutover.
- Verdict line: **✅ SOAK GREEN — cutover unblocked** (as of 2026-07-05).

## Next step
- You: wire publish-on-accept + your cutover flag once Ricardo ships the client table; decide
  the Tempo XYZ resolution.
- Us (Jul 6–17): raw mirror + flag-gated INT compose (`COALESCE(hub app-rows, sheet)` in
  `editorial_int_client_pod_months` + production monthly future months) + valve; then daily
  `plan_parity` runs through the soak.

*Written 2026-07-05 by the Editorial-Hub session.*
