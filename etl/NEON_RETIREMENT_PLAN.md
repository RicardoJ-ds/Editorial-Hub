# Neon Retirement Plan — ingested/analytical data → BigQuery-native

**Goal:** Neon holds ONLY app-state (RBAC `access_*`, overview comments, `usage_events`,
`cache_version`, `audit_log`, `sheet_sync_history`, DQ review queues). All ingested/analytical
data (the spreadsheet-derived tables) is pulled from sheets, processed into dataframes, and
written **directly to BigQuery** — no Neon landing zone. Dashboards already read BigQuery.

**Status of this document:** grounded in a full read of `etl/warehouse/build.py`,
`etl/extract.py`, `etl/load.py`, `backend/app/services/migration_service.py` (6,176 lines),
`sync_manifest.py`, and the serving routers (2026-06-23).

---

## 1. Where we are (already done)

| Concern | State |
|---|---|
| Dashboard **serving** | ✅ reads BigQuery (`DASHBOARD_SOURCE=bq`, prod since 2026-06-19) via `bq_dashboard.q()` + in-process cache |
| Name **normalization** | ✅ BigQuery `editorial_name_map` (sheet-maintained), Neon fallback only |
| Notion published-status | ✅ live from BigQuery `graphite_bi.notion_raw_revenue_content` |
| Deprecated BQ flat mirror `editorial_hub_*` | ✅ already gone (0 tables) |
| Warehouse model | ✅ 19 `editorial_raw_*` + 9 `editorial_int_*` + 20 `v_editorial_*` published to BQ + PG `warehouse` (dual-sink) |

**So the SERVING side is BigQuery-native.** What remains is the **ingestion + warehouse-build
side**, which is still Neon-coupled by design.

---

## 2. The coupling that makes this a real re-architecture (not a flag)

The ETL is **deliberately** built on Neon as the processing store. Four distinct readers of Neon
`public` must move before Neon `public` can be dropped:

1. **The importers themselves** (`migration_service.py`) — write Neon `public`, AND read it during
   processing. The hard part: **fuzzy client matching against the `clients` table + `client_name_aliases`**
   used by ~8 importers (`_resolve_client`, `_build_client_name_lookup`). Every downstream `client_id`
   FK depends on this. BigQuery has no cheap row-level upsert, so each importer must become a
   full-rebuild dataframe → `WRITE_TRUNCATE` load.
2. **The warehouse build** (`etl/warehouse/build.py`) — `build_all()` opens a Neon session and calls
   `fetch_model_rows(session, Model)` for every source table (`build.py:124, 265-268, 475, 504, 543`).
   `etl/extract.py:1-6` states the premise outright: *"This module only reads the results"* the
   importers put in Postgres.
3. **The publish lock + PG sink** — `build_all()` uses a **Neon advisory lock** (`pg_advisory_lock(815001)`,
   `build.py:815-816`) to serialize publishes, plus `pg_sink.ensure_schema` / `create_pg_views`, plus the
   dual-sink data write (`flush_jobs` → `pg_sink.write_table`, `build.py:54-55`).
4. **The DQ admin endpoints** (`backend/app/routers/admin.py`, 29 DB queries) — discrepancy detection
   reads Neon `public` source tables directly (not BQ).

**Difficulty tiers (importers), from the coupling audit:**
- **Easy (10)** — no Neon reads during processing: SOW, Cumulative, KPI Scores, Delivery Schedules,
  Engagement Requirements, Model Assumptions, Week Distribution, Pod History, Pod Assignment History,
  ET CP Pod History. Redirect output to BQ truncate+load.
- **Medium (6)** — read Neon `clients` for matching (cacheable in-memory once per pass): Delivered,
  Operating Model, Meta Deliveries, Capacity Plan, Team Pods, Goals vs Delivery.
- **Hard (2)** — Growth Pods (in-place `clients.growth_pod` update + DQ coupling), Monthly Article
  Count (5 Neon reads + bulk insert + pod-as-of-month).

---

## 3. Critical safety constraint (discovered)

**Local and prod share BigQuery dataset `graphite_bi_sandbox`** (root `.env`, `docker-compose.yml`,
`config.py` all default to it). A local warehouse build overwrites the exact tables prod serves.

➡️ **All migration dev/validation MUST target an isolated dataset** (`graphite_bi_migration`),
set via `BQ_DATASET`. Prod keeps `graphite_bi_sandbox`. Cut over only after parity in isolation.

---

## 4. Target architecture (the "single in-memory pass")

