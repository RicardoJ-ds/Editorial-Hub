---
name: normalization-scope-2025
description: Name-normalization priority rule — capacity-model coverage (≥2025) must be clean; pre-2025 mismatches are accepted. Plus open normalization threads.
metadata: 
  node_type: memory
  type: project
  originSessionId: 23c6899d-f043-4d1c-9662-68a72342385a
---

# Normalization scope rule (Ricardo, 2026-06-11)

**The bar is Dani's capacity model coverage, ~2025 onward.** Editors/clients
not matching real HR names BEFORE ~2025 is normal and accepted — the complete
info doesn't exist (people sources don't reach back; 2022-era names like
kira/kristin/shain/shalin stay unresolved by design). Do NOT burn effort
chasing pre-2025 name parity; DO keep 2025+ exact.

**Idea (backlog):** surface this in the Hub with flags/badges — e.g. a
"pre-capacity-era" badge on pre-2025 article months / unresolved names so
users know mismatches there are expected, not bugs.

## Resolution mechanisms now in place
- **Date-windowed aliases**: `article_name_aliases.valid_from/valid_to`
  ('YYYY-MM', inclusive; unique on (kind, raw_value, COALESCE(valid_from,''))).
  Importer resolves by the article's month; windowless row = fallback;
  undated articles only match windowless. Decisions from Rippling headcount
  (`graphite_bi_sandbox.v_headcount`: employee_name, start_date,
  termination_date, department).
- **"Sam" split (closed)**: ≤2026-01 → Samantha McGrail (tenure 2025-08-04→
  2026-01-27); ≥2026-02 → Samantha Marceau (started 2026-05-11). Log months
  match tenancy windows exactly (no Sam rows Feb–Apr 2026). 4 undated Sam
  rows stay raw 'Sam' (flagged, immaterial).
- **"Lauren" rule (closed)**: DaniQ renamed the new Lauren's sheet entries to
  "Lauren Keleher" (started 2026-06-01), so every bare "Lauren" = **Lauren
  Friar** (Sr. Editor since 2025-09-15). Static alias applied.

## Open normalization threads
- **"/" collab editors** (e.g. "Alyssa/Abby"): DaniQ will send the REAL
  assignments per article. Today they're exploded one-credit-per-editor.
  When her list arrives → apply as per-article corrections.
- **26 unresolved client tabs** (Athena2, Credit Karma, Curology, EarnIn…)
  → map-or-dismiss in Data Quality → Article mappings.
- **6 clients with 2026 OM actuals but zero article log**: Meta AI (78),
  Vimeo (58), GenstoreAI (35), Meta RL (32), Meta BMG (20),
  Workleap+Sharegate (15) — missing tab or missing alias.
- **Honey vs Honeybook / Tempo XYZ vs Tempo**: Ricardo believes same client;
  the SOW lists them as SEPARATE rows (Honey ACTIVE 2026-05 SOW 125 vs
  Honeybook ACTIVE 2025-12 SOW 180; Tempo XYZ SOON_TO_BE_ACTIVE vs Tempo
  ACTIVE, both start 2026-06 SOW 120; also Tempo.io COMPLETED). Empty article
  tabs either way → no data lost. Needs Dani/ops confirmation before any
  merge; do NOT alias unilaterally.
- **Legacy 2021-era tabs** Picsart (EDITOR column exists but 100% empty) /
  Point / Titan (no editor columns): skipped by the editor-credit requirement.
  Pre-2025 → accepted per the scope rule unless Dani wants them.
- **Origin-sheet standardization — DONE (additive) on the working COPY**
  (2026-06-11): `ARTICLE_COUNT_ID` now = `1X_M82VzstJCulkl6l62jaubn2yI0ODBTz33iZ4XqZWU`
  (fresh copy; the earlier copy 1eRmZ… had in-place edits, superseded; the
  REAL team sheet is locked elsewhere — Ricardo's instance has NO access).
  `etl/sheet_standardize.py` (dry-run default / --apply): originals untouched,
  `EDITOR (STANDARD)` / `WRITER (STANDARD)` columns inserted beside them
  (95 tabs + TEMPLATE), strict roster dropdown on editor std / warning on
  writer std, fed from a `📋 Rosters` tab (Rippling); SUBMITTED = date
  validation + yyyy-mm-dd display. The "MMM d" display format was HIDING the
  year on 446 real dates → undated rows 502→56 (those articles now count in
  their real months). `✅ VALIDATION AUDIT` tab scores every tab. Proposal
  doc: `etl/SHEET_STANDARDIZATION_PROPOSAL_for_DaniQ.md`. Importer ignores
  the new columns (exact-match header aliases) and still reads originals.
