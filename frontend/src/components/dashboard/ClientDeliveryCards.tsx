"use client";

import React, { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { DataSourceBadge } from "./DataSourceBadge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn, parseISODateLocal } from "@/lib/utils";
import { normalizePod, sortPodKey } from "./ContractClientProgress";
import {
  AsOfBadge,
  HEALTH_STYLE,
  TooltipBody,
  lastCompletedMonthLabel,
  pacingColor,
  podBadge,
  type Health,
} from "./shared-helpers";

export interface ClientDeliveryCardRow {
  id: number;
  name: string;
  status: string;
  editorial_pod: string | null;
  articles_sow: number;
  articles_delivered: number;
  articles_invoiced: number;
  /** Period variance: delivered(scope) − invoiced(scope). "In-window" balance. */
  variance: number;
  /**
   * Cumulative variance through the end of the current scope — matches the
   * sheet's Variance formula at that month. Lifetime when no date filter is
   * active.
   */
  variance_cumulative?: number;
  pct_complete: number;
  /** Contract start date (ISO string). Combined with term_months, this drives the "Month N/M" chip. */
  start_date?: string | null;
  term_months?: number | null;
  /** Per-month rows that contributed to the card totals (drives the detail popover). */
  monthly_breakdown?: Array<{
    year: number;
    month: number;
    delivered: number;
    invoiced: number;
    variance: number;
    /** True when this row is for a month after today. Monthly popover shows
     *  projected deliveries; the card's summary numbers exclude them. */
    is_future?: boolean;
  }>;
}

interface Props {
  rows: ClientDeliveryCardRow[];
  /**
   * Label shown under the section heading when the card scope differs
   * from the user's literal date filter (e.g. a 1-month filter was
   * auto-expanded to its containing calendar quarter so invoicing —
   * which lands quarterly — is comparable to delivery, which is monthly).
   */
  scopeLabel?: string | null;
}

const MONTH_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Shared layout-animation tuning so the cards section feels consistent with
// the Delivery Overview row above. Slow enough to feel intentional, fast
// enough not to drag.
const CARD_TRANSITION = { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const };

// ─────────────────────────────────────────────────────────────────────────────
// Quarter helpers — Health logic now lives in shared-helpers.tsx so the
// Delivery Progress mix card can reuse the same triage rule.
// ─────────────────────────────────────────────────────────────────────────────

interface CurrentQuarter {
  qIdx: number;
  label: string;
  monthsLabel: string;
  deliveredActual: number;
  invoiced: number;
  monthInQ: number;
}
interface LastFullQuarter {
  qIdx: number;
  label: string;
  monthsLabel: string;
  delivered: number;
  invoiced: number;
}
interface QuarterMeta {
  currentQ: CurrentQuarter | null;
  lastFullQ: LastFullQuarter | null;
}

// Aggregates the row's monthly breakdown into contract-relative quarters
// (M1–M3 = Q1, anchored to start_date — same scheme the popover uses) and
// extracts (a) the Q today's calendar month sits in and (b) the most recent
// fully-completed Q. Returns nulls on missing data so callers can no-op.
function contractQuarterMeta(row: ClientDeliveryCardRow): QuarterMeta {
  const empty: QuarterMeta = { currentQ: null, lastFullQ: null };
  const monthly = row.monthly_breakdown;
  if (!monthly?.length) return empty;
  const start = parseISODateLocal(row.start_date);
  if (!start) return empty;
  const startYear = start.getFullYear();
  const startMonth = start.getMonth() + 1;

  const today = new Date();
  const lastCompleted = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const monthIdx = (y: number, m: number) =>
    (y - startYear) * 12 + (m - startMonth) + 1;

  const todayMi = monthIdx(today.getFullYear(), today.getMonth() + 1);
  const lastCompletedMi = monthIdx(
    lastCompleted.getFullYear(),
    lastCompleted.getMonth() + 1,
  );
  if (todayMi < 1) return empty;

  const currentQIdx = Math.floor((todayMi - 1) / 3);
  // A Q is "fully completed" only when its last contract month (qIdx*3+3) ≤
  // last completed month. Otherwise we don't know the closing figures yet.
  const lastFullQIdx =
    lastCompletedMi >= 3 ? Math.floor(lastCompletedMi / 3) - 1 : -1;

  const aggs = new Map<
    number,
    { delivered: number; deliveredActual: number; invoiced: number }
  >();
  for (const r of monthly) {
    const mi = monthIdx(r.year, r.month);
    if (mi < 1) continue;
    const qIdx = Math.floor((mi - 1) / 3);
    const a = aggs.get(qIdx) ?? {
      delivered: 0,
      deliveredActual: 0,
      invoiced: 0,
    };
    a.delivered += r.delivered;
    if (!(r.is_future ?? false)) a.deliveredActual += r.delivered;
    a.invoiced += r.invoiced;
    aggs.set(qIdx, a);
  }

  const labelFor = (qIdx: number): string => {
    const yearIdx = Math.floor(qIdx / 4);
    const qInYear = (qIdx % 4) + 1;
    // Calendar year of the Q's first month — gives "Q1 26" etc.
    const firstMonthAbs = startYear * 12 + (startMonth - 1) + qIdx * 3;
    const firstY = Math.floor(firstMonthAbs / 12);
    return yearIdx === 0
      ? `Q${qInYear} ${String(firstY).slice(-2)}`
      : `Q${qInYear} Y${yearIdx + 1}`;
  };

  // Calendar months that make up the Q ("Jan–Mar"). Anchored to start_date,
  // so a December-start contract correctly reads "Dec–Feb" for its Q1.
  const monthsLabelFor = (qIdx: number): string => {
    const firstAbs = startYear * 12 + (startMonth - 1) + qIdx * 3;
    const firstMonth = (firstAbs % 12) + 1;
    const lastMonth = ((firstAbs + 2) % 12) + 1;
    return `${MONTH_SHORT[firstMonth]}–${MONTH_SHORT[lastMonth]}`;
  };

  let currentQ: CurrentQuarter | null = null;
  const currentAgg = aggs.get(currentQIdx);
  if (currentAgg) {
    currentQ = {
      qIdx: currentQIdx,
      label: labelFor(currentQIdx),
      monthsLabel: monthsLabelFor(currentQIdx),
      deliveredActual: currentAgg.deliveredActual,
      invoiced: currentAgg.invoiced,
      monthInQ: ((todayMi - 1) % 3) + 1,
    };
  }

  let lastFullQ: LastFullQuarter | null = null;
  const lastFullAgg = lastFullQIdx >= 0 ? aggs.get(lastFullQIdx) : null;
  if (lastFullAgg) {
    lastFullQ = {
      qIdx: lastFullQIdx,
      label: labelFor(lastFullQIdx),
      monthsLabel: monthsLabelFor(lastFullQIdx),
      delivered: lastFullAgg.delivered,
      invoiced: lastFullAgg.invoiced,
    };
  }

  return { currentQ, lastFullQ };
}

// Derive a "Month N/M" chip from sheet-native fields only: start_date + term_months.
// Returns null when we can't compute it honestly (missing start, missing term, parse fail).
function contractMonthChip(
  startDate: string | null | undefined,
  termMonths: number | null | undefined,
): { elapsed: number; total: number } | null {
  if (!termMonths || termMonths <= 0) return null;
  const start = parseISODateLocal(startDate);
  if (!start) return null;
  const now = new Date();
  const months =
    (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) + 1;
  if (months < 1) return { elapsed: 0, total: termMonths };
  return { elapsed: Math.min(months, termMonths), total: termMonths };
}

// Linear interpolation between Graphite WN1 cream (low %) and P1 bright
// green (high %). Used for the lifetime SOW bars where the meaning is
// "share of contracted work delivered" — a neutral progress signal, not
// a pacing alarm. Cream at 0% → green at 100%.
function lifetimeBarColor(pct: number): string {
  const t = Math.max(0, Math.min(100, pct)) / 100;
  // WN1 #DDCFAC (221, 207, 172) → P1 #65FFAA (101, 255, 170)
  const r = Math.round(221 + (101 - 221) * t);
  const g = Math.round(207 + (255 - 207) * t);
  const b = Math.round(172 + (170 - 172) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

// Colored bar segment used inside each card for delivered / invoiced lines.
// Lifetime SOW bars use a neutral cream→green degrade (just shows progress).
// The pacing red/yellow/green palette stays on the in-Q rows where the
// signal is "are we on track right now".
function DeliveryBar({
  label,
  current,
  target,
  tooltipTitle,
  tooltipBullets,
}: {
  label: string;
  current: number;
  target: number;
  tooltipTitle: string;
  tooltipBullets: React.ReactNode[];
}) {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const color = target > 0 ? lifetimeBarColor(pct) : "#606060";
  return (
    <div className="flex items-center gap-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="w-14 shrink-0 font-mono text-[10px] text-[#909090] cursor-help underline decoration-dotted decoration-[#404040] underline-offset-2" />
            }
          >
            {label}
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
            <TooltipBody title={tooltipTitle} bullets={tooltipBullets} />
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <div className="flex-1 h-2 rounded-full bg-[#1f1f1f] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.85 }}
        />
      </div>
      <span
        className="w-10 text-right font-mono text-[10px] font-semibold tabular-nums"
        style={{ color: target > 0 ? color : "#606060" }}
      >
        {target > 0 ? `${Math.round(pct)}%` : "—"}
      </span>
      <span className="w-20 text-right font-mono text-[10px] text-[#606060] tabular-nums">
        {current}/{target}
      </span>
    </div>
  );
}

// Bucket a client by its last full Q closure — same rule as the overview
// cards' Delivery Progress / Pod Attention so a client tagged "behind" on
// a card matches the count in the section header above. Returns "no_q"
// when there's no closed quarter yet (new contract, too early to score).
type CardHealth = Health | "no_q";

function lastQHealthFromRow(row: ClientDeliveryCardRow): CardHealth {
  const q = contractQuarterMeta(row).lastFullQ;
  if (!q || q.invoiced <= 0) return "no_q";
  const pct = (q.delivered / q.invoiced) * 100;
  if (pct >= 100) return "healthy";
  if (pct >= 75) return "watch";
  return "behind";
}

const CARD_HEALTH_RANK: Record<CardHealth, number> = {
  behind: 0,
  watch: 1,
  healthy: 2,
  no_q: 3,
};

const CARD_HEALTH_STYLE: Record<
  CardHealth,
  { label: string; color: string; bg: string }
> = {
  ...HEALTH_STYLE,
  no_q: { label: "New", color: "#DDCFAC", bg: "rgba(221,207,172,0.10)" },
};

function ClientDeliveryCard({ row }: { row: ClientDeliveryCardRow }) {
  const monthChip = contractMonthChip(row.start_date, row.term_months);
  const health = lastQHealthFromRow(row);
  const qMeta = contractQuarterMeta(row);
  const hasQContext = !!(qMeta.lastFullQ || qMeta.currentQ);
  const statusLabel =
    row.status === "ACTIVE" ? "Active" : row.status.toLowerCase();
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-4 animate-fade-slide hover:border-[#333] transition-colors">
      {/* Header — name + month chip */}
      <div className="flex items-start justify-between gap-2">
        <p
          className="min-w-0 flex-1 truncate font-semibold text-white text-sm"
          title={row.name}
        >
          {row.name}
        </p>
        {monthChip && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="shrink-0 cursor-help rounded-full border border-[#2a2a2a] bg-[#0d0d0d] px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#C4BCAA] tabular-nums" />
                }
              >
                Month {monthChip.elapsed}/{monthChip.total}
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
                <TooltipBody
                  title="Contract month"
                  bullets={[
                    "Elapsed month ÷ total term length",
                    "Spans the full relationship across renewals",
                    "Source: Delivered vs Invoiced v2 — first and last active months",
                  ]}
                />
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Status row — health is the prominent triage signal */}
      <div className="mt-1.5 flex items-center gap-2">
        <HealthChip health={health} />
        <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
          {statusLabel}
        </span>
      </div>

      {/* Quarter performance — primary actionable block, top of the body */}
      {hasQContext && (
        <div className="mt-3 space-y-2 rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2.5">
          <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-[#606060]">
            Quarter Performance
          </p>
          <div className="space-y-2.5">
            {qMeta.lastFullQ && (
              <QuarterRow
                kind="lastFull"
                label={qMeta.lastFullQ.label}
                monthsLabel={qMeta.lastFullQ.monthsLabel}
                delivered={qMeta.lastFullQ.delivered}
                target={qMeta.lastFullQ.invoiced}
                monthInQ={null}
                tooltipTitle="Last full Q closure"
                tooltipBullets={[
                  "Most recent fully-completed contract quarter",
                  "Delivered ÷ Q's invoicing target (contracted)",
                  "<100% = closed behind",
                ]}
              />
            )}
            {qMeta.currentQ && (
              <QuarterRow
                kind="current"
                label={qMeta.currentQ.label}
                monthsLabel={qMeta.currentQ.monthsLabel}
                delivered={qMeta.currentQ.deliveredActual}
                target={qMeta.currentQ.invoiced}
                monthInQ={qMeta.currentQ.monthInQ}
                tooltipTitle="Current Q progress"
                tooltipBullets={[
                  "Quarter today's month falls in",
                  "Delivered: settled months only (excludes projections)",
                  "% = partial progress vs full Q goal",
                ]}
              />
            )}
          </div>
        </div>
      )}

      {/* Lifetime — secondary tier, separated by a divider */}
      <div className="mt-3 border-t border-[#2a2a2a] pt-3">
        <div className="mb-2 flex items-center justify-between">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-[#606060] cursor-help underline decoration-dotted decoration-[#404040] underline-offset-2" />
                }
              >
                Lifetime · SOW
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
                <TooltipBody
                  title="SOW (lifetime)"
                  bullets={[
                    "Contracted article total for the full engagement",
                    "Source: Editorial SOW overview · # Articles SOW",
                  ]}
                />
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span className="font-mono text-[12px] font-semibold text-white tabular-nums">
            {row.articles_sow.toLocaleString()}
          </span>
        </div>
        <div className="space-y-1.5">
          <DeliveryBar
            label="Delivered"
            current={row.articles_delivered}
            target={row.articles_invoiced}
            tooltipTitle="Delivered ÷ Invoiced"
            tooltipBullets={[
              "Share of billed work that's shipped.",
              "Bar fades cream → green by progress.",
            ]}
          />
          <DeliveryBar
            label="Invoiced"
            current={row.articles_invoiced}
            target={row.articles_sow}
            tooltipTitle="Invoiced ÷ SOW"
            tooltipBullets={[
              "Share of contracted SOW that's been billed.",
              "Bar fades cream → green by progress.",
            ]}
          />
        </div>
      </div>

      {/* Footer — single right-aligned link to the per-month detail */}
      <div className="mt-3 flex justify-end border-t border-[#2a2a2a] pt-2">
        <MonthlyBreakdownPopover
          row={row}
          currentQIdx={qMeta.currentQ?.qIdx ?? null}
          lastFullQIdx={qMeta.lastFullQ?.qIdx ?? null}
        />
      </div>
    </div>
  );
}

function HealthChip({ health }: { health: CardHealth }) {
  const style = CARD_HEALTH_STYLE[health];
  const bullets =
    health === "healthy"
      ? ["Closed last Q at or above target (≥100%)"]
      : health === "watch"
      ? ["Closed last Q at 75–99%"]
      : health === "behind"
      ? ["Closed last Q under 75%"]
      : ["Too new to score — no closed Q yet"];
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className="inline-flex items-center gap-1 rounded-sm px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-wider cursor-help"
              style={{ color: style.color, backgroundColor: style.bg }}
            />
          }
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: style.color }}
          />
          {style.label}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
          <TooltipBody title={style.label} bullets={bullets} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Two-row quarter readout: a small "Last Full Q" / "Current Q" pill (the
// only thing that triggers the tooltip), the Q's calendar label, the raw
// count, then a progress bar + percentage. Built to mirror DeliveryBar's
// visual rhythm so eyes scan all four bars consistently.
function QuarterRow({
  kind,
  label,
  monthsLabel,
  delivered,
  target,
  monthInQ,
  tooltipTitle,
  tooltipBullets,
}: {
  kind: "lastFull" | "current";
  label: string;
  monthsLabel: string;
  delivered: number;
  target: number;
  monthInQ: number | null;
  tooltipTitle: string;
  tooltipBullets: React.ReactNode[];
}) {
  const pct = target > 0 ? Math.min(Math.round((delivered / target) * 100), 999) : null;
  const barPct = pct === null ? 0 : Math.min(pct, 100);
  // Last Full Q: closure is final, judge by absolute %. Current Q: pacing-
  // aware — at M1 of 3, expecting 17% delivery, so 20% is on-pace, not red.
  let color: string;
  if (pct === null) {
    color = "#606060";
  } else if (kind === "current" && monthInQ !== null) {
    const elapsedInQ = ((monthInQ - 0.5) / 3) * 100;
    color = pacingColor(pct, elapsedInQ);
  } else {
    color = pct >= 75 ? "#42CA80" : pct >= 50 ? "#F5C542" : "#ED6958";
  }

  const badge =
    kind === "lastFull"
      ? { text: "Last Full Q", fg: "#42CA80", bg: "rgba(66,202,128,0.14)" }
      : { text: "Current Q", fg: "#F5BC4E", bg: "rgba(245,188,78,0.14)" };

  return (
    <div>
      {/* Top row — only the kind pill triggers the tooltip */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className="shrink-0 cursor-help rounded-sm px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-wider"
                    style={{ color: badge.fg, backgroundColor: badge.bg }}
                  />
                }
              >
                {badge.text}
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
                <TooltipBody title={tooltipTitle} bullets={tooltipBullets} />
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span className="font-mono text-[11px] text-[#C4BCAA] tabular-nums">
            {label}
          </span>
          <span className="font-mono text-[10px] text-[#606060] tabular-nums">
            · {monthsLabel}
          </span>
          {monthInQ !== null && (
            <span className="font-mono text-[10px] text-[#606060] tabular-nums">
              · M{monthInQ}/3
            </span>
          )}
        </div>
        <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-white">
          {delivered}
          <span className="text-[#606060]">/{target}</span>
        </span>
      </div>
      {/* Bottom row — progress bar + percentage */}
      <div className="mt-1 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#1f1f1f]">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${barPct}%`, backgroundColor: color }}
          />
        </div>
        <span
          className="w-10 shrink-0 text-right font-mono text-[10px] font-semibold tabular-nums"
          style={{ color }}
        >
          {pct !== null ? `${pct}%` : "—"}
        </span>
      </div>
    </div>
  );
}

function BreakdownHeader({
  label,
  title,
  bullets,
  align = "right",
}: {
  label: string;
  title: string;
  bullets: React.ReactNode[];
  align?: "left" | "right";
}) {
  return (
    <th
      className={cn(
        "px-2 py-1 font-semibold uppercase tracking-wider text-[10px]",
        align === "left" ? "text-left" : "text-right",
      )}
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="cursor-help underline decoration-dotted decoration-[#404040] underline-offset-2" />
            }
          >
            {label}
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
            <TooltipBody title={title} bullets={bullets} />
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </th>
  );
}

function MonthlyBreakdownPopover({
  row,
  currentQIdx,
  lastFullQIdx,
}: {
  row: ClientDeliveryCardRow;
  currentQIdx: number | null;
  lastFullQIdx: number | null;
}) {
  const rows = row.monthly_breakdown ?? [];
  if (rows.length === 0) return null;

  // Matches the sheet's mental model: Article Deliveries is monthly, but
  // Invoicing / Cumulative are quarterly — and the sheet's quarters are
  // CONTRACT-relative (M1–M3 = Q1, M4–M6 = Q2, …) anchored to the client's
  // start_date, not calendar quarters. Group by contract-relative Q so the
  // Invoiced total lines up with the sheet for clients that start outside
  // a calendar quarter boundary (e.g. Boulevard starts Dec → Q1 = Dec/Jan/Feb).
  type MonthRow = {
    year: number;
    month: number;
    delivered: number;
    invoiced: number;
    cumDelivered: number;
    /** True for months after today — numbers come from forecasted rows in
     *  the sheet, not real deliveries. Rendered muted/italic. */
    isFuture: boolean;
    /** True for the current calendar month. Its cumulative figures are what
     *  the card's summary totals show, so we highlight the row. */
    isCurrent: boolean;
  };
  type QGroup = {
    key: string;
    qIdx: number;
    label: string;
    months: MonthRow[];
    invoicedQ: number; // Σ invoiced within this Q's months
    cumInvoiced: number; // Σ invoiced across every Q up to and including this one
  };

  const start = parseISODateLocal(row.start_date);
  const startYear = start ? start.getFullYear() : null;
  const startMonth = start ? start.getMonth() + 1 : null; // 1-indexed

  // Contract-month index (M1-based). Returns 1 for the first contract month.
  // Falls back to a calendar-based index if start_date is missing, so the
  // grouping still works but will display "Q? · yy" using calendar quarters.
  const contractMonthIndex = (y: number, m: number): number => {
    if (startYear == null || startMonth == null) {
      return (y - 2000) * 12 + m; // monotonic anchor for stable grouping
    }
    return (y - startYear) * 12 + (m - startMonth) + 1;
  };

  // Highlight the **last completed month** (today's month minus one), not
  // the in-progress current month. The popover's Cum Del at that row is
  // what the card's summary total reflects.
  const now = new Date();
  const lastCompleted = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const nowY = lastCompleted.getFullYear();
  const nowM = lastCompleted.getMonth() + 1;

  const groups: QGroup[] = [];
  const running = { delivered: 0, invoiced: 0 };
  for (const r of rows) {
    const mi = contractMonthIndex(r.year, r.month); // 1..N
    const contractQIdx = Math.floor((mi - 1) / 3); // 0-based Q
    const yearIdx = Math.floor(contractQIdx / 4); // 0 = Y1, 1 = Y2, …
    const qInYear = (contractQIdx % 4) + 1;
    const qLabel = yearIdx === 0 ? `Q${qInYear}` : `Q${qInYear} Y${yearIdx + 1}`;
    const qKey = `contract-Q${contractQIdx}`;

    running.delivered += r.delivered;
    running.invoiced += r.invoiced;
    const mrow: MonthRow = {
      year: r.year,
      month: r.month,
      delivered: r.delivered,
      invoiced: r.invoiced,
      cumDelivered: running.delivered,
      isFuture: r.is_future ?? false,
      isCurrent: r.year === nowY && r.month === nowM,
    };
    const existing = groups.find((g) => g.key === qKey);
    if (existing) {
      existing.months.push(mrow);
      existing.invoicedQ += r.invoiced;
      existing.cumInvoiced = running.invoiced;
    } else {
      groups.push({
        key: qKey,
        qIdx: contractQIdx,
        label: qLabel,
        months: [mrow],
        invoicedQ: r.invoiced,
        cumInvoiced: running.invoiced,
      });
    }
  }

  const grandTotals = {
    delivered: running.delivered,
    invoiced: running.invoiced,
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="font-mono text-[11px] uppercase tracking-wider text-[#606060] hover:text-[#C4BCAA] transition-colors"
          />
        }
      >
        Monthly detail
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="w-auto max-w-[560px] border border-[#2a2a2a] bg-[#0d0d0d] p-0 text-popover-foreground"
      >
        <div className="border-b border-[#2a2a2a] px-3 py-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-mono text-xs font-semibold text-white">{row.name}</p>
            <p className="font-mono text-[10px] text-[#909090]">
              As of{" "}
              <span className="text-[#65FFAA] font-semibold">
                {MONTH_SHORT[nowM]} {String(nowY).slice(-2)}
              </span>
            </p>
          </div>
          <ul className="mt-1.5 space-y-0.5 font-mono text-[10px] leading-snug text-[#909090] list-disc pl-4 marker:text-[#3a3a3a]">
            <li>
              <span className="rounded-sm bg-[#42CA80]/20 px-1 py-px text-[9px] font-semibold uppercase not-italic tracking-wider text-[#42CA80]">as of</span>
              {" "}= last completed month. Its Cum Del matches the card&apos;s Delivered total.
            </li>
            <li>
              <span className="rounded-sm bg-[#3a2e1a] px-1 py-px text-[9px] font-semibold uppercase not-italic tracking-wider text-[#F5BC4E]">proj</span>
              {" "}= future months with forecast values. Excluded from card totals.
            </li>
            <li>
              <span className="rounded-sm bg-[#42CA80]/15 px-1 py-px text-[9px] font-semibold uppercase not-italic tracking-wider text-[#42CA80]">last full</span>
              {" "}/{" "}
              <span className="rounded-sm bg-[#F5BC4E]/15 px-1 py-px text-[9px] font-semibold uppercase not-italic tracking-wider text-[#F5BC4E]">in progress</span>
              {" "}tag the most recent settled Q vs. the Q today sits in. Delivered is monthly; Invoicing + Cumulative are quarterly.
            </li>
          </ul>
        </div>
        <div className="max-h-[300px] overflow-y-auto">
          <table className="w-full border-collapse font-mono text-[10px]">
            <thead className="sticky top-0 bg-[#0d0d0d] shadow-[0_1px_0_0_#2a2a2a]">
              <tr className="text-[#606060]">
                <BreakdownHeader
                  label="Month"
                  align="left"
                  title="Month"
                  bullets={[
                    "One row per contract month",
                    "Source: sheet's M1, M2, … columns",
                  ]}
                />
                <BreakdownHeader
                  label="Delivered"
                  title="Delivered"
                  bullets={[
                    "Articles delivered this month",
                    "Source: Article Deliveries row in the sheet",
                  ]}
                />
                <BreakdownHeader
                  label="Cum Del"
                  title="Cumulative Delivered"
                  bullets={[
                    "Running total of delivered articles in scope",
                    "AS OF row matches the card's Delivered total",
                  ]}
                />
                <BreakdownHeader
                  label="Invoiced (Q)"
                  title="Invoiced per Quarter"
                  bullets={[
                    "Total invoicing within the contract Q",
                    "Spans the Q's months (like the sheet)",
                  ]}
                />
                <BreakdownHeader
                  label="Cum Inv"
                  title="Cumulative Invoiced"
                  bullets={[
                    "Running total of invoicing across every Q in scope",
                  ]}
                />
              </tr>
            </thead>
            <tbody>
              {groups.map((g) =>
                g.months.map((m, i) => {
                  const isFirst = i === 0;
                  return (
                    <tr
                      key={`${g.key}-${m.year}-${m.month}`}
                      className={cn(
                        "border-t border-[#1a1a1a]",
                        isFirst && "border-t-2 border-[#2a2a2a]",
                        m.isFuture && "italic",
                        m.isCurrent && "bg-[#42CA80]/8",
                      )}
                      style={m.isCurrent ? { boxShadow: "inset 2px 0 0 #42CA80" } : undefined}
                    >
                      <td className={cn("px-2 py-0.5", m.isFuture ? "text-[#8a8475]" : m.isCurrent ? "text-white font-semibold" : "text-[#C4BCAA]")}>
                        <span className="inline-flex items-center gap-1.5">
                          {MONTH_SHORT[m.month]} {String(m.year).slice(-2)}
                          {m.isCurrent && (
                            <span className="rounded-sm bg-[#42CA80]/20 px-1 py-px text-[10px] font-semibold uppercase not-italic tracking-wider text-[#42CA80]">
                              as of
                            </span>
                          )}
                          {m.isFuture && (
                            <span className="rounded-sm bg-[#3a2e1a] px-1 py-px text-[10px] font-semibold uppercase not-italic tracking-wider text-[#F5BC4E]">
                              proj
                            </span>
                          )}
                        </span>
                      </td>
                      <td className={cn("px-2 py-0.5 text-right tabular-nums", m.isFuture ? "text-[#8a8475]" : m.isCurrent ? "text-white font-semibold" : "text-white")}>
                        {m.delivered}
                      </td>
                      <td className={cn("px-2 py-0.5 text-right tabular-nums", m.isFuture ? "text-[#8a8475]" : m.isCurrent ? "text-[#42CA80] font-bold" : "text-[#C4BCAA]")}>
                        {m.cumDelivered}
                      </td>
                      {isFirst && (
                        <>
                          <td
                            rowSpan={g.months.length}
                            className="border-l border-[#2a2a2a] bg-[#111111] px-2 py-0.5 text-center align-middle tabular-nums text-white"
                          >
                            <div className="font-semibold">{g.invoicedQ}</div>
                            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-[#606060]">
                              {g.label}
                            </div>
                            {g.qIdx === lastFullQIdx && (
                              <div className="mt-0.5 inline-block rounded-sm bg-[#42CA80]/15 px-1 py-px font-mono text-[9px] font-semibold uppercase not-italic tracking-wider text-[#42CA80]">
                                Last full
                              </div>
                            )}
                            {g.qIdx === currentQIdx && (
                              <div className="mt-0.5 inline-block rounded-sm bg-[#F5BC4E]/15 px-1 py-px font-mono text-[9px] font-semibold uppercase not-italic tracking-wider text-[#F5BC4E]">
                                In progress
                              </div>
                            )}
                          </td>
                          <td
                            rowSpan={g.months.length}
                            className="bg-[#111111] px-2 py-0.5 text-center align-middle tabular-nums text-[#C4BCAA]"
                          >
                            {g.cumInvoiced}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                }),
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[#2a2a2a] bg-[#161616]">
                <td className="px-2 py-1 font-semibold uppercase tracking-wider text-[#606060]">
                  Total
                </td>
                <td className="px-2 py-1 text-right tabular-nums font-semibold text-white">
                  {grandTotals.delivered}
                </td>
                <td className="px-2 py-1" />
                <td className="border-l border-[#2a2a2a] bg-[#111111] px-2 py-1 text-center tabular-nums font-semibold text-white">
                  {grandTotals.invoiced}
                </td>
                <td className="bg-[#111111] px-2 py-1" />
              </tr>
            </tfoot>
          </table>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ClientDeliveryCards({ rows, scopeLabel }: Props) {
  // Card totals exclude the in-progress month, so the section "as of" point
  // is the last completed calendar month.
  const asOfLabel = lastCompletedMonthLabel();
  // Triage-first: behind → watch → healthy → new (no closed Q), alphabetical
  // inside each tier. This is preserved when we group by pod below (Map keeps
  // insertion order), so attention-needing clients float to the top of every
  // pod's grid.
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const rankA = CARD_HEALTH_RANK[lastQHealthFromRow(a)];
        const rankB = CARD_HEALTH_RANK[lastQHealthFromRow(b)];
        if (rankA !== rankB) return rankA - rankB;
        return a.name.localeCompare(b.name);
      }),
    [rows],
  );

  // Section-level rollup so the heading itself answers "how are clients going?"
  const summary = useMemo(() => {
    const counts: Record<CardHealth, number> = {
      healthy: 0,
      watch: 0,
      behind: 0,
      no_q: 0,
    };
    for (const r of rows) counts[lastQHealthFromRow(r)]++;
    return counts;
  }, [rows]);

  return (
    <div className="space-y-4">
      {/* Heading */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
            Client Delivery At a Glance{" "}
            <DataSourceBadge
              type="live"
              source="Sheet: 'Delivered vs Invoiced v2' + 'Editorial SOW overview' — Spreadsheet: Editorial Capacity Planning. One card per filtered client. SOW is lifetime. Delivered / Invoiced sum the per-month rows for the active date range, expanded to complete contract quarters (M1–M3 = Q1 anchored to each client's start_date)."
              shows={[
                "Triage-first sort: BEHIND surfaces at the top of each pod, then WATCH, then HEALTHY, then NEW (alphabetical within each tier).",
                "Health chip uses last full Q closure: BEHIND = closed under 75%; WATCH = closed at 75–99%; HEALTHY = closed at or above target (≥100%); NEW = no closed Q yet.",
                "Two horizontal bars: Delivered vs Invoiced (top) and Invoiced vs SOW (bottom) — color-coded by %, raw numbers on the right.",
                "Quarter context: Last full Q (most recent settled quarter, delivered/invoiced/%) and Current Q (partial progress, with M of 3).",
                "Click \"Monthly detail\" for the per-month breakdown — AS OF row = last completed month, IN PROGRESS / LAST FULL chips tag the corresponding quarters' invoicing cells.",
                "Card totals exclude the in-progress month, so they always reflect data through the last completed month.",
              ]}
            />
          </h3>
          <AsOfBadge label={asOfLabel} />
        </div>
        {scopeLabel && (
          <p className="mt-1 font-mono text-[11px] text-[#8FB5D9]">
            {scopeLabel}
          </p>
        )}
        {rows.length > 0 && (
          <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider tabular-nums">
            <span className="flex items-center gap-1" style={{ color: "#ED6958" }}>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
              {summary.behind} behind
            </span>
            <span className="text-[#2a2a2a]">·</span>
            <span className="flex items-center gap-1" style={{ color: "#F5C542" }}>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
              {summary.watch} watch
            </span>
            <span className="text-[#2a2a2a]">·</span>
            <span className="flex items-center gap-1" style={{ color: "#42CA80" }}>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
              {summary.healthy} healthy
            </span>
            {summary.no_q > 0 && (
              <>
                <span className="text-[#2a2a2a]">·</span>
                <span
                  className="flex items-center gap-1"
                  style={{ color: "#DDCFAC" }}
                  title="No closed Q yet — too new to score"
                >
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
                  {summary.no_q} new
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="text-center text-xs text-[#606060] py-6">
          No clients match the current filters.
        </p>
      ) : (
        <motion.div layout transition={CARD_TRANSITION} className="space-y-5">
          <AnimatePresence mode="popLayout" initial={false}>
            {(() => {
              const groups = new Map<string, ClientDeliveryCardRow[]>();
              for (const r of sorted) {
                const pod = normalizePod(r.editorial_pod);
                const list = groups.get(pod);
                if (list) list.push(r);
                else groups.set(pod, [r]);
              }
              return Array.from(groups.entries())
                .sort(([a], [b]) => sortPodKey(a, b))
                .map(([pod, items]) => (
                  <motion.div
                    key={`pod-group-${pod}`}
                    id={`client-delivery-pod-${pod.replace(/\s+/g, "-").toLowerCase()}`}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={CARD_TRANSITION}
                    className="space-y-2 scroll-mt-[180px]"
                  >
                    <div className="flex items-center gap-2">
                      {podBadge(pod)}
                      <span className="font-mono text-[11px] text-[#606060]">
                        {items.length} client{items.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <motion.div
                      layout
                      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                    >
                      <AnimatePresence mode="popLayout" initial={false}>
                        {items.map((row) => (
                          <motion.div
                            key={row.id}
                            id={`client-delivery-${row.id}`}
                            layout
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={CARD_TRANSITION}
                            className="scroll-mt-[180px]"
                          >
                            <ClientDeliveryCard row={row} />
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </motion.div>
                  </motion.div>
                ));
            })()}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
