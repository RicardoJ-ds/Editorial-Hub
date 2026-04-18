"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { apiGet } from "@/lib/api";
import type {
  Client,
  DeliverableMonthly,
  ProductionTrendPoint,
  ClientPacing,
  GoalsVsDeliveryRow,
  CumulativeMetric,
  ClientProductionRow,
} from "@/lib/types";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { SummaryCard } from "@/components/dashboard/SummaryCard";
import { TimeToMetrics } from "@/components/dashboard/TimeToMetrics";
import { DeliveryTrendChart } from "@/components/charts/DeliveryTrendChart";
import { ProductionTrendChart } from "@/components/charts/ProductionTrendChart";
import { PacingBadge } from "@/components/dashboard/PacingBadge";
import { ClientDeliveryCards } from "@/components/dashboard/ClientDeliveryCards";
import { ClientDeliveryMatrix } from "@/components/dashboard/ClientDeliveryMatrix";
import { GoalsVsDeliverySection } from "@/components/dashboard/GoalsVsDeliverySection";
import { CumulativePipelineSection } from "@/components/dashboard/CumulativePipelineSection";
import {
  PodGoalsRow,
  PodPipelineRow,
} from "@/components/dashboard/ContractClientProgress";
import { SortableHead as SortableHeadShared } from "@/components/dashboard/shared-helpers";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink } from "lucide-react";
import { DataSourceBadge } from "@/components/dashboard/DataSourceBadge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "\u2014";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function wordCountDisplay(min: number | null, max: number | null): string {
  if (min == null && max == null) return "\u2014";
  if (min != null && max != null) {
    if (min === max) return min.toLocaleString();
    return `${min.toLocaleString()}\u2013${max.toLocaleString()}`;
  }
  return (min ?? max)!.toLocaleString();
}

type StatusVariant = "default" | "secondary" | "destructive" | "outline";

function statusBadge(status: string) {
  const map: Record<string, { label: string; className: string; variant: StatusVariant }> = {
    ACTIVE: {
      label: "Active",
      className: "bg-[#42CA80]/15 text-[#42CA80] border-[#42CA80]/30",
      variant: "outline",
    },
    COMPLETED: {
      label: "Completed",
      className: "bg-[#606060]/15 text-[#909090] border-[#606060]/30",
      variant: "outline",
    },
    CANCELLED: {
      label: "Cancelled",
      className: "bg-[#ED6958]/15 text-[#ED6958] border-[#ED6958]/30",
      variant: "outline",
    },
    SOON_TO_BE_ACTIVE: {
      label: "Soon Active",
      className: "bg-[#F5C542]/15 text-[#F5C542] border-[#F5C542]/30",
      variant: "outline",
    },
    INACTIVE: {
      label: "Inactive",
      className: "bg-[#606060]/15 text-[#909090] border-[#606060]/30",
      variant: "outline",
    },
  };
  const info = map[status] ?? {
    label: status,
    className: "",
    variant: "secondary" as StatusVariant,
  };
  return (
    <Badge variant={info.variant} className={info.className}>
      {info.label}
    </Badge>
  );
}

const POD_COLORS: Record<string, string> = {
  "Pod 1": "bg-[#5B9BF5]/15 text-[#5B9BF5] border-[#5B9BF5]/30",
  "Pod 2": "bg-[#42CA80]/15 text-[#42CA80] border-[#42CA80]/30",
  "Pod 3": "bg-[#F5C542]/15 text-[#F5C542] border-[#F5C542]/30",
  "Pod 5": "bg-[#ED6958]/15 text-[#ED6958] border-[#ED6958]/30",
};

