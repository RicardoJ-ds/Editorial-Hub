"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  CardTitleWithTooltip,
  HEALTH_STYLE,
  displayPod,
  healthOf,
  type Health,
  type HealthInput,
} from "./shared-helpers";
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

interface ProgressRow extends HealthInput {
  articles_delivered: number;
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

export function ClientStatusCard({ client }: { client: Client }) {
  const style = statusStyle(client.status);
  const daysToEnd = daysBetweenToday(client.end_date);
  const daysSinceStart = client.start_date
    ? -1 * (daysBetweenToday(client.start_date) ?? 0)
    : null;

  return (
    <Card className="border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#C4BCAA]">
          Client Status
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090] truncate" title={client.name}>
          {client.name}
        </p>
        <div className="mt-2 flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: style.dot }}
          />
          <span
            className="rounded px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: style.fg, backgroundColor: style.bg }}
          >
            {style.label}
          </span>
        </div>
        <div className="mt-2 space-y-0.5 font-mono text-[11px] text-[#C4BCAA]">
          <div className="flex justify-between gap-2">
            <span className="text-[#606060]">Editorial Pod</span>
            <span className="text-white">{client.editorial_pod ? displayPod(client.editorial_pod, "editorial") : "—"}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-[#606060]">Growth Pod</span>
            <span className="text-white">{client.growth_pod ? displayPod(client.growth_pod, "growth") : "—"}</span>
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

// Triage tiers for the Delivery Progress card, using the same health rule as
// every per-card chip. Order = visual priority (Behind first).
const HEALTH_TIERS: Health[] = ["behind", "watch", "healthy"];

function DeliveryProgressMixCard({ rows }: { rows: ProgressRow[] }) {
  // Reuses the already-filtered per-client summaries so the mix respects
  // whatever date window the Client Delivery cards are showing.
  const counts: Record<Health, number> = { behind: 0, watch: 0, healthy: 0 };
  let totalDelivered = 0;
  let totalSow = 0;
  let withSow = 0;
  for (const r of rows) {
    if (r.articles_sow <= 0) continue;
    withSow += 1;
    totalDelivered += r.articles_delivered;
    totalSow += r.articles_sow;
    counts[healthOf(r)] += 1;
  }
  const totalPct = totalSow > 0 ? Math.round((totalDelivered / totalSow) * 100) : 0;
  const headlineColor =
    totalPct >= 75 ? "#42CA80" : totalPct >= 50 ? "#F5C542" : "#ED6958";

  return (
    <Card className="border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <CardTitleWithTooltip
          label="Delivery Progress"
          body={{
            title: "Delivery Progress",
            bullets: [
              "Big number = total articles delivered ÷ total contracted (SOW), summed across the clients in the current filter.",
              "Behind / Watch / Healthy buckets each client by its lifetime delivered − invoiced gap: Healthy = even or ahead; Watch = slipping; Behind = more than one month of SOW behind.",
              "Clients without a SOW set are skipped (no denominator to compare against).",
            ],
          }}
        />
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          Delivered ÷ SOW across {withSow} client{withSow === 1 ? "" : "s"}
        </p>
        <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums" style={{ color: headlineColor }}>
          {totalPct}%
          <span className="ml-1 text-xs text-[#606060] font-normal">overall</span>
        </p>
        <div className="mt-2 space-y-0.5">
          {HEALTH_TIERS.map((tier) => {
            const style = HEALTH_STYLE[tier];
            return (
              <div
                key={tier}
                className="flex items-center justify-between gap-2 font-mono text-[11px]"
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: style.color }}
                  />
                  <span className="uppercase tracking-wider text-[#C4BCAA]">
                    {style.label}
                  </span>
                </span>
                <span
                  className="tabular-nums font-semibold"
                  style={{ color: style.color }}
                >
                  {counts[tier]}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
