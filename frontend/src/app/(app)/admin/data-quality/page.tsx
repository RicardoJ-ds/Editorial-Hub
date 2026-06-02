"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, CalendarClock, Check, ChevronDown, Database, Info, Link2, RefreshCcw, Unlink, X } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArticleMappingsTab } from "@/components/admin/ArticleMappingsTab";
import { apiGet, apiPost } from "@/lib/api";
import {
  ClearFiltersButton,
  type ColumnFilterValue,
  FilterableHeader,
  isFilterActive,
  matchesFilter,
} from "@/components/admin/ColumnFilter";

// ─────────────────────────────────────────────────────────────────────────────
// Data Quality dashboard
//
// Surfaces per-client discrepancies that the maintainer should reconcile —
// today the data lives across multiple sheets/tables that the Ops team edits
// independently, so the same metric drifts between sources.
//
// Initial discrepancy types:
//   1. End-date mismatch  → SOW Overview vs Editorial Operating Model
//   2. Delivered drift    → SOW Overview cumulative vs Delivered vs Invoiced v2
//                            per-month sum
//
// Threshold filters (`min_end_date_diff_months=2`, `min_delivered_delta=1`)
// keep ±1-month calendar-rounding noise out of the list.
// ─────────────────────────────────────────────────────────────────────────────

interface EndDateDiscrepancy {
  client_id: number;
  client_name: string;
  status: string;
  sow_end: string;
  ops_end: string;
  diff_months: number;
  direction: "ops_after_sow" | "ops_before_sow";
}

interface DeliveredDriftDiscrepancy {
  client_id: number;
  client_name: string;
  status: string;
  as_of_label: string;
  // Source A: Editorial Operating Model (production_history actuals through as-of)
  ops_delivered: number;
  // Source B: Delivered vs Invoiced v2 (deliverables_monthly through as-of)
  dvi_delivered: number;
  // Source C: Cumulative Pipeline snapshot (cumulative_metrics.articles_sent)
  cumul_delivered: number | null;
  // Source D: SOW Overview static cumulative (clients.articles_delivered)
  sow_delivered: number;
  // Max − min across available sources
  span: number;
}

interface PodHistoryEntry {
  client_name_raw: string;
  client_id: number | null;
  client_name: string | null;
  current_pod: string | null;
  year: number;
  month: number;
  editorial_pod: string | null;
  source_tab: string;
  missing_fields: string[];
}

