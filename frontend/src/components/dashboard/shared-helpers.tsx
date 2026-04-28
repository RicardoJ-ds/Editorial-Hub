"use client";

import React, { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { TableHead } from "@/components/ui/table";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const POD_COLORS: Record<string, string> = {
  "Pod 1": "bg-[#5B9BF5]/15 text-[#5B9BF5] border-[#5B9BF5]/30",
  "Pod 2": "bg-[#42CA80]/15 text-[#42CA80] border-[#42CA80]/30",
  "Pod 3": "bg-[#F5C542]/15 text-[#F5C542] border-[#F5C542]/30",
  "Pod 4": "bg-[#F28D59]/15 text-[#F28D59] border-[#F28D59]/30",
  "Pod 5": "bg-[#ED6958]/15 text-[#ED6958] border-[#ED6958]/30",
};

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------

type StatusVariant = "default" | "secondary" | "destructive" | "outline";

export function statusBadge(status: string) {
  const map: Record<string, { label: string; className: string; variant: StatusVariant }> = {
    ACTIVE: { label: "Active", className: "bg-[#42CA80]/15 text-[#42CA80] border-[#42CA80]/30", variant: "outline" },
    COMPLETED: { label: "Completed", className: "bg-[#606060]/15 text-[#909090] border-[#606060]/30", variant: "outline" },
    CANCELLED: { label: "Cancelled", className: "bg-[#ED6958]/15 text-[#ED6958] border-[#ED6958]/30", variant: "outline" },
    SOON_TO_BE_ACTIVE: { label: "Soon Active", className: "bg-[#F5C542]/15 text-[#F5C542] border-[#F5C542]/30", variant: "outline" },
    INACTIVE: { label: "Inactive", className: "bg-[#606060]/15 text-[#909090] border-[#606060]/30", variant: "outline" },
  };
  const info = map[status] ?? { label: status, className: "", variant: "secondary" as StatusVariant };
  return <Badge variant={info.variant} className={info.className}>{info.label}</Badge>;
}

/**
 * Display-only formatter for pod labels.
 *
 * Internal keys stay as "Pod 1" / "Pod 2" / "Unassigned" so POD_COLORS lookups,
 * Map keys, and filter-value equality keep working. This helper is for UI
 * rendering only — it prepends "Editorial" (default) or "Growth" so a viewer
 * can tell at a glance which pod taxonomy they're looking at.
 */
export function displayPod(
  pod: string | null | undefined,
  kind: "editorial" | "growth" = "editorial",
): string {
  if (!pod) return "—";
  const s = String(pod).trim();
  if (!s || s === "—" || s === "-") return "—";
  if (/^unassigned$/i.test(s)) return "Unassigned";
  // Already disambiguated — leave as-is.
  if (/^(editorial|growth)\s+pod/i.test(s)) return s;
  const prefix = kind === "growth" ? "Growth Pod" : "Editorial Pod";
  // Handle "Pod 1", "pod 1", "P1", "1".
  const m = s.match(/^pod\s*(\d+)$/i) ?? s.match(/^p\s*(\d+)$/i) ?? s.match(/^(\d+)$/);
  if (m) return `${prefix} ${m[1]}`;
  return s;
}

export function podBadge(pod: string | null, kind: "editorial" | "growth" = "editorial") {
  if (!pod) return <span className="text-[#606060]">{"\u2014"}</span>;
  const color = POD_COLORS[pod] ?? "bg-secondary text-secondary-foreground";
  return <Badge variant="outline" className={color}>{displayPod(pod, kind)}</Badge>;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

export function pctColor(pctStr: string | null): string {
  if (!pctStr) return "text-[#606060]";
  const num = parseFloat(pctStr.replace("%", "")); // nosemgrep
  if (isNaN(num)) return "text-[#606060]";
  if (num >= 75) return "text-[#42CA80]";
  if (num >= 50) return "text-[#F5C542]";
  return "text-[#ED6958]";
}

export function pctColorNum(v: number | null): string {
  if (v == null) return "text-[#606060]";
  if (v >= 75) return "text-[#42CA80]";
  if (v >= 50) return "text-[#F5C542]";
  return "text-[#ED6958]";
}

export function parsePctValue(pctStr: string | null): number {
  if (!pctStr) return 0;
  const num = parseFloat(pctStr.replace("%", "")); // nosemgrep
  return isNaN(num) ? 0 : num;
}

export function displayPct(pctStr: string | null): string {
  if (!pctStr) return "-%";
  const trimmed = pctStr.trim();
  if (trimmed === "" || trimmed === "0" || trimmed === "0%") return "0%";
  return trimmed.includes("%") ? trimmed : `${trimmed}%`;
}

// ---------------------------------------------------------------------------
// Pipeline stage palette — funnel progression in Graphite primary greens
// (P3 → P2 → P1, dark → bright) capped with WN1 cream for published.
// Strictly Graphite Internal DS swatches; no off-brand cyan/blue/purple.
// Used on the pipeline bars where the pacing chip / health chip already
// carries any risk signal — the bars themselves stay calm, stage-marked.
// ---------------------------------------------------------------------------

export const PIPELINE_STAGE_COLORS = {
  topics: "#2E8C59",    // P3 — deepest green (raw ideas, grounded)
  cbs: "#42CA80",       // P2 — standard green
  articles: "#65FFAA",  // P1 — bright green (in production, lifting)
  published: "#DDCFAC", // WN1 — warm cream (delivered / final output)
} as const;

export type PipelineStage = keyof typeof PIPELINE_STAGE_COLORS;

// ---------------------------------------------------------------------------
// Pacing-aware color — for "% of contract progress" style metrics, raw
// thresholds (75/50/<50) unfairly punish new clients whose contracts have
// barely started. A brand-new client at 5% delivery isn't behind — they
// just started. Compare actual progress to *expected* progress (elapsed
// contract time) and color the gap, not the absolute %.
//
//   • elapsed < minElapsedPct (8% by default): can't judge → green.
//   • actual within `warnPp` (10pp) of expected: green.
//   • actual within `riskPp` (25pp) of expected: yellow (watch).
//   • else: red (significantly behind).
//
// Falls back to absolute-threshold coloring when elapsed is unknown so
// non-contract metrics still get sensible colors.
// ---------------------------------------------------------------------------

export function pacingColor(
  actualPct: number,
  elapsedPct: number | null,
  opts: { minElapsedPct?: number; warnPp?: number; riskPp?: number } = {},
): string {
  const { minElapsedPct = 8, warnPp = 10, riskPp = 25 } = opts;
  if (elapsedPct === null || elapsedPct === undefined) {
    if (actualPct >= 75) return "#42CA80";
    if (actualPct >= 50) return "#F5C542";
    return "#ED6958";
  }
  if (elapsedPct < minElapsedPct) return "#42CA80";
  const delta = actualPct - elapsedPct;
  if (delta >= -warnPp) return "#42CA80";
  if (delta >= -riskPp) return "#F5C542";
  return "#ED6958";
}

// Elapsed-contract % from start_date + (end_date OR term_months). Returns
// null when we can't compute it honestly.
export function elapsedContractPct(
  startDate: string | null | undefined,
  opts: { endDate?: string | null; termMonths?: number | null },
): number | null {
  if (!startDate) return null;
  const start = new Date(startDate);
  if (isNaN(start.getTime())) return null;
  let end: Date | null = null;
  if (opts.endDate) {
    const d = new Date(opts.endDate);
    if (!isNaN(d.getTime())) end = d;
  }
  if (!end && opts.termMonths && opts.termMonths > 0) {
    end = new Date(start);
    end.setMonth(end.getMonth() + opts.termMonths);
  }
  if (!end) return null;
  const total = end.getTime() - start.getTime();
  if (total <= 0) return null;
  const elapsed = Math.max(0, Math.min(total, Date.now() - start.getTime()));
  return (elapsed / total) * 100;
}

// ---------------------------------------------------------------------------
// Content-type weighting — the Master Tracker stores one row per
// (client × month × week × content_type). Different content types take
// different effort and contribute different value to the goal:
//
//   article (default) → ×1     (one unit of work)
//   jumbo             → ×2     (longer-form, double effort)
//   LP / landing page → ×0.5   (lighter unit)
//
// The sheet also carries an explicit `ratios` string ("2:1", "1:2"); when
// present we honor it (numerator ÷ denominator) so the weighting tracks the
// sheet exactly. Falls back to the content-type table.
//
// Apply this whenever you sum rows for goal/delivered totals — without it,
// a client with 17 article + 2 jumbo rows reads 19 instead of 21.
// ---------------------------------------------------------------------------

export function contentTypeRatio(
  contentType: string | null | undefined,
  ratios?: string | null,
): number {
  // Content-type table is authoritative — the sheet's `ratios` column is
  // inconsistent in direction ("2:1" vs "1:2" appear for the same type
  // across different rows). Trusting the column directly produced inverted
  // weights (jumbo reading ×0.5 instead of ×2). The known types win first.
  if (contentType) {
    const t = contentType.trim().toLowerCase();
    if (t === "article" || t === "articles") return 1;
    if (t === "jumbo") return 2;
    if (t === "lp" || t === "landing page" || t === "landing pages") return 0.5;
  }
  // Unknown type → fall back to the sheet's ratios string, then default 1.
  if (ratios) {
    const m = ratios.match(/^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/);
    if (m) {
      const a = parseFloat(m[1]);
      const b = parseFloat(m[2]);
      if (b > 0) return a / b;
    }
  }
  return 1;
}

// ---------------------------------------------------------------------------
// TooltipBody — the canonical "title + 2-3 short bullets" body used by every
// hover tooltip across both dashboards. Wrap with the standard Tooltip /
// TooltipTrigger / TooltipContent primitives at the call site:
//
//   <Tooltip>
//     <TooltipTrigger render={<span className="cursor-help underline ..." />}>
//       Metric Label
//     </TooltipTrigger>
//     <TooltipContent>
//       <TooltipBody title="Short title" bullets={["fact one", "fact two"]} />
//     </TooltipContent>
//   </Tooltip>
//
// Bullets accept ReactNode so call sites can highlight a code-style token
// inside a bullet (e.g. wrap a key word in <code>…</code>) when needed.
// ---------------------------------------------------------------------------

export function TooltipBody({
  title,
  bullets,
}: {
  title: string;
  bullets: React.ReactNode[];
}) {
  return (
    <div className="space-y-1 leading-snug">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-white">
        {title}
      </p>
      <ul className="list-disc space-y-0.5 pl-4 text-[11px] marker:text-[#3a3a3a]">
        {bullets.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CardTitleWithTooltip — the small uppercase mono title that sits at the top
// of every overview card (Delivery Progress / Approval Progress / Goal Status
// / etc.), now wrapped in a hover tooltip so reviewers can read what the card
// computes without leaving the page. Dotted underline hints there's an
// explanation behind the label. Use the same `TooltipBody` shape everywhere
// so every overview tooltip looks identical.
// ---------------------------------------------------------------------------

export function CardTitleWithTooltip({
  label,
  body,
}: {
  label: string;
  body: { title: string; bullets: React.ReactNode[] };
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#C4BCAA] cursor-help underline decoration-dotted underline-offset-2 decoration-[#404040] inline-block" />
          }
        >
          {label}
        </TooltipTrigger>
        <TooltipContent>
          <TooltipBody {...body} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Health helpers — shared by ClientDeliveryCards (per-card chip + section
// rollup) and FilterContextCard (Delivery Progress mix card). Same triage
// rule everywhere: cumulative variance vs. one month of SOW.
// ---------------------------------------------------------------------------

export type Health = "healthy" | "watch" | "behind";

export const HEALTH_STYLE: Record<Health, { label: string; color: string; bg: string }> = {
  healthy: { label: "Healthy", color: "#42CA80", bg: "rgba(66,202,128,0.12)" },
  watch:   { label: "Watch",   color: "#F5C542", bg: "rgba(245,197,66,0.12)" },
  behind:  { label: "Behind",  color: "#ED6958", bg: "rgba(237,105,88,0.12)" },
};

export const HEALTH_RANK: Record<Health, number> = { behind: 0, watch: 1, healthy: 2 };

export interface HealthInput {
  /** In-window variance (delivered − invoiced for the active scope). */
  variance: number;
  /** Cumulative variance through the end of scope (lifetime when no filter). */
  variance_cumulative?: number;
  articles_sow: number;
  term_months?: number | null;
}

/** Triage rule: prefer cumulative variance (lifetime balance from the sheet);
 *  if behind by more than ~one month's worth of SOW, the gap can't recover
 *  inside the current month → "behind". Otherwise → "watch". Even or ahead
 *  → "healthy". */
export function healthOf(row: HealthInput): Health {
  const v = row.variance_cumulative ?? row.variance;
  if (v >= 0) return "healthy";
  const monthlySow =
    row.term_months && row.term_months > 0
      ? row.articles_sow / row.term_months
      : 0;
  if (monthlySow > 0 && Math.abs(v) > monthlySow) return "behind";
  return "watch";
}

// ---------------------------------------------------------------------------
// Goal status badge
// ---------------------------------------------------------------------------

export function goalStatusBadge(cbPct: number, adPct: number) {
  const avg = (cbPct + adPct) / 2;
  if (avg >= 75) return (
    <span className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider"
      style={{ backgroundColor: "rgba(66,202,128,.12)", color: "#42CA80" }}>On Track</span>
  );
  if (avg >= 50) return (
    <span className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider"
      style={{ backgroundColor: "rgba(245,188,78,.12)", color: "#F5BC4E" }}>Behind</span>
  );
  return (
    <span className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider"
      style={{ backgroundColor: "rgba(237,105,88,.12)", color: "#ED6958" }}>At Risk</span>
  );
}

// ---------------------------------------------------------------------------
// Sort hook
// ---------------------------------------------------------------------------

type SortDir = "asc" | "desc" | null;

export function useSortableData<T>(data: T[]) {
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
        return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
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
        else if (sortDir === "desc") { setSortKey(null); setSortDir(null); }
      } else { setSortKey(key); setSortDir("asc"); }
    },
    [sortKey, sortDir]
  );

  const getSortIcon = useCallback(
    (key: keyof T) => {
      if (sortKey !== key) return <ArrowUpDown className="ml-1 inline h-3 w-3 text-[#606060]" />;
      if (sortDir === "asc") return <ArrowUp className="ml-1 inline h-3 w-3 text-[#42CA80]" />;
      return <ArrowDown className="ml-1 inline h-3 w-3 text-[#42CA80]" />;
    },
    [sortKey, sortDir]
  );

  return { sorted, toggleSort, getSortIcon };
}

// ---------------------------------------------------------------------------
// Sortable Table Head
// ---------------------------------------------------------------------------

export function SortableHead<T>({
  label, field, toggle, icon,
}: {
  label: string;
  field: keyof T;
  toggle: (key: keyof T) => void;
  icon: (key: keyof T) => React.ReactNode;
}) {
  return (
    <TableHead
      className="cursor-pointer select-none text-xs text-[#C4BCAA] hover:text-white"
      onClick={() => toggle(field)}
    >
      {label}{icon(field)}
    </TableHead>
  );
}