function podBadge(pod: string | null) {
  if (!pod) return <span className="text-[#606060]">{"\u2014"}</span>;
  const color = POD_COLORS[pod] ?? "bg-secondary text-secondary-foreground";
  return (
    <Badge variant="outline" className={color}>
      {pod}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Sort hook
// ---------------------------------------------------------------------------

type SortDir = "asc" | "desc" | null;

function useSortableData<T>(data: T[]) {
  const [sortKey, setSortKey] = useState<keyof T | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return data;
    return [...data].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });
  }, [data, sortKey, sortDir]);

  const toggleSort = useCallback(
    (key: keyof T) => {
      if (sortKey === key) {
        if (sortDir === "asc") setSortDir("desc");
        else if (sortDir === "desc") {
          setSortKey(null);
          setSortDir(null);
        }
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey, sortDir]
  );

  const getSortIcon = useCallback(
    (key: keyof T) => {
      if (sortKey !== key)
        return <ArrowUpDown className="ml-1 inline h-3 w-3 text-[#606060]" />;
      if (sortDir === "asc")
        return <ArrowUp className="ml-1 inline h-3 w-3 text-[#42CA80]" />;
      return <ArrowDown className="ml-1 inline h-3 w-3 text-[#42CA80]" />;
    },
    [sortKey, sortDir]
  );

  return { sorted, toggleSort, getSortIcon };
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-8 w-[200px]" />
        <Skeleton className="h-8 w-[140px]" />
        <Skeleton className="h-8 w-[140px]" />
        <Skeleton className="h-7 w-[200px]" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Skeleton className="h-[100px]" />
        <Skeleton className="h-[100px]" />
        <Skeleton className="h-[100px]" />
      </div>
      <Skeleton className="h-[400px]" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function EditorialClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [deliverables, setDeliverables] = useState<DeliverableMonthly[]>([]);
  const [filteredClients, setFilteredClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [productionTrend, setProductionTrend] = useState<ProductionTrendPoint[]>([]);
  const [pacingData, setPacingData] = useState<ClientPacing[]>([]);
  const [clientProduction, setClientProduction] = useState<ClientProductionRow[]>([]);
  const fetchData = useCallback(async () => {
    try {
      const [clientsData, deliverablesData] = await Promise.all([
        apiGet<Client[]>("/api/clients/?limit=200"),
        apiGet<DeliverableMonthly[]>("/api/deliverables/?limit=1000"),
      ]);
      setClients(clientsData);
      setFilteredClients(clientsData);
      setDeliverables(deliverablesData);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Failed to load dashboard data:", err);
    } finally {
      setLoading(false);
    }
    // Fetch supplementary data in parallel — failures are non-blocking
    apiGet<ProductionTrendPoint[]>("/api/dashboard/production-trend")
      .then(setProductionTrend)
      .catch(() => {});
    apiGet<ClientPacing[]>("/api/dashboard/pacing")
      .then(setPacingData)
      .catch(() => {});
    apiGet<ClientProductionRow[]>("/api/dashboard/client-production")
      .then(setClientProduction)
      .catch(() => {});
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Re-fetch when sync completes
  useEffect(() => {
    const handler = () => { setLoading(true); fetchData(); };
    window.addEventListener("data-synced", handler);
    return () => window.removeEventListener("data-synced", handler);
  }, [fetchData]);

  const handleFilterChange = useCallback((filtered: Client[]) => {
    setFilteredClients(filtered);
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[#606060]">Loading dashboard...</p>
        <DashboardSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Tabs defaultValue="contract-timeline" onValueChange={() => {
        const scroller = document.querySelector('.ml-\\[240px\\]') as HTMLElement | null;
        if (scroller) scroller.scrollTo({ top: 0, behavior: "smooth" });
        else window.scrollTo({ top: 0, behavior: "smooth" });
      }}>
        {/* Sticky: title + filters + tabs */}
        <div className="sticky top-14 z-20 bg-black pb-3 -mx-8 px-8 pt-1">
          {/* Compact header: filters + tabs in one tight block */}
          <div className="flex items-center justify-between mb-3">
            <FilterBar clients={clients} onFilterChange={handleFilterChange} />
            {lastUpdated && (
              <p className="text-[10px] text-[#606060] font-mono shrink-0 ml-4">
                {lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
          </div>
          <TabsList variant="line">
            <TabsTrigger
              value="contract-timeline"
              className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
            >
              Contract &amp; Timeline
            </TabsTrigger>
            <TabsTrigger
              value="deliverables-sow"
              className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
            >
              Deliverables vs SOW
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="contract-timeline">
          <ContractTimelineTab clients={filteredClients} clientProduction={clientProduction} />
        </TabsContent>

        <TabsContent value="deliverables-sow">
          {/* Delivery Overview: summary cards + charts */}
          <DeliverablesSOWTab
            clients={filteredClients}
            deliverables={deliverables}
            productionTrend={productionTrend}
            pacingData={pacingData}
          />

          {/* Unified Client Delivery Matrix (joined data from all sources) */}
          <div className="mt-8 border-t border-[#2a2a2a] pt-6">
            <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060] mb-1">
              Client Delivery Matrix <DataSourceBadge type="live" source="Sheet: 'Delivered vs Invoiced v2' + 'Editorial Operating Model' + 'Goals vs Delivery' — Spreadsheet: Editorial Capacity Planning + Master Tracker. Joined view across all delivery data sources." />
            </h3>
            <p className="text-xs text-[#606060] mb-4">
              Unified per-client monthly view joining SOW, invoicing, CB &amp; article delivery, and production data. Expand rows for weekly detail.
            </p>
            <ClientDeliveryMatrix filteredClients={filteredClients} />
          </div>

          {/* Cumulative Pipeline — summary + funnel, then pod aggregate
              right above per-client detail cards */}
          <div className="mt-8 border-t border-[#2a2a2a] pt-6">
            <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060] mb-1">
              Cumulative Pipeline <DataSourceBadge type="live" source="Sheet: 'Cumulative' — Spreadsheet: Master Tracker. All-time pipeline metrics per pod (aggregate) and per client (detail)." />
            </h3>
            <p className="text-xs text-[#606060] mb-4">
              All-time pipeline progression. Portfolio summary on top, pod aggregate next, then per-client detail.
            </p>
            <CumulativePipelineSection
              filteredClients={filteredClients}
              beforeClientCards={
                <PodPipelineRow filteredClients={filteredClients} />
              }
            />
          </div>

          {/* Weekly Goals vs Delivery — summary + weekly matrix, then pod
              aggregate right above per-client detail cards */}
          <div className="mt-8 border-t border-[#2a2a2a] pt-6">
            <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060] mb-1">
              Weekly Goals vs Delivery <DataSourceBadge type="live" source="Sheet: '[Month Year] Goals vs Delivery' (x9 sheets) — Spreadsheet: Master Tracker. Pod gauges aggregate the latest week; per-client cards show the same week's detail." />
            </h3>
            <p className="text-xs text-[#606060] mb-4">
              Weekly CB and article delivery vs monthly goal. Summary on top, pod aggregate next, then per-client detail.
            </p>
            <GoalsVsDeliverySection
              filteredClients={filteredClients}
              beforeClientCards={
                <PodGoalsRow filteredClients={filteredClients} />
              }
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Client Engagement Timeline
// ---------------------------------------------------------------------------

const TIMELINE_POD_COLORS: Record<string, string> = {
  "Pod 1": "#8FB5D9",
  "Pod 2": "#42CA80",
  "Pod 3": "#F5BC4E",
  "Pod 5": "#ED6958",
};

// --- Totals sidebar bits for the Client Engagement Timeline -----------------

function TotalsHeader({ label, hint }: { label: string; hint: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="font-mono text-[8px] uppercase tracking-wider text-[#606060] text-right cursor-help underline decoration-dotted decoration-[#404040] underline-offset-2" />
          }
        >
          {label}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
          {hint}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function TotalsCell({
  value,
  color,
  muted,
}: {
  value: number | undefined;
  color?: string;
  muted?: boolean;
}) {
  if (value == null) {
    return (
      <span className="font-mono text-[10px] text-[#404040] text-right tabular-nums">—</span>
    );
  }
  // Signed display only when a color signals a signed metric (reconciliation).
  const signed = !!color;
  return (
    <span
      className="font-mono text-[10px] text-right tabular-nums"
      style={{ color: color ?? (muted ? "#606060" : "#C4BCAA") }}
    >
      {signed && value > 0 ? "+" : ""}
      {value.toLocaleString()}
    </span>
  );
}

interface TimelineTooltip {
  x: number;
  y: number;
  content: React.ReactNode;
}

function ClientEngagementTimeline({
  clients,
  clientProduction,
}: {
  clients: Client[];
  clientProduction: ClientProductionRow[];
}) {
  const [cumView, setCumView] = useState<"monthly" | "quarterly">("monthly");
  // Current month in YYYY-MM — used to highlight the live column and split
  // actual (historic) from projected (future). The Operating Model carries
  // both numbers on every row, so we pick by calendar position.
  // Current year + 1-indexed month (matches the API + timelineMonths keys).
  const nowYm = useMemo(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }, []);
  const currentMonthKey = `${nowYm.year}-${String(nowYm.month).padStart(2, "0")}`;
  const currentQuarterKey = `${nowYm.year}-Q${Math.ceil(nowYm.month / 3)}`;

  // Lookup per-client production rows (from ProductionHistory / Editorial Operating Model)
  const productionByClient = useMemo(() => {
    const map = new Map<string, ClientProductionRow>();
    for (const row of clientProduction) map.set(row.client_name, row);
    return map;
  }, [clientProduction]);
  const [tooltip, setTooltip] = useState<TimelineTooltip | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Uses whatever clients are passed in (already filtered by FilterBar)
  const activeClients = useMemo(() => {
    return clients
      .filter((c) => c.start_date)
      .sort((a, b) => {
        const aDate = new Date(a.start_date!).getTime();
        const bDate = new Date(b.start_date!).getTime();
        return aDate - bDate;
      });
  }, [clients]);

  // Calculate the overall date range from all active clients
  const { minDate, maxDate, monthLabels } = useMemo(() => {
    if (activeClients.length === 0) {
      return { minDate: new Date(), maxDate: new Date(), monthLabels: [] };
    }

    const dates = activeClients.flatMap((c) => {
      const result: Date[] = [new Date(c.start_date!)];
      if (c.end_date) result.push(new Date(c.end_date));
      return result;
    });

    let min = new Date(Math.min(...dates.map((d) => d.getTime())));
    let max = new Date(Math.max(...dates.map((d) => d.getTime())));

    // Pad the range: start at beginning of min month, end at end of max month
    min = new Date(min.getFullYear(), min.getMonth(), 1);
    max = new Date(max.getFullYear(), max.getMonth() + 1, 0);

    // If no end dates push max beyond min, set a reasonable default (18 months from min)
    if (max.getTime() - min.getTime() < 1000 * 60 * 60 * 24 * 30) {
      max = new Date(min.getFullYear(), min.getMonth() + 18, 0);
    }

    // Build month labels
    const labels: { label: string; pct: number }[] = [];
    const totalMs = max.getTime() - min.getTime();
    const cursor = new Date(min);
    while (cursor <= max) {
      const pct = ((cursor.getTime() - min.getTime()) / totalMs) * 100;
      const label = cursor.toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
      });
      labels.push({ label, pct });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return { minDate: min, maxDate: max, monthLabels: labels };
  }, [activeClients]);

  // Build a list of all months in the timeline range (for cadence grid).
  // Keys use 1-indexed months to match the backend API (ClientProductionMonth.month
  // is 1..12) so perPeriod.get(key) actually hits the right cell.
  const timelineMonths = useMemo(() => {
    const months: { year: number; month: number; key: string; label: string }[] = [];
    if (activeClients.length === 0) return months;
    const cursor = new Date(minDate);
    while (cursor <= maxDate) {
      const y = cursor.getFullYear();
      const m = cursor.getMonth(); // 0-indexed for Date math
      const apiMonth = m + 1; // 1-indexed for key matching with the API
      months.push({
        year: y,
        month: apiMonth,
        key: `${y}-${String(apiMonth).padStart(2, "0")}`,
        label: cursor.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
  }, [activeClients.length, minDate, maxDate]);

  // Cumulative: sum actual + projected across all filtered clients per month,
  // straight from the Editorial Operating Model. Each month carries both an
  // `actual` and `projected` value; we surface both so the top chart can stack
  // them and mark the current month.
  const cumulativeByMonth = useMemo(() => {
    const map = new Map<string, { actual: number; projected: number }>();
    for (const c of activeClients) {
      const prod = productionByClient.get(c.name);
      if (!prod) continue;
      for (const { year, month, actual, projected } of prod.monthly) {
        const key = `${year}-${String(month).padStart(2, "0")}`;
        const row = map.get(key) ?? { actual: 0, projected: 0 };
        row.actual += actual;
        row.projected += projected;
        map.set(key, row);
      }
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({
        key,
        actual: v.actual,
        projected: v.projected,
        total: v.actual + v.projected,
      }));
  }, [activeClients, productionByClient]);

  // Quarterly aggregation of cumulative data — keep actual/projected split.
  const cumulativeByQuarter = useMemo(() => {
    const map = new Map<string, { actual: number; projected: number }>();
    cumulativeByMonth.forEach(({ key, actual, projected }) => {
      const [y, m] = key.split("-").map(Number);
      // m is 1-indexed (Jan=1); Math.ceil(m / 3) → 1..4
      const q = Math.ceil(m / 3);
      const qKey = `${y}-Q${q}`;
      const row = map.get(qKey) ?? { actual: 0, projected: 0 };
      row.actual += actual;
      row.projected += projected;
      map.set(qKey, row);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({
        key,
        label: key.replace("-", " "),
        actual: v.actual,
        projected: v.projected,
        total: v.actual + v.projected,
      }));
  }, [cumulativeByMonth]);

  // Build quarterly timeline periods for per-client view
  const timelineQuarters = useMemo(() => {
    const quarters: { key: string; label: string; monthKeys: string[] }[] = [];
    const seen = new Set<string>();
    timelineMonths.forEach((tm) => {
      const q = Math.floor(tm.month / 3) + 1;
      const qKey = `${tm.year}-Q${q}`;
      if (!seen.has(qKey)) {
        seen.add(qKey);
        quarters.push({ key: qKey, label: `${tm.year} Q${q}`, monthKeys: [] });
      }
      quarters[quarters.length - 1].monthKeys.push(tm.key);
    });
    return quarters;
  }, [timelineMonths]);

  // Active periods based on cumView toggle (for shared axis + per-client)
  const activePeriods = cumView === "monthly"
    ? timelineMonths.map((tm) => ({ key: tm.key, label: tm.label }))
    : timelineQuarters.map((q) => ({ key: q.key, label: q.label }));

  // Active cumulative data based on toggle
  const activeCumData = cumView === "monthly" ? cumulativeByMonth : cumulativeByQuarter;

  // Max cumulative value (for scaling the cumulative chart)
  const maxCumulative = useMemo(() => {
    return Math.max(1, ...activeCumData.map((c) => c.total));
  }, [activeCumData]);

  if (activeClients.length === 0) return null;

  return (
    <div>
      <div className="flex items-start justify-between mb-3 gap-4">
        <div>
          <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
            Client Engagement Timeline <DataSourceBadge type="live" source="Sheet: 'Editorial SOW overview' + 'Editorial Operating Model' — Spreadsheet: Editorial Capacity Planning. Top chart uses SOW cadence fields; per-client rows toggle between SOW cadence and Operating Model actual/projected. Totals sidebar joins SOW with ProductionHistory (operating model)." />
          </h3>
          <p className="text-[10px] font-mono text-[#606060] mt-0.5">
            Cross-client planning + utilization view. Top: planned-article volume across the portfolio. Middle: one row per filtered client, either their planned cadence or their actual-vs-projected delivery. Right: per-client contract totals with a reconciliation figure.
          </p>
        </div>
        {/* Top-level toggle: Monthly / Quarterly — affects both charts */}
        <div className="flex gap-1 bg-[#0d0d0d] rounded-md p-0.5">
          <button
            onClick={() => setCumView("monthly")}
            className={cn(
              "px-3 py-1 rounded text-[10px] font-mono uppercase tracking-wider transition-colors",
              cumView === "monthly"
                ? "bg-[#42CA80]/15 text-[#42CA80]"
                : "text-[#606060] hover:text-white"
            )}
          >
            Monthly
          </button>
          <button
            onClick={() => setCumView("quarterly")}
            className={cn(
              "px-3 py-1 rounded text-[10px] font-mono uppercase tracking-wider transition-colors",
              cumView === "quarterly"
                ? "bg-[#42CA80]/15 text-[#42CA80]"
                : "text-[#606060] hover:text-white"
            )}
          >
            Quarterly
          </button>
        </div>
      </div>
      <div
        className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-4"
        style={{ ["--scrollbar-gutter" as never]: "13px" }}
      >
        {/* Cumulative article load chart — aligned column-for-column with the
            per-client rows below by iterating the SAME activePeriods array
            (rather than just the months that have production data). */}
        {activePeriods.length > 0 && (() => {
          // Lookup helper: period key → { actual, projected, total }
          const cumMap = new Map(
            activeCumData.map((c) => [c.key, { actual: c.actual, projected: c.projected, total: c.total }]),
          );
          // Aggregate totals across every client in the active portfolio,
          // mirroring the per-row totals sidebar (projected / delivered /
          // sow / reconcile). Computed from productionByClient so the figures
          // match what each client-row shows on the right.
          const agg = activeClients.reduce(
            (acc, c) => {
              const t = productionByClient.get(c.name)?.totals;
              if (!t) return acc;
              acc.projected += t.projected;
              acc.delivered += t.delivered;
              acc.sow += t.sow;
              acc.reconciliation += t.reconciliation;
              return acc;
            },
            { projected: 0, delivered: 0, sow: 0, reconciliation: 0 },
          );
          return (
          <div className="mb-4">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-mono font-semibold uppercase tracking-widest text-[#C4BCAA]">
                  Cumulative Articles — Actual & Projected
                </p>
                <p className="text-[8px] font-mono text-[#606060] mt-0.5">
                  Columns align with the per-client rows below. Solid = actual delivered, lighter shade = projected. Source: Editorial Operating Model. Current month is highlighted.
                </p>
              </div>
              <span className="font-mono text-[9px] text-[#606060]">
                peak: {maxCumulative}
              </span>
            </div>
            {/* pr-[var] mirrors the scrollbar gutter reserved by the
                scrollable client list below, so column x-positions match
                between top chart, axis row, and every client row. */}
            <div
              className="flex items-end gap-2"
              style={{ paddingRight: "var(--scrollbar-gutter)" }}
            >
              {/* Mirrors the 128px client-name column below so the bar grid aligns */}
              <span className="w-32 shrink-0" />
              <div key={cumView} className="flex-1 flex items-end gap-px" style={{ height: 80 }}>
                {activePeriods.map((p, idx) => {
                  const entry = cumMap.get(p.key) ?? { actual: 0, projected: 0, total: 0 };
                  const actualPct = maxCumulative > 0 ? (entry.actual / maxCumulative) * 100 : 0;
                  const projectedPct = maxCumulative > 0 ? (entry.projected / maxCumulative) * 100 : 0;
                  const isCurrent = cumView === "quarterly"
                    ? p.key === currentQuarterKey
                    : p.key === currentMonthKey;
                  const hasGridline = (cumView === "quarterly" || idx % 2 === 0) && !isCurrent;
                  const label = p.label;
                  return (
                    <div
                      key={p.key}
                      className={cn(
                        "relative flex-1 flex flex-col items-center justify-end animate-fade-slide",
                        hasGridline && "border-l border-[#1a1a1a]",
                        isCurrent && "bg-[#42CA80]/14 border-x border-[#42CA80]/50",
                      )}
                      style={{ height: "100%", animationDelay: `${idx * 20}ms` }}
                    >
                      {entry.total > 0 && (
                        <span className={cn(
                          "text-[7px] font-mono mb-0.5",
                          isCurrent ? "text-[#65FFAA] font-semibold" : "text-[#42CA80]"
                        )}>
                          {entry.total}
                        </span>
                      )}
                      <div
                        className="relative w-full flex flex-col justify-end cursor-default"
                        style={{ height: `${actualPct + projectedPct}%`, minHeight: entry.total > 0 ? 2 : 0 }}
                        onMouseEnter={(e) => {
                          if (entry.total <= 0) return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          setTooltip({
                            x: rect.left + rect.width / 2,
                            y: rect.top - 6,
                            content: (
                              <>
                                <p className="text-[10px] font-semibold text-white">{label}</p>
                                {entry.actual > 0 && (
                                  <p className="text-[10px] text-[#42CA80] font-mono">Actual: {entry.actual}</p>
                                )}
                                {entry.projected > 0 && (
                                  <p className="text-[10px] text-[#8FB5D9] font-mono">Projected: {entry.projected}</p>
                                )}
                                <p className="text-[9px] text-[#606060] font-mono mt-0.5">
                                  Source: Editorial Operating Model
                                </p>
                              </>
                            ),
                          });
                        }}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        {/* Projected (top portion) — pod color at 35% */}
                        {projectedPct > 0 && (
                          <div
                            className="w-full rounded-t-sm animate-bar-grow"
                            style={{
                              height: actualPct > 0 ? `${(projectedPct / (actualPct + projectedPct)) * 100}%` : "100%",
                              backgroundColor: "#42CA80",
                              opacity: 0.35,
                              animationDelay: `${idx * 20}ms`,
                            }}
                          />
                        )}
                        {/* Actual (bottom portion) — solid */}
                        {actualPct > 0 && (
                          <div
                            className={cn(
                              "w-full animate-bar-grow",
                              projectedPct === 0 && "rounded-t-sm",
                            )}
                            style={{
                              height: projectedPct > 0 ? `${(actualPct / (actualPct + projectedPct)) * 100}%` : "100%",
                              backgroundColor: "#42CA80",
                              opacity: 0.9,
                              animationDelay: `${idx * 20}ms`,
                            }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Totals sidebar — aggregate across every client in the view */}
              <div className="w-[260px] shrink-0 pl-3 border-l border-[#2a2a2a] grid grid-cols-4 gap-1 items-end">
                <TotalsCell value={agg.projected} />
                <TotalsCell value={agg.delivered} />
                <TotalsCell value={agg.sow} muted />
                <TotalsCell
                  value={agg.reconciliation}
                  color={
                    agg.reconciliation < 0
                      ? "#ED6958"
                      : agg.reconciliation > 0
                      ? "#42CA80"
                      : undefined
                  }
                />
              </div>
            </div>
            {/* Period labels — aligned to the same flex grid as the bars */}
            <div
              key={`labels-${cumView}`}
              className="flex items-center gap-2 mt-0.5 animate-fade-slide"
              style={{ paddingRight: "var(--scrollbar-gutter)" }}
            >
              <span className="w-32 shrink-0" />
              <div className="flex-1 flex gap-px">
                {activePeriods.map((p, i) => {
                  const isCurrent = cumView === "quarterly"
                    ? p.key === currentQuarterKey
                    : p.key === currentMonthKey;
                  const showLabel = cumView === "quarterly" || i % 2 === 0;
                  return (
                    <div key={p.key} className={cn(
                      "flex-1 text-center",
                      isCurrent && "bg-[#42CA80]/14 border-x border-[#42CA80]/50",
                    )}>
                      {showLabel && (
                        <span className={cn(
                          "text-[7px] font-mono",
                          isCurrent ? "text-[#65FFAA] font-semibold" : "text-[#606060]",
                        )}>
                          {p.label}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Mirror the totals sidebar width so labels don't drift */}
              <div className="w-[260px] shrink-0 pl-3 grid grid-cols-4 gap-1">
                <TotalsHeader label="Projected" hint="Sum of articles_projected across every active client." />
                <TotalsHeader label="Delivered" hint="Sum of articles_actual across every active client." />
                <TotalsHeader label="SOW" hint="Sum of contracted articles_sow across every active client." />
                <TotalsHeader label="Reconcile" hint="sow − delivered − projected across every active client." />
              </div>
            </div>
            <div className="border-b border-[#2a2a2a] mt-2 mb-3" />
          </div>
          );
        })()}

        {/* Per-client section title */}
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="text-[10px] font-mono font-semibold uppercase tracking-widest text-[#C4BCAA]">
              Client Article Cadence
              {" "}
              <DataSourceBadge
                type="live"
                source="Sheet: 'Editorial Operating Model' — Spreadsheet: Editorial Capacity Planning. Per-month actual and projected article production per client; solid bar = actual, striped bar = projected."
              />
            </p>
            <p className="text-[8px] font-mono text-[#606060] mt-0.5">
              Per-client monthly output from the Operating Model. Solid = actual, striped = projected. Current month is highlighted.
            </p>
          </div>
        </div>

        {/* Row layout: [client name 128px] [chart area flex-1] [totals sidebar 240px] */}
        {/* Shared period axis — adapts to monthly/quarterly. Gridline-dashes
            on the left edge of labeled cells visually extend through the
            client rows below, so every bar reads clearly against a month. */}
        <div
          key={`axis-${cumView}`}
          className="flex items-stretch gap-2 mb-2 animate-fade-slide"
          style={{ paddingRight: "var(--scrollbar-gutter)" }}
        >
          <span className="w-32 shrink-0" />
          <div className="flex-1 flex gap-px">
            {activePeriods.map((p, i) => {
              const showLabel = cumView === "quarterly" || i % 2 === 0;
              const isCurrent = cumView === "quarterly"
                ? p.key === currentQuarterKey
                : p.key === currentMonthKey;
              return (
                <div
                  key={p.key}
                  className={cn(
                    "flex-1 text-center py-0.5",
                    showLabel && !isCurrent && "border-l border-[#2a2a2a]",
                    isCurrent && "bg-[#42CA80]/14 border-x border-[#42CA80]/50",
                  )}
                >
                  {showLabel && (
                    <span className={cn(
                      "text-[8px] font-mono",
                      isCurrent ? "text-[#65FFAA] font-semibold" : "text-[#606060]",
                    )}>
                      {p.label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {/* Totals column header */}
          <div className="w-[260px] shrink-0 pl-3 border-l border-[#2a2a2a] grid grid-cols-4 gap-1">
            <TotalsHeader label="Projected" hint="Sum of articles_projected from the Editorial Operating Model — planned output still in front of us." />
            <TotalsHeader label="Delivered" hint="Sum of articles_actual from the Operating Model (falls back to Client.articles_delivered if no rows)." />
            <TotalsHeader label="SOW" hint="Client.articles_sow — contracted article total." />
            <TotalsHeader label="Reconcile" hint="sow − delivered − projected. Negative = pod is over-committed to this client." />
          </div>
        </div>

        {/* Reserve a stable vertical-scrollbar gutter so its width is always
            claimed, whether or not the list is currently scrollable. Without
            this the flex bars inside per-client rows shrink by ~13px when
            the scrollbar appears, shifting every column left relative to
            the top chart + axis row. */}
        <div
          key={`view-opmodel-${cumView}`}
          className="max-h-[320px] overflow-y-scroll space-y-1"
          style={{ scrollbarGutter: "stable" }}
        >
          {activeClients.map((client, clientIdx) => {
            const podColor = TIMELINE_POD_COLORS[client.editorial_pod ?? ""] ?? "#606060";
            const prod = productionByClient.get(client.name);
            const totals = prod?.totals;

            // Group operating model rows into the active period (monthly or quarterly).
            const perPeriod = new Map<string, { actual: number; projected: number }>();
            (prod?.monthly ?? []).forEach(({ year, month, actual, projected }) => {
              // month is 1-indexed coming from the API
              const key = cumView === "quarterly"
                ? `${year}-Q${Math.ceil(month / 3)}`
                : `${year}-${String(month).padStart(2, "0")}`;
              const cell = perPeriod.get(key) ?? { actual: 0, projected: 0 };
              cell.actual += actual;
              cell.projected += projected;
              perPeriod.set(key, cell);
            });
            const clientMax = Math.max(
              1,
              ...Array.from(perPeriod.values()).map((v) => v.actual + v.projected),
            );

            return (
              <div
                key={client.id}
                className="flex items-center gap-2 h-7 animate-fade-slide"
                style={{ animationDelay: `${clientIdx * 30}ms` }}
              >
                <span className="w-32 shrink-0 truncate text-xs text-[#C4BCAA] font-mono">
                  {client.name.length > 15 ? client.name.slice(0, 15) + "\u2026" : client.name}
                </span>

                {/* Chart cells — actual (solid) + projected (striped) per period */}
                <div className="flex-1 flex items-end gap-px" style={{ height: 20 }}>
                  {activePeriods.map((p, i) => {
                    const cell = perPeriod.get(p.key);
                    const actual = cell?.actual ?? 0;
                    const projected = cell?.projected ?? 0;
                    const total = actual + projected;
                    const isCurrent = cumView === "quarterly"
                      ? p.key === currentQuarterKey
                      : p.key === currentMonthKey;
                    // Draw a gridline on the left edge of cells that carry
                    // a month label in the axis row above — matches the
                    // axis's every-other-month dashing so the reader can
                    // trace a label straight down to its bar.
                    const hasGridline = (cumView === "quarterly" || i % 2 === 0) && !isCurrent;
                    if (total <= 0) {
                      return (
                        <div
                          key={p.key}
                          className={cn(
                            "flex-1",
                            hasGridline && "border-l border-[#1a1a1a]",
                            isCurrent && "bg-[#42CA80]/14 border-x border-[#42CA80]/50",
                          )}
                          style={{ height: "100%" }}
                        />
                      );
                    }
                    const heightPct = Math.max(20, (total / clientMax) * 100);
                    const actualFrac = total > 0 ? actual / total : 0;
                    const projectedFrac = 1 - actualFrac;
                    return (
                      <div
                        key={p.key}
                        className={cn(
                          "flex-1 flex items-end justify-center",
                          hasGridline && "border-l border-[#1a1a1a]",
                          isCurrent && "bg-[#42CA80]/14 border-x border-[#42CA80]/50",
                        )}
                        style={{ height: "100%" }}
                      >
                        <div
                          className="relative w-full flex flex-col justify-end cursor-default"
                          style={{ height: `${heightPct}%`, minHeight: 4 }}
                          onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setTooltip({
                              x: rect.left + rect.width / 2,
                              y: rect.bottom + 6,
                              content: (
                                <>
                                  <p className="text-[10px] font-semibold text-white">{client.name}</p>
                                  <p className="text-[9px] text-[#42CA80] font-mono">{p.label}</p>
                                  {actual > 0 && (
                                    <p className="text-[10px] text-[#42CA80] font-mono">Actual: {actual}</p>
                                  )}
                                  {projected > 0 && (
                                    <p className="text-[10px] text-[#8FB5D9] font-mono">Projected: {projected}</p>
                                  )}
                                </>
                              ),
                            });
                          }}
                          onMouseLeave={() => setTooltip(null)}
                        >
                          {/* Projected (on top) — pod color at 35% opacity */}
                          {projectedFrac > 0 && (
                            <div
                              className="w-full rounded-t-sm"
                              style={{
                                height: `${projectedFrac * 100}%`,
                                backgroundColor: podColor,
                                opacity: 0.35,
                              }}
                            />
                          )}
                          {/* Actual (on bottom) — pod color solid */}
                          {actualFrac > 0 && (
                            <div
                              className={cn("w-full", projectedFrac === 0 && "rounded-t-sm")}
                              style={{
                                height: `${actualFrac * 100}%`,
                                backgroundColor: podColor,
                                opacity: 0.9,
                              }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Totals sidebar */}
                <div className="w-[260px] shrink-0 pl-3 border-l border-[#2a2a2a] grid grid-cols-4 gap-1 items-center">
                  <TotalsCell value={totals?.projected} />
                  <TotalsCell value={totals?.delivered} />
                  <TotalsCell value={totals?.sow} muted />
                  <TotalsCell
                    value={totals?.reconciliation}
                    color={
                      totals && totals.reconciliation < 0
                        ? "#ED6958"
                        : totals && totals.reconciliation > 0
                        ? "#42CA80"
                        : undefined
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-3 pt-3 border-t border-[#2a2a2a]">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-sm bg-[#42CA80]" style={{ opacity: 0.9 }} />
            <span className="text-[10px] font-mono text-[#606060]">Actual — solid (pod color)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-sm bg-[#42CA80]" style={{ opacity: 0.35 }} />
            <span className="text-[10px] font-mono text-[#606060]">Projected — lighter shade</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-sm bg-[#42CA80]/14 border-x border-[#42CA80]/50" />
            <span className="text-[10px] font-mono text-[#606060]">Current month column</span>
          </div>
          <span className="text-[#333]">·</span>
          {Object.entries(TIMELINE_POD_COLORS).map(([pod, color]) => (
            <div key={pod} className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color, opacity: 0.85 }} />
              <span className="text-[10px] font-mono text-[#606060]">{pod}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Fixed-position tooltip rendered outside all overflow containers */}
      {tooltip && (
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: "translateX(-50%)",
          }}
        >
          <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-md px-3 py-2 shadow-xl whitespace-nowrap">
            {tooltip.content}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1: Contract & Timeline
// ---------------------------------------------------------------------------

function ContractTimelineTab({
  clients,
  clientProduction,
}: {
  clients: Client[];
  clientProduction: ClientProductionRow[];
}) {
  const { sorted, toggleSort, getSortIcon } = useSortableData(clients);

  return (
    <div className="mt-3 space-y-5">
      {/* Time-to Metrics */}
      <TimeToMetrics clients={clients} />

      {/* Client Engagement Timeline */}
      <ClientEngagementTimeline clients={clients} clientProduction={clientProduction} />

      {/* Detail table */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
          Contract &amp; Timeline Detail <DataSourceBadge type="live" source="Sheet: 'Editorial SOW overview' — Spreadsheet: Editorial Capacity Planning. Milestone dates are visualized in the Time-to Metrics cards above." />
        </h3>
        <a
          href="https://docs.google.com/spreadsheets/d/1I6fNQMjs2y4l6IyOxd9QL-QBjB2zGi0mcoV840JDmkI/edit#gid=0"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-[#2a2a2a] bg-[#161616] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA] hover:border-[#42CA80]/40 hover:text-[#42CA80] transition-colors"
        >
          Open source sheet
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] table-scroll">
        <Table>
          <TableHeader>
            <TableRow className="border-[#2a2a2a] hover:bg-transparent">
              <SortableHead<Client> label="Client" field="name" toggle={toggleSort} icon={getSortIcon} />
              <SortableHead<Client> label="Status" field="status" toggle={toggleSort} icon={getSortIcon} />
              <SortableHead<Client> label="Editorial Pod" field="editorial_pod" toggle={toggleSort} icon={getSortIcon} />
              <SortableHead<Client> label="Growth Pod" field="growth_pod" toggle={toggleSort} icon={getSortIcon} />
              <SortableHead<Client> label="Contract Window" field="start_date" toggle={toggleSort} icon={getSortIcon} />
              <SortableHead<Client> label="Term" field="term_months" toggle={toggleSort} icon={getSortIcon} />
              <SortableHead<Client> label="Articles SOW" field="articles_sow" toggle={toggleSort} icon={getSortIcon} />
              <TableHead className="text-xs text-[#C4BCAA]">Cadence</TableHead>
              <TableHead className="text-xs text-[#C4BCAA]">SOW Link</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-[#606060]">
                  No clients match the selected filters.
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((client) => {
                const words = wordCountDisplay(client.word_count_min, client.word_count_max);
                const cadenceTooltip = [
                  client.cadence ? `Cadence: ${client.cadence}` : null,
                  words !== "\u2014" ? `Word count: ${words}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <TableRow
                    key={client.id}
                    className="border-[#2a2a2a] hover:bg-[#1F1F1F]"
                  >
                    <TableCell className="font-semibold text-white">
                      {client.name}
                    </TableCell>
                    <TableCell>{statusBadge(client.status)}</TableCell>
                    <TableCell>{podBadge(client.editorial_pod)}</TableCell>
                    <TableCell className="text-xs text-[#C4BCAA]">
                      {client.growth_pod ?? "\u2014"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-[#C4BCAA] whitespace-nowrap">
                      {client.start_date || client.end_date ? (
                        <>
                          {formatDate(client.start_date)}
                          <span className="text-[#606060]"> → </span>
                          {formatDate(client.end_date)}
                        </>
                      ) : (
                        "\u2014"
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-[#C4BCAA]">
                      {client.term_months != null
                        ? `${client.term_months}mo`
                        : "\u2014"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-white">
                      {client.articles_sow ?? "\u2014"}
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      {cadenceTooltip ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span className="block truncate font-mono text-[10px] text-[#C4BCAA] cursor-default" />
                              }
                            >
                              {client.cadence ?? words}
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              {cadenceTooltip}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        <span className="text-xs text-[#606060]">{"\u2014"}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {client.sow_link ? (
                        client.sow_link.startsWith("http") ? (
                          <a href={client.sow_link} target="_blank" rel="noopener noreferrer">
                            <Badge variant="outline" className="bg-[#5B9BF5]/10 text-[#5B9BF5] border-[#5B9BF5]/30 text-[10px] cursor-pointer hover:bg-[#5B9BF5]/20 transition-colors">
                              {client.name} SOW ↗
                            </Badge>
                          </a>
                        ) : (
                          <Badge variant="outline" className="bg-[#5B9BF5]/10 text-[#5B9BF5] border-[#5B9BF5]/30 text-[10px]">
                            {client.sow_link}
                          </Badge>
                        )
                      ) : (
                        <span className="text-[#606060]">{"\u2014"}</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: Deliverables vs SOW
// ---------------------------------------------------------------------------

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const dateA = new Date(a);
  const dateB = new Date(b);
  if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) return null;
  const diff = dateB.getTime() - dateA.getTime();
  const days = Math.round(diff / (1000 * 60 * 60 * 24));
  return days >= 0 ? days : null;
}

interface ClientDeliverableSummary {
  id: number;
  name: string;
  status: string;
  editorial_pod: string | null;
  articles_sow: number;
  articles_delivered: number;
  articles_invoiced: number;
  variance: number;
  pct_complete: number;
}

function DeliverablesSOWTab({
  clients,
  deliverables,
  productionTrend,
  pacingData,
}: {
  clients: Client[];
  deliverables: DeliverableMonthly[];
  productionTrend: ProductionTrendPoint[];
  pacingData: ClientPacing[];
}) {
  const pacingMap = useMemo(() => {
    const m = new Map<string, ClientPacing>();
    for (const p of pacingData) m.set(p.client_name, p);
    return m;
  }, [pacingData]);
  const rows: ClientDeliverableSummary[] = useMemo(() => {
    return clients.map((c) => {
      const sow = c.articles_sow ?? 0;
      const delivered = c.articles_delivered ?? 0;
      const invoiced = c.articles_invoiced ?? 0;
      const pct = sow > 0 ? Math.round((delivered / sow) * 100) : 0;

      // Sum variance from deliverables for this client (from sheet)
      const clientDeliverables = deliverables.filter((d) => d.client_id === c.id);
      const totalVariance = clientDeliverables.reduce(
        (acc, d) => acc + (d.variance ?? 0),
        0
      );

      return {
        id: c.id,
        name: c.name,
        status: c.status,
        editorial_pod: c.editorial_pod,
        articles_sow: sow,
        articles_delivered: delivered,
        articles_invoiced: invoiced,
        variance: totalVariance,
        pct_complete: pct,
      };
    });
  }, [clients, deliverables]);

  const { sorted, toggleSort, getSortIcon } =
    useSortableData<ClientDeliverableSummary>(rows);

  const totalSow = rows.reduce((a, r) => a + r.articles_sow, 0);
  const totalDelivered = rows.reduce((a, r) => a + r.articles_delivered, 0);
  const totalInvoiced = rows.reduce((a, r) => a + r.articles_invoiced, 0);
  const overallPct = totalSow > 0 ? Math.round((totalDelivered / totalSow) * 100) : 0;
  const avgPct =
    rows.length > 0
      ? Math.round(rows.reduce((a, r) => a + r.pct_complete, 0) / rows.length)
      : 0;

  return (
    <div className="mt-3 space-y-5">
      {/* Section heading */}
      <div>
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060] mb-1">
          Delivery Overview <DataSourceBadge type="live" source="Sheet: 'Delivered vs Invoiced v2' + 'Editorial SOW overview' — Spreadsheet: Editorial Capacity Planning. Articles delivered, invoiced, balance, and SOW targets." />
        </h3>
        <p className="text-xs text-[#606060] mb-3">
          Monthly article delivery progress against SOW targets, invoicing balance, and pacing status per client.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <SummaryCard
          title="Total Delivered vs SOW"
          value={`${totalDelivered.toLocaleString()} / ${totalSow.toLocaleString()}`}
          valueColor="green"
          progress={overallPct}
          description={`${overallPct}% complete`}
        />
        <SummaryCard title="Total Invoiced" value={totalInvoiced.toLocaleString()} />
        <SummaryCard
          title="Total Variance"
          value={(() => { const v = rows.reduce((a, r) => a + r.variance, 0); return v > 0 ? `+${v.toLocaleString()}` : v.toLocaleString(); })()}
          valueColor={(() => { const v = rows.reduce((a, r) => a + r.variance, 0); return v >= 0 ? "green" : "white"; })()}
          description="From Delivered vs Invoiced sheet"
        />
        <SummaryCard
          title="Avg Completion %"
          value={`${avgPct}%`}
          valueColor={avgPct >= 50 ? "green" : "white"}
        />
      </div>

      {/* Charts side by side on larger screens */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {productionTrend.length > 0 && (
          <ProductionTrendChart data={productionTrend} />
        )}
        <DeliveryTrendChart deliverables={deliverables} clients={clients} />
      </div>
      {/* Per-client cards — same data as the table below, with pacing badge + bars */}
      <ClientDeliveryCards rows={rows} pacingMap={pacingMap} />

      <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
        Client Delivery Detail <DataSourceBadge type="live" source="Sheet: 'Delivered vs Invoiced v2' + 'Editorial SOW overview' — Spreadsheet: Editorial Capacity Planning. Per-client articles delivered, invoiced, CB delivery, pacing, and time-to metrics." />
      </h3>
      <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] table-scroll">
        <Table>
          <TableHeader>
            <TableRow className="border-[#2a2a2a] hover:bg-transparent">
              <SortableHead<ClientDeliverableSummary> label="Client" field="name" toggle={toggleSort} icon={getSortIcon} />
              <SortableHead<ClientDeliverableSummary> label="Status" field="status" toggle={toggleSort} icon={getSortIcon} />
              <SortableHead<ClientDeliverableSummary> label="Articles SOW" field="articles_sow" toggle={toggleSort} icon={getSortIcon} />
              <SortableHead<ClientDeliverableSummary> label="Delivered" field="articles_delivered" toggle={toggleSort} icon={getSortIcon} />
              <SortableHead<ClientDeliverableSummary> label="Invoiced" field="articles_invoiced" toggle={toggleSort} icon={getSortIcon} />
              <SortableHead<ClientDeliverableSummary> label="Variance" field="variance" toggle={toggleSort} icon={getSortIcon} />
              <SortableHead<ClientDeliverableSummary> label="% Complete" field="pct_complete" toggle={toggleSort} icon={getSortIcon} />
              <TableHead className="text-xs text-[#C4BCAA]">Pacing</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-[#606060]">
                  No clients match the selected filters.
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((row, idx) => (
                <TableRow
                  key={row.id}
                  className="border-[#2a2a2a] hover:bg-[#1F1F1F] animate-fade-slide"
                  style={{ animationDelay: `${idx * 30}ms` }}
                >
                  <TableCell className="font-semibold text-white">
                    {row.name}
                  </TableCell>
                  <TableCell>{statusBadge(row.status)}</TableCell>
                  <TableCell className="font-mono text-xs text-white">
                    {row.articles_sow}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-white">
                    {row.articles_delivered}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-white">
                    {row.articles_invoiced}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "font-mono text-xs font-semibold",
                      row.variance > 0
                        ? "text-[#42CA80]"
                        : row.variance < 0
                          ? "text-[#ED6958]"
                          : "text-[#C4BCAA]"
                    )}
                  >
                    {row.variance > 0 ? `+${row.variance}` : row.variance}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-white w-10">
                        {row.pct_complete}%
                      </span>
                      <div className="w-20">
                        <Progress value={row.pct_complete} className="h-1.5" />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {pacingMap.has(row.name) ? (
                      <PacingBadge
                        status={pacingMap.get(row.name)!.status}
                        deltaPct={pacingMap.get(row.name)!.delta_pct}
                      />
                    ) : (
                      <span className="text-[#606060]">{"\u2014"}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// Re-export SortableHead from shared helpers (used by Tab 1 + Deliverables table above)
const SortableHead = SortableHeadShared;

// Old GoalsVsDeliveryTab, CumulativePipelineTab, and SortableHead functions
// have been extracted to standalone components in /components/dashboard/
