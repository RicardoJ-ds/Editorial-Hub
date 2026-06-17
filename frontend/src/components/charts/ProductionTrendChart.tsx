"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { Client, ClientProductionRow, ProductionTrendPoint } from "@/lib/types";
import type { DateRange } from "@/components/dashboard/DateRangeFilter";
import { DataSourceBadge } from "@/components/dashboard/DataSourceBadge";
import { trackClick } from "@/lib/analyticsClient";
import { POD_HEX_COLORS, displayPod } from "@/components/dashboard/shared-helpers";
import { normalizePod, sortPodKey } from "@/components/dashboard/ContractClientProgress";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month]} ${String(year).slice(-2)}`;
}

type PodAxis = "editorial" | "growth";
type ViewMode = "all" | "per-pod" | "per-client";

interface BreakdownClient {
  name: string;
  value: number;
  isActual: boolean;
  /** Pod the client belongs to — used by per-client tooltip grouping. */
  pod?: string;
  /** Series colour for the client. Per-client mode assigns a distinct
   *  brand swatch per client (when one pod in scope) or the pod colour
   *  (when multiple pods in scope); single-line mode leaves this blank. */
  color?: string;
}

interface PodBreakdown {
  pod: string;
  color: string;
  total: number;
  isActual: boolean;
  clients: BreakdownClient[];
}

interface ChartRow {
  month: string;
  Actual: number | null;
  Projected: number | null;
  /** Per-client contribution for the month (single-line mode). */
  breakdown?: BreakdownClient[];
  /** Per-pod breakdown (per-pod mode) — pods sorted by sortPodKey, clients
   *  sorted descending by value inside each pod. */
  breakdownByPod?: PodBreakdown[];
  /** Per-pod totals (per-pod mode). Keys are `${pod}__Actual` and
   *  `${pod}__Projected`, values are numbers (or null when the month
   *  belongs to the other side). */
  [podSeries: string]: number | null | string | BreakdownClient[] | PodBreakdown[] | undefined;
}

// At the transition from Actual → Projected the two Recharts series don't
// share a point, so the dashed Projected line starts one month later than
// the solid Actual line ends — producing a visible gap. Copy the final
// Actual value into that same row's Projected field so the dashed series
// has a starting anchor and visually continues the solid line.
function bridgeActualToProjected(rows: ChartRow[]) {
  for (let i = 0; i < rows.length - 1; i++) {
    const cur = rows[i];
    const next = rows[i + 1];
    if (cur.Actual !== null && next.Actual === null && next.Projected !== null) {
      cur.Projected = cur.Actual;
      break;
    }
  }
  return rows;
}

// Same bridge but per pod — copies the last actual value into the
// projected key for the same row so each pod's line visually continues.
function bridgePodSeries(rows: ChartRow[], pods: string[]) {
  for (const pod of pods) {
    const aKey = `${pod}__Actual`;
    const pKey = `${pod}__Projected`;
    for (let i = 0; i < rows.length - 1; i++) {
      const cur = rows[i];
      const next = rows[i + 1];
      const curA = cur[aKey];
      const nextA = next[aKey];
      const nextP = next[pKey];
      if (
        typeof curA === "number" &&
        curA !== null &&
        (nextA === null || nextA === undefined) &&
        typeof nextP === "number" &&
        nextP !== null
      ) {
        cur[pKey] = curA;
        break;
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Custom Tooltip
//
// We render our own tooltip OUTSIDE Recharts and drive it from a hover-state
// object captured in the chart's onMouseMove. Recharts' built-in Tooltip is
// kept for the cursor crosshair (content prop returns null) but doesn't
// render any box itself.
//
// Why custom? Recharts' Tooltip positions a wrapper div via `top`/`left`
// in coord spaces that vary (chart-relative, padded, etc.) and its
// `position` prop doesn't play well with `position: fixed` overrides.
// Mirroring the pattern used by JourneyTooltip in PeriodSnapshotSection
// (position: fixed + cursor viewport coords + self-measure with
// useLayoutEffect) gives us predictable placement.
// ---------------------------------------------------------------------------

interface HoverState {
  /** Cursor X in viewport coords (event.clientX) at re-anchor moment. */
  cursorX: number;
  /** Cursor Y in viewport coords (event.clientY) at re-anchor moment. */
  cursorY: number;
  /** Active month label (e.g. "Apr 26"). */
  label: string;
  /** The active row's full ChartRow payload — used to derive breakdown. */
  payload: ChartRow;
  /** Chart card's viewport bounding rect — used to clip the tooltip's X
   *  position to the card's right edge. Captured at re-anchor so it
   *  stays stable while the cursor moves inside one month's band. */
  containerRect: { left: number; right: number };
}

/** Recharts content component that observes the chart's hover state
 *  (active/payload/label) and reports label changes to the parent via
 *  onChange. Returns null so Recharts renders no tooltip itself — the
 *  actual box is <ChartTooltipBox>, rendered outside the Recharts tree.
 *
 *  We use this instead of just reading state.activeLabel from the
 *  chart's onMouseMove because that approach is unreliable: state
 *  tracking can be skipped or stale when the Tooltip's content returns
 *  null. Going through Recharts' own content-props pipeline is the
 *  documented way to observe tooltip state. */
function TooltipProbe({
  active,
  payload,
  label,
  onChange,
}: {
  active?: boolean;
  payload?: { payload?: ChartRow }[];
  label?: string;
  onChange: (info: { label: string; row: ChartRow } | null) => void;
}) {
  const lastLabelRef = useRef<string | null>(null);
  useEffect(() => {
    if (active && label && payload?.length) {
      const row = payload[0]?.payload;
      if (row && lastLabelRef.current !== label) {
        lastLabelRef.current = label;
        onChange({ label, row });
      }
    } else if (lastLabelRef.current !== null) {
      lastLabelRef.current = null;
      onChange(null);
    }
  }, [active, label, payload, onChange]);
  return null;
}

function ChartTooltipBox({
  hover,
  viewMode,
  podAxis,
}: {
  hover: HoverState;
  viewMode: ViewMode;
  podAxis: PodAxis;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Start hidden; measure on mount, then position + reveal — same frame
  // via useLayoutEffect so the user never sees the first-render flash.
  const [pos, setPos] = useState<{ left: number; top: number; ready: boolean }>(
    { left: 0, top: 0, ready: false },
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const viewportH = window.innerHeight;
    const sideMargin = 8;
    const gap = 30;
    // Horizontal: 30px right of cursor by default; flip to 30px left
    // of cursor when the right side would clip past the chart card's
    // right edge.
    const wouldClipRight = hover.cursorX + gap + w > hover.containerRect.right - sideMargin;
    const left = wouldClipRight
      ? Math.max(sideMargin, hover.cursorX - gap - w)
      : hover.cursorX + gap;
    // Vertical: center on cursor, clamp so the box stays fully inside
    // [sideMargin, viewportH - sideMargin]. When the box is taller
    // than the viewport (rare), pin to top — the box's own max-h cap +
    // internal overflow handle it gracefully.
    const idealTop = hover.cursorY - h / 2;
    const maxTop = viewportH - h - sideMargin;
    const top = h > 0
      ? Math.max(sideMargin, Math.min(idealTop, maxTop))
      : sideMargin;
    setPos({ left, top, ready: true });
  }, [hover]);

  return (
    <div
      ref={ref}
      className="fixed z-40 max-h-[calc(100vh-16px)] overflow-y-auto overscroll-contain rounded-lg border border-[#2a2a2a] bg-[#161616] px-3 py-2 shadow-lg max-w-[320px]"
      style={{
        left: pos.left,
        top: pos.top,
        visibility: pos.ready ? "visible" : "hidden",
        pointerEvents: "none",
      }}
    >
      <ChartTooltipContent
        label={hover.label}
        payload={hover.payload}
        viewMode={viewMode}
        podAxis={podAxis}
      />
    </div>
  );
}

const BREAKDOWN_LIMIT = 10;

function ChartTooltipContent({
  label,
  payload,
  viewMode,
  podAxis,
}: {
  label: string;
  payload: ChartRow;
  viewMode: ViewMode;
  podAxis: PodAxis;
}) {
  if (viewMode === "per-pod") {
    const breakdownByPod = payload.breakdownByPod ?? [];
    if (breakdownByPod.length === 0) return null;
    const total = breakdownByPod.reduce((sum, p) => sum + p.total, 0);
    const isActual = breakdownByPod.some((p) => p.isActual);
    return (
      <>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <p className="font-mono text-xs font-semibold text-white">{label}</p>
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
            {isActual ? "Actual" : "Projected"} · {total}
          </span>
        </div>
        {/* Per-pod view → pod totals only (no per-client list). */}
        <ul className="space-y-0.5">
          {breakdownByPod.map((p) => (
            <li
              key={p.pod}
              className="flex items-center justify-between gap-3 font-mono text-[11px]"
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <span
                  className="inline-block h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: p.color }}
                />
                <span className="font-semibold" style={{ color: p.color }}>
                  {displayPod(p.pod, podAxis)}
                </span>
              </span>
              <span className="tabular-nums font-semibold text-white">
                {p.total}
              </span>
            </li>
          ))}
        </ul>
      </>
    );
  }

  if (viewMode === "per-client") {
    const breakdown = payload.breakdown ?? [];
    const nonZero = breakdown.filter((b) => b.value > 0);
    if (nonZero.length === 0) return null;
    const byPod = new Map<string, BreakdownClient[]>();
    for (const b of nonZero) {
      const pod = b.pod ?? "Unassigned";
      if (!byPod.has(pod)) byPod.set(pod, []);
      byPod.get(pod)!.push(b);
    }
    for (const list of byPod.values()) {
      list.sort((a, b) => b.value - a.value);
    }
    const pods = Array.from(byPod.keys()).sort(sortPodKey);
    const total = nonZero.reduce((sum, c) => sum + c.value, 0);
    const isActual = nonZero.some((b) => b.isActual);
    return (
      <>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <p className="font-mono text-xs font-semibold text-white">{label}</p>
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
            {isActual ? "Actual" : "Projected"} · {total}
          </span>
        </div>
        <ul className="space-y-1.5">
          {pods.map((pod) => {
            const list = byPod.get(pod) ?? [];
            const podTotal = list.reduce((sum, c) => sum + c.value, 0);
            const podColor = POD_HEX_COLORS[pod] ?? list[0]?.color ?? "#606060";
            return (
              <li key={pod} className="space-y-0.5">
                <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: podColor }}
                    />
                    <span className="font-semibold" style={{ color: podColor }}>
                      {displayPod(pod, podAxis)}
                    </span>
                  </span>
                  <span className="tabular-nums font-semibold text-white">
                    {podTotal}
                  </span>
                </div>
                <ul className="space-y-0.5 pl-3.5">
                  {list.map((c) => (
                    <li
                      key={c.name}
                      className="flex items-center justify-between gap-3 font-mono text-[10px]"
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: c.color ?? podColor }}
                        />
                        <span className="truncate text-[#909090]" title={c.name}>
                          {c.name}
                        </span>
                      </span>
                      <span className="tabular-nums text-[#C4BCAA]">
                        {c.value}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </>
    );
  }

  // Default (All) view — single solid/dashed line.
  const breakdown = payload.breakdown ?? [];
  const visible = breakdown.slice(0, BREAKDOWN_LIMIT);
  const hidden = breakdown.length - visible.length;
  const totalActual = typeof payload.Actual === "number" ? payload.Actual : null;
  const totalProjected = typeof payload.Projected === "number" ? payload.Projected : null;
  return (
    <>
      <p className="mb-1 font-mono text-xs font-semibold text-white">{label}</p>
      {totalActual !== null && (
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: "#42CA80" }} />
          <span className="text-[#C4BCAA]">Actual:</span>
          <span className="font-mono font-semibold text-white">{totalActual}</span>
        </div>
      )}
      {totalProjected !== null && (
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: "#42CA80" }} />
          <span className="text-[#C4BCAA]">Projected:</span>
          <span className="font-mono font-semibold text-white">{totalProjected}</span>
        </div>
      )}
      {visible.length > 0 && (
        <>
          <div className="my-1.5 h-px bg-[#2a2a2a]" />
          <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[#606060]">
            By client
          </p>
          <ul className="space-y-0.5">
            {visible.map((row) => (
              <li
                key={row.name}
                className="flex items-center justify-between gap-3 font-mono text-[11px]"
              >
                <span className="truncate text-[#C4BCAA]" title={row.name}>
                  {row.name}
                </span>
                <span className="tabular-nums font-semibold text-white">
                  {row.value}
                </span>
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <p className="mt-1 font-mono text-[10px] text-[#606060]">
              +{hidden} more client{hidden === 1 ? "" : "s"}
            </p>
          )}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// View-mode toggle
// ---------------------------------------------------------------------------

function ViewModeToggle({
  value,
  onChange,
  allowPerClient,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
  /** Whether the "Per client" option is offered. Hidden when more
   *  than one pod is in scope — 20+ overlapping client lines on the
   *  same chart is unreadable; per-client only makes sense with a
   *  pod filter narrowing the set to ≤ ~10 clients. */
  allowPerClient: boolean;
}) {
  const opts: { id: ViewMode; label: string }[] = allowPerClient
    ? [
        { id: "all", label: "All" },
        { id: "per-pod", label: "Per pod" },
        { id: "per-client", label: "Per client" },
      ]
    : [
        { id: "all", label: "All" },
        { id: "per-pod", label: "Per pod" },
      ];
  return (
    <div className="inline-flex rounded-md border border-[#2a2a2a] bg-[#0d0d0d] p-0.5">
      {opts.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => {
              onChange(o.id);
              trackClick("production-history.view-toggle", {
                section_id: "production-history",
                props: { value: o.id },
              });
            }}
            className={
              "rounded-sm px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors " +
              (active
                ? "bg-[#42CA80]/15 text-[#42CA80]"
                : "text-[#909090] hover:text-[#C4BCAA]")
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ProductionTrendChartProps {
  /** All-clients aggregate from /api/dashboard/production-trend (legacy, used when no filter is active). */
  data: ProductionTrendPoint[];
  /** Per-client monthly actual/projected — re-aggregated client-side so the chart honors the FilterBar selection. */
  clientProduction?: ClientProductionRow[];
  filteredClients?: Client[];
  dateRange?: DateRange;
  /** Pod axis the chart should group by when in per-pod mode. */
  podAxis?: PodAxis;
}

export function ProductionTrendChart({
  data,
  clientProduction,
  filteredClients,
  dateRange,
  podAxis = "editorial",
}: ProductionTrendChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("all");

  // Build name → pod lookup once per filteredClients/podAxis change.
  const podByName = useMemo(() => {
    const map = new Map<string, string>();
    if (filteredClients) {
      for (const c of filteredClients) {
        const raw = podAxis === "growth" ? c.growth_pod : c.editorial_pod;
        const pod = raw ? normalizePod(raw) : "Unassigned";
        map.set(c.name, pod);
      }
    }
    return map;
  }, [filteredClients, podAxis]);

  // Single-line (current) aggregation — unchanged from prior implementation.
  const singleSeries = useMemo(() => {
    const hasClientFilter =
      clientProduction &&
      filteredClients &&
      clientProduction.length > 0 &&
      filteredClients.length > 0 &&
      filteredClients.length < clientProduction.length;
    const hasDateFilter = dateRange?.type === "range" && !!dateRange.from;
    const useClientProduction = !!clientProduction && (hasClientFilter || hasDateFilter);

    const inRange = (y: number, m: number) => {
      if (!dateRange || dateRange.type !== "range" || !dateRange.from) return true;
      const cell = new Date(y, m - 1, 1);
      const from = new Date(
        dateRange.from.getFullYear(),
        dateRange.from.getMonth(),
        1,
      );
      const toSrc = dateRange.to ?? dateRange.from;
      const to = new Date(toSrc.getFullYear(), toSrc.getMonth() + 1, 0);
      return cell >= from && cell <= to;
    };

    let lastActualLabel = "";

    if (useClientProduction && clientProduction) {
      const names = filteredClients
        ? new Set(filteredClients.map((c) => c.name))
        : null;
      const rows = names
        ? clientProduction.filter((r) => names.has(r.client_name))
        : clientProduction;
      const byMonth = new Map<
        string,
        {
          year: number;
          month: number;
          actual: number;
          projected: number;
          perClient: { name: string; actual: number; projected: number }[];
        }
      >();
      for (const r of rows) {
        for (const m of r.monthly) {
          if (!inRange(m.year, m.month)) continue;
          const key = `${m.year}-${String(m.month).padStart(2, "0")}`;
          const bucket = byMonth.get(key) ?? {
            year: m.year,
            month: m.month,
            actual: 0,
            projected: 0,
            perClient: [] as { name: string; actual: number; projected: number }[],
          };
          const a = m.actual ?? 0;
          const p = m.projected ?? 0;
          bucket.actual += a;
          bucket.projected += p;
          if (a !== 0 || p !== 0) {
            bucket.perClient.push({ name: r.client_name, actual: a, projected: p });
          }
          byMonth.set(key, bucket);
        }
      }
      const sorted = Array.from(byMonth.values()).sort(
        (a, b) => a.year * 100 + a.month - (b.year * 100 + b.month),
      );
      const mapped: ChartRow[] = sorted.map((pt) => {
        const label = formatLabel(pt.year, pt.month);
        const isActual = pt.actual > 0;
        if (isActual) lastActualLabel = label;
        const breakdown = pt.perClient
          .map((c) => ({
            name: c.name,
            value: isActual ? c.actual : c.projected,
            isActual,
          }))
          .filter((c) => c.value > 0)
          .sort((a, b) => b.value - a.value);
        return {
          month: label,
          // null (not 0) so a month with no actual / no projected doesn't dive
          // the line to the axis at the boundary (past months carry projected=0,
          // future months carry actual=0). bridgeActualToProjected reconnects
          // the dashed line from the last real actual.
          Actual: isActual && pt.actual > 0 ? pt.actual : null,
          Projected: !isActual && pt.projected > 0 ? pt.projected : null,
          breakdown,
        };
      });
      return { chartData: bridgeActualToProjected(mapped), boundaryLabel: lastActualLabel };
    }

    // production-trend can return TWO rows for the boundary month — the real
    // actual row plus a spurious projected mirror (is_actual=false, all zeros).
    // Collapse to one row per (year, month), preferring the row that carries
    // real data (actual delivery beats an empty projection), so the line doesn't
    // duplicate the x-point or break the actual→projected bridge.
    const score = (r: ProductionTrendPoint) =>
      (r.is_actual && r.total_actual > 0 ? 2 : 0) + (r.total_projected > 0 ? 1 : 0);
    const byKey = new Map<string, ProductionTrendPoint>();
    for (const pt of data) {
      if (!inRange(pt.year, pt.month)) continue;
      const key = `${pt.year}-${String(pt.month).padStart(2, "0")}`;
      const prev = byKey.get(key);
      if (!prev || score(pt) > score(prev)) byKey.set(key, pt);
    }
    const sorted = [...byKey.values()].sort(
      (a, b) => a.year * 100 + a.month - (b.year * 100 + b.month),
    );

    const mapped: ChartRow[] = sorted.map((pt) => {
      const label = formatLabel(pt.year, pt.month);
      if (pt.is_actual) lastActualLabel = label;
      return {
        month: label,
        // null (not 0) — same boundary dive-to-zero guard as the per-client path.
        Actual: pt.is_actual && pt.total_actual > 0 ? pt.total_actual : null,
        Projected: !pt.is_actual && pt.total_projected > 0 ? pt.total_projected : null,
      };
    });

    return { chartData: bridgeActualToProjected(mapped), boundaryLabel: lastActualLabel };
  }, [data, clientProduction, filteredClients, dateRange]);

  // Per-pod aggregation. Always re-aggregates from clientProduction (the
  // legacy /api/dashboard/production-trend endpoint has no per-pod split).
  const podSeries = useMemo(() => {
    const inRange = (y: number, m: number) => {
      if (!dateRange || dateRange.type !== "range" || !dateRange.from) return true;
      const cell = new Date(y, m - 1, 1);
      const from = new Date(
        dateRange.from.getFullYear(),
        dateRange.from.getMonth(),
        1,
      );
      const toSrc = dateRange.to ?? dateRange.from;
      const to = new Date(toSrc.getFullYear(), toSrc.getMonth() + 1, 0);
      return cell >= from && cell <= to;
    };

    if (!clientProduction || clientProduction.length === 0) {
      return { chartData: [], boundaryLabel: "", pods: [] as string[] };
    }

    // Narrow to filtered clients when present (matches single-line behavior).
    const names = filteredClients
      ? new Set(filteredClients.map((c) => c.name))
      : null;
    const rows = names
      ? clientProduction.filter((r) => names.has(r.client_name))
      : clientProduction;

    type Bucket = {
      year: number;
      month: number;
      // pod -> { actual, projected, perClient }
      pods: Map<
        string,
        {
          actual: number;
          projected: number;
          perClient: { name: string; actual: number; projected: number }[];
        }
      >;
    };
    const byMonth = new Map<string, Bucket>();
    const allPods = new Set<string>();

    for (const r of rows) {
      // Pod assignment: lookup from filteredClients first (so growth-axis
      // works), then fall back to the row's editorial_pod (still useful
      // when filteredClients hasn't loaded yet and axis is editorial).
      const podFromMap = podByName.get(r.client_name);
      const fallback =
        podAxis === "editorial" && r.editorial_pod
          ? normalizePod(r.editorial_pod)
          : "Unassigned";
      const pod = podFromMap ?? fallback;
      allPods.add(pod);
      for (const m of r.monthly) {
        if (!inRange(m.year, m.month)) continue;
        const key = `${m.year}-${String(m.month).padStart(2, "0")}`;
        const bucket = byMonth.get(key) ?? {
          year: m.year,
          month: m.month,
          pods: new Map(),
        };
        const podBucket = bucket.pods.get(pod) ?? {
          actual: 0,
          projected: 0,
          perClient: [] as { name: string; actual: number; projected: number }[],
        };
        const a = m.actual ?? 0;
        const p = m.projected ?? 0;
        podBucket.actual += a;
        podBucket.projected += p;
        if (a !== 0 || p !== 0) {
          podBucket.perClient.push({ name: r.client_name, actual: a, projected: p });
        }
        bucket.pods.set(pod, podBucket);
        byMonth.set(key, bucket);
      }
    }

    const sortedMonths = Array.from(byMonth.values()).sort(
      (a, b) => a.year * 100 + a.month - (b.year * 100 + b.month),
    );
    const pods = Array.from(allPods).sort(sortPodKey);

    let lastActualLabel = "";
    const chartData: ChartRow[] = sortedMonths.map((pt) => {
      const label = formatLabel(pt.year, pt.month);
      // The month counts as "actual" when ANY pod has actuals this month —
      // matches the single-line logic.
      const monthIsActual = Array.from(pt.pods.values()).some((b) => b.actual > 0);
      if (monthIsActual) lastActualLabel = label;

      const breakdownByPod: PodBreakdown[] = [];
      const row: ChartRow = {
        month: label,
        Actual: null,
        Projected: null,
      };
      for (const pod of pods) {
        const b = pt.pods.get(pod);
        const aKey = `${pod}__Actual`;
        const pKey = `${pod}__Projected`;
        if (!b) {
          row[aKey] = null;
          row[pKey] = null;
          continue;
        }
        // Write null (not a literal 0) when this pod contributed nothing on the
        // active side this month — a 0 would dive the line to the axis at the
        // actual→projected boundary (e.g. a pod that ramped to 0 in the NOW
        // month while siblings still delivered). null lets the line break/bridge
        // cleanly via bridgePodSeries instead.
        row[aKey] = monthIsActual && b.actual > 0 ? b.actual : null;
        row[pKey] = !monthIsActual && b.projected > 0 ? b.projected : null;
        const total = monthIsActual ? b.actual : b.projected;
        if (total > 0) {
          breakdownByPod.push({
            pod,
            color: POD_HEX_COLORS[pod] ?? "#606060",
            total,
            isActual: monthIsActual,
            clients: b.perClient
              .map((c) => ({
                name: c.name,
                value: monthIsActual ? c.actual : c.projected,
                isActual: monthIsActual,
              }))
              .filter((c) => c.value > 0)
              .sort((a, b) => b.value - a.value),
          });
        }
      }
      // Sort pods inside each row by pod number ascending (Pod 1, 2, 3,
      // 5, …) so the tooltip reads in stable pod order regardless of
      // who happened to deliver the most that month. Uses sortPodKey
      // (handles numeric ordering with Unassigned last).
      breakdownByPod.sort((a, b) => sortPodKey(a.pod, b.pod));
      row.breakdownByPod = breakdownByPod;
      return row;
    });

    return {
      chartData: bridgePodSeries(chartData, pods),
      boundaryLabel: lastActualLabel,
      pods,
    };
  }, [clientProduction, filteredClients, dateRange, podByName, podAxis]);

  // Per-client aggregation — one line per client. Each client keeps its
  // pod's colour so the chart visually clusters by pod even though the
  // individual lines belong to clients. Tooltip lists clients (sorted
  // by pod then desc value), with the pod label as a group header.
  const clientSeries = useMemo(() => {
    const inRange = (y: number, m: number) => {
      if (!dateRange || dateRange.type !== "range" || !dateRange.from) return true;
      const cell = new Date(y, m - 1, 1);
      const from = new Date(
        dateRange.from.getFullYear(),
        dateRange.from.getMonth(),
        1,
      );
      const toSrc = dateRange.to ?? dateRange.from;
      const to = new Date(toSrc.getFullYear(), toSrc.getMonth() + 1, 0);
      return cell >= from && cell <= to;
    };

    if (!clientProduction || clientProduction.length === 0) {
      return { chartData: [], boundaryLabel: "", clients: [] as { name: string; pod: string; color: string }[] };
    }
    const names = filteredClients
      ? new Set(filteredClients.map((c) => c.name))
      : null;
    const rows = names
      ? clientProduction.filter((r) => names.has(r.client_name))
      : clientProduction;

    type Bucket = {
      year: number;
      month: number;
      perClient: Map<string, { actual: number; projected: number }>;
    };
    const byMonth = new Map<string, Bucket>();
    const allClients = new Map<string, { pod: string; color: string }>();

    for (const r of rows) {
      const podFromMap = podByName.get(r.client_name);
      const fallback =
        podAxis === "editorial" && r.editorial_pod
          ? normalizePod(r.editorial_pod)
          : "Unassigned";
      const pod = podFromMap ?? fallback;
      const color = POD_HEX_COLORS[pod] ?? "#606060";
      allClients.set(r.client_name, { pod, color });
      for (const m of r.monthly) {
        if (!inRange(m.year, m.month)) continue;
        const key = `${m.year}-${String(m.month).padStart(2, "0")}`;
        const bucket = byMonth.get(key) ?? {
          year: m.year,
          month: m.month,
          perClient: new Map(),
        };
        const cell = bucket.perClient.get(r.client_name) ?? { actual: 0, projected: 0 };
        cell.actual += m.actual ?? 0;
        cell.projected += m.projected ?? 0;
        bucket.perClient.set(r.client_name, cell);
        byMonth.set(key, bucket);
      }
    }

    const sortedMonths = Array.from(byMonth.values()).sort(
      (a, b) => a.year * 100 + a.month - (b.year * 100 + b.month),
    );
    // Order clients by pod (for tooltip grouping) then by name.
    const sortedClients = Array.from(allClients.entries())
      .map(([name, meta]) => ({ name, pod: meta.pod, color: meta.color }))
      .sort((a, b) => {
        const podCmp = sortPodKey(a.pod, b.pod);
        return podCmp !== 0 ? podCmp : a.name.localeCompare(b.name);
      });

    // When only ONE pod is in scope (e.g. user filtered to a single pod
    // in the header), every client would otherwise share the same pod
    // colour and the chart looks like a tangle of identical lines.
    // Assign each client a distinct brand-palette swatch (same swatches
    // as POD_HEX_COLORS) so lines are individually identifiable and the
    // chart stays on-brand. Falls back to the pod-colour scheme when 2+
    // pods are in scope.
    const CLIENT_BRAND_PALETTE = [
      "#8FB5D9", // blue
      "#42CA80", // green
      "#F5C542", // yellow
      "#F28D59", // orange
      "#ED6958", // red
      "#CEBCF4", // lavender
      "#7FE8D6", // teal
      "#C4BCAA", // warm neutral
    ];
    const distinctPods = new Set(sortedClients.map((c) => c.pod));
    const singlePod = distinctPods.size === 1;
    const clients = singlePod
      ? sortedClients.map((c, i) => ({
          ...c,
          color: CLIENT_BRAND_PALETTE[i % CLIENT_BRAND_PALETTE.length],
        }))
      : sortedClients;

    let lastActualLabel = "";
    const chartData: ChartRow[] = sortedMonths.map((pt) => {
      const label = formatLabel(pt.year, pt.month);
      const monthIsActual = Array.from(pt.perClient.values()).some((c) => c.actual > 0);
      if (monthIsActual) lastActualLabel = label;

      const row: ChartRow = { month: label, Actual: null, Projected: null };
      const breakdown: BreakdownClient[] = [];
      for (const c of clients) {
        const cell = pt.perClient.get(c.name);
        const aKey = `${c.name}__Actual`;
        const pKey = `${c.name}__Projected`;
        if (!cell) {
          row[aKey] = null;
          row[pKey] = null;
          continue;
        }
        // null (not 0) when this client contributed nothing on the active side —
        // same boundary dive-to-zero guard as the per-pod path above.
        row[aKey] = monthIsActual && cell.actual > 0 ? cell.actual : null;
        row[pKey] = !monthIsActual && cell.projected > 0 ? cell.projected : null;
        const v = monthIsActual ? cell.actual : cell.projected;
        if (v > 0) breakdown.push({
          name: c.name,
          value: v,
          isActual: monthIsActual,
          pod: c.pod,
          color: c.color,
        });
      }
      // Sort each pod's clients desc by value — PerClientTooltip then
      // groups by pod in pod-sort order. The flat list stays desc-by-value
      // for the legacy SingleTooltip render path.
      breakdown.sort((a, b) => b.value - a.value);
      row.breakdown = breakdown;
      return row;
    });

    // Per-series Actual → Projected bridge (avoid the 1-month gap).
    for (const c of clients) {
      const aKey = `${c.name}__Actual`;
      const pKey = `${c.name}__Projected`;
      for (let i = 0; i < chartData.length - 1; i++) {
        const cur = chartData[i];
        const next = chartData[i + 1];
        const curA = cur[aKey];
        const nextA = next[aKey];
        const nextP = next[pKey];
        if (
          typeof curA === "number" &&
          curA !== null &&
          (nextA === null || nextA === undefined) &&
          typeof nextP === "number" &&
          nextP !== null
        ) {
          cur[pKey] = curA;
          break;
        }
      }
    }

    return { chartData, boundaryLabel: lastActualLabel, clients };
  }, [clientProduction, filteredClients, dateRange, podByName, podAxis]);

  const isPerPod = viewMode === "per-pod";
  const isPerClient = viewMode === "per-client";
  const activeChartData = isPerClient
    ? clientSeries.chartData
    : isPerPod
      ? podSeries.chartData
      : singleSeries.chartData;
  const activeBoundary = isPerClient
    ? clientSeries.boundaryLabel
    : isPerPod
      ? podSeries.boundaryLabel
      : singleSeries.boundaryLabel;

  // Tooltip is rendered OUTSIDE Recharts as <ChartTooltipBox> (see end
  // of this component's JSX). Two pieces of state work together:
  //   • cursorRef       — viewport coords of the mouse, refreshed on
  //     every mousemove inside the chart. A ref (not state) so we
  //     don't trigger a re-render on every pixel of motion.
  //   • hover           — the React state that actually triggers the
  //     tooltip to render. Updated by TooltipProbe (the Recharts
  //     tooltip's `content` component) when the active month changes.
  //     Captures cursorRef's value at the moment of label change so
  //     the tooltip anchors there and stays put.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const handleChartMouseMove = (_state: unknown, e: unknown) => {
    const evt = e as { clientX?: number; clientY?: number } | null;
    if (
      evt == null ||
      typeof evt.clientX !== "number" ||
      typeof evt.clientY !== "number"
    ) {
      return;
    }
    cursorRef.current = { x: evt.clientX, y: evt.clientY };
  };
  const handleChartMouseLeave = () => {
    cursorRef.current = null;
    setHover(null);
  };

  /** Called by TooltipProbe (Recharts' content component) when the
   *  active month changes OR active state turns off. Captures the
   *  CURRENT mouse coords at that moment so the tooltip anchors next
   *  to where the user actually pointed when crossing into the new
   *  column. useCallback so the function reference is stable across
   *  renders — otherwise the probe's effect would re-fire every render. */
  const handleHoverChange = useCallback(
    (info: { label: string; row: ChartRow } | null) => {
      if (!info) {
        setHover(null);
        return;
      }
      if (!cursorRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setHover({
        cursorX: cursorRef.current.x,
        cursorY: cursorRef.current.y,
        label: info.label,
        payload: info.row,
        containerRect: { left: rect.left, right: rect.right },
      });
    },
    [],
  );

  // Allow the "Per client" toggle ONLY when the filtered set narrows
  // to a single pod. With every pod visible there are 20+ overlapping
  // lines on one chart — unreadable and impossible to map to legend.
  const allowPerClient = useMemo(() => {
    const pods = new Set(clientSeries.clients.map((c) => c.pod));
    return pods.size === 1;
  }, [clientSeries.clients]);
  // If the user previously selected "per-client" and the scope just
  // widened back to multiple pods, snap them back to "all" so we don't
  // render a hidden mode.
  useEffect(() => {
    if (!allowPerClient && viewMode === "per-client") setViewMode("all");
  }, [allowPerClient, viewMode]);

  if (activeChartData.length === 0) {
    return (
      <div className="rounded-xl border border-[#2a2a2a] bg-[#161616] p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
            Production History
          </h3>
          <ViewModeToggle value={viewMode} onChange={setViewMode} allowPerClient={allowPerClient} />
        </div>
        <p className="text-center text-sm text-[#606060]">
          No production history data available.
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="rounded-xl border border-[#2a2a2a] bg-[#161616] p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
          Production History <DataSourceBadge
            type="live"
            source="Monthly article output (actual vs. projected)."
            shows={[
              "Solid lines: actually shipped.",
              "Dashed extensions: still projected.",
              "Toggle 'Per pod' to split by pod.",
            ]}
          />
        </h3>
        <ViewModeToggle value={viewMode} onChange={setViewMode} allowPerClient={allowPerClient} />
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart
          data={activeChartData}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          onMouseMove={handleChartMouseMove}
          onMouseLeave={handleChartMouseLeave}
        >
          <defs>
            <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#42CA80" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#42CA80" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradProjected" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#42CA80" stopOpacity={0.1} />
              <stop offset="95%" stopColor="#42CA80" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#2a2a2a"
            vertical={false}
          />
          <XAxis
            dataKey="month"
            tick={{
              fill: "#606060",
              fontSize: 11,
              fontFamily: "var(--font-mono), monospace",
            }}
            axisLine={{ stroke: "#2a2a2a" }}
            tickLine={false}
          />
          <YAxis
            tick={{
              fill: "#606060",
              fontSize: 11,
              fontFamily: "var(--font-mono), monospace",
            }}
            axisLine={{ stroke: "#2a2a2a" }}
            tickLine={false}
          />
          {/* Recharts Tooltip — draws the vertical cursor crosshair AND
              feeds active/payload/label into TooltipProbe, which reports
              hover changes back via handleHoverChange. The probe returns
              null so Recharts doesn't render its own tooltip box; the
              actual UI is <ChartTooltipBox> below the chart, outside the
              Recharts tree. */}
          <Tooltip
            content={<TooltipProbe onChange={handleHoverChange} />}
            cursor={{ stroke: "#2a2a2a" }}
            isAnimationActive={false}
          />
          {activeBoundary && (
            <ReferenceLine
              x={activeBoundary}
              stroke="#606060"
              strokeDasharray="4 4"
              label={{
                value: "Now",
                position: "top",
                fill: "#606060",
                fontSize: 10,
                fontFamily: "var(--font-mono), monospace",
              }}
            />
          )}
          {!isPerPod && !isPerClient && (
            <>
              <Area
                type="monotone"
                dataKey="Actual"
                stroke="#42CA80"
                strokeWidth={2}
                fill="url(#gradActual)"
                connectNulls={false}
              />
              <Area
                type="monotone"
                dataKey="Projected"
                stroke="#42CA80"
                strokeWidth={2}
                strokeDasharray="6 3"
                strokeOpacity={0.5}
                fill="url(#gradProjected)"
                connectNulls={false}
              />
            </>
          )}
          {/* Per-client mode: one line per client, coloured by the
              client's pod so the chart visually clusters even though the
              individual lines are per-client. Thinner stroke + faded
              alpha since there can be 20+ lines. */}
          {isPerClient &&
            clientSeries.clients.map((c) => (
              <Area
                key={`${c.name}-actual`}
                type="monotone"
                dataKey={`${c.name}__Actual`}
                name={`${c.name} Actual`}
                stroke={c.color}
                strokeWidth={1.5}
                strokeOpacity={0.75}
                fill="transparent"
                connectNulls={false}
                dot={false}
                activeDot={{ r: 2.5 }}
              />
            ))}
          {isPerClient &&
            clientSeries.clients.map((c) => (
              <Area
                key={`${c.name}-projected`}
                type="monotone"
                dataKey={`${c.name}__Projected`}
                name={`${c.name} Projected`}
                stroke={c.color}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                strokeOpacity={0.5}
                fill="transparent"
                connectNulls={false}
                dot={false}
                activeDot={{ r: 2.5 }}
              />
            ))}
          {isPerPod &&
            podSeries.pods.map((pod) => {
              const color = POD_HEX_COLORS[pod] ?? "#606060";
              return (
                <Area
                  key={`${pod}-actual`}
                  type="monotone"
                  dataKey={`${pod}__Actual`}
                  name={`${pod} Actual`}
                  stroke={color}
                  strokeWidth={2}
                  fill="transparent"
                  connectNulls={false}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              );
            })}
          {isPerPod &&
            podSeries.pods.map((pod) => {
              const color = POD_HEX_COLORS[pod] ?? "#606060";
              return (
                <Area
                  key={`${pod}-projected`}
                  type="monotone"
                  dataKey={`${pod}__Projected`}
                  name={`${pod} Projected`}
                  stroke={color}
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  strokeOpacity={0.6}
                  fill="transparent"
                  connectNulls={false}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              );
            })}
        </ComposedChart>
      </ResponsiveContainer>
      {/* Legend
           • Per-pod mode → one swatch per pod (pod colours)
           • Per-client mode w/ multiple pods → pod swatches + "N clients" hint
           • Per-client mode w/ ONE pod → swatch per client (distinct colours
             so the user can map each line to a client name)
      */}
      {(isPerPod || isPerClient) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {isPerClient && new Set(clientSeries.clients.map((c) => c.pod)).size === 1
            ? clientSeries.clients.map((c) => (
                <span
                  key={c.name}
                  className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wider"
                  style={{ color: c.color }}
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: c.color }}
                  />
                  {c.name}
                </span>
              ))
            : podSeries.pods.map((pod) => {
                const color = POD_HEX_COLORS[pod] ?? "#606060";
                return (
                  <span
                    key={pod}
                    className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider"
                    style={{ color }}
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    {displayPod(pod, podAxis)}
                  </span>
                );
              })}
          {isPerClient && new Set(clientSeries.clients.map((c) => c.pod)).size > 1 && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
              · {clientSeries.clients.length} clients (hover for names)
            </span>
          )}
        </div>
      )}
      {/* Custom hover tooltip — rendered OUTSIDE the Recharts tree so
          we control its positioning directly (position:fixed +
          viewport-coord clamp). See HoverState + ChartTooltipBox. */}
      {hover && (
        <ChartTooltipBox hover={hover} viewMode={viewMode} podAxis={podAxis} />
      )}
    </div>
  );
}
