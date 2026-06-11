# Editorial Warehouse — layered schema design (raw → int → views)

_Branch `feature/etl-warehouse-refactor` · 2026-06-10 · **Status: BUILT + FULL
PARITY PROVEN** (see `PARITY_REPORT_WAREHOUSE.md` — 3,444 client×field
comparisons against the real frontend functions, all identical; all API replays
identical). Build: `python -m etl.warehouse.run` · Parity:
`npx tsx frontend/scripts/parity-dump.ts && python -m etl.warehouse.parity`_

## Goal

Replace the phase-1 "36 mirrored tables" with a **layered warehouse** matching the
house BigQuery conventions, where the **final views already contain every number
the dashboards display** — all transformations (weighting, variance, utilization,
month bucketing) applied in the pipeline, nothing left to compute at dashboard
level. Validated by a parity harness that compares the warehouse output against
the live app (API replays + the actual frontend functions run on the same data).

**Prime directive: replicate CODE behavior exactly — bug-for-bug.** The audit
found ~12 places where code differs from docs or from itself (register at the
bottom). The warehouse reproduces what users SEE today; fixes are a separate,
explicit decision afterwards (each is logged).

## House conventions (audited from graphite_bi / graphite_bi_sandbox)

- Stay in **`graphite_bi_sandbox`**, namespaced `editorial_*` (the sandbox
  pattern: ashby_, forecast_, montecarlo_ coexist there).
- `<project>_raw_<topic>` = physical landing tables · `<project>_int_<entity>` =
  materialized transform tables · consumption is **always views**, newest house
  style `v_<project>_dim_*` / `v_<project>_fct_*` (matches `v_dim_account`,
  `v_fct_opportunity`).
- snake_case columns, `synced_at` load stamp (house precedent for sheet-synced
  data), no partitioning at these sizes (largest table 15k rows).

## Architecture

```
Google Sheets ──(the proven importers, UNCHANGED — sync_manifest scopes intact)──▶ Postgres
Postgres ──(etl/warehouse: raw → int → views)──▶ BigQuery graphite_bi_sandbox
```

Ingestion stays byte-identical to the SYNC button (same strangler approach as
phase 1). The warehouse package replaces the flat mirror with three layers:

### RAW — 17 topic tables (was 27 mirrors)

Source-shaped, one per source grain, canonical-name columns added where they
exist (originals untouched). Dropped from the warehouse (app-state, not
analytics): access/RBAC, comments, usage analytics, audit log, sync history,
alias/unmapped/incomplete/pod-issue review tables, notion_articles (its
dashboard-relevant outputs — is_published/notion_matched and the computed KPIs —
are already denormalized into articles/kpi_scores), and two wizard-only seeds
(model_assumptions, engagement_rules — feed only DEAD or unmounted surfaces per
the audit). delivery_templates WAS initially dropped on the same reasoning but
came back at the repoint: the live `/api/dashboard/pacing` endpoint reads it.

| Table | Source | Grain |
|---|---|---|
| editorial_raw_clients | clients (+SF canonical cols) | client |
| editorial_raw_deliverables | deliverables_monthly | client × month |
| editorial_raw_production | production_history | client × month |
| editorial_raw_goals | goals_vs_delivery | month × week × client × content_type |
| editorial_raw_cumulative | cumulative_metrics | client (all-time) |
| editorial_raw_capacity | capacity_projections (ALL versions) | pod × month × version |
| editorial_raw_capacity_members | editorial_member_capacity | pod × month × slot |
| editorial_raw_client_pod_history | client_pod_history | client × month |
| editorial_raw_articles | article_records (+canonical editor/writer) | article × editor |
| editorial_raw_article_revisions | article_revisions | article × editor × revision |
| editorial_raw_calendar | editorial_weeks | year × month × week |
| editorial_raw_kpi_scores | kpi_scores | member × month × kpi × (client?) |
| editorial_raw_ai_monitoring | ai_monitoring_records | record |
| editorial_raw_surfer_usage | surfer_api_usage | year_month |
| editorial_raw_team_members | team_members | member |
| editorial_raw_delivery_templates | delivery_templates (Pacing badge) | template × month_index |
| editorial_raw_name_mappings | the 3 mapping dicts, `kind` column | raw_name × kind |

