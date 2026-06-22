---
name: metrics-monthly-articles
description: "Monthly Articles metrics: Articles / Revision-rate% / Revisions — exact definitions + the creation-month vs revision-own-month bucketing, num·den pooling, Notion published reference, pod attribution, editor resolution (slash-split, SE+Editor rule, windowed aliases)."
metadata:
  node_type: memory
  type: reference
  originSessionId: 3fa962ac-9be0-4852-8c63-16ff918094cb
---

# Monthly Articles (Team KPIs → Capacity & Revisions → Revisions)

Source: Spreadsheet 5 Monthly Article Count (~100 client tabs, ~15K rows) → `article_records`
(+ `article_revisions` child). Importer `import_monthly_article_count` (`migration_service.py:6083`),
router `/api/articles/monthly` (`articles.py:79`). See also [[monthly-article-count-feature]],
[[analysis-article-count-data-quality]].

## 1. The three metrics — definitions + bucketing (the critical invariant)
| Metric | Definition | Bucketed by | Table |
|---|---|---|---|
| **Articles** | count of article-editor credit rows (`COUNT(DISTINCT article_uid)` for distinct articles) | article **creation** = editorial submitted month (`ArticleRecord.month_year`) | `article_records` |
| **Revision rate %** | (articles with ≥1 revision) ÷ (articles) × 100 | article **creation** month | `article_records` |
| **Revisions** | count of revision **events** (each dated token in REVISED) | each revision's **OWN** editorial month (`ArticleRevision.month_year`) | `article_revisions` |

**Why two buckets matter:** an article created in March with revisions in April → +1 **Articles** in March, counts in the **Revision-rate** num+den in **March**, but its revision **event** lands in **Revisions** for **April**. "Rework capacity lands when the rework happens" (`models.py:917-923`).

## 2. num·den pooling — pooled rates, never averaged
Revision rate is ALWAYS `Σrevised ÷ Σarticles`, never a mean of per-cell rates.
- FE carries an `{num, den}` accumulator through every level (pod/client/editor/Other/month); `addAcc` sums num & den separately; `finalize()` divides only at the end (`RevisionsTab.tsx:106-135`). For rate: `num=revised, den=count`; Articles: `num=count, den=0`; Revisions: `num=revisions, den=0`.
- Series top-N + "Other" weighting uses `den` for rate, `num` otherwise (`:480`).
- Backend ships `count` + `revised` as separate cols so the client pools them (`articles.py:117-118`). Subtotals are therefore **pooled rates**.

## 3. Published reference (Notion Content Machine) — `_apply_notion_published` `migration_service.py:6030`
- **Match priority:** (1) TASK ID only when `task_id` starts `ID-` and exactly equals a `NotionArticle.case_id`; (2) fallback = **unique** normalized-title match (ambiguous titles dropped). ~40% coverage (most sheet TASK IDs are ClickUp `#hashes`/blank).
- **`is_published`** = `published_url` present OR `cms_status` startswith `"Published"`.
- **Shown as a reference count, NOT a metric basis** — by **submitted (editorial) month**. **No Notion date is ever trusted**; every KPI pivots on the article's submitted date (Ricardo's call). `notion_matched` separates "not published" from "no match / unknown". Tooltip shows `published` + `published_revised`.

## 4. Pod attribution
- Pod **denormalized at import**: both `editorial_pod` + `growth_pod` on every row.
- **editorial_pod = as-of-month pod** from `ClientPodHistory` (per-article, by editorial month) — NOT the client's current pod. **No fallback** → no ET CP coverage / unresolved client → `editorial_pod=None` → "Unassigned" (DQ → Pod coverage). `:6200-6265`.
- **growth_pod = client's CURRENT growth pod** (ET CP is editorial-only, no per-month growth source).
- UI pod axis follows the global Editorial/Growth toggle (`useCurrentPodAxis`); router picks per `pod_axis` param (default `editorial`).

