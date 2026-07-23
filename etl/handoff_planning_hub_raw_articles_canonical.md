# 📥 [CC-HANDOFF] raw_articles canonicalization + editorial-pod roster completeness

**To:** Editorial-Hub session  **From:** Ricardo (Planning-Hub session)
**Project:** editorial — `editorial_raw_articles.editor_canonical` / editorial-pod roster
**Status:** QUESTION  ·  **Date:** 2026-07-06

## Summary
Planning-Hub shipped an in-Hub **MAC≠OM validator** (Capacity → Editors). For each client-month
where **MAC** (`editorial_raw_articles`, distinct `article_uid`) ≠ **OM actual**
(`editorial_raw_production.articles_actual`), it names the **specific editors** behind the MAC and
flags **cross-pod** ones (the editor's *assigned* pod ≠ the client's pod that month). Assigned pod
comes from the app roster (`team_pod_assignments_editorial` + `editorial_pod_seniors`) — the same
source the Team tab renders.

**The problem:** we can only join article-log editors → roster **by name**, because
`editorial_raw_articles.editor_canonical` is **NULL for 100% of 2026 rows**. So any raw-name vs
roster-name drift silently drops an editor's cross-pod flag. That name join is the *only* thing
between us and 100% coverage.

## How we found it (audited via the SA-key BQ path, not the BI-Hub MCP)
- `editorial_raw_articles` (year=2026): `editor_canonical` **NULL** / `editor_match_status =
  'unresolved'` for **all 2,009 rows / 17 distinct editors**.
- `editorial_int_member_months`: the **same 17 editors** are `member_canonical` populated with
  `member_match_status = 'confirmed'`.
  → **The canonicalization exists in the INT layer but was never written back to the RAW article
  log that consumers read.**
- Not a dedup bug — confirmed **two distinct real editors**, both Pod 2:
  - `Samantha Marceau` — 65 articles, 7 clients, 8 months
  - `Samantha McGrail` — 12 articles, 3 clients, 1 month

## Ask (one round — primary + a lighter fallback)
1. **PRIMARY — backfill `editor_canonical` (+ `editor_match_status`) into `editorial_raw_articles`**
   using the same match you already run for `int_member_months`. Then any downstream editor join
   (ours included) is canonical-keyed = bulletproof.
2. **Confirm the prod editorial-pod roster** (`team_pod_assignments_editorial` +
   `editorial_pod_seniors`) includes every currently-active editor — or name any intentionally
   excluded (e.g. departed/contractor).

## Next step
Backfill `editor_canonical` in `editorial_raw_articles`; reply confirming roster completeness.
**No schema change on our side** — Planning-Hub already reads `editor_canonical` first
(`COALESCE(editor_canonical, editor_name)`), so it picks up the values the moment they land; no
redeploy needed. This message carries all the evidence — no doc round-trip required.

## Context
- Validator + all findings are **uncommitted** in `editorial-team-pods` (Capacity → Editors,
  the "⚠ N to validate" chip; per-editor MAC breakdown in the ⚠ tooltip / cell popover / pod drawer).
- Related prior threads: `handoff_planning_hub_pod_vs_client_demand_answer.md` (the pod-level
  ARTIC vs ACTUAL cross-pod explanation this builds on).
