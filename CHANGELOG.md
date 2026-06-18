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

## 0.3.28 — June 18

**Help & Glossary trimmed to the essentials; changelog hidden.**

### Help & Glossary

- The in-app Help now shows **only the Glossary** — the terms relevant to Editorial Clients & Overview. The longer quick-guide intro, the dashboard table, and the how-to / permissions / sync sections were removed for a cleaner, focused reference.
- The **Changelog is now hidden for everyone**. The sidebar version chip opens the Glossary instead of "what's new."

## 0.3.27 — June 18

**Glossary: clearer Pod wording.**

### Help & Glossary

- Removed the old "Pod — a group of editors…" definition, which wasn't quite right (a pod isn't only editors). The **Editorial Pod** and **Growth Pod** entries now stand on their own, so the Editorial-vs-Growth distinction carries the meaning.

## 0.3.26 — June 16

**Milestone timings now read the same on every Overview card, article credit is more accurate, and the data pipeline behind the dashboards was rebuilt — with no change to the numbers you see.**

### Time to Milestones

- A milestone occasionally lands *before* the step that should precede it — e.g. a content brief marked approved a couple of days before the Consulting KO date. The cards used to disagree about this: the **Time-to-Metrics** card hid it (read "—" / 0 clients) while the **Per-Client Days** bar showed the real value. All three cards now agree and show it. On the **Pod Timelines** (and the Editorial Clients **Client Timelines**), a before-kickoff milestone is flagged with a red ring and a labeled value, so a date-entry anomaly is easy to spot and fix.

### Article attribution & client names

- **Shared editor credit:** when one article cell lists a Senior Editor *and* an Editor together, the Editor now gets the credit (the Senior Editor reviews; the Editor edits). Pod totals are unaffected.
- **Reconciled two client names** that were logged under variants — *Genstore* → GenstoreAI, and *ShareGate* → Workleap + Sharegate — so their article counts now tie out against the Operating Model.
- Applied Daniela's confirmed writer-name corrections to the mapping reference.

### Behind the scenes

- The data layer that feeds every dashboard was rebuilt as a single layered pipeline, published to both the app database and BigQuery in one pass — same numbers, more reliable, and easier to audit.
- The **Model Assumptions** sheet (ramp-up, capacity per role, client mix) is now imported on the past-months re-sync and mirrored to BigQuery for the capacity-planning work.

---

## 0.3.25 — June 10

**Team KPIs now shows a real capacity picture: one Capacity tab that reveals how fully each pod — and each editor — is used, month by month. The Monthly Articles revision metrics are also reorganized into clearer tabs.**

### Capacity (one tab, was two)

- The old **Capacity Projections** and **Capacity by Pod** tabs are merged into a single **Capacity** tab, with one shared month picker and a section rail (At a glance · By Pod · Trend · By Editor · By Client).
- **At a glance** — planned vs delivered utilization, pods over plan, and spare capacity for the selected month.
- **By Pod** — each pod's capacity, planned vs delivered workload, and an on-track / under / over status.
- **By Editor** — how much of each pod's delivered work each editor carried, as a real and a weighted utilization %.
- **By Client** — what each client adds to its pod's workload (specialized clients weighted ×1.4); these totals are exactly what the per-editor view splits up.
- **Trend** — utilization across the months, either as a per-pod line chart (planned or delivered, with a 100% over-capacity line) or a per-editor heat grid (under / on-plan / over at a glance).
- The whole tab now follows the page's **pod and period filters** at the top — the month picker only offers months inside the selected period, and the trend matches.

### Monthly Articles

- The revision metrics are now **sub-tabs — Articles · Revision rate · Revisions** — each with a one-line definition and a headline number, so it's always clear what you're looking at. The matrix shades higher revision rates and can expand or collapse all rows at once.

---

## 0.3.24 — June 8

**A Data Quality overhaul: catch clients that were being silently dropped, keep a running log of what you've fixed, and jump straight to the tabs that affect a given dashboard.**

### Missing from Hub

- New **Missing from Hub** tab: clients that appear in a source sheet (Operating Model, Delivered vs Invoiced, Meta Deliveries, or ET CP) but have **no record in the Hub**, so all their data was being silently dropped from every dashboard. Previously these only flashed by in the sync log. Each row spells out **what the problem is**, **where the source data lives** (the sheet tab + spreadsheet, linked), **which dashboard the dropped data would have appeared in**, and a **recommended fix**. Resolve a row by **mapping it to an existing Hub client** (a searchable picker that lists exactly the clients in the *SOW Overview* sheet — writes an alias the importers honor on the next sync), **adding a genuinely new client** to SOW Overview, or **Dismiss** for noise (headers / placeholders).
- Captured by the production importers (Delivered vs Invoiced + Meta Deliveries now record them too, joining Operating Model + ET CP).

### Mapped rows stay visible

- Both mapping tabs (**Missing from Hub** + **Pod assignment issues**) now **keep every row visible after you act on it** — tagged Open / Mapped → client / Dismissed / Resolved — with **All / To-do / Resolved** filters and a per-row **Undo**. No more rows vanishing the instant you map them: you keep a running log of what's done vs still pending. A short reminder notes that maps apply on the next SYNC.
- **Fixed:** pod-name overrides were silently failing to save (a missing database commit), so every Pod-assignment mapping rolled back and the issue kept re-appearing. Now persisted.

### Clearer, dashboard-aware tabs

- Context columns added where they help: **How to fix** (End-date mismatch, Pod history, Pod coverage) and **Problem + Where it hits** (Delivered drift) — without dropping each tab's essential columns (Pod history keeps its full month timeline). **Pod coverage** now names both data sources (Monthly Article Count for the articles, ET CP for the pod) so it's clear where the numbers come from and why a missing pod has to be fixed in ET CP.
- New **View** selector scopes the tabs by dashboard — **All · Delivery & Contracts · Team KPIs · Platform** — so you can focus on just the data-quality issues feeding one dashboard.

---

## 0.3.23 — June 8

**Sync now self-heals when a month rolls over, and "what gets synced" lives in one place.** Last month's final numbers used to go stale because the regular SYNC freezes closed-month tabs — you had to remember to run "Re-sync Past Months". Now the **first SYNC of a new month automatically does both**.

### Self-healing month rollover

- The **first time anyone hits SYNC in a new month**, it automatically also re-syncs past months (so the month that just closed picks up its final, fully-entered numbers). The sync modal shows a "New month detected — also refreshing past months" note. Subsequent syncs that month run at normal speed.
- The "new month" boundary uses the editorial **week distribution** (same source as the "As of" badge), so it lines up with how the team actually counts months.

### One definition of "everything that gets synced"

- Every importer is now declared once in a backend **sync manifest**, tagged as a current-month or past-months step. The SYNC button, Re-sync Past Months, the rollover trigger, and any future automation all read from that one list — so adding a new data source (like the Monthly Article Count) makes it appear everywhere automatically, with no risk of one screen syncing it and another forgetting to.
- The Re-sync Past Months screen now builds its step list from that manifest too (no more hand-maintained copy).

### Under the hood

- New `GET /api/migrate/sync-plan`, `POST /api/migrate/sync-step`, `POST /api/migrate/sync-run` (whole-scope, for cron/headless), and `GET /api/migrate/monthly-resync-status`. The KPI-refresh logic is now shared between the endpoint and the manifest instead of duplicated.

---

## 0.3.22 — June 8

**Plain-language pass on the Overview dashboard, so it reads for everyone — not just people who live in the editorial numbers.** Shorthand is spelled out, the end-of-quarter chip explains itself, and the milestone numbers no longer clutter every card.

### Pod Snapshot

