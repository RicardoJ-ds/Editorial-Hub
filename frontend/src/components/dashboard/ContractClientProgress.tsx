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
  monthYear: string | null;
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
  const na = parseInt(a.replace(/\D/g, ""), 10);
  const nb = parseInt(b.replace(/\D/g, ""), 10);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

function aggregateGoalsByPod(rows: GoalsVsDeliveryRow[]): PodGoalAgg[] {
  // Latest week per client first
  const latestByClient = new Map<string, GoalsVsDeliveryRow>();
  for (const r of rows) {
    const existing = latestByClient.get(r.client_name);
    if (!existing || r.week_number > existing.week_number) latestByClient.set(r.client_name, r);
  }
  const byPod = new Map<string, PodGoalAgg>();
  for (const r of latestByClient.values()) {
    const pod = r.editorial_team_pod ?? "Unassigned";
    if (!byPod.has(pod)) {
      byPod.set(pod, {
        pod, clientCount: 0, clientNames: [],
        cbDelivered: 0, cbGoal: 0, adDelivered: 0, adGoal: 0,
        backlog: 0, revisions: 0,
        monthYear: r.month_year,
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

function aggregatePipelineByPod(rows: CumulativeMetric[]): PodPipelineAgg[] {
  const byPod = new Map<string, PodPipelineAgg>();
  for (const r of rows) {
    const pod = r.account_team_pod ?? "Unassigned";
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
// Pod goal card
// ---------------------------------------------------------------------------

function PodGoalCard({ data }: { data: PodGoalAgg }) {
  const cbPct = data.cbGoal > 0 ? Math.round((data.cbDelivered / data.cbGoal) * 100) : 0;
  const adPct = data.adGoal > 0 ? Math.round((data.adDelivered / data.adGoal) * 100) : 0;

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-4 transition-colors hover:border-[#333] animate-fade-slide">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {podBadge(data.pod)}
          <span className="text-[10px] font-mono text-[#606060]">{data.clientCount} clients</span>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<span className="cursor-help" />}>
              {goalStatusBadge(cbPct, adPct)}
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
              Average of CB % and Article % for this pod this month. ≥75% = On Track, 50–74% = Behind, &lt;50% = At Risk.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Month context */}
      {data.monthYear && (
        <p className="text-[9px] font-mono text-[#606060] mb-2">{data.monthYear} — latest week</p>
      )}

      {/* Progress arcs — totals across the pod's clients */}
      <div className="flex items-center justify-center gap-6">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={<div className="cursor-help" />}
            >
              <ProgressArc value={data.cbDelivered} max={data.cbGoal} label="CBs" />
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px] leading-relaxed">
              Content Briefs delivered vs monthly goal, summed across {data.clientCount} client{data.clientCount === 1 ? "" : "s"} in this pod.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={<div className="cursor-help" />}
            >
              <ProgressArc value={data.adDelivered} max={data.adGoal} label="Articles" />
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px] leading-relaxed">
              Articles delivered vs monthly goal, summed across {data.clientCount} client{data.clientCount === 1 ? "" : "s"} in this pod.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Alert pills */}
      <div className="flex items-center gap-2 mt-3 justify-center flex-wrap">
        {data.revisions > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold bg-[#F5C542]/12 text-[#F5C542] cursor-help" />}>
                Rev: {data.revisions}
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
                Article revision requests still open across the pod this month.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {data.backlog > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold bg-[#ED6958]/12 text-[#ED6958] cursor-help" />}>
                Backlog: {data.backlog}
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
                Approved CBs not yet written into articles — the pod&apos;s build-up of in-flight work.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Clients footer */}
      <div className="mt-3 pt-2 border-t border-[#2a2a2a]">
        <p className="text-[9px] font-mono text-[#606060] truncate" title={data.clientNames.join(", ")}>
          {data.clientNames.join(" · ")}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pod pipeline card
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
              <span className="text-[10px] text-[#C4BCAA] w-14 shrink-0 font-mono cursor-help underline decoration-dotted decoration-[#404040] underline-offset-2" />
            }
          >
            {label}
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
            {hint}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <div className="flex-1 h-3 rounded-full bg-[#2a2a2a] overflow-hidden relative">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color, opacity: 0.85 }}
        />
      </div>
      <span className={cn("font-mono text-[10px] font-semibold w-10 text-right", pctColorNum(pct))}>
        {pct > 0 ? `${Math.round(pct)}%` : "—"}
      </span>
      <span className="font-mono text-[10px] text-[#606060] w-16 text-right">
        {approved}/{sent}
      </span>
    </div>
  );
}

function PodPipelineCard({ data }: { data: PodPipelineAgg }) {
  const overallPct = data.articlesSent > 0
    ? Math.round((data.articlesApproved / data.articlesSent) * 100)
    : 0;

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-4 animate-fade-slide hover:border-[#333] transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {podBadge(data.pod)}
          <span className="text-[10px] font-mono text-[#606060]">{data.clientCount} clients</span>
        </div>
        <span className="text-[9px] font-mono text-[#606060] shrink-0">All-time</span>
      </div>

      {/* Pipeline bars */}
      <div className="space-y-2">
        <PipelineBar
          label="Topics"
          hint="Topics approved vs topics sent for approval — first stage of the editorial funnel."
          sent={data.topicsSent}
          approved={data.topicsApproved}
        />
        <PipelineBar
          label="CBs"
          hint="Content Briefs approved vs sent — second stage, before writing begins."
          sent={data.cbsSent}
          approved={data.cbsApproved}
        />
        <PipelineBar
          label="Articles"
          hint="Articles approved by client vs articles sent for review."
          sent={data.articlesSent}
          approved={data.articlesApproved}
        />
        <PipelineBar
          label="Published"
          hint="Articles published live vs approved — final stage of the funnel."
          sent={data.articlesApproved}
          approved={data.publishedLive}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#2a2a2a]">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <span className={cn(
                  "font-mono text-[10px] font-semibold cursor-help underline decoration-dotted underline-offset-2",
                  data.articlesDifference > 0 ? "text-[#42CA80]" : data.articlesDifference < 0 ? "text-[#ED6958]" : "text-[#606060]"
                )} />
              }
            >
              Articles Δ: {data.articlesDifference > 0 ? `+${data.articlesDifference}` : data.articlesDifference}
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
              Signed delta between articles approved and articles sent (Master Tracker&apos;s &quot;Diff&quot; column). Positive = surplus of approvals, negative = articles waiting on approval.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <span className={cn(
                  "font-mono text-[10px] font-semibold cursor-help underline decoration-dotted underline-offset-2",
                  pctColorNum(overallPct)
                )} />
              }
            >
              Overall: {overallPct > 0 ? `${overallPct}%` : "—"}
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
              Cumulative article approval rate = articles approved ÷ articles sent across the whole pod.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main section
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

  const filterNames = useMemo(
    () => new Set(filteredClients.map((c) => c.name)),
    [filteredClients]
  );

  const goalPods = useMemo(() => {
    const filtered = goalRows.filter((r) => filterNames.has(r.client_name));
    return aggregateGoalsByPod(filtered);
  }, [goalRows, filterNames]);

  const pipelinePods = useMemo(() => {
    const filtered = pipelineRows.filter((r) => filterNames.has(r.client_name));
    return aggregatePipelineByPod(filtered);
  }, [pipelineRows, filterNames]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[220px]" />
        <Skeleton className="h-[220px]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Monthly goal gauges — aggregated per pod */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
            Current Month Goals — by Pod
          </h3>
          <DataSourceBadge
            type="live"
            source="Sheet: '[Month Year] Goals vs Delivery' — Spreadsheet: Master Tracker. Latest week snapshot per client, summed by editorial pod."
          />
        </div>
        <p className="text-[10px] text-[#606060] mb-3">
          Each card sums CBs and articles delivered vs monthly goal across all the pod&apos;s clients.{" "}
          <InfoLabel text="On Track / Behind / At Risk" hint="Buckets based on the pod's avg of CB % and Article %: ≥75% On Track, 50–74% Behind, <50% At Risk." />{" "}
          ·{" "}
          <InfoLabel text="Backlog" hint="Approved content briefs not yet turned into articles — the pod's work-in-flight." />
          {" · "}
          <InfoLabel text="Rev" hint="Open article revision requests this month." />
        </p>
        {goalPods.length === 0 ? (
          <p className="text-center text-sm text-[#606060] py-6">
            No monthly goal data for the selected filters.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {goalPods.map((p) => (
              <PodGoalCard key={`g-${p.pod}`} data={p} />
            ))}
          </div>
        )}
      </div>

      {/* Cumulative pipeline bars — aggregated per pod */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
            Cumulative Pipeline — by Pod
          </h3>
          <DataSourceBadge
            type="live"
            source="Sheet: 'Cumulative' — Spreadsheet: Master Tracker. All-time per-client pipeline totals, summed by account pod."
          />
        </div>
        <p className="text-[10px] text-[#606060] mb-3">
          All-time funnel per pod: each bar shows approved ÷ sent at that stage.{" "}
          <InfoLabel text="Articles Δ" hint="Signed delta between articles approved and articles sent — Master Tracker's own 'Diff' column. Positive = surplus of approvals; negative = articles awaiting approval." />{" "}
          ·{" "}
          <InfoLabel text="Overall %" hint="Cumulative article approval rate = articles approved ÷ articles sent across the whole pod." />
        </p>
        {pipelinePods.length === 0 ? (
          <p className="text-center text-sm text-[#606060] py-6">
            No cumulative pipeline data for the selected filters.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pipelinePods.map((p) => (
              <PodPipelineCard key={`p-${p.pod}`} data={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
