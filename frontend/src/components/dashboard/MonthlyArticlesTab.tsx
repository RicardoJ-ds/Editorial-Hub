"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

interface ArticleRow {
  month_year: string; // "YYYY-MM"
  pod: string; // "Pod 3" | "Unassigned"
  client_name: string;
  editor_name: string;
  count: number;
}
interface MonthlyResp {
  rows: ArticleRow[];
  months: string[];
}
interface EditorOpt {
  name: string;
  count: number;
}

type Dim = "pod" | "client" | "editor";
type ViewMode = Dim;

const VIEW_MODES: { key: ViewMode; label: string }[] = [
  { key: "pod", label: "Per Pod" },
  { key: "client", label: "Per Client" },
  { key: "editor", label: "Per Editor" },
];

const DIM_LABEL: Record<Dim, string> = { pod: "Pod", client: "Client", editor: "Editor" };

// Series cap for client/editor views so the chart stays legible; the rest fold
// into "Other". Pod view never caps (there are only a handful of pods).
const SERIES_CAP = 12;

// DS-aligned categorical palette for client/editor series (charts need hex,
// not Tailwind classes). Greens lead, then complementary hues.
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
  const mi = parseInt(m, 10);
  return `${MONTH_SHORT[mi] ?? m} ${String(y).slice(2)}`;
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
        <div className="absolute top-full left-0 z-50 mt-1 w-[240px] rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] shadow-xl">
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
            {visible.length === 0 && (
              <p className="px-3 py-2 text-xs text-[#606060]">No matches.</p>
            )}
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
// Chart tooltip (dark, on-brand)
// ---------------------------------------------------------------------------

