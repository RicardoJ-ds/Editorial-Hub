"use client";

import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataSourceBadge } from "@/components/dashboard/DataSourceBadge";
import type { Client, DeliverableMonthly } from "@/lib/types";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Redesign rationale (Apr 2026):
// The previous implementation was a line chart with 7 overlapping pod series.
// Pods invoice in bursts — a single catch-up month would spike to 300% and
// crush the rest of the series into a flat band. Users asked for something
// readable; a heatmap serves this shape of data far better than a line chart:
// - One color-coded cell per (pod × month) = easy month/pod scan
// - Bursts stand out instead of warping the axis
// - An "All pods" header row gives the portfolio view alongside the detail
// - Tooltip carries the raw % + the invoiced/delivered numbers behind it
// The "Per month" / "Cumulative" toggle is preserved.
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const POD_COLORS: Record<string, string> = {
  "Pod 1": "#8FB5D9",
  "Pod 2": "#42CA80",
  "Pod 3": "#F5C542",
  "Pod 4": "#F28D59",
  "Pod 5": "#ED6958",
  "Pod 6": "#CEBCF4",
  "Pod 7": "#7FE8D6",
  Unassigned: "#606060",
};

const ALL_KEY = "All pods";

function normalizePod(raw: string | null | undefined): string {
  if (raw == null) return "Unassigned";
  const t = String(raw).trim();
  if (!t || t === "-" || t === "—") return "Unassigned";
  const n = t.match(/^(\d+)$/);
  if (n) return `Pod ${n[1]}`;
  const p = t.match(/^p(?:od)?\s*(\d+)$/i);
  if (p) return `Pod ${p[1]}`;
  return t;
}

