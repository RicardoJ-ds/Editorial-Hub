// Help / Quick guide content rendered by <HelpModal>. Keep this file in
// plain markdown — react-markdown handles the rendering. Audience is
// non-technical Editorial Ops + stakeholders; same style rules as
// dashboard tooltips (short, plain English, no schema names).

export const HELP_MARKDOWN = `# Editorial Hub — Quick Guide

A single place for Editorial Ops to track clients, deliverables, capacity, and team KPIs. Replaces the workflow spread across three Google Sheets.

---

## Which dashboard for which question?

| You want to know… | Open |
|---|---|
| How is the team doing right now? | **Overview** |
| Is a specific client on track? | **Editorial Clients** |
| How are individual editors performing? | **Team KPIs** _(proposal stage)_ |
| Plan capacity for next quarter? | **Capacity Maintenance** _(proposal stage)_ |
| Audit who can see what? | **Admin → Access Control** |
| Spot data drift between sources? | **Admin → Data Quality** |
| Who's using the Hub and how often? | **Admin → Analytics** _(admin-only)_ |

---

## Glossary

**Editorial Pod** (E1–E5) — who edits the article.

**Growth Pod** (G1–G7) — who owns the account relationship.

Each client has one of each.

**SOW** — Statement of Work. The total number of articles contracted for the engagement.

**Delivered** — Articles already shipped to the client.

**Invoiced** — Articles already billed for. Follows the contract's billing cadence (every 1, 2, 3, or 5 months).

**Variance** — Delivered minus invoiced. We use **cumulative variance through end of current quarter**, so over-delivery this quarter cancels earlier deficits.

**Last Q / Current Q** — Each client's **own** contract quarters, anchored to their start date — not calendar quarters. **Current Q** progress bars show actual delivered to date vs cumulative invoiced through end of Q; the variance + tier always describe the projected end-of-Q outcome. The Last Q column was removed from the Pod Snapshot grid — Last Q is still readable via the per-client drill-down popover (click any row).

**Milestones** — Six steps a client passes through, numbered in order: **1** Consulting KO · **2** Editorial KO · **3** First CB Approved · **4** First Article · **5** First Feedback · **6** First Published. The numbers show up in legends, card titles, dropdowns, and tooltips so the same milestone is identifiable across surfaces.

**As Of** — The last fully-completed Editorial month (from the team's week-distribution sheet).

**New (1st Q)** — Clients still in their first contract quarter. Always look "behind" on invoicing because they haven't had time to ramp; surfaced as a separate tier in triage so they don't trigger false alarms.

**Pod axis** — Editorial vs. Growth. Determines how charts group clients. Admin / Leadership / BI Team can toggle it in the top-right; pod-locked teams see their own axis only.

**Capacity utilization (Real vs Weighted)** — On Team KPIs → **Capacity & Revisions** (Capacity view), pods and editors show two rates. **Real** = work actually delivered ÷ capacity (how busy they were). **Weighted** = delivered ÷ what was planned (did we hit the plan). Pod rows also show **Projected** = planned ÷ capacity. Specialized clients' articles count ×1.4 toward a pod's workload. Click a pod to expand its editors; use its **Clients** button to slide in the client-by-client breakdown.

**Capacity & Revisions tab** — A top **Capacity | Revisions** switch picks what you're looking at. **Capacity** is the utilization view above. **Revisions** shows the same layout for article delivery: **Articles** (delivered), **Revisions** (rework events), and **Revision rate** (articles needing ≥1 revision ÷ articles). Same pods table, trend chart, and per-editor grid.

**Preview Mode** — Admins can render the dashboards as another user to debug their permissions.

---

## How to…

#### See a different time window
Use the date-range picker at the top of any dashboard.

#### Find a specific client fast
Use **Search clients…** in the top filter row. The **Status** filter lets you narrow to Active, **Soon to be active**, or Inactive/Completed clients.

#### Drill into a cell on Overview
Click any Last Q / Current Q / Goals / Lifetime cell inside **Pod Snapshot** to open a detail popover. The **Goals popover** opens as a wide per-content-type × per-month grid: each row is one content type (Article ×1, Jumbo ×2, LP ×0.5), each column is a month, and every cell stacks *CB del/goal* (green) on top and *AR del/goal* (cream) below. The bottom **Overall** row sums physical units across types (raw, not weighted) — the Pod Snapshot bar stays weighted for cross-type comparability. Clicking the client name itself opens a lighter snapshot with status + pods + contract dates only. The popover closes when you click outside it, hit Esc, or scroll the page.

#### Focus the milestone cards on one client
On the **Time to Milestones** section, click a client row in **Pod Timelines**. The row is highlighted, the **Time-to-Metrics** cards re-scope to that client's days (the card title carries a chip with the client name), and the **Per-Client Days** bar for that client lights up. Click again to clear.

#### Cross-card highlight on hover
Hover a Time-to-Metrics card OR a Pod Timelines segment / dot — matching elements in the other cards light up; Per-Client Days temporarily switches to the hovered metric. Toggle **Link cards** in the section header to disable.

#### See the per-pod (or per-client) split on Production History
The chart has an **All / Per pod / Per client** toggle in the top-right. *Per client* only shows up when a pod filter narrows the scope to one pod (20+ overlapping lines is unreadable otherwise).

#### Switch how charts group clients
Click **Editorial / Growth** at the top-right (if available to you).

#### Read what a card actually means
Hover the dotted-underlined title — every metric carries a 2–3 bullet explanation.

#### Comment on a section
Hover the chat-bubble next to each section title on the Overview dashboard. Click to open a popover, optionally pick a client, and post. The composer is a rich-text editor — *Bold*, *Italic*, *Link*, *Bulleted list*, *Numbered list* via the toolbar or *Cmd+B / Cmd+I / Cmd+K* shortcuts. Comments posted without a client land under a green **General** group at the top of the section's popover. While you're writing or editing, the dashboard behind dims and locks — only *Cancel* or *Post / Save* dismiss the composer (no accidental loss of in-progress text). Admins + Leadership can post; everyone can read. Every existing comment carries an **Edit** button (pencil icon) next to Resolve and Delete; clicking it opens the same editor with your text prefilled so you can fix typos or add detail. Deleting a comment opens an inline confirmation (*Cancel / Delete*) — irreversible.

#### See how the team is using the Hub *(admin-only)*
Open **Admin → Analytics**. Two tabs: **Dashboard** (charts of total events / active users / sessions, daily activity, top dashboards + sections by view count and dwell, drill-down popover variants, click interactions, comment activity, per-user activity, filter usage, return cadence) and **Tracking Coverage** (inventory of every trackable event with status: ✓ Tracked, ⊖ Partial, ✗ Missing). The Dashboard tab has a **Group filter** (multi-select per RBAC group with member counts) — narrow the charts to "Editorial Team only", "Leadership + Ops", or any combination. Range tabs: 7d / 30d / 90d. Data retention is 6 months.

---

## Permissions, in one line

Five seeded groups. Click **Admin → Access Control** to see the full matrix.

- **Admin / Leadership / BI Team** — all clients · axis toggle · full read access.
- **Editorial Team** — their own pod's clients · Editorial axis only.
- **Growth Team** — their own pod's clients · Growth axis only.

---

## Reading the cards on Editorial Clients

The **Delivery Overview** section (Deliverables vs SOW tab) leads with two summary cards that adapt to scope:

- **Projected Q Variance** — per-pod end-of-Q variance bars + tier chip (*On track / Within limit / Behind / Ahead*). Filter to a single pod → the card swaps to a per-client breakdown of that pod. Same tiers + math as Pod Snapshot on Overview.
- **Pod Progress** — per-pod *%SOW* (lifetime delivered ÷ contracted SOW) + *%Published* (published_live ÷ SOW) side-by-side bars with raw counts beneath. Falls back to "no published count" when cumulative pipeline data isn't loaded for a client. Filter to a single pod → switches to a per-client breakdown.

Each per-client card below the summary shows:

- **Tier badge** (next to the name) — at-a-glance status: _On track_ (green, exactly on target), _Within limit_ (amber, ±1–5 either way), _Behind_ or _Ahead_ (red, more than ±5 off), or _1st Q_ (blue) for brand-new contracts. Same thresholds as Pod Snapshot on Overview.
- **Last Q** — cumulative *delivered / invoiced* through the end of the last full contract quarter, with the variance + tier label below the bar.
- **Current Q** — bar shows *actual delivered to date* over *invoiced through end of Q* (the bar is real progress, not a projection). The variance number + tier label describe the projected end-of-Q outcome.
- **End-of-Q variance** — projected *delivered − invoiced* through end of current quarter. Tiers: _On track_ (exactly 0), _Within limit_ (±1–5 either way), _Behind_ (below −5) or _Ahead_ (above +5) — being far ahead is flagged too, since over-delivered work isn't billed yet. New 1st-Q contracts get a calm _1st Q_ chip instead of an alarm.
- **Lifetime · SOW** — Delivered / Invoiced / SOW for the full relationship.

---

## SYNC

The **SYNC** button at the top right pulls fresh data from Google Sheets + Notion + BigQuery into the app. Run it when:

- You want the latest delivered / invoiced numbers.
- A new month just ended.
- An admin moved a client between pods.

The badge next to the button shows when the last sync ran.

**Re-sync past months** (Data Management → Re-sync Past Months) forces a re-import of a closed Goals vs Delivery month. Use it after the importer fix in 0.3.16 to backfill LP / Jumbo rows that were previously dropped when the source sheet left Column A blank on continuation rows. Each step (Goals vs Delivery, Week Distribution, Team Pods, ET CP History, Backfill Editorial Pod) has its own checkbox — uncheck the ones you don't need for a faster targeted run.

---

## Need a deeper look?
Open the source spreadsheets directly via **Admin → Data Quality** (which also flags drift between sources). The team's Notion changelog covers UX history; click the version chip in the sidebar for an in-app copy.
`;
