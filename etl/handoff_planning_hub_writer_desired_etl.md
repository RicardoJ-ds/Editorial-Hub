📥 [CC-HANDOFF]
To: @editorial-hub session   From: @planning-hub session (Ricardo)
Project: Editorial ETL — adopt the `editorial_writer_desired` mini-ETL
Status: NEEDS-REVIEW / QUESTION

Summary
The Planning Hub has ONE data source it seeds itself, outside your robust ETL: writers' self-reported
**"desired article total" per writer × month**, ingested from a Google Form into BigQuery table
`graphite_bi_sandbox.editorial_writer_desired`. Today it's a manual one-shot script
(`scripts/seed_writer_desired.mjs`, `npm run seed:writer-desired`, CREATE OR REPLACE). We want you to
**fold it into the daily/monthly editorial ETL** so it stays fresh automatically and lives in the same
lineage/catalog as everything else. This doc is the complete spec to port it. Nothing else in the
Planning Hub is app-seeded — this is the last piece.

Why it matters (the consumer)
`editorial_writer_desired.desired` is the **capacity BASIS** in the Planning Hub's Writers model — a
writer's planned bandwidth = their self-reported Desired when present, and only falls back to
computed-from-history bandwidth when it's absent. So freshness directly changes the plan. The Hub reads
it via `getWriterDesired(fromYm)` selecting: `writer_canonical, ym, desired, days, clients, ooo,
weekly_breakdown, current_assignments, submitted_at` (WHERE ym >= floor). Keep those column names/types
stable or coordinate a change.

────────────────────────────────────────────────────────────────────────
SOURCE — Google Sheet
- Spreadsheet ID: `1SprAkqDwKryDzwbxu2u3EWifQv4LNdSnW6zV10plaSo`
- TWO tabs (two form generations), each read A2:I (0-based indices below), majorDimension=ROWS:
  1. CURRENT — tab `'Form Responses'`, range `'Form Responses'!A2:I`
       A=Timestamp(0) B=Name(1) C=Month e.g. "April 2026"(2) D=Days(3) E=Clients(4)
       F=Desired(5) G=OOO(6) H="Weekly Breakdown (SE)"(7) I="Current Assignments (SE)"(8)
       H/I are Sr-Editor free-text annotations — CURRENT TAB ONLY.
  2. LEGACY — tab `'Responses up to April 2026'`, range `'Responses up to April 2026'!A2:I`
       A=Timestamp(0) B=Name(1) C=Month e.g. "December"(2) D=Days(3) E=cadence (OMIT — extra col)
       F=Clients(5) G=Desired(6) H=OOO(7) I=test OOO (ignore)
       NB: the legacy form has an extra "cadence" column at E, so everything from Clients onward is
       shifted one column right vs the current tab. It has NO SE columns → weekly_breakdown /
       current_assignments default to "".

AUTH
- Service account `graphite-bi-sa@graphite-data.iam.gserviceaccount.com` — has Sheets read on the source
  sheet AND BigQuery on the sandbox dataset. The script uses `./secrets/sa-key.json` (scope
  `spreadsheets.readonly` for the Sheets batchGet; default BQ creds for the write). Headless variant:
  it also accepts `GCP_SA_KEY` (raw JSON or base64) — wire whatever your ETL runner already uses.

────────────────────────────────────────────────────────────────────────
TRANSFORM LOGIC (port these exactly)
1. Row filter: skip rows with empty Name; skip rows whose Month can't be parsed.
2. Month/year → ym (year*100+month):
   - Month name parsed from the Month cell (january..december substring match).
   - CURRENT tab: year is explicit in the cell ("April 2026") → extract the 20xx.
   - LEGACY tab: no year in the cell → infer from the submit **timestamp's** year; and WRAP to next
     year when the requested month < the submit month (a Dec form submitted in Nov of the prior year, etc.).
3. Timestamp: format "DD/MM/YYYY HH:MM:SS" (day-first, UTC) → ISO string. Missing time → 00:00:00.
4. desired = first integer found in the Desired cell (may be NULL if blank/non-numeric — keep NULL).
5. Name reconciliation → `writer_canonical`:
   - Normalize both sides: lowercase, NFKD strip-accents, collapse non-alphanumerics to single spaces.
   - Match norm(form name) against norm(`v_editorial_roster.canonical_name`).
   - Hardcoded aliases for FORM spellings that don't norm-match the roster canonical (keyed by norm):
       "linda l armstrong"        → "Linda Armstrong"
       "rich dezso"               → "Richard Dezso"
       "tessina grant moloney"    → "Tessina Grant"
     writer_canonical = matched roster name, else the raw name. `matched` BOOL flags whether it hit.
     >>> CONTEXT: The Hub's duplicate-name display problem is ALREADY solved on our side (render-time
         canonicalization against the roster), so nothing is broken today — this is only about keeping
         `writer_desired.writer_canonical` aligned with your canonical identity going forward. Your
         central name-map already canonicalizes these people in ASSIGNMENTS (verified: your
         v_editorial_fct_pod_assignments maps person_raw "Linda L. Armstrong" → person "Linda Armstrong").
         What we'd like: reconcile the FORM names through that SAME central map so we can drop our local
         3-alias list. One nuance to confirm — the FORM spellings can differ from the assignment
         spellings the map was built on (the form has "tessina grant moloney" / "rich dezso"), so please
         verify the map covers the FORM variants above (or add them). Also add "Dan Pelberg" →
         "Daniel Pelberg" while you're in there (your view currently leaves it un-aliased:
         person_raw="Dan Pelberg" → person="Dan Pelberg").
