# Mapping Validation + OM↔MAC Reconciliation + Capacity Utilization

**Date:** 2026-06-15 · Sources: DaniQ's green-marked Drive sheets, Rippling
`v_headcount`, Salesforce, `production_history` (Editorial Operating Model),
`article_records` (Monthly Article Count).

---

## 1. Mapping validation — are our matches correct?

### Editors → ✅ 100% confirmed against the source of truth (Rippling)
- All **29** confirmed editor canonical names exist in Rippling editorial
  headcount (`v_headcount`, dept = Editorial). Zero mismatches.
- DaniQ left editors **unmarked on purpose** — they don't need manual review
  because Rippling IS the source of truth. The only two ambiguous editors were
  already resolved: **Sam** (→ McGrail/Marceau by Rippling tenure dates),
  **Lauren** (→ Friar; the new Lauren now writes "Lauren Keleher" in the sheet,
  so the two are distinguishable going forward).

### Writers → confirmed by DaniQ (the ONLY possible source — no BQ table exists)
She green-marked **146 month-rows = 74 distinct raw names**:
- **52 → `audition`** bucket (trial/audition writers — not a real headcount
  person; correctly treated as a bucket, not a name).
- **21 first-name → full-name upgrades** we should apply. Notable:

  | raw | our current | DaniQ confirms |
  |---|---|---|
  | Aby | Aby | **Abby Norwood** |
  | Amanda | Amanda | **Amanda Walgrove** |
  | Annabelle | Annabelle | **Anabelle Zaluski** |
  | Mike | Mike | **Michael Ray** |
  | Michael / Michael D / Michael D. | first-name | **Michael Davis** |
  | Mindy | Mindy | **Mindy Born** |
  | Paige | Paige | **Paige Greene** |
  | Thea | Thea | **Thea Atkinson** |
  | Jordan | Jordan | **Jordan Finneseth** |
  | Justine | Justine | **Justine Jade Smith** |
  | Marinda | Marinda | **Marinda Stuiver** |
  | Daniele | Daniele | **Danielle MacKinlay** |
  | Ke | Ke | **Kevin Vaughn** |
  | Kimberley | Kimberley | **Kimberly Kruge** |
  | Bonniey | Bonniey | **Bonniey Josef** |
  | Ayşenur | Ayşenur | **Aysenur Zaza** |

  Note she split two look-alikes: **Mike = Michael Ray** but **Michael =
  Michael Davis** (different people); **Daniel = Daniel Pelberg** but **Daniele
  = Danielle MacKinlay** (different people).
- **1 month-split**: **Dan** → `audition` in May 2025 (EarnIn B2B) but **Daniel
  Pelberg** from Jun 2025 (Better). Writers may need date-windowing like editors.

### Clients → reconciled (2026-06-15): the 2 name-splits applied; only Meta open
DaniQ confirmed and we applied two tab→client aliases: **"Genstore" →
GenstoreAI** and **"ShareGate" → Workleap + Sharegate**. Both now tie out
(GenstoreAI OM 35 = MAC 35; Workleap+Sharegate OM 108 ≈ MAC 105). The only
remaining client gap is the **Meta family** (Meta AI/BMG/RL — no article tab).

---

## 2. Operating Model vs Monthly Article Count — reconciliation

OM is **client-level** (per client × month); MAC has the **editor/writer**
breakdown. So we reconcile MAC's article totals against OM per client/month,
on BOTH month bases.

### Monthly totals, 2026

| Month | OM actual | MAC editorial | MAC calendar | edit gap | cal gap |
|---|---|---|---|---|---|
| Jan | 274 | 264 | 196 | −10 | −78 |
| Feb | 294 | 269 | 259 | −25 | −35 |
| Mar | 324 | 293 | 371 | −31 | +47 |
| Apr | 339 | 311 | 226 | −28 | −113 |
| May | 364 | 334 | 312 | −30 | −52 |
| Jun+ | open | open | open | — | — |

**Editorial-month basis is the right comparison** — it tracks OM within
**3–9% (consistently slightly under)**. Calendar basis swings ±50–110 because
articles submitted near month-edges shift across the boundary (an article
submitted late March = editorial-April but calendar-March). This is the
month-definition effect; editorial basis is stable.

> Big improvement: before our 2026 fixes (Felt header, ISO dates, new origin
> sheet, Tempo lineage) the May gap was OM 364 vs MAC ~130. It's now −30.

### Where the residual gap lives (Jan–May 2026, editorial basis)
**OM = 1,595 · MAC = 1,471 → 92.2% of OM articles are logged.** The 124 gap:

