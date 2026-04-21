"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { Client } from "@/lib/types";

const STATUS_STYLES: Record<
  string,
  { label: string; fg: string; bg: string; dot: string }
> = {
  ACTIVE: { label: "Active", fg: "#42CA80", bg: "#1f4d2e", dot: "#42CA80" },
  SOON_TO_BE_ACTIVE: { label: "Soon to be active", fg: "#8FB5D9", bg: "#1f3a5a", dot: "#8FB5D9" },
  INACTIVE: { label: "Inactive", fg: "#ED6958", bg: "#5b1e1e", dot: "#ED6958" },
  COMPLETED: { label: "Completed", fg: "#CEBCF4", bg: "#3a2452", dot: "#CEBCF4" },
  PAUSED: { label: "Paused", fg: "#F5C542", bg: "#6d4a1e", dot: "#F5C542" },
  TBD: { label: "TBD", fg: "#606060", bg: "#1a1a1a", dot: "#606060" },
};

function statusStyle(raw: string | null | undefined) {
  if (!raw) return STATUS_STYLES.TBD;
  const key = raw.toUpperCase().replace(/\s+/g, "_");
  return STATUS_STYLES[key] ?? {
    label: raw,
    fg: "#C4BCAA",
    bg: "#2a2a2a",
    dot: "#C4BCAA",
  };
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

function daysBetweenToday(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  return Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

interface ProgressRow {
  articles_sow: number;
  articles_delivered: number;
  pct_complete: number;
}

interface Props {
  clients: Client[];
  /**
   * Pre-aggregated per-client summaries from the parent page. Same shape as
   * the Client Delivery cards consume, so Delivery Progress honors whatever
   * time-window filter the cards already applied (SOW stays lifetime,
   * delivered is filtered).
   */
  rows: ProgressRow[];
}

/**
 * Slot 1 in the Delivery Overview row. Adapts to the filter:
 *   • 1 client  → Client Status card (status chip, pod, contract window, days remaining)
 *   • N clients → Delivery Progress Mix — respects the active date range via `rows`.
 */
export function FilterContextCard({ clients, rows }: Props) {
  if (clients.length === 1) {
    return <ClientStatusCard client={clients[0]} />;
  }
  return <DeliveryProgressMixCard rows={rows} />;
}

function ClientStatusCard({ client }: { client: Client }) {
  const style = statusStyle(client.status);
  const daysToEnd = daysBetweenToday(client.end_date);
  const daysSinceStart = client.start_date
    ? -1 * (daysBetweenToday(client.start_date) ?? 0)
    : null;

  return (
    <Card className="border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#C4BCAA]">
          Client Status
        </p>
        <p className="mt-0.5 text-[10px] leading-snug text-[#909090] truncate" title={client.name}>
          {client.name}
        </p>
        <div className="mt-2 flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: style.dot }}
          />
          <span
            className="rounded px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: style.fg, backgroundColor: style.bg }}
          >
            {style.label}
          </span>
        </div>
        <div className="mt-2 space-y-0.5 font-mono text-[10px] text-[#C4BCAA]">
          <div className="flex justify-between gap-2">
            <span className="text-[#606060]">Pod</span>
            <span className="text-white">{client.editorial_pod || "—"}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-[#606060]">Contract</span>
            <span className="text-white tabular-nums">
              {fmtDate(client.start_date)} → {fmtDate(client.end_date)}
            </span>
          </div>
          {daysToEnd !== null && (
            <div className="flex justify-between gap-2">
              <span className="text-[#606060]">
                {daysToEnd >= 0 ? "Remaining" : "Ended"}
              </span>
              <span
                className="tabular-nums font-semibold"
                style={{ color: daysToEnd < 30 && daysToEnd >= 0 ? "#F5C542" : daysToEnd < 0 ? "#ED6958" : "#42CA80" }}
              >
                {Math.abs(daysToEnd)}d{daysToEnd < 0 ? " ago" : ""}
              </span>
            </div>
          )}
          {daysSinceStart !== null && daysSinceStart >= 0 && (
            <div className="flex justify-between gap-2">
              <span className="text-[#606060]">Elapsed</span>
              <span className="text-white tabular-nums">{daysSinceStart}d</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type ProgressBucket = "NOT_STARTED" | "EARLY" | "MID" | "LATE" | "COMPLETE";

const PROGRESS_ROW: {
  key: ProgressBucket;
  label: string;
  color: string;
  range: string;
}[] = [
  { key: "NOT_STARTED", label: "Not started", color: "#606060", range: "0%" },
  { key: "EARLY", label: "Early", color: "#ED6958", range: "1–25%" },
  { key: "MID", label: "Mid", color: "#F5C542", range: "26–75%" },
  { key: "LATE", label: "Late", color: "#42CA80", range: "76–99%" },
  { key: "COMPLETE", label: "Complete", color: "#8FB5D9", range: "100%" },
];

function bucketOf(pct: number): ProgressBucket {
  if (pct <= 0) return "NOT_STARTED";
  if (pct <= 25) return "EARLY";
  if (pct <= 75) return "MID";
  if (pct < 100) return "LATE";
  return "COMPLETE";
}

function DeliveryProgressMixCard({ rows }: { rows: ProgressRow[] }) {
  // Reuses the already-filtered per-client summaries so the mix respects
  // whatever date window the Client Delivery cards are showing.
  const counts: Record<ProgressBucket, number> = {
    NOT_STARTED: 0,
    EARLY: 0,
    MID: 0,
    LATE: 0,
    COMPLETE: 0,
  };
  let totalDelivered = 0;
  let totalSow = 0;
  let withSow = 0;
  for (const r of rows) {
    if (r.articles_sow <= 0) continue;
    withSow += 1;
    totalDelivered += r.articles_delivered;
    totalSow += r.articles_sow;
    counts[bucketOf(r.pct_complete)] += 1;
  }
  const totalPct = totalSow > 0 ? Math.round((totalDelivered / totalSow) * 100) : 0;
  const headlineColor =
    totalPct >= 75 ? "#42CA80" : totalPct >= 50 ? "#F5C542" : "#ED6958";

  return (
    <Card className="border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#C4BCAA]">
          Delivery Progress
        </p>
        <p className="mt-0.5 text-[10px] leading-snug text-[#909090]">
          Delivered ÷ SOW across {withSow} client{withSow === 1 ? "" : "s"}
        </p>
        <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums" style={{ color: headlineColor }}>
          {totalPct}%
          <span className="ml-1 text-xs text-[#606060] font-normal">overall</span>
        </p>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
          {PROGRESS_ROW.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-2 font-mono text-[10px]">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: row.color }}
                />
                <span className="text-[#C4BCAA]">{row.label}</span>
              </span>
              <span className="tabular-nums font-semibold" style={{ color: row.color }}>
                {counts[row.key]}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
