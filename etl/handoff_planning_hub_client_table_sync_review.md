📥 [CC-HANDOFF]
To: @Editorial-Hub session
From: @Ricardo (Planning-Hub / editorial-team-pods)
Project: Capacity "Article breakdown" client table — cross-surface edit sync · lineage deltas · cutover questions
Status: NEEDS-REVIEW / QUESTION

## Summary
We built the ET-CP sheet's client block into the Hub's Capacity → Editors tab (uncommitted, pending Ricardo's validation): a per-client × month grid where DaniQ edits **projected articles, client↔pod moves, category ×1.4, per-month comments and status labels**, plus planned "[New client]" placeholder rows. Edits are **interconnected by design**: one accepted edit updates the Editors demand math, the Writers-tab goals, the published plan tables, and (current-month pod moves) the Team tab. I evaluated all of it against your lineage catalog — mostly clean, but it surfaces **three cutover questions and a contract change** we need your eyes on, because the "editable everywhere" design now overlaps territory the ETL still owns from the sheets.

## 1. What now writes where (review this against your pipeline)
- **Demand overlay (Neon `editorial_demand_edits`, PK ym×client_id)** gained `note TEXT` + `status_override TEXT`; it stores absolute edited `articles` + target `pod` + `weight` per client-month. It overrides, at compose time: Editors pod-month demand, Writers client goals (ym ≥ current), and both published plans.
- **Current-month pod moves fan out to the Team tab** via the SAME upsert + publish path the Team tab always used (`editorial_pod_accounts` → `team_pod_assignments_editorial(_history)`). Per your catalog, `import_pod_history()` is already **Hub-first from `team_pod_assignments_editorial_history`** — so capacity-initiated moves should flow into `editorial_raw_pod_history` exactly like Team-initiated ones. **Q0: confirm that's fine / no assumptions about who writes that table.**
- **Future-month pod moves stay plan-only** (overlay + published plan) — deliberately.

## 2. Published-table contract changes (editorial_capacity_plan_demand & writer plans)
- `editorial_capacity_plan_demand` gains **`note` (STRING)** and **`status_override` (STRING)** columns, and can now contain rows with **NEGATIVE `client_id`** — planned/unsigned clients (e.g. "[New client] July KO #1"), which have NO `dim_client` match by construction. Any downstream join on client_id will drop them; any SUM over the table will include them (intended — they're future demand).
- `editorial_writer_plan_clients`/goals are now composed WITH the demand overlay — published writer-plan goals will (by design) disagree with raw `editorial_raw_production.articles_projected` wherever DaniQ edited in the Hub.
- **Q1:** does anything on your side read `editorial_capacity_plan*` / `editorial_writer_plan*` today (dashboards, reconciliations)? If so, do negative ids / the goal-vs-production divergence break anything?
- **Q2:** should your lineage catalog START covering the Hub-published tables (origin = planning-hub app, contract = `docs/capacity-plan-contract.md`)? Right now they're invisible in it, which is how this kind of drift hides.

## 3. The two unconnected loops — cutover questions (the big ones)
Your catalog shows the PEOPLE loop is already closed (Hub-first pod_history). These two are not:

**(a) Client→pod attribution.** Editors demand attribution = `editorial_int_client_pod_months.pod` ← `editorial_raw_client_pod_history` ← **ET CP version tabs**, and future months ← `editorial_raw_clients.editorial_pod` ← **SOW overview sheet**. Our in-Hub pod moves land only in the overlay + `editorial_capacity_plan_demand.pod`. If DaniQ starts moving clients in the Hub and stops maintaining the sheet columns, next refresh's baseline contradicts the plan.
**Q3:** should `import_et_cp_pod_history()` / the client-pod attribution go **Hub-first from `editorial_capacity_plan_demand`** (mirroring what you did for pod_history), with the sheet as fallback? Or does DaniQ keep maintaining the sheet in parallel until a hard cutover?

**(b) Projected articles.** `editorial_raw_production.articles_projected` ← **'Editorial Operating Model' sheet**, refreshed daily. Our overlay stores absolute edited values against that baseline. If the Hub AND the sheet both get edited, the baseline shifts under the overlay (our auto-discard compares edits to the moving baseline; the published plan still carries the edit, but provenance gets murky).
**Q4:** what's the intended authority once DaniQ edits projections in the Hub — (i) Hub-first import of `editorial_capacity_plan_demand.articles` into production's projected for future months, (ii) freeze the sheet's Operating Model block for future months, or (iii) sheet stays authoritative and the Hub overlay is a temporary what-if layer? We built assuming the Hub eventually wins (that's the stated goal), but the ETL side needs to move in step.

## 4. Lineage-catalog consumer deltas (for your LINEAGE map / next drift-check)
Since your last generation (2026-07-03 22:09 UTC), our read layer changed:
- **REMOVED:** `v_editorial_dim_member` — getRoster no longer joins it (email now from roster.work_email). `v_editorial_fct_pod_assignments` — getRoster no longer joins it (workerId = canonical_name). Both entries' planning_hub lines are stale.
- **EXTENDED:** `editorial_int_client_pod_months` → getCapacityData now also reads `projected_raw`, `actual_raw` (client-table delivered + variance). `editorial_raw_production` → getCapacityData now also reads `articles_actual`, `projected_original` (current-month delivered; Δ-vs-original on future months). `v_editorial_fct_production_monthly` → `getClientLastActiveMonth()` now returns MIN+MAX (firstYm+lastYm, keyed client_id+sf_account_id+name) → Team-tab "last month" badge + client-table status derivation (starting/ending/inactive).

## 5. Review ask
Beyond the questions: a general **sanity review of the edit-sync design against your pipeline** — anything we missed where an in-Hub edit and a sheet-driven refresh could fight (categories? client status? the `editorial_raw_clients.comments` column vs our per-month notes?). The full implementation is uncommitted in editorial-team-pods (plan file: capacity client breakdown; key files: `src/components/capacity-client-breakdown.tsx`, `src/lib/capacity.ts`, `src/app/actions/capacity.ts` syncPodMovesToTeam, `src/lib/writer-capacity.ts` demandEdits override, `src/lib/sync-to-bq.ts`, `db/schema.sql` demand_edits columns).

## Next step
Hub session: answer Q0–Q4, flag any pipeline conflicts, and (if you agree) add the Hub-published tables to the lineage catalog + update the consumer lines in §4 on your next regen.

*Written 2026-07-04 by the Planning-Hub session.*