## 5. Editor resolution
- **Slash-pair explode** (`_split_editors` `:5859`): split on `/ & ,` + "and"; each editor → its own credit row. Blanks (`-`, `N/A`, `TBD`, `ENDED`, `PAUSED`…) dropped. `article_uid = sha256(source_tab|source_row)[:16]` shared across an article's rows.
- **SE+Editor collaboration rule** (`:5814,:6269`): a 2-person cell that is exactly one Senior Editor + one Editor (per ET CP roles that month) credits **only the Editor** (SE reviews, Editor edits). Two-editor / two-SE / unknown cells keep both. Roles from `_build_editor_role_map` (exact (year,month,person) → any-month → first-name fallback). Proven capacity-immaterial.
- **Windowed aliases** (`article_name_aliases`, kind editor/writer): optional `valid_from`/`valid_to` ('YYYY-MM' inclusive). `_alias_resolve` (`:6105`): a windowed row wins when the article's month is inside it; windowless = fallback; **undated articles only match windowless**. Ex: "Sam" → Samantha McGrail ≤2026-01, Samantha Marceau ≥2026-02.

## 6. Ingestion mechanics
- **Dynamic header-row detection** (`:5805`): scans first 5 rows for the EDITOR column (most tabs banner row 1 + headers row 2; Felt has headers on row 1). Old hardcoded "row 2" silently dropped Felt-style tabs.
- **Date parse** (`_article_parse_full`, priority): (1) copy-name **YYMMDD** suffix (most reliable); (2) ISO; (3) m/d/yyyy; (4) month-word; (5) Excel serial. Editorial-month via `editorial_weeks` (`_editorial_month_for`), calendar fallback before week coverage. `month_year` stores the **editorial** month.
- **REVISED parse** (`_parse_revisions` `:5985`): comma-split tokens; year inferred from submit date (`+1` on Dec→Jan wrap); each event re-mapped to its own editorial month + pod-as-of-revision-month.
- **Chunked batchGet** 25 tabs/call, `_article_retry` backoff. **Full rebuild per sync** (DELETE revisions + records, then bulk insert) — no reliable source row key.

## 7. Dated decisions
| Date | What |
|---|---|
| 2026-06-02 | Ingestion built (13,278 articles); normalization review = a DQ tab, not a standalone page |
| 2026-06-03 | Revision + Published phase: REVISED→`article_revisions` (own-month); Notion match; 3-metric selector; pooled num/den rate; published = submitted-month reference |
| 2026-06-06 | Per-month pod from `ClientPodHistory` + `category`; no-fallback "Unassigned"; fixed positional 13-month Pod-column bug (was reading next month's pod) |
| 2026-06-16 (0.3.26) | Metrics reorganized into Articles · Revision-rate · Revisions sub-tabs; SE+Editor collab credit rule; tab folded into Capacity & Revisions |

## 8. Open threads / caveats
- **Month-basis mismatch (the big one):** article log buckets by submitted date + editorial week (week 1 ~the 6th); OM/Goals bucket by delivered-to-client / ~calendar month → MAC and OM never tie unless on the same basis. Proven: Miter editorial-May 11 → calendar-May 25 ≈ OM 28; 73/73 ingested, 0 lost. See [[analysis-article-count-data-quality]].
- **~600 code-fixable ingestion losses (NOT yet fixed):** 471 NULL-month from date-parse failures (Vimeo 186, Webflow 118, Gopuff 27); Felt 96 (mostly fixed by dynamic header); name mismatches (`Men's Warehouse`≠`Men's Wearhouse`).
- **Meta family ~118 no-tab gap** (Meta AI/BMG/RL) — source gap, not code-fixable.
- **The "/" collab cells (~1,471)** — depend on correct ET CP roles; remaining mapping gap. See [[analysis-normalization-proposal]].
- **Per-month historical pod:** ClientPodHistory only Apr 2025–Jun 2026; pre-2025 + Dec-2025 gap → Unassigned by design.
- Jumbo `^` caret marker is unreliable; the `[jumbo]`/`(LP)` title tag is authoritative.
- Warehouse serving: `editorial_int_articles_creation` + `_articles_revisions` → [[metrics-warehouse-int-layer]].
