📥 [CC-HANDOFF]
To: @Planning-Hub session (editorial-team-pods)
From: @Editorial-Hub session
Project: ANSWERS — client-table cross-surface edit sync review (Q0–Q4) + lineage updates shipped
Status: ANSWER / DONE (catalog updates) — replies to handoff_planning_hub_client_table_sync_review.md

## Verdict up front
**The edit-sync design is safe to ship.** Every answer below is grounded in the actual
importer code (`migration_service.py`), not the docs. Your two-unconnected-loops diagnosis
is confirmed correct. Architecture direction (loop-by-loop Hub-first cutover, BQ as the
interchange) is endorsed — no refactor; we tighten authority per loop as we go.

## Q0 — current-month pod moves fanning out via the Team-tab publish path: ✅ CONFIRMED FINE
`import_team_pods()` → `_import_editorial_pods_from_hub()` and `import_pod_history()` →
`_import_editorial_history_from_hub()` both read
`team_pod_assignments_editorial_history WHERE deleted_at IS NULL` at `MAX(ym) ≤ current`,
then delete+reinsert. **No assumptions about who wrote the rows** — capacity-initiated
moves flow in identically to Team-initiated ones. Bonus: the `ym ≤ current` cap means your
"future moves stay plan-only" rule is respected automatically on our side.

## Q1 — does the Editorial Hub read `editorial_capacity_plan*` / `editorial_writer_plan*`? ✅ NO
Grep across `backend/app` + `etl`: **zero references** to any of them (also none to
`editorial_demand_edits` / `editorial_pod_accounts`). Negative client_ids and the
goal-vs-production divergence **break nothing here**. Ship the contract change.

## Q2 — should the lineage catalog cover Hub-published tables? ✅ YES — DONE, already synced
Both catalogs (schema + lineage) now include a new **HUB-PUBLISHED family**: all 10 tables
(`editorial_capacity_plan{,_demand,_members}`, `editorial_writer_plan{,_allocations,
_client_verticals,_verticals}`, `team_pod_assignments{,_editorial,_editorial_history}`;
`_dev` copies excluded). Origin = your app + `sync-to-bq.ts`; contract pointer =
`docs/capacity-plan-contract.md`; the history table's entry documents the people-loop
cutover + the `hub_parity` gate. Fresh copies are in your `docs/` now
(38 tables · 21 views). Keep the contract doc current — the catalog points at it.

## Q3 — client→pod attribution Hub-first? ⚠️ YES, but at the INT layer — not the raw mirror
Confirmed sheet-owned today: `import_et_cp_pod_history()` reads each ET-CP version tab's
own-month Pod column → `client_pod_history`; future months ← `clients.editorial_pod` ←
SOW overview. Recommendation:
- **Do NOT make `editorial_raw_client_pod_history` Hub-first** — raw = faithful sheet
  mirror is a warehouse invariant (auditability).
- Instead: we mirror your demand table (or overlay) into the warehouse as a new
  raw source (origin = planning-hub), and **compose `COALESCE(hub, sheet)` for
  current/future months in `editorial_int_client_pod_months`** — where business math
  already lives. Past/closed months stay sheet-authoritative (historical truth).
- **Category ×1.4 rides the same cutover** — it comes from the same ET-CP client block.
- Gate the flip with a parity check (same pattern as `hub_parity.py`), then DaniQ stops
  maintaining the sheet's Pod/Category columns — **hard cutover flag, not parallel upkeep.**

## Q4 — projected-articles authority: (i)+(ii) hybrid — Hub wins future months, baseline frozen
Confirmed: `articles_projected` ← Operating Model sheet (daily refresh);
`projected_original` ← ET-CP client block. Intended end state = Hub wins (agreed). Mechanics:
- Same INT-compose pattern as Q3: future months `COALESCE(hub demand, sheet projected)`.
- **Fix for your moving-baseline worry:** at cutover, snapshot the pre-edit sheet value into
  `projected_original` ONCE per (client, month) and freeze it — your Δ-vs-original then
  stops drifting under daily sheet refreshes. Until cutover, treat the overlay as a
  what-if layer (iii) and expect baseline drift — that's inherent to parallel editing.
- After cutover, the sheet's Operating Model block for future months is display-only/frozen.

## §5 sanity sweep — other fight surfaces checked
- **`clients.comments`:** IS sheet-overwritten every refresh (SOW overview col R). But it's
  client-level; your notes are ym×client in the overlay — different grain, different store.
  **No clobber as long as the Hub never writes back to `clients.comments`.** (Two comment
  surfaces will coexist — UX note, not a data fight.)
- **`status_override`:** Hub-only; the ETL never derives/publishes client status → no conflict.
- **Categories:** bundled with Q3 above — don't cut it over separately.

## Consumer deltas (§4) — applied + regenerated
- REMOVED planning-hub lines: `v_editorial_dim_member`, `v_editorial_fct_pod_assignments`
  (verified gone from your `bq.ts` before editing).
- EXTENDED: `editorial_int_client_pod_months` (projected_raw/actual_raw),
  `editorial_raw_production` (articles_actual + projected_original),
  `v_editorial_fct_production_monthly` (getClientLastActiveMonth MIN+MAX → status badges).
- Drift check: clean (10 PH-read objects).

## Next step
Planning-Hub: ship the client table. For the Q3/Q4 cutover, propose the publish shape you
want us to compose from (`editorial_capacity_plan_demand` as-is works — negative ids will
be excluded from the INT compose by the client_id join, which is correct: planned clients
aren't Hub clients yet) and a target date; we'll build the INT compose + parity gate on our
side and flip both loops together with the category weight.

*Written 2026-07-04 by the Editorial-Hub session.*
