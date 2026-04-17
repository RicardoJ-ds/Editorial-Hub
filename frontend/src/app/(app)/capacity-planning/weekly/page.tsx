"use client";

import { useMemo } from "react";
import { Download, RotateCcw } from "lucide-react";
import { ProposalBanner } from "../_ProposalBanner";
import { SubNav } from "../_SubNav";
import { ClosedMonthBanner } from "../_MonthActions";
import {
  monthLabel,
  previousWeeks,
  useCP2Store,
  weeksInMonth,
} from "../_store";
import type { MonthKey, ClientChip } from "../_mock";

type ClientRow = {
  clientId: number;
  podId: number | null;
  clientName: string;
  podName: string;
  projectedArticles: number;
};

function collectClientsForMonth(
  pods: Array<{ id: number; displayName: string; clients: ClientChip[] }>,
  unassigned: ClientChip[],
): ClientRow[] {
  const rows: ClientRow[] = [];
  for (const pod of pods) {
    for (const c of pod.clients) {
      rows.push({
        clientId: c.id,
        podId: pod.id,
        clientName: c.name,
        podName: pod.displayName,
        projectedArticles: c.projectedArticles,
      });
    }
  }
  for (const c of unassigned) {
    rows.push({
      clientId: c.id,
      podId: null,
      clientName: c.name,
      podName: "Unassigned",
      projectedArticles: c.projectedArticles,
    });
  }
  // Sort by pod then client for stable ordering.
  rows.sort((a, b) => a.podName.localeCompare(b.podName) || a.clientName.localeCompare(b.clientName));
  return rows;
}

