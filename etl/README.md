# Editorial ETL — sheets → Postgres → BigQuery

> **Status: BUILT & PROVEN (2026-06-10).** The pipeline runs end-to-end and the
> parity harness shows **FULL PARITY** — every dashboard-feeding table lands in
> BigQuery `graphite_bi_sandbox.editorial_*` with identical numbers to what the
> dashboard serves today (`PARITY_REPORT.md`). Phase 2 (lifting the sheet
> parsing itself out of the backend) is documented at the bottom.

## Architecture (phase 1 — strangler fig)

```
Google Sheets ──(the proven importers, UNCHANGED — same code as the SYNC button)──▶ Postgres
Postgres ──(etl: extract → transform → load)──▶ BigQuery graphite_bi_sandbox.editorial_*
```

Ingestion is **byte-for-byte the SYNC button**: `etl/run.py --scope current|past|full`
executes the app's `sync_manifest` steps (single source of truth — never
re-hardcoded here), so SYNC vs RE-SYNC semantics, the month-rollover due-check,
and one-declaration extensibility are all preserved. The publish stage then
mirrors every dashboard table to BQ, ADDS canonical-name columns (originals
untouched), and computes the processed marts.

```
etl/
  run.py            CLI orchestrator (ingest → publish), writes last_run.json
  manifest.py       declarative plan: 27 tables + 5 marts + 3 mapping tables;
                    ingest_plan() delegates to app sync_manifest
  extract.py        Postgres readers (model rows + capacity-month inputs)
  transform.py      canonical columns + marts; capacity math IMPORTED from
                    app/services/capacity_calc.py (shared with the API router —
                    the mart and the endpoint can never drift)
  load.py           BigQuery JSON load jobs (schemas derived from the SQLAlchemy
                    models; WRITE_TRUNCATE; no pandas/pyarrow needed)
  parity.py         the proof harness → PARITY_REPORT.md
  build_mappings.py builds mappings/*.json (curated seeds ∪ live DB ∪ canonical
                    pulls); --apply-writer-aliases loads the writer dictionary
                    into article_name_aliases (self-healing, reversible)
  reports.py        DaniQ-facing CSVs → reports/ (month-basis reconciliation,
                    mapping tables w/ where-to-look, unmapped tabs + client years,
                    caret rows) + REPORT_FACTS.json
  mappings/         canonical pulls + the editor/client/writer dictionaries
  reports/          openable CSVs for DaniQ validation + the markdown report
```

## Commands (inside the backend container)

```bash
docker compose exec -T backend python -m etl.run                  # publish-only: Postgres → BQ
docker compose exec -T backend python -m etl.run --scope current  # SYNC-equivalent ingest, then publish
docker compose exec -T backend python -m etl.run --scope full     # SYNC + Re-sync Past Months, then publish
docker compose exec -T backend python -m etl.run --tables editorial_articles  # selective
docker compose exec -T backend python -m etl.parity               # parity proof → PARITY_REPORT.md
docker compose exec -T backend python -m etl.build_mappings       # refresh name dictionaries
docker compose exec -T backend python -m etl.build_mappings --apply-writer-aliases  # load writer aliases
docker compose exec -T backend python -m etl.reports              # DaniQ CSVs → reports/
```

Auth: `sa-key.json` mounted at `/app/sa-key.json` (project `graphite-data`,
dataset `graphite_bi_sandbox` from `BQ_PROJECT`/`BQ_DATASET`). The `./etl`
folder is volume-mounted into the backend container (`docker-compose.yml`).

## What lands in BigQuery (35 tables)

- **27 mirrored tables** `editorial_clients` (+`sf_client_name`/`sf_account_id`/
  `sf_match_status`), `editorial_articles` (+`editor_canonical`/`writer_canonical`
  + match statuses), `editorial_production_history`, `editorial_member_capacity`,
  `editorial_goals_vs_delivery`, `editorial_notion_articles`, … (full list:
  `manifest.py TABLES`). Excluded by design: RBAC/access tables, comments,
  usage analytics, audit log (app state, not sheet data).
- **6 marts**: `editorial_capacity_pod` (latest-V## collapse, = pod-summary
  endpoint) · `editorial_capacity_member_utilization` (per year/month/pod/member,
  = member-utilization endpoint + canonical names) ·
  `editorial_capacity_client_contributions` (per-client processed table that
  drives the pod totals) · `editorial_articles_monthly` +
  `editorial_revisions_monthly` (the /api/articles/monthly rollup at both-axes
  grain) · `editorial_month_basis` (per client×month: Operating Model actual vs
  article log by editorial month vs calendar month + a verdict — the evidence
  table for the month-definition question).
- **3 mapping review tables**: `editorial_map_editors` / `_clients` / `_writers`.

## The parity proof (`PARITY_REPORT.md`)

1. **Fingerprints** — for all 27 mirrored tables: row count + SUM of every
   numeric column + boolean counts, computed independently in Postgres and BQ.
2. **Endpoint replays** — `member-utilization` (every month), `pod-summary`,
   and `articles/monthly` (both pod axes) recomputed purely from BQ and diffed
   row-by-row, field-by-field against the live API → **identical**.

A dashboard pointed at these BQ tables renders exactly today's numbers.

## Canonical names

Dictionaries in `mappings/` (see `NAME_MAPPINGS.md` + the DaniQ report):
editors → HR `employee_name` (94.9% of article rows confirmed) · writers →
pod-sheet roster ∪ historical full names (78 renames APPLIED via the
self-healing alias table; ~70% full-named) · clients → Salesforce
`Client_Name` (71/84 confirmed). Ambiguous/unresolved rows are FLAGGED, never
guessed — pending DaniQ decisions in `DATA_QUALITY_CAVEATS_for_DaniQ.md` §1.

## Phase 2 — the endgame (not built yet)

1. Lift the sheet parsing out of `migration_service.py` into `etl/extract/` +
   `etl/transform/` as pure functions (catalog: `ETL_INVENTORY.md`), re-testing
   each against current Postgres output. Keep the manifest scope model
   (`current`/`past` + the wizard-only `seed` importers).
2. Repoint dashboard reads to BQ one endpoint at a time behind a flag
   (`editorial_capacity_member_utilization` is the natural first — the mart is
   already endpoint-identical).
3. Decide the month-basis question (DaniQ D7) before any cross-source blending.
4. Retire the legacy `bigquery_sync.py` (its `editorial_hub_*` tables no longer
   exist in BQ).
