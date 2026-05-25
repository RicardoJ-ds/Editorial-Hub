# Editorial Hub

**Current version: `0.3.15`** — see `CHANGELOG.md` for the full history and the
versioning scheme (`0.PHASE.ITERATION`; UI surface reads from
`frontend/src/lib/version.ts`). Bump that constant on every release.

### Version-bump procedure

When asked to "update the version":

1. **Default = bump PATCH only** (e.g., `0.3.2 → 0.3.3`).
2. **Bumping PHASE (`0.3.x → 0.4.0`) or rolling to `1.0` requires explicit
   confirmation.** PHASE changes signal a new project focus area — never
   auto-roll. `1.0` is reserved for when CP v2 is wired to the database and
   RBAC is signed off.
3. Update all four surfaces in one commit:
   - `frontend/src/lib/version.ts` — `VERSION` constant (single source of truth).
   - `CLAUDE.md` (this file) — the "Current version" line above.
   - `CHANGELOG.md` — add a new top section under the new `## X.Y.Z — <date>`
     heading, plain-language for stakeholders.
   - Sidebar version chip reads `version.ts` automatically; no edit.
4. Create an annotated git tag `vX.Y.Z` on the bump commit
   (e.g., `git tag -a v0.3.3 -m "…"`).
5. **Confirm before pushing tags** (`git push origin vX.Y.Z`).

Phase reference: `0.1.x` initial Hub · `0.2.x` data foundation · `0.3.x` UI
maturity (current) · `0.4.x` CP v2 → DB migration (next) · `1.0` Hub
becomes primary tool of record.

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
- **Auth**: Google OAuth, restricted to `@graphitehq.com` (see `frontend/proxy.ts`, `frontend/src/lib/auth.ts`). Session is a JWT cookie signed with `AUTH_SECRET`. Frontend forwards the email to the backend via `X-User-Email` header (see `frontend/src/lib/api.ts` + `frontend/src/app/api/me/route.ts`); backend resolves view-level RBAC via `app/auth_deps.py` + `app/services/access.py`. Two privilege tiers gate matrix mutations: `require_admin` (Admin group only — for Admin-group changes and `admin.access` / `admin.access.edit` grants) and `require_access_editor` (Admin OR `admin.access.edit` view — for cell toggles + member changes on non-Admin groups). Admin-only `X-Preview-As` header impersonates another user. Access profile auto-refreshes on tab focus so revocations propagate without a manual page reload.
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
| `/overview` | **Overview** (exec snapshot) | Three sections: **Pod Snapshot** (`PodDeliveryProgressCard`: per-pod + per-client Goals / Last Q / Current Q / %SOW / %Published; Current Q bar reads ACTUAL delivered to date — variance + tier from projected end-of-Q; section-local Goals period selector; click-anchored `ClientDetailPopover` drill-downs), **Time to Milestones** (`PodPaceSection`: 3 cards — `PodMilestoneJourneyCard` with unified day-axis at top + click-to-focus a client; `PodTTMStatsCard` with 8 milestone-transition averages and a contributors popup; `TimeToTrendChart` per-client days bar chart with metric dropdown — all wired by `LinkedHover` + a `useLinkCardsToggle` chip in the section header for cross-card highlighting), and **Production History** (`ProductionTrendChart` with All / Per pod / Per client view toggle; Per Client gated to single-pod scope; custom tooltip rendered outside Recharts via `MeasuredTooltipShell`, position-fixed + viewport-clamped). |
| `/editorial-clients` | D1: Contract & Timeline + Deliverables vs SOW tabs | Client-level SOW tracking |
| `/team-kpis` | D2: KPI heatmap + Capacity Projections + AI Compliance tabs | Team performance |
| `/capacity-planning` | **Capacity Maintenance** (CP v2 prototype, localStorage-backed) | Proposal — see `CAPACITY_PLANNING_V2.md`. Sidebar entry was renamed from "Capacity Planning v2" |
| `/data-management/import` | Import Wizard + Re-sync past months | The other CRUD pages (Clients, Deliverables, Capacity, KPI Entry) are still routable but hidden from the sidebar — they'll be replaced by the CP v2 maintain screens |
| `/admin/access` | **Access Control** | Live RBAC matrix. Both Groups and Users × Views tabs render as a single matrix table with a 3-level column header (Section → Dashboard → Tab) and per-section dividers. Groups: row-per-group with click-to-expand member lists in a 3-col grid. Users × Views: row-per-user with override-direction arrows (↑ extra grant / ↓ revoke) + "Show only overrides" filter. Editing privilege split: the Access Control column renders **two pills** per row — `View` (green, gated on `admin.access`) and `Edit` (blue, gated on `admin.access.edit`). True admins gate the Admin row, the seeded admin baseline (Daniela / Ricardo), and grants of `admin.access.edit` itself — preventing privilege escalation. Audit Log tab + Preview-As (sticky global banner via `PreviewBanner`, redirects to first accessible page). Backend tables: `access_views`, `access_groups`, `access_group_members`, `access_group_view_permissions`, `access_user_overrides`. |
| `/admin/data-quality` | **Data Quality** | Tabs: end-date drift (SOW Overview vs Operating Model) · **Delivered drift** (4-source comparison — Ops Model, Delivered vs Invoiced, Cumulative Pipeline, SOW Overview — with span colouring) · **Pod History** (merged former Pod Drift + Missing SOW + Not-in-SOW-Overview tabs into one view with combined filter chips: RESOLVED / POD DRIFT / INCOMPLETE SOW / NOT IN SOW OVERVIEW; per-row `missing_fields` exposed) · **Modeling Limitations**. Every tab carries Google-Sheets-style per-column header filters (text / combobox / select / range / date) via `ColumnFilter`. Page layout is viewport-fixed; only the tab tables scroll. Sourced from `GET /api/admin/discrepancies` + `GET /api/admin/pod-history`. Pod issues persist in `pod_import_issues`; cleared automatically when fuzzy self-heal resolves the match on a later SYNC. Backfilling editorial pod from history runs as a step in the past-months resync (`backfill_editorial_pod_from_history()`). |
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
| Delivered vs Invoiced v2 | `deliverables_monthly` | ✅ live sync — no month cap (reads all populated columns; the previous 36-month hard limit was removed to support multi-year/renewal contracts like Webflow) |
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
| `<YYYY> Week Distribution` | `editorial_weeks` | ✅ via past-months resync — defines when each Editorial month begins (drives "As of" badge) |

