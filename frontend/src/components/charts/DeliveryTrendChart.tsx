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

type HeatBands = { thresholds: number[]; labels: string[] };

// Color bands are *mode-aware* because 110% means different things depending
// on whether you're looking at a single month (catch-up burst) or the running
// total (normal retainer billing pattern).
const HEAT_BANDS: Record<Mode, HeatBands> = {
  monthly: {
    thresholds: [25, 50, 75, 90, 110, 150],
    labels: ["<25%", "25–50%", "50–75%", "75–90%", "90–110%", "110–150%", ">150%"],
  },
  cumulative: {
    // Retainer clients invoice monthly commitments ahead of delivery, so the
    // cumulative ratio naturally sits between 100% and 125%. Shift bands so
    // 100–125% is the healthy green zone.
    thresholds: [60, 85, 95, 100, 125, 150],
    labels: ["<60%", "60–85%", "85–95%", "95–100%", "100–125%", "125–150%", ">150%"],
  },
};

// Map a % into a dark-theme heatmap color using the active mode's bands.
function heatColor(
  pct: number | null,
  mode: Mode,
): { bg: string; fg: string; border: string } {
  if (pct == null) return { bg: "#0f0f0f", fg: "#404040", border: "#1a1a1a" };
  const t = HEAT_BANDS[mode].thresholds;
  if (pct < t[0]) return { bg: "#5b1e1e", fg: "#FFB8B0", border: "#7a2828" };
  if (pct < t[1]) return { bg: "#6d2727", fg: "#F5A99A", border: "#8a3434" };
  if (pct < t[2]) return { bg: "#6d4a1e", fg: "#F5BC4E", border: "#8a6128" };
  if (pct < t[3]) return { bg: "#5e5721", fg: "#F5E078", border: "#78702c" };
  if (pct < t[4]) return { bg: "#1f4d2e", fg: "#65FFAA", border: "#2a6b3f" };
  if (pct < t[5]) return { bg: "#1f4a4d", fg: "#7FE8D6", border: "#2a6568" };
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

const MODE_COPY: Record<Mode, { label: string; tooltip: string }> = {
  monthly: {
    label: "In-month",
    tooltip:
      "Invoiced ÷ Delivered for THIS month only. Answers: 'Did we bill the work we shipped this month?' Spiky because pods invoice in bursts — catch-up months show as >100%.",
  },
  cumulative: {
    label: "Running total",
    tooltip:
      "Invoiced ÷ Delivered from the start through this month. Answers: 'Overall, are invoices keeping up with delivery?' Most clients are on monthly retainers, so this runs 105–120% by design — retainer fees bill ahead of actual delivery.",
  },
};

export function DeliveryTrendChart({ deliverables, clients }: DeliveryTrendChartProps) {
  // Default to cumulative — less noisy, matches how Finance looks at the book.
  const [mode, setMode] = useState<Mode>("cumulative");
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
          <div className="max-w-[720px]">
            <CardTitle className="text-white">
              Invoicing vs Delivery %{" "}
              <DataSourceBadge
                type="live"
                source="Sheet: 'Delivered vs Invoiced v2' — Spreadsheet: Editorial Capacity Planning. Monthly articles_invoiced ÷ articles_delivered per editorial pod."
              />
            </CardTitle>
            <p className="mt-1 text-[10px] font-mono text-[#C4BCAA] leading-relaxed">
              {mode === "monthly" ? (
                <>
                  <b className="text-white">In-month view</b> — Invoiced ÷ Delivered for each month in isolation.
                  Answers: <i>did we bill the work we shipped this month?</i> Expect spikes: pods invoice in bursts,
                  so a quiet billing month followed by a catch-up month is normal.
                </>
              ) : (
                <>
                  <b className="text-white">Running total</b> — Invoiced ÷ Delivered from the start of the range
                  through this month. Most clients are on monthly retainers, so <b className="text-white">105–120%</b> is
                  healthy — retainer fees bill slightly ahead of actual delivery by design. Sustained &lt;90% would
                  mean under-billing; &gt;130% would mean over-billing.
                </>
              )}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <div className="flex gap-1 rounded-md bg-[#0d0d0d] p-0.5">
              {(["monthly", "cumulative"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  title={MODE_COPY[m].tooltip}
                  className={cn(
                    "px-2.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider transition-colors",
                    mode === m
                      ? "bg-[#42CA80]/15 text-[#42CA80]"
                      : "text-[#606060] hover:text-white",
                  )}
                >
                  {MODE_COPY[m].label}
                </button>
              ))}
            </div>
            <span className="font-mono text-[9px] text-[#606060] italic">
              Hover a toggle for definitions
            </span>
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
                      const { bg, fg, border } = heatColor(cell.pct, mode);
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

        {/* Color legend — bands follow the active mode */}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9px] text-[#606060]">
          <span className="uppercase tracking-wider">
            Color scale ({mode === "monthly" ? "in-month" : "running total"})
          </span>
          {(() => {
            const bands = HEAT_BANDS[mode];
            // Sample color at the midpoint of each band so legend matches cells.
            const sampleAt = (i: number): number => {
              if (i === 0) return Math.max(0, bands.thresholds[0] / 2);
              if (i === bands.thresholds.length) return bands.thresholds[i - 1] + 20;
              return (bands.thresholds[i - 1] + bands.thresholds[i]) / 2;
            };
            return bands.labels.map((label, i) => {
              const color = heatColor(sampleAt(i), mode);
              return (
                <span key={label} className="inline-flex items-center gap-1">
                  <span
                    className="inline-block h-2.5 w-3 rounded-[3px]"
                    style={{
                      backgroundColor: color.bg,
                      border: `1px solid ${color.border}`,
                    }}
                  />
                  {label}
                </span>
              );
            });
          })()}
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
                      style={{ color: heatColor(tooltip.pct, mode).fg }}
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
