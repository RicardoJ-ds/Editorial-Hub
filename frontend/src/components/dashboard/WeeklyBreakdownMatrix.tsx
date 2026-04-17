"use client";

import React, { useMemo } from "react";
import type { GoalsVsDeliveryRow } from "@/lib/types";
import { DataSourceBadge } from "./DataSourceBadge";
import { cn } from "@/lib/utils";

interface Props {
  /** Every row from /api/goals-delivery/by-month/{month} for the selected month. */
  rows: GoalsVsDeliveryRow[];
  /** Month label used for the section heading (e.g. "September 2025"). */
  monthLabel?: string;
}

interface ClientGroup {
  client_name: string;
  /** Keyed by week number. */
  byWeek: Map<number, GoalsVsDeliveryRow>;
  cbGoal: number;
  adGoal: number;
  cbToDate: number;
  adToDate: number;
}

/** Compact cell: shows a week's CB or AD delivered count. Green tint when >0. */
function WeekCell({ value }: { value: number | null | undefined }) {
  const v = value ?? 0;
  if (v <= 0) {
    return (
      <span className="inline-block w-full text-center font-mono text-[10px] text-[#404040] tabular-nums">
        —
      </span>
    );
  }
  return (
    <span
      className="inline-block w-full text-center font-mono text-[10px] font-semibold tabular-nums"
      style={{
        color: "#42CA80",
        backgroundColor: "rgba(66,202,128,0.08)",
        borderRadius: 3,
        padding: "1px 4px",
      }}
    >
      +{v}
    </span>
  );
}

function TotalCell({
  delivered,
  goal,
}: {
  delivered: number;
  goal: number;
}) {
  const pct = goal > 0 ? Math.round((delivered / goal) * 100) : 0;
  const color =
    goal === 0
      ? "#606060"
      : pct >= 75
      ? "#42CA80"
      : pct >= 50
      ? "#F5BC4E"
      : "#ED6958";
  return (
    <div className="flex flex-col items-end">
      <span className="font-mono text-[10px] font-semibold tabular-nums" style={{ color }}>
        {delivered}/{goal || "—"}
      </span>
      <span className="font-mono text-[9px] text-[#606060]">
        {goal > 0 ? `${pct}%` : ""}
      </span>
    </div>
  );
}

