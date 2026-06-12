# Pod Assignment History — setup + first drift findings

**Date:** 2026-06-12 · **Sources:** Team Pods sheet (`10ydCI1mQ5…`) + ET CP

## What was built
- **`pod_assignment_history`** (Hub) / **`editorial_raw_pod_history`** (BigQuery,
  `graphite_bi_sandbox`): per-month member↔pod↔client assignments from EVERY
  monthly Team Pods tab — **18.5K rows**.
  - Editorial: **Jan 2025 → Jun 2026** · Growth: **Jul 2024 → May 2026**
    (incl. its older "Account Team" tab name; emails ~94% via people-chips).
  - Editorial WRITER columns captured as `role='writer'` (raw free-text).
- Runs automatically on **Re-sync Past Months / full sync** (step
  `team-pods-history`). Current-month RBAC import unchanged.

## Drift: ET CP vs Team Pods (overlapping months)

| Comparison | Result |
|---|---|
| **Clients ↔ pod** (322 client-months) | **100% agreement** — the two sources fully corroborate |
| **Members ↔ pod** (69 month-pod rosters) | **47 identical · 86.5% name-level** — see `reports/pod_member_drift.csv` |

Member differences are mostly **pod-move timing** (one sheet updated before
the other in the transition month): Kimberly Apr 2025, Robert Jul 2025,
Derrik/Lee Sep 2025, Jimmy Jan 2026. Worth a per-case call with Dani on which
source is authoritative for those months.

## Fixes + backfill applied
- Artifact filters: `paused` status notes and bare-email cells no longer
  pollute member names (emails are kept as emails).
- **`client_pod_history` backfilled +92 client-months over 45 clients** from
  Team Pods, covering months ET CP never had (mainly Jan–Mar 2025 + Dec 2025).
  ET CP rows are never overwritten — it stays the primary source.
- Knock-on win: **917 more articles got per-month pod attribution**
  (2025+ unassigned: 1,939 → 1,022).

## Where to query (BigQuery, `graphite-data.graphite_bi_sandbox`)
- `editorial_raw_pod_history` — NEW: member/client/pod per month, both kinds
- `editorial_raw_client_pod_history` — client→editorial pod per month
  (ET CP + Team Pods gap-fill; `source_tab` tells you which)
- `editorial_raw_capacity_members` / `editorial_int_member_months` — ET CP side

## Next
- Per-case review of the ~20 member-transition months (with Dani).
- Decide whether growth-pod article attribution should use this history
  (today articles carry only the client's current growth pod).