- **Column headers** read in full: "Current Quarter" (was "Current Q", subtitle "Delivered against Invoiced"), "% of SOW", "% Published", and the Goals column now says "CBs + Articles vs monthly goal".
- **Bar labels spelled out** — "delivered / invoiced" instead of "del / inv" (SOW kept, with a tooltip that defines it as the full contracted scope).
- **The end-of-quarter chip explains itself.** Instead of a bare "−5", it now reads the number plus a plain line: "5 fewer than invoiced" / "15 more than invoiced" / "matches invoiced" (0). The color still flags on-track / within-limit / behind / ahead at a glance, and **hovering the chip** shows a short explanation (delivered − invoiced, projected to the quarter's end, as of the last closed editorial month).
- Tooltips rewritten without the `÷` math and insider terms.

### Time to Milestones

- **The milestone numbers (1–6) now live in one place — the legend** — instead of being repeated as "1→2 / 4→5" on every card, tooltip, and dropdown. The cards and tooltips just say the readable name ("First Article → First Feedback"), and the numbered key stays available for anyone who wants to map the sequence.

### Section descriptions

- Rewritten in everyday language (e.g. Time to Milestones now reads "How fast each pod moves a client from kickoff to first published article").

### Across the app

- **Dates always render in English** (e.g. "9 Jan 2026"). They were following the browser's language, so a Spanish-set machine showed "9 ene 2026" in the milestone tooltips, drill-down dates, comment timestamps, and the "Synced …" badge.

---

## 0.3.21 — June 8

**Variance colors are now symmetric: green means exactly on target, amber means within ±5 either way, and red now flags clients that are far AHEAD as well as far behind.** Previously any over-delivery read as green "healthy"; now a client projected to finish a quarter well ahead of contracted invoicing is surfaced just like one that's behind — because over-delivered work isn't billed yet.

### Overview + Editorial Clients — how variance reads

- **🟢 On track** — projected end-of-quarter variance is exactly 0.
- **🟡 Within limit** — within ±5 articles of target, behind or ahead.
- **🔴 Behind / Ahead** — more than 5 articles off target. The label now says **"Ahead"** when over-delivering and **"Behind"** when under — both in red.
- **🔵 1st Q** — brand-new contracts in their first quarter stay calm (never alarm), unchanged.

This applies everywhere variance is shown: the Pod Snapshot tiles + per-client cells, the client drill-down popover (chip + the monthly Variance column), and every per-client card on Editorial Clients. In the monthly breakdown table each Variance cell carries a solid tier-colored background, so a far-ahead/far-behind cell reads cleanly red even on the highlighted current-quarter row (it no longer blends to a muddy brown).

### Overview — "Most Behind" is now "Needs Attention"

- The triage card formerly titled **Most Behind** is now **Needs Attention**: it flags clients projected to finish more than ±5 off target in **either** direction, worst miss first.
- **Pod Attention** follows the same lens — pods are ranked by how many clients are off target (behind or ahead), and its drill-downs read "off-target clients" instead of "behind".

### Under the hood

- All variance tier logic now flows through a single shared classifier, so every surface classifies identically (previously the rule was copy-pasted across five components and had already drifted out of sync in one place).

---

## 0.3.20 — June 1

**Overview page no longer hangs forever when something blocks the bootstrap fetch (e.g. a privacy extension intercepting `/api/me`). Every backend GET now times out at 45s, the email-lookup at 10s, and a clear "Overview unavailable" message renders if the page can't bootstrap — instead of an indefinite spinner.**

### Overview — load resilience

- **Hung loads now surface as an error** — when the critical clients fetch fails or times out, the page renders a clear "Overview unavailable. Refresh or check the API logs." panel instead of staying on "Loading overview…" forever.
- **Data load gated on resolved access** — the page now waits for the user's access profile to land before firing the data fetch, so the access check + the data fetch don't race each other on slow networks.
- **Faster paint when ready** — the required clients data loads first; the heavier secondary data (deliverables, cumulative pipeline, production trend, per-client production, goals) loads in parallel after, instead of blocking the first paint.

### Across the Hub — network resilience

- **Email lookup has a 10-second timeout** — the `/api/me` bootstrap call (which decodes your session cookie) used to wait forever if a browser extension or proxy blocked it; now it gives up after 10s. Failed lookups aren't cached, so the next API call retries.
- **Every backend GET has a 45-second timeout** — any backend request that stalls longer than that throws an explicit error, instead of leaving pages stuck on a spinner.
- **Sidebar nav waits for the access profile** — previously every link briefly flashed in before being hidden if the user didn't have access; now permission-gated sections only appear once the access profile loads.

### Known follow-ups

- The same timeout treatment hasn't been applied to `apiPost` / `apiPut` / `apiPatch` / `apiDelete` yet — a hung write (e.g. a comment post, an analytics flush) can still stall. Same with the error UI pattern, which currently only lives on the Overview page; the other dashboards will get matching error states in a follow-up.

---

## 0.3.19 — May 29

**Pod Snapshot Current Q row redesigned so the End-of-Q tier card sits adjacent to the progress bars it explains, with brighter column dividers and bigger numbers across every bar. New `BUSINESS_RULES.md` doc consolidates the Goals vs Delivery ingestion + display rules (including the upcoming Glossary content type from June) into one place.**

### Overview — Pod Snapshot · Current Q

- **End-of-Q tier card moved next to the bars** — the variance + tier badge now sits to the *right* of the Q delivered / Invoiced bars (was on the left), so the row reads left-to-right as "bars → verdict". Same change applies to the per-client expanded rows.
- **Bigger progress bars + numbers** — each bar height doubled, the percentage on the right of each bar now renders in larger bold white (was small cream), and the `delivered / invoiced` numbers beneath bumped in size and weight too. Variance number in the tier card grew from 16px to 20px.
- **Visible column dividers** — vertical separators between Goals · Current Q · %SOW · %Published columns brightened from near-invisible to a readable grey so the grid structure is clearer.

### New documentation

- **`BUSINESS_RULES.md`** (new top-level doc) — consolidates the Goals vs Delivery ingestion + display rules into one place: the full content-type matrix (Article ×1, Jumbo ×2, LP pre-May ×0.5, LP May+ ×2/×0.5, **Glossary June+ ×1/×0.5**), worked examples per type, cutover dates, code-pointer table, and an 8-step checklist for adding a new content type. `CLAUDE.md` (root) and `frontend/AGENTS.md` now carry a one-line summary that points to this doc.
- **Glossary content type** — new content type the team will start using from June 2026. Ingests as-is (no transform) and weights ×0.5 at display, so it counts as half an article-equivalent in the Overall row. Documented in `BUSINESS_RULES.md`; importer + frontend ratio will ship in a follow-up release once the sheet's content-type label is finalised.

---

## 0.3.18 — May 28

**New Admin → Analytics dashboard reveals how the team uses the Hub: who visits, which sections, how long they spend, which filters they apply, when they comment. Includes a Tracking Coverage tab documenting what's instrumented and what isn't, plus a Group filter so admins can compare usage by RBAC group (Leadership, Editorial Team, Growth Team, etc.).**

### Admin — Analytics (new dashboard)

- **Dashboard tab** with: KPI strip (total events / active users / sessions / top dashboard), Daily Activity stacked area chart paired with a leader-line donut showing event mix, Top Dashboards + Top Sections (with average dwell time), Drill-Down popover variants, Click Interactions, Comment Activity timeline, Per-User Activity table (last seen, sessions, top route), Filter Usage breakdown, and Return Cadence (median days between visits).
- **Tracking Coverage tab** — static inventory matrix of every trackable event grouped by category (Navigation, Section visibility + dwell, Filters, Drill-downs, Click toggles, Write actions, Hover engagement, Errors, Session lifecycle, Help). Each row carries a status badge: ✓ Tracked / ⊖ Partial / ✗ Missing. Includes a "Recommended next batch" priority list and an "Intentionally not tracked" section explaining the privacy / cost trade-offs.
- **Group filter** at the top of the Dashboard tab — dropdown listing every RBAC group with member counts and checkboxes; lets admins narrow every chart to a single group (e.g. "Editorial Team only") or any combination. Default reads "All groups". Range tabs (7d / 30d / 90d) still drive the time window.
- **Tooltip contrast fix** — every chart popover on this page now uses a custom dark tooltip so event names, values, and totals are readable regardless of slice colour. The donut's labels sit outside the ring with L-shaped leader lines and an event-name + percent label per slice (slices under 3% hide their label to avoid collisions; still visible on hover).
- **Privacy-by-design** — events fired while previewing as another user are silently dropped. The dashboard is gated behind Admin-only access; the Sidebar tab only appears for the Admin group. 6-month rolling retention; older events auto-deleted on app startup.

### Across the Hub — usage tracking instrumentation

- **PageView events** fire on every route change (including filter-bar URL updates).
- **Section visibility + dwell tracking** wired into every section on Overview (Pod Snapshot, Production History, Time to Milestones), Editorial Clients (Delivery Overview, Cumulative Pipeline, Monthly Goals, Contract Timeline), and Team KPIs (AI Flagged, AI Rewrites, AI Surfer). Records when the section enters the viewport and how long the user spent looking at it.
- **Filter clicks** logged when any FilterBar dimension changes (search, editorial pod, growth pod, status, date range).
- **Drill-down clicks** logged from Pod Snapshot — captures which popover variant was opened (client / goals / lastQ / currentQ / lifetime).
- **Comment activity** logged for every create / edit / resolve / delete on the Overview rich-text comments.
- **Chart toggle clicks** logged on Production History's view-mode toggle (All / Per pod / Per client).
- **Sync clicks** logged whenever the SYNC button kicks off a refresh.

### Under the hood

- **Recharts dev-mode warning suppressed** — the noisy "width(-1) and height(-1) of chart should be greater than 0" message that fired on every chart mount is now silently filtered in development. Pure dev-time cleanup; production builds are unaffected.
- **Analytics SQL hardened** — all aggregation queries now use static SQL with bound parameters end-to-end (no string interpolation), so the security scanner stays green on every deploy.

---

## 0.3.17 — May 27

**Overview reordered around Production History; Pod Snapshot drops the Last Q column; Editorial Clients' Delivery Overview gets two new scope-aware cards (per-pod Current Q variance + lifetime %SOW / %Published); Goals vs Delivery importer pre-treats LP rows from May 2026 onward so the Overall display matches the sheet exactly.**

### Overview — section order

- **Production History moves up** — section order is now Pod Snapshot → Production History → Time to Milestones. Left-rail SectionIndex follows. The Time to Milestones block (Pod Timelines + Time-to-Metrics + Per-Client Days) is still there, just lower on the page so the production trajectory sits adjacent to the headline Pod Snapshot card.

### Overview — Pod Snapshot

- **Last Q column hidden** — the per-pod and per-client Last Q variance column is dropped from the grid. Current Q widens to fill the freed space. Last Q is still readable in the click-anchored drill-down popover (lastQ variant) — only the always-on column was removed.

### Editorial Clients — Deliverables vs SOW · Delivery Overview

- **Projected Q Variance card (was Delivery Progress)** — section keeps the name "Delivery Overview", but the left card was renamed to **Projected Q Variance** so the title reads as exactly what the numbers mean. Lists per-pod End-of-Q variance (delivered · invoiced bar + tier chip per pod). Headline number on top stays as the portfolio variance. Each row carries `END-OF-Q +variance` and the tier label (`On Track / Within Limit / Behind`) inline — no separate legend block.
- **Pod Progress card replaces Closing in 90d** — same card aesthetic, contents now show per-pod `%SOW` and `%Published` bars side-by-side with raw `delivered / SOW` and `published / SOW` numbers underneath. Falls back to "no published count" when cumulative_metrics is empty for a client.
- **Scope-adaptive views** — both cards collapse to a **per-client breakdown** when a single pod is filtered (rather than a single-row pod summary). Single-client filter still uses the original 5-card lineup (Client Status → Delivery Progress → ratios → Time Remaining).
- **Pod color dots + bigger bars** — each row leads with the canonical pod color dot from the Graphite palette (matches what Pod Snapshot and the timeline cards already use), and the progress bars + percentages are larger and easier to read at a glance.
- **Closing in 90d card removed** — the lifetime contract-end signal was rarely actionable on the Delivery Overview surface; clients closing soon still surface in Data Quality and via the contract metadata in the per-client cards below.

### Data ingestion — Goals vs Delivery, LP-row AR pre-treatment

- **LP rows' delivery numbers (both CB and AR columns) from May 2026 onward are now stored doubled at ingestion** so when the Hub applies the canonical LP × 0.5 weight at display time, the per-type LP row shows the doubled stored value and the **Overall** row reads back the team's original sheet value. The spreadsheet from May entered LP rows as final physical-unit counts; the ingestion-side × 2 cancels the display-side × 0.5 so totals match what's on the sheet. Article rows pass through unchanged (× 1). Jumbo rows pass through unchanged at ingestion and get × 2 at display (as article-equivalents). April 2026 and earlier rows are untouched.
- **Pod Snapshot Goals popover · Overall row is now weighted** — applies the canonical content-type ratios (article × 1, jumbo × 2, LP × 0.5) at aggregation so the Overall always matches the Pod Snapshot bar above. Per-content-type rows still display stored values directly, so reviewers can see where the Overall came from (doubled LP cells from May 2026 onward; raw article/jumbo cells).
- **To activate:** run *Data Management → Re-sync Past Months → Master Tracker - Goals vs Delivery* once after deploy. Only May 2026 and later tabs change; the importer's month_year check guarantees April and earlier stay raw.

### Under the hood

- `arRowRatio` helper added then reverted in favour of the ingestion-side pre-treatment, so the canonical content-type ratio table (article ×1, jumbo ×2, LP ×0.5) is the **single source of truth** across every frontend aggregator. No per-axis ratio plumbing anywhere in the dashboards.

---

## 0.3.16 — May 25

**Comments composer rebuilt with rich text (bold, italic, links, lists) and an Hub-themed delete flow; Pod Snapshot Goals popover redesigned as a per-content-type × per-month grid; importer fix recovers months of dropped LP / Jumbo rows for multi-content-type clients.**

### Overview — Comments

- **Rich-text editor**: bold, italic, link, bulleted list, numbered list — typed inline via toolbar buttons or `Cmd+B / Cmd+I / Cmd+K` keyboard shortcuts. Links open inline in a "type URL → Apply" bar (no browser prompt). Existing plain-text comments still render as plain text — nothing breaks for old threads.
- **Comment editor auto-grows** with the text instead of staying a fixed three-line textarea.
- **Modal lock while writing**: clicking *+ Add comment* dims & blurs the dashboard behind the popover and disables outside-click, Esc, and the popover's X — the only exits are *Cancel* or *Post*. Same lock applies to the right-side comments rail (stays open, can't collapse on hover-out, while a draft is in flight).
- **Client picker is optional** on section comments: type a note and *Post* enables immediately. Comments without a client land under a green **General** group at the top of that section's popover.
- **Themed delete confirmation**: the browser's native "OK / Cancel" dialog is replaced by an inline confirmation box matching the Hub theme — *Delete this comment? This can't be undone…* with explicit *Cancel* and *Delete* buttons in red.
- **Edit your comments**: every comment now has a pencil "Edit" button next to Resolve and Delete. Clicking it swaps the body for the same rich-text editor with your existing text prefilled; *Save* updates the comment in place. The dashboard locks behind the scrim while editing, just like writing a new one.

