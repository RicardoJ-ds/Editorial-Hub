# Monthly Article Count — Standardization Proposal (live demo)

**For:** DaniQ · **From:** Ricardo · **Date:** 2026-06-11
**Demo:** the working copy of the Monthly Article Count sheet
(`1X_M82VzstJCulkl6l62jaubn2yI0ODBTz33iZ4XqZWU`) — everything below is already
applied there so you can click through it. The real team sheet is untouched;
if you approve, these rules are what we'd bring to the team.

## Why

Three real incidents drove this (all caught while reconciling the Hub against
the Operating Model):

1. **Felt was invisible.** Its tab put the headers on row 1 instead of row 2,
   so the importer skipped the entire tab — months showed as "missing" when
   ~100 articles existed.
2. **446 articles had their year hidden.** The SUBMITTED column's display
   format ("Aug 26") hid the year on real dates, so those articles couldn't be
   placed in a month and fell out of every monthly count.
3. **Names don't match HR.** "Sam" was two different people over time
   (McGrail → Marceau), "Lauren" became ambiguous when a second Lauren
   joined, and writers appear under 200+ spelling variants.

## The rules (what's applied in the demo copy)

| # | Rule | How it's enforced |
|---|------|-------------------|
| 1 | **One editor per article row** — picked from a roster dropdown, no free text | `EDITOR (STANDARD)` column: dropdown fed by the `📋 Rosters` tab, **strict** (typos are rejected on entry) |
| 2 | **Writers from a roster** | `WRITER (STANDARD)` column: same dropdown pattern (warning-level, since legacy history only has first names) |
| 3 | **One real date per SUBMITTED cell, year always visible** | must-be-a-date validation + `yyyy-mm-dd` display format on the column |
| 4 | **Fixed tab layout** — banner row 1, headers row 2, minimum columns: ARTICLE TITLE · SUBMITTED · COPY NAME · WRITER · EDITOR | `✅ VALIDATION AUDIT` tab flags any tab that deviates (this is the Felt bug class) |
| 5 | **One maintained roster, not 100 lists** | the `📋 Rosters` tab is the single source for all dropdowns; HR names from Rippling. New joiner = add one row there |
| 6 | **New tabs born compliant** | TEMPLATE carries the standard columns + all validation, so duplicating it inherits everything |

## What you'll see in the copy

- **Originals untouched**: the existing EDITOR / WRITER columns are exactly as
  the team wrote them. The new `(STANDARD)` columns sit right beside them with
  the canonical HR names — before → after on every row.
- **"Sam" resolved by dates**: rows through Jan 2026 say Samantha McGrail,
  rows from May 2026 say Samantha Marceau (matches their Rippling tenure
  exactly). Bare "Lauren" = Lauren Friar everywhere (your Keleher rename made
  that unambiguous — thank you).
- **Red cells = the "/" collaborations** (1,471 rows like "Alyssa/Abby"). They
  show both canonical names but fail the one-editor rule on purpose — they're
  waiting for your real-assignment list.
- **`✅ VALIDATION AUDIT` tab**: every tab scored — header position, missing
  columns, rows filled, pending slash cells, unparseable dates, verdict.
- **456 articles recovered**: fixing the date display let us place 446
  previously month-less articles into their real months, on top of Felt's
  ~100 — monthly counts are more complete than before.

## What this does NOT change

- The Hub keeps reading the **original** columns (its name dictionary already
  normalizes them), so dashboards don't move until we deliberately switch to
  the standard columns.
- Pre-2025 history: names that predate the people sources stay as-is —
  the bar is the capacity-model window (2025+), and that's now clean.

## If approved — rollout to the real sheet

1. DaniQ sends the real assignments for the 1,471 "/" rows (any format).
2. We apply the same script to the real sheet (or a fresh copy the team
   adopts): insert the two STANDARD columns + rosters + validation + audit.
3. Team switches to entering ONLY via the dropdowns; the importer flips to
   reading the STANDARD columns; the legacy columns freeze as history.
4. New clients = duplicate TEMPLATE → everything inherited.

*Everything is scripted and repeatable: `python -m etl.sheet_standardize`
(dry-run first, `--apply` to execute). No manual cell editing was involved.*

---

## Addendum 2026-06-15 — writer confirmations applied + what the sheet still needs

### Applied from DaniQ's green-marked validation
- **Editors**: no change needed — 29/29 confirmed against Rippling (the source
  of truth); Sam/Lauren already disambiguated.
- **Writers**: her 72 green confirmations are now reflected in
  `WRITER (STANDARD)` on every client tab — 20 first-name→full-name upgrades
  (live in the Hub too), the **`audition`** bucket for trial writers, and the
  Dan split (audition → Daniel Pelberg from Jun 2025). The roster + dropdown
  now include all confirmed names + `audition`.

### What the Monthly Article Count sheet still needs to stay maintainable
1. **SUBMITTED** — keep as one real date per cell (validation + `yyyy-mm-dd`
   already applied). 60 legacy cells still unparseable; fix at source.
2. **REVISED** — today it's a comma-list of dates in one cell (multi-revision).
   Recommend **one date per revision** in a consistent format, or a separate
   `REVISIONS` count column — so revision-rate KPIs don't depend on parsing a
   free-text list.
3. **One editor per row** — the 1,471 "A / B" collaboration cells still need
   DaniQ's real per-article assignment (the only open writer/editor item). The
   `EDITOR (STANDARD)` dropdown is STRICT, so these flag red until split.
4. **Fixed structure** — banner row 1, headers row 2, required columns
   (ARTICLE TITLE · SUBMITTED · COPY NAME · WRITER · EDITOR). The
   `✅ VALIDATION AUDIT` tab flags any tab that drifts (the Felt bug class).
5. **Missing-article check vs the source of truth** — NEW
   **`🔍 OM RECONCILIATION`** tab: per client × month, Operating Model actual
   vs articles logged here, with a GAP + STATUS column. It surfaces exactly
   where logging is incomplete. Current flags: Meta AI/BMG/RL (no tab at all),
   GenstoreAI (logged under the "Genstore" tab — confirm same client),
   Workleap+Sharegate (logged under "ShareGate"), and small unders
   (Cointracker −16, n8n −6). This regenerates whenever we re-run the
   standardizer. (A live cross-sheet `IMPORTRANGE` from the Operating Model is
   possible but fragile; the generated snapshot is the safer maintenance tool.)
