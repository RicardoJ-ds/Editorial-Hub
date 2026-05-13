"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api";
import type { Client, GoalsVsDeliveryRow } from "@/lib/types";
import { AlertTriangle } from "lucide-react";
import { DataSourceBadge } from "./DataSourceBadge";
import { GoalsMonthTable } from "./GoalsMonthTable";
import { GoalsOverviewCards } from "./GoalsOverviewCards";
import { contentTypeRatio } from "./shared-helpers";
import type { DateRange } from "./DateRangeFilter";
import { useCurrentEditorialMonth } from "@/lib/editorialWeeksClient";

interface ClientGoalAgg {
  client: string;
  cbGoal: number;
  cbDel: number;
  adGoal: number;
  adDel: number;
}

interface GoalsSummary {
  cbGoal: number;
  cbDel: number;
  adGoal: number;
  adDel: number;
  cbPct: number;
  adPct: number;
  totalClients: number;
  onTrack: number;
  perClient: Map<string, ClientGoalAgg>;
}

/** Aggregate Goals-vs-Delivery rows to the per-client + grand-total shape
 *  the gauges + on-track card consume. Same three-step roll-up the section
 *  has used for months — extracted to module scope so the gauges (current
 *  Editorial month only) and the detail table (user's date filter) can
 *  share it. */
function aggregateGoalsSummary(rowsSubset: GoalsVsDeliveryRow[]): GoalsSummary {
  // Step 1: max-of-week per (client × month × content_type). Weekly rows
  // carry running cumulatives, so the max is end-of-month.
  const perCMC = new Map<
    string,
    {
      client: string;
      ratio: number;
      cbGoal: number;
      cbDel: number;
      adGoal: number;
      adDel: number;
    }
  >();
  for (const r of rowsSubset) {
    const ct = (r.content_type ?? "").trim().toLowerCase() || "default";
    const key = `${r.client_name}|${r.month_year}|${ct}`;
    let e = perCMC.get(key);
    if (!e) {
      e = {
        client: r.client_name,
        ratio: contentTypeRatio(r.content_type, r.ratios),
        cbGoal: 0,
        cbDel: 0,
        adGoal: 0,
        adDel: 0,
      };
      perCMC.set(key, e);
    }
    e.cbGoal = Math.max(e.cbGoal, r.cb_monthly_goal ?? 0);
    e.adGoal = Math.max(e.adGoal, r.ad_monthly_goal ?? 0);
    e.cbDel = Math.max(e.cbDel, r.cb_delivered_to_date ?? 0);
    e.adDel = Math.max(e.adDel, r.ad_delivered_to_date ?? 0);
  }

  // Step 2: collapse content-type → (client × month), applying ratio weights.
  const perClientMonth = new Map<
    string,
    { client: string; cbGoal: number; cbDel: number; adGoal: number; adDel: number }
  >();
  for (const [k, e] of perCMC.entries()) {
    const [client, month] = k.split("|");
    const cmKey = `${client}|${month}`;
    let cm = perClientMonth.get(cmKey);
    if (!cm) {
      cm = { client, cbGoal: 0, cbDel: 0, adGoal: 0, adDel: 0 };
      perClientMonth.set(cmKey, cm);
    }
    cm.cbGoal += e.cbGoal * e.ratio;
    cm.cbDel += e.cbDel * e.ratio;
    cm.adGoal += e.adGoal * e.ratio;
    cm.adDel += e.adDel * e.ratio;
  }

  // Step 3: per-client cumulative totals + grand totals.
  const perClient = new Map<string, ClientGoalAgg>();
  for (const e of perClientMonth.values()) {
    let c = perClient.get(e.client);
    if (!c) {
      c = { client: e.client, cbGoal: 0, cbDel: 0, adGoal: 0, adDel: 0 };
      perClient.set(e.client, c);
    }
    if (e.cbGoal > 0) {
      c.cbGoal += e.cbGoal;
      c.cbDel += e.cbDel;
    }
    if (e.adGoal > 0) {
      c.adGoal += e.adGoal;
      c.adDel += e.adDel;
    }
  }

  let cbGoal = 0;
  let cbDel = 0;
  let adGoal = 0;
  let adDel = 0;
  for (const c of perClient.values()) {
    cbGoal += c.cbGoal;
    cbDel += c.cbDel;
    adGoal += c.adGoal;
    adDel += c.adDel;
  }

  // On-track count — same threshold the cards have always used. Clients
  // with zero goals in both dimensions are excluded (would read 0/0).
  const evaluable: ClientGoalAgg[] = [];
  let onTrack = 0;
  for (const c of perClient.values()) {
    if (c.cbGoal === 0 && c.adGoal === 0) continue;
    evaluable.push(c);
    const cbPct = c.cbGoal > 0 ? (c.cbDel / c.cbGoal) * 100 : null;
    const adPct = c.adGoal > 0 ? (c.adDel / c.adGoal) * 100 : null;
    const cbOk = cbPct === null || cbPct >= 75;
    const adOk = adPct === null || adPct >= 75;
    if (cbOk && adOk) onTrack += 1;
  }

  return {
    cbGoal,
    cbDel,
    adGoal,
    adDel,
    cbPct: cbGoal > 0 ? Math.round((cbDel / cbGoal) * 100) : 0,
    adPct: adGoal > 0 ? Math.round((adDel / adGoal) * 100) : 0,
    totalClients: evaluable.length,
    onTrack,
    perClient,
  };
}