### Overview — Pod Snapshot, Goals popover

- **Per-content-type × per-month grid**: each row is one content type (Article ×1, Jumbo ×2, LP ×0.5) and each column is a month. Every cell shows **CB del/goal** on top and **AR del/goal** below, with green/cream labels so the metric is unambiguous at a glance.
- **Overall row at the bottom** sums physical units across types (raw, not weighted) so the totals reflect actual produced deliverables. The Pod Snapshot bar continues to show the weighted overall so different content types stay comparable on the card.
- **Period highlighting**: columns within the selected period are tinted green.
- **Wider popover (760px)** to fit the grid, with positioning preference shifted to "below the click" — no more flipping high above the row.

### Overview — Pod Snapshot, Last Q

- **"1st Q" tier label** now also appears on the *Last Q · Last Close Variance* card when the client's last closed quarter was its first contract quarter — matching the Current Q behaviour. New contracts no longer get an alarming "Behind Plan" badge just because they started recently.

### Data Quality — Goals vs Delivery importer

- **Multi-content-type clients now ingest correctly.** Pre-fix, when a maintainer left Column A blank on a continuation row (typical for an LP or Jumbo row below the Article row), the importer silently dropped it. The fix forward-fills client + pods from the previous row when the continuation row has a real content type and at least one numeric cell. Empty / divider rows still get skipped — guarded.
- **Upsert key now includes content_type.** Previously an LP row and an Article row for the same client + week would overwrite each other depending on import order. A new DB-level unique constraint enforces the natural key going forward, so future bad imports fail loudly instead of silently dropping data.
- **Backfill via re-sync**: run *Data Management → Re-sync Past Months* on any month to recover historical LP / Jumbo rows that were previously dropped.
- **Selective re-sync**: the Re-sync Past Months tab now has a checkbox per step (Goals vs Delivery, Week Distribution, Team Pods, ET CP History, Backfill Editorial Pod). Pick only the steps you need — defaults to all selected. Faster targeted runs when you just want to refresh one tab.

