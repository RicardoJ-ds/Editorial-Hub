"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api";
import type {
  Client,
  CumulativeMetric,
  GoalsVsDeliveryRow,
} from "@/lib/types";
import { ProgressArc } from "@/components/charts/ProgressArc";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DataSourceBadge } from "./DataSourceBadge";
import { podBadge, goalStatusBadge, pctColorNum } from "./shared-helpers";
import { cn } from "@/lib/utils";

interface Props {
  filteredClients: Client[];
}

// ---------------------------------------------------------------------------
// Pod aggregates
// ---------------------------------------------------------------------------

interface PodGoalAgg {
  pod: string;
  clientCount: number;
  clientNames: string[];
  cbDelivered: number;
  cbGoal: number;
  adDelivered: number;
  adGoal: number;
  backlog: number;
  revisions: number;
}

interface PodPipelineAgg {
  pod: string;
  clientCount: number;
  clientNames: string[];
  topicsSent: number;
  topicsApproved: number;
  cbsSent: number;
  cbsApproved: number;
  articlesSent: number;
  articlesApproved: number;
  articlesDifference: number;
  publishedLive: number;
}

function sortPodKey(a: string, b: string) {
  // Unassigned last, then numerically
  if (a === "Unassigned" && b !== "Unassigned") return 1;
  if (b === "Unassigned" && a !== "Unassigned") return -1;
  const na = parseInt(a.replace(/\D/g, ""), 10);
  const nb = parseInt(b.replace(/\D/g, ""), 10);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

/** Collapse every variant ("1", "pod 1", "Pod 1", "P1", " Pod  1 ") into a
 *  canonical "Pod N"; blanks/dashes fall through to "Unassigned". This keeps
 *  the matrix columns — and the FilterBar pod filter — consistent regardless
 *  of which sheet column the pod value originated from. */
function normalizePod(raw: string | null | undefined): string {
  if (raw == null) return "Unassigned";
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed === "-" || trimmed === "—") return "Unassigned";
  const pureNum = trimmed.match(/^(\d+)$/);
  if (pureNum) return `Pod ${pureNum[1]}`;
  const podNum = trimmed.match(/^p(?:od)?\s*(\d+)$/i);
  if (podNum) return `Pod ${podNum[1]}`;
  return trimmed;
}

/** Aggregate goal rows by CLIENT's editorial_pod (via the clientToPod map)
 *  rather than the row's `editorial_team_pod` column, so filter semantics are
 *  consistent with the FilterBar (which filters on Client.editorial_pod). */
function aggregateGoalsByPod(
  rows: GoalsVsDeliveryRow[],
  clientToPod: Map<string, string>,
): PodGoalAgg[] {
  // Latest week per client first
  const latestByClient = new Map<string, GoalsVsDeliveryRow>();
  for (const r of rows) {
    const existing = latestByClient.get(r.client_name);
    if (!existing || r.week_number > existing.week_number) latestByClient.set(r.client_name, r);
  }
  const byPod = new Map<string, PodGoalAgg>();
  for (const r of latestByClient.values()) {
    const pod = normalizePod(clientToPod.get(r.client_name) ?? r.editorial_team_pod);
    if (!byPod.has(pod)) {
      byPod.set(pod, {
        pod, clientCount: 0, clientNames: [],
        cbDelivered: 0, cbGoal: 0, adDelivered: 0, adGoal: 0,
        backlog: 0, revisions: 0,
      });
    }
    const agg = byPod.get(pod)!;
    agg.clientCount += 1;
    agg.clientNames.push(r.client_name);
    agg.cbDelivered += r.cb_delivered_to_date ?? 0;
    agg.cbGoal += r.cb_monthly_goal ?? 0;
    agg.adDelivered += r.ad_delivered_to_date ?? 0;
    agg.adGoal += r.ad_monthly_goal ?? 0;
    agg.backlog += r.ad_cb_backlog ?? 0;
    agg.revisions += r.ad_revisions ?? 0;
  }
  return Array.from(byPod.values()).sort((a, b) => sortPodKey(a.pod, b.pod));
}