export function WeeklyBreakdownMatrix({ rows, monthLabel }: Props) {
  // Group rows by client + enumerate weeks actually present in the data
  const { groups, weeks } = useMemo(() => {
    const weekSet = new Set<number>();
    const byClient = new Map<string, ClientGroup>();
    for (const r of rows) {
      weekSet.add(r.week_number);
      let g = byClient.get(r.client_name);
      if (!g) {
        g = {
          client_name: r.client_name,
          byWeek: new Map(),
          cbGoal: 0,
          adGoal: 0,
          cbToDate: 0,
          adToDate: 0,
        };
        byClient.set(r.client_name, g);
      }
      g.byWeek.set(r.week_number, r);
      // Take the last week's cumulative + goal values as authoritative
      if ((r.cb_monthly_goal ?? 0) > g.cbGoal) g.cbGoal = r.cb_monthly_goal ?? 0;
      if ((r.ad_monthly_goal ?? 0) > g.adGoal) g.adGoal = r.ad_monthly_goal ?? 0;
      if ((r.cb_delivered_to_date ?? 0) > g.cbToDate) g.cbToDate = r.cb_delivered_to_date ?? 0;
      if ((r.ad_delivered_to_date ?? 0) > g.adToDate) g.adToDate = r.ad_delivered_to_date ?? 0;
    }
    return {
      groups: Array.from(byClient.values()).sort((a, b) =>
        a.client_name.localeCompare(b.client_name)
      ),
      weeks: Array.from(weekSet).sort((a, b) => a - b),
    };
  }, [rows]);

  // Column totals (per week, for CB and AD)
  const weekTotals = useMemo(() => {
    const map = new Map<number, { cb: number; ad: number }>();
    for (const w of weeks) map.set(w, { cb: 0, ad: 0 });
    for (const g of groups) {
      for (const w of weeks) {
        const row = g.byWeek.get(w);
        if (!row) continue;
        const t = map.get(w)!;
        t.cb += row.cb_delivered_today ?? 0;
        t.ad += row.ad_delivered_today ?? 0;
      }
    }
    return map;
  }, [groups, weeks]);

  const totalCbGoal = groups.reduce((a, g) => a + g.cbGoal, 0);
  const totalAdGoal = groups.reduce((a, g) => a + g.adGoal, 0);
  const totalCbToDate = groups.reduce((a, g) => a + g.cbToDate, 0);
  const totalAdToDate = groups.reduce((a, g) => a + g.adToDate, 0);

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div>
        <h4 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
          Weekly Breakdown{monthLabel ? ` — ${monthLabel}` : ""}{" "}
          <DataSourceBadge
            type="live"
            source="Sheet: '[Month Year] Goals vs Delivery' — Spreadsheet: Master Tracker. One row per client per week. CB = content briefs delivered that week, AD = article drafts delivered that week. Totals column on the right is cumulative for the month."
          />
        </h4>
        <p className="text-[10px] text-[#606060] mt-0.5">
          Every Week N: Content Briefs and Week N: Article Drafts column from the sheet, rendered side by side for all clients. Green cells = work delivered in that week; dash = no work.
        </p>
      </div>

      <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[#2a2a2a]">
              <th
                rowSpan={2}
                className="sticky left-0 z-10 bg-[#1F1F1F] px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-[#606060]"
              >
                Client
              </th>
              {weeks.map((w, i) => (
                <th
                  key={`wk-${w}`}
                  colSpan={2}
                  className={cn(
                    "bg-[#1F1F1F] px-2 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA]",
                    i < weeks.length - 1 && "border-r border-[#2a2a2a]"
                  )}
                >
                  Week {w}
                </th>
              ))}
              <th
                colSpan={2}
                className="bg-[#1F1F1F] px-2 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-[#42CA80] border-l border-[#2a2a2a]"
              >
                Month Totals
              </th>
            </tr>
            <tr className="border-b border-[#2a2a2a]">
              {weeks.map((w, i) => (
                <React.Fragment key={`sub-${w}`}>
                  <th className="bg-[#141414] px-2 py-1 text-center font-mono text-[9px] uppercase tracking-wider text-[#606060]">
                    CB
                  </th>
                  <th
                    className={cn(
                      "bg-[#141414] px-2 py-1 text-center font-mono text-[9px] uppercase tracking-wider text-[#606060]",
                      i < weeks.length - 1 && "border-r border-[#2a2a2a]"
                    )}
                  >
                    Art
                  </th>
                </React.Fragment>
              ))}
              <th className="bg-[#141414] px-2 py-1 text-center font-mono text-[9px] uppercase tracking-wider text-[#606060] border-l border-[#2a2a2a]">
                CB
              </th>
              <th className="bg-[#141414] px-2 py-1 text-center font-mono text-[9px] uppercase tracking-wider text-[#606060]">
                Art
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr
                key={g.client_name}
                className="border-b border-[#1f1f1f] hover:bg-[#1a1a1a] transition-colors"
              >
                <td className="sticky left-0 z-10 bg-[#161616] px-3 py-1.5 font-mono text-xs text-white whitespace-nowrap max-w-[160px] truncate">
                  {g.client_name}
                </td>
                {weeks.map((w, i) => {
                  const row = g.byWeek.get(w);
                  return (
                    <React.Fragment key={`${g.client_name}-${w}`}>
                      <td className="px-2 py-1.5">
                        <WeekCell value={row?.cb_delivered_today} />
                      </td>
                      <td
                        className={cn(
                          "px-2 py-1.5",
                          i < weeks.length - 1 && "border-r border-[#1f1f1f]"
                        )}
                      >
                        <WeekCell value={row?.ad_delivered_today} />
                      </td>
                    </React.Fragment>
                  );
                })}
                <td className="px-2 py-1.5 text-right border-l border-[#2a2a2a]">
                  <TotalCell delivered={g.cbToDate} goal={g.cbGoal} />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <TotalCell delivered={g.adToDate} goal={g.adGoal} />
                </td>
              </tr>
            ))}
            {/* Footer totals */}
            <tr className="bg-[#0d0d0d] border-t border-[#2a2a2a]">
              <td className="sticky left-0 z-10 bg-[#0d0d0d] px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-[#606060]">
                Totals
              </td>
              {weeks.map((w, i) => {
                const t = weekTotals.get(w)!;
                return (
                  <React.Fragment key={`tot-${w}`}>
                    <td className="px-2 py-2 text-center font-mono text-[10px] font-semibold tabular-nums text-[#42CA80]">
                      {t.cb > 0 ? `+${t.cb}` : "—"}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-2 text-center font-mono text-[10px] font-semibold tabular-nums text-[#42CA80]",
                        i < weeks.length - 1 && "border-r border-[#2a2a2a]"
                      )}
                    >
                      {t.ad > 0 ? `+${t.ad}` : "—"}
                    </td>
                  </React.Fragment>
                );
              })}
              <td className="px-2 py-2 text-right border-l border-[#2a2a2a]">
                <TotalCell delivered={totalCbToDate} goal={totalCbGoal} />
              </td>
              <td className="px-2 py-2 text-right">
                <TotalCell delivered={totalAdToDate} goal={totalAdGoal} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
