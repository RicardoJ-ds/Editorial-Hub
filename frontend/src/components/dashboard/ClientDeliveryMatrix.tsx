"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiGet } from "@/lib/api";
import type {
  Client,
  ClientMonthRow,
  ClientAlltimeRow,
  WeeklyDetailRow,
  ClientDeliveryResponse,
} from "@/lib/types";
import { SummaryCard } from "./SummaryCard";
import { DataSourceBadge } from "./DataSourceBadge";
import { cn } from "@/lib/utils";
import { ChevronRight, ChevronDown } from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POD_COLORS: Record<string, string> = {
  "Pod 1": "bg-[#5B9BF5]/15 text-[#5B9BF5] border-[#5B9BF5]/30",
  "Pod 2": "bg-[#42CA80]/15 text-[#42CA80] border-[#42CA80]/30",
  "Pod 3": "bg-[#F5C542]/15 text-[#F5C542] border-[#F5C542]/30",
  "Pod 4": "bg-[#F28D59]/15 text-[#F28D59] border-[#F28D59]/30",
  "Pod 5": "bg-[#ED6958]/15 text-[#ED6958] border-[#ED6958]/30",
};

const POD_BORDER_COLORS: Record<string, string> = {
  "Pod 1": "#5B9BF5",
  "Pod 2": "#42CA80",
  "Pod 3": "#F5C542",
  "Pod 4": "#F28D59",
  "Pod 5": "#ED6958",
};

