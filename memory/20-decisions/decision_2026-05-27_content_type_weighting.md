---
name: decision-2026-05-27-content-type-weighting
description: "Decision: content-type goal weighting is a two-stage transform (ingestion + display). LP doubled at ingestion from May 2026 so display ×0.5 cancels to physical units; jumbo ×2 display-only; glossary documented (Jun 2026) but ratio not yet shipped (B1)."
metadata:
  node_type: memory
  type: decision
  originSessionId: 3fa962ac-9be0-4852-8c63-16ff918094cb
---

# Decision — Content-type goal weighting (two-stage), 2026-05-27 (0.3.17)

Full formulas + worked examples → [[metrics-goals-content-weighting]]. This file records the
*decision* and its rationale.

## The decision
1. **Weighting is two-stage** — an **ingestion transform** AND a **display ratio** (`contentTypeRatio()`). The Overall (cross-type) net = product of both. The **hardcoded content-type table is the single source of truth**, not the sheet's inconsistent `"2:1"` `ratios` string.
2. **LP doubled at ingestion from May 2026 onward** — when the team switched LP entry from pre-weighted half-units to **physical counts**, the importer (`migration_service.py:4034-4046`) doubles LP's CB+AR columns so the display-side ×0.5 cancels → the Overall row reads the sheet's physical total. **April 2026 and earlier untouched** (guard `month_year >= 2026*12+5`). Per-type LP rows intentionally show the doubled value.
3. **Jumbo ×2 is display-only** (no ingestion transform); article ×1.
4. **Glossary (Jun 2026): ingest ×1, display ×0.5** — documented in `BUSINESS_RULES.md` (0.3.19, May 29).

## Why
- LP physical-count entry would otherwise inflate the Overall row 2×; doubling-then-halving keeps the displayed total honest while letting the team enter natural counts.
- One authoritative table (vs the sheet's directionally-broken `ratios` string) prevents jumbo reading ×0.5.
- Doing the weight at **roll-up step 2** keeps all 3 frontend aggregators + the warehouse port consistent.

## Rejected / reverted
- `arRowRatio` row-level helper — added then **reverted** in favour of ingestion-side pre-treatment, so the content-type table stays the single source of truth.

## Known open consequence — Bug B1
**Glossary ×0.5 is documented but NOT in code.** `contentTypeRatio()` has no glossary branch (FE or `pyrules.py`) → a glossary row falls to the `ratios` parse and defaults to **×1**, not ×0.5. The importer recognition + the FE ratio both still need to ship. Tracked `etl/WAREHOUSE_DESIGN.md:211` (B1). **This is the one outstanding item of this decision.**

## Lineage
0.3.16 (May 25, importer forward-fill + content_type in upsert key) → **0.3.17 (this decision)** → 0.3.19 (May 29, BUSINESS_RULES.md + glossary doc) → 0.3.21 (Jun 8, symmetric variance tiers, see [[metrics-end-of-q-variance-tiers]]).
