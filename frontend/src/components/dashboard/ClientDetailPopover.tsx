"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { ArrowUpRight, X } from "lucide-react";
import type { Client, ClientProductionRow, GoalsVsDeliveryRow } from "@/lib/types";
import {
  computeCurrentQ,
  computeLastFullQ,
  detectSummaryBillingPeriods,
  isFirstContractQ,
  type SummaryBillingPeriod,
  type SummaryRow,
} from "@/components/dashboard/DeliveryOverviewCards";
import { useEditorialAsOf } from "@/lib/editorialWeeksClient";
import {
  contentTypeRatio,
  displayPod,
} from "@/components/dashboard/shared-helpers";
import { DataQualityNote } from "@/components/dashboard/GoalsVsDeliverySection";

// ─────────────────────────────────────────────────────────────────────────────
// Client Detail Popover
//
// Click-anchored popover surfacing the same data a user would find on
// /editorial-clients but inline on /overview. Opens when the user clicks any
// per-client cell in Pod Snapshot. Variants:
//
//   • client    — snapshot summary across all four columns
//   • goals     — monthly CBs/Articles delivered ÷ goal table (last 6 months)
//   • lastQ     — last fully-closed contract Q numbers
//   • currentQ  — current contract Q projected numbers
//   • lifetime  — all-time articles delivered ÷ SOW + monthly trend
//
// Footer carries a deep link to /editorial-clients with `?search={name}` so
// the user lands on D1 already filtered to this client.
// ─────────────────────────────────────────────────────────────────────────────

export type DetailKind = "client" | "goals" | "lastQ" | "currentQ" | "lifetime";

export interface DetailState {
  kind: DetailKind;
  clientId: number;
  clientName: string;
  anchorX: number;
  anchorY: number;
}

interface Props {
  detail: DetailState;
  clients: Client[];
  summaries: SummaryRow[];
  goals: GoalsVsDeliveryRow[];
  /** Per-client monthly actual + projected from the Operating Model. Source
   *  for the projected bars on the %SOW (lifetime) trend chart — same data
   *  that powers the Cadence view on Editorial Clients. */
  clientProduction: ClientProductionRow[];
  /** "April 2026" / "Feb–Apr 2026" — the period label active in the snapshot. */
  periodLabel: string;
  /** Actual list of months that contribute to the period — used to
   *  highlight matching rows in the Goals tooltip table. */
  periodMonths: { year: number; month: number }[];
  onClose: () => void;
}

