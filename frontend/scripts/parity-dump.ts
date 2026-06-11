/**
 * Parity dump — runs the REAL dashboard functions on live API data and emits
 * JSON for the warehouse parity harness (etl/warehouse/parity.py) to diff
 * against the BigQuery int tables.
 *
 *   npx tsx scripts/parity-dump.ts [out.json]
 *
 * Uses the exact exported app code: buildLifetimeSummaries,
 * detectSummaryBillingPeriods/computeCurrentQ/computeLastFullQ/isFirstContractQ
 * (Overview), detectBillingPeriods/quarterMetaFromPeriods/computeClientTier
 * (D1, incl. the deliveryMeta start-override replicated verbatim from
 * editorial-clients/page.tsx:1420-1467), varianceTier, aggregateGoalsSummary.
 */

import { writeFileSync } from "node:fs";

import { buildLifetimeSummaries } from "../src/lib/overviewSummary";
import {
  computeCurrentQ,
  computeLastFullQ,
  detectSummaryBillingPeriods,
  isFirstContractQ,
} from "../src/components/dashboard/DeliveryOverviewCards";
import {
  computeClientTier,
  detectBillingPeriods,
  quarterMetaFromPeriods,
  type ClientDeliveryCardRow,
} from "../src/components/dashboard/ClientDeliveryCards";
import { varianceTier } from "../src/components/dashboard/shared-helpers";
import { aggregateGoalsSummary } from "../src/components/dashboard/GoalsVsDeliverySection";
import type {
  Client,
  CumulativeMetric,
  DeliverableMonthly,
  GoalsVsDeliveryRow,
} from "../src/lib/types";

