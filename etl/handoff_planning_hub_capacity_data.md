# Handoff → Planning-Hub: consuming Editorial Hub data from BigQuery

**For the capacity-planning app.** Goal: consume the Editorial Hub's real, live data —
clients (with Salesforce identity), growth + editorial pods, members (canonical + raw name
maps), capacity numbers, and revisions — to build the capacity model for DaniQ & the Editorial
Team.

- **Project:** `graphite-data`
- **Dataset:** `graphite_bi_sandbox`  (everything below is `graphite-data.graphite_bi_sandbox.<name>`)
- **Access:** any principal with `BigQuery Job User` on `graphite-data` + read on the dataset. The Hub's app SA is `graphite-bi-sa@graphite-data.iam.gserviceaccount.com`.
- **Freshness:** the whole warehouse is republished in one ~20s pass on every Editorial Hub SYNC (button + daily cron ~09:00 UTC). **Querying BQ always returns the latest published numbers.** Every row carries a `synced_at` = the publish timestamp.

> **Golden rule:** for anything that already has business math applied (utilization, weighting,
> variance), **read the `v_editorial_*` views** — they're the clean public surface. The
> `editorial_raw_*` tables are faithful mirrors of the source sheets; the `editorial_int_*`
> tables are where the math is computed (read these when you want the *intermediate* capacity
> values — allocation %, distribution %, weighted rollups — which is exactly what a capacity
> model wants). Views are mostly thin pass-throughs of the int tables.

---

## 0. Read this first — join keys & conventions

- **Client key = `editorial_raw_clients.id`** (range ~1–84). Everything client-scoped joins on
  `client_id = editorial_raw_clients.id`. ⚠️ Do **not** use `editorial_clients` (renumbered
  463+, stale copy).
- **Pod values are strings like `"Pod 1"` … `"Pod 7"`** (not integers). Growth uses the same
  format. There is a sentinel for "unassigned growth" — Pod 99 was remapped to Pod 7 (0.3.47),
  so pods are 1–7.
- **Editorial pod is per-client-per-month** (a client can move pods over time — use
  `editorial_raw_client_pod_history` / `editorial_int_pod_assignments`). **Growth pod is a
  single current value** on the client dim.
- **Names normalize through `editorial_name_map`** (raw → canonical). For **editors** the
  canonical is stored directly in `editor_name` (⚠️ `editor_canonical` is **always NULL** — don't
  use it). **Writers** carry both `writer_name` (canonical) and `writer_canonical`.
- **`editorial_raw_articles` grain = one row per (article, editor)** — collaboration articles
  ("/" in the editor cell) explode into one row per editor. Use `COUNT(DISTINCT article_uid)`
  for article counts, `COUNT(*)` for editor credits.
- **Rates are pooled** (`Σ num ÷ Σ den`), never `AVG(rate)`.

---

## 1. Clients + Salesforce identity

**Use `v_editorial_dim_client`** (one row per client). Full client master with pods + SF identity.

Key columns: `client_id`, `client_name`, `status`, **`editorial_pod`**, **`growth_pod`**,
`start_date`, `end_date`, `term_months`, `cadence`, `cadence_q1..q4`, `articles_sow`,
`articles_delivered`, `articles_invoiced`, `word_count_min/max`, `project_type`, the 6 milestone
dates (`consulting_ko_date`, `editorial_ko_date`, `first_cb_approved_date`,
`first_article_delivered_date`, `first_feedback_date`, `first_article_published_date`),
`managing_director`, `account_director`, `account_manager`, and the **Salesforce link**:
**`sf_client_name`**, **`sf_account_id`**, **`sf_match_status`** (confirmed / ambiguous / unresolved).

- The raw table `editorial_raw_clients` has a few extra ops columns (`domain`, `articles_paid`,
  `sow_link`, `jr_am`, `cs_team`, `comments`) if needed.
