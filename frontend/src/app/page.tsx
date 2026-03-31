"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SummaryCard } from "@/components/dashboard/SummaryCard";
import { apiGet } from "@/lib/api";
import type { Client, DashboardSummary, ProductionTrendPoint } from "@/lib/types";
import {
  LayoutDashboard,
  Users,
  UserCog,
  FileText,
  BarChart3,
  Target,
  Upload,
  ArrowRight,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Navigation definitions
// ---------------------------------------------------------------------------

const dashboards = [
  {
    title: "Editorial Clients",
    description:
      "Client delivery tracker, SOW progress, and time-to-metric analysis.",
    href: "/editorial-clients",
    icon: LayoutDashboard,
  },
  {
    title: "Team KPIs",
    description:
      "Individual and pod-level KPI scores, capacity utilization, and trends.",
    href: "/team-kpis",
    icon: Users,
  },
];

const dataManagement = [
  {
    title: "Clients",
    description: "Manage client records",
    href: "/data-management/clients",
    icon: UserCog,
  },
  {
    title: "Deliverables",
    description: "Monthly deliverable tracking",
    href: "/data-management/deliverables",
    icon: FileText,
  },
  {
    title: "Capacity",
    description: "Pod capacity projections",
    href: "/data-management/capacity",
    icon: BarChart3,
  },
  {
    title: "KPI Scores",
    description: "Enter team KPI scores",
    href: "/data-management/kpi-entry",
    icon: Target,
  },
  {
    title: "Import",
    description: "Bulk CSV import",
    href: "/data-management/import",
    icon: Upload,
  },
];

// ---------------------------------------------------------------------------
// Pod colors for badges
// ---------------------------------------------------------------------------

const POD_BADGE_COLORS: Record<string, string> = {
  "Pod 1": "#8FB5D9",
  "Pod 2": "#42CA80",
  "Pod 3": "#F5BC4E",
  "Pod 5": "#ED6958",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Home() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [productionThisMonth, setProductionThisMonth] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      apiGet<DashboardSummary>("/api/dashboard/clients/summary"),
      apiGet<Client[]>("/api/clients/?status=ACTIVE&limit=100"),
    ])
      .then(([summaryData, clientsData]) => {
        setSummary(summaryData);
        setClients(clientsData);
        setLastUpdated(new Date());
      })
      .catch(() => {
        /* silently ignore -- cards will just stay in skeleton */
      })
      .finally(() => setLoading(false));

    // Fetch production trend — non-blocking
    apiGet<ProductionTrendPoint[]>("/api/dashboard/production-trend")
      .then((data) => {
        const actuals = data.filter((pt) => pt.is_actual);
        if (actuals.length > 0) {
          const last = actuals.sort(
            (a, b) => a.year * 100 + a.month - (b.year * 100 + b.month),
          ).at(-1)!;
          setProductionThisMonth(last.total_actual);
        }
      })
      .catch(() => {});
  }, []);

  // Recently onboarded: active clients sorted by start_date desc, first 6
  const recentlyOnboarded = useMemo(() => {
    return [...clients]
      .filter((c) => c.status === "ACTIVE")
      .sort((a, b) => {
        const dateA = a.start_date ? new Date(a.start_date).getTime() : 0;
        const dateB = b.start_date ? new Date(b.start_date).getTime() : 0;
        return dateB - dateA;
      })
      .slice(0, 6);
  }, [clients]);

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      {/* ---------- Header ---------- */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Editorial Hub
          </h1>
          <p className="mt-1 font-mono text-xs font-semibold uppercase tracking-widest text-[#42CA80]">
            BI Dashboard
          </p>
        </div>
        {lastUpdated && (
          <p className="font-mono text-[11px] text-[#606060]">
            Last updated{" "}
            {lastUpdated.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        )}
      </div>

      {/* ---------- Summary cards ---------- */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : summary ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard
            title="Active Clients"
            value={summary.total_active_clients}
            valueColor="green"
          />
          <SummaryCard
            title="Articles Delivered"
            value={summary.total_articles_delivered}
          />
          <SummaryCard
            title="Articles Invoiced"
            value={summary.total_articles_invoiced}
          />
          <SummaryCard
            title="Avg Time to First Article"
            value={
              summary.avg_time_to_first_article_days != null
                ? `${summary.avg_time_to_first_article_days} days`
                : "\u2014"
            }
          />
          <SummaryCard
            title="Production This Month"
            value={productionThisMonth != null ? productionThisMonth : "\u2014"}
            valueColor="green"
          />
        </div>
      ) : null}

      {/* ---------- Recently Onboarded Clients ---------- */}
      {!loading && recentlyOnboarded.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
            Recently Onboarded Clients
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recentlyOnboarded.map((client) => {
              const podColor =
                POD_BADGE_COLORS[client.editorial_pod ?? ""] ?? "#606060";
              const startFormatted = client.start_date
                ? new Date(client.start_date).toLocaleDateString("en-US", {
                    month: "short",
                    year: "numeric",
                  })
                : "\u2014";

              return (
                <div
                  key={client.id}
                  className="rounded-xl border border-[#2a2a2a] bg-[#161616] p-5"
                >
                  <p className="font-semibold text-white">{client.name}</p>
                  <div className="mt-2 flex items-center gap-2">
                    {client.editorial_pod && (
                      <Badge
                        variant="outline"
                        className="border-current text-xs"
                        style={{
                          color: podColor,
                          backgroundColor: `${podColor}15`,
                          borderColor: `${podColor}4D`,
                        }}
                      >
                        {client.editorial_pod}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-2 font-mono text-xs text-[#C4BCAA]">
                    Started: {startFormatted}
                  </p>
                  <p className="mt-1 font-mono text-xs text-[#606060]">
                    {client.articles_sow ?? 0}
                    <span className="text-[#404040]">/mo</span>
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ---------- Dashboards ---------- */}
      <section className="space-y-3">
        <h2 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
          Dashboards
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {dashboards.map((item) => (
            <Link key={item.href} href={item.href}>
              <Card className="group cursor-pointer border-[#2a2a2a] bg-[#161616] transition-colors hover:border-[#42CA80]/40">
                <CardContent className="flex items-start justify-between gap-4 py-6">
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#1e1e1e]">
                      <item.icon className="h-5 w-5 text-[#42CA80]" />
                    </div>
                    <div>
                      <p className="font-semibold text-white">{item.title}</p>
                      <p className="mt-1 text-sm text-[#C4BCAA]">
                        {item.description}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[#606060] transition-colors group-hover:text-[#42CA80]" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* ---------- Data Management ---------- */}
      <section className="space-y-3">
        <h2 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#606060]">
          Data Management
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {dataManagement.map((item) => (
            <Link key={item.href} href={item.href}>
              <Card className="group cursor-pointer border-[#2a2a2a] bg-[#161616] transition-colors hover:border-[#42CA80]/40">
                <CardContent className="flex items-start justify-between gap-2 py-4">
                  <div className="flex items-start gap-3">
                    <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-[#606060] group-hover:text-[#42CA80]" />
                    <div>
                      <p className="text-sm font-medium text-white">
                        {item.title}
                      </p>
                      <p className="mt-0.5 text-xs text-[#C4BCAA]">
                        {item.description}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#606060] opacity-0 transition-opacity group-hover:opacity-100" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
