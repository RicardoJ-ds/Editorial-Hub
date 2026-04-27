"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Info, ChevronDown, ChevronRight } from "lucide-react";
import type { TeamMember, KpiScore } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TooltipBody } from "./shared-helpers";

// ---------------------------------------------------------------------------
// KPI type display names & classification
// ---------------------------------------------------------------------------

const KPI_DISPLAY_NAMES: Record<string, string> = {
  internal_quality: "Internal Quality",
  external_quality: "External Quality",
  revision_rate: "Revision Rate",
  capacity_utilization: "Capacity Utilization",
  second_reviews: "Second Reviews",
  turnaround_time: "Turnaround Time",
  ai_compliance: "AI Compliance",
  mentorship: "Mentorship",
  feedback_adoption: "Feedback Adoption",
};

/** KPI types where lower is better (score <= target is good) */
const LOWER_IS_BETTER = new Set(["revision_rate", "turnaround_time"]);

interface KpiTooltipSpec {
  title: string;
  bullets: string[];
}

const KPI_TOOLTIPS: Record<string, KpiTooltipSpec> = {
  internal_quality: {
    title: "Internal Quality",
    bullets: [
      "Article quality scored by Senior Editors",
      "Scale 0–100 · Target ≥85",
    ],
  },
  external_quality: {
    title: "External Quality",
    bullets: [
      "Client satisfaction from feedback",
      "Scale 0–100 · Target ≥85",
    ],
  },
  revision_rate: {
    title: "Revision Rate",
    bullets: [
      "% of articles needing client revisions",
      "Lower is better · Target ≤15%",
    ],
  },
  capacity_utilization: {
    title: "Capacity Utilization",
    bullets: [
      "Articles produced ÷ monthly capacity × 100",
      "Target 80–85% (optimal zone)",
    ],
  },
  second_reviews: {
    title: "Second Reviews",
    bullets: [
      "Second-pass reviews by SE per month",
      "Target ≥5",
    ],
  },
  turnaround_time: {
    title: "Turnaround Time",
    bullets: [
      "Avg days from CB approval to article delivery",
      "Lower is better · Target ≤14 days",
    ],
  },
  ai_compliance: {
    title: "AI Compliance",
    bullets: [
      "% of content passing AI detection checks",
      "Target ≥95%",
    ],
  },
  mentorship: {
    title: "Mentorship",
    bullets: [
      "Effectiveness score from Editor feedback",
      "Scale 0–100 · Target ≥80",
    ],
  },
  feedback_adoption: {
    title: "Feedback Adoption",
    bullets: [
      "Rate of applying editorial feedback to next work",
      "Scale 0–100 · Target ≥80",
    ],
  },
};

const SE_KPI_TYPES = [
  "internal_quality",
  "external_quality",
  "revision_rate",
  "capacity_utilization",
  "second_reviews",
  "turnaround_time",
  "ai_compliance",
  "mentorship",
];

