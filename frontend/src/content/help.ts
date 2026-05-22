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

---

## Glossary

**Pod** — A group of editors that owns a set of clients. Two flavors run in parallel:
- **Editorial Pod** (E1–E5) — who edits the article.
- **Growth Pod** (G1–G7) — who owns the account relationship.

Each client has one of each.

**SOW** — Statement of Work. The total number of articles contracted for the engagement.

**Delivered** — Articles already shipped to the client.

**Invoiced** — Articles already billed for. Follows the contract's billing cadence (every 1, 2, 3, or 5 months).

**Variance** — Delivered minus invoiced. We use **cumulative variance through end of current quarter**, so over-delivery this quarter cancels earlier deficits.

**Pace** — A second signal next to variance. Compares how far through the quarter you are vs. how much you've actually delivered. A client can be *behind* on variance but *on pace* to recover — both signals show side-by-side.

**Last Q / Current Q** — Each client's **own** contract quarters, anchored to their start date — not calendar quarters.

**As Of** — The last fully-completed Editorial month (from the team's week-distribution sheet).

**New (1st Q)** — Clients still in their first contract quarter. Always look "behind" on invoicing because they haven't had time to ramp; surfaced as a separate tier in triage so they don't trigger false alarms.

**Pod axis** — Editorial vs. Growth. Determines how charts group clients. Admin / Leadership / BI Team can toggle it in the top-right; pod-locked teams see their own axis only.

**Preview Mode** — Admins can render the dashboards as another user to debug their permissions.

---

## How to…

#### See a different time window
Use the date-range picker at the top of any dashboard.

#### Find a specific client fast
Use **Search clients…** in the top filter row. The **Status** filter lets you narrow to Active, **Soon to be active**, or Inactive/Completed clients.

#### Drill into a Q cell on Overview
Click any Last Q / Current Q / Goals / Lifetime cell inside **Pod Snapshot** to open a detail popover — monthly breakdown, pace bar, projected end-of-Q variance, and the contract's SOW progress chart.

#### See the per-pod split on Production History
The chart has an **All / Per pod** toggle in the top-right. *Per pod* draws one line per pod using the pod colours, with a tooltip that groups the clients under each pod. It follows the global **Editorial / Growth** axis toggle.

#### Reach a legacy section on Overview
Time-to Metrics, Delivery Overview, Cumulative Pipeline, and per-client Delivery cards now live under a single **Legacy sections** block at the bottom of Overview — click **Show** to expand. They'll be removed once Pod Snapshot is fully validated.

#### Switch how charts group clients
Click **Editorial / Growth** at the top-right (if available to you).

#### Read what a card actually means
Hover the dotted-underlined title — every metric carries a 2–3 bullet explanation.

#### Comment on a section
Hover the chat-bubble next to each section title on the Overview dashboard. Click to open a popover, pick a client, and post. Admins + Leadership can post; everyone can read.

---

## Permissions, in one line

Five seeded groups. Click **Admin → Access Control** to see the full matrix.

- **Admin / Leadership / BI Team** — all clients · axis toggle · full read access.
- **Editorial Team** — their own pod's clients · Editorial axis only.
- **Growth Team** — their own pod's clients · Growth axis only.

---

## Reading the cards on Editorial Clients

Each per-client card shows:

- **Tier badge** (next to the name) — at-a-glance status: _Healthy_ (green), _Within limit_ (amber), _Behind_ (red), or _1st Q_ (blue) for brand-new contracts. Same thresholds as Pod Snapshot on Overview.
- **Last Q** — cumulative *delivered / invoiced* through the end of the last full contract quarter, plus the variance and a tier chip.
- **Current Q** — cumulative *delivered / invoiced* through the end of the current contract quarter (actuals + projection for the remaining months). Numbers read as NOW → END / Invoiced.
- **Pace bar** — colour shows whether the client is on track for the current quarter: _ahead_ / _on pace_ / _slipping_ / _behind pace_. This is a separate signal from variance — a behind-on-variance client can still be on pace to recover.
- **End-of-Q variance** — projected *delivered − invoiced* through end of current quarter. The friendly label tells you the state at a glance: _On track_ (≥ 0), _Slight drift_ (−5 to 0), or _Behind plan_ (below −5). New 1st-Q contracts get a calm _New 1st Q_ hint instead of an alarm.
- **Lifetime · SOW** — Delivered / Invoiced / SOW for the full relationship.

The two-shade bar shows actuals as solid + remaining projection as a fainter extension — the colour itself comes from the pace classification, not the absolute %.

---

## SYNC

The **SYNC** button at the top right pulls fresh data from Google Sheets + Notion + BigQuery into the app. Run it when:

- You want the latest delivered / invoiced numbers.
- A new month just ended.
- An admin moved a client between pods.

The badge next to the button shows when the last sync ran.

---

## Need a deeper look?
Open the source spreadsheets directly via **Admin → Data Quality** (which also flags drift between sources). The team's Notion changelog covers UX history; click the version chip in the sidebar for an in-app copy.
`;
