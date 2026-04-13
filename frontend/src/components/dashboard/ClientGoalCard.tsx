"use client";

import React, { useState } from "react";
import type { GoalsVsDeliveryRow, WeeklyDetailRow } from "@/lib/types";
import { ProgressArc } from "@/components/charts/ProgressArc";
import { podBadge, goalStatusBadge, parsePctValue } from "./shared-helpers";
import { apiGet } from "@/lib/api";
import type { ClientDeliveryResponse } from "@/lib/types";
import { ChevronDown, ChevronRight } from "lucide-react";

interface Props {
  data: GoalsVsDeliveryRow;
}

export function ClientGoalCard({ data }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [weeks, setWeeks] = useState<WeeklyDetailRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const cbPct = parsePctValue(data.cb_pct_of_goal);
  const adPct = parsePctValue(data.ad_pct_of_goal);

  const handleExpand = () => {
    setExpanded((prev) => !prev);
    if (!weeks && !loading) {
      setLoading(true);
      // Parse month_year to get year+month for API call
      const parts = data.month_year?.split(" ") ?? [];
      const monthNames: Record<string, number> = {
        January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
        July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
      };
      const month = monthNames[parts[0]] ?? 1;
      const year = parseInt(parts[1]) || 2026;

      apiGet<ClientDeliveryResponse>(
        `/api/dashboard/client-delivery?view=weekly&client_name=${encodeURIComponent(data.client_name)}&year=${year}&month=${month}`
      )
        .then((resp) => setWeeks(resp.weekly_rows ?? []))
        .catch(() => setWeeks([]))
        .finally(() => setLoading(false));
    }
  };

  return (
    <div
      className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-4 transition-colors hover:border-[#333] animate-fade-slide cursor-pointer"
      onClick={handleExpand}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {podBadge(data.editorial_team_pod)}
          <span className="font-semibold text-white text-sm truncate">{data.client_name}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {goalStatusBadge(cbPct, adPct)}
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-[#42CA80]" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-[#606060]" />
          )}
        </div>
      </div>

      {/* Progress arcs */}
      <div className="flex items-center justify-center gap-6">
        <ProgressArc
          value={data.cb_delivered_to_date ?? 0}
          max={data.cb_monthly_goal ?? 0}
          label="CBs"
        />
        <ProgressArc
          value={data.ad_delivered_to_date ?? 0}
          max={data.ad_monthly_goal ?? 0}
          label="Articles"
        />
      </div>

      {/* Alert pills */}
      <div className="flex items-center gap-2 mt-3 justify-center">
        {(data.ad_revisions ?? 0) > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold bg-[#F5C542]/12 text-[#F5C542]">
            Rev: {data.ad_revisions}
          </span>
        )}
        {(data.ad_cb_backlog ?? 0) > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold bg-[#ED6958]/12 text-[#ED6958]">
            Backlog: {data.ad_cb_backlog}
          </span>
        )}
        {data.client_type && (
          <span className="text-[10px] text-[#606060] font-mono">{data.client_type}</span>
        )}
      </div>

      {/* Expanded weekly detail */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-[#2a2a2a] animate-fade-slide">
          {loading ? (
            <div className="text-xs text-[#606060] text-center py-2">Loading weeks...</div>
          ) : weeks && weeks.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {weeks.map((w) => (
                <div
                  key={w.week_number}
                  className="flex-shrink-0 rounded border border-[#2a2a2a] bg-[#0d0d0d] p-2 min-w-[140px]"
                >
                  <div className="font-mono text-[9px] text-[#606060] uppercase mb-1.5">
                    W{w.week_number}
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-[9px] text-[#606060]">CB</span>
                      <span className="font-mono text-[10px] text-white">
                        +{w.cb_delivered_today ?? 0}
                        <span className="text-[#606060] ml-0.5">({w.cb_delivered_to_date ?? 0}/{w.cb_monthly_goal ?? "—"})</span>
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[9px] text-[#606060]">AD</span>
                      <span className="font-mono text-[10px] text-white">
                        +{w.ad_delivered_today ?? 0}
                        <span className="text-[#606060] ml-0.5">({w.ad_delivered_to_date ?? 0}/{w.ad_monthly_goal ?? "—"})</span>
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-[#606060] text-center py-1">No weekly data</div>
          )}
        </div>
      )}
    </div>
  );
}
