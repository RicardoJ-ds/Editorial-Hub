"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type {
  Client,
  ClientProductionRow,
  CumulativeMetric,
  GoalsVsDeliveryRow,
} from "@/lib/types";
import {
  computeCurrentQ,
  computeLastFullQ,
  isFirstContractQ,
  type SummaryRow,
} from "@/components/dashboard/DeliveryOverviewCards";
import {
  ClientDetailPopover,
  type DetailState,
} from "@/components/dashboard/ClientDetailPopover";
import {
  contentTypeRatio,
  displayPod,
  MILESTONE_NUM_BY_FIELD,
  TooltipBody,
  varianceTier,
  varianceSubline,
} from "@/components/dashboard/shared-helpers";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  normalizePod,
  sortPodKey,
} from "@/components/dashboard/ContractClientProgress";
import { useCurrentPodAxis } from "@/lib/podAxisClient";
import { TimeToTrendChart } from "@/components/dashboard/TimeToMetrics";
import { trackEvent } from "@/lib/analyticsClient";
import {
  useEditorialAsOf,
  useLastClosedEditorialMonth,
} from "@/lib/editorialWeeksClient";

// ─────────────────────────────────────────────────────────────────────────────
// Period Snapshot — top of /overview.
//
// One section, two columns:
//   • Pod Delivery Progress (left)  — period goals-vs-delivery per pod + the
//     canonical projected end-of-Q variance chip. Click pod → inline per-client
//     breakdown.
//   • Pod Time-to-Metrics (right)   — 8 milestone-transition averages per pod.
//     Click pod → inline per-client values. (Not period-scoped: milestone dates
//     don't repeat — the badge informs scope on the left card only.)
//
// Period control is section-local: 1m (default) / 3m / 6m / Custom. Custom
// reads the FilterBar's `dateRange` so a VP who's already filtered the page
// gets the same window here.
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_NAMES_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

type LocalPeriodKey = "current" | "1m" | "3m" | "6m" | "12m" | "all";

/** A client whose contract has ended — no in-progress quarter / current month. */
function isInactiveStatus(status: string | undefined): boolean {
  return status === "COMPLETED" || status === "CANCELLED" || status === "INACTIVE";
}

/** Latest editorial-month cell (year*12 + month-1) that carries DELIVERED
 *  goals data for the given clients, or null. Zero-only placeholder / future
 *  projection rows (common after a contract closes) are skipped — we anchor on
 *  real delivery, so the Goals "Last month" lands on a month with numbers. */
function latestDeliveredGoalCell(
  goals: GoalsVsDeliveryRow[],
  names: Set<string>,
): number | null {
  let latest: number | null = null;
  for (const r of goals) {
    if (!names.has(r.client_name)) continue;
    const delivered = (r.cb_delivered_to_date ?? 0) + (r.ad_delivered_to_date ?? 0);
    if (delivered <= 0) continue;
    const ym = parseMonthYear(r.month_year);
    if (!ym) continue;
    const cell = ym.year * 12 + (ym.month - 1);
    if (latest === null || cell > latest) latest = cell;
  }
  return latest;
}

interface PeriodScope {
  /** Inclusive list of months in the window, oldest first. */
  months: { year: number; month: number }[];
  /** "April 2026" / "Feb – Apr 2026" / etc. */
  label: string;
  /** "Last completed month" / "Last 3 months" / etc. */
  caption: string;
}

interface Props {
  clients: Client[];
  filteredClients: Client[];
  summaries: SummaryRow[];
  goals: GoalsVsDeliveryRow[];
  /** Per-client monthly actual + projected from the Operating Model. Drives
   *  the projected bars in the %SOW popover trend chart. */
  clientProduction: ClientProductionRow[];
  /** Cumulative pipeline metrics — used to compute %Published per client
   *  (published_live ÷ SOW). One row per client; client_name is the key
   *  back to filteredClients[].name. */
  cumulative: CumulativeMetric[];
}

/** Pod Snapshot section — Pod Delivery Progress only. The milestone /
 *  time-to-metric cards live in PodPaceSection below this in the page. */
export function PeriodSnapshotSection({
  filteredClients,
  summaries,
  goals,
  clientProduction,
  cumulative,
}: Props) {
  const { axis: podAxis } = useCurrentPodAxis();

  // Last CLOSED Editorial month (grace-aware) → month-cell used to anchor the
  // Goals column so it flips on the same day as the "As of" badge (2 days after
  // the month's Tuesday close), not on the calendar-month boundary. null until
  // the weeks load → resolveLocalPeriod falls back to the calendar month−1.
  const lastClosedEditorial = useLastClosedEditorialMonth();
  const lastCompletedEditorialCell = lastClosedEditorial
    ? lastClosedEditorial.year * 12 + (lastClosedEditorial.month - 1)
    : null;

  // Pod Snapshot is INTENTIONALLY independent of the global FilterBar
  // dateRange. Only the Goals column is period-scoped, and the user picks
  // that scope via the dropdown next to the column headers.
  const [goalsPeriod, setGoalsPeriod] = useState<LocalPeriodKey>("1m");
  const clientNamesInScope = useMemo(
    () => new Set(filteredClients.map((c) => c.name)),
    [filteredClients],
  );
  // When EVERY in-scope client is inactive, the Goals column anchors to their
  // last delivered month and the "Current month" option is dropped — both keyed
  // off contract status so active / mixed scopes are completely unaffected.
  const allInScopeInactive = useMemo(
    () => filteredClients.length > 0 && filteredClients.every((c) => isInactiveStatus(c.status)),
    [filteredClients],
  );
  const anchorEndCell = useMemo(
    () => (allInScopeInactive ? latestDeliveredGoalCell(goals, clientNamesInScope) : null),
    [allInScopeInactive, goals, clientNamesInScope],
  );
  // If the user is on "Current month" but the scope is now all-inactive (that
  // option is hidden), resolve as "Last month" — derived at render, not via a
  // state write, so widening the scope again restores "Current month" on its own.
  const effectiveGoalsPeriod: LocalPeriodKey =
    goalsPeriod === "current" && allInScopeInactive ? "1m" : goalsPeriod;
  const periodScope = useMemo<PeriodScope>(
    () =>
      resolveLocalPeriod(
        effectiveGoalsPeriod,
        goals,
        clientNamesInScope,
        anchorEndCell,
        lastCompletedEditorialCell,
      ),
    [effectiveGoalsPeriod, goals, clientNamesInScope, anchorEndCell, lastCompletedEditorialCell],
  );

  return (
    <PodDeliveryProgressCard
      clients={filteredClients}
      summaries={summaries}
      goals={goals}
      clientProduction={clientProduction}
      cumulative={cumulative}
      period={periodScope}
      goalsPeriod={effectiveGoalsPeriod}
      onGoalsPeriodChange={setGoalsPeriod}
      podAxis={podAxis}
      anchorEndCell={anchorEndCell}
      hideCurrentMonth={allInScopeInactive}
    />
  );
}

/** Linked-hover state shared across the 3 cards in Pod Pace section.
 *  Drives the "Link cards" toggle behavior:
 *    • kind="pair"      — a milestone-pair (from→to). Emitted by TTM
 *                         cards and Pod Timelines segments. Identifies
 *                         a single transition and can sync the Per-Client
 *                         Days metric dropdown.
 *    • kind="milestone" — a single milestone field. Emitted by Pod
 *                         Timelines dots (a dot is one milestone, not a
 *                         transition — so multiple TTM cards may match).
 *                         Does NOT sync the per-client dropdown. */
export type LinkedHover =
  | { kind: "pair"; from: string; to: string }
  | { kind: "milestone"; field: string }
  | null;

const LINK_ENABLED_STORAGE_KEY = "pod-pace-link-enabled";

/** Pod Timelines legend chip — interactive: matches the cross-card
 *  hover state (dims when something else is hovered, highlights when
 *  this milestone is) AND emits a milestone-kind LinkedHover so the
 *  rest of the cards react when the user hovers the chip. */
function LegendChip({
  field,
  label,
  color,
  shape,
  linkedHover,
  onHoverChange,
}: {
  field: string;
  label: string;
  color: string;
  shape: "diamond" | "circle";
  linkedHover?: LinkedHover;
  onHoverChange?: (h: LinkedHover) => void;
}) {
  const num = MILESTONE_NUM_BY_FIELD[field];
  const m = matchDot(linkedHover, field);
  const dim = m === false;
  const hi = m === true;
  return (
    <div
      className={
        "flex items-center gap-1.5 cursor-default transition-opacity " +
        (dim ? "opacity-30" : "")
      }
      onMouseEnter={() => onHoverChange?.({ kind: "milestone", field })}
      onMouseLeave={() => onHoverChange?.(null)}
    >
      {shape === "diamond" ? (
        <div
          className="h-[8px] w-[8px] rotate-45 rounded-sm"
          style={{
            backgroundColor: color,
            boxShadow: hi ? `0 0 6px ${color}90` : undefined,
          }}
        />
      ) : (
        <div
          className="rounded-full"
          style={{
            width: 9,
            height: 9,
            backgroundColor: color,
            boxShadow: hi ? `0 0 8px ${color}90` : undefined,
          }}
        />
      )}
      <span
        className={
          "font-mono text-[10px] " +
          (hi ? "text-white" : "text-[#606060]")
        }
      >
        {num != null && (
          <span className={hi ? "text-white" : "text-[#909090]"}>{num}</span>
        )}{" "}
        {label}
      </span>
    </div>
  );
}

/** Decide a Pod Timelines SEGMENT's match status given the current
 *  cross-card hover. Returns:
 *    • true  → highlight (the segment IS the hover target)
 *    • false → dim (hover is active but on something else)
 *    • null  → render normally (nothing is hovered) */
function matchSegment(
  h: LinkedHover | undefined,
  from: string,
  to: string,
): boolean | null {
  if (!h) return null;
  if (h.kind === "pair") return h.from === from && h.to === to;
  // Milestone hover: a segment matches if EITHER endpoint is the
  // hovered milestone (keeps the segments adjacent to the hovered
  // dot visually emphasised).
  return h.field === from || h.field === to;
}

/** Decide a Pod Timelines DOT's match status given the current
 *  cross-card hover. Same return contract as matchSegment. */
function matchDot(h: LinkedHover | undefined, field: string): boolean | null {
  if (!h) return null;
  if (h.kind === "milestone") return h.field === field;
  // Pair hover: a dot matches if it's the from OR to endpoint of the
  // hovered transition.
  return h.from === field || h.to === field;
}

/** Hook the parent (overview page) calls to manage the "Link cards"
 *  toggle's state + localStorage persistence. Returns the toggle state,
 *  a setter (for use inside PodPaceSection), and a ready-to-render
 *  <LinkCardsToggle> chip you can drop into the Section's rightSlot.
 *
 *  We expose this as a hook so the toggle button lives in the section
 *  header (next to "Open in Editorial Clients") while the state itself
 *  drives the cards inside PodPaceSection. Without this split we'd be
 *  rendering the chip inside the cards' body, which the user didn't
 *  want — they wanted it inline with the section's right-side button.
 */
export function useLinkCardsToggle() {
  const [linkEnabled, setLinkEnabled] = useState<boolean>(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(LINK_ENABLED_STORAGE_KEY);
    if (stored !== null) setLinkEnabled(stored === "true");
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LINK_ENABLED_STORAGE_KEY, String(linkEnabled));
  }, [linkEnabled]);
  const toggle = (
    <LinkCardsToggle
      enabled={linkEnabled}
      onToggle={() => setLinkEnabled((v) => !v)}
    />
  );
  return { linkEnabled, toggle };
}

/** Pod Pace section — milestone journey, time-to-metrics stat cards, and
 *  per-client time-to-metrics breakdown bar chart (legacy TimeToTrendChart
 *  from TimeToMetrics.tsx). Rendered as its own page section beneath the
 *  Pod Snapshot section. */