### Under the hood

- Idempotent startup migration dedupes existing duplicate rows in `goals_vs_delivery` and adds the new uniqueness constraint on Neon.

---

## 0.3.15 — May 25

**Overview rebuilt around three clean sections — Pod Snapshot, Time to Milestones (new), Production History — with a click-to-focus interaction connecting Pod Timelines, Time-to-Metrics, and Per-Client Days. Legacy sections removed; hub-wide header + DataSourceBadge cleanup.**

### Overview — new "Time to Milestones" section

- **Pod Timelines** card (new): horizontal day-axis per pod (multi-pod collapsed by default → Avg row only). Unified single tick row at the top so every pod shares one CKO/7d/14d/… axis. When you filter to a single pod, the pod expands automatically and stretches to fill the card height.
- **Time-to-Metrics** card (new): 8 milestone-transition averages in a 2×4 grid (Consulting KO → Editorial KO, Consulting KO → First Article, etc.). Each card surfaces avg / min–max / contributor count, with a hover popup listing every contributing client grouped by pod.
- **Per-Client Days** card (was inside the Editorial Clients D1 view): bar chart of days per client for the selected milestone transition. Per-client tooltip shows from/to dates + variance.

### Overview — click-to-focus on a client

- Click a client row in **Pod Timelines** → the row gets a green ring, the **Time-to-Metrics** cards re-scope to that client's numbers (avg becomes that single client's days, a chip in the card header shows the client name), and the **Per-Client Days** bar for that client lights up while the others dim. Click again to clear.
- Hover a Time-to-Metrics card OR a Pod Timelines segment → cross-card highlight: matching segment / card glows, others dim, Per-Client Days dropdown temporarily switches to that transition. Toggle the chip "Link cards" in the section header to disable all cross-card effects.

### Overview — Pod Snapshot

- **Q variance redesign**: each Q cell now shows the Q label, *End-of-Q Variance* or *Last Close Variance*, the variance number, and the tier label stacked in a tier-coloured bordered block on the LEFT of the row, with the two progress bars (Q delivered, Invoiced) on the right. No more bottom chip row.
- **Current Q bar reads ACTUAL progress, not projection**: the bar shows cumulative delivered through the last completed month vs cumulative invoiced through end-of-Q. Variance + tier still come from the projected end-of-Q outcome.
- **Pod-aggregate Current Q delivered/invoiced now include 1st-Q clients** — their real delivered work was being excluded from the bar's totals (so the Current Q "del" no longer matched the %SOW lifetime delivered). Only the variance + pace metrics still skip 1st-Q clients (variance is meaningless before a client ramps).
- **Current Q column rebuilt earlier this round.** Out: the `55 · 81 · 81` labelled triple and the two-shade pace bar with the *Push needed / On track / Ahead of pace* chip. In: two compact bars — Q delivered + Invoiced — followed by an **End-of-Q Variance** chip carrying the variance number and tier label (On Track / Within Limit / Behind Plan / 1st Q).
- **Goals column on per-client rows** now uses the same MiniProgress design as the pod row (label · num/goal · % + bar) — consistent visualisation across pod summary and client rows.
- **Single-pod view** drops the aggregated pod summary row and shows a thin labelled separator at the top (dot · pod name · count · horizontal rule) — same style as Pod Timelines' pod label strip.
- **Column widths tuned**: slimmer name + Goals + %SOW + %Published, more room for the two Q columns, vertical dividers between data columns.

### Overview — Production History

- **Per Client** view toggle is hidden when more than one pod is in scope (20+ overlapping lines is unreadable; per-client only renders when a pod filter narrows it to ≤ ~10).
- Custom tooltip rendered outside the chart with viewport-clamped positioning — never moves the page, anchors next to the cursor (centered vertically and clamped to viewport edges), shows up to all clients per pod with milestone numbers.
- Per-Client mode tooltip groups clients by pod with pod-coloured headers; per-pod mode tooltip shows just the pod totals (no client list).

### Milestone numbering across the section

- Every milestone is now prefixed with its chronological number — **1** Consulting KO · **2** Editorial KO · **3** First CB Approved · **4** First Article · **5** First Feedback · **6** First Published. Number appears in the Pod Timelines legend, Time-to-Metrics card titles (e.g. `1→4 · Consulting KO → First Article`), Per-Client Days metric dropdown, and tooltips throughout.

### Editorial Clients — Client Delivery cards alignment

- **QuarterRow** matches the same pattern as Pod Snapshot Q cells: tier-coloured progress bar + `delivered / target` numbers. **Current Q bar reads ACTUAL delivered to date** (not projected end-of-Q) — variance + tier still describe the projected outcome.
- **End-of-Q Variance chip** restored as a standalone line below the two Q rows carrying the headline variance + tier.
- `ClientDetailPopover` Current Q variant rebuilt to mirror the same row pattern. Monthly breakdown table + AS-OF SOW progress chart unchanged.

### Hub-wide visual normalization

