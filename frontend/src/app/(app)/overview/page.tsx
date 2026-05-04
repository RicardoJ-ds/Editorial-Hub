"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { apiGet } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeToMetrics } from "@/components/dashboard/TimeToMetrics";
import {
  DeliveryOverviewCards,
  MostBehindCard,
  PodAttentionCard,
} from "@/components/dashboard/DeliveryOverviewCards";
import { CumulativePipelineHeader } from "@/components/dashboard/CumulativePipelineHeader";
import { GoalsOverviewCards } from "@/components/dashboard/GoalsOverviewCards";
import {
  AsOfBadge,
  contentTypeRatio,
  lastCompletedMonthLabel,
} from "@/components/dashboard/shared-helpers";
import { buildLifetimeSummaries } from "@/lib/overviewSummary";
import type {
  Client,
  CumulativeMetric,
  DeliverableMonthly,
  GoalsVsDeliveryRow,
} from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Overview dashboard — exec snapshot
//
// Pure mirror of the unfiltered top-row cards from D1's two tabs, all on
// one screen so a manager / VP can scan portfolio status without flipping
// tabs or applying filters. Each section deep-links into the corresponding
// D1 section for the full detail.
//
//   • Tab 1 → Time-to Metrics row
//   • Tab 2 → Delivery Overview row + Cumulative Pipeline strip + Monthly
//             Goals Range Snapshot row
//
// Always-current; no date filter (filters live on D1).
// ─────────────────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [deliverables, setDeliverables] = useState<DeliverableMonthly[]>([]);
  const [cumulative, setCumulative] = useState<CumulativeMetric[]>([]);
  const [goalRows, setGoalRows] = useState<GoalsVsDeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiGet<Client[]>("/api/clients/?limit=200"),
      apiGet<DeliverableMonthly[]>("/api/deliverables/?limit=1000"),
    ])
      .then(([cs, ds]) => {
        if (cancelled) return;
        setClients(cs);
        setDeliverables(ds);
      })
      .catch((e) => console.error("Overview load failed:", e))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    apiGet<CumulativeMetric[]>("/api/goals-delivery/cumulative")
      .then((d) => !cancelled && setCumulative(d))
      .catch(() => {});
    apiGet<GoalsVsDeliveryRow[]>("/api/goals-delivery/all")
      .then((d) => !cancelled && setGoalRows(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Active clients only — Overview is a current-state snapshot.
  const activeClients = useMemo(
    () => clients.filter((c) => c.status === "ACTIVE"),
    [clients],
  );

  const summaries = useMemo(
    () => buildLifetimeSummaries(activeClients, deliverables),
    [activeClients, deliverables],
  );

  // Goals Range Snapshot inputs — same 3-step rollup the rest of the app
  // uses (max-of-week per client × month × content_type, weighted-summed
  // up to client × month, then per-client totals). No date filter so the
  // portfolio reading mirrors what D1 shows when nothing is narrowed.
  const goalsSummary = useMemo(
    () => rollupGoalsForPortfolio(goalRows, activeClients),
    [goalRows, activeClients],
  );

  if (loading && clients.length === 0) {
    return <OverviewSkeleton />;
  }

  return (
    <div className="space-y-10">
      <PageHeader />

      <Section
        title="Time-to Metrics"
        subtitle="Average milestone handoffs across the portfolio"
        deepLinkLabel="Open in Editorial Clients"
        deepLinkHref="/editorial-clients?tab=contract-timeline#time-to-metrics"
      >
        <TimeToMetrics clients={activeClients} />
      </Section>

      <Section
        title="Delivery Overview"
        subtitle="Exec triage signals + portfolio totals across active clients"
        deepLinkLabel="Open in Editorial Clients"
        deepLinkHref="/editorial-clients?tab=deliverables-sow#delivery-overview"
      >
        <div className="space-y-3">
          {/* Exec triage row — Most Behind + Pod Attention live here only.
              They are intentionally absent from D1's Delivery Overview row
              so the exec view owns these signals. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <MostBehindCard rows={summaries} clients={activeClients} />
            <PodAttentionCard rows={summaries} clients={activeClients} />
          </div>
          {/* Standard portfolio row — same three cards D1 shows now
              (Delivery Mix · Closing 90D · Last Q Closes). */}
          <DeliveryOverviewCards
            allClients={activeClients}
            filteredClients={activeClients}
            rows={summaries}
          />
        </div>
      </Section>

      <Section
        title="Cumulative Pipeline"
        subtitle="All-time funnel coverage across active clients"
        deepLinkLabel="Open in Editorial Clients"
        deepLinkHref="/editorial-clients?tab=deliverables-sow#cumulative-pipeline"
      >
        <CumulativePipelineHeader
          filteredClients={activeClients}
          rows={cumulative}
        />
      </Section>

      <Section
        title="Monthly Goals — Range Snapshot"
        subtitle="Portfolio CB / Article achievement across all tracked months"
        deepLinkLabel="Open in Editorial Clients"
        deepLinkHref="/editorial-clients?tab=deliverables-sow#monthly-goals"
      >
        <GoalsOverviewCards
          filteredClients={activeClients}
          perClient={goalsSummary.perClient}
          totals={goalsSummary.totals}
          asOfLabel={goalsSummary.asOfLabel}
        />
      </Section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page chrome
// ─────────────────────────────────────────────────────────────────────────────

function PageHeader() {
  return (
    <div className="flex items-end justify-between gap-3 border-b border-[#2a2a2a] pb-3">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
          Dashboards
        </p>
        <h1 className="mt-1 flex items-center gap-3 font-mono text-base font-bold uppercase tracking-[0.2em] text-white">
          Overview
          <AsOfBadge label={lastCompletedMonthLabel()} />
        </h1>
        <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-[#909090]">
          Same top-row cards as Editorial Clients (Tab 1 + Tab 2), pinned in
          their unfiltered portfolio view. Each section opens the full
          dashboard for filtering and detail.
        </p>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  deepLinkLabel,
  deepLinkHref,
  children,
}: {
  title: string;
  subtitle: string;
  deepLinkLabel: string;
  deepLinkHref: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
            {title}
          </h2>
          <p className="mt-0.5 text-[11px] text-[#606060]">{subtitle}</p>
        </div>
        <Link
          href={deepLinkHref}
          className="group inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[#909090] hover:text-[#42CA80]"
        >
          {deepLinkLabel}
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </Link>
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
// Goals rollup — produces the props GoalsOverviewCards expects, scoped to
// every active client across every month tracked. Same 3-step weighted
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

function rollupGoalsForPortfolio(
  rows: GoalsVsDeliveryRow[],
  clients: Client[],
): {
  perClient: Map<string, ClientAgg>;
  totals: { cbGoal: number; cbDel: number; adGoal: number; adDel: number };
  asOfLabel: string | null;
} {
  const activeNames = new Set(clients.map((c) => c.name));

  // Step 1: max per (client × month × content_type) across the running-
  // cumulative weeks. Skips rows for clients outside the active set.
  type CMC = { ratio: number; cbGoal: number; cbDel: number; adGoal: number; adDel: number };
  const perCMC = new Map<string, CMC>();
  for (const r of rows) {
    if (!activeNames.has(r.client_name)) continue;
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

  // Step 2: weighted-sum content types into (client × month).
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

  // Step 3: client totals, dropping months without a goal so deliveries in
  // ramp-up months (no goal yet) don't inflate the numerator. Same rule as
  // GoalsVsDeliverySection.
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

  // "As of" — derived from the latest (month, week_number) actually present
  // in scope, matching D1's framing.
  let bestKey = -Infinity;
  let bestRow: GoalsVsDeliveryRow | null = null;
  for (const r of rows) {
    if (!activeNames.has(r.client_name)) continue;
    const d = parseGoalMonth(r.month_year);
    if (!d) continue;
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
