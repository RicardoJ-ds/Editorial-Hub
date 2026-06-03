"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import type { TeamKpiFilters } from "./TeamKpiFilterBar";

// ---------------------------------------------------------------------------
// Types + constants
// ---------------------------------------------------------------------------

// Per (month, pod, client, editor), bucketed by the article's CREATION month.
interface CreationRow {
  month_year: string;
  pod: string;
  client_name: string;
  editor_name: string;
  count: number; // articles (editor-credits)
  revised: number; // articles with ≥1 revision
  published: number; // matched + published (Notion)
  published_revised: number;
  matched: number; // matched to a Notion row at all
}
// Per (month, pod, client, editor), bucketed by each REVISION's own month.
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
  { key: "rate", label: "Revision rate %" },
  { key: "revisions", label: "Revisions" },
];

const DIM_LABEL: Record<Dim, string> = { pod: "Pod", client: "Client", editor: "Editor" };

const SERIES_CAP = 12;
const SERIES_PALETTE = [
  "#42CA80", "#8FB5D9", "#F5C542", "#F28D59", "#ED6958", "#CEBCF4",
  "#7FE8D6", "#F472B6", "#A78BFA", "#FDBA74", "#6EE7B7", "#93C5FD",
];
const OTHER_COLOR = "#606060";
const MONTH_SHORT = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

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
function seriesLabel(mode: Dim, key: string): string {
  return mode === "pod" ? displayPod(key, "editorial") : key;
}

// ----- metric value math (num/den so rates aggregate correctly) -----
interface Acc {
  num: number;
  den: number;
}
const emptyAcc = (): Acc => ({ num: 0, den: 0 });
function addAcc(a: Acc, num: number, den: number) {
  a.num += num;
  a.den += den;
}
// Resolve an accumulator to a display number. Rate = num/den*100 (null when no
// denominator); sum metrics = num. Computing from summed num/den means
// subtotals are a true pooled rate, not an average of rates.
function finalize(acc: Acc | undefined, metric: Metric): number | null {
  if (!acc) return metric === "rate" ? null : 0;
  if (metric === "rate") return acc.den > 0 ? (acc.num / acc.den) * 100 : null;
  return acc.num;
}
function fmtValue(v: number | null, metric: Metric): string {
  if (v === null || v === undefined) return "";
  return metric === "rate" ? `${Math.round(v)}%` : String(v);
}

// ---------------------------------------------------------------------------
// Editor multi-select (page-scoped — not part of the shared filter bar)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Small segmented toggle + dimension select
// ---------------------------------------------------------------------------

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

