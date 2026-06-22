---
name: monthly-article-count-feature
description: "Ingesting the Monthly Article Count sheet into the Hub + Team KPIs \"Monthly Articles\" tab; per-month pod attribution + standard/specialized category implemented 2026-06-06"
metadata: 
  node_type: memory
  type: project
  originSessionId: 24f01467-2b2d-4ecf-a5d0-16355a39c197
---

Started 2026-06-02. Bringing the Editorial team's **"[Internal] Monthly Article
Count/Revenue Sheet"** (`1FWykZmeG2jznUYn-ng6glN4wjvc1Swb6hHmSHzGZ7dU`, ~94
client tabs, ~13,278 articles, ~105 editors) into the Hub as a first-class
idempotent ingestion, surfaced as a new **Monthly Articles** tab under Team KPIs
(timeline chart Per Pod/Client/Editor + configurable Power-BI-style matrix).
Foundation for the next round: **Revision Rate** + **Capacity Utilization** per
editor (same `article_records` table; `date_revised` reserved for it).

Approved plan: `~/.claude/plans/zesty-chasing-pizza.md`. ETL ported from the
standalone project `~/python/editorial/editorial_dashboard/{extract,aggregate}.py`
(tab skip-list, YYMMDD date parsing, slash-pair editor split, chunked batchGet +
retry — the retry/chunking is the fix for the historical preview/import API
errors on this many-tab sheet).

**Decisions:** name mapping = auto fuzzy-match (`_resolve_client`) + admin
"Unmapped names" review that self-heals next sync; pod is the **client's**
current/last Editorial pod denormalized onto each article (Editorial/Growth
assignment is per-client, not per-editor — so client name → pod; editor needs no
roster join).

**Revision + Published phase (shipped on branch 2026-06-03):** parses the
`REVISED` comma-lists into dated events (`article_revisions` child table, bucketed
by the revision's OWN editorial month; year inferred from submitted date incl.
Dec→Jan wrap). Metric selector on the tab: Articles · Revision rate % (by creation
month, pooled rates via num/den) · Revisions (by revision month). Published =
Notion `notion_articles` matched by TASK ID (`ID-NNNN`→`case_id`) then
unique-title fallback — only ~40% coverage (most sheet TASK IDs are ClickUp
`#hashes`), shown as a reference count by submitted month (NO Notion date trusted —
all KPIs pivot on the article's submitted date, user's explicit call). Next round:
**Capacity Utilization per editor**.

**✅ RESOLVED 2026-06-06 — per-month pod attribution (branch `feature/monthly-article-count`):**
articles now attribute to the **as-of-month** editorial pod, not the client's
current pod. Source = `client_pod_history` (the per-(client,month) pod dimension).
Design (Ricardo's calls): facts stay in `production_history`; the dimension
(`client_pod_history`) gained a **`category`** column (standard/specialized, read
from ET CP client-block col `pod_col+2`) — drives the sheet's specialized ×1.4
used-capacity weighting. **No fallback**: `import_monthly_article_count` builds
`pod_by_cm[(client_id,year,month)]`; absent → `editorial_pod=None` → "Unassigned"
(growth_pod untouched — editorial-only rule). The gap is surfaced, not hidden, via
a new **Data Quality → "Pod coverage"** tab (`/api/admin/discrepancies` →
`unassigned_article_pods`, hint `missing_month` vs `never_in_et_cp`).

**Root-cause bug found+fixed (same class as the capacity-block one below):**
`import_et_cp_pod_history` picked the month's Pod column **positionally** via a
13-month (Dec→Dec) assumption, but the client block is 12 cols (Jan→Dec) — so it
read the **next** month's pod (May→June), mis-assigning any client that changed
pods between adjacent months (e.g. Pylon May: stored Pod 3, true Pod 1). Fixed to
derive the column from the month-header row (mirrors `_ingest_et_cp_year`); deleted
the dead `_et_cp_sheet_months`. **Verified**: after re-sync, per-pod May raw+×1.4
join (`production_history × client_pod_history`) reproduces the sheet's Used
Capacity exactly — Pod1 105/104, Pod2 98/98, Pod3 105/103, Pod5 99/104; Pylon May
articles now → Pod 1. `client_pod_history` covers Apr 2025–Jun 2026 (ET CP tab
span); pre-2025 history + the **Dec 2025 gap** (no Dec-2025 version tab) land in
Unassigned as expected.

**Status (2026-06-02):** fully built + verified on branch
`feature/monthly-article-count`, 4 commits (backend ingestion+API · Team KPIs
Monthly Articles tab · SYNC/Import-Wizard/Data-Quality review · docs). Validated:
13,278 articles ingested (exact match to prior ETL), endpoints curl-tested,
tab + matrix + alias round-trip verified in a real browser (minted a dev
`eh_session` JWT). NOT yet merged to main; version bump (0.3.20→0.3.21) +
CHANGELOG + tag + push are the pending merge-to-main release step (needs OK).

**Workflow:** built on feature branch `feature/monthly-article-count`, iterating
there; merge to `main` only when the whole feature is implemented. The
normalization findings (unmapped clients + editor-name variants/typos) and the
alias-mapping decisions are surfaced as a review tab under **`/admin/data-quality`**
(not a standalone page) — user's explicit choice, 2026-06-02.

**Capacity-per-editor ingestion (shipped on branch 2026-06-04):** new
`editorial_member_capacity` table (per year/month/pod/slot: role+member+capacity,
member_breakdown JSONB for combined cells) + `production_history.projected_original`
(ET CP client-block Projected, all months). Parsed by `_ingest_et_cp_year()`
(month↔column derived from header row — fixed a latent off-by-one where the old
hardcoded offset started at Dec 2025 but the V13 capacity block starts at Jan).
Merged into existing ET CP imports: import_capacity_plan = latest version/current
year; import_et_cp_pod_history = each past year's latest version (2025 from V8 Nov
2025). Storage only — %-utilization-per-editor metric is the NEXT task (will
combine this with the monthly article counts per editor/pod/client).

Related: [[editorial-hub-project]], [[plan-pod-history-and-dq-selfheal]].
