"use client";

import React, { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataSourceBadge } from "@/components/dashboard/DataSourceBadge";
import type { Client, DeliverableMonthly } from "@/lib/types";
import { cn } from "@/lib/utils";

const MONTH_NAMES = [
  "",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Pod-colored series; "All pods" is bold white on top
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
const ALL_COLOR = "#FFFFFF";

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

interface TooltipPayloadEntry {
  name: string;
  value: number | null;
  color: string;
  dataKey?: string;
  payload?: Record<string, number | string | null>;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const rows = payload
    .filter((p) => p.value != null)
    .sort((a, b) => {
      if (a.name === ALL_KEY) return -1;
      if (b.name === ALL_KEY) return 1;
      return sortPodKey(a.name, b.name);
    });
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 shadow-xl">
      <p className="mb-1 font-mono text-xs font-semibold text-white">{label}</p>
      {rows.map((entry) => {
        const rawKey = `${entry.name}__raw`;
        const raw =
          entry.payload && typeof entry.payload[rawKey] === "number"
            ? (entry.payload[rawKey] as number)
            : (entry.value ?? 0);
        const clipped = raw > Y_CAP;
        return (
          <div key={entry.name} className="flex items-center gap-2 font-mono text-[10px]">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-[#C4BCAA]">{entry.name}:</span>
            <span className="font-semibold text-white">{Math.round(raw)}%</span>
            {clipped && <span className="text-[#ED6958] font-semibold">↑</span>}
          </div>
        );
      })}
    </div>
  );
}

interface DeliveryTrendChartProps {
  deliverables: DeliverableMonthly[];
  clients: Client[];
}

type Mode = "monthly" | "cumulative";

/** Y-axis cap. Anything above this gets clipped and marked with an up-arrow.
 *  150% gives enough headroom to see a pod doing a catch-up invoice month
 *  without letting a 3000% outlier flatten the rest of the series. */
const Y_CAP = 150;

/** Dot renderer: when the raw (un-clipped) value for this point exceeds the
 *  cap, draw an up-arrow at the cap line so the clipped point is visible
 *  with its real value tooltipped. Normal points render no dot. */
function makeClippedDot(seriesKey: string) {
  // Recharts types the dot props very loosely — accept anything and narrow here.
  const DotComponent = (props: unknown) => {
    const p = (props ?? {}) as {
      cx?: number;
      cy?: number;
      stroke?: string;
      payload?: Record<string, number | string | null>;
    };
    const { cx, cy, stroke, payload } = p;
    if (cx == null || cy == null || !payload) return <g />;
    const rawKey = `${seriesKey}__raw`;
    const raw = payload[rawKey];
    if (typeof raw !== "number" || raw <= Y_CAP) return <g />;
    const color = stroke ?? "#ED6958";
    // Arrow is rendered at the cap line (cy already clamped to Y_CAP by Recharts
    // because we fed it Math.min(raw, Y_CAP)) — bump up a hair so the tip is
    // clearly above the line.
    const topY = cy - 9;
    return (
      <g>
        <line
          x1={cx}
          x2={cx}
          y1={cy - 2}
          y2={topY + 3}
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        <polyline
          points={`${cx - 3},${topY + 4} ${cx},${topY} ${cx + 3},${topY + 4}`}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    );
  };
  DotComponent.displayName = `ClippedDot(${seriesKey})`;
  return DotComponent;
}

export function DeliveryTrendChart({ deliverables, clients }: DeliveryTrendChartProps) {
  const [mode, setMode] = useState<Mode>("monthly");
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const clientToPod = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of clients) map.set(c.id, normalizePod(c.editorial_pod));
    return map;
  }, [clients]);

  // Build per-month per-pod delivered / invoiced counts
  const { rawByPodMonth, allPods, months } = useMemo(() => {
    const byMonth = new Map<
      string,
      { sortKey: number; label: string; pods: Map<string, { delivered: number; invoiced: number }> }
    >();
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
    return { rawByPodMonth: months, allPods, months };
  }, [deliverables, clientToPod]);

  // For each month, compute invoiced/delivered % per pod + for "All pods", either
  // per-period or cumulative-to-date based on the mode toggle. Values above
  // Y_CAP are clipped to the cap on the rendered series; the unclipped value
  // is preserved on a sibling `${key}__raw` field so the tooltip can show it
  // and the dot renderer can draw an up-arrow marker.
  const chartData = useMemo(() => {
    type Row = Record<string, number | string | null>;
    const cumulative = new Map<string, { delivered: number; invoiced: number }>();
    let allCumDelivered = 0;
    let allCumInvoiced = 0;

    const writeSeries = (row: Row, key: string, value: number | null) => {
      row[`${key}__raw`] = value;
      row[key] = value == null ? null : Math.min(value, Y_CAP);
    };

    return months.map((m) => {
      const row: Row = { month: m.label };
      let monthDelivered = 0;
      let monthInvoiced = 0;

      for (const pod of allPods) {
        const stats = m.pods.get(pod) ?? { delivered: 0, invoiced: 0 };
        monthDelivered += stats.delivered;
        monthInvoiced += stats.invoiced;

        let value: number | null;
        if (mode === "monthly") {
          value = stats.delivered > 0 ? (stats.invoiced / stats.delivered) * 100 : null;
        } else {
          const prev = cumulative.get(pod) ?? { delivered: 0, invoiced: 0 };
          prev.delivered += stats.delivered;
          prev.invoiced += stats.invoiced;
          cumulative.set(pod, prev);
          value = prev.delivered > 0 ? (prev.invoiced / prev.delivered) * 100 : null;
        }
        writeSeries(row, pod, value);
      }

      let allValue: number | null;
      if (mode === "monthly") {
        allValue = monthDelivered > 0 ? (monthInvoiced / monthDelivered) * 100 : null;
      } else {
        allCumDelivered += monthDelivered;
        allCumInvoiced += monthInvoiced;
        allValue =
          allCumDelivered > 0 ? (allCumInvoiced / allCumDelivered) * 100 : null;
      }
      writeSeries(row, ALL_KEY, allValue);

      return row;
    });
  }, [months, allPods, mode]);

  // Surface a lightweight legend so users can toggle pods on/off
  const legendSeries = useMemo(
    () => [ALL_KEY, ...allPods.sort(sortPodKey)],
    [allPods]
  );

  const toggle = (key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (months.length === 0) {
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
                source="Sheet: 'Delivered vs Invoiced v2' — Spreadsheet: Editorial Capacity Planning. Monthly articles_invoiced ÷ articles_delivered per editorial pod. 100% = every delivered article is invoiced that month; <100% = delivered work still unbilled."
              />
            </CardTitle>
            <p className="mt-0.5 text-[10px] font-mono text-[#606060]">
              Invoiced ÷ Delivered per pod over time. White line = all pods combined. Y-axis capped at {Y_CAP}% so a single catch-up month can&apos;t flatten the rest — months exceeding the cap are marked with an <span className="text-[#ED6958]">↑</span>; hover to see the true %.
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
                    : "text-[#606060] hover:text-white"
                )}
              >
                {m === "monthly" ? "Per month" : "Cumulative"}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart
            data={chartData}
            margin={{ top: 6, right: 16, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#2a2a2a"
              vertical={false}
            />
            <XAxis
              dataKey="month"
              tick={{
                fill: "#606060",
                fontSize: 10,
                fontFamily: "var(--font-mono), monospace",
              }}
              axisLine={{ stroke: "#2a2a2a" }}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={20}
            />
            <YAxis
              tickFormatter={(v: number) => `${Math.round(v)}%`}
              tick={{
                fill: "#606060",
                fontSize: 10,
                fontFamily: "var(--font-mono), monospace",
              }}
              axisLine={{ stroke: "#2a2a2a" }}
              tickLine={false}
              domain={[0, Y_CAP]}
              ticks={[0, 25, 50, 75, 100, Y_CAP]}
              allowDataOverflow
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ stroke: "#2a2a2a" }}
            />
            {/* 100% reference */}
            <Line
              type="monotone"
              dataKey={() => 100}
              stroke="#2a2a2a"
              strokeWidth={1}
              strokeDasharray="4 4"
              dot={false}
              isAnimationActive={false}
              legendType="none"
              name="100% target"
            />
            {allPods.map((pod) => (
              <Line
                key={pod}
                type="monotone"
                dataKey={pod}
                stroke={POD_COLORS[pod] ?? "#606060"}
                strokeWidth={hidden.has(pod) ? 0 : 1.6}
                strokeOpacity={hidden.has(pod) ? 0 : 0.85}
                dot={hidden.has(pod) ? false : makeClippedDot(pod)}
                activeDot={{ r: 3, fill: POD_COLORS[pod] ?? "#606060" }}
                connectNulls
                isAnimationActive={false}
                name={pod}
              />
            ))}
            <Line
              type="monotone"
              dataKey={ALL_KEY}
              stroke={ALL_COLOR}
              strokeWidth={hidden.has(ALL_KEY) ? 0 : 2.5}
              strokeOpacity={hidden.has(ALL_KEY) ? 0 : 1}
              dot={hidden.has(ALL_KEY) ? false : makeClippedDot(ALL_KEY)}
              activeDot={{ r: 4, fill: ALL_COLOR }}
              connectNulls
              isAnimationActive={false}
              name={ALL_KEY}
            />
          </LineChart>
        </ResponsiveContainer>

        {/* Interactive legend */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {legendSeries.map((key) => {
            const color = key === ALL_KEY ? ALL_COLOR : POD_COLORS[key] ?? "#606060";
            const isHidden = hidden.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggle(key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[10px] transition-colors",
                  isHidden
                    ? "border-[#1a1a1a] text-[#404040]"
                    : "border-[#2a2a2a] text-[#C4BCAA] hover:text-white"
                )}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: color, opacity: isHidden ? 0.3 : 1 }}
                />
                <span className={cn(key === ALL_KEY && !isHidden && "font-semibold text-white")}>
                  {key}
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
