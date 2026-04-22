"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api";
import type { Client, GoalsVsDeliveryRow } from "@/lib/types";
import { SummaryCard } from "./SummaryCard";
import { GoalsMonthTable } from "./GoalsMonthTable";
import { parsePctValue } from "./shared-helpers";
import type { DateRange } from "./DateRangeFilter";

interface Props {
  filteredClients?: Client[];
  /** Rendered right above the unified goals table so the pod aggregate sits
   *  adjacent to the detail it rolls up from. */
  beforeClientCards?: React.ReactNode;
  /** Page-level date range — defines which months of Goals vs Delivery data
   *  the summary cards and the month-range table aggregate across. When
   *  omitted or type="all", every month we have is included. */
  dateRange?: DateRange;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseMonthYear(s: string): Date | null {
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

export function GoalsVsDeliverySection({ filteredClients, beforeClientCards, dateRange }: Props) {
  const [rows, setRows] = useState<GoalsVsDeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiGet<GoalsVsDeliveryRow[]>("/api/goals-delivery/all")
      .then(setRows)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Rows that survive the client filter + date range. Range match is
  // "month overlaps range": any month whose last day ≥ range start and whose
  // first day ≤ range end. Everything below consumes this set.
  const scopedRows = useMemo(() => {
    const clients = filteredClients ?? [];
    const names = new Set(clients.map((c) => c.name));
    const [start, end] = resolveDateRange(dateRange);
    return rows.filter((r) => {
      if (clients.length > 0 && !names.has(r.client_name)) return false;
      const d = parseMonthYear(r.month_year);
      if (!d) return false;
      if (start) {
        const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        if (monthEnd < start) return false;
      }
      if (end && d > end) return false;
      return true;
    });
  }, [rows, filteredClients, dateRange]);

  // Summary across the scoped range: sum of monthly_goal per (client × month)
  // and sum of max-to-date per (client × month). Using max-of-to-date avoids
  // double-counting since each week carries a running cumulative.
  //
  // Important: only count deliveries in months that ALSO have a goal. Some
  // client-months have pre-goal deliveries (ramp-up period, client signed
  // mid-month etc.) — the month table correctly shows "—" for those cells,
  // and the summary needs to match or the two disagree (e.g. Leapsome: 2
  // delivered in Jan with no Jan goal, 1 delivered in Feb with goal 5 →
  // summary should read 1/5, not 3/5).
  const summary = useMemo(() => {
    const perClientMonth = new Map<string, { cbGoal: number; cbDel: number; adGoal: number; adDel: number }>();
    for (const r of scopedRows) {
      const key = `${r.client_name}|${r.month_year}`;
      let e = perClientMonth.get(key);
      if (!e) {
        e = { cbGoal: 0, cbDel: 0, adGoal: 0, adDel: 0 };
        perClientMonth.set(key, e);
      }
      e.cbGoal = Math.max(e.cbGoal, r.cb_monthly_goal ?? 0);
      e.adGoal = Math.max(e.adGoal, r.ad_monthly_goal ?? 0);
      e.cbDel = Math.max(e.cbDel, r.cb_delivered_to_date ?? 0);
      e.adDel = Math.max(e.adDel, r.ad_delivered_to_date ?? 0);
    }
    let cbGoal = 0, cbDel = 0, adGoal = 0, adDel = 0;
    for (const e of perClientMonth.values()) {
      if (e.cbGoal > 0) {
        cbGoal += e.cbGoal;
        cbDel += e.cbDel;
      }
      if (e.adGoal > 0) {
        adGoal += e.adGoal;
        adDel += e.adDel;
      }
    }
    // On-track client count — use the latest snapshot per client (max
    // month_year, max week within that). "On track" = cb_pct OR ad_pct ≥ 75%.
    const latestPerClient = new Map<string, GoalsVsDeliveryRow>();
    for (const r of scopedRows) {
      const cur = latestPerClient.get(r.client_name);
      if (!cur) {
        latestPerClient.set(r.client_name, r);
        continue;
      }
      if (
        r.month_year > cur.month_year ||
        (r.month_year === cur.month_year && r.week_number > cur.week_number)
      ) {
        latestPerClient.set(r.client_name, r);
      }
    }
    const clients = Array.from(latestPerClient.values());
    const onTrack = clients.filter(
      (r) =>
        parsePctValue(r.cb_pct_of_goal) >= 75 ||
        parsePctValue(r.ad_pct_of_goal) >= 75,
    ).length;

    return {
      cbGoal, cbDel, adGoal, adDel,
      cbPct: cbGoal > 0 ? Math.round((cbDel / cbGoal) * 100) : 0,
      adPct: adGoal > 0 ? Math.round((adDel / adGoal) * 100) : 0,
      totalClients: clients.length,
      onTrack,
    };
  }, [scopedRows]);

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

  const avgAchievement = Math.round((summary.cbPct + summary.adPct) / 2);

  return (
    <div className="space-y-5">
      {/* Summary cards — range-aware. All four metrics aggregate across every
          month of the active date-range filter above (plus pod + client
          filters). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title="CBs Delivered vs Goal"
          value={`${summary.cbDel} / ${summary.cbGoal}`}
          valueColor="green"
          progress={summary.cbPct}
          description={`${summary.cbPct}% of goal`}
        />
        <SummaryCard
          title="Articles Delivered vs Goal"
          value={`${summary.adDel} / ${summary.adGoal}`}
          valueColor="green"
          progress={summary.adPct}
          description={`${summary.adPct}% of goal`}
        />
        <SummaryCard
          title="Avg Achievement"
          value={`${avgAchievement}%`}
          valueColor={avgAchievement >= 75 ? "green" : "white"}
          description="CBs + Articles combined"
        />
        <SummaryCard
          title="Clients On Track"
          value={summary.onTrack}
          valueColor="green"
          description={`of ${summary.totalClients} — CB% or Article% ≥ 75%`}
        />
      </div>

      {/* Pod-aggregate row (latest-week snapshot) — sits above the unified
          table so readers scan pod totals before per-client detail. */}
      {beforeClientCards}

      {/* Unified month-range table — replaces the old horizontal bar chart
          + weekly breakdown matrix + per-client card grid. */}
      <GoalsMonthTable
        rows={scopedRows}
        filteredClients={filteredClients ?? []}
        dateRange={dateRange}
      />
    </div>
  );
}
