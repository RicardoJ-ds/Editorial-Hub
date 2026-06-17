"use client";

// Revisions view — the article/revision KPIs rendered in the SAME format as the
// Capacity tab (At a glance · Trend line · Pods single-month snapshot with a
// client drawer · By Editor month-matrix). Lives under the Capacity tab's
// [Capacity | Revisions] selector. Fed by /api/articles/monthly.

import { useEffect, useMemo, useRef, useState, type CSSProperties, Fragment } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { apiGet } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Client } from "@/lib/types";
import { POD_HEX_COLORS, displayPod } from "./shared-helpers";
import { SlideOverDrawer } from "./SlideOverDrawer";
import { SummaryCard } from "./SummaryCard";
import { Skeleton } from "@/components/ui/skeleton";
import type { DateRange } from "./DateRangeFilter";
import { useCurrentPodAxis } from "@/lib/podAxisClient";

type PodAxis = "editorial" | "growth";

// ── types ─────────────────────────────────────────────────────────────────
interface CreationRow {
  month_year: string;
  pod: string;
  client_name: string;
  editor_name: string;
  count: number;
  revised: number;
  published: number;
  published_revised: number;
  matched: number;
}
interface RevisionRow {
  month_year: string;
  pod: string;
  client_name: string;
  editor_name: string;
  revisions: number;
}
interface MonthlyResp {
  creation: CreationRow[];
  revisions: RevisionRow[];
}
interface EditorOpt {
  name: string;
  count: number;
}

type Dim = "pod" | "client" | "editor";
type ViewMode = Dim;
type Metric = "articles" | "rate" | "revisions";

const VIEW_MODES: { key: ViewMode; label: string }[] = [
  { key: "pod", label: "Per Pod" },
  { key: "client", label: "Per Client" },
  { key: "editor", label: "Per Editor" },
];
const METRICS: { key: Metric; label: string }[] = [
  { key: "articles", label: "Articles" },
  { key: "rate", label: "Revision rate" },
  { key: "revisions", label: "Revisions" },
];
const DIM_LABEL: Record<Dim, string> = { pod: "Pod", client: "Client", editor: "Editor" };