### INT — 8 materialized transform tables (the brains)

All business rules are applied HERE, so every downstream number is a plain
SUM/GROUP BY away. Each table carries `synced_at` + (where time-dependent)
`as_of_date` — the calendar anchor the frontend gets from the browser clock.

1. **editorial_int_client_months** — client × calendar month. Merges
   deliverables (delivered, invoiced, sow_target) + production (actual,
   projected, projected_original, is_actual). Computes `is_future`
   (month > last completed calendar month, audit §Overview-1) and assigns
   **billing periods under BOTH detectors** (the Overview `detectSummaryBillingPeriods`
   and the D1 `detectBillingPeriods` with post-contract truncation — audit
   flagged they diverge for finished clients; both are preserved):
   `ovr_period_idx/label/is_prelude` + `d1_period_idx/label/is_prelude/is_post_contract`.
   Period rule: a month with invoiced > 0 OPENS a period; invoiced == 0 months
   join it; months before first invoicing = prelude. Labels Q1..Qn per contract
   year (`yearIdx = floor((monthsSinceStart−1)/12)`, " Y{n}" suffix for year 2+).

2. **editorial_int_client_q_snapshot** — one row per client per `as_of_date`,
   the variance brain (ports `computeCurrentQ` / `computeLastFullQ` /
   `quarterMetaFromPeriods` + `varianceTier`):
   - currentQ: label, month_in_q, q_length, actual_cum_delivered (non-future),
     projected_remaining (future months in current Q only), projected_end,
     end_of_q_cum_invoiced, **projected_variance = projected_end − cum_invoiced**
     (cumulative from contract start — catch-up nets), is_first_q.
   - lastFullQ: label, q_delivered, q_invoiced, cum_delivered, cum_invoiced,
     cum_variance, is_first_q.
   - D1 twin (quarterMetaFromPeriods over the truncated periods): d1_* columns.
   - `tier` = varianceTier(round(projected_variance), is_first_q):
     new | on_track (v=0) | within_limit (1≤|v|≤5) | ahead (v>5) | behind (v<−5).
   - lifetime: delivered/invoiced (non-future Σ), sow (lifetimeSow = Σ
     sow_target, fallback clients.articles_sow), pct_sow, published_live (joined
     from cumulative by client_name), pct_published.

3. **editorial_int_goals_month_ct** — client × month × content_type:
   `cb_goal/ad_goal/cb_delivered/ad_delivered` = **MAX over weekly rows**
   (cumulative-within-month), `ratio` = contentTypeRatio (article×1, jumbo×2,
   LP×0.5; **NO glossary branch — replicating code, see bug register B1**;
   unknown → parse ratios "a:b" → a/b → 1), and the weighted versions
   (`w_* = value × ratio`). Weekly `delivered_today` detail stays in raw_goals
   (the GoalsMonthTable week expansion reads weekly deltas).

4. **editorial_int_capacity_pod_months** — pod × month, latest-V## collapse
   (rank by integer after 'V'; alphabetical is wrong).

5. **editorial_int_member_months** — member × pod × month utilization via the
   SHARED `app/services/capacity_calc.py` (alloc/distribution fallback model,
   SPEC ×1.4 pod-reference weighting, ≥3-char nickname matching) + canonical
   member names.

6. **editorial_int_client_pod_months** — pod × client × month contributions
   (projected_original/actual raw + ×1.4 weighted).

7. **editorial_int_articles_creation** — editorial month × editorial_pod ×
   growth_pod × client × editor: count (editor-credits), revised, published,
   published_revised, matched. (Creation-month basis.)

8. **editorial_int_articles_revisions** — same dims, revision-own-month basis:
   revisions count.

(kpi_scores needs no int table — the raw grain IS final; the sync-time
recompute rules, incl. their all-time quirks, are upstream and unchanged.)