const MONTHS = [
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function podBadge(pod: string | null) {
  if (!pod) return <span className="text-[#606060]">{"\u2014"}</span>;
  const color = POD_COLORS[pod] ?? "bg-secondary text-secondary-foreground";
  return (
    <Badge variant="outline" className={cn("text-[10px]", color)}>
      {pod}
    </Badge>
  );
}

function pctColor(v: number | null): string {
  if (v == null) return "text-[#606060]";
  if (v >= 75) return "text-[#42CA80]";
  if (v >= 50) return "text-[#F5C542]";
  return "text-[#ED6958]";
}

function varianceDisplay(v: number | null) {
  if (v == null) return <span className="text-[#606060]">{"\u2014"}</span>;
  const color =
    v > 0 ? "text-[#42CA80]" : v < 0 ? "text-[#ED6958]" : "text-[#C4BCAA]";
  return (
    <span className={cn("font-mono text-xs font-semibold", color)}>
      {v > 0 ? `+${v}` : v}
    </span>
  );
}

function val(v: number | null | undefined): string {
  if (v == null) return "\u2014";
  return String(v);
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; className: string }> = {
    ACTIVE: { label: "Active", className: "bg-[#42CA80]/15 text-[#42CA80] border-[#42CA80]/30" },
    COMPLETED: { label: "Completed", className: "bg-[#606060]/15 text-[#606060] border-[#606060]/30" },
    CANCELLED: { label: "Cancelled", className: "bg-[#ED6958]/15 text-[#ED6958] border-[#ED6958]/30" },
    SOON_TO_BE_ACTIVE: { label: "Soon", className: "bg-[#F5C542]/15 text-[#F5C542] border-[#F5C542]/30" },
    INACTIVE: { label: "Inactive", className: "bg-[#606060]/15 text-[#606060] border-[#606060]/30" },
  };
  const cfg = map[status] ?? { label: status, className: "bg-[#606060]/15 text-[#606060]" };
  return (
    <Badge variant="outline" className={cn("text-[10px]", cfg.className)}>
      {cfg.label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Lens = "monthly" | "alltime";

interface Props {
  filteredClients?: Client[];
}

export function ClientDeliveryMatrix({ filteredClients }: Props) {
  const [lens, setLens] = useState<Lens>("monthly");
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(3);
  const [data, setData] = useState<ClientDeliveryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [weeklyCache, setWeeklyCache] = useState<Record<string, WeeklyDetailRow[]>>({});
  const [weeklyLoading, setWeeklyLoading] = useState<Set<string>>(new Set());

  // Fetch data when lens/year/month changes
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ view: lens });
    if (lens === "monthly") {
      params.set("year", String(year));
      params.set("month", String(month));
    }
    apiGet<ClientDeliveryResponse>(`/api/dashboard/client-delivery?${params}`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [lens, year, month]);

  // Filter by global FilterBar
  const filteredMonthly = useMemo(() => {
    if (!data?.monthly_rows) return [];
    if (!filteredClients?.length) return data.monthly_rows;
    const ids = new Set(filteredClients.map((c) => c.id));
    return data.monthly_rows.filter((r) => ids.has(r.client_id));
  }, [data, filteredClients]);

  const filteredAlltime = useMemo(() => {
    if (!data?.alltime_rows) return [];
    if (!filteredClients?.length) return data.alltime_rows;
    const ids = new Set(filteredClients.map((c) => c.id));
    return data.alltime_rows.filter((r) => r.client_id && ids.has(r.client_id));
  }, [data, filteredClients]);

  // Expand/collapse row for weekly drill-down
  const toggleExpand = useCallback(
    (clientName: string) => {
      const key = `${clientName}|${year}|${month}`;
      setExpandedRows((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
          // Lazy-load weekly detail
          if (!weeklyCache[key]) {
            setWeeklyLoading((wl) => new Set(wl).add(key));
            apiGet<ClientDeliveryResponse>(
              `/api/dashboard/client-delivery?view=weekly&client_name=${encodeURIComponent(clientName)}&year=${year}&month=${month}`
            )
              .then((resp) => {
                setWeeklyCache((c) => ({ ...c, [key]: resp.weekly_rows ?? [] }));
              })
              .catch(() => {
                setWeeklyCache((c) => ({ ...c, [key]: [] }));
              })
              .finally(() => {
                setWeeklyLoading((wl) => {
                  const n = new Set(wl);
                  n.delete(key);
                  return n;
                });
              });
          }
        }
        return next;
      });
    },
    [year, month, weeklyCache]
  );

  // Summary stats
  const monthlySummary = useMemo(() => {
    const rows = filteredMonthly;
    const totalSow = rows.reduce((a, r) => a + (r.articles_sow_target ?? 0), 0);
    const totalDelivered = rows.reduce((a, r) => a + (r.articles_delivered ?? 0), 0);
    const totalInvoiced = rows.reduce((a, r) => a + (r.articles_invoiced ?? 0), 0);
    const totalVariance = rows.reduce((a, r) => a + (r.variance ?? 0), 0);
    const cbRows = rows.filter((r) => r.cb_monthly_goal && r.cb_monthly_goal > 0);
    const avgCb = cbRows.length > 0 ? Math.round(cbRows.reduce((a, r) => a + (r.cb_pct ?? 0), 0) / cbRows.length) : 0;
    const adRows = rows.filter((r) => r.ad_monthly_goal && r.ad_monthly_goal > 0);
    const avgAd = adRows.length > 0 ? Math.round(adRows.reduce((a, r) => a + (r.ad_pct ?? 0), 0) / adRows.length) : 0;
    return { totalSow, totalDelivered, totalInvoiced, totalVariance, avgCb, avgAd, clientCount: rows.length };
  }, [filteredMonthly]);

  if (loading) {
    return (
      <div className="mt-3 space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[90px]" />
          ))}
        </div>
        <Skeleton className="h-[500px]" />
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-5">
      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Lens switcher */}
        <div className="flex rounded-lg border border-[#2a2a2a] overflow-hidden">
          {(["monthly", "alltime"] as Lens[]).map((l) => (
            <button
              key={l}
              onClick={() => { setLens(l); setExpandedRows(new Set()); }}
              className={cn(
                "px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
                lens === l
                  ? "bg-[#42CA80]/15 text-[#42CA80]"
                  : "text-[#606060] hover:text-white hover:bg-[#1F1F1F]"
              )}
            >
              {l === "monthly" ? "Monthly" : "Pipeline"}
            </button>
          ))}
        </div>

        {lens === "monthly" && (
          <>
            <div className="h-4 w-px bg-[#2a2a2a]" />
            <div className="flex items-center gap-2">
              <label className="font-mono text-xs text-[#606060] uppercase tracking-wider">Year</label>
              <Select value={String(year)} onValueChange={(v) => v && setYear(Number(v))}>
                <SelectTrigger size="sm" className="w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[2025, 2026, 2027].map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <label className="font-mono text-xs text-[#606060] uppercase tracking-wider">Month</label>
              <Select value={String(month)} onValueChange={(v) => v && setMonth(Number(v))}>
                <SelectTrigger size="sm" className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        <div className="ml-auto">
          <DataSourceBadge
            type="live"
            source="Sheet: 'Delivered vs Invoiced v2' + 'Editorial Operating Model' + 'Goals vs Delivery' — Spreadsheet: Editorial Capacity Planning + Master Tracker. Joined view across all delivery data sources."
          />
        </div>
      </div>

      {/* Monthly View */}
      {lens === "monthly" && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            <SummaryCard title="Clients" value={monthlySummary.clientCount} valueColor="green" />
            <SummaryCard
              title="SOW / Delivered"
              value={`${monthlySummary.totalDelivered} / ${monthlySummary.totalSow}`}
              valueColor={monthlySummary.totalDelivered > 0 ? "green" : "white"}
            />
            <SummaryCard title="Invoiced" value={monthlySummary.totalInvoiced} />
            <SummaryCard
              title="Variance"
              value={monthlySummary.totalVariance > 0 ? `+${monthlySummary.totalVariance}` : String(monthlySummary.totalVariance)}
              valueColor={monthlySummary.totalVariance >= 0 ? "green" : "white"}
            />
            <SummaryCard
              title="Avg CB %"
              value={`${monthlySummary.avgCb}%`}
              valueColor={monthlySummary.avgCb >= 75 ? "green" : "white"}
            />
            <SummaryCard
              title="Avg AD %"
              value={`${monthlySummary.avgAd}%`}
              valueColor={monthlySummary.avgAd >= 75 ? "green" : "white"}
            />
          </div>

          {/* Matrix table */}
          <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] table-scroll">
            <Table>
              <TableHeader>
                <TableRow className="border-[#2a2a2a] hover:bg-transparent">
                  <TableHead className="text-xs text-[#C4BCAA] w-6" />
                  <TableHead className="text-xs text-[#C4BCAA]">Client</TableHead>
                  <TableHead className="text-xs text-[#C4BCAA]">Status</TableHead>
                  <TableHead className="text-xs text-[#C4BCAA]">Pod</TableHead>
                  <TableHead className="text-xs text-[#C4BCAA]">SOW</TableHead>
                  <TableHead className="text-xs text-[#C4BCAA]">Delivered</TableHead>
                  <TableHead className="text-xs text-[#C4BCAA]">Invoiced</TableHead>
                  <TableHead className="text-xs text-[#C4BCAA]">Variance</TableHead>
                  <TableHead className="text-xs text-[#C4BCAA]">CB %</TableHead>
                  <TableHead className="text-xs text-[#C4BCAA]">AD %</TableHead>
                  <TableHead className="text-xs text-[#C4BCAA]">Prod Act/Prj</TableHead>
                  <TableHead className="text-xs text-[#C4BCAA]">% Complete</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMonthly.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center text-[#606060] py-8">
                      No data for the selected period.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredMonthly.map((row, idx) => {
                    const key = `${row.client_name}|${year}|${month}`;
                    const isExpanded = expandedRows.has(key);
                    const weeks = weeklyCache[key];
                    const isWeeklyLoading = weeklyLoading.has(key);
                    const podColor = POD_BORDER_COLORS[row.editorial_pod ?? ""] ?? "#2a2a2a";

                    return (
                      <React.Fragment key={`${row.client_id}-${row.year}-${row.month}`}>
                        <TableRow
                          className={cn(
                            "border-[#2a2a2a] hover:bg-[#1F1F1F] animate-fade-slide cursor-pointer",
                            isExpanded && "bg-[#1a1a1a]"
                          )}
                          style={{
                            animationDelay: `${idx * 30}ms`,
                            borderLeft: `3px solid ${podColor}`,
                          }}
                          onClick={() => row.weeks_with_data > 0 && toggleExpand(row.client_name)}
                        >
                          <TableCell className="w-6 px-2">
                            {row.weeks_with_data > 0 ? (
                              isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5 text-[#42CA80]" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 text-[#606060]" />
                              )
                            ) : null}
                          </TableCell>
                          <TableCell className="font-semibold text-white">{row.client_name}</TableCell>
                          <TableCell>{statusBadge(row.status)}</TableCell>
                          <TableCell>{podBadge(row.editorial_pod)}</TableCell>
                          <TableCell className="font-mono text-xs text-white">{val(row.articles_sow_target)}</TableCell>
                          <TableCell className="font-mono text-xs text-white">{val(row.articles_delivered)}</TableCell>
                          <TableCell className="font-mono text-xs text-white">{val(row.articles_invoiced)}</TableCell>
                          <TableCell>{varianceDisplay(row.variance)}</TableCell>
                          <TableCell>
                            {row.cb_pct != null ? (
                              <div className="flex items-center gap-1.5">
                                <span className={cn("font-mono text-xs font-semibold", pctColor(row.cb_pct))}>
                                  {row.cb_pct}%
                                </span>
                                <div className="w-12">
                                  <Progress value={Math.min(row.cb_pct, 100)} className="h-1" />
                                </div>
                              </div>
                            ) : (
                              <span className="text-[#606060] text-xs">{"\u2014"}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {row.ad_pct != null ? (
                              <div className="flex items-center gap-1.5">
                                <span className={cn("font-mono text-xs font-semibold", pctColor(row.ad_pct))}>
                                  {row.ad_pct}%
                                </span>
                                <div className="w-12">
                                  <Progress value={Math.min(row.ad_pct, 100)} className="h-1" />
                                </div>
                              </div>
                            ) : (
                              <span className="text-[#606060] text-xs">{"\u2014"}</span>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {row.articles_actual != null || row.articles_projected != null ? (
                              <span>
                                <span className="text-white">{val(row.articles_actual)}</span>
                                <span className="text-[#606060]">/</span>
                                <span className="text-[#606060]">{val(row.articles_projected)}</span>
                              </span>
                            ) : (
                              <span className="text-[#606060]">{"\u2014"}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {row.pct_complete != null && row.pct_complete > 0 ? (
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-xs text-white w-8">{row.pct_complete}%</span>
                                <div className="w-14">
                                  <Progress value={Math.min(row.pct_complete, 100)} className="h-1" />
                                </div>
                              </div>
                            ) : (
                              <span className="text-[#606060] text-xs">{"\u2014"}</span>
                            )}
                          </TableCell>
                        </TableRow>

                        {/* Expanded weekly detail */}
                        {isExpanded && (
                          <TableRow className="border-[#2a2a2a] bg-[#0d0d0d]">
                            <TableCell colSpan={12} className="p-0">
                              <div className="px-8 py-3 animate-fade-slide">
                                {isWeeklyLoading ? (
                                  <div className="flex gap-3">
                                    {[1, 2, 3, 4].map((i) => (
                                      <Skeleton key={i} className="h-16 flex-1" />
                                    ))}
                                  </div>
                                ) : weeks && weeks.length > 0 ? (
                                  <div className="flex gap-3 overflow-x-auto pb-1">
                                    {weeks.map((w) => (
                                      <div
                                        key={w.week_number}
                                        className="flex-shrink-0 rounded-lg border border-[#2a2a2a] bg-[#161616] p-3 min-w-[180px]"
                                      >
                                        <div className="font-mono text-[10px] text-[#606060] uppercase tracking-wider mb-2">
                                          Week {w.week_number}
                                          {w.week_date && (
                                            <span className="ml-1 text-[#444]">
                                              {new Date(w.week_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                            </span>
                                          )}
                                        </div>
                                        <div className="space-y-1.5">
                                          <div className="flex justify-between items-center">
                                            <span className="text-[10px] text-[#606060]">CB</span>
                                            <span className="font-mono text-xs text-white">
                                              +{w.cb_delivered_today ?? 0}
                                              <span className="text-[#606060] ml-1">({w.cb_delivered_to_date ?? 0}/{w.cb_monthly_goal ?? "—"})</span>
                                            </span>
                                          </div>
                                          <div className="flex justify-between items-center">
                                            <span className="text-[10px] text-[#606060]">AD</span>
                                            <span className="font-mono text-xs text-white">
                                              +{w.ad_delivered_today ?? 0}
                                              <span className="text-[#606060] ml-1">({w.ad_delivered_to_date ?? 0}/{w.ad_monthly_goal ?? "—"})</span>
                                            </span>
                                          </div>
                                          {(w.ad_revisions ?? 0) > 0 && (
                                            <div className="flex justify-between items-center">
                                              <span className="text-[10px] text-[#606060]">Rev</span>
                                              <span className="font-mono text-xs text-[#F5C542]">{w.ad_revisions}</span>
                                            </div>
                                          )}
                                          {(w.ad_cb_backlog ?? 0) > 0 && (
                                            <div className="flex justify-between items-center">
                                              <span className="text-[10px] text-[#606060]">Backlog</span>
                                              <span className="font-mono text-xs text-[#ED6958]">{w.ad_cb_backlog}</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-[#606060]">No weekly data available.</p>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Pipeline (All-time) View */}
      {lens === "alltime" && (
        <>
          <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] table-scroll">
            <Table>
              <TableHeader>
                <TableRow className="border-[#2a2a2a] hover:bg-transparent">
                  <TableHead className="text-xs text-[#C4BCAA]">Client</TableHead>
                  <TableHead className="text-xs text-[#C4BCAA]">Status</TableHead>
                  <TableHead className="text-xs text-[#C4BCAA]">Pod</TableHead>
                  <TableHead className="text-xs text-[#C4BCAA]">SOW</TableHead>
                  <TableHead className="text-xs text-[#C4BCAA]">Delivered</TableHead>
                  <TableHead className="text-xs text-[#C4BCAA]">Topics</TableHead>
                  <TableHead className="text-xs text-[#C4BCAA]">CBs</TableHead>
                  <TableHead className="text-xs text-[#C4BCAA]">Articles</TableHead>
                  <TableHead className="text-xs text-[#C4BCAA]">Published</TableHead>
                  <TableHead className="text-xs text-[#C4BCAA]">Approval %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAlltime.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-[#606060] py-8">
                      No pipeline data available.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredAlltime.map((row, idx) => {
                    const podColor = POD_BORDER_COLORS[row.editorial_pod ?? row.account_team_pod ?? ""] ?? "#2a2a2a";
                    return (
                      <TableRow
                        key={row.client_id ?? row.client_name}
                        className="border-[#2a2a2a] hover:bg-[#1F1F1F] animate-fade-slide"
                        style={{
                          animationDelay: `${idx * 30}ms`,
                          borderLeft: `3px solid ${podColor}`,
                        }}
                      >
                        <TableCell className="font-semibold text-white">{row.client_name}</TableCell>
                        <TableCell>{statusBadge(row.status ?? "ACTIVE")}</TableCell>
                        <TableCell>{podBadge(row.editorial_pod ?? row.account_team_pod)}</TableCell>
                        <TableCell className="font-mono text-xs text-white">{val(row.articles_sow)}</TableCell>
                        <TableCell className="font-mono text-xs text-white">{val(row.articles_delivered)}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {row.topics_sent != null ? (
                            <span>
                              <span className="text-white">{row.topics_approved}</span>
                              <span className="text-[#606060]">/{row.topics_sent}</span>
                            </span>
                          ) : (
                            <span className="text-[#606060]">{"\u2014"}</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {row.cbs_sent != null ? (
                            <span>
                              <span className="text-white">{row.cbs_approved}</span>
                              <span className="text-[#606060]">/{row.cbs_sent}</span>
                            </span>
                          ) : (
                            <span className="text-[#606060]">{"\u2014"}</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {row.articles_sent != null ? (
                            <span>
                              <span className="text-white">{row.articles_approved}</span>
                              <span className="text-[#606060]">/{row.articles_sent}</span>
                            </span>
                          ) : (
                            <span className="text-[#606060]">{"\u2014"}</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-white">{val(row.published_live)}</TableCell>
                        <TableCell>
                          {row.articles_approval_pct != null ? (
                            <div className="flex items-center gap-1.5">
                              <span className={cn("font-mono text-xs font-semibold", pctColor(row.articles_approval_pct))}>
                                {row.articles_approval_pct}%
                              </span>
                              <div className="w-12">
                                <Progress value={Math.min(row.articles_approval_pct, 100)} className="h-1" />
                              </div>
                            </div>
                          ) : (
                            <span className="text-[#606060] text-xs">{"\u2014"}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
