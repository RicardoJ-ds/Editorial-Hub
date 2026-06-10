"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiGet } from "@/lib/api";
import type {
  TeamMember,
  KpiScore,
  CapacityProjection,
  Client,
  AIMonitoringSummary,
  AIMonitoringBreakdown,
  AIMonitoringRecord,
  SurferAPIUsage,
} from "@/lib/types";
import { SummaryCard } from "@/components/dashboard/SummaryCard";
import { KpiCard, KPI_DISPLAY_NAMES, getKpiTypesForRole } from "@/components/dashboard/KpiCard";
import { CapacityChart } from "@/components/charts/CapacityChart";
import RecommendationChart from "@/components/charts/RecommendationChart";
import { cn } from "@/lib/utils";
import { DataSourceBadge } from "@/components/dashboard/DataSourceBadge";
import { SectionIndex } from "@/components/dashboard/SectionIndex";
import { FilterBar, type DateRange } from "@/components/dashboard/FilterBar";
import { MonthlyArticlesTab } from "@/components/dashboard/MonthlyArticlesTab";
import { SyncControls } from "@/components/layout/SyncControls";
import { TooltipBody, displayPod } from "@/components/dashboard/shared-helpers";
import { useSectionDwellById } from "@/lib/useSectionDwell";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Per-column tooltips on the KPI heatmap. Hovering a header surfaces the
// formula, target, direction (higher / lower is better), source, and the
// known caveats — so reviewers don't have to chase the source code to know
// what an empty cell or a stale value means.
const KPI_HEATMAP_TOOLTIPS: Record<
  string,
  { title: string; bullets: React.ReactNode[] }
> = {
  internal_quality: {
    title: "Internal Quality",
    bullets: [
      "Score 0–100, higher is better. Target ≥ 85.",
      "Senior Editors grade article quality + style on each piece.",
    ],
  },
  external_quality: {
    title: "External Quality",
    bullets: [
      "Score 0–100, higher is better. Target ≥ 85.",
      "Client satisfaction from feedback rounds during the month.",
    ],
  },
  mentorship: {
    title: "Mentorship",
    bullets: [
      "Senior Editors only.",
      "Score 0–100, higher is better. Target ≥ 80.",
      "Editors' growth scores roll up to their Senior Editor.",
    ],
  },
  feedback_adoption: {
    title: "Feedback Adoption",
    bullets: [
      "Editors only.",
      "Score 0–100, higher is better. Target ≥ 80.",
      "How well Senior Editor feedback gets applied on the next round.",
    ],
  },
  revision_rate: {
    title: "Revision Rate",
    bullets: [
      "Share of articles that needed a revision.",
      "Lower is better. Target ≤ 15%.",
      "Counts the editor's own articles plus any they sr-edited.",
    ],
  },
  turnaround_time: {
    title: "Turnaround Time",
    bullets: [
      "Average days from content brief to article delivery.",
      "Lower is better. Target ≤ 14 days.",
      "Outliers above 365 days are dropped.",
    ],
  },
  second_reviews: {
    title: "Second Reviews",
    bullets: [
      "Senior Editors only.",
      "Higher is better. Target ≥ 5 per month.",
      "Counts articles where this person was the senior reviewer.",
    ],
  },
  capacity_utilization: {
    title: "Capacity Utilization",
    bullets: [
      "Pod-level: used ÷ total capacity.",
      "Higher is better. Target ≥ 82.5%.",
      "Same value for everyone in the same pod.",
    ],
  },
  ai_compliance: {
    title: "AI Compliance",
    bullets: [
      "Grades each article's AI usage against the team rubric.",
      "Currently paused upstream — values will populate once scans resume.",
    ],
  },
};

