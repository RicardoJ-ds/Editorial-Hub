---
name: reference-sync-architecture
description: "The Sync Manifest (single source of truth: declare an importer once with a scope → flows everywhere), current/past/full scopes, self-healing month rollover, daily cron, sync endpoints."
metadata:
  node_type: memory
  type: reference
  originSessionId: 3fa962ac-9be0-4852-8c63-16ff918094cb
---

# Sync Architecture

Single source of truth = `backend/app/services/sync_manifest.py` (since 0.3.23, Jun 8).
Doc: `sync-architecture.md`. Data sources it syncs → [[reference-data-sources]].

## 1. The manifest
Every importer declared **exactly once** as a `ManifestStep` (`key`, `label`, `scope`, `run`, `dynamic_prefix`, `description`). Two lists: `CURRENT_STEPS` (`:173`) + `PAST_STEPS` (`:207`).
- **Add an importer = add ONE step** → it flows automatically into the SYNC button, Re-sync Past Months, month-rollover auto-resync, daily cron / `/sync-run`, and all progress UIs. **No hardcoded sheet lists in the frontend** (old `IMPORTABLE_EXACT`/`RESYNC_STEPS` gone).
- `_sheet(name)` (`:143`) wraps a single sheet through `import_all(session,[name])` so it's audit-logged. Execution always reuses `migration_service.import_all` (writes the audit-log "synced" row); the manifest only declares the plan.
- **`dynamic_prefix` steps** expand at plan time into one step per live sheet (`@et-cp` → `ET CP 2026 [V14 …]`; `@kpi-scores` → `Monthly KPI Scores`) via `resolve_plan()` (`:288`).
- **Synthetic steps** (`synthetic:true` so UIs skip sheet previews): `@refresh-kpis` (recompute Notion KPIs, last current step before publish) and `@warehouse-publish` / `@warehouse-publish-past` (rebuild the dual-sink warehouse via `etl.warehouse.build_all` + `create_views`, then **bump the cache token** — see [[reference-warehouse-layered-model]]).

## 2. Scopes (`steps_for_scope` `:270`)
| Scope | Contents | Triggered by |
|---|---|---|
| `current` | this month's live sheets + `@refresh-kpis` + `@warehouse-publish` | every SYNC; daily cron |
| `past` | Goals-vs-Delivery (all months), Week Distribution, Team Pods, ET CP Pod History, Team Pods History, Model Assumptions, Backfill Editorial Pod + `@warehouse-publish-past` | Re-sync Past Months card |
| `full` | `current` then `past`, **dropping the current `@warehouse-publish`** so the warehouse publishes **exactly once** at the very end | month rollover; cron when due |

Endpoints (`backend/app/routers/migration.py`): `GET /api/migrate/sync-plan?scope=` (`:467`) · `POST /sync-step {key}` (`:482`, per-step error isolation) · `POST /sync-run?scope=` (`:514`, whole scope server-side, cron/headless) · `GET /monthly-resync-status` (`:557`) · `GET /status` (the "Synced …" badge). Back-compat `goals-historical-resync` + `resync/{step}` delegate to the manifest.

## 3. Self-healing month rollover (`monthly_resync_due` `:350`)
- **Why:** regular SYNC freezes closed-month Goals tabs (`sheet_sync_history`), so last month's *final* numbers (entered a few days into the next month) never land → stale "last month".
- **Fix:** the **first SYNC of a new editorial month auto-runs `scope=full`**. `SyncAllModal` checks `monthly-resync-status` first; when `due` it pulls `full` + shows a "New month detected" banner. Later syncs that month run `current`.
- **Due rule:** due when the latest Goals tab `SheetSyncHistory.synced_at` predates the current editorial month's **Week-1 start** (from `editorial_weeks`). `current_editorial_month()` (`:331`) mirrors the frontend's `currentEditorialMonth` so server + client agree.

## 4. Daily cron (`_daily_sync_loop`, `main.py:334`)
Env-gated: `sync_cron_enabled` (default **False** — OFF locally, ON in prod) + `sync_cron_utc_hour` (default **9** = 09:00 UTC). Started in `lifespan()` only when enabled. Runs `resolve_plan("current")` step-by-step with **per-step failure isolation** (own session each; a failure logs+rolls back+increments `failed`, rest continue). Rollover auto-escalates to `full`. **Observed firing autonomously in prod 2026-06-12.**

## 5. Manual-only importers (not in any scope)
An importer can be **wizard-only**: present in `migration_service.IMPORT_DISPATCH` + `list_available_sheets()` (so `/data-management/import` shows it) but **absent from `CURRENT_STEPS`/`PAST_STEPS`**, so no automatic path (SYNC button / cron / rollover) ever runs it. The Import Wizard sources its list from `GET /api/migrate/sheets`, **independent of the manifest** — that's the seam. Current example: the 4 **`AI Monitoring - *`** importers (removed from `current` on 2026-06-22; scans paused upstream). They're also in the wizard's `DEFAULT_UNCHECKED` so they're off-by-default. See [[reference-data-sources]] §3.

## 6. Idempotency
Every importer upserts on natural keys; **ordering doesn't matter**.

## 6. Dated milestones
| Date | Ver | What |
|---|---|---|
| May 8 | 0.3.4 | Per-step session isolation on past-resync; Operating Model importer made bulk (~2,650 round-trips → seconds) |
| Jun 8 | 0.3.23 | **Sync Manifest** introduced; self-healing month rollover; sync-plan/step/run/monthly-resync-status endpoints |
| Jun 10 | 0.3.25 | Model Assumptions moved to past-resync + mirrored to BQ |
| Jun 12 | — | **Daily sync cron live in prod** (09:00 UTC); observed firing autonomously |
| Jun 16-19 | 0.3.26+ | `@warehouse-publish` step + BQ serving cutover + cache-token bump |
