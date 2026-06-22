---
name: analysis-normalization-proposal
description: "The spreadsheet normalization work for DaniQ: additive sheet standardization, the 4 name dictionaries (windowed editor/writer aliases, client mappings), OM↔MAC reconciliation numbers (92.2% raw / ~98% real), the 12 client decisions + D1–D8, and the open threads. A top iteration area."
metadata:
  node_type: memory
  type: analysis
  originSessionId: 3fa962ac-9be0-4852-8c63-16ff918094cb
---

# Spreadsheet Normalization + Name Mappings + OM↔MAC Reconciliation

The work to standardize the Monthly Article Count sheet and normalize editor/writer/client names to
canonical sources, so the capacity model is trustworthy. **A top iteration target.** Scope rule:
[[normalization-scope-2025]]. Metrics it feeds: [[metrics-monthly-articles]], [[metrics-capacity-utilization]].
Docs (all for DaniQ): `etl/SHEET_STANDARDIZATION_PROPOSAL_for_DaniQ.md`, `etl/NAME_MAPPINGS.md`,
`etl/DATA_QUALITY_CAVEATS_for_DaniQ.md`, `etl/reports/MAPPING_VALIDATION_REPORT.md`, `etl/reports/SUMMARY_for_DaniQ.md`.

## 1. Additive sheet standardization (`etl/sheet_standardize.py`)
**Principle — additive, originals untouched.** Keep the existing `EDITOR`/`WRITER` columns; **add two `(STANDARD)` columns** beside them with canonical HR names. The Hub importer still reads the originals (its dictionary normalizes them), so dashboards don't move until a deliberate switch.
- Ran on the working copy `ARTICLE_COUNT_ID = 1X_M82Vz…` (the real team sheet is locked elsewhere — Ricardo's instance has no access). Applied to **95 client tabs + TEMPLATE**.
- 6 rules: 1 editor/row from roster (strict dropdown) · writers from roster (warning) · one real date/SUBMITTED cell with visible year (ISO `yyyy-mm-dd`) · fixed layout (banner row 1, headers row 2) · one `📋 Rosters` tab as the single dropdown source (Rippling names + `audition` bucket) · TEMPLATE born compliant.
- **The "MMM d" hidden-year bug (big recovery):** the legacy display format hid the year → those dates couldn't be placed in a month and fell out of every count. Fixing to ISO dropped undated rows **502 → 56** (446 real dates recovered); + Felt fix ≈ **456 articles recovered**.
- Audit tabs added to the copy: `✅ VALIDATION AUDIT`, `🔍 OM RECONCILIATION`, `🔬 SAMPLE AUDIT (May 2026)`.
- Run: `python -m etl.sheet_standardize [--apply]` (dry-run default). Fully scripted, repeatable.

## 2. Name-mapping rules
**Authoritative = machine-readable `etl/mappings/*.json`** (built by `python -m etl.build_mappings`: curated seeds ∪ live DB distinct values ∪ canonical pulls; new names land `unresolved`, never dropped). `NAME_MAPPINGS.md` = human summary.
- **Canonical sources** (via `sa-key.json`, project graphite-data): editors → `graphite_bi_sandbox.v_team_pods_editorial` (HR view — contractor writers NOT in it); clients → `graphite_bi.salesforce_int_Account` (162); writers → `pod_assignments role='writer'` ∪ `ai_monitoring_records.writer_name` ∪ `notion_articles.writer`. Date windows from Rippling `v_headcount`.
- **Windowed aliases** (`article_name_aliases.valid_from`/`valid_to`, 'YYYY-MM' inclusive; windowless = fallback; undated articles only match windowless):
  - **"Sam" (closed):** ≤2026-01 → Samantha McGrail (term 2026-01-27); ≥2026-02 → Samantha Marceau (started 2026-05-11). Log months match tenancy exactly.
  - **"Lauren" (closed):** DaniQ renamed the new Lauren to "Lauren Keleher" in-sheet → every bare "Lauren" = Lauren Friar.
- **Writer dictionary (78 renames)** applied 2026-06-10 → `article_name_aliases (kind='writer', source='etl')`; reversible (`DELETE … WHERE source='etl'`); distinct writer names 244→208; ~70% rows full-named.
- **Editors 29/29 confirmed vs Rippling** (zero mismatches; DaniQ left them unmarked on purpose). Resolved: `mike→Michael Doyle`, `Kennedy Sievers→Stevens` (typo); Maggie/Tiffany conflict was a termination-timing artifact.
- **Curated 38-entry name→email map** (writers, `build_int_pod_assignments`) — **authoritative over row-level emails** (positional pairing mispaired: `ashton.playsted@`→Ashton not Eric; `sinandvinegar@`→Mindy Born not Aranyak). **Lesson:** name↔email needs adjudication or strict ≥5-char surname evidence; co-occurrence alone mispairs.

## 3. OM↔MAC reconciliation (numbers)
OM (client-level, source of truth) vs MAC (editor/writer breakdown). **Editorial-month basis tracks OM within 3-9%** (the right comparison; calendar swings ±50-110 from month-edge shifts).

| Month 2026 | OM | MAC editorial | edit gap |
|---|--:|--:|--:|
| Jan | 274 | 264 | −10 |
| Feb | 294 | 269 | −25 |
| Mar | 324 | 293 | −31 |
| Apr | 339 | 311 | −28 |
| May | 364 | 334 | −30 |

**Jan–May: OM 1,595 vs MAC 1,471 = 92.2% logged.** The 124 gap is mostly **Meta family (no tab): Meta AI 78 + Meta RL 33 + Meta BMG 20 = ~131**. After GenstoreAI (35=35) + Workleap+Sharegate (108≈105) aliases net out, **per-client reconciliation is ~98-99% — the only true remaining gap is the Meta family.** (The 92% raw figure is unchanged by aliases — those articles were mislabeled, not missing.)

## 4. The 12 DaniQ client decisions (2026-06-12, commit `8579fcd`)
ChatGPT→OpenAI · Engine→Hotel Engine · Landing→Hello Landing · EarnIn B2C/B2B keep split (both→SF "EarnIn") · Orderful (I)+(II) same SF account (Hub merge pending Ricardo) · Workleap+Sharegate→Workleap · Meta Manus dismissed · FRC/Lenny/Neeva stay unlinked · **Tempo lineage:** old Tempo→Tempo.io (inactive), Tempo XYZ→Tempo (active) — **512 articles re-attributed Tempo→Tempo.io** (matches OM 507) · Honey/Tempo XYZ confirmed separate new clients. Genstore+ShareGate re-confirmed 2026-06-15 (`d970c2d`).

## 5. The D1–D8 caveats (`DATA_QUALITY_CAVEATS_for_DaniQ.md`)
D1 Lauren (closed) · D2 Sam (closed) · D3 4 unknown 2022 editors (Kristin/Shalin/Kira/Shain — not in HR, name or leave "legacy") · D4 caret rows (`^`/`^^`, separate real articles not dupes, ~16 immaterial) · D5 13 client→SF name calls · D6 20 ex-client tabs not in Hub (add active / skip 2021-23) · **D7 pick ONE month definition** (proposal: editorial month for editor workload/capacity, OM month for client delivery, never blend) · D8 approve writer names (78 auto + 122 legacy first-names + Dan cluster).

## 6. Open threads (DaniQ-pending / unresolved)
- **Meta family (~118-131, no tab)** — the lone real reconciliation gap; decision: log going forward or accept.
- **The 1,471 "/" collaboration editor cells** — the only remaining mapping gap; STRICT dropdown flags them red until split. (A partial rule already shipped: SE+Editor 2-person cell credits only the Editor, 230 cells, capacity-immaterial — no decision needed for that subset.)
- Honey/Honeybook + Tempo XYZ/Tempo — SOW lists separate; confirmed separate 2026-06-12; don't alias unilaterally.
- Dan writer cluster (~37 rows: Daniela Quiroga / Rial / Danielle MacKinlay) — one month-split applied.
- 122 legacy first-name-only writers (4,306 rows, 2022-24) — kept as first names.
- ~60-471 unparseable SUBMITTED dates (NULL-month, invisible) — fix at source. REVISED column = comma-list in one cell.
- 20 ex-client tabs (D6) await add/skip; FRC-in-SF question open. The 🔬 SAMPLE AUDIT awaits a 15-min joint sign-off.

## 7. Reconciling the "different numbers" (so they don't read as conflicts)
- Editor counts 29 / 32 / 42-43 = different denominators (distinct canonical confirmed in Rippling / confirmed raw log names / total raw names). Consistent, not conflicting.
- 92.2% (raw total-logged) vs ~98% (per-client excluding Meta) — both correct, different cuts.

## 8. Code / report locations
Code: `etl/sheet_standardize.py`, `etl/build_mappings.py`, `etl/reports.py`, `etl/transform.py`, `etl/mappings/*.json` (incl. `daniq_writer_confirmations.json` = 72, drives WRITER STANDARD).
Reports (`etl/reports/`): `MAPPING_VALIDATION_REPORT.md`, `SUMMARY_for_DaniQ.md`, `mappings_{clients,editors,writers}.csv`, `unmapped_client_tabs.csv`, `month_basis_by_client.csv`, `caret_rows.csv`, `pod_member_drift.csv`, `REPORT_FACTS.json`.
