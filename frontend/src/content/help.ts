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
| How are individual editors performing? | **Team KPIs** |
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
Use **Search clients…** in the top filter row.

#### Drill from a triage signal into the client
Click any row inside **Most Behind** or **Pod Attention** — it scrolls straight to the per-client card.

#### Switch how charts group clients
Click **Editorial / Growth** at the top-right (if available to you).

#### Read what a card actually means
Hover the dotted-underlined title — every metric carries a 2–3 bullet explanation.

#### Comment on a section
Hover the chat-bubble next to the section title on the Overview dashboard. Admins + Leadership can post.

#### Add a global note about a client
Use the right-edge comments rail on the Overview dashboard. The client field is optional — leave it blank for an org-wide note.

---

## Permissions, in one line

Five seeded groups. Click **Admin → Access Control** to see the full matrix.

- **Admin / Leadership / BI Team** — all clients · axis toggle · full read access.
- **Editorial Team** — their own pod's clients · Editorial axis only.
- **Growth Team** — their own pod's clients · Growth axis only.

---

## Reading the cards on Editorial Clients

Each per-client card shows:

- **Last Full Q** — what they actually closed last quarter (% of invoicing target).
- **Current Q** — partial progress this quarter (settled months only).
- **Projected end of Q** — where the quarter will land cumulatively. The friendly label tells you the state at a glance: _On track_, _Slight drift_, or _Behind plan_. Over-delivery counts as on-track.
- **Lifetime · SOW** — Delivered / Invoiced / SOW for the full relationship.

The bar colors run beige (low) → deep green (full). They are intentionally **not** alarming — the actionable signal lives in the **Projected end of Q** row.

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
