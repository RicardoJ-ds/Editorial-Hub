"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { TeamKpiFilterBar, type TeamKpiFilters } from "@/components/dashboard/TeamKpiFilterBar";

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
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [kpiScores, setKpiScores] = useState<KpiScore[]>([]);
  const [capacityData, setCapacityData] = useState<CapacityProjection[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Unified filter state
  const [filters, setFilters] = useState<TeamKpiFilters>({
    search: "",
    pod: "All",
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    memberId: "All",
    clientId: "All",
  });

  // Backwards-compat aliases for existing code
  const selectedPod = filters.pod;
  const selectedMonth = filters.month;
  const selectedYear = filters.year;
  const selectedMember = filters.memberId;
  const selectedClient = filters.clientId;
  const searchQuery = filters.search;

  const fetchData = useCallback(async () => {
    try {
      const [members, kpis, capacity, activeClients] = await Promise.all([
        apiGet<TeamMember[]>("/api/team-members/?limit=200"),
        apiGet<KpiScore[]>(
          `/api/kpis/?limit=500&year=${selectedYear}&month=${selectedMonth}`
        ),
        apiGet<CapacityProjection[]>("/api/capacity/?limit=200"),
        apiGet<Client[]>("/api/clients/?status=ACTIVE&limit=100"),
      ]);
      setTeamMembers(members);
      setKpiScores(kpis);
      setCapacityData(capacity);
      setClients(activeClients);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Failed to load team KPI data:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedYear, selectedMonth]);

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

  // Filter members by pod, member selection, and search query
  const filteredMembers = useMemo(() => {
    let result = teamMembers;
    if (selectedPod !== "All") {
      result = result.filter((m) => m.pod === selectedPod);
    }
    if (selectedMember !== "All") {
      result = result.filter((m) => String(m.id) === selectedMember);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((m) => m.name.toLowerCase().includes(q));
    }
    return result;
  }, [teamMembers, selectedPod, selectedMember, searchQuery]);

  // Filter KPI scores by selected client
  const filteredScores = useMemo(() => {
    if (selectedClient === "All") return kpiScores;
    const clientId = Number(selectedClient);
    return kpiScores.filter((s) => s.client_id === clientId);
  }, [kpiScores, selectedClient]);

  // Filter capacity by pod
  const filteredCapacity = useMemo(() => {
    if (selectedPod === "All") return capacityData;
    return capacityData.filter((c) => c.pod === selectedPod);
  }, [capacityData, selectedPod]);

  // Year options from data
  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    years.add(now.getFullYear());
    kpiScores.forEach((k) => years.add(k.year));
    capacityData.forEach((c) => years.add(c.year));
    return Array.from(years).sort((a, b) => b - a);
  }, [kpiScores, capacityData]);

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
        {/* Sticky header: filters + tabs (matching D1 pattern) */}
        <div className="sticky top-14 z-20 bg-black pb-3 -mx-8 px-8 pt-1">
          <div className="flex items-center justify-between mb-3">
            <TeamKpiFilterBar
              teamMembers={teamMembers}
              clients={clients}
              yearOptions={yearOptions}
              filters={filters}
              onFiltersChange={setFilters}
            />
            {lastUpdated && (
              <p className="text-[10px] text-[#606060] font-mono shrink-0 ml-4">
                {lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
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
          </TabsList>
        </div>

        <TabsContent value="kpi-performance">
          {selectedClient !== "All" && filteredScores.length === 0 ? (
            <div className="mt-4">
              <p className="text-center text-sm text-[#606060]">
                No data for this client.
              </p>
            </div>
          ) : (
            <KpiPerformanceTab
              members={filteredMembers}
              scores={filteredScores}
              allScores={kpiScores}
              month={selectedMonth}
              year={selectedYear}
              clientMap={clientMap}
            />
          )}
        </TabsContent>

        <TabsContent value="capacity-projections">
          <CapacityProjectionsTab capacity={filteredCapacity} />
        </TabsContent>

        <TabsContent value="ai-compliance">
          <AIComplianceTab />
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
        <DataSourceBadge type="live" source="Sheet: 'Data' — Spreadsheet: Writer AI Monitoring 2.0. Surfer AI detector v1/v2 scores across 1,168 scanned articles." />
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
        <DataSourceBadge type="live" source="Sheet: 'Data' — Spreadsheet: Writer AI Monitoring 2.0. Recommendation breakdown by pod, client, writer, and monthly trend." />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RecommendationChart data={byPod} title="Recommendation by Pod" />
        <RecommendationChart data={byClient} title="Recommendation by Client" />
        <RecommendationChart data={byWriter} title="Recommendation by Writer" />
        <RecommendationChart data={byMonth} title="Recommendation by Month" />
      </div>

      {/* Flagged Articles Table */}
      <section className="space-y-3">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
          Flagged Articles <DataSourceBadge type="live" source="Sheet: 'Yellow/Red Flags_v2' — Spreadsheet: Writer AI Monitoring 2.0. Articles flagged for AI content review requiring editorial action." />
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
      <section className="space-y-3">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
          Rewrites <DataSourceBadge type="live" source="Sheet: 'Rewrites' — Spreadsheet: Writer AI Monitoring 2.0. Articles requiring full rewrite due to AI compliance failure." />
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
      <section className="space-y-3">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
          Surfer API Usage <DataSourceBadge type="live" source="Sheet: 'Surfer&#39;s API usage' — Spreadsheet: Writer AI Monitoring 2.0. Monthly Surfer API call counts by editorial pod." />
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

  // Build score lookup for heatmap
  const scoreMap = useMemo(() => {
    const map = new Map<string, KpiScore>();
    for (const s of scores) {
      if (s.year === year && s.month === month) {
        const key = `${s.team_member_id}-${s.kpi_type}`;
        map.set(key, s);
      }
    }
    return map;
  }, [scores, year, month]);

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
      <section className="space-y-3">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
          KPI Overview <DataSourceBadge type="live" source="Sheet: 'Notion' — Spreadsheet: Notion Database Export. Revision Rate, Turnaround Time, and Second Reviews computed from 13K+ article records. Other KPIs (Internal/External Quality, Mentorship, Feedback) use simulated data pending scoring rubric." />
        </h3>
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
                    {(KPI_DISPLAY_NAMES[kpiType] ?? kpiType)
                      .split(" ")
                      .map((word, i) => (
                        <span key={i}>
                          {word}
                          {i < (KPI_DISPLAY_NAMES[kpiType] ?? kpiType).split(" ").length - 1 && <br />}
                        </span>
                      ))}
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
      <div className="mb-1 flex items-center gap-2">
        <span className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">Capacity Summary</span>
        <DataSourceBadge type="live" source="Sheet: 'ET CP 2026 [V11 Mar 2026]' — Spreadsheet: Editorial Capacity Planning. Monthly pod-level capacity projections, utilization, and available bandwidth." />
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
      <div className="rounded-xl border border-[#2a2a2a] bg-[#161616] p-6">
        <h4 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060] mb-4">
          Utilization by Pod <DataSourceBadge type="live" source="Sheet: 'ET CP 2026 [V11 Mar 2026]' — Spreadsheet: Editorial Capacity Planning. Monthly pod-level capacity projections and utilization." />
        </h4>
        <CapacityChart data={capacity} />
      </div>

      {/* Capacity Table */}
      <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
        Capacity Detail <DataSourceBadge type="live" source="Sheet: 'ET CP 2026 [V11 Mar 2026]' — Spreadsheet: Editorial Capacity Planning. Per-pod monthly capacity, projected usage, actual usage, and variance." />
      </h3>
      <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] table-scroll">
        <Table>
          <TableHeader>
            <TableRow className="border-[#2a2a2a] hover:bg-transparent">
              <TableHead className="text-xs text-[#C4BCAA]">Pod</TableHead>
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