function KpiColumnHeader({ kpiType }: { kpiType: string }) {
  const display = KPI_DISPLAY_NAMES[kpiType] ?? kpiType;
  const body = KPI_HEATMAP_TOOLTIPS[kpiType];
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="cursor-help underline decoration-dotted underline-offset-2 decoration-[#404040] inline-block leading-tight" />
          }
        >
          {display.split(" ").map((word, i, arr) => (
            <span key={i}>
              {word}
              {i < arr.length - 1 && <br />}
            </span>
          ))}
        </TooltipTrigger>
        {body && (
          <TooltipContent side="bottom" className="max-w-sm">
            <TooltipBody {...body} />
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PODS = ["All", "Pod 1", "Pod 2", "Pod 3", "Pod 4", "Pod 5"];
const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

const MONTH_SHORT = [
  "",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const POD_COLORS: Record<string, string> = {
  "Pod 1": "bg-[#5B9BF5]/15 text-[#5B9BF5] border-[#5B9BF5]/30",
  "Pod 2": "bg-[#42CA80]/15 text-[#42CA80] border-[#42CA80]/30",
  "Pod 3": "bg-[#F5C542]/15 text-[#F5C542] border-[#F5C542]/30",
  "Pod 4": "bg-[#F28D59]/15 text-[#F28D59] border-[#F28D59]/30",
  "Pod 5": "bg-[#ED6958]/15 text-[#ED6958] border-[#ED6958]/30",
};

/** Collapse pod variants ("1" / "pod 1" / "Pod 1") to canonical "Pod N".
 *  Mirrors FilterBar.normalizePod so client-pod and member-pod values match. */
function normalizePod(raw: string | null | undefined): string {
  if (raw == null) return "";
  const t = String(raw).trim();
  if (!t || t === "-" || t === "—") return "";
  const n = t.match(/^(\d+)$/);
  if (n) return `Pod ${n[1]}`;
  const p = t.match(/^p(?:od)?\s*(\d+)$/i);
  if (p) return `Pod ${p[1]}`;
  return t;
}

/** KPI types where lower is better */
const LOWER_IS_BETTER = new Set(["revision_rate", "turnaround_time"]);

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-8 w-[140px]" />
        <Skeleton className="h-8 w-[140px]" />
        <Skeleton className="h-8 w-[140px]" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Skeleton className="h-[100px]" />
        <Skeleton className="h-[100px]" />
        <Skeleton className="h-[100px]" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-[200px]" />
        <Skeleton className="h-[200px]" />
        <Skeleton className="h-[200px]" />
        <Skeleton className="h-[200px]" />
        <Skeleton className="h-[200px]" />
        <Skeleton className="h-[200px]" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function TeamKpisPage() {
  const now = new Date();
  // Section dwell tracking for the three AI tabs.
  useSectionDwellById("ai-flagged");
  useSectionDwellById("ai-rewrites");
  useSectionDwellById("ai-surfer");
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [kpiScores, setKpiScores] = useState<KpiScore[]>([]);
  const [capacityData, setCapacityData] = useState<CapacityProjection[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  // Canonical header — `FilterBar` (same as Overview / Editorial Clients) emits
  // the filtered client list + date range. Member + Capacity tabs filter by the
  // pods present in those clients; KPI scores filter by their client ids.
  const [filteredClients, setFilteredClients] = useState<Client[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const start = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 7, 0);
    return { type: "range", from: start, to: end };
  });

  // Translate the active date range into year_from/month_from/year_to/
  // month_to pairs for the kpis API. When the range is "all" we omit them
  // and the backend returns every row.
  const dateRangeQuery = useMemo(() => {
    if (dateRange.type !== "range" || !dateRange.from) return null;
    const to = dateRange.to ?? dateRange.from;
    return {
      yf: dateRange.from.getFullYear(),
      mf: dateRange.from.getMonth() + 1,
      yt: to.getFullYear(),
      mt: to.getMonth() + 1,
    };
  }, [dateRange]);

  // Headline month for the legacy single-month KPI cards under the heatmap
  // — pick the latest month in the active range so the cards show fresh
  // data without ignoring the user's pick.
  const headlineYM = useMemo(() => {
    if (dateRangeQuery) return { y: dateRangeQuery.yt, m: dateRangeQuery.mt };
    return { y: now.getFullYear(), m: now.getMonth() + 1 };
  }, [dateRangeQuery, now]);
  const selectedYear = headlineYM.y;
  const selectedMonth = headlineYM.m;

  const fetchData = useCallback(async () => {
    try {
      const kpiQs = new URLSearchParams({ limit: "5000" });
      if (dateRangeQuery) {
        kpiQs.set("year_from", String(dateRangeQuery.yf));
        kpiQs.set("month_from", String(dateRangeQuery.mf));
        kpiQs.set("year_to", String(dateRangeQuery.yt));
        kpiQs.set("month_to", String(dateRangeQuery.mt));
      }
      const [members, kpis, capacity, activeClients] = await Promise.all([
        apiGet<TeamMember[]>("/api/team-members/?limit=200"),
        apiGet<KpiScore[]>(`/api/kpis/?${kpiQs.toString()}`),
        apiGet<CapacityProjection[]>("/api/capacity/?limit=200"),
        apiGet<Client[]>("/api/clients/?limit=500"),
      ]);
      setTeamMembers(members);
      setKpiScores(kpis);
      setCapacityData(capacity);
      setClients(activeClients);
    } catch (err) {
      console.error("Failed to load team KPI data:", err);
    } finally {
      setLoading(false);
    }
  }, [dateRangeQuery]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Re-fetch when sync completes
  useEffect(() => {
    const handler = () => { setLoading(true); fetchData(); };
    window.addEventListener("data-synced", handler);
    return () => window.removeEventListener("data-synced", handler);
  }, [fetchData]);

  // Client id -> name lookup map
  const clientMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of clients) {
      map.set(c.id, c.name);
    }
    return map;
  }, [clients]);

  // Everything flows from the FilterBar client output (the Overview model):
  // the set of editorial pods present + the client ids in scope.
  const activePods = useMemo(
    () => new Set(filteredClients.map((c) => normalizePod(c.editorial_pod)).filter(Boolean)),
    [filteredClients],
  );
  const clientIds = useMemo(
    () => new Set(filteredClients.map((c) => c.id)),
    [filteredClients],
  );

  const filteredMembers = useMemo(
    () => teamMembers.filter((m) => m.pod && activePods.has(normalizePod(m.pod))),
    [teamMembers, activePods],
  );
  // Scores attributed to an in-scope client (or unattributed nulls).
  const filteredScores = useMemo(
    () => kpiScores.filter((s) => s.client_id === null || clientIds.has(s.client_id)),
    [kpiScores, clientIds],
  );
  const filteredCapacity = useMemo(
    () => capacityData.filter((c) => activePods.has(normalizePod(c.pod))),
    [capacityData, activePods],
  );

  // (Year-options dropdown removed — replaced by DateRangeFilter.)

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Team KPIs Dashboard
          </h2>
          <p className="mt-1 text-sm text-[#606060]">Loading...</p>
        </div>
        <DashboardSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Tabs defaultValue="kpi-performance" onValueChange={() => {
        const scroller = document.querySelector('.ml-\\[240px\\]') as HTMLElement | null;
        if (scroller) scroller.scrollTo({ top: 0, behavior: "smooth" });
        else window.scrollTo({ top: 0, behavior: "smooth" });
      }}>
        {/* Sticky header: title + filters + sync + tabs (matching D1 pattern).
            min-h matches the h3 sticky top inside subsections so the band's
            bg-black butts up against the h3 with no transparent gap. */}
        <div className="sticky top-0 z-20 bg-black pb-3 -mx-8 px-8 pt-3 min-h-[120px]">
          {/* Compact header — title + filters + sync controls inline.
              flex-nowrap + gap-x-4 + text-base title to match Overview
              and Editorial Clients (single hub-wide style). */}
          <div className="flex flex-nowrap items-center gap-x-4 mb-3">
            <h1 className="font-mono text-base font-bold uppercase tracking-[0.18em] text-white whitespace-nowrap shrink-0">
              Team KPIs
            </h1>
            <FilterBar
              clients={clients}
              onFilterChange={setFilteredClients}
              onDateRangeChange={setDateRange}
            />
            <div className="ml-auto shrink-0">
              <SyncControls />
            </div>
          </div>
          <TabsList variant="line">
            <TabsTrigger
              value="kpi-performance"
              className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
            >
              KPI Performance
            </TabsTrigger>
            <TabsTrigger
              value="capacity-projections"
              className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
            >
              Capacity Projections
            </TabsTrigger>
            <TabsTrigger
              value="ai-compliance"
              className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
            >
              AI Compliance
            </TabsTrigger>
            <TabsTrigger
              value="monthly-articles"
              className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
            >
              Monthly Articles
            </TabsTrigger>
            <TabsTrigger
              value="capacity-by-pod"
              className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
            >
              Capacity by Pod
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="kpi-performance">
          <div className="flex gap-6">
            <SectionIndex sections={KPI_PERFORMANCE_SECTIONS} topOffset={140} />
            <div className="flex-1 min-w-0">
              <KpiPerformanceTab
                members={filteredMembers}
                scores={filteredScores}
                allScores={kpiScores}
                month={selectedMonth}
                year={selectedYear}
                clientMap={clientMap}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="capacity-projections">
          <div className="flex gap-6">
            <SectionIndex sections={CAPACITY_SECTIONS} topOffset={140} />
            <div className="flex-1 min-w-0">
              <CapacityProjectionsTab capacity={filteredCapacity} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="ai-compliance">
          <div className="flex gap-6">
            <SectionIndex sections={AI_COMPLIANCE_SECTIONS} topOffset={140} />
            <div className="flex-1 min-w-0">
              <AIComplianceTab />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="monthly-articles">
          <div className="flex gap-6">
            <SectionIndex sections={MONTHLY_ARTICLES_SECTIONS} topOffset={140} />
            <div className="flex-1 min-w-0">
              <MonthlyArticlesTab filteredClients={filteredClients} dateRange={dateRange} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="capacity-by-pod">
          <div className="flex gap-6">
            <SectionIndex sections={CAPACITY_BY_POD_SECTIONS} topOffset={140} />
            <div className="flex-1 min-w-0">
              <CapacityByPodTab />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3: AI Compliance
// ---------------------------------------------------------------------------

function AIComplianceSkeleton() {
  return (
    <div className="mt-4 space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[90px]" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[340px]" />
        ))}
      </div>
      <Skeleton className="h-[300px]" />
    </div>
  );
}

const AI_COMPLIANCE_SECTIONS = [
  { id: "ai-flagged", label: "Flagged Articles" },
  { id: "ai-rewrites", label: "Rewrites" },
  { id: "ai-surfer", label: "Surfer API" },
];

const KPI_PERFORMANCE_SECTIONS = [
  { id: "kpi-overview", label: "KPI Overview" },
  { id: "kpi-pods", label: "Pod Detail" },
];
const CAPACITY_SECTIONS = [
  { id: "capacity-summary", label: "Summary" },
  { id: "capacity-chart", label: "Utilization" },
  { id: "capacity-detail", label: "Detail" },
];
const MONTHLY_ARTICLES_SECTIONS = [
  { id: "articles-chart", label: "Over Time" },
  { id: "articles-matrix", label: "Matrix" },
];
const CAPACITY_BY_POD_SECTIONS = [
  { id: "capacity-by-pod", label: "Pod Overview" },
  { id: "member-utilization", label: "Per Editor" },
  { id: "client-contributions", label: "Client Detail" },
  { id: "utilization-trend", label: "Trend" },
];

// ── Capacity by Pod ──────────────────────────────────────────────────────────
// Simple per-pod matrix: Total capacity (sum of roles) + % Projected + % Actual
// used, for one month. Reads the latest ET CP version per (pod, month) from
// /api/capacity/pod-summary. Editorial pods only (capacity is editorial).
interface CapacityPodRow {
  year: number;
  month: number;
  pod: string;
  version: string | null;
  total_capacity: number | null;
  projected_used_capacity: number | null;
  actual_used_capacity: number | null;
}

const CAP_MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const capMonthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
const capMonthLabel = (y: number, m: number) => `${CAP_MONTH_ABBR[m - 1] ?? m} ${y}`;
const capPct = (num: number | null, den: number | null) =>
  den && den > 0 ? `${Math.round((100 * (num ?? 0)) / den)}%` : "—";

