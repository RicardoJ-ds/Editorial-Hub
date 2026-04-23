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
// Pipeline by Pod — SOW-relative heatmap grid
// ---------------------------------------------------------------------------
//
// Every cell = {stage count} ÷ {pod's contract SOW}, matching the summary
// cards and per-client cards on this page. Approval-rate math (approved ÷ sent
// at each stage) was previously here but it's incompatible with the rest of
// the section — a 94% "CBs approved vs sent" next to a 91% "CBs vs SOW" card
// is confusing.
// ---------------------------------------------------------------------------

const STAGES = [
  { key: "topics", label: "Topics" },
  { key: "cbs", label: "Content Briefs" },
  { key: "articles", label: "Articles" },
  { key: "published", label: "Published" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

interface PodRow {
  pod: string;
  sow: number;
  byStage: Record<StageKey, number>;
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

function emptyStats(): Record<StageKey, number> {
  return { topics: 0, cbs: 0, articles: 0, published: 0 };
}

function StageCell({
  value,
  sow,
  maxVolume,
  stageLabel,
  isPublished,
}: {
  value: number;
  sow: number;
  maxVolume: number;
  stageLabel: string;
  isPublished: boolean;
}) {
  const pct = sow > 0 ? Math.round((value / sow) * 100) : 0;
  const throughputPct =
    maxVolume > 0 ? Math.max(4, Math.round((value / maxVolume) * 100)) : 0;
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
          {sow === 0 && value === 0 ? (
            <span className="font-mono text-xs text-[#404040]">—</span>
          ) : (
            <>
              <span
                className="font-mono text-base font-semibold tabular-nums"
                style={{ color: text }}
              >
                {sow > 0 ? `${pct}%` : "—"}
              </span>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-[#606060] tabular-nums">
                  {value}/{sow}
                </span>
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
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed space-y-1">
          <p className="font-semibold text-white">{stageLabel} vs SOW</p>
          <p className="text-[11px] text-[#C4BCAA]">
            <strong className="text-white">{value.toLocaleString()}</strong>{" "}
            {isPublished ? "published" : "approved"} out of{" "}
            <strong className="text-white">{sow.toLocaleString()}</strong> contract SOW ({pct}%)
          </p>
          <p className="text-[10px] text-[#606060]">
            Thin bar = this cell&apos;s raw volume vs the busiest pod × stage, so you can see relative throughput.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface Props {
  data: CumulativeMetric[];
  /** Client name → articles_sow. Required to compute the SOW-relative
   *  denominator. Rows without a SOW fall through to 0 and render "—". */
  clientToSow?: Map<string, number>;
  /** Client name → canonical pod label. When provided, groups the matrix by
   *  this (instead of `account_team_pod` from the sheet) so pod buckets match
   *  the per-client cards below. */
  clientToPod?: Map<string, string>;
}

export function PipelineFunnelChart({ data, clientToSow, clientToPod }: Props) {
  const { rows, totalRow, maxVolume, totalMaxVolume } = useMemo(() => {
    const podMap = new Map<string, PodRow>();

    for (const row of data) {
      // Never fall back to the sheet's account_team_pod — that column
      // carries growth/account pod labels and would mix axes with the
      // editorial_pod the map is built from. Unmapped clients go to
      // "Unassigned" so the matrix stays a clean editorial-pod view.
      const pod = clientToPod?.get(row.client_name) ?? "Unassigned";
      const sow = clientToSow?.get(row.client_name) ?? 0;
      let entry = podMap.get(pod);
      if (!entry) {
        entry = { pod, sow: 0, byStage: emptyStats(), totalThroughput: 0 };
        podMap.set(pod, entry);
      }
      entry.sow += sow;
      entry.byStage.topics += row.topics_approved ?? 0;
      entry.byStage.cbs += row.cbs_approved ?? 0;
      entry.byStage.articles += row.articles_approved ?? 0;
      entry.byStage.published += row.published_live ?? 0;
    }

    const rows = Array.from(podMap.values()).sort((a, b) => sortPodKey(a.pod, b.pod));
    for (const r of rows) {
      r.totalThroughput = STAGES.reduce((a, s) => a + r.byStage[s.key], 0);
    }

    const totalRow: PodRow = {
      pod: "All pods",
      sow: rows.reduce((a, r) => a + r.sow, 0),
      byStage: emptyStats(),
      totalThroughput: 0,
    };
    for (const r of rows) {
      for (const s of STAGES) totalRow.byStage[s.key] += r.byStage[s.key];
    }

    const maxVolume = Math.max(
      1,
      ...rows.flatMap((r) => STAGES.map((s) => r.byStage[s.key])),
    );
    const totalMaxVolume = Math.max(1, ...STAGES.map((s) => totalRow.byStage[s.key]));

    return { rows, totalRow, maxVolume, totalMaxVolume };
  }, [data, clientToSow, clientToPod]);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#161616] p-5">
      <div className="mb-1 flex items-center gap-2">
        <h4 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
          Pipeline by Editorial Pod
        </h4>
        <DataSourceBadge
          type="live"
          source="Sheet: 'Cumulative' — Spreadsheet: Master Tracker. Stage count ÷ the pod's contracted SOW, so every cell is comparable across stages and pods (same math as the summary cards and per-client cards below)."
          shows={[
            "Rows are editorial pods (from Client.editorial_pod); columns are the four stages (Topics → CBs → Articles → Published).",
            "Clients with no editorial pod set are grouped under Unassigned — this view never uses growth or account pods.",
            "Each % = stage count ÷ pod's total SOW — same math as the cards above and below.",
            "Thin bar inside a cell = raw volume vs. the busiest pod × stage.",
            "Color: green ≥85%, light-green 70–84%, amber 50–69%, red <50%.",
          ]}
        />
      </div>
      <p className="text-[11px] text-[#909090] mb-4">
        Each cell = stage count ÷ pod SOW. Color by %, thin bar by volume.
      </p>

      <div
        className="grid gap-1.5"
        style={{
          gridTemplateColumns: `minmax(100px, auto) repeat(${STAGES.length}, minmax(110px, 1fr))`,
        }}
      >
        <div />
        {STAGES.map((s) => (
          <div
            key={s.key}
            className="text-center font-mono text-[11px] uppercase tracking-wider text-[#C4BCAA] py-1"
          >
            {s.label}
          </div>
        ))}

        {rows.map((r) => (
          <PodRowRender key={r.pod} row={r} maxVolume={maxVolume} />
        ))}

        <div className="flex items-center pt-2 border-t border-[#2a2a2a] font-mono text-[11px] uppercase tracking-wider text-[#42CA80]">
          All editorial pods
        </div>
        {STAGES.map((s) => (
          <div key={`tot-${s.key}`} className="pt-2 border-t border-[#2a2a2a]">
            <StageCell
              value={totalRow.byStage[s.key]}
              sow={totalRow.sow}
              maxVolume={totalMaxVolume}
              stageLabel={s.label}
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
        <span className={cn("font-mono text-[10px] text-[#606060] tabular-nums")}>
          {row.totalThroughput.toLocaleString()}
        </span>
      </div>
      {STAGES.map((s) => (
        <StageCell
          key={`${row.pod}-${s.key}`}
          value={row.byStage[s.key]}
          sow={row.sow}
          maxVolume={maxVolume}
          stageLabel={s.label}
          isPublished={s.key === "published"}
        />
      ))}
    </>
  );
}
