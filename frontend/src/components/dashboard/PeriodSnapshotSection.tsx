"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type {
  Client,
  ClientProductionRow,
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
  TooltipBody,
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
}

export function PeriodSnapshotSection({
  filteredClients,
  summaries,
  goals,
  clientProduction,
}: Props) {
  const { axis: podAxis } = useCurrentPodAxis();

  // Pod Snapshot is INTENTIONALLY independent of the global FilterBar
  // dateRange. Only the Goals column is period-scoped, and the user picks
  // that scope via the dropdown next to the column headers.
  const [goalsPeriod, setGoalsPeriod] = useState<LocalPeriodKey>("1m");
  const clientNamesInScope = useMemo(
    () => new Set(filteredClients.map((c) => c.name)),
    [filteredClients],
  );
  const periodScope = useMemo<PeriodScope>(
    () => resolveLocalPeriod(goalsPeriod, goals, clientNamesInScope),
    [goalsPeriod, goals, clientNamesInScope],
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PodDeliveryProgressCard
            clients={filteredClients}
            summaries={summaries}
            goals={goals}
            clientProduction={clientProduction}
            period={periodScope}
            goalsPeriod={goalsPeriod}
            onGoalsPeriodChange={setGoalsPeriod}
            podAxis={podAxis}
          />
        </div>
        <div className="lg:col-span-1">
          <PodMilestoneJourneyCard
            clients={filteredClients}
            podAxis={podAxis}
          />
        </div>
      </div>
    </div>
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
): PeriodScope {
  const today = new Date();
  const lastCompleted = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const endY = lastCompleted.getFullYear();
  const endM = lastCompleted.getMonth() + 1;

  let stepBack = 0;
  let caption = "Last completed month";
  switch (period) {
    case "current": {
      // In-progress calendar month — partial data, includes today.
      const today = new Date();
      const curY = today.getFullYear();
      const curM = today.getMonth() + 1;
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
  /** Invoiced-weighted average month-in-Q across pod's clients, used to
   *  compute the pod-level pace classification (so a pod whose clients
   *  are mid-Q on average reads as different from one whose clients are
   *  all at start-of-Q). 0 when no clients have current-Q data. */
  currentQAvgMonthInQ: number;
  currentQAvgQLength: number;
  newCount: number;
  // Lifetime (across-all-time)
  lifetimeDelivered: number;
  lifetimeSow: number;
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
  } | null;
  currentQ: {
    label: string;
    projectedVariance: number;
    actualDelivered: number;  // cumulative ACTUALS through last completed month
    delivered: number;        // cumulative projected through end of current Q
    invoiced: number;         // cumulative invoiced through end of current Q
    monthInQ: number;         // 1-based position of today within the Q
    qLength: number;          // total months in the Q
  } | null;
  isNew: boolean;
  // Lifetime
  lifetimeDelivered: number;
  lifetimeSow: number;
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
const DELIVERY_GRID = "grid-cols-[1.25rem_minmax(10rem,13rem)_minmax(11rem,2fr)_minmax(6rem,1fr)_minmax(6rem,1fr)_minmax(6rem,1fr)]";

function PodDeliveryProgressCard({
  clients,
  summaries,
  goals,
  clientProduction,
  period,
  goalsPeriod,
  onGoalsPeriodChange,
  podAxis,
}: {
  clients: Client[];
  summaries: SummaryRow[];
  goals: GoalsVsDeliveryRow[];
  clientProduction: ClientProductionRow[];
  period: PeriodScope;
  goalsPeriod: LocalPeriodKey;
  onGoalsPeriodChange: (k: LocalPeriodKey) => void;
  podAxis: "editorial" | "growth";
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);

  const { podRows, perClientByPod } = useMemo(
    () => aggregatePodDelivery(clients, summaries, goals, period, podAxis),
    [clients, summaries, goals, period, podAxis],
  );

  return (
    <div className="h-full rounded-lg border border-[#2a2a2a] bg-[#161616] p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA]">
            Pod Delivery Progress
          </p>
          <p className="mt-0.5 text-[11px] text-[#606060]">
            Goals (month) · Δ vs invoiced (per-client Q) · Lifetime articles delivered ÷ SOW
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
          {podRows.length} pod{podRows.length === 1 ? "" : "s"}
        </span>
      </div>


      {/* Column header — visible only when at least one pod row will
          render. The Goals header carries the column title (with hover
          tooltip) and the period dropdown sits immediately to its right
          on the same line. */}
      {podRows.length > 0 && (
        <div className={`mt-3 grid ${DELIVERY_GRID} items-center gap-2 border-b border-[#222] px-2 pb-2`}>
          <span />
          <span />
          <GoalsHeaderWithSelector
            sub={`CBs + articles · ${period.label}`}
            help={{
              title: "Goals",
              bullets: [
                "CBs + articles, counted separately.",
                "Numbers = delivered / monthly goal.",
                "Scope picked via the dropdown — section-local.",
              ],
            }}
            selector={
              <GoalsPeriodSelector
                value={goalsPeriod}
                onChange={onGoalsPeriodChange}
                scope={period}
              />
            }
          />
          <ColumnHeader
            title="Last Q · Variance"
            sub="Cumulative Delivered ÷ Invoiced at close"
            align="center"
            help={{
              title: "Last Q",
              bullets: [
                "# = variance = delivered − invoiced (cumulative).",
                "Numbers = delivered / invoiced.",
                "≥ 0 Healthy · −5–0 Within · < −5 Behind.",
              ],
            }}
          />
          <ColumnHeader
            title="Current Q · Variance"
            sub="delivered · proj Q · invoiced"
            align="center"
            help={{
              title: "Current Q",
              bullets: [
                "# = projected variance = end-of-Q − Invoiced.",
                "Numbers = delivered · projected end-of-Q · invoiced.",
                "% = delivered ÷ projected end-of-Q.",
                "Bar = pace = (delivered ÷ proj-Q) ÷ (month-in-Q ÷ Q length).",
                "Pace tells you if delivery is keeping up with how much of the Q has elapsed.",
                "≥ 1.10 ahead of pace · 0.85–1.10 on track · < 0.85 push needed.",
              ],
            }}
          />
          <ColumnHeader
            title="%SOW"
            sub="delivered vs SOW"
            align="center"
            help={{
              title: "%SOW",
              bullets: [
                "Articles only (not CBs).",
                "% = delivered ÷ contracted SOW.",
                "All-time — not period-scoped.",
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
}: {
  title: React.ReactNode;
  sub: string;
  help: { title: string; bullets: React.ReactNode[] };
  align?: "left" | "center" | "right";
  /** Optional small chip rendered next to the title (e.g. "PROJECTED" on
   *  Current Q). Uses a muted blue palette so it reads as informational
   *  without competing with the tier colors below. */
  badge?: string;
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
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={<div className={"cursor-help " + alignCls} />}
        >
          <div className={"inline-flex items-center gap-1.5 " + justifyCls}>
            <p className="font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA] underline decoration-dotted underline-offset-2 decoration-[#404040]">
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
}: {
  sub: string;
  help: { title: string; bullets: React.ReactNode[] };
  selector: React.ReactNode;
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
}: {
  value: LocalPeriodKey;
  onChange: (v: LocalPeriodKey) => void;
  scope: PeriodScope;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = GOALS_PERIOD_OPTIONS.find((o) => o.id === value) ?? GOALS_PERIOD_OPTIONS[0];

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
        <div className="absolute left-0 top-full z-20 mt-1 w-44 rounded-md border border-[#2a2a2a] bg-[#0d0d0d] shadow-xl">
          {GOALS_PERIOD_OPTIONS.map((o) => {
            const isActive = o.id === value;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => { onChange(o.id); setOpen(false); }}
                className={
                  "block w-full px-2.5 py-1.5 text-left font-mono text-[10px] uppercase tracking-wider transition-colors " +
                  (isActive
                    ? "bg-[#42CA80]/10 text-[#42CA80]"
                    : "text-[#C4BCAA] hover:bg-[#1a1a1a] hover:text-white")
                }
              >
                {o.label}
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
    // Invoiced-weighted month-in-Q and qLength accumulators for the pod
    // pace metric. We weight by invoiced so larger clients pull the avg
    // more — matches how the pod's variance + numbers are aggregated.
    let currentQMonthInQWeighted = 0;
    let currentQQLengthWeighted = 0;
    let currentQPaceWeight = 0;
    let newCount = 0;
    let lifetimeDelivered = 0;
    let lifetimeSow = 0;
    const clientRows: PerClientRow[] = [];

    for (const c of podClients) {
      const g = perClientGoals.get(c.name) ?? { cbGoal: 0, cbDel: 0, adGoal: 0, adDel: 0 };
      cbDel += g.cbDel; cbGoal += g.cbGoal;
      adDel += g.adDel; adGoal += g.adGoal;

      const row = summaryById.get(c.id);
      let currentQ: PerClientRow["currentQ"] = null;
      let lastQ: PerClientRow["lastQ"] = null;
      let isNew = false;
      let clientLifetimeDelivered = 0;
      let clientLifetimeSow = 0;
      if (row) {
        const cq = computeCurrentQ(row);
        const lq = computeLastFullQ(row);
        isNew = isFirstContractQ(row);
        clientLifetimeDelivered = row.articles_delivered;
        clientLifetimeSow = row.articles_sow;
        lifetimeDelivered += clientLifetimeDelivered;
        lifetimeSow += clientLifetimeSow;
        if (cq) {
          currentQ = {
            label: cq.label,
            projectedVariance: cq.projectedVariance,
            actualDelivered: cq.delivered,    // cumulative actuals so far
            delivered: cq.projectedEnd,       // cumulative projected end-of-Q
            invoiced: cq.invoiced,
            monthInQ: cq.monthInQ,
            qLength: cq.qLength,
          };
          if (!isNew) {
            currentQVariance += cq.projectedVariance;
            currentQActualDelivered += cq.delivered;
            currentQDelivered += cq.projectedEnd;
            currentQInvoiced += cq.invoiced;
            currentQHasData = true;
            const weight = Math.max(1, cq.invoiced);
            currentQMonthInQWeighted += cq.monthInQ * weight;
            currentQQLengthWeighted += cq.qLength * weight;
            currentQPaceWeight += weight;
          }
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
        lifetimeSow: clientLifetimeSow,
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
      currentQAvgMonthInQ: currentQPaceWeight > 0
        ? currentQMonthInQWeighted / currentQPaceWeight
        : 0,
      currentQAvgQLength: currentQPaceWeight > 0
        ? currentQQLengthWeighted / currentQPaceWeight
        : 0,
      newCount,
      lifetimeDelivered, lifetimeSow,
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
      className={`grid w-full ${DELIVERY_GRID} items-center gap-2 py-3 px-2 text-left transition-colors hover:bg-[#1a1a1a]`}
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
      {/* Last Q */}
      <QTile
        variance={row.lastQHasData ? row.lastQVariance : null}
        delivered={row.lastQDelivered}
        invoiced={row.lastQInvoiced}
      />
      {/* Current Q — shows variance + tier + NOW (actuals so far) + PROJ END */}
      <QTile
        variance={row.currentQHasData ? row.currentQVariance : null}
        delivered={row.currentQDelivered}
        invoiced={row.currentQInvoiced}
        actualDelivered={row.currentQActualDelivered}
        avgMonthInQ={row.currentQAvgMonthInQ}
        avgQLength={row.currentQAvgQLength}
        newCount={row.newCount}
        projected
      />
      {/* Lifetime */}
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
  actualDelivered,
  avgMonthInQ,
  avgQLength,
  newCount,
  projected = false,
}: {
  variance: number | null;
  delivered: number;
  invoiced: number;
  actualDelivered?: number;
  avgMonthInQ?: number;
  avgQLength?: number;
  newCount?: number;
  projected?: boolean;
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
  const tier = variance >= 0
    ? { color: "#42CA80", label: "Healthy" }
    : variance >= -5
    ? { color: "#F5C542", label: "Within limit" }
    : { color: "#ED6958", label: "Behind" };
  const sign = variance > 0 ? "+" : "";
  const italicCls = projected ? "italic" : "";
  const showBreakdown = actualDelivered !== undefined;
  return (
    <div className="text-center">
      <p
        className={`font-mono text-base font-bold tabular-nums leading-none ${italicCls}`}
        style={{ color: tier.color }}
      >
        {sign}{Math.round(variance)}
      </p>
      <p
        className="mt-0.5 font-mono text-[10px] uppercase tracking-wider"
        style={{ color: tier.color }}
      >
        {tier.label}
      </p>
      {showBreakdown ? (
        <div className="mt-1 space-y-1 font-mono text-[10px] tabular-nums text-[#C4BCAA]">
          {/* Three labelled numbers replace the cryptic NOW → END / Invoiced
              arrow form. Each value carries its own meaning chip below so
              the user doesn't have to decode the symbols. */}
          <div className="flex items-center justify-center gap-1.5 leading-tight">
            <span className="text-white">{Math.round(actualDelivered!)}</span>
            <span className="text-[#606060]">·</span>
            <span className={`font-semibold text-white ${italicCls}`}>
              {Math.round(delivered)}
            </span>
            <span className="text-[#606060]">·</span>
            <span className="text-[#909090]">{Math.round(invoiced)}</span>
          </div>
          <div className="flex items-center justify-center gap-1.5 font-mono text-[8px] uppercase tracking-wider text-[#606060]">
            <span>delivered</span>
            <span>·</span>
            <span>proj Q</span>
            <span>·</span>
            <span>invoiced</span>
          </div>
          {(() => {
            // Pace coloring: bar uses pace tier (separate from variance
            // tier above). Falls back to variance tier color if we don't
            // have pacing data.
            const pace = avgMonthInQ !== undefined && avgQLength !== undefined
              ? paceClassify(actualDelivered!, delivered, avgMonthInQ, avgQLength)
              : null;
            const barColor = pace?.color ?? tier.color;
            return (
              <>
                <div className="flex items-center gap-1.5">
                  <div className="flex-1">
                    <QProgressBar
                      actual={actualDelivered!}
                      projected={delivered}
                      target={invoiced}
                      color={barColor}
                    />
                  </div>
                  <span
                    className="shrink-0 font-mono text-[9px] font-semibold tabular-nums"
                    style={{ color: barColor }}
                    title="Cumulative actuals now ÷ projected end of Q"
                  >
                    {delivered > 0
                      ? `${Math.round((actualDelivered! / delivered) * 100)}%`
                      : "—"}
                  </span>
                </div>
                {pace && (
                  <p
                    className="font-mono text-[9px] uppercase tracking-wider"
                    style={{ color: pace.color }}
                  >
                    {pace.label}
                  </p>
                )}
              </>
            );
          })()}
        </div>
      ) : (
        <p className={`mt-1 font-mono text-[10px] tabular-nums text-[#C4BCAA] ${italicCls}`}>
          <span className="font-semibold text-white">{Math.round(delivered)}</span>
          <span className="text-[#606060]"> / {Math.round(invoiced)}</span>
        </p>
      )}
    </div>
  );
}

/** Classify the actual-vs-expected delivery pace for the current Q.
 *  Compares actual progress (NOW / END) against the linear expected
 *  progress at this month-in-Q (monthInQ / qLength).
 *
 *  pace_ratio = (NOW/END) / (monthInQ/qLength)
 *    ≥ 1.10   → "Ahead of pace"  (dark green)
 *    0.85-1.10 → "On track"       (light green)
 *    < 0.85   → "Push needed"    (yellow)
 *
 *  Three buckets, three colours — separate from the variance tier so a
 *  row can be Healthy on outcome AND "Push needed" on pace at the same
 *  time. Red dropped on purpose: yellow already says "needs attention"
 *  and the variance tier (above the bar) carries the alarm when
 *  delivered − invoiced has actually fallen behind. */
function paceClassify(
  actualDelivered: number,
  projectedEnd: number,
  monthInQ: number,
  qLength: number,
): { color: string; label: string } | null {
  if (projectedEnd <= 0 || qLength <= 0) return null;
  const actualProgress = actualDelivered / projectedEnd;
  const expectedProgress = monthInQ / qLength;
  if (expectedProgress <= 0) return null;
  const ratio = actualProgress / expectedProgress;
  if (ratio >= 1.10) return { color: "#42CA80", label: "Ahead of pace" };
  if (ratio >= 0.85) return { color: "#9FE5BD", label: "On track" };
  return { color: "#F5C542", label: "Push needed" };
}

/** Clean two-shade bar (matches the Goals MiniProgress idiom). Solid fill
 *  is NOW cumulative actuals; faded same color is the projected additional
 *  through end of Q. 100% of the bar represents the cumulative invoiced
 *  target — the variance number above already conveys overshoot
 *  precisely, so the bar caps at 100% and stays calm. */
function QProgressBar({
  actual,
  projected,
  target,
  color,
  compact = false,
}: {
  actual: number;
  projected: number;
  target: number;
  color: string;
  compact?: boolean;
}) {
  const safeTarget = Math.max(1, target);
  const actualPct = Math.max(0, Math.min(100, (actual / safeTarget) * 100));
  const projectedPct = Math.max(0, Math.min(100, (projected / safeTarget) * 100));
  const fadedWidth = Math.max(0, projectedPct - actualPct);
  const h = compact ? 3 : 5;
  return (
    <div
      className="relative w-full overflow-hidden rounded-sm bg-[#1a1a1a]"
      style={{ height: h }}
      aria-label={`Now ${Math.round(actual)} of ${Math.round(target)} invoiced, projected ${Math.round(projected)}`}
    >
      <div
        className="absolute top-0 bottom-0 left-0"
        style={{ width: `${actualPct}%`, backgroundColor: color }}
      />
      {fadedWidth > 0 && (
        <div
          className="absolute top-0 bottom-0"
          style={{
            left: `${actualPct}%`,
            width: `${fadedWidth}%`,
            backgroundColor: `${color}40`,
          }}
        />
      )}
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
  };
  return (
    <div className="bg-[#0d0d0d]/40 py-1.5">
      {rows.map((r) => {
        const cbPct = r.cbGoal > 0 ? (r.cbDel / r.cbGoal) * 100 : null;
        const adPct = r.adGoal > 0 ? (r.adDel / r.adGoal) * 100 : null;
        const lifetimePct = r.lifetimeSow > 0
          ? Math.round((r.lifetimeDelivered / r.lifetimeSow) * 100)
          : null;
        return (
          <div
            key={r.id}
            className={`grid ${DELIVERY_GRID} items-center gap-2 px-2 py-1.5 hover:bg-[#1a1a1a]`}
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
                <ClientGoalCell label="CB" del={r.cbDel} goal={r.cbGoal} pct={cbPct} />
                <ClientGoalCell label="AR" del={r.adDel} goal={r.adGoal} pct={adPct} />
              </div>
            </CellButton>
            {/* col 4: last Q (actual) → opens "lastQ" detail */}
            <CellButton onClick={(e) => openCell("lastQ", r, e)} ariaLabel={`Open Last Q detail for ${r.name}`}>
              <ClientQCell
                label={r.lastQ?.label ?? "Last Q"}
                q={r.lastQ
                  ? {
                      delivered: r.lastQ.delivered,
                      invoiced: r.lastQ.invoiced,
                      variance: r.lastQ.variance,
                    }
                  : null}
              />
            </CellButton>
            {/* col 5: current Q (projected) → opens "currentQ" detail */}
            <CellButton onClick={(e) => openCell("currentQ", r, e)} ariaLabel={`Open Current Q detail for ${r.name}`}>
              <ClientQCell
                label={r.currentQ?.label ?? "Curr Q"}
                q={r.currentQ
                  ? {
                      delivered: r.currentQ.delivered,
                      invoiced: r.currentQ.invoiced,
                      variance: r.currentQ.projectedVariance,
                      actualDelivered: r.currentQ.actualDelivered,
                      monthInQ: r.currentQ.monthInQ,
                      qLength: r.currentQ.qLength,
                    }
                  : null}
                isNew={r.isNew}
                projected
              />
            </CellButton>
            {/* col 6: lifetime → opens "lifetime" detail */}
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
  if (goal === 0) {
    return (
      <p className="font-mono text-[10px] tabular-nums text-[#606060]">
        <span className="text-[#606060]">{label}</span> —
      </p>
    );
  }
  const color = pct === null
    ? "#909090"
    : pct >= 90 ? "#42CA80"
    : pct >= 70 ? "#F5C542"
    : "#ED6958";
  return (
    <p className="font-mono text-[10px] tabular-nums text-[#C4BCAA]">
      <span className="text-[#606060]">{label}</span>{" "}
      {Math.round(del)}/{Math.round(goal)}{" "}
      <span style={{ color }}>({Math.round(pct!)}%)</span>
    </p>
  );
}

function ClientQCell({
  label,
  q,
  isNew,
  projected = false,
}: {
  label: string;
  q: {
    delivered: number;
    invoiced: number;
    variance: number;
    /** Cumulative actuals through last completed month. Only set on
     *  Current Q so the cell can render NOW → END breakdown. */
    actualDelivered?: number;
    /** Position within Q + Q length, for the pace classification. Only
     *  set on Current Q. */
    monthInQ?: number;
    qLength?: number;
  } | null;
  isNew?: boolean;
  projected?: boolean;
}) {
  if (!q) {
    return (
      <div className="text-center font-mono text-[10px] tabular-nums">
        <p className="text-[#606060]">{label}</p>
        <p className="text-[#606060]">{isNew ? "1st Q" : "—"}</p>
      </div>
    );
  }
  const color = isNew
    ? "#8FB5D9"
    : q.variance >= 0 ? "#42CA80"
    : q.variance >= -5 ? "#F5C542"
    : "#ED6958";
  const sign = q.variance > 0 ? "+" : "";
  const showBreakdown = q.actualDelivered !== undefined;
  return (
    <div className="text-center font-mono text-[10px] tabular-nums">
      <p className="text-[#606060]">
        {label}
        {projected && <span className="ml-1 italic text-[#505050]">(proj.)</span>}
      </p>
      <p>
        <span className="font-semibold" style={{ color }}>
          {sign}{Math.round(q.variance)}
        </span>
      </p>
      {showBreakdown ? (
        <>
          <p className="text-[#606060]">
            <span className="text-[#909090]">{Math.round(q.actualDelivered!)}</span>
            <span className="mx-0.5">→</span>
            <span className="text-[#C4BCAA]">{Math.round(q.delivered)}</span>
            <span> / {Math.round(q.invoiced)}</span>
          </p>
          {(() => {
            const pace = q.monthInQ !== undefined && q.qLength !== undefined
              ? paceClassify(q.actualDelivered!, q.delivered, q.monthInQ, q.qLength)
              : null;
            const barColor = pace?.color ?? color;
            return (
              <>
                <div className="mt-0.5 flex items-center gap-1">
                  <div className="flex-1">
                    <QProgressBar
                      actual={q.actualDelivered!}
                      projected={q.delivered}
                      target={q.invoiced}
                      color={barColor}
                      compact
                    />
                  </div>
                  <span
                    className="shrink-0 font-mono text-[8px] font-semibold tabular-nums"
                    style={{ color: barColor }}
                    title="Cumulative actuals now ÷ projected end of Q"
                  >
                    {q.delivered > 0
                      ? `${Math.round((q.actualDelivered! / q.delivered) * 100)}%`
                      : "—"}
                  </span>
                </div>
                {pace && (
                  <p
                    className="font-mono text-[8px] uppercase tracking-wider"
                    style={{ color: pace.color }}
                  >
                    {pace.label}
                  </p>
                )}
              </>
            );
          })()}
        </>
      ) : (
        <p className="text-[#606060]">
          <span className="text-[#C4BCAA]">{Math.round(q.delivered)}</span>
          <span> / {Math.round(q.invoiced)}</span>
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pod Milestone Journey (right card)
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
  fromDate?: string | null;
  toDate?: string | null;
  /** Days from each preceding milestone in journey order. */
  previousLegs?: { label: string; color: string; days: number }[];
  isAverage?: boolean;
  contributingCount?: number;
}

function PodMilestoneJourneyCard({
  clients,
  podAxis,
}: {
  clients: Client[];
  podAxis: "editorial" | "growth";
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tip, setTip] = useState<JourneyTip | null>(null);

  const groups = useMemo(
    () => aggregatePodJourney(clients, podAxis),
    [clients, podAxis],
  );
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
      <div className="flex-none flex items-baseline justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA]">
            Pod Milestone Journey
          </p>
          <p className="mt-0.5 text-[11px] text-[#606060]">
            Days since Consulting KO · click pod to expand · longest journey first
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
          {groups.length} pod{groups.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className={"mt-3 divide-y divide-[#222] " + (hasExpanded ? "flex-1 min-h-0 flex flex-col" : "")}>
        {groups.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-[#606060]">
            No milestone data in scope.
          </p>
        ) : (
          groups.map((g) => {
            const open = expanded === g.pod;
            return (
              <PodJourneyGroupView
                key={g.pod}
                group={g}
                open={open}
                onToggle={() => setExpanded(open ? null : g.pod)}
                podAxis={podAxis}
                scale={sharedScale}
                onShowTip={(payload) => setTip(payload)}
                onHideTip={() => setTip(null)}
              />
            );
          })
        )}
      </div>

      {/* Legend */}
      <div className="flex-none mt-4 flex flex-wrap items-center gap-3 border-t border-[#2a2a2a] pt-3">
        <div className="flex items-center gap-1.5">
          <div className="h-[8px] w-[8px] rotate-45 rounded-sm bg-white" />
          <span className="font-mono text-[10px] text-[#606060]">Consulting KO</span>
        </div>
        {JOURNEY.map((m) => (
          <div key={m.key} className="flex items-center gap-1.5">
            {m.shape === "diamond" ? (
              <div
                className="h-[8px] w-[8px] rotate-45 rounded-sm"
                style={{ backgroundColor: m.color }}
              />
            ) : (
              <div
                className="rounded-full"
                style={{ width: 9, height: 9, backgroundColor: m.color }}
              />
            )}
            <span className="font-mono text-[10px] text-[#606060]">{m.label}</span>
          </div>
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
  return d.toLocaleDateString(undefined, {
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

        {/* Primary stat: days from CKO */}
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
              from Consulting KO
            </span>
          </p>
        </div>

        {/* Previous legs — days first, then label */}
        {tip.previousLegs && tip.previousLegs.length > 0 && (
          <div className="border-t border-[#222] px-3 py-2">
            <p className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-[#606060]">
              After previous milestones
            </p>
            <div className="space-y-1">
              {tip.previousLegs.map((leg) => (
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
              ))}
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
}: {
  group: PodJourneyGroup;
  open: boolean;
  onToggle: () => void;
  podAxis: "editorial" | "growth";
  scale: number;
  onShowTip: (t: JourneyTip) => void;
  onHideTip: () => void;
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
    name: r.client.name,
    milestones: r.milestones,
    hasCKO: !!r.client.consulting_ko_date,
    ckoDate: r.client.consulting_ko_date,
    dimmed: r.milestones.length === 0 && !r.client.consulting_ko_date,
  }));

  return (
    <div
      className="cursor-pointer transition-colors hover:bg-[#1a1a1a] relative"
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="flex-none flex items-center gap-3 pt-2.5 pb-1">
        <ChevronRight
          className={
            "h-3.5 w-3.5 shrink-0 text-[#606060] transition-transform " +
            (open ? "rotate-90" : "")
          }
        />
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
      <div>
        <AnimatePresence initial={false}>
          {open ? (
            <motion.div
              key="expanded"
              variants={JOURNEY_PANEL_VARIANTS}
              initial="hidden"
              animate="visible"
              exit="hidden"
              style={{ overflow: "hidden" }}
            >
              <JourneyTimeline
                rows={clientRows}
                scale={scale}
                onShowTip={onShowTip}
                onHideTip={onHideTip}
                staggerChildren
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
}) {
  const ROW_H = compact ? 22 : 30;
  // Shared label column width across compact (Avg row) and full (per-client
  // rows) so CKO + day ticks line up vertically across collapsed AND
  // expanded pods. Was previously 50 / 130 — that broke the axis alignment.
  const labelW = 130;
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
      {/* Tick labels */}
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
          return (
            <motion.div
              key={row.id}
              {...wrapperProps}
              className={
                "grid items-center group/row rounded transition-colors" +
                (stretch ? " flex-1 min-h-[28px]" : "")
              }
              style={
                stretch
                  ? { gridTemplateColumns: `${labelW}px 1fr` }
                  : { gridTemplateColumns: `${labelW}px 1fr`, height: ROW_H }
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
                {/* Segments */}
                {row.milestones.map((m, i) => {
                  const prev = i > 0 ? row.milestones[i - 1].days : 0;
                  const l = pct(Math.min(prev, m.days));
                  const r = pct(Math.max(prev, m.days));
                  const w = Math.max(0, r - l);
                  return w > 0.3 ? (
                    <div
                      key={`s-${m.key}`}
                      className="absolute top-1/2 -translate-y-1/2 rounded-full"
                      style={{
                        left: `${l}%`,
                        width: `${w}%`,
                        height: 3,
                        backgroundColor: m.color,
                        opacity: 0.4,
                        transition: "left 280ms cubic-bezier(0.22, 1, 0.36, 1), width 280ms cubic-bezier(0.22, 1, 0.36, 1)",
                      }}
                    />
                  ) : null;
                })}
                {/* Dots */}
                {row.milestones.map((m, i) => {
                  const hShift = stagger[i] * 6;
                  const size = m.shape === "diamond" ? 9 : 11;
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
                        transition:
                          "left 280ms cubic-bezier(0.22, 1, 0.36, 1), transform 150ms ease",
                      }}
                      onMouseEnter={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        const previousLegs = row.milestones
                          .slice(0, i)
                          .map((p) => ({
                            label: p.label,
                            color: p.color,
                            days: m.days - p.days,
                          }));
                        onShowTip({
                          x: r.left + r.width / 2,
                          y: r.top - 8,
                          name: row.name,
                          label: row.isAverage ? `Average ${m.label}` : m.label,
                          days: m.days,
                          color: m.color,
                          fromDate: row.isAverage ? undefined : row.ckoDate,
                          toDate: row.isAverage ? undefined : m.date,
                          previousLegs,
                          isAverage: row.isAverage,
                          contributingCount: row.isAverage
                            ? row.averageCounts?.get(m.key)
                            : undefined,
                        });
                      }}
                      onMouseLeave={onHideTip}
                    >
                      {m.shape === "diamond" ? (
                        <div
                          className="rotate-45 rounded-sm"
                          style={{
                            width: 9,
                            height: 9,
                            backgroundColor: m.color,
                            boxShadow: `0 0 6px ${m.color}40`,
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
                          }}
                        />
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
