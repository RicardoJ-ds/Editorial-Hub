"use client";

import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataSourceBadge } from "@/components/dashboard/DataSourceBadge";
import type { Client, DeliverableMonthly } from "@/lib/types";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Formula: Delivered ÷ Invoiced. Mirrors the sheet's `Variance = Delivered −
// Invoiced` so under-delivery reads as <100% (red) and balance sits at 100%.
// Retainer billing fires ahead of delivery by design, so a healthy cumulative
// zone is ~80–100%. A running total <60% signals real under-delivery risk.
// Heatmap instead of line chart because pods invoice in bursts — a single
// catch-up month spiking to ∞/0 would otherwise crush every other series.
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

// Color bands are *mode-aware* because "80%" means different things depending
// on whether you're looking at a single period (in-month / in-quarter burst)
// or the running total across the whole range.
// Formula is Delivered ÷ Invoiced, so <100% = delivery lagging billing.
const HEAT_BANDS: Record<Mode, HeatBands> = {
  monthly: {
    // A single period can dip low during a slow month; 60–120% is the busy zone.
    thresholds: [40, 60, 80, 100, 120, 150],
    labels: ["<40%", "40–60%", "60–80%", "80–100%", "100–120%", "120–150%", ">150%"],
  },
  cumulative: {
    // Retainer clients invoice monthly commitments ahead of delivery, so the
    // cumulative Delivered/Invoiced ratio naturally sits between 80% and 100%.
    // That's the healthy green band. Sustained <60% is real under-delivery.
    thresholds: [50, 70, 80, 100, 110, 130],
    labels: ["<50%", "50–70%", "70–80%", "80–100%", "100–110%", "110–130%", ">130%"],
  },
};

// Map a % into a dark-theme heatmap color using the active mode's bands.
// Bad = red, Healthy = green, Over-delivery = cyan/blue (rarer but possible
// when a pod catches up a backlog mid-quarter).
function heatColor(
  pct: number | null,
  mode: Mode,
): { bg: string; fg: string; border: string } {
  if (pct == null) return { bg: "#0f0f0f", fg: "#404040", border: "#1a1a1a" };
  const t = HEAT_BANDS[mode].thresholds;
  if (pct < t[0]) return { bg: "#5b1e1e", fg: "#FFB8B0", border: "#7a2828" };
  if (pct < t[1]) return { bg: "#6d2727", fg: "#F5A99A", border: "#8a3434" };
  if (pct < t[2]) return { bg: "#6d4a1e", fg: "#F5BC4E", border: "#8a6128" };
  if (pct < t[3]) return { bg: "#1f4d2e", fg: "#65FFAA", border: "#2a6b3f" };
  if (pct < t[4]) return { bg: "#1f4a4d", fg: "#7FE8D6", border: "#2a6568" };
  if (pct < t[5]) return { bg: "#1f3a6b", fg: "#8FB5D9", border: "#2a4f8c" };
  return { bg: "#3a2452", fg: "#CEBCF4", border: "#4e3272" };
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
type Granularity = "month" | "quarter";

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
    label: "In-period",
    tooltip:
      "Delivered ÷ Invoiced for THIS period only. Answers: 'Of what we billed this month/quarter, how much shipped?' Spiky because pods deliver in bursts — slow months dip below 100%.",
  },
  cumulative: {
    label: "Running total",
    tooltip:
      "Delivered ÷ Invoiced from the start of the range through this period. Answers: 'Overall, is delivery keeping up with billing?' Retainer clients bill ahead of delivery, so this typically runs 80–100% by design.",
  },
};

const GRAN_COPY: Record<Granularity, { label: string }> = {
  quarter: { label: "Quarter" },
  month: { label: "Month" },
};

function quarterOf(month: number): number {
  return Math.floor((month - 1) / 3) + 1;
}

function quarterLabel(year: number, q: number): string {
  return `Q${q} ${String(year).slice(-2)}`;
}

