"use client";

import React from "react";
import type { Client, CumulativeMetric } from "@/lib/types";
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
  /** Which pod axis the parent is grouping by. Drives the chip label —
   *  "Editorial Pod 1" vs "Growth Pod 1". Default editorial keeps the
   *  prior behavior intact when callers don't pass it. */
  podKind?: "editorial" | "growth";
  /** Source client object — used solely to anchor the scroll-target id. */
  client?: Client | null;
  /** Which pipeline stages to render. Defaults to all four. The Overview
   *  dashboard passes `["articles","published"]` so its compact cards
   *  show only the billable / shipped stages. */
  stages?: PipelineStage[];
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
  const sowLabel = sow && sow > 0 ? sow : "—";
  // The right-side `value/sow` column already shows the raw numbers, but
  // the bar is the dominant visual — users naturally hover the colored
  // strip first. Repeat the count + denominator inside a tooltip so the
  // bar is self-explanatory without forcing a scan to the right edge.
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <div className="flex items-center gap-2 cursor-help" />
          }
        >
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
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
          <TooltipBody
            title={`${label} ÷ SOW`}
            bullets={[
              `${label}: ${value.toLocaleString()}`,
              `Contracted SOW: ${typeof sowLabel === "number" ? sowLabel.toLocaleString() : sowLabel}`,
              sow && sow > 0
                ? `Progress: ${Math.round(pct)}%`
                : "No SOW on record — cannot compute %.",
            ]}
          />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ClientPipelineCard({
  data,
  sow = null,
  pod = null,
  podKind = "editorial",
  client = null,
  stages = ["topics", "cbs", "articles", "published"],
}: Props) {
  // Articles use SENT (delivered to the client), not approved — the
  // approval step is downstream of delivery and the latter is what
  // billing tracks. Topics and CBs keep `approved` because those gates
  // require explicit client sign-off.
  const articlesValue = data.articles_sent ?? 0;
  const visible = new Set(stages);
  return (
    <div
      id={client ? `cumulative-pipeline-${client.id}` : undefined}
      className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-4 animate-fade-slide hover:border-[#333] transition-colors scroll-mt-[180px]"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {podBadge(pod ?? "Unassigned", podKind)}
          <span className="font-semibold text-white text-sm truncate">{data.client_name}</span>
        </div>
        {data.client_type && (
          <span className="shrink-0 text-[11px] text-[#606060] font-mono">{data.client_type}</span>
        )}
      </div>

      {/* Pipeline bars — every stage measured against contract SOW so they're
          directly comparable. Color is purely informational here; the pacing
          chip on the per-pod card above carries the "behind / ahead" signal. */}
      <div className="space-y-2">
        {visible.has("topics")    && <PipelineBar label="Topics"    stage="topics"    value={data.topics_approved   ?? 0} sow={sow} />}
        {visible.has("cbs")       && <PipelineBar label="CBs"       stage="cbs"       value={data.cbs_sent          ?? 0} sow={sow} />}
        {visible.has("articles")  && <PipelineBar label="Articles"  stage="articles"  value={articlesValue}                 sow={sow} />}
        {visible.has("published") && <PipelineBar label="Published" stage="published" value={data.published_live    ?? 0} sow={sow} />}
      </div>
    </div>
  );
}
