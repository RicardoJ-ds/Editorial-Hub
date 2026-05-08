"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpRight } from "lucide-react";
import { apiGet } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeToMetrics } from "@/components/dashboard/TimeToMetrics";
import {
  DeliveryMixCard,
  DeliveryOverviewCards,
  MostBehindCard,
  PodAttentionCard,
} from "@/components/dashboard/DeliveryOverviewCards";
import { CumulativePipelineSection } from "@/components/dashboard/CumulativePipelineSection";
import { ClientDeliveryCards } from "@/components/dashboard/ClientDeliveryCards";
import { GoalsOverviewCards } from "@/components/dashboard/GoalsOverviewCards";
import { ProductionTrendChart } from "@/components/charts/ProductionTrendChart";
import { FilterBar, type DateRange } from "@/components/dashboard/FilterBar";
import { SectionIndex } from "@/components/dashboard/SectionIndex";
import { OverviewCommentsRail } from "@/components/dashboard/OverviewCommentsRail";
import { SyncControls } from "@/components/layout/SyncControls";
import { useEditorialAsOf } from "@/lib/editorialWeeksClient";
import { useRequireView } from "@/lib/accessClient";
import { useCurrentPodAxis } from "@/lib/podAxisClient";
import {
  AsOfBadge,
  contentTypeRatio,
  displayPod,
} from "@/components/dashboard/shared-helpers";
import { normalizePod, sortPodKey } from "@/components/dashboard/ContractClientProgress";
import { buildLifetimeSummaries } from "@/lib/overviewSummary";
import type {
  Client,
  ClientProductionRow,
  CumulativeMetric,
  DeliverableMonthly,
  GoalsVsDeliveryRow,
  ProductionTrendPoint,
} from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Overview dashboard — exec snapshot
//
// Mirrors D1's top-row cards. Filters fan out to every section. The Delivery
// Overview section has three lenses the user can toggle through:
//   • Composition (default) — descriptive: what does the work look like?
//   • Trajectory            — direction-of-travel: where are we trending?
//   • Triage                — alarm-style: who's behind?
// All three lenses read from the same fetched data; switching is free.
// ─────────────────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "time-to-metrics", label: "Time-to Metrics" },
  { id: "delivery-overview", label: "Delivery Overview" },
  { id: "production-history", label: "Production History" },
  { id: "cumulative-pipeline", label: "Cumulative Pipeline" },
  { id: "client-delivery", label: "Client Delivery" },
  { id: "monthly-goals", label: "Monthly Goals" },
];

type Lens = "composition" | "trajectory" | "triage";

