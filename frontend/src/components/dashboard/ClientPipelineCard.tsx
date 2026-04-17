"use client";

import React from "react";
import type { CumulativeMetric } from "@/lib/types";
import { podBadge, parsePctValue, pctColorNum } from "./shared-helpers";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  data: CumulativeMetric;
}

function PipelineBar({ label, sent, approved, pctStr }: { label: string; sent: number; approved: number; pctStr: string | null }) {
  const pct = parsePctValue(pctStr);
  const barPct = sent > 0 ? Math.min((approved / sent) * 100, 100) : 0;
  const color = pct >= 75 ? "#42CA80" : pct >= 50 ? "#F5C542" : "#ED6958";

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-[#606060] w-14 shrink-0 font-mono">{label}</span>
      <div className="flex-1 h-3 rounded-full bg-[#2a2a2a] overflow-hidden relative">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${barPct}%`, backgroundColor: color, opacity: 0.85 }}
        />
      </div>
      <span className={cn("font-mono text-[10px] font-semibold w-8 text-right", pctColorNum(pct))}>
        {pct > 0 ? `${Math.round(pct)}%` : "—"}
      </span>
      <span className="font-mono text-[10px] text-[#606060] w-14 text-right">
        {approved}/{sent}
      </span>
    </div>
  );
}

export function ClientPipelineCard({ data }: Props) {
  const overallPct = parsePctValue(data.articles_pct_approved);

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-4 animate-fade-slide hover:border-[#333] transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {podBadge(data.account_team_pod)}
          <span className="font-semibold text-white text-sm truncate">{data.client_name}</span>
        </div>
        {data.client_type && (
          <span className="text-[10px] text-[#606060] font-mono shrink-0">{data.client_type}</span>
        )}
      </div>

      {/* Pipeline bars */}
      <div className="space-y-2">
        <PipelineBar
          label="Topics"
          sent={data.topics_sent ?? 0}
          approved={data.topics_approved ?? 0}
          pctStr={data.topics_pct_approved}
        />
        <PipelineBar
          label="CBs"
          sent={data.cbs_sent ?? 0}
          approved={data.cbs_approved ?? 0}
          pctStr={data.cbs_pct_approved}
        />
        <PipelineBar
          label="Articles"
          sent={data.articles_sent ?? 0}
          approved={data.articles_approved ?? 0}
          pctStr={data.articles_pct_approved}
        />
        <PipelineBar
          label="Published"
          sent={data.articles_approved ?? 0}
          approved={data.published_live ?? 0}
          pctStr={data.published_pct_live}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#2a2a2a]">
        {data.articles_difference != null && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className={cn(
                      "font-mono text-[10px] font-semibold cursor-help underline decoration-dotted underline-offset-2",
                      data.articles_difference > 0
                        ? "text-[#42CA80]"
                        : data.articles_difference < 0
                        ? "text-[#ED6958]"
                        : "text-[#606060]"
                    )}
                  />
                }
              >
                Diff: {data.articles_difference > 0 ? `+${data.articles_difference}` : data.articles_difference}
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-sm text-[11px] leading-relaxed space-y-1.5">
                <p>
                  <strong>How many articles this client has received but not yet approved.</strong>
                </p>
                <p className="text-[10px] text-[#9A9A9A]">
                  Formula: <code>articles sent − articles approved</code>. Comes from the Master Tracker&apos;s &quot;Diff&quot; column (stored, not recomputed).
                </p>
                <p className="text-[10px] text-[#9A9A9A]">
                  Example: if 30 articles were sent and 22 are approved, Diff = <strong className="text-white">+8</strong> — eight articles are sitting in the client&apos;s review queue waiting to be signed off.
                </p>
                <ul className="text-[10px] text-[#9A9A9A] list-none space-y-0.5 pt-0.5">
                  <li><span className="text-[#42CA80] font-semibold">Positive</span> — articles in flight, normal state of an active pipeline.</li>
                  <li><span className="text-[#C4BCAA] font-semibold">Zero</span> — approvals are fully caught up.</li>
                  <li><span className="text-[#ED6958] font-semibold">Negative</span> — rare, usually a sheet correction (more approvals logged than items sent).</li>
                </ul>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
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
              Overall: {overallPct > 0 ? `${Math.round(overallPct)}%` : "—"}
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
              Cumulative article approval rate for this client = articles approved ÷ articles sent.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
