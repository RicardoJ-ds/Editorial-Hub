# Sheet Sync Architecture

> **Added:** 2026-06-08 (v0.3.23)
> **Companion docs:**
> - [`sheet-inventory.md`](sheet-inventory.md) — which sheets feed which tables
> - [`../frontend/docs/SHEETS_DOCUMENTATION.md`](../../frontend/docs/SHEETS_DOCUMENTATION.md) — per-sheet column reference

How the Hub pulls fresh data from the Google Sheets, and the **one place** you
edit when adding a new data source.

---

## The Sync Manifest — single source of truth

Everything that gets synced is declared **once** in
[`backend/app/services/sync_manifest.py`](../../backend/app/services/sync_manifest.py)
as a list of `ManifestStep`s. Each step is tagged with a **scope**:

| Scope | When it runs | Examples |
|---|---|---|
| `current` | Every SYNC click (this month's live sheets) | SOW overview, Delivered vs Invoiced, Operating Model, AI Monitoring, Cumulative, Goals (current month), Notion, Growth Pods, Monthly Article Count, the live ET CP version, computed-KPI refresh |
| `past` | The "Re-sync Past Months" pass | Goals vs Delivery (**all** months), Week Distribution, Team Pods, ET CP Pod History, Backfill Editorial Pod |
| `full` | `current` **then** `past` — i.e. "click SYNC, then Re-sync Past Months" | used by the month-rollover trigger + cron |

Every trigger reads from this manifest, so they can never drift:

- the **SYNC** button (`SyncControls` → `SyncAllModal`),
- the **Re-sync Past Months** card (`/data-management/import` → `HistoricalResyncTab`),
- the **month-rollover** auto-resync (see below),
- a future **cron / agent / headless** call,
- and the **progress UIs**, which render the step list straight from the manifest.

### Adding a new importer (the runbook)

1. Write the importer fn in `migration_service.py` (returns an `ImportResult`),
   and — if it maps to a real sheet — register it in `IMPORT_DISPATCH`.
2. Add **one** `ManifestStep` to `sync_manifest.py`:
   - a current-month sheet → add `_sheet("Your Sheet Name")` to `CURRENT_STEPS`;
   - a versioned/dynamic tab family → add a `ManifestStep(..., dynamic_prefix="…")`
     (it expands to one step per matching live sheet at plan time);
   - a past-months / annual step → add a `ManifestStep(..., scope="past", run=…)`
     to `PAST_STEPS` (give it a `description` for the Re-sync card).
3. That's it. The SYNC button, Re-sync card, rollover, cron, and progress UIs
   all pick it up automatically. **Do not** add a second copy to any frontend
   list — there are none to keep in sync anymore.

---

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/migrate/sync-plan?scope=current\|past\|full` | The ordered step list for a scope. Dynamic tabs are expanded against the live sheet list. The UIs render from this. |
| `POST /api/migrate/sync-step` `{ "key": "…" }` | Run one step (a sheet name, or a fixed id like `goals-vs-delivery` / `@refresh-kpis`). Drives per-step progress. |
| `POST /api/migrate/sync-run?scope=full` | Run an **entire scope** server-side in one call — for cron / agent / headless triggers ("do everything"). |
| `GET /api/migrate/monthly-resync-status` | Whether a past-months resync is **due** (a new month rolled over and last month isn't refreshed yet). |
| `GET /api/migrate/status` | Last-import audit row → the "Synced …" badge. Written by `import_all()`. |

Back-compat: `POST /api/migrate/goals-historical-resync` and
`POST /api/migrate/resync/{step}` still exist but now delegate to the manifest.
The legacy `POST /api/migrate/sync-all` is an unused orphan — prefer
`/sync-run?scope=full`.

---

## Month-rollover auto-resync (self-healing)

**Problem it solves:** the regular SYNC freezes closed-month `[Month Year]
Goals vs Delivery` tabs (via `sheet_sync_history`). When a month closes and the
team finishes entering its final numbers a few days into the next month, those
edits never reach the Hub unless someone manually runs Re-sync Past Months — so
"last month" reads stale (low %, yellow/red) even though the sheet is green.

**Fix:** the **first SYNC of a new editorial month** automatically runs
`scope=full` (= SYNC + Re-sync Past Months). `SyncAllModal` checks
`monthly-resync-status` first; when `due`, it pulls `scope=full` and shows a
"New month detected — also refreshing past months" banner. Subsequent syncs
that month run `scope=current` (normal speed).

**Due-check** (`sync_manifest.monthly_resync_due`): the past-resync is *due*
when the latest Goals-tab `sheet_sync_history.synced_at` predates the current
editorial month's **Week-1 start** (from `editorial_weeks` — the same week
distribution the "As of" badge uses). `current_editorial_month()` mirrors the
frontend's `currentEditorialMonth` so server and client agree.

**Example (June 8, 2026):** editorial June started June 3; the last Goals sync
was May 25 → `due: true` → the next SYNC runs full and finalizes May.

---

## Why "last month" can look stale and "current month" empty

On the Pod Snapshot **Goals** column:

- **Current month** (e.g. June) is *in progress* — a few days in, almost
  nothing is delivered yet, so 0% is expected, not a bug. The selector defaults
  to **Last month** for this reason.
- **Last month** (e.g. May) should be complete — but if it's the first sync
  after the month rolled over and the resync hasn't run, it shows the last
  mid-month snapshot (stale). Running SYNC (which now auto-resyncs past months)
  refreshes it to the sheet's final numbers.
