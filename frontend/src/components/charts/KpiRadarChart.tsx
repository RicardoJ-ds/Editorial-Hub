"use client";

import { useMemo } from "react";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { KpiScore } from "@/lib/types";

const KPI_DISPLAY_NAMES: Record<string, string> = {
  internal_quality: "Internal Quality",
  external_quality: "External Quality",
  revision_rate: "Revision Rate",
  capacity_utilization: "Capacity Util.",
  second_reviews: "Second Reviews",
  turnaround_time: "Turnaround Time",
  ai_compliance: "AI Compliance",
  mentorship: "Mentorship",
  feedback_adoption: "Feedback",
};

/** KPI types where lower is better */
const LOWER_IS_BETTER = new Set(["revision_rate", "turnaround_time"]);

interface TooltipPayloadEntry {
  name: string;
  value: number;
  color?: string;
  payload?: Record<string, unknown>;
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
          <span className="text-[#C4BCAA]">{entry.name}:</span>
          <span className="font-mono font-semibold text-white">
            {entry.value.toFixed(0)}
          </span>
        </div>
      ))}
    </div>
  );
}

interface KpiRadarChartProps {
  scores: KpiScore[];
  memberName: string;
}

export function KpiRadarChart({ scores, memberName }: KpiRadarChartProps) {
  const data = useMemo(() => {
    // Group scores by kpi_type
    const map = new Map<string, { score: number | null; target: number | null }>();
    for (const s of scores) {
      map.set(s.kpi_type, { score: s.score, target: s.target });
    }

    return Array.from(map.entries()).map(([kpiType, { score, target }]) => {
      // Normalize to 0-100 scale
      let normalizedScore = 0;
      let normalizedTarget = 0;

      if (LOWER_IS_BETTER.has(kpiType)) {
        // For lower-is-better: invert the scale relative to target
        // Score of 0 = 100, score of 2*target = 0
        const maxVal = (target ?? 1) * 2;
        normalizedScore =
          score !== null ? Math.max(0, Math.min(100, ((maxVal - score) / maxVal) * 100)) : 0;
        normalizedTarget =
          target !== null ? Math.max(0, Math.min(100, ((maxVal - target) / maxVal) * 100)) : 0;
      } else {
        // Higher is better: normalize relative to target * 1.2
        const maxVal = (target ?? 1) * 1.2;
        normalizedScore =
          score !== null ? Math.max(0, Math.min(100, (score / maxVal) * 100)) : 0;
        normalizedTarget =
          target !== null ? Math.max(0, Math.min(100, (target / maxVal) * 100)) : 0;
      }

      return {
        kpi: KPI_DISPLAY_NAMES[kpiType] ?? kpiType,
        Actual: Math.round(normalizedScore),
        Target: Math.round(normalizedTarget),
      };
    });
  }, [scores]);

  if (data.length === 0) {
    return (
      <Card className="border-[#2a2a2a] bg-[#161616]">
        <CardContent className="pt-0">
          <p className="text-center text-sm text-[#606060]">
            No KPI data available.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-[#2a2a2a] bg-[#161616]">
      <CardHeader>
        <CardTitle className="text-white">{memberName} — KPI Radar</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ResponsiveContainer width="100%" height={320}>
          <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
            <PolarGrid stroke="#2a2a2a" />
            <PolarAngleAxis
              dataKey="kpi"
              tick={{
                fill: "#C4BCAA",
                fontSize: 10,
                fontFamily: "var(--font-mono), monospace",
              }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tick={{
                fill: "#606060",
                fontSize: 9,
                fontFamily: "var(--font-mono), monospace",
              }}
              axisLine={false}
            />
            <Radar
              name="Target"
              dataKey="Target"
              stroke="#606060"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              fill="transparent"
            />
            <Radar
              name="Actual"
              dataKey="Actual"
              stroke="#42CA80"
              strokeWidth={2}
              fill="#42CA80"
              fillOpacity={0.15}
            />
            <Tooltip content={<CustomTooltip />} />
          </RadarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
