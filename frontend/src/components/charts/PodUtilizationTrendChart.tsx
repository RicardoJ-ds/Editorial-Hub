"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { POD_HEX_COLORS, displayPod } from "@/components/dashboard/shared-helpers";

// Pod-level utilization over every month, one line per pod. "Planned" =
// projected ÷ capacity (defined for all 12 months — the forward-looking plan);
// "Delivered" = actual ÷ capacity (closed months only, so its lines stop at the
// last closed month). Reference line at 100% marks over-capacity.
export interface PodSummaryRow {
  year: number;
  month: number;
  pod: string;
  total_capacity: number | null;
  projected_used_capacity: number | null;
  actual_used_capacity: number | null;
}

const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
type Metric = "planned" | "delivered";

function DarkTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number | null; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const items = payload.filter((p) => p.value !== null && p.value !== undefined);
  if (!items.length) return null;
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 shadow-xl">
      <p className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-white">
        {label}
      </p>
      {[...items]
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
        .map((p) => (
          <div key={p.name} className="flex items-center justify-between gap-3 text-[11px]">
            <span className="flex items-center gap-1.5 text-[#C4BCAA]">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="font-mono text-white">{(p.value ?? 0).toFixed(0)}%</span>
          </div>
        ))}
    </div>
  );
}

export function PodUtilizationTrendChart({
  rows,
  activePods,
  range,
}: {
  rows: PodSummaryRow[];
  activePods?: Set<string>;
  /** Inclusive "YYYY-MM" window from the FilterBar period; omit for all time. */
  range?: { from: string; to: string };
}) {
  const [metric, setMetric] = useState<Metric>("delivered");

  const { chartData, pods } = useMemo(() => {
    const useFilter = activePods && activePods.size > 0;
    const mk = (r: PodSummaryRow) => `${r.year}-${String(r.month).padStart(2, "0")}`;
    const inRange = (k: string) => !range || (k >= range.from && k <= range.to);
    const visible = rows.filter(
      (r) =>
        (r.total_capacity ?? 0) > 0 &&
        (!useFilter || activePods!.has(r.pod)) &&
        inRange(mk(r)),
    );
    const podList = Array.from(new Set(visible.map((r) => r.pod))).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    const monthKeys = Array.from(new Set(visible.map(mk))).sort();
    const byCell = new Map<string, PodSummaryRow>();
    for (const r of visible) byCell.set(`${r.pod}|${r.year}-${String(r.month).padStart(2, "0")}`, r);

    const data = monthKeys.map((key) => {
      const [y, m] = key.split("-").map(Number);
      const row: Record<string, string | number | null> = { month: `${MONTH_ABBR[m]} ${String(y).slice(2)}` };
      for (const pod of podList) {
        const r = byCell.get(`${pod}|${key}`);
        const cap = r?.total_capacity ?? 0;
        const used = metric === "planned" ? r?.projected_used_capacity ?? 0 : r?.actual_used_capacity ?? 0;
        // Delivered is 0 for not-yet-closed months → null so the line stops.
        row[pod] = cap > 0 && !(metric === "delivered" && used === 0) ? Math.round((used / cap) * 100) : null;
      }
      return row;
    });
    return { chartData: data, pods: podList };
  }, [rows, metric, activePods, range]);

  if (pods.length === 0) {
    return <p className="py-8 text-center font-mono text-xs text-[#606060]">No capacity data.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] text-[#606060]">
          {metric === "planned"
            ? "% Capacity Utilization (Projected) — projected ÷ capacity across the year, the forward-looking plan."
            : "% Capacity Utilization (Real) — actual ÷ capacity; lines stop at the last closed month."}{" "}
          The dashed line marks 100% (over-capacity).
        </p>
        <div className="inline-flex shrink-0 rounded-md border border-[#1e1e1e] bg-[#0d0d0d] p-0.5">
          {(["delivered", "planned"] as Metric[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              className={
                metric === m
                  ? "rounded bg-[#42CA80]/15 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-[#42CA80]"
                  : "rounded px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-[#606060] hover:text-[#C4BCAA]"
              }
            >
              {m === "delivered" ? "Real" : "Projected"}
            </button>
          ))}
        </div>
      </div>
      <div style={{ width: "100%", height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
            <XAxis dataKey="month" tick={{ fill: "#606060", fontSize: 11 }} tickLine={false} />
            <YAxis
              tick={{ fill: "#606060", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              domain={[0, (max: number) => Math.max(120, Math.ceil(max / 10) * 10)]}
              tickFormatter={(v: number) => `${v}%`}
            />
            <ReferenceLine y={100} stroke="#ED6958" strokeDasharray="6 4" strokeWidth={1} />
            <Tooltip content={<DarkTooltip />} cursor={{ stroke: "#2a2a2a" }} isAnimationActive={false} />
            {pods.map((pod) => (
              <Line
                key={pod}
                type="monotone"
                dataKey={pod}
                name={displayPod(pod, "editorial")}
                stroke={POD_HEX_COLORS[pod] ?? "#606060"}
                strokeWidth={2}
                dot={{ r: 2 }}
                activeDot={{ r: 4 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {pods.map((pod) => (
          <span
            key={pod}
            className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider"
            style={{ color: POD_HEX_COLORS[pod] ?? "#606060" }}
          >
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: POD_HEX_COLORS[pod] ?? "#606060" }} />
            {displayPod(pod, "editorial")}
          </span>
        ))}
      </div>
    </div>
  );
}
