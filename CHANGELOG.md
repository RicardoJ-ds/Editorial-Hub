# Editorial Hub — Changelog

Plain-language summary of every release for the Editorial Ops team and stakeholders. Newest first.

## Versioning note

We use **`0.PHASE.ITERATION`**. The middle digit names the project's current focus area; the patch digit is uncapped (so `0.3.10` is fine — there's no implicit "1.0 in N releases").

| Phase | Focus | When |
|---|---|---|
| `0.1.x` | Initial Hub — Dashboard 1 + Dashboard 2 read-only, sheet ingestion, Google login | through early Apr 2026 |
| `0.2.x` | Data foundation — CP v2 prototype, BigQuery growth pods, Notion KPIs, live sync system | mid Apr 2026 |
| `0.3.x` | UI maturity — refinement rounds, scope-aware cards, Overview dashboard | Apr 22 → onward |
| `0.4.x` | (next) CP v2 → DB migration, dashboards switched onto `cp2_*` reads | upcoming |
| **`1.0`** | The Hub becomes the Editorial team's primary tool of record (CP v2 wired to DB + RBAC sign-off) | when the above lands |

> **Renamed from the prior scheme (May 5).** Earlier releases were labeled v0.1 → v0.4. Mapping for stakeholders who may remember the old labels: v0.1 → 0.1.0 · (untagged data-foundation work) → 0.2.0 · v0.2 → 0.3.0 · v0.3 → 0.3.1 · v0.4 → 0.3.2.

---

## 0.3.4 — May 8

**Sync stability fixes.** All cleanup on top of 0.3.3 — same day.

- **Past-months resync no longer crashes if one importer fails.** Each step (Goals vs Delivery / Week Distribution / Team Pods) now runs in its own session; a failure shows up as a red row in the result panel with the actual error message, while the other steps still finish. Previously a single failure would surface as a blanket "Failed to fetch" with no way to tell which sheet broke.
- **Team Pods previews render after import.** The post-import snapshot panel under "Team Pods – Editorial + Growth" was returning 500 because the preview endpoint was looking in the wrong spreadsheet. Both rows now show their first 10 rows like every other importer.
- **Team Pods rows show the actual month** (`May 2026`) instead of the placeholder `(latest)`.
- **SYNC – Editorial Operating Model is fast again.** The importer was making one database round-trip per (client × month) cell — ~2,650 round-trips against Neon, taking 60–180 seconds and tripping the browser's fetch timeout. Now does one bulk read upfront, in-memory upserts, single commit. Drops to a couple of seconds.

---

## 0.3.3 — May 8

**Access Control is real now.** The /admin/access page is no longer a mockup; it enforces who sees what.

- Six seeded groups: **Admin** (Daniela + Ricardo), **VPs and Managers** (Rafa, Marcos, Juan, Ethan, Caitlin, Ainoa), **Leadership** (auto-populated — Senior Editors + Growth Leads from the Team Pods sheet), **BI Team** (Ricardo, Simon, Paolo), and the new **Editorial Team** + **Growth Team** groups (auto-populated, replace the mockup "Senior Editors and Editors" + "Account Team" entries).
- Seeded members are protected — admins can add/remove others, but the original list can't be deleted via the UI.
- Auto-sync badge on the three pod-derived groups; membership refreshes whenever the Team Pods sync runs.
- View-only across the matrix — no edit on dashboards. Per-user overrides (in **Users × Views**) win over group defaults.
- **Preview Access** (admin-only) — render the dashboard exactly as another user would see it, then "Exit preview" to come back.

**New: Team Pods importer (Editorial + Growth).** The teams sheet's people-chips carry email addresses; the importer reads them via Sheets API metadata and writes them to a new `pod_assignments` table. Powers everything below. Runs alongside the past-months resync AND in the regular import wizard. The current sheet is a temporary copy — we'll swap it for the original once access lands.

**Pod-aware filtering across the dashboards.**

