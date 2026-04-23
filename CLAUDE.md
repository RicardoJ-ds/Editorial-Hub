# Editorial Hub

BI platform for Graphite's Editorial Team. Replaces the CP/Ops team's workflow
across three Google Sheets with a single app. Today: **read-only dashboards**
driven by one-time CSV seeds; **Capacity Planning v2** prototype is live but
still writes to `localStorage`, not the database.

## Project Links
- **PRD 1 (Build Prompt v3)**: https://docs.google.com/document/d/19CxD9p9EWpN54blgSI8V-Anqc5N_7Ax1/edit
- **PRD 2 (PRD Final v3)**: https://docs.google.com/document/d/1CbCpQ5VACySSmSVVk9S4eMBPlanNWCzP/edit
- **PRD 3 (Input Template — detailed)**: https://docs.google.com/document/d/1tus6wvrQIrQf-ygXQxtogv6QOocv8PMsRN8xnNp6fJQ/edit
- **Editorial Capacity Planning Spreadsheet**: https://docs.google.com/spreadsheets/d/1I6fNQMjs2y4l6IyOxd9QL-QBjB2zGi0mcoV840JDmkI
- **Master Tracker Spreadsheet**: https://docs.google.com/spreadsheets/d/1dtZIiTKPEkhc0qrlWdlvd-n8qAn5-lhVcPkgHNgoLAY
- **Writer AI Monitoring Spreadsheet**: https://docs.google.com/spreadsheets/d/13kl0_6YuzsJ3xEzNLzDZeR-sHMaNJNw6oJGmwb-CBOU
- **Local PRD copies**: `data/` (gitignored)

## Architecture

- **Frontend**: Next.js **16.2** + React 19 + shadcn/ui + Tailwind v4 (`frontend/`)
- **Backend**: FastAPI + SQLAlchemy async + PostgreSQL 16 (`backend/`)
- **Auth**: Google OAuth, restricted to `@graphitehq.com` (see `frontend/proxy.ts`, `frontend/src/lib/auth.ts`). Session is a JWT cookie signed with `AUTH_SECRET`.
- **Local dev**: Docker Compose (postgres:5480, backend:8050, frontend:4050)
- **Production**:
  - Frontend → **Vercel** (alias `editorial-hub-kappa.vercel.app`)
  - Backend → **Railway** (`editorial-hub-api-production.up.railway.app`)
  - DB → **Neon Postgres**
- **Service Account**: `graphite-bi-sa@graphite-data.iam.gserviceaccount.com` on project `graphite-data`
- **BigQuery (legacy sync, currently unused)**: `graphite_bi_sandbox.editorial_hub_*` tables
- **Design System**: `.docs/Graphite-Interal-DS.html` (gitignored)

## Setup

```bash
cp .env.example .env       # Fill in DB password, Google OAuth creds, sheet IDs
docker compose up -d       # Starts postgres:5480, backend:8050, frontend:4050
cd backend && python scripts/seed_data.py   # One-time seed from backend/data/*.csv
```

All secrets live in `.env` — see `.env.example` for the full list.

## Key Commands

```bash
docker compose up -d              # Full stack
docker compose down               # Stop
cd backend && python scripts/seed_data.py   # Reseed DB from CSVs
cd frontend && npm run dev        # Frontend dev (standalone; needs backend on :8050)
cd frontend && npm run build      # Production build
cd frontend && npx tsc --noEmit   # Type-check
```

**Deploys:** Railway is wired to `RicardoJ-ds/Editorial-Hub` on branch `main` (Settings → Source); every `git push` triggers a backend rebuild. Vercel frontend deploys the same way. **Manual fallback** (only if auto-deploy stalls):
```bash
cd /Users/ricardo/python/editorial-hub
railway up --detach --service editorial-hub-api
```
Do **not** pass `--path-as-root backend` — the Dockerfile references project-root paths (`COPY backend/...`) since commit `e94b46d`. See `~/.claude/projects/.../memory/reference_railway_backend.md`.

## Routes

| Path | Dashboard | Notes |
|---|---|---|
| `/` | Home | Lands on dashboard picker |
| `/editorial-clients` | D1: Contract & Timeline + Deliverables vs SOW tabs | Client-level SOW tracking |
| `/team-kpis` | D2: KPI heatmap + Capacity Projections + AI Compliance tabs | Team performance |
| `/capacity-planning` | **CP v2 prototype** (localStorage-backed) | Proposal — see `CAPACITY_PLANNING_V2.md` |
| `/data-management/*` | Admin CRUD | Clients, Deliverables, Capacity, KPI Entry, Import Wizard |
| `/(auth)/login` | Google OAuth handshake | Redirects back to `/` |

## Data Sources & Ingestion Reality

**Full per-sheet reference:** `frontend/docs/SHEETS_DOCUMENTATION.md`
**Cross-sheet inventory + ingestion status:** `.docs/sheet-inventory.md`
**Dashboard → source mapping:** `.docs/dashboard-data-flow.md`

### Spreadsheet 1 — Editorial Capacity Planning
ID: `1I6fNQMjs2y4l6IyOxd9QL-QBjB2zGi0mcoV840JDmkI`