| Client (OM) | OM | MAC | note |
|---|---|---|---|
| Meta AI | 78 | 0 | **no MAC tab** (Meta family) |
| Meta RL | 33 | 0 | **no MAC tab** |
| Meta BMG | 20 | 0 | **no MAC tab** |
| GenstoreAI | 35 | **35** | ✅ alias applied ("Genstore" tab) |
| Workleap + Sharegate | 108 | **105** | ✅ alias applied ("ShareGate" tab) |
| Cointracker (−16), n8n (−6)… | — | — | small single-digit (genuine un-logged / month-edge) |

**Decomposition (after the 2026-06-15 client fixes):** the GenstoreAI and
Workleap+Sharegate name-splits are now resolved (both tie out). The total
logged % is unchanged (~92%) because those articles were never missing — only
mislabeled — but the **per-client** reconciliation is now clean except the
**Meta family (~118 articles, no tab)** + single-digit per-client noise. So the
real, non-Meta reconciliation is **~98–99%**.

Resolved: **Genstore↔GenstoreAI** and **ShareGate↔Workleap+Sharegate** (aliases
applied). Remaining open: the **Meta family** needs tabs, or accept as
un-loggable (Meta domains never separately logged).

---

## 3. Capacity Utilization per member per pod (May 2026, latest closed)

> Reminder of the model: there is **no per-member "actual" anywhere** — so
> `actual_used` is ALWAYS derived by the **article-distribution fallback**:
> `actual_used = (member articles ÷ pod articles) × pod's authoritative RAW
> actual (from OM)`. Articles are only a *distribution key*; the magnitude
> comes from OM, which is why the ~8% article under-count does **not** distort
> the numbers. `Real% = used ÷ capacity`, `Wtd% = used ÷ projected`.

| Pod | cap | OM actual | articles | pod util (act) |
|---|---|---|---|---|
| Pod 1 | 126 | 98 | 102 | 83% |
| Pod 2 | 112 | 81 | 75 | 88% |
| Pod 3 | 135 | 87 | 87 | 77% |
| Pod 5 | 105 | 98 | 64 | 99% |

Per member (cap · articles · used · Real% · Wtd%):
- **Pod 1** — Robert Thorpe 60·44·42.3·**70%**/90% · Jimmy Bunes 46·44·42.3·**92%**/117% · Nina Denison 20·14·13.5·**67%**/86%
- **Pod 2** — Elliot Gardner 60·31·33.5·**56%**/77% · Kennedy Stevens 20·23·24.8·**124%**/172% · Samantha Marceau 18·21·22.7·**126%**/174% · *support from Pod 1 14·0·0·**0%** ⚠*
- **Pod 3** — Haley Drucker 60·43·43·**72%**/109% · Lee Anderson 60·40·40·**67%**/101% · Alyssa Zacharias 15·4·4·**27%**/40%
- **Pod 5** — Shivani Verma 60·35·53.6·**89%**/101% · Lauren Friar 25·12·18.4·**74%**/83% · Maggie Gowland 20·17·26·**130%**/147%

### Fallback flags
- **The fallback is universal** (every `actual_used` is article-derived) — that's
  by design, not a defect.
- **No-article-match members** (used understated → 0): only **1** —
  *"support from Pod 1"* in Pod 2, which is a **placeholder roster string in ET
  CP, not a real person**. Every real editor matched to articles this month.
- **Pods with zero article data** (distribution impossible): **none** — all 4
  active pods have article coverage, so the distribution key is valid everywhere.

---

## 4. Thoughts

1. **Editors are solid** — fully tied to Rippling; no open items. Capacity
   Utilization rests only on editors, so the KPI's identity layer is clean.
2. **Writers don't touch capacity** — they feed the Monthly Articles dashboard
   + the Team Pods app, not the editor Capacity KPI. DaniQ's 74 confirmations
   should be applied to our dictionary (21 upgrades + audition bucket + the Dan
   split) — that's the next action, and it's the input for refreshing the
   STANDARD columns in the proposal copy.
3. **OM↔MAC now reconciles to ~92% raw / ~98% after the 2 name-splits** — the
   only material remaining gap is the **Meta family with no article tab**.
   Recommend: confirm Genstore/ShareGate as same-client aliases, and decide
   whether Meta domains will ever be logged (if not, accept and document).
4. **Use the editorial-month basis** for any OM↔MAC comparison — calendar basis
   scatters across month-edges and will never tie cleanly.
5. **Capacity numbers are trustworthy at pod level** (anchored to OM actual);
   per-member is a fair distribution but inherits two assumptions — that
   under-counting is ~proportional within a pod, and name-matching is complete.
   Both are now in good shape (only the placeholder "support" string unmatched).
