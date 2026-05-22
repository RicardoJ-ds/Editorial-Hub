"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpRight } from "lucide-react";
import { apiGet } from "@/lib/api";
import { fetchAllDeliverables } from "@/lib/deliverablesClient";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeToMetrics } from "@/components/dashboard/TimeToMetrics";
import { PeriodSnapshotSection } from "@/components/dashboard/PeriodSnapshotSection";
import {
  DeliveryMixCard,
  DeliveryOverviewCards,
  MostBehindCard,
  PodAttentionCard,
} from "@/components/dashboard/DeliveryOverviewCards";
import { CumulativePipelineSection } from "@/components/dashboard/CumulativePipelineSection";
import { ClientDeliveryCards } from "@/components/dashboard/ClientDeliveryCards";
import { ProductionTrendChart } from "@/components/charts/ProductionTrendChart";
import { FilterBar, type DateRange } from "@/components/dashboard/FilterBar";
import { SectionIndex } from "@/components/dashboard/SectionIndex";
import {
  ClientCommentsRail,
  OverviewCommentsProvider,
  SectionCommentIcon,
} from "@/components/dashboard/OverviewCommentsRail";
import { SyncControls } from "@/components/layout/SyncControls";
import { ClientHeader } from "@/components/dashboard/CumulativePipelineHeader";
import { useEditorialAsOf } from "@/lib/editorialWeeksClient";
import { useRequireView } from "@/lib/accessClient";
import { useCurrentPodAxis } from "@/lib/podAxisClient";
import {
  AsOfBadge,
  CardTitleWithTooltip,
  displayPod,
} from "@/components/dashboard/shared-helpers";
import {
  normalizePod,
  sortPodKey,
} from "@/components/dashboard/ContractClientProgress";
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

// Visible sections drive the left nav rail. Everything below Production
// History was deprecated by Pod Snapshot and lives inside a single
// LegacySectionsContainer (hidden behind a Show toggle) until removal.
const SECTIONS = [
  { id: "period-snapshot", label: "Pod Snapshot" },
  { id: "production-history", label: "Production History" },
];

type Lens = "composition" | "triage";

