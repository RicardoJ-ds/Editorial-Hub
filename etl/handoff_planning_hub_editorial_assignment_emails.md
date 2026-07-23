📥 [CC-HANDOFF]
To: @planning-hub session   From: @editorial-hub session (Ricardo)
Project: Populate `email` on published editorial assignments (RBAC depends on it)
Status: BUG — root fix on your side (we've patched defensively)

## The problem
`graphite-data.graphite_bi_sandbox.team_pod_assignments_editorial_history` (which YOU publish)
carries **`email = NULL` for every editorial row** — verified for ym 2026-07:
- `editor` rows: 52, **with_email = 0**
- `senior_editor` rows: 27, **with_email = 0**
- `writer` rows: 65, with_email = 12
So Alyssa Zacharias, Elliot Gardner, Haley Drucker, Kennedy Stevens, Lauren Friar, Sam Marceau, …
all publish with no email.

## Why it broke the Editorial-Hub RBAC
Our `import_team_pods` reads that table Hub-first → `pod_assignments` → the pod-derived **Editorial
Team** access group is rebuilt by `refresh_pod_derived_members`, which **keys on email** (RBAC is
email-based). Null email → those people are skipped → the Editorial Team group **derived to ZERO**
(only a leftover *manual* member, Sam Marceau, still showed). Editors lost dashboard access.

## What we did (our side — defensive only)
`_import_editorial_pods_from_hub` now backfills `work_email` by name when the Hub email is null,
resolving **`v_headcount.employee_name → work_email` FIRST, then `v_editorial_roster.canonical_name
→ work_email`**. Order matters: several editors are ALSO Slack writers, so they appear twice in
`v_editorial_roster` — once with their @graphitehq editor email and once with their @ext.writing
writer email. Roster-first would sometimes pick the @ext.writing address (which can't log into the
app). `v_headcount` (Rippling) always carries the canonical @graphitehq identity, so it wins.
Verified: editorial_team went 1 → 13, all @graphitehq (e.g. Anabelle Zaluski now resolves to her
editor login, not editor1@ext.writing). This is a safety net, not the real fix.

## The ask (general fix on your side)
**Populate `email` when you publish `team_pod_assignments_editorial_history`.** Since you identify
editors by name/slack, resolve the address the same way we do:
- Preferred: **`v_headcount.employee_name → work_email`** (Rippling — the canonical @graphitehq.com
  login; always correct for editors, who are employees).
- Fallback: join to **`v_editorial_roster`** on `canonical_name` (or `slack_id`) → `work_email` for
  anyone not in headcount. **But filter to editor/sr_editor rows** (or otherwise avoid the
  @ext.writing row) for people who are both an editor and a writer — else you re-introduce the
  @ext.writing-instead-of-login bug we just fixed on our side.
Write that into the `email` column for editorial rows (writers already carry theirs). Then every
consumer — our RBAC, and anything else email-keyed — gets a complete record, and our backfill
becomes a redundant safety net.

`v_editorial_roster` is the resolver we both trust (its `work_email` is exactly this canonical
identity). Once your publish carries `email`, nothing else needs to change on our side.

## Note (unrelated, same screenshot)
- **Elliot Rosson's access is CORRECT** — he resolves to `growth_team`, growth `Pod 4`. His empty
  Overview is a dashboard-scope thing (Overview is the editorial exec view; growth-locked users are
  meant to use Editorial Clients / their pod view), not a missing grant. Growth Pod 4 has 9 clients
  (6 active), so it's not empty — preview him on **Editorial Clients** to confirm he sees his pod's clients.
- **Justworks + Unvault both show growth `Pod 6`** in `editorial_raw_clients` (sourced from the SF
  `Pod` / growth assignment). If Justworks should be **Pod 7**, correct it at that source (Salesforce
  `Pod` / the growth pod assignment) — it's not an Editorial-Hub-side value.

Next step (you): populate `email` at publish (roster-resolved). Ping if the roster join needs anything from us.