- **Section titles** on Editorial Clients + Team KPIs now use the lighter Overview Section style (`text-sm font-semibold text-[#C4BCAA]`). Sticky `top-[120px]` + `border-b` + horizontal-rule pattern dropped.
- **Page header** on Overview slimmed: AsOfBadge moved out of the inline title (still shown inside section title chips), title bumped to `text-base`, filters + sync controls share one non-wrapping row, sticky band reduced to `min-h-[72px]`.
- **Editorial Clients + Team KPIs** page headers picked up the same `text-base` title + `flex-nowrap gap-x-4` shape so all three dashboards read identically.
- **Chart titles** moved INSIDE their bordered cards (e.g. "Client Engagement Timeline" no longer hangs outside the card).
- **LIVE / source badges** (`DataSourceBadge`) hidden across the Hub — the component is now a no-op.

### Smaller fixes

- **Client search dropdown** in the FilterBar scopes to clients matching the active pod + status filters (was showing every client regardless of the visible chips).
- **Pod Timelines** auto-expand when one pod is in scope; the chevron is hidden + collapse disabled so the card can't accidentally go empty.
- **Pod Delivery Progress single-pod filter** keeps a thin labelled strip (pod dot + name + count + horizontal rule) at the top so users see which pod they're scoped to.
- **JourneyTooltip** now shows the milestone number prefix in the focal stat title + each "after previous milestone" leg label.
- **Client-name popover** (clicking a client name cell in Pod Snapshot) now shows ONLY the static client info (status + pods + contract). The Goals / Last Q / Current Q / %SOW blocks were dropped — each has its own popover variant when clicking its respective cell, so duplicating them was just noise.
- **Client Delivery card "Lifetime" row** (Editorial Clients D1) now computes its Delivered/Invoiced bar from `monthly_breakdown` (cumulative through last completed month), matching Pod Snapshot logic. Was showing date-filter-scoped numbers that contradicted the "Lifetime · SOW" label.
- **Popover dismissal** — `ClientDetailPopover` now closes on scroll (outside the popover) in addition to outside-click + Esc. Scrolling inside the popover body still works.
- **Goals period dropdown** in Pod Snapshot now shows the concrete month range under each option (`Last 3 months` → `Feb – Apr 26`, `All time` → `Jan 24 – Apr 26`, etc.) so users see the window before picking. Trigger pill stays compact on the short label.

### Removed

- **Legacy sections** on Overview (Delivery Overview · Cumulative Pipeline · Client Delivery at a Glance · Time-to Metrics legacy) plus their `Show / Hide` container and ~1,000 lines of supporting view code — superseded by Pod Snapshot + Time to Milestones.
- **Deep-link "Open in Editorial Clients"** buttons in Overview section headers — the new sections are the canonical view; cross-page deep links were noisy.
- **Pace bar + chip** (Push needed / On track / Ahead of pace) and `paceClassify` helper removed from all three card surfaces — `QProgressBar` (two-shade bar) gone too. Only the single `LifetimeBar` remains.

---

## 0.3.14 — May 22

**Last Q is now rendered in a muted grey across Pod Snapshot, Client Delivery cards, and the detail popover — Current Q reads as the focal point.**

### Pod Snapshot · Editorial Clients

- **Last Q column dimmed.** The "Last Q · Variance" column header, the per-pod summary tile, and every per-client Last Q cell now render in mid-grey instead of the green/amber/red tier colours. Current Q keeps the full palette so the eye lands on the actionable column.
- **Tier label still accurate.** The text ("Healthy" / "Within limit" / "Behind") is unchanged — only the colour drops to grey, so screen-readers and tooltip readers still see the same outcome chip.

### Client Delivery cards (Editorial Clients + Overview legacy)

- **Last Full Q row muted.** The Last Full Q chip, label, variance number, tier text, numbers, and progress bar all drop to grey. Current Q above keeps its colour so the row carries the actionable signal.

### Detail popover

- **Last Q variant dimmed** to match — variance number and tier label render in grey. 1st-Q new-client clients still get their blue chip since "1st Q" is a separate (and useful) context, not an outcome.

**Current Q reads in plain English now (delivered · proj Q · invoiced); pace bar drops red and gets clearer labels (Push needed / On track / Ahead of pace); Re-sync Past Months gets the same step-by-step progress UI as the Import Wizard; SYNC button no longer re-pulls one-time-seed sheets on every click.**

### Pod Snapshot · Editorial Clients — Current Q rebuilt

- **Numbers are labelled.** The old `55 → 81 / 81` arrow form is replaced by three clearly-labelled numbers: **delivered · proj Q · invoiced**. Each value carries a small tag below so you don't have to remember what each slot means. Same treatment on the Pod Snapshot tile, the click-anchored detail popover, and the per-client Client Delivery cards.
- **Pace bar drops red.** Now uses three shades: dark green = *Ahead of pace*, light green = *On track*, yellow = *Push needed*. The red BEHIND chip above the bar still appears when delivered minus invoiced has actually fallen below threshold — that's the outcome variance (a different signal). The two are intentionally separate: a client can be Behind on variance and still be on pace to recover.
- **Tooltip explains the math.** The Current Q column header tooltip now ends with a plain-English line: *"Pace tells you if delivery is keeping up with how much of the Q has elapsed."*

### Overview · Editorial Clients — Production History

- **Tooltip stops getting clipped** at the right edge. When the cursor approaches the right side of the chart, the tooltip flips to the left of the cursor instead of being cut off.
- **Pods now sort by pod number** inside the tooltip (Pod 1 → Pod 2 → Pod 3 → Pod 5 …) instead of by delivery volume, so the reading order is stable from month to month.
- **Per-pod toggle works on Editorial Clients too.** Same All / Per pod control as Overview, fully wired to the Editorial / Growth axis. Behavior is identical across both dashboards.

### Admin → Data Management — Re-sync Past Months

- **Step-by-step progress.** Re-sync Past Months now mirrors the Import Wizard's importing screen: five named steps with live status icons (pending → spinner → check / error) and an overall progress bar. No more single ten-second spinner with no insight into where it's stuck.
- **ET CP Pod History expands into per-tab dropdowns.** Just like Master Tracker — Goals vs Delivery, each historical ET CP version tab is its own row with parsed / imported counts and an *Imported* badge. Click any tab to see a working preview of that month's snapshot (skipping the banner rows so the Client / Pod columns line up).
- **Backfill Editorial Pod is no longer a 500.** The summary row now expands to show every client that got their pod backfilled (with the source tab it came from) plus any client that had no history to draw from. No more "Preview failed — API error: 500".

### SYNC button — lighter default

- **Drops five sheets** from every SYNC click: ET CP Pod History (the current ET CP version still imports — only the historical walk moved) and four one-time-seed sheets (Model Assumptions, Delivery Schedules, Editorial Engagement Requirements, Meta Calendar Month Deliveries). They rarely change, so re-fetching them on every click was wasted time. All five remain available in the Import Wizard, unchecked by default — tick them only when one actually needs a refresh.
- **Refresh Computed KPIs preview** no longer 500s. Synthetic steps (computed, no underlying sheet) now return an empty preview gracefully instead of an error card.

### Help & Glossary

- **Pace labels updated** to the new three-bucket vocabulary (Push needed / On track / Ahead of pace).
- *Reading the cards* updated to describe the new explicit-label number row.

---

## 0.3.12 — May 22

**Overview gets a Pod Snapshot section as its new lead view; Production History gains a per-pod toggle; legacy sections collapse behind a Show button; Data Quality reorganized around a unified Pod History tab + per-column filters everywhere.**

### Overview — new lead section: Pod Snapshot

