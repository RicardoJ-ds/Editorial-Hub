"use client";

import React, { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import {
  CardTitleWithTooltip,
  HEALTH_STYLE,
  displayPod,
  elapsedContractPct,
  healthOf,
  pacingColor,
  type Health,
  type HealthInput,
} from "./shared-helpers";
import { ClientStatusCard } from "./FilterContextCard";
import type { Client } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Scope-aware Delivery Overview cards.
//
// "Cumulative numbers across the whole portfolio" mostly aren't actionable —
// total delivered = 800 means nothing without a denominator that you can
// meaningfully act on. So we surface different cards based on what the user
// has narrowed to:
//
//   • single client    → client-specific drill-down
//   • single pod       → pod-scoped totals + the pod's most-behind client
//   • all / multi-pod  → triage signals (most-behind, closing soon, pod with
//                        most attention) instead of meaningless sums.
//
// The grid is wrapped in <motion.div layout> so cards smoothly resize and
// reorder when the user changes filters, instead of snapping.
// ─────────────────────────────────────────────────────────────────────────────

interface SummaryRow extends HealthInput {
  id: number;
  name: string;
  editorial_pod: string | null;
  articles_delivered: number;
  articles_invoiced: number;
  pct_complete: number;
  monthly_breakdown?: Array<{
    year: number;
    month: number;
    delivered: number;
    invoiced: number;
    is_future?: boolean;
  }>;
  start_date?: string | null;
}

type Scope =
  | { kind: "client"; client: Client; row: SummaryRow | null }
  | { kind: "pod"; pod: string; clients: Client[]; rows: SummaryRow[] }
  | { kind: "portfolio"; clients: Client[]; rows: SummaryRow[] };

function normalizePod(raw: string | null | undefined): string {
  if (raw == null) return "";
  const t = String(raw).trim();
  if (!t || t === "-" || t === "—") return "";
  const n = t.match(/^(\d+)$/);
  if (n) return `Pod ${n[1]}`;
  const p = t.match(/^p(?:od)?\s*(\d+)$/i);
  if (p) return `Pod ${p[1]}`;
  return t;
}

// SOW-weighted average elapsed contract % across a list of clients/rows. We
// weight by SOW so the larger-engagement clients dominate the pacing color
// (they're what the % reading is mostly about anyway).
function sowWeightedElapsedPct(
  clients: Client[],
  rows: SummaryRow[],
): number | null {
  const byId = new Map(clients.map((c) => [c.id, c]));
  let weightedSum = 0;
  let totalWeight = 0;
  for (const r of rows) {
    const client = byId.get(r.id);
    if (!client) continue;
    const e = elapsedContractPct(client.start_date, {
      endDate: client.end_date,
      termMonths: client.term_months,
    });
    if (e === null) continue;
    const w = Math.max(0, r.articles_sow);
    weightedSum += e * w;
    totalWeight += w;
  }
  if (totalWeight === 0) return null;
  return weightedSum / totalWeight;
}

function detectScope(
  filteredClients: Client[],
  rows: SummaryRow[],
): Scope {
  if (filteredClients.length === 1) {
    const client = filteredClients[0];
    const row = rows.find((r) => r.id === client.id) ?? null;
    return { kind: "client", client, row };
  }
  const pods = new Set(filteredClients.map((c) => normalizePod(c.editorial_pod)));
  if (filteredClients.length > 1 && pods.size === 1) {
    return {
      kind: "pod",
      pod: Array.from(pods)[0],
      clients: filteredClients,
      rows,
    };
  }
  return { kind: "portfolio", clients: filteredClients, rows };
}

interface Props {
  /** Full client list (used for "X of Y" framing). */
  allClients: Client[];
  /** The set the filter bar produced. */
  filteredClients: Client[];
  /** Pre-aggregated per-client summaries from the parent (already date-scoped). */
  rows: SummaryRow[];
}

const cardTransition = { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const };

export function DeliveryOverviewCards({ allClients, filteredClients, rows }: Props) {
  const scope = useMemo(
    () => detectScope(filteredClients, rows),
    [filteredClients, rows],
  );

  // Each card gets a stable key per scope kind + slot so AnimatePresence can
  // tell which cards are new vs. carried-over across filter swaps.
  const cards = useMemo(() => buildCardsForScope(scope, allClients), [scope, allClients]);

  return (
    <motion.div
      layout
      transition={cardTransition}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {cards.map(({ key, node }) => (
          <motion.div
            key={key}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={cardTransition}
          >
            {node}
          </motion.div>
        ))}
      </AnimatePresence>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Card building per scope
// ─────────────────────────────────────────────────────────────────────────────

function buildCardsForScope(
  scope: Scope,
  allClients: Client[],
): { key: string; node: React.ReactNode }[] {
  if (scope.kind === "client") {
    const c = scope.client;
    const r = scope.row;
    const eClient = elapsedContractPct(c.start_date, {
      endDate: c.end_date,
      termMonths: c.term_months,
    });
    return [
      { key: "client-status", node: <ClientStatusCard client={c} /> },
      {
        key: "client-deliv",
        node: r ? (
          <RatioCard
            title="Delivered ÷ Invoiced"
            current={r.articles_delivered}
            target={r.articles_invoiced}
            scope="lifetime"
            elapsedPct={eClient}
          />
        ) : null,
      },
      {
        key: "client-inv",
        node: r ? (
          <RatioCard
            title="Invoiced ÷ SOW"
            current={r.articles_invoiced}
            target={r.articles_sow}
            scope="lifetime"
            elapsedPct={eClient}
          />
        ) : null,
      },
      {
        key: "client-q",
        node: r ? <LastFullQCard row={r} /> : null,
      },
      {
        key: "client-time",
        node: <ContractTimingCard client={c} />,
      },
    ].filter((c) => c.node != null) as { key: string; node: React.ReactNode }[];
  }

  if (scope.kind === "pod") {
    const podRows = scope.rows;
    const podClients = scope.clients;
    const totDel = podRows.reduce((a, r) => a + r.articles_delivered, 0);
    const totInv = podRows.reduce((a, r) => a + r.articles_invoiced, 0);
    const totSow = podRows.reduce((a, r) => a + r.articles_sow, 0);
    const variance = totDel - totInv;
    const podLabel = displayPod(scope.pod, "editorial");
    // SOW-weighted average elapsed contract % so the pod's pacing bar color
    // reflects the dominant clients in the pod.
    const ePod = sowWeightedElapsedPct(podClients, podRows);
    return [
      {
        key: "pod-mix",
        node: <DeliveryMixCard rows={podRows} subtitle={`${podLabel} · ${podRows.length} clients`} />,
      },
      {
        key: "pod-deliv",
        node: (
          <RatioCard
            title="Delivered ÷ SOW"
            current={totDel}
            target={totSow}
            scope={`Across ${podLabel}`}
            elapsedPct={ePod}
          />
        ),
      },
      {
        key: "pod-inv",
        node: (
          <RatioCard
            title="Invoiced ÷ SOW"
            current={totInv}
            target={totSow}
            scope={`Across ${podLabel}`}
            elapsedPct={ePod}
          />
        ),
      },
      {
        key: "pod-var",
        node: (
          <VarianceCard
            value={variance}
            subtitle={`Pod balance · delivered − invoiced`}
          />
        ),
      },
      {
        key: "pod-top",
        node: <MostBehindCard rows={podRows} clients={podClients} compact />,
      },
    ];
  }

  // portfolio (all or multi-pod)
  const r = scope.rows;
  const c = scope.clients;
  return [
    {
      key: "port-mix",
      node: (
        <DeliveryMixCard
          rows={r}
          subtitle={`${r.length} of ${allClients.length} clients`}
        />
      ),
    },
    { key: "port-most-behind", node: <MostBehindCard rows={r} clients={c} /> },
    { key: "port-closing", node: <ClosingSoonCard clients={c} /> },
    { key: "port-recent-q", node: <RecentQClosesCard rows={r} /> },
    { key: "port-pod-attn", node: <PodAttentionCard rows={r} /> },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Cards
// ─────────────────────────────────────────────────────────────────────────────

const HEALTH_TIERS: Health[] = ["behind", "watch", "healthy"];

function DeliveryMixCard({
  rows,
  subtitle,
}: {
  rows: SummaryRow[];
  subtitle: string;
}) {
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
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
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
          {subtitle}{withSow > 0 ? ` · ${withSow} with SOW` : ""}
        </p>
        <p
          className="mt-1.5 font-mono text-2xl font-bold tabular-nums"
          style={{ color: headlineColor }}
        >
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

function RatioCard({
  title,
  current,
  target,
  scope,
  elapsedPct = null,
}: {
  title: string;
  current: number;
  target: number;
  scope: string;
  /** Elapsed contract time as % — when provided, color is pacing-aware
   *  (won't penalize a brand-new client's low absolute %). Pod / portfolio
   *  scopes pass a SOW-weighted average across the clients they cover. */
  elapsedPct?: number | null;
}) {
  const pct = target > 0 ? Math.round((current / target) * 100) : null;
  const color = pct === null ? "#606060" : pacingColor(pct, elapsedPct);
  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#C4BCAA]">
          {title}
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">{scope}</p>
        <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-white">
          {current.toLocaleString()}
          <span className="text-[#606060] font-normal"> / {target.toLocaleString()}</span>
        </p>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-[#1f1f1f] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${pct === null ? 0 : Math.min(pct, 100)}%`,
                backgroundColor: color,
              }}
            />
          </div>
          <span
            className="font-mono text-[11px] font-semibold tabular-nums"
            style={{ color }}
          >
            {pct === null ? "—" : `${pct}%`}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function VarianceCard({
  value,
  subtitle,
}: {
  value: number;
  subtitle: string;
}) {
  const color = value > 0 ? "#42CA80" : value < 0 ? "#ED6958" : "#909090";
  const sign = value > 0 ? "+" : "";
  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#C4BCAA]">
          Variance
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">{subtitle}</p>
        <p
          className="mt-1.5 font-mono text-2xl font-bold tabular-nums"
          style={{ color }}
        >
          {sign}
          {value.toLocaleString()}
        </p>
        <p className="mt-1 font-mono text-[11px] text-[#606060]">
          {value > 0
            ? "Delivered ahead of invoicing"
            : value < 0
            ? "Invoicing ahead of delivery"
            : "At balance"}
        </p>
      </CardContent>
    </Card>
  );
}

// Last-full-Q closure for a single client. Mirrors the ClientDeliveryCards
// math (contract-relative quarters anchored to start_date) but only computes
// the most recently completed Q.
function LastFullQCard({ row }: { row: SummaryRow }) {
  const lastFull = useMemo(() => computeLastFullQ(row), [row]);
  if (!lastFull) {
    return (
      <Card className="h-full border-[#2a2a2a] bg-[#161616]">
        <CardContent className="pt-0">
          <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#C4BCAA]">
            Last Full Q
          </p>
          <p className="mt-0.5 text-[11px] text-[#909090]">No closed quarter yet</p>
          <p className="mt-1.5 font-mono text-2xl font-bold text-[#606060]">—</p>
        </CardContent>
      </Card>
    );
  }
  const pct =
    lastFull.invoiced > 0
      ? Math.round((lastFull.delivered / lastFull.invoiced) * 100)
      : null;
  const color =
    pct === null
      ? "#606060"
      : pct >= 100
      ? "#42CA80"
      : pct >= 75
      ? "#42CA80"
      : pct >= 50
      ? "#F5C542"
      : "#ED6958";
  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#C4BCAA]">
          Last Full Q
        </p>
        <p className="mt-0.5 text-[11px] text-[#909090]">
          {lastFull.label} · {lastFull.monthsLabel}
        </p>
        <p
          className="mt-1.5 font-mono text-2xl font-bold tabular-nums"
          style={{ color }}
        >
          {pct === null ? "—" : `${pct}%`}
        </p>
        <p className="mt-1 font-mono text-[11px] text-[#606060] tabular-nums">
          {lastFull.delivered}/{lastFull.invoiced} delivered
        </p>
      </CardContent>
    </Card>
  );
}

function computeLastFullQ(row: SummaryRow): {
  label: string;
  monthsLabel: string;
  delivered: number;
  invoiced: number;
} | null {
  const monthly = row.monthly_breakdown;
  if (!row.start_date || !monthly?.length) return null;
  const start = new Date(row.start_date);
  if (isNaN(start.getTime())) return null;
  const startYear = start.getFullYear();
  const startMonth = start.getMonth() + 1;
  const today = new Date();
  const lastCompleted = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastCompletedMi =
    (lastCompleted.getFullYear() - startYear) * 12 +
    (lastCompleted.getMonth() + 1 - startMonth) +
    1;
  if (lastCompletedMi < 3) return null;
  const lastFullQIdx = Math.floor(lastCompletedMi / 3) - 1;
  if (lastFullQIdx < 0) return null;

  let delivered = 0;
  let invoiced = 0;
  for (const r of monthly) {
    const mi = (r.year - startYear) * 12 + (r.month - startMonth) + 1;
    if (mi < 1) continue;
    const qIdx = Math.floor((mi - 1) / 3);
    if (qIdx === lastFullQIdx) {
      delivered += r.delivered;
      invoiced += r.invoiced;
    }
  }
  const yearIdx = Math.floor(lastFullQIdx / 4);
  const qInYear = (lastFullQIdx % 4) + 1;
  const firstAbs = startYear * 12 + (startMonth - 1) + lastFullQIdx * 3;
  const firstY = Math.floor(firstAbs / 12);
  const label =
    yearIdx === 0
      ? `Q${qInYear} ${String(firstY).slice(-2)}`
      : `Q${qInYear} Y${yearIdx + 1}`;
  const MONTH_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const firstMonth = (firstAbs % 12) + 1;
  const lastMonth = ((firstAbs + 2) % 12) + 1;
  const monthsLabel = `${MONTH_SHORT[firstMonth]}–${MONTH_SHORT[lastMonth]}`;
  return { label, monthsLabel, delivered, invoiced };
}

// "Days remaining" + elapsed share of the contract.
function ContractTimingCard({ client }: { client: Client }) {
  const today = new Date();
  const start = client.start_date ? new Date(client.start_date) : null;
  const end = client.end_date ? new Date(client.end_date) : null;
  const validStart = start && !isNaN(start.getTime()) ? start : null;
  const validEnd = end && !isNaN(end.getTime()) ? end : null;

  const daysRemaining = validEnd
    ? Math.round((validEnd.getTime() - today.getTime()) / 86400000)
    : null;
  const totalDays =
    validStart && validEnd
      ? Math.max(
          1,
          Math.round((validEnd.getTime() - validStart.getTime()) / 86400000),
        )
      : null;
  const elapsedDays =
    validStart && totalDays
      ? Math.max(0, Math.round((today.getTime() - validStart.getTime()) / 86400000))
      : null;
  const elapsedPct =
    totalDays && elapsedDays !== null
      ? Math.min(100, Math.max(0, Math.round((elapsedDays / totalDays) * 100)))
      : null;

  const valueColor =
    daysRemaining === null
      ? "#606060"
      : daysRemaining < 0
      ? "#ED6958"
      : daysRemaining < 30
      ? "#F5C542"
      : "#42CA80";

  const valueText =
    daysRemaining === null
      ? "—"
      : daysRemaining < 0
      ? `${Math.abs(daysRemaining)}d ago`
      : `${daysRemaining}d`;
  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#C4BCAA]">
          {daysRemaining !== null && daysRemaining < 0 ? "Ended" : "Time Remaining"}
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          {validEnd ? validEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "No end date set"}
        </p>
        <p
          className="mt-1.5 font-mono text-2xl font-bold tabular-nums"
          style={{ color: valueColor }}
        >
          {valueText}
        </p>
        {elapsedPct !== null && (
          <div className="mt-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-[#1f1f1f] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#42CA80] transition-all duration-500"
                  style={{ width: `${elapsedPct}%` }}
                />
              </div>
              <span className="font-mono text-[11px] tabular-nums text-[#606060]">
                {elapsedPct}%
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-[#606060]">
              Elapsed of contract term
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Top 3 clients with the most negative cumulative variance, listed inline.
function MostBehindCard({
  rows,
  clients,
  compact = false,
}: {
  rows: SummaryRow[];
  clients: Client[];
  compact?: boolean;
}) {
  const list = useMemo(() => {
    const byId = new Map(clients.map((c) => [c.id, c]));
    return rows
      .map((r) => ({ row: r, v: r.variance_cumulative ?? r.variance, client: byId.get(r.id) }))
      .filter((x) => x.v < 0 && x.client)
      .sort((a, b) => a.v - b.v)
      .slice(0, compact ? 1 : 3);
  }, [rows, clients, compact]);

  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#C4BCAA]">
          {compact ? "Top to Watch" : "Most Behind"}
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          By cumulative variance
        </p>
        {list.length === 0 ? (
          <>
            <p className="mt-1.5 font-mono text-2xl font-bold text-[#42CA80]">All clear</p>
            <p className="mt-1 font-mono text-[11px] text-[#606060]">
              Every client at or ahead of plan
            </p>
          </>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {list.map(({ row, v, client }) => (
              <li
                key={row.id}
                className="flex items-baseline justify-between gap-2 font-mono text-[12px]"
              >
                <span className="min-w-0 truncate text-white" title={client!.name}>
                  {client!.name}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-[#ED6958]">
                  {v.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ClosingSoonCard({ clients }: { clients: Client[] }) {
  const closing = useMemo(() => {
    const today = new Date();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 90);
    return clients
      .map((c) => {
        if (!c.end_date) return null;
        const end = new Date(c.end_date);
        if (isNaN(end.getTime())) return null;
        if (end < today) return null;
        if (end > cutoff) return null;
        return { client: c, end };
      })
      .filter((x): x is { client: Client; end: Date } => x !== null)
      .sort((a, b) => a.end.getTime() - b.end.getTime());
  }, [clients]);

  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#C4BCAA]">
          Closing in 90d
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          Contracts ending soon
        </p>
        <p
          className="mt-1.5 font-mono text-2xl font-bold tabular-nums"
          style={{
            color:
              closing.length === 0 ? "#909090" : closing.length >= 3 ? "#F5C542" : "#42CA80",
          }}
        >
          {closing.length}
        </p>
        {closing.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {closing.slice(0, 3).map(({ client, end }) => {
              const days = Math.max(
                0,
                Math.round((end.getTime() - Date.now()) / 86400000),
              );
              return (
                <li
                  key={client.id}
                  className="flex items-baseline justify-between gap-2 font-mono text-[11px]"
                >
                  <span className="min-w-0 truncate text-[#C4BCAA]" title={client.name}>
                    {client.name}
                  </span>
                  <span className="shrink-0 tabular-nums text-[#606060]">
                    {days}d
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// Average closing % across all last-full-Qs that we can compute. Plus a count
// of clients whose last Q closed under 100%.
function RecentQClosesCard({ rows }: { rows: SummaryRow[] }) {
  const stats = useMemo(() => {
    let withQ = 0;
    let underTarget = 0;
    let pctSum = 0;
    for (const r of rows) {
      const q = computeLastFullQ(r);
      if (!q || q.invoiced <= 0) continue;
      withQ += 1;
      const pct = (q.delivered / q.invoiced) * 100;
      pctSum += Math.min(pct, 200);
      if (pct < 100) underTarget += 1;
    }
    return {
      withQ,
      underTarget,
      avgPct: withQ > 0 ? Math.round(pctSum / withQ) : null,
    };
  }, [rows]);

  const color =
    stats.avgPct === null
      ? "#909090"
      : stats.avgPct >= 100
      ? "#42CA80"
      : stats.avgPct >= 75
      ? "#42CA80"
      : stats.avgPct >= 50
      ? "#F5C542"
      : "#ED6958";

  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#C4BCAA]">
          Last Q Closes
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          Avg closing % across {stats.withQ} {stats.withQ === 1 ? "client" : "clients"}
        </p>
        <p
          className="mt-1.5 font-mono text-2xl font-bold tabular-nums"
          style={{ color }}
        >
          {stats.avgPct === null ? "—" : `${stats.avgPct}%`}
        </p>
        <p className="mt-1 font-mono text-[11px] text-[#606060]">
          {stats.underTarget > 0
            ? `${stats.underTarget} closed under 100%`
            : stats.withQ > 0
            ? "All quarters hit target"
            : "No closed quarter yet"}
        </p>
      </CardContent>
    </Card>
  );
}

function PodAttentionCard({ rows }: { rows: SummaryRow[] }) {
  const stats = useMemo(() => {
    const byPod: Record<string, { behind: number; total: number }> = {};
    for (const r of rows) {
      const pod = normalizePod(r.editorial_pod) || "Unassigned";
      const slot = byPod[pod] ?? { behind: 0, total: 0 };
      slot.total += 1;
      if (healthOf(r) === "behind") slot.behind += 1;
      byPod[pod] = slot;
    }
    const sorted = Object.entries(byPod).sort(
      (a, b) => b[1].behind - a[1].behind,
    );
    return sorted;
  }, [rows]);

  const top = stats[0];
  if (!top || top[1].behind === 0) {
    return (
      <Card className="h-full border-[#2a2a2a] bg-[#161616]">
        <CardContent className="pt-0">
          <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#C4BCAA]">
            Pod Attention
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
            Distribution of behind clients
          </p>
          <p className="mt-1.5 font-mono text-2xl font-bold text-[#42CA80]">
            All clear
          </p>
          <p className="mt-1 font-mono text-[11px] text-[#606060]">
            No pod has behind clients
          </p>
        </CardContent>
      </Card>
    );
  }
  const [topPod, { behind, total }] = top;
  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#C4BCAA]">
          Pod Attention
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          Pod with most BEHIND clients
        </p>
        <p
          className="mt-1.5 font-mono text-xl font-bold text-white truncate"
          title={displayPod(topPod, "editorial")}
        >
          {displayPod(topPod, "editorial")}
        </p>
        <p className="mt-1 font-mono text-[11px] text-[#ED6958] tabular-nums">
          {behind}/{total} behind
        </p>
        {stats.length > 1 && (
          <ul className="mt-1 space-y-0.5">
            {stats.slice(1, 3).map(([pod, { behind: b, total: t }]) => (
              <li
                key={pod}
                className="flex items-baseline justify-between gap-2 font-mono text-[10px]"
              >
                <span className="truncate text-[#C4BCAA]">
                  {displayPod(pod, "editorial")}
                </span>
                <span className="shrink-0 tabular-nums text-[#606060]">
                  {b}/{t}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
