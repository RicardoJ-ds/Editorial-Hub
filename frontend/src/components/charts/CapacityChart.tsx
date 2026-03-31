"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CapacityProjection } from "@/lib/types";

// ---------------------------------------------------------------------------
// Graphite DS colors for pods
// ---------------------------------------------------------------------------

const POD_COLORS: Record<string, string> = {
  "Pod 1": "#8FB5D9",
  "Pod 2": "#CEBCF4",
  "Pod 3": "#42CA80",
  "Pod 4": "#F28D59",
  "Pod 5": "#F5BC4E",
};

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
            {entry.value.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CapacityChartProps {
  data: CapacityProjection[];
}

export function CapacityChart({ data }: CapacityChartProps) {
  const { chartData, pods } = useMemo(() => {
    // Determine the next 3 months from the data that have projections
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // Filter to future months (or current), sort chronologically
    const futureData = data
      .filter(
        (d) =>
          d.year > currentYear ||
          (d.year === currentYear && d.month >= currentMonth)
      )
      .sort((a, b) => a.year - b.year || a.month - b.month);

    // Get unique months (up to 3)
    const uniqueMonths: { year: number; month: number }[] = [];
    const seen = new Set<string>();
    for (const d of futureData) {
      const key = `${d.year}-${d.month}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueMonths.push({ year: d.year, month: d.month });
        if (uniqueMonths.length >= 3) break;
      }
    }

    // If no future data, just take last 3 unique months from all data
    if (uniqueMonths.length === 0) {
      const allSorted = [...data].sort(
        (a, b) => a.year - b.year || a.month - b.month
      );
      const seenAll = new Set<string>();
      const allMonths: { year: number; month: number }[] = [];
      for (const d of allSorted) {
        const key = `${d.year}-${d.month}`;
        if (!seenAll.has(key)) {
          seenAll.add(key);
          allMonths.push({ year: d.year, month: d.month });
        }
      }
      uniqueMonths.push(...allMonths.slice(-3));
    }

    // Collect all pods
    const podSet = new Set<string>();
    data.forEach((d) => podSet.add(d.pod));
    const podList = Array.from(podSet).sort();

    // Build chart rows
    const rows = uniqueMonths.map(({ year, month }) => {
      const label = `${MONTH_NAMES[month]} ${year}`;
      const row: Record<string, string | number> = { month: label };
      for (const pod of podList) {
        const entry = data.find(
          (d) => d.pod === pod && d.year === year && d.month === month
        );
        if (entry) {
          const total = entry.total_capacity ?? 0;
          const projected = entry.projected_used_capacity ?? 0;
          const utilization = total > 0 ? (projected / total) * 100 : 0;
          row[pod] = Math.round(utilization * 10) / 10;
        } else {
          row[pod] = 0;
        }
      }
      return row;
    });

    return { chartData: rows, pods: podList };
  }, [data]);

  if (chartData.length === 0) {
    return (
      <Card className="border-[#2a2a2a] bg-[#161616]">
        <CardContent className="pt-0">
          <p className="text-center text-sm text-[#606060]">
            No capacity projection data available for chart.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-[#2a2a2a] bg-[#161616]">
      <CardHeader>
        <CardTitle className="text-white">
          Projected Utilization by Pod
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ResponsiveContainer width="100%" height={320}>
          <BarChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#2a2a2a"
              vertical={false}
            />
            <XAxis
              dataKey="month"
              tick={{ fill: "#C4BCAA", fontSize: 12, fontFamily: "monospace" }}
              axisLine={{ stroke: "#2a2a2a" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#C4BCAA", fontSize: 12, fontFamily: "monospace" }}
              axisLine={{ stroke: "#2a2a2a" }}
              tickLine={false}
              domain={[0, 120]}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ fill: "rgba(255,255,255,0.03)" }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, fontFamily: "monospace" }}
              iconType="circle"
              iconSize={8}
            />
            <ReferenceLine
              y={85}
              stroke="#42CA80"
              strokeDasharray="6 4"
              strokeWidth={1.5}
              label={{
                value: "85% Optimal",
                position: "insideTopRight",
                fill: "#42CA80",
                fontSize: 11,
                fontFamily: "monospace",
              }}
            />
            {pods.map((pod) => (
              <Bar
                key={pod}
                dataKey={pod}
                fill={POD_COLORS[pod] ?? "#606060"}
                radius={[3, 3, 0, 0]}
                maxBarSize={40}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
