---
name: goals-rename-orphan
description: Renaming a client in the Master Tracker leaves orphan goals rows (upsert-only importer); they double-count — must delete + republish. Plus how to run prod DB ops via railway run.
metadata: 
  node_type: memory
  type: reference
  originSessionId: 23c6899d-f043-4d1c-9662-68a72342385a
---

**Gotcha (2026-06-18, found via Dr Squatch):** `import_goals_vs_delivery`
(`backend/app/services/migration_service.py:3822`) is **upsert-only** on the
natural key `(month_year, week_number, client_name, content_type)` — it never
deletes rows whose `client_name` the sheet no longer emits. So when someone
**renames a client in the Master Tracker** (e.g. "Dr. Squatch" → "Dr Squatch",
removing a dot), a re-sync INSERTS the new-name rows but the **old-name rows
linger as orphans**.

Why orphans aren't harmless: they match no `clients.name`, so
`aggregateGoalsByPod` (`ContractClientProgress.tsx:164`) buckets them under
**"Unassigned"**, and the warehouse view `v_editorial_fct_goals_client_totals`
emits a **phantom client row** → portfolio/grand-total goals **double-count**.
A plain SYNC / "Re-sync Past Months" does NOT clean this up.

**Fix procedure (3 steps, order of sync/delete doesn't matter since the sheet no
longer emits the old name; publish MUST be last):**
1. Re-sync goals: `POST {API}/api/migrate/sync-step` body `{"key":"goals-vs-delivery"}` (mode=all, every monthly tab).
2. Delete the orphan: `DELETE FROM goals_vs_delivery WHERE client_name = '<old name>';`
3. Republish so dashboards (which read the **warehouse**, not raw) reflect it: `POST .../sync-step {"key":"@warehouse-publish"}`.

**Running prod (Neon) DB ops from the terminal — I DO have prod access:** the
Railway CLI is linked (`railway status` → project/service `editorial-hub-api`,
env `production`). Local `.env` only points at the local docker DB, and there's
no local `psql`, so use **`railway run`** to inject the prod `DATABASE_URL`,
plus the backend's own async engine (handles Neon URL+SSL):
`cd backend && railway run --service editorial-hub-api env PYTHONPATH="$(pwd)" .venv/bin/python <script>`
where the script does `from app.database import async_session` + `text(...)`.
(Prod client IDs differ from local — Dr Squatch = 540 local, **2 prod**; resolve
ids from the DB, never assume. See [[importer-bare-month-skip]].)

Same family of "source-name ≠ Hub name" bugs: bare-month skip (Pebl), casing
(n8n "N8N" → fixed with a case-insensitive RBAC scope match), dot (Dr Squatch).
Related: [[normalization-scope-2025]], [[importer-bare-month-skip]].