### VIEWS — the dashboard contract (19, all `v_editorial_*`)

| View | Backs (dashboard surface) | Definition over |
|---|---|---|
| v_editorial_dim_client | FilterBar, dims everywhere (incl. 6 milestone dates, both pods, SF canonical) | raw_clients |
| v_editorial_dim_member | Team KPIs roster | raw_team_members |
| v_editorial_dim_calendar | editorial week/month mapping, As-of | raw_calendar |
| v_editorial_fct_client_q_snapshot | Overview Pod Snapshot Current Q cells, D1 client cards, End-of-Q chips, tiers | int_client_q_snapshot |
| v_editorial_fct_pod_snapshot | Overview pod rows (Σ incl./excl. 1st-Q per the audited rules, both pod axes) | int_client_q_snapshot × dim_client |
| v_editorial_fct_client_months | monthly breakdown popovers, lifetime bars | int_client_months |
| v_editorial_fct_goals_monthly | Pod Snapshot Goals, Monthly Goals gauges + table | int_goals_month_ct |
| v_editorial_fct_goals_client_totals | Goal-gated client/month totals (step-3 of the goals aggregation, in SQL) | int_goals_month_ct |
| v_editorial_fct_production_monthly | Production History chart (all 3 modes) | raw_production × dim_client |
| v_editorial_fct_pipeline | Cumulative Pipeline header/cards (+approval-rate fields) | raw_cumulative × dim_client |
| v_editorial_fct_milestone_transitions | TTM cards, Pod Timelines, Per-Client Days (8 transitions, day diffs) | raw_clients |
| v_editorial_fct_kpi_scores | KPI heatmap + KpiCards | raw_kpi_scores |
| v_editorial_fct_capacity_pods | Capacity At-a-glance/By Pod/Trend(Pods) | int_capacity_pod_months |
| v_editorial_fct_member_utilization | Capacity By Editor + Editors heat matrix | int_member_months |
| v_editorial_fct_client_contributions | Capacity By Client | int_client_pod_months |
| v_editorial_fct_articles_monthly | Monthly Articles (chart+matrix, both axes) | int_articles_creation |
| v_editorial_fct_article_revisions | Monthly Articles Revisions metric | int_articles_revisions |
| v_editorial_fct_ai_recommendations | AI Compliance rollups (pod/client/writer/month) | raw_ai_monitoring |
| v_editorial_fct_ai_flagged | AI Compliance flags + rewrites detail rows | raw_ai_monitoring |

**Count: 17 raw + 8 int = 25 physical tables (was 36) + 19 views.** Views are
free, self-documenting, and ARE the dashboard read contract (the repoint
shipped — see "Final architecture" below).

## Cross-cutting semantics (the considerations, made explicit)

- **Two month definitions coexist** (audited, deliberate): deliverables/
  production/goals/variance are **calendar-month**; articles + revisions are
  **editorial-month** (mapped via editorial_weeks, week 1 ≈ the 6th). The
  warehouse keeps both and labels every fact's basis; cross-blending stays
  forbidden until DaniQ's D7 decision.
- **`as_of_date` snapshots**: is_future, current-Q, pacing all depend on
  "today". Int tables stamp the build date; parity runs same-day.
- **Pod-axis duality**: every pod-grouped fact carries BOTH editorial_pod and
  growth_pod so either axis re-groups without recompute.
- **1st-Q escape hatch**: pod aggregates include 1st-Q clients in delivered
  bars but EXCLUDE them from variance sums (exactly as audited).
- **LP pre-doubling (May 2026+) lives at INGESTION** (unchanged); the
  display-side ×0.5 lives in int_goals ratio — net ×1 from May 2026, ×0.5
  before. Cutover preserved by construction.
- **Editor credits**: a pair-edited article counts once per editor; client
  distinct-article counts must use article_uid.
- **Pooled rates**: revision-rate aggregations carry num/den; views expose both
  so any rollup is Σnum/Σden, never average-of-rates.