function sortPodKey(a: string, b: string) {
  if (a === "Unassigned" && b !== "Unassigned") return 1;
  if (b === "Unassigned" && a !== "Unassigned") return -1;
  const na = parseInt(a.replace(/\D/g, ""), 10);
  const nb = parseInt(b.replace(/\D/g, ""), 10);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

// Map a % into a dark-theme heatmap color:
//   <25%   = deep red       (severely behind on invoicing)
//   25–75% = red/amber ramp
//   75–100% = amber/green ramp
//   ≈100% = healthy green (optimal: delivered = invoiced)
//   >100% = cyan/blue (catch-up month — invoicing past work)
// Returns a background color + text color for contrast.
function heatColor(pct: number | null): { bg: string; fg: string; border: string } {
  if (pct == null) return { bg: "#0f0f0f", fg: "#404040", border: "#1a1a1a" };
  if (pct < 25) return { bg: "#5b1e1e", fg: "#FFB8B0", border: "#7a2828" };
  if (pct < 50) return { bg: "#6d2727", fg: "#F5A99A", border: "#8a3434" };
  if (pct < 75) return { bg: "#6d4a1e", fg: "#F5BC4E", border: "#8a6128" };
  if (pct < 90) return { bg: "#5e5721", fg: "#F5E078", border: "#78702c" };
  if (pct < 110) return { bg: "#1f4d2e", fg: "#65FFAA", border: "#2a6b3f" };
  if (pct < 150) return { bg: "#1f4a4d", fg: "#7FE8D6", border: "#2a6568" };
  return { bg: "#1f3a6b", fg: "#8FB5D9", border: "#2a4f8c" };
}

function pctLabel(pct: number | null): string {
  if (pct == null) return "—";
  return `${Math.round(pct)}%`;
}

interface DeliveryTrendChartProps {
  deliverables: DeliverableMonthly[];
  clients: Client[];
}

type Mode = "monthly" | "cumulative";

type Cell = {
  delivered: number;
  invoiced: number;
  pct: number | null;
};

type Tooltip = {
  x: number;
  y: number;
  pod: string;
  monthLabel: string;
  delivered: number;
  invoiced: number;
  pct: number | null;
} | null;

export function DeliveryTrendChart({ deliverables, clients }: DeliveryTrendChartProps) {
  const [mode, setMode] = useState<Mode>("monthly");
  const [tooltip, setTooltip] = useState<Tooltip>(null);

  const clientToPod = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of clients) map.set(c.id, normalizePod(c.editorial_pod));
    return map;
  }, [clients]);

  // Build the grid: rows = pods (+ All pods header), columns = months.
  const { rows, columns } = useMemo(() => {
    // Per-month per-pod aggregation
    type MonthBucket = {
      sortKey: number;
      label: string;
      pods: Map<string, { delivered: number; invoiced: number }>;
    };
    const byMonth = new Map<string, MonthBucket>();
    const podSet = new Set<string>();

    for (const d of deliverables) {
      const pod = clientToPod.get(d.client_id) ?? "Unassigned";
      podSet.add(pod);
      const key = `${d.year}-${String(d.month).padStart(2, "0")}`;
      const label = `${MONTH_NAMES[d.month]} ${String(d.year).slice(-2)}`;
      const sortKey = d.year * 100 + d.month;
      let m = byMonth.get(key);
      if (!m) {
        m = { sortKey, label, pods: new Map() };
        byMonth.set(key, m);
      }
      let p = m.pods.get(pod);
      if (!p) {
        p = { delivered: 0, invoiced: 0 };
        m.pods.set(pod, p);
      }
      p.delivered += d.articles_delivered ?? 0;
      p.invoiced += d.articles_invoiced ?? 0;
    }

    const months = Array.from(byMonth.values()).sort((a, b) => a.sortKey - b.sortKey);
    const allPods = Array.from(podSet).sort(sortPodKey);

    // Running cumulative state per pod (for cumulative mode)
    const cumByPod = new Map<string, { delivered: number; invoiced: number }>();
    let cumAll = { delivered: 0, invoiced: 0 };

    const columns = months.map((m) => ({ key: m.label, label: m.label }));

    // All-pods row first (aggregate across every pod for each month)
    const rows: Array<{ pod: string; cells: Cell[] }> = [];

    const allCells: Cell[] = months.map((m) => {
      let d = 0;
      let i = 0;
      for (const pod of allPods) {
        const stats = m.pods.get(pod);
        if (!stats) continue;
        d += stats.delivered;
        i += stats.invoiced;
      }
      if (mode === "cumulative") {
        cumAll.delivered += d;
        cumAll.invoiced += i;
        return {
          delivered: cumAll.delivered,
          invoiced: cumAll.invoiced,
          pct: cumAll.delivered > 0
            ? (cumAll.invoiced / cumAll.delivered) * 100
            : null,
        };
      }
      return {
        delivered: d,
        invoiced: i,
        pct: d > 0 ? (i / d) * 100 : null,
      };
    });
    rows.push({ pod: ALL_KEY, cells: allCells });

    for (const pod of allPods) {
      const cells: Cell[] = months.map((m) => {
        const stats = m.pods.get(pod) ?? { delivered: 0, invoiced: 0 };
        if (mode === "cumulative") {
          const prev = cumByPod.get(pod) ?? { delivered: 0, invoiced: 0 };
          prev.delivered += stats.delivered;
          prev.invoiced += stats.invoiced;
          cumByPod.set(pod, prev);
          return {
            delivered: prev.delivered,
            invoiced: prev.invoiced,
            pct: prev.delivered > 0
              ? (prev.invoiced / prev.delivered) * 100
              : null,
          };
        }
        return {
          delivered: stats.delivered,
          invoiced: stats.invoiced,
          pct: stats.delivered > 0
            ? (stats.invoiced / stats.delivered) * 100
            : null,
        };
      });
      rows.push({ pod, cells });
    }
    return { rows, columns };
  }, [deliverables, clientToPod, mode]);

  if (rows.length === 0) {
    return (
      <Card className="border-[#2a2a2a] bg-[#161616]">
        <CardContent className="pt-0">
          <p className="text-center text-sm text-[#606060]">
            No delivery data available for chart.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-[#2a2a2a] bg-[#161616]">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-white">
              Invoicing vs Delivery %{" "}
              <DataSourceBadge
                type="live"
                source="Sheet: 'Delivered vs Invoiced v2' — Spreadsheet: Editorial Capacity Planning. Monthly articles_invoiced ÷ articles_delivered per editorial pod. 100% = every delivered article is invoiced in-period; <100% = work still unbilled; >100% = catch-up invoicing for earlier months."
              />
            </CardTitle>
            <p className="mt-0.5 text-[10px] font-mono text-[#C4BCAA]">
              Each cell = Invoiced ÷ Delivered for that pod × month. Red = behind on billing, green ≈ healthy, teal/blue = catch-up month. Hover for the raw counts.
            </p>
          </div>
          <div className="flex gap-1 rounded-md bg-[#0d0d0d] p-0.5 shrink-0">
            {(["monthly", "cumulative"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "px-2.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider transition-colors",
                  mode === m
                    ? "bg-[#42CA80]/15 text-[#42CA80]"
                    : "text-[#606060] hover:text-white",
                )}
              >
                {m === "monthly" ? "Per month" : "Cumulative"}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Heatmap table — pods on rows, months on columns */}
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-max border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-[#161616] px-2 pb-2 text-left font-mono text-[9px] uppercase tracking-wider text-[#606060]">
                  Pod
                </th>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className="px-0.5 pb-2 text-center font-mono text-[8px] uppercase tracking-wider text-[#606060]"
                    style={{ minWidth: 38 }}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => {
                const isAll = row.pod === ALL_KEY;
                return (
                  <tr
                    key={row.pod}
                    className={cn(
                      isAll && "border-b-2 border-[#2a2a2a]",
                    )}
                  >
                    <td
                      className={cn(
                        "sticky left-0 z-10 bg-[#161616] px-2 py-1.5 font-mono text-[10px] whitespace-nowrap",
                        isAll
                          ? "font-semibold text-white"
                          : "text-[#C4BCAA]",
                      )}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{
                            backgroundColor: isAll
                              ? "#FFFFFF"
                              : POD_COLORS[row.pod] ?? "#606060",
                          }}
                        />
                        {row.pod}
                      </span>
                    </td>
                    {row.cells.map((cell, ci) => {
                      const { bg, fg, border } = heatColor(cell.pct);
                      return (
                        <td
                          key={`${row.pod}-${ci}`}
                          className="px-0.5 py-0.5"
                        >
                          <div
                            className={cn(
                              "flex h-7 items-center justify-center rounded font-mono text-[9px] font-semibold",
                              isAll && "h-8 text-[10px]",
                            )}
                            style={{
                              backgroundColor: bg,
                              color: fg,
                              border: `1px solid ${border}`,
                              minWidth: 34,
                            }}
                            onMouseEnter={(e) => {
                              const r = e.currentTarget.getBoundingClientRect();
                              setTooltip({
                                x: r.left + r.width / 2,
                                y: r.top - 6,
                                pod: row.pod,
                                monthLabel: columns[ci].label,
                                delivered: cell.delivered,
                                invoiced: cell.invoiced,
                                pct: cell.pct,
                              });
                            }}
                            onMouseLeave={() => setTooltip(null)}
                          >
                            {cell.pct == null ? (
                              <span style={{ color: "#404040" }}>—</span>
                            ) : (
                              pctLabel(cell.pct)
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Color legend */}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9px] text-[#606060]">
          <span className="uppercase tracking-wider">Color scale</span>
          {[
            { label: "<25%", color: heatColor(10) },
            { label: "25–50%", color: heatColor(35) },
            { label: "50–75%", color: heatColor(60) },
            { label: "75–90%", color: heatColor(82) },
            { label: "90–110%", color: heatColor(100) },
            { label: "110–150%", color: heatColor(130) },
            { label: ">150%", color: heatColor(180) },
          ].map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-3 rounded-[3px]"
                style={{
                  backgroundColor: s.color.bg,
                  border: `1px solid ${s.color.border}`,
                }}
              />
              {s.label}
            </span>
          ))}
        </div>

        {/* Floating tooltip */}
        {tooltip && (
          <div
            className="fixed z-[9999] pointer-events-none"
            style={{
              left: tooltip.x,
              top: tooltip.y,
              transform: "translate(-50%, -100%)",
            }}
          >
            <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 shadow-xl whitespace-nowrap">
              <p className="font-mono text-[11px] font-semibold text-white">
                {tooltip.pod} · {tooltip.monthLabel}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-[#C4BCAA]">
                {tooltip.pct == null ? (
                  <>No delivery this {mode === "cumulative" ? "period-to-date" : "month"}</>
                ) : (
                  <>
                    Invoiced / Delivered:{" "}
                    <span className="text-white">{tooltip.invoiced}</span>
                    {" / "}
                    <span className="text-white">{tooltip.delivered}</span>
                    {" = "}
                    <span
                      style={{ color: heatColor(tooltip.pct).fg }}
                      className="font-semibold"
                    >
                      {pctLabel(tooltip.pct)}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
