// Single source of truth for the Hub's user-facing version.
//
// Scheme: 0.PHASE.ITERATION (see CHANGELOG.md for the full rationale).
//   • PHASE bumps when the project enters a new focus area
//       0.1 → initial Hub  ·  0.2 → data foundation
//       0.3 → UI maturity  ·  0.4 → CP v2 → DB migration (next)
//   • ITERATION is uncapped — 0.3.10 is fine. 1.0 ships when CP v2 is wired
//     to the database and RBAC is signed off.
//
// Update this on every release; the sidebar chip + any other consumer reads
// from here so we don't end up with version strings in two places.
export const VERSION = "0.3.2";