- **"Unassigned"**: NULL pods serialize as "Unassigned" in views (matching the
  API), never invented.

## Parity harness (v2) — how we prove "same exact result"

1. **API replays** (as phase 1): member-utilization (all months), pod-summary,
   articles/monthly (both axes) — now recomputed from the NEW int tables/views,
   diffed row-by-row vs the live endpoints.
2. **Frontend-function replays** (NEW — the gold standard for frontend-computed
   numbers): a `frontend/scripts/parity-dump.ts` runs the REAL exported app
   functions (buildLifetimeSummaries, detectSummaryBillingPeriods,
   computeCurrentQ/LastFullQ, quarterMetaFromPeriods, varianceTier,
   contentTypeRatio + the 3-step goals aggregation) against live API data and
   dumps JSON; Python compares vs int_client_q_snapshot / goals views,
   field-by-field.
3. **Visual spot-checks** via the authenticated Playwright session (dashboard
   renders vs view rows for sampled clients/pods).
Verdict + diffs land in `etl/PARITY_REPORT_WAREHOUSE.md`.

## Bug register (replicated bug-for-bug; fix = separate decision)

| # | Behavior replicated | Where | Audit ref |
|---|---|---|---|
| B1 | Glossary has NO ×0.5 branch (docs say June 2026; code falls to ratios/×1) | contentTypeRatio | rules F1 |
| B2 | Goals popover "Overall" row is WEIGHTED in code; CLAUDE.md says raw | ClientDetailPopover | overview-audit #2 |
| B3 | Overview billing periods lack D1's post-contract truncation (finished clients can tier differently per surface) | detectSummaryBillingPeriods | overview-audit #3 |
| B4 | Popover cum-delivered includes future projections; computeLastFullQ doesn't | MonthlyBreakdownTable | overview-audit #4 |
| B5 | Negative TTM days excluded in stats card, included in timelines + bar chart | PodTTMStatsCard vs others | overview-audit #5 |
| B6 | KPI heatmap mean pools aggregate + per-client rows; target = latest row's target even if null | team-kpis page | tk-audit 5 |
| B7 | revision_rate/turnaround KPIs are ALL-TIME per member, stamped into every month | notion_kpi_service | tk-audit 3 |
| B8 | capacity_utilization KPI prefers projected over actual and has NO V## collapse | notion_kpi_service | tk-audit 4 |
| B9 | AI summary rates double-×100 on the frontend (display inflated) — warehouse stores backend's 0–100 counts/rates; display bug untouched | ai_monitoring + page | tk-audit 1 |
| B10 | AI by-month ordered lexically (text month column) — warehouse adds a proper month_date AND keeps the text key | ai_monitoring | tk-audit 2 |
| B11 | client-production delivered falls back to clients.articles_delivered only when Σactual = 0; client skipped when all-zero | dashboard.py | be-audit caveat c |
| B12 | %SOW numerator (date-scoped delivered) ÷ clients.articles_sow while lifetime bars use lifetimeSow | PodLifetimeProgressCard | d1-audit 4.1 |

## Final architecture — DUAL-SINK (decision 2026-06-11)

After a 4-agent adversarial audit of the BQ-only repoint, Ricardo chose (and
we implemented) a **dual-sink** publish: the same in-memory processed rows are
written, in one ~20s parallel publish, to BOTH

1. **Postgres schema `warehouse`** (11 tables: the 8 `editorial_int_*` +
   raw_clients/raw_articles/raw_name_mappings the readers need, + all 19 views
   translated to PG dialect in `etl/warehouse/pg_sink.py`) — **this is what
   the app serves** (`DASHBOARD_SOURCE=postgres`, ~10–20ms per endpoint), and
2. **BigQuery `graphite_bi_sandbox`** (all 25 tables + 19 views) — the
   always-fresh analytics mirror for other projects, and the backup.

Why this beats BQ-only serving: same numbers everywhere by construction
(tables are written from one row set — table-level cross-sink drift is
impossible; the 19 views are dialect translations kept in lockstep and proven
by the endpoint harness), Postgres latency for users, BQ availability for
analysts. The earlier BQ-only latency concern (~0.5–2.5s/endpoint) is moot.

