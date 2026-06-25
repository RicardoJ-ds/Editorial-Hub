# Editorial Hub — backend

FastAPI + SQLAlchemy (async) + PostgreSQL 16, **uv-managed**. Lives in `backend/`. Serves the
dashboards (reads from the warehouse via BigQuery + in-process cache when `DASHBOARD_SOURCE=bq`,
else Postgres `warehouse` schema) and owns all writes + RBAC + comments + data-quality.

> Complements the **root `CLAUDE.md`** (architecture, routes, data sources, sync manifest,
> version procedure) — this file is the backend-local map. Don't duplicate; cross-reference.

## Services / modules — `app/services/`

| Module | Responsibility |
|---|---|
| `access.py` | RBAC resolution (`resolve_access` + `resolve_access_cached`) and `seed_access_baseline` (views, groups, seed members, default matrix). |
| `bq_dashboard.py` | BigQuery dashboard query layer — `q(sql, params)` against `graphite_bi_sandbox`. |
| `bq_cache.py` | In-process cache fronting `q()`, keyed by `(sql, params, publish_token)` from the `cache_version` row; TTL fallback + serve-stale-on-error. |
| `capacity_calc.py` | Capacity-utilization math (real / weighted / spare). **Shared with the ETL mart** — keep parity. |
| `calculations.py` | Computed KPI + dashboard aggregations. |
| `client_delivery_service.py` | Client delivery / SOW aggregations for the Editorial Clients dashboard. |
| `notion_kpi_service.py` | Notion-derived KPIs: Revision Rate, Turnaround Time, Second Reviews. |
| `migration_service.py` | `import_all()` + every per-sheet importer (idempotent upserts on natural keys). |
| `sync_manifest.py` | **Single source of truth for the sync plan** — `ManifestStep`s tagged scope `current`/`past`. Add an importer here; it flows to SYNC button, resync, cron, and UIs. |
| `google_auth.py` | Google service-account auth (`graphite-bi-sa@graphite-data`) for Sheets + BigQuery. |

Auth gating lives in `app/auth_deps.py`: `require_admin` (Admin group only) and
`require_access_editor` (Admin OR `admin.access.edit`). Frontend forwards `X-User-Email`;
admins may impersonate via `X-Preview-As`.

## API routes / endpoints — registered in `main.py`

| Router | Prefix | Notes |
|---|---|---|
| `clients` | `/api/clients` | Client list + per-pod filter |
| `deliverables` | `/api/deliverables` | Monthly deliverables vs SOW |
| `team_members` | `/api/team-members` | Roster |
| `capacity` | `/api/capacity` | pod-summary · member-utilization(-matrix) · client-contributions |
| `kpis` | `/api/kpis` | D2 KPI heatmap |
| `dashboard` | `/api/dashboard` | Overview / exec snapshot data |
| `client_delivery` | `/api/dashboard/client-delivery` | Client delivery sub-resource |
| `goals_delivery` | `/api/goals-delivery` | Goals vs delivery |
| `articles` | `/api/articles` | Monthly Articles (`/monthly`, `/editors`, `/unmapped` — all read-only; name edits live in the Editorial Name Mappings sheet → BQ `editorial_name_map`) |
| `ai_monitoring` | `/api/ai-monitoring` | Writer AI compliance |
| `notion_articles` | `/api/notion-articles` | Notion Content Machine mirror |
| `access` | `/api/access` | RBAC matrix CRUD |
| `admin` | `/api/admin` | Data Quality (read-only): discrepancies, pod-history, pod-name-overrides (GET). Map/dismiss/override **writes removed** — DQ problems are fixed at the source sheet, not mapped in the UI |
| `overview_comments` | `/api/overview/comments` | Overview comment threads |
| `analytics` | `/api/analytics` | Usage analytics (admin-only) |
| `migration` | `/api/migrate` | sync-plan / sync-step / sync-run / status / resync |

`GET /api/health` → liveness.

## Key data models — `app/models.py`

| Model | Purpose |
|---|---|
| `clients` | Client SOW / contract roster |
| `deliverables_monthly` | Per-month delivered/invoiced (self-heals removed months) |
| `team_members`, `capacity_projections`, `editorial_member_capacity` | Roster + pod-level + per-slot capacity |
| `article_records` + `article_revisions` | One row per (article, editor); revisions bucketed by their own month; `second_review` = canonical Sr-editor from the sheet's 2ND REVIEW column |
| `goals_vs_delivery` | Weekly goals vs delivery (uq on month/week/client/content_type) |
| `production_history` | Operating-model actuals/projected (+ `projected_original`) |
| `pod_assignments` + `pod_assignment_history` | Current + historical member↔pod↔client |
| `access_views`, `access_groups`, `access_group_members`, `access_group_view_permissions`, `access_user_overrides` | RBAC |
| `usage_events` | Analytics (6-month retention) |
| `notion_articles` | Published-status reference |
| `cache_version` | One-row publish token for BQ cache invalidation |

## Startup sequence — `lifespan()` in `main.py`

The app boots in this order (idempotent — startup bugs hide here):

1. `Base.metadata.create_all` — creates any new tables (never ALTERs existing ones).
2. `_run_data_migrations(conn)` — one-shot idempotent data migrations: ensure the
   `cache_version` row exists, apply column ALTERs/backfills `create_all` can't, and trim
   `usage_events` older than 6 months.
3. `_seed_access(conn)` — RBAC baseline (views, groups, seed members, default matrix).
4. If `SYNC_CRON_ENABLED` — start `_daily_sync_loop()` (manifest scope=`current` daily at
   `SYNC_CRON_UTC_HOUR`, default 09:00 UTC; rollover auto-escalates to `full`). OFF locally.

## Build & test

Run from `backend/` (uv-managed; ruff + mypy configured in `pyproject.toml`):

```bash
cd backend
uv run ruff check .
uv run ruff format .
uv run mypy .
uv run pytest -q        # backend/tests/
```

## Code standards

- Type hints on public functions; ruff + mypy clean (config in `pyproject.toml`).
- **`get_db()` never commits** — mutation endpoints must call `db.commit()`; a bare `flush()`
  rolls back at request end. (Burned us on pod-name overrides — see memory.)
- Dashboard reads go through `bq_dashboard.q()` (cached); keep Neon thin (writes + RBAC +
  comments + DQ). After any SYNC, the warehouse-publish step bumps `cache_version`.
- All importers idempotent (upsert on natural keys); ordering doesn't matter.
- Use the project environment (`uv`), not system Python.