export default function WeeklyPage() {
  const {
    state,
    selectedMonth,
    weeklyActuals,
    setWeeklyActual,
    importWeeklyFromSheet,
    isMonthClosed,
  } = useCP2Store();
  const month = selectedMonth as MonthKey;
  const closed = isMonthClosed(month);

  const weeks = useMemo(() => weeksInMonth(month), [month]);
  const clientRows = useMemo(
    () =>
      collectClientsForMonth(
        state.monthly[month] ?? [],
        state.unassigned[month] ?? [],
      ),
    [state.monthly, state.unassigned, month],
  );

  // Fast lookup: (weekKey, clientId) → row
  const actualByWeek = useMemo(() => {
    const map = new Map<string, Map<number, { delivered: number; goal: number }>>();
    for (const [wk, list] of Object.entries(weeklyActuals)) {
      const inner = new Map<number, { delivered: number; goal: number }>();
      for (const r of list) {
        inner.set(r.clientId, {
          delivered: r.deliveredArticles,
          goal: r.goalArticles,
        });
      }
      map.set(wk, inner);
    }
    return map;
  }, [weeklyActuals]);

  // Sparkline lookback: 8 weeks ending at the LAST week of the selected month.
  const lookbackKeys = useMemo(() => {
    const last = weeks[weeks.length - 1]?.weekKey ?? "";
    return previousWeeks(last, 8);
  }, [weeks]);

  // Totals per column
  const columnTotals = useMemo(() => {
    const totals = weeks.map(() => ({ delivered: 0, goal: 0 }));
    weeks.forEach((w, i) => {
      const inner = actualByWeek.get(w.weekKey);
      if (!inner) return;
      for (const row of clientRows) {
        const v = inner.get(row.clientId);
        if (v) {
          totals[i].delivered += v.delivered;
          totals[i].goal += v.goal;
        }
      }
    });
    return totals;
  }, [weeks, actualByWeek, clientRows]);

  // Row totals for the whole month
  const rowTotals = useMemo(() => {
    const totals = new Map<number, { delivered: number; goal: number }>();
    for (const row of clientRows) {
      let d = 0;
      let g = 0;
      for (const w of weeks) {
        const inner = actualByWeek.get(w.weekKey);
        const v = inner?.get(row.clientId);
        if (v) {
          d += v.delivered;
          g += v.goal;
        }
      }
      totals.set(row.clientId, { delivered: d, goal: g });
    }
    return totals;
  }, [clientRows, weeks, actualByWeek]);

  return (
    <div className="flex flex-col gap-6">
      <ProposalBanner subtitle="Weekly actuals vs goals per client. Edit cells inline; row totals and the 8-week sparkline update live. In production this table is populated by the ingest pipeline from Master Tracker 'Goals vs Delivery'." />
      <SubNav />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#606060]">
          {weeks.length} week{weeks.length === 1 ? "" : "s"} · {clientRows.length} client
          {clientRows.length === 1 ? "" : "s"} · {monthLabel(month)}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={importWeeklyFromSheet}
            disabled={closed}
            title={
              closed
                ? "Month is closed"
                : "Reseed from the mock pipeline (would call backend ingest in production)"
            }
            className="flex items-center gap-1.5 rounded-md border border-[#2a2a2a] bg-[#161616] px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider text-[#C4BCAA] hover:border-[#42CA80]/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            Import from Goals vs Delivery
          </button>
        </div>
      </div>

      <ClosedMonthBanner />

      {clientRows.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-[#2a2a2a] bg-[#0a0a0a] px-4 py-6 text-sm text-[#606060]">
          <RotateCcw className="h-4 w-4" />
          No clients for {monthLabel(month)} — allocate some first on the Allocation tab.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#1f1f1f] bg-[#0a0a0a]">
          <table className="w-full min-w-[960px] border-collapse">
            <thead>
              <tr className="border-b border-[#1a1a1a] bg-[#050505]">
                <th className="sticky left-0 z-10 bg-[#050505] px-4 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-[#606060]">
                  Client
                </th>
                <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-[#606060]">
                  Pod
                </th>
                {weeks.map((w) => (
                  <th
                    key={w.weekKey}
                    title={`${w.start.toISOString().slice(0, 10)} → ${w.end.toISOString().slice(0, 10)}`}
                    className="px-2 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-[#606060]"
                  >
                    {w.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-wider text-[#606060]">
                  Month total
                </th>
                <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-[#606060]">
                  8-week trend
                </th>
              </tr>
            </thead>
            <tbody>
              {clientRows.map((row) => {
                const totals = rowTotals.get(row.clientId) ?? { delivered: 0, goal: 0 };
                const sparkData = lookbackKeys.map(
                  (wk) => actualByWeek.get(wk)?.get(row.clientId)?.delivered ?? 0,
                );
                const sparkMax = Math.max(1, ...sparkData);
                return (
                  <tr
                    key={`${row.podId ?? "u"}-${row.clientId}`}
                    className="border-b border-[#161616] last:border-0 hover:bg-[#111111]"
                  >
                    <td className="sticky left-0 z-10 bg-[#0a0a0a] px-4 py-2 text-xs font-medium text-white">
                      {row.clientName}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-[#C4BCAA]">
                      {row.podName}
                    </td>
                    {weeks.map((w) => {
                      const cell = actualByWeek.get(w.weekKey)?.get(row.clientId) ?? {
                        delivered: 0,
                        goal: 0,
                      };
                      return (
                        <td key={w.weekKey} className="px-1 py-1 text-center align-middle">
                          <WeekCell
                            disabled={closed}
                            delivered={cell.delivered}
                            goal={cell.goal}
                            onChangeDelivered={(v) =>
                              setWeeklyActual(w.weekKey, row.clientId, row.podId, {
                                deliveredArticles: v,
                                goalArticles: cell.goal,
                              })
                            }
                            onChangeGoal={(v) =>
                              setWeeklyActual(w.weekKey, row.clientId, row.podId, {
                                deliveredArticles: cell.delivered,
                                goalArticles: v,
                              })
                            }
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right font-mono text-xs text-white">
                      <span
                        className={
                          totals.delivered >= totals.goal
                            ? "text-[#65FFAA]"
                            : totals.delivered < totals.goal - 1
                              ? "text-[#ED6958]"
                              : "text-[#F5C542]"
                        }
                      >
                        {totals.delivered}
                      </span>
                      <span className="text-[#606060]"> / {totals.goal}</span>
                    </td>
                    <td className="px-3 py-2">
                      <Sparkline data={sparkData} max={sparkMax} />
                    </td>
                  </tr>
                );
              })}

              {/* Column totals */}
              <tr className="border-t-2 border-[#1f1f1f] bg-[#050505]">
                <td
                  colSpan={2}
                  className="sticky left-0 z-10 bg-[#050505] px-4 py-2 text-right font-mono text-[10px] uppercase tracking-widest text-[#606060]"
                >
                  Total
                </td>
                {columnTotals.map((t, i) => (
                  <td
                    key={weeks[i].weekKey}
                    className="px-2 py-2 text-center font-mono text-[11px]"
                  >
                    <span
                      className={
                        t.delivered >= t.goal
                          ? "text-[#65FFAA]"
                          : t.delivered < t.goal - 1
                            ? "text-[#ED6958]"
                            : "text-[#F5C542]"
                      }
                    >
                      {t.delivered}
                    </span>
                    <span className="text-[#606060]"> / {t.goal}</span>
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-mono text-[11px] text-[#C4BCAA]">
                  {columnTotals.reduce((s, t) => s + t.delivered, 0)}
                  <span className="text-[#606060]">
                    {" "}
                    / {columnTotals.reduce((s, t) => s + t.goal, 0)}
                  </span>
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-start gap-3 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3 text-[11px] text-[#C4BCAA]">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#606060]">
          Legend
        </span>
        <span>
          <span className="mx-1 text-[#65FFAA]">green</span>= on / over goal ·
          <span className="mx-1 text-[#F5C542]">yellow</span>= within 1 ·
          <span className="mx-1 text-[#ED6958]">red</span>= short by &gt; 1.
        </span>
        <span className="ml-auto font-mono text-[10px] text-[#606060]">
          cp2_fact_actuals_weekly
        </span>
      </div>
    </div>
  );
}

function WeekCell({
  disabled,
  delivered,
  goal,
  onChangeDelivered,
  onChangeGoal,
}: {
  disabled: boolean;
  delivered: number;
  goal: number;
  onChangeDelivered: (v: number) => void;
  onChangeGoal: (v: number) => void;
}) {
  const tone =
    delivered >= goal
      ? "border-[#42CA80]/30 bg-[#42CA80]/5"
      : delivered < goal - 1
        ? "border-[#ED6958]/30 bg-[#ED6958]/5"
        : "border-[#F5C542]/30 bg-[#F5C542]/5";

  return (
    <div
      className={`mx-auto flex w-[70px] flex-col gap-0.5 rounded border ${tone} px-1 py-0.5 ${
        disabled ? "opacity-60" : ""
      }`}
    >
      <input
        type="number"
        min={0}
        value={delivered}
        disabled={disabled}
        onChange={(e) => onChangeDelivered(parseInt(e.target.value || "0", 10))}
        className="w-full bg-transparent text-center font-mono text-[11px] text-white outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        title="Delivered"
      />
      <input
        type="number"
        min={0}
        value={goal}
        disabled={disabled}
        onChange={(e) => onChangeGoal(parseInt(e.target.value || "0", 10))}
        className="w-full bg-transparent text-center font-mono text-[10px] text-[#606060] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        title="Goal"
      />
    </div>
  );
}

function Sparkline({ data, max }: { data: number[]; max: number }) {
  const w = 96;
  const h = 28;
  const step = data.length > 1 ? w / (data.length - 1) : 0;
  const points = data
    .map((v, i) => `${i * step},${h - (v / max) * (h - 4) - 2}`)
    .join(" ");
  const last = data[data.length - 1] ?? 0;
  const prev = data[data.length - 2] ?? last;
  const trendColor = last > prev ? "#65FFAA" : last < prev ? "#ED6958" : "#C4BCAA";
  return (
    <svg width={w} height={h} className="block">
      <polyline
        fill="none"
        stroke={trendColor}
        strokeWidth={1.25}
        points={points}
        vectorEffect="non-scaling-stroke"
      />
      {data.length > 0 && (
        <circle
          cx={(data.length - 1) * step}
          cy={h - (last / max) * (h - 4) - 2}
          r={1.8}
          fill={trendColor}
        />
      )}
    </svg>
  );
}
