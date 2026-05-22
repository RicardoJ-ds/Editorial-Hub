"use client";

import { useMemo, useState } from "react";
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
type ViewMode = "all" | "per-pod";

interface BreakdownClient {
  name: string;
  value: number;
  isActual: boolean;
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
// Custom Tooltips
// ---------------------------------------------------------------------------

interface TooltipPayloadEntry {
  name: string;
  value: number;
  color: string;
  payload?: ChartRow;
}

const BREAKDOWN_LIMIT = 10;
const POD_CLIENT_LIMIT = 6;

function SingleTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const breakdown = payload[0]?.payload?.breakdown ?? [];
  const visible = breakdown.slice(0, BREAKDOWN_LIMIT);
  const hidden = breakdown.length - visible.length;
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] px-3 py-2 shadow-lg">
      <p className="mb-1 font-mono text-xs font-semibold text-white">
        {label}
      </p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-xs">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-[#C4BCAA]">{entry.name}:</span>
          <span className="font-mono font-semibold text-white">
            {entry.value}
          </span>
        </div>
      ))}
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
    </div>
  );
}

function PerPodTooltip({
  active,
  payload,
  label,
  podAxis,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  podAxis: PodAxis;
}) {
  if (!active || !payload?.length) return null;
  const breakdownByPod = payload[0]?.payload?.breakdownByPod ?? [];
  if (breakdownByPod.length === 0) return null;
  const total = breakdownByPod.reduce((sum, p) => sum + p.total, 0);
  const isActual = breakdownByPod.some((p) => p.isActual);
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] px-3 py-2 shadow-lg max-w-[320px]">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <p className="font-mono text-xs font-semibold text-white">{label}</p>
        <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
          {isActual ? "Actual" : "Projected"} · {total}
        </span>
      </div>
      <ul className="space-y-1.5">
        {breakdownByPod.map((p) => {
          const visible = p.clients.slice(0, POD_CLIENT_LIMIT);
          const hidden = p.clients.length - visible.length;
          return (
            <li key={p.pod} className="space-y-0.5">
              <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                  <span
                    className="font-semibold"
                    style={{ color: p.color }}
                  >
                    {displayPod(p.pod, podAxis)}
                  </span>
                </span>
                <span className="tabular-nums font-semibold text-white">
                  {p.total}
                </span>
              </div>
              {visible.length > 0 && (
                <ul className="space-y-0.5 pl-3.5">
                  {visible.map((c) => (
                    <li
                      key={c.name}
                      className="flex items-center justify-between gap-3 font-mono text-[10px]"
                    >
                      <span className="truncate text-[#909090]" title={c.name}>
                        {c.name}
                      </span>
                      <span className="tabular-nums text-[#C4BCAA]">
                        {c.value}
                      </span>
                    </li>
                  ))}
                  {hidden > 0 && (
                    <li className="font-mono text-[10px] text-[#606060]">
                      +{hidden} more
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// View-mode toggle
// ---------------------------------------------------------------------------

function ViewModeToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  const opts: { id: ViewMode; label: string }[] = [
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
            onClick={() => onChange(o.id)}
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
          Actual: isActual ? pt.actual : null,
          Projected: !isActual ? pt.projected : null,
          breakdown,
        };
      });
      return { chartData: bridgeActualToProjected(mapped), boundaryLabel: lastActualLabel };
    }

    const sorted = [...data]
      .filter((pt) => inRange(pt.year, pt.month))
      .sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month));

    const mapped: ChartRow[] = sorted.map((pt) => {
      const label = formatLabel(pt.year, pt.month);
      if (pt.is_actual) lastActualLabel = label;
      return {
        month: label,
        Actual: pt.is_actual ? pt.total_actual : null,
        Projected: !pt.is_actual ? pt.total_projected : null,
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
        row[aKey] = monthIsActual ? b.actual : null;
        row[pKey] = !monthIsActual ? b.projected : null;
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
      // Sort pods inside each row by total desc — the tooltip already
      // surfaces biggest contributors first.
      breakdownByPod.sort((a, b) => b.total - a.total);
      row.breakdownByPod = breakdownByPod;
      return row;
    });

    return {
      chartData: bridgePodSeries(chartData, pods),
      boundaryLabel: lastActualLabel,
      pods,
    };
  }, [clientProduction, filteredClients, dateRange, podByName, podAxis]);

  const isPerPod = viewMode === "per-pod";
  const activeChartData = isPerPod ? podSeries.chartData : singleSeries.chartData;
  const activeBoundary = isPerPod ? podSeries.boundaryLabel : singleSeries.boundaryLabel;

  if (activeChartData.length === 0) {
    return (
      <div className="rounded-xl border border-[#2a2a2a] bg-[#161616] p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
            Production History
          </h3>
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
        </div>
        <p className="text-center text-sm text-[#606060]">
          No production history data available.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#161616] p-6">
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
        <ViewModeToggle value={viewMode} onChange={setViewMode} />
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart
          data={activeChartData}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
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
          <Tooltip
            content={
              isPerPod ? (
                <PerPodTooltip podAxis={podAxis} />
              ) : (
                <SingleTooltip />
              )
            }
            cursor={{ stroke: "#2a2a2a" }}
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
          {!isPerPod && (
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
      {isPerPod && podSeries.pods.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
          {podSeries.pods.map((pod) => {
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
        </div>
      )}
    </div>
  );
}