- **Per-pod Delivery Progress + Milestone Journey** — Two new cards at the top of Overview replace the old top-row triage. Delivery Progress rolls Last Q / Current Q numbers up per pod (NOW → END / Invoiced, projected variance, pace-coloured bar, progress %). Milestone Journey shows the timeline of Editorial KO → First CB → First Article → First Feedback → First Published per pod.
- **Section-local Goals period selector** — Above the Goals column, pick Current month / Last 1 / 3 / 6 / 12 months / All time. Period bounds are computed from the actual goals data envelope, not the calendar.
- **Click-to-drill popovers** — Click any Last Q / Current Q / Goals / Lifetime cell to open a detail popover with the monthly breakdown table (variance cells tinted by tier), pace bar, projected end-of-Q variance, and the contract's SOW progress chart anchored to the editorial AS-OF date.
- **Cumulative-through-end-of-Q math everywhere** — Last Q and Current Q numbers across Pod Snapshot AND Client Delivery at a Glance now consistently show cumulative totals through the end of the quarter (not per-Q deltas). Matches the spreadsheet's per-Q Variance row.
- **Pace classification** — A second signal beside variance. The bar colour shows whether a client is *ahead* / *on pace* / *slipping* / *behind pace* for the current quarter. A client can be Behind on variance but on pace to recover — both signals show side-by-side.

### Overview — Production History

- **All / Per pod toggle** — New segmented control in the chart's top-right. *Per pod* draws one line per pod using the pod colours, no fill. Tooltip groups the clients under each pod with pod totals + per-client values.
- **Follows the global Editorial / Growth axis** — Per-pod mode regroups according to the current axis toggle, so admins / leadership can see the same chart through either lens.

### Overview — Legacy sections

- **Show toggle at the bottom** — Time-to Metrics, Delivery Overview, Cumulative Pipeline, and Client Delivery at a Glance all moved into a single *Legacy sections* block behind a Show / Hide button. They were superseded by Pod Snapshot above and stay mounted for reference until removal.
- **Left nav rail trimmed** — Only Pod Snapshot and Production History show in the section index now.

### Editorial Clients — Client Delivery at a Glance

- **Last Q / Current Q rows rebuilt** — Same NOW → END / Invoiced + variance + pace-bar pattern as Pod Snapshot. The Current Q row now leads with the variance number + tier chip on the right, then the cumulative numbers, then the pace-coloured two-shade bar with progress %.
- **Single source of truth across surfaces** — Pace thresholds and tier thresholds are now identical between Pod Snapshot, the per-client cards, and the drill-down popovers.

### Filter bar — date range + pod axis

- **Date picker improvements** — Year bounds are now driven by the data envelope (no more rolling through empty years). The picker uses subtle past / current / future tense colours, an iOS-style multi-year selector, and a Quick Select highlight on the active preset.
- **Dynamic panel anchor** — Date picker now flips its alignment (left vs right) based on the trigger's viewport position so it never clips off-screen.
- **Pod Axis toggle inline with the filters** — Moved out of the top-right and into the filter row with a "Pod Axis" label, between Growth Pod and Status.

### Admin → Data Quality (reorganized)

- **Pod History tab (merged)** — Old Pod Drift, Missing SOW, and Not-in-SOW-Overview tabs collapsed into a single Pod History tab. Combined filter chips: RESOLVED / POD DRIFT / INCOMPLETE SOW / NOT IN SOW OVERVIEW. Each row exposes a `missing_fields` summary.
- **Delivered Drift — 4-source comparison** — Refactored to compare Operating Model, Delivered vs Invoiced, Cumulative Pipeline, and SOW Overview side-by-side with span colouring.
- **New Modeling Limitations tab** — Moved out of the body and into its own tab.
- **Per-column filters everywhere** — Google-Sheets-style header filter dropdowns (text / combobox / select / range / date) on every tab. Powered by a new shared `ColumnFilter` primitive.
- **Backfill Editorial Pod from history** — Added as a step inside the *Re-sync past months* flow so missing editorial-pod assignments get filled automatically.
- **Page layout fixed to the viewport** — Only the tab tables scroll now; tabs + filters stay anchored.

### Admin / Data Management

- **Page titles normalized** — All admin + data-management pages share the same Data Quality eyebrow + h1 pattern for a consistent look.
- **Access Control** — Fixed an overlap in the sticky left column on hover.

### Help & Glossary

- **Pace term added** — Sits next to Variance in the glossary as a separate signal.
- **New How-to entries** — Drilling into a Q cell on Overview, the per-pod toggle on Production History, and finding the Legacy sections block.
- **Reading the cards rewritten** — Updated around the new NOW / END / Invoiced + pace-bar + variance pattern.

---

## 0.3.11 — May 15

**Delivery Progress card now drives every Deliverables view; per-card tier badges + explicit "variance" wording across Overview Triage; Help modal made wider and gated to Admin/Leadership/BI Team.**

### Editorial Clients — Delivery Overview

- **Cards row reshuffled** — Replaced "Last Q closes" with the same **Delivery Progress** card used on Overview, repositioned to the first slot. Portfolio: Delivery Progress → Closing in 90d. Single pod: same two cards (Variance card removed — current-Q variance per client already lives on the cards below). Single client: lineup now leads with Client Status → Delivery Progress (scoped to that client) → Delivered ÷ Invoiced → Invoiced ÷ SOW → Time Remaining (Last Full Q card removed; its signal already appears inside Delivery Progress).
- **Section tooltip refreshed** to describe the new per-scope card sets.

### Client Delivery at a Glance — both dashboards

- **Per-card tier badge** — Each client card now carries a small pill next to the name: `HEALTHY` (green) · `WITHIN LIMIT` (amber) · `BEHIND` (red) · `1ST Q` (blue). Same thresholds as the Overview Delivery Progress card so the two surfaces classify identically.
- **1st Q escape hatch applied per card** — Clients in their first contract Q (e.g. Photoroom) no longer read as red "Behind plan". The card surfaces a calm blue `1st Q` badge + a "New 1st Q" hint in place of the alarm copy, mirroring how the Triage cards already treated them.
- **"End-of-Q variance" labeling** — The line under the Current Q progress bar was relabeled from "Projected end of Q" to **End-of-Q variance** (with an `articles` unit chip on the number). The tooltip now states the formula explicitly: *projected delivered − invoiced cumulative through end of current quarter*.

### Overview — Triage

- **Variance wording is now canonical** across Delivery Progress, Most Behind, and Pod Attention. Every headline, subtitle, tooltip, and popover refers to *projected end-of-current-Q variance* explicitly. The formula `delivered − invoiced` appears in at least one bullet per card so anyone hovering knows what the −5 / −15 numbers mean.
- **Card alignment** — All cards in the Delivery Overview row stretch to a uniform height (no more shorter Client Status card next to taller cards).
- **Narrow layout** — Inside the single-client lineup, each Delivery Progress row gracefully wraps its Last Q / Current Q halves to two lines instead of overflowing.

### Help & Glossary

- **Modal width** — The Help / Changelog modal is now noticeably wider (780px) so long bullets read cleanly without horizontal cramping.
- **Changelog tab gating** — Only Admin · Leadership · BI Team see the Changelog tab. Everyone else lands on Help & Glossary. A small inline note next to the tab confirms the access rule for authorized viewers.
- **Glossary content** — Team KPIs row now carries the `(proposal stage)` label (the dashboard still has gaps, will be filled in 0.4.x). The "Add a global note about a client" tip was removed (the comments rail was already replaced by per-section bubbles).
- **Status filter mention** — The "Find a specific client" tip now references the **Soon to be active** option in the Status filter.

---

## 0.3.10 — May 14

**Bug fixes across data sync, dashboard filters, and pod color-coding; plus a new Data Quality tab for pod assignment issues.**

### Bug fixes

