"use client";

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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AIMonitoringBreakdown } from "@/lib/types";

const COLORS = {
  full_pass: "#65FFAA",
  partial_pass: "#F5A623",
  review_rewrite: "#FF6B6B",
};

interface RecommendationChartProps {
  data: AIMonitoringBreakdown[];
  title: string;
  maxItems?: number;
}

export default function RecommendationChart({
  data,
  title,
  maxItems = 25,
}: RecommendationChartProps) {
  const chartData = data.slice(0, maxItems).map((d) => ({
    name: d.name.length > 15 ? d.name.slice(0, 13) + "…" : d.name,
    fullName: d.name,
    "Full Pass": d.full_pass,
    "Partial Pass": d.partial_pass,
    "Review/Rewrite": d.review_rewrite,
  }));

  return (
    <Card className="border-[#2a2a2a] bg-[#161616]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-[#999]">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={chartData}
            margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis
              dataKey="name"
              tick={{ fill: "#999", fontSize: 10 }}
              angle={-45}
              textAnchor="end"
              height={60}
              interval={0}
            />
            <YAxis tick={{ fill: "#999", fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1F1F1F",
                border: "1px solid #333",
                borderRadius: "6px",
                color: "#fff",
                fontSize: 12,
              }}
              labelFormatter={(_, payload) => {
                if (payload?.[0]?.payload?.fullName) {
                  return payload[0].payload.fullName;
                }
                return "";
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, color: "#999" }}
              iconType="square"
            />
            <Bar
              dataKey="Full Pass"
              stackId="a"
              fill={COLORS.full_pass}
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="Partial Pass"
              stackId="a"
              fill={COLORS.partial_pass}
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="Review/Rewrite"
              stackId="a"
              fill={COLORS.review_rewrite}
              radius={[2, 2, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