interface PodImportIssueItem {
  id: number;
  raw_name: string;
  pod_kind: string;
  pod_label: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

interface DiscrepanciesResponse {
  end_date_mismatches: EndDateDiscrepancy[];
  delivered_drift: DeliveredDriftDiscrepancy[];
  pod_import_issues: PodImportIssueItem[];
  generated_at: string;
  as_of_label: string;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatYM(iso: string): string {
  // ISO date "YYYY-MM-DD" → "Mon yy" without timezone bugs.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTH_SHORT[Number(m[2]) - 1]} ${m[1].slice(-2)}`;
}

function statusPill(status: string) {
  const styles: Record<string, { bg: string; fg: string }> = {
    ACTIVE: { bg: "rgba(66,202,128,0.14)", fg: "#42CA80" },
    SOON_TO_BE_ACTIVE: { bg: "rgba(245,188,78,0.14)", fg: "#F5BC4E" },
    COMPLETED: { bg: "rgba(96,96,96,0.18)", fg: "#909090" },
    CANCELLED: { bg: "rgba(237,105,88,0.14)", fg: "#ED6958" },
    INACTIVE: { bg: "rgba(96,96,96,0.18)", fg: "#909090" },
  };
  const s = styles[status] ?? styles.INACTIVE;
  return (
    <span
      className="inline-flex items-center rounded-sm px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-wider"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {status.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

function severityColor(absMonths: number): string {
  if (absMonths >= 6) return "#ED6958";
  if (absMonths >= 3) return "#F5BC4E";
  return "#909090";
}

function deltaColor(absDelta: number): string {
  if (absDelta >= 100) return "#ED6958";
  if (absDelta >= 20) return "#F5BC4E";
  return "#909090";
}

function EndDateDiscrepancyTab({ rows }: { rows: EndDateDiscrepancy[] }) {
  const [filter, setFilter] = useState<"all" | "active" | "ops_after" | "ops_before">("active");
  const [colFilters, setColFilters] = useState<Record<string, ColumnFilterValue>>({});

  const statusOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.status))).sort(),
    [rows],
  );
  const directionOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.direction))).sort(),
    [rows],
  );
  const clientOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.client_name))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    let r = rows;
    if (filter === "active") r = r.filter((d) => d.status === "ACTIVE");
    else if (filter === "ops_after") r = r.filter((d) => d.direction === "ops_after_sow");
    else if (filter === "ops_before") r = r.filter((d) => d.direction === "ops_before_sow");

    // Apply column filters with AND semantics.
    return r.filter((d) => {
      if (colFilters.client && !matchesFilter(d.client_name, colFilters.client)) return false;
      if (colFilters.status && !matchesFilter(d.status, colFilters.status)) return false;
      if (colFilters.sow_end && !matchesFilter(d.sow_end, colFilters.sow_end)) return false;
      if (colFilters.ops_end && !matchesFilter(d.ops_end, colFilters.ops_end)) return false;
      if (colFilters.diff_months && !matchesFilter(d.diff_months, colFilters.diff_months)) return false;
      if (colFilters.direction && !matchesFilter(d.direction, colFilters.direction)) return false;
      return true;
    });
  }, [rows, filter, colFilters]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="space-y-0.5 font-mono text-[11px] shrink-0">
        <p className="text-[#606060]">
          <span className="text-[#C4BCAA] font-semibold">Sources:</span>{" "}
          <span className="text-[#42CA80]">SOW Overview</span> <code className="text-[#C4BCAA]">end_date</code> vs the last month with non-zero production in the Editorial Operating Model.{" "}
          Rows show clients listed in SOW Overview only.
        </p>
        <p className="text-[#606060]">
          <span className="text-[#42CA80] font-semibold">Ops after SOW:</span>{" "}
          Renewal likely signed but not yet entered in SOW Overview.{" "}
          <span className="text-[#ED6958] font-semibold">Ops before SOW:</span>{" "}
          The team stopped projecting deliveries before contract close — often silent churn or overdue status update.
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <FilterChip label={`All · ${rows.length}`} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterChip
          label={`Active only · ${rows.filter((d) => d.status === "ACTIVE").length}`}
          active={filter === "active"}
          onClick={() => setFilter("active")}
        />
        <FilterChip
          label={`Ops after SOW · ${rows.filter((d) => d.direction === "ops_after_sow").length}`}
          active={filter === "ops_after"}
          onClick={() => setFilter("ops_after")}
          icon={<ArrowUpFromLine className="h-3 w-3" />}
        />
        <FilterChip
          label={`Ops before SOW · ${rows.filter((d) => d.direction === "ops_before_sow").length}`}
          active={filter === "ops_before"}
          onClick={() => setFilter("ops_before")}
          icon={<ArrowDownToLine className="h-3 w-3" />}
        />
        <div className="ml-auto">
          <ClearFiltersButton filters={colFilters} setFilters={setColFilters} />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
        <table className="w-full border-collapse font-mono text-[12px]">
          <thead className="sticky top-0 z-10 bg-[#161616] text-[#606060]">
            <tr>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                <FilterableHeader label="Client" filterKey="client" def={{ kind: "combobox", options: clientOptions }} filters={colFilters} setFilters={setColFilters} />
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                <FilterableHeader label="Status" filterKey="status" def={{ kind: "select", options: statusOptions }} filters={colFilters} setFilters={setColFilters} />
              </th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider">
                <FilterableHeader label="SOW end" filterKey="sow_end" def={{ kind: "date" }} filters={colFilters} setFilters={setColFilters} />
              </th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider">
                <FilterableHeader label="Ops end" filterKey="ops_end" def={{ kind: "date" }} filters={colFilters} setFilters={setColFilters} />
              </th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider">
                <FilterableHeader label="Δ months" filterKey="diff_months" def={{ kind: "range" }} filters={colFilters} setFilters={setColFilters} />
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                <FilterableHeader label="Direction" filterKey="direction" def={{ kind: "select", options: directionOptions }} filters={colFilters} setFilters={setColFilters} />
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-[#606060]">
                  No discrepancies match this filter.
                </td>
              </tr>
            ) : (
              filtered.map((d) => (
                <tr key={d.client_id} className="border-t border-[#1a1a1a] hover:bg-[#161616]">
                  <td className="px-3 py-1.5 text-white">{d.client_name}</td>
                  <td className="px-3 py-1.5">{statusPill(d.status)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#C4BCAA]">{formatYM(d.sow_end)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#C4BCAA]">{formatYM(d.ops_end)}</td>
                  <td
                    className="px-3 py-1.5 text-right font-semibold tabular-nums"
                    style={{ color: severityColor(Math.abs(d.diff_months)) }}
                  >
                    {d.diff_months > 0 ? "+" : ""}
                    {d.diff_months}
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className="inline-flex items-center gap-1 text-[11px]"
                      style={{ color: d.direction === "ops_after_sow" ? "#42CA80" : "#ED6958" }}
                    >
                      {d.direction === "ops_after_sow" ? (
                        <ArrowUpFromLine className="h-3 w-3" />
                      ) : (
                        <ArrowDownToLine className="h-3 w-3" />
                      )}
                      {d.direction === "ops_after_sow" ? "Ops after SOW" : "Ops before SOW"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function sourceColor(value: number, minVal: number, maxVal: number, isNull: boolean): string {
  if (isNull) return "#404040";
  if (maxVal === minVal) return "#C4BCAA";
  // Outlier = value equals the extreme end with span > 5
  if (value === maxVal && maxVal - minVal > 5) return "#ED6958";
  if (value === minVal && maxVal - minVal > 5) return "#F5C542";
  return "#C4BCAA";
}

function DeliveredDriftTab({ rows, asOfLabel }: { rows: DeliveredDriftDiscrepancy[]; asOfLabel: string }) {
  const [filter, setFilter] = useState<"all" | "active">("active");
  const [colFilters, setColFilters] = useState<Record<string, ColumnFilterValue>>({});

  const statusOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.status))).sort(),
    [rows],
  );
  const clientOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.client_name))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    let r = rows;
    if (filter === "active") r = r.filter((d) => d.status === "ACTIVE");
    return r.filter((d) => {
      if (colFilters.client && !matchesFilter(d.client_name, colFilters.client)) return false;
      if (colFilters.status && !matchesFilter(d.status, colFilters.status)) return false;
      if (colFilters.ops_delivered && !matchesFilter(d.ops_delivered ?? 0, colFilters.ops_delivered)) return false;
      if (colFilters.dvi_delivered && !matchesFilter(d.dvi_delivered ?? 0, colFilters.dvi_delivered)) return false;
      if (colFilters.cumul_delivered && !matchesFilter(d.cumul_delivered ?? 0, colFilters.cumul_delivered)) return false;
      if (colFilters.sow_delivered && !matchesFilter(d.sow_delivered ?? 0, colFilters.sow_delivered)) return false;
      if (colFilters.span && !matchesFilter(d.span ?? 0, colFilters.span)) return false;
      return true;
    });
  }, [rows, filter, colFilters]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="space-y-0.5 font-mono text-[11px] shrink-0">
        <p className="text-[#606060]">
          <span className="text-[#C4BCAA] font-semibold">As of {asOfLabel}:</span>{" "}
          Ops Model + Del vs Invoiced summed through this month. Cumul. + SOW are static snapshots.
          Rows show clients listed in <span className="text-[#42CA80]">SOW Overview</span> only.
        </p>
        <p className="text-[#606060]">
          <span className="text-[#ED6958] font-semibold">Red</span> = highest outlier · <span className="text-[#F5BC4E] font-semibold">Amber</span> = lowest. Rows where all sources agree are hidden.
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <FilterChip label={`All · ${rows.length}`} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterChip
          label={`Active only · ${rows.filter((d) => d.status === "ACTIVE").length}`}
          active={filter === "active"}
          onClick={() => setFilter("active")}
        />
        <div className="ml-auto">
          <ClearFiltersButton filters={colFilters} setFilters={setColFilters} />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
        <table className="w-full border-collapse font-mono text-[12px]">
          <thead className="sticky top-0 z-10 bg-[#161616] text-[#606060]">
            <tr>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                <FilterableHeader label="Client" filterKey="client" def={{ kind: "combobox", options: clientOptions }} filters={colFilters} setFilters={setColFilters} />
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                <FilterableHeader label="Status" filterKey="status" def={{ kind: "select", options: statusOptions }} filters={colFilters} setFilters={setColFilters} />
              </th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider" title="Editorial Operating Model — production_history.articles_actual summed through as-of month">
                <FilterableHeader label="Ops Model" filterKey="ops_delivered" def={{ kind: "range" }} filters={colFilters} setFilters={setColFilters} />
              </th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider" title="Delivered vs Invoiced v2 — deliverables_monthly.articles_delivered summed through as-of month">
                <FilterableHeader label="Del vs Invoiced" filterKey="dvi_delivered" def={{ kind: "range" }} filters={colFilters} setFilters={setColFilters} />
              </th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider" title="Cumulative Pipeline — cumulative_metrics.articles_sent snapshot">
                <FilterableHeader label="Cumul." filterKey="cumul_delivered" def={{ kind: "range" }} filters={colFilters} setFilters={setColFilters} />
              </th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider" title="SOW Overview — clients.articles_delivered static cumulative">
                <FilterableHeader label="SOW" filterKey="sow_delivered" def={{ kind: "range" }} filters={colFilters} setFilters={setColFilters} />
              </th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider">
                <FilterableHeader label="Span" filterKey="span" def={{ kind: "range" }} filters={colFilters} setFilters={setColFilters} />
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-[#606060]">
                  No discrepancies match this filter.
                </td>
              </tr>
            ) : (
              filtered.map((d) => {
                const ops = d.ops_delivered ?? 0;
                const dvi = d.dvi_delivered ?? 0;
                const sow = d.sow_delivered ?? 0;
                const span = d.span ?? 0;
                const nonNullVals = [ops, dvi, d.cumul_delivered, sow].filter(
                  (v): v is number => v !== null && v !== undefined,
                );
                const minV = nonNullVals.length ? Math.min(...nonNullVals) : 0;
                const maxV = nonNullVals.length ? Math.max(...nonNullVals) : 0;
                return (
                  <tr key={d.client_id} className="border-t border-[#1a1a1a] hover:bg-[#161616]">
                    <td className="px-3 py-1.5 text-white">{d.client_name}</td>
                    <td className="px-3 py-1.5">{statusPill(d.status)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold" style={{ color: sourceColor(ops, minV, maxV, false) }}>
                      {ops.toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold" style={{ color: sourceColor(dvi, minV, maxV, false) }}>
                      {dvi.toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold" style={{ color: sourceColor(d.cumul_delivered ?? 0, minV, maxV, d.cumul_delivered == null) }}>
                      {d.cumul_delivered == null ? <span className="text-[#404040]">—</span> : d.cumul_delivered.toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold" style={{ color: sourceColor(sow, minV, maxV, false) }}>
                      {sow.toLocaleString()}
                    </td>
                    <td
                      className="px-3 py-1.5 text-right font-semibold tabular-nums"
                      style={{ color: deltaColor(span) }}
                    >
                      ±{span.toLocaleString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface ClientOption {
  id: number;
  name: string;
}

function tokenize(name: string): Set<string> {
  const tokens = name
    .replace(/([a-z])([A-Z])/g, "$1 $2") // "JustFoodForDogs" → "Just Food For Dogs"
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const intersection = [...a].filter((t) => b.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Suggest the single best-matching client using word-token Jaccard similarity.
 * Returns null when no client scores ≥ 0.4 or when two clients are tied at the top.
 */
function suggestClient(rawName: string, clients: ClientOption[]): ClientOption | null {
  const rawTokens = tokenize(rawName);
  if (rawTokens.size === 0) return null;

  const THRESHOLD = 0.4;
  let topScore = 0;
  let topClient: ClientOption | null = null;
  let tied = false;

  for (const c of clients) {
    const score = jaccard(rawTokens, tokenize(c.name));
    if (score >= THRESHOLD) {
      if (score > topScore) {
        topScore = score;
        topClient = c;
        tied = false;
      } else if (score === topScore) {
        tied = true;
      }
    }
  }

  return tied ? null : topClient;
}

function AssignDropdown({
  rawName,
  podKind,
  clients,
  suggestion,
  onAssigned,
}: {
  rawName: string;
  podKind: string;
  clients: ClientOption[];
  suggestion: ClientOption | null;
  onAssigned: (rawName: string, clientName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ClientOption | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dropPos, setDropPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const userPicked = useRef(false);

  useEffect(() => {
    if (suggestion && !userPicked.current) setSelected(suggestion);
  }, [suggestion]);

  // Click outside works across both trigger and portaled dropdown.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !dropdownRef.current?.contains(t)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Close on outside scroll so the fixed panel doesn't drift from its
  // trigger — but allow scrolling inside the dropdown itself (the list).
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node | null;
      if (t && dropdownRef.current?.contains(t)) return; // inner list scroll
      setOpen(false);
    };
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [open]);

  function handleToggle() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const PANEL_HEIGHT = 280;
      const spaceBelow = window.innerHeight - rect.bottom;
      setDropPos({
        top: spaceBelow >= PANEL_HEIGHT ? rect.bottom + 4 : rect.top - PANEL_HEIGHT - 4,
        left: rect.left,
      });
    }
    setOpen((v) => !v);
  }

  const filtered = useMemo(
    () =>
      query.trim() === ""
        ? clients.slice(0, 30)
        : clients.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())).slice(0, 30),
    [clients, query]
  );

  async function handleConfirm() {
    if (!selected) return;
    setSaving(true);
    try {
      await apiPost("/api/admin/pod-name-overrides", {
        raw_name: rawName,
        pod_kind: podKind,
        client_id: selected.id,
      });
      setSaved(true);
      setOpen(false);
      onAssigned(rawName, selected.name);
    } catch {
      // keep open so user can retry
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm bg-[#42CA80]/10 px-2 py-0.5 font-mono text-[10px] text-[#42CA80]">
        <Check className="h-3 w-3" />
        Mapped · Pending SYNC
      </span>
    );
  }

  const panel =
    open && dropPos
      ? createPortal(
          <div
            ref={dropdownRef}
            style={{ position: "fixed", top: dropPos.top, left: dropPos.left, width: 256, zIndex: 9999 }}
            className="rounded-md border border-[#2a2a2a] bg-[#161616] shadow-xl"
          >
            <div className="border-b border-[#2a2a2a] p-2">
              <input
                autoFocus
                type="text"
                placeholder="Search clients…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-sm bg-[#0d0d0d] px-2 py-1 font-mono text-[11px] text-white placeholder-[#606060] outline-none ring-1 ring-[#2a2a2a] focus:ring-[#42CA80]/40"
              />
              <p className="mt-1 font-mono text-[10px] text-[#606060]">
                From <span className="text-[#42CA80]">SOW Overview</span> sheet · missing? Add it there first
              </p>
            </div>
            <div className="max-h-48 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-3 py-2 font-mono text-[11px] text-[#606060]">No matches</p>
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      userPicked.current = true;
                      setSelected(c);
                      setQuery("");
                      setOpen(false);
                    }}
                    className={
                      "block w-full px-3 py-1.5 text-left font-mono text-[11px] hover:bg-[#0d0d0d] " +
                      (selected?.id === c.id ? "text-[#42CA80]" : "text-[#C4BCAA]")
                    }
                  >
                    {c.name}
                  </button>
                ))
              )}
            </div>
            {selected && (
              <div className="flex items-center justify-between border-t border-[#2a2a2a] px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => { userPicked.current = true; setSelected(null); setOpen(false); }}
                  className="rounded-sm px-1.5 py-0.5 font-mono text-[10px] text-[#606060] hover:text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <div className="flex items-center gap-1">
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        className={
          "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 font-mono text-[10px] hover:border-[#42CA80]/40 hover:text-white " +
          (selected
            ? "border-[#42CA80]/30 bg-[#42CA80]/8 text-[#42CA80]"
            : "border-[#2a2a2a] bg-[#161616] text-[#909090]")
        }
      >
        {selected ? selected.name : "Assign client"}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>

      {selected && !open && (
        <button
          type="button"
          onClick={handleConfirm}
          disabled={saving}
          className="rounded-sm bg-[#42CA80]/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#42CA80] hover:bg-[#42CA80]/25 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Confirm"}
        </button>
      )}

      {panel}
    </div>
  );
}

function PodImportIssuesTab({ rows, onRefresh }: { rows: PodImportIssueItem[]; onRefresh: () => void }) {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [pending, setPending] = useState<Record<string, string>>({});
  const [colFilters, setColFilters] = useState<Record<string, ColumnFilterValue>>({});

  useEffect(() => {
    apiGet<ClientOption[]>("/api/clients/?limit=500").then((r) => setClients(r ?? []));
  }, []);

  const suggestions = useMemo(
    () => Object.fromEntries(rows.map((r) => [r.raw_name, suggestClient(r.raw_name, clients)])),
    [rows, clients]
  );

  const podOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.pod_label ?? "").filter(Boolean))).sort(),
    [rows],
  );
  const nameOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.raw_name))).sort(),
    [rows],
  );

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  }

  function isoDate(iso: string): string {
    // For date-filter comparison; return YYYY-MM-DD slice.
    return iso.length >= 10 ? iso.slice(0, 10) : iso;
  }

  function handleAssigned(rawName: string, clientName: string) {
    setPending((p) => ({ ...p, [rawName]: clientName }));
  }

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (colFilters.raw_name && !matchesFilter(r.raw_name, colFilters.raw_name)) return false;
      if (colFilters.pod_label && !matchesFilter(r.pod_label ?? "", colFilters.pod_label)) return false;
      if (colFilters.first_seen && !matchesFilter(isoDate(r.first_seen_at), colFilters.first_seen)) return false;
      if (colFilters.last_seen && !matchesFilter(isoDate(r.last_seen_at), colFilters.last_seen)) return false;
      return true;
    });
  }, [rows, colFilters]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="space-y-0.5 font-mono text-[11px] shrink-0">
        <p className="text-[#606060]">
          <span className="text-[#C4BCAA] font-semibold">Source:</span>{" "}
          Names from the Growth Pods sheet that didn&apos;t match any Hub client during SYNC.
        </p>
        <p className="text-[#606060]">
          <span className="text-[#C4BCAA] font-semibold">Map to Hub client:</span>{" "}
          The dropdown lists every client in the <span className="text-[#42CA80]">SOW Overview</span> sheet. If your target isn&apos;t there, add it to SOW Overview first then run SYNC.
        </p>
        <p className="text-[#606060]">
          Close names self-heal automatically — only assign when fuzzy-match won&apos;t catch it. Run SYNC after saving.
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <ClearFiltersButton filters={colFilters} setFilters={setColFilters} />
      </div>
      {filteredRows.length === 0 ? (
        <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-6 text-center font-mono text-[12px] text-[#42CA80]">
          {rows.length === 0 ? "No unmatched pod assignments." : "No rows match the current filters."}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead className="sticky top-0 z-10 bg-[#111111] text-[#606060]">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">
                <FilterableHeader label="Sheet name (raw)" filterKey="raw_name" def={{ kind: "combobox", options: nameOptions }} filters={colFilters} setFilters={setColFilters} />
              </th>
              <th className="px-3 py-1.5 text-left font-medium">
                <FilterableHeader label="Growth Pod" filterKey="pod_label" def={{ kind: "select", options: podOptions }} filters={colFilters} setFilters={setColFilters} />
              </th>
              <th className="px-3 py-1.5 text-left font-medium">
                <FilterableHeader label="First seen" filterKey="first_seen" def={{ kind: "date" }} filters={colFilters} setFilters={setColFilters} />
              </th>
              <th className="px-3 py-1.5 text-left font-medium">
                <FilterableHeader label="Last seen" filterKey="last_seen" def={{ kind: "date" }} filters={colFilters} setFilters={setColFilters} />
              </th>
              <th className="px-3 py-1.5 text-left font-medium">Map to Hub client</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r) => (
              <tr key={r.id} className="border-t border-[#1a1a1a] hover:bg-[#111111]">
                <td className="px-3 py-1.5 text-[#ED6958]">{r.raw_name}</td>
                <td className="px-3 py-1.5 text-[#C4BCAA]">{r.pod_label ?? "—"}</td>
                <td className="px-3 py-1.5 text-[#606060]">{formatDate(r.first_seen_at)}</td>
                <td className="px-3 py-1.5 text-[#606060]">{formatDate(r.last_seen_at)}</td>
                <td className="px-3 py-1.5">
                  <AssignDropdown
                    rawName={r.raw_name}
                    podKind={r.pod_kind}
                    clients={clients}
                    suggestion={suggestions[r.raw_name] ?? null}
                    onAssigned={handleAssigned}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {Object.keys(pending).length > 0 && (
        <div className="rounded-md border border-[#F5BC4E]/30 bg-[#F5BC4E]/5 px-3 py-2 flex items-center justify-between gap-3 shrink-0">
          <p className="font-mono text-[11px] text-[#F5BC4E]">
            {Object.keys(pending).length} override{Object.keys(pending).length !== 1 ? "s" : ""} saved — run SYNC to apply.
          </p>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1 rounded-sm border border-[#2a2a2a] bg-[#0d0d0d] px-2 py-0.5 font-mono text-[10px] text-[#C4BCAA] hover:text-white"
          >
            <RefreshCcw className="h-3 w-3" />
            Refresh
          </button>
        </div>
      )}
    </div>
  );
}

function fmtYM(year: number, month: number): string {
  if (!year || !month) return "—";
  return `${MONTH_SHORT[month - 1]} ${String(year).slice(-2)}`;
}

const MISSING_FIELD_LABELS: Record<string, string> = {
  sow_entry: "SOW entry",
  start_date: "Start date",
  end_date: "End date",
  articles_sow: "Articles SOW",
};

type PodHistoryFilter = "all" | "resolved" | "drift" | "incomplete_sow" | "no_match";

function PodHistoryTab({ rows }: { rows: PodHistoryEntry[] }) {
  const [filter, setFilter] = useState<PodHistoryFilter>("all");
  const [colFilters, setColFilters] = useState<Record<string, ColumnFilterValue>>({});

  // Group ALL rows by client (raw name) once — drives both the table and the
  // per-filter counts. Sorted client-asc; entries within a client are kept in
  // API order (year/month ASC).
  const grouped = useMemo(() => {
    const map = new Map<string, PodHistoryEntry[]>();
    for (const r of rows) {
      if (!map.has(r.client_name_raw)) map.set(r.client_name_raw, []);
      map.get(r.client_name_raw)!.push(r);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  // Per-client classification (single canonical bucket per row). A client
  // belongs to exactly one of: no_match → incomplete_sow → drift → resolved
  // (priority in that order so the chip surfaces the most actionable issue).
  type Bucket = "no_match" | "incomplete_sow" | "drift" | "resolved";
  const classify = (entries: PodHistoryEntry[]): Bucket => {
    const first = entries[0];
    if (first.client_id === null) return "no_match";
    const missing = first.missing_fields.filter((f) => f !== "sow_entry");
    if (missing.length > 0) return "incomplete_sow";
    const latest = entries[entries.length - 1];
    if (latest.editorial_pod && first.current_pod && latest.editorial_pod !== first.current_pod) {
      return "drift";
    }
    return "resolved";
  };

  const counts = useMemo(() => {
    const c = { all: grouped.length, resolved: 0, drift: 0, incomplete_sow: 0, no_match: 0 };
    for (const [, entries] of grouped) {
      c[classify(entries)] += 1;
    }
    return c;
  }, [grouped]);

  // Distinct client display names (for the Client column's combobox).
  const clientOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      s.add(r.client_name_raw);
      if (r.client_name && r.client_name !== r.client_name_raw) s.add(r.client_name);
    }
    return Array.from(s).sort();
  }, [rows]);

  // Distinct pod values seen anywhere in the data (for the Editorial Pod
  // column's select filter).
  const podOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (r.editorial_pod) s.add(r.editorial_pod);
      if (r.current_pod) s.add(r.current_pod);
    }
    return Array.from(s).sort();
  }, [rows]);

  // Distinct missing-field values (display labels).
  const missingOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      for (const m of r.missing_fields) {
        if (m === "sow_entry") continue;
        s.add(MISSING_FIELD_LABELS[m] ?? m);
      }
    }
    return Array.from(s).sort();
  }, [rows]);

  // Distinct source-tab values.
  const sourceTabOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (r.source_tab) s.add(r.source_tab);
    }
    return Array.from(s).sort();
  }, [rows]);

  const visible = useMemo(() => {
    let g = filter === "all" ? grouped : grouped.filter(([, entries]) => classify(entries) === filter);

    // Apply per-column filters. Each filter narrows the set; rows must
    // satisfy ALL active filters (AND semantics).
    g = g.filter(([rawName, entries]) => {
      const first = entries[0];
      const latest = entries[entries.length - 1];
      const displayPod = first.current_pod ?? latest?.editorial_pod ?? "";
      const missingLabels = first.missing_fields
        .filter((f) => !(first.client_id === null && f === "sow_entry"))
        .map((m) => MISSING_FIELD_LABELS[m] ?? m);

      const clientCell = `${rawName} ${first.client_name ?? ""}`;

      if (colFilters.client && isFilterActive(colFilters.client)) {
        if (!matchesFilter(clientCell, colFilters.client)) return false;
      }
      if (colFilters.editorial_pod && isFilterActive(colFilters.editorial_pod)) {
        if (!matchesFilter(displayPod, colFilters.editorial_pod)) return false;
      }
      if (colFilters.missing && isFilterActive(colFilters.missing)) {
        if (!matchesFilter(missingLabels, colFilters.missing)) return false;
      }
      if (colFilters.source_tab && isFilterActive(colFilters.source_tab)) {
        if (!matchesFilter(latest?.source_tab ?? "", colFilters.source_tab)) return false;
      }
      return true;
    });

    return g;
  }, [grouped, filter, colFilters]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="space-y-0.5 font-mono text-[11px] shrink-0">
        <p className="text-[#606060]">
          <span className="text-[#C4BCAA] font-semibold">Editorial Pod:</span>{" "}
          <span className="text-[#42CA80]">Green</span> = current ET CP assignment ·{" "}
          <span className="text-[#F5BC4E]">Amber</span> = falling back to last confirmed pod from history ·{" "}
          <span className="text-[#ED6958]">No match</span> = name in ET CP but no row in <span className="text-[#42CA80]">SOW Overview</span> yet — add it there to link the client.
        </p>
        <p className="text-[#606060]">
          <span className="text-[#F5BC4E] font-semibold">Missing:</span>{" "}
          Fields the Hub client&apos;s <span className="text-[#42CA80]">SOW Overview</span> row lacks (start date, end date, articles SOW). Fill them in + SYNC — the chip clears once the data syncs.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1 shrink-0">
        {(
          [
            { key: "all", label: "ALL", count: counts.all },
            { key: "resolved", label: "RESOLVED", count: counts.resolved },
            { key: "drift", label: "POD DRIFT", count: counts.drift },
            { key: "incomplete_sow", label: "INCOMPLETE SOW", count: counts.incomplete_sow },
            { key: "no_match", label: "NOT IN SOW OVERVIEW", count: counts.no_match },
          ] as { key: PodHistoryFilter; label: string; count: number }[]
        ).map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setFilter(opt.key)}
            className={
              "rounded-sm px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors " +
              (filter === opt.key
                ? "bg-[#42CA80]/15 text-[#42CA80] border border-[#42CA80]/40"
                : "border border-[#2a2a2a] bg-[#0d0d0d] text-[#606060] hover:text-[#C4BCAA]")
            }
          >
            {opt.label} ({opt.count})
          </button>
        ))}
        <div className="ml-auto">
          <ClearFiltersButton filters={colFilters} setFilters={setColFilters} />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-6 text-center font-mono text-[12px] text-[#606060]">
          {grouped.length === 0
            ? "No pod history records. Run the past-months resync to import ET CP Pod History."
            : "No rows match the current filter."}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead className="sticky top-0 z-10 bg-[#161616] text-[#606060]">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                  <FilterableHeader
                    label="Client"
                    filterKey="client"
                    def={{ kind: "combobox", options: clientOptions }}
                    filters={colFilters}
                    setFilters={setColFilters}
                  />
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                  <FilterableHeader
                    label="Editorial Pod"
                    filterKey="editorial_pod"
                    def={{ kind: "select", options: podOptions }}
                    filters={colFilters}
                    setFilters={setColFilters}
                  />
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                  <FilterableHeader
                    label="Missing"
                    filterKey="missing"
                    def={{ kind: "select", options: missingOptions }}
                    filters={colFilters}
                    setFilters={setColFilters}
                  />
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">Month history (confirmed, non-projected)</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                  <FilterableHeader
                    label="Source tab"
                    filterKey="source_tab"
                    def={{ kind: "select", options: sourceTabOptions }}
                    filters={colFilters}
                    setFilters={setColFilters}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map(([rawName, entries]) => {
                const first = entries[0];
                const latestEntry = entries[entries.length - 1];
                const latestHistoryPod = latestEntry?.editorial_pod ?? null;
                const isUnresolved = first.client_id === null;
                const bucket = classify(entries);
                const hasDrift = bucket === "drift";
                const currentPod = first.current_pod;
                const podSource: "live" | "from_history" | "no_match" | "empty" =
                  isUnresolved ? "no_match"
                  : currentPod ? "live"
                  : latestHistoryPod ? "from_history"
                  : "empty";
                const displayPod = currentPod ?? latestHistoryPod;
                // Missing chips: hide the "sow_entry" placeholder for unmatched
                // (the No-match pod chip already signals it); for matched rows,
                // show only the real missing fields.
                const missingChips = first.missing_fields.filter((f) => !(isUnresolved && f === "sow_entry"));
                return (
                  <tr key={rawName} className="border-t border-[#1a1a1a] hover:bg-[#161616]">
                    <td className="px-3 py-2 align-top">
                      <div className={isUnresolved ? "text-[#ED6958]" : "text-[#C4BCAA]"}>{rawName}</div>
                      {first.client_name && first.client_name !== rawName && (
                        <div className="text-[#42CA80] text-[10px]">→ {first.client_name}</div>
                      )}
                      {hasDrift && (
                        <div className="text-[10px] text-[#F5BC4E]">⚠ pod drift</div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {podSource === "no_match" && (
                        <span
                          className="rounded-sm bg-[#ED6958]/10 px-1.5 py-px text-[9px] font-semibold text-[#ED6958]"
                          title="Name found in ET CP capacity plan but missing from the SOW Overview sheet. Add the client there to link it."
                        >
                          Not in SOW Overview
                        </span>
                      )}
                      {podSource === "live" && (
                        <span className={`rounded-sm px-1.5 py-px text-[9px] font-semibold ${hasDrift ? "bg-[#F5BC4E]/10 text-[#F5BC4E]" : "bg-[#42CA80]/10 text-[#42CA80]"}`}>
                          {displayPod}
                        </span>
                      )}
                      {podSource === "from_history" && (
                        <div className="space-y-0.5">
                          <span className="rounded-sm bg-[#F5BC4E]/10 px-1.5 py-px text-[9px] font-semibold text-[#F5BC4E]">
                            {displayPod}
                          </span>
                          <div className="text-[9px] text-[#606060]">from history</div>
                        </div>
                      )}
                      {podSource === "empty" && (
                        <span className="text-[#606060]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {missingChips.length === 0 ? (
                        <span className="text-[#404040]">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {missingChips.map((mf) => (
                            <span
                              key={mf}
                              className="rounded-sm border border-[#F5C542]/30 bg-[#F5C542]/10 px-1.5 py-px font-mono text-[9px] font-semibold text-[#F5C542]"
                            >
                              {MISSING_FIELD_LABELS[mf] ?? mf}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-wrap gap-1">
                        {entries.map((e) => (
                          <span
                            key={`${e.year}-${e.month}`}
                            title={`Source: ${e.source_tab}`}
                            className="rounded-sm border border-[#2a2a2a] bg-[#161616] px-1.5 py-px text-[9px] text-[#909090]"
                          >
                            {fmtYM(e.year, e.month)}&nbsp;
                            <span className="text-[#42CA80]">{e.editorial_pod ?? "—"}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td
                      className="px-3 py-2 align-top text-[#909090] truncate max-w-[200px]"
                      title={latestEntry?.source_tab ?? ""}
                    >
                      {latestEntry?.source_tab ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors " +
        (active
          ? "border-[#42CA80]/40 bg-[#42CA80]/10 text-[#42CA80]"
          : "border-[#2a2a2a] bg-[#0d0d0d] text-[#909090] hover:text-[#C4BCAA]")
      }
    >
      {icon}
      {label}
    </button>
  );
}

export default function DataQualityPage() {
  const [data, setData] = useState<DiscrepanciesResponse | null>(null);
  const [podHistory, setPodHistory] = useState<PodHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, ph] = await Promise.all([
        apiGet<DiscrepanciesResponse>("/api/admin/discrepancies"),
        apiGet<PodHistoryEntry[]>("/api/admin/pod-history").catch(() => []),
      ]);
      setData(d);
      setPodHistory(ph ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load discrepancies");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const refresh = () => void load();
    window.addEventListener("data-synced", refresh);
    return () => window.removeEventListener("data-synced", refresh);
  }, []);

  // Group pod history by client to derive per-client buckets (no_match,
  // incomplete_sow, drift, resolved) — same logic as PodHistoryTab.classify.
  const podHistoryCounts = useMemo(() => {
    const byClient = new Map<string, PodHistoryEntry[]>();
    for (const r of podHistory) {
      if (!byClient.has(r.client_name_raw)) byClient.set(r.client_name_raw, []);
      byClient.get(r.client_name_raw)!.push(r);
    }
    const counts = { no_match: 0, incomplete_sow: 0, drift: 0, resolved: 0 };
    for (const entries of byClient.values()) {
      const first = entries[0];
      if (first.client_id === null) {
        counts.no_match += 1;
        continue;
      }
      const missing = first.missing_fields.filter((f) => f !== "sow_entry");
      if (missing.length > 0) {
        counts.incomplete_sow += 1;
        continue;
      }
      const latest = entries[entries.length - 1];
      if (latest.editorial_pod && first.current_pod && latest.editorial_pod !== first.current_pod) {
        counts.drift += 1;
        continue;
      }
      counts.resolved += 1;
    }
    return counts;
  }, [podHistory]);

  const totalActive = useMemo(() => {
    if (!data) return 0;
    return (
      data.end_date_mismatches.filter((d) => d.status === "ACTIVE").length +
      data.delivered_drift.filter((d) => d.status === "ACTIVE").length +
      data.pod_import_issues.length +
      podHistoryCounts.incomplete_sow +
      podHistoryCounts.no_match
    );
  }, [data, podHistoryCounts]);

  const generatedAt = data?.generated_at
    ? new Date(data.generated_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="flex h-[calc(100vh-88px)] flex-col gap-3 overflow-hidden">
      <div className="flex items-start justify-between gap-3 shrink-0">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
            Admin
          </p>
          <h1 className="mt-0.5 font-mono text-base font-bold uppercase tracking-[0.2em] text-white">
            Data Quality
          </h1>
          <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-[#909090]">
            <li>
              <span className="text-[#C4BCAA] font-semibold">Hub client</span> = a row in the{" "}
              <span className="text-[#42CA80]">SOW Overview</span> sheet. Names appearing in other sheets but missing from SOW Overview show as <span className="text-[#ED6958]">No match</span> / red rows
            </li>
            <li>
              <span className="text-[#C4BCAA] font-semibold">Per-client drift</span> · fixable in the source sheets (4 tabs below)
            </li>
            <li>
              <span className="text-[#F5BC4E] font-semibold">Modeling notes</span> · designed-as behaviors, fixable only by code or data-model work
            </li>
          </ul>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {generatedAt && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
              Updated {generatedAt}
            </span>
          )}
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-[#C4BCAA] hover:border-[#42CA80]/40 hover:text-white disabled:opacity-50"
          >
            <RefreshCcw className={"h-3 w-3 " + (loading ? "animate-spin" : "")} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-[#ED6958]/40 bg-[#ED6958]/10 px-3 py-2 font-mono text-[11px] text-[#ED6958] shrink-0">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-8 text-center font-mono text-[12px] text-[#606060]">
          Loading discrepancies…
        </div>
      ) : data ? (
        <>
          <div className="shrink-0">
            <SummaryRow
              endDateCount={data.end_date_mismatches.length}
              driftCount={data.delivered_drift.length}
              podIssueCount={data.pod_import_issues.length}
              noMatchCount={podHistoryCounts.no_match}
              incompleteSowCount={podHistoryCounts.incomplete_sow}
              podDriftCount={podHistoryCounts.drift}
              activeCount={totalActive}
            />
          </div>

          <Tabs defaultValue="end_date" className="flex flex-1 min-h-0 flex-col">
            <TabsList variant="line" className="shrink-0">
              <TabsTrigger
                value="end_date"
                className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
              >
                <CalendarClock className="mr-2 inline-block h-3.5 w-3.5" />
                End-date mismatch ({data.end_date_mismatches.length})
              </TabsTrigger>
              <TabsTrigger
                value="delivered"
                className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
              >
                <Database className="mr-2 inline-block h-3.5 w-3.5" />
                Delivered drift ({data.delivered_drift.length})
              </TabsTrigger>
              <TabsTrigger
                value="pod_issues"
                className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
              >
                <Unlink className="mr-2 inline-block h-3.5 w-3.5" />
                Pod assignment issues ({data.pod_import_issues.length})
              </TabsTrigger>
              <TabsTrigger
                value="pod_history"
                className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
              >
                <CalendarClock className="mr-2 inline-block h-3.5 w-3.5" />
                Pod history
              </TabsTrigger>
              <TabsTrigger
                value="article_mappings"
                className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
              >
                <Link2 className="mr-2 inline-block h-3.5 w-3.5" />
                Article mappings
              </TabsTrigger>
              <TabsTrigger
                value="modeling"
                className="data-active:border-b-2 data-active:border-[#F5BC4E] data-active:text-white text-[#606060]"
              >
                <Info className="mr-2 inline-block h-3.5 w-3.5" />
                Modeling notes ({KNOWN_ITEMS.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="end_date" className="mt-3 flex-1 min-h-0 overflow-hidden">
              <EndDateDiscrepancyTab rows={data.end_date_mismatches} />
            </TabsContent>
            <TabsContent value="delivered" className="mt-3 flex-1 min-h-0 overflow-hidden">
              <DeliveredDriftTab rows={data.delivered_drift} asOfLabel={data.as_of_label} />
            </TabsContent>
            <TabsContent value="pod_issues" className="mt-3 flex-1 min-h-0 overflow-hidden">
              <PodImportIssuesTab rows={data.pod_import_issues} onRefresh={load} />
            </TabsContent>
            <TabsContent value="pod_history" className="mt-3 flex-1 min-h-0 overflow-hidden">
              <PodHistoryTab rows={podHistory} />
            </TabsContent>
            <TabsContent value="article_mappings" className="mt-3 flex-1 min-h-0 overflow-hidden">
              <ArticleMappingsTab />
            </TabsContent>
            <TabsContent value="modeling" className="mt-3 flex-1 min-h-0 overflow-hidden">
              <KnownLimitationsTab />
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  );
}

// Items to be aware of — modeling decisions or upstream-data limits that
// can make the dashboards look "wrong" when they're actually behaving as
// designed. Distinct from per-client discrepancies further below (which
// the maintainer fixes by editing a source sheet); these are systemic and
// fixed by code/data-model work, not by the Ops team.
interface KnownItem {
  title: string;
  /** Concrete behavior a maintainer might observe and flag as wrong. */
  symptom: string;
  /** Root cause — usually a data-model decision or an upstream limitation. */
  why: string;
  /** Optional roadmap path to remove the limitation. */
  unlock?: string;
}

const KNOWN_ITEMS: KnownItem[] = [
  {
    title: "Pod assignments are not historical",
    symptom:
      "Filtering by Editorial Pod or Growth Pod uses today's roster. A client that moved from Pod 1 → Pod 2 last quarter shows only under Pod 2, even when reviewing months they were actually worked by Pod 1.",
    why:
      "We store one Editorial Pod (from the ET CP capacity plan) and one Growth Pod (from BigQuery team_pod_assignments) per client. Both are single-value columns on the clients table, not month-stamped — so when a member or a client changes pods, the prior assignment is overwritten on the next sync.",
    unlock:
      "Add a pod-membership history table (client × pod × valid_from / valid_to) and switch every pod aggregator to look up the pod valid for the month being aggregated.",
  },
  {
    title: "Goals data before Aug/Sep 2025 is partial",
    symptom:
      "Per-client month-by-month rows for early-2025 months show smaller totals than what was actually delivered. The Monthly Goals vs Delivery section already shows a yellow banner about it.",
    why:
      "Pre-Aug/Sep 2025 rows came from a different upstream sheet that didn't track all clients or all weeks. We ingested what was available so older months render, but the totals understate reality.",
    unlock:
      "Backfill the Master Tracker's [Month Year] Goals vs Delivery sheets for early-2025 months from the original sources, then re-sync.",
  },
  {
    title: "Per-row pod columns in source sheets are ignored",
    symptom:
      "Goals vs Delivery and Cumulative sheets carry their own pod columns (editorial_team_pod, growth_team_pod, account_team_pod) that sometimes disagree with the clients table. The dashboards do not honor those columns, so a client could read 'Pod 2' on a sheet row but render under Pod 1 on the dashboard.",
    why:
      "Those per-row columns are inconsistent across rows of the same client (one row says Pod 1, another is blank). To keep every aggregator agreeing on a single pod per client, we use only clients.editorial_pod / clients.growth_pod as the source of truth.",
    unlock:
      "If a client's pod looks wrong, fix it in the SOW Overview / capacity plan (Editorial) or in BigQuery team_pod_assignments (Growth). The next sync propagates everywhere.",
  },
];

function KnownLimitationsTab() {
  const count = KNOWN_ITEMS.length;
  return (
    <div className="flex h-full flex-col gap-2">
      <p className="shrink-0 font-mono text-[11px] leading-snug text-[#909090]">
        <span className="font-semibold text-[#F5BC4E]">{count} known {count === 1 ? "item" : "items"}.</span>{" "}
        These behave as designed but can look wrong at first glance. Not per-client drift — they need a code or data-model change to remove, not a sheet edit.
      </p>
      <ol className="flex-1 min-h-0 space-y-2 overflow-y-auto rounded-md border border-[#F5BC4E]/30 bg-[#F5BC4E]/5 p-2">
        {KNOWN_ITEMS.map((it, i) => (
          <li
            key={it.title}
            className="rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2"
          >
            <p className="flex items-center gap-2 font-mono text-[11px] font-semibold text-white">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#F5BC4E]/15 text-[10px] text-[#F5BC4E]">
                {i + 1}
              </span>
              {it.title}
            </p>
            <dl className="mt-1.5 space-y-1 text-[11px] leading-snug">
              <KnownField label="Symptom" body={it.symptom} />
              <KnownField label="Why" body={it.why} />
              {it.unlock && <KnownField label="How to unlock" body={it.unlock} />}
            </dl>
          </li>
        ))}
      </ol>
    </div>
  );
}

function KnownField({ label, body }: { label: string; body: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-x-3">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
        {label}
      </dt>
      <dd className="text-[#C4BCAA]">{body}</dd>
    </div>
  );
}

function SummaryRow({
  endDateCount,
  driftCount,
  podIssueCount,
  noMatchCount,
  incompleteSowCount,
  podDriftCount,
  activeCount,
}: {
  endDateCount: number;
  driftCount: number;
  podIssueCount: number;
  noMatchCount: number;
  incompleteSowCount: number;
  podDriftCount: number;
  activeCount: number;
}) {
  const total =
    endDateCount +
    driftCount +
    podIssueCount +
    noMatchCount +
    incompleteSowCount +
    podDriftCount;
  const sowActionCount = noMatchCount + incompleteSowCount;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <SummaryCard
        label="Total discrepancies"
        value={total}
        icon={<AlertTriangle className="h-3.5 w-3.5" />}
        color={total > 0 ? "#F5BC4E" : "#42CA80"}
        helper="Across all 4 per-client tabs"
      />
      <SummaryCard
        label="Needs attention"
        value={activeCount}
        icon={<AlertTriangle className="h-3.5 w-3.5" />}
        color={activeCount > 0 ? "#ED6958" : "#42CA80"}
        helper="Active drift + unmatched pods + missing SOW rows"
      />
      <SummaryCard
        label="Action in SOW Overview"
        value={sowActionCount}
        icon={<Info className="h-3.5 w-3.5" />}
        color={sowActionCount > 0 ? "#F5BC4E" : "#42CA80"}
        helper={`${noMatchCount} to add · ${incompleteSowCount} to complete`}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  helper,
  icon,
  color = "#C4BCAA",
}: {
  label: string;
  value: number | string;
  helper?: string;
  icon?: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[#2a2a2a] bg-[#161616] px-3 py-2">
      <div className="flex flex-1 flex-col">
        <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[#606060]">
          {icon}
          {label}
        </p>
        {helper && (
          <p className="font-mono text-[10px] text-[#909090]">{helper}</p>
        )}
      </div>
      {value !== "" && (
        <p className="font-mono text-xl font-bold tabular-nums" style={{ color }}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
      )}
    </div>
  );
}