const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function parseMonthYear(s: string): { year: number; month: number } | null {
  const m = s.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const monthStr = m[1].toLowerCase().slice(0, 3);
  const idx = ["jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(monthStr);
  if (idx === -1) return null;
  return { year: parseInt(m[2], 10), month: idx + 1 };
}

function tierFor(variance: number, isNew = false) {
  if (isNew) return { color: "#8FB5D9", label: "1st Q" };
  if (variance >= 0) return { color: "#42CA80", label: "Healthy" };
  if (variance >= -5) return { color: "#F5C542", label: "Within limit" };
  return { color: "#ED6958", label: "Behind" };
}

const KIND_LABELS: Record<DetailKind, string> = {
  client: "Client snapshot",
  goals: "Goals · monthly",
  lastQ: "Last Q · actual close",
  currentQ: "Current Q · projected",
  lifetime: "%SOW · all-time",
};

export function ClientDetailPopover({
  detail,
  clients,
  summaries,
  goals,
  clientProduction,
  periodLabel,
  periodMonths,
  onClose,
}: Props) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click / ESC.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!popoverRef.current) return;
      if (popoverRef.current.contains(e.target as Node)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const client = useMemo(
    () => clients.find((c) => c.id === detail.clientId) ?? null,
    [clients, detail.clientId],
  );
  const summary = useMemo(
    () => summaries.find((s) => s.id === detail.clientId) ?? null,
    [summaries, detail.clientId],
  );

  // Position the popover so it always fits in the viewport. Strategy:
  //   1. Compute available space below + above the click point.
  //   2. Open in the larger of the two gaps.
  //   3. Cap the popover's maxHeight to that space — the body scrolls
  //      inside if content is taller. No more bottom-clipping when the
  //      click is near the top of the viewport.
  // Wider for the Q variants — they render a full monthly breakdown table.
  const WIDTH = detail.kind === "lastQ" || detail.kind === "currentQ" ? 540 : 380;
  const ESTIMATED_HEIGHT = detail.kind === "lastQ" || detail.kind === "currentQ" ? 460 : 320;
  const GAP = 12;
  const EDGE = 8;
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1280;
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
  const spaceBelow = viewportH - detail.anchorY - GAP - EDGE;
  const spaceAbove = detail.anchorY - GAP - EDGE;
  // Prefer below when it fits OR when there's more room below than above.
  const fitsBelow = spaceBelow >= ESTIMATED_HEIGHT;
  const openBelow = fitsBelow || spaceBelow >= spaceAbove;
  const usableHeight = Math.max(
    160, // sane floor so the popover is at least usable
    openBelow ? spaceBelow : spaceAbove,
  );
  const top = openBelow
    ? detail.anchorY + GAP
    : Math.max(EDGE, detail.anchorY - GAP - Math.min(ESTIMATED_HEIGHT, spaceAbove));
  // Center horizontally on the click, clamp to viewport.
  let left = detail.anchorX - WIDTH / 2;
  left = Math.max(EDGE, Math.min(viewportW - WIDTH - EDGE, left));

  // Deep link target: tab + section + search param. Matches the existing
  // PROPAGATED_FILTER_KEYS contract on /overview.
  const deepLinkPath = (() => {
    const base = `/editorial-clients?search=${encodeURIComponent(detail.clientName)}`;
    switch (detail.kind) {
      case "goals":
        return `${base}&tab=deliverables-sow#monthly-goals`;
      case "lastQ":
      case "currentQ":
        return `${base}&tab=deliverables-sow#client-delivery`;
      case "lifetime":
        return `${base}&tab=deliverables-sow#cumulative-pipeline`;
      case "client":
      default:
        return `${base}&tab=deliverables-sow`;
    }
  })();

  return (
    <div
      ref={popoverRef}
      className="fixed z-[9999] flex flex-col rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] shadow-2xl"
      style={{ left, top, width: WIDTH, maxHeight: usableHeight }}
      role="dialog"
      aria-label={`${detail.clientName} — ${KIND_LABELS[detail.kind]}`}
    >
      {/* Header */}
      <div className="flex-none flex items-start justify-between gap-3 border-b border-[#222] px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-[13px] font-semibold text-white">
            {detail.clientName}
          </p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-[#909090]">
            {KIND_LABELS[detail.kind]}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded-sm p-1 text-[#606060] transition-colors hover:bg-[#1a1a1a] hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {detail.kind === "client" && (
          <ClientSummaryBody
            client={client}
            summary={summary}
            goals={goals}
            periodLabel={periodLabel}
            periodMonths={periodMonths}
            clientName={detail.clientName}
          />
        )}
        {detail.kind === "goals" && (
          <GoalsBody
            goals={goals}
            clientName={detail.clientName}
            periodLabel={periodLabel}
            periodMonths={periodMonths}
          />
        )}
        {detail.kind === "lastQ" && (
          <QBody summary={summary} kind="last" />
        )}
        {detail.kind === "currentQ" && (
          <QBody summary={summary} kind="current" />
        )}
        {detail.kind === "lifetime" && (
          <LifetimeBody
            summary={summary}
            clientProduction={clientProduction}
            clientName={detail.clientName}
          />
        )}
      </div>

      {/* Footer */}
      <div className="flex-none border-t border-[#222] px-4 py-2.5">
        <Link
          href={deepLinkPath}
          className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[#42CA80] transition-colors hover:text-[#65FFAA]"
        >
          Open in Editorial Clients
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Body variants
// ─────────────────────────────────────────────────────────────────────────────

function ClientSummaryBody({
  client,
  summary,
  goals,
  periodLabel,
  periodMonths,
  clientName,
}: {
  client: Client | null;
  summary: SummaryRow | null;
  goals: GoalsVsDeliveryRow[];
  periodLabel: string;
  periodMonths: { year: number; month: number }[];
  clientName: string;
}) {
  // Goal totals filtered to the EXACT same months the snapshot column
  // uses — otherwise the popover shows numbers that contradict the row.
  const periodGoals = useGoalsForPeriod(goals, clientName, periodMonths);
  const lifetimePct = summary && summary.articles_sow > 0
    ? Math.round((summary.articles_delivered / summary.articles_sow) * 100)
    : null;
  return (
    <div className="space-y-3">
      {client && (
        <div className="flex items-baseline gap-2 font-mono text-[10px] text-[#909090] flex-wrap">
          <span className="rounded-sm bg-[#42CA80]/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[#42CA80]">
            {client.status ?? "—"}
          </span>
          {client.editorial_pod && (
            <span>· {displayPod(client.editorial_pod, "editorial")}</span>
          )}
          {client.growth_pod && (
            <span>· {displayPod(client.growth_pod, "growth")}</span>
          )}
        </div>
      )}

      {client && <ContractMetaBlock client={client} />}

      <StatBlock title={`Goals · ${periodLabel}`}>
        <StatRow
          left="CBs"
          right={
            periodGoals.cbGoal > 0
              ? `${Math.round(periodGoals.cbDel)} / ${Math.round(periodGoals.cbGoal)} (${Math.round(
                  (periodGoals.cbDel / periodGoals.cbGoal) * 100,
                )}%)`
              : "—"
          }
        />
        <StatRow
          left="Articles"
          right={
            periodGoals.adGoal > 0
              ? `${Math.round(periodGoals.adDel)} / ${Math.round(periodGoals.adGoal)} (${Math.round(
                  (periodGoals.adDel / periodGoals.adGoal) * 100,
                )}%)`
              : "—"
          }
        />
      </StatBlock>

      <div className="grid grid-cols-2 gap-2">
        <StatBlock title="Last Q · actual">
          <QSummaryTile summary={summary} kind="last" />
        </StatBlock>
        <StatBlock title="Current Q · projected">
          <QSummaryTile summary={summary} kind="current" />
        </StatBlock>
      </div>

      <StatBlock title="%SOW · all-time">
        <p className="font-mono">
          <span className="text-2xl font-bold tabular-nums text-white">
            {lifetimePct !== null ? `${lifetimePct}%` : "—"}
          </span>
          {summary && summary.articles_sow > 0 && (
            <span className="ml-2 text-[10px] text-[#909090]">
              {summary.articles_delivered.toLocaleString()} /{" "}
              {summary.articles_sow.toLocaleString()} articles
            </span>
          )}
        </p>
      </StatBlock>
    </div>
  );
}

function GoalsBody({
  goals,
  clientName,
  periodLabel,
  periodMonths,
}: {
  goals: GoalsVsDeliveryRow[];
  clientName: string;
  periodLabel: string;
  periodMonths: { year: number; month: number }[];
}) {
  const periodCells = useMemo(
    () => new Set(periodMonths.map((m) => m.year * 12 + (m.month - 1))),
    [periodMonths],
  );
  // Roll up the last 6 month_year buckets, sorted chronological.
  const rows = useMemo(() => {
    const byMonth = new Map<
      string,
      { y: number; m: number; cbGoal: number; cbDel: number; adGoal: number; adDel: number }
    >();
    for (const r of goals) {
      if (r.client_name !== clientName) continue;
      const ym = parseMonthYear(r.month_year);
      if (!ym) continue;
      const k = `${ym.year}-${String(ym.month).padStart(2, "0")}`;
      let agg = byMonth.get(k);
      if (!agg) {
        agg = { y: ym.year, m: ym.month, cbGoal: 0, cbDel: 0, adGoal: 0, adDel: 0 };
        byMonth.set(k, agg);
      }
      // Max-of-week per content type aggregation done elsewhere; here we
      // just take the latest cumulative (max across weeks). For the
      // popover it's sufficient — the user wanted recent monthly trend,
      // not the full 3-step roll-up.
      const ratio = contentTypeRatio(r.content_type, r.ratios);
      agg.cbGoal = Math.max(agg.cbGoal, (r.cb_monthly_goal ?? 0) * ratio);
      agg.adGoal = Math.max(agg.adGoal, (r.ad_monthly_goal ?? 0) * ratio);
      agg.cbDel = Math.max(agg.cbDel, (r.cb_delivered_to_date ?? 0) * ratio);
      agg.adDel = Math.max(agg.adDel, (r.ad_delivered_to_date ?? 0) * ratio);
    }
    // Show as many months as fit the period (so a 12-month selection
    // shows all 12 in the table) — capped at 12 so the popover doesn't
    // become a wall of text for "All time".
    const cap = Math.max(6, Math.min(12, periodMonths.length));
    const sorted = Array.from(byMonth.values())
      .sort((a, b) => (a.y * 12 + a.m) - (b.y * 12 + b.m))
      .slice(-cap);
    return sorted;
  }, [goals, clientName, periodMonths]);

  if (rows.length === 0) {
    return (
      <p className="font-mono text-[11px] text-[#606060]">
        No goals data captured for this client.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
          Last {rows.length} {rows.length === 1 ? "month" : "months"}
        </p>
        <span className="rounded-sm border border-[#42CA80]/40 bg-[#42CA80]/10 px-1.5 py-px font-mono text-[8px] uppercase tracking-wider text-[#42CA80]">
          ● In period
        </span>
      </div>
      <div className="rounded-md border border-[#1a1a1a] overflow-hidden">
        <div className="grid grid-cols-[3.5rem_1fr_1fr] gap-x-3 px-2 py-1.5 bg-[#111] border-b border-[#1a1a1a] font-mono text-[10px] tabular-nums">
          <p className="text-[#606060]">Month</p>
          <p className="text-[#606060]">CB del/goal</p>
          <p className="text-[#606060]">AR del/goal</p>
        </div>
        {rows.map((r) => {
          const cbPct = r.cbGoal > 0 ? (r.cbDel / r.cbGoal) * 100 : null;
          const adPct = r.adGoal > 0 ? (r.adDel / r.adGoal) * 100 : null;
          const inPeriod = periodCells.has(r.y * 12 + (r.m - 1));
          return (
            <div
              key={`${r.y}-${r.m}`}
              className={
                "grid grid-cols-[3.5rem_1fr_1fr] gap-x-3 px-2 py-1 font-mono text-[10px] tabular-nums border-b border-[#1a1a1a] last:border-b-0 " +
                (inPeriod ? "bg-[#42CA80]/8" : "")
              }
              style={inPeriod ? { boxShadow: "inset 2px 0 0 #42CA80" } : undefined}
            >
              <span className={inPeriod ? "text-white font-semibold" : "text-[#909090]"}>
                {MONTH_NAMES_SHORT[r.m - 1]} {String(r.y).slice(2)}
              </span>
              <span style={{ color: pctColor(cbPct) }}>
                {r.cbGoal > 0
                  ? `${Math.round(r.cbDel)}/${Math.round(r.cbGoal)} (${Math.round(cbPct!)}%)`
                  : "—"}
              </span>
              <span style={{ color: pctColor(adPct) }}>
                {r.adGoal > 0
                  ? `${Math.round(r.adDel)}/${Math.round(r.adGoal)} (${Math.round(adPct!)}%)`
                  : "—"}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 font-mono text-[9px] italic text-[#606060]">
        Highlighted rows are within: {periodLabel}.
      </p>
      <div className="mt-2">
        <DataQualityNote compact />
      </div>
    </div>
  );
}

function QBody({
  summary,
  kind,
}: {
  summary: SummaryRow | null;
  kind: "last" | "current";
}) {
  if (!summary) {
    return <p className="font-mono text-[11px] text-[#606060]">No data.</p>;
  }
  const periods = detectSummaryBillingPeriods(summary);
  // Identify which qIdx corresponds to "last full" vs "current" so we can
  // highlight the right rows in the monthly table.
  const now = new Date();
  const lastCompleted = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastCell = lastCompleted.getFullYear() * 12 + lastCompleted.getMonth();
  const todayCell = now.getFullYear() * 12 + now.getMonth();
  let lastFullQIdx: number | null = null;
  let currentQIdx: number | null = null;
  for (const p of periods) {
    if (p.isPrelude) continue;
    const start = p.startYear * 12 + (p.startMonth - 1);
    const end = p.endYear * 12 + (p.endMonth - 1);
    if (end <= lastCell) lastFullQIdx = p.qIdx;
    if (start <= todayCell && todayCell <= end) currentQIdx = p.qIdx;
  }
  const focusQIdx = kind === "last" ? lastFullQIdx : currentQIdx;
  return (
    <div className="space-y-3">
      <QSummaryTile summary={summary} kind={kind} />
      {/* SOW progress only on Current Q — for Last Q the popover is
          about a closed period and the all-time SOW bar adds noise. */}
      {kind === "current" && <SOWProgressBlock summary={summary} />}
      <MonthlyBreakdownTable
        periods={periods}
        focusQIdx={focusQIdx}
        kind={kind}
      />
      <p className="font-mono text-[9px] italic text-[#606060]">
        Q is each client&apos;s contract quarter, not calendar.{" "}
        {kind === "current" && "Projection includes future-month estimates."}
      </p>
    </div>
  );
}

/** Compact SOW progress bar — shows how much of the contract has been
 *  delivered to date. Anchors the Q numbers against the overall contract
 *  envelope so the user can tell whether the Q variance is a big or small
 *  fraction of the bigger picture. */
function SOWProgressBlock({ summary }: { summary: SummaryRow }) {
  const asOf = useEditorialAsOf();
  const sow = summary.articles_sow ?? 0;
  const delivered = summary.articles_delivered;
  if (sow <= 0) return null;
  const pct = Math.min(100, (delivered / sow) * 100);
  return (
    <div className="rounded-md border border-[#1a1a1a] bg-[#111] p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-[9px] uppercase tracking-wider text-[#606060]">
          SOW progress · all-time
        </p>
        <p className="font-mono text-[10px] tabular-nums text-[#C4BCAA]">
          <span className="font-semibold text-white">{delivered.toLocaleString()}</span>
          <span className="text-[#606060]"> / {sow.toLocaleString()} articles</span>
          <span className="ml-1 font-bold text-white">({Math.round(pct)}%)</span>
        </p>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-sm bg-[#161616]">
        <div className="h-full bg-[#42CA80]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-[#65FFAA]">
        AS OF {asOf.label}
      </p>
    </div>
  );
}

/** Compact monthly breakdown — same shape as MonthlyBreakdownPopover in
 *  ClientDeliveryCards but fits inside the snapshot popover. Per-row month
 *  with Delivered + Cum Del, period-spanning Invoiced (Q) + Cum Inv +
 *  Variance cells, period being clicked is ringed. */
function MonthlyBreakdownTable({
  periods,
  focusQIdx,
  kind,
}: {
  periods: SummaryBillingPeriod[];
  focusQIdx: number | null;
  kind: "last" | "current";
}) {
  // Walk the periods to compute cumulative invoiced + variance per period.
  type DisplayRow = {
    year: number;
    month: number;
    delivered: number;
    cumDelivered: number;
    isFuture: boolean;
    isCurrent: boolean;
  };
  type DisplayPeriod = {
    qIdx: number;
    label: string;
    isPrelude: boolean;
    invoicedQ: number;
    cumInvoiced: number;
    variance: number | null;
    rows: DisplayRow[];
  };
  const now = new Date();
  const lastCompleted = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const nowY = lastCompleted.getFullYear();
  const nowM = lastCompleted.getMonth() + 1;
  const display: DisplayPeriod[] = [];
  let cumDelivered = 0;
  let cumInvoiced = 0;
  for (const p of periods) {
    cumInvoiced += p.invoicedQ;
    const rows: DisplayRow[] = [];
    for (const m of p.months) {
      cumDelivered += m.delivered;
      rows.push({
        year: m.year,
        month: m.month,
        delivered: m.delivered,
        cumDelivered,
        isFuture: m.is_future ?? false,
        isCurrent: m.year === nowY && m.month === nowM,
      });
    }
    const variance = p.isPrelude ? null : cumDelivered - cumInvoiced;
    display.push({
      qIdx: p.qIdx,
      label: p.label,
      isPrelude: p.isPrelude,
      invoicedQ: p.invoicedQ,
      cumInvoiced,
      variance,
      rows,
    });
  }

  if (display.length === 0) {
    return (
      <p className="font-mono text-[10px] text-[#606060]">
        No monthly data captured.
      </p>
    );
  }

  // Grand totals across the whole client history (every period rendered).
  const totalDelivered = cumDelivered;
  const totalInvoiced = cumInvoiced;
  const totalVariance = totalDelivered - totalInvoiced;
  const totalVarColor = totalVariance >= 0
    ? "#42CA80"
    : totalVariance >= -5
    ? "#F5C542"
    : "#ED6958";

  return (
    <div className="overflow-hidden rounded-md border border-[#1a1a1a]">
      <div className="border-b border-[#1a1a1a] bg-[#111] px-2.5 py-1.5">
        <p className="font-mono text-[9px] uppercase tracking-wider text-[#606060]">
          Monthly breakdown · {kind === "last" ? "last full Q highlighted" : "current Q highlighted"}
        </p>
      </div>
      <div className="max-h-[260px] overflow-y-auto">
        <table className="w-full border-collapse font-mono text-[10px]">
          <thead className="sticky top-0 bg-[#0d0d0d] shadow-[0_1px_0_0_#1a1a1a]">
            <tr className="text-[#606060]">
              <th className="px-2 py-1.5 text-left font-semibold">Month</th>
              <th className="px-2 py-1.5 text-right font-semibold">Del</th>
              <th className="px-2 py-1.5 text-right font-semibold">Cum Del</th>
              <th className="border-l border-[#1a1a1a] px-2 py-1.5 text-right font-semibold">Inv (Q)</th>
              <th className="px-2 py-1.5 text-right font-semibold">Cum Inv</th>
              <th className="px-2 py-1.5 text-right font-semibold">Variance</th>
            </tr>
          </thead>
          <tbody>
            {display.map((p) => {
              const isFocus = focusQIdx !== null && p.qIdx === focusQIdx;
              return p.rows.map((m, i) => {
                const isFirst = i === 0;
                const varColor =
                  p.variance === null
                    ? "#606060"
                    : p.variance >= 0
                    ? "#42CA80"
                    : p.variance >= -5
                    ? "#F5C542"
                    : "#ED6958";
                return (
                  <tr
                    key={`${p.qIdx}-${m.year}-${m.month}`}
                    className={
                      "border-t border-[#1a1a1a] " +
                      (m.isFuture ? "italic " : "") +
                      (isFocus ? "bg-[#42CA80]/8 " : "")
                    }
                    style={
                      isFocus && isFirst
                        ? { boxShadow: "inset 2px 0 0 #42CA80" }
                        : isFocus
                        ? { boxShadow: "inset 2px 0 0 #42CA80" }
                        : undefined
                    }
                  >
                    <td
                      className={
                        "px-2 py-1 " +
                        (m.isFuture
                          ? "text-[#8a8475]"
                          : m.isCurrent
                          ? "text-white font-semibold"
                          : "text-[#C4BCAA]")
                      }
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {MONTH_NAMES_SHORT[m.month - 1]} {String(m.year).slice(-2)}
                        {m.isCurrent && (
                          <span className="rounded-sm bg-[#42CA80]/20 px-1 py-px text-[8px] font-semibold uppercase not-italic tracking-wider text-[#42CA80]">
                            as of
                          </span>
                        )}
                        {m.isFuture && (
                          <span className="rounded-sm bg-[#3a2e1a] px-1 py-px text-[8px] font-semibold uppercase not-italic tracking-wider text-[#F5BC4E]">
                            proj
                          </span>
                        )}
                      </span>
                    </td>
                    <td
                      className={
                        "px-2 py-1 text-right tabular-nums " +
                        (m.isFuture
                          ? "text-[#8a8475]"
                          : m.isCurrent
                          ? "text-white font-semibold"
                          : "text-white")
                      }
                    >
                      {m.delivered}
                    </td>
                    <td
                      className={
                        "px-2 py-1 text-right tabular-nums " +
                        (m.isFuture
                          ? "text-[#8a8475]"
                          : m.isCurrent
                          ? "text-[#42CA80] font-bold"
                          : "text-[#C4BCAA]")
                      }
                    >
                      {m.cumDelivered}
                    </td>
                    {isFirst && (
                      <>
                        <td
                          rowSpan={p.rows.length}
                          className="border-l border-[#1a1a1a] bg-[#111] px-2 py-1 text-center align-middle tabular-nums text-white"
                        >
                          {p.isPrelude ? (
                            <span className="text-[#606060]">—</span>
                          ) : (
                            <>
                              <div className="font-semibold">{p.invoicedQ}</div>
                              <div className="mt-0.5 inline-block rounded-sm bg-[#42CA80]/15 px-1 py-px text-[8px] font-semibold uppercase not-italic tracking-wider text-[#42CA80]">
                                {p.label}
                              </div>
                            </>
                          )}
                        </td>
                        <td
                          rowSpan={p.rows.length}
                          className="bg-[#111] px-2 py-1 text-right align-middle tabular-nums text-[#C4BCAA]"
                        >
                          {p.cumInvoiced}
                        </td>
                        <td
                          rowSpan={p.rows.length}
                          className="px-2 py-1 text-right align-middle tabular-nums font-semibold"
                          style={{
                            color: varColor,
                            // Tint the variance cell with its tier color
                            // so each Q's variance is the strongest signal
                            // in the row — matches the spreadsheet's per-Q
                            // Variance row visual.
                            backgroundColor:
                              p.variance === null
                                ? "#111"
                                : `${varColor}1f`,
                          }}
                        >
                          {p.variance === null
                            ? "—"
                            : (p.variance > 0 ? "+" : "") + p.variance}
                        </td>
                      </>
                    )}
                  </tr>
                );
              });
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[#2a2a2a] bg-[#161616]">
              <td className="px-2 py-1.5 font-semibold uppercase tracking-wider text-[#606060]">
                Total
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-white">
                {totalDelivered}
              </td>
              <td className="px-2 py-1.5" />
              <td className="border-l border-[#1a1a1a] bg-[#111] px-2 py-1.5 text-center tabular-nums font-semibold text-white">
                {totalInvoiced}
              </td>
              <td className="bg-[#111] px-2 py-1.5" />
              <td
                className="px-2 py-1.5 text-right tabular-nums font-semibold"
                style={{
                  color: totalVarColor,
                  backgroundColor: `${totalVarColor}1f`,
                }}
              >
                {totalVariance > 0 ? `+${totalVariance}` : totalVariance}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** Pace classification — mirrors Pod Snapshot's helper so the popover
 *  speaks the same language as the snapshot row. Three-bucket palette
 *  (dark green / light green / yellow); see PeriodSnapshotSection for
 *  the rationale. */
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

function QSummaryTile({
  summary,
  kind,
}: {
  summary: SummaryRow | null;
  kind: "last" | "current";
}) {
  if (!summary) {
    return <p className="font-mono text-[11px] text-[#606060]">—</p>;
  }
  const isNew = isFirstContractQ(summary);
  if (kind === "current") {
    const q = computeCurrentQ(summary);
    if (!q) return <p className="font-mono text-[11px] text-[#606060]">—</p>;
    return (
      <CurrentQSummary
        label={q.label}
        monthsLabel={q.monthsLabel}
        variance={q.projectedVariance}
        actualDelivered={q.delivered}
        projectedEnd={q.projectedEnd}
        invoiced={q.invoiced}
        monthInQ={q.monthInQ}
        qLength={q.qLength}
        isNew={isNew}
      />
    );
  }
  const q = computeLastFullQ(summary);
  if (!q) {
    return (
      <p className="font-mono text-[11px] text-[#606060]">
        {isNew ? "1st contract Q — no prior close." : "—"}
      </p>
    );
  }
  return (
    <QSummaryInner
      label={q.label}
      monthsLabel={q.monthsLabel}
      variance={q.cumVariance}
      delivered={q.cumDelivered}
      invoiced={q.cumInvoiced}
      italic={false}
      isNew={false}
      verbiage="cumulative delivered / invoiced"
    />
  );
}

/** Current Q popover summary — full picture: variance + tier + NOW → END
 *  / Invoiced numbers + pace-colored progress bar + progress % + pace
 *  label. Mirrors the row-level Current Q tile (QTile) so the popover
 *  reads as a deeper expansion of the same data. */
function CurrentQSummary({
  label,
  monthsLabel,
  variance,
  actualDelivered,
  projectedEnd,
  invoiced,
  monthInQ,
  qLength,
  isNew,
}: {
  label: string;
  monthsLabel: string;
  variance: number;
  actualDelivered: number;
  projectedEnd: number;
  invoiced: number;
  monthInQ: number;
  qLength: number;
  isNew: boolean;
}) {
  const tier = tierFor(variance, isNew);
  const sign = variance > 0 ? "+" : "";
  const pace = paceClassify(actualDelivered, projectedEnd, monthInQ, qLength);
  const safeTarget = Math.max(1, invoiced);
  const actualPct = Math.max(0, Math.min(100, (actualDelivered / safeTarget) * 100));
  const projectedPct = Math.max(0, Math.min(100, (projectedEnd / safeTarget) * 100));
  const fadedWidth = Math.max(0, projectedPct - actualPct);
  const barColor = pace?.color ?? tier.color;
  const progressPct = projectedEnd > 0
    ? Math.round((actualDelivered / projectedEnd) * 100)
    : null;
  return (
    <div className="space-y-2">
      <p className="font-mono text-[10px] uppercase tracking-wider text-[#909090]">
        {label} · {monthsLabel}
      </p>
      <p className="font-mono italic">
        <span className="text-2xl font-bold tabular-nums" style={{ color: tier.color }}>
          {sign}{Math.round(variance)}
        </span>
        <span className="ml-2 text-[10px] uppercase tracking-wider" style={{ color: tier.color }}>
          {tier.label}
        </span>
      </p>
      {/* delivered · proj Q · invoiced — explicit-label format keeps
          the popover readable without forcing the reader to decode
          NOW/END/Invoiced arrows. */}
      <p className="font-mono text-[11px] tabular-nums text-[#C4BCAA]">
        <span className="text-white">{Math.round(actualDelivered)}</span>
        <span className="ml-1 text-[9px] uppercase tracking-wider text-[#606060]">
          delivered
        </span>
        <span className="text-[#606060] mx-2">·</span>
        <span className="font-semibold italic text-white">
          {Math.round(projectedEnd)}
        </span>
        <span className="ml-1 text-[9px] uppercase tracking-wider text-[#606060]">
          proj Q
        </span>
        <span className="text-[#606060] mx-2">·</span>
        <span className="text-white">{Math.round(invoiced)}</span>
        <span className="ml-1 text-[9px] uppercase tracking-wider text-[#606060]">
          invoiced
        </span>
      </p>
      {/* Pace-colored two-shade bar + progress % + pace label */}
      <div className="flex items-center gap-2">
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[#1f1f1f]">
          <div
            className="absolute top-0 bottom-0 left-0"
            style={{ width: `${actualPct}%`, backgroundColor: barColor }}
          />
          {fadedWidth > 0 && (
            <div
              className="absolute top-0 bottom-0"
              style={{
                left: `${actualPct}%`,
                width: `${fadedWidth}%`,
                backgroundColor: `${barColor}40`,
              }}
            />
          )}
        </div>
        {progressPct !== null && (
          <span
            className="w-10 shrink-0 text-right font-mono text-[10px] font-semibold tabular-nums"
            style={{ color: barColor }}
            title="Cumulative actuals now ÷ projected end of Q"
          >
            {progressPct}%
          </span>
        )}
      </div>
      {pace && (
        <p
          className="font-mono text-[9px] uppercase tracking-wider"
          style={{ color: pace.color }}
        >
          {pace.label}
        </p>
      )}
    </div>
  );
}

function QSummaryInner({
  label,
  monthsLabel,
  variance,
  delivered,
  invoiced,
  italic,
  isNew,
  verbiage,
}: {
  label: string;
  monthsLabel: string;
  variance: number;
  delivered: number;
  invoiced: number;
  italic: boolean;
  isNew: boolean;
  verbiage: string;
}) {
  const tier = tierFor(variance, isNew);
  const sign = variance > 0 ? "+" : "";
  const italicCls = italic ? "italic" : "";
  return (
    <div className="space-y-1">
      <p className="font-mono text-[10px] uppercase tracking-wider text-[#909090]">
        {label} · {monthsLabel}
      </p>
      <p className={`font-mono ${italicCls}`}>
        <span
          className="text-2xl font-bold tabular-nums"
          style={{ color: tier.color }}
        >
          {sign}{Math.round(variance)}
        </span>
        <span
          className="ml-2 text-[10px] uppercase tracking-wider"
          style={{ color: tier.color }}
        >
          {tier.label}
        </span>
      </p>
      <p className={`font-mono text-[11px] tabular-nums text-[#C4BCAA] ${italicCls}`}>
        <span className="font-semibold text-white">{Math.round(delivered)}</span>
        <span className="text-[#606060]"> / {Math.round(invoiced)}</span>
        <span className="ml-1.5 text-[9px] uppercase tracking-wider text-[#606060]">
          articles {verbiage}
        </span>
      </p>
    </div>
  );
}

function LifetimeBody({
  summary,
  clientProduction,
  clientName,
}: {
  summary: SummaryRow | null;
  clientProduction: ClientProductionRow[];
  clientName: string;
}) {
  // Anchor for "last completed" comes from the Editorial week distribution
  // (same source the Cadence card on Editorial Clients uses). When
  // editorial weeks aren't loaded yet, this falls back to the calendar
  // month minus one — same behavior as elsewhere on the app.
  const asOf = useEditorialAsOf();
  const asOfCell = useMemo(() => {
    const m = asOf.label?.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (!m) return null;
    const monthIdx = [
      "january", "february", "march", "april", "may", "june",
      "july", "august", "september", "october", "november", "december",
    ].indexOf(m[1].toLowerCase());
    if (monthIdx < 0) return null;
    return parseInt(m[2], 10) * 12 + monthIdx;
  }, [asOf.label]);

  if (!summary) {
    return <p className="font-mono text-[11px] text-[#606060]">No data.</p>;
  }
  const sow = summary.articles_sow ?? 0;
  const delivered = summary.articles_delivered;
  const pct = sow > 0 ? Math.min(100, (delivered / sow) * 100) : 0;

  // Build a unified monthly series from the Operating Model. Each row
  // carries BOTH actual and projected — same source as the Cadence view
  // on Editorial Clients. We trim LEADING months that have no real data
  // so the chart starts from the client's first meaningful month, not
  // from pre-contract zeros.
  const trend = useMemo(() => {
    const row = clientProduction.find((p) => p.client_name === clientName);
    if (!row) return [];
    const sorted = [...row.monthly]
      .map((m) => ({
        year: m.year,
        month: m.month,
        actual: m.actual ?? 0,
        projected: m.projected ?? 0,
        cell: m.year * 12 + (m.month - 1),
      }))
      .sort((a, b) => a.cell - b.cell);
    // Trim leading + trailing zero rows so the chart starts at the first
    // meaningful month and ends at the last one with data — same scope
    // the Cadence card on Editorial Clients shows.
    const firstReal = sorted.findIndex((m) => m.actual > 0 || m.projected > 0);
    let trimmed = firstReal === -1 ? sorted : sorted.slice(firstReal);
    let lastReal = -1;
    for (let i = trimmed.length - 1; i >= 0; i--) {
      if (trimmed[i].actual > 0 || trimmed[i].projected > 0) { lastReal = i; break; }
    }
    if (lastReal >= 0) trimmed = trimmed.slice(0, lastReal + 1);
    // Cap at 18 months so very long contracts don't blow up the popover
    // width — kept centered on the AS-OF anchor when possible.
    const MAX = 18;
    let list = trimmed;
    if (trimmed.length > MAX) {
      if (asOfCell !== null) {
        const idx = trimmed.findIndex((m) => m.cell === asOfCell);
        if (idx >= 0) {
          const half = Math.floor(MAX / 2);
          const start = Math.max(0, Math.min(trimmed.length - MAX, idx - half));
          list = trimmed.slice(start, start + MAX);
        } else {
          list = trimmed.slice(-MAX);
        }
      } else {
        list = trimmed.slice(-MAX);
      }
    }
    return list.map((m) => {
      // ACTUAL = at or before the AS OF month (a closed month in the
      //          Editorial calendar). PROJECTED = anything after.
      const isActual = asOfCell === null ? false : m.cell <= asOfCell;
      const isAsOf = asOfCell !== null && m.cell === asOfCell;
      return {
        year: m.year,
        month: m.month,
        actual: m.actual,
        projected: m.projected,
        isActual,
        isAsOf,
      };
    });
  }, [clientProduction, clientName, asOfCell]);

  const maxBarValue = trend.length > 0
    ? Math.max(...trend.map((m) => Math.max(m.actual, m.projected, 1)))
    : 0;

  return (
    <div className="space-y-3">
      <div>
        <p className="font-mono text-[9px] uppercase tracking-wider text-[#606060]">
          Articles delivered ÷ contracted SOW
        </p>
        <p className="mt-1 font-mono">
          <span className="text-3xl font-bold tabular-nums text-white">
            {sow > 0 ? `${Math.round(pct)}%` : "—"}
          </span>
          {sow > 0 && (
            <span className="ml-2 font-mono text-[11px] tabular-nums">
              <span className="font-semibold text-white">{delivered.toLocaleString()}</span>
              <span className="text-[#909090]"> / </span>
              <span className="text-[#C4BCAA]">{sow.toLocaleString()}</span>
              <span className="ml-1 text-[10px] text-[#606060]">articles</span>
            </span>
          )}
        </p>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-sm bg-[#161616]">
          <div
            className="h-full bg-[#42CA80]"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      {trend.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
              Monthly delivered · Operating Model
            </p>
            <div className="flex items-center gap-2 font-mono text-[9px] text-[#606060]">
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-sm bg-[#42CA80]" />
                Actual
              </span>
              <span className="flex items-center gap-1">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-sm bg-[#8FB5D9]"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(45deg, rgba(255,255,255,0.18) 0 1.5px, transparent 1.5px 3px)",
                  }}
                />
                Projected
              </span>
            </div>
          </div>
          {/* Tense chip row — two states: ACTUAL (closed months per the
              Editorial week distribution) vs PROJ (current + future). The
              last completed month gets an "AS OF" highlight so the user
              can locate today's anchor at a glance — same as the Cadence
              card on Editorial Clients.
              `whitespace-nowrap` + `overflow-hidden` keeps every chip on
              one line so the AS OF label can't wrap to two lines and
              misalign the row when many months are showing. */}
          <div className="mt-2 flex items-stretch gap-1">
            {trend.map((m) => {
              const tag = m.isAsOf ? "AS OF" : (m.isActual ? "ACTUAL" : "PROJ");
              const tagColor = m.isAsOf
                ? "#65FFAA"
                : m.isActual
                ? "#42CA80"
                : "#8FB5D9";
              const ring = m.isAsOf ? "ring-1 ring-[#65FFAA]/60" : "";
              return (
                <span
                  key={`tag-${m.year}-${m.month}`}
                  className={
                    "flex-1 min-w-0 text-center font-mono text-[8px] uppercase tracking-tight rounded-sm py-px whitespace-nowrap overflow-hidden " +
                    ring
                  }
                  style={{
                    color: tagColor,
                    backgroundColor: `${tagColor}${m.isAsOf ? "22" : "1a"}`,
                  }}
                >
                  {tag}
                </span>
              );
            })}
          </div>
          {/* Bars: actual = solid green, projected = striped blue. The
              as-of month gets a brighter green outline so it pops as the
              latest closed month. */}
          <div className="mt-1 flex items-end gap-1" style={{ height: 80 }}>
            {trend.map((m) => {
              // Closed months → actual. Open / projected months → projected.
              const v = m.isActual ? m.actual : m.projected;
              const barPx = maxBarValue > 0
                ? Math.max(4, Math.round((v / maxBarValue) * 64))
                : 4;
              const color = m.isActual ? "#42CA80" : "#8FB5D9";
              return (
                <div
                  key={`${m.year}-${m.month}`}
                  className="flex-1 flex flex-col items-center justify-end gap-0.5 min-w-0"
                >
                  <span
                    className="font-mono text-[9px] tabular-nums leading-none"
                    style={{ color }}
                    title={
                      m.isActual
                        ? "Actual delivered (Operating Model)"
                        : "Projected from Operating Model"
                    }
                  >
                    {v}
                  </span>
                  <div
                    className="w-full rounded-sm transition-colors"
                    style={{
                      height: barPx,
                      backgroundColor: m.isActual ? `${color}66` : `${color}40`,
                      backgroundImage: m.isActual
                        ? undefined
                        : "repeating-linear-gradient(45deg, rgba(255,255,255,0.12) 0 3px, transparent 3px 6px)",
                      outline: m.isAsOf ? "1px solid #65FFAA" : undefined,
                      outlineOffset: m.isAsOf ? "1px" : undefined,
                    }}
                    title={`${MONTH_NAMES_SHORT[m.month - 1]} ${m.year}: actual ${m.actual}, projected ${m.projected}`}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex gap-1">
            {trend.map((m) => (
              <span
                key={`lbl-${m.year}-${m.month}`}
                className={
                  "flex-1 text-center font-mono text-[8px] truncate " +
                  (m.isAsOf
                    ? "text-[#65FFAA] font-bold"
                    : m.isActual
                    ? "text-[#606060]"
                    : "text-[#8FB5D9]/70")
                }
              >
                {MONTH_NAMES_SHORT[m.month - 1]}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Atoms
// ─────────────────────────────────────────────────────────────────────────────

function ContractMetaBlock({ client }: { client: Client }) {
  // Compose a contract summary line: dates + term + SOW + content type.
  const fmt = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric",
    });
  };
  const start = fmt(client.start_date);
  const end = fmt(client.end_date);
  const term = client.term_months ?? null;
  const sow = client.articles_sow ?? null;
  const contentType = (client as unknown as Record<string, string | null>)["content_type"];
  return (
    <div className="rounded-md border border-[#1a1a1a] bg-[#111] p-2.5">
      <p className="font-mono text-[9px] uppercase tracking-wider text-[#606060]">
        Contract
      </p>
      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] tabular-nums">
        <Meta label="Start" value={start ?? "—"} />
        <Meta label="End" value={end ?? "—"} />
        <Meta
          label="Term"
          value={term !== null ? `${term} month${term === 1 ? "" : "s"}` : "—"}
        />
        <Meta
          label="SOW"
          value={sow !== null ? `${sow.toLocaleString()} articles` : "—"}
        />
        {contentType && (
          <Meta
            label="Type"
            value={contentType}
            wide
          />
        )}
      </div>
    </div>
  );
}

function Meta({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <span className="text-[#606060]">{label}: </span>
      <span className="text-[#C4BCAA]">{value}</span>
    </div>
  );
}

function StatBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-[#1a1a1a] bg-[#111] p-2.5">
      <p className="font-mono text-[9px] uppercase tracking-wider text-[#606060]">
        {title}
      </p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function StatRow({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 font-mono text-[11px] tabular-nums">
      <span className="text-[#909090]">{left}</span>
      <span className="text-[#C4BCAA]">{right}</span>
    </div>
  );
}

function CellRow({
  monthLabel,
  cb,
  cbPct,
  ad,
  adPct,
}: {
  monthLabel: string;
  cb: string;
  cbPct: number | null;
  ad: string;
  adPct: number | null;
}) {
  const cbColor = pctColor(cbPct);
  const adColor = pctColor(adPct);
  return (
    <>
      <span className="text-[#909090]">{monthLabel}</span>
      <span style={{ color: cbColor }}>{cb}</span>
      <span style={{ color: adColor }}>{ad}</span>
    </>
  );
}

function pctColor(pct: number | null): string {
  if (pct === null) return "#606060";
  if (pct >= 90) return "#42CA80";
  if (pct >= 70) return "#F5C542";
  return "#ED6958";
}

function useGoalsForPeriod(
  goals: GoalsVsDeliveryRow[],
  clientName: string,
  periodMonths: { year: number; month: number }[],
): { cbGoal: number; cbDel: number; adGoal: number; adDel: number } {
  return useMemo(() => {
    // Apply the SAME month filter the snapshot column uses, otherwise the
    // tooltip would silently sum months outside the selected period —
    // making the popover totals diverge from the row totals.
    const periodCells = new Set(
      periodMonths.map((m) => m.year * 12 + (m.month - 1)),
    );
    let cbGoal = 0, cbDel = 0, adGoal = 0, adDel = 0;
    const perCMC = new Map<string, {
      cbGoal: number; cbDel: number; adGoal: number; adDel: number; ratio: number;
    }>();
    for (const r of goals) {
      if (r.client_name !== clientName) continue;
      const ym = parseMonthYear(r.month_year);
      if (!ym) continue;
      if (!periodCells.has(ym.year * 12 + (ym.month - 1))) continue;
      const ct = (r.content_type ?? "").trim().toLowerCase() || "default";
      const key = `${r.month_year}|${ct}`;
      let cur = perCMC.get(key);
      if (!cur) {
        cur = {
          cbGoal: 0, cbDel: 0, adGoal: 0, adDel: 0,
          ratio: contentTypeRatio(r.content_type, r.ratios),
        };
        perCMC.set(key, cur);
      }
      cur.cbGoal = Math.max(cur.cbGoal, r.cb_monthly_goal ?? 0);
      cur.adGoal = Math.max(cur.adGoal, r.ad_monthly_goal ?? 0);
      cur.cbDel = Math.max(cur.cbDel, r.cb_delivered_to_date ?? 0);
      cur.adDel = Math.max(cur.adDel, r.ad_delivered_to_date ?? 0);
    }
    for (const cur of perCMC.values()) {
      cbGoal += cur.cbGoal * cur.ratio;
      cbDel += cur.cbDel * cur.ratio;
      adGoal += cur.adGoal * cur.ratio;
      adDel += cur.adDel * cur.ratio;
    }
    return { cbGoal, cbDel, adGoal, adDel };
  }, [goals, clientName, periodMonths]);
}
