"use client";

import React, { useMemo, useState } from "react";
import type { Client } from "@/lib/types";
import { SummaryCard } from "./SummaryCard";
import { DataSourceBadge } from "./DataSourceBadge";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TimeToMetricsProps {
  clients: Client[];
}

interface MilestoneTooltip {
  x: number;
  y: number;
  content: React.ReactNode;
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const dateA = new Date(a);
  const dateB = new Date(b);
  if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) return null;
  return Math.round((dateB.getTime() - dateA.getTime()) / (1000 * 60 * 60 * 24));
}

function statsOf(values: (number | null)[]): {
  avg: number | null; min: number | null; max: number | null; count: number;
} {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return { avg: null, min: null, max: null, count: 0 };
  const avg = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
  return { avg, min: Math.min(...valid), max: Math.max(...valid), count: valid.length };
}

function fmtRange(s: ReturnType<typeof statsOf>): string | undefined {
  if (s.min === null || s.max === null) return undefined;
  return `Min: ${s.min}d / Max: ${s.max}d`;
}

// Reference: Consulting KO (day 0) — always comes first
const REF_FIELD = "consulting_ko_date";
const REF_LABEL = "Consulting KO";

type MetricDef = {
  key: string;
  short: string;
  label: string;
  subtitle: string;
  from?: string;
  to: string;
};

const METRIC_DEFS: MetricDef[] = [
  { key: "cko_eko", short: "CKO → EKO", label: "Consulting KO → Editorial KO", subtitle: "Growth-to-Editorial handoff time", to: "editorial_ko_date" },
  { key: "cko_cb", short: "CKO → CB", label: "Consulting KO → First CB", subtitle: "Consulting kickoff to first content brief approved", to: "first_cb_approved_date" },
  { key: "cko_art", short: "CKO → Article", label: "Consulting KO → First Article", subtitle: "Consulting kickoff to first article delivered", to: "first_article_delivered_date" },
  { key: "cko_fb", short: "CKO → Feedback", label: "Consulting KO → First Feedback", subtitle: "Consulting kickoff to first client feedback", to: "first_feedback_date" },
  { key: "cb_art", short: "CB → Article", label: "First CB → First Article", subtitle: "Content brief approval to article delivery", from: "first_cb_approved_date", to: "first_article_delivered_date" },
  { key: "cko_pub", short: "CKO → Published", label: "Consulting KO → First Published", subtitle: "Full cycle from kickoff to live publication", to: "first_article_published_date" },
  { key: "art_fb", short: "Article → Feedback", label: "First Article → First Feedback", subtitle: "Article delivery to client response time", from: "first_article_delivered_date", to: "first_feedback_date" },
  { key: "fb_pub", short: "Feedback → Published", label: "Feedback → Published", subtitle: "Client feedback to article going live", from: "first_feedback_date", to: "first_article_published_date" },
];

// All milestones in chronological order after CKO
const JOURNEY = [
  { key: "eko", label: "Editorial KO", short: "EKO", field: "editorial_ko_date", color: "#F28D59", shape: "diamond" as const },
  { key: "cb", label: "First CB Approved", short: "CB", field: "first_cb_approved_date", color: "#42CA80", shape: "circle" as const },
  { key: "article", label: "First Article", short: "Article", field: "first_article_delivered_date", color: "#8FB5D9", shape: "circle" as const },
  { key: "feedback", label: "First Feedback", short: "Feedback", field: "first_feedback_date", color: "#F5BC4E", shape: "circle" as const },
  { key: "published", label: "First Published", short: "Published", field: "first_article_published_date", color: "#CEBCF4", shape: "circle" as const },
] as const;

