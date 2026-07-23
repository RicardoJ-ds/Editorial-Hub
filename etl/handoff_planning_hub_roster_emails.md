📥 [CC-HANDOFF]
To: @Editorial-Hub session (Paolo / Simón)
From: @Ricardo (editorial-team-pods / Planning-Hub session)
Project: editorial-hub ETL + `graphite_bi_sandbox` roster views — email quality feeding the Planning Hub roster picker
Status: QUESTION / NEEDS-REVIEW

## Summary
**Every active roster member — all roles (Senior Editor, Editor, Writer, incl. freelancers) — should resolve to a canonical graphite work email. Today almost none do.** The Planning Hub's roster picker (add SE / Editor / Writer, plus the writers-capacity availability rail) shows each person's email from BQ; right now they're **missing**, **personal gmail**, or the **synthetic `@ext.writing.graphitehq.com`** domain — only ~2/3 of editors have a real `@graphitehq.com` address, and **zero writers do**. This is an upstream ETL / roster-view data-quality issue, not an app bug — flagging for you to fix at source or tell us the authoritative source.

## What the app does (so you know the read path)
`editorial-team-pods` → `src/lib/bq.ts` `getRoster()` resolves each active roster person's email as:
```
COALESCE(dim_member.email, pod_assignments.email)
```
where
- `dim_member` = `graphite-data.graphite_bi_sandbox.v_editorial_dim_member` (has `email`, but only for the ~12 capacity-modeled editors)
- `pod_assignments` = `graphite-data.graphite_bi_sandbox.v_editorial_fct_pod_assignments` (has `email` per `person`)
- roster universe = `graphite-data.graphite_bi_sandbox.v_editorial_roster` (`is_active = TRUE`) — this view has **no email column**, so the app has to reach into the two tables above.

`getRoster()` also sets the app's identity key `workerId = pod_assignments.email ?? canonical_name` — so the same email column is both the **display email** AND the **assignment-matching key**. Changing emails could re-key assignments (see the caveat at the bottom).

## Findings (BigQuery, active roster, resolved the same way the app does)
Email domain distribution by role:

| role | graphitehq.com | ext.writing.graphitehq.com | gmail | other | none |
|---|---|---|---|---|---|
| editor | 8 | — | — | — | 1 |
| sr_editor | 4 | — | — | — | 2 |
| writer | — | 11 | 13 | 1 | 3 |

So: **all** graphite-email coverage today is on editors/sr-editors; **no writer** has a `@graphitehq.com` email (they're gmail or the synthetic ext domain), and several people have **no email at all**.

`v_editorial_dim_member.email` is populated ONLY for the capacity-modeled editors — it is `NULL` for every writer and most sr-editors we checked, so the roster falls back to `pod_assignments.email`, which carries whatever the source sheet/tracker had (personal gmail, `@ext.writing.graphitehq.com`, or null).

Concrete examples (assign_email = pod_assignments.email, dim_email = dim_member.email):
- **Bryan Clark** (sr_editor): assign `—`, dim `—`  → no email shown
- **Chrissy Woodward** (sr_editor): no email in either source
- **Prit Centrago** (writer): assign `—`, dim `—` → no email
- **Abby Norwood** (writer): assign `abbyscottnorwood@gmail.com` → personal gmail
- **Owen Murray** (writer): assign `writer.murray@ext.writing.graphitehq.com` → synthetic ext domain
- **Tamara Siklosi** (writer): assign `writer29@ext.writing.graphitehq.com`
- **Andrew Blackman** (writer): assign `andrew-blackman@ext.writing.graphitehq.com`
- **Nina Denison** (sr_editor): assign `nina.denison@graphitehq.com` ✓ (this is what good looks like)

## Ask
1. **Target = 100% coverage:** every *active* roster member, all roles, should carry a canonical graphite work email. Can the ETL populate an authoritative `email` column on **`v_editorial_roster`** sourced from HR/identity (BambooHR / Google Workspace / whatever is canonical), rather than the article-tracker / pod-sheet value? No active member should be missing an email or on personal gmail.
2. If a canonical source already exists, tell us **which table/column is authoritative** and we'll join to it for display.
3. **Which domain is canonical for freelance writers?** Is `@ext.writing.graphitehq.com` the sanctioned freelancer domain (real mailboxes) — in which case that's acceptable — or a synthetic placeholder? If synthetic, they should map to the person's real graphite address, and personal gmail should never appear for an active member.

## Important caveat (don't break assignment matching)
In the Planning Hub, `workerId` (the key that matches a person to their `team_pod_assignments_editorial` rows) is currently derived from `pod_assignments.email`. If you change/populate emails, please coordinate: we likely need to **split the identity key from the display email** (keep a stable key — e.g. canonical_name or a durable person_id — and add a separate `work_email` for display) so re-emailing people doesn't orphan their existing assignments/history. Happy to make the app-side change once we agree on a stable person-id column in `v_editorial_roster`.

## Artifacts
- Read path: `editorial-team-pods/src/lib/bq.ts` → `getRoster()`
- Views involved: `v_editorial_roster`, `v_editorial_fct_pod_assignments`, `v_editorial_dim_member` (all in `graphite-data.graphite_bi_sandbox`)

## Next step
Editorial-Hub session: check the ETL's email source for the roster, advise on (1)/(2)/(3), and confirm whether we should add a stable `person_id` + `work_email` to `v_editorial_roster` so the Planning Hub can key on the id and display the work email.

*Written 2026-07-03 by the Planning-Hub session.*
