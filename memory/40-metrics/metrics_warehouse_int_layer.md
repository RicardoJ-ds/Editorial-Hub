---
name: metrics-warehouse-int-layer
description: "Where each calculation is re-computed for serving: the editorial_int_* table→computation map, plus the B1–B12 bug-for-bug register (frontend↔doc↔warehouse divergences replicated deliberately)."
metadata:
  node_type: memory
  type: reference
  originSessionId: 3fa962ac-9be0-4852-8c63-16ff918094cb
---

# Warehouse INT Layer — the calculation serving map + bug register

**All business math lives in the `editorial_int_*` layer** so every dashboard read is a plain
`SUM/GROUP BY` over a view. The math is ported from the frontend TS into `etl/warehouse/pyrules.py`
and proven byte-identical (`etl/PARITY_REPORT_WAREHOUSE.md`). Architecture of the warehouse itself
→ [[reference-warehouse-layered-model]]. Per-domain formulas → the other `40-metrics/` files.

## INT table → what it computes
| Int table | Computes | Formula file |
|---|---|---|
| `editorial_int_client_months` | client×calendar-month merge (delivered/invoiced/sow + actual/projected/projected_original/is_actual); `is_future`; billing periods under **BOTH** detectors (`ovr_*` Overview + `d1_*` post-contract-truncated) | [[metrics-end-of-q-variance-tiers]] |
| `editorial_int_client_q_snapshot` | **the variance brain** — one row per client per `as_of_date`: currentQ (`projected_end`, `projected_variance` cumulative from start), lastFullQ, D1 twin, `tier`, lifetime delivered/invoiced/sow/pct_sow/published_live/pct_published | [[metrics-end-of-q-variance-tiers]], [[metrics-goals-content-weighting]] |
| `editorial_int_goals_month_ct` | client×month×content_type — goals 3-step: cb/ad goal+delivered = MAX over weeks; `ratio`=contentTypeRatio (article×1/jumbo×2/LP×0.5; **no glossary branch — B1**); weighted `w_*` | [[metrics-goals-content-weighting]] |
| `editorial_int_capacity_pod_months` | pod×month, **latest-V## collapse** (rank by int after 'V') | [[metrics-capacity-utilization]] |
| `editorial_int_member_months` | member×pod×month via shared `app/services/capacity_calc.py` (alloc/distribution fallback, SPEC ×1.4 pod weighting) | [[metrics-capacity-utilization]] |
| `editorial_int_client_pod_months` | pod×client×month contributions (raw + ×1.4 weighted) | [[metrics-capacity-utilization]] |
| `editorial_int_articles_creation` | editorial-month × editorial_pod × growth_pod × client × editor: count/revised/published/matched (**creation-month** basis) | [[metrics-monthly-articles]] |
| `editorial_int_articles_revisions` | same dims, **revision-own-month** basis | [[metrics-monthly-articles]] |
| `editorial_int_pod_assignments` | resolved editorial pod-assignment history (Team Pods cutover 2026-06-12) | [[reference-data-sources]] |

(kpi_scores needs no int table — raw grain is final; recomputed at sync by `@refresh-kpis`.)

## Cross-cutting semantics (`WAREHOUSE_DESIGN.md:168-189`)
- **Two month definitions coexist** — calendar (deliverables/production/goals/variance) vs editorial-month (articles/revisions). **Cross-blending forbidden** pending DaniQ's D7.
- **Pod-axis duality** — both `editorial_pod` + `growth_pod` carried on every fact.
- **1st-Q escape hatch** — in delivered bars, excluded from variance.
- **LP pre-doubling** at ingestion (May 2026+), ×0.5 at display → net ×1.
- **Pooled rates** carry num/den. NULL pods serialize "Unassigned."

## Bug register — B1–B12 (replicated bug-for-bug; a fix is a separate decision)
`etl/WAREHOUSE_DESIGN.md:207-222`. The warehouse matches the frontend **including its bugs** so numbers tie; fixing one means fixing both sides + re-proving parity.
| # | One-line |
|---|---|
| **B1** | Glossary has NO ×0.5 branch (docs say Jun 2026; code falls to ratios/×1) — `contentTypeRatio` |
| **B2** | Goals popover "Overall" is WEIGHTED in code; CLAUDE.md says raw |
| **B3** | Overview billing periods lack D1's post-contract truncation (finished clients tier differently per surface) |
| **B4** | Popover cum-delivered includes future projections; `computeLastFullQ` doesn't |
| **B5** | Negative TTM days excluded in stat card (now fixed FE 0.3.27), included in timelines+bars; warehouse always emits them |
| **B6** | KPI heatmap mean pools aggregate + per-client rows; target = latest row's target even if null |
| **B7** | revision_rate/turnaround KPIs are ALL-TIME per member, stamped into every month — `notion_kpi_service` |
| **B8** | capacity_utilization KPI prefers projected over actual, NO V## collapse — `notion_kpi_service` |
| **B9** | AI summary rates double-×100 on frontend (display inflated); warehouse stores 0–100, display bug untouched |
| **B10** | AI by-month ordered lexically (text month); warehouse adds proper `month_date` AND keeps text key |
| **B11** | client-production delivered falls back to `clients.articles_delivered` only when Σactual=0; all-zero client skipped |
| **B12** | %SOW numerator (date-scoped) ÷ `clients.articles_sow` while lifetime bars use lifetimeSow |

## Parity proofs (the guarantee that warehouse == frontend)
- **Function parity** (`python -m etl.warehouse.parity`, 2026-06-12): 3,612 client_q_snapshot fields · 1,233 client_months period maps · 76 goals 3-step rows · member-util/pod-summary/articles replays — all identical vs the real exported TS (`frontend/scripts/parity-dump.ts`).
- **Endpoint parity** (`python -m etl.warehouse.endpoint_parity`, 2026-06-19): **53/53 cases** postgres vs bq identical (the cutover-time run with cache off was the slightly smaller **52/52** matrix).

## When you change a calculation
1. Edit the frontend TS (the spec). 2. Mirror it in `pyrules.py` (or `capacity_calc.py`, shared). 3. If it's in the bug register, decide whether to also fix the warehouse-replicated bug. 4. Re-run `parity` + `endpoint_parity`. 5. Update the relevant `40-metrics/` file + `../log.md`.
