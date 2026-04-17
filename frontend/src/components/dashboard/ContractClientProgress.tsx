"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api";
import type {
  Client,
  CumulativeMetric,
  GoalsVsDeliveryRow,
} from "@/lib/types";
import { ClientGoalCard } from "./ClientGoalCard";
import { ClientPipelineCard } from "./ClientPipelineCard";
import { DataSourceBadge } from "./DataSourceBadge";

interface Props {
  filteredClients: Client[];
}

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

  // Latest week per client, then filter + sort alphabetically by client
  const latestGoalPerClient = useMemo(() => {
    const map = new Map<string, GoalsVsDeliveryRow>();
    for (const row of goalRows) {
      const existing = map.get(row.client_name);
      if (!existing || row.week_number > existing.week_number) map.set(row.client_name, row);
    }
    return Array.from(map.values())
      .filter((r) => filterNames.has(r.client_name))
      .sort((a, b) => a.client_name.localeCompare(b.client_name));
  }, [goalRows, filterNames]);

  const filteredPipeline = useMemo(() => {
    return pipelineRows
      .filter((r) => filterNames.has(r.client_name))
      .sort((a, b) => a.client_name.localeCompare(b.client_name));
  }, [pipelineRows, filterNames]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[260px]" />
        <Skeleton className="h-[260px]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Monthly goal gauges — one card per client */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
            Current Month Goals — by Client
          </h3>
          <DataSourceBadge
            type="live"
            source="Sheet: '[Month Year] Goals vs Delivery' — Spreadsheet: Master Tracker. Latest week snapshot for each client in the most recent month."
          />
        </div>
        {latestGoalPerClient.length === 0 ? (
          <p className="text-center text-sm text-[#606060] py-6">
            No monthly goal data for the selected filters.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {latestGoalPerClient.map((row) => (
              <ClientGoalCard key={row.id} data={row} />
            ))}
          </div>
        )}
      </div>

      {/* Cumulative pipeline bars — one card per client */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
            Cumulative Pipeline — by Client
          </h3>
          <DataSourceBadge
            type="live"
            source="Sheet: 'Cumulative' — Spreadsheet: Master Tracker. All-time pipeline per client: topics, CBs, articles, published."
          />
        </div>
        {filteredPipeline.length === 0 ? (
          <p className="text-center text-sm text-[#606060] py-6">
            No cumulative pipeline data for the selected filters.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredPipeline.map((row) => (
              <ClientPipelineCard key={row.id} data={row} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