export default function OverviewPage() {
  // Pod-locked teams (Editorial Team / Growth Team) have no Overview by
  // spec. The hook bounces them to /editorial-clients.
  useRequireView("overview");
  const overviewAsOf = useEditorialAsOf();
  const { axis: podAxis } = useCurrentPodAxis();
  const [clients, setClients] = useState<Client[]>([]);
  const [filteredClients, setFilteredClients] = useState<Client[]>([]);
  const [deliverables, setDeliverables] = useState<DeliverableMonthly[]>([]);
  const [cumulative, setCumulative] = useState<CumulativeMetric[]>([]);
  const [productionTrend, setProductionTrend] = useState<ProductionTrendPoint[]>([]);
  const [clientProduction, setClientProduction] = useState<ClientProductionRow[]>([]);
  const [goals, setGoals] = useState<GoalsVsDeliveryRow[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>({ type: "all" });
  const [lens, setLens] = useState<Lens>("composition");
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [cs, ds] = await Promise.all([
        apiGet<Client[]>("/api/clients/?limit=200"),
        fetchAllDeliverables(),
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
    apiGet<ProductionTrendPoint[]>("/api/dashboard/production-trend")
      .then(setProductionTrend)
      .catch(() => {});
    apiGet<ClientProductionRow[]>("/api/dashboard/client-production")
      .then(setClientProduction)
      .catch(() => {});
    apiGet<GoalsVsDeliveryRow[]>("/api/goals-delivery/all")
      .then(setGoals)
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

      <OverviewCommentsProvider
        sections={SECTIONS}
        filteredClients={filteredClients}
      >
        {/* Right-edge comments sidebar — fixed, hover to expand, sits
            12px inside the viewport's right edge so the page scrollbar
            stays clickable. */}
        <ClientCommentsRail />
        <div className="flex gap-6">
          <SectionIndex sections={SECTIONS} />
          <div className="flex-1 min-w-0 space-y-12">
            {filteredClients.length === 1 && (
              <ClientHeader client={filteredClients[0]} />
            )}
            <Section
              id="period-snapshot"
              title="Pod Snapshot"
              subtitle="Per-pod delivery + milestone pace · Goals scope is section-local"
              deepLinkHref="/editorial-clients?tab=deliverables-sow"
              titleChip={
                <AsOfBadge
                  label={overviewAsOf.label}
                  fallback={overviewAsOf.isFallback}
                />
              }
              trailingSlot={
                <SectionCommentIcon
                  sectionId="period-snapshot"
                  sectionLabel="Pod Snapshot"
                />
              }
            >
              <PeriodSnapshotSection
                clients={clients}
                filteredClients={filteredClients}
                summaries={summaries}
                goals={goals}
                clientProduction={clientProduction}
              />
            </Section>

            <Section
              id="production-history"
              title="Production History"
              subtitle="Monthly actuals + projection trajectory across the filtered clients"
              deepLinkHref="/editorial-clients?tab=contract-timeline#production-history"
              titleChip={
                <AsOfBadge
                  label={overviewAsOf.label}
                  fallback={overviewAsOf.isFallback}
                />
              }
              trailingSlot={
                <SectionCommentIcon
                  sectionId="production-history"
                  sectionLabel="Production History"
                />
              }
            >
              <ProductionTrendChart
                data={productionTrend}
                clientProduction={clientProduction}
                filteredClients={filteredClients}
                dateRange={dateRange}
                podAxis={podAxis}
              />
            </Section>

            {/* All sections below were superseded by Pod Snapshot. Kept
                mounted (collapsed) behind a single Show toggle for
                reference; removed in a follow-up once the new section
                is validated. */}
            <LegacySectionsContainer>
              <CollapsibleLegacySection
                id="time-to-metrics-legacy"
                title="Time-to Metrics (legacy)"
                subtitle="Original aggregate cards — now covered by Period Snapshot"
              >
                <TimeToMetrics clients={filteredClients} hideHeader />
              </CollapsibleLegacySection>

            <Section
              id="delivery-overview"
              title="Delivery Overview"
              subtitle={
                lens === "composition"
                  ? "What does our work look like?"
                  : "Who needs attention right now?"
              }
              deepLinkHref="/editorial-clients?tab=deliverables-sow#delivery-overview"
              trailingSlot={
                <SectionCommentIcon
                  sectionId="delivery-overview"
                  sectionLabel="Delivery Overview"
                />
              }
              rightSlot={<LensSwitcher value={lens} onChange={setLens} />}
            >
              {lens === "composition" && (
                <CompositionView
                  clients={filteredClients}
                  summaries={summaries}
                  cumulative={cumulative}
                  deliverables={deliverables}
                  clientProduction={clientProduction}
                  dateRange={dateRange}
                />
              )}
              {lens === "triage" && (
                <TriageView clients={filteredClients} summaries={summaries} />
              )}
            </Section>

            <Section
              id="cumulative-pipeline"
              title="Cumulative Pipeline"
              subtitle="All-time funnel coverage — Articles + Published per client"
              deepLinkHref="/editorial-clients?tab=deliverables-sow#cumulative-pipeline"
              titleChip={
                <AsOfBadge
                  label={overviewAsOf.label}
                  fallback={overviewAsOf.isFallback}
                />
              }
              trailingSlot={
                <SectionCommentIcon
                  sectionId="cumulative-pipeline"
                  sectionLabel="Cumulative Pipeline"
                />
              }
            >
              {/* Slim per-client cards: Articles + Published only. The Overview
                  lens skips Topics + CBs since they're upstream of billing —
                  executives reviewing here mostly care about shipped vs billed. */}
              <CumulativePipelineSection
                filteredClients={filteredClients}
                cardStages={["articles", "published"]}
                defaultCollapsedByPod
              />
            </Section>

            <Section
              id="client-delivery"
              title="Client Delivery at a Glance"
              subtitle="Per-client delivery vs invoicing — collapsed by pod to keep the page scannable"
              deepLinkHref="/editorial-clients?tab=deliverables-sow#client-delivery"
              titleChip={
                <AsOfBadge
                  label={overviewAsOf.label}
                  fallback={overviewAsOf.isFallback}
                />
              }
              trailingSlot={
                <SectionCommentIcon
                  sectionId="client-delivery"
                  sectionLabel="Client Delivery"
                />
              }
            >
              <ClientDeliveryCards
                rows={clientDeliveryRows}
                defaultCollapsedByPod
                hideHeader
              />
            </Section>
            </LegacySectionsContainer>

          </div>
        </div>
      </OverviewCommentsProvider>
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
  trailingSlot,
  titleChip,
}: {
  id: string;
  title: string;
  subtitle: string;
  deepLinkHref: string;
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
  /** Slot rendered immediately after the section title, inline with it
   *  (NOT at the far-right of the header row). Used for the Notion-style
   *  comment icon so it reads as part of the title chip rather than
   *  competing with the right-side "Open in …" button. */
  trailingSlot?: React.ReactNode;
  /** Optional chip rendered next to the title — used to surface scope
   *  notes that need to be visible at-a-glance (e.g. "May 2026 · not
   *  date-filtered" on Monthly Goals). */
  titleChip?: React.ReactNode;
}) {
  return (
    <section id={id} className="group/sec scroll-mt-[140px] space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
              {title}
            </h2>
            {titleChip}
            {trailingSlot}
          </div>
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

// Single Show/Hide wrapper for everything below Production History that
// Period Snapshot supersedes. Lets a VP audit the older views without
// leaking them into the default Overview surface. Removed entirely once
// the new section is validated and we drop the legacy code.
function LegacySectionsContainer({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="scroll-mt-[140px]">
      <div className="flex items-end justify-between gap-3 border-t border-[#2a2a2a] pt-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#606060]">
              Legacy sections
            </h2>
            <span className="rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[#606060]">
              Deprecated
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-[#606060]">
            Time-to Metrics · Delivery Overview · Cumulative Pipeline · Client Delivery — superseded by Pod Snapshot above.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[#909090] transition-colors hover:border-[#42CA80]/40 hover:text-[#42CA80]"
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open && <div className="mt-8 space-y-12">{children}</div>}
    </section>
  );
}

// Wrapper for an individual legacy section nested inside
// LegacySectionsContainer — Time-to Metrics gets its own inner Show/Hide
// because it's much taller than the others and most users only want to
// peek at it.
function CollapsibleLegacySection({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section id={id} className="scroll-mt-[140px] space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#606060]">
              {title}
            </h2>
          </div>
          <p className="mt-0.5 text-[11px] text-[#606060]">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[#909090] transition-colors hover:border-[#42CA80]/40 hover:text-[#42CA80]"
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open && children}
    </section>
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
// Triage lens — three top cards (Delivery Progress / Most Behind / Pod
// Attention), all bucketed on the current-Q projected close so catch-up
// plans baked into projections are honored. The forward-looking "Closing
// in 90d" card lives below; "Last Q Closes" was removed — its signal is
// now folded into Most Behind / Pod Attention rows (which show BOTH the
// last Q's actual close and the current Q's projected close per client).
// ─────────────────────────────────────────────────────────────────────────────

import { ClosingSoonCard } from "@/components/dashboard/DeliveryOverviewCards";
import type { SummaryRow } from "@/components/dashboard/DeliveryOverviewCards";

function TriageView({
  clients,
  summaries,
}: {
  clients: Client[];
  summaries: SummaryRow[];
}) {
  // 2 × 2 grid:
  //   row 1 — Delivery Progress · Most Behind
  //   row 2 — Pod Attention     · Closing in 90d
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <DeliveryMixCard
        rows={summaries}
        clients={clients}
        subtitle={`${summaries.length} client${summaries.length === 1 ? "" : "s"}`}
      />
      <MostBehindCard rows={summaries} clients={clients} />
      <PodAttentionCard rows={summaries} clients={clients} />
      <ClosingSoonCard clients={clients} />
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
  clientProduction,
  dateRange,
}: {
  clients: Client[];
  summaries: SummaryRow[];
  cumulative: CumulativeMetric[];
  deliverables: DeliverableMonthly[];
  clientProduction: ClientProductionRow[];
  dateRange: DateRange;
}) {
  // `deliverables` retained on the signature for future use but unused
  // now — delivered counts read from Operating Model below.
  void deliverables;
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

    // Resolve the date filter into [startCell, endCell] inclusive month
    // bounds (or null = no range = use trailing-3-months fallback).
    const cellOf = (y: number, m: number) => y * 12 + (m - 1);
    let rangeCells: { lo: number; hi: number; label: string } | null = null;
    if (dateRange.type === "range" && dateRange.from) {
      const from = dateRange.from;
      const to = dateRange.to ?? dateRange.from;
      rangeCells = {
        lo: cellOf(from.getFullYear(), from.getMonth() + 1),
        hi: cellOf(to.getFullYear(), to.getMonth() + 1),
        label: `${from.toLocaleString("en-US", { month: "short", year: "2-digit" })}${
          to.getTime() === from.getTime()
            ? ""
            : ` – ${to.toLocaleString("en-US", { month: "short", year: "2-digit" })}`
        }`,
      };
    }

    // Trailing 3 completed months — fallback when no date range is set.
    const now = new Date();
    const lastCompleted = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const trailing3Lo = cellOf(
      lastCompleted.getFullYear(),
      lastCompleted.getMonth() + 1 - 2,
    );
    const trailing3Hi = cellOf(
      lastCompleted.getFullYear(),
      lastCompleted.getMonth() + 1,
    );
    const trailingLabel = "last 3 months";

    // The two windows we accumulate into:
    //   recent: the "in-scope" period (date filter, or trailing-3 if no filter)
    //   prior:  the equal-length window immediately before `recent` —
    //           drives the ▲▼ % vs prior trend.
    const windowLo = rangeCells ? rangeCells.lo : trailing3Lo;
    const windowHi = rangeCells ? rangeCells.hi : trailing3Hi;
    const windowLength = windowHi - windowLo + 1;
    const priorLo = windowLo - windowLength;
    const priorHi = windowLo - 1;
    const periodLabel = rangeCells ? rangeCells.label : trailingLabel;

    const filteredNamesForSnap = new Set(clients.map((c) => c.name));
    let recent = 0;
    let prior = 0;
    for (const row of clientProduction) {
      if (!filteredNamesForSnap.has(row.client_name)) continue;
      for (const mm of row.monthly) {
        const cell = cellOf(mm.year, mm.month);
        const v = mm.actual ?? 0;
        if (cell >= windowLo && cell <= windowHi) recent += v;
        else if (cell >= priorLo && cell <= priorHi) prior += v;
      }
    }
    const trendPct =
      prior > 0 ? Math.round(((recent - prior) / prior) * 100) : null;

    return {
      activeClients: clients.length,
      pods: podSet.size,
      totalDelivered,
      totalSow,
      sowPct: totalSow > 0 ? Math.round((totalDelivered / totalSow) * 100) : null,
      recent,
      prior,
      trendPct,
      periodLabel,
      windowLo,
      windowHi,
    };
  }, [clients, summaries, clientProduction, axis, dateRange]);

  // Composition lens shows just two cards now: a portfolio snapshot and
  // a top-contributors list. Content Type Mix and Pod Output were
  // dropped — pod ranking already lives in the Production History
  // section, and content mix wasn't moving any decision on Overview.
  // `cumulative` is no longer read here but kept on the props for
  // upstream call sites that still pass it.
  void cumulative;
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <PeriodAtAGlance stats={stats} />
      <TopContributors
        clients={clients}
        clientProduction={clientProduction}
        windowLo={stats.windowLo}
        windowHi={stats.windowHi}
        periodLabel={stats.periodLabel}
      />
    </div>
  );
}

interface CompositionStats {
  activeClients: number;
  pods: number;
  totalDelivered: number;
  totalSow: number;
  sowPct: number | null;
  recent: number;
  prior: number;
  trendPct: number | null;
  periodLabel: string;
  windowLo: number;
  windowHi: number;
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
          Articles delivered ({stats.periodLabel})
        </p>
        <div className="mt-1 flex items-baseline gap-2">
          <p className="font-mono text-3xl font-bold tabular-nums text-white">
            {stats.recent.toLocaleString()}
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
            {stats.trendPct !== null ? "vs prior period" : "no prior data"}
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

function TopContributors({
  clients,
  clientProduction,
  windowLo,
  windowHi,
  periodLabel,
}: {
  clients: Client[];
  clientProduction: ClientProductionRow[];
  windowLo: number;
  windowHi: number;
  periodLabel: string;
}) {
  // Delivered counts source from the Editorial Operating Model sheet —
  // `ClientProductionRow.monthly[]` is the per-month feed imported from
  // that sheet. We sum only `.actual` per the spec ("actual, not
  // projected") and only within the date filter window (falling back to
  // trailing 3 months when no range is set — same window as Snapshot).
  const filteredNames = useMemo(
    () => new Set(clients.map((c) => c.name)),
    [clients],
  );
  const cellOf = (y: number, m: number) => y * 12 + (m - 1);
  const top = useMemo(() => {
    const sums: { name: string; delivered: number }[] = [];
    for (const row of clientProduction) {
      if (!filteredNames.has(row.client_name)) continue;
      let delivered = 0;
      for (const m of row.monthly) {
        const cell = cellOf(m.year, m.month);
        if (cell < windowLo || cell > windowHi) continue;
        delivered += m.actual ?? 0;
      }
      if (delivered > 0) sums.push({ name: row.client_name, delivered });
    }
    return sums.sort((a, b) => b.delivered - a.delivered).slice(0, 5);
  }, [clientProduction, filteredNames, windowLo, windowHi]);
  const max = top[0]?.delivered ?? 0;

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA]">
        Top contributors
      </p>
      <p className="mt-0.5 text-[11px] text-[#606060]">
        Highest actual article volume in {periodLabel} — Editorial Operating Model
      </p>
      {top.length === 0 ? (
        <p className="mt-3 text-[11px] text-[#606060]">No data in scope.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {top.map((r, i) => {
            const pct = max > 0 ? (r.delivered / max) * 100 : 0;
            return (
              <li key={r.name}>
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
                    {r.delivered.toLocaleString()}
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
                    <span className="text-[#C4BCAA]">{displayPod(d.pod, axis)}</span>
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
  // `deliverables` retained on signature for upstream call-site shape;
  // not used since Forward View was removed.
  void deliverables;
  return (
    <div className="space-y-3">
      <ProductionTrendChart
        data={productionTrend}
        clientProduction={clientProduction}
        filteredClients={clients}
      />
      <PodVelocity clients={clients} clientProduction={clientProduction} />
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
      <CardTitleWithTooltip
        label="Pod velocity"
        body={{
          title: "Pod velocity",
          bullets: [
            "Articles shipped per week, averaged over the last 4 months.",
            "▲▼ shows the change vs. the prior 4 months.",
            "Green: +5% or better · Red: −5% or worse · Grey: in between.",
          ],
        }}
      />
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
  clientProduction,
}: {
  clients: Client[];
  clientProduction: ClientProductionRow[];
}) {
  const data = useMemo(() => {
    const filteredNames = new Set(clients.map((c) => c.name));
    const now = new Date();
    const lastCompleted = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const cellOf = (y: number, m: number) => y * 12 + (m - 1);
    const lastCell = cellOf(lastCompleted.getFullYear(), lastCompleted.getMonth() + 1);

    // Projection sources from Editorial Operating Model actuals (same
    // source as Pod Velocity + Top Contributors) so all three cards
    // reconcile. Previously this read `deliverables_monthly` which can
    // be stale for recent months and was returning low / zero values.
    let trailing = 0;
    for (const row of clientProduction) {
      if (!filteredNames.has(row.client_name)) continue;
      for (const m of row.monthly) {
        const distance = lastCell - cellOf(m.year, m.month);
        if (distance >= 0 && distance < 3) trailing += m.actual ?? 0;
      }
    }
    const monthlyRate = trailing / 3;
    const projectedNextQ = Math.round(monthlyRate * 3);

    const ninetyOut = new Date();
    ninetyOut.setDate(ninetyOut.getDate() + 90);
    let closingSoon = 0;
    for (const c of clients) {
      const end = c.end_date ? new Date(c.end_date) : null;
      if (end && !Number.isNaN(end.getTime()) && end >= now && end <= ninetyOut) {
        closingSoon += 1;
      }
    }

    return { projectedNextQ, monthlyRate, closingSoon };
  }, [clients, clientProduction]);

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-4">
      <CardTitleWithTooltip
        label="Forward view"
        body={{
          title: "Forward view",
          bullets: [
            "Projection of next quarter at the current 3-month pace.",
            "Contracts closing: SOW end dates within the next 90 days.",
            "Estimate only — not a commitment.",
          ],
        }}
      />
      <p className="mt-0.5 text-[11px] text-[#606060]">
        Projection at current pace · not a commitment
      </p>
      <ul className="mt-3 space-y-2.5">
        <ForwardRow
          label="Projected next quarter"
          value={`~ ${data.projectedNextQ.toLocaleString()} articles`}
          helper={`At ${data.monthlyRate.toFixed(0)}/mo trailing pace`}
          tooltip={{
            title: "Projected next quarter",
            bullets: [
              "Sum of actuals over the last 3 completed months (Editorial Operating Model).",
              "Divide by 3 to get the monthly rate; multiply by 3 again to project the next quarter.",
              "If recent months haven't been imported, the projection reads low — re-sync past months.",
            ],
          }}
        />
        <ForwardRow
          label="Contracts closing in 90 days"
          value={data.closingSoon.toString()}
          helper="By SOW Overview end date"
          tooltip={{
            title: "Contracts closing in 90 days",
            bullets: [
              "Count of clients whose SOW Overview end date is between today and today + 90 days.",
              "Reads from `clients.end_date` (the SOW Overview sheet column).",
              "Clients with no end date set are not counted.",
            ],
          }}
        />
      </ul>
    </div>
  );
}

function ForwardRow({
  label,
  value,
  helper,
  tooltip,
}: {
  label: string;
  value: string;
  helper: string;
  tooltip?: { title: string; bullets: React.ReactNode[] };
}) {
  return (
    <li className="border-b border-[#1f1f1f] pb-2 last:border-b-0 last:pb-0">
      {tooltip ? (
        <CardTitleWithTooltip
          label={label}
          body={tooltip}
        />
      ) : (
        <p className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
          {label}
        </p>
      )}
      <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-white">
        {value}
      </p>
      <p className="mt-0.5 font-mono text-[10px] text-[#606060]">{helper}</p>
    </li>
  );
}