```
Google Sheets
   │  (importer EXTRACT + TRANSFORM logic — reused as-is)
   ▼
in-memory dataframes/dicts  ──(in-memory client/alias resolution, built from the SOW pass)
   │
   ▼  load_rows(bq, "editorial_raw_*", rows, schema)  [WRITE_TRUNCATE]
BigQuery raw  ──►  int (Python/pyrules math)  ──►  views (SQL DDL)   [all already source-agnostic]
   │
   ▼  bq_dashboard.q() + cache
Dashboards
```

The int/view layers are **already** pure functions of in-memory dicts (`build.py` builds them from
the fetched rows, no re-query) — so they need **zero change**. The whole migration is about changing
where the **raw dicts come from**: importer-in-memory instead of Neon.

---

## 5. Staged, parity-gated plan (each stage independently safe; prod untouched until cutover)

**Stage 0 — Isolation harness.** Create `graphite_bi_migration`; add `BQ_DATASET` override path;
confirm a local warehouse build writes there (not sandbox). Wire `endpoint_parity` (53 endpoints,
`X-Data-Source` toggle) + `warehouse.parity` as the gate. *Effort: S. Risk: none.*

**Stage 1 — Warehouse reads raw from BQ (seam).** Add `WAREHOUSE_RAW_SOURCE=neon|bq` +
`fetch_model_rows_from_bq(table)`; the int builders read `editorial_raw_*` from BQ when `bq`.
Validate: build int/views from Neon vs from BQ-raw → **byte-identical** (they must be, same dicts).
*Effort: M. Risk: low — proves int/view layer is source-agnostic.*

**Stage 2 — In-memory client resolution.** Refactor `_resolve_client` / `_build_client_name_lookup`
to accept an in-memory clients+aliases lookup (built from the SOW pass) instead of querying Neon.
Keep a Neon-backed shim behind a flag for rollback. *Effort: M. Risk: medium — touches the resolution
core used by 8 importers; parity-gate per importer.*

**Stage 3 — Importer output → BQ raw (dual-write, per domain).** Each importer, after processing,
ALSO loads its dataframe to `editorial_raw_*` (truncate+load). Start with the Easy 10, then Medium 6,
then Hard 2. Keep Neon writes (dual-write) so nothing breaks. Parity-gate each domain. *Effort: L.*

**Stage 4 — Cutover warehouse to BQ raw.** Flip `WAREHOUSE_RAW_SOURCE=bq` in prod; the warehouse now
builds int/views from importer-written BQ raw. Bake. *Effort: S. Risk: medium — full parity gate first.*

**Stage 5 — Stop Neon `public` writes.** Importers stop writing Neon (BQ-only). DQ queues
(`incomplete_clients`, `article_unmapped_names`, `pod_import_issues`) STILL write Neon (app-state).
*Effort: M.*

**Stage 6 — Migrate the publish lock + DQ admin reads off Neon `public`.** Replace `pg_advisory_lock`
with a tiny Neon app-state lock row (keeps the lock in the allowed Neon footprint) OR a BQ-side guard.
Repoint `admin.py` discrepancy detection to read BQ raw. *Effort: M.*

**Stage 7 — Retire PG warehouse sink + drop Neon ingested schemas.** Flag-gate then remove
`pg_sink` data writes; drop Neon `public` ingested tables + `warehouse` schema. New rollback path =
re-enable + republish (minutes), or BQ serve-stale-on-error. *Effort: S. Risk: removes the
`DASHBOARD_SOURCE=postgres` instant rollback — confirm with stakeholder.*

---

## 6. What STAYS in Neon (the end state)

`access_views/groups/group_members/group_view_permissions/user_overrides` (RBAC) · overview comments ·
`usage_events` · `cache_version` (publish token) · `audit_log` · `sheet_sync_history` ·
DQ review queues (`incomplete_clients`, `article_unmapped_names`, `pod_import_issues`) ·
the publish-lock row.

---

## 7. Validation method (non-negotiable)

1. Build the warehouse to `graphite_bi_migration` via BOTH paths (Neon-sourced vs BQ-raw-sourced).
2. `python -m etl.warehouse.parity` — int/view field-level diff vs the real frontend functions.
3. `python -m etl.warehouse.endpoint_parity` — 53 dashboard endpoints, `X-Data-Source` postgres vs bq,
   multiset + ordered compare. **Zero diff required** before any prod cutover.

---

## 8. Why this was not completed in a single pass

Doing it correctly = rewriting the 6,176-line, deeply-Neon-coupled ingestion layer (resolution core
+ 18 importers), repointing the warehouse, migrating the lock + DQ reads, and proving 53-endpoint
parity — across an isolated dataset. That is a multi-session project. The prime directive ("without
breaking any current approach expected behavior") makes a partial/unvalidated cutover unacceptable,
so the work is staged and parity-gated. Prod stays on `0.3.29` until Stage 4 parity is green.