- A new top-bar toggle (next to SYNC) lets Admin / VPs / BI Team flip the dashboards between **Editorial Pod** and **Growth Pod** grouping.
- Editorial Team and Growth Team users are locked to their own axis (no toggle, only their pod's clients).
- Leadership sees only their assigned clients (across both pod kinds).
- Sidebar nav now hides items the user can't access (no broken links into restricted pages).

**Overview dashboard additions** (per Daniela's ask).

- **Right-side comments rail** — Notion / Google-Docs style threads anchored per section, narrowed per client when the filter narrows. Admin-only create.
- **Production History** chart added.
- **Client Delivery at a Glance** added, **collapsed by pod by default** so the page doesn't dump 50+ cards on first paint.
- **Cumulative Pipeline** per-client cards now show only Articles + Published on this view (Topics + CBs hidden — they're upstream of billing and not what executives are reviewing here).

**Editorial Clients · Monthly Goals fix.**

- The CB / Article gauges (formerly *Range Snapshot*) now read **Current Month Progress** — they always show this Editorial month so far, regardless of the date filter.
- Amber chip surfaces "{Month YYYY} · not date-filtered" with a tooltip clarifying the gauges aren't following the date range.
- The detailed month-by-month table below stays date-scoped (no change there).

**"As of" badges driven by the Editorial calendar.**

- New `editorial_weeks` table imports the Master Tracker's `<YYYY> Week Distribution` tabs (annual config, runs with past-months resync).
- Badges across D1 / Overview / Client Delivery now use the team's Editorial calendar — until Week 1 of the new month begins, "As of" still references the prior month.
- Falls back to calendar months with a small `· cal.` chip when today lands outside imported weeks.

---

## 0.3.2 — May 4 *(was v0.4)*

**New: Overview dashboard (`/overview`)**

- Single-screen exec snapshot for managers and VPs — same top-row cards as Editorial Clients, pinned in their unfiltered view, all visible without flipping tabs or applying filters.
- Sections: *Time-to Metrics · Delivery Overview · Cumulative Pipeline · Monthly Goals — Range Snapshot.*
- *Most Behind* and *Pod Attention* live here exclusively (moved out of Editorial Clients).
- Every section has an "Open in Editorial Clients" link that lands on the right tab and section.

**Editorial Clients · Cumulative Pipeline**

- Articles stage now counts **Sent**, not Approved — same column the Master Tracker bills against. Topics and CBs still use Approved (those stages require explicit client sign-off); Published still uses Live.
- The percentage on every Articles card and bar is therefore *Sent ÷ SOW* now. The headline number will look higher than before, which is correct — those articles are billable as soon as they're delivered.

**Editorial Clients · Time-to Metrics**

- The *Client Milestone Journey* chart is now grouped by **Growth Pod** instead of Editorial Pod (per the team's request). The metric cards above and the per-client trend chart still group by Editorial Pod.

**Editorial Clients · Production History chart**

- Hovering any month now shows the per-client breakdown beneath the total — so you can see who makes up "53 projected articles in April" at a glance.

**Editorial Clients · Monthly Goals fix**

- Pod aggregates and per-client breakdown no longer split a single client across two pods. Previously, when a client's goal sheet had inconsistent per-row pod values, the dashboard could show one client under both Editorial Pod 1 and Unassigned. Now every aggregator follows one rule: look up the client's pod in the SOW Overview / clients table; default to *Unassigned* when not set.
- Side effect: when you set a client's pod in SOW Overview, every section (cards, pod aggregate, table, cumulative pipeline) reflects it consistently after the next sync.

**Admin · Data Quality — clearer structure**

- The *Modeling limitations* panel now has three numbered items, each with **Symptom · Why · How to unlock**:
  1. Pod assignments are not historical (filter uses today's roster).
  2. Goals data before Aug/Sep 2025 is partial (different upstream source).
  3. Per-row pod columns in source sheets are ignored on purpose.
- Page intro names the two flavors of items it surfaces: *per-client drift* (fixable in source sheets, in tabs below) and *modeling limitations* (need code or data-model work, in panel above).

**Behind the scenes**

- Last cleanup of per-row pod fallbacks. The dashboard now uses a single rule across every aggregator: pod comes from `clients.editorial_pod` / `clients.growth_pod`. The goal sheet's own pod columns are no longer used as fallbacks.

---

## 0.3.1 — Apr 28 *(was v0.3)*

**Editorial Clients · Delivery Overview (top cards)**

- *Most Behind* now ranks by the last completed quarter (the in-flight one always looked late mid-quarter).
- *Closing in 90D* shows human buckets — *This month / Next month / 2 months out / Soon* — with a toggle between SOW and Operating Model end dates.
- *Pod Attention* surfaces the leading pod's behind clients with a *View all pods* popover.
- Click any client name or pod chip → page scrolls to that card with a brief green-ring highlight.

**Editorial Clients · Cumulative Pipeline section**

- Replaced the heavy summary cards with one slim header strip (scope summary + 4 stage bars + anomaly flag).
- Single-client view shows status, pods, contract window and days remaining inline.
- Per-client lifetime SOW bars degrade cream → green (no more red/yellow noise).

**Health & dates**

- Per-client *Healthy / Watch / Behind* chip is now based on the last finished quarter's closure %; brand-new clients show *No Q yet* instead of being flagged as behind.
- Fixed a date-parsing bug that rolled dates back by a day in negative timezones.

**New: Admin → Data Quality page (`/admin/data-quality`)**

- Lists every client whose end date disagrees between SOW Overview and Operating Model.
- Lists every client whose delivered count disagrees between cumulative tracker and monthly sheet.
- Read-only, refresh on demand — meant for spotting silent drift before the dashboards do.

**Growth Pod filter integrity**

- Confirmed the filter pulls a clean *one client → one pod* mapping from BigQuery, even though the source query returns one row per team member.
- Safeguard log added so any future cross-pod assignment is surfaced instead of silently absorbed.

---

## 0.3.0 — Apr 22 *(was v0.2 — first refinement round)*

- Renamed *Pod* → *Editorial Pod* / *Growth Pod* everywhere visible.
- Trimmed Contract & Timeline table from 17 → 9 columns.
- Period filter now has a month-range slider, defaulting to current month ±6.
- Delivery Trend chart re-built as a heatmap (was a tangled line chart).
- Per-client cards grouped into pod subsections instead of one flat list.
- Tooltip cleanup — every card explains its formula in 2–3 short bullets.
- Import page split into *Wizard* and *Re-sync past months* tabs.
- *Refresh computed KPIs* step now runs at the end of every sync.
- Fixed Y2 contract ingestion gap so older months stop disappearing on renewals.

---

## 0.2.0 — mid Apr *(data foundation)*

- **Capacity Planning v2 prototype** shipped (localStorage-backed): roster, allocation, leave, weekly actuals, schema, glossary, migration validator.
- **Growth Pod assignments** now pulled live from BigQuery (replacing a stale spreadsheet).
- **Notion-backed KPIs**: Revision Rate, Turnaround Time, Second Reviews — all computed from the Notion DB, no more manual entry.
- **Live sync system**: SYNC button in the header runs every importer, then the *Refresh computed KPIs* step at the end so the heatmap updates the same session.

---

## 0.1.0 — Initial Hub *(launch through early April)*

- Replaced 3 Google Sheets with a single dashboard app for the Editorial team.
- **Dashboard 1 — Editorial Clients:** Contract & Timeline tab, Deliverables vs SOW tab, per-client cards grouped by pod, monthly goals vs delivery.
- **Dashboard 2 — Team KPIs:** heatmap of 9 KPIs, capacity projections, AI compliance — all from real data.
- **Google login:** access restricted to `@graphitehq.com`.
