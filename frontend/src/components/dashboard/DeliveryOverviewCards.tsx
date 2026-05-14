"use client";

import React, { useMemo } from "react";
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
}

const cardTransition = { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const };

export function DeliveryOverviewCards({ allClients, filteredClients, rows }: Props) {
  const { axis } = useCurrentPodAxis();
  const scope = useMemo(
    () => detectScope(filteredClients, rows, axis),
    [filteredClients, rows, axis],
  );

  // Each card gets a stable key per scope kind + slot so AnimatePresence can
  // tell which cards are new vs. carried-over across filter swaps.
  const cards = useMemo(() => buildCardsForScope(scope, allClients), [scope, allClients]);

  // Column count tracks card count so a row never has empty slots:
  //   • 5 in single-client scope (status + 4 ratios)
  //   • 3 in pod scope (after Delivery Progress + Most Behind moved to /overview)
  //   • 2 in portfolio scope (after Delivery Progress + Most Behind + Pod Attention moved)
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
    // Pod scope cards mirror the last-Q lens used across the dashboard.
    // Delivery Progress lives on /overview's Triage lens, not here — D1 still
    // surfaces the same per-pod last-Q signal via Last Q Closes + the
    // per-client cards below. Variance is the lifetime delivery vs invoicing
    // balance for the pod.
    return [
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
    ];
  }

  // portfolio (all or multi-pod). "Delivery Progress", "Most Behind" and
  // "Pod Attention" are intentionally absent here — all three live on the
  // Overview dashboard's Triage lens, where exec viewers get the triage
  // signals first. D1 still surfaces the same data via Last Q Closes,
  // Closing in 90d, and the per-client cards below.
  const r = scope.rows;
  const c = scope.clients;
  return [
    { key: "port-closing", node: <ClosingSoonCard clients={c} /> },
    { key: "port-recent-q", node: <RecentQClosesCard rows={r} clients={c} /> },
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

/** Signed variance bucket used by the Overview Triage cards. Over-
 *  delivery is healthy by definition — only *under*-delivery counts
 *  against a client for triage purposes.
 *    v ≥ 0          → healthy ("on target or ahead")
 *    -5 ≤ v < 0     → watch   ("within limit" — small under-delivery)
 *    v < -5         → behind  ("significant under-delivery")
 *  Magnitude-based bucketing (D1's per-period chip color) is a
 *  different concept and intentionally not used here. */
function signedVarianceHealth(v: number): Health {
  if (v >= 0) return "healthy";
  if (v >= -5) return "watch";
  return "behind";
}

/** Per-card variance color, signed. Over-delivery reads as the same
 *  green as on-target — the triage cards reward catch-up. */
function signedVarianceColor(v: number): string {
  if (v >= 0) return "#42CA80";
  if (v >= -5) return "#F5BC4E";
  return "#ED6958";
}

// ─────────────────────────────────────────────────────────────────────────────
// Variable billing-period detection for triage cards. Same data-driven
// grouping as ClientDeliveryCards.tsx: a new period opens when invoiced > 0;
// subsequent zero-invoiced months join it. Supports 1-, 2-, 3- and 5-month
// spans so the triage cards and the Monthly Detail popover agree on what
// "current Q" means even for variable-cadence clients like Webflow.
// ─────────────────────────────────────────────────────────────────────────────
interface SummaryBillingPeriod {
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

function detectSummaryBillingPeriods(row: SummaryRow): SummaryBillingPeriod[] {
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
function isFirstContractQ(row: SummaryRow): boolean {
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
  healthy: "Healthy",
  watch: "Within limit",
  behind: "Behind",
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
  tierItems.behind.sort(
    (a, b) => a.currentQ.projectedVariance - b.currentQ.projectedVariance,
  );
  tierItems.watch.sort(
    (a, b) => a.currentQ.projectedVariance - b.currentQ.projectedVariance,
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
              "Where each client will land vs. invoicing by end of this quarter.",
              "Healthy: on target or ahead · Within limit: behind by ≤ 5 · Behind: below −5.",
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
        >
          {totalInvoiced === 0
            ? "—"
            : totalVariance > 0
              ? `+${totalVariance}`
              : totalVariance.toLocaleString()}
          <span className="ml-1 text-xs text-[#606060] font-normal">
            projected current Q
          </span>
        </p>

        {featured.length === 0 ? (
          <>
            <p className="mt-1.5 font-mono text-2xl font-bold text-[#42CA80]">
              All clear
            </p>
            <p className="mt-1 font-mono text-[11px] text-[#606060]">
              Every scored client is projected to close current Q at ≥ −5
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
function computeCurrentQ(row: SummaryRow): {
  label: string;
  monthsLabel: string;
  delivered: number;
  projectedRemaining: number;
  projectedEnd: number;
  invoiced: number;
  projectedVariance: number;
} | null {
  const periods = detectSummaryBillingPeriods(row);
  if (periods.length === 0) return null;
  const today = new Date();
  const todayCell = today.getFullYear() * 12 + today.getMonth();

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
      for (const m of p.months) {
        if (m.is_future ?? false) projectedRemaining += m.delivered;
      }
      const projectedEnd = cumDelivered + projectedRemaining;
      return {
        label: p.label,
        monthsLabel: p.monthsLabel,
        delivered: cumDelivered,
        projectedRemaining,
        projectedEnd,
        invoiced: cumInvoiced,
        projectedVariance: projectedEnd - cumInvoiced,
      };
    }
  }
  return null;
}


function computeLastFullQ(row: SummaryRow): {
  label: string;
  monthsLabel: string;
  delivered: number;
  invoiced: number;
} | null {
  const periods = detectSummaryBillingPeriods(row);
  if (periods.length === 0) return null;
  const today = new Date();
  const lastCompleted = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastCell = lastCompleted.getFullYear() * 12 + lastCompleted.getMonth();

  let lastFullP: SummaryBillingPeriod | null = null;
  for (const p of periods) {
    if (p.isPrelude) continue;
    if (p.endYear * 12 + (p.endMonth - 1) <= lastCell) lastFullP = p;
  }
  if (!lastFullP) return null;

  let delivered = 0;
  for (const m of lastFullP.months) {
    if (!(m.is_future ?? false)) delivered += m.delivered;
  }
  return { label: lastFullP.label, monthsLabel: lastFullP.monthsLabel, delivered, invoiced: lastFullP.invoicedQ };
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
  //   • allBehind — current Q projected variance < −5 (signed) AND
  //                 NOT a 1st-Q client. Worst-first.
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
      (a, b) => a.currentQ.projectedVariance - b.currentQ.projectedVariance,
    );
    ramping.sort((a, b) => a.client.name.localeCompare(b.client.name));
    return { allBehind: behind, newClients: ramping };
  }, [rows, clients]);

  const list = allBehind.slice(0, 3);
  const overflow = allBehind.length - list.length;
  const projectedGap = allBehind.reduce(
    (acc, x) => acc + x.currentQ.projectedVariance,
    0,
  );

  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="flex h-full flex-col pt-0">
        <CardTitleWithTooltip
          label="Most Behind"
          body={{
            title: "Most Behind",
            bullets: [
              "Clients projected to close > 5 articles behind this quarter.",
              "Each row shows last quarter's close and this quarter's plan.",
              "Over-delivery this quarter cancels earlier deficits.",
              "Click a row to jump to the client.",
            ],
          }}
        />
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          Current Q projected close · per-client contract Q
        </p>
        {list.length === 0 ? (
          <>
            <p className="mt-1.5 font-mono text-2xl font-bold text-[#42CA80]">All clear</p>
            <p className="mt-1 font-mono text-[11px] text-[#606060]">
              Every client&apos;s current Q is projected to close ≥ −5
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
              <span className="text-[#ED6958]">
                {projectedGap > 0
                  ? `+${projectedGap}`
                  : projectedGap.toLocaleString()}
              </span>
              {" "}projected · {allBehind.length} flagged
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
                      title="Clients in their first contract Q — excluded from the Behind list."
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
                      Excluded from Behind triage — ramping in their first
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
                      Most behind · current Q projected close
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
                title="1st contract Q — excluded from Behind triage."
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
        <div className="flex w-full items-baseline justify-between gap-2 text-[10px] text-[#606060]">
          <span className="truncate">
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
          <span className="shrink-0 tabular-nums">
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
  // Same lens as Delivery Progress + Most Behind: classify each client
  // by current-Q projected variance (|v| > 5 = behind), then surface
  // the pod carrying the most behind clients PLUS those clients (Most
  // Behind row format) so the user can drill straight in. Catch-up
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
    // Sort each pod's behind list worst-first (most negative projected
    // variance).
    for (const pod of Object.keys(behindByPod)) {
      behindByPod[pod].sort(
        (a, b) => a.currentQ.projectedVariance - b.currentQ.projectedVariance,
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
                "Pods ranked by how many clients will close > 5 behind this quarter.",
                "Brand-new clients (1st quarter) are kept out — they ramp slowly.",
                "Click a pod or row to jump.",
              ],
            }}
          />
          <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
            Pods ranked by current-Q projected close
          </p>
          <p className="mt-1.5 font-mono text-2xl font-bold text-[#42CA80]">
            All clear
          </p>
          <p className="mt-1 font-mono text-[11px] text-[#606060]">
            Every pod&apos;s clients are projected to close current Q at ≥ −5
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
              "Pods ranked by how many clients will close > 5 behind this quarter.",
              "Brand-new clients (1st quarter) are kept out — they ramp slowly.",
              "Click a pod or row to jump.",
            ],
          }}
        />
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          Pod with most BEHIND clients · cumulative through current Q
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
            {totalNew > 0 && (
              <Popover>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-sm border border-[#8FB5D9]/40 bg-[#8FB5D9]/10 px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-[#8FB5D9] hover:bg-[#8FB5D9]/15"
                      title="Clients in their 1st contract Q across all pods — excluded from Behind triage."
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
                      Excluded from Behind triage.
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
                      Behind clients · {displayPod(topPod, podAxis)}
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
            {" "}of {totalWithQ} behind · {sorted.length}{" "}
            {sorted.length === 1 ? "pod" : "pods"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
