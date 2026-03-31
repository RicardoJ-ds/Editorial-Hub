"use client";

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataSourceBadge } from "@/components/dashboard/DataSourceBadge";
import type { DeliverableMonthly } from "@/lib/types";

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
      <p className="mb-1 font-mono text-xs font-semibold text-white">{label}</p>
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

interface DeliveryTrendChartProps {
  deliverables: DeliverableMonthly[];
}

export function DeliveryTrendChart({ deliverables }: DeliveryTrendChartProps) {
  const chartData = useMemo(() => {
    // Aggregate all clients' deliverables by month
    const byMonth = new Map<
      string,
      { delivered: number; invoiced: number; sortKey: number; label: string }
    >();

    for (const d of deliverables) {
      const key = `${d.year}-${String(d.month).padStart(2, "0")}`;
      const label = `${MONTH_NAMES[d.month]} ${String(d.year).slice(-2)}`;
      const sortKey = d.year * 100 + d.month;
      if (!byMonth.has(key)) {
        byMonth.set(key, { delivered: 0, invoiced: 0, sortKey, label });
      }
      const entry = byMonth.get(key)!;
      entry.delivered += d.articles_delivered ?? 0;
      entry.invoiced += d.articles_invoiced ?? 0;
    }

    // Sort by date and compute cumulative totals
    const sorted = Array.from(byMonth.values()).sort(
      (a, b) => a.sortKey - b.sortKey
    );

    let cumDelivered = 0;
    let cumInvoiced = 0;

    return sorted.map((entry) => {
      cumDelivered += entry.delivered;
      cumInvoiced += entry.invoiced;
      return {
        month: entry.label,
        Delivered: cumDelivered,
        Invoiced: cumInvoiced,
      };
    });
  }, [deliverables]);

  if (chartData.length === 0) {
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
        <CardTitle className="text-white">
          Delivery vs Invoicing Trend <DataSourceBadge type="live" source="Google Sheets — Delivered vs Invoiced v2" />
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="gradDelivered" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#42CA80" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#42CA80" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradInvoiced" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8FB5D9" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#8FB5D9" stopOpacity={0} />
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
            <Legend
              wrapperStyle={{
                fontSize: 12,
                fontFamily: "var(--font-mono), monospace",
              }}
              iconType="circle"
              iconSize={8}
            />
            <Area
              type="monotone"
              dataKey="Delivered"
              stroke="#42CA80"
              strokeWidth={2}
              fill="url(#gradDelivered)"
            />
            <Area
              type="monotone"
              dataKey="Invoiced"
              stroke="#8FB5D9"
              strokeWidth={2}
              fill="url(#gradInvoiced)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
