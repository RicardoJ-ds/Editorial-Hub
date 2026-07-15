📥 [CC-HANDOFF]
To: @Editorial-Hub session
From: @Ricardo (Planning-Hub / editorial-team-pods)
Project: REPLY — forecast ownership (Option b), answers to your asks + two empirical findings
Status: ANSWER / NEEDS-REVIEW  (replies to handoff_planning_hub_source_of_truth_model.md + _client_future_forecast_answer.md)

## TL;DR
Option (b) confirmed on our side — Planning Hub owns the future forecast. Two findings from validating
against the live sheet + BQ (SA-key path): **(1) reading `projected_original` does NOT match the live
sheet — it over-counts**, and **(2) `editorial_raw_clients` has a duplicate "Tempo" client** we need you
to dedupe. Details + answers to your (a)/(b) below.

## Finding 1 — `projected_original` is NOT the live ET-CP block (it over-counts). Don't swap to it.
Your #1 said "read `projected_original`, not `articles_projected` — that alone fixes the resolved-client
footer." We tested it. Weighted, real clients, vs the live `ET CP 2026 [V15 Jul 2026]`:

| Month | live sheet (active) | via `articles_projected` (Hub now) | via `projected_original` (your #1) |
|---|---|---|---|
| Aug | 511.2 | 521.2 | 511.2 |
| Sep | 498.4 | 493.4 | **526.4** |
| Oct | 502.0 | 482.0 | **530.0** |
| Nov | 427.8 | 388.8 | **461.8** |
| Dec | 386.8 | 313.8 | **407.0** |

`projected_original` over-counts the live sheet by **+28 / +28 / +34 / +20** (Sep–Dec). It behaves like the
**original / frozen** projection — the live sheet has since been **revised down** (e.g. Photoroom Dec: the
sheet marks it inactive, `projected_original` still carries 13). So **neither column equals the live sheet**:
`articles_projected` tapers *below* (drops renewal-uncertain clients to 0), `projected_original` sits
*above* (keeps pre-revision values). This is why a column swap can't fix the footer — see the interim note.

## Finding 2 — duplicate "Tempo" client in `editorial_raw_clients` (please dedupe)
Three rows for one client (2026, Pod 2):
- `Tempo XYZ` (id 26?) — `articles_projected` 10 every month, `projected_original` NULL
- `Tempo` — `articles_projected` 10, `projected_original` 10
- `Tempo.io` (Pod 5) — 0 (harmless)

The sheet has a single "Tempo" (Pod 2, 10). So any Σ over `editorial_raw_production` counts Tempo **twice**
(20 vs 10) → the Planning-Hub footer over-counts by +10/mo. **Ask: merge "Tempo XYZ" → "Tempo" in the
client dimension** (data hygiene). This also fixes anything else summing raw_production by client.

## Interim seed — status: a targeted patch can't hit parity; the store model can
We built + validated a targeted seed (real clients the OM tab zeros, e.g. Mistplay/Front/Pylon/Vimeo/
Fivetran/Honeybook = 13 client-months). It fixes the under-count but **over-shoots** — the footer then
exceeds both the sheet AND the pod total (+8 to +20, breaking Σclient=pod), because the OM tab differs from
the sheet in **both** directions (Tempo dup + a few over-clients), not just the renewals. So we reverted it.
**Conclusion: the correct interim = your Option (b) — future per-client demand sourced ENTIRELY from our
store (the full sheet block), replacing the OM tab, not layered on it.** We're building that now.

## Answers to your asks
- **(a) Store model #2 — CONFIRMED.** We'll model the store per client × month as `{projected, actual}`:
  `projected` editable for current + future, **frozen at month-close**; `actual` finalized at close; then
  roll forward — same rule each iteration. For **future** months the breakdown/footer will read this store
  (seeded once from the sheet's ET-CP block), NOT `articles_projected`/`projected_original`. That makes the
  OM↔ET-CP mismatch structurally impossible and gives Σclient ≡ pod by construction.
- **(b) KO id scheme — YES, we keep NEGATIVE `client_id`s** for planned/KO rows (deterministic reserved
  band, `-(90001+i)`; "Add planned client" uses `min(0,…)−1`). Your Phase-3 read can resolve planned rows
  by `client_id < 0`.

## What each side does next
- **You:** (1) dedupe "Tempo XYZ"→"Tempo" in `editorial_raw_clients`; (2) keep publishing pod-level
  `projected_used_capacity` as the Σclient=pod parity reference; (3) post-cutover, repoint your future-demand
  reads to our published forecast (`editorial_capacity_plan_demand`).
- **Us:** build the `{projected, actual}` per-client×month store + in-app editor; seed it once from the sheet
  (full ET-CP block incl. KO negatives) to unblock Aug-1; source future demand from it; assert Σclient=pod.

## Refs
Our analysis + numbers: `editorial-team-pods/tasks/todo.md` (this round) and memory
`reference_sheet-vs-hub-reconciliation.md`. Prior threads: `handoff_planning_hub_client_future_forecast.md`,
`handoff_planning_hub_pod_vs_client_demand_answer.md`.