- `sf_account_id` is your bridge to the **full Salesforce universe** in the main analytics
  warehouse `graphite-data.graphite_bi` (accounts, opportunities, revenue) — join
  `sf_account_id` → SF account id there. Only clients with `sf_match_status='confirmed'` are safe
  to join 1:1.

```sql
SELECT client_id, client_name, status, editorial_pod, growth_pod,
       start_date, end_date, term_months, articles_sow,
       sf_client_name, sf_account_id, sf_match_status
FROM `graphite-data.graphite_bi_sandbox.v_editorial_dim_client`
ORDER BY client_name;
```

---

## 2. Pods — growth + editorial (current + history)

| Need | Read | Grain |
|---|---|---|
| **Current** growth + editorial pod per client | `v_editorial_dim_client.growth_pod / editorial_pod` | client |
| **Editorial** pod per client **per month** (authoritative) | `editorial_raw_client_pod_history` | (client, year, month) — has `editorial_pod` + `category` (standard/specialized) |
| **Who staffed which pod** per month (people ↔ pod ↔ client) | `editorial_int_pod_assignments` | (year, month, pod_kind, pod, client, role, person) — both `editorial` and `growth` in `pod_kind`; `person` is canonical, `email`, `confidence` |
| Editorial-only staffing (RBAC feed) | `v_editorial_fct_pod_assignments` | same, filtered `pod_kind='editorial'` |
| Raw monthly roster from the Team Pods sheet | `editorial_raw_pod_history` | (year, month, pod_kind, pod_number, client, role, person) |

- **`category`** on `editorial_raw_client_pod_history` matters for capacity: *specialized* work is
  weighted **×1.4** in the pod-reference math (see §4).
- For growth-pod history use `editorial_int_pod_assignments WHERE pod_kind='growth'` (the `fct`
  view is editorial-only).

```sql
-- Editorial pod per client per month (drives per-month capacity attribution)
SELECT client_id, client_name_raw, year, month, editorial_pod, category
FROM `graphite-data.graphite_bi_sandbox.editorial_raw_client_pod_history`
ORDER BY client_name_raw, year, month;
```

---

## 3. Members — canonical + raw name maps

The roster + name canon are the single source of truth for "who is an editor/writer and what's
their real name."

| Read | What it is |
|---|---|
| **`v_editorial_roster`** | The canonical roster. One row per (`canonical_name`, `role`) where role ∈ `editor` / `sr_editor` / `writer`. Columns: `source` (rippling/slack/legacy), `source_id`, `slack_id`, `status`, `hire_date`, `term_date`, `is_active`. Rippling editors + Slack writers + legacy, **minus** the exclusions tab. |
| **`editorial_name_map`** | Raw → canonical mapping. Columns: `kind` (`editor`/`writer`/`client`), `raw_value`, `canonical_value`, `valid_from`, `valid_to` (**`YYYY-MM` windows** — one raw name can map to different people over time; NULL = open), `status`, `source`. |
| `editorial_roster_exclusions` | Role-aware "not an editor/writer" list subtracted by the roster view. |
| `editorial_raw_name_mappings` | Flattened union of the map (kind, raw_name, canonical_name, status, note) — convenience mirror. |
| `v_editorial_dim_member` | Legacy seeded roster (12 rows: name, role, pod, monthly_capacity, email) — **prefer `v_editorial_roster`** for the live picture. |

- **Windowed aliases** (`valid_from`/`valid_to`) are important: e.g. "Sam" → Samantha McGrail
  through 2026-01, → Samantha Marceau from 2026-02. Undated rows are the fallback.