// Visible warning that pre-Oct 2025 data was sourced from a different system
// and may not be fully tracked. Repeated near the weekly-detail footer in
// GoalsMonthTable so reviewers see it again when they drill in.
export function DataQualityNote({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={
        compact
          ? "inline-flex items-start gap-1.5 rounded-md border border-[#F5BC4E]/30 bg-[#F5BC4E]/10 px-2 py-1 font-mono text-[10px] leading-snug text-[#F5BC4E]"
          : "flex items-start gap-2 rounded-md border border-[#F5BC4E]/30 bg-[#F5BC4E]/10 px-3 py-2 text-[11px] leading-snug text-[#F5BC4E]"
      }
    >
      <AlertTriangle className={compact ? "h-3 w-3 shrink-0 mt-px" : "h-3.5 w-3.5 shrink-0 mt-0.5"} />
      <span>
        <span className="font-mono uppercase tracking-wider font-semibold">
          Data may be incomplete
        </span>
        {": "}
        <span className="text-[#E6E6E6]">
          rows before Aug/Sep 2025 came from a different source and aren&apos;t
          fully tracked yet — totals across older months may understate
          delivery.
        </span>
      </span>
    </div>
  );
}

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
  // `scopedRows` continues to drive the date-filtered detail table.
  // The gauges (below) use `currentMonthSummary` instead, computed from
  // rows scoped to the current Editorial month only — see Phase 5 spec.

  // Current-Editorial-month rows. Independent of the user's date filter so
  // the gauges always show "this month so far" — Phase 5 spec. Filter on
  // both the client set + the editorial-calendar month.
  const editorialMonth = useCurrentEditorialMonth();
  const currentMonthRows = useMemo(() => {
    const clients = filteredClients ?? [];
    const names = new Set(clients.map((c) => c.name));
    return rows.filter((r) => {
      if (clients.length > 0 && !names.has(r.client_name)) return false;
      const d = parseMonthYear(r.month_year);
      if (!d) return false;
      return (
        d.getFullYear() === editorialMonth.year &&
        d.getMonth() + 1 === editorialMonth.month
      );
    });
  }, [rows, filteredClients, editorialMonth.year, editorialMonth.month]);

  const currentMonthSummary = useMemo(
    () => aggregateGoalsSummary(currentMonthRows),
    [currentMonthRows],
  );

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[90px]" />)}
        </div>
        <Skeleton className="h-[300px]" />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Data-quality banner — visible always so reviewers know early-2025
          numbers may be incomplete. Same warning re-displayed near the
          weekly-detail footer of the table below. */}
      <DataQualityNote />

      {/* Top cards — scope-aware, mirrors Delivery Overview / Cumulative
          Pipeline. The gauges always show the CURRENT Editorial month's
          progress (NOT the user's date filter) so DaniQ + leads can see
          "where are we right now" at a glance. The detail table below
          continues to honor the date range. */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
            Current Month Progress
          </h3>
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#F5BC4E]/30 bg-[#F5BC4E]/10 px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#F5BC4E]"
            title="These gauges always show this Editorial month — they ignore the date filter."
          >
            {editorialMonth.label} · not date-filtered
          </span>
          <DataSourceBadge
            type="live"
            source={`Goals vs Delivery for ${editorialMonth.label}. Always this month — ignores the date filter.`}
            shows={[
              "1 client: their CB / Article % + status this month.",
              "1 pod: pod CB / Article totals + clients on track.",
              "Portfolio: Goal Status, Most Behind, Avg Achievement, On Track.",
              "Numbers are weighted (jumbo ×2, LP ×0.5).",
            ]}
          />
        </div>
        <GoalsOverviewCards
          filteredClients={filteredClients ?? []}
          perClient={currentMonthSummary.perClient}
          totals={{
            cbGoal: currentMonthSummary.cbGoal,
            cbDel: currentMonthSummary.cbDel,
            adGoal: currentMonthSummary.adGoal,
            adDel: currentMonthSummary.adDel,
          }}
          asOfLabel={editorialMonth.label}
        />
      </div>

      {/* Pod-aggregate row (cumulative across the active range) — sits above
          the unified table so readers scan pod totals before per-client
          detail. */}
      {beforeClientCards}

      {/* Unified month-range table — replaces the old horizontal bar chart
          + weekly breakdown matrix + per-client card grid. */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
            Month-by-Month Detail
          </h3>
          <DataSourceBadge
            type="live"
            source="Per-client × per-month grid with weekly drill-down."
            shows={[
              "One row per client; one column per month.",
              "Click a month header to expand its weekly detail.",
              "Toggle CBs / Articles to flip the table.",
              "Cells show delivered ÷ goal (weighted, rounded to whole units).",
            ]}
          />
        </div>
        <GoalsMonthTable
          rows={scopedRows}
          filteredClients={filteredClients ?? []}
          dateRange={dateRange}
        />
      </div>
    </div>
  );
}
