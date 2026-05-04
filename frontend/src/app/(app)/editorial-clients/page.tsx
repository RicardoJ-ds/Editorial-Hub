"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { FilterBar, type DateRange } from "@/components/dashboard/FilterBar";
import { SyncControls } from "@/components/layout/SyncControls";
import { TimeToMetrics } from "@/components/dashboard/TimeToMetrics";
import { ProductionTrendChart } from "@/components/charts/ProductionTrendChart";
import { ClientNotesPanel, hasClientNote } from "@/components/dashboard/ClientNotesPanel";
import { DeliveryOverviewCards } from "@/components/dashboard/DeliveryOverviewCards";
import { SectionIndex } from "@/components/dashboard/SectionIndex";
import { ClientDeliveryCards } from "@/components/dashboard/ClientDeliveryCards";
import { GoalsVsDeliverySection } from "@/components/dashboard/GoalsVsDeliverySection";
import { CumulativePipelineSection } from "@/components/dashboard/CumulativePipelineSection";
import { PodGoalsRow } from "@/components/dashboard/ContractClientProgress";
import {
  AsOfBadge,
  SortableHead as SortableHeadShared,
  TooltipBody,
  displayPod,
  elapsedContractPct,
  lastCompletedMonthLabel,
  pacingColor,
} from "@/components/dashboard/shared-helpers";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, parseISODateLocal } from "@/lib/utils";
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

type YM = { y: number; m: number };
const ymIdx = (a: YM) => a.y * 12 + a.m;
const earlierYm = (a: YM, b: YM): YM => (ymIdx(a) <= ymIdx(b) ? a : b);
const laterYm = (a: YM, b: YM): YM => (ymIdx(a) >= ymIdx(b) ? a : b);

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

