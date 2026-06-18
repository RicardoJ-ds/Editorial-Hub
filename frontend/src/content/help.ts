// Help / Glossary content rendered by <HelpModal>. Keep this file in
// plain markdown — react-markdown handles the rendering. Audience is
// non-technical Editorial Ops + stakeholders; same style rules as
// dashboard tooltips (short, plain English, no schema names).
//
// Scoped (per DaniQ) to the Glossary only — terms relevant to
// Editorial Clients & Overview. Nothing else lives here.

export const HELP_MARKDOWN = `## Glossary

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
`;