export function PodPaceSection({
  filteredClients,
  linkEnabled,
}: {
  filteredClients: Client[];
  /** From useLinkCardsToggle() in the parent page. When false the three
   *  cards stop influencing each other on hover. */
  linkEnabled: boolean;
}) {
  const { axis: podAxis } = useCurrentPodAxis();
  const [linkedHover, setLinkedHover] = useState<LinkedHover>(null);
  // ID of the client currently SELECTED via click on a Pod Timeline
  // row. When set (and `linkEnabled`), the Time-to-Metrics cards
  // re-scope to ONLY that client and the Per-Client Days bar for that
  // client gets a highlight ring. Cleared by clicking the same row
  // again, or by external state changes (e.g. filter change).
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);

  // Effective hover signal — when the toggle is off we ignore it entirely
  // so the three cards stop influencing each other.
  const activeHover: LinkedHover = linkEnabled ? linkedHover : null;
  const activeSelectedId = linkEnabled ? selectedClientId : null;
  // TTM cards work off a single-client array when a row is selected,
  // otherwise the full filtered set. Variance/avg etc compute the
  // same way — just with N=1.
  const ttmClients = useMemo(() => {
    if (activeSelectedId == null) return filteredClients;
    const c = filteredClients.find((cc) => cc.id === activeSelectedId);
    return c ? [c] : filteredClients;
  }, [filteredClients, activeSelectedId]);
  const selectedClientName = useMemo(() => {
    if (activeSelectedId == null) return null;
    return filteredClients.find((cc) => cc.id === activeSelectedId)?.name ?? null;
  }, [filteredClients, activeSelectedId]);

  // For Per-Client Days: when a TTM card or segment is hovered (a unique
  // pair), look up the matching metric key and use it as a transient
  // override so the bar chart reflects the hovered transition. When the
  // hover ends, the chart reverts to the user's dropdown selection.
  const metricOverride =
    activeHover?.kind === "pair"
      ? matchTTMKeyByPair(activeHover.from, activeHover.to)
      : null;

  return (
    <div className="space-y-3">
      {/* Pod Timelines gets more horizontal room (60/40 split) so its
          legend fits on one line and the labels for long pod names
          stop wrapping. TTM cards still readable at 40% — the chip
          titles fit at the 2-col grid we set inside. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.5fr_1fr]">
        <PodMilestoneJourneyCard
          clients={filteredClients}
          podAxis={podAxis}
          linkedHover={activeHover}
          onHoverChange={setLinkedHover}
          onClientFocus={setSelectedClientId}
          selectedClientId={activeSelectedId}
          selectedClientName={selectedClientName}
        />
        <PodTTMStatsCard
          clients={ttmClients}
          linkedHover={activeHover}
          onHoverChange={setLinkedHover}
          focusedClientName={selectedClientName}
        />
      </div>
      <TimeToTrendChart
        clients={filteredClients}
        metricOverride={metricOverride}
        highlightedClientName={selectedClientName}
      />
    </div>
  );
}

/** Return the TTM metric key whose (from, to) milestone pair matches the
 *  given fields, or null if no match. Used to sync the Per-Client Days
 *  metric dropdown when a pair is hovered elsewhere. */
function matchTTMKeyByPair(from: string, to: string): string | null {
  const fromField = from === "" ? "consulting_ko_date" : from;
  for (const m of TTM_METRICS) {
    const mFrom = m.from ?? "consulting_ko_date";
    if (mFrom === fromField && m.to === to) return m.key;
  }
  return null;
}

function LinkCardsToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={
        "inline-flex items-center gap-2 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors " +
        (enabled
          ? "border-[#42CA80]/40 bg-[#42CA80]/10 text-[#42CA80] hover:bg-[#42CA80]/15"
          : "border-[#2a2a2a] bg-[#0d0d0d] text-[#606060] hover:text-[#909090]")
      }
      title="Highlight related milestones across cards on hover; sync the Per-Client Days dropdown to the hovered transition."
    >
      <span
        className={
          "inline-block h-2.5 w-2.5 rounded-full transition-colors " +
          (enabled ? "bg-[#42CA80]" : "bg-[#404040]")
        }
      />
      Link cards{enabled ? "" : " (off)"}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Period resolution
//
// Goals column (and only the Goals column) is month-period scoped. All
// other columns are intrinsic to the contract (per-client Q math) or
// lifetime, so they're unaffected by the date filter.
//
//   • dateRange.type === "range"  → use exactly those months
//   • dateRange.type === "all"    → default to last completed editorial
//                                    month (matches what the row-level
//                                    "1m" default used to do)
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve a local Goals-scope key to the months it covers + a display
 *  label. Anchored to the LAST COMPLETED editorial month so the most
 *  recent month in any selection is a closed actuals month, not an
 *  in-progress projection.
 *
 *  `goals` is consulted only for the "all" key — it walks the rows to
 *  derive the earliest goal month available for the in-scope clients,
 *  so "All time" matches the actual data envelope (no 20-year hack). */
function resolveLocalPeriod(
  period: LocalPeriodKey,
  goals?: GoalsVsDeliveryRow[],
  clientNames?: Set<string>,
  /** When the in-scope clients are ALL inactive, this is their last month
   *  WITH delivered data — the period END anchors here so "Last month" shows
   *  their last real month instead of an empty post-contract calendar month.
   *  null/undefined (active or mixed scope) → end stays at the last completed
   *  month, exactly as before. */
  anchorEndCell?: number | null,
  /** The last CLOSED Editorial month as an absolute month-cell
   *  (`year*12 + (month-1)`), grace applied — from `useLastClosedEditorialMonth`.
   *  When provided, the Goals column anchors here (and "Current month" = the
   *  next Editorial month) so it flips on the SAME day as the "As of" badge.
   *  null/undefined (weeks not loaded yet) → fall back to the calendar month−1. */
  lastCompletedEditorialCell?: number | null,
): PeriodScope {
  const today = new Date();
  // Anchor on the last CLOSED Editorial month (grace-aware) when we have it,
  // else the calendar month−1 (legacy fallback so the column always renders).
  const lastCompletedCell =
    lastCompletedEditorialCell != null
      ? lastCompletedEditorialCell
      : today.getFullYear() * 12 + (today.getMonth() - 1);
  const endCell =
    anchorEndCell != null ? Math.min(lastCompletedCell, anchorEndCell) : lastCompletedCell;
  const endY = Math.floor(endCell / 12);
  const endM = (endCell % 12) + 1;

  let stepBack = 0;
  let caption = "Last completed month";
  switch (period) {
    case "current": {
      // In-progress Editorial month = the one right after the last closed one
      // (same grace boundary as the badge); falls back to the calendar month
      // when weeks aren't loaded. Partial data — the month still being worked.
      const curCell =
        lastCompletedEditorialCell != null
          ? lastCompletedEditorialCell + 1
          : today.getFullYear() * 12 + today.getMonth();
      const curY = Math.floor(curCell / 12);
      const curM = (curCell % 12) + 1;
      return {
        months: [{ year: curY, month: curM }],
        label: `${MONTH_NAMES_LONG[curM - 1]} ${curY}`,
        caption: "Current (in-progress) month",
      };
    }
    case "3m":  stepBack = 2; caption = "Last 3 completed months"; break;
    case "6m":  stepBack = 5; caption = "Last 6 completed months"; break;
    case "12m": stepBack = 11; caption = "Last 12 completed months"; break;
    case "all": {
      // All time — derive the start from the earliest goal-data month
      // present for the in-scope clients. If we don't have goals data
      // (or no clients are in scope), fall back to a 24-month window
      // ending at the last completed month so the column still renders.
      let earliestCell: number | null = null;
      if (goals && clientNames && clientNames.size > 0) {
        for (const r of goals) {
          if (!clientNames.has(r.client_name)) continue;
          const ym = parseMonthYear(r.month_year);
          if (!ym) continue;
          const cell = ym.year * 12 + (ym.month - 1);
          if (earliestCell === null || cell < earliestCell) earliestCell = cell;
        }
      }
      const startCellAll = earliestCell !== null
        ? earliestCell
        : endY * 12 + (endM - 1) - 23;
      const startYAll = Math.floor(startCellAll / 12);
      const startMAll = (startCellAll % 12) + 1;
      const monthsAll = monthsBetween(startYAll, startMAll, endY, endM);
      const startLabel = `${MONTH_NAMES_SHORT[startMAll - 1]} ${String(startYAll).slice(-2)}`;
      const endLabel = `${MONTH_NAMES_SHORT[endM - 1]} ${String(endY).slice(-2)}`;
      return {
        months: monthsAll,
        label: `All time · ${startLabel} – ${endLabel}`,
        caption: earliestCell !== null
          ? `Every month with goals data for the in-scope clients (${monthsAll.length} months)`
          : "Last 24 months (no goals data in scope)",
      };
    }
    case "1m":
    default:    stepBack = 0; caption = "Last completed month";
  }
  const startCell = endY * 12 + (endM - 1) - stepBack;
  const startY = Math.floor(startCell / 12);
  const startM = (startCell % 12) + 1;
  const months = monthsBetween(startY, startM, endY, endM);
  const label = months.length === 1
    ? `${MONTH_NAMES_LONG[endM - 1]} ${endY}`
    : startY === endY
    ? `${MONTH_NAMES_SHORT[startM - 1]} – ${MONTH_NAMES_SHORT[endM - 1]} ${endY}`
    : `${MONTH_NAMES_SHORT[startM - 1]} ${String(startY).slice(-2)} – ${MONTH_NAMES_SHORT[endM - 1]} ${String(endY).slice(-2)}`;
  return { months, label, caption };
}

function monthsBetween(
  y1: number, m1: number,
  y2: number, m2: number,
): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  let y = y1, m = m1;
  while (y < y2 || (y === y2 && m <= m2)) {
    out.push({ year: y, month: m });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pod Delivery Progress (left card)
// ─────────────────────────────────────────────────────────────────────────────

interface PodDeliveryRow {
  pod: string;
  clients: Client[];
  // Goals (month-period scoped)
  cbDel: number;
  cbGoal: number;
  adDel: number;
  adGoal: number;
  // Delivery vs Invoiced (per-client Q-based, summed across the pod's clients).
  // All counts are ARTICLES (the only unit `deliverables_monthly` carries).
  // All "Q" numbers are CUMULATIVE through end of that Q.
  lastQVariance: number;
  lastQDelivered: number;          // cumulative delivered through end of last full Q
  lastQInvoiced: number;           // cumulative invoiced through end of last full Q
  lastQHasData: boolean;
  currentQVariance: number;
  currentQActualDelivered: number; // cumulative ACTUALS through last completed month
  currentQDelivered: number;       // cumulative projected through end of current Q
  currentQInvoiced: number;        // cumulative invoiced through end of current Q
  currentQHasData: boolean;
  /** True when EVERY client contributing to the Current Q total is inactive
   *  (showing its last ended quarter) — no in-progress client. Drives the
   *  pod tile chip wording ("Last quarter" vs "End of quarter"). */
  currentQAllFinal: boolean;
  /** Invoiced-weighted average month-in-Q across pod's clients, used to
   *  compute the pod-level pace classification (so a pod whose clients
   *  are mid-Q on average reads as different from one whose clients are
   *  all at start-of-Q). 0 when no clients have current-Q data. */
  currentQAvgMonthInQ: number;
  currentQAvgQLength: number;
  newCount: number;
  // Lifetime (across-all-time)
  lifetimeDelivered: number;
  lifetimeInvoiced: number;
  lifetimeSow: number;
  /** Sum of published_live across the pod's clients, from
   *  cumulative_metrics. Drives the new %Published column. */
  lifetimePublished: number;
}

interface PerClientRow {
  id: number;
  name: string;
  // Goals (month-period scoped)
  cbDel: number;
  cbGoal: number;
  adDel: number;
  adGoal: number;
  // Delivery vs Invoiced (this client's own Qs). All cumulative through end
  // of the named Q — variance = cumulative delivered − cumulative invoiced.
  lastQ: {
    label: string;
    delivered: number;        // cumulative delivered through end of last Q
    invoiced: number;         // cumulative invoiced through end of last Q
    variance: number;
    /** True when this last full Q was the client's FIRST contract Q
     *  (Q1) — drives the "1st Q" tier on the variance card so a
     *  ramp-up close doesn't read as "Behind Plan". */
    isFirstQ: boolean;
  } | null;
  currentQ: {
    label: string;
    monthsLabel: string;      // e.g. "Feb–Apr 26" — the quarter's month span
    projectedVariance: number;
    actualDelivered: number;  // cumulative ACTUALS through last completed month
    delivered: number;        // cumulative projected through end of current Q
    invoiced: number;         // cumulative invoiced through end of current Q
    monthInQ: number;         // 1-based position of today within the Q
    qLength: number;          // total months in the Q
    /** True when this is NOT an in-progress quarter but the client's LAST
     *  ended quarter, surfaced here because the client is inactive/completed
     *  (no current Q exists). The cell then reads "Last quarter" + clicking
     *  opens the lastQ drill-down. */
    isFinal: boolean;
  } | null;
  isNew: boolean;
  // Lifetime
  lifetimeDelivered: number;
  lifetimeInvoiced: number;
  lifetimeSow: number;
  /** published_live from cumulative_metrics for this client. */
  lifetimePublished: number;
}

/** Shared grid for the pod summary row + per-client expand list. Keeps the
 *  Goals / Last Q / Curr Q / Lifetime columns visually aligned across both. */
// All data columns use fr units (with min-width) so they grow
// proportionally when the card widens. Previously Goals was 1.8fr while
// the others were capped via minmax — the Goals column absorbed every
// extra pixel of viewport, which looked weird on wide screens.
//   • chevron       — 1.25rem  fixed
//   • pod / client  — 10–13rem (room for "Workleap + Sharegate (7)")
//   • Goals         — 2fr  min 11rem
//   • Last Q        — 1fr  min 6rem
//   • Current Q     — 1fr  min 6rem
//   • %SOW          — 1fr  min 6rem
// 7 columns now: chevron · name · Goals · Last Q · Current Q · %SOW ·
// %Published. The two Q columns get more breathing room (10rem min) so
// the two stacked lifetime bars + chip have width to render. %SOW and
// %Published are compact since each is a single bar + percentage.
// 6 columns: chevron · name · Goals · Current Q · %SOW · %Published.
// (Last Q column hidden in 0.3.17 — focus shifts to Current Q +
// lifetime SOW; Last Q is still readable via the per-client drill-down
// popover, which carries the lastQ variant.) Name + Goals + %SOW +
// %Published stay slim so Current Q (the focal [chip block | bars]
// layout) gets the breathing room it needs. Vertical dividers between
// columns come from the DELIVERY_CELL_DIVIDER class applied to each
// cell except the last.
const DELIVERY_GRID = "grid-cols-[1.25rem_minmax(8rem,11rem)_minmax(7rem,1.1fr)_minmax(13rem,1.9fr)_minmax(4rem,0.9fr)_minmax(4rem,0.9fr)]";

/** Vertical column dividers — applied to the grid row container via
 *  Tailwind arbitrary selectors. Targets every direct child EXCEPT the
 *  first (chevron column) and the last (%Published) so the divider
 *  shows between the data columns only. Pairs with gap-x-3 + pr-3 to
 *  push the line away from the cell's content. */
const DELIVERY_DIVIDERS =
  "[&>*:not(:first-child):not(:last-child)]:border-r [&>*:not(:first-child):not(:last-child)]:border-[#2a2a2a] [&>*:not(:first-child):not(:last-child)]:pr-3";

function PodDeliveryProgressCard({
  clients,
  summaries,
  goals,
  clientProduction,
  cumulative,
  period,
  goalsPeriod,
  onGoalsPeriodChange,
  podAxis,
  anchorEndCell,
  hideCurrentMonth,
}: {
  clients: Client[];
  summaries: SummaryRow[];
  goals: GoalsVsDeliveryRow[];
  clientProduction: ClientProductionRow[];
  cumulative: CumulativeMetric[];
  period: PeriodScope;
  goalsPeriod: LocalPeriodKey;
  onGoalsPeriodChange: (k: LocalPeriodKey) => void;
  podAxis: "editorial" | "growth";
  /** Inactive-scope period anchor (see resolveLocalPeriod); null otherwise. */
  anchorEndCell: number | null;
  /** Drop the "Current month" Goals option (all in-scope clients inactive). */
  hideCurrentMonth: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);

  // Build name → published_live map once per cumulative change. The
  // aggregator below sums published_live per pod alongside delivered /
  // invoiced / SOW so the %Published column can show per-pod + per-client.
  const publishedByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cumulative) {
      m.set(c.client_name, c.published_live ?? 0);
    }
    return m;
  }, [cumulative]);

  const { podRows, perClientByPod } = useMemo(
    () => aggregatePodDelivery(clients, summaries, goals, period, podAxis, publishedByName),
    [clients, summaries, goals, period, podAxis, publishedByName],
  );

  return (
    <div className="h-full rounded-lg border border-[#2a2a2a] bg-[#161616] p-4">
      {/* Column header — visible only when at least one pod row will
          render. The Goals header carries the column title (with hover
          tooltip) and the period dropdown sits immediately to its right
          on the same line. */}
      {podRows.length > 0 && (
        <div
          className={
            `grid ${DELIVERY_GRID} ${DELIVERY_DIVIDERS} items-center gap-3 px-3 pb-2 ` +
            // When filtered to a single pod we drop the column-header's
            // bottom border so the line inside the pod-label strip below
            // becomes the only separator between headers and rows —
            // avoids stacking two near-identical horizontal rules.
            (podRows.length === 1 ? "" : "border-b border-[#222]")
          }
        >
          <span />
          <span />
          <GoalsHeaderWithSelector
            anchored={hideCurrentMonth}
            sub={`CBs + Articles vs monthly goal · ${period.label}`}
            help={{
              title: "Goals",
              bullets: [
                "Content Briefs and Articles, counted separately.",
                "Numbers = delivered / monthly goal.",
                "Time range set by the dropdown above.",
              ],
            }}
            selector={
              <GoalsPeriodSelector
                value={goalsPeriod}
                onChange={onGoalsPeriodChange}
                scope={period}
                goals={goals}
                clientNames={
                  new Set(clients.map((c) => c.name))
                }
                anchorEndCell={anchorEndCell}
                hideCurrent={hideCurrentMonth}
              />
            }
          />
          <ColumnHeader
            title="Current Quarter"
            sub="Delivered against Invoiced"
            align="center"
            help={{
              title: "Current Quarter",
              bullets: [
                "Top bar: articles delivered vs invoiced this quarter.",
                "Bottom bar: invoiced this quarter vs the full contract (SOW).",
                "Chip: projected delivered vs invoiced by quarter's end.",
              ],
            }}
          />
          <ColumnHeader
            title="% of SOW"
            sub="delivered vs full contract"
            align="center"
            help={{
              title: "% of SOW",
              bullets: [
                "Share of the full contract delivered so far.",
                "SOW = the total articles the contract covers.",
              ],
            }}
          />
          <ColumnHeader
            title="% Published"
            sub="published vs full contract"
            align="center"
            help={{
              title: "% Published",
              bullets: [
                "Share of the full contract already published live.",
                "SOW = the total articles the contract covers.",
              ],
            }}
          />
        </div>
      )}

      {detail && (
        <ClientDetailPopover
          detail={detail}
          clients={clients}
          summaries={summaries}
          goals={goals}
          clientProduction={clientProduction}
          periodLabel={period.label}
          periodMonths={period.months}
          onClose={() => setDetail(null)}
        />
      )}
      <div className="divide-y divide-[#222]">
        {podRows.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-[#606060]">
            No data in scope.
          </p>
        ) : podRows.length === 1 ? (
          /* Single pod in scope. Drop the aggregated summary row —
             the client rows ARE the data — but keep a thin labelled
             separator at the top so the user can still see WHICH pod
             they're looking at. Matches the Pod Timelines pod label
             strip (dot + name + count + horizontal rule). */
          (() => {
            const row = podRows[0];
            const podColor = POD_HEX_COLORS[row.pod] ?? "#606060";
            return (
              <div>
                <div className="flex items-center gap-3 pt-2.5 pb-1 px-2">
                  <span
                    className="inline-block h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: podColor }}
                  />
                  <span
                    className="font-mono text-[11px] font-semibold uppercase tracking-wider shrink-0"
                    style={{ color: podColor }}
                  >
                    {displayPod(row.pod, podAxis)}
                  </span>
                  <span className="font-mono text-[10px] text-[#606060] shrink-0">
                    ({row.clients.length})
                  </span>
                  <span className="h-px flex-1 bg-[#2a2a2a]" />
                </div>
                <PerClientDeliveryList
                  rows={perClientByPod.get(row.pod) ?? []}
                  onOpenDetail={(d) => setDetail(d)}
                />
              </div>
            );
          })()
        ) : (
          podRows.map((row) => {
            const open = expanded === row.pod;
            return (
              <div key={row.pod}>
                <PodDeliveryRowHeader
                  row={row}
                  open={open}
                  onToggle={() => setExpanded(open ? null : row.pod)}
                  podAxis={podAxis}
                />
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      key="expand"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.18 }}
                      className="overflow-hidden"
                    >
                      <PerClientDeliveryList
                        rows={perClientByPod.get(row.pod) ?? []}
                        onOpenDetail={(d) => setDetail(d)}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ColumnHeader({
  title,
  sub,
  help,
  align = "left",
  badge,
  muted = false,
}: {
  title: React.ReactNode;
  sub: string;
  help: { title: string; bullets: React.ReactNode[] };
  align?: "left" | "center" | "right";
  /** Optional small chip rendered next to the title (e.g. "PROJECTED" on
   *  Current Q). Uses a muted blue palette so it reads as informational
   *  without competing with the tier colors below. */
  badge?: string;
  /** Dim the header (title in mid-grey instead of cream). Used on
   *  Last Q so the visual weight shifts to Current Q as the focal
   *  point. Tooltip + alignment are unchanged — Last Q is still
   *  hover-able and stays the same width. */
  muted?: boolean;
}) {
  const alignCls = align === "right"
    ? "text-right"
    : align === "center"
    ? "text-center"
    : "";
  const justifyCls = align === "center"
    ? "justify-center"
    : align === "right"
    ? "justify-end"
    : "";
  const titleColor = muted ? "text-[#606060]" : "text-[#C4BCAA]";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={<div className={"cursor-help " + alignCls} />}
        >
          <div className={"inline-flex items-center gap-1.5 " + justifyCls}>
            <p className={`font-mono text-[10px] uppercase tracking-wider ${titleColor} underline decoration-dotted underline-offset-2 decoration-[#404040]`}>
              {title}
            </p>
            {badge && (
              <span className="rounded-sm border border-[#8FB5D9]/40 bg-[#8FB5D9]/10 px-1 py-px font-mono text-[8px] uppercase tracking-wider text-[#8FB5D9]">
                {badge}
              </span>
            )}
          </div>
          <p className="font-mono text-[9px] text-[#606060]">{sub}</p>
        </TooltipTrigger>
        <TooltipContent>
          <TooltipBody {...help} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Goals column header — title with hover-tooltip + inline period
 *  selector that reads as part of the same text line. The selector takes
 *  the role of the rotating part of the title (so "GOALS LAST MONTH" or
 *  "GOALS ALL TIME" reads as one continuous label). */
function GoalsHeaderWithSelector({
  sub,
  help,
  selector,
  anchored = false,
}: {
  sub: string;
  help: { title: string; bullets: React.ReactNode[] };
  selector: React.ReactNode;
  /** Every in-scope client is inactive → the period is anchored to their last
   *  month WITH data. Show a "Last data month" badge so it's clear the goals
   *  aren't the current/last-completed calendar month. */
  anchored?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="inline-flex items-baseline gap-2 flex-wrap">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <p className="font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA] underline decoration-dotted underline-offset-2 decoration-[#404040] cursor-help inline-block" />
              }
            >
              Goals
            </TooltipTrigger>
            <TooltipContent>
              <TooltipBody {...help} />
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {selector}
        {anchored && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex cursor-help self-center rounded-sm px-1.5 py-px font-mono text-[8px] font-semibold uppercase tracking-wider text-[#909090] bg-[#909090]/10" />
                }
              >
                Last data month
              </TooltipTrigger>
              <TooltipContent>
                <TooltipBody
                  title="Last data month"
                  bullets={[
                    "This client is inactive — its contract has ended.",
                    "Goals show the last month with delivered data.",
                  ]}
                />
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {/* Small amber warning icon — surfaces the pre-Aug/Sep-2025 data
            quality caveat without putting a banner on the card. */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className="inline-flex items-center cursor-help text-[#F5BC4E]/70 hover:text-[#F5BC4E] transition-colors"
                  aria-label="Data quality note"
                />
              }
            >
              <AlertTriangle className="h-3 w-3" />
            </TooltipTrigger>
            <TooltipContent>
              <TooltipBody
                title="Data may be incomplete"
                bullets={[
                  "Rows before Aug/Sep 2025 came from a different source.",
                  "Older months aren't fully tracked yet.",
                  "Totals across older months may understate delivery.",
                ]}
              />
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <p className="font-mono text-[9px] text-[#606060]">{sub}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Goals period selector
//
// Section-local dropdown that picks the month range for the Goals column.
// Pod Snapshot is INTENTIONALLY independent of the global FilterBar date
// range — the other columns (Last Q / Current Q / %SOW / Milestone Journey)
// are intrinsic to each client's contract, not period-scoped. This control
// scopes only the Goals column.
// Sits in column 2 of the header grid so it visually aligns with the pod
// label column underneath.
// ─────────────────────────────────────────────────────────────────────────────

const GOALS_PERIOD_OPTIONS: { id: LocalPeriodKey; label: string }[] = [
  { id: "current", label: "Current month" },
  { id: "1m", label: "Last month" },
  { id: "3m", label: "Last 3 months" },
  { id: "6m", label: "Last 6 months" },
  { id: "12m", label: "Last 12 months" },
  { id: "all", label: "All time" },
];

function GoalsPeriodSelector({
  value,
  onChange,
  scope,
  goals,
  clientNames,
  anchorEndCell,
  hideCurrent = false,
}: {
  value: LocalPeriodKey;
  onChange: (v: LocalPeriodKey) => void;
  scope: PeriodScope;
  /** Source data needed to compute each option's month-range label —
   *  shows the concrete window under each option in the dropdown
   *  (e.g. `Last 3 months · Feb – Apr 26`). The trigger button stays
   *  on the short label. */
  goals?: GoalsVsDeliveryRow[];
  clientNames?: Set<string>;
  /** Inactive-scope period anchor, threaded into each option's label. */
  anchorEndCell?: number | null;
  /** Hide the "Current month" option — used when every in-scope client is
   *  inactive/completed (no in-progress month). */
  hideCurrent?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Same grace-aware anchor as the section, so each option's previewed month
  // range matches the resolved column (flips with the "As of" badge).
  const lastClosedEditorial = useLastClosedEditorialMonth();
  const lastCompletedEditorialCell = lastClosedEditorial
    ? lastClosedEditorial.year * 12 + (lastClosedEditorial.month - 1)
    : null;
  const options = hideCurrent
    ? GOALS_PERIOD_OPTIONS.filter((o) => o.id !== "current")
    : GOALS_PERIOD_OPTIONS;
  const active = options.find((o) => o.id === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block">
      {/* Compact pill trigger — bordered + tinted so the affordance reads
          as a dropdown, but kept tight (px-1.5 py-px, 10px text) so it
          still sits inline with the "Goals" title text on the same
          baseline. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          "inline-flex items-center gap-1 rounded-md border px-1.5 py-px font-mono text-[10px] uppercase tracking-wider transition-colors " +
          (open
            ? "border-[#42CA80]/50 bg-[#42CA80]/10 text-[#42CA80]"
            : "border-[#2a2a2a] bg-[#0d0d0d] text-[#C4BCAA] hover:border-[#42CA80]/40 hover:bg-[#42CA80]/5 hover:text-[#42CA80]")
        }
        title={scope.caption}
      >
        <span>{active.label}</span>
        <ChevronDown
          className={"h-2.5 w-2.5 shrink-0 transition-transform " + (open ? "rotate-180" : "")}
        />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-md border border-[#2a2a2a] bg-[#0d0d0d] shadow-xl">
          {options.map((o) => {
            const isActive = o.id === value;
            // Resolve the concrete month range for this option so
            // users can preview the window before picking it. Cheap —
            // the helper just walks the goals list once per option.
            const optionScope = resolveLocalPeriod(
              o.id,
              goals,
              clientNames,
              anchorEndCell,
              lastCompletedEditorialCell,
            );
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => { onChange(o.id); setOpen(false); }}
                className={
                  "block w-full px-2.5 py-1.5 text-left transition-colors " +
                  (isActive
                    ? "bg-[#42CA80]/10 text-[#42CA80]"
                    : "text-[#C4BCAA] hover:bg-[#1a1a1a] hover:text-white")
                }
              >
                <div className="font-mono text-[10px] uppercase tracking-wider">
                  {o.label}
                </div>
                <div
                  className={
                    "font-mono text-[9px] tabular-nums " +
                    (isActive ? "text-[#42CA80]/70" : "text-[#606060]")
                  }
                >
                  {optionScope.label}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Parse the backend's month_year strings — accepts both "Apr 2026" and
 *  "April 2026" (the live feed uses full month name; older fixtures used
 *  short). Returns null when unparseable. */
function parseMonthYear(s: string): { year: number; month: number } | null {
  const m = s.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const monthStr = m[1].toLowerCase().slice(0, 3);
  const idx = ["jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(monthStr);
  if (idx === -1) return null;
  return { year: parseInt(m[2], 10), month: idx + 1 };
}

function aggregatePodDelivery(
  clients: Client[],
  summaries: SummaryRow[],
  goals: GoalsVsDeliveryRow[],
  period: PeriodScope,
  podAxis: "editorial" | "growth",
  publishedByName: Map<string, number>,
): {
  podRows: PodDeliveryRow[];
  perClientByPod: Map<string, PerClientRow[]>;
} {
  // Encode period months into a fast lookup set keyed by year*12+month.
  const periodCells = new Set(
    period.months.map((mm) => mm.year * 12 + (mm.month - 1)),
  );

  // Per-client goals aggregation across the selected period.
  // Same 3-step rollup as GoalsVsDeliverySection.aggregateGoalsSummary.
  const clientNames = new Set(clients.map((c) => c.name));
  const perCMC = new Map<
    string,
    { client: string; ratio: number; cbGoal: number; cbDel: number; adGoal: number; adDel: number }
  >();
  for (const r of goals) {
    if (!clientNames.has(r.client_name)) continue;
    const ym = parseMonthYear(r.month_year);
    if (!ym) continue;
    const cell = ym.year * 12 + (ym.month - 1);
    if (!periodCells.has(cell)) continue;
    const ct = (r.content_type ?? "").trim().toLowerCase() || "default";
    const key = `${r.client_name}|${r.month_year}|${ct}`;
    let e = perCMC.get(key);
    if (!e) {
      e = {
        client: r.client_name,
        ratio: contentTypeRatio(r.content_type, r.ratios),
        cbGoal: 0, cbDel: 0, adGoal: 0, adDel: 0,
      };
      perCMC.set(key, e);
    }
    e.cbGoal = Math.max(e.cbGoal, r.cb_monthly_goal ?? 0);
    e.adGoal = Math.max(e.adGoal, r.ad_monthly_goal ?? 0);
    e.cbDel = Math.max(e.cbDel, r.cb_delivered_to_date ?? 0);
    e.adDel = Math.max(e.adDel, r.ad_delivered_to_date ?? 0);
  }
  const perClientGoals = new Map<
    string,
    { cbGoal: number; cbDel: number; adGoal: number; adDel: number }
  >();
  for (const [k, e] of perCMC.entries()) {
    const [client] = k.split("|");
    const cur = perClientGoals.get(client) ?? { cbGoal: 0, cbDel: 0, adGoal: 0, adDel: 0 };
    cur.cbGoal += e.cbGoal * e.ratio;
    cur.cbDel += e.cbDel * e.ratio;
    cur.adGoal += e.adGoal * e.ratio;
    cur.adDel += e.adDel * e.ratio;
    perClientGoals.set(client, cur);
  }

  // Per-client current-Q + last-Q lookup.
  const summaryById = new Map(summaries.map((s) => [s.id, s]));

  // Group clients by pod.
  const byPod = new Map<string, Client[]>();
  for (const c of clients) {
    const raw = podAxis === "growth" ? c.growth_pod : c.editorial_pod;
    const pod = normalizePod(raw);
    if (!byPod.has(pod)) byPod.set(pod, []);
    byPod.get(pod)!.push(c);
  }

  const podRows: PodDeliveryRow[] = [];
  const perClientByPod = new Map<string, PerClientRow[]>();
  for (const [pod, podClients] of byPod.entries()) {
    let cbDel = 0, cbGoal = 0, adDel = 0, adGoal = 0;
    let lastQVariance = 0;
    let lastQDelivered = 0;
    let lastQInvoiced = 0;
    let lastQHasData = false;
    let currentQVariance = 0;
    let currentQActualDelivered = 0;
    let currentQDelivered = 0;
    let currentQInvoiced = 0;
    let currentQHasData = false;
    // Track whether the Current Q total mixes in-progress clients with
    // inactive ones (showing their last ended Q) — drives the pod tile chip.
    let currentQHasLive = false;
    let currentQHasFinal = false;
    // Invoiced-weighted month-in-Q and qLength accumulators for the pod
    // pace metric. We weight by invoiced so larger clients pull the avg
    // more — matches how the pod's variance + numbers are aggregated.
    let currentQMonthInQWeighted = 0;
    let currentQQLengthWeighted = 0;
    let currentQPaceWeight = 0;
    let newCount = 0;
    let lifetimeDelivered = 0;
    let lifetimeInvoiced = 0;
    let lifetimeSow = 0;
    let lifetimePublished = 0;
    const clientRows: PerClientRow[] = [];

    for (const c of podClients) {
      const g = perClientGoals.get(c.name) ?? { cbGoal: 0, cbDel: 0, adGoal: 0, adDel: 0 };
      cbDel += g.cbDel; cbGoal += g.cbGoal;
      adDel += g.adDel; adGoal += g.adGoal;

      // Inactive clients have no in-progress Q, so their Current Q column
      // would read "—". Instead we surface their LAST ended quarter there.
      const isInactive = isInactiveStatus(c.status);

      const row = summaryById.get(c.id);
      let currentQ: PerClientRow["currentQ"] = null;
      let lastQ: PerClientRow["lastQ"] = null;
      let isNew = false;
      let clientLifetimeDelivered = 0;
      let clientLifetimeInvoiced = 0;
      let clientLifetimeSow = 0;
      const clientLifetimePublished = publishedByName.get(c.name) ?? 0;
      lifetimePublished += clientLifetimePublished;
      if (row) {
        const cq = computeCurrentQ(row);
        const lq = computeLastFullQ(row);
        isNew = isFirstContractQ(row);
        clientLifetimeDelivered = row.articles_delivered;
        clientLifetimeInvoiced = row.articles_invoiced;
        clientLifetimeSow = row.articles_sow;
        lifetimeDelivered += clientLifetimeDelivered;
        lifetimeInvoiced += clientLifetimeInvoiced;
        lifetimeSow += clientLifetimeSow;
        if (cq) {
          currentQ = {
            label: cq.label,
            monthsLabel: cq.monthsLabel,
            projectedVariance: cq.projectedVariance,
            actualDelivered: cq.delivered,    // cumulative actuals so far
            delivered: cq.projectedEnd,       // cumulative projected end-of-Q
            invoiced: cq.invoiced,
            monthInQ: cq.monthInQ,
            qLength: cq.qLength,
            isFinal: false,
          };
          // Actual delivered/invoiced numbers ALWAYS aggregate every
          // client with a current Q — including 1st-Q clients. Their
          // delivered work is real data and should match the lifetime
          // delivered shown in %SOW. The VARIANCE + pace metrics still
          // skip 1st-Q clients (variance is meaningless when they
          // just started ramping).
          currentQActualDelivered += cq.delivered;
          currentQDelivered += cq.projectedEnd;
          currentQInvoiced += cq.invoiced;
          currentQHasData = true;
          currentQHasLive = true;
          if (!isNew) {
            currentQVariance += cq.projectedVariance;
            const weight = Math.max(1, cq.invoiced);
            currentQMonthInQWeighted += cq.monthInQ * weight;
            currentQQLengthWeighted += cq.qLength * weight;
            currentQPaceWeight += weight;
          }
        } else if (isInactive && lq) {
          // No in-progress Q + the contract has ended → show the client's
          // LAST ended quarter in the Current Q column (cumulative numbers,
          // no projection — the quarter is closed). Folded into the pod
          // total so the pod tile isn't empty either; excluded from the
          // pace metric (a fully-elapsed quarter has no "pacing").
          currentQ = {
            label: lq.label,
            monthsLabel: lq.monthsLabel,
            projectedVariance: lq.cumVariance,
            actualDelivered: lq.cumDelivered,
            delivered: lq.cumDelivered,
            invoiced: lq.cumInvoiced,
            monthInQ: 0,
            qLength: 0,
            isFinal: true,
          };
          currentQActualDelivered += lq.cumDelivered;
          currentQDelivered += lq.cumDelivered;
          currentQInvoiced += lq.cumInvoiced;
          currentQHasData = true;
          currentQHasFinal = true;
          if (!lq.isFirstQ) currentQVariance += lq.cumVariance;
        }
        if (lq) {
          // Cumulative through end of last full Q — matches the
          // spreadsheet's per-Q Variance math AND aligns with how the
          // current Q's projected variance is computed (both are
          // cumulative-from-contract-start through end of that Q).
          lastQ = {
            label: lq.label,
            delivered: lq.cumDelivered,
            invoiced: lq.cumInvoiced,
            variance: lq.cumVariance,
            isFirstQ: lq.isFirstQ,
          };
          lastQVariance += lq.cumVariance;
          lastQDelivered += lq.cumDelivered;
          lastQInvoiced += lq.cumInvoiced;
          lastQHasData = true;
        }
        if (isNew) newCount += 1;
      }

      clientRows.push({
        id: c.id,
        name: c.name,
        cbDel: g.cbDel, cbGoal: g.cbGoal,
        adDel: g.adDel, adGoal: g.adGoal,
        lastQ,
        currentQ,
        isNew,
        lifetimeDelivered: clientLifetimeDelivered,
        lifetimeInvoiced: clientLifetimeInvoiced,
        lifetimeSow: clientLifetimeSow,
        lifetimePublished: clientLifetimePublished,
      });
    }

    clientRows.sort((a, b) => {
      // Behind first (most negative current-Q variance), then alphabetical.
      const av = a.currentQ?.projectedVariance ?? 0;
      const bv = b.currentQ?.projectedVariance ?? 0;
      if (av !== bv) return av - bv;
      return a.name.localeCompare(b.name);
    });

    podRows.push({
      pod,
      clients: podClients,
      cbDel, cbGoal,
      adDel, adGoal,
      lastQVariance, lastQDelivered, lastQInvoiced, lastQHasData,
      currentQVariance,
      currentQActualDelivered,
      currentQDelivered,
      currentQInvoiced,
      currentQHasData,
      currentQAllFinal: currentQHasFinal && !currentQHasLive,
      currentQAvgMonthInQ: currentQPaceWeight > 0
        ? currentQMonthInQWeighted / currentQPaceWeight
        : 0,
      currentQAvgQLength: currentQPaceWeight > 0
        ? currentQQLengthWeighted / currentQPaceWeight
        : 0,
      newCount,
      lifetimeDelivered, lifetimeInvoiced, lifetimeSow, lifetimePublished,
    });
    perClientByPod.set(pod, clientRows);
  }

  podRows.sort((a, b) => sortPodKey(a.pod, b.pod));
  return { podRows, perClientByPod };
}

function PodDeliveryRowHeader({
  row,
  open,
  onToggle,
  podAxis,
}: {
  row: PodDeliveryRow;
  open: boolean;
  onToggle: () => void;
  podAxis: "editorial" | "growth";
}) {
  const cbPct = row.cbGoal > 0 ? (row.cbDel / row.cbGoal) * 100 : null;
  const adPct = row.adGoal > 0 ? (row.adDel / row.adGoal) * 100 : null;
  const lifetimePct = row.lifetimeSow > 0
    ? Math.round((row.lifetimeDelivered / row.lifetimeSow) * 100)
    : null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`grid w-full ${DELIVERY_GRID} ${DELIVERY_DIVIDERS} items-center gap-3 py-3 px-3 text-left transition-colors hover:bg-[#1a1a1a]`}
    >
      <ChevronRight
        className={
          "h-3.5 w-3.5 text-[#606060] transition-transform " +
          (open ? "rotate-90" : "")
        }
      />
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span
          className="inline-block h-2 w-2 rounded-full shrink-0 self-center"
          style={{ backgroundColor: POD_HEX_COLORS[row.pod] ?? "#606060" }}
        />
        <span
          className="truncate font-mono text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: POD_HEX_COLORS[row.pod] ?? "#C4BCAA" }}
        >
          {displayPod(row.pod, podAxis)}
        </span>
        <span className="font-mono text-[10px] text-[#606060]">
          ({row.clients.length})
        </span>
      </div>
      {/* Goals — stacked so the values can't overflow into Last Q */}
      <div className="space-y-1.5">
        <MiniProgress label="CBs" del={row.cbDel} goal={row.cbGoal} pct={cbPct} />
        <MiniProgress label="Articles" del={row.adDel} goal={row.adGoal} pct={adPct} />
      </div>
      {/* Current Q — coloured by tier. Bar uses ACTUAL delivered to
          date (currentQActualDelivered), NOT the projected end-of-Q
          number — that way the bar reflects real progress so far.
          The variance + tier are still computed from the projected
          end-of-Q outcome. */}
      <QTile
        kind={row.currentQAllFinal ? "last" : "current"}
        isFinal={row.currentQAllFinal}
        variance={row.currentQHasData ? row.currentQVariance : null}
        delivered={row.currentQActualDelivered}
        invoiced={row.currentQInvoiced}
        sow={row.lifetimeSow}
        newCount={row.newCount}
      />
      {/* %SOW (lifetime delivered ÷ contracted SOW) */}
      <div className="text-center">
        <p className="font-mono text-base font-bold tabular-nums leading-none text-white">
          {lifetimePct !== null ? `${lifetimePct}%` : "—"}
        </p>
        <p className="mt-0.5 font-mono text-[10px] tabular-nums text-[#C4BCAA]">
          {row.lifetimeSow > 0
            ? `${row.lifetimeDelivered.toLocaleString()} / ${row.lifetimeSow.toLocaleString()}`
            : "—"}
        </p>
      </div>
      {/* %Published (published_live ÷ contracted SOW) — pulled from
          cumulative_metrics, sums across the pod's clients. */}
      <div className="text-center">
        <p className="font-mono text-base font-bold tabular-nums leading-none text-white">
          {row.lifetimeSow > 0
            ? `${Math.round((row.lifetimePublished / row.lifetimeSow) * 100)}%`
            : "—"}
        </p>
        <p className="mt-0.5 font-mono text-[10px] tabular-nums text-[#C4BCAA]">
          {row.lifetimeSow > 0
            ? `${row.lifetimePublished.toLocaleString()} / ${row.lifetimeSow.toLocaleString()}`
            : "—"}
        </p>
      </div>
    </button>
  );
}

/** Bigger variance display used in the pod summary row. Compact variant for
 *  per-client rows lives in ClientQCell.
 *
 *  Layout:
 *    variance (big, colored)
 *    tier label (colored)
 *    delivered / invoiced  (single line for Last Q)
 *    OR  NOW del / inv  +  END del / inv  (two lines for projected Current Q)
 *
 *  `projected` flips the value digits to italic — visual cue that the
 *  big variance number is a forecast, not an actual close. When
 *  `actualDelivered` is provided, the tile shows the two-line NOW/END
 *  breakdown instead of a single delivered/invoiced line. */
function QTile({
  variance,
  delivered,
  invoiced,
  sow,
  newCount,
  muted = false,
  kind,
  isFinal = false,
}: {
  variance: number | null;
  /** Delivered cumulative through end of THIS Q (per-Q snapshot, not
   *  lifetime). Drives the %Delivered bar's numerator. */
  delivered: number;
  /** Invoiced cumulative through end of THIS Q (per-Q snapshot). */
  invoiced: number;
  /** Contracted SOW (lifetime — constant across Qs). */
  sow: number;
  newCount?: number;
  /** Render in muted greys. Used for Last Q so the eye lands on
   *  Current Q (the actionable column). */
  muted?: boolean;
  /** "current" → End-of-Q chip; "last" → Last Close chip. Drives chip
   *  wording only; the rest of the layout is identical. */
  kind: "last" | "current";
  /** Pod whose Current Q total is entirely last-ended-quarter data (all
   *  clients inactive) — show the "Last full Q" badge above the bars. */
  isFinal?: boolean;
}) {
  if (variance === null) {
    return (
      <div className="text-center font-mono text-[10px] text-[#606060]">
        {newCount && newCount > 0 ? (
          <span className="rounded-sm bg-[#8FB5D9]/15 px-1.5 py-0.5 text-[#8FB5D9]">
            {newCount} new (1st Q)
          </span>
        ) : (
          "—"
        )}
      </div>
    );
  }
  // Tier drives the End-of-Q chip's colour. When `muted`, every shade
  // collapses to mid-grey so Last Q stays calm against Current Q.
  const base = varianceTier(variance);
  const tier = muted ? { color: "#909090", label: base.label } : base;
  const barColor = muted ? "#909090" : "#42CA80";
  return (
    <div className="space-y-1">
      {isFinal && (
        <div className="flex items-center">
          <FinalQBadge text="Last full Q" />
        </div>
      )}
      <div className="flex items-center gap-2 font-mono text-[10px] tabular-nums">
        {/* LEFT: the two progress bars take the lion's share of the cell. */}
        <div className="flex-1 min-w-0 space-y-1.5 text-left">
          <LifetimeBar
            label="Delivered"
            num={delivered}
            numUnit="delivered"
            denom={invoiced}
            denomUnit="invoiced"
            color={barColor}
            muted={muted}
          />
          <LifetimeBar
            label="Invoiced"
            num={invoiced}
            numUnit="invoiced"
            denom={sow}
            denomUnit="SOW"
            color={barColor}
            muted={muted}
          />
        </div>
        {/* RIGHT: variance + tier hugs the bars on the right. Compact
            vertical badge — same data as the old QInfoBlock, smaller
            footprint, visually attached to the bars they explain. */}
        <QInfoBlock
          qLabel=""
          variance={variance}
          tier={tier}
          chipLabel={kind === "current" ? "End of quarter" : "Last quarter"}
          muted={muted}
        />
      </div>
    </div>
  );
}

/** Stacked bar — label + percentage on the first line, full-width bar
 *  beneath, raw num/denom on the third line. Used for the two per-Q
 *  ratios on Current Q + Last Q tiles. Vertical layout so the bar
 *  always takes the full cell width. The `muted` flag washes everything
 *  to grey so Last Q can sit next to a coloured Current Q without
 *  fighting for attention. */
function LifetimeBar({
  label,
  num,
  numUnit,
  denom,
  denomUnit,
  color,
  muted = false,
}: {
  label: string;
  num: number;
  numUnit: string;
  denom: number;
  denomUnit: string;
  color: string;
  muted?: boolean;
}) {
  const pct = denom > 0 ? Math.min(100, (num / denom) * 100) : 0;
  const pctText = denom > 0 ? `${Math.round((num / denom) * 100)}%` : "—";
  const labelColor = muted ? "text-[#707070]" : "text-[#909090]";
  const pctColor = muted ? "text-[#909090]" : "text-white";
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-1 font-mono text-[10px] tabular-nums">
        <span className={`uppercase tracking-wider ${labelColor}`}>{label}</span>
        <span className={`text-[12px] font-bold ${pctColor}`}>{pctText}</span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-sm bg-[#1a1a1a]">
        <div
          className="absolute top-0 bottom-0 left-0 rounded-sm"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <p className="font-mono text-[10px] tabular-nums text-[#606060]">
        {denom > 0 ? (
          <>
            <span className={muted ? "text-[#707070]" : "text-[#C4BCAA]"}>{num.toLocaleString()}</span> {numUnit} <span className="text-[#404040]">/</span> {denom.toLocaleString()} {denomUnit}
          </>
        ) : "—"}
      </p>
    </div>
  );
}

/** End-of-Q variance chip — mirrors the Client Delivery cards' chip
 *  format ("END-OF-Q VARIANCE X · TIER") so the two surfaces share one
 *  vocabulary. Compact, single-line. */
function EndOfQChip({
  variance,
  tier,
  chipLabel = "End-of-Q",
}: {
  variance: number;
  tier: { color: string; label: string };
  /** "End-of-Q" for Current Q, "Last Close" for Last Q. */
  chipLabel?: string;
}) {
  const sign = variance > 0 ? "+" : "";
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider"
      style={{ borderColor: `${tier.color}40`, backgroundColor: `${tier.color}12` }}
    >
      <span className="text-[#909090]">{chipLabel}</span>
      <span className="tabular-nums font-semibold" style={{ color: tier.color }}>
        {sign}{Math.round(variance)}
      </span>
      <span className="text-[#606060]">·</span>
      <span style={{ color: tier.color }}>{tier.label}</span>
    </div>
  );
}

function MiniProgress({
  label,
  del,
  goal,
  pct,
}: {
  label: string;
  del: number;
  goal: number;
  pct: number | null;
}) {
  const color = pct === null
    ? "#606060"
    : pct >= 90 ? "#42CA80"
    : pct >= 70 ? "#F5C542"
    : "#ED6958";
  const width = pct === null ? 0 : Math.min(100, Math.max(0, pct));
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 font-mono text-[10px]">
        <span className="uppercase tracking-wider text-[#606060]">{label}</span>
        <span className="tabular-nums text-[#C4BCAA]">
          {goal > 0 ? (
            <>
              <span className="font-semibold text-white">{Math.round(del)}</span>
              <span className="text-[#606060]"> / {Math.round(goal)}</span>
            </>
          ) : "—"}
          {pct !== null && (
            <span className="ml-1" style={{ color }}>
              ({Math.round(pct)}%)
            </span>
          )}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-sm bg-[#0d0d0d]">
        <div
          className="h-full"
          style={{ width: `${width}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function PerClientDeliveryList({
  rows,
  onOpenDetail,
}: {
  rows: PerClientRow[];
  onOpenDetail: (d: DetailState) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-6 py-3 text-[11px] text-[#606060]">
        No clients in this pod for the selected period.
      </p>
    );
  }
  const openCell = (
    kind: DetailState["kind"],
    row: PerClientRow,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    onOpenDetail({
      kind,
      clientId: row.id,
      clientName: row.name,
      anchorX: e.clientX,
      anchorY: e.clientY,
    });
    trackEvent("DrillDownOpened", {
      route: typeof window !== "undefined" ? window.location.pathname : "/",
      section_id: "period-snapshot",
      props: { variant: kind },
    });
  };
  return (
    <div className="bg-[#0d0d0d]/40 py-1.5">
      {rows.map((r, idx) => {
        const cbPct = r.cbGoal > 0 ? (r.cbDel / r.cbGoal) * 100 : null;
        const adPct = r.adGoal > 0 ? (r.adDel / r.adGoal) * 100 : null;
        const lifetimePct = r.lifetimeSow > 0
          ? Math.round((r.lifetimeDelivered / r.lifetimeSow) * 100)
          : null;
        return (
          <div
            key={r.id}
            className={`grid ${DELIVERY_GRID} ${DELIVERY_DIVIDERS} items-center gap-3 px-3 py-2 border-b border-[#1a1a1a] last:border-b-0 ${idx % 2 === 1 ? "bg-[#0e0e0e]" : ""} hover:bg-[#1a1a1a]`}
          >
            {/* col 1: indent under chevron */}
            <span />
            {/* col 2: client name → opens "client" summary popover */}
            <CellButton onClick={(e) => openCell("client", r, e)} ariaLabel={`Open snapshot for ${r.name}`}>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="truncate font-mono text-[11px] text-[#C4BCAA]">
                  {r.name}
                </span>
                {r.isNew && (
                  <span className="shrink-0 rounded-sm bg-[#8FB5D9]/15 px-1 py-px font-mono text-[8px] uppercase tracking-wider text-[#8FB5D9]">
                    1ST Q
                  </span>
                )}
              </div>
            </CellButton>
            {/* col 3: goals → opens "goals" monthly table */}
            <CellButton onClick={(e) => openCell("goals", r, e)} ariaLabel={`Open goals detail for ${r.name}`}>
              <div className="space-y-0.5">
                <ClientGoalCell label="CBs" del={r.cbDel} goal={r.cbGoal} pct={cbPct} />
                <ClientGoalCell label="Articles" del={r.adDel} goal={r.adGoal} pct={adPct} />
              </div>
            </CellButton>
            {/* col 4: current Q → opens "currentQ" detail.
                Bar uses ACTUAL delivered-to-date (cumulative through
                last completed month), NOT projected end-of-Q. The chip
                still shows END-OF-Q variance — the only thing that's
                projection-based is the variance number. */}
            <CellButton
              onClick={(e) => openCell(r.currentQ?.isFinal ? "lastQ" : "currentQ", r, e)}
              ariaLabel={`Open ${r.currentQ?.isFinal ? "last" : "current"} Q detail for ${r.name}`}
            >
              <ClientQCell
                label={r.currentQ?.label ?? "Curr Q"}
                kind={r.currentQ?.isFinal ? "last" : "current"}
                isFinal={r.currentQ?.isFinal ?? false}
                monthsLabel={r.currentQ?.monthsLabel}
                q={r.currentQ
                  ? {
                      delivered: r.currentQ.actualDelivered,
                      invoiced: r.currentQ.invoiced,
                      variance: r.currentQ.projectedVariance,
                    }
                  : null}
                isNew={r.isNew}
                sow={r.lifetimeSow}
              />
            </CellButton>
            {/* col 6: %SOW (lifetime delivered ÷ SOW) → opens "lifetime" detail */}
            <CellButton onClick={(e) => openCell("lifetime", r, e)} ariaLabel={`Open Lifetime detail for ${r.name}`}>
              <div className="text-center">
                <p className="font-mono text-[11px] font-bold tabular-nums text-white">
                  {lifetimePct !== null ? `${lifetimePct}%` : "—"}
                </p>
                <p className="font-mono text-[9px] tabular-nums text-[#909090]">
                  {r.lifetimeSow > 0
                    ? `${r.lifetimeDelivered}/${r.lifetimeSow}`
                    : "—"}
                </p>
              </div>
            </CellButton>
            {/* col 7: %Published (published_live ÷ SOW) — read-only,
                no popover yet since we don't have a dedicated detail
                view for it. Sourced from cumulative_metrics. */}
            <div className="text-center px-1">
              <p className="font-mono text-[11px] font-bold tabular-nums text-white">
                {r.lifetimeSow > 0
                  ? `${Math.round((r.lifetimePublished / r.lifetimeSow) * 100)}%`
                  : "—"}
              </p>
              <p className="font-mono text-[9px] tabular-nums text-[#909090]">
                {r.lifetimeSow > 0
                  ? `${r.lifetimePublished}/${r.lifetimeSow}`
                  : "—"}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Clickable wrapper for a cell. Resets the default `<button>` look so the
 *  cell looks identical to the static version — just hoverable + focusable. */
function CellButton({
  children,
  onClick,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="rounded-sm text-left transition-colors hover:bg-[#1f1f1f] focus:outline-none focus:ring-1 focus:ring-[#42CA80]/40 px-1 -mx-1 cursor-pointer"
    >
      {children}
    </button>
  );
}

/** Per-client Goals cell — same layout as the pod summary's
 *  MiniProgress (label + num/goal + percentage on top, progress bar
 *  below). Delegates to MiniProgress so both rows render identically;
 *  call sites just pass the canonical "CBs" / "Articles" labels. */
function ClientGoalCell({
  label,
  del,
  goal,
  pct,
}: {
  label: string;
  del: number;
  goal: number;
  pct: number | null;
}) {
  return <MiniProgress label={label} del={del} goal={goal} pct={pct} />;
}

function ClientQCell({
  label,
  q,
  sow,
  isNew,
  kind,
  muted = false,
  isFinal = false,
  monthsLabel,
}: {
  label: string;
  q: {
    delivered: number;     // cumulative through end of THIS Q
    invoiced: number;      // cumulative through end of THIS Q
    variance: number;
  } | null;
  /** Lifetime contracted SOW — constant; used as the denominator on
   *  the %Invoiced bar. */
  sow: number;
  isNew?: boolean;
  kind: "last" | "current";
  /** Render in muted greys. Last Q passes `muted` so it stays calm
   *  against a coloured Current Q in the same row. */
  muted?: boolean;
  /** This is an inactive client's LAST ended quarter shown in the Current Q
   *  column — render a "Last full Q" badge + month span so it's unmistakable
   *  the numbers aren't an in-progress quarter. */
  isFinal?: boolean;
  monthsLabel?: string;
}) {
  if (!q) {
    return (
      <div className="flex items-center gap-2 font-mono text-[10px] tabular-nums">
        <QSideLabel text={label} muted />
        <span className="text-[#606060]">{isNew ? "1st Q" : "—"}</span>
      </div>
    );
  }
  // 1st-Q new clients keep the blue chip; Current Q uses full tier
  // palette; Last Q renders in mid-grey (driven by `muted`).
  const base = varianceTier(q.variance, isNew);
  const color = muted && !isNew ? "#909090" : base.color;
  const tierLabel = base.label;
  const barColor = muted ? "#909090" : "#42CA80";
  return (
    <div className="space-y-1">
      {/* Inactive client: a "Last full Q" badge + the quarter's month span
          above the bars makes it unmistakable the Current Q column is showing
          the last ended quarter, not an in-progress one. */}
      {isFinal && (
        <div className="flex items-center gap-1.5">
          <FinalQBadge text="Last full Q" />
          <span className="truncate font-mono text-[9px] tabular-nums text-[#707070]">
            {label}
            {monthsLabel ? ` · ${monthsLabel}` : ""}
          </span>
        </div>
      )}
      <div className="flex items-center gap-2 font-mono text-[10px] tabular-nums">
        {/* LEFT: the two progress bars take the lion's share. */}
        <div className="flex-1 min-w-0 space-y-1.5 text-left">
          <LifetimeBar
            label="Delivered"
            num={q.delivered}
            numUnit="delivered"
            denom={q.invoiced}
            denomUnit="invoiced"
            color={barColor}
            muted={muted}
          />
          <LifetimeBar
            label="Invoiced"
            num={q.invoiced}
            numUnit="invoiced"
            denom={sow}
            denomUnit="SOW"
            color={barColor}
            muted={muted}
          />
        </div>
        {/* RIGHT: Q label + variance chip stacked — sits adjacent to the
            bars it explains. The Q label is suppressed for a final quarter
            since the badge above already names it. */}
        <QInfoBlock
          qLabel={isFinal ? "" : label}
          variance={q.variance}
          tier={{ color, label: tierLabel }}
          chipLabel={kind === "current" ? "End of quarter" : "Last quarter"}
          muted={muted}
        />
      </div>
    </div>
  );
}

/** Small grey pill marking past-quarter / past-month reference data — mirrors
 *  the "Last Full Q" badge on the Client Delivery cards so the two surfaces
 *  read the same. */
function FinalQBadge({ text }: { text: string }) {
  return (
    <span
      className="shrink-0 rounded-sm px-1.5 py-px font-mono text-[8px] font-semibold uppercase tracking-wider"
      style={{ color: "#909090", backgroundColor: "rgba(144,144,144,0.10)" }}
    >
      {text}
    </span>
  );
}

/** LEFT block of a Q cell — Q label + variance + tier label, all
 *  vertically stacked into a single column to the left of the bars.
 *  Replaces the EndOfQChip that used to sit below the bars; the chip
 *  data now reads top-to-bottom in this block:
 *    1) Q label  (e.g. "Q1", "Q2 Y2")
 *    2) Variance (e.g. "−15")
 *    3) Tier     (e.g. "Behind", "Ahead", "Within limit")
 *  Tier colour drives all three lines (muted grey for Last Q). */
function QInfoBlock({
  qLabel,
  variance,
  tier,
  chipLabel,
  muted = false,
}: {
  qLabel: string;
  variance: number;
  tier: { color: string; label: string };
  chipLabel: "End of quarter" | "Last quarter";
  muted?: boolean;
}) {
  const sign = variance > 0 ? "+" : "";
  const labelColor = muted ? "#707070" : tier.color;
  // Plain-language gloss under the number — replaces the old uppercase tier
  // word ("WITHIN LIMIT") so non-editorial readers know what the number means.
  // 1st-Q clients carry the blue "1st Q" tier, so detect them off the label.
  const isNew = tier.label === "1st Q";
  const subline = varianceSubline(variance, isNew);
  // As-of month comes from the Editorial week distribution (NOT the calendar).
  const asOf = useEditorialAsOf();
  const isCurrent = chipLabel === "End of quarter";
  // The tier rule, stated correctly: 0 is on track, anything within ±5 (either
  // direction) is within limit, only beyond ±5 is flagged behind/ahead. 1st-Q
  // clients are exempt while they ramp, so swap in a note instead of the rule.
  const ruleBullet = isNew
    ? "1st contract quarter — still ramping, so not flagged."
    : "0 on track · within ±5 within limit · beyond ±5 behind/ahead.";
  const tipBullets = isCurrent
    ? [
        "Articles delivered − invoiced, projected to the quarter's end.",
        ruleBullet,
        `As of ${asOf.label}${asOf.isFallback ? " (calendar)" : ""}.`,
      ]
    : [
        "Articles delivered − invoiced at the last quarter's close.",
        ruleBullet,
      ];
  return (
    <div className="shrink-0 w-[5.5rem] flex flex-col items-stretch gap-1 font-mono tabular-nums">
      {qLabel && (
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: labelColor }}
        >
          {qLabel}
        </span>
      )}
      {/* Variance enclosure — tier-coloured border + faint tint so the
          variance reads as a self-contained badge attached to the bars
          on its left. Variance NUMBER is the focal element (xl), the chip
          label above it, and a plain-language gloss below it. Hover for the
          short explanation of what end-of-quarter variance means. */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <div
                className="w-full rounded-md border px-2 py-1.5 flex flex-col items-center gap-0.5 cursor-help"
                style={{
                  borderColor: `${labelColor}66`,
                  backgroundColor: `${labelColor}12`,
                }}
              />
            }
          >
            <span
              className="text-[9px] uppercase tracking-wider leading-tight text-center"
              style={{ color: muted ? "#606060" : "#909090" }}
            >
              {chipLabel}
            </span>
            <span
              className="text-xl font-bold leading-none tabular-nums"
              style={{ color: labelColor }}
            >
              {sign}
              {Math.round(variance)}
            </span>
            <span
              className="text-[8px] leading-tight text-center"
              style={{ color: muted ? "#606060" : "#909090" }}
            >
              {subline}
            </span>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-[16rem] text-xs leading-relaxed">
            <TooltipBody title={chipLabel} bullets={tipBullets} />
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

/** Compact horizontal Q label rendered to the left of the bars
 *  (e.g. "Q1", "Q2 Y2"). Plain text — no card, no border, no rotation —
 *  so the row reads naturally left-to-right and the label can be
 *  scanned at a glance. Tier colour (or muted grey for Last Q) tints
 *  the text so the eye still picks the right column. */
function QSideLabel({
  text,
  muted = false,
  accent,
}: {
  text: string;
  muted?: boolean;
  accent?: string;
}) {
  const color = muted ? "#707070" : accent ?? "#909090";
  return (
    <span
      className="shrink-0 w-9 self-center text-left font-mono text-[10px] font-semibold uppercase tracking-wider tabular-nums"
      style={{ color }}
    >
      {text}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pod TTM Stat Cards
//
// Right half of the PMJ + TTM row below Pod Delivery Progress. Shows the
// same 8 milestone-transition averages as TimeToMetrics (CKO→EKO, CKO→CB,
// CKO→Article, CKO→Feedback, CB→Article, CKO→Published, Article→Feedback,
// Feedback→Published) but in a compact 4×2 card grid instead of a timeline.
// Computes avg / min / max across ALL filtered clients (not per-pod).
// ─────────────────────────────────────────────────────────────────────────────

interface TTMMetricDef {
  key: string;
  short: string;
  subtitle: string;
  /** If omitted, `consulting_ko_date` is the from anchor. */
  from?: string;
  to: string;
  color: string;
}

/** One contributor row inside a TTM card's hover popup. */
interface TTMContributor {
  clientName: string;
  pod: string;
  fromDate: string | null;
  toDate: string | null;
  days: number;
}

/** Tooltip payload for the TTM cards hover popup. */
interface TTMTip {
  x: number;
  y: number;
  stat: TTMMetricDef & {
    avg: number | null;
    min: number | null;
    max: number | null;
    count: number;
    contributors: TTMContributor[];
  };
}

// Canonical milestone names — match the Pod Timelines legend exactly so
// the names read identically across every surface (cards, legend,
// dropdown, tooltips). "short" is just used as the card title now.
const TTM_METRICS: TTMMetricDef[] = [
  { key: "cko_eko", short: "Consulting KO → Editorial KO",      subtitle: "Growth-to-Editorial handoff",     to: "editorial_ko_date",             color: "#F28D59" },
  { key: "cko_cb",  short: "Consulting KO → First CB Approved", subtitle: "Kickoff to first brief approved", to: "first_cb_approved_date",        color: "#42CA80" },
  { key: "cko_art", short: "Consulting KO → First Article",     subtitle: "Kickoff to first article",         to: "first_article_delivered_date",  color: "#8FB5D9" },
  { key: "cko_fb",  short: "Consulting KO → First Feedback",    subtitle: "Kickoff to first feedback",        to: "first_feedback_date",           color: "#F5BC4E" },
  { key: "cb_art",  short: "First CB Approved → First Article", subtitle: "Brief approval to delivery",      from: "first_cb_approved_date",  to: "first_article_delivered_date", color: "#65FFAA" },
  { key: "cko_pub", short: "Consulting KO → First Published",   subtitle: "Full cycle to live publication",  to: "first_article_published_date",  color: "#CEBCF4" },
  { key: "art_fb",  short: "First Article → First Feedback",    subtitle: "Delivery to client response",   from: "first_article_delivered_date", to: "first_feedback_date",       color: "#F5C542" },
  { key: "fb_pub",  short: "First Feedback → First Published",  subtitle: "Feedback to article going live", from: "first_feedback_date",    to: "first_article_published_date", color: "#7FE8D6" },
];

function daysBetweenTTM(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.round(ms / 86_400_000);
}

function PodTTMStatsCard({
  clients,
  linkedHover,
  onHoverChange,
  focusedClientName,
}: {
  clients: Client[];
  linkedHover: LinkedHover;
  onHoverChange: (h: LinkedHover) => void;
  /** When set, the card title carries the client name as a chip — the
   *  parent has narrowed `clients` to a single client (the user
   *  clicked one in Pod Timelines), so the stats now describe only
   *  that client. Surfaces the scope so the avg/range numbers aren't
   *  silently re-scoped. */
  focusedClientName?: string | null;
}) {
  const { axis: podAxisInner } = useCurrentPodAxis();
  const stats = useMemo(() => {
    return TTM_METRICS.map((m) => {
      const values: number[] = [];
      const contributors: TTMContributor[] = [];
      for (const c of clients) {
        const raw = c as unknown as Record<string, string | null>;
        const fromDate = m.from ? raw[m.from] : c.consulting_ko_date;
        const toDate = raw[m.to];
        const d = daysBetweenTTM(fromDate, toDate);
        // Keep negative day-deltas (a milestone logged before its predecessor,
        // e.g. a CB approved before the Consulting KO date). Dropping them here
        // made this card read "—" while the Pod Timelines + Per-Client Days
        // cards still showed the value — those two only null-filter, so this
        // matches them. A data quirk should look the same on every card.
        if (d !== null) {
          values.push(d);
          const rawPod =
            podAxisInner === "growth" ? c.growth_pod : c.editorial_pod;
          contributors.push({
            clientName: c.name,
            pod: normalizePod(rawPod),
            fromDate: fromDate ?? null,
            toDate: toDate ?? null,
            days: d,
          });
        }
      }
      const avg = values.length > 0
        ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
        : null;
      const min = values.length > 0 ? Math.min(...values) : null;
      const max = values.length > 0 ? Math.max(...values) : null;
      return { ...m, avg, min, max, count: values.length, contributors };
    });
  }, [clients, podAxisInner]);

  // Tip state lives at the parent so individual cards can hand off the
  // mouse to a single popup without each managing its own.
  const [tip, setTip] = useState<TTMTip | null>(null);

  return (
    <div className="flex h-full flex-col rounded-lg border border-[#2a2a2a] bg-[#161616] p-4">
      {/* Title row — subtitle pushed to the RIGHT so the header sits on
          a single line. When a client is selected in Pod Timelines the
          name is shown as a green chip next to the title so the scope
          change is visible at a glance. */}
      <div className="flex-none flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA] shrink-0">
            Time-to-Metrics
          </p>
          {focusedClientName && (
            <span className="truncate rounded-sm border border-[#42CA80]/40 bg-[#42CA80]/10 px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-[#42CA80]">
              {focusedClientName}
            </span>
          )}
        </div>
        <p className="text-[11px] text-[#606060] shrink-0">
          Avg days · {clients.length} client{clients.length === 1 ? "" : "s"}
        </p>
      </div>
      {/* 2-column x 4-row grid — each row stretches with auto-rows-fr so
          the 8 cards fill the available vertical space, matching the
          height of the Pod Timelines card next to it. Wider cards give
          us room for the canonical milestone names (e.g.
          "Consulting KO → First Article" instead of "CKO → ARTICLE"). */}
      <div className="mt-3 grid flex-1 grid-cols-2 gap-2 auto-rows-fr">
        {stats.map((m) => (
          <TTMStatCard
            key={m.key}
            stat={m}
            linkedHover={linkedHover}
            onHoverChange={onHoverChange}
            onShowTip={setTip}
            onHideTip={() => setTip(null)}
            podAxis={podAxisInner}
          />
        ))}
      </div>
      {tip && <TTMContributorsTooltip tip={tip} podAxis={podAxisInner} />}
    </div>
  );
}

function TTMStatCard({
  stat,
  linkedHover,
  onHoverChange,
  onShowTip,
  onHideTip,
}: {
  stat: TTMMetricDef & {
    avg: number | null;
    min: number | null;
    max: number | null;
    count: number;
    contributors: TTMContributor[];
  };
  linkedHover: LinkedHover;
  onHoverChange: (h: LinkedHover) => void;
  onShowTip: (t: TTMTip) => void;
  onHideTip: () => void;
  podAxis: "editorial" | "growth";
}) {
  const fromField = stat.from ?? "consulting_ko_date";
  // Card is "matched" when the active hover refers to this transition,
  // OR (for milestone hover) when this card has that milestone as either
  // its from or to endpoint.
  const matched =
    linkedHover?.kind === "pair"
      ? linkedHover.from === fromField && linkedHover.to === stat.to
      : linkedHover?.kind === "milestone"
        ? linkedHover.field === fromField || linkedHover.field === stat.to
        : null;
  // null = nothing hovered → render normally. false = something hovered
  // elsewhere AND this card doesn't match → dim. true = match → keep
  // full opacity + accent border.
  const dim = matched === false;
  return (
    <div
      className={
        "rounded-md border bg-[#111] p-2 transition-opacity cursor-default " +
        (matched === true
          ? "border-[#42CA80]/60"
          : "border-[#1a1a1a]") +
        (dim ? " opacity-35" : "")
      }
      onMouseEnter={(e) => {
        onHoverChange({ kind: "pair", from: fromField, to: stat.to });
        const r = e.currentTarget.getBoundingClientRect();
        onShowTip({
          // Anchor the tooltip just above the card's top edge,
          // centered horizontally. The popup itself positions via
          // translate(-50%, -100%).
          x: r.left + r.width / 2,
          y: r.top - 8,
          stat,
        });
      }}
      onMouseLeave={() => {
        onHoverChange(null);
        onHideTip();
      }}
    >
      <p className="font-mono text-[9px] uppercase tracking-wider text-[#606060] truncate" title={stat.subtitle}>
        {stat.short}
      </p>
      {/* Avg on the LEFT, range + count stacked on the RIGHT — the
          right column is top-aligned with the avg's first line so
          "min – max" lands on the same row as the big "17 d" number,
          then "6 clients" sits directly under it. */}
      <div className="mt-1 flex items-start justify-between gap-2">
        <p className="font-mono leading-none">
          {stat.avg !== null ? (
            <>
              <span className="text-xl font-bold tabular-nums" style={{ color: stat.color }}>
                {stat.avg}
              </span>
              <span className="ml-0.5 text-[9px] text-[#606060]">d</span>
            </>
          ) : (
            <span className="text-[14px] text-[#606060]">—</span>
          )}
        </p>
        <div className="text-right font-mono text-[8px] tabular-nums leading-tight">
          {stat.min !== null && stat.max !== null && (
            <p className="text-[#606060]">
              {stat.min}d – {stat.max}d
            </p>
          )}
          <p className="text-[#909090]">
            {stat.count} client{stat.count === 1 ? "" : "s"}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pod Milestone Journey (left card in the Pod Pace section)
//
// Mirrors the "Client Milestone Journey" timeline from TimeToMetrics.tsx —
// dots on a horizontal day-axis — but groups clients into collapsible pod
// rows. Pods are collapsed by default; expanding sorts clients within by
// longest-journey-first (max milestone day desc).
// ─────────────────────────────────────────────────────────────────────────────

// Hex pod colors — mirror of the local map in TimeToMetrics.tsx. Kept inline
// so this card doesn't depend on the legacy file's private constants.
// Shared animation variants for the pod-journey expand/collapse. Defined at
// module scope so the same easing + timings drive BOTH directions:
//   • Enter (expand): parent grows height + fades in, then rows cascade.
//   • Exit (collapse): rows cascade OUT in reverse, then parent shrinks.
// Variants propagate via context so the row motion.divs inside JourneyTimeline
// pick up "hidden"/"visible" from the panel even though they're nested through
// non-motion wrapper divs.
const JOURNEY_PANEL_VARIANTS = {
  visible: {
    opacity: 1,
    height: "auto",
    transition: {
      // Stretch height duration so the card GROWS gradually alongside
      // the row cascade, not snap-open then fade rows in. Total cascade
      // for ~7 rows ≈ 0.05*6 + 0.22 = 0.52s — match the height to it.
      opacity: { duration: 0.28, ease: [0.22, 1, 0.36, 1] },
      height: { duration: 0.52, ease: [0.22, 1, 0.36, 1] },
      staggerChildren: 0.05,
      delayChildren: 0,
    },
  },
  hidden: {
    opacity: 0,
    height: 0,
    transition: {
      // Mirror the expand: rows cascade out in reverse while height
      // shrinks. Same total duration so collapse feels symmetric.
      opacity: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
      height: { duration: 0.42, ease: [0.22, 1, 0.36, 1] },
      staggerChildren: 0.03,
      staggerDirection: -1,
    },
  },
} as const;

const JOURNEY_ROW_VARIANTS = {
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
  },
  hidden: {
    opacity: 0,
    x: -8,
    transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
  },
} as const;

const POD_HEX_COLORS: Record<string, string> = {
  "Pod 1": "#8FB5D9",
  "Pod 2": "#42CA80",
  "Pod 3": "#F5C542",
  "Pod 4": "#F28D59",
  "Pod 5": "#ED6958",
  "Pod 6": "#CEBCF4",
  "Pod 7": "#7FE8D6",
  Unassigned: "#606060",
};

const JOURNEY: { key: string; label: string; field: string; color: string; shape: "circle" | "diamond" }[] = [
  { key: "eko", label: "Editorial KO", field: "editorial_ko_date", color: "#F28D59", shape: "diamond" },
  { key: "cb", label: "First CB Approved", field: "first_cb_approved_date", color: "#42CA80", shape: "circle" },
  { key: "article", label: "First Article", field: "first_article_delivered_date", color: "#8FB5D9", shape: "circle" },
  { key: "feedback", label: "First Feedback", field: "first_feedback_date", color: "#F5BC4E", shape: "circle" },
  { key: "published", label: "First Published", field: "first_article_published_date", color: "#CEBCF4", shape: "circle" },
];

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.round(ms / 86_400_000);
}

interface MilestoneEntry {
  key: string;
  /** DB column name for this milestone, e.g. `editorial_ko_date`. Used
   *  to match cross-card hover state to a specific milestone (since the
   *  TTM cards + Per-Client Days dropdown both key by field). */
  field: string;
  label: string;
  days: number;
  color: string;
  shape: "circle" | "diamond";
  /** ISO date when known (per-client rows). Absent on the per-pod average
   *  row, which carries no source dates. */
  date?: string | null;
}

interface ClientJourneyRow {
  client: Client;
  milestones: MilestoneEntry[];
  /** Max milestone day — used for longest-first sort and per-pod max scaling. */
  maxDay: number;
}

interface PodJourneyGroup {
  pod: string;
  rows: ClientJourneyRow[];
  /** Largest single-client journey in this pod, in days. */
  maxDay: number;
  /** Per-milestone average across the pod's clients (only clients that hit
   *  the milestone contribute). Empty array = no milestone data. Rendered
   *  as the collapsed-pod mini-timeline. */
  averages: MilestoneEntry[];
  /** Number of clients contributing to each average milestone (parallel to
   *  `averages`, same key order). Used by the average-row tooltip. */
  averageCounts: Map<string, number>;
}

/** Generic row shape consumed by JourneyTimeline. Works for both per-client
 *  rows (expanded view) and the per-pod average row (collapsed view). */
interface TimelineRow {
  id: string;
  name: string;
  /** DB id for client rows; undefined on the Avg row. Used by the
   *  parent card to focus the Time-to-Metrics cards on a single
   *  client when the user hovers that row. */
  clientId?: number;
  milestones: MilestoneEntry[];
  /** Whether to render the white-diamond CKO marker at day 0. */
  hasCKO: boolean;
  /** ISO CKO date — used as the "from" date in per-client tooltips. */
  ckoDate?: string | null;
  /** True → render the name in muted color (for rows with no milestones). */
  dimmed?: boolean;
  /** True → this row is an aggregate (the pod average). Toggles tooltip
   *  wording from real dates to "avg across N clients". */
  isAverage?: boolean;
  /** Per-milestone-key contributor counts (averages only). */
  averageCounts?: Map<string, number>;
}

/** Tooltip payload — kept rich so the popup can show real dates + every
 *  prior-milestone leg without re-deriving from the parent rows. */
interface JourneyTip {
  x: number;
  y: number;
  name: string;
  label: string;
  days: number;
  color: string;
  /** DB field for the focal milestone, used to render its number prefix
   *  in the tooltip header. */
  field?: string;
  fromDate?: string | null;
  toDate?: string | null;
  /** Days from each preceding milestone in journey order. Includes the
   *  field so the tooltip can render each leg's milestone number. */
  previousLegs?: { label: string; color: string; days: number; field?: string }[];
  isAverage?: boolean;
  contributingCount?: number;
}

function PodMilestoneJourneyCard({
  clients,
  podAxis,
  linkedHover,
  onHoverChange,
  onClientFocus,
  selectedClientId,
  selectedClientName,
}: {
  clients: Client[];
  podAxis: "editorial" | "growth";
  linkedHover: LinkedHover;
  onHoverChange: (h: LinkedHover) => void;
  /** Fired when the user clicks a single client's row. Passes the
   *  client's id; cleared (null) when the same row is clicked again.
   *  The parent uses this to re-scope the Time-to-Metrics cards. */
  onClientFocus?: (clientId: number | null) => void;
  /** Currently-selected client id from the parent. Drives the
   *  highlighted-row treatment in each pod's timeline. */
  selectedClientId?: number | null;
  /** Name of the selected client — surfaced as a chip in the header. */
  selectedClientName?: string | null;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tip, setTip] = useState<JourneyTip | null>(null);

  const groups = useMemo(
    () => aggregatePodJourney(clients, podAxis),
    [clients, podAxis],
  );

  // Auto-expand when the header filter narrows the scope to a single
  // pod. Without this the user has to manually click the chevron to see
  // their clients after they've already filtered to that pod. We only
  // trigger when the set of pods CHANGES (not on every render) so a
  // manual collapse inside a single-pod view sticks.
  const lastSinglePodRef = useRef<string | null>(null);
  useEffect(() => {
    const onlyPod = groups.length === 1 ? groups[0].pod : null;
    if (onlyPod && lastSinglePodRef.current !== onlyPod) {
      setExpanded(onlyPod);
    }
    lastSinglePodRef.current = onlyPod;
  }, [groups]);
  // Shared scale across all pods so they stay comparable, BUT only counts
  // what's actually rendered: a collapsed pod contributes its average max-day
  // (what shows on screen), an expanded pod contributes its longest client.
  // So a 117d outlier hiding inside a collapsed pod doesn't blow up the axis
  // when nothing on screen needs that range.
  const sharedScale = useMemo(() => {
    let max = 0;
    for (const g of groups) {
      if (expanded === g.pod) {
        max = Math.max(max, g.maxDay);
      } else {
        const avgMax = g.averages.length
          ? Math.max(...g.averages.map((m) => m.days))
          : 0;
        max = Math.max(max, avgMax);
      }
    }
    return Math.max(14, max) * 1.12;
  }, [groups, expanded]);

  const hasExpanded = expanded !== null;
  return (
    <div
      className="flex h-full flex-col rounded-lg border border-[#2a2a2a] bg-[#161616] p-4 relative"
      style={{ isolation: "isolate" }}
    >
      {/* Header — title + optional client chip on the LEFT (with
          subtitle stacked beneath), interaction hint on the FAR
          RIGHT. Hint stays out of the title flow so it doesn't
          compete with the chip for attention. */}
      <div className="flex-none flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA]">
              Pod Timelines
            </p>
            {selectedClientName && (
              <span className="truncate rounded-sm border border-[#42CA80]/40 bg-[#42CA80]/10 px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-[#42CA80]">
                {selectedClientName}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-[#606060]">
            Days since Consulting KO ·{" "}
            {groups.length === 1
              ? displayPod(groups[0].pod, podAxis)
              : `${groups.length} pods`}
          </p>
        </div>
        <p className="shrink-0 text-right text-[11px] italic text-[#707070]">
          click a client to focus · hover to highlight
        </p>
      </div>


      {/* Unified day-axis tick row — rendered ONCE above all pods so
          we don't redraw CKO/7d/14d labels for every pod. The dots in
          each pod's timeline below align to these ticks via the shared
          sharedScale + JOURNEY_LABEL_W. Uses the same pl-8 pr-2 +
          grid + mx-3 offsets as JourneyTimeline so positions match. */}
      {groups.length > 0 && (
        <div className="mt-3 pl-8 pr-2">
          <div
            className="grid"
            style={{ gridTemplateColumns: `${JOURNEY_LABEL_W}px 1fr` }}
          >
            <div />
            <div className="relative h-3.5 mx-3">
              {pickTicks(sharedScale).map((d) => (
                <span
                  key={d}
                  className={
                    "absolute font-mono text-[9px] " +
                    (d === 0 ? "font-bold text-white" : "text-[#606060]")
                  }
                  style={{
                    left: `${Math.min(Math.max((d / sharedScale) * 100, 0.5), 95)}%`,
                    transform: "translateX(-50%)",
                    transition: "left 280ms cubic-bezier(0.22, 1, 0.36, 1)",
                  }}
                >
                  {d === 0 ? "CKO" : `${d}d`}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className={"mt-1 divide-y divide-[#222] " + (hasExpanded ? "flex-1 min-h-0 flex flex-col" : "")}>
        {groups.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-[#606060]">
            No milestone data in scope.
          </p>
        ) : (
          groups.map((g) => {
            const open = expanded === g.pod;
            // When only one pod is in scope, collapsing it would leave
            // the card empty — disable the toggle so the user can't
            // accidentally hide their only data.
            const singlePodLocked = groups.length === 1;
            return (
              <PodJourneyGroupView
                key={g.pod}
                group={g}
                open={open}
                onToggle={
                  singlePodLocked
                    ? () => {}
                    : () => setExpanded(open ? null : g.pod)
                }
                podAxis={podAxis}
                scale={sharedScale}
                onShowTip={(payload) => setTip(payload)}
                onHideTip={() => setTip(null)}
                linkedHover={linkedHover}
                onHoverChange={onHoverChange}
                stretchExpanded={singlePodLocked}
                lockExpand={singlePodLocked}
                onClientFocus={onClientFocus}
                selectedClientId={selectedClientId}
              />
            );
          })
        )}
      </div>

      {/* Milestone legend — each chip is interactive (matches the
          cross-card hover state via LegendChip). */}
      <div className="flex-none mt-4 flex flex-wrap items-center gap-3 border-t border-[#2a2a2a] pt-3">
        <LegendChip
          field="consulting_ko_date"
          label="Consulting KO"
          color="white"
          shape="diamond"
          linkedHover={linkedHover}
          onHoverChange={onHoverChange}
        />
        {JOURNEY.map((m) => (
          <LegendChip
            key={m.key}
            field={m.field}
            label={m.label}
            color={m.color}
            shape={m.shape}
            linkedHover={linkedHover}
            onHoverChange={onHoverChange}
          />
        ))}
      </div>

      {tip && <JourneyTooltip tip={tip} />}
    </div>
  );
}

function fmtTipDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Force en-US so milestone dates render "9 Jan 2026", not the browser's
  // locale (e.g. Spanish "9 ene 2026"). The Hub is English-only.
  return d.toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function JourneyTooltip({ tip }: { tip: JourneyTip }) {
  const hasDates = !!(tip.fromDate || tip.toDate);
  const sameDate =
    hasDates && tip.fromDate && tip.toDate && tip.fromDate === tip.toDate;
  return (
    <div
      className="fixed z-[9999] pointer-events-none"
      style={{ left: tip.x, top: tip.y, transform: "translate(-50%, -100%)" }}
    >
      <div className="w-[260px] rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] shadow-xl overflow-hidden">
        {/* Header: client/avg + date window */}
        <div className="border-b border-[#222] px-3 py-2">
          <p className="text-[13px] font-semibold text-white truncate">
            {tip.name}
          </p>
          {hasDates && (
            <p className="mt-0.5 font-mono text-[10px] text-[#909090]">
              {sameDate
                ? fmtTipDate(tip.fromDate)
                : `${fmtTipDate(tip.fromDate)} → ${fmtTipDate(tip.toDate)}`}
            </p>
          )}
        </div>

        {/* Primary stat: days from CKO. Title is prefixed with the
            focal milestone's number so it ties back to the legend +
            TTM cards (e.g. "4 First Article"). CKO itself is #1. */}
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <div
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: tip.color }}
            />
            <span className="font-mono text-[11px] uppercase tracking-wider text-[#C4BCAA] truncate">
              {tip.label}
            </span>
          </div>
          <p className="mt-1.5 font-mono">
            <span className="text-xl font-bold tabular-nums text-white">
              {tip.days}d
            </span>
            <span className="ml-1.5 text-[11px] text-[#909090]">
              from <span className="text-[#C4BCAA]">Consulting KO</span>
            </span>
          </p>
        </div>

        {/* Previous legs — days first, then label. Each leg's label
            carries its milestone number so the user can map back to the
            legend / TTM card / dropdown numbers. */}
        {tip.previousLegs && tip.previousLegs.length > 0 && (
          <div className="border-t border-[#222] px-3 py-2">
            <p className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-[#606060]">
              After previous milestones
            </p>
            <div className="space-y-1">
              {tip.previousLegs.map((leg) => {
                return (
                  <div
                    key={leg.label}
                    className="grid grid-cols-[2.5rem_1fr] items-center gap-2 font-mono text-[11px]"
                  >
                    <span className="text-right font-bold tabular-nums text-white">
                      {leg.days}d
                    </span>
                    <span className="flex items-center gap-1.5 text-[#C4BCAA] truncate">
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: leg.color }}
                      />
                      <span className="truncate">after {leg.label}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Average row footer */}
        {tip.isAverage && tip.contributingCount !== undefined && (
          <div className="border-t border-[#222] bg-[#111] px-3 py-1.5">
            <p className="font-mono text-[10px] italic text-[#909090]">
              Average across {tip.contributingCount} client
              {tip.contributingCount === 1 ? "" : "s"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Hover popup rendered above a TTM stat card on the Pod Pace section.
 *  Mirrors MetricContributorsPopup from TimeToMetrics.tsx — lists each
 *  contributing client grouped by pod, with their from/to dates and the
 *  resulting day count. Header carries the milestone numbers (e.g.
 *  "1→4 · Consulting KO → First Article") to match the legend / cards. */
function TTMContributorsTooltip({
  tip,
  podAxis,
}: {
  tip: TTMTip;
  podAxis: "editorial" | "growth";
}) {
  const { stat } = tip;
  const byPod = new Map<string, TTMContributor[]>();
  for (const c of stat.contributors) {
    const arr = byPod.get(c.pod) ?? [];
    arr.push(c);
    byPod.set(c.pod, arr);
  }
  for (const arr of byPod.values()) {
    arr.sort((a, b) => b.days - a.days);
  }
  const pods = Array.from(byPod.keys()).sort(sortPodKey);
  return (
    <div
      className="fixed z-[9999] pointer-events-none"
      style={{ left: tip.x, top: tip.y, transform: "translate(-50%, -100%)" }}
    >
      <div className="flex max-h-[360px] w-[380px] flex-col overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] shadow-xl shadow-black/60">
        <div className="border-b border-[#2a2a2a] px-3 py-2">
          <p className="font-mono text-[11px] font-semibold text-white">
            {stat.short}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-[#606060]">
            Avg {stat.avg ?? "—"}d across {stat.count} client
            {stat.count === 1 ? "" : "s"}
            {stat.min !== null && stat.max !== null && (
              <> · Min {stat.min}d · Max {stat.max}d</>
            )}
          </p>
        </div>
        {stat.count === 0 ? (
          <p className="px-3 py-3 text-center font-mono text-[10px] text-[#606060]">
            No clients have both dates recorded yet.
          </p>
        ) : (
          <div className="space-y-2 overflow-y-auto px-3 py-2">
            {pods.map((pod) => {
              const rows = byPod.get(pod) ?? [];
              const color = POD_HEX_COLORS[pod] ?? "#606060";
              return (
                <div key={pod}>
                  <div className="mb-0.5 flex items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span
                      className="font-mono text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color }}
                    >
                      {displayPod(pod, podAxis)}
                    </span>
                    <span className="font-mono text-[10px] text-[#606060]">
                      ({rows.length})
                    </span>
                  </div>
                  <div className="ml-3 space-y-0.5">
                    {rows.map((r) => (
                      <div
                        key={r.clientName}
                        className="flex items-center gap-2 font-mono text-[10px]"
                      >
                        <span
                          className="w-[110px] shrink-0 truncate text-[#C4BCAA]"
                          title={r.clientName}
                        >
                          {r.clientName}
                        </span>
                        <span className="shrink-0 text-[#606060] tabular-nums">
                          {fmtTipDate(r.fromDate)} → {fmtTipDate(r.toDate)}
                        </span>
                        <span className="ml-auto font-semibold tabular-nums text-white">
                          {r.days}d
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function aggregatePodJourney(
  clients: Client[],
  podAxis: "editorial" | "growth",
): PodJourneyGroup[] {
  const byPod = new Map<string, Client[]>();
  for (const c of clients) {
    const raw = podAxis === "growth" ? c.growth_pod : c.editorial_pod;
    const pod = normalizePod(raw);
    if (!byPod.has(pod)) byPod.set(pod, []);
    byPod.get(pod)!.push(c);
  }

  const groups: PodJourneyGroup[] = [];
  for (const [pod, podClients] of byPod.entries()) {
    const rows: ClientJourneyRow[] = podClients.map((c) => {
      const cko = c.consulting_ko_date;
      const milestones: MilestoneEntry[] = [];
      if (cko) {
        for (const m of JOURNEY) {
          const dateStr = (c as unknown as Record<string, string | null>)[m.field];
          const d = daysBetween(cko, dateStr);
          if (d !== null) {
            milestones.push({
              key: m.key,
              field: m.field,
              label: m.label,
              days: d,
              color: m.color,
              shape: m.shape,
              date: dateStr,
            });
          }
        }
        milestones.sort((a, b) => a.days - b.days);
      }
      const maxDay = milestones.length
        ? Math.max(...milestones.map((mm) => mm.days))
        : 0;
      return { client: c, milestones, maxDay };
    });
    // Longest journey first (clients with no milestones drop to the bottom).
    rows.sort((a, b) => b.maxDay - a.maxDay);
    const maxDay = rows.length ? Math.max(...rows.map((r) => r.maxDay)) : 0;

    // Per-milestone average across clients that hit the milestone.
    const acc = new Map<string, {
      sum: number; count: number; label: string; color: string;
      shape: "circle" | "diamond";
    }>();
    for (const r of rows) {
      for (const m of r.milestones) {
        const cur = acc.get(m.key);
        if (cur) {
          cur.sum += m.days;
          cur.count += 1;
        } else {
          acc.set(m.key, {
            sum: m.days, count: 1,
            label: m.label, color: m.color, shape: m.shape,
          });
        }
      }
    }
    const averages: MilestoneEntry[] = [];
    const averageCounts = new Map<string, number>();
    for (const m of JOURNEY) {
      const cur = acc.get(m.key);
      if (cur && cur.count > 0) {
        averages.push({
          key: m.key,
          field: m.field,
          label: m.label,
          days: Math.round(cur.sum / cur.count),
          color: cur.color,
          shape: cur.shape,
        });
        averageCounts.set(m.key, cur.count);
      }
    }
    averages.sort((a, b) => a.days - b.days);

    groups.push({ pod, rows, maxDay, averages, averageCounts });
  }

  groups.sort((a, b) => sortPodKey(a.pod, b.pod));
  return groups;
}

/** Pick day-tick marks that fit at the given scale without overlap.
 *  Greedy left-to-right: skip ticks whose position is within 7% of the
 *  previously kept one. Extended-range candidates kick in past 150d. */
/** Left column width (px) — the area where the pod name / "Avg" /
 *  client name lives. Shared between the unified tick row at the top
 *  of PodMilestoneJourneyCard and each JourneyTimeline below so the
 *  ticks line up exactly with the dots in every row. */
const JOURNEY_LABEL_W = 130;

function pickTicks(scale: number): number[] {
  const candidates = [0, 7, 14, 21, 30, 45, 60, 90, 120, 150];
  if (scale > 200) {
    candidates.push(200, 250, 300, 400, 500, 600, 800, 1000);
  }
  const inRange = candidates.filter((d) => d <= scale * 0.95);
  const picked: number[] = [];
  let lastPct = -Infinity;
  for (const d of inRange) {
    const pct = (d / scale) * 100;
    if (pct - lastPct >= 7) {
      picked.push(d);
      lastPct = pct;
    }
  }
  return picked;
}

function PodJourneyGroupView({
  group,
  open,
  onToggle,
  podAxis,
  scale,
  onShowTip,
  onHideTip,
  linkedHover,
  onHoverChange,
  stretchExpanded = false,
  lockExpand = false,
  onClientFocus,
  selectedClientId,
}: {
  group: PodJourneyGroup;
  open: boolean;
  onToggle: () => void;
  podAxis: "editorial" | "growth";
  scale: number;
  onShowTip: (t: JourneyTip) => void;
  onHideTip: () => void;
  linkedHover: LinkedHover;
  onHoverChange: (h: LinkedHover) => void;
  /** When true and this pod is `open`, the timeline rows stretch
   *  vertically to fill the card's available height. Set by the
   *  parent when this is the only pod in scope (e.g. user has
   *  filtered to a single pod), so the empty space below the rows
   *  becomes usable canvas. */
  stretchExpanded?: boolean;
  /** When true, the chevron + click-to-toggle behaviour are hidden.
   *  Used when this is the only pod in scope — collapsing would
   *  leave the card empty. */
  lockExpand?: boolean;
  /** Forwarded to JourneyTimeline — fires on per-client row click so
   *  the parent can re-scope the Time-to-Metrics cards. */
  onClientFocus?: (clientId: number | null) => void;
  /** Forwarded to JourneyTimeline — drives the selected-row highlight. */
  selectedClientId?: number | null;
}) {
  const podColor = POD_HEX_COLORS[group.pod] ?? "#606060";
  const averageRow: TimelineRow = {
    id: `${group.pod}-avg`,
    name: "Avg",
    milestones: group.averages,
    hasCKO: group.averages.length > 0,
    isAverage: true,
    averageCounts: group.averageCounts,
  };
  const clientRows: TimelineRow[] = group.rows.map((r) => ({
    id: `${group.pod}-${r.client.id}`,
    clientId: r.client.id,
    name: r.client.name,
    milestones: r.milestones,
    hasCKO: !!r.client.consulting_ko_date,
    ckoDate: r.client.consulting_ko_date,
    dimmed: r.milestones.length === 0 && !r.client.consulting_ko_date,
  }));

  return (
    <div
      className={
        (lockExpand ? "relative" : "cursor-pointer transition-colors hover:bg-[#1a1a1a] relative") +
        (stretchExpanded && open ? " flex flex-1 min-h-0 flex-col" : "")
      }
      onClick={lockExpand ? undefined : onToggle}
      role={lockExpand ? undefined : "button"}
      tabIndex={lockExpand ? undefined : 0}
      onKeyDown={lockExpand ? undefined : (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="flex-none flex items-center gap-3 pt-2.5 pb-1">
        {!lockExpand && (
          <ChevronRight
            className={
              "h-3.5 w-3.5 shrink-0 text-[#606060] transition-transform " +
              (open ? "rotate-90" : "")
            }
          />
        )}
        <span
          className="inline-block h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: podColor }}
        />
        <span
          className="font-mono text-[11px] font-semibold uppercase tracking-wider shrink-0"
          style={{ color: podColor }}
        >
          {displayPod(group.pod, podAxis)}
        </span>
        <span className="font-mono text-[10px] text-[#606060] shrink-0">
          ({group.rows.length})
        </span>
        <span className="h-px flex-1 bg-[#2a2a2a]" />
        {group.maxDay > 0 && (
          <span className="font-mono text-[10px] text-[#909090] shrink-0">
            Longest: {group.maxDay}d
          </span>
        )}
      </div>
      {/* Collapsed → mini timeline of averages; expanded → full per-client
          timeline. Animate height + opacity simultaneously so the swap
          GROWS / SHRINKS instead of snapping. Both panels mount together
          while one shrinks to 0 and the other grows to its natural
          height — crossfades cleanly without the "pop". */}
      <div
        className={
          stretchExpanded && open ? "flex flex-1 min-h-0 flex-col" : ""
        }
      >
        <AnimatePresence initial={false}>
          {open ? (
            <motion.div
              key="expanded"
              variants={JOURNEY_PANEL_VARIANTS}
              initial="hidden"
              animate="visible"
              exit="hidden"
              className={
                stretchExpanded ? "flex flex-1 min-h-0 flex-col" : ""
              }
              style={{ overflow: "hidden" }}
            >
              <JourneyTimeline
                rows={clientRows}
                scale={scale}
                onShowTip={onShowTip}
                onHideTip={onHideTip}
                staggerChildren
                stretch={stretchExpanded}
                linkedHover={linkedHover}
                onHoverChange={onHoverChange}
                hideTicks
                onClientFocus={onClientFocus}
                selectedClientId={selectedClientId}
              />
            </motion.div>
          ) : (
            <motion.div
              key="collapsed"
              variants={JOURNEY_PANEL_VARIANTS}
              initial="hidden"
              animate="visible"
              exit="hidden"
              style={{ overflow: "hidden" }}
            >
              <JourneyTimeline
                rows={[averageRow]}
                scale={scale}
                onShowTip={onShowTip}
                onHideTip={onHideTip}
                compact
                staggerChildren
                linkedHover={linkedHover}
                onHoverChange={onHoverChange}
                hideTicks
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function JourneyTimeline({
  rows,
  scale,
  onShowTip,
  onHideTip,
  compact = false,
  stretch = false,
  staggerChildren = false,
  linkedHover,
  onHoverChange,
  hideTicks = false,
  onClientFocus,
  selectedClientId,
}: {
  rows: TimelineRow[];
  scale: number;
  onShowTip: (t: JourneyTip) => void;
  onHideTip: () => void;
  /** Compact = collapsed-row mini timeline (smaller label column + height,
   *  no extra padding, no background wash). */
  compact?: boolean;
  /** Stretch = rows expand vertically to fill all available parent height
   *  (down to a sensible min). Used by the expanded pod row so the timeline
   *  fills the milestone-journey card when there's extra space below the
   *  collapsed pods. */
  stretch?: boolean;
  /** Stagger each client row's enter animation by a few ms so the list
   *  cascades in rather than appearing all at once. Used only on the
   *  expand-pod transition. */
  staggerChildren?: boolean;
  /** Cross-card hover state — drives dimming + hover emission so this
   *  timeline stays in sync with the TTM cards + Per-Client Days. */
  linkedHover?: LinkedHover;
  onHoverChange?: (h: LinkedHover) => void;
  /** Skip the per-timeline tick label row at the top. Set when the
   *  parent (PodMilestoneJourneyCard) renders a single unified tick
   *  row above all pods, so each pod's timeline only shows dots + grid
   *  lines (no repeated CKO/7d/14d/… labels). */
  hideTicks?: boolean;
  /** Click on a per-client row sets/clears the parent's selected
   *  client. Toggles: clicking the same row again deselects. Used to
   *  re-scope sibling cards (TTM cards, Per-Client Days) to that one
   *  client + highlight this row visually. */
  onClientFocus?: (clientId: number | null) => void;
  /** Currently selected client id (from the parent's state). Drives
   *  the highlighted-row treatment in the timeline. */
  selectedClientId?: number | null;
}) {
  const ROW_H = compact ? 22 : 30;
  const labelW = JOURNEY_LABEL_W;
  const ticks = useMemo(() => pickTicks(scale), [scale]);
  const pct = (d: number) =>
    Math.min(Math.max((d / scale) * 100, 0.5), 95);

  if (rows.length === 0) {
    return (
      <p className="px-6 py-2 text-[11px] text-[#606060]">
        No clients in this pod.
      </p>
    );
  }

  const wrapperCls = compact
    ? "pl-8 pr-2 pb-1.5"
    : stretch
    ? "flex flex-1 min-h-0 flex-col pb-3 pt-1 pl-8 pr-2 bg-[#0d0d0d]/40"
    : "pb-3 pt-1 pl-8 pr-2 bg-[#0d0d0d]/40";

  return (
    <div className={wrapperCls}>
      {/* Tick labels — suppressed when hideTicks is set (the parent
          renders one unified tick row above all pods instead). */}
      {!hideTicks && (
        <div
          className="flex-none grid mb-0.5"
          style={{ gridTemplateColumns: `${labelW}px 1fr` }}
        >
          <div />
          <div className="relative h-3.5 mx-3">
            {ticks.map((d) => (
              <span
                key={d}
                className={
                  "absolute font-mono text-[9px] " +
                  (d === 0 ? "font-bold text-white" : "text-[#606060]")
                }
                style={{
                  left: `${pct(d)}%`,
                  transform: "translateX(-50%)",
                  transition: "left 280ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              >
                {d === 0 ? "CKO" : `${d}d`}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Rows */}
      <div className={"relative pt-1.5" + (stretch ? " flex-1 min-h-0 flex flex-col" : "")}>
        {/* Grid lines */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ marginLeft: labelW }}
        >
          <div className="relative h-full mx-3">
            {ticks.map((d) => (
              <div
                key={d}
                className={d === 0 ? "absolute bg-[#444]" : "absolute bg-[#1a1a1a]"}
                style={{
                  left: `${pct(d)}%`,
                  top: 0,
                  bottom: 0,
                  width: d === 0 ? 2 : 1,
                  transition: "left 280ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              />
            ))}
          </div>
        </div>

        {rows.map((row) => {
          const positions = row.milestones.map((m) => m.days);
          const stagger = positions.map((pos, i) => {
            let n = 0;
            for (let j = 0; j < i; j++) {
              if (Math.abs(positions[j] - pos) < 1) n += 1;
            }
            return n;
          });
          // When the parent panel uses variants (staggerChildren), each row
          // inherits the visible/hidden states via React context — they
          // cascade IN on expand and cascade OUT on collapse (reverse order)
          // without each needing its own initial/animate/exit props.
          const wrapperProps = staggerChildren
            ? { variants: JOURNEY_ROW_VARIANTS }
            : {};
          // Per-client rows are CLICKABLE — clicking selects the
          // client (re-scopes sibling cards + highlights the row);
          // clicking the same row again clears the selection. The
          // Avg row has no clientId so it stays inert.
          const isClientRow = row.clientId != null;
          const isSelected =
            isClientRow && selectedClientId === row.clientId;
          return (
            <motion.div
              key={row.id}
              {...wrapperProps}
              className={
                "grid items-center group/row rounded transition-colors" +
                (stretch ? " flex-1 min-h-[28px]" : "") +
                (isClientRow ? " cursor-pointer hover:bg-[#1a1a1a]" : "") +
                (isSelected ? " bg-[#42CA80]/10 ring-1 ring-inset ring-[#42CA80]/30" : "")
              }
              style={
                stretch
                  ? { gridTemplateColumns: `${labelW}px 1fr` }
                  : { gridTemplateColumns: `${labelW}px 1fr`, height: ROW_H }
              }
              onClick={
                isClientRow && row.clientId != null
                  ? (e) => {
                      // stopPropagation so the click does NOT bubble
                      // up to PodJourneyGroupView's pod-toggle handler.
                      // Otherwise clicking a client row would collapse
                      // the pod that hosts it, defeating the focus
                      // interaction.
                      e.stopPropagation();
                      // Toggle: re-clicking the selected row clears it.
                      onClientFocus?.(
                        isSelected ? null : (row.clientId as number),
                      );
                    }
                  : undefined
              }
            >
              <span
                className={
                  "truncate pr-3 text-right font-mono text-[11px] " +
                  (row.dimmed ? "text-[#606060]" : "text-[#C4BCAA]") +
                  (compact ? " italic text-[#909090]" : "")
                }
              >
                {row.name}
              </span>
              <div
                className={"relative mx-3" + (stretch ? " self-stretch flex items-center" : "")}
                style={stretch ? undefined : { height: ROW_H - 6 }}
              >
                <div
                  className="absolute top-1/2 -translate-y-1/2 rounded-full bg-[#1a1a1a]"
                  style={{ left: 0, width: "100%", height: 3 }}
                />
                {row.hasCKO && (
                  <div
                    className="absolute cursor-default z-20"
                    style={{
                      left: `${pct(0)}%`,
                      top: "50%",
                      marginTop: -5,
                      marginLeft: -5,
                      transition: "left 280ms cubic-bezier(0.22, 1, 0.36, 1)",
                    }}
                    onMouseEnter={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      onShowTip({
                        x: r.left + r.width / 2,
                        y: r.top - 8,
                        name: row.name,
                        label: "Consulting KO (Day 0)",
                        days: 0,
                        color: "#FFFFFF",
                        field: "consulting_ko_date",
                        fromDate: row.ckoDate ?? undefined,
                        toDate: row.ckoDate ?? undefined,
                        isAverage: row.isAverage,
                      });
                    }}
                    onMouseLeave={onHideTip}
                  >
                    <div
                      className="h-[9px] w-[9px] rotate-45 rounded-sm bg-white"
                      style={{ boxShadow: "0 0 8px rgba(255,255,255,0.4)" }}
                    />
                  </div>
                )}
                {/* Segments — each represents the transition FROM the
                    previous milestone (or CKO) TO this milestone. We
                    emit a pair-hover so the matching TTM card + the
                    Per-Client Days metric highlight to match. */}
                {row.milestones.map((m, i) => {
                  const prev = i > 0 ? row.milestones[i - 1].days : 0;
                  const l = pct(Math.min(prev, m.days));
                  const r = pct(Math.max(prev, m.days));
                  const w = Math.max(0, r - l);
                  // A reversed leg (this milestone predates its predecessor —
                  // e.g. a CB approved before the Consulting KO) collapses to
                  // ~0 width once both ends clamp to the baseline. Render it as
                  // a dashed-red marker instead of dropping it, so the
                  // out-of-order transition stays visible like the negative dot.
                  const reversed = m.days < prev;
                  if (w <= 0.3 && !reversed) return null;
                  const prevField = i > 0
                    ? row.milestones[i - 1].field
                    : "consulting_ko_date";
                  // Match status against the active cross-card hover.
                  const segMatch = matchSegment(linkedHover, prevField, m.field);
                  const segDim = segMatch === false;
                  const segHi = segMatch === true;
                  return (
                    <div
                      key={`s-${m.key}`}
                      className="absolute top-1/2 -translate-y-1/2 rounded-full cursor-default"
                      style={{
                        left: `${l}%`,
                        width: reversed ? `max(8px, ${w}%)` : `${w}%`,
                        height: segHi ? 5 : 3,
                        backgroundColor: reversed ? "transparent" : m.color,
                        backgroundImage: reversed
                          ? "repeating-linear-gradient(90deg, #ED6958 0, #ED6958 3px, transparent 3px, transparent 6px)"
                          : undefined,
                        opacity: segDim ? 0.12 : segHi ? 0.95 : reversed ? 0.9 : 0.4,
                        transition:
                          "left 280ms cubic-bezier(0.22, 1, 0.36, 1), width 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 150ms, height 150ms",
                      }}
                      onMouseEnter={() =>
                        onHoverChange?.({
                          kind: "pair",
                          from: prevField,
                          to: m.field,
                        })
                      }
                      onMouseLeave={() => onHoverChange?.(null)}
                    />
                  );
                })}
                {/* Dots */}
                {row.milestones.map((m, i) => {
                  const hShift = stagger[i] * 6;
                  const size = m.shape === "diamond" ? 9 : 11;
                  const dotMatch = matchDot(linkedHover, m.field);
                  const dotDim = dotMatch === false;
                  const isNeg = m.days < 0;
                  return (
                    <div
                      key={m.key}
                      className="absolute cursor-default hover:scale-[1.3]"
                      style={{
                        left: `calc(${pct(m.days)}% + ${hShift}px)`,
                        top: "50%",
                        marginTop: -(size / 2),
                        marginLeft: -(size / 2),
                        zIndex: 10 + i,
                        opacity: dotDim ? 0.2 : 1,
                        transition:
                          "left 280ms cubic-bezier(0.22, 1, 0.36, 1), transform 150ms ease, opacity 150ms",
                      }}
                      onMouseEnter={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        const previousLegs = row.milestones
                          .slice(0, i)
                          .map((p) => ({
                            label: p.label,
                            color: p.color,
                            days: m.days - p.days,
                            field: p.field,
                          }));
                        onShowTip({
                          x: r.left + r.width / 2,
                          y: r.top - 8,
                          name: row.name,
                          label: row.isAverage ? `Average ${m.label}` : m.label,
                          days: m.days,
                          color: m.color,
                          field: m.field,
                          fromDate: row.isAverage ? undefined : row.ckoDate,
                          toDate: row.isAverage ? undefined : m.date,
                          previousLegs,
                          isAverage: row.isAverage,
                          contributingCount: row.isAverage
                            ? row.averageCounts?.get(m.key)
                            : undefined,
                        });
                        // Cross-card: dot hover = single-milestone signal
                        // (not a unique pair), so TTM cards involving
                        // this milestone light up but Per-Client Days
                        // doesn't switch metrics.
                        onHoverChange?.({ kind: "milestone", field: m.field });
                      }}
                      onMouseLeave={() => {
                        onHideTip();
                        onHoverChange?.(null);
                      }}
                    >
                      {m.shape === "diamond" ? (
                        <div
                          className="rotate-45 rounded-sm"
                          style={{
                            width: 9,
                            height: 9,
                            backgroundColor: m.color,
                            boxShadow: `0 0 6px ${m.color}40`,
                            outline: isNeg ? "1.5px solid #ED6958" : undefined,
                            outlineOffset: isNeg ? 1 : undefined,
                          }}
                        />
                      ) : (
                        <div
                          className="rounded-full"
                          style={{
                            width: 11,
                            height: 11,
                            backgroundColor: m.color,
                            boxShadow: `0 0 8px ${m.color}50`,
                            outline: isNeg ? "1.5px solid #ED6958" : undefined,
                            outlineOffset: isNeg ? 1 : undefined,
                          }}
                        />
                      )}
                      {/* Pre-CKO milestone (negative days): surface the signed
                          value inline + a red ring so the out-of-order anomaly
                          reads at a glance, matching the Time-to-Metrics card. */}
                      {isNeg && (
                        <span
                          className="absolute left-full top-1/2 ml-1 -translate-y-1/2 whitespace-nowrap font-mono text-[8px] font-semibold text-[#ED6958]"
                          style={{ textShadow: "0 0 4px rgba(0,0,0,0.85)" }}
                        >
                          {m.days}d
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
