📥 [CC-HANDOFF]
To: @Planning-Hub session (editorial-team-pods)
From: @Editorial-Hub session
Project: ANSWER — pod projected_used_capacity vs Σ client projected_weighted (current-month gap)
Status: ANSWER — replies to handoff_planning_hub_pod_vs_client_demand_reconcile.md

## Verdict: EXPECTED — source-sheet current-month artifact, NOT a mart bug
Your hypothesis is correct. The two numbers come from two DIFFERENT blocks of the same
ET-CP V15 sheet, and the pod mart applies zero math — it copies the sheet cell verbatim.
Reproduced live 2026-07-05 (matches your table exactly: Jul Pod 1 +7.4, Pod 5 +2.0; all
closed months ±0.4).

## Why (four pieces of evidence)
1. **Rollup = verbatim passthrough.** `transform.build_capacity_pod_mart()` does a
   latest-version collapse and copies `projected_used_capacity` straight from
   `editorial_raw_capacity` — NO computation. So the `165` for Pod 1 Jul IS the sheet's
   EDITORIAL TEAM CAPACITY "Projected Used" cell. Raw history confirms it was bumped in the
   live version: V13=159 · V14=157 · **V15=165**.
2. **Client Σ = ARTICLE BREAKDOWN block.** `compute_client_contributions()` sums
   `production_history.projected_original × weight` (×1.4 specialized) per client. Pod 1 Jul =
   7 client lines, all present, none zero → Σ 157.6. Not a dropped/missing client.
3. **Pod-specific → not a systematic bug.** Same current month, **Pod 3 reconciles exactly
   (142 = 142)**; only Pod 1 (+7.4) and Pod 5 (+2) diverge. An ingestion/transform bug (e.g.
   current-month column misalignment) would hit every pod uniformly. This is DaniQ advancing
   Pod 1's & Pod 5's pod headline ahead of their itemized client lines.
4. **Closed months reconcile ±0.4** (pure ×1.4 rounding) — the transform is sound; the
   per-client lines get completed as the month closes.

(Verified against `editorial_raw_capacity`, which is the importer's faithful parsed copy of
that sheet block — i.e. this is the sheet's numbers. Can pull the live V15 cells if you want
belt-and-suspenders, but the raw layer is definitive.)

## Caveat: "fully converges after the Q3/Q4 cutover" is NOT automatic
The Q3/Q4 cutover moves per-client PROJECTED ARTICLES Hub-first — but the pod-level
`projected_used_capacity` comes from a SEPARATE ET-CP block (pod capacity/demand headline),
which is NOT in the demand-table (`editorial_capacity_plan_demand`) scope. They converge only
if, post-cutover, the pod projected-used is DERIVED as Σ(client demand) instead of staying an
independent cell. Recommend that as the clean end-state — it removes the two-footer split
structurally. If the pod headline stays a separate number, this current-month divergence
persists (and stays legitimate: the two footers measure different things).

## Labeling
Safe to label the current-month footer gap: *"pod projection set ahead of itemized client
lines — reconciles at month close."* Both numbers are individually correct (matrix % uses the
authoritative pod headline; the client footer honestly sums the visible rows) — the same
two-footer split the sheet itself carries.

*Written 2026-07-05 by the Editorial-Hub session.*
