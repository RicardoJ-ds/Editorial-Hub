"use client";

import React, { useMemo, useState } from "react";
import type { ClientPacing } from "@/lib/types";
import { PacingBadge } from "./PacingBadge";
import { DataSourceBadge } from "./DataSourceBadge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface ClientDeliveryCardRow {
  id: number;
  name: string;
  status: string;
  articles_sow: number;
  articles_delivered: number;
  articles_invoiced: number;
  variance: number;
  pct_complete: number;
}

type PacingStatus = "AHEAD" | "ON_TRACK" | "BEHIND" | "AT_RISK";

interface Props {
  rows: ClientDeliveryCardRow[];
  pacingMap: Map<string, ClientPacing>;
}

const RISK_RANK: Record<PacingStatus, number> = {
  AT_RISK: 0,
  BEHIND: 1,
  ON_TRACK: 2,
  AHEAD: 3,
};

const FILTER_LABEL: Record<PacingStatus | "ALL", string> = {
  ALL: "All",
  AT_RISK: "At Risk",
  BEHIND: "Behind",
  ON_TRACK: "On Track",
  AHEAD: "Ahead",
};

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

function ClientDeliveryCard({
  row,
  pacing,
}: {
  row: ClientDeliveryCardRow;
  pacing: ClientPacing | undefined;
}) {
  const pacingStatus: PacingStatus =
    (pacing?.status as PacingStatus | undefined) ?? "ON_TRACK";
  const varianceColor =
    row.variance > 0 ? "#42CA80" : row.variance < 0 ? "#ED6958" : "#606060";

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
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<span className="cursor-help" />}>
              <PacingBadge
                status={pacingStatus}
                deltaPct={pacing ? Math.round(pacing.delta_pct) : undefined}
              />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
              Pacing vs the delivery template for this SOW size. Compares cumulative
              actual articles to the expected cumulative at this month. AHEAD ≥ +5%,
              ON_TRACK within ±5%, BEHIND −5 to −20%, AT_RISK &lt; −20%.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Bars */}
      <div className="space-y-2">
        <DeliveryBar
          label="Delivered"
          current={row.articles_delivered}
          target={row.articles_sow}
          hint="Articles delivered vs articles in the SOW. This is the % Complete column from the table below."
        />
        <DeliveryBar
          label="Invoiced"
          current={row.articles_invoiced}
          target={row.articles_delivered}
          hint="Articles invoiced out of what was delivered. Low values here mean there is revenue not yet billed."
        />
      </div>

      {/* Footer */}
      <div className="mt-3 pt-2 border-t border-[#2a2a2a] flex items-center justify-between">
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
        <span
          className={cn(
            "font-mono text-[10px] font-semibold",
            row.pct_complete >= 75
              ? "text-[#42CA80]"
              : row.pct_complete >= 50
              ? "text-[#F5C542]"
              : "text-[#ED6958]"
          )}
        >
          {row.pct_complete}% complete
        </span>
      </div>
    </div>
  );
}

export function ClientDeliveryCards({ rows, pacingMap }: Props) {
  const [filter, setFilter] = useState<PacingStatus | "ALL">("ALL");

  // Attach pacing status to each row (ON_TRACK fallback when we don't have pacing data)
  const annotated = useMemo(() => {
    return rows.map((r) => {
      const pacing = pacingMap.get(r.name);
      const status: PacingStatus =
        (pacing?.status as PacingStatus | undefined) ?? "ON_TRACK";
      return { row: r, pacing, status };
    });
  }, [rows, pacingMap]);

  // Bucket counts for the filter strip (always computed off the full set)
  const counts = useMemo(() => {
    const c: Record<PacingStatus, number> = {
      AT_RISK: 0,
      BEHIND: 0,
      ON_TRACK: 0,
      AHEAD: 0,
    };
    for (const a of annotated) c[a.status] += 1;
    return c;
  }, [annotated]);

  const visible = useMemo(() => {
    const filtered =
      filter === "ALL" ? annotated : annotated.filter((a) => a.status === filter);
    // Sort: risks first, then by % complete ascending so laggards surface
    return [...filtered].sort((a, b) => {
      const rr = RISK_RANK[a.status] - RISK_RANK[b.status];
      if (rr !== 0) return rr;
      return a.row.pct_complete - b.row.pct_complete;
    });
  }, [annotated, filter]);

  const totalVisible = visible.length;

  return (
    <div className="space-y-3">
      {/* Heading */}
      <div>
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060] mb-1">
          Client Delivery At a Glance{" "}
          <DataSourceBadge
            type="live"
            source="Sheet: 'Delivered vs Invoiced v2' + 'Editorial SOW overview' — Spreadsheet: Editorial Capacity Planning. Same data as the Client Delivery Detail table below, rendered as per-client cards. Pacing status comes from /api/dashboard/pacing."
          />
        </h3>
        <p className="text-xs text-[#606060]">
          One card per filtered client showing delivered vs SOW, invoicing progress, variance, and a pacing badge so risks surface at a glance.
        </p>
      </div>

      {/* Filter strip */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#1e1e1e] bg-[#0d0d0d] p-1.5">
        {(["ALL", "AT_RISK", "BEHIND", "ON_TRACK", "AHEAD"] as const).map((f) => {
          const active = filter === f;
          const n = f === "ALL" ? annotated.length : counts[f];
          const tone =
            f === "AT_RISK"
              ? "text-[#ED6958]"
              : f === "BEHIND"
              ? "text-[#F5BC4E]"
              : f === "AHEAD"
              ? "text-[#42CA80]"
              : "text-[#C4BCAA]";
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
                active
                  ? "bg-[#42CA80]/12 text-[#42CA80] border border-[#42CA80]/30"
                  : "border border-transparent text-[#606060] hover:text-white"
              )}
              disabled={n === 0 && f !== "ALL"}
            >
              <span>{FILTER_LABEL[f]}</span>
              <span className={cn("font-semibold", active ? "" : tone)}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* Cards grid */}
      {totalVisible === 0 ? (
        <p className="text-center text-xs text-[#606060] py-6">
          No clients match the current filter.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map(({ row, pacing }) => (
            <ClientDeliveryCard key={row.id} row={row} pacing={pacing} />
          ))}
        </div>
      )}
    </div>
  );
}
