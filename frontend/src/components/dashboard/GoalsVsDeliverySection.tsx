"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiGet } from "@/lib/api";
import type { Client, GoalsVsDeliveryRow } from "@/lib/types";
import { SummaryCard } from "./SummaryCard";
import { DataSourceBadge } from "./DataSourceBadge";
import { ClientGoalCard } from "./ClientGoalCard";
import { GoalsDeliveryChart } from "@/components/charts/GoalsDeliveryChart";
import { parsePctValue } from "./shared-helpers";

interface Props {
  filteredClients?: Client[];
}

export function GoalsVsDeliverySection({ filteredClients }: Props) {
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [selectedWeek, setSelectedWeek] = useState<string>("latest");
  const [rows, setRows] = useState<GoalsVsDeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<string[]>("/api/goals-delivery/months").then(setMonths).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    apiGet<GoalsVsDeliveryRow[]>("/api/goals-delivery/latest")
      .then((data) => {
        setRows(data);
        if (data.length > 0 && !selectedMonth) setSelectedMonth(data[0].month_year);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMonthChange = useCallback((month: string | null) => {
    if (!month) return;
    setSelectedMonth(month);
    setSelectedWeek("latest");
    setLoading(true);
    apiGet<GoalsVsDeliveryRow[]>(`/api/goals-delivery/by-month/${encodeURIComponent(month)}`)
      .then(setRows)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const availableWeeks = useMemo(() => {
    const weeks = new Set(rows.map((r) => r.week_number));
    return Array.from(weeks).sort((a, b) => a - b);
  }, [rows]);

  const clientRows = useMemo(() => {
    if (selectedWeek === "latest") {
      const map = new Map<string, GoalsVsDeliveryRow>();
      for (const row of rows) {
        const existing = map.get(row.client_name);
        if (!existing || row.week_number > existing.week_number) map.set(row.client_name, row);
      }
      return Array.from(map.values()).sort((a, b) => a.client_name.localeCompare(b.client_name));
    }
    const weekNum = parseInt(selectedWeek, 10);
    return rows.filter((r) => r.week_number === weekNum).sort((a, b) => a.client_name.localeCompare(b.client_name));
  }, [rows, selectedWeek]);

  const displayRows = useMemo(() => {
    if (!filteredClients?.length) return clientRows;
    const names = new Set(filteredClients.map((c) => c.name));
    return clientRows.filter((r) => names.has(r.client_name));
  }, [clientRows, filteredClients]);

  // Summary
  const totalCB = displayRows.reduce((a, r) => a + (r.cb_delivered_to_date ?? 0), 0);
  const totalCBGoal = displayRows.reduce((a, r) => a + (r.cb_monthly_goal ?? 0), 0);
  const totalAD = displayRows.reduce((a, r) => a + (r.ad_delivered_to_date ?? 0), 0);
  const totalADGoal = displayRows.reduce((a, r) => a + (r.ad_monthly_goal ?? 0), 0);
  const cbPct = totalCBGoal > 0 ? Math.round((totalCB / totalCBGoal) * 100) : 0;
  const adPct = totalADGoal > 0 ? Math.round((totalAD / totalADGoal) * 100) : 0;
  const onTrack = displayRows.filter((r) => {
    return parsePctValue(r.cb_pct_of_goal) >= 75 || parsePctValue(r.ad_pct_of_goal) >= 75;
  }).length;

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[90px]" />)}
        </div>
        <Skeleton className="h-[300px]" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="font-mono text-xs text-[#606060] uppercase tracking-wider">Month</label>
          <Select value={selectedMonth} onValueChange={handleMonthChange}>
            <SelectTrigger size="sm" className="w-[200px]"><SelectValue placeholder="Select month" /></SelectTrigger>
            <SelectContent>
              {months.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="h-4 w-px bg-[#2a2a2a]" />
        <div className="flex items-center gap-2">
          <label className="font-mono text-xs text-[#606060] uppercase tracking-wider">Week</label>
          <Select value={selectedWeek} onValueChange={(v) => v && setSelectedWeek(v)}>
            <SelectTrigger size="sm" className="w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">Latest</SelectItem>
              {availableWeeks.map((w) => <SelectItem key={w} value={String(w)}>Week {w}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard title="CBs Delivered vs Goal" value={`${totalCB} / ${totalCBGoal}`} valueColor="green" progress={cbPct} description={`${cbPct}% of goal`} />
        <SummaryCard title="Articles Delivered vs Goal" value={`${totalAD} / ${totalADGoal}`} valueColor="green" progress={adPct} description={`${adPct}% of goal`} />
        <SummaryCard title="Avg Achievement" value={`${Math.round((cbPct + adPct) / 2)}%`} valueColor={Math.round((cbPct + adPct) / 2) >= 75 ? "green" : "white"} description="Across CBs + Articles" />
        <SummaryCard title="Clients On Track" value={onTrack} valueColor="green" description={`of ${displayRows.length} clients`} />
      </div>

      {/* Chart */}
      <GoalsDeliveryChart data={displayRows} />

      {/* Client Goal Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {displayRows.map((row) => (
          <ClientGoalCard key={row.id} data={row} />
        ))}
      </div>

      {displayRows.length === 0 && (
        <p className="text-center text-sm text-[#606060] py-8">No data available for the selected period.</p>
      )}
    </div>
  );
}
