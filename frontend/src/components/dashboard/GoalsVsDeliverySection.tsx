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
  const summary = useMemo(() => {
    // Three-step roll-up so content-type weighting is honored:
    //   1) (client × month × content_type × week) is one row in the sheet.
    //      Take max-of-week per (client × month × content_type) — multiple
    //      weeks carry running cumulatives, max = end-of-month.
    //   2) Weight each (client × month × content_type) by its ratio
    //      (article ×1, jumbo ×2, LP ×0.5) and sum across content types
    //      → (client × month) weighted totals.
    //   3) Sum across months → per-client totals; sum across clients → grand
    //      totals. Cards / pod gauges / table all consume these denominators.
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
    for (const r of scopedRows) {
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
    // Collapse (client × month × content_type) → (client × month), applying
    // the per-content-type weight on the way up.
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

    // Per-client cumulative totals (same denominators the table uses).
    type ClientAgg = {
      client: string;
      cbGoal: number;
      cbDel: number;
      adGoal: number;
      adDel: number;
    };
    const perClient = new Map<string, ClientAgg>();
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

    let cbGoal = 0,
      cbDel = 0,
      adGoal = 0,
      adDel = 0;
    for (const c of perClient.values()) {
      cbGoal += c.cbGoal;
      cbDel += c.cbDel;
      adGoal += c.adGoal;
      adDel += c.adDel;
    }

    // On-track client count — uses the SAME cumulative-range numerator and
    // denominator the table column shows, so the card and the table can't
    // disagree. Rule: a client is on track when BOTH cumulative cb_pct ≥ 75%
    // AND cumulative ad_pct ≥ 75%. Clients with no goal in either dimension
    // are skipped (they'd otherwise read 0/0 and trip the logic).
    const evaluable: ClientAgg[] = [];
    let onTrack = 0;
    for (const c of perClient.values()) {
      if (c.cbGoal === 0 && c.adGoal === 0) continue;
      evaluable.push(c);
      const cbPct = c.cbGoal > 0 ? (c.cbDel / c.cbGoal) * 100 : null;
      const adPct = c.adGoal > 0 ? (c.adDel / c.adGoal) * 100 : null;
      // "Both on track" — if a metric isn't measurable (no goal), don't
      // penalize the client for it; just require the measurable side to pass.
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
  }, [scopedRows]);

  // "As of …" framing — derive from the latest (month_year, week_number)
  // actually present in scope, not "today". Keeps the framing honest if the
  // sheet hasn't synced this week yet.
  const asOfLabel = useMemo(() => {
    let bestKey = -Infinity;
    let bestRow: GoalsVsDeliveryRow | null = null;
    for (const r of scopedRows) {
      const d = parseMonthYear(r.month_year);
      if (!d) continue;
      const key = d.getFullYear() * 1000 + d.getMonth() * 60 + (r.week_number ?? 0);
      if (key > bestKey) {
        bestKey = key;
        bestRow = r;
      }
    }
    if (!bestRow) return null;
    const d = parseMonthYear(bestRow.month_year);
    if (!d) return null;
    const monthShort = d.toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
    });
    return `As of week ${bestRow.week_number} · ${monthShort}`;
  }, [scopedRows]);

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
          Pipeline. Portfolio mode drops cumulative sums in favor of triage
          signals (Most Behind, Avg Achievement, Clients On Track). */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
            Range Snapshot
          </h3>
          <DataSourceBadge
            type="live"
            source="Aggregated from the Goals vs Delivery sheet across the active date range. Cards swap based on filter scope: 1 client · 1 pod · portfolio."
            shows={[
              "1 client → that client's CB / Article % + goal-status tier.",
              "1 pod → pod CB / Article totals + clients on track in the pod.",
              "Portfolio → triage signals: Goal Status mix, Most Behind, Avg Achievement, Clients On Track.",
              "Numbers are content-type weighted (article ×1, jumbo ×2, LP ×0.5).",
            ]}
          />
        </div>
        <GoalsOverviewCards
          filteredClients={filteredClients ?? []}
          perClient={summary.perClient}
          totals={{
            cbGoal: summary.cbGoal,
            cbDel: summary.cbDel,
            adGoal: summary.adGoal,
            adDel: summary.adDel,
          }}
          asOfLabel={asOfLabel}
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
            source="Per-(client × month) view, with weekly drill-down. Same content-type-weighted aggregation as the cards above and the pod gauges, so totals always reconcile."
            shows={[
              "One row per client; one column per month in the active range.",
              "Click a month header to expand its weekly breakdown (one month at a time).",
              "Toggle CBs / Articles to flip the whole table to the other metric.",
              "Cells show delivered/goal — content-type weighted, rounded to whole units.",
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
