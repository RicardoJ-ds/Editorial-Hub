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
