"use client";

import { useMemo } from "react";
import type { CumulativeMetric } from "@/lib/types";
import { DataSourceBadge } from "@/components/dashboard/DataSourceBadge";
import { podBadge } from "@/components/dashboard/shared-helpers";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Pipeline by Pod — compact heatmap-style grid
// ---------------------------------------------------------------------------
//
// Previous version rendered N pods × 2 bars × 4 stages = dozens of Recharts bars
// with an unreadable legend. Replaced with a stage × pod grid: each cell shows
// the approval % big, the raw approved/sent underneath, a thin throughput bar
// so volume is still visible, and color-tints the cell by % so performance
// reads at a glance. No legend, no overlapping bars.
// ---------------------------------------------------------------------------

const STAGES = [
  { key: "topics", label: "Topics" },
  { key: "cbs", label: "Content Briefs" },
  { key: "articles", label: "Articles" },
  { key: "published", label: "Published" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

interface PodStageStats {
  sent: number;
  approved: number;
}

interface PodRow {
  pod: string;
  byStage: Record<StageKey, PodStageStats>;
  totalThroughput: number;
}

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

function sortPodKey(a: string, b: string) {
  if (a === "Unassigned" && b !== "Unassigned") return 1;
  if (b === "Unassigned" && a !== "Unassigned") return -1;
  const na = parseInt(a.replace(/\D/g, ""), 10);
  const nb = parseInt(b.replace(/\D/g, ""), 10);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

function pctColor(pct: number): { text: string; bg: string; bar: string } {
  if (pct >= 85) return { text: "#42CA80", bg: "rgba(66,202,128,0.08)", bar: "#42CA80" };
  if (pct >= 70) return { text: "#8CD59A", bg: "rgba(140,213,154,0.08)", bar: "#8CD59A" };
  if (pct >= 50) return { text: "#F5BC4E", bg: "rgba(245,188,78,0.08)", bar: "#F5BC4E" };
  if (pct > 0) return { text: "#ED6958", bg: "rgba(237,105,88,0.08)", bar: "#ED6958" };
  return { text: "#404040", bg: "transparent", bar: "#2a2a2a" };
}

function emptyStats(): Record<StageKey, PodStageStats> {
  return {
    topics: { sent: 0, approved: 0 },
    cbs: { sent: 0, approved: 0 },
    articles: { sent: 0, approved: 0 },
    published: { sent: 0, approved: 0 },
  };
}

function StageCell({
  sent,
  approved,
  maxVolume,
  isPublished,
}: {
  sent: number;
  approved: number;
  maxVolume: number;
  isPublished: boolean;
}) {
  const pct = sent > 0 ? Math.round((approved / sent) * 100) : 0;
  const throughputPct =
    maxVolume > 0 ? Math.max(4, Math.round((sent / maxVolume) * 100)) : 0;
  const { text, bg, bar } = pctColor(pct);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              className="flex flex-col justify-between gap-1 rounded-md border border-[#1f1f1f] p-2 cursor-help transition-colors hover:border-[#2a2a2a]"
              style={{ backgroundColor: bg, minHeight: 62 }}
            />
          }
        >
          {sent === 0 && approved === 0 ? (
            <span className="font-mono text-[11px] text-[#404040]">—</span>
          ) : (
            <>
              <span
                className="font-mono text-base font-semibold tabular-nums"
                style={{ color: text }}
              >
                {sent > 0 ? `${pct}%` : "—"}
              </span>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[9px] text-[#606060] tabular-nums">
                  {approved}/{sent}
                </span>
                {/* Throughput bar */}
                <div className="h-1 flex-1 rounded-full bg-[#0a0a0a] overflow-hidden max-w-[60px]">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${throughputPct}%`, backgroundColor: bar, opacity: 0.6 }}
                  />
                </div>
              </div>
            </>
          )}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed space-y-1">
          <p className="font-semibold text-white">
            {isPublished ? "Published live vs approved" : "Approved vs sent"}
          </p>
          <p className="text-[10px] text-[#C4BCAA]">
            <strong className="text-white">{approved.toLocaleString()}</strong>{" "}
            {isPublished ? "published" : "approved"} out of{" "}
            <strong className="text-white">{sent.toLocaleString()}</strong>{" "}
            {isPublished ? "approved" : "sent"} ({pct}%)
          </p>
          <p className="text-[9px] text-[#606060]">
            Thin bar at the bottom compares this cell&apos;s volume to the largest
            pod × stage combo so you can see relative throughput.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function PipelineFunnelChart({ data }: { data: CumulativeMetric[] }) {
  const { rows, totalRow, maxVolume } = useMemo(() => {
    const podMap = new Map<string, PodRow>();

    for (const row of data) {
      const pod = normalizePod(row.account_team_pod);
      let entry = podMap.get(pod);
      if (!entry) {
        entry = { pod, byStage: emptyStats(), totalThroughput: 0 };
        podMap.set(pod, entry);
      }
      entry.byStage.topics.sent += row.topics_sent ?? 0;
      entry.byStage.topics.approved += row.topics_approved ?? 0;
      entry.byStage.cbs.sent += row.cbs_sent ?? 0;
      entry.byStage.cbs.approved += row.cbs_approved ?? 0;
      entry.byStage.articles.sent += row.articles_sent ?? 0;
      entry.byStage.articles.approved += row.articles_approved ?? 0;
      // "Published" stage: compare published_live against approved articles
      entry.byStage.published.sent += row.articles_approved ?? 0;
      entry.byStage.published.approved += row.published_live ?? 0;
    }

    const rows = Array.from(podMap.values()).sort((a, b) => sortPodKey(a.pod, b.pod));

    // Totals row across every pod
    const totalRow: PodRow = { pod: "All pods", byStage: emptyStats(), totalThroughput: 0 };
    for (const r of rows) {
      for (const s of STAGES) {
        totalRow.byStage[s.key].sent += r.byStage[s.key].sent;
        totalRow.byStage[s.key].approved += r.byStage[s.key].approved;
      }
    }
    for (const r of rows) {
      r.totalThroughput = STAGES.reduce(
        (a, s) => a + r.byStage[s.key].sent,
        0
      );
    }

    const maxVolume = Math.max(
      1,
      ...rows.flatMap((r) => STAGES.map((s) => r.byStage[s.key].sent))
    );

    return { rows, totalRow, maxVolume };
  }, [data]);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#161616] p-5">
      <div className="mb-1 flex items-center gap-2">
        <h4 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
          Pipeline by Pod
        </h4>
        <DataSourceBadge
          type="live"
          source="Sheet: 'Cumulative' — Spreadsheet: Master Tracker. All-time pipeline per account-team pod. Approval % = approved ÷ sent at each stage; Published = published_live ÷ articles approved."
        />
      </div>
      <p className="text-[10px] text-[#606060] mb-4">
        Each cell shows the approval rate at that stage for the pod. Approved/Sent under the %, thin bar = relative throughput vs the busiest cell. Color tints by performance: green ≥85%, light-green 70–84%, amber 50–69%, red &lt;50%.
      </p>

      {/* Grid: [Pod label] + one column per stage */}
      <div
        className="grid gap-1.5"
        style={{
          gridTemplateColumns: `minmax(100px, auto) repeat(${STAGES.length}, minmax(110px, 1fr))`,
        }}
      >
        {/* Header row */}
        <div />
        {STAGES.map((s) => (
          <div
            key={s.key}
            className="text-center font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA] py-1"
          >
            {s.label}
          </div>
        ))}

        {/* Pod rows */}
        {rows.map((r) => (
          <PodRowRender key={r.pod} row={r} maxVolume={maxVolume} />
        ))}

        {/* Totals row */}
        <div className="flex items-center pt-2 border-t border-[#2a2a2a] font-mono text-[10px] uppercase tracking-wider text-[#42CA80]">
          All pods
        </div>
        {STAGES.map((s) => (
          <div key={`tot-${s.key}`} className="pt-2 border-t border-[#2a2a2a]">
            <StageCell
              sent={totalRow.byStage[s.key].sent}
              approved={totalRow.byStage[s.key].approved}
              maxVolume={Math.max(
                ...STAGES.map((ss) => totalRow.byStage[ss.key].sent),
                1
              )}
              isPublished={s.key === "published"}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function PodRowRender({ row, maxVolume }: { row: PodRow; maxVolume: number }) {
  return (
    <>
      <div className="flex items-center gap-2 py-1">
        {podBadge(row.pod)}
        <span className={cn("font-mono text-[9px] text-[#606060] tabular-nums")}>
          {row.totalThroughput.toLocaleString()}
        </span>
      </div>
      {STAGES.map((s) => (
        <StageCell
          key={`${row.pod}-${s.key}`}
          sent={row.byStage[s.key].sent}
          approved={row.byStage[s.key].approved}
          maxVolume={maxVolume}
          isPublished={s.key === "published"}
        />
      ))}
    </>
  );
}
