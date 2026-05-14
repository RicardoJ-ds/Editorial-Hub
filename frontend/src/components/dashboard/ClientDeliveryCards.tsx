"use client";

import React, { useEffect, useRef, useMemo } from "react";
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
import { useEditorialAsOf } from "@/lib/editorialWeeksClient";
import { useCurrentPodAxis } from "@/lib/podAxisClient";
import { revealCurrentHashTarget } from "@/lib/detailTargets";
import {
  AsOfBadge,
  TooltipBody,
  podBadge,
} from "./shared-helpers";

export interface ClientDeliveryCardRow {
  id: number;
  name: string;
  status: string;
  editorial_pod: string | null;
  growth_pod: string | null;
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
  /** Contract end date (ISO string). Drives post-contract truncation in the
   *  popover for COMPLETED / INACTIVE clients — months past this date stop
   *  joining the prior billing period. */
  end_date?: string | null;
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

/** Year/month bounds that constrain which billing periods render in the
 *  Monthly Detail popover. A period is shown when at least one of its months
 *  falls inside the bound (period stays whole — its other months show too,
 *  even if outside the bound). Null = no filter, show every period. */
export interface FilterRange {
  fromYear: number;
  fromMonth: number;
  toYear: number;
  toMonth: number;
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
  /** User's active date filter, propagated into the popover so it can hide
   *  periods that don't overlap. When null/undefined, the popover renders
   *  every detected period for the client. */
  filterRange?: FilterRange | null;
  /** When true, each pod group renders inside a `<details>` element that
   *  starts collapsed. Used by the Overview dashboard so a portfolio-wide
   *  view doesn't dump 50+ cards on the page at once. Default = false
   *  (D1 behavior unchanged). */
  defaultCollapsedByPod?: boolean;
  /** When true, the component's internal "Client Delivery At a Glance"
   *  h3 + DataSourceBadge + AsOf badge are NOT rendered. Used when the
   *  parent already provides its own section heading (e.g. the Overview
   *  page passes the same title at the Section level — without this
   *  prop the two headings would stack and read as a duplicate). */
  hideHeader?: boolean;
}

const MONTH_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Per-period variance bucketing — mirrors the conditional-format the
// "Delivered vs Invoiced" sheet uses: zero is the target, modest deltas are
// a watch signal, large deltas (over- or under-delivered) are a flag. Magnitude-
// based on purpose so an over-delivery (+10) reads the same as an under-
// delivery (−10) at a glance — the sign is right next to the cell anyway.
function varianceColor(v: number): string {
  const abs = Math.abs(v);
  if (abs === 0) return "#42CA80"; // P2 green — on target
  if (abs <= 5) return "#F5BC4E"; // S6 amber — drifting
  return "#ED6958"; // S7 red — out of bounds
}

function varianceBg(v: number): string {
  const abs = Math.abs(v);
  if (abs === 0) return "rgba(66,202,128,0.10)";
  if (abs <= 5) return "rgba(245,188,78,0.10)";
  return "rgba(237,105,88,0.10)";
}

// Shared layout-animation tuning so the cards section feels consistent with
// the Delivery Overview row above. Slow enough to feel intentional, fast
// enough not to drag.
const CARD_TRANSITION = { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const };

// ─────────────────────────────────────────────────────────────────────────────
// Billing-period detection — replaces the old fixed M1–M3 = Q1 quarter scheme
// with a data-driven grouping that mirrors the spreadsheet's merged-cell
// layout. A new period opens on a month with invoiced > 0; subsequent months
// with invoiced === 0 join it. Periods come out as 1-, 2-, 3- or 5-month
// spans — whatever the contract actually invoices on. Numbered Q1, Q2, …
// within each contract year (M1–M12 = Y1, M13–M24 = Y2, …); Y2+ periods get
// a `Y{n}` suffix to stay distinguishable across years.
// ─────────────────────────────────────────────────────────────────────────────

type MonthRow = NonNullable<ClientDeliveryCardRow["monthly_breakdown"]>[number];

interface BillingPeriod {
  /** Sequential index across all detected periods (0-based). The card and
   *  popover compare against this to mark LAST FULL / IN PROGRESS, so it has
   *  to stay stable between the two. */
  qIdx: number;
  /** Display label like "Q3" or "Q1 Y2". Empty for prelude/post-contract. */
  label: string;
  /** Calendar-month span: "Jan–Mar 26" or "Dec 25–Feb 26". */
  monthsLabel: string;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  /** Months in chronological order. */
  months: MonthRow[];
  /** Σ invoiced across the period. In practice equals the first month's value
   *  because the rest are 0 (merged cells in the source sheet). */
  invoicedQ: number;
  /** True when this is the unbilled prefix — months before any invoicing.
   *  Rendered without a Q label or chip; numbering picks up at the first real
   *  billing period. Rare in practice (most contracts invoice from M1). */
  isPrelude: boolean;
  /** True when this entry is a single post-contract row (typically a final
   *  reconciliation / credit). Stands alone — no Q label, no LAST FULL /
   *  IN PROGRESS chip, but its non-zero invoicing still ticks Cum Inv. */
  isPostContract: boolean;
}

function detectBillingPeriods(row: ClientDeliveryCardRow): BillingPeriod[] {
  const monthly = row.monthly_breakdown ?? [];
  if (monthly.length === 0) return [];
  const sorted = [...monthly].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month,
  );
  const start = parseISODateLocal(row.start_date);
  const startYear = start ? start.getFullYear() : null;
  const startMonth = start ? start.getMonth() + 1 : null;