### Spreadsheet 3 — Writer AI Monitoring
ID: `13kl0_6YuzsJ3xEzNLzDZeR-sHMaNJNw6oJGmwb-CBOU`

| Sheet | Destination | Ingested? |
|---|---|---|
| Data / Rewrites / Yellow-Red Flags_v2 | `ai_monitoring_records` | ✅ seeded (1,168 rows); **new scans paused upstream** |
| Surfer's API usage | `surfer_api_usage` | ✅ seeded |

### Spreadsheet 4 — Team Pods
ID env-driven via `TEAM_PODS_ID`; currently a **temporary copy** at `1N6q1ZYC4W9BYusewdwqwprUu9zSmbQp99mC3f2y3_HI` — must be swapped to the original sheet before prod.

| Sheet | Destination | Ingested? |
|---|---|---|
| Editorial Team [<Mon> <YYYY>] | `pod_assignments` (pod_kind=editorial) | ✅ chip-based: emails come from people-chip metadata via `spreadsheets.get(includeGridData=true)` |
| Growth Team [<Mon> <YYYY>] | `pod_assignments` (pod_kind=growth) | ✅ same chip-based path; tab has different headers + 2 pod-member columns |

Powers RBAC group auto-population for the two pod-derived groups: **Editorial Team** (Senior Editors + Editors; Writers excluded) and **Growth Team** (Growth Leads / Directors / Account Directors / Managers; Content Specialists excluded). The **Leadership + Ops** group is seed-only (VPs, managers, and ops leads) and is no longer pod-derived. Also drives the per-pod client filter at `/api/clients/`.

### Notion Database (separate connector, not a sheet)
Imported via `backend/app/services/notion_import.py` (paginated read + bulk upsert — fix shipped in `612c854`, Apr 16). Populates `notion_articles`, feeds 3 KPIs: Revision Rate, Turnaround Time, Second Reviews.

## PRD Compliance

