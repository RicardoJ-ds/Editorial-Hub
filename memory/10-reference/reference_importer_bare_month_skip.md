---
name: importer-bare-month-skip
description: "Delivered-vs-Invoiced importer silently drops a client whose \"Month 1\" cell lacks a year; how to fix + run a targeted prod sync from the terminal"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 615365e5-c0c5-40d8-bacf-dfc56631f55e
---

**Gotcha (2026-06-18, found via Pebl):** `import_delivered_invoiced` (`backend/app/services/migration_service.py:~960`) reads each client block's "Month 1" cell (col F) via `parse_month_str()`, which does `datetime.strptime(value, "%b %Y")` — it REQUIRES `"<Mon> YYYY"` (e.g. "May 2026"). A bare `"May"` returns `(None, None)` → the importer hits `if start_year is None: row_idx += 6; continue` and **silently skips the entire client block** (no Data Quality flag). Result: that client gets **0 rows in `deliverables_monthly`**.

Symptom seen: Pebl %SOW **cell showed 1.6%** (from `clients.articles_delivered=3`, set by the Operating-Model importer which parsed fine) but the **%SOW popover showed 0%** (it sums `deliverables_monthly` via `buildLifetimeSummaries()` in `frontend/src/lib/overviewSummary.ts` — 0 rows). The popover's monthly chart reads the Operating Model, so it self-contradicted (chart=3, headline=0). Root cause = one source-cell typo + two surfaces reading two different "delivered" sources.

**Fix applied:** DaniQ corrected the sheet cell "May" → "May 2026"; re-synced. **Recommended code hardening (NOT yet done):** make `parse_month_str` accept a bare month (infer year from the "Start Date SOW" col E or current year), AND flag skipped clients into Data Quality instead of dropping silently. Consider unifying the %SOW cell + popover on ONE delivered source.

**Run a targeted sync against PROD from the terminal (no dashboard):** the headless endpoints execute on Railway and write to Neon.
- `POST {API}/api/migrate/sync-step` body `{"key":"<step>"}` — keys are sheet names (e.g. `"Delivered vs Invoiced v2"`) or fixed ids (`@refresh-kpis`, `@warehouse-publish`). Header `X-User-Email: ricardo.jaramillo@graphitehq.com`.
- `POST {API}/api/migrate/sync-run?scope=current|past|full` — whole scope (what the daily cron runs). `GET /api/migrate/sync-plan?scope=` lists step keys (computed from manifest, no DB — works even when DB is down).
- Dashboards serve the **warehouse** (`DASHBOARD_SOURCE=postgres`), so after any importer step you MUST also run `@warehouse-publish` for the change to show. API base = `https://editorial-hub-api-production.up.railway.app`.

**Watch-outs:** (1) **client IDs differ between local docker DB and prod Neon** — Pebl = 544 local, **82 prod**; always resolve the id from `/api/clients/` before querying prod by id. (2) After a Neon outage the backend pool serves dead connections ("SSL connection has been closed unexpectedly"); it self-heals after a few requests, else redeploy the Railway service.
