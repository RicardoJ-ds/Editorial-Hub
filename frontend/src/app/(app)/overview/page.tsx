"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSectionDwell } from "@/lib/useSectionDwell";
import { apiGet } from "@/lib/api";
import { fetchAllDeliverables } from "@/lib/deliverablesClient";
import { Skeleton } from "@/components/ui/skeleton";
import { PeriodSnapshotSection, PodPaceSection, useLinkCardsToggle } from "@/components/dashboard/PeriodSnapshotSection";
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
import { AsOfBadge } from "@/components/dashboard/shared-helpers";
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
// Three sections, all driven by the same FilterBar:
//   • Pod Snapshot       — per-pod / per-client delivery + Q variance + lifetime.
//   • Time to Milestones — pod timelines + time-to-metrics + per-client days.
//   • Production History — monthly actuals vs projection trajectory.
// ─────────────────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "period-snapshot", label: "Pod Snapshot" },
  { id: "production-history", label: "Production History" },
  { id: "pod-pace", label: "Time to Milestones" },
];

export default function OverviewPage() {
  // Pod-locked teams (Editorial Team / Growth Team) have no Overview by
  // spec. The hook bounces them to /editorial-clients.
  const access = useRequireView("overview");
  const canLoadOverview = !!access?.is_authenticated && access.view_slugs.includes("overview");
  const overviewAsOf = useEditorialAsOf();
  const { axis: podAxis } = useCurrentPodAxis();
  // "Link cards" toggle for the Time to Milestones section. The chip
  // renders in the section header's rightSlot; `linkEnabled` flows down
  // into PodPaceSection so the chip's state actually drives the cards.
  const { linkEnabled: linkCardsEnabled, toggle: linkCardsToggle } =
    useLinkCardsToggle();
  const [clients, setClients] = useState<Client[]>([]);
  const [filteredClients, setFilteredClients] = useState<Client[]>([]);
  const [deliverables, setDeliverables] = useState<DeliverableMonthly[]>([]);
  const [cumulative, setCumulative] = useState<CumulativeMetric[]>([]);
  const [productionTrend, setProductionTrend] = useState<ProductionTrendPoint[]>([]);
  const [clientProduction, setClientProduction] = useState<ClientProductionRow[]>([]);
  const [goals, setGoals] = useState<GoalsVsDeliveryRow[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>({ type: "all" });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!canLoadOverview) return;
    setLoading(true);
    setLoadError(null);
    try {
      const cs = await apiGet<Client[]>("/api/clients/?limit=200");
      setClients(cs);
      setFilteredClients(cs);
    } catch (e) {
      console.error("Overview load failed:", e);
      setLoadError("Overview data failed to load. Refresh or check the API logs.");
      return;
    } finally {
      setLoading(false);
    }
    fetchAllDeliverables()
      .then(setDeliverables)
      .catch((e) => {
        console.error("Overview deliverables load failed:", e);
      });
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
  }, [canLoadOverview]);

  useEffect(() => {
    if (!canLoadOverview) return;
    fetchData();
  }, [canLoadOverview, fetchData]);

  useEffect(() => {
    if (!canLoadOverview) return;
    const handler = () => { fetchData(); };
    window.addEventListener("data-synced", handler);
    return () => window.removeEventListener("data-synced", handler);
  }, [canLoadOverview, fetchData]);

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

  if (loading && clients.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[#606060]">Loading overview…</p>
        <OverviewSkeleton />
      </div>
    );
  }

  if (loadError && clients.length === 0) {
    return (
      <div className="rounded-md border border-[#2a2a2a] bg-[#111] p-4">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#ED6958]">
          Overview unavailable
        </p>
        <p className="mt-2 text-sm text-[#C4BCAA]">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 bg-black pb-3 -mx-8 px-8 pt-3 min-h-[72px]">
        {/* Single-line header: title + filters + sync controls in one
            tight row. Same shape as the Editorial Clients page header
            but with a slightly larger page title. flex-nowrap so the
            sync timestamp + button never drop to a second line. */}
        <div className="flex flex-nowrap items-center gap-x-4 mb-3">
          <h1 className="font-mono text-base font-bold uppercase tracking-[0.18em] text-white whitespace-nowrap shrink-0">
            Overview
          </h1>
          <FilterBar
            clients={clients}
            onFilterChange={handleFilterChange}
            onDateRangeChange={handleDateRangeChange}
          />
          <div className="ml-auto shrink-0">
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
          <SectionIndex sections={SECTIONS} topOffset={92} />
          <div className="flex-1 min-w-0 space-y-12">
            {filteredClients.length === 1 && (
              <ClientHeader client={filteredClients[0]} />
            )}
            <Section
              id="period-snapshot"
              title="Pod Snapshot"
              subtitle="How each pod is delivering this quarter, with goals and contract progress"
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
                cumulative={cumulative}
              />
            </Section>

            <Section
              id="production-history"
              title="Production History"
              subtitle="Articles delivered each month, with the projected trend ahead"
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

            <Section
              id="pod-pace"
              title="Time to Milestones"
              subtitle="How fast each pod moves a client from kickoff to first published article"
              titleChip={
                <AsOfBadge
                  label={overviewAsOf.label}
                  fallback={overviewAsOf.isFallback}
                />
              }
              trailingSlot={
                <SectionCommentIcon
                  sectionId="pod-pace"
                  sectionLabel="Time to Milestones"
                />
              }
              rightSlot={linkCardsToggle}
            >
              <PodPaceSection
                filteredClients={filteredClients}
                linkEnabled={linkCardsEnabled}
              />
            </Section>

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
  children,
  rightSlot,
  trailingSlot,
  titleChip,
}: {
  id: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
  /** Slot rendered immediately after the section title, inline with it
   *  (NOT at the far-right of the header row). Used for the Notion-style
   *  comment icon so it reads as part of the title chip. */
  trailingSlot?: React.ReactNode;
  /** Optional chip rendered next to the title — used to surface scope
   *  notes that need to be visible at-a-glance (e.g. "May 2026 · not
   *  date-filtered" on Monthly Goals). */
  titleChip?: React.ReactNode;
}) {
  // Analytics: measure how long this section sits on-screen (≥50%
  // visible). Fires SectionViewed with dwell_ms when the section
  // leaves the viewport or the user navigates away.
  const ref = useRef<HTMLElement>(null);
  useSectionDwell(id, ref);
  return (
    <section
      ref={ref}
      id={id}
      className="group/sec scroll-mt-[92px] space-y-3"
    >
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
        {rightSlot && (
          <div className="flex items-center gap-3 shrink-0">{rightSlot}</div>
        )}
      </div>
      {children}
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
