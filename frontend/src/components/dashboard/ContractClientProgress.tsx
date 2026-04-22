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
import type { DateRange } from "./DateRangeFilter";

interface Props {
  filteredClients: Client[];
  /** When set, pod gauges aggregate goals/delivered across every month in
   *  the range — matching the section's summary cards and month table.
   *  When omitted, pulls only the latest month from the sheet. */
  dateRange?: DateRange;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseMonthYearStr(s: string): Date | null {
  if (!s) return null;
  const m = s.trim().match(/^(\w+)\s+(\d{4})$/);
  if (!m) return null;
  const idx = MONTH_NAMES.indexOf(m[1]);
  if (idx < 0) return null;
  return new Date(parseInt(m[2], 10), idx, 1);
}

function resolveDateRange(r: DateRange | undefined): [Date | null, Date | null] {
  if (!r || r.type !== "range") return [null, null];
  const start = r.from ?? null;
  const end = r.to ?? r.from ?? null;
  return [start, end];
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

export function sortPodKey(a: string, b: string) {
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
export function normalizePod(raw: string | null | undefined): string {
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
 *  consistent with the FilterBar.
 *
 *  Summation math matches `GoalsVsDeliverySection` / `GoalsMonthTable`:
 *    • Collapse each (client × month) to one entry: max(monthly_goal) and
 *      max(delivered_to_date). Multiple weeks per month carry a running
 *      cumulative, so max-of-to-date = end-of-month cumulative.
 *    • Sum those per-(client × month) entries across every month in the
 *      range, then sum across clients per pod. So three widgets (summary
 *      cards, pod gauges, month table) always show identical totals.
 */
function aggregateGoalsByPod(
  rows: GoalsVsDeliveryRow[],
  clientToPod: Map<string, string>,
): PodGoalAgg[] {
  const perClientMonth = new Map<string, {
    client: string;
    pod: string;
    cbGoal: number; cbDel: number;
    adGoal: number; adDel: number;
  }>();
  for (const r of rows) {
    const key = `${r.client_name}|${r.month_year}`;
    const pod = normalizePod(clientToPod.get(r.client_name) ?? r.editorial_team_pod);
    let e = perClientMonth.get(key);
    if (!e) {
      e = { client: r.client_name, pod, cbGoal: 0, cbDel: 0, adGoal: 0, adDel: 0 };
      perClientMonth.set(key, e);
    }
    e.cbGoal = Math.max(e.cbGoal, r.cb_monthly_goal ?? 0);
    e.adGoal = Math.max(e.adGoal, r.ad_monthly_goal ?? 0);
    e.cbDel = Math.max(e.cbDel, r.cb_delivered_to_date ?? 0);
    e.adDel = Math.max(e.adDel, r.ad_delivered_to_date ?? 0);
  }

  const byPod = new Map<string, PodGoalAgg>();
  const seenClientsPerPod = new Map<string, Set<string>>();
  for (const e of perClientMonth.values()) {
    if (!byPod.has(e.pod)) {
      byPod.set(e.pod, {
        pod: e.pod, clientCount: 0, clientNames: [],
        cbDelivered: 0, cbGoal: 0, adDelivered: 0, adGoal: 0,
      });
      seenClientsPerPod.set(e.pod, new Set());
    }
    const agg = byPod.get(e.pod)!;
    const seen = seenClientsPerPod.get(e.pod)!;
    if (!seen.has(e.client)) {
      seen.add(e.client);
      agg.clientCount += 1;
      agg.clientNames.push(e.client);
    }
    // Only count deliveries in months that had a goal — matches the summary
    // cards and the month table, which both drop goal-less months.
    if (e.cbGoal > 0) {
      agg.cbGoal += e.cbGoal;
      agg.cbDelivered += e.cbDel;
    }
    if (e.adGoal > 0) {
      agg.adGoal += e.adGoal;
      agg.adDelivered += e.adDel;
    }
  }
  return Array.from(byPod.values()).sort((a, b) => sortPodKey(a.pod, b.pod));
}

function aggregatePipelineByPod(
  rows: CumulativeMetric[],
  clientToPod: Map<string, string>,
): PodPipelineAgg[] {
  const byPod = new Map<string, PodPipelineAgg>();
  for (const r of rows) {
    // Editorial-pod only. No fallback to account_team_pod from the Cumulative
    // sheet — that column carries growth/account pod labels and would mix
    // axes with the editorial-pod grouping the dashboard uses everywhere.
    const pod = clientToPod.get(r.client_name) ?? "Unassigned";
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
              Avg of CB % and Article % for the pod across the active date range. ≥75% = On Track, 50–74% = Behind, &lt;50% = At Risk.
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
              CBs delivered vs monthly goal, summed per (client × month) across the active date range — {data.clientCount} client{data.clientCount === 1 ? "" : "s"} in this pod.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<div className="cursor-help" />}>
              <ProgressArc value={data.adDelivered} max={data.adGoal} label="Articles" />
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px] leading-relaxed">
              Articles delivered vs monthly goal, summed per (client × month) across the active date range — {data.clientCount} client{data.clientCount === 1 ? "" : "s"} in this pod.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

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
            <TooltipContent side="top" className="max-w-sm text-[11px] leading-relaxed space-y-1.5">
              <p>
                <strong>How many articles this pod&apos;s clients have received but not yet approved</strong>, summed across every client in the pod.
              </p>
              <p className="text-[10px] text-[#9A9A9A]">
                Formula: <code>articles sent − articles approved</code>. Comes from the Master Tracker&apos;s &quot;Diff&quot; column (stored per-client, then summed here).
              </p>
              <p className="text-[10px] text-[#9A9A9A]">
                Example: if one client has 30 sent / 22 approved (Diff +8) and another has 15 sent / 13 approved (Diff +2), the pod&apos;s total Δ is <strong className="text-white">+10</strong> — ten articles across the pod are waiting on client sign-off.
              </p>
              <ul className="text-[10px] text-[#9A9A9A] list-none space-y-0.5 pt-0.5">
                <li><span className="text-[#42CA80] font-semibold">Positive</span> — articles in flight, normal for an active pipeline.</li>
                <li><span className="text-[#C4BCAA] font-semibold">Zero</span> — approvals are caught up.</li>
                <li><span className="text-[#ED6958] font-semibold">Negative</span> — rare; usually a sheet correction.</li>
              </ul>
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
// Shared data hook — both per-pod rows fetch the same two endpoints and
// aggregate by the client's editorial_pod.
// ---------------------------------------------------------------------------

function usePodAggregates(filteredClients: Client[], dateRange?: DateRange) {
  const [goalRows, setGoalRows] = useState<GoalsVsDeliveryRow[]>([]);
  const [pipelineRows, setPipelineRows] = useState<CumulativeMetric[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // Goals: pull every month we have on hand so the pod gauges can honor
    // the same date range as the rest of the Monthly Goals section.
    Promise.all([
      apiGet<GoalsVsDeliveryRow[]>("/api/goals-delivery/all").catch(() => [] as GoalsVsDeliveryRow[]),
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
  // Client row's editorial_pod. Keeps the FilterBar's POD filter consistent
  // across both aggregations regardless of how the sheet column was named.
  const clientToPod = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of filteredClients) {
      if (c.editorial_pod) map.set(c.name, normalizePod(c.editorial_pod));
    }
    return map;
  }, [filteredClients]);

  const filterNames = useMemo(
    () => new Set(filteredClients.map((c) => c.name)),
    [filteredClients],
  );

  // Apply the global client filter + date-range filter to the goal rows
  // before handing them to the aggregator. Month "in range" = its first day
  // is on or before range.to AND its last day is on or after range.from.
  const scopedGoalRows = useMemo(() => {
    const [start, end] = resolveDateRange(dateRange);
    return goalRows.filter((r) => {
      if (!filterNames.has(r.client_name)) return false;
      const d = parseMonthYearStr(r.month_year);
      if (!d) return false;
      if (start) {
        const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        if (monthEnd < start) return false;
      }
      if (end && d > end) return false;
      return true;
    });
  }, [goalRows, filterNames, dateRange]);

  const goalPods = useMemo(
    () => aggregateGoalsByPod(scopedGoalRows, clientToPod),
    [scopedGoalRows, clientToPod],
  );

  const pipelinePods = useMemo(
    () => aggregatePipelineByPod(
      pipelineRows.filter((r) => filterNames.has(r.client_name)),
      clientToPod,
    ),
    [pipelineRows, filterNames, clientToPod],
  );

  return { loading, goalPods, pipelinePods };
}

// ---------------------------------------------------------------------------
// Per-pod Month Goals row
// ---------------------------------------------------------------------------

export function PodGoalsRow({ filteredClients, dateRange }: Props) {
  const { loading, goalPods } = usePodAggregates(filteredClients, dateRange);

  if (loading) return <Skeleton className="h-[180px]" />;
  if (goalPods.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#2a2a2a] bg-[#0c0c0c] px-4 py-6 text-center text-sm text-[#606060]">
        No pod-level goal data for the selected filters.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="font-mono text-[10px] font-semibold uppercase tracking-widest text-[#C4BCAA]">
            Aggregated by pod
          </h4>
          <DataSourceBadge
            type="live"
            source="Sheet: '[Month Year] Goals vs Delivery' — Spreadsheet: Master Tracker. Goals and delivery summed per (client × month) across every month in the active date range, then rolled up by the client's editorial_pod."
            shows={[
              "Each pod card shows combined CB and Article progress across the clients it owns.",
              "Numbers match the summary cards above and the month table below — all three use the same (client × month) aggregation over the active date range.",
              "Color: green ≥75% On Track, amber 50–74% Behind, red <50% At Risk.",
            ]}
          />
        </div>
        <p className="text-[10px] text-[#909090]">
          <InfoLabel text="On Track / Behind / At Risk" hint="Goals status buckets: ≥75% On Track, 50–74% Behind, <50% At Risk." />
        </p>
      </div>
      {/* Responsive grid — no horizontal scroll. Each pod is its own card with
          header + month-goal gauges stacked. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {goalPods.map((g) => (
          <div key={`g-${g.pod}`} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 rounded-md border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-1.5">
              {podBadge(g.pod)}
              <span className="font-mono text-[10px] text-[#606060]">
                {g.clientCount} client{g.clientCount === 1 ? "" : "s"}
              </span>
            </div>
            <GoalCell data={g} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-pod Cumulative Pipeline row
// ---------------------------------------------------------------------------

export function PodPipelineRow({ filteredClients }: Props) {
  const { loading, pipelinePods } = usePodAggregates(filteredClients);

  if (loading) return <Skeleton className="h-[220px]" />;
  if (pipelinePods.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#2a2a2a] bg-[#0c0c0c] px-4 py-6 text-center text-sm text-[#606060]">
        No pod-level pipeline data for the selected filters.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="font-mono text-[10px] font-semibold uppercase tracking-widest text-[#C4BCAA]">
            Aggregated by pod
          </h4>
          <DataSourceBadge
            type="live"
            source="Sheet: 'Cumulative' — Spreadsheet: Master Tracker. All-time per-client pipeline totals, summed by the client's editorial_pod."
            shows={[
              "One card per editorial pod showing its all-time funnel: Topics → CBs → Articles → Published.",
              "Each bar is approval rate at that stage, color-coded by %; raw approved/sent numbers on the right.",
              "Δ footer = articles sent minus articles approved (how many are waiting on client sign-off). Overall % footer = articles approved ÷ articles sent.",
              "Sums are pod-wide, not per-client — open a per-client card below to drill in.",
            ]}
          />
        </div>
        <p className="text-[10px] text-[#606060]">
          <InfoLabel text="Articles Δ" hint="Articles sent minus articles approved — how many articles the pod has delivered that are still awaiting client approval. Summed across the pod's clients." />
          {" · "}
          <InfoLabel text="Overall %" hint="Cumulative article approval rate = articles approved ÷ articles sent across the pod." />
        </p>
      </div>
      {/* Responsive grid — no horizontal scroll. Each pod is its own card. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {pipelinePods.map((p) => (
          <div key={`p-${p.pod}`} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 rounded-md border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-1.5">
              {podBadge(p.pod)}
              <span className="font-mono text-[10px] text-[#606060]">
                {p.clientCount} client{p.clientCount === 1 ? "" : "s"}
              </span>
            </div>
            <PipelineCell data={p} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Backwards-compat alias — used by older call sites. Renders both rows stacked.
export function ContractClientProgress(props: Props) {
  return (
    <div className="space-y-4">
      <PodGoalsRow {...props} />
      <PodPipelineRow {...props} />
    </div>
  );
}
