"use client";

import React, { useMemo, useState } from "react";
import type { Client, GoalsVsDeliveryRow } from "@/lib/types";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { podBadge } from "./shared-helpers";
import { normalizePod, sortPodKey } from "./ContractClientProgress";
import type { DateRange } from "./DateRangeFilter";

// ---------------------------------------------------------------------------
// GoalsMonthTable
// ---------------------------------------------------------------------------
//
// Replaces the old Goal Achievement bar chart + Weekly Breakdown matrix with
// a single unified view:
//   • Fixed columns per client: range-wide Goal, Delivered, Progress bar, %
//   • One column per month in the active date range showing del/goal
//   • Click a month header to expand it into Week 1–5 sub-columns (raw
//     per-week delivery counts — not `+N` deltas). Only one month open at a
//     time, so width stays manageable.
//   • Metric toggle (CBs / Articles) flips the whole table to the other
//     metric without refetching. Both metrics always visible on the summary
//     cards above this table.
// ---------------------------------------------------------------------------

type Metric = "cb" | "ad";

interface Props {
  rows: GoalsVsDeliveryRow[];
  filteredClients: Client[];
  dateRange?: DateRange;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseMonthYear(s: string): Date | null {
  if (!s) return null;
  const m = s.trim().match(/^(\w+)\s+(\d{4})$/);
  if (!m) return null;
  const idx = MONTH_NAMES.indexOf(m[1]);
  if (idx < 0) return null;
  return new Date(parseInt(m[2], 10), idx, 1);
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthShortLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function resolveDateRange(r: DateRange | undefined): [Date | null, Date | null] {
  if (!r || r.type !== "range") return [null, null];
  const start = r.from ?? null;
  const end = r.to ?? r.from ?? null;
  return [start, end];
}

function pctColor(pct: number): string {
  if (pct >= 85) return "#42CA80";
  if (pct >= 70) return "#8CD59A";
  if (pct >= 50) return "#F5BC4E";
  if (pct > 0) return "#ED6958";
  return "#404040";
}

interface MonthAgg {
  key: string;
  label: string;
  date: Date;
  goal: number;
  delivered: number;       // max(_to_date across weeks) — the final cumulative
  byWeek: Map<number, number>;  // week_number → _today count
}

interface ClientAgg {
  name: string;
  pod: string;
  months: Map<string, MonthAgg>;
  totalGoal: number;
  totalDelivered: number;
}

export function GoalsMonthTable({ rows, filteredClients, dateRange }: Props) {
  const [metric, setMetric] = useState<Metric>("cb");
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const names = new Set(filteredClients.map((c) => c.name));
    const [start, end] = resolveDateRange(dateRange);
    return rows.filter((r) => {
      if (!names.has(r.client_name)) return false;
      const d = parseMonthYear(r.month_year);
      if (!d) return false;
      if (start) {
        const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        if (monthEnd < start) return false;
      }
      if (end && d > end) return false;
      return true;
    });
  }, [rows, filteredClients, dateRange]);

