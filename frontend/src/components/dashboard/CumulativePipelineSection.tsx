"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api";
import type { Client, CumulativeMetric } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { SummaryCard } from "./SummaryCard";
import { ClientPipelineCard } from "./ClientPipelineCard";
import { ClientStatusCard } from "./FilterContextCard";
import { PipelineFunnelChart } from "@/components/charts/PipelineFunnelChart";
import { normalizePod, sortPodKey } from "./ContractClientProgress";
import { podBadge } from "./shared-helpers";

interface Props {
  filteredClients?: Client[];
  /** Rendered immediately above the per-client card grid. Use this to inject
   *  a pod-aggregate row so reviewers see pod totals right before the
   *  per-client detail they roll up from. */
  beforeClientCards?: React.ReactNode;
}

export function CumulativePipelineSection({ filteredClients, beforeClientCards }: Props) {
  const [rows, setRows] = useState<CumulativeMetric[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<CumulativeMetric[]>("/api/goals-delivery/cumulative")
      .then(setRows)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Use the CLIENT's editorial_pod (from filteredClients) as the canonical
  // pod for grouping, so the per-section layout matches the pod-aggregate
  // row which also uses editorial_pod.
  const clientToEditorialPod = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of filteredClients ?? []) {
      if (c.editorial_pod) map.set(c.name, normalizePod(c.editorial_pod));
    }
    return map;
  }, [filteredClients]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const podA = clientToEditorialPod.get(a.client_name) ?? normalizePod(a.account_team_pod);
      const podB = clientToEditorialPod.get(b.client_name) ?? normalizePod(b.account_team_pod);
      if (podA !== podB) return sortPodKey(podA, podB);
      return a.client_name.localeCompare(b.client_name);
    });
  }, [rows, clientToEditorialPod]);

  const displayRows = useMemo(() => {
    if (!filteredClients?.length) return sortedRows;
    const names = new Set(filteredClients.map((c) => c.name));
    return sortedRows.filter((r) => names.has(r.client_name));
  }, [sortedRows, filteredClients]);

  // Group displayRows by the client's editorial_pod so we can render
  // discrete subsections per pod instead of a flat alphabetical grid.
  const rowsByPod = useMemo(() => {
    const map = new Map<string, typeof displayRows>();
    for (const r of displayRows) {
      const pod = clientToEditorialPod.get(r.client_name)
        ?? normalizePod(r.account_team_pod);
      const list = map.get(pod);
      if (list) list.push(r);
      else map.set(pod, [r]);
    }
    return Array.from(map.entries()).sort(([a], [b]) => sortPodKey(a, b));
  }, [displayRows, clientToEditorialPod]);

  // SOW denominator per client — used by both summary cards and per-client
  // cards so every pipeline stage is expressed as "% of contracted SOW".
  const clientToSow = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of filteredClients ?? []) {
      if (typeof c.articles_sow === "number" && c.articles_sow > 0) {
        map.set(c.name, c.articles_sow);
      }
    }
    return map;
  }, [filteredClients]);

  // Summary — all approval metrics measured against total SOW across the
  // filtered clients, not "sent" counts. This matches how the dashboard
  // reports contract delivery elsewhere.
  const totalSow = displayRows.reduce((a, r) => a + (clientToSow.get(r.client_name) ?? 0), 0);
  const totalTopicsApproved = displayRows.reduce((a, r) => a + (r.topics_approved ?? 0), 0);
  const totalCBsApproved = displayRows.reduce((a, r) => a + (r.cbs_approved ?? 0), 0);
  const totalArticlesApproved = displayRows.reduce((a, r) => a + (r.articles_approved ?? 0), 0);
  const totalPublishedLive = displayRows.reduce((a, r) => a + (r.published_live ?? 0), 0);
  const pctOf = (n: number) => (totalSow > 0 ? Math.round((n / totalSow) * 100) : 0);

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[90px]" />)}
        </div>
        <Skeleton className="h-[300px]" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Summary cards — every metric is {approved or live} ÷ SOW so all four
          funnel stages are comparable against the contract commitment. Slot 1
          adapts to the filter: 1 client → status card, N clients → approval
          bucket mix (mirrors the Delivery Overview layout). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {filteredClients?.length === 1 ? (
          <ClientStatusCard client={filteredClients[0]} />
        ) : (
          <ApprovalProgressMixCard
            rows={displayRows}
            clientToSow={clientToSow}
          />
        )}
        <SummaryCard
          title="Topics vs SOW"
          value={`${totalTopicsApproved} / ${totalSow}`}
          progress={pctOf(totalTopicsApproved)}
          description={`${pctOf(totalTopicsApproved)}% of SOW`}
        />
        <SummaryCard
          title="CBs vs SOW"
          value={`${totalCBsApproved} / ${totalSow}`}
          progress={pctOf(totalCBsApproved)}
          description={`${pctOf(totalCBsApproved)}% of SOW`}
        />
        <SummaryCard
          title="Articles vs SOW"
          value={`${totalArticlesApproved} / ${totalSow}`}
          progress={pctOf(totalArticlesApproved)}
          description={`${pctOf(totalArticlesApproved)}% of SOW`}
        />
        <SummaryCard
          title="Published vs SOW"
          value={`${totalPublishedLive} / ${totalSow}`}
          progress={pctOf(totalPublishedLive)}
          description={`${pctOf(totalPublishedLive)}% of SOW`}
        />
      </div>

      {/* Funnel chart */}
      <PipelineFunnelChart
        data={displayRows}
        clientToSow={clientToSow}
        clientToPod={clientToEditorialPod}
      />

      {/* Pod-aggregate row (if slotted) sits immediately above per-client detail */}
      {beforeClientCards}

      {/* Per-client cards — grouped into discrete subsections per pod so you
          can scan one pod at a time instead of a flat alphabetical grid. */}
      {rowsByPod.length === 0 ? (
        <p className="text-center text-sm text-[#606060] py-8">No cumulative pipeline data available.</p>
      ) : (
        <div className="space-y-5">
          {rowsByPod.map(([pod, rows]) => (
            <div key={`pod-group-${pod}`} className="space-y-2">
              <div className="flex items-center gap-2">
                {podBadge(pod)}
                <span className="font-mono text-[10px] text-[#606060]">
                  {rows.length} client{rows.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {rows.map((row) => (
                  <ClientPipelineCard
                    key={row.id}
                    data={row}
                    sow={clientToSow.get(row.client_name) ?? null}
                    pod={pod}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approval Progress — portfolio mix of clients bucketed by articles_approved
// ÷ SOW. Mirrors the Delivery Overview's Delivery Progress card so the two
// sections read consistently: headline overall %, plus distribution of how
// many clients sit in each completion bucket.
// ---------------------------------------------------------------------------

type ApprovalBucket = "NOT_STARTED" | "EARLY" | "MID" | "LATE" | "COMPLETE";

const APPROVAL_ROW: { key: ApprovalBucket; label: string; color: string }[] = [
  { key: "NOT_STARTED", label: "Not started", color: "#606060" },
  { key: "EARLY",       label: "Early",       color: "#ED6958" },
  { key: "MID",         label: "Mid",         color: "#F5C542" },
  { key: "LATE",        label: "Late",        color: "#42CA80" },
  { key: "COMPLETE",    label: "Complete",    color: "#8FB5D9" },
];

function bucketOf(pct: number): ApprovalBucket {
  if (pct <= 0) return "NOT_STARTED";
  if (pct <= 25) return "EARLY";
  if (pct <= 75) return "MID";
  if (pct < 100) return "LATE";
  return "COMPLETE";
}

function ApprovalProgressMixCard({
  rows,
  clientToSow,
}: {
  rows: CumulativeMetric[];
  clientToSow: Map<string, number>;
}) {
  const counts: Record<ApprovalBucket, number> = {
    NOT_STARTED: 0, EARLY: 0, MID: 0, LATE: 0, COMPLETE: 0,
  };
  let totalApproved = 0;
  let totalSow = 0;
  let withSow = 0;
  for (const r of rows) {
    const sow = clientToSow.get(r.client_name) ?? 0;
    if (sow <= 0) continue;
    withSow += 1;
    const approved = r.articles_approved ?? 0;
    totalApproved += approved;
    totalSow += sow;
    counts[bucketOf((approved / sow) * 100)] += 1;
  }
  const totalPct = totalSow > 0 ? Math.round((totalApproved / totalSow) * 100) : 0;
  const headlineColor =
    totalPct >= 75 ? "#42CA80" : totalPct >= 50 ? "#F5C542" : "#ED6958";

  return (
    <Card className="border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#C4BCAA]">
          Approval Progress
        </p>
        <p className="mt-0.5 text-[10px] leading-snug text-[#909090]">
          Articles approved ÷ SOW across {withSow} client{withSow === 1 ? "" : "s"}
        </p>
        <p
          className="mt-1.5 font-mono text-2xl font-bold tabular-nums"
          style={{ color: headlineColor }}
        >
          {totalPct}%
          <span className="ml-1 text-xs text-[#606060] font-normal">overall</span>
        </p>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
          {APPROVAL_ROW.map((row) => (
            <div
              key={row.key}
              className="flex items-center justify-between gap-2 font-mono text-[10px]"
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: row.color }}
                />
                <span className="text-[#C4BCAA]">{row.label}</span>
              </span>
              <span
                className="tabular-nums font-semibold"
                style={{ color: row.color }}
              >
                {counts[row.key]}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