const EDITOR_KPI_TYPES = [
  "internal_quality",
  "external_quality",
  "revision_rate",
  "capacity_utilization",
  "turnaround_time",
  "ai_compliance",
  "feedback_adoption",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getKpiColor(
  kpiType: string,
  score: number | null,
  target: number | null
): string {
  if (score === null || target === null) return "text-[#606060]";

  const lowerBetter = LOWER_IS_BETTER.has(kpiType);

  if (lowerBetter) {
    // Lower is better: green if score <= target, yellow if within 10% above, red if much above
    if (score <= target) return "text-[#42CA80]";
    if (score <= target * 1.1) return "text-[#F5BC4E]";
    return "text-[#ED6958]";
  } else {
    // Higher is better: green if score >= target, yellow if within 10%, red if below
    if (score >= target) return "text-[#42CA80]";
    if (score >= target * 0.9) return "text-[#F5BC4E]";
    return "text-[#ED6958]";
  }
}

function getKpiTypesForRole(role: string): string[] {
  if (role === "SE") return SE_KPI_TYPES;
  if (role === "Editor") return EDITOR_KPI_TYPES;
  // Fallback: show all known types
  return Object.keys(KPI_DISPLAY_NAMES);
}

function roleBadgeClass(role: string): string {
  if (role === "SE") return "bg-[#CEBCF4]/15 text-[#CEBCF4] border-[#CEBCF4]/30";
  if (role === "Editor") return "bg-[#8FB5D9]/15 text-[#8FB5D9] border-[#8FB5D9]/30";
  return "bg-[#606060]/15 text-[#909090] border-[#606060]/30";
}

const POD_COLORS: Record<string, string> = {
  "Pod 1": "bg-[#5B9BF5]/15 text-[#5B9BF5] border-[#5B9BF5]/30",
  "Pod 2": "bg-[#42CA80]/15 text-[#42CA80] border-[#42CA80]/30",
  "Pod 3": "bg-[#F5C542]/15 text-[#F5C542] border-[#F5C542]/30",
  "Pod 4": "bg-[#F28D59]/15 text-[#F28D59] border-[#F28D59]/30",
  "Pod 5": "bg-[#ED6958]/15 text-[#ED6958] border-[#ED6958]/30",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface KpiCardProps {
  member: TeamMember;
  scores: KpiScore[];
  month: number;
  year: number;
  clients?: Map<number, string>;
}

export function KpiCard({ member, scores, month, year, clients }: KpiCardProps) {
  const [perClientOpen, setPerClientOpen] = useState(false);
  const kpiTypes = getKpiTypesForRole(member.role);

  // Build a lookup: kpi_type -> KpiScore (aggregate scores with client_id === null)
  const scoreMap = new Map<string, KpiScore>();
  for (const s of scores) {
    if (
      s.team_member_id === member.id &&
      s.year === year &&
      s.month === month &&
      s.client_id === null
    ) {
      scoreMap.set(s.kpi_type, s);
    }
  }

  // Per-client scores: group by client_id
  const perClientScores = useMemo(() => {
    const clientScores = scores.filter(
      (s) =>
        s.team_member_id === member.id &&
        s.year === year &&
        s.month === month &&
        s.client_id !== null
    );
    if (clientScores.length === 0) return null;

    const grouped = new Map<number, KpiScore[]>();
    for (const s of clientScores) {
      const cid = s.client_id!;
      if (!grouped.has(cid)) grouped.set(cid, []);
      grouped.get(cid)!.push(s);
    }
    return grouped;
  }, [scores, member.id, year, month]);

  const podColor =
    POD_COLORS[member.pod ?? ""] ??
    "bg-[#606060]/15 text-[#909090] border-[#606060]/30";

  return (
    <Card className="border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        {/* Header */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-white">{member.name}</span>
          <Badge variant="outline" className={roleBadgeClass(member.role)}>
            {member.role}
          </Badge>
          {member.pod && (
            <Badge variant="outline" className={podColor}>
              {member.pod}
            </Badge>
          )}
        </div>

        {/* KPI Grid */}
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          {kpiTypes.map((kpiType) => {
            const kpi = scoreMap.get(kpiType);
            const score = kpi?.score ?? null;
            const target = kpi?.target ?? null;
            const color = getKpiColor(kpiType, score, target);

            const tooltip = KPI_TOOLTIPS[kpiType];

            return (
              <div key={kpiType}>
                <div className="flex items-center gap-1">
                  <p className="font-mono text-[10px] font-medium uppercase tracking-wider text-[#606060]">
                    {KPI_DISPLAY_NAMES[kpiType] ?? kpiType}
                  </p>
                  {tooltip && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span className="inline-flex cursor-help" />
                          }
                        >
                          <Info className="size-3 text-[#606060] shrink-0" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <TooltipBody
                            title={tooltip.title}
                            bullets={tooltip.bullets}
                          />
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span
                    className={cn("font-mono text-sm font-bold", color)}
                  >
                    {score !== null ? score.toFixed(1) : "\u2014"}
                  </span>
                  <span className="font-mono text-[10px] text-[#606060]">
                    / {target !== null ? target.toFixed(1) : "\u2014"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Per-Client Breakdown */}
        {perClientScores && perClientScores.size > 0 && (
          <div className="mt-3 border-t border-[#2a2a2a] pt-2">
            <button
              onClick={() => setPerClientOpen(!perClientOpen)}
              className="flex items-center gap-1 text-xs font-medium text-[#C4BCAA] hover:text-white transition-colors"
            >
              {perClientOpen ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              Per Client
              <span className="ml-1 font-mono text-[10px] text-[#606060]">
                ({perClientScores.size})
              </span>
            </button>
            {perClientOpen && (
              <div className="mt-2 overflow-x-auto rounded-md border border-[#2a2a2a] bg-[#111111]">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#2a2a2a]">
                      <th className="px-2 py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-[#606060]">
                        Client
                      </th>
                      <th className="px-2 py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-[#606060]">
                        KPI
                      </th>
                      <th className="px-2 py-1.5 text-center font-mono text-[10px] font-medium uppercase tracking-wider text-[#606060]">
                        Score
                      </th>
                      <th className="px-2 py-1.5 text-center font-mono text-[10px] font-medium uppercase tracking-wider text-[#606060]">
                        Target
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(perClientScores.entries()).map(
                      ([clientId, clientKpis]) => {
                        const clientName =
                          clients?.get(clientId) ?? `Client #${clientId}`;
                        return clientKpis.map((kpi, idx) => (
                          <tr
                            key={`${clientId}-${kpi.kpi_type}`}
                            className="border-b border-[#2a2a2a]/50 last:border-b-0"
                          >
                            {idx === 0 ? (
                              <td
                                className="px-2 py-1 text-white whitespace-nowrap"
                                rowSpan={clientKpis.length}
                              >
                                {clientName}
                              </td>
                            ) : null}
                            <td className="px-2 py-1 text-[#C4BCAA] whitespace-nowrap">
                              {KPI_DISPLAY_NAMES[kpi.kpi_type] ??
                                kpi.kpi_type}
                            </td>
                            <td
                              className={cn(
                                "px-2 py-1 text-center font-mono font-bold",
                                getKpiColor(
                                  kpi.kpi_type,
                                  kpi.score,
                                  kpi.target
                                )
                              )}
                            >
                              {kpi.score !== null
                                ? kpi.score.toFixed(1)
                                : "\u2014"}
                            </td>
                            <td className="px-2 py-1 text-center font-mono text-[#606060]">
                              {kpi.target !== null
                                ? kpi.target.toFixed(1)
                                : "\u2014"}
                            </td>
                          </tr>
                        ));
                      }
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export { KPI_DISPLAY_NAMES, getKpiTypesForRole };
