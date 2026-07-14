"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, CalendarClock, Check, Database, ExternalLink, Info, Link2, RefreshCcw, Unlink } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArticleMappingsTab } from "@/components/admin/ArticleMappingsTab";
import { UnmappedNamesTab } from "@/components/admin/UnmappedNamesTab";
import { NormalizationMapTab } from "@/components/admin/NormalizationMapTab";
import { apiGet } from "@/lib/api";
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
  category: string | null;
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
  status: "open" | "mapped" | "resolved" | string;
  mapped_to: string | null;
}

interface UnassignedArticlePod {
  client_name: string;
  client_id: number | null;
  year: number;
  month: number;
  article_count: number;
  hint: "missing_month" | "never_in_et_cp" | string;
}

interface MissingClient {
  id: number;
  name_raw: string;
  first_seen_tab: string;
  last_seen_tab: string;
  status: "open" | "mapped" | "dismissed" | "resolved" | string;
  mapped_to: string | null;
}

interface DiscrepanciesResponse {
  end_date_mismatches: EndDateDiscrepancy[];
  delivered_drift: DeliveredDriftDiscrepancy[];
  pod_import_issues: PodImportIssueItem[];
  unassigned_article_pods: UnassignedArticlePod[];
  missing_clients: MissingClient[];
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
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">How to fix</th>
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
                  <td className="px-3 py-1.5 text-[#909090]">
                    {d.direction === "ops_after_sow"
                      ? "Renewal signed? Update the SOW Overview end date."
                      : "Confirm churn, or extend projections in the Operating Model."}
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

// Where each data source lives, so users know exactly which spreadsheet + tab
// to open to fix a discrepancy. Both books live in Google Sheets (IDs from the
// project links). Plain-language descriptions — no DB-column jargon.
const DQ_SHEET_LINKS = {
  capacity: "https://docs.google.com/spreadsheets/d/1I6fNQMjs2y4l6IyOxd9QL-QBjB2zGi0mcoV840JDmkI",
  masterTracker: "https://docs.google.com/spreadsheets/d/1dtZIiTKPEkhc0qrlWdlvd-n8qAn5-lhVcPkgHNgoLAY",
  // Monthly Article Count sheet (Spreadsheet 5) — source of the delivered-article rows.
  articleCount: "https://docs.google.com/spreadsheets/d/1FWykZmeG2jznUYn-ng6glN4wjvc1Swb6hHmSHzGZ7dU",
} as const;

// Maps a source-sheet tab (incomplete_clients.last_seen_tab) to WHERE it lives
// (spreadsheet) and WHICH dashboard the dropped data would have appeared in —
// so the Missing-from-Hub tab can tell the user where the problem hits and
// where to go fix it.
function sourceMeta(tab: string): { book: string; href: string; affects: string } {
  const t = (tab || "").toLowerCase();
  if (t.includes("operating model"))
    return { book: "Editorial Capacity Planning", href: DQ_SHEET_LINKS.capacity, affects: "Overview → Production History · Editorial Clients delivery" };
  if (t.includes("delivered vs invoiced"))
    return { book: "Editorial Capacity Planning", href: DQ_SHEET_LINKS.capacity, affects: "Editorial Clients → Deliverables vs SOW" };
  if (t.includes("meta"))
    return { book: "Editorial Capacity Planning", href: DQ_SHEET_LINKS.capacity, affects: "Editorial Clients → Meta deliveries" };
  if (t.includes("et cp"))
    return { book: "Editorial Capacity Planning", href: DQ_SHEET_LINKS.capacity, affects: "Team KPIs → Capacity · pod assignment" };
  if (t.includes("cumulative"))
    return { book: "Master Tracker", href: DQ_SHEET_LINKS.masterTracker, affects: "Editorial Clients → Cumulative Pipeline" };
  return { book: "—", href: DQ_SHEET_LINKS.capacity, affects: "—" };
}

// Per-row recommended fix. Heuristic: names with test/placeholder/support
// markers are almost certainly NOT real clients → can be ignored; everything
// else is probably a client missing from the SOW Overview → add it there. It's
// only a hint shown read-only; the actual fix happens in the source sheet.
function suggestFix(name: string): { kind: "add" | "dismiss"; text: string } {
  const n = (name || "").toLowerCase();
  const looksLikeNoise =
    /\[test\]|\[new client\]|\bko\s*#|\bsales\b|\bnew clients\b|\(support\)|\(test\)|\btest\b|ai articles/.test(n);
  return looksLikeNoise
    ? { kind: "dismiss", text: "Likely not a real client — can be ignored" }
    : { kind: "add", text: "Add to SOW Overview, then SYNC" };
}

// Lifecycle badge shared by the two mapping tabs (Missing from Hub, Pod issues)
// so a resolved row stays visible with what happened to it instead of vanishing.
function MapStatusBadge({ status, mappedTo }: { status: string; mappedTo: string | null }) {
  if (status === "mapped")
    return (
      <span className="inline-flex items-center gap-1 rounded-sm bg-[#42CA80]/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[#42CA80]">
        <Check className="h-3 w-3 shrink-0" />
        Mapped{mappedTo ? ` → ${mappedTo}` : ""}
      </span>
    );
  if (status === "dismissed")
    return (
      <span className="inline-flex items-center rounded-sm bg-[#2a2a2a] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[#707070]">
        Dismissed
      </span>
    );
  if (status === "resolved")
    return (
      <span className="inline-flex items-center gap-1 rounded-sm bg-[#42CA80]/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[#42CA80]">
        <Check className="h-3 w-3 shrink-0" />
        Added to Hub
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#F5BC4E]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#F5BC4E]" />
      Open
    </span>
  );
}

// Short, direct reminder: a map only writes a rule — it links the sheet name to a
// Hub client and the data flows in on the NEXT SYNC (nothing changes until then).
function SyncHint({ className = "" }: { className?: string }) {
  return (
    <span
      className={"inline-flex items-center gap-1.5 font-mono text-[10px] text-[#707070] " + className}
      title="A map links the sheet name to a Hub client. Its data is re-imported (and reaches the dashboards) on the next SYNC."
    >
      <RefreshCcw className="h-3 w-3 shrink-0 text-[#42CA80]" />
      Maps link the name to a Hub client — applied on the next SYNC
    </span>
  );
}

// Dedicated tab: clients that appear in a source sheet but have NO record in
// the Hub, so the importer drops all their rows. Read-only — each row states the
// problem, where the source data lives (tab + spreadsheet, linked), and which
// dashboard it hits. Rows that self-heal on a later SYNC flip to Resolved (filter
// by To-do / Resolved); the fix is made in the source sheet, not here.
function MissingFromHubTab({ rows }: { rows: MissingClient[]; onRefresh?: () => void }) {
  const [view, setView] = useState<"all" | "todo" | "resolved">("all");

  const openCount = rows.filter((r) => r.status === "open").length;
  const resolvedCount = rows.length - openCount;
  const shown = rows.filter((r) =>
    view === "all" ? true : view === "todo" ? r.status === "open" : r.status !== "open",
  );

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="shrink-0 space-y-0.5 font-mono text-[11px]">
        <p className="text-[#606060]">
          <span className="text-[#C4BCAA] font-semibold">What&apos;s flagged:</span>{" "}
          a client name appears in a source sheet but has{" "}
          <span className="text-[#ED6958]">no matching client in the Hub</span> — so the importer
          drops all of its rows, and its delivery never reaches the dashboards.
        </p>
        <p className="text-[#606060]">
          <span className="text-[#C4BCAA] font-semibold">How to fix (at the source):</span>{" "}
          add the client to the{" "}
          <a href={DQ_SHEET_LINKS.capacity} target="_blank" rel="noopener noreferrer" className="text-[#42CA80] hover:underline">
            SOW Overview
          </a>{" "}
          sheet — or correct its name there to match an existing Hub client — then SYNC. Names that
          aren&apos;t real clients (a header / total / placeholder like &quot;New clients&quot;) can be
          ignored. This list is read-only: fixing the source corrects the data everywhere.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-6 text-center font-mono text-[12px] text-[#42CA80]">
          Nothing flagged — every name in the source sheets maps to a Hub client.
        </div>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <FilterChip label={`All · ${rows.length}`} active={view === "all"} onClick={() => setView("all")} />
            <FilterChip label={`To do · ${openCount}`} active={view === "todo"} onClick={() => setView("todo")} />
            <FilterChip label={`Resolved · ${resolvedCount}`} active={view === "resolved"} onClick={() => setView("resolved")} />
            <SyncHint className="ml-auto" />
          </div>
          <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
            <table className="w-full border-collapse font-mono text-[12px]">
              <thead className="sticky top-0 z-10 bg-[#161616] text-[#606060]">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">Name in sheet</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">Problem</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">How to fix</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">Where it hits</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">Source (tab · spreadsheet)</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((m) => {
                  const meta = sourceMeta(m.last_seen_tab);
                  const fix = suggestFix(m.name_raw);
                  const isOpen = m.status === "open";
                  return (
                    <tr key={m.id} className="border-t border-[#1a1a1a] align-top hover:bg-[#161616]">
                      <td className="px-3 py-1.5 text-white">{m.name_raw}</td>
                      <td className="px-3 py-1.5">
                        <span
                          className={
                            "rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-wider " +
                            (isOpen ? "bg-[#ED6958]/15 text-[#ED6958]" : "bg-[#2a2a2a] text-[#707070]")
                          }
                        >
                          Unknown client name
                        </span>
                      </td>
                      <td className="px-3 py-1.5" style={{ color: !isOpen ? "#606060" : fix.kind === "add" ? "#42CA80" : "#F5BC4E" }}>
                        {fix.text}
                      </td>
                      <td className="px-3 py-1.5 text-[#909090]">{meta.affects}</td>
                      <td className="px-3 py-1.5">
                        <a href={meta.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#42CA80] hover:underline">
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          <span className="text-[#C4BCAA]">{m.last_seen_tab}</span>
                        </a>
                        <span className="text-[#606060]"> · {meta.book}</span>
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center justify-end">
                          <MapStatusBadge status={m.status} mappedTo={m.mapped_to} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-[#606060]">
                      No rows in this view.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// Which dashboard reads each delivered-count source — so a drift row can say
// where the disagreement actually shows up for an end user.
const DRIFT_SRC_DASHBOARD: Record<string, string> = {
  ops: "Production History",
  dvi: "Deliverables",
  cumul: "Cumulative Pipeline",
  sow: "SOW totals",
};

// Name the high vs low source for a drift row + the dashboards they feed.
function driftDiagnosis(d: DeliveredDriftDiscrepancy): { problem: string; where: string } {
  const srcs = (
    [
      { key: "ops", label: "Ops Model", val: d.ops_delivered },
      { key: "dvi", label: "Del vs Invoiced", val: d.dvi_delivered },
      { key: "cumul", label: "Cumul.", val: d.cumul_delivered },
      { key: "sow", label: "SOW", val: d.sow_delivered },
    ] as { key: string; label: string; val: number | null | undefined }[]
  ).filter((s): s is { key: string; label: string; val: number } => s.val != null);
  if (srcs.length < 2) return { problem: "Only one source has data.", where: "—" };
  const hi = srcs.reduce((a, b) => (b.val > a.val ? b : a));
  const lo = srcs.reduce((a, b) => (b.val < a.val ? b : a));
  if (hi.val === lo.val) return { problem: "All sources agree.", where: "—" };
  return {
    problem: `${hi.label} ${hi.val.toLocaleString()} vs ${lo.label} ${lo.val.toLocaleString()}`,
    where: `${DRIFT_SRC_DASHBOARD[hi.key]} / ${DRIFT_SRC_DASHBOARD[lo.key]}`,
  };
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
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" title="The two sources that disagree most">Problem</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" title="Dashboards reading the high vs low source">Where it hits</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-[#606060]">
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
                const diag = driftDiagnosis(d);
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
                    <td className="px-3 py-1.5 text-[#909090]">{diag.problem}</td>
                    <td className="px-3 py-1.5 text-[#909090]">{diag.where}</td>
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

function PodImportIssuesTab({ rows }: { rows: PodImportIssueItem[]; onRefresh?: () => void }) {
  const [view, setView] = useState<"all" | "todo" | "resolved">("all");
  const [colFilters, setColFilters] = useState<Record<string, ColumnFilterValue>>({});

  const openCount = rows.filter((r) => r.status === "open").length;
  const resolvedCount = rows.length - openCount;

  const podOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.pod_label ?? "").filter(Boolean))).sort(),
    [rows],
  );
  const nameOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.raw_name))).sort(),
    [rows],
  );

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  }

  function isoDate(iso: string): string {
    // For date-filter comparison; return YYYY-MM-DD slice.
    return iso.length >= 10 ? iso.slice(0, 10) : iso;
  }

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (view === "todo" && r.status !== "open") return false;
      if (view === "resolved" && r.status === "open") return false;
      if (colFilters.raw_name && !matchesFilter(r.raw_name, colFilters.raw_name)) return false;
      if (colFilters.pod_label && !matchesFilter(r.pod_label ?? "", colFilters.pod_label)) return false;
      if (colFilters.first_seen && !matchesFilter(isoDate(r.first_seen_at), colFilters.first_seen)) return false;
      if (colFilters.last_seen && !matchesFilter(isoDate(r.last_seen_at), colFilters.last_seen)) return false;
      return true;
    });
  }, [rows, colFilters, view]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="space-y-0.5 font-mono text-[11px] shrink-0">
        <p className="text-[#606060]">
          <span className="text-[#C4BCAA] font-semibold">What&apos;s flagged:</span>{" "}
          names from the Growth Pods sheet that didn&apos;t match any Hub client during SYNC.
        </p>
        <p className="text-[#606060]">
          <span className="text-[#C4BCAA] font-semibold">How to fix (at the source):</span>{" "}
          correct the name in the Growth Pods (Team Pods) sheet so it matches a Hub client — or add the
          client to <span className="text-[#42CA80]">SOW Overview</span> — then SYNC. Close names self-heal
          automatically. This list is read-only: fixing the source corrects the data everywhere.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
        <FilterChip label={`All · ${rows.length}`} active={view === "all"} onClick={() => setView("all")} />
        <FilterChip label={`To do · ${openCount}`} active={view === "todo"} onClick={() => setView("todo")} />
        <FilterChip label={`Resolved · ${resolvedCount}`} active={view === "resolved"} onClick={() => setView("resolved")} />
        <div className="ml-auto flex items-center gap-3">
          <SyncHint />
          <ClearFiltersButton filters={colFilters} setFilters={setColFilters} />
        </div>
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
              <th className="px-3 py-1.5 text-left font-medium">Status</th>
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
                  <MapStatusBadge status={r.status} mappedTo={r.mapped_to} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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

  // Per-bucket remediation, so each row says how to clear its status.
  const FIX_BY_BUCKET: Record<Bucket, string> = {
    resolved: "Linked + complete — no action.",
    drift: "Pod changed — set the latest pod in ET CP, then re-sync.",
    incomplete_sow: "Fill the missing SOW fields in SOW Overview, then SYNC.",
    no_match: "Add the client to SOW Overview, then SYNC.",
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
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">How to fix</th>
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
                            title={`Source: ${e.source_tab}${e.category ? ` · ${e.category}` : ""}`}
                            className="rounded-sm border border-[#2a2a2a] bg-[#161616] px-1.5 py-px text-[9px] text-[#909090]"
                          >
                            {fmtYM(e.year, e.month)}&nbsp;
                            <span className="text-[#42CA80]">{e.editorial_pod ?? "—"}</span>
                            {e.category && (
                              <span className={e.category === "specialized" ? "text-[#DDCFAC]" : "text-[#606060]"}>
                                &nbsp;· {e.category === "specialized" ? "spec" : "std"}
                              </span>
                            )}
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
                    <td
                      className={
                        "px-3 py-2 align-top " +
                        (bucket === "resolved" ? "text-[#606060]" : "text-[#909090]")
                      }
                    >
                      {FIX_BY_BUCKET[bucket]}
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

function UnassignedPodsTab({ rows }: { rows: UnassignedArticlePod[] }) {
  const [hintFilter, setHintFilter] = useState<"all" | "missing_month" | "never_in_et_cp">("all");
  const [colFilters, setColFilters] = useState<Record<string, ColumnFilterValue>>({});

  const hintLabel = (h: string) =>
    h === "missing_month" ? "Missing this month" : h === "never_in_et_cp" ? "Never in ET CP" : h;

  const clientOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.client_name))).sort(),
    [rows],
  );
  const monthOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => fmtYM(r.year, r.month)))).sort().reverse(),
    [rows],
  );

  const filtered = useMemo(() => {
    let r = rows;
    if (hintFilter !== "all") r = r.filter((u) => u.hint === hintFilter);
    return r.filter((u) => {
      if (colFilters.client && !matchesFilter(u.client_name, colFilters.client)) return false;
      if (colFilters.month && !matchesFilter(fmtYM(u.year, u.month), colFilters.month)) return false;
      if (colFilters.count && !matchesFilter(u.article_count, colFilters.count)) return false;
      if (colFilters.hint && !matchesFilter(hintLabel(u.hint), colFilters.hint)) return false;
      return true;
    });
  }, [rows, hintFilter, colFilters]);

  const totalArticles = useMemo(() => filtered.reduce((s, u) => s + u.article_count, 0), [filtered]);
  const missingMonthCount = useMemo(() => rows.filter((u) => u.hint === "missing_month").length, [rows]);
  const neverCount = useMemo(() => rows.filter((u) => u.hint === "never_in_et_cp").length, [rows]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="space-y-0.5 font-mono text-[11px] shrink-0">
        <p className="text-[#606060]">
          Each row is a client that <span className="text-[#C4BCAA]">delivered articles</span> that month (counted from the{" "}
          <a href={DQ_SHEET_LINKS.articleCount} target="_blank" rel="noopener noreferrer" className="text-[#42CA80] hover:underline">
            Monthly Article Count
          </a>{" "}
          sheet) but has <span className="text-[#ED6958] font-semibold">no editorial pod</span> for it. The per-month pod comes only from the{" "}
          <a href={DQ_SHEET_LINKS.capacity} target="_blank" rel="noopener noreferrer" className="text-[#42CA80] hover:underline">
            ET CP
          </a>{" "}
          sheet&apos;s Editorial Team Capacity block — with no entry there, the articles can&apos;t be attributed to a pod and fall into <span className="text-[#C4BCAA]">Unassigned</span> on Team KPIs → Monthly Articles.
        </p>
        <p className="text-[#606060]">
          <span className="text-[#F5BC4E] font-semibold">Missing this month</span> = the client IS in ET CP for other months → add it to that month&apos;s block.{" "}
          <span className="text-[#ED6958] font-semibold">Never in ET CP</span> = the client never appears in ET CP at all → add it. Fix in the ET CP sheet, then re-sync.
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <FilterChip label={`All · ${rows.length}`} active={hintFilter === "all"} onClick={() => setHintFilter("all")} />
        <FilterChip label={`Missing this month · ${missingMonthCount}`} active={hintFilter === "missing_month"} onClick={() => setHintFilter("missing_month")} />
        <FilterChip label={`Never in ET CP · ${neverCount}`} active={hintFilter === "never_in_et_cp"} onClick={() => setHintFilter("never_in_et_cp")} />
        <span className="ml-2 font-mono text-[11px] text-[#606060]">
          {filtered.length.toLocaleString()} rows · {totalArticles.toLocaleString()} articles
        </span>
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
                <FilterableHeader label="Month" filterKey="month" def={{ kind: "combobox", options: monthOptions }} filters={colFilters} setFilters={setColFilters} />
              </th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider">
                <FilterableHeader label="Articles" filterKey="count" def={{ kind: "range" }} filters={colFilters} setFilters={setColFilters} />
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                <FilterableHeader label="Status" filterKey="hint" def={{ kind: "select", options: ["Missing this month", "Never in ET CP"] }} filters={colFilters} setFilters={setColFilters} />
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" title="Where it hits: Monthly Articles → Unassigned">How to fix</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-[#606060]">
                  No unassigned-pod articles — full per-month coverage.
                </td>
              </tr>
            ) : (
              filtered.map((u) => (
                <tr key={`${u.client_name}-${u.year}-${u.month}`} className="border-t border-[#1a1a1a] hover:bg-[#161616]">
                  <td className="px-3 py-1.5 text-white">{u.client_name}</td>
                  <td className="px-3 py-1.5 text-[#909090]">{fmtYM(u.year, u.month)}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-[#C4BCAA]">
                    {u.article_count.toLocaleString()}
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={
                        "rounded-sm px-1.5 py-px text-[9px] font-semibold " +
                        (u.hint === "missing_month"
                          ? "bg-[#F5BC4E]/10 text-[#F5BC4E]"
                          : "bg-[#ED6958]/10 text-[#ED6958]")
                      }
                    >
                      {hintLabel(u.hint)}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-[#909090]">
                    {u.hint === "missing_month"
                      ? "Add this client to that month's ET CP block, then re-sync."
                      : "Add the client to ET CP, then re-sync."}
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

// ── Dashboard lens ──────────────────────────────────────────────────────────
// Scope the tabs by the dashboard a problem shows up on. Membership is
// many-to-many — a tab appears under every lens it feeds. Delivery & Contracts
// merges Overview + Editorial Clients (they share the same source data + tabs).
type LensKey = "all" | "delivery" | "team_kpis" | "platform";

const LENS_DEFS: { key: LensKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "delivery", label: "Delivery & Contracts" },
  { key: "team_kpis", label: "Team KPIs" },
  { key: "platform", label: "Platform" },
];

// Tab value → the lenses it belongs to.
const TAB_LENSES: Record<string, LensKey[]> = {
  end_date: ["delivery"],
  delivered: ["delivery"],
  missing_from_hub: ["delivery", "team_kpis"],
  pod_issues: ["team_kpis", "platform"],
  pod_history: ["team_kpis"],
  article_mappings: ["team_kpis"],
  unmapped_names: ["team_kpis", "platform"],
  pod_coverage: ["team_kpis"],
  normalization: ["team_kpis", "platform"],
  modeling: ["platform"],
};

// Canonical left-to-right tab order (used to pick the first tab in a lens).
const TAB_ORDER = [
  "end_date",
  "delivered",
  "missing_from_hub",
  "pod_issues",
  "pod_history",
  "article_mappings",
  "unmapped_names",
  "pod_coverage",
  "normalization",
  "modeling",
];

function tabInLens(tab: string, lens: LensKey): boolean {
  return lens === "all" || (TAB_LENSES[tab] ?? []).includes(lens);
}

export default function DataQualityPage() {
  const [data, setData] = useState<DiscrepanciesResponse | null>(null);
  const [podHistory, setPodHistory] = useState<PodHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lens, setLens] = useState<LensKey>("all");
  const [activeTab, setActiveTab] = useState("end_date");

  // Switch lens; if the open tab isn't in the new lens, jump to the first that is.
  const selectLens = (l: LensKey) => {
    setLens(l);
    if (!tabInLens(activeTab, l)) {
      const first = TAB_ORDER.find((t) => tabInLens(t, l));
      if (first) setActiveTab(first);
    }
  };

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
    ? new Date(data.generated_at).toLocaleString("en-US", {
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

          <div className="shrink-0 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-[#606060]">View</span>
            {LENS_DEFS.map((l) => (
              <FilterChip key={l.key} label={l.label} active={lens === l.key} onClick={() => selectLens(l.key)} />
            ))}
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 min-h-0 flex-col">
            {/* Horizontal scroll: the tab row overflows the viewport once enough
                tabs are present; pb/-mb keep the active-tab underline unclipped. */}
            <div className="shrink-0 overflow-x-auto pb-2 -mb-2">
            <TabsList variant="line" className="w-max">
              {tabInLens("end_date", lens) && (
                <TabsTrigger
                  value="end_date"
                  className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
                >
                  <CalendarClock className="mr-2 inline-block h-3.5 w-3.5" />
                  End-date mismatch ({data.end_date_mismatches.length})
                </TabsTrigger>
              )}
              {tabInLens("delivered", lens) && (
                <TabsTrigger
                  value="delivered"
                  className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
                >
                  <Database className="mr-2 inline-block h-3.5 w-3.5" />
                  Delivered drift ({data.delivered_drift.length})
                </TabsTrigger>
              )}
              {tabInLens("missing_from_hub", lens) && (
                <TabsTrigger
                  value="missing_from_hub"
                  className="data-active:border-b-2 data-active:border-[#ED6958] data-active:text-white text-[#ED6958]/80"
                >
                  <AlertTriangle className="mr-2 inline-block h-3.5 w-3.5" />
                  Missing from Hub ({data.missing_clients?.length ?? 0})
                </TabsTrigger>
              )}
              {tabInLens("pod_issues", lens) && (
                <TabsTrigger
                  value="pod_issues"
                  className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
                >
                  <Unlink className="mr-2 inline-block h-3.5 w-3.5" />
                  Pod assignment issues ({data.pod_import_issues.length})
                </TabsTrigger>
              )}
              {tabInLens("pod_history", lens) && (
                <TabsTrigger
                  value="pod_history"
                  className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
                >
                  <CalendarClock className="mr-2 inline-block h-3.5 w-3.5" />
                  Pod history
                </TabsTrigger>
              )}
              {tabInLens("article_mappings", lens) && (
                <TabsTrigger
                  value="article_mappings"
                  className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
                >
                  <Link2 className="mr-2 inline-block h-3.5 w-3.5" />
                  Article mappings
                </TabsTrigger>
              )}
              {tabInLens("unmapped_names", lens) && (
                <TabsTrigger
                  value="unmapped_names"
                  className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
                >
                  <Unlink className="mr-2 inline-block h-3.5 w-3.5" />
                  Unmapped names
                </TabsTrigger>
              )}
              {tabInLens("pod_coverage", lens) && (
                <TabsTrigger
                  value="pod_coverage"
                  className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
                >
                  <AlertTriangle className="mr-2 inline-block h-3.5 w-3.5" />
                  Pod coverage ({data.unassigned_article_pods.length})
                </TabsTrigger>
              )}
              {tabInLens("normalization", lens) && (
                <TabsTrigger
                  value="normalization"
                  className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
                >
                  <Database className="mr-2 inline-block h-3.5 w-3.5" />
                  Normalization
                </TabsTrigger>
              )}
              {tabInLens("modeling", lens) && (
                <TabsTrigger
                  value="modeling"
                  className="data-active:border-b-2 data-active:border-[#F5BC4E] data-active:text-white text-[#606060]"
                >
                  <Info className="mr-2 inline-block h-3.5 w-3.5" />
                  Modeling notes ({KNOWN_ITEMS.length})
                </TabsTrigger>
              )}
            </TabsList>
            </div>

            <TabsContent value="end_date" className="mt-3 flex-1 min-h-0 overflow-hidden">
              <EndDateDiscrepancyTab rows={data.end_date_mismatches} />
            </TabsContent>
            <TabsContent value="delivered" className="mt-3 flex-1 min-h-0 overflow-hidden">
              <DeliveredDriftTab rows={data.delivered_drift} asOfLabel={data.as_of_label} />
            </TabsContent>
            <TabsContent value="missing_from_hub" className="mt-3 flex-1 min-h-0 overflow-hidden">
              <MissingFromHubTab rows={data.missing_clients ?? []} onRefresh={load} />
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
            <TabsContent value="unmapped_names" className="mt-3 flex-1 min-h-0 overflow-hidden">
              <UnmappedNamesTab />
            </TabsContent>
            <TabsContent value="pod_coverage" className="mt-3 flex-1 min-h-0 overflow-hidden">
              <UnassignedPodsTab rows={data.unassigned_article_pods} />
            </TabsContent>
            <TabsContent value="normalization" className="mt-3 flex-1 min-h-0 overflow-hidden">
              <NormalizationMapTab />
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
