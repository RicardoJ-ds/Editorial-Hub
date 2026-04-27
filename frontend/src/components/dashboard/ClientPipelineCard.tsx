"use client";

import React from "react";
import type { CumulativeMetric } from "@/lib/types";
import {
  PIPELINE_STAGE_COLORS,
  TooltipBody,
  podBadge,
  type PipelineStage,
} from "./shared-helpers";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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

// Per-client pipeline cards live below the per-pod aggregate row, which
// already carries the pacing chip + status colors. At the per-client level
// we want a calm, judgment-free progress snapshot — colors mark the funnel
// STAGE (Topics → Published), not performance. A brand-new client and a
// mature client read with the same color, just different bar widths.
function PipelineBar({
  label,
  stage,
  value,
  sow,
}: {
  label: string;
  stage: PipelineStage;
  value: number;
  sow: number | null;
}) {
  const pct = sow && sow > 0 ? (value / sow) * 100 : 0;
  const barPct = Math.min(pct, 100);
  const fill = PIPELINE_STAGE_COLORS[stage];
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-[#606060] w-14 shrink-0 font-mono">{label}</span>
      <div className="flex-1 h-3 rounded-full bg-[#1f1f1f] overflow-hidden relative">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${barPct}%`, backgroundColor: fill, opacity: 0.85 }}
        />
      </div>
      <span className="font-mono text-[11px] font-semibold w-9 text-right tabular-nums text-[#C4BCAA]">
        {sow && sow > 0 ? `${Math.round(pct)}%` : "—"}
      </span>
      <span className="font-mono text-[11px] text-[#606060] w-14 text-right tabular-nums">
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
          <span className="text-[11px] text-[#606060] font-mono shrink-0">{data.client_type}</span>
        )}
      </div>

      {/* Pipeline bars — every stage measured against contract SOW so they're
          directly comparable. Color is purely informational here; the pacing
          chip on the per-pod card above carries the "behind / ahead" signal. */}
      <div className="space-y-2">
        <PipelineBar label="Topics"    stage="topics"    value={data.topics_approved   ?? 0} sow={sow} />
        <PipelineBar label="CBs"       stage="cbs"       value={data.cbs_approved      ?? 0} sow={sow} />
        <PipelineBar label="Articles"  stage="articles"  value={data.articles_approved ?? 0} sow={sow} />
        <PipelineBar label="Published" stage="published" value={data.published_live    ?? 0} sow={sow} />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end mt-3 pt-2 border-t border-[#2a2a2a]">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="font-mono text-[11px] font-semibold cursor-help underline decoration-dotted underline-offset-2 text-[#C4BCAA]" />
              }
            >
              Approved articles: {sow && sow > 0 ? `${Math.round(overallPct)}%` : "—"}
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
              <TooltipBody
                title="Approved Articles ÷ SOW"
                bullets={[
                  "Share of contracted SOW currently approved",
                  "Same denominator as the pipeline bars",
                  "Status / risk lives on the pod card above (pacing chip)",
                ]}
              />
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
