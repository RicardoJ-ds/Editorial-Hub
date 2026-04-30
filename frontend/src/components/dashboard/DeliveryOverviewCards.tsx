"use client";

import React, { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronRight } from "lucide-react";
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
import { parseISODateLocal } from "@/lib/utils";
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

// Scroll to the per-client card in the "Client Delivery At a Glance" section
// below. Each row in the Most Behind / Closing in 90D cards is wired to call
// this so the user can drill from a triage signal into the full client card.
// `scroll-mt-[180px]` on the target accounts for the sticky filter band + h2.
function scrollToClient(clientId: number) {
  const el =
    typeof document !== "undefined"
      ? document.getElementById(`client-delivery-${clientId}`)
      : null;
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  // Brief highlight so the user's eye lands on the right card after scroll.
  el.classList.add("ring-2", "ring-[#42CA80]/60", "ring-offset-2", "ring-offset-black", "transition-shadow");
  window.setTimeout(() => {
    el.classList.remove("ring-2", "ring-[#42CA80]/60", "ring-offset-2", "ring-offset-black");
  }, 1600);
}

function scrollToPod(pod: string) {
  const slug = pod.replace(/\s+/g, "-").toLowerCase();
  const el =
    typeof document !== "undefined"
      ? document.getElementById(`client-delivery-pod-${slug}`)
      : null;
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  // Outline the whole pod group briefly so the user sees they landed on
  // the right pod, not a single client card.
  el.classList.add(
    "outline",
    "outline-2",
    "outline-[#42CA80]/50",
    "outline-offset-4",
    "rounded",
    "transition-all",
  );
  window.setTimeout(() => {
    el.classList.remove(
      "outline",
      "outline-2",
      "outline-[#42CA80]/50",
      "outline-offset-4",
      "rounded",
    );
  }, 1600);
}

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
    const variance = totDel - totInv;
    const podLabel = displayPod(scope.pod, "editorial");
    // Same five-card layout as portfolio scope but everything is filtered to
    // this pod's clients only. Cards mirror the last-Q lens we adopted across
    // the dashboard — Delivery Progress / Last Q Closes / Most Behind all
    // grade against the most recently CLOSED contract quarter, not lifetime
    // cumulative variance. Variance is kept as the only lifetime signal so
    // the user still sees the pod's overall delivery vs invoicing balance.
    return [
      {
        key: "pod-mix",
        node: (
          <DeliveryMixCard
            rows={podRows}
            subtitle={`${podLabel} · ${podRows.length} clients`}
          />
        ),
      },
      {
        key: "pod-recent-q",
        node: <RecentQClosesCard rows={podRows} clients={podClients} />,
      },
      {
        key: "pod-closing",
        node: <ClosingSoonCard clients={podClients} />,
      },
      {
        key: "pod-var",
        node: (
          <VarianceCard
            value={variance}
            subtitle={`Pod balance · delivered − invoiced (lifetime)`}
          />
        ),
      },
      {
        key: "pod-most-behind",
        node: <MostBehindCard rows={podRows} clients={podClients} />,
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
    { key: "port-recent-q", node: <RecentQClosesCard rows={r} clients={c} /> },
    { key: "port-pod-attn", node: <PodAttentionCard rows={r} clients={c} /> },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Cards
// ─────────────────────────────────────────────────────────────────────────────

const HEALTH_TIERS: Health[] = ["behind", "watch", "healthy"];

// Bucket a client by its **last full contract Q** closure ratio. Mirrors
// the Most Behind card's lens so the dashboard tells one coherent story:
// instead of "lifetime cumulative health" the cards now triage on the most
// recent settled quarter.
//   ≥ 100% closure → healthy (closed at or above target)
//    75–99%        → watch   (slightly behind on the close)
//    < 75%         → behind  (significantly under)
// Returns null when the client has no closed Q yet (new contracts) — those
// are surfaced separately as "no closed Q".
function lastQHealth(row: SummaryRow): Health | null {
  const q = computeLastFullQ(row);
  if (!q || q.invoiced <= 0) return null;
  const pct = (q.delivered / q.invoiced) * 100;
  if (pct >= 100) return "healthy";
  if (pct >= 75) return "watch";
  return "behind";
}

function DeliveryMixCard({
  rows,
  subtitle,
}: {
  rows: SummaryRow[];
  subtitle: string;
}) {
  const counts: Record<Health, number> = { behind: 0, watch: 0, healthy: 0 };
  let withQ = 0;
  let noQ = 0;
  let qDelivered = 0;
  let qInvoiced = 0;
  for (const r of rows) {
    const q = computeLastFullQ(r);
    if (!q || q.invoiced <= 0) {
      noQ += 1;
      continue;
    }
    withQ += 1;
    qDelivered += q.delivered;
    qInvoiced += q.invoiced;
    const tier = lastQHealth(r);
    if (tier) counts[tier] += 1;
  }
  const totalPct = qInvoiced > 0 ? Math.round((qDelivered / qInvoiced) * 100) : 0;
  const headlineColor =
    qInvoiced === 0
      ? "#909090"
      : totalPct >= 100
      ? "#42CA80"
      : totalPct >= 75
      ? "#42CA80"
      : totalPct >= 50
      ? "#F5C542"
      : "#ED6958";
  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="flex h-full flex-col pt-0">
        <CardTitleWithTooltip
          label="Delivery Progress"
          body={{
            title: "Delivery Progress",
            bullets: [
              "% = Σ delivered ÷ Σ invoiced for each client's last closed Q.",
              "Healthy ≥ 100% · Watch 75–99% · Behind < 75%.",
              "No closed Q = too new to score (excluded).",
            ],
          }}
        />
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          {subtitle}{withQ > 0 ? ` · ${withQ} with closed Q` : ""}
        </p>
        <p
          className="mt-1.5 font-mono text-2xl font-bold tabular-nums"
          style={{ color: headlineColor }}
        >
          {qInvoiced === 0 ? "—" : `${totalPct}%`}
          <span className="ml-1 text-xs text-[#606060] font-normal">last full Q</span>
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
        <div className="mt-auto pt-2 font-mono text-[10px] text-[#606060]">
          <span className="text-[#909090]">{qDelivered.toLocaleString()}</span>
          <span> / </span>
          <span>{qInvoiced.toLocaleString()}</span>
          <span className="ml-1 uppercase tracking-wider">
            delivered · invoiced (last Q)
          </span>
          {noQ > 0 && (
            <span className="ml-2 uppercase tracking-wider">
              · {noQ} no closed Q
            </span>
          )}
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
  // For a single client we can also show the *prior* Q's closure so the
  // user sees a one-step trend (improving / declining) instead of just a
  // standalone number. Computes by aggregating monthly_breakdown into
  // contract Qs and picking the index before the last full Q.
  const stats = useMemo(() => {
    const last = computeLastFullQ(row);
    if (!last) return null;
    if (!row.start_date || !row.monthly_breakdown?.length) {
      return { last, prior: null as null | { pct: number; label: string } };
    }
    const start = parseISODateLocal(row.start_date);
    if (!start) return { last, prior: null };
    const startYear = start.getFullYear();
    const startMonth = start.getMonth() + 1;
    const today = new Date();
    const lastCompleted = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastCompletedMi =
      (lastCompleted.getFullYear() - startYear) * 12 +
      (lastCompleted.getMonth() + 1 - startMonth) +
      1;
    const lastFullQIdx =
      lastCompletedMi >= 3 ? Math.floor(lastCompletedMi / 3) - 1 : -1;
    const priorQIdx = lastFullQIdx - 1;
    if (priorQIdx < 0) return { last, prior: null };

    let pDelivered = 0;
    let pInvoiced = 0;
    for (const r of row.monthly_breakdown) {
      const mi = (r.year - startYear) * 12 + (r.month - startMonth) + 1;
      if (mi < 1) continue;
      const qIdx = Math.floor((mi - 1) / 3);
      if (qIdx === priorQIdx) {
        pDelivered += r.delivered;
        pInvoiced += r.invoiced;
      }
    }
    if (pInvoiced <= 0) return { last, prior: null };
    const yearIdx = Math.floor(priorQIdx / 4);
    const qInYear = (priorQIdx % 4) + 1;
    const firstAbs = startYear * 12 + (startMonth - 1) + priorQIdx * 3;
    const firstY = Math.floor(firstAbs / 12);
    const label =
      yearIdx === 0
        ? `Q${qInYear} ${String(firstY).slice(-2)}`
        : `Q${qInYear} Y${yearIdx + 1}`;
    return {
      last,
      prior: { pct: Math.round((pDelivered / pInvoiced) * 100), label },
    };
  }, [row]);

  if (!stats) {
    return (
      <Card className="h-full border-[#2a2a2a] bg-[#161616]">
        <CardContent className="flex h-full flex-col pt-0">
          <CardTitleWithTooltip
            label="Last Full Q"
            body={{
              title: "Last Full Q",
              bullets: [
                "% = delivered ÷ invoiced for the last closed contract Q.",
                "Per-client contract Q (anchored to start_date).",
                "Shown when the client has at least one closed Q.",
              ],
            }}
          />
          <p className="mt-0.5 text-[11px] text-[#909090]">No closed quarter yet</p>
          <p className="mt-1.5 font-mono text-2xl font-bold text-[#606060]">—</p>
        </CardContent>
      </Card>
    );
  }
  const { last: lastFull, prior } = stats;
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
  const trendDelta = prior && pct !== null ? pct - prior.pct : null;
  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="flex h-full flex-col pt-0">
        <CardTitleWithTooltip
          label="Last Full Q"
          body={{
            title: "Last Full Q",
            bullets: [
              "% = delivered ÷ invoiced for the last closed contract Q.",
              "Per-client contract Q (anchored to start_date).",
              "Δ vs prior Q shown when there's a previous closed Q.",
            ],
          }}
        />
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
        {prior && trendDelta !== null && (
          <p className="mt-auto pt-2 font-mono text-[10px] uppercase tracking-wider text-[#606060]">
            <span className="text-[#909090]">vs {prior.label}:</span>
            <span
              className="ml-1 font-semibold tabular-nums"
              style={{
                color:
                  trendDelta > 0
                    ? "#42CA80"
                    : trendDelta < 0
                    ? "#ED6958"
                    : "#909090",
              }}
            >
              {trendDelta > 0 ? "+" : ""}
              {trendDelta} pp
            </span>
            <span className="ml-1 text-[#606060]">({prior.pct}%)</span>
          </p>
        )}
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
  if (!monthly?.length) return null;
  const start = parseISODateLocal(row.start_date);
  if (!start) return null;
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
  const validStart = parseISODateLocal(client.start_date);
  const validEnd = parseISODateLocal(client.end_date);

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
}: {
  rows: SummaryRow[];
  clients: Client[];
}) {
  // Full sorted list of behind clients (negative last-Q variance).
  // The card body shows the top 3; the overflow lives in a popover
  // triggered by the "View all" footer link.
  const allBehind = useMemo(() => {
    const byId = new Map(clients.map((c) => [c.id, c]));
    return rows
      .map((r) => {
        const lastQ = computeLastFullQ(r);
        if (!lastQ) return null;
        const v = lastQ.delivered - lastQ.invoiced;
        return { row: r, v, lastQ, client: byId.get(r.id) };
      })
      .filter((x): x is NonNullable<typeof x> & { client: Client } =>
        x !== null && x.v < 0 && !!x.client,
      )
      .sort((a, b) => a.v - b.v);
  }, [rows, clients]);

  const list = allBehind.slice(0, 3);
  const overflow = allBehind.length - list.length;
  const totalGap = allBehind.reduce((acc, x) => acc + x.v, 0);

  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="flex h-full flex-col pt-0">
        <CardTitleWithTooltip
          label="Most Behind"
          body={{
            title: "Most Behind",
            bullets: [
              "Last Q gap = delivered − invoiced. Negative = below target.",
              "Range is each client's own contract Q (per start_date).",
              "Click row → jump to client.",
            ],
          }}
        />
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          Last full Q gap (delivered − invoiced) · per-client contract Q
        </p>
        {list.length === 0 ? (
          <>
            <p className="mt-1.5 font-mono text-2xl font-bold text-[#42CA80]">All clear</p>
            <p className="mt-1 font-mono text-[11px] text-[#606060]">
              Every client closed the last Q at or above target
            </p>
          </>
        ) : (
          <>
            <ul className="mt-1.5 space-y-1">
              {list.map((item) => (
                <BehindRow key={item.row.id} item={item} />
              ))}
            </ul>
            <div className="mt-auto flex items-center justify-between gap-2 pt-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
                <span className="text-[#ED6958]">{totalGap.toLocaleString()}</span>
                {" "}total gap · {allBehind.length} behind
              </span>
              {overflow > 0 && (
              <Popover>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[#909090] hover:text-[#C4BCAA]"
                    />
                  }
                >
                  View all {allBehind.length}
                  <ChevronRight className="h-3 w-3" />
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="bottom"
                  className="w-[360px] max-w-[90vw] border border-[#2a2a2a] bg-[#0d0d0d] p-0"
                >
                  <div className="border-b border-[#2a2a2a] px-3 py-2">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#C4BCAA]">
                      Most behind · last full Q
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-[#606060]">
                      {allBehind.length} clients · click a row to jump to its card
                    </p>
                  </div>
                  <ul className="max-h-[320px] overflow-y-auto p-1">
                    {allBehind.map((item) => (
                      <BehindRow key={item.row.id} item={item} dense />
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface BehindRowItem {
  row: SummaryRow;
  v: number;
  lastQ: { label: string; monthsLabel: string; delivered: number; invoiced: number };
  client: Client;
}

function BehindRow({ item, dense = false }: { item: BehindRowItem; dense?: boolean }) {
  const { row, v, lastQ, client } = item;
  return (
    <li>
      <button
        type="button"
        onClick={() => scrollToClient(row.id)}
        title={`Jump to ${client.name}'s card`}
        className={
          // Hover bg is lighter than both the card surface (#161616) and the
          // popover surface (#0d0d0d) so the hover state reads on either.
          "flex w-full items-baseline justify-between gap-2 rounded font-mono text-[12px] transition-colors hover:bg-[#242424] " +
          (dense ? "px-2 py-1" : "px-1.5 py-0.5 -mx-1.5")
        }
      >
        <span className="min-w-0 flex-1 truncate text-left text-white" title={client.name}>
          {client.name}
          <span className="ml-1.5 text-[10px] text-[#606060]">
            {lastQ.label} · {lastQ.monthsLabel}
          </span>
        </span>
        <span className="shrink-0 tabular-nums">
          <span className="text-[#606060]">
            {lastQ.delivered}/{lastQ.invoiced}
          </span>
          <span className="ml-2 font-semibold text-[#ED6958]">{v.toLocaleString()}</span>
        </span>
      </button>
    </li>
  );
}

type ClosingSource = "sow" | "ops";

function ClosingSoonCard({ clients }: { clients: Client[] }) {
  // Two end-date sources: SOW Overview (`end_date`) is the contract's
  // declared close; Operating Model (`operating_model_end_date`) is the
  // last month with non-zero production projection. They diverge when
  // ops has already wound a client down or a renewal isn't reflected in
  // the SOW yet — toggle so the user can audit the discrepancies.
  const [source, setSource] = useState<ClosingSource>("sow");

  const closing = useMemo(() => {
    const today = new Date();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 90);
    return clients
      .map((c) => {
        const raw =
          source === "sow" ? c.end_date : c.operating_model_end_date;
        const parsed = parseISODateLocal(raw);
        if (!parsed) return null;
        // Operating Model dates are month-precision (anchored to day 1 of the
        // last projected month). A client whose ops_end is "Apr 2026" closes
        // some time during April, so for cutoff comparisons we treat it as
        // end-of-month — otherwise a client closing this month would already
        // appear "past" by the second day of the month and drop off the list.
        const end =
          source === "ops"
            ? new Date(parsed.getFullYear(), parsed.getMonth() + 1, 0)
            : parsed;
        if (end < today) return null;
        if (end > cutoff) return null;
        return { client: c, end };
      })
      .filter((x): x is { client: Client; end: Date } => x !== null)
      .sort((a, b) => a.end.getTime() - b.end.getTime());
  }, [clients, source]);

  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="flex h-full flex-col pt-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitleWithTooltip
              label="Closing in 90d"
              body={{
                title: "Closing in 90d",
                bullets: [
                  "SOW = contract end date · Ops = last projected month.",
                  "Toggle to spot mismatches (renewal not entered, silent churn).",
                  "Full divergence list at /admin/data-quality.",
                ],
              }}
            />
            <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
              {source === "sow"
                ? "By SOW Overview end date"
                : "By Operating Model last projected month"}
            </p>
          </div>
          <div
            role="tablist"
            aria-label="End-date source"
            className="shrink-0 inline-flex rounded-md border border-[#2a2a2a] bg-[#0d0d0d] p-0.5 font-mono text-[10px] uppercase tracking-wider"
          >
            {(["sow", "ops"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={source === s}
                onClick={() => setSource(s)}
                className={
                  source === s
                    ? "rounded-sm bg-[#1f1f1f] px-1.5 py-0.5 text-white"
                    : "rounded-sm px-1.5 py-0.5 text-[#606060] hover:text-[#C4BCAA]"
                }
                title={
                  s === "sow"
                    ? "SOW Overview end date"
                    : "Last month with projected production in the Operating Model"
                }
              >
                {s === "sow" ? "SOW" : "Ops"}
              </button>
            ))}
          </div>
        </div>
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
          <>
            <ul className="mt-1 space-y-0.5">
              {closing.slice(0, 3).map((item) => (
                <ClosingRow key={item.client.id} item={item} source={source} />
              ))}
            </ul>
            {closing.length > 3 && (
              <Popover>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      className="mt-auto inline-flex items-center gap-1 pt-2 font-mono text-[10px] uppercase tracking-wider text-[#909090] hover:text-[#C4BCAA]"
                    />
                  }
                >
                  View all {closing.length}
                  <ChevronRight className="h-3 w-3" />
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  side="bottom"
                  className="w-[320px] max-w-[90vw] border border-[#2a2a2a] bg-[#0d0d0d] p-0"
                >
                  <div className="border-b border-[#2a2a2a] px-3 py-2">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#C4BCAA]">
                      Closing in 90d · {source === "sow" ? "SOW" : "Operating Model"}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-[#606060]">
                      {closing.length} clients · click a row to jump to its card
                    </p>
                  </div>
                  <ul className="max-h-[320px] overflow-y-auto p-1">
                    {closing.map((item) => (
                      <ClosingRow
                        key={item.client.id}
                        item={item}
                        source={source}
                        dense
                      />
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Urgency tiers shared by both toggle modes so the colors mean the same
// thing — closer = heavier weight. SOW maps days→tier, Ops maps
// months→tier so "this month" = same dark-green tone as "0–30d".
//
// Palette (Graphite DS): P3 (dark green) → P2 (lighter green) → WN1 (cream).
// Imminent gets the heaviest swatch so it reads as "weight on the calendar"
// rather than "red emergency"; later closes fade to cream as informational.
type UrgencyTier = "imminent" | "soon" | "later";

// Same pill style as podBadge / statusBadge across the app: 15% bg tint,
// 30% border, full-color text — all in the same hue. Three Graphite DS
// swatches with enough hue spread (P1 bright → P3 dark → WN1 cream) to
// read distinct at a glance.
const URGENCY_STYLE: Record<
  UrgencyTier,
  { bg: string; fg: string; border: string }
> = {
  imminent: {
    bg: "rgba(101,255,170,0.15)",
    fg: "#65FFAA",
    border: "rgba(101,255,170,0.30)",
  }, // P1 bright
  soon: {
    bg: "rgba(46,140,89,0.18)",
    fg: "#2E8C59",
    border: "rgba(46,140,89,0.40)",
  }, // P3 dark
  later: {
    bg: "rgba(221,207,172,0.12)",
    fg: "#DDCFAC",
    border: "rgba(221,207,172,0.30)",
  }, // WN1 cream
};

function urgencyFromDays(days: number): UrgencyTier {
  if (days <= 30) return "imminent";
  if (days <= 60) return "soon";
  return "later";
}
function urgencyFromMonthsAhead(m: number): UrgencyTier {
  if (m <= 0) return "imminent";
  if (m === 1) return "soon";
  return "later";
}

function ClosingRow({
  item,
  source,
  dense = false,
}: {
  item: { client: Client; end: Date };
  source: ClosingSource;
  dense?: boolean;
}) {
  const { client, end } = item;
  // SOW dates are real calendar days, so "Xd" is accurate. Operating Model
  // dates are month-precision (anchored to end-of-month for filtering), so
  // a day count would be fake precision — use a month-relative label instead.
  let label: string;
  let tier: UrgencyTier;
  if (source === "sow") {
    const days = Math.max(0, Math.round((end.getTime() - Date.now()) / 86400000));
    label = `${days}d`;
    tier = urgencyFromDays(days);
  } else {
    const today = new Date();
    const monthsAhead =
      (end.getFullYear() - today.getFullYear()) * 12 +
      (end.getMonth() - today.getMonth());
    label =
      monthsAhead <= 0
        ? "this month"
        : monthsAhead === 1
        ? "next month"
        : `in ${monthsAhead} months`;
    tier = urgencyFromMonthsAhead(monthsAhead);
  }
  const style = URGENCY_STYLE[tier];
  return (
    <li>
      <button
        type="button"
        onClick={() => scrollToClient(client.id)}
        title={`Jump to ${client.name}'s card`}
        className={
          "flex w-full items-baseline justify-between gap-2 rounded font-mono text-[11px] transition-colors hover:bg-[#242424] " +
          (dense ? "px-2 py-1" : "px-1.5 py-0.5 -mx-1.5")
        }
      >
        <span
          className="min-w-0 flex-1 truncate text-left text-[#C4BCAA]"
          title={client.name}
        >
          {client.name}
        </span>
        <span
          className="shrink-0 rounded-sm border px-1.5 py-px font-mono text-[10px] font-semibold tabular-nums"
          style={{
            backgroundColor: style.bg,
            color: style.fg,
            borderColor: style.border,
          }}
        >
          {label}
        </span>
      </button>
    </li>
  );
}

// Average closing % across all last-full-Qs that we can compute. Plus a count
// of clients whose last Q closed under 100%.
function RecentQClosesCard({
  rows,
  clients,
}: {
  rows: SummaryRow[];
  clients: Client[];
}) {
  const stats = useMemo(() => {
    const byId = new Map(clients.map((c) => [c.id, c]));
    let withQ = 0;
    let underTarget = 0;
    let pctSum = 0;
    let totalDelivered = 0;
    let totalInvoiced = 0;
    let bestEntry: { id: number; name: string; pct: number } | null = null;
    let worstEntry: { id: number; name: string; pct: number } | null = null;
    for (const r of rows) {
      const q = computeLastFullQ(r);
      if (!q || q.invoiced <= 0) continue;
      withQ += 1;
      const pct = (q.delivered / q.invoiced) * 100;
      pctSum += Math.min(pct, 200);
      totalDelivered += q.delivered;
      totalInvoiced += q.invoiced;
      if (pct < 100) underTarget += 1;
      const name = byId.get(r.id)?.name ?? "—";
      if (!bestEntry || pct > bestEntry.pct) bestEntry = { id: r.id, name, pct };
      if (!worstEntry || pct < worstEntry.pct) worstEntry = { id: r.id, name, pct };
    }
    return {
      withQ,
      underTarget,
      avgPct: withQ > 0 ? Math.round(pctSum / withQ) : null,
      totalDelivered,
      totalInvoiced,
      bestEntry,
      worstEntry,
    };
  }, [rows, clients]);

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
      <CardContent className="flex h-full flex-col pt-0">
        <CardTitleWithTooltip
          label="Last Q Closes"
          body={{
            title: "Last Q Closes",
            bullets: [
              "Avg of delivered ÷ invoiced for each client's last closed Q.",
              "Outliers capped at 200% so one extreme doesn't skew the avg.",
              "Best / Worst are clickable → jump to client.",
            ],
          }}
        />
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
        {stats.bestEntry && stats.worstEntry && (
          <div className="mt-auto space-y-0.5 pt-2">
            <button
              type="button"
              onClick={() => scrollToClient(stats.bestEntry!.id)}
              title={`Jump to ${stats.bestEntry.name}'s card`}
              className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-baseline justify-between gap-2 rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors hover:bg-[#242424]"
            >
              <span className="text-[#606060]">Best</span>
              <span className="min-w-0 flex-1 truncate text-right text-[#C4BCAA]">
                {stats.bestEntry.name}
              </span>
              <span className="shrink-0 tabular-nums text-[#42CA80]">
                {Math.round(stats.bestEntry.pct)}%
              </span>
            </button>
            <button
              type="button"
              onClick={() => scrollToClient(stats.worstEntry!.id)}
              title={`Jump to ${stats.worstEntry.name}'s card`}
              className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-baseline justify-between gap-2 rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors hover:bg-[#242424]"
            >
              <span className="text-[#606060]">Worst</span>
              <span className="min-w-0 flex-1 truncate text-right text-[#C4BCAA]">
                {stats.worstEntry.name}
              </span>
              <span
                className="shrink-0 tabular-nums"
                style={{
                  color: stats.worstEntry.pct < 100 ? "#ED6958" : "#42CA80",
                }}
              >
                {Math.round(stats.worstEntry.pct)}%
              </span>
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PodAttentionCard({
  rows,
  clients,
}: {
  rows: SummaryRow[];
  clients: Client[];
}) {
  // Same lens as Delivery Progress + Most Behind: classify each client by
  // its last full Q closure (under 75% = behind), then surface the pod
  // carrying the most behind clients PLUS the actual behind clients in
  // that pod (Most Behind row format) so the user can drill straight in.
  const { sorted, behindByPod } = useMemo(() => {
    const byId = new Map(clients.map((c) => [c.id, c]));
    const byPod: Record<string, { behind: number; withQ: number; total: number }> = {};
    const behindByPod: Record<string, BehindRowItem[]> = {};
    for (const r of rows) {
      const pod = normalizePod(r.editorial_pod) || "Unassigned";
      const slot = byPod[pod] ?? { behind: 0, withQ: 0, total: 0 };
      slot.total += 1;
      const tier = lastQHealth(r);
      if (tier) {
        slot.withQ += 1;
        if (tier === "behind") {
          slot.behind += 1;
          const lastQ = computeLastFullQ(r);
          const client = byId.get(r.id);
          if (lastQ && client) {
            const v = lastQ.delivered - lastQ.invoiced;
            (behindByPod[pod] ??= []).push({ row: r, v, lastQ, client });
          }
        }
      }
      byPod[pod] = slot;
    }
    // Sort each pod's behind list worst-first (largest negative gap).
    for (const pod of Object.keys(behindByPod)) {
      behindByPod[pod].sort((a, b) => a.v - b.v);
    }
    const sorted = Object.entries(byPod).sort(
      (a, b) => b[1].behind - a[1].behind,
    );
    return { sorted, behindByPod };
  }, [rows, clients]);

  const totalBehind = sorted.reduce((a, [, { behind }]) => a + behind, 0);
  const totalWithQ = sorted.reduce((a, [, { withQ }]) => a + withQ, 0);

  const top = sorted[0];
  if (!top || top[1].behind === 0) {
    return (
      <Card className="h-full border-[#2a2a2a] bg-[#161616]">
        <CardContent className="flex h-full flex-col pt-0">
          <CardTitleWithTooltip
            label="Pod Attention"
            body={{
              title: "Pod Attention",
              bullets: [
                "Behind = client closed last Q under 75%.",
                "Ratio: behind ÷ clients with a closed Q (new ones excluded).",
                "Click pod or row → jump.",
              ],
            }}
          />
          <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
            Distribution of behind clients · last full Q
          </p>
          <p className="mt-1.5 font-mono text-2xl font-bold text-[#42CA80]">
            All clear
          </p>
          <p className="mt-1 font-mono text-[11px] text-[#606060]">
            No pod has clients that closed last Q under 75%
          </p>
          <p className="mt-auto pt-2 font-mono text-[10px] uppercase tracking-wider text-[#606060]">
            {sorted.length} {sorted.length === 1 ? "pod" : "pods"} · {totalWithQ} with closed Q
          </p>
        </CardContent>
      </Card>
    );
  }
  const [topPod, { behind, withQ }] = top;
  const topPodBehind = behindByPod[topPod] ?? [];
  const visibleBehind = topPodBehind.slice(0, 3);
  const overflowBehind = topPodBehind.length - visibleBehind.length;

  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="flex h-full flex-col pt-0">
        <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#C4BCAA]">
          Pod Attention
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          Pod with most BEHIND clients · last full Q
        </p>
        {/* Top pod headline — clickable scrolls to that pod's group */}
        <button
          type="button"
          onClick={() => scrollToPod(topPod)}
          title={`Jump to ${displayPod(topPod, "editorial")} group`}
          className="mt-1.5 -mx-1.5 flex w-[calc(100%+0.75rem)] flex-col items-start gap-0.5 rounded px-1.5 py-0.5 text-left transition-colors hover:bg-[#242424]"
        >
          <span
            className="block truncate font-mono text-lg font-bold text-white"
            title={displayPod(topPod, "editorial")}
          >
            {displayPod(topPod, "editorial")}
          </span>
          <span className="font-mono text-[11px] text-[#ED6958] tabular-nums">
            {behind}/{withQ} behind
          </span>
        </button>

        {/* Behind clients in the top pod — Most Behind row format */}
        {visibleBehind.length > 0 && (
          <ul className="mt-2 space-y-1">
            {visibleBehind.map((item) => (
              <BehindRow key={item.row.id} item={item} />
            ))}
          </ul>
        )}

        {/* Footer row: view-all popovers on the left, red total summary on
            the right. Both popovers are click-to-jump like the per-row
            buttons in Most Behind. */}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {overflowBehind > 0 && (
              <Popover>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[#909090] hover:text-[#C4BCAA]"
                    />
                  }
                >
                  View all {topPodBehind.length}
                  <ChevronRight className="h-3 w-3" />
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="bottom"
                  className="w-[360px] max-w-[90vw] border border-[#2a2a2a] bg-[#0d0d0d] p-0"
                >
                  <div className="border-b border-[#2a2a2a] px-3 py-2">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#C4BCAA]">
                      Behind clients · {displayPod(topPod, "editorial")}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-[#606060]">
                      {topPodBehind.length} clients · click a row to jump to its card
                    </p>
                  </div>
                  <ul className="max-h-[320px] overflow-y-auto p-1">
                    {topPodBehind.map((item) => (
                      <BehindRow key={item.row.id} item={item} dense />
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            )}
            {sorted.length > 1 && (
              <Popover>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[#909090] hover:text-[#C4BCAA]"
                    />
                  }
                >
                  View all {sorted.length} pods
                  <ChevronRight className="h-3 w-3" />
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="bottom"
                  className="w-[320px] max-w-[90vw] border border-[#2a2a2a] bg-[#0d0d0d] p-0"
                >
                  <div className="border-b border-[#2a2a2a] px-3 py-2">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#C4BCAA]">
                      All editorial pods · last full Q
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-[#606060]">
                      {sorted.length} pods · click a row to jump to its group
                    </p>
                  </div>
                  <ul className="max-h-[320px] overflow-y-auto p-1">
                    {sorted.map(([pod, { behind: b, withQ: w, total: t }]) => (
                      <li key={pod}>
                        <button
                          type="button"
                          onClick={() => scrollToPod(pod)}
                          title={`Jump to ${displayPod(pod, "editorial")} group`}
                          className="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left font-mono text-[11px] transition-colors hover:bg-[#161616]"
                        >
                          <span className="min-w-0 flex-1 truncate text-[#C4BCAA]">
                            {displayPod(pod, "editorial")}
                          </span>
                          <span className="shrink-0 tabular-nums">
                            <span className="text-[#ED6958] font-semibold">
                              {b}
                            </span>
                            <span className="text-[#606060]"> / {w}</span>
                            {t > w && (
                              <span className="ml-1 text-[#404040]">
                                ({t - w} no Q)
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            )}
          </div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
            <span className="font-semibold text-[#ED6958]">{totalBehind}</span>
            {" "}of {totalWithQ} behind · {sorted.length}{" "}
            {sorted.length === 1 ? "pod" : "pods"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
