# Name mappings → canonical sources of truth

_Updated 2026-06-10. **The machine-readable dictionaries in `mappings/*.json` are
authoritative** — built/refreshed by `python -m etl.build_mappings` (run inside the
backend container), which unions curated seed rules + the live DB distinct values +
the canonical pulls, so coverage is always complete (new names land as
`unresolved`, never dropped). This doc is the human summary; the full
before→after tables for DaniQ live in `DATA_QUALITY_CAVEATS_for_DaniQ.md` §3._

Canonical sources (pulled 2026-06-10 via `sa-key.json`, project `graphite-data`):
- **Editors** → `graphite_bi_sandbox.v_team_pods_editorial` (HR headcount view;
  42 rows in `mappings/canonical_editors.json`). NOTE: despite the name it is an
  HR view — contractor writers are NOT in it.
- **Clients** → `graphite_bi.salesforce_int_Account` (162 accounts in
  `mappings/canonical_clients.json`; literal `"nan"` strings = null).
- **Writers** → `pod_assignments WHERE role='writer'` (current roster, stable
  `…@ext.writing.graphitehq.com` emails) ∪ historical full names from
  `ai_monitoring_records.writer_name` + `notion_articles.writer`. 50-name roster
  in `mappings/writer_aliases.json`.

## Editors (`mappings/editor_aliases.json`) — 43 log names
- **32 confirmed** (94.9% of 14,789 article rows) — incl. `mike → Michael Doyle`
  (HR: editor 2023-03..05, exactly his article months) and all case/typo variants
  (`Derriik`, `Magggie`, `Magie`, `MAGGIE`, `maggie`, `NIcholas`).
- **2 ambiguous** (283 rows): `lauren` (Friar vs Keleher, both active — needs a
  DaniQ split rule) · `sam` (proposed Marceau; McGrail terminated 2026-01-27 so
  pre-Feb-2026 rows ambiguous).
- **4 unresolved** (462 rows): `kira` / `kristin` / `shalin` / `shain` — 2022-era,
  absent from every people source incl. terminated HR rows. Need human memory.
- **5 junk** (7 rows): `^ ^^ AND 83 "no edits"` — drop from editor counts.
- **Resolved mysteries:** Maggie & Tiffany "TERMINATED in HR but active in
  capacity" — terminations are RECENT (2026-06-03 / 2026-05-07); they were truly
  active in the staffed months. Status conflict was a timing artifact.

## Capacity members (`editor_aliases.json → capacity_members`) — 43 raw slot values
- **32 confirmed** full-name matches (incl. `Kennedy Sievers → Kennedy Stevens`
  surname typo, `ROBERT THORPE` case fix, annotation stripping: `(temp)`,
  `(net-new)`, `(freelancer)`, `(X's backfill)`).
- **5 placeholders** (not people): `-`, `new hire`, `new hire + Pod 3 (20)`,
  `support from Pod 1/3`.
- **6 combined cells** — split into people by `_parse_member_breakdown`. The
  space-separated format (`Maggie Gowland (14) Anabelle Zaluski (10)`) was NOT
  split until 2026-06-10 (counted as one person with the wrong capacity);
  importer fixed + ET CP re-imported, per-member rows for affected months now
  correct.

## Writers (`mappings/writer_aliases.json`) — 244 raw log names
- **78 renames APPLIED** 2026-06-10 (10,281 rows, ~70%): loaded into
  `article_name_aliases (kind='writer', source='etl')` → the importer
  self-heals on every sync. Reversible:
  `DELETE FROM article_name_aliases WHERE source='etl'`.
  Nickname/prefix matching (≥3 chars: `kev↔kevin`, `pat↔patrick`) mirrors the
  capacity matcher. Distinct writer names in the DB dropped 244 → 208.
- **122 first-name-only** (4,262 rows, 2022–2024 era): no roster covers them —
  kept as self-canonical first names, status `first_name_only`.
- **5 ambiguous** (37 rows): the Dan/Dani/Daniel(a) cluster (Quiroga vs Rial vs
  MacKinlay).
- **17 unresolved** (86 rows) + 18 trial-writer markers (101 rows) + 3 junk.
- Watch-outs: writer "Kimberly" = Kimberly **Kruge** (≠ editor Kimberly
  Pavlovich); "Sam" as WRITER = Samantha McGrail (roster), distinct from the
  editor-"Sam" decision; Owen Murray has two ext emails.

## Clients (`mappings/client_aliases.json`) — 84 Hub clients
Matching = exact → alphanumeric-key (catches `Dr Squatch↔Dr. Squatch`,
`ThredUp↔Thred Up`, `Gopuff↔Go Puff`) → curated override → flag.
- **71 confirmed** (13 are spelling drifts, incl. the corrected wrong-fuzzies
  `Meta BMG → Meta for Business`, `Meta RL → Meta Reality Labs`).
- **9 decision rows** (DaniQ): ChatGPT→OpenAI? · Engine→Hotel Engine ·
  Landing→Hello Landing · EarnIn B2C/B2B split · Orderful (I)/(II) split ·
  Workleap+Sharegate combo · Tempo XYZ (Tempo vs Tempo.io).
- **4 no SF account**: Meta Manus (new), First Round Capital, Lenny, Neeva (defunct).

### Article-log tabs with no Hub client — 28 tabs, ~3,970 rows
- **Proposed mappings (7)**: Men's Warehouse→Men's Wearhouse · Neiman→Neiman
  Marcus · Orderful→Orderful (I) · Orderful 2→Orderful (II) · ShareGate→Workleap
  + Sharegate · Genstore→GenstoreAI · FRC→First Round Capital. (Workleap already
  applied via the Hub.)
- **20 add-to-Hub-or-out-of-scope decisions**: Mirage (759, no SF), Curology
  (370), Worldcoin (333), Flip (307, SF "FlipFit"), EarnIn (267, which variant?),
  Jaanuu (248), Little Passports (159), Gopuff (152), Athena2 (145), Bergdorf
  (134), Mailjet (128), Email On Acid (112), Mailgun (107, SF
  "Pathwire/Mailgun"), Shift (87), Dynamite (58), ESGgo (34), Descript (31),
  OpenSea (15), Cadre (6), Credit Karma (1).

## How the dictionaries are consumed
- **ETL transform** (`etl/transform.py`): adds `editor_canonical` /
  `writer_canonical` / `sf_client_name` (+ match-status) columns to the BigQuery
  tables; originals untouched → parity preserved.
- **Self-healing import**: editor/writer/client-tab aliases can be loaded into
  `article_name_aliases` (writers already are); the Monthly Article Count
  importer applies them on every sync; reviewable in Data Quality → Article
  mappings.
- **Review tables in BQ**: `editorial_map_editors` / `editorial_map_writers` /
  `editorial_map_clients`.
