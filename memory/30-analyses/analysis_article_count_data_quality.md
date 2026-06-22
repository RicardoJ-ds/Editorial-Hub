---
name: analysis-article-count-data-quality
description: Why Monthly Article Count counts < Operating Model — month-definition mismatch (the big one) + real ingestion losses + source gaps. Investigation 2026-06-09.
metadata: 
  node_type: memory
  type: project
  originSessionId: 16aec1b2-de33-466e-9e21-3d91480b6a82
---

# Monthly Article Count vs Operating Model — the gap, explained

Trigger: capacity util showed Pod 1 May = 45 articles vs Operating Model's 98.
May totals: OpModel **364** vs article-log **130** distinct. Investigated thoroughly.

## #1 root cause — MONTH DEFINITION (most of the gap; NOT missing data)
- Article log buckets by the article's **submitted date + editorial week** (editorial month week 1 starts ~the 6th → `editorial_weeks`). So an article submitted May 4–5 lands in **editorial-April** (April week 5 = Apr 29–May 5).
- Operating Model **and** Goals-vs-Delivery bucket by **delivered-to-client date / ~calendar month**.
- Proof (Miter): editorial-May **11** → calendar-May **25** ≈ OpModel **28**; **Goals vs Delivery = 28 exactly** (weeks May 6→Jun 2). `article_records` had **73/73 rows ingested, 0 NULL, 0 lost**. Nothing missing — just attributed to a different month.
- Pod 2 on calendar basis: editorial-May 28 → **61** (vs OpModel 81).
- ⇒ Compare MAC and OpModel on the **same month basis** or they never tie. (Three date semantics in play: calendar · Hub editorial week · delivered-to-client.)

## #2 real ingestion losses (code-fixable, ~600 articles) — NOT yet fixed
- **Date-parse failures → NULL month → invisible: 471 articles.** Tabs with `"M/D"` / `"Mon D"` formats + empty COPY (Vimeo 186, Webflow 118, Gopuff 27…). `_article_parse_full` doesn't handle them.
- **Header not recognized → whole tab skipped:** Felt = 96 rows dropped (`_article_build_header_map` returns empty for its layout). Tabs have heterogeneous headers (leading blank col, different labels).
- **Client name mismatch → unmapped:** tab `"Men's Warehouse"` ≠ client `"Men's Wearhouse"`.
- **Jumbo `^` marker:** 91 caret rows all-time (Webflow 36, CoinTracker 30, rest single digits); inconsistent (`^`/`^^`/`^^^`, "grouped with above"). Reliable content-type signal is the **`[jumbo]` / `(LP)` tag in title/copy**, not `^`. Minor impact.

## #3 source gaps (team must fix — code cannot)
- **Meta AI / Meta BMG**: no tab in the sheet at all (OpModel marks 18/15 as `actual`, `is_actual=true` — but nothing corroborates it). Meta = Pod 5 (irrelevant to Pod 1).
- **College HUNKS**: sheet has only 37 rows all-time (all ingested), OpModel says ~29/month → genuinely un-logged rows. **Eventbrite** stale (stops Feb).
- Ricardo confirmed: all delivered articles ARE expected in the sheet → these are data-entry gaps.

## Unit check (ruled out)
OpModel `articles_actual` == Deliverables-sheet `articles_delivered` (29 for College HUNKS/Leapsome/Miter/Boulevard), CBs=0. So OpModel "actual" IS article count — not a unit/CB difference.

## Implication for capacity util
The model ([[analysis_capacity_utilization]]) sidesteps the absolute under-count by using
articles only as a **distribution key** scaled to the pod's authoritative actual. But the
**month-basis** of the distribution still matters and is unresolved. See [[now]].
Related: [[monthly-article-count-feature]], [[decision_2026-06-09_capacity_util_model]].