export default function OverviewPage() {
  // Pod-locked teams (Editorial Team / Growth Team) have no Overview by
  // spec. The hook bounces them to /editorial-clients.
  useRequireView("overview");
  const overviewAsOf = useEditorialAsOf();
  const [clients, setClients] = useState<Client[]>([]);
  const [filteredClients, setFilteredClients] = useState<Client[]>([]);
  const [deliverables, setDeliverables] = useState<DeliverableMonthly[]>([]);
  const [cumulative, setCumulative] = useState<CumulativeMetric[]>([]);
  const [goalRows, setGoalRows] = useState<GoalsVsDeliveryRow[]>([]);
  const [productionTrend, setProductionTrend] = useState<ProductionTrendPoint[]>([]);
  const [clientProduction, setClientProduction] = useState<ClientProductionRow[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>({ type: "all" });
  const [lens, setLens] = useState<Lens>("composition");
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [cs, ds] = await Promise.all([
        apiGet<Client[]>("/api/clients/?limit=200"),
        apiGet<DeliverableMonthly[]>("/api/deliverables/?limit=1000"),
      ]);
      setClients(cs);
      setFilteredClients(cs);
      setDeliverables(ds);
    } catch (e) {
      console.error("Overview load failed:", e);
    } finally {
      setLoading(false);
    }
    apiGet<CumulativeMetric[]>("/api/goals-delivery/cumulative")
      .then(setCumulative)
      .catch(() => {});
    apiGet<GoalsVsDeliveryRow[]>("/api/goals-delivery/all")
      .then(setGoalRows)
      .catch(() => {});
    apiGet<ProductionTrendPoint[]>("/api/dashboard/production-trend")
      .then(setProductionTrend)
      .catch(() => {});
    apiGet<ClientProductionRow[]>("/api/dashboard/client-production")
      .then(setClientProduction)
      .catch(() => {});
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const handler = () => { fetchData(); };
    window.addEventListener("data-synced", handler);
    return () => window.removeEventListener("data-synced", handler);
  }, [fetchData]);

  const handleFilterChange = useCallback((filtered: Client[]) => {
    setFilteredClients(filtered);
  }, []);
  const handleDateRangeChange = useCallback((range: DateRange) => {
    setDateRange(range);
  }, []);

  const summaries = useMemo(
    () => buildLifetimeSummaries(filteredClients, deliverables),
    [filteredClients, deliverables],
  );

  const goalsSummary = useMemo(
    () => rollupGoalsForPortfolio(goalRows, filteredClients, dateRange),
    [goalRows, filteredClients, dateRange],
  );

  // Lifetime delivery rows for the Client Delivery section. The Overview
  // skips D1's date-aware "scope" math — it shows the full relationship,
  // collapsed by pod. Missing fields (variance_cumulative, end_date) are
  // optional and the cards render fallbacks when they're absent.
  const clientDeliveryRows = useMemo(() => {
    const byId = new Map(filteredClients.map((c) => [c.id, c]));
    return summaries.map((s) => {
      const client = byId.get(s.id);
      return {
        id: s.id,
        name: s.name,
        status: client?.status ?? "ACTIVE",
        editorial_pod: s.editorial_pod,
        growth_pod: client?.growth_pod ?? null,
        articles_sow: s.articles_sow,
        articles_delivered: s.articles_delivered,
        articles_invoiced: s.articles_invoiced,
        variance: s.articles_delivered - s.articles_invoiced,
        variance_cumulative: s.variance_cumulative,
        pct_complete: s.pct_complete,
        start_date: s.start_date ?? client?.start_date,
        end_date: client?.end_date,
        term_months: s.term_months ?? client?.term_months,
        monthly_breakdown: s.monthly_breakdown?.map((m) => ({
          year: m.year,
          month: m.month,
          delivered: m.delivered,
          invoiced: m.invoiced,
          variance: m.delivered - m.invoiced,
          is_future: m.is_future,
        })),
      };
    });
  }, [summaries, filteredClients]);

  if (loading && clients.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[#606060]">Loading overview…</p>
        <OverviewSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 bg-black pb-3 -mx-8 px-8 pt-3 min-h-[120px]">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-3">
          <h1 className="font-mono text-sm font-bold uppercase tracking-[0.18em] text-white whitespace-nowrap shrink-0 inline-flex items-center gap-2">
            Overview
            <AsOfBadge label={overviewAsOf.label} fallback={overviewAsOf.isFallback} />
          </h1>
          <FilterBar
            clients={clients}
            onFilterChange={handleFilterChange}
            onDateRangeChange={handleDateRangeChange}
          />
          <div className="ml-auto">
            <SyncControls />
          </div>
        </div>
      </div>

      <div className="flex gap-6">
        <SectionIndex sections={SECTIONS} />
        <div className="flex-1 min-w-0 space-y-12">
          <Section
            id="time-to-metrics"
            title="Time-to Metrics"
            subtitle="Average milestone handoffs across the filtered clients"
            deepLinkHref="/editorial-clients?tab=contract-timeline#time-to-metrics"
          >
            <TimeToMetrics clients={filteredClients} hideHeader />
          </Section>

          <Section
            id="delivery-overview"
            title="Delivery Overview"
            subtitle={
              lens === "composition"
                ? "What does our work look like?"
                : lens === "trajectory"
                ? "Where are we trending?"
                : "Who needs attention right now?"
            }
            deepLinkHref="/editorial-clients?tab=deliverables-sow#delivery-overview"
            rightSlot={<LensSwitcher value={lens} onChange={setLens} />}
          >
            {lens === "composition" && (
              <CompositionView
                clients={filteredClients}
                summaries={summaries}
                cumulative={cumulative}
                deliverables={deliverables}
              />
            )}
            {lens === "trajectory" && (
              <TrajectoryView
                clients={filteredClients}
                productionTrend={productionTrend}
                clientProduction={clientProduction}
                deliverables={deliverables}
              />
            )}
            {lens === "triage" && (
              <TriageView clients={filteredClients} summaries={summaries} />
            )}
          </Section>

          <Section
            id="production-history"
            title="Production History"
            subtitle="Monthly actuals + projection trajectory across the filtered clients"
            deepLinkHref="/editorial-clients?tab=contract-timeline#production-history"
          >
            <ProductionTrendChart
              data={productionTrend}
              clientProduction={clientProduction}
              filteredClients={filteredClients}
            />
          </Section>

          <Section
            id="cumulative-pipeline"
            title="Cumulative Pipeline"
            subtitle="All-time funnel coverage — Articles + Published per client"
            deepLinkHref="/editorial-clients?tab=deliverables-sow#cumulative-pipeline"
          >
            {/* Slim per-client cards: Articles + Published only. The Overview
                lens skips Topics + CBs since they're upstream of billing —
                executives reviewing here mostly care about shipped vs billed. */}
            <CumulativePipelineSection
              filteredClients={filteredClients}
              cardStages={["articles", "published"]}
            />
          </Section>

          <Section
            id="client-delivery"
            title="Client Delivery"
            subtitle="Per-client delivery vs invoicing — collapsed by pod to keep the page scannable"
            deepLinkHref="/editorial-clients?tab=deliverables-sow#client-delivery"
          >
            <ClientDeliveryCards
              rows={clientDeliveryRows}
              defaultCollapsedByPod
            />
          </Section>

          <Section
            id="monthly-goals"
            title="Monthly Goals"
            subtitle="CB / Article achievement across the filtered scope"
            deepLinkHref="/editorial-clients?tab=deliverables-sow#monthly-goals"
          >
            <GoalsOverviewCards
              filteredClients={filteredClients}
              perClient={goalsSummary.perClient}
              totals={goalsSummary.totals}
              asOfLabel={goalsSummary.asOfLabel}
            />
          </Section>
        </div>
        <OverviewCommentsRail
          sections={SECTIONS}
          filteredClients={filteredClients}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page chrome
// ─────────────────────────────────────────────────────────────────────────────

function Section({
  id,
  title,
  subtitle,
  deepLinkHref,
  children,
  rightSlot,
}: {
  id: string;
  title: string;
  subtitle: string;
  deepLinkHref: string;
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-[140px] space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
            {title}
          </h2>
          <p className="mt-0.5 text-[11px] text-[#606060]">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {rightSlot}
          <DeepLink href={deepLinkHref} />
        </div>
      </div>
      {children}
    </section>
  );
}

// Filter params we propagate from /overview into D1 so a VP scanning the
// Overview with filters applied keeps the same narrowing after clicking
// "Open in Editorial Clients". Mirror of D1_PROPAGATED_FILTER_KEYS in
// DeliveryOverviewCards — keep both lists in sync.
const PROPAGATED_FILTER_KEYS = [
  "search",
  "editorial_pod",
  "growth_pod",
  "status",
] as const;

function DeepLink({ href }: { href: string }) {
  const searchParams = useSearchParams();
  const finalHref = useMemo(() => {
    // Split incoming href into path?query#hash so we can merge our filter
    // params alongside whatever the Section already sets (e.g. tab=...).
    const hashIdx = href.indexOf("#");
    const hash = hashIdx >= 0 ? href.slice(hashIdx) : "";
    const noHash = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
    const qIdx = noHash.indexOf("?");
    const path = qIdx >= 0 ? noHash.slice(0, qIdx) : noHash;
    const incomingQuery = qIdx >= 0 ? noHash.slice(qIdx + 1) : "";
    const merged = new URLSearchParams(incomingQuery);
    for (const key of PROPAGATED_FILTER_KEYS) {
      const v = searchParams.get(key);
      if (v && !merged.has(key)) merged.set(key, v);
    }
    const q = merged.toString();
    return `${path}${q ? `?${q}` : ""}${hash}`;
  }, [href, searchParams]);

  return (
    <Link
      href={finalHref}
      className="group inline-flex items-center gap-1.5 rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA] transition-colors hover:border-[#42CA80]/40 hover:bg-[#42CA80]/10 hover:text-[#42CA80]"
    >
      Open in Editorial Clients
      <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </Link>
  );
}

// Pill-tab segmented control used to flip between Composition / Trajectory /
// Triage lenses. Kept inline because it's only used by Delivery Overview.
function LensSwitcher({
  value,
  onChange,
}: {
  value: Lens;
  onChange: (v: Lens) => void;
}) {
  const opts: { id: Lens; label: string }[] = [
    { id: "composition", label: "Composition" },
    { id: "trajectory", label: "Trajectory" },
    { id: "triage", label: "Triage" },
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

function OverviewSkeleton() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-[80px]" />
      <Skeleton className="h-[200px]" />
      <Skeleton className="h-[180px]" />
      <Skeleton className="h-[80px]" />
      <Skeleton className="h-[180px]" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Triage lens — the original five cards (Most Behind / Pod Attention on top,
// Delivery Mix / Closing 90D / Last Q Closes below).
// ─────────────────────────────────────────────────────────────────────────────

import type { SummaryRow } from "@/components/dashboard/DeliveryOverviewCards";

function TriageView({
  clients,
  summaries,
}: {
  clients: Client[];
  summaries: SummaryRow[];
}) {
  // Triage pyramid: portfolio % (Delivery Progress) → worst clients
  // (Most Behind) → worst pod (Pod Attention) on the top row, then the
  // forward-looking Closing 90d + Last Q Closes context cards below.
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <DeliveryMixCard
          rows={summaries}
          subtitle={`${summaries.length} client${summaries.length === 1 ? "" : "s"}`}
        />
        <MostBehindCard rows={summaries} clients={clients} />
        <PodAttentionCard rows={summaries} clients={clients} />
      </div>
      <DeliveryOverviewCards
        allClients={clients}
        filteredClients={clients}
        rows={summaries}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Composition lens — descriptive cards: portfolio summary, content-type
// distribution, top contributors by volume, pod output ranking.
// ─────────────────────────────────────────────────────────────────────────────

function CompositionView({
  clients,
  summaries,
  cumulative,
  deliverables,
}: {
  clients: Client[];
  summaries: SummaryRow[];
  cumulative: CumulativeMetric[];
  deliverables: DeliverableMonthly[];
}) {
  const { axis } = useCurrentPodAxis();
  const stats = useMemo(() => {
    const podSet = new Set(
      clients.map((c) => {
        const raw = axis === "growth" ? c.growth_pod : c.editorial_pod;
        return raw ? normalizePod(raw) : "Unassigned";
      }),
    );
    const totalDelivered = summaries.reduce((a, r) => a + r.articles_delivered, 0);
    const totalSow = summaries.reduce((a, r) => a + r.articles_sow, 0);

    // Trailing 3-month delivery vs prior 3-month delivery, summed across
    // filtered clients. Powers the trend arrow next to the volume number.
    const ids = new Set(clients.map((c) => c.id));
    const now = new Date();
    const lastCompleted = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthOffset = (back: number) => {
      const d = new Date(lastCompleted);
      d.setMonth(d.getMonth() - back);
      return { y: d.getFullYear(), m: d.getMonth() + 1 };
    };
    const inWindow = (y: number, m: number, fromBack: number, toBack: number) => {
      const cell = y * 12 + (m - 1);
      const fromCell = monthOffset(fromBack);
      const toCell = monthOffset(toBack);
      const fromN = fromCell.y * 12 + (fromCell.m - 1);
      const toN = toCell.y * 12 + (toCell.m - 1);
      return cell >= toN && cell <= fromN;
    };
    let recent3 = 0;
    let prior3 = 0;
    for (const d of deliverables) {
      if (!ids.has(d.client_id)) continue;
      const v = d.articles_delivered ?? 0;
      if (inWindow(d.year, d.month, 2, 0)) recent3 += v;
      else if (inWindow(d.year, d.month, 5, 3)) prior3 += v;
    }
    const trendPct =
      prior3 > 0 ? Math.round(((recent3 - prior3) / prior3) * 100) : null;

    return {
      activeClients: clients.length,
      pods: podSet.size,
      totalDelivered,
      totalSow,
      sowPct: totalSow > 0 ? Math.round((totalDelivered / totalSow) * 100) : null,
      recent3,
      prior3,
      trendPct,
    };
  }, [clients, summaries, deliverables, axis]);

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <PeriodAtAGlance stats={stats} />
      <ContentTypeMix cumulative={cumulative} clients={clients} />
      <TopContributors summaries={summaries} />
      <PodOutput summaries={summaries} clients={clients} />
    </div>
  );
}

interface CompositionStats {
  activeClients: number;
  pods: number;
  totalDelivered: number;
  totalSow: number;
  sowPct: number | null;
  recent3: number;
  prior3: number;
  trendPct: number | null;
}

function PeriodAtAGlance({ stats }: { stats: CompositionStats }) {
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA]">
        Snapshot
      </p>
      <p className="mt-0.5 text-[11px] text-[#606060]">
        Filtered scope · all-time
      </p>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat label="Active clients" value={stats.activeClients.toString()} />
        <Stat label="Editorial pods" value={stats.pods.toString()} />
        <Stat
          label="Lifetime SOW"
          value={stats.totalSow > 0 ? stats.totalSow.toLocaleString() : "—"}
        />
      </div>
      <div className="mt-4 border-t border-[#2a2a2a] pt-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
          Articles delivered (last 3 months)
        </p>
        <div className="mt-1 flex items-baseline gap-2">
          <p className="font-mono text-3xl font-bold tabular-nums text-white">
            {stats.recent3.toLocaleString()}
          </p>
          {stats.trendPct !== null && (
            <span
              className="inline-flex items-center gap-0.5 font-mono text-[11px] font-semibold tabular-nums"
              style={{ color: stats.trendPct >= 0 ? "#42CA80" : "#ED6958" }}
            >
              {stats.trendPct >= 0 ? (
                <ArrowUp className="h-3 w-3" />
              ) : (
                <ArrowDown className="h-3 w-3" />
              )}
              {Math.abs(stats.trendPct)}%
            </span>
          )}
          <span className="font-mono text-[10px] text-[#606060]">
            {stats.trendPct !== null ? "vs prior 3 months" : "no prior data"}
          </span>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[9px] uppercase tracking-wider text-[#606060]">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-white">
        {value}
      </p>
    </div>
  );
}

function ContentTypeMix({
  cumulative,
  clients,
}: {
  cumulative: CumulativeMetric[];
  clients: Client[];
}) {
  const data = useMemo(() => {
    const names = new Set(clients.map((c) => c.name));
    const buckets = new Map<string, number>();
    for (const r of cumulative) {
      if (!names.has(r.client_name)) continue;
      const ct = (r.content_type ?? "").trim().toLowerCase() || "other";
      const v = r.articles_sent ?? 0;
      buckets.set(ct, (buckets.get(ct) ?? 0) + v);
    }
    const total = Array.from(buckets.values()).reduce((a, b) => a + b, 0);
    const entries = Array.from(buckets.entries())
      .map(([ct, v]) => ({
        label: prettyContentType(ct),
        value: v,
        pct: total > 0 ? (v / total) * 100 : 0,
        color: contentTypeColor(ct),
      }))
      .filter((e) => e.value > 0)
      .sort((a, b) => b.value - a.value);
    return { entries, total };
  }, [cumulative, clients]);

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA]">
        Content type mix
      </p>
      <p className="mt-0.5 text-[11px] text-[#606060]">
        Articles sent, all-time, by content type
      </p>
      <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-white">
        {data.total.toLocaleString()}{" "}
        <span className="font-normal text-[11px] text-[#606060]">total</span>
      </p>
      {data.entries.length === 0 ? (
        <p className="mt-3 text-[11px] text-[#606060]">No data in scope.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {data.entries.map((e) => (
            <li key={e.label}>
              <div className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
                <span className="text-[#C4BCAA]">{e.label}</span>
                <span className="text-[#606060] tabular-nums">
                  <span className="text-white font-semibold">
                    {e.value.toLocaleString()}
                  </span>{" "}
                  · {Math.round(e.pct)}%
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-[#1f1f1f] overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(e.pct, 100)}%`,
                    backgroundColor: e.color,
                    opacity: 0.85,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function prettyContentType(raw: string): string {
  if (!raw) return "Other";
  const t = raw.toLowerCase();
  if (t === "article" || t === "articles") return "Article";
  if (t === "jumbo") return "Jumbo";
  if (t === "lp" || t === "landing page" || t === "landing pages") return "Landing page";
  if (t === "glossary") return "Glossary";
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

function contentTypeColor(raw: string): string {
  // Map well-known content types to Graphite DS swatches; fallback to a
  // neutral cream for anything unrecognised.
  const t = raw.toLowerCase();
  if (t === "article" || t === "articles") return "#65FFAA"; // P1
  if (t === "jumbo") return "#42CA80"; // P2
  if (t === "lp" || t === "landing page" || t === "landing pages") return "#8FB5D9"; // S2
  if (t === "glossary") return "#CEBCF4"; // S1
  return "#DDCFAC"; // WN1
}

function TopContributors({ summaries }: { summaries: SummaryRow[] }) {
  const top = useMemo(
    () =>
      [...summaries]
        .filter((r) => r.articles_delivered > 0)
        .sort((a, b) => b.articles_delivered - a.articles_delivered)
        .slice(0, 5),
    [summaries],
  );
  const max = top[0]?.articles_delivered ?? 0;

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA]">
        Top contributors
      </p>
      <p className="mt-0.5 text-[11px] text-[#606060]">
        Highest delivered article volume in scope
      </p>
      {top.length === 0 ? (
        <p className="mt-3 text-[11px] text-[#606060]">No data in scope.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {top.map((r, i) => {
            const pct = max > 0 ? (r.articles_delivered / max) * 100 : 0;
            return (
              <li key={r.id}>
                <div className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-[#606060] tabular-nums">
                      {i + 1}.
                    </span>
                    <span className="truncate text-white" title={r.name}>
                      {r.name}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-white">
                    {r.articles_delivered.toLocaleString()}
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-[#1f1f1f] overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: "#42CA80",
                      opacity: 0.85,
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PodOutput({
  summaries,
  clients,
}: {
  summaries: SummaryRow[];
  clients: Client[];
}) {
  const { axis } = useCurrentPodAxis();
  const data = useMemo(() => {
    const podByClient = new Map<number, string>();
    for (const c of clients) {
      const raw = axis === "growth" ? c.growth_pod : c.editorial_pod;
      podByClient.set(c.id, raw ? normalizePod(raw) : "Unassigned");
    }
    const totals = new Map<string, { delivered: number; clients: number }>();
    for (const r of summaries) {
      const pod = podByClient.get(r.id) ?? "Unassigned";
      const t = totals.get(pod) ?? { delivered: 0, clients: 0 };
      t.delivered += r.articles_delivered;
      t.clients += 1;
      totals.set(pod, t);
    }
    return Array.from(totals.entries())
      .map(([pod, t]) => ({ pod, ...t }))
      .sort((a, b) => sortPodKey(a.pod, b.pod));
  }, [summaries, clients, axis]);

  const max = Math.max(0, ...data.map((d) => d.delivered));

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA]">
        Pod output
      </p>
      <p className="mt-0.5 text-[11px] text-[#606060]">
        Articles delivered by editorial pod
      </p>
      {data.length === 0 ? (
        <p className="mt-3 text-[11px] text-[#606060]">No data in scope.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {data.map((d) => {
            const pct = max > 0 ? (d.delivered / max) * 100 : 0;
            const fill = podSwatch(d.pod);
            return (
              <li key={d.pod}>
                <div className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: fill }}
                    />
                    <span className="text-[#C4BCAA]">{displayPod(d.pod)}</span>
                    <span className="text-[#606060]">· {d.clients} client{d.clients === 1 ? "" : "s"}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-white">
                    {d.delivered.toLocaleString()}
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-[#1f1f1f] overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: fill,
                      opacity: 0.85,
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function podSwatch(pod: string): string {
  const map: Record<string, string> = {
    "Pod 1": "#5B9BF5",
    "Pod 2": "#42CA80",
    "Pod 3": "#F5C542",
    "Pod 4": "#F28D59",
    "Pod 5": "#ED6958",
    Unassigned: "#606060",
  };
  return map[pod] ?? "#909090";
}

// ─────────────────────────────────────────────────────────────────────────────
// Trajectory lens — direction-of-travel: production trend chart, pod
// velocity board, forward view (projected next quarter, contracts closing).
// ─────────────────────────────────────────────────────────────────────────────

function TrajectoryView({
  clients,
  productionTrend,
  clientProduction,
  deliverables,
}: {
  clients: Client[];
  productionTrend: ProductionTrendPoint[];
  clientProduction: ClientProductionRow[];
  deliverables: DeliverableMonthly[];
}) {
  return (
    <div className="space-y-3">
      <ProductionTrendChart
        data={productionTrend}
        clientProduction={clientProduction}
        filteredClients={clients}
      />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <PodVelocity clients={clients} clientProduction={clientProduction} />
        <ForwardView clients={clients} deliverables={deliverables} />
      </div>
    </div>
  );
}

function PodVelocity({
  clients,
  clientProduction,
}: {
  clients: Client[];
  clientProduction: ClientProductionRow[];
}) {
  const { axis } = useCurrentPodAxis();
  const data = useMemo(() => {
    const podByName = new Map<string, string>();
    for (const c of clients) {
      const raw = axis === "growth" ? c.growth_pod : c.editorial_pod;
      podByName.set(c.name, raw ? normalizePod(raw) : "Unassigned");
    }

    const now = new Date();
    const lastCompleted = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const cellOf = (y: number, m: number) => y * 12 + (m - 1);
    const lastCell = cellOf(lastCompleted.getFullYear(), lastCompleted.getMonth() + 1);

    type PodAgg = { recent: number; prior: number };
    const agg = new Map<string, PodAgg>();
    for (const r of clientProduction) {
      const pod = podByName.get(r.client_name);
      if (!pod) continue;
      for (const m of r.monthly) {
        const cell = cellOf(m.year, m.month);
        const distance = lastCell - cell;
        if (distance < 0 || distance > 7) continue;
        const v = m.actual ?? 0;
        const slot = agg.get(pod) ?? { recent: 0, prior: 0 };
        if (distance < 4) slot.recent += v;
        else slot.prior += v;
        agg.set(pod, slot);
      }
    }

    return Array.from(agg.entries())
      .map(([pod, a]) => {
        const recentPerWeek = a.recent / 4 / 4.33; // 4 months → ~17.3 weeks
        const priorPerWeek = a.prior / 4 / 4.33;
        const delta =
          priorPerWeek > 0 ? ((recentPerWeek - priorPerWeek) / priorPerWeek) * 100 : null;
        return {
          pod,
          perWeek: recentPerWeek,
          deltaPct: delta,
        };
      })
      .sort((a, b) => sortPodKey(a.pod, b.pod));
  }, [clients, clientProduction, axis]);

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA]">
        Pod velocity
      </p>
      <p className="mt-0.5 text-[11px] text-[#606060]">
        Articles per week, last 4 months · ▲▼ vs prior 4 months
      </p>
      {data.length === 0 ? (
        <p className="mt-3 text-[11px] text-[#606060]">No pace data in scope.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {data.map((d) => (
            <li
              key={d.pod}
              className="flex items-center justify-between gap-2 font-mono text-[11px]"
            >
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: podSwatch(d.pod) }}
                />
                <span className="text-[#C4BCAA]">{displayPod(d.pod)}</span>
              </span>
              <span className="inline-flex items-center gap-2 tabular-nums">
                <span className="text-white font-semibold">
                  {d.perWeek.toFixed(1)}
                </span>
                <span className="text-[#606060]">/wk</span>
                {d.deltaPct !== null ? (
                  <span
                    className="inline-flex items-center gap-0.5 text-[10px] font-semibold"
                    style={{
                      color:
                        Math.abs(d.deltaPct) < 5
                          ? "#909090"
                          : d.deltaPct >= 0
                          ? "#42CA80"
                          : "#ED6958",
                    }}
                  >
                    {Math.abs(d.deltaPct) < 5 ? (
                      <ArrowRight className="h-3 w-3" />
                    ) : d.deltaPct >= 0 ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    )}
                    {Math.abs(Math.round(d.deltaPct))}%
                  </span>
                ) : (
                  <span className="text-[10px] text-[#606060]">—</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ForwardView({
  clients,
  deliverables,
}: {
  clients: Client[];
  deliverables: DeliverableMonthly[];
}) {
  const data = useMemo(() => {
    const ids = new Set(clients.map((c) => c.id));
    const now = new Date();
    const lastCompleted = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const cellOf = (y: number, m: number) => y * 12 + (m - 1);
    const lastCell = cellOf(lastCompleted.getFullYear(), lastCompleted.getMonth() + 1);

    let trailing = 0;
    for (const d of deliverables) {
      if (!ids.has(d.client_id)) continue;
      const distance = lastCell - cellOf(d.year, d.month);
      if (distance >= 0 && distance < 3) trailing += d.articles_delivered ?? 0;
    }
    const monthlyRate = trailing / 3;
    const projectedNextQ = Math.round(monthlyRate * 3);

    const ninetyOut = new Date();
    ninetyOut.setDate(ninetyOut.getDate() + 90);
    let closingSoon = 0;
    let inFinalQ = 0;
    for (const c of clients) {
      const end = c.end_date ? new Date(c.end_date) : null;
      if (end && !Number.isNaN(end.getTime()) && end >= now && end <= ninetyOut) {
        closingSoon += 1;
      }
      // "Final quarter" — within 90 days of end date.
      if (end && !Number.isNaN(end.getTime())) {
        const daysLeft = Math.round((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysLeft >= 0 && daysLeft <= 90) inFinalQ += 1;
      }
    }

    return { projectedNextQ, monthlyRate, closingSoon, inFinalQ };
  }, [clients, deliverables]);

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA]">
        Forward view
      </p>
      <p className="mt-0.5 text-[11px] text-[#606060]">
        Projection at current pace · not a commitment
      </p>
      <ul className="mt-3 space-y-2.5">
        <ForwardRow
          label="Projected next quarter"
          value={`~ ${data.projectedNextQ.toLocaleString()} articles`}
          helper={`At ${data.monthlyRate.toFixed(0)}/mo trailing pace`}
        />
        <ForwardRow
          label="Contracts closing in 90 days"
          value={data.closingSoon.toString()}
          helper="By SOW Overview end date"
        />
        <ForwardRow
          label="Clients in final quarter"
          value={data.inFinalQ.toString()}
          helper="≤90 days remaining on contract"
        />
      </ul>
    </div>
  );
}

function ForwardRow({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <li className="border-b border-[#1f1f1f] pb-2 last:border-b-0 last:pb-0">
      <p className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-white">
        {value}
      </p>
      <p className="mt-0.5 font-mono text-[10px] text-[#606060]">{helper}</p>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Goals rollup — produces the props GoalsOverviewCards expects, scoped to
// the filtered clients across the active date range. Same 3-step weighted
// rollup pattern used in GoalsVsDeliverySection / aggregateGoalsByPod so
// totals reconcile with what D1 shows.
// ─────────────────────────────────────────────────────────────────────────────

interface ClientAgg {
  client: string;
  cbGoal: number;
  cbDel: number;
  adGoal: number;
  adDel: number;
}

const MONTH_NAMES_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseGoalMonth(s: string): { y: number; m: number } | null {
  const m = s.trim().match(/^(\w+)\s+(\d{4})$/);
  if (!m) return null;
  const idx = MONTH_NAMES_FULL.indexOf(m[1]);
  if (idx < 0) return null;
  return { y: Number(m[2]), m: idx + 1 };
}

function inDateRange(
  ym: { y: number; m: number },
  range: DateRange,
): boolean {
  if (range.type !== "range" || !range.from) return true;
  const cell = new Date(ym.y, ym.m - 1, 1);
  const from = new Date(range.from.getFullYear(), range.from.getMonth(), 1);
  const toSrc = range.to ?? range.from;
  const to = new Date(toSrc.getFullYear(), toSrc.getMonth() + 1, 0);
  return cell >= from && cell <= to;
}

function rollupGoalsForPortfolio(
  rows: GoalsVsDeliveryRow[],
  clients: Client[],
  dateRange: DateRange,
): {
  perClient: Map<string, ClientAgg>;
  totals: { cbGoal: number; cbDel: number; adGoal: number; adDel: number };
  asOfLabel: string | null;
} {
  const activeNames = new Set(clients.map((c) => c.name));

  type CMC = { ratio: number; cbGoal: number; cbDel: number; adGoal: number; adDel: number };
  const perCMC = new Map<string, CMC>();
  for (const r of rows) {
    if (!activeNames.has(r.client_name)) continue;
    const ym = parseGoalMonth(r.month_year);
    if (!ym || !inDateRange(ym, dateRange)) continue;
    const ct = (r.content_type ?? "").trim().toLowerCase() || "default";
    const key = `${r.client_name}|${r.month_year}|${ct}`;
    let e = perCMC.get(key);
    if (!e) {
      e = {
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

  const perCM = new Map<
    string,
    { client: string; cbGoal: number; cbDel: number; adGoal: number; adDel: number }
  >();
  for (const [k, e] of perCMC.entries()) {
    const [client, month] = k.split("|");
    const cmKey = `${client}|${month}`;
    let cm = perCM.get(cmKey);
    if (!cm) {
      cm = { client, cbGoal: 0, cbDel: 0, adGoal: 0, adDel: 0 };
      perCM.set(cmKey, cm);
    }
    cm.cbGoal += e.cbGoal * e.ratio;
    cm.cbDel += e.cbDel * e.ratio;
    cm.adGoal += e.adGoal * e.ratio;
    cm.adDel += e.adDel * e.ratio;
  }

  const perClient = new Map<string, ClientAgg>();
  for (const cm of perCM.values()) {
    let c = perClient.get(cm.client);
    if (!c) {
      c = { client: cm.client, cbGoal: 0, cbDel: 0, adGoal: 0, adDel: 0 };
      perClient.set(cm.client, c);
    }
    if (cm.cbGoal > 0) {
      c.cbGoal += cm.cbGoal;
      c.cbDel += cm.cbDel;
    }
    if (cm.adGoal > 0) {
      c.adGoal += cm.adGoal;
      c.adDel += cm.adDel;
    }
  }

  let cbGoal = 0, cbDel = 0, adGoal = 0, adDel = 0;
  for (const c of perClient.values()) {
    cbGoal += c.cbGoal;
    cbDel += c.cbDel;
    adGoal += c.adGoal;
    adDel += c.adDel;
  }

  let bestKey = -Infinity;
  let bestRow: GoalsVsDeliveryRow | null = null;
  for (const r of rows) {
    if (!activeNames.has(r.client_name)) continue;
    const d = parseGoalMonth(r.month_year);
    if (!d || !inDateRange(d, dateRange)) continue;
    const key = d.y * 1000 + d.m * 60 + (r.week_number ?? 0);
    if (key > bestKey) {
      bestKey = key;
      bestRow = r;
    }
  }
  const asOfLabel = bestRow
    ? (() => {
        const d = parseGoalMonth(bestRow.month_year);
        if (!d) return null;
        const monthShort = new Date(d.y, d.m - 1, 1).toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
        });
        return `As of week ${bestRow.week_number} · ${monthShort}`;
      })()
    : null;

  return {
    perClient,
    totals: { cbGoal, cbDel, adGoal, adDel },
    asOfLabel,
  };
}
