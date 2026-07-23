📥 [CC-HANDOFF]
To: Writer-Capacity plan author (planning-hub / editorial-team-pods session)
From: Editorial Hub session (Ricardo)
Project: editorial-team-pods — "Writer Capacity" Capacity sub-tab (Editors | Writers)
Status: NEEDS-REVIEW

## Summary
Reviewed the full 10-part Writer Capacity plan against the LIVE Editorial Hub warehouse
(`graphite-data.graphite_bi_sandbox`). **Verdict: sound plan, approve.** It reuses the proven
editors-capacity architecture (BQ read-only + Neon overlay + pure compose + staged what-if +
manual publish) and the data facts check out — the handoff traps were all handled correctly
(`COUNT(DISTINCT article_uid)`, `editor_canonical` is NULL so use `writer_canonical`, writers use
RAW articles / no ×1.4, `client_id` as the join key, ~28 active writers from `v_editorial_roster`).
**Block only on 2 cross-system fixes before the Team-mirror ships** — these are the places a bug
escapes the planning-hub and lands in the Editorial Hub's data / RBAC.

## Must-fix (before the Team-mirror ships)
1. **Team-mirror writes writers into `team_pod_assignments_editorial`.** The Editorial Hub
   *consumes* that table (Hub-first for editorial pod history since the 2026-06-12 cutover) and its
   RBAC **Editorial Team group EXCLUDES Writers**. If the mirrored writer rows aren't clearly
   role-tagged, you risk (a) leaking Editorial-Team access to writers, or (b) polluting Hub pod
   attribution / Monthly-Articles. → Confirm mirrored rows carry a **writer role tag** + the
   `created_by='writer-capacity'` marker, and validate against the Hub's `import_pod_history` +
   RBAC exclusion that writers stay excluded. The Hub already expects `role='writer'` raw rows, so
   tagging them correctly should be enough — but verify end-to-end.
2. **`client_id → sf_account_id` bridge is not gated on `sf_match_status`.** Only
   `sf_match_status='confirmed'` rows are safe to join 1:1 (see the data handoff). Ambiguous /
   unresolved matches → the mirror attaches to the wrong account or silently drops. → Gate the
   bridge on `confirmed`; route the rest to the "skipped(why)" report you already have.

## Worth a second look
- **Shared `graphite_bi_sandbox` dataset.** Publishing `editorial_writer_*` + `editorial_client_verticals`
  into the same dataset the Hub warehouse truncates. No name collision today, but: `editorial_client_verticals`
  is generically named (consider a `writer_` / planning-hub prefix); and a **local** publish writes to the
  **prod-shared** sandbox (low risk since the tables are new/unconsumed, but note it).
- **Bandwidth accuracy depends on writer name-canonicalization coverage.** `WHERE writer_canonical IS NOT NULL`
  drops articles by unmapped writers → understated computed BW. Manual override cushions it; flag as a known
  dependency on `editorial_name_map` completeness.
- **Keep the join key on `v_editorial_roster.canonical_name`.** The seed `writerNameMap` is fine for one-time
  sheet→roster reconciliation — don't let it become a second source of truth.

## Nits
- `role === "Writer"` appears once; the view emits lowercase `writer` — verify `getRoster()` normalizes.
- `byVertical` supply is non-exclusive (a writer skilled in 3 verticals counts in all 3) — labeled in UI; just never `SUM` it.

## Coordination
- The Editorial Hub's upcoming **Neon → BigQuery ingestion migration** touches the same dataset but
  **preserves all table names + schemas**, so these reads (`editorial_raw_articles`, `v_editorial_*`,
  `v_editorial_dim_client`) should be unaffected. Confirm schema-stability before both land; pin to the
  `bq-schema-catalog` output.

## Next step
Address the 2 must-fixes (role-tag the mirror; gate the SF bridge on `sf_match_status='confirmed'`),
then proceed — the rest is polish or clearly-labeled modeling assumptions.

## Context
- Data contract this plan consumes: `etl/handoff_planning_hub_capacity_data.md`
- General "reproduce any Hub number from BQ": `etl/platform_handoff_editorial_hub.md`
- Note: reviewed against the 10 numbered parts; the trailing "Out of scope v1" note was truncated in
  the paste (`weekly cadence per writer …`) — not reviewed.

*Written 2026-07-03 by the Editorial Hub session.*