function CapacityByPodTab() {
  const [rows, setRows] = useState<CapacityPodRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    let alive = true;
    apiGet<CapacityPodRow[]>("/api/capacity/pod-summary")
      .then((data) => {
        if (!alive) return;
        setRows(data);
        // Default to the latest month that has any staffed capacity.
        const withCap = data
          .filter((r) => (r.total_capacity ?? 0) > 0)
          .map((r) => capMonthKey(r.year, r.month))
          .sort();
        const all = data.map((r) => capMonthKey(r.year, r.month)).sort();
        setSelected(withCap.at(-1) ?? all.at(-1) ?? "");
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const monthOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => capMonthKey(r.year, r.month)))).sort().reverse(),
    [rows],
  );

  const podRows = useMemo(() => {
    if (!selected) return [];
    const [y, m] = selected.split("-").map(Number);
    return rows
      .filter((r) => r.year === y && r.month === m && (r.total_capacity ?? 0) > 0)
      .sort((a, b) => a.pod.localeCompare(b.pod, undefined, { numeric: true }));
  }, [rows, selected]);

  const totals = useMemo(
    () => ({
      total: podRows.reduce((s, r) => s + (r.total_capacity ?? 0), 0),
      proj: podRows.reduce((s, r) => s + (r.projected_used_capacity ?? 0), 0),
      act: podRows.reduce((s, r) => s + (r.actual_used_capacity ?? 0), 0),
    }),
    [podRows],
  );

  if (loading) return <Skeleton className="h-48 w-full max-w-2xl" />;

  return (
    <div className="space-y-10">
    <section id="capacity-by-pod" className="max-w-2xl space-y-3 scroll-mt-[140px]">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
            Capacity by Pod
          </h2>
          <p className="mt-0.5 font-mono text-[11px] text-[#606060]">
            Total capacity = sum of every role in the pod. % Projected / % Actual = used ÷ total.
            Latest ET CP version. Actual fills in as the month closes.
          </p>
        </div>
        <Select value={selected} onValueChange={(v) => setSelected(v ?? "")}>
          <SelectTrigger className="w-[150px] shrink-0">
            <SelectValue placeholder="Month" />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.map((mo) => {
              const [y, m] = mo.split("-").map(Number);
              return (
                <SelectItem key={mo} value={mo}>
                  {capMonthLabel(y, m)}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
        <table className="w-full border-collapse font-mono text-[13px]">
          <thead className="bg-[#161616] text-[10px] uppercase tracking-wider text-[#606060]">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">Pod</th>
              <th className="px-4 py-2 text-right font-semibold">Total capacity</th>
              <th className="px-4 py-2 text-right font-semibold">% Projected</th>
              <th className="px-4 py-2 text-right font-semibold">% Actual</th>
            </tr>
          </thead>
          <tbody>
            {podRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-[#606060]">
                  No capacity data for this month.
                </td>
              </tr>
            ) : (
              podRows.map((r) => (
                <tr key={r.pod} className="border-t border-[#1a1a1a] hover:bg-[#161616]">
                  <td className="px-4 py-2 text-white">{displayPod(r.pod, "editorial")}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-[#C4BCAA]">
                    {r.total_capacity ?? 0}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-[#C4BCAA]">
                    {capPct(r.projected_used_capacity, r.total_capacity)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-[#C4BCAA]">
                    {capPct(r.actual_used_capacity, r.total_capacity)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {podRows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-[#2a2a2a] bg-[#111111] font-semibold">
                <td className="px-4 py-2 text-[#C4BCAA]">Totals</td>
                <td className="px-4 py-2 text-right tabular-nums text-white">{totals.total}</td>
                <td className="px-4 py-2 text-right tabular-nums text-white">
                  {capPct(totals.proj, totals.total)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-white">
                  {capPct(totals.act, totals.total)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
    {selected && <MemberUtilizationSection monthKey={selected} />}
    {selected && <ClientContributionsSection monthKey={selected} />}
    <UtilizationTrendSection />
    </div>
  );
}

// ── Capacity Utilization per Editor ──────────────────────────────────────────
// Joins-only over 4 origins (no stored/duplicated numbers). Model:
//   %alloc = capacity ÷ pod cap · articles are a DISTRIBUTION key scaled to the
//   authoritative pod RAW actual (fallback — the article log under-counts) ·
//   projected = %alloc × pod raw projected · %Real = actual ÷ capacity ·
//   %Weighted = actual ÷ projected. Pod-level weighted util shown for reference.
interface MemberUtilRow {
  pod: string;
  role: string | null;
  member: string;
  capacity: number | null;
  matched: boolean;
  articles: number;
  pct_allocation: number;
  pct_distribution: number;
  projected_used: number;
  actual_used: number;
  pct_util_real: number | null;
  pct_util_weighted: number | null;
  pod_total_capacity: number;
  pod_total_articles: number;
  pod_projected_raw: number;
  pod_actual_raw: number;
  pod_projected_weighted: number;
  pod_actual_weighted: number;
  pod_util_projected_weighted: number | null;
  pod_util_actual_weighted: number | null;
}

const fmtPct = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`;

function MemberUtilizationSection({ monthKey }: { monthKey: string }) {
  const [rows, setRows] = useState<MemberUtilRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!monthKey) return;
    const [y, m] = monthKey.split("-").map(Number);
    let alive = true;
    setLoading(true);
    apiGet<MemberUtilRow[]>(`/api/capacity/member-utilization?year=${y}&month=${m}`)
      .then((d) => {
        if (alive) setRows(d);
      })
      .catch(() => {
        if (alive) setRows([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [monthKey]);

  const pods = useMemo(() => {
    const map = new Map<string, MemberUtilRow[]>();
    for (const r of rows) {
      if (!map.has(r.pod)) map.set(r.pod, []);
      map.get(r.pod)!.push(r);
    }
    return Array.from(map.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], undefined, { numeric: true }),
    );
  }, [rows]);

  const unmatched = rows.filter(
    (r) => !r.matched && r.member.toLowerCase() !== "support from pod 1",
  ).length;

  if (loading) return <Skeleton className="h-64 w-full max-w-3xl" />;
  if (!rows.length) return null;

  return (
    <section id="member-utilization" className="max-w-3xl space-y-3 scroll-mt-[140px]">
      <div>
        <h2 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
          Capacity Utilization per Editor
        </h2>
        <p className="mt-0.5 font-mono text-[11px] leading-relaxed text-[#606060]">
          Articles set each editor&apos;s <span className="text-[#909090]">share</span> of the pod&apos;s
          real used capacity (the log under-counts, so it&apos;s a distribution key, not the total).
          <span className="text-[#909090]"> %Util Real</span> = actual ÷ capacity ·
          <span className="text-[#909090]"> %Util Wtd</span> = actual ÷ projected.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
        <table className="w-full border-collapse font-mono text-[13px]">
          <thead className="bg-[#161616] text-[10px] uppercase tracking-wider text-[#606060]">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Editor</th>
              <th className="px-3 py-2 text-right font-semibold">Capacity</th>
              <th className="px-3 py-2 text-right font-semibold">% Alloc</th>
              <th className="px-3 py-2 text-right font-semibold">Articles</th>
              <th className="px-3 py-2 text-right font-semibold">Projected</th>
              <th className="px-3 py-2 text-right font-semibold">Actual</th>
              <th className="px-3 py-2 text-right font-semibold">% Util Real</th>
              <th className="px-3 py-2 text-right font-semibold">% Util Wtd</th>
            </tr>
          </thead>
          <tbody>
            {pods.map(([pod, members]) => {
              const b = members[0];
              return (
                <Fragment key={pod}>
                  <tr className="border-t border-[#2a2a2a] bg-[#141414] text-[10px] text-[#909090]">
                    <td className="px-3 py-1.5 font-semibold uppercase tracking-wider text-[#C4BCAA]">
                      {displayPod(pod, "editorial")}
                    </td>
                    <td className="px-3 py-1.5 text-right">{b.pod_total_capacity}</td>
                    <td className="px-3 py-1.5 text-right">{b.pod_total_articles} art</td>
                    <td colSpan={2} className="px-3 py-1.5 text-right">
                      raw proj {b.pod_projected_raw} / act {b.pod_actual_raw}
                    </td>
                    <td colSpan={3} className="px-3 py-1.5 text-right">
                      pod wtd util: proj {fmtPct(b.pod_util_projected_weighted)} · act{" "}
                      {fmtPct(b.pod_util_actual_weighted)}
                    </td>
                  </tr>
                  {members.map((r) => (
                    <tr
                      key={`${pod}-${r.member}`}
                      className="border-t border-[#1a1a1a] hover:bg-[#161616]"
                    >
                      <td className="px-3 py-2 text-white">
                        {r.member}
                        {r.role && <span className="ml-2 text-[10px] text-[#606060]">{r.role}</span>}
                        {!r.matched && (
                          <span
                            className="ml-2 text-[10px] text-[#F5BC4E]"
                            title="No matching editor in the article log"
                          >
                            no match
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-[#C4BCAA]">
                        {r.capacity ?? 0}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-[#606060]">
                        {fmtPct(r.pct_allocation)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-[#606060]">{r.articles}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[#909090]">
                        {r.projected_used}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-[#909090]">
                        {r.actual_used}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-white">
                        {fmtPct(r.pct_util_real)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-white">
                        {fmtPct(r.pct_util_weighted)}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {unmatched > 0 && (
        <p className="font-mono text-[10px] text-[#606060]">
          {unmatched} member{unmatched === 1 ? "" : "s"} couldn&apos;t be matched to an editor name —
          counted as 0 articles (name-matching is a known follow-up).
        </p>
      )}
    </section>
  );
}

// ── Client Contributions ─────────────────────────────────────────────────────
// The intermediate ("processed") table between the raw origins and the pod
// utilization numbers: one row per client with its projected/actual articles
// and the specialized ×1.4 weighting. Pod subtotals here ARE the pod raw /
// weighted totals the per-editor section divides up.
interface ClientContributionRow {
  pod: string;
  client_id: number;
  client_name: string;
  category: string | null;
  weight: number;
  projected_raw: number;
  actual_raw: number;
  projected_weighted: number;
  actual_weighted: number;
}

function ClientContributionsSection({ monthKey }: { monthKey: string }) {
  const [rows, setRows] = useState<ClientContributionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!monthKey) return;
    const [y, m] = monthKey.split("-").map(Number);
    let alive = true;
    setLoading(true);
    apiGet<ClientContributionRow[]>(`/api/capacity/client-contributions?year=${y}&month=${m}`)
      .then((d) => {
        if (alive) setRows(d);
      })
      .catch(() => {
        if (alive) setRows([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [monthKey]);

  const pods = useMemo(() => {
    const map = new Map<string, ClientContributionRow[]>();
    for (const r of rows) {
      if (!map.has(r.pod)) map.set(r.pod, []);
      map.get(r.pod)!.push(r);
    }
    return Array.from(map.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], undefined, { numeric: true }),
    );
  }, [rows]);

  if (loading) return <Skeleton className="h-64 w-full max-w-3xl" />;
  if (!rows.length) return null;

  return (
    <section id="client-contributions" className="max-w-3xl space-y-3 scroll-mt-[140px]">
      <div>
        <h2 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
          Client Contributions
        </h2>
        <p className="mt-0.5 font-mono text-[11px] leading-relaxed text-[#606060]">
          What each client adds to its pod&apos;s workload this month. Specialized clients
          weigh <span className="text-[#909090]">×1.4</span>. Pod totals here are exactly the
          projected / actual numbers the per-editor section splits up.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
        <table className="w-full border-collapse font-mono text-[13px]">
          <thead className="bg-[#161616] text-[10px] uppercase tracking-wider text-[#606060]">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Client</th>
              <th className="px-3 py-2 text-left font-semibold">Category</th>
              <th className="px-3 py-2 text-right font-semibold">Projected</th>
              <th className="px-3 py-2 text-right font-semibold">Actual</th>
              <th className="px-3 py-2 text-right font-semibold">Wtd Projected</th>
              <th className="px-3 py-2 text-right font-semibold">Wtd Actual</th>
            </tr>
          </thead>
          <tbody>
            {pods.map(([pod, clients]) => {
              const t = clients.reduce(
                (s, r) => ({
                  pr: s.pr + r.projected_raw,
                  ar: s.ar + r.actual_raw,
                  pw: s.pw + r.projected_weighted,
                  aw: s.aw + r.actual_weighted,
                }),
                { pr: 0, ar: 0, pw: 0, aw: 0 },
              );
              return (
                <Fragment key={pod}>
                  <tr className="border-t border-[#2a2a2a] bg-[#141414]">
                    <td className="px-3 py-1.5 font-semibold uppercase tracking-wider text-[10px] text-[#C4BCAA]">
                      {displayPod(pod, "editorial")}
                    </td>
                    <td className="px-3 py-1.5 text-[10px] text-[#606060]">
                      {clients.length} client{clients.length === 1 ? "" : "s"}
                    </td>
                    <td className="px-3 py-1.5 text-right text-[11px] font-semibold text-white">{t.pr}</td>
                    <td className="px-3 py-1.5 text-right text-[11px] font-semibold text-white">{t.ar}</td>
                    <td className="px-3 py-1.5 text-right text-[11px] font-semibold text-[#C4BCAA]">
                      {t.pw.toFixed(1)}
                    </td>
                    <td className="px-3 py-1.5 text-right text-[11px] font-semibold text-[#C4BCAA]">
                      {t.aw.toFixed(1)}
                    </td>
                  </tr>
                  {clients.map((r) => (
                    <tr
                      key={`${pod}-${r.client_id}`}
                      className="border-t border-[#1a1a1a] hover:bg-[#161616]"
                    >
                      <td className="px-3 py-1.5 pl-6 text-[#C4BCAA]">{r.client_name}</td>
                      <td className="px-3 py-1.5">
                        {r.category === "specialized" ? (
                          <span className="rounded bg-[#8FB5D9]/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[#8FB5D9]">
                            Specialized ×1.4
                          </span>
                        ) : (
                          <span className="text-[10px] uppercase tracking-wider text-[#606060]">
                            {r.category ?? "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#909090]">
                        {r.projected_raw}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#909090]">
                        {r.actual_raw}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#606060]">
                        {r.projected_weighted.toFixed(1)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#606060]">
                        {r.actual_weighted.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Utilization Trend ────────────────────────────────────────────────────────
// Member × month matrix of the FINAL utilization numbers across every month
// with staffed capacity. One fetch of /member-utilization-matrix; a metric
// toggle switches %Util Real / %Util Wtd / Articles.
interface MemberUtilMatrixRow extends MemberUtilRow {
  year: number;
  month: number;
}

type TrendMetric = "real" | "weighted" | "articles";
const TREND_METRICS: { key: TrendMetric; label: string }[] = [
  { key: "real", label: "% Util Real" },
  { key: "weighted", label: "% Util Wtd" },
  { key: "articles", label: "Articles" },
];

// Utilization heat: amber when clearly under, green near plan, red when over.
function utilCellStyle(v: number | null): React.CSSProperties {
  if (v === null || v === undefined) return {};
  const pct = v * 100;
  if (pct <= 0) return {};
  if (pct < 85) {
    const a = Math.min(0.3, 0.08 + ((85 - pct) / 85) * 0.25);
    return { backgroundColor: `rgba(245, 188, 78, ${a.toFixed(2)})` };
  }
  if (pct <= 105) return { backgroundColor: "rgba(66, 202, 128, 0.16)" };
  const a = Math.min(0.38, 0.12 + ((pct - 105) / 60) * 0.3);
  return { backgroundColor: `rgba(237, 105, 88, ${a.toFixed(2)})` };
}

function UtilizationTrendSection() {
  const [rows, setRows] = useState<MemberUtilMatrixRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<TrendMetric>("real");

  useEffect(() => {
    let alive = true;
    apiGet<MemberUtilMatrixRow[]>("/api/capacity/member-utilization-matrix")
      .then((d) => {
        if (alive) setRows(d);
      })
      .catch(() => {
        if (alive) setRows([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Only months where some pod has real production (skip empty future months).
  const months = useMemo(() => {
    const withData = new Set(
      rows.filter((r) => r.pod_actual_raw > 0).map((r) => capMonthKey(r.year, r.month)),
    );
    return Array.from(withData).sort();
  }, [rows]);

  const { pods, valueAt } = useMemo(() => {
    const byCell = new Map<string, MemberUtilMatrixRow>();
    const members = new Map<string, { pod: string; member: string; role: string | null; maxCap: number }>();
    for (const r of rows) {
      const mk = capMonthKey(r.year, r.month);
      if (!months.includes(mk)) continue;
      const id = `${r.pod}|${r.member}`;
      byCell.set(`${id}|${mk}`, r);
      const cur = members.get(id);
      if (!cur || (r.capacity ?? 0) > cur.maxCap) {
        members.set(id, {
          pod: r.pod,
          member: r.member,
          role: r.role,
          maxCap: r.capacity ?? 0,
        });
      }
    }
    const podMap = new Map<string, { id: string; member: string; role: string | null; maxCap: number }[]>();
    for (const [id, m] of members) {
      if (!podMap.has(m.pod)) podMap.set(m.pod, []);
      podMap.get(m.pod)!.push({ id, member: m.member, role: m.role, maxCap: m.maxCap });
    }
    const pods = Array.from(podMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([pod, ms]) => [pod, ms.sort((a, b) => b.maxCap - a.maxCap || a.member.localeCompare(b.member))] as const);
    const valueAt = (id: string, mk: string): { v: number | null; raw: MemberUtilMatrixRow | undefined } => {
      const r = byCell.get(`${id}|${mk}`);
      if (!r) return { v: null, raw: undefined };
      if (metric === "articles") return { v: r.articles, raw: r };
      return { v: metric === "real" ? r.pct_util_real : r.pct_util_weighted, raw: r };
    };
    return { pods, valueAt };
  }, [rows, months, metric]);

  if (loading) return <Skeleton className="h-72 w-full" />;
  if (!rows.length || months.length === 0) return null;

  return (
    <section id="utilization-trend" className="space-y-3 scroll-mt-[140px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
            Utilization Trend
          </h2>
          <p className="mt-0.5 font-mono text-[11px] leading-relaxed text-[#606060]">
            Final per-editor numbers across every month with staffed capacity and real
            production. <span className="text-[#F5BC4E]">Amber</span> = under 85% ·{" "}
            <span className="text-[#42CA80]">green</span> = 85–105% ·{" "}
            <span className="text-[#ED6958]">red</span> = over.
          </p>
        </div>
        <div className="inline-flex rounded-md border border-[#1e1e1e] bg-[#0d0d0d] p-0.5">
          {TREND_METRICS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setMetric(o.key)}
              className={
                metric === o.key
                  ? "rounded bg-[#42CA80]/15 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-[#42CA80]"
                  : "rounded px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-[#606060] hover:text-[#C4BCAA]"
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
        <table className="w-full border-collapse font-mono text-xs">
          <thead className="bg-[#161616] text-[10px] uppercase tracking-wider text-[#606060]">
            <tr>
              <th className="sticky left-0 z-10 min-w-[180px] bg-[#161616] px-3 py-2 text-left font-semibold">
                Editor
              </th>
              {months.map((mk) => {
                const [y, m] = mk.split("-").map(Number);
                return (
                  <th key={mk} className="px-2 py-2 text-right font-semibold whitespace-nowrap">
                    {capMonthLabel(y, m)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pods.map(([pod, members]) => (
              <Fragment key={pod}>
                <tr className="border-t border-[#2a2a2a] bg-[#141414]">
                  <td
                    className="sticky left-0 z-10 bg-[#141414] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#C4BCAA]"
                    colSpan={1}
                  >
                    {displayPod(pod, "editorial")}
                  </td>
                  {months.map((mk) => {
                    const sample = members
                      .map((m) => valueAt(m.id, mk).raw)
                      .find((r) => r !== undefined);
                    const podUtil =
                      metric === "articles"
                        ? sample?.pod_total_articles ?? null
                        : sample && sample.pod_total_capacity > 0
                          ? sample.pod_actual_raw / sample.pod_total_capacity
                          : null;
                    return (
                      <td key={mk} className="px-2 py-1.5 text-right text-[10px] text-[#606060]">
                        {podUtil === null
                          ? ""
                          : metric === "articles"
                            ? podUtil
                            : fmtPct(podUtil)}
                      </td>
                    );
                  })}
                </tr>
                {members.map((m) => (
                  <tr key={m.id} className="border-t border-[#1a1a1a] hover:bg-[#161616]">
                    <td className="sticky left-0 z-10 bg-[#0d0d0d] px-3 py-1.5 whitespace-nowrap text-white">
                      {m.member}
                      {m.role && (
                        <span className="ml-2 text-[10px] text-[#606060]">{m.role}</span>
                      )}
                    </td>
                    {months.map((mk) => {
                      const { v } = valueAt(m.id, mk);
                      return (
                        <td
                          key={mk}
                          className="px-2 py-1.5 text-right tabular-nums text-[#C4BCAA]"
                          style={metric === "articles" ? {} : utilCellStyle(v as number | null)}
                        >
                          {v === null || v === undefined
                            ? "—"
                            : metric === "articles"
                              ? v
                              : fmtPct(v as number)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="font-mono text-[10px] text-[#606060]">
        Pod rows show the pod-level number (actual ÷ total capacity, or total articles).
        Empty months (no production data yet) are hidden.
      </p>
    </section>
  );
}

function AIComplianceTab() {
  const [summary, setSummary] = useState<AIMonitoringSummary | null>(null);
  const [byPod, setByPod] = useState<AIMonitoringBreakdown[]>([]);
  const [byClient, setByClient] = useState<AIMonitoringBreakdown[]>([]);
  const [byWriter, setByWriter] = useState<AIMonitoringBreakdown[]>([]);
  const [byMonth, setByMonth] = useState<AIMonitoringBreakdown[]>([]);
  const [flags, setFlags] = useState<AIMonitoringRecord[]>([]);
  const [rewrites, setRewrites] = useState<AIMonitoringRecord[]>([]);
  const [surferUsage, setSurferUsage] = useState<SurferAPIUsage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAll() {
      try {
        const [
          summaryRes,
          byPodRes,
          byClientRes,
          byWriterRes,
          byMonthRes,
          flagsRes,
          rewritesRes,
          surferRes,
        ] = await Promise.all([
          apiGet<AIMonitoringSummary>("/api/ai-monitoring/summary"),
          apiGet<AIMonitoringBreakdown[]>("/api/ai-monitoring/by-pod"),
          apiGet<AIMonitoringBreakdown[]>("/api/ai-monitoring/by-client?limit=20"),
          apiGet<AIMonitoringBreakdown[]>("/api/ai-monitoring/by-writer?limit=20"),
          apiGet<AIMonitoringBreakdown[]>("/api/ai-monitoring/by-month"),
          apiGet<AIMonitoringRecord[]>("/api/ai-monitoring/flags?limit=50"),
          apiGet<AIMonitoringRecord[]>("/api/ai-monitoring/rewrites?limit=50"),
          apiGet<SurferAPIUsage[]>("/api/ai-monitoring/surfer-usage"),
        ]);
        setSummary(summaryRes);
        setByPod(byPodRes);
        setByClient(byClientRes);
        setByWriter(byWriterRes);
        setByMonth(byMonthRes);
        setFlags(flagsRes);
        setRewrites(rewritesRes);
        setSurferUsage(surferRes);
      } catch (err) {
        console.error("Failed to load AI compliance data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, []);

  if (loading) return <AIComplianceSkeleton />;

  // Latest month Surfer API calls total
  const latestSurfer = surferUsage.length > 0 ? surferUsage[surferUsage.length - 1] : null;

  return (
    <div className="mt-4 space-y-8">
      {/* Summary Cards */}
      <div className="mb-1 flex items-center gap-2">
        <span className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">AI Compliance Summary</span>
        <DataSourceBadge type="live" source="Writer AI Monitoring · Surfer AI detector results." />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCard
          title="Total Articles Scanned"
          value={summary?.total ?? 0}
        />
        <SummaryCard
          title="Full Pass Rate"
          value={summary ? `${(summary.full_pass_rate * 100).toFixed(1)}%` : "—"}
          valueColor="green"
          progress={summary ? summary.full_pass_rate * 100 : undefined}
        />
        <SummaryCard
          title="Partial Pass"
          value={summary?.partial_pass ?? 0}
          description={
            summary
              ? `${(summary.partial_pass_rate * 100).toFixed(1)}% of total`
              : undefined
          }
        />
        <SummaryCard
          title="Review / Rewrite"
          value={summary?.review_rewrite ?? 0}
          valueColor={
            summary && summary.review_rewrite_rate > 0.15 ? "red" : "white"
          }
          description={
            summary
              ? `${(summary.review_rewrite_rate * 100).toFixed(1)}% of total`
              : undefined
          }
        />
        <SummaryCard
          title="Surfer API Calls"
          value={latestSurfer?.total_spent ?? "—"}
          description={
            latestSurfer
              ? `${latestSurfer.year_month} · ${latestSurfer.remaining_calls ?? "?"} remaining`
              : "No data"
          }
        />
      </div>

      {/* Recommendation Charts 2x2 */}
      <div className="mb-1 flex items-center gap-2">
        <span className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">Recommendation Breakdown</span>
        <DataSourceBadge type="live" source="Writer AI Monitoring · breakdown by pod, client, writer, month." />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RecommendationChart data={byPod} title="Recommendation by Pod" />
        <RecommendationChart data={byClient} title="Recommendation by Client" />
        <RecommendationChart data={byWriter} title="Recommendation by Writer" />
        <RecommendationChart data={byMonth} title="Recommendation by Month" />
      </div>

      {/* Flagged Articles Table */}
      <section id="ai-flagged" className="space-y-3 scroll-mt-[140px]">
        <h3 className="mb-2 font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
          Flagged Articles <DataSourceBadge type="live" source="Articles flagged for AI review · Writer AI Monitoring." />
        </h3>
        <div className="rounded-lg border border-[#2a2a2a] bg-[#161616]">
          <Table>
            <TableHeader>
              <TableRow className="border-[#2a2a2a] hover:bg-transparent">
                <TableHead className="text-xs text-[#C4BCAA]">Client</TableHead>
                <TableHead className="text-xs text-[#C4BCAA]">Topic</TableHead>
                <TableHead className="text-xs text-[#C4BCAA]">Writer</TableHead>
                <TableHead className="text-xs text-[#C4BCAA]">Editor</TableHead>
                <TableHead className="text-xs text-[#C4BCAA]">Recommendation</TableHead>
                <TableHead className="text-xs text-[#C4BCAA]">Action</TableHead>
                <TableHead className="text-xs text-[#C4BCAA]">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flags.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-[#606060]">
                    No flagged articles.
                  </TableCell>
                </TableRow>
              ) : (
                flags.map((r, idx) => (
                  <TableRow key={r.id} className="border-[#2a2a2a] hover:bg-[#1F1F1F] animate-fade-slide" style={{ animationDelay: `${idx * 30}ms` }}>
                    <TableCell className="text-xs text-white">{r.client}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-[#C4BCAA]" title={r.topic_title}>
                      {r.topic_title}
                    </TableCell>
                    <TableCell className="text-xs text-[#C4BCAA]">{r.writer_name ?? "—"}</TableCell>
                    <TableCell className="text-xs text-[#C4BCAA]">{r.editor_name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          r.recommendation === "Full Pass"
                            ? "bg-[#42CA80]/15 text-[#42CA80] border-[#42CA80]/30"
                            : r.recommendation === "Partial Pass"
                              ? "bg-[#F5BC4E]/15 text-[#F5BC4E] border-[#F5BC4E]/30"
                              : "bg-[#ED6958]/15 text-[#ED6958] border-[#ED6958]/30"
                        }
                      >
                        {r.recommendation}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-[#C4BCAA]">{r.action ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-[#C4BCAA]">{r.date_processed ?? "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* Rewrites Table */}
      <section id="ai-rewrites" className="space-y-3 scroll-mt-[140px]">
        <h3 className="mb-2 font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
          Rewrites <DataSourceBadge type="live" source="Articles needing full rewrite (AI compliance fail)." />
        </h3>
        <div className="rounded-lg border border-[#2a2a2a] bg-[#161616]">
          <Table>
            <TableHeader>
              <TableRow className="border-[#2a2a2a] hover:bg-transparent">
                <TableHead className="text-xs text-[#C4BCAA]">Client</TableHead>
                <TableHead className="text-xs text-[#C4BCAA]">Topic</TableHead>
                <TableHead className="text-xs text-[#C4BCAA]">Writer</TableHead>
                <TableHead className="text-xs text-[#C4BCAA]">Editor</TableHead>
                <TableHead className="text-xs text-[#C4BCAA]">Recommendation</TableHead>
                <TableHead className="text-xs text-[#C4BCAA]">Action</TableHead>
                <TableHead className="text-xs text-[#C4BCAA]">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rewrites.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-[#606060]">
                    No rewrites recorded.
                  </TableCell>
                </TableRow>
              ) : (
                rewrites.map((r, idx) => (
                  <TableRow key={r.id} className="border-[#2a2a2a] hover:bg-[#1F1F1F] animate-fade-slide" style={{ animationDelay: `${idx * 30}ms` }}>
                    <TableCell className="text-xs text-white">{r.client}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-[#C4BCAA]" title={r.topic_title}>
                      {r.topic_title}
                    </TableCell>
                    <TableCell className="text-xs text-[#C4BCAA]">{r.writer_name ?? "—"}</TableCell>
                    <TableCell className="text-xs text-[#C4BCAA]">{r.editor_name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          r.recommendation === "Full Pass"
                            ? "bg-[#42CA80]/15 text-[#42CA80] border-[#42CA80]/30"
                            : r.recommendation === "Partial Pass"
                              ? "bg-[#F5BC4E]/15 text-[#F5BC4E] border-[#F5BC4E]/30"
                              : "bg-[#ED6958]/15 text-[#ED6958] border-[#ED6958]/30"
                        }
                      >
                        {r.recommendation}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-[#C4BCAA]">{r.action ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-[#C4BCAA]">{r.date_processed ?? "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* Surfer API Usage Table */}
      <section id="ai-surfer" className="space-y-3 scroll-mt-[140px]">
        <h3 className="mb-2 font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
          Surfer API Usage <DataSourceBadge type="live" source="Monthly Surfer API call counts by pod." />
        </h3>
        <div className="rounded-lg border border-[#2a2a2a] bg-[#161616]">
          <Table>
            <TableHeader>
              <TableRow className="border-[#2a2a2a] hover:bg-transparent">
                <TableHead className="text-xs text-[#C4BCAA]">Year/Month</TableHead>
                <TableHead className="text-xs text-[#C4BCAA] text-right">Pod 1</TableHead>
                <TableHead className="text-xs text-[#C4BCAA] text-right">Pod 2</TableHead>
                <TableHead className="text-xs text-[#C4BCAA] text-right">Pod 3</TableHead>
                <TableHead className="text-xs text-[#C4BCAA] text-right">Pod 4</TableHead>
                <TableHead className="text-xs text-[#C4BCAA] text-right">Pod 5</TableHead>
                <TableHead className="text-xs text-[#C4BCAA] text-right">Total</TableHead>
                <TableHead className="text-xs text-[#C4BCAA] text-right">Remaining</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {surferUsage.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-[#606060]">
                    No Surfer API usage data.
                  </TableCell>
                </TableRow>
              ) : (
                surferUsage.map((row, idx) => (
                  <TableRow key={row.id} className="border-[#2a2a2a] hover:bg-[#1F1F1F] animate-fade-slide" style={{ animationDelay: `${idx * 30}ms` }}>
                    <TableCell className="font-mono text-xs text-white">{row.year_month}</TableCell>
                    <TableCell className="font-mono text-xs text-[#C4BCAA] text-right">{row.pod_1}</TableCell>
                    <TableCell className="font-mono text-xs text-[#C4BCAA] text-right">{row.pod_2}</TableCell>
                    <TableCell className="font-mono text-xs text-[#C4BCAA] text-right">{row.pod_3}</TableCell>
                    <TableCell className="font-mono text-xs text-[#C4BCAA] text-right">{row.pod_4}</TableCell>
                    <TableCell className="font-mono text-xs text-[#C4BCAA] text-right">{row.pod_5}</TableCell>
                    <TableCell className="font-mono text-xs font-semibold text-white text-right">{row.total_spent}</TableCell>
                    <TableCell
                      className={cn(
                        "font-mono text-xs font-semibold text-right",
                        row.remaining_calls !== null && row.remaining_calls < 100
                          ? "text-[#ED6958]"
                          : "text-[#42CA80]"
                      )}
                    >
                      {row.remaining_calls ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Heatmap helper: get bg color for a KPI cell
// ---------------------------------------------------------------------------

function getHeatmapColor(
  kpiType: string,
  score: number | null,
  target: number | null
): string {
  if (score === null || target === null) return "bg-[#1F1F1F]";

  const lowerBetter = LOWER_IS_BETTER.has(kpiType);

  if (lowerBetter) {
    if (score <= target) return "bg-[#42CA80]/20";
    if (score <= target * 1.1) return "bg-[#F5BC4E]/20";
    return "bg-[#ED6958]/20";
  } else {
    if (score >= target) return "bg-[#42CA80]/20";
    if (score >= target * 0.9) return "bg-[#F5BC4E]/20";
    return "bg-[#ED6958]/20";
  }
}

function getHeatmapTextColor(
  kpiType: string,
  score: number | null,
  target: number | null
): string {
  if (score === null || target === null) return "text-[#606060]";

  const lowerBetter = LOWER_IS_BETTER.has(kpiType);

  if (lowerBetter) {
    if (score <= target) return "text-[#42CA80]";
    if (score <= target * 1.1) return "text-[#F5BC4E]";
    return "text-[#ED6958]";
  } else {
    if (score >= target) return "text-[#42CA80]";
    if (score >= target * 0.9) return "text-[#F5BC4E]";
    return "text-[#ED6958]";
  }
}

// ---------------------------------------------------------------------------
// Tab 1: KPI Performance
// ---------------------------------------------------------------------------

function KpiPerformanceTab({
  members,
  scores,
  allScores,
  month,
  year,
  clientMap,
}: {
  members: TeamMember[];
  scores: KpiScore[];
  allScores: KpiScore[];
  month: number;
  year: number;
  clientMap: Map<number, string>;
}) {
  // Ref map for scrolling to member cards
  const memberRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Group members by pod
  const grouped = useMemo(() => {
    const groups = new Map<string, TeamMember[]>();
    for (const m of members) {
      const pod = m.pod ?? "Unassigned";
      if (!groups.has(pod)) groups.set(pod, []);
      groups.get(pod)!.push(m);
    }
    // Sort pods
    const sorted = Array.from(groups.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return sorted;
  }, [members]);

  // Compute pod-level summary stats
  const podStats = useMemo(() => {
    const stats = new Map<
      string,
      { avgUtilization: number | null; avgQuality: number | null }
    >();
    for (const [pod, podMembers] of grouped) {
      const utilizations: number[] = [];
      const qualities: number[] = [];
      for (const m of podMembers) {
        const memberScores = scores.filter(
          (s) =>
            s.team_member_id === m.id && s.year === year && s.month === month
        );
        for (const s of memberScores) {
          if (
            s.kpi_type === "capacity_utilization" &&
            s.score !== null
          ) {
            utilizations.push(s.score);
          }
          if (
            (s.kpi_type === "internal_quality" ||
              s.kpi_type === "external_quality") &&
            s.score !== null
          ) {
            qualities.push(s.score);
          }
        }
      }
      stats.set(pod, {
        avgUtilization:
          utilizations.length > 0
            ? Math.round(
                (utilizations.reduce((a, b) => a + b, 0) /
                  utilizations.length) *
                  10
              ) / 10
            : null,
        avgQuality:
          qualities.length > 0
            ? Math.round(
                (qualities.reduce((a, b) => a + b, 0) / qualities.length) * 10
              ) / 10
            : null,
      });
    }
    return stats;
  }, [grouped, scores, year, month]);

  // Build score lookup for heatmap.
  //
  // The page now drives this from a date range (month_from → month_to)
  // instead of a single (year, month). Each cell aggregates every score
  // for the (member × kpi_type) inside the active range:
  //   • score: arithmetic mean across the months that have a non-null
  //     score (so a 3-month gap doesn't drag the average to zero).
  //   • target: latest non-null target in the range — targets do shift
  //     over time and "now" is the most relevant.
  // For Second Reviews — which is a count, not a score — the mean across
  // months still reads as "avg per month in the range", which is the
  // same framing the per-card detail uses, so there's no divergence.
  const scoreMap = useMemo(() => {
    type Agg = { sum: number; n: number; latestTarget: number | null; latestYM: number };
    const agg = new Map<string, Agg>();
    for (const s of scores) {
      const key = `${s.team_member_id}-${s.kpi_type}`;
      const ym = s.year * 100 + s.month;
      let row = agg.get(key);
      if (!row) {
        row = { sum: 0, n: 0, latestTarget: null, latestYM: -1 };
        agg.set(key, row);
      }
      if (s.score !== null && s.score !== undefined) {
        row.sum += s.score;
        row.n += 1;
      }
      if (ym > row.latestYM) {
        row.latestYM = ym;
        row.latestTarget = s.target ?? null;
      }
    }
    const out = new Map<string, { score: number | null; target: number | null }>();
    for (const [k, v] of agg.entries()) {
      out.set(k, {
        score: v.n > 0 ? Math.round((v.sum / v.n) * 10) / 10 : null,
        target: v.latestTarget,
      });
    }
    return out;
  }, [scores]);

  // Determine all KPI columns for the heatmap (union of all member KPI types)
  const allKpiTypes = useMemo(() => {
    const types = new Set<string>();
    for (const m of members) {
      const kpiTypes = getKpiTypesForRole(m.role);
      kpiTypes.forEach((t) => types.add(t));
    }
    return Array.from(types);
  }, [members]);

  const handleRowClick = useCallback((memberId: number) => {
    const el = memberRefs.current.get(memberId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Flash effect
      el.classList.add("ring-1", "ring-[#42CA80]/50");
      setTimeout(() => {
        el.classList.remove("ring-1", "ring-[#42CA80]/50");
      }, 1500);
    }
  }, []);

  if (members.length === 0) {
    return (
      <div className="mt-4">
        <p className="text-center text-sm text-[#606060]">
          No team members found for the selected filters.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-5">
      {/* KPI Overview Heatmap */}
      <section id="kpi-overview" className="scroll-mt-[140px] space-y-3">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
          KPI Overview <DataSourceBadge type="live" source="Revision Rate / Turnaround / Second Reviews from Notion. Quality + Mentorship use scored sheets." />
        </h3>
        <p className="text-[10px] font-mono text-[#606060] -mt-1">
          One row per team member with one cell per KPI. Green ≥ target, amber within 10% of target, red below. Click any cell to scroll to that member&apos;s detailed card.
        </p>
        <div className="table-scroll rounded-xl border border-[#2a2a2a] bg-[#161616]">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-[#1F1F1F] px-3 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-[#606060]">
                  Team Member
                </th>
                <th className="bg-[#1F1F1F] px-2 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-[#606060]">
                  Pod
                </th>
                {allKpiTypes.map((kpiType) => (
                  <th
                    key={kpiType}
                    className="bg-[#1F1F1F] px-2 py-2 text-center font-mono text-[10px] font-medium uppercase tracking-wider text-[#606060]"
                  >
                    <KpiColumnHeader kpiType={kpiType} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((member, idx) => {
                const memberKpiTypes = getKpiTypesForRole(member.role);
                const podColor =
                  POD_COLORS[member.pod ?? ""] ??
                  "bg-[#606060]/15 text-[#909090] border-[#606060]/30";

                return (
                  <tr
                    key={member.id}
                    className="cursor-pointer border-t border-[#2a2a2a] transition-colors hover:bg-[#1F1F1F] animate-fade-slide"
                    style={{ animationDelay: `${idx * 30}ms` }}
                    onClick={() => handleRowClick(member.id)}
                  >
                    <td className="sticky left-0 z-10 bg-[#161616] px-3 py-2 text-sm font-semibold text-white whitespace-nowrap">
                      {member.name}
                    </td>
                    <td className="px-2 py-2">
                      {member.pod ? (
                        <Badge
                          variant="outline"
                          className={cn("text-[10px]", podColor)}
                        >
                          {member.pod}
                        </Badge>
                      ) : (
                        <span className="text-xs text-[#606060]">{"\u2014"}</span>
                      )}
                    </td>
                    {allKpiTypes.map((kpiType) => {
                      const applicable = memberKpiTypes.includes(kpiType);
                      if (!applicable) {
                        return (
                          <td
                            key={kpiType}
                            className="px-2 py-2 text-center"
                          >
                            <span className="text-[10px] text-[#404040]">{"\u2014"}</span>
                          </td>
                        );
                      }
                      const key = `${member.id}-${kpiType}`;
                      const kpi = scoreMap.get(key);
                      const score = kpi?.score ?? null;
                      const target = kpi?.target ?? null;
                      const bgColor = getHeatmapColor(kpiType, score, target);
                      const textColor = getHeatmapTextColor(kpiType, score, target);

                      return (
                        <td
                          key={kpiType}
                          className={cn(
                            "px-2 py-2 text-center",
                            bgColor
                          )}
                        >
                          <span
                            className={cn(
                              "font-mono text-xs font-bold",
                              textColor
                            )}
                          >
                            {score !== null ? score.toFixed(1) : "\u2014"}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pod groups with KPI Cards */}
      <div id="kpi-pods" className="scroll-mt-[140px] space-y-5">
      {grouped.map(([pod, podMembers]) => {
        const stats = podStats.get(pod);
        const podColor =
          POD_COLORS[pod] ??
          "bg-[#606060]/15 text-[#909090] border-[#606060]/30";

        return (
          <div key={pod} className="space-y-4">
            {/* Pod Header */}
            <div className="flex items-center gap-3">
              <Badge variant="outline" className={cn("text-sm", podColor)}>
                {pod}
              </Badge>
              <div className="flex items-center gap-4 text-xs text-[#C4BCAA]">
                {stats?.avgUtilization !== null && (
                  <span className="font-mono">
                    Avg Utilization:{" "}
                    <span className="font-semibold text-white">
                      {stats?.avgUtilization?.toFixed(1) ?? "\u2014"}
                    </span>
                  </span>
                )}
                {stats?.avgQuality !== null && (
                  <span className="font-mono">
                    Avg Quality:{" "}
                    <span className="font-semibold text-white">
                      {stats?.avgQuality?.toFixed(1) ?? "\u2014"}
                    </span>
                  </span>
                )}
              </div>
            </div>

            {/* KPI Cards Grid */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {podMembers.map((member) => (
                <div
                  key={member.id}
                  ref={(el) => {
                    if (el) {
                      memberRefs.current.set(member.id, el);
                    }
                  }}
                  className="transition-all duration-300"
                >
                  <KpiCard
                    member={member}
                    scores={allScores}
                    month={month}
                    year={year}
                    clients={clientMap}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: Capacity Projections
// ---------------------------------------------------------------------------

function CapacityProjectionsTab({
  capacity,
}: {
  capacity: CapacityProjection[];
}) {
  // Compute summary stats
  const summary = useMemo(() => {
    const utilizations: number[] = [];
    let podsOptimal = 0;
    let podsOver = 0;

    // Group by pod+month to get unique entries
    const byPodMonth = new Map<string, CapacityProjection>();
    for (const c of capacity) {
      const key = `${c.pod}-${c.year}-${c.month}`;
      byPodMonth.set(key, c);
    }

    for (const c of byPodMonth.values()) {
      const total = c.total_capacity ?? 0;
      const projected = c.projected_used_capacity ?? 0;
      if (total > 0) {
        const util = (projected / total) * 100;
        utilizations.push(util);
        if (util >= 80 && util <= 85) podsOptimal++;
        if (util > 100) podsOver++;
      }
    }

    const avgUtil =
      utilizations.length > 0
        ? Math.round(
            (utilizations.reduce((a, b) => a + b, 0) / utilizations.length) * 10
          ) / 10
        : 0;

    // Total available bandwidth for current month
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    let totalAvailableBandwidth = 0;
    let hasBandwidthData = false;
    for (const c of byPodMonth.values()) {
      if (c.year === currentYear && c.month === currentMonth) {
        const total = c.total_capacity ?? 0;
        const projected = c.projected_used_capacity ?? 0;
        totalAvailableBandwidth += total - projected;
        hasBandwidthData = true;
      }
    }

    return { avgUtil, podsOptimal, podsOver, totalAvailableBandwidth, hasBandwidthData };
  }, [capacity]);

  // Table rows sorted by pod then date
  const tableRows = useMemo(() => {
    return [...capacity].sort((a, b) => {
      const podCmp = a.pod.localeCompare(b.pod);
      if (podCmp !== 0) return podCmp;
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });
  }, [capacity]);

  return (
    <div className="mt-3 space-y-5">
      {/* Summary Row */}
      <div id="capacity-summary" className="mb-1 scroll-mt-[140px]">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">Capacity Summary</span>
          <DataSourceBadge type="live" source="Pod-level monthly capacity projections + utilization." />
        </div>
        <p className="text-[10px] font-mono text-[#606060] mt-0.5">
          Roll-ups across all pods: avg utilization, pods in the 80–85% optimal band, pods over 100%, and total available bandwidth for the current month.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title="Overall Avg Utilization"
          value={`${summary.avgUtil.toFixed(1)}%`}
          valueColor={
            summary.avgUtil >= 80 && summary.avgUtil <= 85 ? "green" : "white"
          }
        />
        <SummaryCard
          title="Pods At Optimal (80-85%)"
          value={summary.podsOptimal}
          valueColor="green"
        />
        <SummaryCard
          title="Pods Over Capacity (>100%)"
          value={summary.podsOver}
          valueColor={summary.podsOver > 0 ? "red" : "green"}
        />
        <SummaryCard
          title="Total Available Bandwidth"
          value={
            summary.hasBandwidthData
              ? summary.totalAvailableBandwidth
              : "N/A"
          }
          valueColor={
            !summary.hasBandwidthData
              ? "white"
              : summary.totalAvailableBandwidth >= 0
                ? "green"
                : "red"
          }
          description="Current month: capacity - projected"
        />
      </div>

      {/* Capacity Chart */}
      <div id="capacity-chart" className="scroll-mt-[140px] rounded-xl border border-[#2a2a2a] bg-[#161616] p-6">
        <div className="mb-4">
          <h4 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
            Utilization by Pod <DataSourceBadge type="live" source="Sheet: 'ET CP 2026 [V11 Mar 2026]' — Spreadsheet: Editorial Capacity Planning. Monthly pod-level capacity projections and utilization." />
          </h4>
          <p className="text-[10px] font-mono text-[#606060] mt-0.5">
            Per-pod monthly utilization = projected workload ÷ pod capacity. Reference bands at 80% and 100% show the optimal zone and the over-capacity line.
          </p>
        </div>
        <CapacityChart data={capacity} />
      </div>

      {/* Capacity Table */}
      <h3 id="capacity-detail" className="scroll-mt-[140px] font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
        Capacity Detail <DataSourceBadge type="live" source="Per-pod monthly capacity, projected vs. actual usage." />
      </h3>
      <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] table-scroll">
        <Table>
          <TableHeader>
            <TableRow className="border-[#2a2a2a] hover:bg-transparent">
              <TableHead className="text-xs text-[#C4BCAA]">Editorial Pod</TableHead>
              <TableHead className="text-xs text-[#C4BCAA]">Month</TableHead>
              <TableHead className="text-xs text-[#C4BCAA]">
                Total Capacity
              </TableHead>
              <TableHead className="text-xs text-[#C4BCAA]">
                Projected Articles
              </TableHead>
              <TableHead className="text-xs text-[#C4BCAA]">
                Actual Used
              </TableHead>
              <TableHead className="text-xs text-[#C4BCAA]">
                Available
              </TableHead>
              <TableHead className="text-xs text-[#C4BCAA]">
                Variance
              </TableHead>
              <TableHead className="text-xs text-[#C4BCAA]">
                Utilization %
              </TableHead>
              <TableHead className="text-xs text-[#C4BCAA]">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tableRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-[#606060]">
                  No capacity data available.
                </TableCell>
              </TableRow>
            ) : (
              tableRows.map((row, idx) => {
                const total = row.total_capacity ?? 0;
                const projected = row.projected_used_capacity ?? 0;
                const actual = row.actual_used_capacity ?? 0;
                const utilPct =
                  total > 0
                    ? Math.round((projected / total) * 1000) / 10
                    : 0;
                const status = getCapacityStatus(utilPct);

                return (
                  <TableRow
                    key={row.id}
                    className="border-[#2a2a2a] hover:bg-[#1F1F1F] animate-fade-slide"
                    style={{ animationDelay: `${idx * 30}ms` }}
                  >
                    <TableCell>
                      <CapacityPodBadge pod={row.pod} />
                    </TableCell>
                    <TableCell className="font-mono text-xs text-[#C4BCAA]">
                      {MONTH_SHORT[row.month]} {row.year}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-white">
                      {total}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-white">
                      {projected}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-white">
                      {actual > 0 ? actual : "\u2014"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "font-mono text-xs font-semibold",
                        total - projected < 0
                          ? "text-[#ED6958]"
                          : "text-white"
                      )}
                    >
                      {total - projected}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "font-mono text-xs font-semibold",
                        projected - total > 0
                          ? "text-[#ED6958]"
                          : "text-white"
                      )}
                    >
                      {projected - total > 0
                        ? `+${projected - total}`
                        : projected - total}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "font-mono text-xs font-semibold",
                        utilPct >= 80 && utilPct <= 85
                          ? "text-[#42CA80]"
                          : utilPct > 100
                            ? "text-[#ED6958]"
                            : utilPct > 85
                              ? "text-[#F5BC4E]"
                              : "text-[#ED6958]"
                      )}
                    >
                      {utilPct.toFixed(1)}%
                    </TableCell>
                    <TableCell>{status}</TableCell>
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
// Helpers
// ---------------------------------------------------------------------------

function CapacityPodBadge({ pod }: { pod: string }) {
  const color =
    POD_COLORS[pod] ?? "bg-[#606060]/15 text-[#909090] border-[#606060]/30";
  return (
    <Badge variant="outline" className={color}>
      {pod}
    </Badge>
  );
}

function getCapacityStatus(utilPct: number) {
  if (utilPct >= 80 && utilPct <= 85) {
    return (
      <Badge
        variant="outline"
        className="bg-[#42CA80]/15 text-[#42CA80] border-[#42CA80]/30"
      >
        Optimal
      </Badge>
    );
  }
  if (utilPct > 85 && utilPct <= 100) {
    return (
      <Badge
        variant="outline"
        className="bg-[#F5BC4E]/15 text-[#F5BC4E] border-[#F5BC4E]/30"
      >
        Warning
      </Badge>
    );
  }
  if (utilPct > 100) {
    return (
      <Badge
        variant="outline"
        className="bg-[#ED6958]/15 text-[#ED6958] border-[#ED6958]/30"
      >
        Over
      </Badge>
    );
  }
  // Under 80%
  return (
    <Badge
      variant="outline"
      className="bg-[#ED6958]/15 text-[#ED6958] border-[#ED6958]/30"
    >
      Under
    </Badge>
  );
}
