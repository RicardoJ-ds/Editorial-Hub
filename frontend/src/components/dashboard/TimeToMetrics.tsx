"use client";

import React, { useMemo, useRef, useState } from "react";
import type { Client } from "@/lib/types";
import { SummaryCard } from "./SummaryCard";
import { DataSourceBadge } from "./DataSourceBadge";
import { displayPod } from "./shared-helpers";
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

// Pod helpers shared across dashboards — keep in sync with FilterBar/ContractClientProgress.
const POD_COLORS: Record<string, string> = {
  "Pod 1": "#8FB5D9",
  "Pod 2": "#42CA80",
  "Pod 3": "#F5C542",
  "Pod 4": "#F28D59",
  "Pod 5": "#ED6958",
  "Pod 6": "#CEBCF4",
  "Pod 7": "#7FE8D6",
  Unassigned: "#606060",
};

function normalizePod(raw: string | null | undefined): string {
  if (raw == null) return "Unassigned";
  const t = String(raw).trim();
  if (!t || t === "-" || t === "—") return "Unassigned";
  const n = t.match(/^(\d+)$/);
  if (n) return `Pod ${n[1]}`;
  const p = t.match(/^p(?:od)?\s*(\d+)$/i);
  if (p) return `Pod ${p[1]}`;
  return t;
}