  // Post-contract truncation: when a contract is finished and we know its end
  // date, months past that month stop joining the prior period. All-zero post
  // rows are dropped (importer noise). Non-zero post rows (e.g. a final
  // credit) become standalone "POST" entries so the user sees them but
  // they don't pollute the last in-contract billing period.
  const end = parseISODateLocal(row.end_date);
  const isFinished =
    row.status === "COMPLETED" ||
    row.status === "INACTIVE" ||
    row.status === "PAUSED";
  const enforcePost = isFinished && end != null;
  const endYearStrict = end ? end.getFullYear() : null;
  const endMonthStrict = end ? end.getMonth() + 1 : null;
  const isPostContract = (y: number, m: number): boolean => {
    if (!enforcePost || endYearStrict == null || endMonthStrict == null) return false;
    if (y > endYearStrict) return true;
    if (y === endYearStrict && m > endMonthStrict) return true;
    return false;
  };

  type Raw = Omit<BillingPeriod, "qIdx" | "label" | "monthsLabel">;
  const raw: Raw[] = [];
  let current: Raw | null = null;
  let prelude: Raw | null = null;
  for (const r of sorted) {
    if (isPostContract(r.year, r.month)) {
      // Close any open period first — post-contract rows never extend it.
      if (prelude) {
        raw.push(prelude);
        prelude = null;
      }
      if (current) {
        raw.push(current);
        current = null;
      }
      // Drop all-zero noise; surface only rows with real data.
      if (r.invoiced === 0 && r.delivered === 0) continue;
      raw.push({
        startYear: r.year,
        startMonth: r.month,
        endYear: r.year,
        endMonth: r.month,
        months: [r],
        invoicedQ: r.invoiced,
        isPrelude: false,
        isPostContract: true,
      });
      continue;
    }

    if (r.invoiced > 0) {
      // First non-zero closes any preceding prelude or open period.
      if (prelude) {
        raw.push(prelude);
        prelude = null;
      }
      if (current) raw.push(current);
      current = {
        startYear: r.year,
        startMonth: r.month,
        endYear: r.year,
        endMonth: r.month,
        months: [r],
        invoicedQ: r.invoiced,
        isPrelude: false,
        isPostContract: false,
      };
    } else if (current) {
      // Zero-invoiced month joins the open period (matches merged cells).
      current.endYear = r.year;
      current.endMonth = r.month;
      current.months.push(r);
    } else if (prelude) {
      prelude.endYear = r.year;
      prelude.endMonth = r.month;
      prelude.months.push(r);
    } else {
      prelude = {
        startYear: r.year,
        startMonth: r.month,
        endYear: r.year,
        endMonth: r.month,
        months: [r],
        invoicedQ: 0,
        isPrelude: true,
        isPostContract: false,
      };
    }
  }
  if (current) raw.push(current);
  if (prelude) raw.push(prelude);

