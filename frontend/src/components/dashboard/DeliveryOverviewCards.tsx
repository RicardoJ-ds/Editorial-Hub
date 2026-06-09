"use client";

import React, { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronRight } from "lucide-react";
import {
  CardTitleWithTooltip,
  HEALTH_STYLE,
  POD_HEX_COLORS,
  displayPod,
  elapsedContractPct,
  healthOf,
  pacingColor,
  varianceTier,
  varianceTierColor,
  type Health,
  type HealthInput,
} from "./shared-helpers";
import { ClientStatusCard } from "./FilterContextCard";
import { parseISODateLocal } from "@/lib/utils";
import type { Client, CumulativeMetric } from "@/lib/types";
import { useCurrentPodAxis } from "@/lib/podAxisClient";
import { revealDetailTarget, slugifyPodLabel } from "@/lib/detailTargets";

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

export interface SummaryRow extends HealthInput {
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

// Filter params we propagate when redirecting from /overview into D1, so a
// VP scanning the Overview with filters applied keeps that exact narrowing
// after the click. FilterBar reads each of these on mount and pre-applies
// them. Date range is intentionally excluded (defaults to current ±6 mo on
// D1, which is the most useful starting point on the operational view).
const D1_PROPAGATED_FILTER_KEYS = [
  "search",
  "editorial_pod",
  "growth_pod",
  "status",
] as const;

/** Build a D1 query string that preserves the current page's filter params
 *  (when the call originates from /overview) and overlays any explicit
 *  overrides — e.g. `search={clientName}` for a per-client click, or
 *  `editorial_pod={pod}` for a per-pod click. */
function buildD1QueryString(overrides: Record<string, string | undefined>): string {
  if (typeof window === "undefined") return "";
  const current = new URLSearchParams(window.location.search);
  const out = new URLSearchParams();
  for (const key of D1_PROPAGATED_FILTER_KEYS) {
    const v = current.get(key);
    if (v) out.set(key, v);
  }
  // D1 deep links always land on Deliverables vs SOW since that's where the
  // per-client cards + pod groups live.
  out.set("tab", "deliverables-sow");
  for (const [k, v] of Object.entries(overrides)) {
    if (v) out.set(k, v);
  }
  return out.toString();
}

// Scroll to the per-client card in the "Client Delivery At a Glance" section
// below. Each row in the Most Behind / Closing in 90D cards is wired to call
// this so the user can drill from a triage signal into the full client card.
// `scroll-mt-[180px]` on the target accounts for the sticky filter band + h2.
//
// Route-aware: the same cards mount on /overview where these targets don't
// exist. In that case, navigate the user to D1 with the right hash + filter
// params so the section scrolls into view after the page renders, with the
// Overview's filters preserved (and the clicked client pre-applied to the
// search box when `clientName` is provided).
type DetailSection = "client-delivery" | "cumulative-pipeline";

function scrollToClientDetail(
  section: DetailSection,
  clientId: number,
  clientName?: string,
) {
  const targetId = `${section}-${clientId}`;
  if (revealDetailTarget(targetId, "ring")) return;
  if (typeof window !== "undefined") {
    const q = buildD1QueryString({ search: clientName });
    window.location.assign(`/editorial-clients?${q}#${targetId}`);
  }
}

function scrollToPodDetail(
  section: DetailSection,
  pod: string,
  podAxis: "editorial" | "growth",
) {
  const slug = slugifyPodLabel(pod);
  const targetId = `${section}-pod-${slug}`;
  if (revealDetailTarget(targetId, "outline")) return;
  if (typeof window !== "undefined") {
    const podFilterKey = podAxis === "growth" ? "growth_pod" : "editorial_pod";
    const q = buildD1QueryString({ [podFilterKey]: pod });
    window.location.assign(`/editorial-clients?${q}#${targetId}`);
  }
}

function scrollToClient(clientId: number, clientName?: string) {
  scrollToClientDetail("client-delivery", clientId, clientName);
}

function scrollToPod(pod: string, podAxis: "editorial" | "growth") {
  scrollToPodDetail("client-delivery", pod, podAxis);
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
  podAxis: "editorial" | "growth",
): Scope {
  if (filteredClients.length === 1) {
    const client = filteredClients[0];
    const row = rows.find((r) => r.id === client.id) ?? null;
    return { kind: "client", client, row };
  }
  // Detect "single pod scope" against whichever pod axis is active. The
  // user's toggle (or pod lock) is the source of truth.
  const pods = new Set(
    filteredClients.map((c) => normalizePod(podAxis === "growth" ? c.growth_pod : c.editorial_pod)),
  );
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
  /** Cumulative pipeline metrics — drives the %Published numbers on the
   *  per-pod lifetime card. Falls back to %SOW-only when empty. */
  cumulative?: CumulativeMetric[];
}

const cardTransition = { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const };

export function DeliveryOverviewCards({ allClients, filteredClients, rows, cumulative = [] }: Props) {
  const { axis } = useCurrentPodAxis();
  const scope = useMemo(
    () => detectScope(filteredClients, rows, axis),
    [filteredClients, rows, axis],
  );

  // Each card gets a stable key per scope kind + slot so AnimatePresence can
  // tell which cards are new vs. carried-over across filter swaps.
  const cards = useMemo(
    () => buildCardsForScope(scope, allClients, axis, cumulative),
    [scope, allClients, axis, cumulative],
  );

  // Column count tracks card count so a row never has empty slots:
  //   • 5 in single-client scope (status + 4 ratios)
  //   • 2 in pod scope (Delivery Progress + Closing in 90d)
  //   • 2 in portfolio scope (Delivery Progress + Closing in 90d)
  const lgCols =
    cards.length >= 5
      ? "lg:grid-cols-5"
      : cards.length === 4
      ? "lg:grid-cols-4"
      : cards.length === 3
      ? "lg:grid-cols-3"
      : "lg:grid-cols-2";

  return (
    <motion.div
      layout
      transition={cardTransition}
      className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${lgCols}`}
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
            className="h-full"
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
  axis: "editorial" | "growth",
  cumulative: CumulativeMetric[],
): { key: string; node: React.ReactNode }[] {
  if (scope.kind === "client") {
    const c = scope.client;
    const r = scope.row;
    const eClient = elapsedContractPct(c.start_date, {
      endDate: c.end_date,
      termMonths: c.term_months,
    });
    // Single-client lineup, left → right:
    //   1. Client Status        — pod, contract window, days remaining
    //   2. Delivery Progress    — current-Q variance triage for this one client
    //   3. Delivered ÷ Invoiced — lifetime ratio
    //   4. Invoiced ÷ SOW       — lifetime ratio
    //   5. Time Remaining       — contract elapsed
    // Last Full Q was removed — the Delivery Progress card already surfaces
    // last Q's close in the same row, so it was redundant.
    return [
      { key: "client-status", node: <ClientStatusCard client={c} /> },
      {
        key: "client-progress",
        node: r ? (
          <DeliveryMixCard
            rows={[r]}
            clients={[c]}
            subtitle={c.name}
          />
        ) : null,
      },
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
        key: "client-time",
        node: <ContractTimingCard client={c} />,
      },
    ].filter((c) => c.node != null) as { key: string; node: React.ReactNode }[];
  }

  if (scope.kind === "pod") {
    const podRows = scope.rows;
    const podClients = scope.clients;
    // Pod scope: same two-card top row, but both cards now show per-pod
    // breakdowns sourced from the same data Pod Snapshot uses on
    // /overview. With a single-pod filter active, both cards collapse
    // to a single row inside the card (since the pod scope is exactly
    // one pod). Headlines + chips inherit the existing card aesthetic.
    return [
      {
        key: "pod-delivery-progress",
        node: (
          <PodDeliveryProgressCard
            rows={podRows}
            clients={podClients}
            axis={axis}
          />
        ),
      },
      {
        key: "pod-lifetime",
        node: (
          <PodLifetimeProgressCard
            rows={podRows}
            clients={podClients}
            cumulative={cumulative}
            axis={axis}
          />
        ),
      },
    ];
  }

  // portfolio (all or multi-pod). Same two-card pattern as pod scope,
  // but rows aggregate across every pod in view. Most Behind / Pod
  // Attention still live exclusively on /overview.
  const r = scope.rows;
  const c = scope.clients;
  return [
    {
      key: "port-delivery-progress",
      node: <PodDeliveryProgressCard rows={r} clients={c} axis={axis} />,
    },
    {
      key: "port-lifetime",
      node: (
        <PodLifetimeProgressCard
          rows={r}
          clients={c}
          cumulative={cumulative}
          axis={axis}
        />
      ),
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-pod card pair — 0.3.17 redesign for Delivery Overview's top row.
//
// Left card: PodDeliveryProgressCard
//   One row per pod showing aggregated Current Q delivered / invoiced
//   + projected end-of-Q variance chip. Sourced from `computeCurrentQ()`
//   (same math the Pod Snapshot section on /overview uses) but with a
//   compact list-style visual that fits the existing Card aesthetic on
//   Editorial Clients — NOT a copy of the Pod Snapshot grid.
//
// Right card: PodLifetimeProgressCard
//   One row per pod with two mini-bars: %SOW (lifetime delivered ÷
//   contracted SOW) and %Published (published_live ÷ SOW). Cumulative
//   metrics flow in from the page-level fetch; when missing the
//   %Published bar falls back to "—".
// ─────────────────────────────────────────────────────────────────────────────

interface PodAggCurrentQ {
  pod: string;
  clientCount: number;
  delivered: number;        // Q delivered through last completed month
  invoiced: number;         // cumulative invoiced through end-of-Q
  projectedEnd: number;     // projected end-of-Q delivered
  variance: number;         // projectedEnd − invoiced
  scoredCount: number;      // clients with a real Current Q (skips 1st Q + null Q)
  newCount: number;         // 1st-Q clients in this pod (excluded from variance)
}

function aggregateCurrentQByPod(
  rows: SummaryRow[],
  clients: Client[],
  axis: "editorial" | "growth",
): PodAggCurrentQ[] {
  const podByClientId = new Map<number, string>();
  for (const c of clients) {
    const raw = axis === "growth" ? c.growth_pod : c.editorial_pod;
    podByClientId.set(c.id, normalizePod(raw) || "Unassigned");
  }
  const byPod = new Map<string, PodAggCurrentQ>();
  for (const r of rows) {
    const pod = podByClientId.get(r.id) ?? "Unassigned";
    let agg = byPod.get(pod);
    if (!agg) {
      agg = {
        pod,
        clientCount: 0,
        delivered: 0,
        invoiced: 0,
        projectedEnd: 0,
        variance: 0,
        scoredCount: 0,
        newCount: 0,
      };
      byPod.set(pod, agg);
    }
    agg.clientCount += 1;
    const q = computeCurrentQ(r);
    // Skip clients with no Current Q data (no billing periods detected
    // OR pre-contract-start); the pod row still counts them in
    // clientCount so the "(N)" label is honest. Earlier this branch
    // did `return []` which dropped the entire card whenever one
    // client lacked a Q — that's why a single multi-pod view read 0
    // variance + "No Current Q data" even though most pods had Q
    // numbers.
    if (!q) continue;
    if (q.invoiced <= 0) continue;
    const tier = clientCurrentQTier(r);
    if (tier === null) continue;
    if (tier === "new") {
      agg.newCount += 1;
      continue;
    }
    agg.scoredCount += 1;
    agg.delivered += q.delivered;
    agg.invoiced += q.invoiced;
    agg.projectedEnd += q.projectedEnd;
  }
  for (const agg of byPod.values()) {
    agg.variance = agg.projectedEnd - agg.invoiced;
  }
  return Array.from(byPod.values()).sort((a, b) =>
    sortPodKeyLocal(a.pod, b.pod),
  );
}

function sortPodKeyLocal(a: string, b: string): number {
  // "Pod 1" → 1, "Pod 2" → 2, "Unassigned" → 999
  const numA = parseInt(a.replace(/[^0-9]/g, ""), 10);
  const numB = parseInt(b.replace(/[^0-9]/g, ""), 10);
  const safeA = isNaN(numA) ? 999 : numA;
  const safeB = isNaN(numB) ? 999 : numB;
  return safeA - safeB;
}

/** Compact variance row used by both pod cards. Generic over "label"
 *  (pod name or client name) so the same shape covers portfolio
 *  per-pod rollups AND single-pod per-client breakdowns.
 *
 *  Layout (left → right):
 *    [● dot] [label · count]            ← 11rem column with pod dot
 *    [progress bar + del/inv numbers]   ← flexes to fill
 *    [tier chip: variance + label]      ← bordered block on the right,
 *                                          mirrors Pod Snapshot's
 *                                          End-of-Q Variance tile */
function CurrentQRow({
  label,
  countSuffix,
  accentColor,
  delivered,
  invoiced,
  variance,
}: {
  label: string;
  countSuffix?: string;
  /** Hex color shown as a dot before the label. Used for pod rows
   *  (POD_HEX_COLORS lookup); omitted for per-client rows where it
   *  defaults to a neutral grey. */
  accentColor?: string;
  delivered: number;
  invoiced: number;
  variance: number;
}) {
  const pct = invoiced > 0 ? Math.min(100, (delivered / invoiced) * 100) : 0;
  const tierInfo = varianceTier(variance);
  const color = tierInfo.color;
  const tierLabel = tierInfo.label;
  const dotColor = accentColor ?? "#606060";
  return (
    <div className="grid grid-cols-[minmax(9rem,12rem)_minmax(0,1fr)_auto] items-center gap-3 py-1.5 transition-colors hover:bg-[#1a1a1a]/40">
      {/* Pod / client label with colored dot */}
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: dotColor }}
        />
        <span
          className="font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA] break-words leading-tight"
          title={label}
        >
          {label}
          {countSuffix && (
            <span className="ml-1 font-normal text-[#606060]">{countSuffix}</span>
          )}
        </span>
      </div>
      {/* Progress bar + del/inv readout */}
      <div className="min-w-0 space-y-0.5">
        <div className="h-1 overflow-hidden rounded-full bg-[#1f1f1f]">
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
        <div className="flex items-baseline justify-between font-mono text-[10px] tabular-nums leading-none">
          <span>
            <span className="text-[#C4BCAA]">{delivered}</span>
            <span className="text-[#606060]">{" del · "}</span>
            <span className="text-[#C4BCAA]">{invoiced}</span>
            <span className="text-[#606060]">{" inv"}</span>
          </span>
          <span className="text-[#606060]">{Math.round(pct)}%</span>
        </div>
      </div>
      {/* Tier chip — bordered block mirroring Pod Snapshot's End-of-Q
          Variance tile. Two lines: "END-OF-Q <variance>" on top,
          tier label below. Wider + shorter than the previous 3-line
          stack — fits the available horizontal space better. */}
      <div
        className="inline-flex flex-col items-center justify-center rounded-md border px-2.5 py-1 leading-tight tabular-nums"
        style={{
          color,
          borderColor: `${color}55`,
          backgroundColor: `${color}10`,
        }}
      >
        <span className="font-mono text-[10px] uppercase tracking-wider whitespace-nowrap">
          <span className="text-[#909090]">End-of-Q</span>{" "}
          <span className="font-bold">
            {variance > 0 ? "+" : ""}
            {variance}
          </span>
        </span>
        <span className="font-mono text-[9px] uppercase tracking-wider whitespace-nowrap">
          {tierLabel}
        </span>
      </div>
    </div>
  );
}

export function PodDeliveryProgressCard({
  rows,
  clients,
  axis,
}: {
  rows: SummaryRow[];
  clients: Client[];
  axis: "editorial" | "growth";
}) {
  const podAggs = useMemo(
    () => aggregateCurrentQByPod(rows, clients, axis),
    [rows, clients, axis],
  );
  const totalVariance = podAggs.reduce((s, p) => s + p.variance, 0);
  const totalInvoiced = podAggs.reduce((s, p) => s + p.invoiced, 0);
  const headlineColor =
    totalInvoiced === 0 ? "#909090" : signedVarianceColor(totalVariance);
  const totalScored = podAggs.reduce((s, p) => s + p.scoredCount, 0);
  const totalNew = podAggs.reduce((s, p) => s + p.newCount, 0);

  // Single-pod scope = only one pod in the input. Switch to a
  // per-client breakdown — the per-pod summary is redundant when
  // there's only one pod (it just collapses to a one-row list).
  const isSinglePod = podAggs.length === 1;
  const perClient = useMemo(() => {
    if (!isSinglePod) return [];
    const byId = new Map(clients.map((c) => [c.id, c]));
    const result: Array<{
      name: string;
      delivered: number;
      invoiced: number;
      variance: number;
      isNew: boolean;
      tierOrder: number; // for sorting: behind=0 watch=1 healthy=2 new=3
    }> = [];
    for (const r of rows) {
      const c = byId.get(r.id);
      if (!c) continue;
      const q = computeCurrentQ(r);
      if (!q) continue;
      if (q.invoiced <= 0) continue;
      const tier = clientCurrentQTier(r);
      if (tier === null) continue;
      const isNew = tier === "new";
      const variance = q.projectedEnd - q.invoiced;
      const tierOrder =
        tier === "behind" ? 0 : tier === "watch" ? 1 : tier === "new" ? 3 : 2;
      result.push({
        name: c.name,
        delivered: q.delivered,
        invoiced: q.invoiced,
        variance: isNew ? 0 : variance,
        isNew,
        tierOrder,
      });
    }
    return result.sort(
      (a, b) =>
        a.tierOrder - b.tierOrder ||
        a.variance - b.variance ||
        a.name.localeCompare(b.name),
    );
  }, [isSinglePod, rows, clients]);

  const subtitle = isSinglePod
    ? `Per-client end-of-Q variance · ${podAggs[0].clientCount} client${podAggs[0].clientCount === 1 ? "" : "s"} in this pod`
    : `Projected end-of-Q variance · ${totalScored} scored client${totalScored === 1 ? "" : "s"}${totalNew > 0 ? ` · ${totalNew} new (1st Q) excluded` : ""}`;

  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="flex h-full flex-col pt-0">
        <CardTitleWithTooltip
          label="Projected Q Variance"
          body={{
            title: "Projected Q Variance",
            bullets: [
              isSinglePod
                ? "Per-client Current Q delivered vs invoiced for this pod."
                : "Per-pod aggregated Current Q delivered vs invoiced.",
              "Variance = projected end-of-Q delivered − invoiced.",
              "1st-Q clients excluded from variance; counted separately.",
            ],
          }}
        />
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">{subtitle}</p>
        <p
          className="mt-1.5 font-mono text-2xl font-bold tabular-nums leading-none"
          style={{ color: headlineColor }}
        >
          {totalVariance > 0 ? "+" : ""}
          {totalVariance}
        </p>

        <div className="mt-3 space-y-0.5 divide-y divide-[#1a1a1a]">
          {isSinglePod ? (
            perClient.length === 0 ? (
              <p className="font-mono text-[10px] text-[#606060]">
                No Current Q data for any client in this pod.
              </p>
            ) : (
              perClient.map((c) => (
                <CurrentQRow
                  key={c.name}
                  label={c.name}
                  countSuffix={c.isNew ? "1ST Q" : undefined}
                  delivered={c.delivered}
                  invoiced={c.invoiced}
                  variance={c.variance}
                />
              ))
            )
          ) : podAggs.length === 0 ? (
            <p className="font-mono text-[10px] text-[#606060]">No Current Q data.</p>
          ) : (
            podAggs.map((agg) => (
              <CurrentQRow
                key={agg.pod}
                label={displayPod(agg.pod, axis)}
                countSuffix={`(${agg.clientCount})`}
                accentColor={POD_HEX_COLORS[agg.pod]}
                delivered={agg.delivered}
                invoiced={agg.invoiced}
                variance={agg.variance}
              />
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface LifetimeRow {
  label: string;
  /** Optional client count suffix shown next to the label (pod rows
   *  only). Omitted for per-client rows. */
  countSuffix?: string;
  /** Hex color for the leading dot — pod hex on pod rows, undefined
   *  on per-client rows (falls back to neutral grey). */
  accentColor?: string;
  delivered: number;
  sow: number;
  published: number;
  hasPublished: boolean;
}

function LifetimeProgressRow({ row }: { row: LifetimeRow }) {
  const pctSow = row.sow > 0 ? Math.min(100, (row.delivered / row.sow) * 100) : 0;
  const pctPub = row.sow > 0 ? Math.min(100, (row.published / row.sow) * 100) : 0;
  const dotColor = row.accentColor ?? "#606060";
  return (
    <div className="grid grid-cols-[minmax(9rem,12rem)_1fr_1fr] items-center gap-3 py-1.5 transition-colors hover:bg-[#1a1a1a]/40">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: dotColor }}
        />
        <span
          className="font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA] break-words leading-tight"
          title={row.label}
        >
          {row.label}
          {row.countSuffix && (
            <span className="ml-1 font-normal text-[#606060]">{row.countSuffix}</span>
          )}
        </span>
      </div>
      {/* %SOW — bar with the percentage rendered to the right so the
          big number is readable at a glance instead of buried under
          the bar. */}
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-[9px] uppercase tracking-wider text-[#606060]">
            SOW
          </span>
          <span className="font-mono text-[11px] font-semibold tabular-nums text-[#C4BCAA]">
            {Math.round(pctSow)}%
          </span>
        </div>
        <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-[#1f1f1f]">
          <div
            className="h-full rounded-full bg-[#42CA80] transition-[width] duration-300"
            style={{ width: `${pctSow}%` }}
          />
        </div>
        <p className="mt-0.5 font-mono text-[9px] tabular-nums leading-none text-[#606060]">
          {row.delivered.toLocaleString()} / {row.sow.toLocaleString()}
        </p>
      </div>
      {/* %Published — same shape; falls back to muted "—" when no
          cumulative_metrics row covers this client. */}
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-[9px] uppercase tracking-wider text-[#606060]">
            Published
          </span>
          {row.hasPublished ? (
            <span className="font-mono text-[11px] font-semibold tabular-nums text-[#C4BCAA]">
              {Math.round(pctPub)}%
            </span>
          ) : (
            <span className="font-mono text-[11px] text-[#404040]">—</span>
          )}
        </div>
        <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-[#1f1f1f]">
          <div
            className="h-full rounded-full bg-[#DDCFAC] transition-[width] duration-300"
            style={{ width: `${row.hasPublished ? pctPub : 0}%` }}
          />
        </div>
        <p className="mt-0.5 font-mono text-[9px] tabular-nums leading-none text-[#606060]">
          {row.hasPublished
            ? `${row.published.toLocaleString()} / ${row.sow.toLocaleString()}`
            : "no published count"}
        </p>
      </div>
    </div>
  );
}

export function PodLifetimeProgressCard({
  rows,
  clients,
  cumulative,
  axis,
}: {
  rows: SummaryRow[];
  clients: Client[];
  cumulative: CumulativeMetric[];
  axis: "editorial" | "growth";
}) {
  // Per-pod aggregates of lifetime delivered, SOW, and published.
  // Pulls cumulative metrics for published_live; falls back to "—"
  // when no cumulative row exists for a client.
  const podRows = useMemo<Array<LifetimeRow & { pod: string }>>(() => {
    const podByClientId = new Map<number, string>();
    const sowByClientId = new Map<number, number>();
    const clientNameById = new Map<number, string>();
    for (const c of clients) {
      const raw = axis === "growth" ? c.growth_pod : c.editorial_pod;
      podByClientId.set(c.id, normalizePod(raw) || "Unassigned");
      const sowRaw = (c as unknown as { articles_sow?: number | null }).articles_sow;
      sowByClientId.set(c.id, typeof sowRaw === "number" ? sowRaw : 0);
      clientNameById.set(c.id, c.name);
    }
    const publishedByClient = new Map<string, number>();
    for (const m of cumulative) {
      const v = (m as unknown as { published_live?: number | null }).published_live;
      if (typeof v === "number") publishedByClient.set(m.client_name, v);
    }
    type Agg = {
      pod: string;
      clientCount: number;
      delivered: number;
      sow: number;
      published: number;
      hasPublished: boolean;
    };
    const byPod = new Map<string, Agg>();
    for (const r of rows) {
      const pod = podByClientId.get(r.id) ?? "Unassigned";
      let agg = byPod.get(pod);
      if (!agg) {
        agg = { pod, clientCount: 0, delivered: 0, sow: 0, published: 0, hasPublished: false };
        byPod.set(pod, agg);
      }
      agg.clientCount += 1;
      agg.delivered += r.articles_delivered ?? 0;
      agg.sow += sowByClientId.get(r.id) ?? 0;
      const name = clientNameById.get(r.id);
      if (name) {
        const pub = publishedByClient.get(name);
        if (typeof pub === "number") {
          agg.published += pub;
          agg.hasPublished = true;
        }
      }
    }
    return Array.from(byPod.values())
      .sort((a, b) => sortPodKeyLocal(a.pod, b.pod))
      .map((a) => ({
        pod: a.pod,
        label: displayPod(a.pod, axis),
        countSuffix: `(${a.clientCount})`,
        accentColor: POD_HEX_COLORS[a.pod],
        delivered: a.delivered,
        sow: a.sow,
        published: a.published,
        hasPublished: a.hasPublished,
      }));
  }, [rows, clients, cumulative, axis]);

  // Single-pod scope = render per-client breakdown for that pod.
  const isSinglePod = podRows.length === 1;
  const perClientRows = useMemo<LifetimeRow[]>(() => {
    if (!isSinglePod) return [];
    const sowByClientId = new Map<number, number>();
    const nameById = new Map<number, string>();
    for (const c of clients) {
      const sowRaw = (c as unknown as { articles_sow?: number | null }).articles_sow;
      sowByClientId.set(c.id, typeof sowRaw === "number" ? sowRaw : 0);
      nameById.set(c.id, c.name);
    }
    const pubByName = new Map<string, number>();
    for (const m of cumulative) {
      const v = (m as unknown as { published_live?: number | null }).published_live;
      if (typeof v === "number") pubByName.set(m.client_name, v);
    }
    const out: LifetimeRow[] = [];
    for (const r of rows) {
      const name = nameById.get(r.id);
      if (!name) continue;
      const sow = sowByClientId.get(r.id) ?? 0;
      const pub = pubByName.get(name);
      out.push({
        label: name,
        delivered: r.articles_delivered ?? 0,
        sow,
        published: typeof pub === "number" ? pub : 0,
        hasPublished: typeof pub === "number",
      });
    }
    return out.sort((a, b) => {
      // Behind on %SOW first → ascending pct
      const aPct = a.sow > 0 ? a.delivered / a.sow : 1;
      const bPct = b.sow > 0 ? b.delivered / b.sow : 1;
      return aPct - bPct;
    });
  }, [isSinglePod, rows, clients, cumulative]);

  // Headline = portfolio %SOW (delivered ÷ total SOW).
  const totalDelivered = podRows.reduce((s, p) => s + p.delivered, 0);
  const totalSow = podRows.reduce((s, p) => s + p.sow, 0);
  const portfolioPctSow = totalSow > 0 ? (totalDelivered / totalSow) * 100 : 0;
  const totalPublished = podRows.reduce((s, p) => s + p.published, 0);
  const portfolioPctPub = totalSow > 0 ? (totalPublished / totalSow) * 100 : 0;
  const anyHasPub = podRows.some((p) => p.hasPublished);

  const subtitle = isSinglePod
    ? `Lifetime %SOW + %Published · per client in this pod`
    : `Lifetime %SOW + %Published · per pod`;

  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="flex h-full flex-col pt-0">
        <CardTitleWithTooltip
          label="Pod Progress"
          body={{
            title: "Pod Progress",
            bullets: [
              "%SOW = lifetime delivered ÷ contracted SOW.",
              "%Published = articles published live ÷ contracted SOW.",
              isSinglePod
                ? "Per-client breakdown when one pod is in scope."
                : "Per-pod breakdown rolls up across the in-scope clients.",
            ],
          }}
        />
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">{subtitle}</p>
        <div className="mt-1.5 flex items-baseline gap-3 font-mono tabular-nums">
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold leading-none text-white">
              {Math.round(portfolioPctSow)}%
            </span>
            <span className="text-[9px] uppercase tracking-wider text-[#606060]">SOW</span>
          </div>
          {anyHasPub && (
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-bold leading-none text-[#C4BCAA]">
                {Math.round(portfolioPctPub)}%
              </span>
              <span className="text-[9px] uppercase tracking-wider text-[#606060]">Published</span>
            </div>
          )}
        </div>
        <div className="mt-3 space-y-0.5 divide-y divide-[#1a1a1a]">
          {isSinglePod ? (
            perClientRows.length === 0 ? (
              <p className="font-mono text-[10px] text-[#606060]">No lifetime data.</p>
            ) : (
              perClientRows.map((row) => (
                <LifetimeProgressRow key={row.label} row={row} />
              ))
            )
          ) : podRows.length === 0 ? (
            <p className="font-mono text-[10px] text-[#606060]">No lifetime data.</p>
          ) : (
            podRows.map((row) => (
              <LifetimeProgressRow key={row.pod} row={row} />
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
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

/** Signed variance bucket used by the Overview Triage cards. SYMMETRIC and
 *  magnitude-based: a client far AHEAD of contracted invoicing needs attention
 *  just like one far behind (over-delivered work isn't billed yet).
 *    v = 0          → healthy ("on track")
 *    1 ≤ |v| ≤ 5    → watch   ("within limit", either direction)
 *    |v| > 5        → behind  ("off target" — surfaced for attention either way)
 *  NB: the "behind" key name is historical; it now means off-target in EITHER
 *  direction. It drives the Needs Attention + Pod Attention selection. */
function signedVarianceHealth(v: number): Health {
  // Derive from the canonical classifier so triage counts can never drift
  // from the per-row tier colors. Only called for non-1st-Q clients
  // (clientCurrentQTier short-circuits "new" first), so ahead|behind both
  // fold into the off-target "behind" bucket.
  const key = varianceTier(v).key;
  if (key === "onTrack") return "healthy";
  if (key === "withinLimit") return "watch";
  return "behind";
}

/** Per-card variance color, signed — the canonical symmetric classifier
 *  (0 green · ±1–5 amber · beyond ±5 red, behind OR ahead). */
function signedVarianceColor(v: number): string {
  return varianceTierColor(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// Variable billing-period detection for triage cards. Same data-driven
// grouping as ClientDeliveryCards.tsx: a new period opens when invoiced > 0;
// subsequent zero-invoiced months join it. Supports 1-, 2-, 3- and 5-month
// spans so the triage cards and the Monthly Detail popover agree on what
// "current Q" means even for variable-cadence clients like Webflow.
// ─────────────────────────────────────────────────────────────────────────────
export interface SummaryBillingPeriod {
  qIdx: number;
  label: string;
  monthsLabel: string;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  months: Array<{ year: number; month: number; delivered: number; invoiced: number; is_future?: boolean }>;
  invoicedQ: number;
  isPrelude: boolean;
}

const TRIAGE_MS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function detectSummaryBillingPeriods(row: SummaryRow): SummaryBillingPeriod[] {
  const monthly = row.monthly_breakdown ?? [];
  if (monthly.length === 0) return [];
  const sorted = [...monthly].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month,
  );
  const start = parseISODateLocal(row.start_date);
  const startYear = start ? start.getFullYear() : null;
  const startMonth = start ? start.getMonth() + 1 : null;

  type Raw = Omit<SummaryBillingPeriod, "qIdx" | "label" | "monthsLabel">;
  const raw: Raw[] = [];
  let cur: Raw | null = null;
  let prelude: Raw | null = null;
  for (const r of sorted) {
    if (r.invoiced > 0) {
      if (prelude) { raw.push(prelude); prelude = null; }
      if (cur) raw.push(cur);
      cur = { startYear: r.year, startMonth: r.month, endYear: r.year, endMonth: r.month, months: [r], invoicedQ: r.invoiced, isPrelude: false };
    } else if (cur) {
      cur.endYear = r.year; cur.endMonth = r.month; cur.months.push(r);
    } else if (prelude) {
      prelude.endYear = r.year; prelude.endMonth = r.month; prelude.months.push(r);
    } else {
      prelude = { startYear: r.year, startMonth: r.month, endYear: r.year, endMonth: r.month, months: [r], invoicedQ: 0, isPrelude: true };
    }
  }
  if (cur) raw.push(cur);
  if (prelude) raw.push(prelude);

  let prevYearIdx = -1;
  let qInYear = 0;
  return raw.map((p, idx) => {
    let label = "";
    if (!p.isPrelude) {
      if (startYear != null && startMonth != null) {
        const mi = (p.startYear - startYear) * 12 + (p.startMonth - startMonth) + 1;
        const yearIdx = mi >= 1 ? Math.floor((mi - 1) / 12) : 0;
        if (yearIdx !== prevYearIdx) { qInYear = 0; prevYearIdx = yearIdx; }
        qInYear += 1;
        label = yearIdx === 0 ? `Q${qInYear}` : `Q${qInYear} Y${yearIdx + 1}`;
      } else {
        qInYear += 1;
        label = `Q${qInYear}`;
      }
    }
    const sStr = `${TRIAGE_MS[p.startMonth]} ${String(p.startYear).slice(-2)}`;
    const eStr = `${TRIAGE_MS[p.endMonth]} ${String(p.endYear).slice(-2)}`;
    let monthsLabel: string;
    if (p.startYear === p.endYear && p.startMonth === p.endMonth) {
      monthsLabel = sStr;
    } else if (p.startYear === p.endYear) {
      monthsLabel = `${TRIAGE_MS[p.startMonth]}–${TRIAGE_MS[p.endMonth]} ${String(p.endYear).slice(-2)}`;
    } else {
      monthsLabel = `${sStr}–${eStr}`;
    }
    return { ...p, qIdx: idx, label, monthsLabel };
  });
}

/** True when the client's current contract Q is their FIRST (Q1).
 *  Brand-new clients always read "behind" against contracted invoicing
 *  because they haven't had time to ramp — surfacing them as a separate
 *  "New (1st Q)" tier keeps the Behind list honest. */
export function isFirstContractQ(row: SummaryRow): boolean {
  const periods = detectSummaryBillingPeriods(row);
  const today = new Date();
  const todayCell = today.getFullYear() * 12 + today.getMonth();
  for (const p of periods) {
    if (p.isPrelude) continue;
    const startCell = p.startYear * 12 + (p.startMonth - 1);
    const endCell = p.endYear * 12 + (p.endMonth - 1);
    if (startCell <= todayCell && todayCell <= endCell) return p.label === "Q1";
  }
  return false;
}

/** Four-way tier for Overview Triage classification. `new` is the
 *  1st-contract-Q escape hatch — those clients sit outside the
 *  healthy / watch / behind buckets and surface in a dedicated row. */
type CurrentQTier = "healthy" | "watch" | "behind" | "new";

const CURRENT_Q_TIER_ORDER: CurrentQTier[] = [
  "behind",
  "watch",
  "healthy",
  "new",
];

const CURRENT_Q_TIER_LABEL: Record<CurrentQTier, string> = {
  healthy: "On track",
  watch: "Within limit",
  behind: "Off target",
  new: "New (1st Q)",
};

const CURRENT_Q_TIER_COLOR: Record<CurrentQTier, string> = {
  healthy: "#42CA80",
  watch: "#F5BC4E",
  behind: "#ED6958",
  new: "#8FB5D9", // S8 from Graphite DS — distinct from triage greens/ambers/reds.
};

/** Classify a client by current-Q projected close, with the 1st-Q
 *  escape hatch applied. Returns null when the client doesn't have an
 *  in-progress Q yet (no current Q at all). */
function clientCurrentQTier(row: SummaryRow): CurrentQTier | null {
  const q = computeCurrentQ(row);
  if (!q || q.invoiced <= 0) return null;
  if (isFirstContractQ(row)) return "new";
  return signedVarianceHealth(q.projectedVariance);
}

export function DeliveryMixCard({
  rows,
  clients,
  subtitle,
}: {
  rows: SummaryRow[];
  clients: Client[];
  subtitle: string;
}) {
  const counts: Record<CurrentQTier, number> = {
    behind: 0,
    watch: 0,
    healthy: 0,
    new: 0,
  };
  const byId = new Map(clients.map((c) => [c.id, c]));
  const tierItems: Record<CurrentQTier, BehindRowItem[]> = {
    behind: [],
    watch: [],
    healthy: [],
    new: [],
  };
  let withQ = 0;
  let noQ = 0;
  let totalProjectedEnd = 0;
  let totalInvoiced = 0;
  for (const r of rows) {
    const currentQ = computeCurrentQ(r);
    if (!currentQ || currentQ.invoiced <= 0) {
      noQ += 1;
      continue;
    }
    const tier = clientCurrentQTier(r);
    if (tier === null) {
      noQ += 1;
      continue;
    }
    const client = byId.get(r.id);
    if (!client) continue;
    withQ += 1;
    counts[tier] += 1;
    const lastQ = computeLastFullQ(r);
    tierItems[tier].push({ row: r, lastQ, currentQ, client });
    if (tier !== "new") {
      totalProjectedEnd += currentQ.projectedEnd;
      totalInvoiced += currentQ.invoiced;
    }
  }
  // Off-target ("behind") + within-limit ("watch") now span both directions —
  // sort by magnitude so the worst offenders (ahead OR behind) lead.
  tierItems.behind.sort(
    (a, b) =>
      Math.abs(b.currentQ.projectedVariance) -
      Math.abs(a.currentQ.projectedVariance),
  );
  tierItems.watch.sort(
    (a, b) =>
      Math.abs(b.currentQ.projectedVariance) -
      Math.abs(a.currentQ.projectedVariance),
  );
  tierItems.healthy.sort(
    (a, b) => b.currentQ.projectedVariance - a.currentQ.projectedVariance,
  );
  tierItems.new.sort((a, b) => a.client.name.localeCompare(b.client.name));
  const totalVariance = totalProjectedEnd - totalInvoiced;
  const headlineColor =
    totalInvoiced === 0
      ? "#909090"
      : signedVarianceColor(totalVariance);
  const scoredCount = withQ - counts.new;
  const featured = [
    ...tierItems.behind,
    ...tierItems.watch,
    ...tierItems.new,
    ...tierItems.healthy,
  ].slice(0, 3);
  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="flex h-full flex-col pt-0">
        <CardTitleWithTooltip
          label="Delivery Progress"
          body={{
            title: "Delivery Progress",
            bullets: [
              "Headline = sum of (delivered − invoiced) projected through end of current Q across all scored clients.",
              "On track: variance = 0 · Within limit: ±1–5 · Off target: beyond ±5 (behind or ahead).",
              "Over-delivery this quarter cancels earlier deficits.",
              "Click a client row to jump to Client Delivery At a Glance.",
            ],
          }}
        />
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          {subtitle}
          {withQ > 0
            ? ` · ${scoredCount} scored${counts.new > 0 ? ` · ${counts.new} new (1st Q)` : ""}`
            : ""}
        </p>
        <p
          className="mt-1.5 font-mono text-2xl font-bold tabular-nums"
          style={{ color: headlineColor }}
          title="Projected end-of-current-Q variance (delivered − invoiced), summed across scored clients."
        >
          {totalInvoiced === 0
            ? "—"
            : totalVariance > 0
              ? `+${totalVariance}`
              : totalVariance.toLocaleString()}
          <span className="ml-1 text-xs text-[#606060] font-normal">
            projected variance · end of current Q
          </span>
        </p>

        {featured.length === 0 ? (
          <>
            <p className="mt-1.5 font-mono text-2xl font-bold text-[#42CA80]">
              All clear
            </p>
            <p className="mt-1 font-mono text-[11px] text-[#606060]">
              Every scored client&apos;s projected end-of-Q variance is within ±5
            </p>
          </>
        ) : (
          <ul className="mt-2 space-y-1">
            {featured.map((item) => (
              <BehindRow
                key={`mix-${item.row.id}`}
                item={item}
                tone={clientCurrentQTier(item.row) === "new" ? "new" : "default"}
              />
            ))}
          </ul>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
            <span className="text-[#909090]">
              {totalProjectedEnd.toLocaleString()}
            </span>
            <span> / </span>
            <span>{totalInvoiced.toLocaleString()}</span>
            <span className="ml-1 uppercase tracking-wider">
              projected · invoiced
            </span>
            {noQ > 0 && (
              <span className="ml-2 uppercase tracking-wider">
                · {noQ} no current Q
              </span>
            )}
          </span>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {CURRENT_Q_TIER_ORDER.filter((tier) => counts[tier] > 0).map((tier) => (
              <DeliveryMixTierPopover
                key={`mix-popover-${tier}`}
                tier={tier}
                items={tierItems[tier]}
                count={counts[tier]}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DeliveryMixTierPopover({
  tier,
  items,
  count,
}: {
  tier: CurrentQTier;
  items: BehindRowItem[];
  count: number;
}) {
  const color = CURRENT_Q_TIER_COLOR[tier];
  const label = CURRENT_Q_TIER_LABEL[tier];

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider transition-colors hover:text-[#C4BCAA]"
            style={{ color }}
            title={`${label} · ${count} client${count === 1 ? "" : "s"}`}
          />
        }
      >
        {label} {count}
        <ChevronRight className="h-3 w-3" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-[440px] max-w-[92vw] border border-[#2a2a2a] bg-[#0d0d0d] p-0"
      >
        <div className="border-b border-[#2a2a2a] px-3 py-2">
          <p
            className="font-mono text-[11px] font-semibold uppercase tracking-wider"
            style={{ color }}
          >
            {label}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-[#606060]">
            {items.length} client{items.length === 1 ? "" : "s"} · click a row to jump to Client Delivery
          </p>
        </div>
        <ul className="max-h-[360px] overflow-y-auto p-2 space-y-2">
          {items.map((item) => (
            <BehindRow
              key={`${tier}-${item.row.id}`}
              item={item}
              dense
              tone={tier === "new" ? "new" : "default"}
            />
          ))}
        </ul>
      </PopoverContent>
    </Popover>
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
    const periods = detectSummaryBillingPeriods(row);
    const today = new Date();
    const lastCompleted = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastCell = lastCompleted.getFullYear() * 12 + lastCompleted.getMonth();
    // Find the period BEFORE the last full Q.
    let lastFullIdx = -1;
    for (let i = 0; i < periods.length; i++) {
      const p = periods[i];
      if (p.isPrelude) continue;
      if (p.endYear * 12 + (p.endMonth - 1) <= lastCell) lastFullIdx = i;
    }
    if (lastFullIdx < 1) return { last, prior: null as null | { pct: number; label: string } };
    // Find the prior non-prelude period.
    let priorP: SummaryBillingPeriod | null = null;
    for (let i = lastFullIdx - 1; i >= 0; i--) {
      if (!periods[i].isPrelude) { priorP = periods[i]; break; }
    }
    if (!priorP || priorP.invoicedQ <= 0) return { last, prior: null };
    let pDelivered = 0;
    for (const m of priorP.months) {
      if (!(m.is_future ?? false)) pDelivered += m.delivered;
    }
    return {
      last,
      prior: { pct: Math.round((pDelivered / priorP.invoicedQ) * 100), label: priorP.label },
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
                "Delivered ÷ invoiced for the last closed quarter.",
                "Each client's own quarter, anchored to their start date.",
                "Hidden until at least one quarter has closed.",
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
              "Delivered ÷ invoiced for the last closed quarter.",
              "Each client's own quarter, anchored to their start date.",
              "Shows Δ vs. the prior quarter when available.",
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

/** Current in-progress contract Q for a client. Numbers are cumulative
 *  through end of the current Q so catch-up over-delivery nets against
 *  earlier-Q misses — matches the spreadsheet's Variance row. Uses
 *  data-driven billing period detection (same as Monthly Detail popover)
 *  instead of fixed 3-month calendar quarters. */
export function computeCurrentQ(row: SummaryRow): {
  label: string;
  monthsLabel: string;
  delivered: number;
  projectedRemaining: number;
  projectedEnd: number;
  invoiced: number;
  projectedVariance: number;
  /** 1-based position of today's calendar month within the current Q
   *  period. Used to compute pacing (actual progress vs expected). */
  monthInQ: number;
  /** Total months in the current Q period. */
  qLength: number;
} | null {
  const periods = detectSummaryBillingPeriods(row);
  if (periods.length === 0) return null;
  const today = new Date();
  const todayY = today.getFullYear();
  const todayM = today.getMonth() + 1;
  const todayCell = todayY * 12 + (todayM - 1);

  let cumDelivered = 0;
  let cumInvoiced = 0;
  for (const p of periods) {
    cumInvoiced += p.invoicedQ;
    for (const m of p.months) {
      if (!(m.is_future ?? false)) cumDelivered += m.delivered;
    }
    if (p.isPrelude) continue;
    const startCell = p.startYear * 12 + (p.startMonth - 1);
    const endCell = p.endYear * 12 + (p.endMonth - 1);
    if (startCell <= todayCell && todayCell <= endCell) {
      let projectedRemaining = 0;
      let monthInQ = 0;
      for (let i = 0; i < p.months.length; i++) {
        const m = p.months[i];
        if (m.is_future ?? false) projectedRemaining += m.delivered;
        if (m.year === todayY && m.month === todayM) monthInQ = i + 1;
      }
      // Fall back to "last completed-or-current month within this Q" if
      // today isn't itself in the month list (shouldn't happen but
      // guards against off-by-one).
      if (monthInQ === 0) monthInQ = Math.max(1, todayCell - startCell + 1);
      const projectedEnd = cumDelivered + projectedRemaining;
      return {
        label: p.label,
        monthsLabel: p.monthsLabel,
        delivered: cumDelivered,
        projectedRemaining,
        projectedEnd,
        invoiced: cumInvoiced,
        projectedVariance: projectedEnd - cumInvoiced,
        monthInQ,
        qLength: p.months.length,
      };
    }
  }
  return null;
}


export function computeLastFullQ(row: SummaryRow): {
  label: string;
  monthsLabel: string;
  /** Articles delivered DURING the last full Q (just that period). */
  delivered: number;
  /** Invoicing target FOR the last full Q (just that period). */
  invoiced: number;
  /** Cumulative actuals from contract start through end of last full Q.
   *  Matches the spreadsheet's per-Q "Variance" math — over-delivery in
   *  earlier Qs nets against later under-delivery, so this is the right
   *  number to anchor any UI that talks about progress "as of end of
   *  last Q". */
  cumDelivered: number;
  /** Cumulative invoicing target from contract start through end of last
   *  full Q. */
  cumInvoiced: number;
  /** Cumulative variance = cumDelivered − cumInvoiced. */
  cumVariance: number;
  /** True when the last full Q was THE FIRST contract Q (label "Q1").
   *  Same semantics as `isFirstContractQ` for the current Q — surfaces
   *  brand-new clients whose ramp-up quarter just closed so the variance
   *  card can show a "1st Q" tier instead of "Behind Plan". */
  isFirstQ: boolean;
} | null {
  const periods = detectSummaryBillingPeriods(row);
  if (periods.length === 0) return null;
  const today = new Date();
  const lastCompleted = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastCell = lastCompleted.getFullYear() * 12 + lastCompleted.getMonth();

  let lastFullP: SummaryBillingPeriod | null = null;
  let cumDelivered = 0;
  let cumInvoiced = 0;
  // Cumulative totals frozen at end of the last full period.
  let cumDeliveredAtLastFull = 0;
  let cumInvoicedAtLastFull = 0;
  for (const p of periods) {
    // Accumulate every period (including preludes) for the cumulative
    // totals — invoicing might be 0 in a prelude but delivered counts.
    for (const m of p.months) {
      if (!(m.is_future ?? false)) cumDelivered += m.delivered;
    }
    cumInvoiced += p.invoicedQ;
    if (p.isPrelude) continue;
    if (p.endYear * 12 + (p.endMonth - 1) <= lastCell) {
      lastFullP = p;
      cumDeliveredAtLastFull = cumDelivered;
      cumInvoicedAtLastFull = cumInvoiced;
    }
  }
  if (!lastFullP) return null;

  let delivered = 0;
  for (const m of lastFullP.months) {
    if (!(m.is_future ?? false)) delivered += m.delivered;
  }
  return {
    label: lastFullP.label,
    monthsLabel: lastFullP.monthsLabel,
    delivered,
    invoiced: lastFullP.invoicedQ,
    cumDelivered: cumDeliveredAtLastFull,
    cumInvoiced: cumInvoicedAtLastFull,
    cumVariance: cumDeliveredAtLastFull - cumInvoicedAtLastFull,
    isFirstQ: lastFullP.label === "Q1",
  };
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

/** Top clients flagged for attention based on current-Q PROJECTED variance.
 *  A client is "behind" when its current Q is projected to close > 5 articles
 *  off-target (magnitude — matches D1). Each row shows both:
 *    • Last Q's actual close (delivered/invoiced + variance)
 *    • Current Q's projected close (projectedEnd/invoiced + variance)
 *  so the operator can see whether catch-up plans are already in flight. */
export function MostBehindCard({
  rows,
  clients,
}: {
  rows: SummaryRow[];
  clients: Client[];
}) {
  // Two buckets:
  //   • allBehind — current Q projected variance MORE than ±5 off target
  //                 (behind OR ahead) AND NOT a 1st-Q client. Worst-first
  //                 by magnitude, so the biggest miss in either direction
  //                 leads regardless of sign.
  //   • newClients — clients in their first contract Q (separate tier
  //                  per spec; surfaced in the popover so the operator
  //                  can drill in but they don't pollute the headline).
  const { allBehind, newClients } = useMemo(() => {
    const byId = new Map(clients.map((c) => [c.id, c]));
    const behind: BehindRowItem[] = [];
    const ramping: BehindRowItem[] = [];
    for (const r of rows) {
      const currentQ = computeCurrentQ(r);
      if (!currentQ || currentQ.invoiced <= 0) continue;
      const tier = clientCurrentQTier(r);
      if (tier !== "behind" && tier !== "new") continue;
      const lastQ = computeLastFullQ(r);
      const client = byId.get(r.id);
      if (!client) continue;
      const item: BehindRowItem = { row: r, lastQ, currentQ, client };
      if (tier === "new") ramping.push(item);
      else behind.push(item);
    }
    behind.sort(
      (a, b) =>
        Math.abs(b.currentQ.projectedVariance) -
        Math.abs(a.currentQ.projectedVariance),
    );
    ramping.sort((a, b) => a.client.name.localeCompare(b.client.name));
    return { allBehind: behind, newClients: ramping };
  }, [rows, clients]);

  const list = allBehind.slice(0, 3);
  const overflow = allBehind.length - list.length;
  // Worst single miss by magnitude (signed) — a netted sum would cancel
  // ahead against behind and read falsely calm, so we surface the extreme.
  const worstMiss = allBehind.reduce(
    (acc, x) =>
      Math.abs(x.currentQ.projectedVariance) > Math.abs(acc)
        ? x.currentQ.projectedVariance
        : acc,
    0,
  );

  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="flex h-full flex-col pt-0">
        <CardTitleWithTooltip
          label="Needs Attention"
          body={{
            title: "Needs Attention",
            bullets: [
              "Clients projected to close current Q more than ±5 off target — behind OR ahead.",
              "Each row shows last quarter's close and this quarter's plan.",
              "Over-delivery this quarter cancels earlier deficits.",
              "Click a row to jump to the client.",
            ],
          }}
        />
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          Projected end-of-current-Q variance · per-client contract Q
        </p>
        {list.length === 0 ? (
          <>
            <p className="mt-1.5 font-mono text-2xl font-bold text-[#42CA80]">All clear</p>
            <p className="mt-1 font-mono text-[11px] text-[#606060]">
              Every client&apos;s projected end-of-Q variance is within ±5
            </p>
          </>
        ) : (
          <>
            <ul className="mt-1.5 space-y-1">
              {list.map((item) => (
                <BehindRow key={item.row.id} item={item} />
              ))}
            </ul>
          </>
        )}
        <div
          className={
            "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 " +
            (list.length === 0 ? "mt-auto pt-2" : "mt-auto pt-2")
          }
        >
          {list.length > 0 ? (
            <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
              <span className="text-[#ED6958]">{allBehind.length} flagged</span>
              {" "}· worst{" "}
              {worstMiss > 0 ? `+${worstMiss}` : worstMiss.toLocaleString()}
            </span>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            {newClients.length > 0 && (
              <Popover>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-sm border border-[#8FB5D9]/40 bg-[#8FB5D9]/10 px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-[#8FB5D9] hover:bg-[#8FB5D9]/15"
                      title="Clients in their first contract Q — excepted from the attention list."
                    />
                  }
                >
                  {newClients.length} new (1st Q)
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  side="bottom"
                  className="w-[420px] max-w-[90vw] border border-[#2a2a2a] bg-[#0d0d0d] p-0"
                >
                  <div className="border-b border-[#2a2a2a] px-3 py-2">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#8FB5D9]">
                      New clients · 1st contract Q
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-[#606060]">
                      Excepted from attention triage — ramping in their first
                      Q, contracted invoicing not yet meaningful.
                    </p>
                  </div>
                  <ul className="max-h-[360px] overflow-y-auto p-1">
                    {newClients.map((item) => (
                      <BehindRow key={item.row.id} item={item} dense tone="new" />
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            )}
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
                  align="end"
                  side="bottom"
                  className="w-[420px] max-w-[90vw] border border-[#2a2a2a] bg-[#0d0d0d] p-0"
                >
                  <div className="border-b border-[#2a2a2a] px-3 py-2">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#C4BCAA]">
                      Needs attention · projected end-of-current-Q variance
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-[#606060]">
                      {allBehind.length} clients · click a row to jump
                    </p>
                  </div>
                  <ul className="max-h-[360px] overflow-y-auto p-1">
                    {allBehind.map((item) => (
                      <BehindRow key={item.row.id} item={item} dense />
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface BehindRowItem {
  row: SummaryRow;
  lastQ: { label: string; monthsLabel: string; delivered: number; invoiced: number } | null;
  currentQ: {
    label: string;
    monthsLabel: string;
    delivered: number;
    projectedRemaining: number;
    projectedEnd: number;
    invoiced: number;
    projectedVariance: number;
  };
  client: Client;
}

function BehindRow({
  item,
  dense = false,
  tone = "default",
}: {
  item: BehindRowItem;
  dense?: boolean;
  /** "new" tints the current-Q variance chip blue so 1st-Q rows in the
   *  New popover read as a separate category rather than triage. */
  tone?: "default" | "new";
}) {
  const { row, lastQ, currentQ, client } = item;
  const lastQVar = lastQ ? lastQ.delivered - lastQ.invoiced : null;
  const fmtVar = (v: number) => (v > 0 ? `+${v}` : v.toLocaleString());
  const currentChipColor =
    tone === "new"
      ? CURRENT_Q_TIER_COLOR.new
      : signedVarianceColor(currentQ.projectedVariance);
  return (
    <li>
      <button
        type="button"
        onClick={() => scrollToClient(row.id, client.name)}
        title={`Jump to ${client.name}'s card`}
        className={
          // Hover bg is lighter than both the card surface (#161616) and the
          // popover surface (#0d0d0d) so the hover state reads on either.
          "flex w-full flex-col gap-0.5 rounded font-mono transition-colors hover:bg-[#242424] " +
          (dense ? "px-2 py-1.5" : "px-1.5 py-1 -mx-1.5")
        }
      >
        <div className="flex w-full items-baseline justify-between gap-2 text-[12px]">
          <span className="min-w-0 flex-1 truncate text-left text-white" title={client.name}>
            {client.name}
            {tone === "new" && (
              <span
                className="ml-1.5 rounded-sm border border-[#8FB5D9]/40 bg-[#8FB5D9]/10 px-1 py-px font-mono text-[9px] uppercase tracking-wider"
                style={{ color: CURRENT_Q_TIER_COLOR.new }}
                title="1st contract Q — excepted from attention triage."
              >
                1st Q
              </span>
            )}
          </span>
          <span
            className="shrink-0 font-semibold tabular-nums"
            style={{ color: currentChipColor }}
            title={`Current Q projected variance (cumulative through end of Q): ${fmtVar(currentQ.projectedVariance)}`}
          >
            {fmtVar(currentQ.projectedVariance)}
          </span>
        </div>
        {/* Second line — auto-wraps when the card is narrow (e.g. inside the
            single-client 5-column lineup). At full width: Last Q on the left,
            Current Q on the right, one line. When the row can't fit both, the
            two halves stack onto their own lines (each justified to start). */}
        <div className="flex w-full flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[10px] text-[#606060]">
          <span className="min-w-0">
            {lastQ ? (
              <>
                <span className="text-[#909090]">Last Q</span>{" "}
                <span className="text-[#909090]">
                  {lastQ.label} · {lastQ.monthsLabel}
                </span>{" "}
                <span className="tabular-nums">
                  {lastQ.delivered}/{lastQ.invoiced}
                </span>{" "}
                {lastQVar !== null && (
                  <span
                    className="tabular-nums"
                    style={{
                      color:
                        lastQVar >= 0 ? "#909090" : signedVarianceColor(lastQVar),
                    }}
                  >
                    ({fmtVar(lastQVar)})
                  </span>
                )}
              </>
            ) : (
              <span className="text-[#606060]">No closed Q yet</span>
            )}
          </span>
          <span className="tabular-nums">
            <span className="text-[#909090]">Current Q</span>{" "}
            <span>
              {currentQ.label} · {currentQ.monthsLabel}
            </span>{" "}
            <span>
              {currentQ.projectedEnd}/{currentQ.invoiced}
            </span>
          </span>
        </div>
      </button>
    </li>
  );
}

export function ClosingSoonCard({ clients }: { clients: Client[] }) {
  // End-date source = Operating Model `operating_model_end_date` (last month
  // with non-zero production projection). The earlier SOW/Ops toggle was
  // removed — operators consistently want the projected close, not the
  // contract close, since the SOW is often stale on renewals/silent churn.
  // The SOW/Ops divergence audit lives at /admin/data-quality if needed.
  const closing = useMemo(() => {
    const today = new Date();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 90);
    return clients
      .map((c) => {
        const parsed = parseISODateLocal(c.operating_model_end_date);
        if (!parsed) return null;
        // Operating Model dates are month-precision (anchored to day 1 of the
        // last projected month). A client whose ops_end is "Apr 2026" closes
        // some time during April, so for cutoff comparisons we treat it as
        // end-of-month — otherwise a client closing this month would already
        // appear "past" by the second day of the month and drop off the list.
        const end = new Date(parsed.getFullYear(), parsed.getMonth() + 1, 0);
        if (end < today) return null;
        if (end > cutoff) return null;
        return { client: c, end };
      })
      .filter((x): x is { client: Client; end: Date } => x !== null)
      .sort((a, b) => a.end.getTime() - b.end.getTime());
  }, [clients]);

  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="flex h-full flex-col pt-0">
        <div className="min-w-0">
          <CardTitleWithTooltip
            label="Closing in 90d"
            body={{
              title: "Closing in 90d",
              bullets: [
                "Contracts ending within the next 90 days.",
                "End date taken from each client's projected last month.",
                "Cross-check vs. SOW lives at Admin · Data Quality.",
              ],
            }}
          />
          <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
            By Operating Model last projected month
          </p>
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
                <ClosingRow key={item.client.id} item={item} />
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
                      Closing in 90d · Operating Model
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-[#606060]">
                      {closing.length} clients · click a row to jump to its card
                    </p>
                  </div>
                  <ul className="max-h-[320px] overflow-y-auto p-1">
                    {closing.map((item) => (
                      <ClosingRow key={item.client.id} item={item} dense />
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

// Urgency tiers — closer = heavier weight. Months-ahead → tier so "this
// month" reads as the most pressing. Palette (Graphite DS): P3 (dark green)
// → P2 (lighter green) → WN1 (cream). Imminent gets the heaviest swatch so
// it reads as "weight on the calendar" rather than "red emergency"; later
// closes fade to cream as informational.
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

function urgencyFromMonthsAhead(m: number): UrgencyTier {
  if (m <= 0) return "imminent";
  if (m === 1) return "soon";
  return "later";
}

function ClosingRow({
  item,
  dense = false,
}: {
  item: { client: Client; end: Date };
  dense?: boolean;
}) {
  const { client, end } = item;
  // Operating Model dates are month-precision (anchored to end-of-month for
  // filtering), so a day count would be fake precision — use a month-relative
  // label instead.
  const today = new Date();
  const monthsAhead =
    (end.getFullYear() - today.getFullYear()) * 12 +
    (end.getMonth() - today.getMonth());
  const label =
    monthsAhead <= 0
      ? "this month"
      : monthsAhead === 1
      ? "next month"
      : `in ${monthsAhead} months`;
  const tier = urgencyFromMonthsAhead(monthsAhead);
  const style = URGENCY_STYLE[tier];
  return (
    <li>
      <button
        type="button"
        onClick={() => scrollToClient(client.id, client.name)}
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
              "Average closing % across each client's last closed quarter.",
              "Extreme values capped at 200% so one outlier doesn't skew the average.",
              "Click Best / Worst to jump to that client.",
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
              onClick={() => scrollToClient(stats.bestEntry!.id, stats.bestEntry!.name)}
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
              onClick={() => scrollToClient(stats.worstEntry!.id, stats.worstEntry!.name)}
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

export function PodAttentionCard({
  rows,
  clients,
}: {
  rows: SummaryRow[];
  clients: Client[];
}) {
  // Same lens as Delivery Progress + Needs Attention: classify each client
  // by current-Q projected variance (|v| > 5 off target = "behind" bucket,
  // EITHER direction), then surface the pod carrying the most off-target
  // clients PLUS those clients so the user can drill straight in. Catch-up
  // baked into projections is honored — a pod with last-Q misses that
  // are projected to recover this Q reads "all clear".
  const { axis: podAxis } = useCurrentPodAxis();
  const { sorted, behindByPod, newByPod } = useMemo(() => {
    const byId = new Map(clients.map((c) => [c.id, c]));
    const byPod: Record<
      string,
      { behind: number; withQ: number; total: number; newCount: number }
    > = {};
    const behindByPod: Record<string, BehindRowItem[]> = {};
    const newByPod: Record<string, BehindRowItem[]> = {};
    for (const r of rows) {
      // Prefer the axis-relevant pod from the live `clients` list. Falls
      // back to the row's hardcoded `editorial_pod` for rows whose client
      // has been filtered out.
      const client = byId.get(r.id);
      const rawPod = client
        ? (podAxis === "growth" ? client.growth_pod : client.editorial_pod)
        : r.editorial_pod;
      const pod = normalizePod(rawPod) || "Unassigned";
      const slot =
        byPod[pod] ?? { behind: 0, withQ: 0, total: 0, newCount: 0 };
      slot.total += 1;
      const tier = clientCurrentQTier(r);
      if (tier !== null) {
        slot.withQ += 1;
        const currentQ = computeCurrentQ(r);
        const lastQ = computeLastFullQ(r);
        if (tier === "behind" && currentQ && client) {
          slot.behind += 1;
          (behindByPod[pod] ??= []).push({
            row: r,
            lastQ,
            currentQ,
            client,
          });
        } else if (tier === "new" && currentQ && client) {
          slot.newCount += 1;
          (newByPod[pod] ??= []).push({
            row: r,
            lastQ,
            currentQ,
            client,
          });
        }
      }
      byPod[pod] = slot;
    }
    // Sort each pod's off-target list worst-first by MAGNITUDE so the
    // biggest miss (ahead or behind) leads.
    for (const pod of Object.keys(behindByPod)) {
      behindByPod[pod].sort(
        (a, b) =>
          Math.abs(b.currentQ.projectedVariance) -
          Math.abs(a.currentQ.projectedVariance),
      );
    }
    for (const pod of Object.keys(newByPod)) {
      newByPod[pod].sort((a, b) => a.client.name.localeCompare(b.client.name));
    }
    const sorted = Object.entries(byPod).sort(
      (a, b) => b[1].behind - a[1].behind,
    );
    return { sorted, behindByPod, newByPod };
  }, [rows, clients, podAxis]);

  const totalBehind = sorted.reduce((a, [, { behind }]) => a + behind, 0);
  const totalWithQ = sorted.reduce((a, [, { withQ }]) => a + withQ, 0);
  const totalNew = sorted.reduce((a, [, { newCount }]) => a + newCount, 0);

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
                "Pods ranked by how many clients are projected more than ±5 off target — behind or ahead.",
                "Variance = delivered − invoiced through end of current Q.",
                "Brand-new clients (1st quarter) are kept out — they ramp slowly.",
                "Click a pod or row to jump.",
              ],
            }}
          />
          <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
            Pods ranked by projected end-of-current-Q variance
          </p>
          <p className="mt-1.5 font-mono text-2xl font-bold text-[#42CA80]">
            All clear
          </p>
          <p className="mt-1 font-mono text-[11px] text-[#606060]">
            Every pod&apos;s clients have projected end-of-Q variance within ±5
          </p>
          <p className="mt-auto pt-2 font-mono text-[10px] uppercase tracking-wider text-[#606060]">
            {sorted.length} {sorted.length === 1 ? "pod" : "pods"} · {totalWithQ} with current Q
            {totalNew > 0 && (
              <span className="ml-2 text-[#8FB5D9]">· {totalNew} new (1st Q)</span>
            )}
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
        <CardTitleWithTooltip
          label="Pod Attention"
          body={{
            title: "Pod Attention",
            bullets: [
              "Pods ranked by how many clients will close more than ±5 off target — behind or ahead.",
              "Brand-new clients (1st quarter) are kept out — they ramp slowly.",
              "Click a pod or row to jump.",
            ],
          }}
        />
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          Pod with most off-target clients · projected end-of-current-Q variance
        </p>
        {/* Top pod headline — clickable scrolls to that pod's group */}
        <button
          type="button"
          onClick={() => scrollToPod(topPod, podAxis)}
          title={`Jump to ${displayPod(topPod, podAxis)} group`}
          className="mt-1.5 -mx-1.5 flex w-[calc(100%+0.75rem)] flex-col items-start gap-0.5 rounded px-1.5 py-0.5 text-left transition-colors hover:bg-[#242424]"
        >
          <span
            className="block truncate font-mono text-lg font-bold text-white"
            title={displayPod(topPod, podAxis)}
          >
            {displayPod(topPod, podAxis)}
          </span>
          <span className="font-mono text-[11px] text-[#ED6958] tabular-nums">
            {behind}/{withQ} off target
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
            {totalNew > 0 && (
              <Popover>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-sm border border-[#8FB5D9]/40 bg-[#8FB5D9]/10 px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-[#8FB5D9] hover:bg-[#8FB5D9]/15"
                      title="Clients in their 1st contract Q across all pods — excepted from attention triage."
                    />
                  }
                >
                  {totalNew} new (1st Q)
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="bottom"
                  className="w-[420px] max-w-[90vw] border border-[#2a2a2a] bg-[#0d0d0d] p-0"
                >
                  <div className="border-b border-[#2a2a2a] px-3 py-2">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#8FB5D9]">
                      New clients · 1st contract Q
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-[#606060]">
                      Grouped by {podAxis === "growth" ? "growth" : "editorial"} pod.
                      Excepted from attention triage.
                    </p>
                  </div>
                  <ul className="max-h-[360px] overflow-y-auto p-1">
                    {Object.entries(newByPod)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .flatMap(([pod, items]) =>
                        items.map((item) => (
                          <BehindRow
                            key={`${pod}-${item.row.id}`}
                            item={item}
                            dense
                            tone="new"
                          />
                        )),
                      )}
                  </ul>
                </PopoverContent>
              </Popover>
            )}
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
                      Off-target clients · {displayPod(topPod, podAxis)}
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
                      All {podAxis === "growth" ? "growth" : "editorial"} pods · last full Q
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
                          onClick={() => scrollToPod(pod, podAxis)}
                          title={`Jump to ${displayPod(pod, podAxis)} group`}
                          className="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left font-mono text-[11px] transition-colors hover:bg-[#161616]"
                        >
                          <span className="min-w-0 flex-1 truncate text-[#C4BCAA]">
                            {displayPod(pod, podAxis)}
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
            {" "}of {totalWithQ} off target · {sorted.length}{" "}
            {sorted.length === 1 ? "pod" : "pods"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
