// Lifetime client-delivery summaries for the Overview dashboard.
//
// D1's per-tab `clientSummaries` runs a quarter-expansion algorithm so the
// totals respect the user's date filter. The Overview is a snapshot dashboard
// with no date filter, so we don't need that complexity here — just lifetime
// delivered + invoiced + the per-month breakdown that MostBehindCard reads
// to compute each client's last-completed-quarter gap.

import type { Client, DeliverableMonthly } from "@/lib/types";
import type { SummaryRow } from "@/components/dashboard/DeliveryOverviewCards";

export function buildLifetimeSummaries(
  clients: Client[],
  deliverables: DeliverableMonthly[],
): SummaryRow[] {
  // Cap at the end of the last fully-completed month so partial-month +
  // future projections don't inflate the totals. Same rule D1 uses.
  const now = new Date();
  const lastCompleted = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const nowY = lastCompleted.getFullYear();
  const nowM = lastCompleted.getMonth() + 1;
  const isPastOrCurrent = (y: number, m: number) =>
    y < nowY || (y === nowY && m <= nowM);

  const rowsByClient = new Map<number, DeliverableMonthly[]>();
  for (const d of deliverables) {
    const arr = rowsByClient.get(d.client_id) ?? [];
    arr.push(d);
    rowsByClient.set(d.client_id, arr);
  }

  return clients.map((c) => {
    const cd = rowsByClient.get(c.id) ?? [];
    const cdActuals = cd.filter((d) => isPastOrCurrent(d.year, d.month));
    const delivered = cdActuals.reduce(
      (a, d) => a + (d.articles_delivered ?? 0),
      0,
    );
    const invoiced = cdActuals.reduce(
      (a, d) => a + (d.articles_invoiced ?? 0),
      0,
    );
    const monthly_breakdown = cd
      .slice()
      .sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month))
      .map((d) => ({
        year: d.year,
        month: d.month,
        delivered: d.articles_delivered ?? 0,
        invoiced: d.articles_invoiced ?? 0,
        is_future: !isPastOrCurrent(d.year, d.month),
      }));

    const sow = c.articles_sow ?? 0;
    const variance = delivered - invoiced;
    const pct = sow > 0 ? Math.round((delivered / sow) * 100) : 0;
    return {
      id: c.id,
      name: c.name,
      editorial_pod: c.editorial_pod,
      articles_delivered: delivered,
      articles_invoiced: invoiced,
      articles_sow: sow,
      variance,
      variance_cumulative: variance,
      pct_complete: pct,
      term_months: c.term_months,
      start_date: c.start_date,
      monthly_breakdown,
    };
  });
}
