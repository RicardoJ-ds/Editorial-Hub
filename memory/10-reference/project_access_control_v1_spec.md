---
name: access-control-v1-spec
description: Multi-day Editorial Hub feature scope locked in May 8 2026 — Team Pods importer, RBAC rebuild, pod-aware filtering, Overview comments, Monthly Goals fix
type: project
originSessionId: 64b08894-7fc6-4aca-8b18-05b3f98176b9
---
Five-bucket feature ask captured 2026-05-08 (PRD-equivalent for the v0.5 work). Each bucket is a separable phase.

**Bucket 1 — Team Pods importer**
- Source: Master Tracker copy at `1N6q1ZYC4W9BYusewdwqwprUu9zSmbQp99mC3f2y3_HI` ("[Int] Team Pods" copy). Two tabs: `Editorial Team [May 2026]` and `Growth Team [May 2026]`.
- Editorial sheet structure: Pod # · Pod Members (names with `(SE)` / `(E)` role tags) · Client · Senior Editor · Editor · Writer.
- Growth sheet mirrors `growth_pods_assignments` (BigQuery) — but importer should pull from sheet so the source-of-truth lives in one place.
- Auth via existing SA key (`graphite-bi-sa@graphite-data.iam.gserviceaccount.com`, file `sa-key.json`).
- Lands in same flow as the current Growth Pods import — past-months sync **and** import wizard.

**Bucket 2 — Access Control rebuild**
- Seeded groups (protected — seed members can't be removed, only manually-added members can):
  - Admin: daniela.quiroga@graphitehq.com, ricardo.jaramillo@graphitehq.com
  - VPs and Managers: rafa@, marcos@, juan.cardoso@, ethan@, caitlin@, ainoa@graphitehq.com
  - Leadership: all Growth leadership from Growth sheet + all Senior Editors from Editorial sheet (auto-refresh on sync)
  - BI Team: ricardo.jaramillo@, simon.betancur@, paolo.cavalli@graphitehq.com
  - Editorial Team / Growth Team: pulled from the Team Pods sheets (replacing the current "Senior Editors and Editors" + "Account Team" mockup groups)
- Group permissions table (this is the seeded default, editable later by admins):

| Group | Dashboards | Data | Admin/Access | E↔G toggle | Pod scope |
|---|---|---|---|---|---|
| Admin | All | Yes | Yes (edit) | Yes | All clients |
| VPs and Managers | All | No | View | Yes | All clients |
| Leadership | All | No | No | No | All pods, only their clients |
| BI Team | All | Yes | View | Yes | All clients |
| Editorial Team | Dashboards minus Overview | No | No | No | Own pod only |
| Growth Team | Dashboards minus Overview | No | No | No | Own pod only |

- View-only across the board — no edit on dashboards.
- User × Views overrides Group default (e.g., grant Simon admin even though he's BI Team only).
- "Preview access" mode for admins to render the UI as another user/group.
- Auto-update badge on each group when sheet sync runs.

**Bucket 3 — Pod-aware filtering**
- Global pod-axis context (Editorial | Growth). Editorial Team members locked to Editorial; Growth Team to Growth; higher groups get a top-bar toggle.
- Pod-restricted users see only their pod's clients; higher groups see all.
- Touches every chart that groups by `editorial_pod` (~90% of the dashboard surface).

**Bucket 4 — Overview Dashboard additions**
- Right-rail comment threads, Notion/Google-Docs style, anchored per section + per client. Admin-only create.
- Per-client comments grouped/stacked when multiple clients in scope; narrowed when filtered to one. Dropdown to add a comment for a client outside the filter (chosen from currently-filtered list).
- Add Production History chart to Overview.
- Add Client Delivery at a Glance (collapsed by default, grouped by pod).
- Cumulative Pipeline cards in Overview show only Articles + Published (no CBs / Topics).

**Bucket 5 — Editorial Clients · Monthly Goals fix**
- Gauge cards = current month progress (NOT date-filtered). Add badge: "Current month progress, not the filtered period".
- Detail tables stay filtered (no change there).

**Why:** ship the data-access foundation that maps users to clients/pods so the dashboards stop being one-size-fits-all. Today everyone sees the entire portfolio with no role enforcement.

**How to apply:** treat each bucket as a separate reviewable slice. Don't combine them in one PR. Phase 1 (importer) blocks Phase 2 (RBAC) blocks Phase 3 (pod filtering). Phase 4 + 5 are independent and can run in parallel after Phase 1.

**Key blockers surfaced 2026-05-08:**
1. Editorial Team sheet has names, no emails — need a deterministic name→email mapping rule (likely `firstname.lastname@graphitehq.com` heuristic, but unconfirmed).
2. Auth enforcement scope — current `/admin/access` page is a UI mockup only. Real RBAC = backend gating of every endpoint, not just UI.
3. User wrote "Only Admin and Leadership can edit access" then "admin users are the only ones can edit access control" — contradicts. Default to admin-only until clarified.

**User preferences confirmed in this thread:** plan thoroughly first on big asks, surface blockers explicitly, deliver in reviewable phases. Don't over-engineer with abstractions until the first slice is working.
