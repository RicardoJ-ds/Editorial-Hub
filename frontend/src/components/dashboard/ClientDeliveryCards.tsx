"use client";

import React, { useMemo } from "react";
import { DataSourceBadge } from "./DataSourceBadge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  variance: number;
  pct_complete: number;
  /** Contract start date (ISO string). Combined with term_months, this drives the "Month N/M" chip. */
  start_date?: string | null;
  term_months?: number | null;
}

interface Props {
  rows: ClientDeliveryCardRow[];
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
                Contract month elapsed ÷ term length, derived from start_date + term_months on the SOW overview sheet.
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

      {/* Footer — Variance only. The % complete lives in the Delivered bar above. */}
      <div className="mt-3 pt-2 border-t border-[#2a2a2a]">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className="font-mono text-[10px] font-semibold cursor-help underline decoration-dotted underline-offset-2"
                  style={{ color: varianceColor }}
                />
              }
            >
              Variance: {row.variance > 0 ? "+" : ""}
              {row.variance.toLocaleString()}
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
              Net variance summed from the Delivered vs Invoiced monthly rows. Positive = ahead of plan, negative = behind.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

export function ClientDeliveryCards({ rows }: Props) {
  // Sort laggards-first so the lowest % complete surfaces at the top of each pod group.
  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.pct_complete - b.pct_complete),
    [rows],
  );

  return (
    <div className="space-y-3">
      {/* Heading */}
      <div>
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060] mb-1">
          Client Delivery At a Glance{" "}
          <DataSourceBadge
            type="live"
            source="Sheet: 'Delivered vs Invoiced v2' + 'Editorial SOW overview' — Spreadsheet: Editorial Capacity Planning. Same data as the Client Delivery Detail table below, rendered as per-client cards."
          />
        </h3>
        <p className="text-xs text-[#606060]">
          One card per filtered client showing delivered vs SOW, invoicing progress, and variance — sorted lowest % complete first so laggards surface.
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
