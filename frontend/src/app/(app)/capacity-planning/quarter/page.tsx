"use client";

import { useMemo } from "react";
import { ProposalBanner } from "../_ProposalBanner";
import { SubNav } from "../_SubNav";
import {
  monthLabel,
  monthRange,
  useCP2Store,
} from "../_store";
import type { MonthKey } from "../_mock";
import { computePodTotals } from "../_mock";

/** Return the quarter (1..4) of a YYYY-MM key. */
function quarterOf(monthKey: string): { year: number; q: number } {
  const [y, m] = monthKey.split("-").map((n) => parseInt(n, 10));
  return { year: y, q: Math.ceil(m / 3) };
}

export default function QuarterPage() {
  const { state, selectedMonth, weeklyActuals } = useCP2Store();

  // Anchor to the selected month's quarter.
  const { year, q } = quarterOf(selectedMonth);
  const firstMonthNum = (q - 1) * 3 + 1;
  const months: string[] = [];
  for (let i = 0; i < 3; i++) {
    const m = firstMonthNum + i;
    months.push(`${year}-${String(m).padStart(2, "0")}`);
  }

  // Build per-month totals for every pod that appears in any of the 3 months.
  const byPod = useMemo(() => {
    const pods = new Map<
      number,
      {
        podName: string;
        perMonth: Record<string, { capacity: number; projected: number; delivered: number }>;
      }
    >();
    for (const m of months) {
      for (const pod of state.monthly[m as MonthKey] ?? []) {
        if (!pods.has(pod.id)) {
          pods.set(pod.id, {
            podName: pod.displayName,
            perMonth: {},
          });
        }
        const totals = computePodTotals(pod);
        pods.get(pod.id)!.perMonth[m] = {
          capacity: totals.totalCapacity,
          projected: totals.projectedUse,
          delivered: totals.actualDelivered,
        };
      }
    }
    return pods;
  }, [state.monthly, months]);

  // Per-client weekly delivered for the quarter, rolled up to month then summed.
  const clientRollup = useMemo(() => {
    const out = new Map<
      number,
      { clientName: string; delivered: number; goal: number }
    >();
    for (const m of months) {
      // All weeks whose key prefix matches this quarter is a loose filter — we
      // just iterate everything and attribute by clientId.
    }
    // Simpler: walk weeklyActuals for weeks whose month is in `months`.
    const selectedMonthsSet = new Set(months);
    for (const list of Object.values(weeklyActuals)) {
      for (const w of list) {
        const { year: wy, q: wq } = quarterOf(
          // week-to-month heuristic: use first 4 digits (year) and approximate
          // month by splitting — we use monthly actuals grouping instead.
          selectedMonth,
        );
        void wy;
        void wq;
        // For the rollup we only include weeks where there's a row in the
        // selected months; the mock already keeps weeks inside month buckets.
        if (!selectedMonthsSet.has(monthFromWeek(w.weekKey))) continue;
        const name =
          findClientName(state.monthly, state.unassigned, w.clientId) ?? `#${w.clientId}`;
        const prev = out.get(w.clientId) ?? { clientName: name, delivered: 0, goal: 0 };
        out.set(w.clientId, {
          clientName: name,
          delivered: prev.delivered + w.deliveredArticles,
          goal: prev.goal + w.goalArticles,
        });
      }
    }
    return Array.from(out.values()).sort((a, b) => b.delivered - a.delivered);
  }, [weeklyActuals, state.monthly, state.unassigned, months, selectedMonth]);

  const quarterLabel = `Q${q} ${year}`;
  const neighbors = monthRange(selectedMonth, 0, 0); // nothing; placeholder to keep the function imported
  void neighbors;

  return (
    <div className="flex flex-col gap-6">
      <ProposalBanner subtitle="Quarterly rollup. Summed monthly capacity + projected + delivered per pod, and per-client actuals across the three months." />
      <SubNav />

      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">
          {quarterLabel}{" "}
          <span className="ml-2 font-mono text-xs text-[#606060]">
            {months.map(monthLabel).join(" · ")}
          </span>
        </h2>
      </div>

      {/* Pod summary */}
      <div className="overflow-hidden rounded-lg border border-[#1f1f1f] bg-[#0a0a0a]">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead>
            <tr className="border-b border-[#1a1a1a] bg-[#050505] text-[10px] uppercase tracking-wider text-[#606060]">
              <th className="px-4 py-2 text-left">Pod</th>
              {months.map((m) => (
                <th key={m} colSpan={3} className="px-3 py-2 text-center">
                  {monthLabel(m)}
                </th>
              ))}
              <th colSpan={3} className="px-3 py-2 text-center text-[#65FFAA]">
                {quarterLabel} total
              </th>
            </tr>
            <tr className="border-b border-[#1a1a1a] bg-[#050505] text-[10px] uppercase tracking-wider text-[#606060]">
              <th />
              {months.flatMap((m) => [
                <th key={`${m}-c`} className="px-2 py-1 text-right">cap</th>,
                <th key={`${m}-p`} className="px-2 py-1 text-right">proj</th>,
                <th key={`${m}-d`} className="px-2 py-1 text-right">deliv</th>,
              ])}
              <th className="px-2 py-1 text-right">cap</th>
              <th className="px-2 py-1 text-right">proj</th>
              <th className="px-2 py-1 text-right">deliv</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(byPod.values()).map((entry) => {
              const qCap = months.reduce(
                (s, m) => s + (entry.perMonth[m]?.capacity ?? 0),
                0,
              );
              const qProj = months.reduce(
                (s, m) => s + (entry.perMonth[m]?.projected ?? 0),
                0,
              );
              const qDel = months.reduce(
                (s, m) => s + (entry.perMonth[m]?.delivered ?? 0),
                0,
              );
              return (
                <tr
                  key={entry.podName}
                  className="border-b border-[#161616] last:border-0"
                >
                  <td className="px-4 py-2 text-xs font-medium text-white">
                    {entry.podName}
                  </td>
                  {months.flatMap((m) => {
                    const cell = entry.perMonth[m];
                    return [
                      <td key={`${m}-c`} className="px-2 py-1.5 text-right text-[#C4BCAA]">
                        {cell ? cell.capacity.toFixed(0) : "—"}
                      </td>,
                      <td key={`${m}-p`} className="px-2 py-1.5 text-right text-[#C4BCAA]">
                        {cell ? cell.projected : "—"}
                      </td>,
                      <td key={`${m}-d`} className="px-2 py-1.5 text-right text-[#C4BCAA]">
                        {cell ? cell.delivered : "—"}
                      </td>,
                    ];
                  })}
                  <td className="px-2 py-1.5 text-right font-semibold text-white">
                    {qCap.toFixed(0)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold text-white">
                    {qProj}
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right font-semibold ${
                      qDel >= qProj ? "text-[#65FFAA]" : qDel < qProj - 3 ? "text-[#ED6958]" : "text-[#F5C542]"
                    }`}
                  >
                    {qDel}
                  </td>
                </tr>
              );
            })}
            {byPod.size === 0 && (
              <tr>
                <td
                  colSpan={months.length * 3 + 4}
                  className="px-4 py-6 text-center text-xs text-[#606060]"
                >
                  No pod data for {quarterLabel}. Allocate on the Overview tab first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Top clients by delivered */}
      {clientRollup.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-[#1f1f1f] bg-[#0a0a0a]">
          <div className="border-b border-[#1f1f1f] px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-[#606060]">
            Client actuals · {quarterLabel}
          </div>
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="bg-[#050505] text-[10px] uppercase tracking-wider text-[#606060]">
                <th className="px-4 py-2 text-left">Client</th>
                <th className="px-3 py-2 text-right">Delivered</th>
                <th className="px-3 py-2 text-right">Goal</th>
                <th className="px-3 py-2 text-right">Hit %</th>
              </tr>
            </thead>
            <tbody>
              {clientRollup.map((r) => {
                const hit = r.goal > 0 ? (r.delivered / r.goal) * 100 : 0;
                return (
                  <tr
                    key={r.clientName}
                    className="border-t border-[#111] hover:bg-[#111111]"
                  >
                    <td className="px-4 py-1.5 text-xs text-white">{r.clientName}</td>
                    <td className="px-3 py-1.5 text-right text-[#C4BCAA]">{r.delivered}</td>
                    <td className="px-3 py-1.5 text-right text-[#606060]">{r.goal}</td>
                    <td
                      className={`px-3 py-1.5 text-right font-semibold ${
                        hit >= 100 ? "text-[#65FFAA]" : hit < 90 ? "text-[#ED6958]" : "text-[#F5C542]"
                      }`}
                    >
                      {hit.toFixed(0)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function monthFromWeek(weekKey: string): string {
  // Approximate — attribute a week to the month of its Thursday. Since the
  // seed data keyed each week to a specific month already, the approximation
  // is close enough for rollup display in the prototype.
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!m) return "";
  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const thurs = new Date(Date.UTC(year, 0, 4 + (week - 1) * 7 - dow + 4));
  return `${thurs.getUTCFullYear()}-${String(thurs.getUTCMonth() + 1).padStart(2, "0")}`;
}

function findClientName(
  monthly: Record<string, Array<{ clients: { id: number; name: string }[] }>>,
  unassigned: Record<string, { id: number; name: string }[]>,
  clientId: number,
): string | null {
  for (const pods of Object.values(monthly)) {
    for (const pod of pods) {
      for (const c of pod.clients) if (c.id === clientId) return c.name;
    }
  }
  for (const list of Object.values(unassigned)) {
    for (const c of list) if (c.id === clientId) return c.name;
  }
  return null;
}
