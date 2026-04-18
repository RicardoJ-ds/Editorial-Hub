"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api";
import type { Client, CumulativeMetric } from "@/lib/types";
import { SummaryCard } from "./SummaryCard";
import { ClientPipelineCard } from "./ClientPipelineCard";
import { PipelineFunnelChart } from "@/components/charts/PipelineFunnelChart";

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

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const podA = a.account_team_pod ?? "";
      const podB = b.account_team_pod ?? "";
      if (podA !== podB) return podA.localeCompare(podB);
      return a.client_name.localeCompare(b.client_name);
    });
  }, [rows]);

  const displayRows = useMemo(() => {
    if (!filteredClients?.length) return sortedRows;
    const names = new Set(filteredClients.map((c) => c.name));
    return sortedRows.filter((r) => names.has(r.client_name));
  }, [sortedRows, filteredClients]);

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

      {/* Client Pipeline Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {displayRows.map((row) => (
          <ClientPipelineCard key={row.id} data={row} />
        ))}
      </div>

      {displayRows.length === 0 && (
        <p className="text-center text-sm text-[#606060] py-8">No cumulative pipeline data available.</p>
      )}
    </div>
  );
}
