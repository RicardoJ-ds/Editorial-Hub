"use client";

import React, { useMemo } from "react";
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
import { cn } from "@/lib/utils";
import { normalizePod, sortPodKey } from "./ContractClientProgress";
import { podBadge } from "./shared-helpers";

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

/** Sheet-aligned phrasing for delivered vs invoiced balance. Mirrors the
 *  Editorial SOW overview "Status (as of …)" column (More invoiced / More
 *  delivered / At balance) and appends the absolute difference. */
function varianceLabel(variance: number): string {
  if (variance > 0) return `More delivered than invoiced: ${variance.toLocaleString()}`;
  if (variance < 0) return `More invoiced than delivered: ${Math.abs(variance).toLocaleString()}`;
  return "At balance";
}

function VarianceLine({
  scope,
  variance,
  color,
  tooltip,
}: {
  scope: "Period" | "Cumulative";
  variance: number;
  color: string;
  tooltip: string;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="font-mono text-[10px] cursor-help flex items-baseline gap-1.5" />
          }
        >
          <span className="text-[#606060] uppercase tracking-wider text-[9px] shrink-0">
            {scope}
          </span>
          <span
            className="font-semibold underline decoration-dotted underline-offset-2"
            style={{ color }}
          >
            {varianceLabel(variance)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Derive a "Month N/M" chip from sheet-native fields only: start_date + term_months.
// Returns null when we can't compute it honestly (missing start, missing term, parse fail).
function contractMonthChip(
  startDate: string | null | undefined,
  termMonths: number | null | undefined,
): { elapsed: number; total: number } | null {
  if (!startDate || !termMonths || termMonths <= 0) return null;
  const start = new Date(startDate);
  if (isNaN(start.getTime())) return null;
  const now = new Date();
  const months =
    (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) + 1;
  if (months < 1) return { elapsed: 0, total: termMonths };
  return { elapsed: Math.min(months, termMonths), total: termMonths };
}

// Colored bar segment used inside each card for delivered / invoiced lines.
function DeliveryBar({
  label,
  current,
  target,
  hint,
}: {
  label: string;
  current: number;
  target: number;
  hint: string;
}) {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const color =
    target > 0 && pct >= 75 ? "#42CA80" : pct >= 50 ? "#F5C542" : "#ED6958";
  return (
    <div className="flex items-center gap-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="w-14 shrink-0 font-mono text-[10px] text-[#C4BCAA] cursor-help underline decoration-dotted decoration-[#404040] underline-offset-2" />
            }
          >
            {label}
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
            {hint}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <div className="flex-1 h-2.5 rounded-full bg-[#2a2a2a] overflow-hidden">
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

function ClientDeliveryCard({ row }: { row: ClientDeliveryCardRow }) {
  const varianceColor =
    row.variance > 0 ? "#42CA80" : row.variance < 0 ? "#ED6958" : "#606060";
  const cumVariance = row.variance_cumulative;
  const cumVarianceColor =
    cumVariance === undefined
      ? "#606060"
      : cumVariance > 0
      ? "#42CA80"
      : cumVariance < 0
      ? "#ED6958"
      : "#606060";

  const monthChip = contractMonthChip(row.start_date, row.term_months);
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-4 animate-fade-slide hover:border-[#333] transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-white text-sm" title={row.name}>
            {row.name}
          </p>
          <p className="mt-0.5 text-[10px] font-mono text-[#606060]">
            {row.status === "ACTIVE" ? "Active" : row.status.toLowerCase()}
          </p>
        </div>
        {monthChip && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="shrink-0 cursor-help rounded-full border border-[#2a2a2a] bg-[#0d0d0d] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#C4BCAA] tabular-nums" />
                }
              >
                Month {monthChip.elapsed}/{monthChip.total}
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
                Contract month elapsed ÷ term length. Derived from the first and last active months in the Delivered vs Invoiced v2 sheet (per client), so it spans the full relationship across renewals — not just the current active year.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* SOW line — contracted article total from the 'Editorial SOW overview' sheet */}
      <div className="mb-2 flex items-center justify-between border-b border-[#2a2a2a] pb-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060] cursor-help underline decoration-dotted decoration-[#404040] underline-offset-2" />
              }
            >
              SOW
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
              Contracted article total from the Editorial SOW overview sheet (# Articles SOW column).
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <span className="font-mono text-[12px] font-semibold text-white tabular-nums">
          {row.articles_sow.toLocaleString()}
        </span>
      </div>

      {/* Bars */}
      <div className="space-y-2">
        <DeliveryBar
          label="Delivered"
          current={row.articles_delivered}
          target={row.articles_sow}
          hint="Delivered ÷ SOW. Bar color: green ≥75%, yellow ≥50%, red below. The right-hand pair is delivered / SOW in absolute numbers."
        />
        <DeliveryBar
          label="Invoiced"
          current={row.articles_invoiced}
          target={row.articles_delivered}
          hint="Invoiced ÷ Delivered. Measures how much of what we shipped has actually been billed. Low % = revenue not yet invoiced. The right-hand pair is invoiced / delivered."
        />
      </div>

      {/* Footer — variance status (sheet phrasing) + per-month breakdown. */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#2a2a2a] pt-2">
        <div className="flex flex-col gap-0.5">
          <VarianceLine
            scope="Period"
            variance={row.variance}
            color={varianceColor}
            tooltip="In the filtered window, this is the gap between what we delivered and what we billed. Same phrasing as the SOW overview sheet's Status (as of …) column."
          />
          {cumVariance !== undefined && cumVariance !== row.variance && (
            <VarianceLine
              scope="Cumulative"
              variance={cumVariance}
              color={cumVarianceColor}
              tooltip="Running balance through the end of the scope — mirrors the sheet's Variance cell at that month."
            />
          )}
        </div>
        <MonthlyBreakdownPopover row={row} />
      </div>
    </div>
  );
}

function BreakdownHeader({
  label,
  hint,
  align = "right",
}: {
  label: string;
  hint: string;
  align?: "left" | "right";
}) {
  return (
    <th
      className={cn(
        "px-3 py-1.5 font-semibold uppercase tracking-wider",
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
          <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
            {hint}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </th>
  );
}

function MonthlyBreakdownPopover({ row }: { row: ClientDeliveryCardRow }) {
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
    label: string;
    months: MonthRow[];
    invoicedQ: number; // Σ invoiced within this Q's months
    cumInvoiced: number; // Σ invoiced across every Q up to and including this one
  };

  const start = row.start_date ? new Date(row.start_date) : null;
  const startValid = start && !isNaN(start.getTime());
  const startYear = startValid ? start!.getFullYear() : null;
  const startMonth = startValid ? start!.getMonth() + 1 : null; // 1-indexed

  // Contract-month index (M1-based). Returns 1 for the first contract month.
  // Falls back to a calendar-based index if start_date is missing, so the
  // grouping still works but will display "Q? · yy" using calendar quarters.
  const contractMonthIndex = (y: number, m: number): number => {
    if (startYear == null || startMonth == null) {
      return (y - 2000) * 12 + m; // monotonic anchor for stable grouping
    }
    return (y - startYear) * 12 + (m - startMonth) + 1;
  };

  const now = new Date();
  const nowY = now.getFullYear();
  const nowM = now.getMonth() + 1;

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
            className="font-mono text-[10px] uppercase tracking-wider text-[#606060] hover:text-[#C4BCAA] transition-colors"
          />
        }
      >
        Monthly detail
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="w-auto border border-[#2a2a2a] bg-[#0d0d0d] p-0 text-popover-foreground"
      >
        <div className="border-b border-[#2a2a2a] px-3 py-2">
          <p className="font-mono text-[11px] font-semibold text-white">{row.name}</p>
          <p className="mt-0.5 font-mono text-[9px] leading-relaxed text-[#606060]">
            Delivered is monthly. Invoicing / Cumulative are quarterly — shown once per Q, spanning the Q&apos;s months like the sheet does. The row marked <span className="rounded-sm bg-[#42CA80]/20 px-1 py-px text-[7px] font-semibold uppercase not-italic tracking-wider text-[#42CA80]">now</span> is the current month — its Cum Del matches the card&apos;s Delivered total, and its Q&apos;s Cum Inv matches Invoiced. Rows marked <span className="rounded-sm bg-[#3a2e1a] px-1 py-px text-[7px] font-semibold uppercase not-italic tracking-wider text-[#F5BC4E]">proj</span> are future months with forecast values; card totals exclude them.
          </p>
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          <table className="w-full border-collapse font-mono text-[10px]">
            <thead className="sticky top-0 bg-[#0d0d0d] shadow-[0_1px_0_0_#2a2a2a]">
              <tr className="text-[#606060]">
                <BreakdownHeader
                  label="Month"
                  hint="Calendar month from the sheet's M1, M2… columns."
                  align="left"
                />
                <BreakdownHeader
                  label="Delivered"
                  hint="Articles delivered this month — from the sheet's Article Deliveries row."
                />
                <BreakdownHeader
                  label="Cum Del"
                  hint="Running total of delivered articles within the active scope."
                />
                <BreakdownHeader
                  label="Invoiced (Q)"
                  hint="Quarterly invoicing total, merged across the Q's months just like the sheet."
                />
                <BreakdownHeader
                  label="Cum Inv"
                  hint="Running total of invoicing across every quarter in this scope."
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
                      <td className={cn("px-3 py-1", m.isFuture ? "text-[#8a8475]" : m.isCurrent ? "text-white font-semibold" : "text-[#C4BCAA]")}>
                        <span className="inline-flex items-center gap-1.5">
                          {MONTH_SHORT[m.month]} {String(m.year).slice(-2)}
                          {m.isCurrent && (
                            <span className="rounded-sm bg-[#42CA80]/20 px-1 py-px text-[7px] font-semibold uppercase not-italic tracking-wider text-[#42CA80]">
                              now
                            </span>
                          )}
                          {m.isFuture && (
                            <span className="rounded-sm bg-[#3a2e1a] px-1 py-px text-[7px] font-semibold uppercase not-italic tracking-wider text-[#F5BC4E]">
                              proj
                            </span>
                          )}
                        </span>
                      </td>
                      <td className={cn("px-3 py-1 text-right tabular-nums", m.isFuture ? "text-[#8a8475]" : m.isCurrent ? "text-white font-semibold" : "text-white")}>
                        {m.delivered}
                      </td>
                      <td className={cn("px-3 py-1 text-right tabular-nums", m.isFuture ? "text-[#8a8475]" : m.isCurrent ? "text-[#42CA80] font-bold" : "text-[#C4BCAA]")}>
                        {m.cumDelivered}
                      </td>
                      {isFirst && (
                        <>
                          <td
                            rowSpan={g.months.length}
                            className="border-l border-[#2a2a2a] bg-[#111111] px-3 py-1 text-center align-middle tabular-nums text-white"
                          >
                            <div className="font-semibold">{g.invoicedQ}</div>
                            <div className="mt-0.5 font-mono text-[8px] uppercase tracking-wider text-[#606060]">
                              {g.label}
                            </div>
                          </td>
                          <td
                            rowSpan={g.months.length}
                            className="bg-[#111111] px-3 py-1 text-center align-middle tabular-nums text-[#C4BCAA]"
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
                <td className="px-3 py-1.5 font-semibold uppercase tracking-wider text-[#606060]">
                  Total
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-white">
                  {grandTotals.delivered}
                </td>
                <td className="px-3 py-1.5" />
                <td className="border-l border-[#2a2a2a] bg-[#111111] px-3 py-1.5 text-center tabular-nums font-semibold text-white">
                  {grandTotals.invoiced}
                </td>
                <td className="bg-[#111111] px-3 py-1.5" />
              </tr>
            </tfoot>
          </table>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ClientDeliveryCards({ rows, scopeLabel }: Props) {
  // Alphabetical within each pod group — matches the other per-client card
  // sections (Cumulative Pipeline, Monthly Goals) so the dashboard reads
  // consistently across tabs.
  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.name.localeCompare(b.name)),
    [rows],
  );

  return (
    <div className="space-y-3">
      {/* Heading */}
      <div>
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-[#C4BCAA]">
          Client Delivery At a Glance{" "}
          <DataSourceBadge
            type="live"
            source="Sheet: 'Delivered vs Invoiced v2' + 'Editorial SOW overview' — Spreadsheet: Editorial Capacity Planning. One card per filtered client. SOW is lifetime. Delivered / Invoiced sum the per-month rows for the active date range, expanded to complete contract quarters."
            shows={[
              "One card per filtered client, grouped by editorial pod with a pod header; alphabetical within each pod.",
              "Top-right chip = current contract month out of total term (e.g. MONTH 8/25).",
              "Two horizontal bars: Delivered vs SOW (top) and Invoiced vs Delivered (bottom) — color-coded by %, raw numbers on the right.",
              "Footer line reads the sheet's own phrasing (\"More invoiced than delivered: 18\" or \"At balance\") for the period, with a Cumulative line underneath when it differs.",
              "Click \"Monthly detail\" for the per-month breakdown — the NOW row shows the figures the card's summary totals come from.",
            ]}
          />
        </h3>
        {scopeLabel && (
          <p className="mt-0.5 font-mono text-[10px] text-[#8FB5D9]">
            {scopeLabel} — per-client contract quarters are fully included so invoicing (Q) and delivery (monthly) stay comparable.
          </p>
        )}
        <p className="mt-0.5 font-mono text-[10px] text-[#909090]">
          One card per filtered client — delivered vs SOW, invoicing, and variance. Grouped by pod, alphabetical within.
        </p>
      </div>

      {sorted.length === 0 ? (
        <p className="text-center text-xs text-[#606060] py-6">
          No clients match the current filters.
        </p>
      ) : (
        <div className="space-y-5">
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
                <div key={`pod-group-${pod}`} className="space-y-2">
                  <div className="flex items-center gap-2">
                    {podBadge(pod)}
                    <span className="font-mono text-[10px] text-[#606060]">
                      {items.length} client{items.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {items.map((row) => (
                      <ClientDeliveryCard key={row.id} row={row} />
                    ))}
                  </div>
                </div>
              ));
          })()}
        </div>
      )}
    </div>
  );
}
