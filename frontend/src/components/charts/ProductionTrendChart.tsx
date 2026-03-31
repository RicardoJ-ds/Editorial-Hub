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
import type { ProductionTrendPoint } from "@/lib/types";
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
  data: ProductionTrendPoint[];
}

export function ProductionTrendChart({ data }: ProductionTrendChartProps) {
  const { chartData, boundaryLabel } = useMemo(() => {
    const sorted = [...data].sort(
      (a, b) => a.year * 100 + a.month - (b.year * 100 + b.month),
    );

    // Find the last actual data point to place the "Now" reference line
    let lastActualLabel = "";

    const mapped = sorted.map((pt) => {
      const label = formatLabel(pt.year, pt.month);
      if (pt.is_actual) lastActualLabel = label;
      return {
        month: label,
        Actual: pt.is_actual ? pt.total_actual : null,
        Projected: !pt.is_actual ? pt.total_projected : null,
      };
    });

    return { chartData: mapped, boundaryLabel: lastActualLabel };
  }, [data]);

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
        <h3 className="text-base font-semibold text-white">
          Production History <DataSourceBadge type="live" source="Google Sheets — Editorial Operating Model (Oct 2022–Feb 2027)" />
        </h3>
        <p className="mt-0.5 text-xs text-[#606060]">
          Monthly article output across all clients
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