| Sheet | Destination | Ingested? |
|---|---|---|
| Editorial SOW overview | `clients` | ✅ one-time seed |
| Delivered vs Invoiced v2 | `deliverables_monthly` | ✅ one-time seed |
| ET CP 2026 [V11 Mar 2026] | `team_members` + `capacity_projections` | ✅ one-time seed (pod roster hardcoded in `seed_data.py`) |
| Model Assumptions | `model_assumptions` | ✅ one-time seed |
| Editorial Operating Model | `production_history` | ✅ seeded; drives Production History chart |
| Delivery Schedules | `delivery_templates` | ✅ seeded; drives Pacing badge |
| Editorial Engagement Requirements | `engagement_rules` | ✅ seeded |
| Meta Calendar Month Deliveries | `deliverables_monthly` (subset) | ✅ seeded |

### Spreadsheet 2 — Master Tracker
ID: `1dtZIiTKPEkhc0qrlWdlvd-n8qAn5-lhVcPkgHNgoLAY`

| Sheet | Destination | Ingested? |
|---|---|---|
| Cumulative | `cumulative_metrics` | ✅ seeded |
| [Month Year] Goals vs Delivery (x9) | `goals_vs_delivery` | ✅ seeded |

### Spreadsheet 3 — Writer AI Monitoring
ID: `13kl0_6YuzsJ3xEzNLzDZeR-sHMaNJNw6oJGmwb-CBOU`

| Sheet | Destination | Ingested? |
|---|---|---|
| Data / Rewrites / Yellow-Red Flags_v2 | `ai_monitoring_records` | ✅ seeded (1,168 rows); **new scans paused upstream** |
| Surfer's API usage | `surfer_api_usage` | ✅ seeded |

### Notion Database (separate connector, not a sheet)
Imported via `backend/app/services/notion_import.py` (paginated read + bulk upsert — fix shipped in `612c854`, Apr 16). Populates `notion_articles`, feeds 3 KPIs: Revision Rate, Turnaround Time, Second Reviews.

## PRD Compliance

**Audit:** `.docs/prd-compliance-audit.md` (gitignored — local reference; last full audit 2026-04-07 with an Apr 14–18 delta appended).
**Current coverage:** ~98% of PRD (auth deferred per §9 — now partially implemented via Google OAuth).
**All 9 D2 KPIs use real data** (0 mock):
- Revision Rate, Turnaround Time, Second Reviews → Notion DB
- AI Compliance → Writer AI Monitoring 2.0
- Capacity Utilization → ET CP 2026 (`capacity_projections`)
- Internal / External Quality, Mentorship, Feedback Adoption → Monthly KPI Scores sheet

**Remaining P1 gaps:** Quarter picker on D2; auto-detect latest CP version.

## Capacity Planning v2 (prototype)

**Status:** Phases 1–8 of the UI maintenance overhaul are shipped to production, **all backed by `localStorage` and mock data**. Zero `cp2_*` tables exist in `backend/app/models.py` today. See `CAPACITY_PLANNING_V2.md` for the schema spec and `CP2_COVERAGE_AUDIT.md` for the column-level coverage proof.

**What's live:**
- Overview Board, Roster, Allocation, Leave, Overrides, Weekly Actuals, Quarter rollup, Migration Validator (dry-run), Global Search, Month Diff, Admin CRUD for 5 dim tables, Schema (fullscreen ERD + click-to-highlight), Tables, Glossary.

**What's NOT built yet:**
- Alembic migrations for `cp2_*` tables
- One-time ETL script to populate `cp2_*` from today's tables
- Wiring Editorial Clients + Team KPIs dashboards onto `cp2_*` reads

**Why this matters:** Today the dashboards read from 5+ legacy tables fed by ingestion of 3 separate spreadsheets, with overlapping metrics (e.g. `articles_delivered` lives in both `clients` cumulative and `deliverables_monthly` monthly). The CP v2 ERD is designed to collapse those into a single dim-fact model and eliminate sheet duplication. Migration plan: `.docs/dashboard-data-flow.md`.

## Design Preferences

- Dark mode by default
- Graphite DS colors: greens `#65FFAA` `#42CA80` `#2EBC59`; neutrals `#161616` `#1F1F1F` `#333333` `#000000`
- Typography: IBM Plex Sans (body), JetBrains Mono (labels/data)
- shadcn/ui customized with Graphite theme
- **Section hierarchy on the dashboards**: h2 (`text-base` bold, white, `tracking-[0.2em]`) for top-level sections with a bottom-divider rule; h3 (`text-sm` semibold, `#C4BCAA`) for cards within; `text-xs` for sub-section labels. Card subtitles are avoided — explanatory copy lives inside `DataSourceBadge` tooltips (`source` + `shows` bullets).
- **Pod display**: always say "Editorial Pod N" or "Growth Pod N" in user-facing copy via `displayPod()` in `frontend/src/components/dashboard/shared-helpers.tsx`. Internal keys stay as `"Pod N"` so existing `POD_COLORS` lookups and Map/Set keys keep working.

### Sheet sync (live, not one-time)
- **Header SYNC button** on every page opens a modal that fans out to `/api/migrate/import` once per sheet, shows per-sheet progress, then a rich result view (per-sheet + per-tab expandables with source-data previews).
- **`/data-management/import`** has a two-tab layout: *Import Wizard* (manual sheet picker with preview) and *Re-sync Past Months* (forces a full re-import of every `[Month Year] Goals vs Delivery` tab — normally frozen by `sheet_sync_history`).
- All importers are idempotent (upsert on natural keys); ordering doesn't matter.

## Memory & Commits

- No `Co-Authored-By` lines in commit messages.
- Keep commits scoped; prefer new commits over amending.
- When updating this file: run `.claude/skills/pre-commit-checks/` first.