- **Monthly detail (Client Delivery cards)** — The detail popover now opens scrolled to the most recent closed billing period instead of the oldest row. Long-history clients (like Webflow) no longer appear to show incomplete data.
- **Webflow + multi-year contract history** — The "Delivered vs Invoiced" importer previously had a 36-month cap that silently dropped Sep 2025–Feb 2026 data for Webflow. The cap is now removed entirely; the importer reads however many months the sheet carries.
- **Goals vs Delivery (SYNC button)** — The SYNC button was never actually importing Goals vs Delivery data because individual month tabs (e.g. `[May 2026] Goals vs Delivery`) didn't match the expected sheet name. Fixed with a synthetic aggregate entry so SYNC now correctly imports the current month's data.
- **Pylon May 2026** — Was showing 7 CBs / 0 ADs. After the Goals vs Delivery fix, now correctly shows 0 CBs / 1 AD, matching the Master Tracker.
- **Pod colors in Client Engagement Timeline** — Extended from 5 to 12 pods; clients on pods 6–12 no longer appear grey. Timeline legend is now dynamic, showing only pods that exist in the current filtered view.
- **Growth Pod — Workleap** — "Workleap" in BigQuery didn't match "Workleap + Sharegate" in the app. Added to the name-override dictionary.
- **Growth Pod importer — fuzzy self-heal** — Before flagging a BigQuery client as unmatched, the importer now tries substring matching automatically. Cases like "Workleap" ↔ "Workleap + Sharegate" resolve without a code deploy.
- **Deliverables pagination** — Editorial Clients and Overview pages now page through all deliverables in 1 000-row batches rather than capping at the first page.

### New features