const API = process.env.PARITY_API ?? "http://localhost:8050";
const HDRS = { "X-User-Email": "ricardo.jaramillo@graphitehq.com" };

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: HDRS });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function fetchAllDeliverables(): Promise<DeliverableMonthly[]> {
  const out: DeliverableMonthly[] = [];
  for (let skip = 0; ; skip += 1000) {
    const page = await get<DeliverableMonthly[]>(`/api/deliverables/?limit=1000&skip=${skip}`);
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

// Verbatim replica of the D1 deliveryMeta useMemo (page.tsx:1420-1467) — the
// only piece that can't be imported (it lives inside the page component).
function deliveryMetaFor(
  clients: Client[],
  deliverables: DeliverableMonthly[],
): Map<number, { startDate: string; termMonths: number; lifetimeSow: number }> {
  const map = new Map<number, { startDate: string; termMonths: number; lifetimeSow: number }>();
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const byClient = new Map<number, DeliverableMonthly[]>();
  for (const d of deliverables) {
    const arr = byClient.get(d.client_id);
    if (arr) arr.push(d);
    else byClient.set(d.client_id, [d]);
  }
  const parse = (s: string | null | undefined): Date | null => {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  };
  for (const [cid, rows] of byClient) {
    const active = rows.filter(
      (r) =>
        (r.articles_sow_target ?? 0) > 0 ||
        (r.articles_delivered ?? 0) > 0 ||
        (r.articles_invoiced ?? 0) > 0,
    );
    if (active.length === 0) continue;
    active.sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
    const first = active[0];
    const lastPlanned =
      [...active].reverse().find((r) => (r.articles_sow_target ?? 0) > 0) ??
      active[active.length - 1];
    let startYm = { y: first.year, m: first.month };
    let endYm = { y: lastPlanned.year, m: lastPlanned.month };
    const c = clientById.get(cid);
    const sheetStart = parse(c?.start_date);
    const sheetEnd = parse(c?.end_date);
    if (sheetStart) {
      const s = { y: sheetStart.getFullYear(), m: sheetStart.getMonth() + 1 };
      if (s.y * 12 + s.m < startYm.y * 12 + startYm.m) startYm = s;
    }
    if (sheetEnd) {
      const e = { y: sheetEnd.getFullYear(), m: sheetEnd.getMonth() + 1 };
      if (e.y * 12 + e.m > endYm.y * 12 + endYm.m) endYm = e;
    }
    map.set(cid, {
      startDate: `${startYm.y}-${String(startYm.m).padStart(2, "0")}-01`,
      termMonths: (endYm.y - startYm.y) * 12 + (endYm.m - startYm.m) + 1,
      lifetimeSow: rows.reduce((a, r) => a + (r.articles_sow_target ?? 0), 0),
    });
  }
  return map;
}

async function main() {
  const [clients, deliverables, goals, cumulative] = await Promise.all([
    get<Client[]>("/api/clients/?limit=500"),
    fetchAllDeliverables(),
    get<GoalsVsDeliveryRow[]>("/api/goals-delivery/all"),
    get<CumulativeMetric[]>("/api/goals-delivery/cumulative"),
  ]);
  // publishedByName — same exact-name, last-wins join the Overview uses.
  const publishedByName = new Map<string, number>();
  for (const cm of cumulative) publishedByName.set(cm.client_name, cm.published_live ?? 0);

  const summaries = buildLifetimeSummaries(clients, deliverables);
  const meta = deliveryMetaFor(clients, deliverables);
  const byId = new Map(clients.map((c) => [c.id, c]));

  const perClient = summaries.map((row) => {
    const c = byId.get(row.id)!;
    // Overview path
    const periods = detectSummaryBillingPeriods(row);
    const cq = computeCurrentQ(row);
    const lq = computeLastFullQ(row);
    const isNew = isFirstContractQ(row);
    const tier = cq && cq.invoiced > 0 ? varianceTier(cq.projectedVariance, isNew).key : null;

    // D1 path
    const dm = meta.get(row.id);
    const d1Row: ClientDeliveryCardRow = {
      id: row.id,
      name: row.name,
      status: c.status,
      editorial_pod: c.editorial_pod ?? null,
      growth_pod: c.growth_pod ?? null,
      articles_sow: dm && dm.lifetimeSow > 0 ? dm.lifetimeSow : (c.articles_sow ?? 0),
      articles_delivered: row.articles_delivered,
      articles_invoiced: row.articles_invoiced,
      variance: row.variance,
      variance_cumulative: row.variance_cumulative,
      pct_complete: row.pct_complete,
      start_date: dm?.startDate ?? c.start_date,
      end_date: c.end_date,
      term_months: dm?.termMonths ?? c.term_months,
      monthly_breakdown: row.monthly_breakdown,
    } as ClientDeliveryCardRow;
    const d1Periods = detectBillingPeriods(d1Row);
    const qm = quarterMetaFromPeriods(d1Periods);
    const d1IsFirst = qm.currentQ?.label === "Q1";
    const d1Tier = computeClientTier(qm.currentQ, !!d1IsFirst)?.key ?? null;

    // Per-month period assignments (both variants) — verifies the
    // editorial_int_client_months table the snapshot check can't see.
    const periodMap = (ps: { qIdx: number; label: string; isPrelude: boolean; months: { year: number; month: number }[] }[], post?: boolean) => {
      const m: Record<string, (number | string | boolean)[]> = {};
      for (const p of ps) {
        for (const mo of p.months) {
          const k = `${mo.year}-${String(mo.month).padStart(2, "0")}`;
          m[k] = post
            ? [p.qIdx, p.label, p.isPrelude, (p as { isPostContract?: boolean }).isPostContract ?? false]
            : [p.qIdx, p.label, p.isPrelude];
        }
      }
      return m;
    };
    const published = publishedByName.get(row.name) ?? 0;

    return {
      client_id: row.id,
      client_name: row.name,
      published_live: published,
      pct_published: row.articles_sow > 0 ? Math.round((published / row.articles_sow) * 100) : null,
      ovr_period_map: periodMap(periods),
      d1_period_map: periodMap(d1Periods as never, true),
      lifetime_delivered: row.articles_delivered,
      lifetime_invoiced: row.articles_invoiced,
      articles_sow: row.articles_sow,
      lifetime_variance: row.variance,
      pct_complete: row.pct_complete,
      n_periods: periods.length,
      ovr_q_label: cq?.label ?? null,
      ovr_q_month_in_q: cq?.monthInQ ?? null,
      ovr_q_length: cq?.qLength ?? null,
      ovr_q_delivered: cq?.delivered ?? null,
      ovr_q_projected_remaining: cq?.projectedRemaining ?? null,
      ovr_q_projected_end: cq?.projectedEnd ?? null,
      ovr_q_invoiced: cq?.invoiced ?? null,
      ovr_q_projected_variance: cq?.projectedVariance ?? null,
      ovr_is_first_q: isNew,
      ovr_tier: tier,
      ovr_lq_label: lq?.label ?? null,
      ovr_lq_delivered: lq?.delivered ?? null,
      ovr_lq_invoiced: lq?.invoiced ?? null,
      ovr_lq_cum_delivered: lq?.cumDelivered ?? null,
      ovr_lq_cum_invoiced: lq?.cumInvoiced ?? null,
      ovr_lq_cum_variance: lq?.cumVariance ?? null,
      ovr_lq_is_first_q: lq?.isFirstQ ?? null,
      d1_effective_start: dm?.startDate ?? c.start_date ?? null,
      d1_term_months: dm?.termMonths ?? c.term_months ?? null,
      d1_lifetime_sow: d1Row.articles_sow,
      d1_q_label: qm.currentQ?.label ?? null,
      d1_q_month_in_q: qm.currentQ?.monthInQ ?? null,
      d1_q_length: qm.currentQ?.qLength ?? null,
      d1_q_delivered_actual: qm.currentQ?.deliveredActual ?? null,
      d1_q_invoiced: qm.currentQ?.invoiced ?? null,
      d1_q_projected_end_cum_delivered: qm.currentQ?.projectedEndCumDelivered ?? null,
      d1_q_actual_cum_delivered: qm.currentQ?.actualCumDelivered ?? null,
      d1_q_end_of_q_cum_invoiced: qm.currentQ?.endOfQCumInvoiced ?? null,
      d1_q_projected_end_cum_variance: qm.currentQ?.projectedEndCumVariance ?? null,
      d1_is_first_q: qm.currentQ ? !!d1IsFirst : null,
      d1_tier: d1Tier,
      d1_lq_label: qm.lastFullQ?.label ?? null,
      d1_lq_delivered: qm.lastFullQ?.delivered ?? null,
      d1_lq_invoiced: qm.lastFullQ?.invoiced ?? null,
      d1_lq_cum_delivered: qm.lastFullQ?.cumDelivered ?? null,
      d1_lq_cum_invoiced: qm.lastFullQ?.cumInvoiced ?? null,
      d1_lq_cum_variance: qm.lastFullQ?.cumVariance ?? null,
    };
  });

  const g = aggregateGoalsSummary(goals);
  const goalsOut = {
    cb_goal: g.cbGoal,
    cb_delivered: g.cbDel,
    ad_goal: g.adGoal,
    ad_delivered: g.adDel,
    cb_pct: g.cbPct,
    ad_pct: g.adPct,
    per_client: Object.fromEntries(
      [...g.perClient.entries()].map(([k, v]) => [
        k,
        { cb_goal: v.cbGoal, cb_del: v.cbDel, ad_goal: v.adGoal, ad_del: v.adDel },
      ]),
    ),
  };

  const out = {
    dumped_at: new Date().toISOString(),
    as_of_date: new Date().toISOString().slice(0, 10),
    clients: perClient,
    goals: goalsOut,
  };
  const dest = process.argv[2] ?? "/tmp/parity_frontend_dump.json";
  writeFileSync(dest, JSON.stringify(out, null, 1));
  console.log(`dumped ${perClient.length} clients + goals → ${dest}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
