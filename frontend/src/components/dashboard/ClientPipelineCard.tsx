"use client";

import React from "react";
import type { CumulativeMetric } from "@/lib/types";
import { podBadge, pctColorNum } from "./shared-helpers";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  data: CumulativeMetric;
  /** Contract SOW article count — used as the denominator for every pipeline
   *  stage. When null/0 the card falls back to showing "—" for pct. */
  sow?: number | null;
  /** Editorial pod label to render on the card's badge. Passed in from the
   *  parent so the badge matches its group header. When blank we show an
   *  "Unassigned" chip rather than falling back to the sheet's
   *  account_team_pod column — that column carries growth/account pod
   *  labels and would mix axes with the editorial-pod grouping above. */
  pod?: string | null;
}

function PipelineBar({ label, value, sow }: { label: string; value: number; sow: number | null }) {
  const pct = sow && sow > 0 ? (value / sow) * 100 : 0;
  const color = pct >= 75 ? "#42CA80" : pct >= 50 ? "#F5C542" : "#ED6958";
  const barPct = Math.min(pct, 100);

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-[#606060] w-14 shrink-0 font-mono">{label}</span>
      <div className="flex-1 h-3 rounded-full bg-[#2a2a2a] overflow-hidden relative">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${barPct}%`, backgroundColor: color, opacity: 0.85 }}
        />
      </div>
      <span className={cn("font-mono text-[10px] font-semibold w-9 text-right", pctColorNum(pct))}>
        {sow && sow > 0 ? `${Math.round(pct)}%` : "—"}
      </span>
      <span className="font-mono text-[10px] text-[#606060] w-14 text-right tabular-nums">
        {value}/{sow ?? "—"}
      </span>
    </div>
  );
}

export function ClientPipelineCard({ data, sow = null, pod = null }: Props) {
  const overallPct = sow && sow > 0 ? (((data.articles_approved ?? 0) / sow) * 100) : 0;

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-4 animate-fade-slide hover:border-[#333] transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {podBadge(pod ?? "Unassigned")}
          <span className="font-semibold text-white text-sm truncate">{data.client_name}</span>
        </div>
        {data.client_type && (
          <span className="text-[10px] text-[#606060] font-mono shrink-0">{data.client_type}</span>
        )}
      </div>

      {/* Pipeline bars — every stage measured against contract SOW so they're
          directly comparable. "Value" is the approved/live count at each stage. */}
      <div className="space-y-2">
        <PipelineBar label="Topics"    value={data.topics_approved   ?? 0} sow={sow} />
        <PipelineBar label="CBs"       value={data.cbs_approved      ?? 0} sow={sow} />
        <PipelineBar label="Articles"  value={data.articles_approved ?? 0} sow={sow} />
        <PipelineBar label="Published" value={data.published_live    ?? 0} sow={sow} />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end mt-3 pt-2 border-t border-[#2a2a2a]">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className={cn(
                    "font-mono text-[10px] font-semibold cursor-help underline decoration-dotted underline-offset-2",
                    pctColorNum(overallPct)
                  )}
                />
              }
            >
              Approved articles: {sow && sow > 0 ? `${Math.round(overallPct)}%` : "—"}
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
              Share of contracted SOW currently approved = articles approved ÷ SOW. Same denominator the pipeline bars use, so this is the article-stage number from the Articles bar.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