function DimSelect({
  label,
  value,
  exclude,
  allowNone,
  onChange,
}: {
  label: string;
  value: Dim | "none";
  exclude?: Dim;
  allowNone?: boolean;
  onChange: (v: Dim | "none") => void;
}) {
  const opts: Dim[] = ["pod", "client", "editor"];
  return (
    <label className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-[#606060]">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Dim | "none")}
        className="h-7 rounded-md border border-[#1e1e1e] bg-[#0d0d0d] px-2 text-xs text-[#C4BCAA] outline-none focus:border-[#42CA80]/50"
      >
        {allowNone && <option value="none">None</option>}
        {opts
          .filter((o) => o !== exclude)
          .map((o) => (
            <option key={o} value={o}>
              {DIM_LABEL[o]}
            </option>
          ))}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Chart tooltip (dark, on-brand) — shows the metric value per series + a
// published reference (creation-based metrics only).
// ---------------------------------------------------------------------------

interface TooltipPayloadItem {
  name: string;
  value: number;
  color: string;
}
interface MonthMeta {
  count: number;
  revised: number;
  published: number;
}
function ChartTooltip({
  active,
  payload,
  label,
  metric,
  metaByMonth,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
  metric: Metric;
  metaByMonth: Map<string, MonthMeta>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const items = [...payload]
    .filter((p) => p.value !== null && p.value !== undefined)
    .sort((a, b) => b.value - a.value);
  const meta = label ? metaByMonth.get(label) : undefined;
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 shadow-xl">
      <p className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-white">
        {label}
      </p>
      <div className="space-y-0.5">
        {items.slice(0, 14).map((p) => (
          <div key={p.name} className="flex items-center justify-between gap-3 text-[11px]">
            <span className="flex items-center gap-1.5 text-[#C4BCAA]">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="font-mono text-white">{fmtValue(p.value, metric)}</span>
          </div>
        ))}
        {items.length > 14 && (
          <p className="pt-0.5 text-[10px] text-[#606060]">+{items.length - 14} more…</p>
        )}
      </div>
      {meta && metric !== "revisions" && (
        <p className="mt-1.5 border-t border-[#1f1f1f] pt-1 font-mono text-[10px] text-[#606060]">
          {meta.revised}/{meta.count} revised · Published (Notion): {meta.published}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

export function MonthlyArticlesTab({
  filters,
  clients,
}: {
  filters: TeamKpiFilters;
  clients: Client[];
}) {
  const [data, setData] = useState<MonthlyResp>({ creation: [], revisions: [] });
  const [editorOptions, setEditorOptions] = useState<EditorOpt[]>([]);
  const [selectedEditors, setSelectedEditors] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [metric, setMetric] = useState<Metric>("articles");
  const [viewMode, setViewMode] = useState<ViewMode>("pod");
  const [primaryDim, setPrimaryDim] = useState<Dim>("client");
  const [secondaryDim, setSecondaryDim] = useState<Dim | "none">("editor");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const clientName = useMemo(() => {
    if (filters.clientId === "All") return null;
    return clients.find((c) => String(c.id) === filters.clientId)?.name ?? null;
  }, [filters.clientId, clients]);

  const dateParams = useMemo(() => {
    if (filters.dateRange.type !== "range" || !filters.dateRange.from) return {};
    const to = filters.dateRange.to ?? filters.dateRange.from;
    return { date_from: monthKeyFromDate(filters.dateRange.from), date_to: monthKeyFromDate(to) };
  }, [filters.dateRange]);

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
    if (filters.pod !== "All") qs.set("pod", filters.pod);
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
  }, [dateParams, filters.pod, clientName, selectedEditors]);

  const isRevisions = metric === "revisions";
  // Active rows projected to a uniform {month, pod, client, editor, num, den}
  // shape so the chart + matrix share one aggregation path.
  const rows = useMemo(() => {
    if (isRevisions) {
      return data.revisions.map((r) => ({
        month_year: r.month_year,
        pod: r.pod,
        client_name: r.client_name,
        editor_name: r.editor_name,
        num: r.revisions,
        den: 0,
      }));
    }
    return data.creation.map((r) => ({
      month_year: r.month_year,
      pod: r.pod,
      client_name: r.client_name,
      editor_name: r.editor_name,
      num: metric === "rate" ? r.revised : r.count,
      den: metric === "rate" ? r.count : 0,
    }));
  }, [data, metric, isRevisions]);

  const months = useMemo(
    () => [...new Set(rows.map((r) => r.month_year))].sort(),
    [rows],
  );

  // Per-month published reference for the chart tooltip (creation data only).
  const metaByMonth = useMemo(() => {
    const m = new Map<string, MonthMeta>();
    for (const r of data.creation) {
      const key = fmtMonth(r.month_year);
      const cur = m.get(key) ?? { count: 0, revised: 0, published: 0 };
      cur.count += r.count;
      cur.revised += r.revised;
      cur.published += r.published;
      m.set(key, cur);
    }
    return m;
  }, [data.creation]);

  // ----- chart series (top-N by volume + Other) -----
  const { chartData, series } = useMemo(() => {
    const keyOf = (r: (typeof rows)[number]) =>
      viewMode === "pod" ? r.pod : viewMode === "client" ? r.client_name : r.editor_name;
    // rank series by volume (denominator for rate, else the value)
    const weights = new Map<string, number>();
    for (const r of rows) {
      weights.set(keyOf(r), (weights.get(keyOf(r)) ?? 0) + (metric === "rate" ? r.den : r.num));
    }
    const ranked = [...weights.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const cap = viewMode === "pod" ? ranked.length : SERIES_CAP;
    const top = ranked.slice(0, cap);
    const topSet = new Set(top);
    const hasOther = ranked.length > top.length;

    const byMonth = new Map<string, Map<string, Acc>>();
    for (const m of months) byMonth.set(m, new Map());
    for (const r of rows) {
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
    const chartRows = months.map((m) => {
      const bucket = byMonth.get(m) ?? new Map();
      const obj: Record<string, number | string | null> = { month: fmtMonth(m) };
      for (const s of seriesKeys) obj[s] = finalize(bucket.get(s), metric);
      return obj;
    });
    return {
      chartData: chartRows,
      series: seriesKeys.map((k, i) => ({
        key: k,
        label: k === "Other" ? "Other" : seriesLabel(viewMode, k),
        color: seriesColor(viewMode, k, i),
      })),
    };
  }, [rows, months, viewMode, metric]);

  // ----- matrix (configurable 1–2 level pivot) -----
  type MNode = { key: string; byMonth: Map<string, Acc>; total: Acc };
  const matrix = useMemo(() => {
    const dimVal = (r: (typeof rows)[number], d: Dim) =>
      d === "pod" ? r.pod : d === "client" ? r.client_name : r.editor_name;
    const primary = new Map<string, MNode & { children: Map<string, MNode> }>();
    const grand = emptyAcc();
    const grandByMonth = new Map<string, Acc>();
    const bump = (map: Map<string, Acc>, key: string, num: number, den: number) => {
      let a = map.get(key);
      if (!a) {
        a = emptyAcc();
        map.set(key, a);
      }
      addAcc(a, num, den);
    };

    for (const r of rows) {
      const pKey = dimVal(r, primaryDim);
      let p = primary.get(pKey);
      if (!p) {
        p = { key: pKey, byMonth: new Map(), total: emptyAcc(), children: new Map() };
        primary.set(pKey, p);
      }
      addAcc(p.total, r.num, r.den);
      bump(p.byMonth, r.month_year, r.num, r.den);
      if (secondaryDim !== "none") {
        const sKey = dimVal(r, secondaryDim);
        let c = p.children.get(sKey);
        if (!c) {
          c = { key: sKey, byMonth: new Map(), total: emptyAcc() };
          p.children.set(sKey, c);
        }
        addAcc(c.total, r.num, r.den);
        bump(c.byMonth, r.month_year, r.num, r.den);
      }
      addAcc(grand, r.num, r.den);
      bump(grandByMonth, r.month_year, r.num, r.den);
    }
    const weight = (a: Acc) => (metric === "rate" ? a.den : a.num);
    const primaries = [...primary.values()].sort((a, b) => weight(b.total) - weight(a.total));
    return { primaries, grand, grandByMonth };
  }, [rows, primaryDim, secondaryDim, metric]);

  const toggleRow = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // headline stats (always from creation — the article universe)
  const totalArticles = useMemo(
    () => data.creation.reduce((s, r) => s + r.count, 0),
    [data.creation],
  );
  const totalRevised = useMemo(
    () => data.creation.reduce((s, r) => s + r.revised, 0),
    [data.creation],
  );
  const totalPublished = useMemo(
    () => data.creation.reduce((s, r) => s + r.published, 0),
    [data.creation],
  );
  const overallRate = totalArticles > 0 ? Math.round((totalRevised / totalArticles) * 100) : 0;

  const metricLabel = METRICS.find((m) => m.key === metric)?.label ?? "Articles";
  const pivotNote = isRevisions
    ? "by revision month (when the rework happened)"
    : "by article creation month";

  return (
    <div className="mt-3 space-y-6">
      {/* Top controls: metric selector + headline + editor multi-select */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#606060]">Metric</span>
          <Segmented options={METRICS} value={metric} onChange={setMetric} />
          <div className="flex items-center gap-4 pl-1 font-mono text-xs text-[#C4BCAA]">
            <span>
              <span className="font-semibold text-white">{totalArticles.toLocaleString()}</span> articles
            </span>
            <span>
              <span className="font-semibold text-white">{overallRate}%</span> revised
            </span>
            <span>
              <span className="font-semibold text-white">{totalPublished.toLocaleString()}</span> published
            </span>
          </div>
        </div>
        <EditorMultiSelect
          options={editorOptions}
          selected={selectedEditors}
          onChange={setSelectedEditors}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-[#ED6958]/30 bg-[#ED6958]/10 px-4 py-3 text-sm text-[#ED6958]">
          {error}
        </div>
      )}

      {/* Timeline chart */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
            {metricLabel} Over Time
          </h3>
          <Segmented options={VIEW_MODES} value={viewMode} onChange={setViewMode} />
        </div>
        <p className="-mt-1 font-mono text-[10px] text-[#606060]">
          {metricLabel} per {DIM_LABEL[viewMode].toLowerCase()} per month, {pivotNote}. Pod / Client /
          Date filters + the Editors selector narrow it.
          {metric === "rate" && " Rate = articles with ≥1 revision ÷ articles (all articles)."}
          {viewMode !== "pod" && ` Top ${SERIES_CAP} shown; the rest fold into "Other".`}
        </p>
        <div className="rounded-xl border border-[#2a2a2a] bg-[#161616] p-4">
          {loading ? (
            <div className="flex h-[320px] items-center justify-center text-sm text-[#606060]">
              Loading…
            </div>
          ) : chartData.length === 0 ? (
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
                      domain={metric === "rate" ? [0, 100] : undefined}
                      tickFormatter={metric === "rate" ? (v: number) => `${v}%` : undefined}
                    />
                    <Tooltip
                      content={<ChartTooltip metric={metric} metaByMonth={metaByMonth} />}
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
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                {series.map((s) => (
                  <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-[#C4BCAA]">
                    <span className="h-2 w-2 rounded-[2px]" style={{ background: s.color }} />
                    {s.label}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Pivot matrix */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
            {metricLabel} Matrix
          </h3>
          <div className="flex flex-wrap items-center gap-3">
            <DimSelect
              label="Group by"
              value={primaryDim}
              exclude={secondaryDim === "none" ? undefined : secondaryDim}
              onChange={(v) => {
                if (v !== "none") setPrimaryDim(v);
                setExpanded(new Set());
              }}
            />
            <DimSelect
              label="then by"
              value={secondaryDim}
              exclude={primaryDim}
              allowNone
              onChange={(v) => {
                setSecondaryDim(v);
                setExpanded(new Set());
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (secondaryDim === "none") return;
                const p = primaryDim;
                setPrimaryDim(secondaryDim);
                setSecondaryDim(p);
                setExpanded(new Set());
              }}
              disabled={secondaryDim === "none"}
              className="rounded-md border border-[#1e1e1e] px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider text-[#606060] transition-colors hover:text-[#C4BCAA] disabled:opacity-40"
            >
              Invert
            </button>
          </div>
        </div>
        <p className="-mt-1 font-mono text-[10px] text-[#606060]">
          {metricLabel}, {pivotNote}.{" "}
          {secondaryDim === "none"
            ? `One row per ${DIM_LABEL[primaryDim].toLowerCase()}.`
            : `Grouped ${DIM_LABEL[primaryDim].toLowerCase()} ▸ ${DIM_LABEL[secondaryDim].toLowerCase()} — click a row to expand. Subtotals + grand total ${metric === "rate" ? "are pooled rates (not averages)" : "sum up"}.`}
        </p>
        <div className="overflow-x-auto rounded-xl border border-[#2a2a2a] bg-[#161616]">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#2a2a2a]">
                <th className="sticky left-0 z-10 min-w-[200px] bg-[#1F1F1F] px-3 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-[#606060]">
                  {DIM_LABEL[primaryDim]}
                  {secondaryDim !== "none" && ` ▸ ${DIM_LABEL[secondaryDim]}`}
                </th>
                {months.map((m) => (
                  <th
                    key={m}
                    className="bg-[#1F1F1F] px-2 py-2 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-[#606060] whitespace-nowrap"
                  >
                    {fmtMonth(m)}
                  </th>
                ))}
                <th className="bg-[#1F1F1F] px-3 py-2 text-right font-mono text-[10px] font-bold uppercase tracking-wider text-[#C4BCAA]">
                  {metric === "rate" ? "Overall" : "Total"}
                </th>
              </tr>
            </thead>
            <tbody>
              {matrix.primaries.length === 0 ? (
                <tr>
                  <td colSpan={months.length + 2} className="px-3 py-6 text-center text-[#606060]">
                    No data matches the current filters.
                  </td>
                </tr>
              ) : (
                matrix.primaries.map((p) => (
                  <MatrixGroup
                    key={p.key}
                    primaryLabel={seriesLabel(primaryDim, p.key)}
                    node={p}
                    months={months}
                    metric={metric}
                    open={expanded.has(p.key)}
                    hasChildren={secondaryDim !== "none" && p.children.size > 0}
                    onToggle={() => toggleRow(p.key)}
                    secondaryDim={secondaryDim}
                  />
                ))
              )}
            </tbody>
            {matrix.primaries.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-[#2a2a2a] bg-[#1a1a1a]">
                  <td className="sticky left-0 z-10 bg-[#1a1a1a] px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-wider text-white">
                    {metric === "rate" ? "Overall" : "Grand total"}
                  </td>
                  {months.map((m) => (
                    <td key={m} className="px-2 py-2 text-right font-mono text-[11px] font-bold text-white">
                      {fmtValue(finalize(matrix.grandByMonth.get(m), metric), metric)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-mono text-[11px] font-bold text-[#42CA80]">
                    {fmtValue(finalize(matrix.grand, metric), metric)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Matrix group (primary row + expandable secondary rows)
// ---------------------------------------------------------------------------

function MatrixGroup({
  primaryLabel,
  node,
  months,
  metric,
  open,
  hasChildren,
  onToggle,
  secondaryDim,
}: {
  primaryLabel: string;
  node: {
    byMonth: Map<string, Acc>;
    total: Acc;
    children: Map<string, { key: string; byMonth: Map<string, Acc>; total: Acc }>;
  };
  months: string[];
  metric: Metric;
  open: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  secondaryDim: Dim | "none";
}) {
  const weight = (a: Acc) => (metric === "rate" ? a.den : a.num);
  const children = useMemo(
    () => [...node.children.values()].sort((a, b) => weight(b.total) - weight(a.total)),
    [node.children, metric],
  );
  return (
    <>
      <tr
        className={cn(
          "border-t border-[#2a2a2a] transition-colors",
          hasChildren && "cursor-pointer hover:bg-[#1F1F1F]",
        )}
        onClick={hasChildren ? onToggle : undefined}
      >
        <td className="sticky left-0 z-10 bg-[#161616] px-3 py-2 font-semibold text-white whitespace-nowrap">
          <span className="flex items-center gap-1.5">
            {hasChildren ? (
              open ? (
                <ChevronDown className="h-3 w-3 text-[#606060]" />
              ) : (
                <ChevronRight className="h-3 w-3 text-[#606060]" />
              )
            ) : (
              <span className="w-3" />
            )}
            {primaryLabel}
          </span>
        </td>
        {months.map((m) => (
          <td key={m} className="px-2 py-2 text-right font-mono text-[#C4BCAA]">
            {fmtValue(finalize(node.byMonth.get(m), metric), metric)}
          </td>
        ))}
        <td className="px-3 py-2 text-right font-mono font-semibold text-white">
          {fmtValue(finalize(node.total, metric), metric)}
        </td>
      </tr>
      {open &&
        secondaryDim !== "none" &&
        children.map((c) => (
          <tr key={c.key} className="border-t border-[#1f1f1f] bg-[#0f0f0f]">
            <td className="sticky left-0 z-10 bg-[#0f0f0f] py-1.5 pl-9 pr-3 text-[#909090] whitespace-nowrap">
              {secondaryDim === "pod" ? displayPod(c.key, "editorial") : c.key}
            </td>
            {months.map((m) => (
              <td key={m} className="px-2 py-1.5 text-right font-mono text-[#909090]">
                {fmtValue(finalize(c.byMonth.get(m), metric), metric)}
              </td>
            ))}
            <td className="px-3 py-1.5 text-right font-mono text-[#C4BCAA]">
              {fmtValue(finalize(c.total, metric), metric)}
            </td>
          </tr>
        ))}
    </>
  );
}
