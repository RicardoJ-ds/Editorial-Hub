"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api";
import type { Client, CumulativeMetric } from "@/lib/types";
import { SummaryCard } from "./SummaryCard";
import { ClientPipelineCard } from "./ClientPipelineCard";
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

  // Summary
  const totalClients = new Set(displayRows.map((r) => r.client_name)).size;
  const totalTopicsSent = displayRows.reduce((a, r) => a + (r.topics_sent ?? 0), 0);
  const totalTopicsApproved = displayRows.reduce((a, r) => a + (r.topics_approved ?? 0), 0);
  const totalCBsSent = displayRows.reduce((a, r) => a + (r.cbs_sent ?? 0), 0);
  const totalCBsApproved = displayRows.reduce((a, r) => a + (r.cbs_approved ?? 0), 0);
  const totalArticlesSent = displayRows.reduce((a, r) => a + (r.articles_sent ?? 0), 0);
  const totalArticlesApproved = displayRows.reduce((a, r) => a + (r.articles_approved ?? 0), 0);
  const overallApproval = totalArticlesSent > 0 ? Math.round((totalArticlesApproved / totalArticlesSent) * 100) : 0;

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
      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCard title="Total Clients" value={totalClients} valueColor="green" />
        <SummaryCard
          title="Topics Approval"
          value={`${totalTopicsApproved} / ${totalTopicsSent}`}
          progress={totalTopicsSent > 0 ? Math.round((totalTopicsApproved / totalTopicsSent) * 100) : 0}
          description={`${totalTopicsSent > 0 ? Math.round((totalTopicsApproved / totalTopicsSent) * 100) : 0}% approved`}
        />
        <SummaryCard
          title="CBs Approval"
          value={`${totalCBsApproved} / ${totalCBsSent}`}
          progress={totalCBsSent > 0 ? Math.round((totalCBsApproved / totalCBsSent) * 100) : 0}
          description={`${totalCBsSent > 0 ? Math.round((totalCBsApproved / totalCBsSent) * 100) : 0}% approved`}
        />
        <SummaryCard
          title="Articles Approval"
          value={`${totalArticlesApproved} / ${totalArticlesSent}`}
          progress={overallApproval}
          description={`${overallApproval}% approved`}
        />
        <SummaryCard title="Overall Approval Rate" value={`${overallApproval}%`} valueColor={overallApproval >= 75 ? "green" : "white"} />
      </div>

      {/* Funnel chart */}
      <PipelineFunnelChart data={displayRows} />

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
                  <ClientPipelineCard key={row.id} data={row} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