  // Number billing periods Q1, Q2, … within each contract year. Year boundary
  // is the period's start month: M1–M12 = Y1, M13–M24 = Y2, etc. Prelude and
  // post-contract entries don't consume a Q number — they render with no
  // label / a "POST" tag respectively.
  let prevYearIdx = -1;
  let qInYear = 0;
  return raw.map((p, idx) => {
    let label = "";
    const skipNumbering = p.isPrelude || p.isPostContract;
    if (!skipNumbering && startYear != null && startMonth != null) {
      const mi = (p.startYear - startYear) * 12 + (p.startMonth - startMonth) + 1;
      const yearIdx = mi >= 1 ? Math.floor((mi - 1) / 12) : 0;
      if (yearIdx !== prevYearIdx) {
        qInYear = 0;
        prevYearIdx = yearIdx;
      }
      qInYear += 1;
      label = yearIdx === 0 ? `Q${qInYear}` : `Q${qInYear} Y${yearIdx + 1}`;
    } else if (!skipNumbering) {
      // No start_date — fall back to flat sequential numbering.
      qInYear += 1;
      label = `Q${qInYear}`;
    }
    const startStr = `${MONTH_SHORT[p.startMonth]} ${String(p.startYear).slice(-2)}`;
    const endStr = `${MONTH_SHORT[p.endMonth]} ${String(p.endYear).slice(-2)}`;
    let monthsLabel: string;
    if (p.startYear === p.endYear && p.startMonth === p.endMonth) {
      monthsLabel = startStr;
    } else if (p.startYear === p.endYear) {
      monthsLabel = `${MONTH_SHORT[p.startMonth]}–${MONTH_SHORT[p.endMonth]} ${String(p.endYear).slice(-2)}`;
    } else {
      monthsLabel = `${startStr}–${endStr}`;
    }
    return { ...p, qIdx: idx, label, monthsLabel };
  });
}