- Unmapped first-name fragments stay raw and are **not** in the roster — they're a data-quality
  item, fixed at the source (DaniQ's Editorial Name Mappings sheet → BQ), not in code.

```sql
SELECT canonical_name, role, source, status, is_active, hire_date, term_date
FROM `graphite-data.graphite_bi_sandbox.v_editorial_roster`
ORDER BY role, is_active DESC, canonical_name;
```

---

## 4. Capacity — the core of your model

This is where the Editorial Hub already does the heavy lifting. **Read the `editorial_int_*`
tables** — they expose every intermediate value, which is exactly what you'll want to rebuild or
extend a capacity model.

### 4a. Pod-level capacity — `editorial_int_capacity_pod_months` (view: `v_editorial_fct_capacity_pods`)
Grain: (year, month, pod). Columns: `total_capacity`, `projected_used_capacity`,
`actual_used_capacity`, `version` (the ET CP version, e.g. "V13 May 2026").

### 4b. Per-member utilization — `editorial_int_member_months` (view: `v_editorial_fct_member_utilization`)
Grain: (year, month, pod, role, member). This is the richest table for a capacity model — it
carries the raw inputs **and** the derived rollups:
- Member: `member`, `member_canonical`, `member_match_status`, `capacity`, `articles`, `matched`
- Keys: `pct_allocation` (share of pod capacity), `pct_distribution` (share of pod articles)
- Derived: `projected_used`, `actual_used`, `pct_util_real`, `pct_util_weighted`
- Pod rollups on every row: `pod_total_capacity`, `pod_total_articles`, `pod_projected_raw`,
  `pod_actual_raw`, `pod_projected_weighted`, `pod_actual_weighted`,
  `pod_util_projected_weighted`, `pod_util_actual_weighted`

### 4c. Per-client contribution to a pod — `editorial_int_client_pod_months` (view: `v_editorial_fct_client_contributions`)
Grain: (year, month, pod, client). Columns: `client_id`, `client_name`, `sf_client_name`,
`category`, **`weight`** (×1.0 standard / ×1.4 specialized), `projected_raw`, `actual_raw`,
`projected_weighted`, `actual_weighted`.

### 4d. Raw per-slot member capacity — `editorial_raw_capacity_members`
Grain: (year, month, pod, slot). The un-processed ET CP block: `role`, `member_raw`,
**`member_breakdown`** (JSON array of `{name, capacity}` — splits combined cells like
"Lauren K (28) + Anabelle (15)"), `capacity`, `source_version`.

### The capacity formulas (already applied in the int layer)
```
% Real     = actual_used ÷ capacity
% Weighted = actual_used ÷ projected_used
Spare      = pod_total_capacity − Σ projected_used
member projected_used = (capacity ÷ pod_capacity) × pod_projected_raw   -- allocation key
member actual_used    = (articles ÷ pod_articles) × pod_actual_raw      -- distribution key
```
- Articles are a **distribution key only** — the magnitude comes from the pod's Operating-Model
  actual, not a raw article count.
- **Specialized-category** client work is weighted **×1.4** at the pod reference level.
- Engine: `backend/app/services/capacity_calc.py` (shared verbatim by the ETL) — read it if you
  want to reproduce or diverge from the model.

```sql
-- Pod utilization by month
SELECT year, month, pod, total_capacity, projected_used_capacity, actual_used_capacity,
       ROUND(actual_used_capacity/NULLIF(total_capacity,0)*100,1)          pct_util_real,
       ROUND(actual_used_capacity/NULLIF(projected_used_capacity,0)*100,1) pct_util_weighted,
       total_capacity - projected_used_capacity                            spare
FROM `graphite-data.graphite_bi_sandbox.v_editorial_fct_capacity_pods`
ORDER BY year, month, pod;

-- Per-member utilization for a month (full intermediate values)
SELECT pod, role, member_canonical, capacity, articles,
       pct_allocation, pct_distribution, projected_used, actual_used,
       pct_util_real, pct_util_weighted
FROM `graphite-data.graphite_bi_sandbox.v_editorial_fct_member_utilization`
WHERE year=2026 AND month=5 ORDER BY pod, member_canonical;
```

---

## 5. Revisions

Two grains — mind which one you need:

| Read | Grain | Use |
|---|---|---|
| **`v_editorial_fct_articles_monthly`** (int: `editorial_int_articles_creation`) | (month_year, editorial_pod, growth_pod, client, editor) by **creation** month | article counts + **revision rate** + 2nd-review %. Columns: `count`, `revised` (articles with ≥1 revision), `second_reviews`, `published`, `published_revised`, `matched` |
| **`v_editorial_fct_article_revisions`** (int: `editorial_int_articles_revisions`) | same dims but by each **revision's own** month | count of **revision events** (`revisions`) |
| `editorial_raw_articles` | one row per (article, editor) | un-aggregated; has `revision_count`, `revision_dates` (JSON), `second_review`, `is_published`, `word_count`, `submitted_date`, `editorial_pod`/`growth_pod` |
| `editorial_raw_article_revisions` | one row per revision event | `revision_date`, `month_year`, editor, client, pods |

```
revision rate %  = Σ revised        ÷ Σ count   (by CREATION month)   -- pooled
2nd review %      = Σ second_reviews ÷ Σ count   (by CREATION month)   -- pooled
revisions        = Σ revisions                  (by each revision's OWN month)
```
- `pod` grouping follows the axis you pick: each row carries **both** `editorial_pod` and
  `growth_pod` (denormalized from the client's current pods).
- Published status comes from the Notion Content Machine (matched by task id / title, ~40%
  coverage) — treat `published`/`matched` as a reference, not a hard total.

```sql
-- Revision rate % + 2nd-review % pooled, by pod & creation month
SELECT month_year, editorial_pod,
       SUM(count) articles, SUM(revised) revised,
       ROUND(SUM(revised)/NULLIF(SUM(count),0)*100,1)         revision_rate_pct,
       ROUND(SUM(second_reviews)/NULLIF(SUM(count),0)*100,1)  second_review_pct
FROM `graphite-data.graphite_bi_sandbox.v_editorial_fct_articles_monthly`
GROUP BY month_year, editorial_pod ORDER BY month_year, editorial_pod;
```

---

## 6. Gotchas (the things that bite)

1. **Client id space** — join on `editorial_raw_clients.id`, never `editorial_clients` (stale 463+).
2. **`editor_canonical` is always NULL** — editor canonical lives in `editor_name`; only writers use `writer_canonical`.
3. **`editorial_raw_articles` grain is article×editor** — `COUNT(DISTINCT article_uid)` for articles, `COUNT(*)` for editor credits. ~4k rows have NULL `client_id` (unresolved tab → no pod).
4. **Pods are strings `"Pod N"` (1–7)**; editorial pod is per-month, growth pod is current-only.
5. **Rates are pooled, not averaged.**
6. **Revisions bucket two ways** — rate by creation month, events by their own month (different views).
7. **Specialized category ⇒ ×1.4** in the capacity reference math.
8. **Name windows** (`valid_from`/`valid_to`) in `editorial_name_map` — a raw name can map to different people over time.
9. **Freshness** — always the latest published rows; no snapshot to pin unless you filter/store `synced_at` yourself.

---

## 7. Companion references (in the Editorial Hub repo)
- `etl/platform_handoff_editorial_hub.md` — the general "reproduce any Hub number from BQ" guide (full catalog + recipes + all formulas).
- `etl/WAREHOUSE_DESIGN.md` — warehouse design + bug register.
- `BUSINESS_RULES.md` — content-type weighting matrix + worked examples.
- `backend/app/services/capacity_calc.py` — the exact capacity engine (shared by app + ETL).
- Salesforce beyond editorial clients: `graphite-data.graphite_bi` (main analytics warehouse) — join via `sf_account_id`.

*Generated 2026-07-01 from the Editorial Hub warehouse build source (`etl/warehouse/build.py`,
`views.py`, `v_editorial_roster.sql`, `build_mappings.py`). Columns are exact to the code that
publishes the dataset.*