function aggregatePipelineByPod(
  rows: CumulativeMetric[],
  clientToPod: Map<string, string>,
): PodPipelineAgg[] {
  const byPod = new Map<string, PodPipelineAgg>();
  for (const r of rows) {
    const pod = normalizePod(clientToPod.get(r.client_name) ?? r.account_team_pod);
    if (!byPod.has(pod)) {
      byPod.set(pod, {
        pod, clientCount: 0, clientNames: [],
        topicsSent: 0, topicsApproved: 0,
        cbsSent: 0, cbsApproved: 0,
        articlesSent: 0, articlesApproved: 0,
        articlesDifference: 0, publishedLive: 0,
      });
    }
    const agg = byPod.get(pod)!;
    agg.clientCount += 1;
    agg.clientNames.push(r.client_name);
    agg.topicsSent += r.topics_sent ?? 0;
    agg.topicsApproved += r.topics_approved ?? 0;
    agg.cbsSent += r.cbs_sent ?? 0;
    agg.cbsApproved += r.cbs_approved ?? 0;
    agg.articlesSent += r.articles_sent ?? 0;
    agg.articlesApproved += r.articles_approved ?? 0;
    agg.articlesDifference += r.articles_difference ?? 0;
    agg.publishedLive += r.published_live ?? 0;
  }
  return Array.from(byPod.values()).sort((a, b) => sortPodKey(a.pod, b.pod));
}

// ---------------------------------------------------------------------------
// Small label+tooltip helper
// ---------------------------------------------------------------------------