interface CurrentQuarter {
  qIdx: number;
  label: string;
  monthsLabel: string;
  deliveredActual: number;
  invoiced: number;
  /** 1-based position of today's calendar month within the period. */
  monthInQ: number;
  /** Total months in the period — drives the M{n}/{N} chip and pacing math. */
  qLength: number;
  /** Cumulative variance projected through end of this Q (Σ delivered
   *  actuals + projections for future months IN this Q − Σ contracted
   *  invoicing from contract start through end of this Q). Matches the
   *  spreadsheet's Variance row math and the Overview Triage cards. */
  projectedEndCumVariance: number;
  /** Companion field: actual cumulative delivered (actuals + projections)
   *  through end of this Q, used in the informational tooltip. */
  projectedEndCumDelivered: number;
  /** Cumulative invoicing target through end of this Q. */
  endOfQCumInvoiced: number;
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

// "Last full" = latest period whose end month is ≤ last completed calendar
// month. "Current" = period whose [start, end] window contains today.
// Preludes are skipped (no Q to attach a chip to).
function quarterMetaFromPeriods(periods: BillingPeriod[]): QuarterMeta {
  if (periods.length === 0) return { currentQ: null, lastFullQ: null };
  const today = new Date();
  const todayY = today.getFullYear();
  const todayM = today.getMonth() + 1;
  const lastCompleted = new Date(todayY, today.getMonth() - 1, 1);
  const cellOf = (y: number, m: number) => y * 12 + (m - 1);
  const todayCell = cellOf(todayY, todayM);
  const lastCell = cellOf(lastCompleted.getFullYear(), lastCompleted.getMonth() + 1);

  let currentQ: CurrentQuarter | null = null;
  let lastFullQ: LastFullQuarter | null = null;
  // Running totals so we can attach the cumulative-end-of-Q numbers
  // (matching the spreadsheet's Variance row math) to the current Q.
  let cumDelivered = 0;
  let cumInvoiced = 0;
  for (const p of periods) {
    cumInvoiced += p.invoicedQ;
    for (const m of p.months) {
      cumDelivered += m.delivered;
    }
    if (p.isPrelude || p.isPostContract) continue;
    const startCell = cellOf(p.startYear, p.startMonth);
    const endCell = cellOf(p.endYear, p.endMonth);

    if (startCell <= todayCell && todayCell <= endCell) {
      let deliveredActual = 0;
      let monthInQ = 0;
      for (let i = 0; i < p.months.length; i++) {
        const m = p.months[i];
        if (!(m.is_future ?? false)) deliveredActual += m.delivered;
        if (m.year === todayY && m.month === todayM) monthInQ = i + 1;
      }
      currentQ = {
        qIdx: p.qIdx,
        label: p.label,
        monthsLabel: p.monthsLabel,
        deliveredActual,
        invoiced: p.invoicedQ,
        monthInQ,
        qLength: p.months.length,
        projectedEndCumDelivered: cumDelivered,
        endOfQCumInvoiced: cumInvoiced,
        projectedEndCumVariance: cumDelivered - cumInvoiced,
      };
    }

    if (endCell <= lastCell) {
      let delivered = 0;
      for (const m of p.months) delivered += m.delivered;
      lastFullQ = {
        qIdx: p.qIdx,
        label: p.label,
        monthsLabel: p.monthsLabel,
        delivered,
        invoiced: p.invoicedQ,
      };
    }
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
  // WN1 #DDCFAC (221, 207, 172) → P3 #2E8C59 (46, 140, 89) — same green
  // used for Topics in the Cumulative Pipeline cards and matched by the
  // QuarterRow bars' `progressColor`, so every per-client bar speaks
  // the same visual language.
  const r = Math.round(221 + (46 - 221) * t);
  const g = Math.round(207 + (140 - 207) * t);
  const b = Math.round(172 + (89 - 172) * t);
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
  // True ratio (uncapped) for the displayed percentage — over-delivery is
  // meaningful and should be visible (e.g. 92/90 reads as 102%, not 100%).
  // The bar fill itself is capped at 100% so it doesn't visually overflow.
  const pctRaw = target > 0 ? (current / target) * 100 : 0;
  const barPct = Math.min(pctRaw, 100);
  const color = target > 0 ? lifetimeBarColor(pctRaw) : "#606060";
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
          style={{ width: `${barPct}%`, backgroundColor: color, opacity: 0.85 }}
        />
      </div>
      <span
        className="w-10 text-right font-mono text-[10px] font-semibold tabular-nums"
        style={{ color: target > 0 ? color : "#606060" }}
      >
        {target > 0 ? `${Math.round(pctRaw)}%` : "—"}
      </span>
      <span className="w-20 text-right font-mono text-[10px] text-[#606060] tabular-nums">
        {current}/{target}
      </span>
    </div>
  );
}

// Behind / Watch / Healthy / New classification helpers used to live here
// and surface as a chip on every card + a rollup pill in the section header.
// Removed pending a refactor of the underlying concept (the "behind" framing
// hides nuance for clients with mixed cadences). Add the helpers back once
// the new model is decided.

function ClientDeliveryCard({
  row,
  filterRange,
}: {
  row: ClientDeliveryCardRow;
  filterRange?: FilterRange | null;
}) {
  const monthChip = contractMonthChip(row.start_date, row.term_months);
  const periods = useMemo(() => detectBillingPeriods(row), [row]);
  const qMeta = useMemo(() => quarterMetaFromPeriods(periods), [periods]);
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
                    "Months elapsed ÷ total contract length.",
                    "Spans the full relationship across renewals.",
                  ]}
                />
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Status row — Behind/Watch/Healthy/New chip removed pending refactor
          of the health concept. Just keep the contract status text. */}
      <div className="mt-1.5">
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
                tooltipTitle="Last full quarter"
                tooltipBullets={[
                  "Most recent quarter that has fully closed.",
                  "Delivered ÷ invoicing target for the period.",
                  "Below 100% means the quarter closed behind.",
                ]}
              />
            )}
            {qMeta.currentQ && (
              <>
                <QuarterRow
                  kind="current"
                  label={qMeta.currentQ.label}
                  monthsLabel={qMeta.currentQ.monthsLabel}
                  delivered={qMeta.currentQ.deliveredActual}
                  target={qMeta.currentQ.invoiced}
                  monthInQ={qMeta.currentQ.monthInQ}
                  qLength={qMeta.currentQ.qLength}
                  tooltipTitle="Current quarter"
                  tooltipBullets={[
                    "The quarter today's month falls in.",
                    "Counts only delivered actuals — no projections.",
                    "% is partial progress vs. the quarter's invoicing target.",
                  ]}
                />
                <ProjectedEndOfQNote currentQ={qMeta.currentQ} />
              </>
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
                    "Total articles contracted for the full engagement.",
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
            tooltipBullets={["Share of billed work that's shipped."]}
          />
          <DeliveryBar
            label="Invoiced"
            current={row.articles_invoiced}
            target={row.articles_sow}
            tooltipTitle="Invoiced ÷ SOW"
            tooltipBullets={["Share of the contract that's been billed."]}
          />
        </div>
      </div>

      {/* Footer — single right-aligned link to the per-month detail */}
      <div className="mt-3 flex justify-end border-t border-[#2a2a2a] pt-2">
        <MonthlyBreakdownPopover
          row={row}
          periods={periods}
          currentQIdx={qMeta.currentQ?.qIdx ?? null}
          lastFullQIdx={qMeta.lastFullQ?.qIdx ?? null}
          filterRange={filterRange}
        />
      </div>
    </div>
  );
}

/** Calm informative line that sits under the Current Q progress bar.
 *
 *  Tells the operator how the current Q is *projected* to close on a
 *  cumulative basis (delivered actuals + remaining-month projections
 *  inside this Q − contracted invoicing cumulative through end of Q).
 *  Same math as the spreadsheet's Variance row and the Overview Triage
 *  cards, so the three surfaces tell one coherent story.
 *
 *  Intentionally neutral: a current-Q progress bar that looks "behind"
 *  early in the period (e.g. M1/3 at 0%) is often perfectly fine — the
 *  projections cover it. This note answers "is the plan good?" so the
 *  visible bar doesn't trigger false alarms. No red/amber here; only
 *  +X / 0 / -X in a cream font with a one-line context hint. */