const SERIES_CAP = 12;
const SERIES_PALETTE = [
  "#42CA80", "#8FB5D9", "#F5C542", "#F28D59", "#ED6958", "#CEBCF4",
  "#7FE8D6", "#F472B6", "#A78BFA", "#FDBA74", "#6EE7B7", "#93C5FD",
];
const OTHER_COLOR = "#606060";
const MONTH_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTH_SHORT[parseInt(m, 10)] ?? m} ${String(y).slice(2)}`;
}
function monthKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function seriesColor(mode: ViewMode, key: string, idx: number): string {
  if (key === "Other") return OTHER_COLOR;
  if (mode === "pod") return POD_HEX_COLORS[key] ?? OTHER_COLOR;
  return SERIES_PALETTE[idx % SERIES_PALETTE.length];
}
function seriesLabel(mode: Dim, key: string, axis: PodAxis): string {
  return mode === "pod" ? displayPod(key, axis) : key;
}

// Heat tint for revision-rate cells: redder = higher rate (more rework).
function rateCellStyle(v: number | null, metric: Metric): CSSProperties {
  if (metric !== "rate" || v === null || v === undefined) return {};
  const a = Math.min(0.35, (v / 100) * 0.55);
  return a <= 0.03 ? {} : { backgroundColor: `rgba(237, 105, 88, ${a.toFixed(2)})` };
}

// ── metric value math (num/den so rates pool correctly) ─────────────────────
interface Acc {
  num: number;
  den: number;
}
const emptyAcc = (): Acc => ({ num: 0, den: 0 });
function addAcc(a: Acc, num: number, den: number) {
  a.num += num;
  a.den += den;
}
function finalize(acc: Acc | undefined, metric: Metric): number | null {
  if (!acc) return metric === "rate" ? null : 0;
  if (metric === "rate") return acc.den > 0 ? (acc.num / acc.den) * 100 : null;
  return acc.num;
}
function fmtValue(v: number | null, metric: Metric): string {
  if (v === null || v === undefined) return "—";
  return metric === "rate" ? `${Math.round(v)}%` : String(v);
}

// Raw per-group counters for the single-month snapshot (all three metrics shown
// as columns, so we keep the components rather than a single accumulator).
interface Cell {
  articles: number;
  revised: number;
  revisions: number;
}
const emptyCell = (): Cell => ({ articles: 0, revised: 0, revisions: 0 });
const cellRate = (c: Cell): number | null =>
  c.articles > 0 ? Math.round((c.revised / c.articles) * 100) : null;

// ── editor multi-select (page-scoped) ───────────────────────────────────────
function EditorMultiSelect({
  options,
  selected,
  onChange,
}: {
  options: EditorOpt[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const visible = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, draft]);

  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(next);
  };

  const label =
    selected.size === 0 ? "All editors" : `${selected.size} editor${selected.size > 1 ? "s" : ""}`;

  return (
    <div className="relative flex items-center gap-1.5" ref={wrapRef}>
      <span className="text-[10px] font-mono uppercase tracking-wider text-[#606060]">Editors</span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 items-center gap-1 rounded-md border border-[#1e1e1e] bg-transparent px-2 text-xs text-[#C4BCAA] hover:border-[#42CA80]/50"
      >
        <span>{label}</span>
        <ChevronDown className="h-3 w-3 text-[#606060]" />
      </button>
      {selected.size > 0 && (
        <button
          type="button"
          onClick={() => onChange(new Set())}
          className="text-[#606060] hover:text-[#ED6958]"
          aria-label="Clear editors"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      {open && (
        <div className="absolute top-full right-0 z-50 mt-1 w-[240px] rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] shadow-xl">
          <div className="relative border-b border-[#1f1f1f] p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3 w-3 -translate-y-1/2 text-[#606060]" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Filter editors…"
              className="h-7 w-full rounded-md border border-[#1e1e1e] bg-transparent pl-7 pr-2 text-xs text-white outline-none focus:border-[#42CA80]/50"
            />
          </div>
          <div className="max-h-[260px] overflow-y-auto py-1">
            {visible.map((o) => {
              const on = selected.has(o.name);
              return (
                <button
                  key={o.name}
                  type="button"
                  onClick={() => toggle(o.name)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                    on ? "bg-[#42CA80]/15 text-[#42CA80]" : "text-[#C4BCAA] hover:bg-[#1F1F1F]",
                  )}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span
                      className={cn(
                        "flex h-3 w-3 items-center justify-center rounded-[3px] border",
                        on ? "border-[#42CA80] bg-[#42CA80]/30" : "border-[#404040]",
                      )}
                    >
                      {on && <span className="h-1.5 w-1.5 rounded-[1px] bg-[#42CA80]" />}
                    </span>
                    <span className="truncate">{o.name}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-[#606060]">{o.count}</span>
                </button>
              );
            })}
            {visible.length === 0 && <p className="px-3 py-2 text-xs text-[#606060]">No matches.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── small segmented toggle ──────────────────────────────────────────────────
function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-[#1e1e1e] bg-[#0d0d0d] p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            "rounded px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider transition-colors",
            value === o.key ? "bg-[#42CA80]/15 text-[#42CA80]" : "text-[#606060] hover:text-[#C4BCAA]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── chart tooltip ───────────────────────────────────────────────────────────
interface TooltipPayloadItem {
  name: string;
  value: number;
  color: string;
}
function ChartTooltip({
  active,
  payload,
  label,
  metric,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  metric: Metric;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const items = [...payload]
    .filter((p) => p.value !== null && p.value !== undefined)
    .sort((a, b) => b.value - a.value);
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 shadow-xl">
      <p className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-white">
        {label}
      </p>
      <div className="space-y-0.5">
        {items.slice(0, 14).map((p) => (
          <div key={p.name} className="flex items-center justify-between gap-3 text-[11px]">
            <span className="flex items-center gap-1.5 text-[#C4BCAA]">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="font-mono text-white">{fmtValue(p.value, metric)}</span>
          </div>
        ))}
        {items.length > 14 && (
          <p className="pt-0.5 text-[10px] text-[#606060]">+{items.length - 14} more…</p>
        )}
      </div>
    </div>
  );
}

// ── main ────────────────────────────────────────────────────────────────────
export function RevisionsTab({
  filteredClients,
  dateRange,
  activePods,
}: {
  filteredClients: Client[];
  dateRange: DateRange;
  activePods: Set<string>;
}) {
  const [data, setData] = useState<MonthlyResp>({ creation: [], revisions: [] });
  const [editorOptions, setEditorOptions] = useState<EditorOpt[]>([]);
  const [selectedEditors, setSelectedEditors] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-surface metric: the snapshot Pods table shows ALL THREE as columns, so
  // only the Trend chart + By-Editor matrix carry a metric sub-toggle.
  const [chartMetric, setChartMetric] = useState<Metric>("articles");
  const [chartView, setChartView] = useState<ViewMode>("pod");
  const [matrixMetric, setMatrixMetric] = useState<Metric>("articles");

  // Pods snapshot: inline editor expansion (decoupled) + one-pod client drawer.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drawerPod, setDrawerPod] = useState<string | null>(null);
  const toggleExpanded = (pod: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pod)) next.delete(pod);
      else next.add(pod);
      return next;
    });

  const { axis } = useCurrentPodAxis();
  const podAxis: PodAxis = axis === "growth" ? "growth" : "editorial";

  const podParam = useMemo(() => {
    const pods = new Set(
      filteredClients
        .map((c) => (podAxis === "growth" ? c.growth_pod : c.editorial_pod))
        .filter((p): p is string => !!p),
    );
    return pods.size === 1 ? [...pods][0] : null;
  }, [filteredClients, podAxis]);

  const clientName = useMemo(
    () => (filteredClients.length === 1 ? filteredClients[0].name : null),
    [filteredClients],
  );

  const dateParams = useMemo(() => {
    if (dateRange.type !== "range" || !dateRange.from) return {} as { date_from?: string; date_to?: string };
    const to = dateRange.to ?? dateRange.from;
    return { date_from: monthKeyFromDate(dateRange.from), date_to: monthKeyFromDate(to) };
  }, [dateRange]);

  useEffect(() => {
    apiGet<EditorOpt[]>("/api/articles/editors")
      .then(setEditorOptions)
      .catch(() => setEditorOptions([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams();
    if (dateParams.date_from) qs.set("date_from", dateParams.date_from);
    if (dateParams.date_to) qs.set("date_to", dateParams.date_to);
    qs.set("pod_axis", podAxis);
    if (podParam) qs.set("pod", podParam);
    if (clientName) qs.set("clients", clientName);
    if (selectedEditors.size > 0) qs.set("editors", Array.from(selectedEditors).join(","));
    apiGet<MonthlyResp>(`/api/articles/monthly?${qs.toString()}`)
      .then((resp) => {
        if (!cancelled) setData(resp);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load article data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dateParams, podParam, podAxis, clientName, selectedEditors]);

  useEffect(() => {
    setExpanded(new Set());
    setDrawerPod(null);
  }, [dateParams, podParam, podAxis, clientName, selectedEditors]);

  const visiblePod = useMemo(
    () => (pod: string) => activePods.size === 0 || activePods.has(pod),
    [activePods],
  );

  // Months present (creation OR revision), sorted; selected = latest with
  // delivered articles (mirrors Capacity's "latest closed month").
  const months = useMemo(() => {
    const s = new Set<string>();
    for (const r of data.creation) s.add(r.month_year);
    for (const r of data.revisions) s.add(r.month_year);
    return [...s].sort();
  }, [data]);
  const selectedMonth = useMemo(() => {
    const withArticles = new Set(data.creation.filter((r) => r.count > 0).map((r) => r.month_year));
    const inOrder = months.filter((m) => withArticles.has(m));
    return inOrder.at(-1) ?? months.at(-1) ?? "";
  }, [data.creation, months]);

  // ── At a glance — the selected month's three figures ──
  const glance = useMemo(() => {
    let articles = 0;
    let revised = 0;
    let revisions = 0;
    for (const r of data.creation) {
      if (r.month_year !== selectedMonth || !visiblePod(r.pod)) continue;
      articles += r.count;
      revised += r.revised;
    }
    for (const r of data.revisions) {
      if (r.month_year !== selectedMonth || !visiblePod(r.pod)) continue;
      revisions += r.revisions;
    }
    return {
      articles,
      revisions,
      rate: articles > 0 ? Math.round((revised / articles) * 100) : null,
    };
  }, [data, selectedMonth, visiblePod]);

  // ── Trend chart — one metric (chartMetric) over months, top-N + Other ──
  const chartRows = useMemo(() => {
    const isRev = chartMetric === "revisions";
    return (isRev ? data.revisions : data.creation)
      .filter((r) => visiblePod(r.pod))
      .map((r) =>
        isRev
          ? {
              month_year: r.month_year,
              pod: r.pod,
              client_name: r.client_name,
              editor_name: r.editor_name,
              num: (r as RevisionRow).revisions,
              den: 0,
            }
          : {
              month_year: r.month_year,
              pod: r.pod,
              client_name: r.client_name,
              editor_name: r.editor_name,
              num: chartMetric === "rate" ? (r as CreationRow).revised : (r as CreationRow).count,
              den: chartMetric === "rate" ? (r as CreationRow).count : 0,
            },
      );
  }, [data, chartMetric, visiblePod]);

  const { chartData, series } = useMemo(() => {
    const keyOf = (r: (typeof chartRows)[number]) =>
      chartView === "pod" ? r.pod : chartView === "client" ? r.client_name : r.editor_name;
    const weights = new Map<string, number>();
    for (const r of chartRows) {
      weights.set(keyOf(r), (weights.get(keyOf(r)) ?? 0) + (chartMetric === "rate" ? r.den : r.num));
    }
    const ranked = [...weights.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const cap = chartView === "pod" ? ranked.length : SERIES_CAP;
    const top = ranked.slice(0, cap);
    const topSet = new Set(top);
    const hasOther = ranked.length > top.length;

    const byMonth = new Map<string, Map<string, Acc>>();
    for (const m of months) byMonth.set(m, new Map());
    for (const r of chartRows) {
      const bucket = byMonth.get(r.month_year);
      if (!bucket) continue;
      const k = topSet.has(keyOf(r)) ? keyOf(r) : "Other";
      let acc = bucket.get(k);
      if (!acc) {
        acc = emptyAcc();
        bucket.set(k, acc);
      }
      addAcc(acc, r.num, r.den);
    }
    const seriesKeys = hasOther ? [...top, "Other"] : top;
    const rows = months.map((m) => {
      const bucket = byMonth.get(m) ?? new Map();
      const obj: Record<string, number | string | null> = { month: fmtMonth(m) };
      for (const s of seriesKeys) obj[s] = finalize(bucket.get(s), chartMetric);
      return obj;
    });
    return {
      chartData: rows,
      series: seriesKeys.map((k, i) => ({
        key: k,
        label: k === "Other" ? "Other" : seriesLabel(chartView, k, podAxis),
        color: seriesColor(chartView, k, i),
      })),
    };
  }, [chartRows, months, chartView, chartMetric, podAxis]);

  // ── Pods snapshot (selected month) — pod → editors + per-pod clients ──
  const podSnap = useMemo(() => {
    const pods = new Map<
      string,
      Cell & { editors: Map<string, Cell>; clients: Map<string, Cell> }
    >();
    const ensurePod = (key: string) => {
      let p = pods.get(key);
      if (!p) {
        p = { articles: 0, revised: 0, revisions: 0, editors: new Map(), clients: new Map() };
        pods.set(key, p);
      }
      return p;
    };
    const ensure = (m: Map<string, Cell>, key: string) => {
      let c = m.get(key);
      if (!c) {
        c = emptyCell();
        m.set(key, c);
      }
      return c;
    };
    for (const r of data.creation) {
      if (r.month_year !== selectedMonth || !visiblePod(r.pod)) continue;
      const p = ensurePod(r.pod);
      p.articles += r.count;
      p.revised += r.revised;
      const e = ensure(p.editors, r.editor_name);
      e.articles += r.count;
      e.revised += r.revised;
      const c = ensure(p.clients, r.client_name);
      c.articles += r.count;
      c.revised += r.revised;
    }
    for (const r of data.revisions) {
      if (r.month_year !== selectedMonth || !visiblePod(r.pod)) continue;
      const p = ensurePod(r.pod);
      p.revisions += r.revisions;
      ensure(p.editors, r.editor_name).revisions += r.revisions;
      ensure(p.clients, r.client_name).revisions += r.revisions;
    }
    return [...pods.entries()].sort((a, b) =>
      a[0].localeCompare(b[0], undefined, { numeric: true }),
    );
  }, [data, selectedMonth, visiblePod]);

  const totals = useMemo(() => {
    const t = emptyCell();
    for (const [, p] of podSnap) {
      t.articles += p.articles;
      t.revised += p.revised;
      t.revisions += p.revisions;
    }
    return t;
  }, [podSnap]);

  const drawerClients = useMemo(() => {
    if (!drawerPod) return [] as [string, Cell][];
    const p = podSnap.find(([k]) => k === drawerPod);
    if (!p) return [];
    return [...p[1].clients.entries()].sort((a, b) => b[1].articles - a[1].articles);
  }, [podSnap, drawerPod]);

  // ── By Editor matrix (editor × months, one metric) ──
  const editorMatrix = useMemo(() => {
    // key = `${pod}|${editor}` → month → Cell
    const cells = new Map<string, Map<string, Cell>>();
    const meta = new Map<string, { pod: string; editor: string; articles: number; revisions: number }>();
    const touch = (pod: string, editor: string) => {
      const id = `${pod}|${editor}`;
      if (!cells.has(id)) cells.set(id, new Map());
      if (!meta.has(id)) meta.set(id, { pod, editor, articles: 0, revisions: 0 });
      return id;
    };
    const cellAt = (id: string, month: string) => {
      const byMonth = cells.get(id)!;
      let c = byMonth.get(month);
      if (!c) {
        c = emptyCell();
        byMonth.set(month, c);
      }
      return c;
    };
    for (const r of data.creation) {
      if (!visiblePod(r.pod)) continue;
      const id = touch(r.pod, r.editor_name);
      const c = cellAt(id, r.month_year);
      c.articles += r.count;
      c.revised += r.revised;
      meta.get(id)!.articles += r.count;
    }
    for (const r of data.revisions) {
      if (!visiblePod(r.pod)) continue;
      const id = touch(r.pod, r.editor_name);
      cellAt(id, r.month_year).revisions += r.revisions;
      meta.get(id)!.revisions += r.revisions;
    }
    // Rank editors within a pod by the metric being shown (rate ranks by volume).
    const rankOf = (m: { articles: number; revisions: number }) =>
      matrixMetric === "revisions" ? m.revisions : m.articles;
    const byPod = new Map<string, { id: string; editor: string; rank: number }[]>();
    for (const [id, m] of meta) {
      if (!byPod.has(m.pod)) byPod.set(m.pod, []);
      byPod.get(m.pod)!.push({ id, editor: m.editor, rank: rankOf(m) });
    }
    const pods = [...byPod.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(
        ([pod, eds]) =>
          [pod, eds.sort((a, b) => b.rank - a.rank || a.editor.localeCompare(b.editor))] as const,
      );
    const valueAt = (id: string, month: string): number | null => {
      const c = cells.get(id)?.get(month);
      if (!c) return null;
      if (matrixMetric === "articles") return c.articles;
      if (matrixMetric === "revisions") return c.revisions;
      return c.articles > 0 ? Math.round((c.revised / c.articles) * 100) : null;
    };
    const podValueAt = (pod: string, month: string): number | null => {
      let articles = 0;
      let revised = 0;
      let revisions = 0;
      for (const { id } of byPod.get(pod) ?? []) {
        const c = cells.get(id)?.get(month);
        if (!c) continue;
        articles += c.articles;
        revised += c.revised;
        revisions += c.revisions;
      }
      if (matrixMetric === "articles") return articles;
      if (matrixMetric === "revisions") return revisions;
      return articles > 0 ? Math.round((revised / articles) * 100) : null;
    };
    return { pods, valueAt, podValueAt };
  }, [data, matrixMetric, visiblePod]);

  if (loading) return <Skeleton className="h-96 w-full" />;

  const monthLabel = selectedMonth ? fmtMonth(selectedMonth) : "—";
  const heatMetric = matrixMetric === "rate";

  return (
    <div className="space-y-10">
      <div>
        <h2 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
          Revisions — {monthLabel}
        </h2>
        <p className="mt-0.5 font-mono text-[11px] text-[#606060]">
          Articles, revisions, and revision rate (articles with ≥1 revision ÷ articles). Cards + the
          Pods table show the latest in-range month with deliveries; the Trend + By-Editor matrix
          span the whole period. Editor-credits, by the article&apos;s creation month (revisions by
          their own month).
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-[#ED6958]/30 bg-[#ED6958]/10 px-4 py-3 text-sm text-[#ED6958]">
          {error}
        </div>
      )}

      {/* At a glance */}
      <section id="rev-glance" className="scroll-mt-[140px] space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
            At a glance
          </h3>
          <EditorMultiSelect
            options={editorOptions}
            selected={selectedEditors}
            onChange={setSelectedEditors}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryCard title="Articles" value={glance.articles} description="delivered this month" />
          <SummaryCard
            title="Revision rate"
            value={glance.rate === null ? "—" : `${glance.rate}%`}
            valueColor={glance.rate === null ? "white" : glance.rate > 40 ? "red" : "green"}
            description="articles revised ÷ articles"
          />
          <SummaryCard title="Revisions" value={glance.revisions} description="revision events this month" />
        </div>
      </section>

      {/* Trend */}
      <section id="rev-trend" className="scroll-mt-[140px] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
            Trend
          </h2>
          <div className="flex items-center gap-2">
            <Segmented options={METRICS} value={chartMetric} onChange={setChartMetric} />
            <Segmented options={VIEW_MODES} value={chartView} onChange={setChartView} />
          </div>
        </div>
        <p className="-mt-1 font-mono text-[11px] text-[#606060]">
          {METRICS.find((m) => m.key === chartMetric)?.label} per{" "}
          {DIM_LABEL[chartView].toLowerCase()} per month.
          {chartView !== "pod" && ` Top ${SERIES_CAP} shown; the rest fold into "Other".`}
        </p>
        <div className="rounded-xl border border-[#2a2a2a] bg-[#161616] p-4">
          {chartData.length === 0 ? (
            <div className="flex h-[320px] items-center justify-center text-sm text-[#606060]">
              No data matches the current filters.
            </div>
          ) : (
            <>
              <div style={{ width: "100%", height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
                    <XAxis dataKey="month" tick={{ fill: "#606060", fontSize: 11 }} tickLine={false} />
                    <YAxis
                      tick={{ fill: "#606060", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                      domain={chartMetric === "rate" ? [0, 100] : undefined}
                      tickFormatter={chartMetric === "rate" ? (v: number) => `${v}%` : undefined}
                    />
                    <Tooltip
                      content={<ChartTooltip metric={chartMetric} />}
                      cursor={{ stroke: "#2a2a2a" }}
                      isAnimationActive={false}
                    />
                    {series.map((s) => (
                      <Line
                        key={s.key}
                        type="monotone"
                        dataKey={s.key}
                        name={s.label}
                        stroke={s.color}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 3 }}
                        connectNulls
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {series.map((s) => (
                  <span
                    key={s.key}
                    className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider"
                    style={{ color: s.color }}
                  >
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                    {s.label}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Pods (single-month snapshot) */}
      <section id="rev-pods" className="scroll-mt-[140px] space-y-3">
        <div>
          <h2 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
            Pods
          </h2>
          <p className="mt-0.5 font-mono text-[11px] text-[#606060]">
            {monthLabel} — Articles · Revisions · Revision rate per pod. Click a pod to expand its
            editors; use <span className="text-[#909090]">Clients ▸</span> for the client breakdown.
          </p>
        </div>
        <div className="overflow-x-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
          <table className="w-full border-collapse font-mono text-[13px]">
            <thead className="bg-[#161616] text-[10px] uppercase tracking-wider text-[#606060]">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Pod / Editor</th>
                <th className="px-3 py-2 text-right font-semibold">Articles</th>
                <th className="px-3 py-2 text-right font-semibold">Revisions</th>
                <th className="px-3 py-2 text-right font-semibold">Revision rate</th>
              </tr>
            </thead>
            <tbody>
              {podSnap.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-[#606060]">
                    No article data for this month.
                  </td>
                </tr>
              ) : (
                podSnap.map(([pod, p]) => {
                  const isExpanded = expanded.has(pod);
                  const isSelected = drawerPod === pod;
                  const eds = [...p.editors.entries()].sort((a, b) => b[1].articles - a[1].articles);
                  return (
                    <Fragment key={pod}>
                      <tr
                        className={cn(
                          "cursor-pointer border-t border-[#2a2a2a] bg-[#141414] transition-colors hover:bg-[#1c1c1c]",
                          isSelected && "bg-[#42CA80]/10 hover:bg-[#42CA80]/10",
                        )}
                        onClick={() => toggleExpanded(pod)}
                      >
                        <td className="px-4 py-2 font-semibold text-[#C4BCAA]">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1.5">
                              <ChevronRight
                                className={cn(
                                  "h-3.5 w-3.5 text-[#606060] transition-transform",
                                  isExpanded && "rotate-90 text-[#42CA80]",
                                )}
                              />
                              {displayPod(pod, podAxis)}
                              <span className="ml-1 text-[10px] font-normal text-[#606060]">
                                {p.editors.size} editor{p.editors.size === 1 ? "" : "s"}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDrawerPod(isSelected ? null : pod);
                              }}
                              className={cn(
                                "rounded border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors",
                                isSelected
                                  ? "border-[#42CA80]/50 bg-[#42CA80]/15 text-[#42CA80]"
                                  : "border-[#2a2a2a] text-[#606060] hover:border-[#42CA80]/40 hover:text-[#C4BCAA]",
                              )}
                              title="Show this pod's client-by-client breakdown"
                            >
                              Clients ▸
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-white">{p.articles}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-white">{p.revisions}</td>
                        <td
                          className="px-3 py-2 text-right tabular-nums text-white"
                          style={rateCellStyle(cellRate(p), "rate")}
                        >
                          {cellRate(p) === null ? "—" : `${cellRate(p)}%`}
                        </td>
                      </tr>
                      {isExpanded &&
                        eds.map(([editor, c]) => (
                          <tr
                            key={`${pod}-${editor}`}
                            className="border-t border-[#1a1a1a] bg-[#0d0d0d] hover:bg-[#161616]"
                          >
                            <td className="px-4 py-1.5 pl-10 text-white">{editor}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-[#909090]">
                              {c.articles}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-[#909090]">
                              {c.revisions}
                            </td>
                            <td
                              className="px-3 py-1.5 text-right tabular-nums text-[#C4BCAA]"
                              style={rateCellStyle(cellRate(c), "rate")}
                            >
                              {cellRate(c) === null ? "—" : `${cellRate(c)}%`}
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })
              )}
            </tbody>
            {podSnap.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-[#2a2a2a] bg-[#111111] font-semibold">
                  <td className="px-4 py-2 text-[#C4BCAA]">Totals</td>
                  <td className="px-3 py-2 text-right tabular-nums text-white">{totals.articles}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-white">{totals.revisions}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-white">
                    {cellRate(totals) === null ? "—" : `${cellRate(totals)}%`}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {/* By Editor (editor × months heat matrix) */}
      <section id="rev-editors" className="scroll-mt-[140px] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
              By Editor
            </h2>
            <p className="mt-0.5 font-mono text-[11px] text-[#606060]">
              Each editor month by month. Pick the metric on the right.
            </p>
          </div>
          <Segmented options={METRICS} value={matrixMetric} onChange={setMatrixMetric} />
        </div>
        {months.length === 0 || editorMatrix.pods.length === 0 ? (
          <p className="font-mono text-[11px] text-[#606060]">No editor data in range.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
            <table className="w-full border-collapse font-mono text-xs">
              <thead className="bg-[#161616] text-[10px] uppercase tracking-wider text-[#606060]">
                <tr>
                  <th className="sticky left-0 z-10 min-w-[180px] bg-[#161616] px-3 py-2 text-left font-semibold">
                    Editor
                  </th>
                  {months.map((m) => (
                    <th key={m} className="px-2 py-2 text-right font-semibold whitespace-nowrap">
                      {fmtMonth(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {editorMatrix.pods.map(([pod, eds]) => (
                  <Fragment key={pod}>
                    <tr className="border-t border-[#2a2a2a] bg-[#141414]">
                      <td className="sticky left-0 z-10 bg-[#141414] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#C4BCAA]">
                        {displayPod(pod, podAxis)}
                      </td>
                      {months.map((m) => {
                        const v = editorMatrix.podValueAt(pod, m);
                        return (
                          <td key={m} className="px-2 py-1.5 text-right text-[10px] text-[#606060]">
                            {v === null ? "" : fmtValue(v, matrixMetric)}
                          </td>
                        );
                      })}
                    </tr>
                    {eds.map(({ id, editor }) => (
                      <tr key={id} className="border-t border-[#1a1a1a] hover:bg-[#161616]">
                        <td className="sticky left-0 z-10 bg-[#0d0d0d] px-3 py-1.5 whitespace-nowrap text-white">
                          {editor}
                        </td>
                        {months.map((m) => {
                          const v = editorMatrix.valueAt(id, m);
                          return (
                            <td
                              key={m}
                              className="px-2 py-1.5 text-right tabular-nums text-[#C4BCAA]"
                              style={heatMetric ? rateCellStyle(v, "rate") : {}}
                            >
                              {v === null ? "—" : fmtValue(v, matrixMetric)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <SlideOverDrawer
        open={drawerPod !== null}
        onClose={() => setDrawerPod(null)}
        title={drawerPod ? `${displayPod(drawerPod, podAxis)} — by Client` : ""}
        subtitle={`${monthLabel} — Articles · Revisions · Revision rate per client.`}
      >
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 bg-[#1F1F1F]">
            <tr>
              <th className="px-3 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-[#606060]">
                Client
              </th>
              <th className="px-3 py-2 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-[#606060]">
                Articles
              </th>
              <th className="px-3 py-2 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-[#606060]">
                Revisions
              </th>
              <th className="px-3 py-2 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-[#606060]">
                Rate
              </th>
            </tr>
          </thead>
          <tbody>
            {drawerClients.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center font-mono text-[11px] text-[#606060]">
                  No client data for this pod.
                </td>
              </tr>
            ) : (
              drawerClients.map(([client, c]) => (
                <tr key={client} className="border-t border-[#1f1f1f] hover:bg-[#161616]">
                  <td className="px-3 py-1.5 font-mono text-[#C4BCAA]">{client}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-white">{c.articles}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[#909090]">{c.revisions}</td>
                  <td
                    className="px-3 py-1.5 text-right font-mono tabular-nums text-[#C4BCAA]"
                    style={rateCellStyle(cellRate(c), "rate")}
                  >
                    {cellRate(c) === null ? "—" : `${cellRate(c)}%`}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </SlideOverDrawer>
    </div>
  );
}