function InfoLabel({ text, hint }: { text: string; hint: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="underline decoration-dotted decoration-[#606060] underline-offset-2 cursor-help" />
          }
        >
          {text}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
          {hint}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Goal cell (compact card inside matrix)
// ---------------------------------------------------------------------------

function GoalCell({ data }: { data: PodGoalAgg | null }) {
  if (!data) {
    return (
      <div className="rounded-lg border border-dashed border-[#2a2a2a] bg-[#0c0c0c] p-3 text-center text-[10px] font-mono text-[#606060]">
        No goal data
      </div>
    );
  }
  const cbPct = data.cbGoal > 0 ? Math.round((data.cbDelivered / data.cbGoal) * 100) : 0;
  const adPct = data.adGoal > 0 ? Math.round((data.adDelivered / data.adGoal) * 100) : 0;

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-3 transition-colors hover:border-[#333] animate-fade-slide">
      <div className="mb-2 flex items-center justify-end">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<span className="cursor-help" />}>
              {goalStatusBadge(cbPct, adPct)}
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
              Avg of CB % and Article % for the pod this month. ≥75% = On Track, 50–74% = Behind, &lt;50% = At Risk.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="flex items-center justify-center gap-4">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<div className="cursor-help" />}>
              <ProgressArc value={data.cbDelivered} max={data.cbGoal} label="CBs" />
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px] leading-relaxed">
              CBs delivered vs monthly goal, summed across {data.clientCount} client
              {data.clientCount === 1 ? "" : "s"} in this pod.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<div className="cursor-help" />}>
              <ProgressArc value={data.adDelivered} max={data.adGoal} label="Articles" />
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px] leading-relaxed">
              Articles delivered vs monthly goal, summed across {data.clientCount} client
              {data.clientCount === 1 ? "" : "s"} in this pod.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {(data.revisions > 0 || data.backlog > 0) && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
          {data.revisions > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-mono font-semibold bg-[#F5C542]/12 text-[#F5C542] cursor-help" />}>
                  Rev: {data.revisions}
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
                  Open article revision requests this month across the pod.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {data.backlog > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-mono font-semibold bg-[#ED6958]/12 text-[#ED6958] cursor-help" />}>
                  Backlog: {data.backlog}
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
                  Approved CBs not yet written into articles.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline cell (compact card inside matrix)
// ---------------------------------------------------------------------------

function PipelineBar({ label, hint, sent, approved }: { label: string; hint: string; sent: number; approved: number }) {
  const pct = sent > 0 ? (approved / sent) * 100 : 0;
  const color = pct >= 75 ? "#42CA80" : pct >= 50 ? "#F5C542" : "#ED6958";
  return (
    <div className="flex items-center gap-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="text-[9px] text-[#C4BCAA] w-12 shrink-0 font-mono cursor-help underline decoration-dotted decoration-[#404040] underline-offset-2" />
            }
          >
            {label}
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
            {hint}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <div className="flex-1 h-2.5 rounded-full bg-[#2a2a2a] overflow-hidden relative">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color, opacity: 0.85 }}
        />
      </div>
      <span className={cn("font-mono text-[9px] font-semibold w-9 text-right", pctColorNum(pct))}>
        {pct > 0 ? `${Math.round(pct)}%` : "—"}
      </span>
      <span className="font-mono text-[9px] text-[#606060] w-14 text-right">
        {approved}/{sent}
      </span>
    </div>
  );
}

function PipelineCell({ data }: { data: PodPipelineAgg | null }) {
  if (!data) {
    return (
      <div className="rounded-lg border border-dashed border-[#2a2a2a] bg-[#0c0c0c] p-3 text-center text-[10px] font-mono text-[#606060]">
        No pipeline data
      </div>
    );
  }
  const overallPct = data.articlesSent > 0
    ? Math.round((data.articlesApproved / data.articlesSent) * 100)
    : 0;

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-3 animate-fade-slide hover:border-[#333] transition-colors">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[9px] font-mono text-[#606060]">All-time</span>
      </div>
      <div className="space-y-1.5">
        <PipelineBar label="Topics"    hint="Topics approved vs topics sent for approval — first stage of the funnel." sent={data.topicsSent}    approved={data.topicsApproved} />
        <PipelineBar label="CBs"       hint="Content Briefs approved vs sent — second stage, before writing begins."    sent={data.cbsSent}       approved={data.cbsApproved} />
        <PipelineBar label="Articles"  hint="Articles approved by client vs articles sent for review."                   sent={data.articlesSent}  approved={data.articlesApproved} />
        <PipelineBar label="Published" hint="Articles published live vs approved — final stage of the funnel."           sent={data.articlesApproved} approved={data.publishedLive} />
      </div>
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#2a2a2a]">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <span className={cn(
                  "font-mono text-[9px] font-semibold cursor-help underline decoration-dotted underline-offset-2",
                  data.articlesDifference > 0 ? "text-[#42CA80]" : data.articlesDifference < 0 ? "text-[#ED6958]" : "text-[#606060]"
                )} />
              }
            >
              Δ: {data.articlesDifference > 0 ? `+${data.articlesDifference}` : data.articlesDifference}
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
              <strong>Articles sent − articles approved</strong> (Master Tracker&apos;s &quot;Diff&quot; column), summed across the pod. Positive = articles delivered to clients that are still awaiting approval. Zero = approvals are caught up. Negative is rare and usually a sheet correction.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <span className={cn(
                  "font-mono text-[9px] font-semibold cursor-help underline decoration-dotted underline-offset-2",
                  pctColorNum(overallPct)
                )} />
              }
            >
              Overall: {overallPct > 0 ? `${overallPct}%` : "—"}
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
              Cumulative article approval rate = articles approved ÷ articles sent across the pod.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main section — matrix layout
// ---------------------------------------------------------------------------

export function ContractClientProgress({ filteredClients }: Props) {
  const [goalRows, setGoalRows] = useState<GoalsVsDeliveryRow[]>([]);
  const [pipelineRows, setPipelineRows] = useState<CumulativeMetric[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiGet<GoalsVsDeliveryRow[]>("/api/goals-delivery/latest").catch(() => [] as GoalsVsDeliveryRow[]),
      apiGet<CumulativeMetric[]>("/api/goals-delivery/cumulative").catch(() => [] as CumulativeMetric[]),
    ])
      .then(([goals, pipeline]) => {
        if (cancelled) return;
        setGoalRows(goals);
        setPipelineRows(pipeline);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Canonical source of truth for "what pod is this client on" is the filtered
  // Client row's editorial_pod. Using this everywhere means the FilterBar's
  // pod filter applies consistently to both matrix rows (goals + pipeline),
  // regardless of whether the underlying sheet row stores editorial_team_pod
  // or account_team_pod.
  const clientToPod = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of filteredClients) {
      if (c.editorial_pod) map.set(c.name, normalizePod(c.editorial_pod));
    }
    return map;
  }, [filteredClients]);

  const filterNames = useMemo(
    () => new Set(filteredClients.map((c) => c.name)),
    [filteredClients]
  );

  const goalPods = useMemo(() => {
    const filtered = goalRows.filter((r) => filterNames.has(r.client_name));
    return aggregateGoalsByPod(filtered, clientToPod);
  }, [goalRows, filterNames, clientToPod]);

  const pipelinePods = useMemo(() => {
    const filtered = pipelineRows.filter((r) => filterNames.has(r.client_name));
    return aggregatePipelineByPod(filtered, clientToPod);
  }, [pipelineRows, filterNames, clientToPod]);

  // Matrix columns = union of pods present in either aggregation.
  const podColumns = useMemo(() => {
    const set = new Set<string>();
    for (const g of goalPods) set.add(g.pod);
    for (const p of pipelinePods) set.add(p.pod);
    return Array.from(set).sort(sortPodKey);
  }, [goalPods, pipelinePods]);

  const goalByPod = useMemo(() => {
    const map = new Map<string, PodGoalAgg>();
    for (const g of goalPods) map.set(g.pod, g);
    return map;
  }, [goalPods]);

  const pipelineByPod = useMemo(() => {
    const map = new Map<string, PodPipelineAgg>();
    for (const p of pipelinePods) map.set(p.pod, p);
    return map;
  }, [pipelinePods]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-[220px]" />
        <Skeleton className="h-[220px]" />
      </div>
    );
  }

  if (podColumns.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#2a2a2a] bg-[#0c0c0c] px-4 py-6 text-center text-sm text-[#606060]">
        No pod data for the selected filters.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
            Pod Matrix — Current Month Goals & Cumulative Pipeline
          </h3>
          <DataSourceBadge
            type="live"
            source="Sheets: '[Month Year] Goals vs Delivery' (top row) + 'Cumulative' (bottom row) — Spreadsheet: Master Tracker. Grouped by the client's editorial_pod from the Client record."
          />
        </div>
        <p className="text-[10px] text-[#606060]">
          <InfoLabel text="On Track / Behind / At Risk" hint="Goals status buckets: ≥75% On Track, 50–74% Behind, <50% At Risk." />{" "}
          ·{" "}
          <InfoLabel text="Articles Δ / Overall %" hint="Pipeline deltas and cumulative approval rate." />
        </p>
      </div>

      {/* Matrix: one column per pod, two rows (Goals, Pipeline).
          Pod columns have a capped max width so a single filtered pod doesn't
          stretch across the whole page, and the grid uses fit-content so the
          tracks hug the left edge instead of right-aligning in the parent. */}
      <div className="overflow-x-auto">
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: `110px repeat(${podColumns.length}, minmax(240px, 320px))`,
            width: "fit-content",
          }}
        >
          {/* Header row — pod labels */}
          <div />
          {podColumns.map((pod) => {
            const g = goalByPod.get(pod);
            const p = pipelineByPod.get(pod);
            const count = Math.max(g?.clientCount ?? 0, p?.clientCount ?? 0);
            return (
              <div
                key={`h-${pod}`}
                className="flex items-center justify-between rounded-md border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  {podBadge(pod)}
                  <span className="font-mono text-[10px] text-[#606060]">
                    {count} client{count === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Goals row */}
          <div className="flex items-center px-2 font-mono text-[10px] uppercase tracking-widest text-[#606060]">
            Month Goals
          </div>
          {podColumns.map((pod) => (
            <GoalCell key={`g-${pod}`} data={goalByPod.get(pod) ?? null} />
          ))}

          {/* Pipeline row */}
          <div className="flex items-center px-2 font-mono text-[10px] uppercase tracking-widest text-[#606060]">
            Pipeline (all-time)
          </div>
          {podColumns.map((pod) => (
            <PipelineCell key={`p-${pod}`} data={pipelineByPod.get(pod) ?? null} />
          ))}
        </div>
      </div>
    </div>
  );
}