- **Filter bar: "Soon to be active"** — New status option added alongside Active / Inactive.
- **Data Quality → Pod assignment issues tab** — Unmatched BigQuery client names (those that couldn't be mapped to a DB client during Growth Pod import) now persist in a `pod_import_issues` table and surface in a dedicated tab in `/admin/data-quality`. Shows BQ name, intended pod, and first/last seen dates. Rows auto-clear on the next SYNC when fuzzy matching resolves them.
- **Overview → deep-link scroll** — Clicking a client or pod in the Delivery Overview cards now opens and scrolls to the right card on Editorial Clients, with a brief highlight ring. Falls back to a URL redirect if the page isn't already loaded.

### Under the hood

- Leadership group renamed to **Leadership + Ops**; Diego Rubio added as a seeded member.
- Growth Team exclusion logic fixed: a member with two pod rows (one Content Specialist, one pod member) is now correctly excluded from the Growth Team access group.

---

## 0.3.9 — May 13

**In-app Help & Changelog modal, surfaced from the sidebar.**

- **Sidebar · Help button** — A new "Help" icon at the bottom of the sidebar (next to the user info) opens a Help & Glossary panel covering: which dashboard answers which question, a glossary of the terms used across the Hub (pod, SOW, variance, cumulative, "current Q", "as of", etc.), how to do common tasks, and the permission tiers in one line.
- **Sidebar · Version chip is now clickable** — Click `v0.3.9` to open the Changelog tab of the same modal. Plain-language history of every release, scrollable.
- **Modal · Tabbed interface** — Help & Glossary · Changelog. Tabs preserve state when switching. Modern dark-theme styling with markdown rendering (tables, code, blockquotes, etc.). A "Back to app" button in the footer plus the standard ✕ in the header.
- **Plus:** the release workflow auto-syncs `CHANGELOG.md` into the bundled in-app copy whenever the version is bumped, so the modal is always current.

---

## 0.3.8 — May 13 (hotfix)

**Fix backend startup crash on Railway after the 0.3.7 Leadership consolidation.**

- The seed loop used to skip a member only when an existing row had `source='seed'` for the same `(group_id, email)` pair. But the database's `(group_id, email)` uniqueness constraint ignores `source`, so any member previously added by an admin via the UI (`source='manual'`) would block a later seed reinsert and crash startup. The new 0.3.7 Leadership roster (Christine Woods, Bryan, Paula Landinez) hit this exact case in production — they had been added manually before being added to the seed list. Fix: the existence check now matches on `(group_id, email)` alone, so manual rows are correctly treated as "already a member" regardless of how they got there.

---

## 0.3.7 — May 13

**Access-control overhaul (Leadership consolidation, draft mode), data-driven editorial pod assignment, cumulative variance math, plus a tooltip rewrite pass across every dashboard.**

- **Admin → Access Control · Leadership consolidation** — The old pod-derived Leadership group has been retired and the `VPs and Managers` group is now called **Leadership**. Juan Mantilla added to the seed list. Senior Editors / Growth Leads now get their access purely through Editorial Team / Growth Team (their pod's clients, locked to their pod axis). The seeded Leadership tier (VPs + managers) keeps full org-wide reach + Capacity Planning v2 access.
- **Admin → Access Control · membership exclusions** — Pod-derived groups now filter out roles that don't use the dashboards: **Writers** no longer appear in Editorial Team, and **Content Specialists** no longer appear in Growth Team. The Editorial Team / Growth Team counts you see in the matrix reflect only the people who actually need dashboard access.
- **Admin → Access Control · draft mode** — Cell edits no longer save instantly. Click toggles now stage changes locally with an amber dashed outline; a sticky bottom banner shows "N unsaved edits" with Save / Discard. Save flushes everything in one batch; switching tabs preserves your draft; sidebar navigation prompts before discarding. A conflict modal surfaces when another admin moved the same cells while you were editing (Save anyway / Discard conflicts / Review).
- **Admin → Access Control · Users × Views row improvements** — Group memberships now display by **name** ("Growth Team") instead of slug ("growth_team"). The "Show only overrides" toggle is now clearable with an explicit ✕ even when the count drops to zero, and stays visible after toggling — no more getting stuck with an empty matrix.
- **Admin → Access Control · Preview Access button** — Sits inline with the row instead of pushed to the far right, and renders as a small green outline pill so it reads as an action.
- **Overview · Triage cards** — Rewritten so they tell one consistent story:
  - **Delivery Progress** counts each client by **end-of-current-quarter projected variance** (cumulative through end of Q, not last Q in isolation). Healthy: on target or ahead · Within limit: behind by ≤ 5 · Behind: below −5 · **New (1st Q)**: ramping clients in their first contract quarter — kept out of triage entirely.
  - **Most Behind** + **Pod Attention** use the same lens. Each row shows BOTH last quarter's actual close AND this quarter's projected close, so catch-up plans in flight are visible. Brand-new clients surface in a separate blue "N new (1st Q)" pill.
  - Over-delivery (e.g. shipping +6 in Q2 to catch up a −6 deficit in Q1) reads as **0 / Healthy**, not Behind. Matches the spreadsheet's Variance row math.
- **Overview · 2 × 2 layout** — The Triage cards are now arranged 2 × 2 (Delivery Progress · Most Behind · Pod Attention · Closing in 90d), replacing the old 3-on-top + 1-below grid. "Last Q Closes" was removed — its signal is folded into the per-row last-quarter values on Most Behind / Pod Attention.
- **Overview · Monthly Goals section** — Restored as a pod-aggregation snapshot (no per-client breakdown — Open in Editorial Clients for that). Shows AsOf badge and Open-in-D1 deep link.
- **Overview · As Of badges** — Now appear on the Cumulative Pipeline and Production History section headers so the period the data covers is unambiguous.
- **Overview · Sections merged** — "Client Delivery" and "Client Delivery at a Glance" are now a single section title with the As Of badge inline.
- **Overview · Sidebar comments rail** — A discreet right-edge rail (hover to expand) replaces the old per-section comment icons' dependence on filter scope. Pulls all general + section-anchored threads, narrowed to the current client / pod filter. Optional client field means admins / Leadership can post truly global notes that aren't tied to a single client. Posting from one place refreshes everywhere (single shared store).
- **Overview · Preview Mode banner** — When admin is impersonating another user, the indicator is now a full-width sticky banner at the top of the app shell (amber, pulsing dot, Exit button) instead of a floating chip that overlapped the SYNC button.
- **Editorial Clients · pod axis follows the filter** — If you have access to the Editorial / Growth toggle and pick a specific Editorial Pod or Growth Pod in the filter bar, the axis auto-flips to match. No more mismatched groupings.
- **Editorial Clients · Client Delivery + Cumulative Pipeline pod groups** — Both sections now collapse by pod (same behavior as Overview). One click to expand each pod, keeps long pages scannable.
- **Editorial Clients · Monthly Goals vs Delivery** — Per-client breakdown is now a collapsible-by-pod list and the section heading is promoted so it reads as a proper sub-section, not a faint caption.
- **Editorial Clients + Overview · per-client cards** —
  - Cumulative pipeline bars: hover any horizontal bar (Topics / CBs / Articles / Published) to see the raw count, contracted SOW, and progress %.
  - Quarter Performance bars (Last Full Q / Current Q): re-coloured as a calm beige → deep green ramp (matching the Topics colour in Cumulative Pipeline) instead of red/amber/green alarm tiers. The actionable signal lives in the new "Projected end of Q" line.
  - **Projected end of Q** — A new informational row below the Current Q bar shows where the quarter is projected to close (e.g. `+0 On track` / `−5 Slight drift` / `−6 Behind plan`). Catch-up in this quarter cancels earlier deficits.
  - The "Articles: %" footer was removed from cumulative pipeline cards (info now lives in the bar tooltips).
- **Editorial Clients + Overview · Monthly detail popover** — The Variance column is now cumulative (matches the spreadsheet's Variance row exactly). Column header tooltips, top-of-popover legend, and per-period chip colors all align.
- **Capacity Planning · Editorial pod from the sheet** — The hardcoded list of "which clients are in which pod" is gone. Pod assignment is now read directly from the article-breakdown section of the latest `ET CP 2026 [V## <Month YYYY>]` sheet, using the rightmost non-empty Pod column per client. SYNC picks up pod moves automatically. The sheet-version detector also numerically sorts the `V##` portion so `V13` beats `V9`.
- **Sidebar UX** — Sidebar nav links now prompt before navigating away when there are unsaved Access Control changes. The Preview Access toast follows sidebar hover and stays clear of the SYNC button.
- **Tooltip + DataSourceBadge copy** — Sweeping rewrite across every dashboard (Overview, Editorial Clients, Team KPIs, all shared cards, all charts). Tooltips are now ≤ 3 bullets, ≤ 10 words per bullet, plain English, no sheet/schema references. Rule documented in `frontend/AGENTS.md` House rules.

---

## 0.3.6 — May 11

**Refinements to Access Control's Groups tab + the Editorial / Growth toggle scope + the Overview comments UX.**

- **Admin → Access Control · Groups tab** — Each group now exposes a "What this group can do" card inside its expanded row showing **Sections**, **Pod axis** (Toggle / Locked Editorial / Locked Growth / No toggle), and **Client scope** (All / Assigned / Own pod only). Plus a "▸ How groups work" collapsible reference table at the top of the tab that summarizes all six seeded groups in one place.
- **Editorial / Growth toggle is now scoped to the dashboards** — Overview, Editorial Clients, Team KPIs. Hidden on Admin, Data Management, and Capacity Planning pages where it has no effect. Your last selection still persists when you navigate back to a dashboard.
- **Overview · Comments — Notion-style** — The right-side rail is gone. Each section now has a small comment icon next to its title. Click → a popover opens just below it with that section's threads, no full-screen overlay, no backdrop, no layout shift. Empty sections fade their icon in on hover; sections with threads show the icon plus the open / resolved count.
- **Overview · Comments — client picker** — The composer's client picker is now a typeahead text input + dropdown (same style as the dashboards' "Search clients..." filter), instead of a native select. Filters as you type.
- **Overview · Comments — timestamps** — Comment timestamps now read like Notion: `now`, `42m`, `2h`, `10:42 AM` (same day), `Yesterday`, `May 8`, then `May 8, 2024` for older. Hover the timestamp for the full localized date + time.

---

## 0.3.5 — May 8

**Access Control — granular edit role + protections.**

- New **Edit Access Control** privilege rendered as a second pill (in blue) next to the View pill under the Access Control column. Granting it lets a non-admin selectively edit the matrix without making them a full Admin. Sensitive ops stay admin-only: Admin-group permissions and membership, plus granting Edit Access Control itself, can never be touched by a non-admin.
- **Admin group is now read-only** in the matrix. Admins always have full access by definition; the row can no longer be modified by anyone.
- **Seeded Admins (Daniela, Ricardo) are immutable** across the whole matrix. No one — including other admins — can override their access. Stale overrides on these accounts are auto-cleaned on every backend restart.
- **View-only banner** on the Access Control page when a viewer doesn't have edit access, so they understand why pills aren't clickable.
- **Capacity Planning v2** moved out of the "Proposal" section into "Data" (matches where it belongs in the sidebar).

**Access Control matrix — visual pass.**

- New **3-level column header**: Section → Dashboard → Tab. Top row groups columns under Dashboards / Data / Admin; the middle row labels each dashboard (Overview, Editorial Clients, Team KPIs, Capacity Planning v2, Import Data, Access Control, Data Quality); the bottom row only appears for dashboards with tabs.
- **Stronger column dividers** between sections (heavier 2px line) and between dashboards within a section (lighter 1px line) so the groupings are visible while scrolling.
- The "Group" / "User" sticky-left column gets its own right-edge divider so the matrix data is properly bounded.
- **Override visualization** in Users × Views: cells now show a green ↑ when a user has *more* access than their group, or a red ↓ when they have *less*. The amber dot is gone — direction is always shown. User rows show the same arrows next to the name with a count. A "Show only overrides" filter toggle and an override count chip appear at the top.
- **Groups tab matrix layout** mirrors Users × Views: rows = groups, columns = views, click any cell to grant/revoke. Click a group name to expand inline and see members in a 3-column grid.

**Preview Access — full flow.**

- Starting a preview now redirects you to the previewed user's first accessible page (instead of stranding you on the No Access wall when previewing as a non-admin).
- **Sticky amber banner** at the top of every page while preview is active, with an Exit Preview button that's always reachable no matter where you navigate.
- Exit Preview returns you to the path you were on when you started preview — usually back to Access Control.

**Access changes propagate to other users on tab focus.**

- Other users' open tabs silently refresh their access profile when they switch back to the tab. If their access changed (something added or revoked), the UI updates seamlessly — no flicker, no full reload, no scroll-position loss. If access didn't change, nothing visibly happens.

**Editorial / Growth toggle works everywhere it should.**

- Fixed: with Growth selected, the Cumulative Pipeline section, Time-to Metrics Client Milestone Journey, Client Engagement Timeline legend, and Pod Attention card were all still grouping or labeling by Editorial Pod. Every per-pod chart, badge, and section header now follows the active toggle.
- New toggle visual: segmented control with a sliding indicator that animates between Editorial / Growth via a spring transition. Editorial uses Graphite green; Growth uses sky-blue — color-coded so the active axis is identifiable at a glance.
- Empty-state copy updates correctly ("No growth-pod pipeline data" vs "No editorial-pod pipeline data").

**Overview dashboard — Cumulative Pipeline collapsed by pod.**

- Each pod block on the Overview's Cumulative Pipeline section is now collapsed behind an expand row by default, matching Client Delivery at a Glance below it. Keeps the page scannable when there are 50+ clients.

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