6. Dedup on (writer_canonical, ym): keep the row with the latest `submitted_at` (ISO strings sort).

OUTPUT TABLE — `graphite_bi_sandbox.editorial_writer_desired`
- Written today as CREATE OR REPLACE (full delete+reload every run — idempotent).
- Columns (types):
    writer_canonical STRING   -- roster-canonical (or raw if unmatched)
    raw_name STRING           -- exact form spelling (audit)
    year INT64, month INT64, ym INT64
    desired INT64             -- NULLABLE
    clients STRING            -- free text ("which clients")
    days STRING               -- free text
    ooo STRING                -- out-of-office dates (form field)
    weekly_breakdown STRING   -- Sr-Editor free text (current tab only, else "")
    current_assignments STRING-- Sr-Editor free text (current tab only, else "")
    source_tab STRING         -- 'current' | 'old'
    submitted_at STRING       -- ISO timestamp (kept as STRING, not TIMESTAMP)
    matched BOOL              -- true if reconciled to a roster canonical
    published_at TIMESTAMP    -- CURRENT_TIMESTAMP() stamped at write

────────────────────────────────────────────────────────────────────────
CADENCE (semantics matter)
- Writers submit on ANY day, but each response sets their Desired for a whole REFERENCE MONTH (the `ym`),
  NOT for the submit date. The dedup (step 6) keeps the LATEST submission per (writer_canonical, ym), so a
  resubmission for the same month overwrites the earlier one. → Run it DAILY (full idempotent reload picks
  up that day's submissions; never stale). A monthly run is the acceptable minimum. Fold it into the same
  daily trigger as the rest of the editorial ETL.

MIGRATION STEPS (suggested)
1. Add a build step in your ETL (e.g. `build_writer_desired()` producing `editorial_raw_writer_desired`
   or the int/view name that fits your conventions) reading the sheet + running the transforms above.
2. Reuse your central name-map for reconciliation (fold in the 3 aliases + Pelberg).
3. Publish to the SAME table name `editorial_writer_desired` in `graphite_bi_sandbox` (or publish a raw
   table + a `v_editorial_writer_desired` view at that name) so the Hub reader is unchanged.
4. Add it to the lineage + schema catalogs (`docs/bq_*_catalog`) with `consumers.planning_hub =
   getWriterDesired()`.
5. Once it's live on the trigger, the Planning Hub will retire `scripts/seed_writer_desired.mjs` +
   the `seed:writer-desired` npm script (we'll keep it around as a manual fallback until you confirm).

KEEPING IT UP TO DATE (maintenance notes)
- New responses: automatic — the full reload re-reads the sheet each run.
- New writer whose form spelling doesn't match the roster: the run logs "Unmatched names (N)" — add an
  alias to the central name-map (don't let it silently land as an unmatched raw name).
- Form structure change (new column / a 3rd form generation / renamed tab): update the tab list + column
  index mapping. The legacy-tab one-column shift is the kind of gotcha to watch for.
- Contract stability: the Hub selects the exact columns listed above — additive changes are fine;
  renames/type changes need a heads-up to us.

Reference (current implementation to read/port)
- `editorial-team-pods/scripts/seed_writer_desired.mjs` (self-contained; supports `--dry-run` which prints
  a full normalization summary — raw counts, skipped, dedup'd, ym range, unmatched names — without writing).
- Reader: `editorial-team-pods/src/lib/bq.ts` → `getWriterDesired()` + the `writerDesired` table ref.

Decisions — our position, please confirm or adjust (we've pre-answered these; just need your yes/tweak)
1. TABLE SHAPE — our side is agnostic. Only hard requirement: the final object is named
   `editorial_writer_desired` in `graphite_bi_sandbox` and keeps the column contract above. Single
   CREATE-OR-REPLACE table OR a raw table + a `v_editorial_writer_desired` view at that name — your call.
2. NAME RECONCILIATION VIA YOUR CENTRAL MAP — our position: YES, centralize it and we delete our local
   3-alias list. Please confirm your map already covers the FORM spellings ("linda l armstrong",
   "rich dezso", "tessina grant moloney"); if not, add them. Add "Dan Pelberg" → "Daniel Pelberg" too.
3. SE FREE-TEXT COLUMNS — our position: KEEP `weekly_breakdown` + `current_assignments` in THIS table
   (the Hub reads them from here). If you'd rather split them into their own object, that's fine — just
   tell us the new location so we can repoint the reader.
4. CADENCE — our position: DAILY (see semantics above: daily submissions, per-reference-month data,
   latest-per-(writer,ym) wins). Confirm daily works in your trigger, or tell us the schedule you'll use.
