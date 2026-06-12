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
| **Members ↔ pod** (69 month-pod rosters) | **47 identical · 86.5% name-level** — every diff in `reports/pod_member_drift.csv` |

Member differences are mostly **pod-move timing** (one sheet updated before
the other in the transition month).

### Per-case review (2026-06-12) — full detail in `reports/pod_member_drift.csv` (single file: every differing slot, classified, with evidence + verdict on the reviewed cases)

Of 119 raw differing member-months, **101 are coverage windows, not drift**:
76 ET CP-only slots are *future projections* (Jul–Dec 2026, no Team Pods tab
yet), 16 TP-only slots are *Jan–Feb 2025* (before ET CP member data starts —
and the articles corroborate Team Pods 100% there), 9 are junk tokens.

The **18 real cases**, arbitrated by article evidence (each member's articles
that month reveal which pod's clients they actually worked — client→pod is
100% agreed between sources):

- **Mid-month joins/leaves (9)** — both sources "right", they snapshot
  different days: Kimberly Mar 2025, Katie Apr 2025, Lee+Robert Jul 2025,
  Haley+Micki Aug 2025 (ET CP caught the join first); Abby Mar 2026 +
  Derrik Sep 2025 (Team Pods caught the leave first).
- **Genuine pod-move conflicts (8)**: Team Pods wins 3 (Kimberly Apr 2025 —
  Pod 2 ×32 articles vs ET CP's Pod 1; Robert Jan 2026 — the Pod 5 help was
  real; Tiffany Feb 2026 — true straddle), ET CP wins 4 (Maggie Aug 2025
  multi-pod coverage was real; Lee Sep 2025; Jimmy Apr 2026; Katie Aug 2025
  mostly), 1 split (Jimmy Jan 2026).
- **🚩 DQ flag**: Anabelle Zaluski — terminated 2025-08-22 per Rippling, yet
  assigned in BOTH sources in Jun 2026 with 3 articles. Freelance return or
  HR not updated — confirm with Dani.

**Conclusion:** neither source is globally authoritative — ET CP tracks
capacity splits better, Team Pods tracks move timing better. These member
diffs do NOT affect dashboard numbers (per-month attribution uses client→pod,
where the sources fully agree); they only matter for per-editor capacity
history.

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