- **Backend flag `DASHBOARD_SOURCE`** (`postgres` default | `bq`). Every
  dashboard read endpoint (**24 routes**: clients, deliverables, goals
  all+cumulative, kpis, team-members, editorial-weeks, production-trend,
  client-production, pacing, capacity ×4, articles ×2, ai-monitoring ×8)
  branches to `app/services/bq_dashboard.py`, which mirrors the legacy logic
  over the warehouse views. The frontend is untouched (same API contracts);
  RBAC scoping stays app-side. Per-request override header `X-Data-Source`
  is **gated by `DATA_SOURCE_OVERRIDE_ENABLED`** (true in local compose for
  the harness, **false in production**).
- **Endpoint parity** (`python -m etl.warehouse.endpoint_parity` →
  `PARITY_REPORT_ENDPOINTS.md`): **53/53 cases identical** across a realistic
  param matrix (statuses, pods, axes, windows, filters, skip>0 pagination
  with exact-sequence id checks). Loop fixes applied: (1) BQ tz-aware
  timestamps normalized to naive UTC; (2) deterministic id/name tie-break
  sort keys added to BOTH paths everywhere pagination or on-screen order
  matters — pure tiebreaks, no visible semantics change. Latent note: PG
  `en_US` vs BQ code-point collation could order non-ASCII names differently
  within ties; the id tiebreak bounds the blast radius to adjacent rows.
- **Function parity** (`python -m etl.warehouse.parity` →
  `PARITY_REPORT_WAREHOUSE.md`): 3,612 snapshot fields + 1,233 per-month
  period assignments + goals totals + capacity/articles replays — all
  identical vs the REAL frontend TS functions (`scripts/parity-dump.ts`).
- **Visual validation (Playwright, authenticated)**: Overview / Editorial
  Clients / Team KPIs render fully from the warehouse; capacity golden
  numbers byte-identical on screen; pod variance chips match
  `v_editorial_fct_pod_snapshot` exactly.
- **Refresh triggers — same behavior as before**:
  - Terminal one-liner: `./etl/refresh.sh [current|past|full]`
    (= SYNC button / Re-sync Past Months / both, then warehouse publish).
  - **SYNC button** → manifest step `@warehouse-publish` runs last.
  - **Re-sync Past Months** → `@warehouse-publish-past` runs last.
  - **scope=full** (month-rollover / cron) publishes exactly ONCE, at the end.
  - **Import Wizard** single-sheet imports publish after success (a publish
    failure surfaces as a failed synthetic step, never a 500).
  - `etl/warehouse/run.py --scope current` self-escalates to `full` on month
    rollover, mirroring SyncAllModal.
- **Publish hardening**: cross-process `pg_advisory_lock(815001)`; per-table
  failure isolation in `flush_jobs` (one bad table fails loudly, the rest
  land); single `_BUILD_TS` per build; atomic `CREATE OR REPLACE TABLE` on
  the empty-table BQ path; PG bulk inserts via `execute_values`; parallel
  loads (ThreadPoolExecutor×8, ~120s → ~20s).
- **Prod deploy**: backend Dockerfile `COPY etl/ ./etl/` + railway.toml
  `watchPatterns` include `etl/**` — the image ships the publisher.

## Out of scope (documented, deliberate)

- Dead/unmounted surfaces get NO warehouse objects: backend pacing badge
  internals beyond `/api/dashboard/pacing`, EngagementHealth,
  /dashboard/clients/summary + time-to-metrics endpoints,
  VarianceCard/LastFullQCard/RecentQClosesCard, PodPipelineRow approval matrix
  (spec preserved in the audit if it returns).
- RBAC row-scoping stays a read-time app concern (per-user), never baked into
  shared tables.
- Phase 2 (post-merge): thin-reader endpoints that SELECT the views directly
  (delete the per-endpoint Python mirrors), then decommission the phase-1
  flat `editorial_hub_*` tables.
