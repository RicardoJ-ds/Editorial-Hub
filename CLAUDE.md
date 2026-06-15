# Editorial Hub

**Current version: `0.3.25`** — see `CHANGELOG.md` for the full history and the
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
- **Warehouse (dual-sink, `feature/etl-warehouse-refactor`)**: `etl/warehouse/` publishes a layered model (19 `editorial_raw_*` + 9 `editorial_int_*` tables + 20 `v_editorial_*` views) to BOTH Postgres schema `warehouse` (what the dashboards serve — `DASHBOARD_SOURCE=postgres`, default) and BigQuery `graphite_bi_sandbox` (always-fresh analytics mirror / backup) from the same in-memory rows in one ~20s publish. All business math (billing periods, end-of-Q variance + tiers, goals 3-step weighting, capacity fallback model) is applied in the int layer — design + bug register in `etl/WAREHOUSE_DESIGN.md`; parity proofs in `etl/PARITY_REPORT_WAREHOUSE.md` + `etl/PARITY_REPORT_ENDPOINTS.md`. `DASHBOARD_SOURCE=bq` flips serving to BigQuery; the `X-Data-Source` per-request override is gated by `DATA_SOURCE_OVERRIDE_ENABLED` (local-only, OFF in prod). Terminal refresh: `./etl/refresh.sh [current|past|full]`.
- **BigQuery (phase-1 flat mirror, deprecated)**: `graphite_bi_sandbox.editorial_hub_*` tables — superseded by the warehouse; decommission after merge validation (see `etl/README.md` banner)
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
| `/team-kpis` | D2: KPI heatmap + **Capacity** + AI Compliance + **Monthly Articles** tabs | Team performance. **Capacity** (`CapacityTab`, merged the old Capacity Projections + Capacity by Pod tabs into one — single shared month selector + `SectionIndex` rail): **At a glance** (KPI strip: delivered/planned utilization, pods over plan, spare capacity) · **By Pod** (per-pod plan vs delivered + status dot, latest ET CP version via `/api/capacity/pod-summary`) · **Trend** (all months; `[Pods | Editors]` toggle — Pods = `PodUtilizationTrendChart` line chart with Planned/Delivered sub-toggle, Editors = the member×month heat matrix `EditorTrendMatrix`) · **By Editor** (`MemberUtilizationSection`, `/api/capacity/member-utilization`) · **By Client** (`ClientContributionsSection`, `/api/capacity/client-contributions`). Respects the FilterBar pod scope via `activePods`. Capacity math is shared with the ETL mart through `app/services/capacity_calc.py`. **Monthly Articles** (`MonthlyArticlesTab`): per-editor delivered-article counts from the Monthly Article Count sheet — a timeline chart with a Per Pod / Per Client / Per Editor view toggle (default Per Pod; client/editor cap at top 12 + "Other") + a page-scoped editor multi-select, plus a configurable pivot matrix (Group-by + then-by over Pod/Client/Editor, Invert, collapsible rows, monthly columns + subtotals + grand total). A **metric selector** drives both chart + matrix: **Articles** (count) · **Revision rate %** (articles with ≥1 revision ÷ articles, by article **creation** month) · **Revisions** (revision-event count, by each revision's **own** month). Rate carries num/den through aggregation so subtotals are pooled rates, not averages. Tooltip shows a **published reference** (Notion-matched count). Pod grouping follows the global **Editorial/Growth pod-axis toggle** (`useCurrentPodAxis`) — each article carries both `editorial_pod` and `growth_pod` denormalized from its client's **current** pods. Header is the canonical `FilterBar`. Reads `GET /api/articles/monthly?pod_axis=…` (returns `creation` + `revisions` arrays) + `/api/articles/editors`. |
| `/capacity-planning` | **Capacity Maintenance** (CP v2 prototype, localStorage-backed) | Proposal — see `CAPACITY_PLANNING_V2.md`. Sidebar entry was renamed from "Capacity Planning v2" |
| `/data-management/import` | Import Wizard + Re-sync past months | The other CRUD pages (Clients, Deliverables, Capacity, KPI Entry) are still routable but hidden from the sidebar — they'll be replaced by the CP v2 maintain screens |
| `/admin/access` | **Access Control** | Live RBAC matrix. Both Groups and Users × Views tabs render as a single matrix table with a 3-level column header (Section → Dashboard → Tab) and per-section dividers. Groups: row-per-group with click-to-expand member lists in a 3-col grid. Users × Views: row-per-user with override-direction arrows (↑ extra grant / ↓ revoke) + "Show only overrides" filter. Editing privilege split: the Access Control column renders **two pills** per row — `View` (green, gated on `admin.access`) and `Edit` (blue, gated on `admin.access.edit`). True admins gate the Admin row, the seeded admin baseline (Daniela / Ricardo), and grants of `admin.access.edit` itself — preventing privilege escalation. Audit Log tab + Preview-As (sticky global banner via `PreviewBanner`, redirects to first accessible page). Backend tables: `access_views`, `access_groups`, `access_group_members`, `access_group_view_permissions`, `access_user_overrides`. |
| `/admin/data-quality` | **Data Quality** | A **View** selector (`TAB_LENSES` / `tabInLens()`) scopes the tab bar by the dashboard a problem feeds — **All · Delivery & Contracts · Team KPIs · Platform** (many-to-many — a tab shows under every dashboard it feeds; picking a lens auto-jumps off a now-hidden tab). Tabs: end-date drift (SOW Overview vs Operating Model — + **How to fix** column) · **Delivered drift** (4-source comparison — Ops Model, Delivered vs Invoiced, Cumulative Pipeline, SOW Overview — with span colouring + **Problem** / **Where it hits** columns via `driftDiagnosis()`) · **Missing from Hub** (`MissingFromHubTab`, added 0.3.24 — its own tab, NOT part of Delivered drift): clients in a source sheet with no Hub record, so their data is dropped. Sourced from `missing_clients` on `GET /api/admin/discrepancies`, drawn from the `incomplete_clients` table populated by `_record_incomplete_client()` in `import_delivered_invoiced` / `import_operating_model` / `import_meta_deliveries` + ET CP history. Columns (in order): Name · Problem · **How to fix** (`suggestFix()` heuristic — Add-to-SOW vs Dismiss-as-noise) · **Where it hits** (dashboard section) · **Source** (tab + spreadsheet, linked via `sourceMeta()`) · **Action**. Map via the styled searchable `AssignDropdown` (writes a `ClientNameAlias` row via `POST /api/admin/missing-clients/{id}/map`, for variants/acronyms the fuzzy matcher can't catch like `WL/SG support` → Workleap+Sharegate) or **Dismiss** (`POST .../dismiss` → sets `resolved_at`, for noise). **Keep-visible:** the feed returns ALL rows tagged `status` (open / mapped→client / dismissed / resolved) + `mapped_to`, so resolved rows stay logged — `All / To-do / Resolved` chips + a per-row **Undo** (`POST .../reopen` drops the alias + clears `resolved_at`). The alias is consulted by `_build_client_name_lookup(clients, session)` (Operating Model + ET CP) and `_add_user_client_aliases()` (Delivered + Meta), so a mapped name resolves on the next sync and stops being flagged. Query-time self-heals when a name matches a live client · **Pod assignment issues** (`PodImportIssuesTab`): unmatched Growth-pod names → map via `AssignDropdown` writing a `PodNameOverride` (consumed by `import_growth_pods`; same keep-visible status + Undo). NOTE: `create/delete_pod_name_override` must `db.commit()` — `get_db()` never auto-commits (a flush-only bug had been silently dropping every override) · **Pod coverage** (`UnassignedPodsTab`): article-months with no editorial pod — intro names BOTH sources (Monthly Article Count for articles, ET CP for the pod) + a **How to fix** column · **Pod History** (merged former Pod Drift + Missing SOW + Not-in-SOW-Overview tabs into one view with combined filter chips: RESOLVED / POD DRIFT / INCOMPLETE SOW / NOT IN SOW OVERVIEW; per-row `missing_fields` exposed) · **Article mappings** (`ArticleMappingsTab`: normalization review for the Monthly Article Count importer — unresolved client tabs to map to a Hub client + editor-name variants to merge; each posts an alias via `POST /api/articles/aliases` that self-heals on the next sync, reading `GET /api/articles/unmapped`) · **Modeling Limitations**. Every tab carries Google-Sheets-style per-column header filters (text / combobox / select / range / date) via `ColumnFilter`. Page layout is viewport-fixed; only the tab tables scroll. Sourced from `GET /api/admin/discrepancies` + `GET /api/admin/pod-history`. Pod issues persist in `pod_import_issues`; cleared automatically when fuzzy self-heal resolves the match on a later SYNC. Backfilling editorial pod from history runs as a step in the past-months resync (`backfill_editorial_pod_from_history()`). |
| `/admin/analytics` | **Analytics** _(admin-only)_ | Two tabs: **Dashboard** (KPI strip, Daily Activity area chart + leader-line donut, Top Dashboards, Top Sections, Drill-Down, Click Interactions, Comment Activity, Per-User, Filter Usage, Return Cadence) and **Tracking Coverage** (static inventory matrix of every trackable event with status badges + recommended next batch). Range tabs (7d / 30d / 90d) and a **Group filter** (multi-select chips per RBAC group with member counts) drive a single `GET /api/analytics/summary?range=…&groups=<csv-of-slugs>` call; the backend resolves the slugs to member emails and filters every rollup. All chart tooltips render through a shared `DarkTooltip` custom-content component so the popover palette is consistent regardless of series colour. Source: `usage_events` table populated by the frontend's `analyticsClient` (10s batch / 5-event flush / `pagehide` sendBeacon). 6-month retention via startup migration in `main.py`. View slug `admin.analytics` — forced-revoked on every non-admin group, so the Sidebar tab only appears for the Admin group. |
| `/(auth)/login` | Google OAuth handshake | Redirects back to `/` |

## Data Sources & Ingestion Reality

**Full per-sheet reference:** `frontend/docs/SHEETS_DOCUMENTATION.md`
**Cross-sheet inventory + ingestion status:** `.docs/sheet-inventory.md`
**Dashboard → source mapping:** `.docs/dashboard-data-flow.md`
**Sync architecture (manifest, scopes, endpoints, month-rollover, add-an-importer runbook):** `.docs/sync-architecture.md`

### Spreadsheet 1 — Editorial Capacity Planning
ID: `1I6fNQMjs2y4l6IyOxd9QL-QBjB2zGi0mcoV840JDmkI`

| Sheet | Destination | Ingested? |
|---|---|---|
| Editorial SOW overview | `clients` | ✅ one-time seed |
| Delivered vs Invoiced v2 | `deliverables_monthly` | ✅ live sync — no month cap (reads all populated columns; the previous 36-month hard limit was removed to support multi-year/renewal contracts like Webflow) |
| ET CP 2026 [V13 May 2026] | `team_members` + `capacity_projections` + **`editorial_member_capacity`** | ✅ live sync. `team_members` roster still hardcoded in `seed_data.py`; `capacity_projections` (pod-level Total/Projected/Actual used) + the new **`editorial_member_capacity`** (per (year, month, pod, slot): role · member · capacity, with `member_breakdown` JSONB splitting combined cells like "Lauren K (28) + Anabelle (15)") are parsed from the **EDITORIAL TEAM CAPACITY** block by `_ingest_et_cp_year()` — month↔column derived from the header row (fixes the old hardcoded-offset Dec/Jan misalignment), pod/role counts detected **dynamically**. **SYNC/Import Wizard** → latest version, whole current year; **Re-sync Past Months** (`import_et_cp_pod_history`) → each past year's **last** version (e.g. 2025 from `V8 Nov 2025`). |
| Model Assumptions | `model_assumptions` | ✅ live sync (**Re-sync Past Months only** — changes a few times/year, not in the normal SYNC). Also mirrored to BigQuery **`editorial_raw_model_assumptions`** for the editorial-planning-hub project (categorisation 70/30, ramp-up %, weekly/monthly capacity, ideal-capacity flags, new-clients-per-pod). |
| Editorial Operating Model | `production_history` | ✅ live sync; drives Production History chart (`articles_actual` / `articles_projected` / `is_actual`). The new **`projected_original`** column holds the ET CP per-month client-block **Projected** for ALL months (past = the original projection that existed before the month closed; future = mirrors the live projection) — filled by `_ingest_et_cp_year()` from the ET CP sheet, never touching the existing actual/projected columns. Foundation for the future %-utilization-per-editor metric. |
| Delivery Schedules | `delivery_templates` | ✅ seeded; drives Pacing badge |
| Editorial Engagement Requirements | `engagement_rules` | ✅ seeded |
| Meta Calendar Month Deliveries | `deliverables_monthly` (subset) | ✅ seeded |

### Spreadsheet 2 — Master Tracker
ID: `1dtZIiTKPEkhc0qrlWdlvd-n8qAn5-lhVcPkgHNgoLAY`

| Sheet | Destination | Ingested? |
|---|---|---|
| Cumulative | `cumulative_metrics` | ✅ seeded |
| [Month Year] Goals vs Delivery (x9) | `goals_vs_delivery` | ✅ seeded — importer forward-fills `client_name` / pods on continuation rows whose Column A is blank (typical for LP / Jumbo variants under the Article row) so multi-content-type clients are no longer silently dropped. Upsert key is `(month_year, week_number, client_name, content_type)`; DB enforces it via `uq_goals_vs_delivery_mw_client_ctype` (0.3.16 startup migration). |
| `<YYYY> Week Distribution` | `editorial_weeks` | ✅ via past-months resync — defines when each Editorial month begins (drives "As of" badge) |

### Spreadsheet 3 — Writer AI Monitoring
ID: `13kl0_6YuzsJ3xEzNLzDZeR-sHMaNJNw6oJGmwb-CBOU`

| Sheet | Destination | Ingested? |
|---|---|---|
| Data / Rewrites / Yellow-Red Flags_v2 | `ai_monitoring_records` | ✅ seeded (1,168 rows); **new scans paused upstream** |
| Surfer's API usage | `surfer_api_usage` | ✅ seeded |

### Spreadsheet 4 — Team Pods
ID env-driven via `TEAM_PODS_ID` = `10ydCI1mQ5_T6nnMJt9eNHZ32_8NJBkOceiAW6FprjxA` ("Copy of [Int] Team Pods", swapped 2026-06-12 from the older temp copy — shared with the BI SA).

| Sheet | Destination | Ingested? |
|---|---|---|
| Editorial Team [<Mon> <YYYY>] | `pod_assignments` (pod_kind=editorial) | ✅ chip-based: emails come from people-chip metadata via `spreadsheets.get(includeGridData=true)` |
| Growth Team [<Mon> <YYYY>] | `pod_assignments` (pod_kind=growth) | ✅ same chip-based path; tab has different headers + 2 pod-member columns |
| ALL monthly tabs (Editorial Team / Growth Team / legacy "Account Team") | **`pod_assignment_history`** — ⚠️ **CUTOVER 2026-06-12: editorial months now come from the editorial-team-pods Hub's published table `graphite_bi_sandbox.team_pod_assignments_editorial_history` (Hub-first, sheet fallback); growth stays sheet-parsed.** Same for the CURRENT-month RBAC import (`import_team_pods` → Hub-first for editorial). Gate: `python -m etl.warehouse.hub_parity` (containment — no Hub row lost in roundtrip). | ✅ `import_pod_history()` — per-month member↔pod↔client history (editorial Jan 2025→now, growth Jul 2024→now incl. the old Account Team name; emails from chips, text fallback for pre-chip tabs; Editorial WRITER+WRITER EMAIL captured as role='writer' raw rows). Manifest step `team-pods-history` (scope past); slice-rewrite per (year, month, kind); year-less bracket tabs inferred 2025; 2024 paren legend-layout tabs skipped. Second source of editorial assignments for cross-checking ET CP. Warehouse: `editorial_raw_pod_history`. |

Powers RBAC group auto-population for the two pod-derived groups: **Editorial Team** (Senior Editors + Editors; Writers excluded) and **Growth Team** (Growth Leads / Directors / Account Directors / Managers; Content Specialists excluded). The **Leadership + Ops** group is seed-only (VPs, managers, and ops leads) and is no longer pod-derived. Also drives the per-pod client filter at `/api/clients/`.

### Spreadsheet 5 — Monthly Article Count
ID env-driven via `ARTICLE_COUNT_ID` (defaults to `1eRmZFnrhhPdHwkvLm9Ho1aNMq4WoyeggVhpShrW0kL0`, the most-updated "Copy of [Internal] Monthly Article Count/Revenue Sheet" — shared with the BI service account; previous origin was `1FWykZmeG2jznUYn-ng6glN4wjvc1Swb6hHmSHzGZ7dU`). **One tab per client** (~100 tabs, hidden tabs included — paused/ended clients), ~15K delivered-article rows.

| Sheet | Destination | Ingested? |
|---|---|---|
| `<Client>` (one tab each) | `article_records` | ✅ live sync — `import_monthly_article_count()` stacks every client tab; one row per (article, editor) with slash-pair editors exploded; chunked `batchGet` (25/call) + backoff retry; YYMMDD-in-copy-name date parsing; **header row detected dynamically** (scans the first rows for the EDITOR column — most tabs banner row 1 + headers row 2, but some like Felt put headers on row 1; the old hardcoded "row 2" silently dropped those tabs). **Full rebuild per sync** (no reliable source row key). |

Each article's `editorial_pod` is **denormalized from its resolved client's current pod** (Editorial pod is per-client). Client tabs are matched via the existing fuzzy `_resolve_client`; unresolved tabs land in `article_unmapped_names` (their articles carry no pod) and editor-name variants are surfaced for merging — both reviewed/aliased in the **Data Quality → Article mappings** tab (`article_name_aliases`, self-healing on the next sync). Aliases can carry a **date window** (`valid_from`/`valid_to`, 'YYYY-MM' inclusive) so one raw name maps to different people over time — e.g. "Sam" → Samantha McGrail through 2026-01, → Samantha Marceau from 2026-02 (windows from the Rippling headcount `v_headcount`); windowless rows are the fallback, undated articles only match windowless. Drives Team KPIs → **Monthly Articles**. The `REVISED` cell (often a comma-list of dates) is parsed into `revision_count` + dated events in the **`article_revisions`** child table (one row per article-editor-revision, bucketed by the revision's own editorial month — year inferred from the submitted date). Published status comes from the **Notion Content Machine** (`notion_articles`): matched by TASK ID (`ID-NNNN` → `case_id`) then unique normalized-title fallback (~40% coverage; the rest are ClickUp `#hashes`/blank → unknown), `is_published = cms_status` starts with "Published" or `published_url` present — shown as a **reference count by submitted month** (no Notion date is trusted; all KPIs pivot on the article's submitted date). **Pending:** per-month historical pod attribution (today every month uses the client's current/last pod — see `memory/project_monthly_article_count.md`). Next: Capacity Utilization per editor.

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
- **Content-type weighting**: goals aggregations apply `contentTypeRatio()` (article ×1, jumbo ×2, LP ×0.5, glossary ×0.5) so a jumbo's CBs/articles count for two units — keeps `GoalsVsDeliverySection` summary, `aggregateGoalsByPod`, and `GoalsMonthTable` totals consistent. **LP rows from May 2026 onward are doubled at ingestion** so the display-side ×0.5 cancels out and the Overall row reads the sheet's physical-unit total. **Glossary rows (June 2026 onward) pass through at ingestion and weight ×0.5 at display.** See `BUSINESS_RULES.md` § 1 for the full matrix, worked examples per content type, and cutover dates.
- **Tooltip body**: every metric tooltip uses the `TooltipBody` helper — uppercase mono title + 2–3 short bullets — so every tooltip looks the same. `DataSourceBadge` was deemed visual noise and now renders null hub-wide; the component is kept so existing call sites compile.
- **Milestone numbering**: the six lifecycle milestones are numbered `1` Consulting KO · `2` Editorial KO · `3` First CB Approved · `4` First Article · `5` First Feedback · `6` First Published, via `MILESTONE_NUM_BY_FIELD` in `shared-helpers.tsx`. **As of 0.3.22 the numbers appear ONLY in the Pod Timelines legend** (the single key) — they were removed from the Overview TTM card titles, the Per-Client Days dropdown, and the journey/contributor tooltips, which now show the readable transition name only ("First Article → First Feedback"). Don't re-add the `N→M` prefix to cards/tooltips; keep the key in the legend. (`milestonePairPrefix` still exists for the legacy `TimeToMetrics` cards on Editorial Clients.)
- **Pod display**: always say "Editorial Pod N" or "Growth Pod N" in user-facing copy via `displayPod()` in `frontend/src/components/dashboard/shared-helpers.tsx`. Internal keys stay as `"Pod N"` so existing `POD_COLORS` lookups and Map/Set keys keep working.

### Sheet sync (live, not one-time)
- **Daily server-side sync**: env-gated scheduler in `main.py` lifespan (`SYNC_CRON_ENABLED`, `SYNC_CRON_UTC_HOUR`, default 09:00 UTC — OFF locally, ON in prod) runs the manifest scope=current daily (same plan as the SYNC button incl. the dual-sink warehouse publish; rollover auto-escalates to full). Per-step failure isolation mirrors `POST /api/migrate/sync-run`.
- **Single source of truth = the Sync Manifest** (`backend/app/services/sync_manifest.py`, since 0.3.23). It declares every importer ONCE as a `ManifestStep` tagged with a **scope**: `current` (refreshed on every SYNC), `past` (the Re-sync Past Months pass), or both. Adding a new importer = add one `ManifestStep` with its scope → it flows automatically into the SYNC button, Re-sync Past Months, the month-rollover auto-resync, `/sync-run` (cron/agent), AND the progress UIs. **Do not** re-hardcode sheet lists in the frontend. The backend serves the plan via `GET /api/migrate/sync-plan?scope=current|past|full`; steps run via `POST /api/migrate/sync-step` (one step) or `POST /api/migrate/sync-run?scope=` (whole scope, server-side — for cron/headless). `import_all()` still does the importing + writes the audit-log "synced" row; the manifest only declares the plan. `goals-historical-resync` + `/resync/{step}` are kept as back-compat but now delegate to the manifest.
- **SYNC button** lives in `SyncControls`; clicking it opens `SyncAllModal`, which now (a) calls `GET /api/migrate/monthly-resync-status` and (b) fetches `GET /api/migrate/sync-plan?scope=…` — `current` normally, but **`full` on the first sync of a new editorial month** (so the just-closed month's final numbers land automatically — no manual Re-sync needed). It runs each step via `/sync-step` and shows per-step progress incl. a `past months` chip. The "Refresh computed KPIs" step is part of the manifest (`@refresh-kpis`), not a frontend special-case, and so is the final **"Publish warehouse"** step (`@warehouse-publish` on SYNC, `@warehouse-publish-past` on Re-sync Past Months; scope=full publishes exactly once at the end) — it rebuilds the dual-sink warehouse (Postgres `warehouse` schema + BigQuery) that the dashboards read. Synthetic steps (KPI refresh, warehouse publish) carry `synthetic: true` in `ImportResultResponse` so the UI skips sheet previews for them. The Import Wizard also publishes after any successful single-sheet import. "Synced …" badge reads `GET /api/migrate/status`.
- **Month-rollover due-check** (`sync_manifest.monthly_resync_due`): the past-resync is "due" when the latest `[Month Year] Goals vs Delivery` `sheet_sync_history.synced_at` predates the current editorial month's Week-1 start (from `editorial_weeks` — same week distribution the "As of" badge uses). Server + client agree because `current_editorial_month` mirrors the frontend's `currentEditorialMonth`.
- **`/data-management/import`** has a two-tab layout: *Import Wizard* (manual sheet picker with preview, still uses `/import`) and *Re-sync Past Months* (`HistoricalResyncTab` — now renders its step list from `sync-plan?scope=past`, no hardcoded `RESYNC_STEPS`).
- All importers are idempotent (upsert on natural keys); ordering doesn't matter.

## Memory & Commits

- No `Co-Authored-By` lines in commit messages.
- Keep commits scoped; prefer new commits over amending.
- When updating this file: run `.claude/skills/pre-commit-checks/` first.