  const clientToPod = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of filteredClients) {
      map.set(c.name, normalizePod(c.editorial_pod) || "Unassigned");
    }
    return map;
  }, [filteredClients]);

  const { months, clients, weekNumbers } = useMemo(() => {
    const monthByKey = new Map<string, Date>();
    const byClient = new Map<string, ClientAgg>();
    const weeksSet = new Set<number>();

    for (const r of filtered) {
      const d = parseMonthYear(r.month_year);
      if (!d) continue;
      const mk = monthKey(d);
      monthByKey.set(mk, d);
      weeksSet.add(r.week_number);

      let c = byClient.get(r.client_name);
      if (!c) {
        c = {
          name: r.client_name,
          pod: clientToPod.get(r.client_name) || "Unassigned",
          months: new Map(),
          totalGoal: 0,
          totalDelivered: 0,
        };
        byClient.set(r.client_name, c);
      }

      let m = c.months.get(mk);
      if (!m) {
        m = { key: mk, label: monthShortLabel(d), date: d, goal: 0, delivered: 0, byWeek: new Map() };
        c.months.set(mk, m);
      }

      const goal = metric === "cb" ? (r.cb_monthly_goal ?? 0) : (r.ad_monthly_goal ?? 0);
      if (goal > m.goal) m.goal = goal;

      const thisWeek = metric === "cb" ? (r.cb_delivered_today ?? 0) : (r.ad_delivered_today ?? 0);
      m.byWeek.set(r.week_number, (m.byWeek.get(r.week_number) ?? 0) + thisWeek);

      const toDate = metric === "cb" ? (r.cb_delivered_to_date ?? 0) : (r.ad_delivered_to_date ?? 0);
      if (toDate > m.delivered) m.delivered = toDate;
    }

    for (const c of byClient.values()) {
      for (const m of c.months.values()) {
        // Only count deliveries in months that had a goal — matches the
        // summary cards, pod gauges, and each month cell (which renders "—"
        // for goal-less months). Pre-goal ramp-up months don't contribute.
        if (m.goal > 0) {
          c.totalGoal += m.goal;
          c.totalDelivered += m.delivered;
        }
      }
    }

    const months = Array.from(monthByKey.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, date]) => ({ key, date, label: monthShortLabel(date) }));

    const clients = Array.from(byClient.values()).sort((a, b) => {
      const pd = sortPodKey(a.pod, b.pod);
      if (pd !== 0) return pd;
      return a.name.localeCompare(b.name);
    });

    const weekNumbers = Array.from(weeksSet).sort((a, b) => a - b);

    return { months, clients, weekNumbers };
  }, [filtered, clientToPod, metric]);

  if (clients.length === 0 || months.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#2a2a2a] bg-[#0c0c0c] px-4 py-8 text-center text-xs text-[#909090]">
        No Goals vs Delivery data for the selected filters.
      </div>
    );
  }

  const metricLabel = metric === "cb" ? "Content Briefs" : "Articles";

  return (
    <div className="space-y-3">
      {/* Metric toggle */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#909090]">
          Metric
        </span>
        <div className="inline-flex rounded-md bg-[#0d0d0d] p-0.5 border border-[#1f1f1f]">
          {(["cb", "ad"] as Metric[]).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={cn(
                "px-3 py-1 text-[11px] font-mono uppercase tracking-wider rounded transition-colors",
                metric === m
                  ? "bg-[#42CA80]/15 text-[#42CA80]"
                  : "text-[#909090] hover:text-white",
              )}
            >
              {m === "cb" ? "Content Briefs" : "Articles"}
            </button>
          ))}
        </div>
        <span className="font-mono text-[11px] text-[#606060] ml-auto">
          {clients.length} clients · {months.length} month{months.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[#2a2a2a] bg-[#0d0d0d]">
              <th className="sticky left-0 z-10 bg-[#0d0d0d] px-3 py-2 text-left text-[11px] font-mono uppercase tracking-wider text-[#C4BCAA] min-w-[180px]">
                Client
              </th>
              <th className="px-2 py-2 text-right text-[11px] font-mono uppercase tracking-wider text-[#C4BCAA] whitespace-nowrap">
                Goal
              </th>
              <th className="px-2 py-2 text-right text-[11px] font-mono uppercase tracking-wider text-[#C4BCAA] whitespace-nowrap">
                Delivered
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-mono uppercase tracking-wider text-[#C4BCAA] min-w-[140px]">
                Progress
              </th>
              <th className="px-2 py-2 text-right text-[11px] font-mono uppercase tracking-wider text-[#C4BCAA] whitespace-nowrap">
                %
              </th>
              {months.map((m) => {
                const isExpanded = expandedMonth === m.key;
                return (
                  <th
                    key={m.key}
                    colSpan={isExpanded ? weekNumbers.length + 1 : 1}
                    className={cn(
                      "px-2 py-2 text-center text-[11px] font-mono uppercase tracking-wider border-l border-[#2a2a2a] whitespace-nowrap",
                      isExpanded ? "bg-[#1f1f1f] text-[#42CA80]" : "text-[#C4BCAA]",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedMonth((cur) => (cur === m.key ? null : m.key))
                      }
                      className="inline-flex items-center gap-1 hover:text-white transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                      {m.label}
                    </button>
                  </th>
                );
              })}
            </tr>
            {/* Sub-header row: week numbers under the expanded month */}
            {expandedMonth && (
              <tr className="border-b border-[#2a2a2a] bg-[#0d0d0d]">
                <th
                  className="sticky left-0 z-10 bg-[#0d0d0d] px-3 py-1"
                  colSpan={5}
                />
                {months.map((m) => {
                  const isExpanded = expandedMonth === m.key;
                  if (!isExpanded) {
                    return <th key={`${m.key}-sub`} className="border-l border-[#2a2a2a]" />;
                  }
                  return (
                    <React.Fragment key={`${m.key}-sub`}>
                      {weekNumbers.map((w, i) => (
                        <th
                          key={`${m.key}-w${w}`}
                          className={cn(
                            "px-2 py-1 text-center text-[10px] font-mono text-[#909090] bg-[#1f1f1f] whitespace-nowrap",
                            i === 0 && "border-l border-[#2a2a2a]",
                          )}
                        >
                          W{w}
                        </th>
                      ))}
                      <th className="px-2 py-1 text-center text-[10px] font-mono text-[#909090] bg-[#1f1f1f] whitespace-nowrap">
                        Total
                      </th>
                    </React.Fragment>
                  );
                })}
              </tr>
            )}
          </thead>
          <tbody>
            {clients.map((c) => {
              const pct = c.totalGoal > 0 ? (c.totalDelivered / c.totalGoal) * 100 : 0;
              const color = pctColor(pct);
              const barPct = Math.min(pct, 100);

              return (
                <tr
                  key={c.name}
                  className="border-b border-[#1f1f1f] hover:bg-[#1a1a1a] transition-colors"
                >
                  <td className="sticky left-0 z-10 bg-[#161616] px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      {podBadge(c.pod)}
                      <span className="font-semibold text-white text-[12px] truncate">
                        {c.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-[#C4BCAA]">
                    {c.totalGoal > 0 ? c.totalGoal : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-white">
                    {c.totalDelivered > 0 ? c.totalDelivered : "—"}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-[#2a2a2a] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${barPct}%`, backgroundColor: color, opacity: 0.85 }}
                        />
                      </div>
                    </div>
                  </td>
                  <td
                    className="px-2 py-1.5 text-right font-mono text-xs font-semibold tabular-nums"
                    style={{ color }}
                  >
                    {c.totalGoal > 0 ? `${Math.round(pct)}%` : "—"}
                  </td>
                  {months.map((m) => {
                    const agg = c.months.get(m.key);
                    const isExpanded = expandedMonth === m.key;
                    if (isExpanded) {
                      // Per-week cells + total
                      return (
                        <React.Fragment key={`${c.name}-${m.key}`}>
                          {weekNumbers.map((w, i) => {
                            const v = agg?.byWeek.get(w) ?? 0;
                            return (
                              <td
                                key={`${c.name}-${m.key}-w${w}`}
                                className={cn(
                                  "px-2 py-1.5 text-center font-mono text-xs tabular-nums bg-[#1a1a1a]",
                                  i === 0 && "border-l border-[#2a2a2a]",
                                  v > 0 ? "text-[#42CA80] font-semibold" : "text-[#404040]",
                                )}
                              >
                                {v > 0 ? v : "—"}
                              </td>
                            );
                          })}
                          <td className="px-2 py-1.5 text-center font-mono text-xs tabular-nums bg-[#1a1a1a]">
                            <MonthSummaryCell agg={agg} />
                          </td>
                        </React.Fragment>
                      );
                    }
                    return (
                      <td
                        key={`${c.name}-${m.key}`}
                        className="px-2 py-1.5 text-center font-mono text-xs tabular-nums border-l border-[#1f1f1f]"
                      >
                        <MonthSummaryCell agg={agg} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-[#909090]">
        Showing <span className="text-[#C4BCAA]">{metricLabel}</span>.
        Click a month header to expand its weekly breakdown (one at a time).
      </p>
    </div>
  );
}

function MonthSummaryCell({ agg }: { agg: MonthAgg | undefined }) {
  if (!agg || agg.goal === 0) {
    return <span className="text-[#404040]">—</span>;
  }
  const pct = (agg.delivered / agg.goal) * 100;
  const color = pctColor(pct);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span style={{ color }} className="font-semibold tabular-nums">
        {agg.delivered}
      </span>
      <span className="text-[#606060]">/</span>
      <span className="text-[#C4BCAA] tabular-nums">{agg.goal}</span>
    </span>
  );
}