function podBadge(pod: string | null, kind: "editorial" | "growth" = "editorial") {
  if (!pod) return <span className="text-[#606060]">{"\u2014"}</span>;
  const color = POD_COLORS[pod] ?? "bg-secondary text-secondary-foreground";
  return (
    <Badge variant="outline" className={color}>
      {displayPod(pod, kind)}
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
  const searchParams = useSearchParams();
  const [clients, setClients] = useState<Client[]>([]);
  const [deliverables, setDeliverables] = useState<DeliverableMonthly[]>([]);
  const [filteredClients, setFilteredClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [productionTrend, setProductionTrend] = useState<ProductionTrendPoint[]>([]);
  const [pacingData, setPacingData] = useState<ClientPacing[]>([]);
  const [clientProduction, setClientProduction] = useState<ClientProductionRow[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>({ type: "all" });
  const fetchData = useCallback(async () => {
    try {
      const [clientsData, deliverablesData] = await Promise.all([
        apiGet<Client[]>("/api/clients/?limit=200"),
        apiGet<DeliverableMonthly[]>("/api/deliverables/?limit=1000"),
      ]);
      setClients(clientsData);
      setFilteredClients(clientsData);
      setDeliverables(deliverablesData);
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

  const handleDateRangeChange = useCallback((range: DateRange) => {
    setDateRange(range);
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[#606060]">Loading dashboard...</p>
        <DashboardSkeleton />
      </div>
    );
  }

  // Deep-link friendly tab default — reads `?tab=deliverables-sow` from the
  // URL when present (e.g. on a click from the Overview dashboard); falls
  // back to Contract & Timeline. Hash fragments on the URL keep working via
  // the browser's native hash scroll + each section's scroll-mt offset.
  const initialTab =
    searchParams?.get("tab") === "deliverables-sow"
      ? "deliverables-sow"
      : "contract-timeline";

  return (
    <div className="space-y-4">
      <Tabs defaultValue={initialTab} onValueChange={() => {
        const scroller = document.querySelector('.ml-\\[240px\\]') as HTMLElement | null;
        if (scroller) scroller.scrollTo({ top: 0, behavior: "smooth" });
        else window.scrollTo({ top: 0, behavior: "smooth" });
      }}>
        {/* Sticky: title + filters + sync + tabs.
            min-h matches the h2 sticky top inside sections so the band's
            bg-black butts up against the h2 with no transparent gap. */}
        <div className="sticky top-0 z-20 bg-black pb-3 -mx-8 px-8 pt-3 min-h-[120px]">
          {/* Compact header: title + filters + sync controls in one tight row */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-3">
            <h1 className="font-mono text-sm font-bold uppercase tracking-[0.18em] text-white whitespace-nowrap shrink-0">
              Editorial Clients
            </h1>
            <FilterBar
              clients={clients}
              onFilterChange={handleFilterChange}
              onDateRangeChange={handleDateRangeChange}
            />
            <div className="ml-auto">
              <SyncControls />
            </div>
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
          <div className="flex gap-6">
            <SectionIndex sections={TAB_1_SECTIONS} />
            <div className="flex-1 min-w-0">
              <ContractTimelineTab clients={filteredClients} clientProduction={clientProduction} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="deliverables-sow">
          <div className="flex gap-6">
            <SectionIndex sections={TAB_2_SECTIONS} />
            <div className="flex-1 min-w-0">
              {/* Delivery Overview: summary cards + charts */}
              <div id="delivery-overview" className="scroll-mt-[140px]">
                <DeliverablesSOWTab
                  clients={filteredClients}
                  allClients={clients}
                  deliverables={deliverables}
                  productionTrend={productionTrend}
                  pacingData={pacingData}
                  clientProduction={clientProduction}
                  dateRange={dateRange}
                />
              </div>

              {/* Cumulative Pipeline — portfolio summary, funnel chart, then
                  per-client detail cards grouped by pod. */}
              <section id="cumulative-pipeline" className="mt-12 scroll-mt-[140px]">
            <div className="mb-4 sticky top-[120px] z-10 bg-black flex items-center gap-3 border-b border-[#2a2a2a] pb-2 pt-1">
              <h2 className="font-mono text-base font-bold uppercase tracking-[0.2em] text-white flex items-center gap-2">
                Cumulative Pipeline <DataSourceBadge
                  type="live"
                  source="Sheet: 'Cumulative' — Spreadsheet: Master Tracker. All-time pipeline counts per client. Every stage is expressed as a share of the client's contract SOW."
                  shows={[
                    "All-time funnel: Topics → Content Briefs → Articles → Published.",
                    "Every stage is divided by contract SOW, so the four stages are directly comparable.",
                    "Layout: portfolio totals + approval-progress mix on top, editorial-pod matrix in the middle, per-client detail grouped by editorial pod below.",
                  ]}
                />
              </h2>
              <AsOfBadge label={lastCompletedMonthLabel()} />
              <span className="h-px flex-1 bg-[#2a2a2a]" />
            </div>
            <CumulativePipelineSection filteredClients={filteredClients} />
          </section>

              {/* Monthly Goals vs Delivery — summary cards + pod aggregate +
                  unified month-range table (with expandable weekly breakdown). */}
              <section id="monthly-goals" className="mt-12 scroll-mt-[140px]">
                <div className="mb-4 sticky top-[120px] z-10 bg-black flex items-center gap-3 border-b border-[#2a2a2a] pb-2 pt-1">
                  <h2 className="font-mono text-base font-bold uppercase tracking-[0.2em] text-white flex items-center gap-2">
                    Monthly Goals vs Delivery <DataSourceBadge
                      type="live"
                      source="Sheet: '[Month Year] Goals vs Delivery' (x9 sheets) — Spreadsheet: Master Tracker. Goals and delivery tracked per client per week across every month of the active date range."
                      shows={[
                        "Progress toward each client's monthly CB and Article goals, aggregated over the active date range.",
                        "Summary cards roll up the whole range; toggle CBs / Articles on the table to flip metrics.",
                        "Each month column shows delivered/goal. Click a month header to expand its weekly breakdown (one month at a time).",
                        "Respects the page filters above: Editorial Pod, Growth Pod, Status, Date Range.",
                      ]}
                    />
                  </h2>
                  <span className="h-px flex-1 bg-[#2a2a2a]" />
                </div>
                <GoalsVsDeliverySection
                  filteredClients={filteredClients}
                  dateRange={dateRange}
                  beforeClientCards={
                    <PodGoalsRow filteredClients={filteredClients} dateRange={dateRange} />
                  }
                />
              </section>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

const TAB_1_SECTIONS = [
  { id: "time-to-metrics", label: "Time-to Metrics" },
  { id: "contract-timeline", label: "Contract & Timeline" },
];

const TAB_2_SECTIONS = [
  { id: "delivery-overview", label: "Delivery Overview" },
  { id: "cumulative-pipeline", label: "Cumulative Pipeline" },
  { id: "monthly-goals", label: "Monthly Goals vs Delivery" },
];

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

function TotalsHeader({
  label,
  title,
  bullets,
}: {
  label: string;
  title: string;
  bullets: React.ReactNode[];
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060] text-center cursor-help underline decoration-dotted decoration-[#404040] underline-offset-2 block" />
          }
        >
          {label}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
          <TooltipBody title={title} bullets={bullets} />
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
      <span className="block font-mono text-[11px] text-[#404040] text-center tabular-nums">—</span>
    );
  }
  // Signed display only when a color signals a signed metric (reconciliation).
  const signed = !!color;
  return (
    <span
      className="block font-mono text-[11px] text-center tabular-nums"
      style={{ color: color ?? (muted ? "#606060" : "#C4BCAA") }}
    >
      {signed && value > 0 ? "+" : ""}
      {value.toLocaleString()}
    </span>
  );
}

function TotalsPercentCell({
  delivered,
  sow,
  elapsedPct = null,
}: {
  delivered: number | undefined;
  sow: number | undefined;
  /** Elapsed contract % — when provided, color is pacing-aware so a brand-
   *  new client doesn't read red just for being early. Lifetime % vs SOW
   *  is otherwise penalized by the pure 75/50 thresholds. */
  elapsedPct?: number | null;
}) {
  if (sow == null || sow <= 0 || delivered == null) {
    return (
      <span className="block font-mono text-[11px] text-[#404040] text-center tabular-nums">—</span>
    );
  }
  const pct = Math.round((delivered / sow) * 100);
  const color = pacingColor(pct, elapsedPct);
  return (
    <span
      className="block font-mono text-[11px] font-semibold text-center tabular-nums"
      style={{ color }}
    >
      {pct}%
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
  // Lookup per-client production rows (from ProductionHistory / Editorial Operating Model)
  const productionByClient = useMemo(() => {
    const map = new Map<string, ClientProductionRow>();
    for (const row of clientProduction) map.set(row.client_name, row);
    return map;
  }, [clientProduction]);
  const [tooltip, setTooltip] = useState<TimelineTooltip | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Uses whatever clients are passed in (already filtered by FilterBar).
  // Alphabetical ordering matches the per-client cards on the Deliverables
  // tab so the whole dashboard reads consistently.
  const activeClients = useMemo(() => {
    return clients
      .filter((c) => c.start_date)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients]);

  // Highlight the "current" column based on the Operating Model's own data —
  // specifically the most recent month that still carries an actual > 0 for
  // at least one filtered client. This matches the chart's data source
  // (not the browser clock): mid-month, the sheet still reads the previous
  // month as the latest "actual", and we should honor that. Falls back to
  // calendar-now if nothing in scope has actuals.
  const { currentMonthKey, currentQuarterKey } = useMemo(() => {
    let bestYear = 0;
    let bestMonth = 0;
    for (const c of activeClients) {
      const prod = productionByClient.get(c.name);
      if (!prod) continue;
      for (const { year, month, actual } of prod.monthly) {
        if (!actual || actual <= 0) continue;
        if (year > bestYear || (year === bestYear && month > bestMonth)) {
          bestYear = year;
          bestMonth = month;
        }
      }
    }
    if (bestYear === 0) {
      const d = new Date();
      bestYear = d.getFullYear();
      bestMonth = d.getMonth() + 1;
    }
    return {
      currentMonthKey: `${bestYear}-${String(bestMonth).padStart(2, "0")}`,
      currentQuarterKey: `${bestYear}-Q${Math.ceil(bestMonth / 3)}`,
    };
  }, [activeClients, productionByClient]);

  // Calculate the overall date range from all active clients
  const { minDate, maxDate, monthLabels } = useMemo(() => {
    if (activeClients.length === 0) {
      return { minDate: new Date(), maxDate: new Date(), monthLabels: [] };
    }

    const dates = activeClients.flatMap((c) => {
      const result: Date[] = [];
      const s = parseISODateLocal(c.start_date);
      const e = parseISODateLocal(c.end_date);
      if (s) result.push(s);
      if (e) result.push(e);
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

  // Build quarterly timeline periods for per-client view
  const timelineQuarters = useMemo(() => {
    const quarters: { key: string; label: string; monthKeys: string[] }[] = [];
    const seen = new Set<string>();
    timelineMonths.forEach((tm) => {
      // tm.month is 1-indexed; ceil gives Jan-Mar=Q1, Oct-Dec=Q4
      const q = Math.ceil(tm.month / 3);
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


  if (activeClients.length === 0) return null;

  // Friendly "as of <Month Year>" label derived from the highlighted column
  // (last month with actual data in the Operating Model), so readers know
  // exactly what the right-side totals reflect.
  const asOfLabel = (() => {
    const [y, m] = currentMonthKey.split("-").map(Number);
    const d = new Date(y, (m ?? 1) - 1, 1);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  })();

  return (
    <div>
      <div className="flex items-start justify-between mb-3 gap-4">
        <div>
          <h3 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
            Client Engagement Timeline <DataSourceBadge
              type="live"
              source="Sheet: 'Editorial Operating Model' + 'Editorial SOW overview' — Spreadsheet: Editorial Capacity Planning. Per-month actual and projected article production per client; solid bar = actual, lighter shade = projected. Totals sidebar joins SOW with ProductionHistory (operating model)."
              shows={[
                "One row per client, month-by-month article output.",
                "Solid bars = actually shipped. Lighter shade = still projected.",
                "Highlighted column = the latest month with actual data in the Operating Model; totals on the right reflect everything through that month.",
                "Right sidebar: per-client Projected / Delivered / SOW totals plus % of SOW shipped so far.",
              ]}
            />
          </h3>
        </div>
      </div>
      <div
        className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-4"
        style={{ ["--scrollbar-gutter" as never]: "13px" }}
      >

        {/* Top row: "As of …" caption (left) + period toggle (right). */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex flex-wrap items-center gap-2">
            <AsOfBadge label={asOfLabel} />
            <p className="font-mono text-[11px] text-[#606060]">
              latest month with actual output in the Operating Model.
            </p>
          </div>
          <div className="flex gap-1 bg-[#0d0d0d] rounded-md p-0.5 border border-[#2a2a2a] shrink-0">
            <button
              onClick={() => setCumView("monthly")}
              className={cn(
                "px-2.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider transition-colors",
                cumView === "monthly"
                  ? "bg-[#42CA80]/15 text-[#42CA80]"
                  : "text-[#606060] hover:text-white",
              )}
            >
              Monthly
            </button>
            <button
              onClick={() => setCumView("quarterly")}
              className={cn(
                "px-2.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider transition-colors",
                cumView === "quarterly"
                  ? "bg-[#42CA80]/15 text-[#42CA80]"
                  : "text-[#606060] hover:text-white",
              )}
            >
              Quarterly
            </button>
          </div>
        </div>

        {/* Row layout: [client name 128px] [chart area flex-1] [totals sidebar 240px] */}
        {/* Shared period axis — adapts to monthly/quarterly. Gridline-dashes
            on the left edge of labeled cells visually extend through the
            client rows below, so every bar reads clearly against a month. */}
        <div
          key={`axis-${cumView}`}
          className="flex items-end gap-2 mb-3 animate-fade-slide"
          style={{ paddingRight: "var(--scrollbar-gutter)" }}
        >
          <span className="w-32 shrink-0" />
          <div className="flex-1 flex items-end gap-px">
            {activePeriods.map((p) => {
              const isCurrent = cumView === "quarterly"
                ? p.key === currentQuarterKey
                : p.key === currentMonthKey;
              // Split monthly labels ("Feb 25") into a two-line stack so the
              // month abbreviation and the 2-digit year each sit on their own
              // line — that way every column fits a readable, non-rotated
              // label even when the timeline is 24+ months wide.
              const [monthShort, yearShort] =
                cumView === "monthly"
                  ? (p.label.split(" ") as [string, string | undefined])
                  : [p.label, undefined];
              return (
                <div
                  key={p.key}
                  className={cn(
                    "flex-1 text-center py-0.5",
                    !isCurrent && "border-l border-[#2a2a2a]",
                    isCurrent && "bg-[#42CA80]/14 border-x border-[#42CA80]/50",
                  )}
                >
                  <span
                    className={cn(
                      "flex flex-col items-center leading-tight font-mono text-[10px]",
                      isCurrent ? "text-[#65FFAA] font-semibold" : "text-[#909090]",
                    )}
                  >
                    <span>{monthShort}</span>
                    {yearShort && <span>{yearShort}</span>}
                  </span>
                </div>
              );
            })}
          </div>
          {/* Totals column header — bottom-aligned so it sits just above the first data row */}
          <div className="w-[260px] shrink-0 pl-3 border-l border-[#2a2a2a] grid grid-cols-4 gap-1 items-end self-end pb-0.5">
            <TotalsHeader
              label="Projected"
              title="Projected"
              bullets={[
                "Planned output still in front of us",
                "Source: Editorial Operating Model · articles_projected",
              ]}
            />
            <TotalsHeader
              label="Delivered"
              title="Delivered"
              bullets={[
                "Articles already shipped to the client",
                "Source: Editorial Operating Model · articles_actual",
                "Falls back to Client.articles_delivered if no rows",
              ]}
            />
            <TotalsHeader
              label="SOW"
              title="SOW"
              bullets={[
                "Contracted article total for this engagement",
                "Source: Client.articles_sow",
              ]}
            />
            <TotalsHeader
              label="% SOW"
              title="% SOW"
              bullets={[
                "Contract completion so far",
                "Delivered ÷ SOW",
                "Color: green ≥75%, yellow ≥50%, red below",
              ]}
            />
          </div>
        </div>

        {/* Reserve a stable vertical-scrollbar gutter so its width is always
            claimed, whether or not the list is currently scrollable. Without
            this the flex bars inside per-client rows shrink by ~13px when
            the scrollbar appears, shifting every column left relative to
            the top chart + axis row. */}
        <div
          key={`view-opmodel-${cumView}`}
          className="max-h-[320px] overflow-y-scroll space-y-2 pt-4"
          style={{ scrollbarGutter: "stable" }}
        >
          {activeClients.map((client, idx) => {
            const podColor = TIMELINE_POD_COLORS[client.editorial_pod ?? ""] ?? "#606060";
            const prod = productionByClient.get(client.name);
            const totals = prod?.totals ?? null;
            const perMonth = prod?.monthly ?? [];
            const fullName = client.name;
            const shortName = client.name.length > 15 ? client.name.slice(0, 15) + "\u2026" : client.name;

            // Group operating model rows into the active period (monthly or quarterly).
            const perPeriod = new Map<string, { actual: number; projected: number }>();
            perMonth.forEach(({ year, month, actual, projected }) => {
              const key = cumView === "quarterly"
                ? `${year}-Q${Math.ceil(month / 3)}`
                : `${year}-${String(month).padStart(2, "0")}`;
              const cell = perPeriod.get(key) ?? { actual: 0, projected: 0 };
              cell.actual += actual;
              cell.projected += projected;
              perPeriod.set(key, cell);
            });
            const rowMax = Math.max(
              1,
              ...Array.from(perPeriod.values()).map((v) => v.actual + v.projected),
            );

            return (
              <div
                key={client.id}
                className="flex items-center gap-2 h-11 animate-fade-slide"
                style={{ animationDelay: `${idx * 30}ms` }}
              >
                <span
                  className="w-32 shrink-0 truncate text-xs font-mono text-[#C4BCAA]"
                  title={fullName}
                >
                  {shortName}
                </span>

                {/* Chart cells — actual (solid) + projected (striped) per period */}
                <div className="flex-1 flex items-end gap-px" style={{ height: 32 }}>
                  {activePeriods.map((p, i) => {
                    const cell = perPeriod.get(p.key);
                    const actual = cell?.actual ?? 0;
                    const projected = cell?.projected ?? 0;
                    const total = actual + projected;
                    const isCurrent = cumView === "quarterly"
                      ? p.key === currentQuarterKey
                      : p.key === currentMonthKey;
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
                    const heightPct = Math.max(20, (total / rowMax) * 100);
                    const actualFrac = total > 0 ? actual / total : 0;
                    const projectedFrac = 1 - actualFrac;
                    return (
                      <div
                        key={p.key}
                        className={cn(
                          "flex-1 flex items-end justify-center relative",
                          hasGridline && "border-l border-[#1a1a1a]",
                          isCurrent && "bg-[#42CA80]/14 border-x border-[#42CA80]/50",
                        )}
                        style={{ height: "100%" }}
                      >
                        {/* Value label above bar */}
                        <span
                          className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-[calc(100%+1px)] font-mono text-[9px] tabular-nums pointer-events-none"
                          style={{ color: isCurrent ? "#65FFAA" : "#909090" }}
                        >
                          {total}
                        </span>
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
                                  <p className="text-[11px] font-semibold text-white">{fullName}</p>
                                  <p className="text-[10px] text-[#42CA80] font-mono">{p.label}</p>
                                  {actual > 0 && (
                                    <p className="text-[11px] text-[#42CA80] font-mono">Actual: {actual}</p>
                                  )}
                                  {projected > 0 && (
                                    <p className="text-[11px] text-[#8FB5D9] font-mono">Projected: {projected}</p>
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

                {/* Totals sidebar — Reconcile column intentionally removed.
                    For most clients projected + delivered already sums to
                    SOW (% SOW + Delivered + Projected tells the story); a
                    fifth column showing the residual was mostly noise. The
                    handful of cases where the math doesn't reconcile are
                    sheet-data issues (over-delivered SOWs not updated on
                    Editorial SOW overview) and need fixing at the source,
                    not surfacing as a chart column. */}
                <div className="w-[260px] shrink-0 pl-3 border-l border-[#2a2a2a] grid grid-cols-4 gap-1 items-center">
                  <TotalsCell value={totals?.projected} />
                  <TotalsCell value={totals?.delivered} />
                  <TotalsCell value={totals?.sow} muted />
                  <TotalsPercentCell
                    delivered={totals?.delivered}
                    sow={totals?.sow}
                    elapsedPct={elapsedContractPct(client.start_date, {
                      endDate: client.end_date,
                      termMonths: client.term_months,
                    })}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Pod color legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-3 border-t border-[#2a2a2a]">
          {Object.entries(TIMELINE_POD_COLORS).map(([pod, color]) => (
            <div key={pod} className="flex items-center gap-1.5">
              <div
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: color, opacity: 0.85 }}
              />
              <span className="text-[11px] font-mono text-[#606060]">
                {displayPod(pod, "editorial")}
              </span>
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
    <div className="mt-3 space-y-12">
      {/* Time-to Metrics */}
      <div id="time-to-metrics" className="scroll-mt-[140px]">
        <TimeToMetrics clients={clients} />
      </div>

      {/* Contract & Timeline — parent section that groups the engagement
          timeline and the detail table as two children. */}
      <section id="contract-timeline" className="scroll-mt-[140px]">
        <div className="mb-4 sticky top-[120px] z-10 bg-black flex items-center gap-3 border-b border-[#2a2a2a] pb-2 pt-1">
          <h2 className="font-mono text-base font-bold uppercase tracking-[0.2em] text-white">
            Contract &amp; Timeline
          </h2>
          <span className="h-px flex-1 bg-[#2a2a2a]" />
        </div>
        <div className="space-y-8">
          {/* Client Engagement Timeline */}
          <ClientEngagementTimeline clients={clients} clientProduction={clientProduction} />

          {/* Detail table */}
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
                Contract &amp; Timeline Detail <DataSourceBadge
                  type="live"
                  source="Sheet: 'Editorial SOW overview' — Spreadsheet: Editorial Capacity Planning. Milestone dates are visualized in the Time-to Metrics cards above."
                  shows={[
                    "Flat table of every filtered client — contract dates, pod, status, SOW, milestone dates.",
                    "Same raw values that feed the Time-to Metrics cards above.",
                    "Use it to look up a specific client or spot-check a sheet value.",
                  ]}
                />
              </h3>
              <a
                href="https://docs.google.com/spreadsheets/d/1dtZIiTKPEkhc0qrlWdlvd-n8qAn5-lhVcPkgHNgoLAY/edit#gid=1646003860"
                target="_blank"
                rel="noopener noreferrer"
                title="Open the 'v2 Editorial SOW & Engagement info' tab of the Master Tracker in Google Sheets"
                className="group inline-flex items-center gap-2 rounded-md border border-[#42CA80]/30 bg-[#42CA80]/10 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#42CA80] hover:bg-[#42CA80]/20 hover:border-[#42CA80]/50 hover:text-[#65FFAA] transition-colors"
              >
                Open source sheet
                <ExternalLink className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
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
              <SortableHead<Client> label="Start Date" field="start_date" toggle={toggleSort} icon={getSortIcon} />
              <SortableHead<Client> label="End Date" field="end_date" toggle={toggleSort} icon={getSortIcon} />
              <SortableHead<Client> label="Term" field="term_months" toggle={toggleSort} icon={getSortIcon} />
              <SortableHead<Client> label="Articles SOW" field="articles_sow" toggle={toggleSort} icon={getSortIcon} />
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
                return (
                  <TableRow
                    key={client.id}
                    className="border-[#2a2a2a] hover:bg-[#1F1F1F]"
                  >
                    <TableCell className="font-semibold text-white">
                      {client.name}
                    </TableCell>
                    <TableCell>{statusBadge(client.status)}</TableCell>
                    <TableCell>{podBadge(client.editorial_pod, "editorial")}</TableCell>
                    <TableCell>{podBadge(client.growth_pod, "growth")}</TableCell>
                    <TableCell className="font-mono text-xs text-[#C4BCAA] whitespace-nowrap">
                      {formatDate(client.start_date)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-[#C4BCAA] whitespace-nowrap">
                      {formatDate(client.end_date)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-[#C4BCAA]">
                      {client.term_months != null
                        ? `${client.term_months}mo`
                        : "\u2014"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-white">
                      {client.articles_sow ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {client.sow_link ? (
                        client.sow_link.startsWith("http") ? (
                          <a href={client.sow_link} target="_blank" rel="noopener noreferrer">
                            <Badge variant="outline" className="bg-[#5B9BF5]/10 text-[#5B9BF5] border-[#5B9BF5]/30 text-[11px] cursor-pointer hover:bg-[#5B9BF5]/20 transition-colors">
                              {client.name} SOW ↗
                            </Badge>
                          </a>
                        ) : (
                          <Badge variant="outline" className="bg-[#5B9BF5]/10 text-[#5B9BF5] border-[#5B9BF5]/30 text-[11px]">
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
        </div>
      </section>
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
  /**
   * In-period variance: delivered(scope) − invoiced(scope). "Within this
   * window, did we ship more than we billed?" Replaces the old sum-of-
   * monthly-variance which was arithmetically wrong (summing running totals).
   */
  variance: number;
  /**
   * Cumulative variance through the end of the scope: the sheet's Variance
   * formula applied at the last month of the filter range. When no filter
   * is active, equals lifetime delivered − lifetime invoiced from the SOW
   * sheet's Client row. "Overall, does delivery lead or trail billing?"
   */
  variance_cumulative: number;
  pct_complete: number;
  start_date?: string | null;
  term_months?: number | null;
  /** Per-month breakdown of the rows that contributed to the card totals (for the hover popover). */
  monthly_breakdown?: Array<{
    year: number;
    month: number;
    delivered: number;
    invoiced: number;
    variance: number;
  }>;
}

function DeliverablesSOWTab({
  clients,
  allClients,
  deliverables,
  productionTrend,
  pacingData,
  clientProduction,
  dateRange,
}: {
  /** Filtered set from the FilterBar — what the page should display. */
  clients: Client[];
  /** Full client list — used by DeliveryOverviewCards to show "X of Y" framing. */
  allClients: Client[];
  deliverables: DeliverableMonthly[];
  productionTrend: ProductionTrendPoint[];
  pacingData: ClientPacing[];
  clientProduction: ClientProductionRow[];
  dateRange: DateRange;
}) {
  // Trim deliverables to the FilterBar selection (client set + date range).
  // FilterBar emits a filtered `clients` array — anything not in that set
  // is hidden by contract (status, pod, search, engagement overlap).
  const filteredDeliverables = useMemo(() => {
    const clientIds = new Set(clients.map((c) => c.id));
    const inRange = (y: number, m: number) => {
      if (dateRange.type !== "range" || !dateRange.from) return true;
      const cell = new Date(y, m - 1, 1);
      const from = new Date(
        dateRange.from.getFullYear(),
        dateRange.from.getMonth(),
        1
      );
      const toSrc = dateRange.to ?? dateRange.from;
      // End-of-month for the "to" boundary so the selected month is included
      const to = new Date(toSrc.getFullYear(), toSrc.getMonth() + 1, 0);
      return cell >= from && cell <= to;
    };
    return deliverables.filter(
      (d) => clientIds.has(d.client_id) && inRange(d.year, d.month)
    );
  }, [deliverables, clients, dateRange]);
  const pacingMap = useMemo(() => {
    const m = new Map<string, ClientPacing>();
    for (const p of pacingData) m.set(p.client_name, p);
    return m;
  }, [pacingData]);
  // Invoicing is quarterly on the sheet and the sheet's quarters are
  // CONTRACT-relative (M1–M3 = Q1, M4–M6 = Q2, …), anchored to each
  // client's start_date. A filter of Jan–Mar 2026 for a client whose
  // contract started in Dec 2025 therefore touches contract Q1
  // (Dec/Jan/Feb) AND contract Q2 (Mar/Apr/May). To make the card
  // numbers match the sheet's Q rollups, we expand the per-client scope
  // to include every month of every contract-Q touched by the filter —
  // independently per client because each one has its own Q boundaries.
  //
  // SOW stays lifetime from the SOW sheet.
  // Period variance = delivered(expanded scope) − invoiced(expanded scope).
  // Cumulative variance = Σ delivered − Σ invoiced through the last
  // expanded month (matches the sheet's Variance formula at that cell).
  // Lifetime fallback kicks in when no date filter is active.
  const cardsScopeLabel = useMemo(() => {
    if (dateRange.type !== "range" || !dateRange.from) return null;
    const to = dateRange.to ?? dateRange.from;
    const monthNames = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const fromLbl = `${monthNames[dateRange.from.getMonth()]} ${String(dateRange.from.getFullYear()).slice(-2)}`;
    const toLbl = `${monthNames[to.getMonth()]} ${String(to.getFullYear()).slice(-2)}`;
    const range = fromLbl === toLbl ? fromLbl : `${fromLbl} – ${toLbl}`;
    return `Expanded to complete contract quarters touching ${range}`;
  }, [dateRange]);

  // Per-client relationship metadata derived from deliverables_monthly (the
  // Delivered vs Invoiced v2 sheet). It's the source of truth for the
  // client's real delivery window because the SOW overview sheet overwrites
  // start_date / term_months / SOW on each contract renewal and only carries
  // the current active year — losing Y1 history. The monthly table keeps
  // every year, so we pull bounds from it.
  //
  // Merge rule for the effective contract window:
  //   start = min(clients.start_date, first_active_month_in_deliverables)
  //   end   = max(clients.end_date,   last_planned_month_in_deliverables)
  // The min() captures renewals that overwrote Y1 (first_active is earlier);
  // the inclusion of clients.start_date preserves the onboarding window for
  // brand-new clients whose deliveries haven't started yet.
  const deliveryMeta = useMemo(() => {
    const map = new Map<
      number,
      { startDate: string; termMonths: number; lifetimeSow: number }
    >();
    const clientById = new Map(clients.map((c) => [c.id, c]));
    const byClient = new Map<number, DeliverableMonthly[]>();
    for (const d of deliverables) {
      const arr = byClient.get(d.client_id);
      if (arr) arr.push(d);
      else byClient.set(d.client_id, [d]);
    }
    for (const [cid, rows] of byClient) {
      const active = rows.filter(
        (r) =>
          (r.articles_sow_target ?? 0) > 0 ||
          (r.articles_delivered ?? 0) > 0 ||
          (r.articles_invoiced ?? 0) > 0,
      );
      if (active.length === 0) continue;
      active.sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
      const first = active[0];
      const lastPlanned = [...active]
        .reverse()
        .find((r) => (r.articles_sow_target ?? 0) > 0) ?? active[active.length - 1];

      const firstYm = { y: first.year, m: first.month };
      const lastYm = { y: lastPlanned.year, m: lastPlanned.month };

      // Fold in clients.start_date / end_date so the SOW overview's onboarding
      // window is preserved when deliveries haven't started yet.
      const c = clientById.get(cid);
      const sheetStart = parseISODateLocal(c?.start_date);
      const sheetEnd = parseISODateLocal(c?.end_date);
      const startYm = sheetStart
        ? earlierYm(firstYm, { y: sheetStart.getFullYear(), m: sheetStart.getMonth() + 1 })
        : firstYm;
      const endYm = sheetEnd
        ? laterYm(lastYm, { y: sheetEnd.getFullYear(), m: sheetEnd.getMonth() + 1 })
        : lastYm;

      const startDate = `${startYm.y}-${String(startYm.m).padStart(2, "0")}-01`;
      const termMonths = (endYm.y - startYm.y) * 12 + (endYm.m - startYm.m) + 1;
      const lifetimeSow = rows.reduce((a, r) => a + (r.articles_sow_target ?? 0), 0);
      map.set(cid, { startDate, termMonths, lifetimeSow });
    }
    return map;
  }, [clients, deliverables]);

  const rows: ClientDeliverableSummary[] = useMemo(() => {
    const hasFilter = dateRange.type === "range" && !!dateRange.from;
    const filterFrom = hasFilter ? dateRange.from! : null;
    const filterTo = hasFilter ? dateRange.to ?? dateRange.from! : null;

    // Prefer the monthly-derived start over the SOW overview's, because the
    // latter is Y2-only after a renewal. This anchors the contract-Q
    // expansion on the actual first delivery month.
    const effectiveStart = (c: Client): string | null | undefined => {
      return deliveryMeta.get(c.id)?.startDate ?? c.start_date;
    };
    const effectiveTerm = (c: Client): number | null | undefined => {
      return deliveryMeta.get(c.id)?.termMonths ?? c.term_months;
    };

    // Literal filter month set — just the months actually selected, no
    // quarter expansion. Used for "Delivered" (and cumulative delivered)
    // because delivery is reported monthly: when the user filters Jan–Dec
    // they should only see articles delivered in those calendar months,
    // not the spillover from a contract Q whose tail extends past Dec.
    const literalMonthsFor = (): Set<string> | null => {
      if (!hasFilter || !filterFrom || !filterTo) return null;
      const months = new Set<string>();
      let y = filterFrom.getFullYear();
      let m = filterFrom.getMonth() + 1;
      const endY = filterTo.getFullYear();
      const endM = filterTo.getMonth() + 1;
      while (y < endY || (y === endY && m <= endM)) {
        months.add(`${y}-${String(m).padStart(2, "0")}`);
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
      }
      return months;
    };

    // Per-client expanded month set: every month of every contract-Q
    // touched by the filter range. Used for "Invoiced" because the sheet
    // bills quarterly and a partial-Q filter would understate invoicing.
    // Falls back to literal filter months when start_date is missing,
    // so the card still renders honestly.
    const expandedMonthsFor = (c: Client): Set<string> | null => {
      if (!hasFilter || !filterFrom || !filterTo) return null;
      const start = parseISODateLocal(effectiveStart(c));
      const months = new Set<string>();
      const pushKey = (y: number, m: number) =>
        months.add(`${y}-${String(m).padStart(2, "0")}`);
      if (!start) {
        // No contract start — fall through to literal filter months only.
        let y = filterFrom.getFullYear();
        let m = filterFrom.getMonth() + 1;
        const endY = filterTo.getFullYear();
        const endM = filterTo.getMonth() + 1;
        while (y < endY || (y === endY && m <= endM)) {
          pushKey(y, m);
          m += 1;
          if (m > 12) {
            m = 1;
            y += 1;
          }
        }
        return months;
      }
      const startY = start.getFullYear();
      const startM = start.getMonth() + 1;
      const touchedQs = new Set<number>();
      let y = filterFrom.getFullYear();
      let m = filterFrom.getMonth() + 1;
      const endY = filterTo.getFullYear();
      const endM = filterTo.getMonth() + 1;
      while (y < endY || (y === endY && m <= endM)) {
        const mi = (y - startY) * 12 + (m - startM) + 1;
        if (mi >= 1) touchedQs.add(Math.floor((mi - 1) / 3));
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
      }
      for (const qIdx of touchedQs) {
        for (let offset = 0; offset < 3; offset++) {
          const miTotal = qIdx * 3 + offset; // 0-based months since contract start
          const total = startM - 1 + miTotal;
          const qy = startY + Math.floor(total / 12);
          const qm = (total % 12) + 1;
          pushKey(qy, qm);
        }
      }
      return months;
    };

    // Cap card totals at the end of the **last completed month** so
    // partial current-month rows + projected/future rows in
    // deliverables_monthly don't inflate "delivered" or "invoiced". The
    // monthly popover still displays every row; current + future months
    // render with the PROJ marker so nothing is hidden — only the
    // rolled-up card numbers are capped.
    const now = new Date();
    const lastCompleted = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const nowY = lastCompleted.getFullYear();
    const nowM = lastCompleted.getMonth() + 1;
    const isPastOrCurrent = (y: number, m: number): boolean =>
      y < nowY || (y === nowY && m <= nowM);

    return clients.map((c) => {
      // Prefer the sum of per-month SOW targets from deliverables_monthly —
      // it always reflects the full relationship. Falls back to the lifetime
      // `clients.articles_sow` for clients without monthly rows.
      const meta = deliveryMeta.get(c.id);
      const sow = meta && meta.lifetimeSow > 0
        ? meta.lifetimeSow
        : (c.articles_sow ?? 0);
      // Two scopes per client:
      //   • expanded → full contract Qs touching the filter (used for
      //     Invoiced + variance + health, which need quarter-aligned math)
      //   • literal  → only the months the user actually picked (used for
      //     Delivered + cumulative delivered, since delivery is monthly
      //     and quarter expansion would inflate the displayed count with
      //     months outside the filter)
      const expandedScope = expandedMonthsFor(c);
      const literalScope = literalMonthsFor();
      const inExpanded = (d: DeliverableMonthly): boolean => {
        if (d.client_id !== c.id) return false;
        if (!expandedScope) return true; // no filter → all rows
        return expandedScope.has(`${d.year}-${String(d.month).padStart(2, "0")}`);
      };
      const inLiteral = (d: DeliverableMonthly): boolean => {
        if (d.client_id !== c.id) return false;
        if (!literalScope) return true; // no filter → all rows
        return literalScope.has(`${d.year}-${String(d.month).padStart(2, "0")}`);
      };
      // The popover (and any "rows in scope" derivations like the lifetime
      // window check) keeps the expanded set so the user can see the full
      // quarter context surrounding their selection.
      const clientDeliverables = deliverables.filter(inExpanded);
      const expandedActuals = clientDeliverables.filter((d) =>
        isPastOrCurrent(d.year, d.month),
      );
      const literalActuals = deliverables.filter(
        (d) => inLiteral(d) && isPastOrCurrent(d.year, d.month),
      );

      // Scope end = the latest month included in each scope, clamped to
      // today so projections never leak into cumulative totals.
      const computeScopeEnd = (
        scope: Set<string> | null,
      ): { y: number; m: number } | null => {
        if (!scope || scope.size === 0) return null;
        const latest = Array.from(scope).sort().pop()!;
        const [ly, lm] = latest.split("-");
        const y = parseInt(ly, 10);
        const m = parseInt(lm, 10);
        return isPastOrCurrent(y, m) ? { y, m } : { y: nowY, m: nowM };
      };
      const expandedScopeEnd = computeScopeEnd(expandedScope);
      const literalScopeEnd = computeScopeEnd(literalScope);

      // Delivered uses the literal filter (user-selected months only).
      const delivered = literalActuals.reduce(
        (acc, d) => acc + (d.articles_delivered ?? 0),
        0,
      );
      // Invoiced uses the expanded contract-Q scope (sheet invoicing
      // is quarterly, so a partial-Q filter would understate the bill).
      const invoiced = expandedActuals.reduce(
        (acc, d) => acc + (d.articles_invoiced ?? 0),
        0,
      );
      // Variance + health stay on the expanded scope so the two terms are
      // computed against matched windows. Mixing literal-delivered with
      // expanded-invoiced would bias variance negative just from scope
      // mismatch, falsely flagging healthy clients as "behind."
      const expandedDelivered = expandedActuals.reduce(
        (acc, d) => acc + (d.articles_delivered ?? 0),
        0,
      );
      const periodVariance = expandedDelivered - invoiced;

      // Cumulative delivered uses the literal scope-end (matches the
      // displayed Delivered bar's window). Cumulative invoiced uses the
      // expanded scope-end (matches the displayed Invoiced bar). Health
      // chip needs matched scopes again, so cumulativeVariance below is
      // computed off the expanded scope end alone.
      const cumDeliveredLiteral = deliverables
        .filter((d) => {
          if (d.client_id !== c.id) return false;
          if (!isPastOrCurrent(d.year, d.month)) return false;
          if (!literalScopeEnd) return true;
          return (
            d.year < literalScopeEnd.y ||
            (d.year === literalScopeEnd.y && d.month <= literalScopeEnd.m)
          );
        })
        .reduce((a, d) => a + (d.articles_delivered ?? 0), 0);
      // Variance cumulative — both terms summed at the expanded scope end
      // so the matched-window invariant holds for healthOf().
      const expandedCumRows = deliverables.filter((d) => {
        if (d.client_id !== c.id) return false;
        if (!isPastOrCurrent(d.year, d.month)) return false;
        if (!expandedScopeEnd) return true;
        return (
          d.year < expandedScopeEnd.y ||
          (d.year === expandedScopeEnd.y && d.month <= expandedScopeEnd.m)
        );
      });
      const cumDeliveredExpanded = expandedCumRows.reduce(
        (a, d) => a + (d.articles_delivered ?? 0),
        0,
      );
      const cumInvoiced = expandedCumRows.reduce(
        (a, d) => a + (d.articles_invoiced ?? 0),
        0,
      );
      const cumulativeVariance = cumDeliveredExpanded - cumInvoiced;
      // Reference the literal cumulative so eslint doesn't trip; consumers
      // that want a "cumulative delivered for the selected months" value
      // can read this off the row payload below.
      void cumDeliveredLiteral;

      const pct = sow > 0 ? Math.round((delivered / sow) * 100) : 0;

      // Monthly popover: include every in-scope row — past, current, and
      // future. `is_future` tells the popover to render projected rows with
      // a muted/marker style so the reader can see what's forecast vs real.
      const monthly_breakdown = clientDeliverables
        .slice()
        .sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month))
        .map((d) => ({
          year: d.year,
          month: d.month,
          delivered: d.articles_delivered ?? 0,
          invoiced: d.articles_invoiced ?? 0,
          variance: d.variance ?? 0,
          is_future: !isPastOrCurrent(d.year, d.month),
        }));

      return {
        id: c.id,
        name: c.name,
        status: c.status,
        editorial_pod: c.editorial_pod,
        articles_sow: sow,
        articles_delivered: delivered,
        articles_invoiced: invoiced,
        variance: periodVariance,
        variance_cumulative: cumulativeVariance,
        pct_complete: pct,
        start_date: meta?.startDate ?? c.start_date,
        term_months: meta?.termMonths ?? c.term_months,
        monthly_breakdown,
      };
    });
  }, [clients, deliverables, dateRange, deliveryMeta]);

  return (
    <div className="mt-3 space-y-8">
      {/* Section heading */}
      <div className="sticky top-[120px] z-10 bg-black flex items-center gap-3 border-b border-[#2a2a2a] pb-2 pt-1">
        <h2 className="font-mono text-base font-bold uppercase tracking-[0.2em] text-white flex items-center gap-2">
          Delivery Overview <DataSourceBadge
            type="live"
            source="Sheet: 'Delivered vs Invoiced v2' + 'Editorial SOW overview' — Spreadsheet: Editorial Capacity Planning. Cards adapt to the active filter so cumulative numbers only appear when they're meaningful (single client / single pod)."
            shows={[
              "Cards switch by filter scope: single client → client drill-down; single pod → pod totals; portfolio → triage signals.",
              "Portfolio mode replaces meaningless sums (total invoiced across every pod) with actionable cards: Most Behind, Closing in 90d, Last Q Closes, Pod Attention.",
              "Pod mode shows pod-scoped totals + the most-behind client in that pod.",
              "Single-client mode shows lifetime ratios + last full Q closure + days remaining.",
            ]}
          />
        </h2>
        <span className="h-px flex-1 bg-[#2a2a2a]" />
      </div>
      <DeliveryOverviewCards
        allClients={allClients}
        filteredClients={clients}
        rows={rows}
      />

      {/* Production History + Client Notes. When no filtered client has a
          note, Production History spans full width instead of leaving a big
          blank pane next to it. */}
      {clients.some(hasClientNote) ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <ProductionTrendChart
            data={productionTrend}
            clientProduction={clientProduction}
            filteredClients={clients}
            dateRange={dateRange}
          />
          <ClientNotesPanel clients={clients} />
        </div>
      ) : (
        <ProductionTrendChart
          data={productionTrend}
          clientProduction={clientProduction}
          filteredClients={clients}
          dateRange={dateRange}
        />
      )}
      {/* Per-client cards — pacing badge, delivery/invoice bars, variance + % complete */}
      <ClientDeliveryCards rows={rows} scopeLabel={cardsScopeLabel} />
    </div>
  );
}

// Re-export SortableHead from shared helpers (used by Tab 1 + Deliverables table above)
const SortableHead = SortableHeadShared;

// Old GoalsVsDeliveryTab, CumulativePipelineTab, and SortableHead functions
// have been extracted to standalone components in /components/dashboard/
