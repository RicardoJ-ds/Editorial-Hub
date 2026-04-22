"use client";

import { useMemo } from "react";
import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { Client, ClientProductionRow, ProductionTrendPoint } from "@/lib/types";
import type { DateRange } from "@/components/dashboard/DateRangeFilter";
import { DataSourceBadge } from "@/components/dashboard/DataSourceBadge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function formatLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month]} ${String(year).slice(-2)}`;
}

// At the transition from Actual → Projected the two Recharts series don't
// share a point, so the dashed Projected line starts one month later than
// the solid Actual line ends — producing a visible gap. Copy the final
// Actual value into that same row's Projected field so the dashed series
// has a starting anchor and visually continues the solid line.
function bridgeActualToProjected(
  rows: { month: string; Actual: number | null; Projected: number | null }[],
) {
  for (let i = 0; i < rows.length - 1; i++) {
    const cur = rows[i];
    const next = rows[i + 1];
    if (cur.Actual !== null && next.Actual === null && next.Projected !== null) {
      cur.Projected = cur.Actual;
      break;
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Custom Tooltip
// ---------------------------------------------------------------------------

interface TooltipPayloadEntry {
  name: string;
  value: number;
  color: string;
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
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] px-3 py-2 shadow-lg">
      <p className="mb-1 font-mono text-xs font-semibold text-white">
        {label}
      </p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-xs">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-[#C4BCAA]">{entry.name}:</span>
          <span className="font-mono font-semibold text-white">
            {entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ProductionTrendChartProps {
  /** All-clients aggregate from /api/dashboard/production-trend (legacy, used when no filter is active). */
  data: ProductionTrendPoint[];
  /** Per-client monthly actual/projected — re-aggregated client-side so the chart honors the FilterBar selection. */
  clientProduction?: ClientProductionRow[];
  filteredClients?: Client[];
  dateRange?: DateRange;
}

export function ProductionTrendChart({
  data,
  clientProduction,
  filteredClients,
  dateRange,
}: ProductionTrendChartProps) {
  const { chartData, boundaryLabel, source } = useMemo(() => {
    // Decide whether a filter is actively narrowing the dataset. If any of:
    //   - a non-empty client subset (not all clients selected)
    //   - a bounded date range
    // is present, re-aggregate from clientProduction so the chart matches the
    // filter. Otherwise fall back to the backend's all-clients series.
    const hasClientFilter =
      clientProduction &&
      filteredClients &&
      clientProduction.length > 0 &&
      filteredClients.length > 0 &&
      filteredClients.length < clientProduction.length;
    const hasDateFilter = dateRange?.type === "range" && !!dateRange.from;
    const useClientProduction = !!clientProduction && (hasClientFilter || hasDateFilter);

    const inRange = (y: number, m: number) => {
      if (!dateRange || dateRange.type !== "range" || !dateRange.from) return true;
      const cell = new Date(y, m - 1, 1);
      const from = new Date(
        dateRange.from.getFullYear(),
        dateRange.from.getMonth(),
        1,
      );
      const toSrc = dateRange.to ?? dateRange.from;
      const to = new Date(toSrc.getFullYear(), toSrc.getMonth() + 1, 0);
      return cell >= from && cell <= to;
    };

    // Find the last actual data point to place the "Now" reference line
    let lastActualLabel = "";

    if (useClientProduction && clientProduction) {
      const names = filteredClients
        ? new Set(filteredClients.map((c) => c.name))
        : null;
      const rows = names
        ? clientProduction.filter((r) => names.has(r.client_name))
        : clientProduction;
      const byMonth = new Map<
        string,
        { year: number; month: number; actual: number; projected: number }
      >();
      for (const r of rows) {
        for (const m of r.monthly) {
          if (!inRange(m.year, m.month)) continue;
          const key = `${m.year}-${String(m.month).padStart(2, "0")}`;
          const bucket = byMonth.get(key) ?? {
            year: m.year,
            month: m.month,
            actual: 0,
            projected: 0,
          };
          bucket.actual += m.actual ?? 0;
          bucket.projected += m.projected ?? 0;
          byMonth.set(key, bucket);
        }
      }
      const sorted = Array.from(byMonth.values()).sort(
        (a, b) => a.year * 100 + a.month - (b.year * 100 + b.month),
      );
      const mapped = sorted.map((pt) => {
        const label = formatLabel(pt.year, pt.month);
        // Treat a month as "actual" when actual > 0 (projected-only future months stay null here)
        const isActual = pt.actual > 0;
        if (isActual) lastActualLabel = label;
        return {
          month: label,
          Actual: isActual ? pt.actual : null,
          Projected: !isActual ? pt.projected : null,
        };
      });
      return { chartData: bridgeActualToProjected(mapped), boundaryLabel: lastActualLabel, source: "filtered" as const };
    }

    const sorted = [...data]
      .filter((pt) => inRange(pt.year, pt.month))
      .sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month));

    const mapped = sorted.map((pt) => {
      const label = formatLabel(pt.year, pt.month);
      if (pt.is_actual) lastActualLabel = label;
      return {
        month: label,
        Actual: pt.is_actual ? pt.total_actual : null,
        Projected: !pt.is_actual ? pt.total_projected : null,
      };
    });

    return { chartData: bridgeActualToProjected(mapped), boundaryLabel: lastActualLabel, source: "all" as const };
  }, [data, clientProduction, filteredClients, dateRange]);

  if (chartData.length === 0) {
    return (
      <div className="rounded-xl border border-[#2a2a2a] bg-[#161616] p-6">
        <p className="text-center text-sm text-[#606060]">
          No production history data available.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#161616] p-6">
      <div className="mb-4">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#C4BCAA]">
          Production History <DataSourceBadge
            type="live"
            source="Sheet: 'Editorial Operating Model' — Spreadsheet: Editorial Capacity Planning. Monthly article output, actual vs projected. Honors the Client + Time-period filters above."
            shows={[
              "Monthly article output over time.",
              "Solid line = what actually shipped. Dashed extension = what's still projected.",
              "The vertical 'Now' marker separates history from forecast.",
              "Watch pace — dips below trend are early misses.",
            ]}
          />
        </h3>
        <p className="mt-0.5 text-xs text-[#909090]">
          {source === "filtered"
            ? "Actual vs. projected monthly output for the selected clients."
            : "Actual vs. projected monthly output across all clients."}
        </p>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart
          data={chartData}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#42CA80" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#42CA80" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradProjected" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#42CA80" stopOpacity={0.1} />
              <stop offset="95%" stopColor="#42CA80" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#2a2a2a"
            vertical={false}
          />
          <XAxis
            dataKey="month"
            tick={{
              fill: "#606060",
              fontSize: 11,
              fontFamily: "var(--font-mono), monospace",
            }}
            axisLine={{ stroke: "#2a2a2a" }}
            tickLine={false}
          />
          <YAxis
            tick={{
              fill: "#606060",
              fontSize: 11,
              fontFamily: "var(--font-mono), monospace",
            }}
            axisLine={{ stroke: "#2a2a2a" }}
            tickLine={false}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ stroke: "#2a2a2a" }}
          />
          {boundaryLabel && (
            <ReferenceLine
              x={boundaryLabel}
              stroke="#606060"
              strokeDasharray="4 4"
              label={{
                value: "Now",
                position: "top",
                fill: "#606060",
                fontSize: 10,
                fontFamily: "var(--font-mono), monospace",
              }}
            />
          )}
          <Area
            type="monotone"
            dataKey="Actual"
            stroke="#42CA80"
            strokeWidth={2}
            fill="url(#gradActual)"
            connectNulls={false}
          />
          <Area
            type="monotone"
            dataKey="Projected"
            stroke="#42CA80"
            strokeWidth={2}
            strokeDasharray="6 3"
            strokeOpacity={0.5}
            fill="url(#gradProjected)"
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