export function TimeToMetrics({ clients }: TimeToMetricsProps) {
  // Card metrics — all relative to Consulting KO
  const cards = useMemo(() => {
    return METRIC_DEFS.map((d) => {
      const from = d.from ?? REF_FIELD;
      const values = clients.map((c) =>
        daysBetween((c as unknown as Record<string, string | null>)[from], (c as unknown as Record<string, string | null>)[d.to])
      );
      return { ...d, stats: statsOf(values) };
    });
  }, [clients]);

  // Per-client milestone data — all days from CKO
  const clientMilestones = useMemo(() => {
    return clients
      .filter((c) => c.consulting_ko_date && c.status === "ACTIVE")
      .map((c) => {
        const entries: { key: string; label: string; days: number; color: string; shape: string }[] = [];
        JOURNEY.forEach((m) => {
          const d = daysBetween(c.consulting_ko_date, (c as unknown as Record<string, string | null>)[m.field]);
          if (d !== null) entries.push({ key: m.key, label: m.label, days: d, color: m.color, shape: m.shape });
        });
        entries.sort((a, b) => a.days - b.days);
        return { client: c, milestones: entries };
      })
      .filter((m) => m.milestones.length > 0)
      .sort((a, b) => {
        const aArt = a.milestones.find((m) => m.key === "article")?.days ?? 999;
        const bArt = b.milestones.find((m) => m.key === "article")?.days ?? 999;
        return aArt - bArt;
      });
  }, [clients]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
          Time-to Metrics
        </h3>
        <DataSourceBadge type="live" source="Sheet: 'Editorial SOW overview' — Spreadsheet: Editorial Capacity Planning. Calculated from milestone date fields: Consulting KO, Editorial KO, First CB, First Article, First Feedback, First Published." />
        <span className="text-[8px] font-mono text-[#404040] ml-auto">Reference: Consulting KO (Day 0)</span>
      </div>

      {/* Row 1: Primary — from Consulting KO */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.slice(0, 4).map((m) => (
          <SummaryCard key={m.key} title={`Avg ${m.short}`} subtitle={m.subtitle} value={m.stats.avg !== null ? `${m.stats.avg} days` : "N/A"} description={fmtRange(m.stats) ?? m.label} />
        ))}
      </div>

      {/* Row 2: Secondary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.slice(4).map((m) => (
          <SummaryCard key={m.key} title={`Avg ${m.short}`} subtitle={m.subtitle} value={m.stats.avg !== null ? `${m.stats.avg} days` : "N/A"} description={fmtRange(m.stats) ?? m.label} />
        ))}
      </div>

      {/* Month-over-month trend */}
      <TimeToTrendChart clients={clients} />

      {/* Waterfall chart */}
      {clientMilestones.length > 0 && <MilestoneWaterfall data={clientMilestones} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month-over-month trend chart
// ---------------------------------------------------------------------------

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthKey(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthKey(key: string): string {
  const [y, m] = key.split("-");
  const mi = parseInt(m, 10) - 1;
  return `${MONTH_LABELS[mi] ?? ""} ${y.slice(2)}`;
}

type GroupMode = "month" | "client";

type TrendBucket = {
  key: string;
  label: string;
  avg: number;
  count: number;
  sublabel?: string;
};

function TimeToTrendChart({ clients }: { clients: Client[] }) {
  const [metricKey, setMetricKey] = useState<string>("cko_art");
  const [groupMode, setGroupMode] = useState<GroupMode>("month");

  const metric = useMemo(
    () => METRIC_DEFS.find((m) => m.key === metricKey) ?? METRIC_DEFS[0],
    [metricKey]
  );

  const { buckets, overallAvg } = useMemo<{
    buckets: TrendBucket[];
    overallAvg: number | null;
  }>(() => {
    const from = metric.from ?? REF_FIELD;
    const all: number[] = [];

    if (groupMode === "month") {
      const grouped = new Map<string, number[]>();
      for (const c of clients) {
        const rec = c as unknown as Record<string, string | null>;
        const days = daysBetween(rec[from], rec[metric.to]);
        if (days === null) continue;
        const key = monthKey(c.consulting_ko_date);
        if (!key) continue;
        all.push(days);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(days);
      }
      const sortedKeys = Array.from(grouped.keys()).sort();
      const buckets: TrendBucket[] = sortedKeys.map((key) => {
        const values = grouped.get(key)!;
        const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
        return { key, label: formatMonthKey(key), avg, count: values.length };
      });
      const overallAvg = all.length
        ? Math.round(all.reduce((a, b) => a + b, 0) / all.length)
        : null;
      return { buckets, overallAvg };
    }

    // groupMode === "client": one bar per client's individual delta.
    const perClient: TrendBucket[] = [];
    for (const c of clients) {
      const rec = c as unknown as Record<string, string | null>;
      const days = daysBetween(rec[from], rec[metric.to]);
      if (days === null) continue;
      all.push(days);
      perClient.push({
        key: `client-${c.id}`,
        label: c.name,
        avg: days,
        count: 1,
        sublabel: c.editorial_pod ?? undefined,
      });
    }
    // Slowest (highest value) first so outliers are obvious when "lower is better".
    perClient.sort((a, b) => b.avg - a.avg);
    const overallAvg = all.length
      ? Math.round(all.reduce((a, b) => a + b, 0) / all.length)
      : null;
    return { buckets: perClient, overallAvg };
  }, [clients, metric, groupMode]);

  // Cap the y-axis so a single extreme cohort doesn't flatten everything else.
  // Use p90 of bucket averages with a sensible floor relative to the overall avg.
  const { scaleMax, actualMax } = useMemo(() => {
    const actualMax = Math.max(1, overallAvg ?? 0, ...buckets.map((b) => b.avg));
    if (buckets.length === 0) return { scaleMax: actualMax, actualMax };
    const sorted = buckets.map((b) => b.avg).slice().sort((a, b) => a - b);
    const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
    const floor = Math.max(10, Math.round((overallAvg ?? 0) * 2));
    const scaleMax = Math.max(1, Math.min(actualMax, Math.max(p90, floor)));
    return { scaleMax, actualMax };
  }, [buckets, overallAvg]);

  const [hover, setHover] = useState<{
    x: number;
    y: number;
    key: string;
    label: string;
    avg: number;
    count: number;
    sublabel?: string;
  } | null>(null);

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <p className="text-[10px] font-mono font-semibold uppercase tracking-widest text-[#C4BCAA] flex items-center gap-2">
            {groupMode === "month" ? "Month-over-Month Trend" : "Per-Client Breakdown"}
            <DataSourceBadge
              type="live"
              source="Sheet: 'Editorial SOW overview' — Spreadsheet: Editorial Capacity Planning. Calculated from Consulting KO, Editorial KO, First CB, First Article, First Feedback, First Published date columns."
            />
          </p>
          <p className="text-[9px] font-mono text-[#606060] mt-0.5">
            {groupMode === "month" ? (
              <>Average {metric.label.toLowerCase()}, bucketed by each client&apos;s {REF_LABEL} month. Lower is better.</>
            ) : (
              <>{metric.label} per client, sorted slowest → fastest. Lower is better.</>
            )}
            {overallAvg !== null && (
              <> Overall avg across all clients: <span className="text-white font-semibold">{overallAvg}d</span>.</>
            )}
            {actualMax > scaleMax && (
              <> Y-axis capped at <span className="text-[#C4BCAA]">{scaleMax}d</span> so outliers don&apos;t flatten the rest — clipped bars marked ↑.</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Group by toggle */}
          <div className="flex items-center gap-1 rounded-md border border-[#2a2a2a] bg-[#0d0d0d] p-0.5">
            <span className="pl-2 pr-1 font-mono text-[9px] text-[#606060] uppercase tracking-wider">
              Group
            </span>
            {(["month", "client"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setGroupMode(m)}
                type="button"
                className={cn(
                  "rounded px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-wider transition-colors",
                  groupMode === m
                    ? "bg-[#42CA80]/15 text-[#65FFAA]"
                    : "text-[#C4BCAA] hover:bg-[#161616] hover:text-white",
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] text-[#606060] uppercase tracking-wider">Metric</span>
            <Select value={metricKey} onValueChange={(v) => v && setMetricKey(v)}>
              <SelectTrigger size="sm" className="w-[280px]">
                <SelectValue>
                  <span className="text-xs">{metric.label}</span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {METRIC_DEFS.map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-medium">{m.label}</span>
                      <span className="font-mono text-[9px] text-[#606060]">{m.short} · {m.subtitle}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {buckets.length === 0 ? (
        <p className="text-center text-xs text-[#606060] py-10">
          Not enough data to compute a {groupMode === "month" ? "trend" : "breakdown"} for the current filters.
        </p>
      ) : (
        <div>
          {/* Chart area — bars + reference line share the same baseline (container bottom) */}
          <div className="relative h-[160px]">
            {/* Bars: column has [label, bar]; the bar sits at the very bottom of the 160px area */}
            <div className="absolute inset-0 flex items-end gap-2">
              {buckets.map((b) => {
                const clipped = b.avg > scaleMax;
                const ratio = clipped ? 1 : b.avg / scaleMax;
                const hPx = Math.max(2, Math.round(ratio * 140));
                const above = overallAvg !== null && b.avg > overallAvg;
                return (
                  <div key={b.key} className="flex-1 flex flex-col items-center gap-1 min-w-0 group/bar">
                    <span className="font-mono text-[9px] text-[#C4BCAA] tabular-nums">
                      {b.avg}d{clipped && <span className="text-[#ED6958]"> ↑</span>}
                    </span>
                    <div
                      className={cn(
                        "w-full transition-all rounded-t",
                        above ? "bg-[#F5BC4E]" : "bg-[#42CA80]",
                        "group-hover/bar:opacity-80",
                        clipped && "ring-1 ring-inset ring-[#ED6958]/70"
                      )}
                      style={{ height: hPx, opacity: 0.85 }}
                      onMouseEnter={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        setHover({
                          x: r.left + r.width / 2,
                          y: r.top - 10,
                          key: b.key,
                          label: b.label,
                          avg: b.avg,
                          count: b.count,
                          sublabel: b.sublabel,
                        });
                      }}
                      onMouseLeave={() => setHover(null)}
                    />
                  </div>
                );
              })}
            </div>

            {/* Reference line (overall average) — measured from the same bottom the bars sit on */}
            {overallAvg !== null && overallAvg > 0 && (
              <div
                className="absolute left-0 right-0 pointer-events-none"
                style={{
                  bottom: `${Math.min(1, overallAvg / scaleMax) * 140}px`,
                  height: 0,
                  borderTop: "1px dashed #42CA80",
                  opacity: 0.7,
                }}
              >
                <span
                  className="absolute right-0 text-[8px] font-mono text-[#42CA80] bg-[#161616] px-1 whitespace-nowrap"
                  style={{ top: -6 }}
                >
                  Overall avg · {overallAvg}d
                </span>
              </div>
            )}
          </div>

          {/* Labels — one per bar, aligned to the same flex widths.
              Client labels rotate 45° so long names fit. */}
          <div className={cn("flex gap-2", groupMode === "client" ? "mt-3 h-[56px]" : "mt-1")}>
            {buckets.map((b) => (
              <span
                key={`lbl-${b.key}`}
                title={b.label}
                className={cn(
                  "flex-1 font-mono text-[8px] text-[#606060] min-w-0",
                  groupMode === "client"
                    ? "origin-top-left rotate-[45deg] whitespace-nowrap overflow-hidden text-ellipsis"
                    : "truncate text-center",
                )}
              >
                {b.label}
              </span>
            ))}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 pt-2 border-t border-[#2a2a2a]">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm bg-[#42CA80]" />
              <span className="text-[9px] font-mono text-[#C4BCAA]">
                Faster — {groupMode === "month" ? "month avg" : "client"} ≤ overall
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm bg-[#F5BC4E]" />
              <span className="text-[9px] font-mono text-[#C4BCAA]">
                Slower — {groupMode === "month" ? "month avg" : "client"} &gt; overall
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-px border-t border-dashed border-[#42CA80]" />
              <span className="text-[9px] font-mono text-[#C4BCAA]">
                Overall average across all clients{overallAvg !== null ? ` (${overallAvg}d)` : ""}
              </span>
            </div>
          </div>

          {/* Tooltip */}
          {hover && (
            <div
              className="fixed z-[9999] pointer-events-none"
              style={{ left: hover.x, top: hover.y, transform: "translate(-50%, -100%)" }}
            >
              <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-lg px-3 py-2 shadow-xl whitespace-nowrap">
                <p className="text-[11px] font-mono font-semibold text-white">{hover.label}</p>
                {hover.sublabel && (
                  <p className="text-[9px] font-mono text-[#606060] mt-0.5">{hover.sublabel}</p>
                )}
                <p className="text-[10px] font-mono text-[#C4BCAA] mt-0.5">
                  {groupMode === "month" ? (
                    <>Avg <span className="text-white">{hover.avg}d</span> · {hover.count} client{hover.count === 1 ? "" : "s"}</>
                  ) : (
                    <><span className="text-white">{hover.avg}d</span></>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Milestone Waterfall
// ---------------------------------------------------------------------------

function MilestoneWaterfall({ data }: { data: { client: Client; milestones: { key: string; label: string; days: number; color: string; shape: string }[] }[] }) {
  const [tip, setTip] = useState<MilestoneTooltip | null>(null);

  const maxDays = useMemo(() => Math.max(14, ...data.flatMap(({ milestones }) => milestones.map((m) => m.days))), [data]);
  const scale = maxDays * 1.12;
  const ROW_H = 34;

  const ticks = useMemo(() => {
    const c = [0, 7, 14, 21, 30, 45, 60, 90, 120, 150];
    return c.filter((d) => d <= scale * 0.9);
  }, [scale]);

  const pct = (d: number) => Math.min(Math.max((d / scale) * 100, 0.5), 95);

  function showTip(e: React.MouseEvent, name: string, label: string, days: number, color: string) {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({
      x: r.left + r.width / 2, y: r.top - 12,
      content: (
        <>
          <p className="text-[13px] font-semibold text-white">{name}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-[12px] font-mono text-[#C4BCAA]">{label}</span>
          </div>
          <p className="text-[13px] font-mono mt-1">
            <span className="text-white font-bold">{days} days</span>
            <span className="text-[#606060]"> from Consulting KO</span>
          </p>
        </>
      ),
    });
  }

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-5 overflow-hidden relative z-0" style={{ isolation: "isolate" }}>
      <div className="mb-5">
        <p className="text-[10px] font-mono font-semibold uppercase tracking-widest text-[#C4BCAA] flex items-center gap-2">
          Client Milestone Journey
          <DataSourceBadge
            type="live"
            source="Sheet: 'Editorial SOW overview' — Spreadsheet: Editorial Capacity Planning. One dot per milestone date per active client. Distance from Day 0 = elapsed days from Consulting KO."
          />
        </p>
        <p className="text-[8px] font-mono text-[#606060] mt-0.5">Days from Consulting KO (day 0) through each milestone to publication. Sorted by fastest to first article.</p>
      </div>

      {/* Scale labels only (no grid lines here) */}
      <div className="grid mb-1" style={{ gridTemplateColumns: "130px 1fr" }}>
        <div />
        <div className="relative h-5 mx-4">
          {ticks.map((d) => (
            <span key={d} className={cn("absolute text-[8px] font-mono", d === 0 ? "text-white font-bold" : "text-[#606060]")} style={{ left: `${pct(d)}%`, transform: "translateX(-50%)" }}>
              {d === 0 ? "CKO" : `${d}d`}
            </span>
          ))}
        </div>
      </div>

      {/* Rows */}
      <div className="max-h-[380px] overflow-hidden rounded">
        <div className="max-h-[380px] overflow-y-auto pt-4 pb-2 relative">
          {/* Grid lines */}
          <div className="absolute inset-0 pointer-events-none" style={{ marginLeft: 130 }}>
            <div className="relative h-full mx-4">
              {ticks.map((d) => (
                <div key={d} className={d === 0 ? "absolute bg-[#444]" : "absolute bg-[#1a1a1a]"} style={{ left: `${pct(d)}%`, top: 0, bottom: 0, width: d === 0 ? 2 : 1 }} />
              ))}
            </div>
          </div>
          {data.map(({ client, milestones: ms }) => {
          const positions = ms.map((m) => m.days);
          const stagger = positions.map((pos, i) => {
            let n = 0;
            for (let j = 0; j < i; j++) if (Math.abs(positions[j] - pos) < 1) n++;
            return n;
          });

          return (
            <div key={client.id} className="grid items-center group/row hover:bg-[#1a1a1a] rounded transition-colors" style={{ gridTemplateColumns: "130px 1fr", height: ROW_H }}>
              <span className="truncate text-[10px] text-[#C4BCAA] font-mono text-right pr-3 group-hover/row:text-white transition-colors">{client.name}</span>
              <div className="relative mx-4" style={{ height: ROW_H - 6 }}>
                {/* Track */}
                <div className="absolute top-1/2 -translate-y-1/2 rounded-full bg-[#1a1a1a]" style={{ left: 0, width: "100%", height: 4 }} />

                {/* CKO marker at day 0 */}
                <div className="absolute cursor-default z-20" style={{ left: `${pct(0)}%`, top: "50%", marginTop: -5, marginLeft: -5 }}
                  onMouseEnter={(e) => showTip(e, client.name, "Consulting KO (Day 0)", 0, "#FFFFFF")}
                  onMouseLeave={() => setTip(null)}>
                  <div className="w-[9px] h-[9px] bg-white rounded-sm rotate-45" style={{ boxShadow: "0 0 8px rgba(255,255,255,0.4)" }} />
                </div>

                {/* Segments */}
                {ms.map((m, i) => {
                  const prev = i > 0 ? ms[i - 1].days : 0;
                  const l = pct(Math.min(prev, m.days));
                  const r = pct(Math.max(prev, m.days));
                  const w = Math.max(0, r - l);
                  return w > 0.3 ? (
                    <div key={`s-${m.key}`} className="absolute top-1/2 -translate-y-1/2 rounded-full" style={{ left: `${l}%`, width: `${w}%`, height: 4, backgroundColor: m.color, opacity: 0.4 }} />
                  ) : null;
                })}

                {/* Milestone dots — overlapping dots spread horizontally */}
                {ms.map((m, i) => {
                  const hShift = stagger[i] * 6;
                  const dotSize = m.shape === "diamond" ? 9 : 11;
                  return (
                    <div key={m.key} className="absolute cursor-default transition-transform hover:scale-[1.3]"
                      style={{ left: `calc(${pct(m.days)}% + ${hShift}px)`, top: "50%", marginTop: -(dotSize / 2), marginLeft: -(dotSize / 2), zIndex: 10 + i }}
                      onMouseEnter={(e) => showTip(e, client.name, m.label, m.days, m.color)}
                      onMouseLeave={() => setTip(null)}>
                      <div className="absolute inset-[-4px] rounded-full opacity-0 group-hover/row:opacity-20 transition-opacity" style={{ backgroundColor: m.color }} />
                      {m.shape === "diamond" ? (
                        <div className="rounded-sm rotate-45" style={{ width: 9, height: 9, backgroundColor: m.color, boxShadow: `0 0 6px ${m.color}40` }} />
                      ) : (
                        <div className="rounded-full" style={{ width: 11, height: 11, backgroundColor: m.color, boxShadow: `0 0 8px ${m.color}50` }} />
                      )}
                      {stagger[i] === 0 && (
                        <span className="absolute top-full mt-1 left-1/2 -translate-x-1/2 text-[11px] font-mono font-semibold opacity-0 group-hover/row:opacity-100 transition-opacity whitespace-nowrap rounded-full px-1.5 py-0.5 bg-[#0d0d0d]/90" style={{ color: m.color }}>{m.days}d</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mt-4 pt-3 border-t border-[#2a2a2a]">
        <div className="flex items-center gap-2">
          <div className="w-[8px] h-[8px] bg-white rounded-sm rotate-45" />
          <span className="text-[9px] font-mono text-[#606060]">Consulting KO (Day 0)</span>
        </div>
        {JOURNEY.map((m) => (
          <div key={m.key} className="flex items-center gap-2">
            {m.shape === "diamond" ? (
              <div className="w-[8px] h-[8px] rounded-sm rotate-45" style={{ backgroundColor: m.color }} />
            ) : (
              <div className="rounded-full" style={{ width: 9, height: 9, backgroundColor: m.color, boxShadow: `0 0 4px ${m.color}40` }} />
            )}
            <span className="text-[9px] font-mono text-[#606060]">{m.label}</span>
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {tip && (
        <div className="fixed z-[9999] pointer-events-none" style={{ left: tip.x, top: tip.y, transform: "translate(-50%, -100%)" }}>
          <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-lg px-4 py-3 shadow-xl whitespace-nowrap">{tip.content}</div>
        </div>
      )}
    </div>
  );
}