interface TooltipPayloadItem {
  name: string;
  value: number;
  color: string;
}
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const items = [...payload].filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  const total = items.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 shadow-xl">
      <p className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-white">
        {label} · {total} articles
      </p>
      <div className="space-y-0.5">
        {items.slice(0, 14).map((p) => (
          <div key={p.name} className="flex items-center justify-between gap-3 text-[11px]">
            <span className="flex items-center gap-1.5 text-[#C4BCAA]">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="font-mono text-white">{p.value}</span>
          </div>
        ))}
        {items.length > 14 && (
          <p className="pt-0.5 text-[10px] text-[#606060]">+{items.length - 14} more…</p>
        )}
      </div>
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
  const [data, setData] = useState<MonthlyResp>({ rows: [], months: [] });
  const [editorOptions, setEditorOptions] = useState<EditorOpt[]>([]);
  const [selectedEditors, setSelectedEditors] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("pod");
  const [primaryDim, setPrimaryDim] = useState<Dim>("client");
  const [secondaryDim, setSecondaryDim] = useState<Dim | "none">("editor");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Map the shared filter bar's clientId → canonical client name (the API
  // filters by name). The page-scoped editor multi-select drives editor
  // filtering; the shared "Member" filter is a team-roster control and does
  // not apply on this tab.
  const clientName = useMemo(() => {
    if (filters.clientId === "All") return null;
    return clients.find((c) => String(c.id) === filters.clientId)?.name ?? null;
  }, [filters.clientId, clients]);

  const dateParams = useMemo(() => {
    if (filters.dateRange.type !== "range" || !filters.dateRange.from) return {};
    const to = filters.dateRange.to ?? filters.dateRange.from;
    return { date_from: monthKeyFromDate(filters.dateRange.from), date_to: monthKeyFromDate(to) };
  }, [filters.dateRange]);

  // Editor option list (independent of filters) for the multi-select.
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
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load article counts");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dateParams, filters.pod, clientName, selectedEditors]);

  const months = data.months;

  // ----- chart series (top-N by total + Other) -----
  const { chartData, series } = useMemo(() => {
    const keyOf = (r: ArticleRow) =>
      viewMode === "pod" ? r.pod : viewMode === "client" ? r.client_name : r.editor_name;
    const totals = new Map<string, number>();
    for (const r of data.rows) totals.set(keyOf(r), (totals.get(keyOf(r)) ?? 0) + r.count);
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const cap = viewMode === "pod" ? ranked.length : SERIES_CAP;
    const top = ranked.slice(0, cap);
    const topSet = new Set(top);
    const hasOther = ranked.length > top.length;

    const byMonth = new Map<string, Record<string, number>>();
    for (const m of months) byMonth.set(m, {});
    for (const r of data.rows) {
      const bucket = byMonth.get(r.month_year);
      if (!bucket) continue;
      const k = topSet.has(keyOf(r)) ? keyOf(r) : "Other";
      bucket[k] = (bucket[k] ?? 0) + r.count;
    }
    const seriesKeys = hasOther ? [...top, "Other"] : top;
    const rows = months.map((m) => {
      const bucket = byMonth.get(m) ?? {};
      const obj: Record<string, number | string> = { month: fmtMonth(m) };
      for (const s of seriesKeys) obj[s] = bucket[s] ?? 0;
      return obj;
    });
    return {
      chartData: rows,
      series: seriesKeys.map((k, i) => ({
        key: k,
        label: k === "Other" ? "Other" : seriesLabel(viewMode, k),
        color: seriesColor(viewMode, k, i),
      })),
    };
  }, [data.rows, months, viewMode]);

  // ----- matrix (configurable 1–2 level pivot) -----
  const matrix = useMemo(() => {
    const dimVal = (r: ArticleRow, d: Dim) =>
      d === "pod" ? r.pod : d === "client" ? r.client_name : r.editor_name;

    type Node = { key: string; byMonth: Map<string, number>; total: number };
    const primary = new Map<string, Node & { children: Map<string, Node> }>();
    let grand = 0;
    const grandByMonth = new Map<string, number>();

    for (const r of data.rows) {
      const pKey = dimVal(r, primaryDim);
      let p = primary.get(pKey);
      if (!p) {
        p = { key: pKey, byMonth: new Map(), total: 0, children: new Map() };
        primary.set(pKey, p);
      }
      p.total += r.count;
      p.byMonth.set(r.month_year, (p.byMonth.get(r.month_year) ?? 0) + r.count);
      if (secondaryDim !== "none") {
        const sKey = dimVal(r, secondaryDim);
        let c = p.children.get(sKey);
        if (!c) {
          c = { key: sKey, byMonth: new Map(), total: 0 };
          p.children.set(sKey, c);
        }
        c.total += r.count;
        c.byMonth.set(r.month_year, (c.byMonth.get(r.month_year) ?? 0) + r.count);
      }
      grand += r.count;
      grandByMonth.set(r.month_year, (grandByMonth.get(r.month_year) ?? 0) + r.count);
    }
    const primaries = [...primary.values()].sort((a, b) => b.total - a.total);
    return { primaries, grand, grandByMonth };
  }, [data.rows, primaryDim, secondaryDim]);

  const toggleRow = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalArticles = useMemo(() => data.rows.reduce((s, r) => s + r.count, 0), [data.rows]);
  const distinctEditors = useMemo(
    () => new Set(data.rows.map((r) => r.editor_name)).size,
    [data.rows],
  );

  return (
    <div className="mt-3 space-y-6">
      {/* Summary + page-scoped editor multi-select */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-5 font-mono text-xs text-[#C4BCAA]">
          <span>
            <span className="font-semibold text-white">{totalArticles.toLocaleString()}</span> article
            credits
          </span>
          <span>
            <span className="font-semibold text-white">{distinctEditors}</span> editors
          </span>
          <span>
            <span className="font-semibold text-white">{months.length}</span> months
          </span>
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
            Articles Over Time
          </h3>
          <Segmented options={VIEW_MODES} value={viewMode} onChange={setViewMode} />
        </div>
        <p className="-mt-1 font-mono text-[10px] text-[#606060]">
          Article count per {DIM_LABEL[viewMode].toLowerCase()} per month. Pod / Client / Date filters
          above + the Editors selector narrow it. Tip: pick a pod, then switch to Per Editor to drill in.
          {viewMode !== "pod" && ` Top ${SERIES_CAP} shown; the rest fold into "Other".`}
        </p>
        <div className="rounded-xl border border-[#2a2a2a] bg-[#161616] p-4">
          {loading ? (
            <div className="flex h-[320px] items-center justify-center text-sm text-[#606060]">
              Loading…
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex h-[320px] items-center justify-center text-sm text-[#606060]">
              No articles match the current filters.
            </div>
          ) : (
            <>
              <div style={{ width: "100%", height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
                    <XAxis dataKey="month" tick={{ fill: "#606060", fontSize: 11 }} tickLine={false} />
                    <YAxis tick={{ fill: "#606060", fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#2a2a2a" }} isAnimationActive={false} />
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
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {/* Manual legend (on-brand, wraps) */}
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
            Article Matrix
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
          {secondaryDim === "none"
            ? `One row per ${DIM_LABEL[primaryDim].toLowerCase()}.`
            : `Grouped ${DIM_LABEL[primaryDim].toLowerCase()} ▸ ${DIM_LABEL[secondaryDim].toLowerCase()} — click a row to expand. Subtotals per group, grand total at the bottom.`}
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
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {matrix.primaries.length === 0 ? (
                <tr>
                  <td colSpan={months.length + 2} className="px-3 py-6 text-center text-[#606060]">
                    No articles match the current filters.
                  </td>
                </tr>
              ) : (
                matrix.primaries.map((p) => {
                  const isOpen = expanded.has(p.key);
                  const hasChildren = secondaryDim !== "none" && p.children.size > 0;
                  const pLabel = seriesLabel(primaryDim, p.key);
                  return (
                    <MatrixGroup
                      key={p.key}
                      primaryLabel={pLabel}
                      node={p}
                      months={months}
                      open={isOpen}
                      hasChildren={hasChildren}
                      onToggle={() => toggleRow(p.key)}
                      secondaryDim={secondaryDim}
                    />
                  );
                })
              )}
            </tbody>
            {matrix.primaries.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-[#2a2a2a] bg-[#1a1a1a]">
                  <td className="sticky left-0 z-10 bg-[#1a1a1a] px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-wider text-white">
                    Grand total
                  </td>
                  {months.map((m) => (
                    <td key={m} className="px-2 py-2 text-right font-mono text-[11px] font-bold text-white">
                      {matrix.grandByMonth.get(m) || ""}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-mono text-[11px] font-bold text-[#42CA80]">
                    {matrix.grand}
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
  open,
  hasChildren,
  onToggle,
  secondaryDim,
}: {
  primaryLabel: string;
  node: {
    byMonth: Map<string, number>;
    total: number;
    children: Map<string, { key: string; byMonth: Map<string, number>; total: number }>;
  };
  months: string[];
  open: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  secondaryDim: Dim | "none";
}) {
  const children = useMemo(
    () => [...node.children.values()].sort((a, b) => b.total - a.total),
    [node.children],
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
            {node.byMonth.get(m) || ""}
          </td>
        ))}
        <td className="px-3 py-2 text-right font-mono font-semibold text-white">{node.total}</td>
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
                {c.byMonth.get(m) || ""}
              </td>
            ))}
            <td className="px-3 py-1.5 text-right font-mono text-[#C4BCAA]">{c.total}</td>
          </tr>
        ))}
    </>
  );
}