function sortPodKey(a: string, b: string): number {
  if (a === "Unassigned" && b !== "Unassigned") return 1;
  if (b === "Unassigned" && a !== "Unassigned") return -1;
  const na = parseInt(a.replace(/\D/g, ""), 10);
  const nb = parseInt(b.replace(/\D/g, ""), 10);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

function fmtDateShort(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = d.toLocaleDateString("en-US", { month: "short" });
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type Contributor = {
  clientName: string;
  pod: string;
  fromDate: string;
  toDate: string;
  days: number;
};

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

type MetricCard = MetricDef & {
  stats: ReturnType<typeof statsOf>;
  contributors: Contributor[];
};

export function TimeToMetrics({ clients }: TimeToMetricsProps) {
  // Per-card stats AND the full list of contributing clients, so the hover
  // tooltip can show every (client, from-date → to-date, days) triple used.
  const cards = useMemo<MetricCard[]>(() => {
    return METRIC_DEFS.map((d) => {
      const fromField = d.from ?? REF_FIELD;
      const contributors: Contributor[] = [];
      const values: (number | null)[] = [];
      for (const c of clients) {
        const a = (c as unknown as Record<string, string | null>)[fromField];
        const b = (c as unknown as Record<string, string | null>)[d.to];
        const days = daysBetween(a, b);
        values.push(days);
        if (days !== null && a && b) {
          contributors.push({
            clientName: c.name,
            pod: normalizePod(c.editorial_pod),
            fromDate: a,
            toDate: b,
            days,
          });
        }
      }
      contributors.sort((x, y) => y.days - x.days);
      return { ...d, stats: statsOf(values), contributors };
    });
  }, [clients]);

  // Single shared tooltip instance for all 8 cards — avoids mounting 8 portals.
  // Mouse-out schedules a short close delay so the user can move into the
  // tooltip itself and scroll without it disappearing.
  const [tip, setTip] = useState<{
    x: number;
    y: number;
    card: MetricCard;
    align: "left" | "right";
  } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setTip(null), 150);
  };
  const openTip = (e: React.MouseEvent<HTMLDivElement>, card: MetricCard) => {
    const r = e.currentTarget.getBoundingClientRect();
    cancelClose();
    // Prefer placement to the right of the card; flip to the left if the
    // popup would overflow the viewport.
    const POPUP_WIDTH = 380;
    const GAP = 8;
    const viewportW = typeof window !== "undefined" ? window.innerWidth : 1280;
    const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
    const fitsRight = r.right + GAP + POPUP_WIDTH <= viewportW;
    const align: "left" | "right" = fitsRight ? "left" : "right";
    const x = fitsRight ? r.right + GAP : r.left - GAP;
    // Clamp vertical so the popup doesn't dive off-screen.
    const y = Math.max(8, Math.min(viewportH - 80, r.top));
    setTip({ x, y, card, align });
  };

  // Per-client milestone data, grouped by pod. Every client appears as a
  // row; clients with no CKO or no milestone dates render as empty rows.
  // Pods are ordered numerically (Pod 1, 2, …, Unassigned last); clients
  // within each pod are sorted alphabetically.
  const clientMilestonesByPod = useMemo(() => {
    const rows = clients.map((c) => {
      const entries: { key: string; label: string; days: number; color: string; shape: string }[] = [];
      if (c.consulting_ko_date) {
        JOURNEY.forEach((m) => {
          const d = daysBetween(c.consulting_ko_date, (c as unknown as Record<string, string | null>)[m.field]);
          if (d !== null) entries.push({ key: m.key, label: m.label, days: d, color: m.color, shape: m.shape });
        });
        entries.sort((a, b) => a.days - b.days);
      }
      return { client: c, milestones: entries };
    });
    const byPod = new Map<string, typeof rows>();
    for (const r of rows) {
      const pod = normalizePod(r.client.editorial_pod);
      if (!byPod.has(pod)) byPod.set(pod, []);
      byPod.get(pod)!.push(r);
    }
    return Array.from(byPod.keys())
      .sort(sortPodKey)
      .map((pod) => ({
        pod,
        rows: byPod.get(pod)!.slice().sort((a, b) => a.client.name.localeCompare(b.client.name)),
      }));
  }, [clients]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 border-b border-[#2a2a2a] pb-2">
        <h2 className="font-mono text-base font-bold uppercase tracking-[0.2em] text-white flex items-center gap-2">
          Time-to Metrics
          <DataSourceBadge
            type="live"
            source="Sheet: 'Editorial SOW overview' — Spreadsheet: Editorial Capacity Planning. Calculated from milestone date fields: Consulting KO, Editorial KO, First CB, First Article, First Feedback, First Published."
            shows={[
              "Each card = one milestone handoff (e.g. Consulting KO → First Article).",
              "Big number is the average across filtered clients, in days.",
              "Min/Max shows the fastest and slowest client in the filter.",
              "Lower is better — smaller numbers mean smoother onboardings.",
            ]}
          />
        </h2>
        <span className="h-px flex-1 bg-[#2a2a2a]" />
        <span className="text-[10px] font-mono text-[#909090]">Reference: Consulting KO (Day 0)</span>
      </div>

      {/* Row 1: Primary — from Consulting KO */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.slice(0, 4).map((m) => (
          <HoverableMetricCard key={m.key} card={m} onEnter={openTip} onLeave={scheduleClose} />
        ))}
      </div>

      {/* Row 2: Secondary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.slice(4).map((m) => (
          <HoverableMetricCard key={m.key} card={m} onEnter={openTip} onLeave={scheduleClose} />
        ))}
      </div>

      {/* Per-client breakdown — only meaningful when the filter returns more than one client */}
      {clients.length > 1 && <TimeToTrendChart clients={clients} />}

      {/* Waterfall chart */}
      {clientMilestonesByPod.length > 0 && <MilestoneWaterfall groups={clientMilestonesByPod} />}

      {/* Shared hover tooltip — fixed-position portal so parent overflow
          never clips it. Pointer events enabled on the popup so the user
          can move into it to scroll through long client lists. */}
      {tip && (
        <div
          className="fixed z-[9999]"
          style={{
            left: tip.x,
            top: tip.y,
            transform: tip.align === "right" ? "translateX(-100%)" : undefined,
          }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <MetricContributorsPopup card={tip.card} />
        </div>
      )}
    </div>
  );
}

function HoverableMetricCard({
  card,
  onEnter,
  onLeave,
}: {
  card: MetricCard;
  onEnter: (e: React.MouseEvent<HTMLDivElement>, card: MetricCard) => void;
  onLeave: () => void;
}) {
  return (
    <div
      className="cursor-default h-full"
      onMouseEnter={(e) => onEnter(e, card)}
      onMouseLeave={onLeave}
    >
      <SummaryCard
        title={`Avg ${card.label}`}
        value={card.stats.avg !== null ? `${card.stats.avg} days` : "N/A"}
        description={fmtRange(card.stats)}
      />
    </div>
  );
}

function MetricContributorsPopup({ card }: { card: MetricCard }) {
  const byPod = new Map<string, Contributor[]>();
  for (const row of card.contributors) {
    const arr = byPod.get(row.pod) ?? [];
    arr.push(row);
    byPod.set(row.pod, arr);
  }
  for (const arr of byPod.values()) {
    arr.sort((a, b) => b.days - a.days);
  }
  const pods = Array.from(byPod.keys()).sort(sortPodKey);

  const parts = card.label.split(" → ");
  const fromLabel = parts[0] ?? "From";
  const toLabel = parts[1] ?? "To";
  const count = card.contributors.length;

  return (
    <div className="flex max-h-[360px] w-[380px] flex-col overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] shadow-xl shadow-black/60">
      <div className="border-b border-[#2a2a2a] px-3 py-2">
        <p className="font-mono text-[11px] font-semibold text-white">{card.label}</p>
        <p className="mt-0.5 font-mono text-[10px] text-[#606060]">
          Avg {card.stats.avg ?? "—"}d across {count} client{count === 1 ? "" : "s"} with both dates set.
          {card.stats.min !== null && card.stats.max !== null && (
            <>  · Min {card.stats.min}d · Max {card.stats.max}d</>
          )}
        </p>
      </div>
      {count === 0 ? (
        <p className="px-3 py-3 text-center font-mono text-[10px] text-[#606060]">
          No clients have both {fromLabel} and {toLabel} dates recorded yet.
        </p>
      ) : (
        <div className="space-y-2 overflow-y-auto px-3 py-2">
          {pods.map((pod) => {
            const rows = byPod.get(pod) ?? [];
            const color = POD_COLORS[pod] ?? "#606060";
            return (
              <div key={pod}>
                <div className="mb-0.5 flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                  <span
                    className="font-mono text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color }}
                  >
                    {displayPod(pod, "editorial")}
                  </span>
                  <span className="font-mono text-[10px] text-[#606060]">({rows.length})</span>
                </div>
                <div className="ml-3 space-y-0.5">
                  {rows.map((r) => (
                    <div key={r.clientName} className="flex items-center gap-2 font-mono text-[10px]">
                      <span className="w-[90px] shrink-0 truncate text-[#C4BCAA]" title={r.clientName}>
                        {r.clientName}
                      </span>
                      <span className="shrink-0 text-[#606060] tabular-nums">
                        {fmtDateShort(r.fromDate)} → {fmtDateShort(r.toDate)}
                      </span>
                      <span className="ml-auto font-semibold tabular-nums text-white">{r.days}d</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-client breakdown chart
// ---------------------------------------------------------------------------


type TrendBucket = {
  key: string;
  label: string;
  avg: number | null;
  count: number;
  sublabel?: string;
};

function TimeToTrendChart({ clients }: { clients: Client[] }) {
  const [metricKey, setMetricKey] = useState<string>("cko_art");

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

    // One bar per client's individual delta. Include clients with no data
    // too — they render as empty slots so the roster stays visible.
    const perClient: TrendBucket[] = [];
    for (const c of clients) {
      const rec = c as unknown as Record<string, string | null>;
      const days = daysBetween(rec[from], rec[metric.to]);
      if (days !== null) all.push(days);
      perClient.push({
        key: `client-${c.id}`,
        label: c.name,
        avg: days,
        count: 1,
        sublabel: c.editorial_pod ? displayPod(c.editorial_pod, "editorial") : undefined,
      });
    }
    // Slowest first among clients with data; null-avg clients go to the end.
    perClient.sort((a, b) => {
      if (a.avg === null && b.avg === null) return a.label.localeCompare(b.label);
      if (a.avg === null) return 1;
      if (b.avg === null) return -1;
      return b.avg - a.avg;
    });
    const overallAvg = all.length
      ? Math.round(all.reduce((a, b) => a + b, 0) / all.length)
      : null;
    return { buckets: perClient, overallAvg };
  }, [clients, metric]);

  // Cap the y-axis so a single extreme cohort doesn't flatten everything else.
  // Use p90 of bucket averages with a sensible floor relative to the overall avg.
  const { scaleMax, actualMax } = useMemo(() => {
    const withData = buckets.map((b) => b.avg).filter((v): v is number => v !== null);
    const actualMax = Math.max(1, overallAvg ?? 0, ...withData);
    if (withData.length === 0) return { scaleMax: actualMax, actualMax };
    const sorted = withData.slice().sort((a, b) => a - b);
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
      {/* Title + subtitle. */}
      <div className="mb-3">
        <p className="text-xs font-mono font-semibold uppercase tracking-widest text-[#C4BCAA] flex items-center gap-2">
          Per-Client Breakdown
          <DataSourceBadge
            type="live"
            source="Sheet: 'Editorial SOW overview' — Spreadsheet: Editorial Capacity Planning. Calculated from Consulting KO, Editorial KO, First CB, First Article, First Feedback, First Published date columns."
            shows={[
              `Each bar is one client's ${metric.label.toLowerCase()}.`,
              "Sorted slowest → fastest so outliers float to the top.",
              "Lower is better.",
              ...(actualMax > scaleMax
                ? [`Bars clipped at ${scaleMax}d are marked ↑.`]
                : []),
            ]}
          />
        </p>
        {overallAvg !== null && (
          <p className="text-[11px] font-mono text-[#909090] mt-0.5">
            Overall avg: <span className="text-white font-semibold">{overallAvg}d</span>
          </p>
        )}
      </div>

      {/* Row 2: Metric dropdown only, left-aligned. */}
      <div className="mb-4 flex items-center gap-2">
        <span className="font-mono text-[10px] text-[#606060] uppercase tracking-wider">Metric</span>
        <Select value={metricKey} onValueChange={(v) => v && setMetricKey(v)}>
          <SelectTrigger size="sm" className="w-[280px]">
            <SelectValue>
              <span className="text-xs">{metric.label}</span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {METRIC_DEFS.map((m) => (
              <SelectItem key={m.key} value={m.key}>
                <span className="text-xs font-medium">{m.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {buckets.length === 0 ? (
        <p className="text-center text-xs text-[#606060] py-10">
          Not enough data to compute a breakdown for the current filters.
        </p>
      ) : (
        (() => {
          // Give each bar a minimum footprint. When we have many clients the
          // whole chart widens past the container and scrolls horizontally —
          // much better than squeezing 70+ bars into 1000px and losing
          // labels/values entirely.
          const MIN_BAR_WIDTH = 40;
          const BAR_GAP = 6;
          const minWidthPx = buckets.length * (MIN_BAR_WIDTH + BAR_GAP);
          // Fit the longest client name, rotated at 50°. We measure by char
          // count × ~6.5px/char and map to vertical height = sin(50°) × len.
          const longestLabel = Math.max(...buckets.map((b) => b.label.length), 10);
          const labelRowHeight = Math.min(220, Math.round(longestLabel * 6.5 * 0.77) + 24);
          return (
            <div className="overflow-x-auto">
              <div style={{ minWidth: minWidthPx }}>
                {/* Chart area — bars + reference line share the same baseline */}
                <div className="relative h-[160px]">
                  <div className="absolute inset-0 flex items-end" style={{ gap: BAR_GAP }}>
                    {buckets.map((b) => {
                      const hasData = b.avg !== null;
                      const clipped = hasData && b.avg! > scaleMax;
                      const ratio = !hasData ? 0 : clipped ? 1 : b.avg! / scaleMax;
                      const hPx = !hasData ? 0 : Math.max(2, Math.round(ratio * 140));
                      const above = hasData && overallAvg !== null && b.avg! > overallAvg;
                      // Show the day-count above the bar only when the bar is
                      // wide enough to not collide with its neighbours. Under
                      // ~30px the values overlap; the tooltip still has them.
                      const showValue = MIN_BAR_WIDTH >= 30 || buckets.length <= 20;
                      return (
                        <div
                          key={b.key}
                          className="flex flex-col items-center gap-1 group/bar"
                          style={{ width: MIN_BAR_WIDTH, flex: "1 0 auto" }}
                        >
                          {showValue ? (
                            <span className={cn(
                              "font-mono text-[10px] tabular-nums",
                              hasData ? "text-[#C4BCAA]" : "text-[#404040]",
                            )}>
                              {hasData ? <>{b.avg}d{clipped && <span className="text-[#ED6958]"> ↑</span>}</> : "—"}
                            </span>
                          ) : (
                            <span className="font-mono text-[10px] text-transparent">·</span>
                          )}
                          {hasData ? (
                            <div
                              className={cn(
                                "w-full transition-all rounded-t cursor-default",
                                above ? "bg-[#F5BC4E]" : "bg-[#42CA80]",
                                "hover:opacity-100",
                                clipped && "ring-1 ring-inset ring-[#ED6958]/70",
                              )}
                              style={{ height: hPx, opacity: 0.85 }}
                              onMouseEnter={(e) => {
                                const r = e.currentTarget.getBoundingClientRect();
                                setHover({
                                  x: r.left + r.width / 2,
                                  y: r.top - 10,
                                  key: b.key,
                                  label: b.label,
                                  avg: b.avg!,
                                  count: b.count,
                                  sublabel: b.sublabel,
                                });
                              }}
                              onMouseLeave={() => setHover(null)}
                            />
                          ) : (
                            // Empty placeholder so the column still occupies space
                            <div className="w-full" style={{ height: 2, opacity: 0 }} />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Reference line (overall average) */}
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
                        className="absolute right-0 text-[10px] font-mono text-[#42CA80] bg-[#161616] px-1 whitespace-nowrap"
                        style={{ top: -6 }}
                      >
                        Overall avg · {overallAvg}d
                      </span>
                    </div>
                  )}
                </div>

                {/* Labels — rotated 50° in client mode, centered in month
                    mode. In client mode each label is absolutely positioned
                    so its top-left pivot sits at the CENTER of its bar. That
                    way the label's starting point reads directly under the
                    bar, with the tail extending down-right into the gutter
                    below. */}
                <div
                  className="flex mt-2"
                  style={{ gap: BAR_GAP, height: labelRowHeight }}
                >
                  {buckets.map((b) => (
                    <div
                      key={`lbl-${b.key}`}
                      className="relative"
                      style={{ width: MIN_BAR_WIDTH, flex: "1 0 auto" }}
                    >
                      <span
                        title={
                          b.avg === null
                            ? `${b.label} · no data for this metric`
                            : b.sublabel
                              ? `${b.label} · ${b.sublabel}`
                              : b.label
                        }
                        className={cn(
                          "absolute font-mono text-[11px] leading-tight whitespace-nowrap hover:text-white",
                          b.avg === null ? "text-[#606060]" : "text-[#C4BCAA]",
                        )}
                        style={{
                          top: 2,
                          left: "50%",
                          transformOrigin: "top left",
                          transform: "rotate(50deg)",
                        }}
                      >
                        {b.label}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Legend */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-2 border-t border-[#2a2a2a]">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-sm bg-[#42CA80]" />
                    <span className="text-[10px] font-mono text-[#C4BCAA]">
                      Faster — client ≤ overall
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-sm bg-[#F5BC4E]" />
                    <span className="text-[10px] font-mono text-[#C4BCAA]">
                      Slower — client &gt; overall
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-px border-t border-dashed border-[#42CA80]" />
                    <span className="text-[10px] font-mono text-[#C4BCAA]">
                      Overall average across all clients{overallAvg !== null ? ` (${overallAvg}d)` : ""}
                    </span>
                  </div>
                  {buckets.length > 12 && (
                    <span className="ml-auto text-[10px] font-mono text-[#606060]">
                      ← scroll to see all {buckets.length} clients →
                    </span>
                  )}
                </div>

                {/* Tooltip */}
                {hover && (
                  <div
                    className="fixed z-[9999] pointer-events-none"
                    style={{ left: hover.x, top: hover.y, transform: "translate(-50%, -100%)" }}
                  >
                    <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-lg px-3 py-2 shadow-xl whitespace-nowrap">
                      <p className="text-xs font-mono font-semibold text-white">{hover.label}</p>
                      {hover.sublabel && (
                        <p className="text-[10px] font-mono text-[#606060] mt-0.5">{hover.sublabel}</p>
                      )}
                      <p className="text-[11px] font-mono text-[#C4BCAA] mt-0.5">
                        <span className="text-white">{hover.avg}d</span>
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Milestone Waterfall
// ---------------------------------------------------------------------------

type MilestoneRow = { client: Client; milestones: { key: string; label: string; days: number; color: string; shape: string }[] };
type MilestoneGroup = { pod: string; rows: MilestoneRow[] };

function MilestoneWaterfall({ groups }: { groups: MilestoneGroup[] }) {
  const [tip, setTip] = useState<MilestoneTooltip | null>(null);

  const maxDays = useMemo(
    () =>
      Math.max(
        14,
        ...groups.flatMap((g) => g.rows.flatMap(({ milestones }) => milestones.map((m) => m.days))),
      ),
    [groups],
  );
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
        <p className="text-xs font-mono font-semibold uppercase tracking-widest text-[#C4BCAA] flex items-center gap-2">
          Client Milestone Journey
          <DataSourceBadge
            type="live"
            source="Sheet: 'Editorial SOW overview' — Spreadsheet: Editorial Capacity Planning. One dot per milestone date per active client. Distance from Day 0 = elapsed days from Consulting KO."
            shows={[
              "One row per client; the horizontal axis is days from Consulting KO (day 0).",
              "Each dot marks a milestone date — the further right, the longer it took.",
              "Grouped by editorial pod, clients listed alphabetically within each pod.",
            ]}
          />
        </p>
      </div>

      {/* Scale labels only (no grid lines here) */}
      <div className="grid mb-1" style={{ gridTemplateColumns: "130px 1fr" }}>
        <div />
        <div className="relative h-5 mx-4">
          {ticks.map((d) => (
            <span key={d} className={cn("absolute text-[10px] font-mono", d === 0 ? "text-white font-bold" : "text-[#606060]")} style={{ left: `${pct(d)}%`, transform: "translateX(-50%)" }}>
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
          {groups.map(({ pod, rows }) => {
            const podColor = POD_COLORS[pod] ?? "#606060";
            return (
              <div key={`grp-${pod}`}>
                {/* Pod header row — spans the full width */}
                <div className="grid items-center mt-2 mb-1" style={{ gridTemplateColumns: "130px 1fr" }}>
                  <div className="flex items-center justify-end gap-1.5 pr-3">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: podColor }} />
                    <span
                      className="font-mono text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: podColor }}
                    >
                      {displayPod(pod, "editorial")}
                    </span>
                    <span className="font-mono text-[10px] text-[#606060]">({rows.length})</span>
                  </div>
                  <div className="relative mx-4 h-px bg-[#2a2a2a]" />
                </div>

                {rows.map(({ client, milestones: ms }) => {
                  const positions = ms.map((m) => m.days);
                  const stagger = positions.map((pos, i) => {
                    let n = 0;
                    for (let j = 0; j < i; j++) if (Math.abs(positions[j] - pos) < 1) n++;
                    return n;
                  });

                  return (
            <div key={client.id} className="grid items-center group/row hover:bg-[#1a1a1a] rounded transition-colors" style={{ gridTemplateColumns: "130px 1fr", height: ROW_H }}>
              <span className={cn(
                "truncate text-[11px] font-mono text-right pr-3 group-hover/row:text-white transition-colors",
                ms.length === 0 && !client.consulting_ko_date ? "text-[#606060]" : "text-[#C4BCAA]",
              )}>{client.name}</span>
              <div className="relative mx-4" style={{ height: ROW_H - 6 }}>
                {/* Track */}
                <div className="absolute top-1/2 -translate-y-1/2 rounded-full bg-[#1a1a1a]" style={{ left: 0, width: "100%", height: 4 }} />

                {/* CKO marker at day 0 — only if this client has a CKO date */}
                {client.consulting_ko_date && (
                  <div className="absolute cursor-default z-20" style={{ left: `${pct(0)}%`, top: "50%", marginTop: -5, marginLeft: -5 }}
                    onMouseEnter={(e) => showTip(e, client.name, "Consulting KO (Day 0)", 0, "#FFFFFF")}
                    onMouseLeave={() => setTip(null)}>
                    <div className="w-[9px] h-[9px] bg-white rounded-sm rotate-45" style={{ boxShadow: "0 0 8px rgba(255,255,255,0.4)" }} />
                  </div>
                )}

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
                        <span className="absolute top-full mt-1 left-1/2 -translate-x-1/2 text-xs font-mono font-semibold opacity-0 group-hover/row:opacity-100 transition-opacity whitespace-nowrap rounded-full px-1.5 py-0.5 bg-[#0d0d0d]/90" style={{ color: m.color }}>{m.days}d</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mt-4 pt-3 border-t border-[#2a2a2a]">
        <div className="flex items-center gap-2">
          <div className="w-[8px] h-[8px] bg-white rounded-sm rotate-45" />
          <span className="text-[10px] font-mono text-[#606060]">Consulting KO (Day 0)</span>
        </div>
        {JOURNEY.map((m) => (
          <div key={m.key} className="flex items-center gap-2">
            {m.shape === "diamond" ? (
              <div className="w-[8px] h-[8px] rounded-sm rotate-45" style={{ backgroundColor: m.color }} />
            ) : (
              <div className="rounded-full" style={{ width: 9, height: 9, backgroundColor: m.color, boxShadow: `0 0 4px ${m.color}40` }} />
            )}
            <span className="text-[10px] font-mono text-[#606060]">{m.label}</span>
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
