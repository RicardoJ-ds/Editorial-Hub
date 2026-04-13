"use client";

import { useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataSourceBadge } from "@/components/dashboard/DataSourceBadge";
import type { Client } from "@/lib/types";

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "#42CA80",
  COMPLETED: "#606060",
  CANCELLED: "#ED6958",
  SOON_TO_BE_ACTIVE: "#F5BC4E",
  INACTIVE: "#606060",
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  SOON_TO_BE_ACTIVE: "Soon Active",
  INACTIVE: "Inactive",
};

interface TooltipPayloadEntry {
  name: string;
  value: number;
  payload: { fill: string };
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] px-3 py-2 shadow-lg">
      <div className="flex items-center gap-2 text-xs">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: entry.payload.fill }}
        />
        <span className="text-[#C4BCAA]">{entry.name}:</span>
        <span className="font-mono font-semibold text-white">
          {entry.value}
        </span>
      </div>
    </div>
  );
}

interface StatusDistributionChartProps {
  clients: Client[];
}

export function StatusDistributionChart({
  clients,
}: StatusDistributionChartProps) {
  const data = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of clients) {
      counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([status, count]) => ({
        name: STATUS_LABELS[status] ?? status,
        value: count,
        fill: STATUS_COLORS[status] ?? "#606060",
      }))
      .sort((a, b) => b.value - a.value);
  }, [clients]);

  const total = clients.length;

  return (
    <Card className="border-[#2a2a2a] bg-[#161616]">
      <CardHeader>
        <CardTitle className="text-white">Client Status <DataSourceBadge type="live" source="Sheet: 'Editorial SOW overview' — Spreadsheet: Editorial Capacity Planning. Client status breakdown: Active, Completed, Cancelled, Soon to be Active." /></CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={80}
              paddingAngle={3}
              dataKey="value"
              strokeWidth={0}
            >
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <text
              x="50%"
              y="48%"
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-white font-mono text-2xl font-bold"
            >
              {total}
            </text>
            <text
              x="50%"
              y="58%"
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-[#606060] font-mono text-[10px] uppercase tracking-wider"
            >
              Total
            </text>
          </PieChart>
        </ResponsiveContainer>
        {/* Legend */}
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          {data.map((entry) => (
            <div key={entry.name} className="flex items-center gap-1.5 text-xs">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: entry.fill }}
              />
              <span className="text-[#C4BCAA]">{entry.name}</span>
              <span className="font-mono font-semibold text-white">
                {entry.value}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
