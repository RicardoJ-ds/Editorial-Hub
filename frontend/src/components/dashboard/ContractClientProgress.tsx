"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
import {
  TooltipBody,
  contentTypeRatio,
  pctColorNum,
  podBadge,
} from "./shared-helpers";
import { useCurrentPodAxis } from "@/lib/podAxisClient";
import { useCurrentEditorialMonth } from "@/lib/editorialWeeksClient";
import { cn } from "@/lib/utils";
import type { DateRange } from "./DateRangeFilter";

interface Props {
  filteredClients: Client[];
  /** When set, pod gauges aggregate goals/delivered across every month in
   *  the range — matching the section's summary cards and month table.
   *  When omitted, pulls only the latest month from the sheet. */
  dateRange?: DateRange;
  /** When true, the per-client breakdown grid for each pod renders inside
   *  a `<details>` element that starts collapsed. Matches the same UX
   *  Overview / Cumulative Pipeline / Client Delivery use to keep long
   *  pages scannable. (PodGoalsRow only — ignored by ContractClientProgress.) */
  defaultCollapsedByPod?: boolean;
  /** When true, PodGoalsRow renders only the per-pod gauges row and skips
   *  the "Per-client breakdown" subsection entirely. Used on Overview so
   *  the executive view is a one-row snapshot — deep-link sends users to
   *  D1 for the per-client drill-down. */
  hidePerClientBreakdown?: boolean;
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

interface ClientGoalDatum {
  client: string;
  cbDelivered: number;
  cbGoal: number;
  adDelivered: number;
  adGoal: number;
}

interface PodGoalAgg {
  pod: string;
  clientCount: number;
  clientNames: string[];
  /** Per-client breakdown so the section can render gauges under each pod
   *  card without re-walking the source rows. */
  clients: ClientGoalDatum[];
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
  // Step 1: max per (client × month × content_type) across weeks.
  const perCMC = new Map<string, {
    client: string;
    pod: string;
    ratio: number;
    cbGoal: number; cbDel: number;
    adGoal: number; adDel: number;
  }>();
  for (const r of rows) {
    const ct = (r.content_type ?? "").trim().toLowerCase() || "default";
    const key = `${r.client_name}|${r.month_year}|${ct}`;
    // Always defer to the canonical client→pod map so every row of a client
    // lands in the SAME pod bucket. The per-row sheet column would split a
    // client across two pods when its values were inconsistent.
    const pod = clientToPod.get(r.client_name) ?? "Unassigned";
    let e = perCMC.get(key);
    if (!e) {
      e = {
        client: r.client_name,
        pod,
        ratio: contentTypeRatio(r.content_type, r.ratios),
        cbGoal: 0, cbDel: 0, adGoal: 0, adDel: 0,
      };
      perCMC.set(key, e);
    }
    e.cbGoal = Math.max(e.cbGoal, r.cb_monthly_goal ?? 0);
    e.adGoal = Math.max(e.adGoal, r.ad_monthly_goal ?? 0);
    e.cbDel = Math.max(e.cbDel, r.cb_delivered_to_date ?? 0);
    e.adDel = Math.max(e.adDel, r.ad_delivered_to_date ?? 0);
  }
  // Step 2: weighted-sum across content types → (client × month).
  const perClientMonth = new Map<string, {
    client: string;
    pod: string;
    cbGoal: number; cbDel: number;
    adGoal: number; adDel: number;
  }>();
  for (const [k, e] of perCMC.entries()) {
    const [client, month] = k.split("|");
    const cmKey = `${client}|${month}`;
    let cm = perClientMonth.get(cmKey);
    if (!cm) {
      cm = {
        client: e.client,
        pod: e.pod,
        cbGoal: 0, cbDel: 0, adGoal: 0, adDel: 0,
      };
      perClientMonth.set(cmKey, cm);
    }
    cm.cbGoal += e.cbGoal * e.ratio;
    cm.cbDel += e.cbDel * e.ratio;
    cm.adGoal += e.adGoal * e.ratio;
    cm.adDel += e.adDel * e.ratio;
  }