function ProjectedEndOfQNote({
  currentQ,
}: {
  currentQ: CurrentQuarter;
}) {
  const v = currentQ.projectedEndCumVariance;
  const fmt = v > 0 ? `+${v}` : v.toLocaleString();
  // Three short copy variants. Signed semantics — over-delivery is
  // healthy. The number itself carries the signed-variance color
  // (green ≥0 · amber -5 to 0 · red < -5) so the tier is unambiguous
  // at a glance without the line dominating the card.
  const hint = v >= 0 ? "On track" : v >= -5 ? "Slight drift" : "Behind plan";
  const numColor = signedVarianceColor(v);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <div className="flex cursor-help items-center gap-2 rounded border border-[#1f1f1f] bg-[#0a0a0a] px-2 py-1" />
          }
        >
          <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-[#8FB5D9]">
            Projected end of Q
          </span>
          <span
            className="font-mono text-[11px] font-semibold tabular-nums"
            style={{ color: numColor }}
          >
            {fmt}
          </span>
          <span
            className="font-mono text-[10px] uppercase tracking-wider"
            style={{ color: numColor }}
          >
            {hint}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
          <TooltipBody
            title="Projected end of Q"
            bullets={[
              "Where this client lands by end of the quarter vs. invoicing.",
              "Over-delivery this quarter cancels earlier deficits.",
              "0 on track · ±1–5 slight drift · below −5 behind plan.",
              `${currentQ.projectedEndCumDelivered.toLocaleString()} delivered · ${currentQ.endOfQCumInvoiced.toLocaleString()} invoiced.`,
            ]}
          />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Signed-variance color, matches the Overview Triage cards. */
function signedVarianceColor(v: number): string {
  if (v >= 0) return "#42CA80";
  if (v >= -5) return "#F5BC4E";
  return "#ED6958";
}

/** Linear interpolation from beige (`#DDCFAC`, low completion) to the
 *  deep P3 green (`#2E8C59`, full completion) — same green used for
 *  Topics in the Cumulative Pipeline cards, so the two surfaces share
 *  visual vocabulary. The Last Full Q + Current Q progress bars use
 *  this ramp instead of the alarm-coded red/amber/green tiers; the
 *  actionable signal lives in the Projected end of Q note below. */
function progressColor(pct: number | null): string {
  if (pct === null) return "#606060";
  const p = Math.min(Math.max(pct, 0), 100) / 100;
  const from = [0xdd, 0xcf, 0xac]; // WN1 cream
  const to = [0x2e, 0x8c, 0x59]; // P3 deep green — matches Topics in Cumulative Pipeline
  const r = Math.round(from[0] + (to[0] - from[0]) * p);
  const g = Math.round(from[1] + (to[1] - from[1]) * p);
  const b = Math.round(from[2] + (to[2] - from[2]) * p);
  return `rgb(${r}, ${g}, ${b})`;
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
  qLength,
  tooltipTitle,
  tooltipBullets,
}: {
  kind: "lastFull" | "current";
  label: string;
  monthsLabel: string;
  delivered: number;
  target: number;
  monthInQ: number | null;
  /** Total months in the period — drives the M{n}/{N} chip and pacing math
   *  for variable-length billing periods. Only relevant for the "current"
   *  kind; lastFull omits it. */
  qLength?: number;
  tooltipTitle: string;
  tooltipBullets: React.ReactNode[];
}) {
  const pct = target > 0 ? Math.min(Math.round((delivered / target) * 100), 999) : null;
  const barPct = pct === null ? 0 : Math.min(pct, 100);
  // Beige → green ramp instead of red/amber/green tiers. Low % reads
  // beige (cream), full reads bright green; mid-progress reads a calm
  // olive-ish blend. Matches the visual vocabulary of the Cumulative
  // Pipeline cards and keeps these bars from triggering false-alarm
  // reds early in a billing period. The Projected end of Q note below
  // carries the actionable signal (signed-variance color).
  const color = progressColor(pct);

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
          {monthInQ !== null && qLength != null && (
            <span className="font-mono text-[10px] text-[#606060] tabular-nums">
              · M{monthInQ}/{qLength}
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
  periods,
  currentQIdx,
  lastFullQIdx,
  filterRange,
}: {
  row: ClientDeliveryCardRow;
  periods: BillingPeriod[];
  currentQIdx: number | null;
  lastFullQIdx: number | null;
  filterRange?: FilterRange | null;
}) {
  const lastFullRowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    lastFullRowRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, []);

  if (periods.length === 0) return null;

  // Highlight the **last completed month** (today's month minus one), not
  // the in-progress current month. The popover's Cum Del at that row is
  // what the card's summary total reflects.
  const now = new Date();
  const lastCompleted = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const nowY = lastCompleted.getFullYear();
  const nowM = lastCompleted.getMonth() + 1;

  // Walk detected periods (already in chronological order) and accumulate
  // Cum Del per month + Cum Inv per period boundary. Each period becomes one
  // row-span block on the right; left columns stay one row per month.
  type DisplayRow = {
    year: number;
    month: number;
    delivered: number;
    cumDelivered: number;
    isFuture: boolean;
    isCurrent: boolean;
  };
  type DisplayPeriod = {
    qIdx: number;
    label: string;
    isPrelude: boolean;
    invoicedQ: number;
    cumInvoiced: number;
    /** Period variance = CUMULATIVE delivered − CUMULATIVE invoiced through
     *  end of this period. Matches the spreadsheet's per-period variance
     *  cell (the green/red merged block alongside the invoicing cell),
     *  which uses cumulative math: catch-up over-delivery in one Q nets
     *  against earlier-Q deficits, so a −14 last Q + 14 this Q reads as
     *  0, not +14. null for the prelude (no invoicing yet — no useful
     *  variance to report). */
    variance: number | null;
    rows: DisplayRow[];
  };

  // Period-aware filter expansion: a period is shown when at least one of
  // its months overlaps the user's date range. The period stays whole — its
  // other months still render so the user can see "Q1 spans Jan–Apr" even
  // when their filter is Feb–Jun. Cum Del / Cum Inv keep their running
  // totals from the start of the contract so the visible numbers reconcile
  // with the spreadsheet (we accumulate across ALL periods first, then
  // filter what to render).
  const overlapsFilter = (p: BillingPeriod): boolean => {
    if (!filterRange) return true;
    const startCell = p.startYear * 12 + (p.startMonth - 1);
    const endCell = p.endYear * 12 + (p.endMonth - 1);
    const fromCell = filterRange.fromYear * 12 + (filterRange.fromMonth - 1);
    const toCell = filterRange.toYear * 12 + (filterRange.toMonth - 1);
    return endCell >= fromCell && startCell <= toCell;
  };

  const allDisplay: (DisplayPeriod & { isPostContract: boolean })[] = [];
  let cumDelivered = 0;
  let cumInvoiced = 0;
  for (const p of periods) {
    cumInvoiced += p.invoicedQ;
    const rows: DisplayRow[] = [];
    for (const m of p.months) {
      cumDelivered += m.delivered;
      rows.push({
        year: m.year,
        month: m.month,
        delivered: m.delivered,
        cumDelivered,
        isFuture: m.is_future ?? false,
        isCurrent: m.year === nowY && m.month === nowM,
      });
    }
    // Variance is cumulative through end of this period: catch-up
    // over-delivery in one Q nets against earlier-Q deficits so the
    // column reconciles with the spreadsheet's Variance row. Prelude
    // periods have no invoicing target — surface as null so we render
    // an em-dash instead of a misleading 0/red bucket.
    const variance = p.isPrelude ? null : cumDelivered - cumInvoiced;
    allDisplay.push({
      qIdx: p.qIdx,
      label: p.label,
      isPrelude: p.isPrelude,
      isPostContract: p.isPostContract,
      invoicedQ: p.invoicedQ,
      cumInvoiced,
      variance,
      rows,
    });
  }

  const display = allDisplay.filter((p) => {
    const original = periods.find((o) => o.qIdx === p.qIdx);
    return original ? overlapsFilter(original) : true;
  });

  // Grand totals reflect the full client history, not the filtered slice —
  // matches the card's "Lifetime" framing in the section above.
  const grandTotals = {
    delivered: cumDelivered,
    invoiced: cumInvoiced,
    variance: cumDelivered - cumInvoiced,
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
              {" "}— last completed month.
            </li>
            <li>
              <span className="rounded-sm bg-[#3a2e1a] px-1 py-px text-[9px] font-semibold uppercase not-italic tracking-wider text-[#F5BC4E]">proj</span>
              {" "}— forecast for upcoming months.
            </li>
            <li>
              <span className="rounded-sm bg-[#42CA80]/15 px-1 py-px text-[9px] font-semibold uppercase not-italic tracking-wider text-[#42CA80]">last full</span>
              {" "}/{" "}
              <span className="rounded-sm bg-[#F5BC4E]/15 px-1 py-px text-[9px] font-semibold uppercase not-italic tracking-wider text-[#F5BC4E]">in progress</span>
              {" "}— most recent closed period vs. the one today falls in.
            </li>
            <li>
              <span className="rounded-sm bg-[#909090]/15 px-1 py-px text-[9px] font-semibold uppercase not-italic tracking-wider text-[#909090]">post</span>
              {" "}— activity after contract end (reconciliation / credits).
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
                  bullets={["One row per contract month."]}
                />
                <BreakdownHeader
                  label="Delivered"
                  title="Delivered"
                  bullets={["Articles delivered this month."]}
                />
                <BreakdownHeader
                  label="Cum Del"
                  title="Cumulative delivered"
                  bullets={[
                    "Running total of delivered articles.",
                    "The AS OF row matches the card's Delivered total.",
                  ]}
                />
                <BreakdownHeader
                  label="Invoiced (Q)"
                  title="Invoiced per period"
                  bullets={[
                    "Invoicing total for each billing period.",
                    "Period length varies (1–5 months) by contract cadence.",
                  ]}
                />
                <BreakdownHeader
                  label="Cum Inv"
                  title="Cumulative invoiced"
                  bullets={["Running total of invoicing across all periods."]}
                />
                <BreakdownHeader
                  label="Variance"
                  title="Period variance"
                  bullets={[
                    "Cumulative delivered − invoiced at end of this period.",
                    "Over-delivery one quarter cancels earlier deficits.",
                    "Green: 0 · Amber: ±1–5 · Red: beyond ±5.",
                  ]}
                />
              </tr>
            </thead>
            <tbody>
              {display.length === 0 && (
                <tr className="border-t border-[#1a1a1a]">
                  <td
                    colSpan={6}
                    className="px-3 py-4 text-center font-mono text-[10px] text-[#606060]"
                  >
                    No billing periods overlap the current filter — widen the
                    date range to see this client&apos;s detail.
                  </td>
                </tr>
              )}
              {display.map((p) =>
                p.rows.map((m, i) => {
                  const isFirst = i === 0;
                  const isLastFullFirstRow = isFirst && p.qIdx === lastFullQIdx;
                  return (
                    <tr
                      key={`${p.qIdx}-${m.year}-${m.month}`}
                      ref={isLastFullFirstRow ? lastFullRowRef : undefined}
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
                            rowSpan={p.rows.length}
                            className="border-l border-[#2a2a2a] bg-[#111111] px-2 py-0.5 text-center align-middle tabular-nums text-white"
                          >
                            {p.isPrelude ? (
                              <span className="font-mono text-[10px] text-[#606060]">—</span>
                            ) : p.isPostContract ? (
                              <>
                                <div className="font-semibold">{p.invoicedQ}</div>
                                <div className="mt-0.5 inline-block rounded-sm bg-[#909090]/15 px-1 py-px font-mono text-[9px] font-semibold uppercase not-italic tracking-wider text-[#909090]">
                                  Post
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="font-semibold">{p.invoicedQ}</div>
                                <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-[#606060]">
                                  {p.label}
                                </div>
                                {p.qIdx === lastFullQIdx && (
                                  <div className="mt-0.5 inline-block rounded-sm bg-[#42CA80]/15 px-1 py-px font-mono text-[9px] font-semibold uppercase not-italic tracking-wider text-[#42CA80]">
                                    Last full
                                  </div>
                                )}
                                {p.qIdx === currentQIdx && (
                                  <div className="mt-0.5 inline-block rounded-sm bg-[#F5BC4E]/15 px-1 py-px font-mono text-[9px] font-semibold uppercase not-italic tracking-wider text-[#F5BC4E]">
                                    In progress
                                  </div>
                                )}
                              </>
                            )}
                          </td>
                          <td
                            rowSpan={p.rows.length}
                            className="bg-[#111111] px-2 py-0.5 text-center align-middle tabular-nums text-[#C4BCAA]"
                          >
                            {p.isPrelude ? "—" : p.cumInvoiced}
                          </td>
                          <td
                            rowSpan={p.rows.length}
                            className="border-l border-[#2a2a2a] px-2 py-0.5 text-center align-middle font-semibold tabular-nums"
                            style={
                              p.variance === null
                                ? { color: "#606060" }
                                : {
                                    color: varianceColor(p.variance),
                                    backgroundColor: varianceBg(p.variance),
                                  }
                            }
                          >
                            {p.variance === null
                              ? "—"
                              : p.variance > 0
                              ? `+${p.variance}`
                              : p.variance}
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
                <td
                  className="border-l border-[#2a2a2a] px-2 py-1 text-center tabular-nums font-semibold"
                  style={{
                    color: varianceColor(grandTotals.variance),
                    backgroundColor: varianceBg(grandTotals.variance),
                  }}
                >
                  {grandTotals.variance > 0
                    ? `+${grandTotals.variance}`
                    : grandTotals.variance}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ClientDeliveryCards({
  rows,
  scopeLabel,
  filterRange,
  defaultCollapsedByPod = false,
  hideHeader = false,
}: Props) {
  // Card totals exclude the in-progress month, so the section "as of" point
  // is the last fully-completed Editorial month (per the week distribution).
  const asOf = useEditorialAsOf();
  const { axis: podAxis } = useCurrentPodAxis();
  // Alphabetical sort by client name. The previous triage-first sort
  // depended on the Behind/Watch/Healthy classification — that concept
  // is being refactored, so we render in a neutral order until it lands.
  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.name.localeCompare(b.name)),
    [rows],
  );

  useEffect(() => {
    const reveal = () =>
      revealCurrentHashTarget(["client-delivery-", "client-delivery-pod-"]);
    const frame = window.requestAnimationFrame(reveal);
    window.addEventListener("hashchange", reveal);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", reveal);
    };
  }, [defaultCollapsedByPod, sorted]);

  return (
    <div className="space-y-4">
      {/* Heading — suppressed when the parent provides its own section
          title (Overview merges "Client Delivery" + "At a Glance" into a
          single section heading; without `hideHeader` the two would
          stack). D1 still renders the internal heading. */}
      {!hideHeader && (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
              Client Delivery At a Glance{" "}
              <DataSourceBadge
                type="live"
                source="Sheet: 'Delivered vs Invoiced v2' + 'Editorial SOW overview' — Spreadsheet: Editorial Capacity Planning. One card per filtered client. SOW is lifetime. Delivered / Invoiced sum the per-month rows for the active date range, grouped by each contract's billing cadence (1-, 2-, 3- or 5-month periods — matches the spreadsheet's merged-cell layout)."
                shows={[
                  "One card per filtered client, sorted alphabetically inside each pod.",
                  "Two horizontal bars: Delivered vs Invoiced (top) and Invoiced vs SOW (bottom) — color-coded by %, raw numbers on the right.",
                  "Period context: Last full Q (most recent settled billing period, delivered/invoiced/%) and Current Q (partial progress, M of N where N is the period length).",
                  "Click \"Monthly detail\" for the per-month breakdown — AS OF row = last completed month, IN PROGRESS / LAST FULL chips tag the corresponding billing periods' invoicing cells.",
                  "Card totals exclude the in-progress month, so they always reflect data through the last completed month.",
                ]}
              />
            </h3>
            <AsOfBadge label={asOf.label} fallback={asOf.isFallback} />
          </div>
          {scopeLabel && (
            <p className="mt-1 font-mono text-[11px] text-[#8FB5D9]">
              {scopeLabel}
            </p>
          )}
        </div>
      )}

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
                const rawPod = podAxis === "growth" ? r.growth_pod : r.editorial_pod;
                const pod = normalizePod(rawPod);
                const list = groups.get(pod);
                if (list) list.push(r);
                else groups.set(pod, [r]);
              }
              return Array.from(groups.entries())
                .sort(([a], [b]) => sortPodKey(a, b))
                .map(([pod, items]) => {
                  const groupHeader = (
                    <div className="flex items-center gap-2">
                      {podBadge(pod, podAxis)}
                      <span className="font-mono text-[11px] text-[#606060]">
                        {items.length} client{items.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  );
                  const groupGrid = (
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
                            <ClientDeliveryCard row={row} filterRange={filterRange} />
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </motion.div>
                  );
                  // Overview wraps each pod block in a <details> so the
                  // page doesn't dump 50+ cards on first paint. D1 keeps
                  // the open layout since users land there to scan.
                  return (
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
                      {defaultCollapsedByPod ? (
                        <details className="group/pod">
                          <summary className="flex cursor-pointer list-none items-center gap-2 rounded border border-[#1f1f1f] bg-[#0d0d0d] px-3 py-1.5 transition-colors hover:border-[#2a2a2a]">
                            {podBadge(pod, podAxis)}
                            <span className="font-mono text-[11px] text-[#606060]">
                              {items.length} client{items.length === 1 ? "" : "s"}
                            </span>
                            <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-[#606060] group-open/pod:hidden">
                              ▸ expand
                            </span>
                            <span className="ml-auto hidden font-mono text-[10px] uppercase tracking-wider text-[#606060] group-open/pod:inline">
                              ▾ collapse
                            </span>
                          </summary>
                          <div className="mt-2">{groupGrid}</div>
                        </details>
                      ) : (
                        <>
                          {groupHeader}
                          {groupGrid}
                        </>
                      )}
                    </motion.div>
                  );
                });
            })()}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