export function DeliveryTrendChart({ deliverables, clients }: DeliveryTrendChartProps) {
  // Default: Running total + Quarter granularity — matches how Finance reads the book.
  const [mode, setMode] = useState<Mode>("cumulative");
  const [granularity, setGranularity] = useState<Granularity>("quarter");
  const [tooltip, setTooltip] = useState<Tooltip>(null);

  const clientToPod = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of clients) map.set(c.id, normalizePod(c.editorial_pod));
    return map;
  }, [clients]);

  // Build the grid: rows = pods (+ All pods header), columns = periods (month or quarter).
  const { rows, columns } = useMemo(() => {
    type PeriodBucket = {
      sortKey: number;
      label: string;
      pods: Map<string, { delivered: number; invoiced: number }>;
    };
    const byPeriod = new Map<string, PeriodBucket>();
    const podSet = new Set<string>();

    for (const d of deliverables) {
      const pod = clientToPod.get(d.client_id) ?? "Unassigned";
      podSet.add(pod);
      let key: string;
      let label: string;
      let sortKey: number;
      if (granularity === "quarter") {
        const q = quarterOf(d.month);
        key = `${d.year}-Q${q}`;
        label = quarterLabel(d.year, q);
        sortKey = d.year * 10 + q;
      } else {
        key = `${d.year}-${String(d.month).padStart(2, "0")}`;
        label = `${MONTH_NAMES[d.month]} ${String(d.year).slice(-2)}`;
        sortKey = d.year * 100 + d.month;
      }
      let m = byPeriod.get(key);
      if (!m) {
        m = { sortKey, label, pods: new Map() };
        byPeriod.set(key, m);
      }
      let p = m.pods.get(pod);
      if (!p) {
        p = { delivered: 0, invoiced: 0 };
        m.pods.set(pod, p);
      }
      p.delivered += d.articles_delivered ?? 0;
      p.invoiced += d.articles_invoiced ?? 0;
    }

    const periods = Array.from(byPeriod.values()).sort((a, b) => a.sortKey - b.sortKey);
    const allPods = Array.from(podSet).sort(sortPodKey);

    // Formula: Delivered ÷ Invoiced. Guard against invoiced=0 (returns null).
    const ratio = (delivered: number, invoiced: number): number | null =>
      invoiced > 0 ? (delivered / invoiced) * 100 : null;

    // Running cumulative state per pod (for cumulative mode)
    const cumByPod = new Map<string, { delivered: number; invoiced: number }>();
    const cumAll = { delivered: 0, invoiced: 0 };

    const columns = periods.map((m) => ({ key: m.label, label: m.label }));

    const rows: Array<{ pod: string; cells: Cell[] }> = [];

    // All-pods row first (aggregate across every pod for each period)
    const allCells: Cell[] = periods.map((m) => {
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
          pct: ratio(cumAll.delivered, cumAll.invoiced),
        };
      }
      return { delivered: d, invoiced: i, pct: ratio(d, i) };
    });
    rows.push({ pod: ALL_KEY, cells: allCells });

    for (const pod of allPods) {
      const cells: Cell[] = periods.map((m) => {
        const stats = m.pods.get(pod) ?? { delivered: 0, invoiced: 0 };
        if (mode === "cumulative") {
          const prev = cumByPod.get(pod) ?? { delivered: 0, invoiced: 0 };
          prev.delivered += stats.delivered;
          prev.invoiced += stats.invoiced;
          cumByPod.set(pod, prev);
          return {
            delivered: prev.delivered,
            invoiced: prev.invoiced,
            pct: ratio(prev.delivered, prev.invoiced),
          };
        }
        return {
          delivered: stats.delivered,
          invoiced: stats.invoiced,
          pct: ratio(stats.delivered, stats.invoiced),
        };
      });
      rows.push({ pod, cells });
    }
    return { rows, columns };
  }, [deliverables, clientToPod, mode, granularity]);

  if (rows.length === 0 || columns.length === 0) {
    return (
      <Card className="border-[#2a2a2a] bg-[#161616]">
        <CardHeader>
          <CardTitle className="text-white">Delivery vs Invoicing %</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-center text-sm text-[#606060]">
            No delivery data in the selected client and time-range filter.
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
              Delivery vs Invoicing %{" "}
              <DataSourceBadge
                type="live"
                source="Sheet: 'Delivered vs Invoiced v2' — Spreadsheet: Editorial Capacity Planning. Each cell = articles_delivered ÷ articles_invoiced (mirrors the sheet's Variance = Delivered − Invoiced). Respects the Client + Time-period filters above."
                shows={[
                  "Delivered ÷ Invoiced as a %, plotted over time. Close to 100% means deliveries and invoicing are in balance.",
                  "In-period view = each bar is that period's ratio alone. Expect dips and spikes because pods deliver in bursts.",
                  "Running Total view = cumulative ratio through each period. 80–100% is healthy; <60% under-delivery; >110% catching up.",
                  "Toggle Monthly / Quarterly granularity on the right.",
                ]}
              />
            </CardTitle>
            <p className="mt-1 text-[10px] font-mono text-[#C4BCAA] leading-relaxed">
              {mode === "monthly" ? (
                <>
                  <b className="text-white">In-{granularity}</b> — Delivered ÷ Invoiced per {granularity}.
                  Expect dips and catch-up spikes: pods deliver in bursts.
                </>
              ) : (
                <>
                  <b className="text-white">Running total</b> — cumulative Delivered ÷ Invoiced.
                  Healthy: <b className="text-white">80–100%</b> (retainers bill slightly ahead).
                  &lt;60% = under-delivery; &gt;110% = catching up.
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
              Hover for definitions
            </span>
          </div>
          <div className="flex gap-1 rounded-md bg-[#0d0d0d] p-0.5 shrink-0 ml-auto">
            {(["quarter", "month"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={cn(
                  "px-2.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider transition-colors",
                  granularity === g
                    ? "bg-[#8FB5D9]/15 text-[#8FB5D9]"
                    : "text-[#606060] hover:text-white",
                )}
              >
                {GRAN_COPY[g].label}
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
                  Pod {granularity === "quarter" ? "· By quarter" : "· By month"}
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
            Color scale ({mode === "monthly" ? `in-${granularity}` : "running total"})
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
                  <>No invoicing this {mode === "cumulative" ? "period-to-date" : granularity}</>
                ) : (
                  <>
                    Delivered / Invoiced:{" "}
                    <span className="text-white">{tooltip.delivered}</span>
                    {" / "}
                    <span className="text-white">{tooltip.invoiced}</span>
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