  const byPod = new Map<string, PodGoalAgg>();
  const seenClientsPerPod = new Map<string, Set<string>>();
  // Per-(pod, client) running tallies so we can hand back a clean per-client
  // breakdown alongside each pod aggregate.
  const perPodClient = new Map<string, ClientGoalDatum>();
  for (const e of perClientMonth.values()) {
    if (!byPod.has(e.pod)) {
      byPod.set(e.pod, {
        pod: e.pod, clientCount: 0, clientNames: [], clients: [],
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
    const ck = `${e.pod}|${e.client}`;
    let cdat = perPodClient.get(ck);
    if (!cdat) {
      cdat = {
        client: e.client,
        cbDelivered: 0,
        cbGoal: 0,
        adDelivered: 0,
        adGoal: 0,
      };
      perPodClient.set(ck, cdat);
      agg.clients.push(cdat);
    }
    // Only count deliveries in months that had a goal — matches the summary
    // cards and the month table, which both drop goal-less months.
    if (e.cbGoal > 0) {
      agg.cbGoal += e.cbGoal;
      agg.cbDelivered += e.cbDel;
      cdat.cbGoal += e.cbGoal;
      cdat.cbDelivered += e.cbDel;
    }
    if (e.adGoal > 0) {
      agg.adGoal += e.adGoal;
      agg.adDelivered += e.adDel;
      cdat.adGoal += e.adGoal;
      cdat.adDelivered += e.adDel;
    }
  }
  // Sort each pod's clients alphabetically so the rendered grid is stable.
  for (const agg of byPod.values()) {
    agg.clients.sort((a, b) => a.client.localeCompare(b.client));
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

function InfoLabel({
  text,
  title,
  bullets,
}: {
  text: string;
  title: string;
  bullets: React.ReactNode[];
}) {
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
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
          <TooltipBody title={title} bullets={bullets} />
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
      <div className="rounded-lg border border-dashed border-[#2a2a2a] bg-[#0c0c0c] p-3 text-center text-[11px] font-mono text-[#606060]">
        No goal data
      </div>
    );
  }
  // Goal Status badge (On Track / Behind / At Risk) intentionally removed
  // pending refactor. The CB / Article arc gauges below carry the raw %.
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-3 transition-colors hover:border-[#333] animate-fade-slide">
      <div className="flex items-center justify-center gap-4">
        <ArcWithTooltip
          value={data.cbDelivered}
          max={data.cbGoal}
          label="CBs"
          tooltipTitle="CBs vs Goal"
          tooltipBullets={[
            "CBs delivered ÷ monthly goal",
            "Summed per (client × month) in the active range",
            `${data.clientCount} client${data.clientCount === 1 ? "" : "s"} in this pod`,
          ]}
        />
        <ArcWithTooltip
          value={data.adDelivered}
          max={data.adGoal}
          label="Articles"
          tooltipTitle="Articles vs Goal"
          tooltipBullets={[
            "Articles delivered ÷ monthly goal",
            "Summed per (client × month) in the active range",
            `${data.clientCount} client${data.clientCount === 1 ? "" : "s"} in this pod`,
          ]}
        />
      </div>

    </div>
  );
}

// Wraps a ProgressArc so only its label is the tooltip trigger — keeps the
// tooltip from firing across the entire arc graphic.
function ArcWithTooltip({
  value,
  max,
  label,
  tooltipTitle,
  tooltipBullets,
}: {
  value: number;
  max: number;
  label: string;
  tooltipTitle: string;
  tooltipBullets: React.ReactNode[];
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <div className="inline-flex flex-col items-center cursor-help" />
          }
        >
          <ProgressArc value={value} max={max} label={label} />
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs leading-relaxed">
          <TooltipBody title={tooltipTitle} bullets={tooltipBullets} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Pipeline cell (compact card inside matrix)
// ---------------------------------------------------------------------------

function PipelineBar({
  label,
  tooltipTitle,
  tooltipBullets,
  sent,
  approved,
}: {
  label: string;
  tooltipTitle: string;
  tooltipBullets: React.ReactNode[];
  sent: number;
  approved: number;
}) {
  const pct = sent > 0 ? (approved / sent) * 100 : 0;
  const color = pct >= 75 ? "#42CA80" : pct >= 50 ? "#F5C542" : "#ED6958";
  return (
    <div className="flex items-center gap-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="text-[10px] text-[#C4BCAA] w-12 shrink-0 font-mono cursor-help underline decoration-dotted decoration-[#404040] underline-offset-2" />
            }
          >
            {label}
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
            <TooltipBody title={tooltipTitle} bullets={tooltipBullets} />
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <div className="flex-1 h-2.5 rounded-full bg-[#2a2a2a] overflow-hidden relative">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color, opacity: 0.85 }}
        />
      </div>
      <span className={cn("font-mono text-[10px] font-semibold w-9 text-right", pctColorNum(pct))}>
        {pct > 0 ? `${Math.round(pct)}%` : "—"}
      </span>
      <span className="font-mono text-[10px] text-[#606060] w-14 text-right">
        {approved}/{sent}
      </span>
    </div>
  );
}

function PipelineCell({ data }: { data: PodPipelineAgg | null }) {
  if (!data) {
    return (
      <div className="rounded-lg border border-dashed border-[#2a2a2a] bg-[#0c0c0c] p-3 text-center text-[11px] font-mono text-[#606060]">
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
        <span className="text-[10px] font-mono text-[#606060]">All-time</span>
      </div>
      <div className="space-y-1.5">
        <PipelineBar
          label="Topics"
          sent={data.topicsSent}
          approved={data.topicsApproved}
          tooltipTitle="Topics — Stage 1"
          tooltipBullets={[
            "Topics approved ÷ topics sent",
            "First stage of the editorial funnel",
          ]}
        />
        <PipelineBar
          label="CBs"
          sent={data.cbsSent}
          approved={data.cbsApproved}
          tooltipTitle="CBs — Stage 2"
          tooltipBullets={[
            "Content Briefs approved ÷ sent",
            "Sign-off gate before writing begins",
          ]}
        />
        <PipelineBar
          label="Articles"
          sent={data.articlesSent}
          approved={data.articlesApproved}
          tooltipTitle="Articles — Stage 3"
          tooltipBullets={[
            "Articles approved ÷ articles sent for review",
            "Where most client revision cycles happen",
          ]}
        />
        <PipelineBar
          label="Published"
          sent={data.articlesApproved}
          approved={data.publishedLive}
          tooltipTitle="Published — Stage 4"
          tooltipBullets={[
            "Articles published live ÷ approved",
            "Final stage; quality gate after approval",
          ]}
        />
      </div>
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#2a2a2a]">
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
              Δ: {data.articlesDifference > 0 ? `+${data.articlesDifference}` : data.articlesDifference}
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
              <TooltipBody
                title="Articles in flight"
                bullets={[
                  "Articles sent to the client but not yet approved.",
                  "Formula: sent − approved.",
                  <><span className="text-[#42CA80] font-semibold">+</span> normal pipeline · <span className="text-[#C4BCAA] font-semibold">0</span> caught up · <span className="text-[#ED6958] font-semibold">−</span> rare correction.</>,
                ]}
              />
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
            <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
              <TooltipBody
                title="Approval rate"
                bullets={[
                  "Articles approved ÷ articles sent.",
                  "Cumulative across all clients in the pod.",
                ]}
              />
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

function usePodAggregates(
  filteredClients: Client[],
  dateRange?: DateRange,
  // When true, scope `goalRows` to the current Editorial month only and
  // ignore `dateRange`. Mirrors the rule in `GoalsVsDeliverySection`:
  // gauge cards (per-pod + per-client) show "this month so far"
  // regardless of the date filter; the detail table below stays scoped.
  currentMonthOnly: boolean = false,
) {
  const [goalRows, setGoalRows] = useState<GoalsVsDeliveryRow[]>([]);
  const [pipelineRows, setPipelineRows] = useState<CumulativeMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const editorialMonth = useCurrentEditorialMonth();

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
  // Client row's pod field. The pod axis (`editorial_pod` vs `growth_pod`)
  // comes from the user's access profile + their toggle selection — see
  // `useCurrentPodAxis`. Every filtered client gets an entry; clients with
  // no value on the active axis map to "Unassigned".
  const { axis } = useCurrentPodAxis();
  const clientToPod = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of filteredClients) {
      const raw = axis === "growth" ? c.growth_pod : c.editorial_pod;
      map.set(c.name, raw ? normalizePod(raw) : "Unassigned");
    }
    return map;
  }, [filteredClients, axis]);

  const filterNames = useMemo(
    () => new Set(filteredClients.map((c) => c.name)),
    [filteredClients],
  );

  // Apply the global client filter to the goal rows. Month scoping
  // depends on the caller:
  //   • `currentMonthOnly` → only rows for the current Editorial month
  //     (gauge mode — used by PodGoalsRow + per-client mini gauges).
  //   • otherwise → respect the date-range filter the user picked above.
  // Month "in range" = first day on or before range.to AND last day on
  // or after range.from.
  const scopedGoalRows = useMemo(() => {
    if (currentMonthOnly) {
      return goalRows.filter((r) => {
        if (!filterNames.has(r.client_name)) return false;
        const d = parseMonthYearStr(r.month_year);
        if (!d) return false;
        return (
          d.getFullYear() === editorialMonth.year &&
          d.getMonth() + 1 === editorialMonth.month
        );
      });
    }
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
  }, [
    goalRows,
    filterNames,
    dateRange,
    currentMonthOnly,
    editorialMonth.year,
    editorialMonth.month,
  ]);

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

  return { loading, goalPods, pipelinePods, editorialMonth };
}

// ---------------------------------------------------------------------------
// Per-pod Month Goals row
// ---------------------------------------------------------------------------

export function PodGoalsRow({
  filteredClients,
  dateRange,
  defaultCollapsedByPod = false,
  hidePerClientBreakdown = false,
}: Props) {
  // Pod gauges are part of the gauge-card family — scope is "this
  // Editorial month so far," NOT the date filter. The Month-by-Month
  // table below remains date-scoped. Matches the spec on Phase 5 +
  // GoalsVsDeliverySection's top cards.
  const { loading, goalPods, editorialMonth } = usePodAggregates(
    filteredClients,
    dateRange,
    /* currentMonthOnly */ true,
  );
  const { axis: podAxis } = useCurrentPodAxis();

  if (loading) return <Skeleton className="h-[180px]" />;
  if (goalPods.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#2a2a2a] bg-[#0c0c0c] px-4 py-6 text-center text-sm text-[#606060]">
        No {podAxis === "growth" ? "growth-pod" : "editorial-pod"} goal data
        for {editorialMonth.label}.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
            Aggregated by {podAxis === "growth" ? "growth" : "editorial"} pod
          </h3>
          <span
            className="inline-flex items-center gap-1 rounded-sm border border-[#F5BC4E]/30 bg-[#F5BC4E]/10 px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-[#F5BC4E]"
            title="These gauges always show this Editorial month — they ignore the date filter."
          >
            {editorialMonth.label} · not date-filtered
          </span>
          <DataSourceBadge
            type="live"
            source={`Goals vs Delivery for ${editorialMonth.label}. Always shows this month — ignores the date filter.`}
            shows={[
              "Top row: each pod's combined CB / Article progress.",
              "Below: same chart per client, grouped by pod.",
              "Numbers are weighted (jumbo = ×2, LP = ×0.5).",
            ]}
          />
        </div>
      </div>

      {/* Pod gauges — top row. Same fixed-width grid every responsive
          breakpoint, so a pod card and a per-client card render at exactly
          the same size in the section below. */}
      <motion.div
        layout
        transition={GAUGE_TRANSITION}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {goalPods.map((g) => (
            <motion.div
              key={`g-${g.pod}`}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={GAUGE_TRANSITION}
              className="flex flex-col gap-2"
            >
              <div className="flex items-center gap-2 rounded-md border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-1.5">
                {podBadge(g.pod, podAxis)}
                <span className="font-mono text-[11px] text-[#606060]">
                  {g.clientCount} client{g.clientCount === 1 ? "" : "s"}
                </span>
              </div>
              <GoalCell data={g} />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      {/* Per-client subsections — one per pod. Same pod-header convention
          as Delivery Overview / Cumulative Pipeline / Client Delivery.
          When `defaultCollapsedByPod` is set, each pod is wrapped in a
          <details> that starts collapsed to keep the page scannable. */}
      {!hidePerClientBreakdown && goalPods.some((g) => g.clients.length > 0) && (
        <div className="space-y-3 border-t border-[#1f1f1f] pt-4">
          <h3 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
            Per-client breakdown
          </h3>
          <div className="space-y-2">
            {goalPods.map((g) => {
              if (g.clients.length === 0) return null;
              const grid = (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {g.clients.map((c) => (
                    <ClientMiniGauge key={`${g.pod}-${c.client}`} data={c} />
                  ))}
                </div>
              );
              return (
                <div key={`pcs-${g.pod}`} className="space-y-2">
                  {defaultCollapsedByPod ? (
                    <details className="group/pod">
                      <summary className="flex cursor-pointer list-none items-center gap-2 rounded border border-[#1f1f1f] bg-[#0d0d0d] px-3 py-1.5 transition-colors hover:border-[#2a2a2a]">
                        {podBadge(g.pod, podAxis)}
                        <span className="font-mono text-[11px] text-[#606060]">
                          {g.clientCount} client{g.clientCount === 1 ? "" : "s"}
                        </span>
                        <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-[#606060] group-open/pod:hidden">
                          ▸ expand
                        </span>
                        <span className="ml-auto hidden font-mono text-[10px] uppercase tracking-wider text-[#606060] group-open/pod:inline">
                          ▾ collapse
                        </span>
                      </summary>
                      <div className="mt-2">{grid}</div>
                    </details>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        {podBadge(g.pod, podAxis)}
                        <span className="font-mono text-[11px] text-[#606060]">
                          {g.clientCount} client{g.clientCount === 1 ? "" : "s"}
                        </span>
                      </div>
                      {grid}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const GAUGE_TRANSITION = { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const };

// Per-client gauge — same layout/treatment as GoalCell (the pod card) so the
// pod row and its drill-down read consistently. Just adds the client name in
// the header.
function ClientMiniGauge({ data }: { data: ClientGoalDatum }) {
  // Goal Status badge removed pending refactor — see GoalCell.
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-3 transition-colors hover:border-[#333] animate-fade-slide">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p
          className="min-w-0 flex-1 truncate font-semibold text-white text-sm"
          title={data.client}
        >
          {data.client}
        </p>
      </div>
      <div className="flex items-center justify-center gap-4">
        <ArcWithTooltip
          value={data.cbDelivered}
          max={data.cbGoal}
          label="CBs"
          tooltipTitle="CBs vs Goal"
          tooltipBullets={[
            "CBs delivered ÷ monthly goal",
            "Weighted by content type (article ×1, jumbo ×2, LP ×0.5)",
            "Summed across every month in the active range",
          ]}
        />
        <ArcWithTooltip
          value={data.adDelivered}
          max={data.adGoal}
          label="Articles"
          tooltipTitle="Articles vs Goal"
          tooltipBullets={[
            "Articles delivered ÷ monthly goal",
            "Weighted by content type (article ×1, jumbo ×2, LP ×0.5)",
            "Summed across every month in the active range",
          ]}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-pod Cumulative Pipeline row
// ---------------------------------------------------------------------------

export function PodPipelineRow({ filteredClients }: Props) {
  const { loading, pipelinePods } = usePodAggregates(filteredClients);
  const { axis: podAxis } = useCurrentPodAxis();

  if (loading) return <Skeleton className="h-[220px]" />;
  if (pipelinePods.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#2a2a2a] bg-[#0c0c0c] px-4 py-6 text-center text-sm text-[#606060]">
        No {podAxis === "growth" ? "growth-pod" : "editorial-pod"} pipeline
        data for the selected filters.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
            Aggregated by {podAxis === "growth" ? "growth" : "editorial"} pod
          </h3>
          <DataSourceBadge
            type="live"
            source="All-time pipeline totals per pod from Master Tracker."
            shows={[
              "One card per pod: Topics → CBs → Articles → Published.",
              "Each bar shows approval rate at that stage.",
              "Δ footer: articles awaiting client sign-off.",
              "Overall %: articles approved ÷ articles sent.",
            ]}
          />
        </div>
        <p className="text-[11px] text-[#606060]">
          <InfoLabel
            text="Articles Δ"
            title="Articles in flight"
            bullets={[
              "Articles sent but not yet approved.",
              "How much is waiting on client sign-off.",
              "Summed across the pod's clients.",
            ]}
          />
          {" · "}
          <InfoLabel
            text="Overall %"
            title="Approval rate"
            bullets={[
              "Articles approved ÷ articles sent.",
              "Cumulative across the pod.",
            ]}
          />
        </p>
      </div>
      {/* Responsive grid — no horizontal scroll. Each pod is its own card. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {pipelinePods.map((p) => (
          <div key={`p-${p.pod}`} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 rounded-md border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-1.5">
              {podBadge(p.pod, podAxis)}
              <span className="font-mono text-[11px] text-[#606060]">
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
