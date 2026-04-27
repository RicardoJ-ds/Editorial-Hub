"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api";
import type { Client, CumulativeMetric } from "@/lib/types";
import { ClientPipelineCard } from "./ClientPipelineCard";
import {
  CumulativePipelineCards,
  PodPipelineCardsGrid,
} from "./CumulativePipelineCards";
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

  // Canonical pod for grouping across this section = the CLIENT's
  // editorial_pod. Always include every filtered client so the fallback
  // never reaches the sheet's account_team_pod (which carries growth /
  // account pod labels, not editorial) — that would mix axes and surface
  // e.g. a "Pod 7" row in a matrix otherwise indexed by editorial pod.
  // Blank editorial_pod → "Unassigned".
  const clientToEditorialPod = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of filteredClients ?? []) {
      map.set(c.name, c.editorial_pod ? normalizePod(c.editorial_pod) : "Unassigned");
    }
    return map;
  }, [filteredClients]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const podA = clientToEditorialPod.get(a.client_name) ?? "Unassigned";
      const podB = clientToEditorialPod.get(b.client_name) ?? "Unassigned";
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
      const pod = clientToEditorialPod.get(r.client_name) ?? "Unassigned";
      const list = map.get(pod);
      if (list) list.push(r);
      else map.set(pod, [r]);
    }
    return Array.from(map.entries()).sort(([a], [b]) => sortPodKey(a, b));
  }, [displayRows, clientToEditorialPod]);

  // SOW denominator per client — used by per-client cards so every pipeline
  // stage is expressed as "% of contracted SOW".
  const clientToSow = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of filteredClients ?? []) {
      if (typeof c.articles_sow === "number" && c.articles_sow > 0) {
        map.set(c.name, c.articles_sow);
      }
    }
    return map;
  }, [filteredClients]);


  if (loading) {
    return (
      <div className="space-y-8">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[90px]" />)}
        </div>
        <Skeleton className="h-[300px]" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Top cards — scope-aware. Portfolio mode drops cumulative sums in
          favor of triage signals (bottleneck, funnel health, most stuck,
          pod attention). Pod / single-client modes show the totals that
          actually mean something at that scope. */}
      <CumulativePipelineCards
        filteredClients={filteredClients ?? []}
        rows={displayRows}
      />

      {/* Per-pod aggregate cards — pacing-aware so a pod with new clients
          isn't unfairly punished for lower absolute %. Replaces the wide
          pipeline matrix. Hidden when only one pod is in scope. */}
      <PodPipelineCardsGrid
        filteredClients={filteredClients ?? []}
        rows={displayRows}
      />

      {/* Pod-aggregate row (if slotted) sits immediately above per-client detail */}
      {beforeClientCards}

      {/* Per-client cards — grouped into discrete subsections per pod so you
          can scan one pod at a time instead of a flat alphabetical grid. */}
      {rowsByPod.length === 0 ? (
        <p className="text-center text-sm text-[#606060] py-8">No cumulative pipeline data available.</p>
      ) : (
        <div className="space-y-6">
          {rowsByPod.map(([pod, rows]) => (
            <div key={`pod-group-${pod}`} className="space-y-3">
              <div className="flex items-center gap-2 border-b border-[#1f1f1f] pb-1.5">
                {podBadge(pod)}
                <span className="font-mono text-xs text-[#606060]">
                  {rows.length} client{rows.length === 1 ? "" : "s"}
                </span>
                <span className="h-px flex-1 bg-[#1f1f1f]" />
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

