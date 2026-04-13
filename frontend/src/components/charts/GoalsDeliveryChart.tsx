"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { GoalsVsDeliveryRow } from "@/lib/types";
import { DataSourceBadge } from "@/components/dashboard/DataSourceBadge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePct(s: string | null): number {
  if (!s) return 0;
  const n = parseFloat(s.replaceAll("%", ""));
  return isNaN(n) ? 0 : n;
}

function pctColor(v: number): string {
  if (v >= 75) return "#42CA80";
  if (v >= 50) return "#F5BC4E";
  return "#ED6958";
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
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] px-3 py-2 shadow-xl">
      <p className="mb-1 font-mono text-xs font-semibold text-white">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 font-mono text-[10px]">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-[#C4BCAA]">{entry.name}:</span>
          <span className="font-semibold text-white">{entry.value}%</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GoalsDeliveryChart({ data }: { data: GoalsVsDeliveryRow[] }) {
  const chartData = useMemo(() => {
    return data
      .map((r) => ({
        name: r.client_name.length > 18 ? r.client_name.slice(0, 16) + "…" : r.client_name,
        fullName: r.client_name,
        cb: parsePct(r.cb_pct_of_goal),
        ad: parsePct(r.ad_pct_of_goal),
      }))
      .sort((a, b) => (b.cb + b.ad) / 2 - (a.cb + a.ad) / 2)
      .slice(0, 20);
  }, [data]);

  if (chartData.length === 0) return null;

  const chartHeight = Math.max(300, chartData.length * 36);

  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#161616] p-6">
      <div className="mb-4 flex items-center gap-2">
        <h4 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
          Goal Achievement by Client
        </h4>
        <DataSourceBadge
          type="live"
          source="Sheet: '[Month] Goals vs Delivery' — Spreadsheet: Master Tracker. CB and Article delivery percentage against monthly goals."
        />
      </div>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 20, left: 4, bottom: 4 }}
          barCategoryGap="20%"
        >
          <CartesianGrid
            horizontal={false}
            strokeDasharray="3 3"
            stroke="#2a2a2a"
          />
          <XAxis
            type="number"
            domain={[0, 120]}
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fill: "#606060", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
            axisLine={{ stroke: "#2a2a2a" }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={130}
            tick={{ fill: "#C4BCAA", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
          />
          <ReferenceLine
            x={75}
            stroke="#606060"
            strokeDasharray="4 4"
            label={{
              value: "75%",
              position: "top",
              fill: "#606060",
              fontSize: 10,
              fontFamily: "JetBrains Mono, monospace",
            }}
          />
          <Bar dataKey="cb" name="CB %" barSize={12} radius={[0, 3, 3, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={pctColor(entry.cb)} fillOpacity={0.85} />
            ))}
          </Bar>
          <Bar dataKey="ad" name="Articles %" barSize={12} radius={[0, 3, 3, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={pctColor(entry.ad)} fillOpacity={0.6} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-3 flex items-center gap-4 justify-center">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-6 rounded-sm" style={{ backgroundColor: "#42CA80", opacity: 0.85 }} />
          <span className="font-mono text-[10px] text-[#606060]">CB %</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-6 rounded-sm" style={{ backgroundColor: "#42CA80", opacity: 0.6 }} />
          <span className="font-mono text-[10px] text-[#606060]">Articles %</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-px w-6 border-t border-dashed border-[#606060]" />
          <span className="font-mono text-[10px] text-[#606060]">75% Goal</span>
        </div>
      </div>
    </div>
  );
}