**Audit:** `.docs/prd-compliance-audit.md` (gitignored — local reference; last full audit 2026-04-07 with deltas appended through 2026-04-26).
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
- **Section hierarchy on the dashboards**: page-level h1 (`text-base` bold, white, `tracking-[0.18em]`) on all three dashboards; section h2s use the lighter `text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]` style (Overview's `Section` component); h3 (`text-sm` semibold, `#C4BCAA`) for cards within. Card subtitles are kept short and inline — `DataSourceBadge` is now a no-op (returns null) so LIVE / source chips are hidden across the Hub.
- **Header layout**: all three dashboard pages (Overview, Editorial Clients, Team KPIs) share the same `flex-nowrap items-center gap-x-4` shape with `text-base` h1, `FilterBar`, and `SyncControls` (`ml-auto shrink-0`) in one row. Overview's sticky band is `min-h-[72px]` (one title row only); Editorial Clients + Team KPIs keep `min-h-[120px]` because they add a `TabsList` row below the title.
- **Sticky section headers**: section h2s use plain (non-sticky) typography on all three dashboards (the older `sticky top-[120px] z-10 border-b` pattern was dropped). Overview Section components carry `scroll-mt-[92px]` for anchor jumps; Editorial Clients + Team KPIs use `scroll-mt-[140px]` to clear their taller header.
- **SectionIndex anchor nav**: each tab renders a thin sticky left-side rail (`SectionIndex`) listing its sections; click jumps to the section, scroll-spy keeps the active item highlighted. Hidden below `xl`. The component walks up the DOM and listens to every scrollable ancestor — the page's actual scroller is `<div className="ml-[64px] ... overflow-auto">` from `(app)/layout.tsx`, not `window`.
- **Pipeline stage palette**: bars in cumulative-pipeline cards use Graphite primary greens P3 → P2 → P1 (Topics → CBs → Articles, dark → bright) plus WN1 cream for Published. Strictly DS swatches; defined as `PIPELINE_STAGE_COLORS` in `shared-helpers.tsx`.
- **Pacing-aware status colors**: lifetime % of contract progress uses `pacingColor(actualPct, elapsedPct)` from `shared-helpers.tsx` — a brand-new client at 5 % isn't behind, they just started. Helper unifies this across per-client cards, per-pod cards, and the scope-aware top cards.
- **Content-type weighting**: goals aggregations apply `contentTypeRatio()` (article ×1, jumbo ×2, LP ×0.5) so a jumbo's CBs/articles count for two units — keeps `GoalsVsDeliverySection` summary, `aggregateGoalsByPod`, and `GoalsMonthTable` totals consistent.
- **Tooltip body**: every metric tooltip uses the `TooltipBody` helper — uppercase mono title + 2–3 short bullets — so every tooltip looks the same. `DataSourceBadge` was deemed visual noise and now renders null hub-wide; the component is kept so existing call sites compile.
- **Milestone numbering**: the six lifecycle milestones are numbered `1` Consulting KO · `2` Editorial KO · `3` First CB Approved · `4` First Article · `5` First Feedback · `6` First Published. Helper `MILESTONE_NUM_BY_FIELD` + `milestonePairPrefix(from, to)` in `shared-helpers.tsx` drive the numbered prefixes shown in legends, Time-to-Metrics card titles, the Per-Client Days metric dropdown, and tooltips.
- **Pod display**: always say "Editorial Pod N" or "Growth Pod N" in user-facing copy via `displayPod()` in `frontend/src/components/dashboard/shared-helpers.tsx`. Internal keys stay as `"Pod N"` so existing `POD_COLORS` lookups and Map/Set keys keep working.

### Sheet sync (live, not one-time)
- **SYNC button** lives in `SyncControls` — rendered inline next to the filters on D1/D2 (since their header bar is hidden) and inside the global header on every other route. Clicking it opens `SyncAllModal` which fans out to `/api/migrate/import` once per sheet, shows per-sheet progress, then appends a synthetic **"Refresh computed KPIs"** step that calls `POST /api/migrate/refresh-kpis` so the four Notion-derived KPIs (Revision Rate, Turnaround Time, Second Reviews, Capacity Utilization) recompute on every sync. Without that step the heatmap would only update its sheet-derived columns. A "Synced Apr 23, 4:18 PM" badge sits next to the button (locale + timezone aware), reading from `GET /api/migrate/status` and refreshing on the existing `data-synced` event.
- **`/data-management/import`** has a two-tab layout: *Import Wizard* (manual sheet picker with preview) and *Re-sync Past Months* (forces a full re-import of every `[Month Year] Goals vs Delivery` tab — normally frozen by `sheet_sync_history`).
- All importers are idempotent (upsert on natural keys); ordering doesn't matter.

## Memory & Commits

- No `Co-Authored-By` lines in commit messages.
- Keep commits scoped; prefer new commits over amending.
- When updating this file: run `.claude/skills/pre-commit-checks/` first.
