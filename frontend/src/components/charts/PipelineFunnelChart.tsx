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
  ResponsiveContainer,
} from "recharts";
import type { CumulativeMetric } from "@/lib/types";
import { DataSourceBadge } from "@/components/dashboard/DataSourceBadge";

// ---------------------------------------------------------------------------
// Pod Colors (matching design system)
// ---------------------------------------------------------------------------

const POD_COLORS: Record<string, { sent: string; approved: string }> = {
  "Pod 1": { sent: "#8FB5D9", approved: "#5B9BF5" },
  "Pod 2": { sent: "#A3E4C1", approved: "#42CA80" },
  "Pod 3": { sent: "#F5DFA0", approved: "#F5C542" },
  "Pod 4": { sent: "#F5B88A", approved: "#F28D59" },
  "Pod 5": { sent: "#F5A9A0", approved: "#ED6958" },
};

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
          <span className="font-semibold text-white">
            {entry.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface StageData {
  stage: string;
  [key: string]: string | number; // pod-level sent/approved values
}

export function PipelineFunnelChart({ data }: { data: CumulativeMetric[] }) {
  const { chartData, pods } = useMemo(() => {
    // Group by pod
    const podMap = new Map<
      string,
      { topicsSent: number; topicsAppr: number; cbsSent: number; cbsAppr: number; artSent: number; artAppr: number; published: number }
    >();

    for (const row of data) {
      const pod = row.account_team_pod ?? "Unassigned";
      const cur = podMap.get(pod) ?? {
        topicsSent: 0, topicsAppr: 0, cbsSent: 0, cbsAppr: 0, artSent: 0, artAppr: 0, published: 0,
      };
      cur.topicsSent += row.topics_sent ?? 0;
      cur.topicsAppr += row.topics_approved ?? 0;
      cur.cbsSent += row.cbs_sent ?? 0;
      cur.cbsAppr += row.cbs_approved ?? 0;
      cur.artSent += row.articles_sent ?? 0;
      cur.artAppr += row.articles_approved ?? 0;
      cur.published += row.published_live ?? 0;
      podMap.set(pod, cur);
    }

    const podNames = Array.from(podMap.keys()).sort();

    const stages: StageData[] = [
      { stage: "Topics" },
      { stage: "Content Briefs" },
      { stage: "Articles" },
      { stage: "Published" },
    ];

    for (const pod of podNames) {
      const d = podMap.get(pod)!;
      stages[0][`${pod} Sent`] = d.topicsSent;
      stages[0][`${pod} Approved`] = d.topicsAppr;
      stages[1][`${pod} Sent`] = d.cbsSent;
      stages[1][`${pod} Approved`] = d.cbsAppr;
      stages[2][`${pod} Sent`] = d.artSent;
      stages[2][`${pod} Approved`] = d.artAppr;
      stages[3][`${pod} Sent`] = d.published;
      stages[3][`${pod} Approved`] = d.published;
    }

    return { chartData: stages, pods: podNames };
  }, [data]);

  if (chartData.length === 0 || pods.length === 0) return null;

  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#161616] p-6">
      <div className="mb-4 flex items-center gap-2">
        <h4 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
          Pipeline by Pod
        </h4>
        <DataSourceBadge
          type="live"
          source="Sheet: 'Cumulative' — Spreadsheet: Master Tracker. Pipeline stages aggregated by editorial pod."
        />
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <BarChart
          data={chartData}
          margin={{ top: 4, right: 20, left: 4, bottom: 4 }}
          barCategoryGap="25%"
          barGap={2}
        >
          <CartesianGrid
            vertical={false}
            strokeDasharray="3 3"
            stroke="#2a2a2a"
          />
          <XAxis
            dataKey="stage"
            tick={{ fill: "#C4BCAA", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}
            axisLine={{ stroke: "#2a2a2a" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#606060", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
          />
          <Legend
            iconType="square"
            iconSize={8}
            wrapperStyle={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "#606060" }}
          />
          {pods.map((pod) => {
            const colors = POD_COLORS[pod] ?? { sent: "#666", approved: "#999" };
            return [
              <Bar
                key={`${pod}-sent`}
                dataKey={`${pod} Sent`}
                name={`${pod} Sent`}
                fill={colors.sent}
                fillOpacity={0.4}
                radius={[3, 3, 0, 0]}
              />,
              <Bar
                key={`${pod}-appr`}
                dataKey={`${pod} Approved`}
                name={`${pod} Approved`}
                fill={colors.approved}
                fillOpacity={0.85}
                radius={[3, 3, 0, 0]}
              />,
            ];
          })}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
