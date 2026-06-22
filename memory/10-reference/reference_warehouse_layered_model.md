---
name: reference-warehouse-layered-model
description: "The dual-sink layered warehouse: 19 editorial_raw_* + 9 editorial_int_* + 20 v_editorial_* views published to BOTH Postgres `warehouse` and BigQuery in one ~20s pass; the BQ serving cache + 4 flags; how publish/refresh works."
metadata:
  node_type: memory
  type: reference
  originSessionId: 3fa962ac-9be0-4852-8c63-16ff918094cb
---

# Warehouse — Layered Model + Dual-Sink + BQ Cache

The data layer the dashboards read. Design + bug register: `etl/WAREHOUSE_DESIGN.md`.
Where each number is computed → [[metrics-warehouse-int-layer]]. Cutover state → [[bq-serving-cutover]].

## 1. Layered model (live counts: **19 raw + 9 int + 20 views**)
- **RAW** (`editorial_raw_*`, 19) — source-shaped, one per grain; canonical-name columns **added** (originals untouched), `synced_at` stamp. App-state tables deliberately excluded (RBAC, comments, usage, audit, alias/unmapped/incomplete/pod-issue, notion_articles). `model_assumptions` re-added 2026-06-15 (BQ consumer); `delivery_templates` re-added (live pacing reads it).
- **INT** (`editorial_int_*`, 9) — **all business math here** → downstream is plain SUM/GROUP BY. Each carries `synced_at` + `as_of_date` where time-dependent.
- **VIEWS** (`v_editorial_dim_*` / `v_editorial_fct_*`, 20) — the dashboard read **contract**. Consumption is always via views.

⚠️ `WAREHOUSE_DESIGN.md:164` body still reads "18 raw + 8 int" — that's pre-2026-06-12 (before the Team-Pods cutover added `editorial_raw_pod_history` / `editorial_int_pod_assignments` / `v_..._pod_assignments`). **Trust the builders: 19/9/20.**

## 2. Dual-sink publish (decision 2026-06-11 → [[decision-2026-06-11-dual-sink-warehouse]])
Same in-memory processed rows → **both sinks in one ~20s parallel publish**:
1. **Postgres schema `warehouse`** — what the app serves by default (`DASHBOARD_SOURCE=postgres`, ~10-20ms). Holds all 9 int + 3 canonical-enriched raws + all views in PG dialect. Views over plain raw topics point at the operational `public` tables, not duplicates (`pg_sink.py`, `PG_TABLES_PREFIXES=("editorial_int_",)`).
2. **BigQuery `graphite_bi_sandbox`** — all 28 tables + 20 views; always-fresh mirror + backup.

**Why dual-sink beats BQ-only:** same numbers by construction (one row set → both sinks; views are dialect translations in lockstep, proven by the endpoint harness) + Postgres latency for users + BQ availability for analysts.

**Hardening:** cross-process `pg_advisory_lock(815001)`; per-table failure isolation; single build timestamp; atomic `CREATE OR REPLACE TABLE`; PG `execute_values` (page 1000); parallel loads `ThreadPoolExecutor×8` (~120s → ~20s).

**Flags** (`backend/app/config.py:13-28`): `dashboard_source` = `postgres`(default)|`bq` (branches all 24 dashboard reads to `app/services/bq_dashboard.py`, read at process start) · `data_source_override_enabled` (gates per-request `X-Data-Source`; **false in prod**, true in local for the harness).

## 3. BQ serving cache (`backend/app/services/bq_cache.py`)
Fronts `bq_dashboard.q()` so neither BQ nor Neon is hit per request:
- `cached_query(sql, params, runner)`: result cached in-process keyed by **`(sql, _param_key(params), publish_token)`**. No-op when `bq_cache_enabled=False` (parity harness).
- **Publish token** in the one-row **`cache_version`** table (id=1; created by `main._run_data_migrations`). Read ≤ once per `cache_token_poll_seconds` per process; serves last-known on a DB blip.
- `bump_token(session)` = `INSERT … ON CONFLICT DO UPDATE SET token=token+1 … RETURNING` + commit. Called from `@warehouse-publish` (`sync_manifest._warehouse_publish_run`); **a bump failure does NOT fail the publish** (TTL is the fallback).
- `bq_cache_ttl_seconds` safety net; **serve-stale-on-error** (returns last-good on a BQ exception, not a 500). `_param_key` keys different RBAC `allowed_names` scopes to different slots.
- **RBAC resolve cache** (`access.resolve_access_cached`): the dominant Neon read once on BQ; cached `rbac_cache_ttl_seconds`, **returns deep copies** so preview-as can't corrupt it.

**The 4 cache flags + defaults:** `bq_cache_enabled=True` · `bq_cache_ttl_seconds=600` · `cache_token_poll_seconds=5` · `rbac_cache_ttl_seconds=30`.

## 4. Refresh triggers
Terminal `./etl/refresh.sh [current|past|full]`; SYNC → `@warehouse-publish` runs last; Re-sync Past → `@warehouse-publish-past`; `scope=full` publishes **exactly once** at end; Import Wizard publishes after success; `run.py --scope current` self-escalates to `full` on month rollover. Prod ships the publisher (Dockerfile `COPY etl/`; railway.toml `watchPatterns: etl/**`). See [[reference-sync-architecture]].

## 5. Cutover state (full detail in [[bq-serving-cutover]])
Prod serves from **BigQuery since 2026-06-19** (commit `c7cb29d` = the read-cache; cutover itself was Railway env-vars only). Rollback = `DASHBOARD_SOURCE=postgres` (reads live `public`, can't be stale). Residual: a BQ outage with a **cold cache returns errors** (no postgres-fallthrough wired). **Open trap:** one shared BQ dataset for local+prod → **don't `@warehouse-publish` locally** (clobbers prod BQ).

## 6. Code / doc locations
- `etl/warehouse/`: `run.py` (orchestrator + rollover escalation) · `build.py` (raw+int builders) · `views.py` (BQ view DDL) · `pg_sink.py` (Postgres sink + PG views) · `pyrules.py` (ported rules) · `parity.py`/`endpoint_parity.py`/`hub_parity.py` (proofs) · `drop_legacy.py`.
- `backend/app/services/`: `bq_cache.py` (138 lines), `bq_dashboard.py` (`q()`), `sync_manifest.py:60-96` (publish + bump), `access.py:660-669` (rbac cache), `capacity_calc.py`. `config.py:13-28` (flags). `models.py` `CacheVersion`.
- Docs: `etl/WAREHOUSE_DESIGN.md`, `etl/README.md` (phase-1, superseded banner), `etl/ETL_INVENTORY.md`, `backend/CLAUDE.md`.

## 7. Phase 2 (later)
Thin-reader endpoints (SELECT views directly, delete per-endpoint Python mirrors); decommission phase-1 flat `editorial_hub_*` tables (`drop_legacy.py --confirm`); optionally stop writing the Neon `warehouse` sink to save storage (re-grep `FROM warehouse` first; rollback stays via `public`).
