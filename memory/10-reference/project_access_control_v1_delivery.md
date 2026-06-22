---
name: access-control-v1-delivery
description: Checklist of everything shipped for the May 8 2026 v0.5 access-control milestone (Team Pods + RBAC + pod filtering + Overview comments + Overview sections + Monthly Goals fix)
type: project
originSessionId: 64b08894-7fc6-4aca-8b18-05b3f98176b9
---
Delivery summary for the v0.5 milestone landed 2026-05-08. Companion to:
- `project_access_control_v1_spec.md` — the high-level spec
- `project_access_control_v1_original_prompt.md` — the verbatim user ask

When validating later or picking up follow-ups, this is the authoritative
"what's actually shipped" reference. Items marked `[ ]` are deliberately
deferred polish — see the spec memory for the full reasoning.

---

## Bucket 1 — Team Pods importer
- [x] `pod_assignments` table (email, display_name, pod_kind, pod_number, client_name, role, source_tab); UNIQUE on (email, client, kind, role)
- [x] `import_team_pods` reads chip metadata via `spreadsheets.get(includeGridData=true)` with `chipRuns[].chip.personProperties.email` projection — names AND emails captured
- [x] Editorial Team + Growth Team tabs both supported (different header rows, different pod-member columns, different role columns)
- [x] Multi-letter role tags handled: `(SE)`, `(E)`, `(W)`, `(SR GL)`, `(JR GL)`, `(GD)`, `(GD - external)`, `(CS)`, etc.
- [x] Forward-fills Pod # and Pod Members across rows of each pod block
- [x] Picks the latest `<YYYY> Team [<Mon> <YYYY>]` tab automatically
- [x] Idempotent — wipes + re-writes per `pod_kind` on each sync
- [x] Wired into IMPORT_DISPATCH (Import Wizard) AND past-months resync
- [x] `TEAM_PODS_ID` env var configurable; currently temp copy `1N6q1ZYC…`
- [x] Verified: 225 Editorial + 912 Growth rows imported

## Bucket 2a — Access Control backend
- [x] Five tables: `access_views`, `access_groups`, `access_group_members`, `access_group_view_permissions`, `access_user_overrides`
- [x] Idempotent app-startup seed: 10 views (incl. Overview + Data Quality), 6 groups, 11 seeded members, default permission matrix
- [x] Admin: daniela.quiroga + ricardo.jaramillo
- [x] VPs and Managers: rafa, marcos, juan.cardoso, ethan, caitlin, ainoa
- [x] BI Team: ricardo.jaramillo, simon.betancur, paolo.cavalli
- [x] Leadership: auto-populated from pod_assignments (Senior Editors + Growth leadership roles)
- [x] Editorial Team / Growth Team groups: auto-populated, replace the old mockup groups
- [x] Seed members protected (backend 403 on remove); manual + derived removable
- [x] User × view overrides win over group defaults
- [x] All edits write to `audit_log` with `entity_type='access_control'`
- [x] `resolve_access(email)` returns full AccessProfile
- [x] Auth: `X-User-Email` (from Next.js `/api/me` route decoding session cookie); `X-Preview-As` honored only when real caller is admin
- [x] FastAPI deps: `current_email`, `current_access`, `require_authenticated`, `require_admin`, `require_view(slug)`
- [x] 10 endpoints under `/api/access/*`

## Bucket 2b — Access Control UI
- [x] Groups tab first position
- [x] Groups tab refactored per image #16 → image #17: left rail + matrix-style permissions in columns + members block
- [x] Auto-sync badge on derived groups (Editorial Team / Growth Team / Leadership)
- [x] Users × Views tab: real data, click-to-toggle override (admins only), amber dot on overrides
- [x] Audit Log tab: real entries
- [x] Preview Access widget: admin-only, sets `X-Preview-As`, amber banner during preview, exit button
- [x] Page-level gate: non-admin/VP/BI users see "No Access"
- [x] View-only permissions (binary). Add member form + remove buttons admin-only with seed protection

## Bucket 3 — Pod-aware filtering
- [x] Sidebar nav filtered by `view_slugs`
- [x] `/api/clients/` filtered by `client_scope` + `pod_kind_lock` (verified across admin/Robert Thorpe/Kelly Hart/stranger)
- [x] `/overview` page-level gate redirects pod-locked teams
- [x] `useCurrentPodAxis()` hook with localStorage persistence; locked for pod-restricted users
- [x] Top-bar toggle in `SyncControls`, visible only when `can_toggle_axis`
- [x] Charts honoring the axis: ContractClientProgress + downstream rows; DeliveryOverviewCards (scope + PodAttention); ClientDeliveryCards; GoalsOverviewCards; Overview's PodOutput/PodVelocity/CompositionView; CumulativePipelineHeader/Section; TimeToMetrics
- [ ] **Deferred** — display-only charts (FilterContextCard, ClientNotesPanel, GoalsMonthTable rollups) still show editorial labels regardless of axis
- [ ] **Deferred** — `require_view` guard sweep across non-clients endpoints

## Bucket 4a — Overview comments rail
- [x] `overview_comments` table
- [x] `/api/overview/comments/*` endpoints (list/create/resolve/reopen/delete); reads gated on `overview` view, mutations admin-only
- [x] Right-rail UI sticky at xl widths, one thread block per Overview section
- [x] Threads grouped per client; narrowed when filter narrows to one client
- [x] Admin-only composer with client dropdown limited to currently-filtered clients
- [x] Resolve / reopen / delete (admin-only); resolved threads dim + strike-through

## Bucket 4b — Overview new sections
- [x] Production History chart
- [x] Cumulative Pipeline cards limited to Articles + Published (`cardStages` prop)
- [x] Client Delivery at a Glance, collapsed by pod by default (`defaultCollapsedByPod` prop using `<details>`)
- [x] `clientDeliveryRows` derived from `summaries` + `clients` to avoid duplicating D1's row pipeline
- [x] New section IDs registered in SECTIONS so anchors + comments rail align

## Bucket 5 — Monthly Goals gauges fix
- [x] Goals aggregation extracted to module-scope `aggregateGoalsSummary(rows)` helper
- [x] `useCurrentEditorialMonth()` hook
- [x] Gauges read from `currentMonthSummary` (NOT date-filtered)
- [x] Section header renamed "Range Snapshot" → "Current Month Progress"
- [x] Amber chip `{Month YYYY} · not date-filtered` with tooltip
- [x] Detail table (`GoalsMonthTable`) unchanged — still date-scoped

## Cross-cutting infrastructure (foundational, supports everything above)
- [x] `editorial_weeks` table + importer + past-months sync wiring + endpoint + frontend hooks; AsOfBadge with `· cal.` fallback chip
- [x] `lib/api.ts` injects X-User-Email + X-Preview-As headers
- [x] `app/api/me/route.ts` surfaces session email server-side
- [x] `lib/accessClient.tsx` (useAccessProfile + useRequireView + setPreviewAs)
- [x] `lib/podAxisClient.tsx` (useCurrentPodAxis with localStorage)

**Why:** v0.5 milestone — RBAC foundation that maps real users to clients/pods, plus the Overview-dashboard additions DaniQ asked for, plus the Monthly Goals "this month not the filter" semantic fix.

**How to apply:** when validating, refining, or extending any of these pieces, find the corresponding bucket. When something needs to be added that's NOT in this list, it's net-new work — add it to a new milestone, don't quietly fold into v0.5.
