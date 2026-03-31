"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building,
  FileText,
  BarChart3,
  Target,
  Upload,
  ShieldCheck,
  TrendingUp,
  Layers,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import type { Client, CapacityProjection } from "@/lib/types";

interface SectionItem {
  title: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  countKey: string;
}

const sections: SectionItem[] = [
  {
    title: "Client Management",
    description: "Manage client SOW data, status, and milestones",
    href: "/data-management/clients",
    icon: Building,
    countKey: "clients",
  },
  {
    title: "Deliverables Tracker",
    description: "Track monthly article deliveries and invoicing",
    href: "/data-management/deliverables",
    icon: FileText,
    countKey: "deliverables",
  },
  {
    title: "Capacity Planner",
    description: "Manage pod capacity projections",
    href: "/data-management/capacity",
    icon: BarChart3,
    countKey: "capacity",
  },
  {
    title: "KPI Scorecard",
    description: "Enter monthly KPI scores for team members",
    href: "/data-management/kpi-entry",
    icon: Target,
    countKey: "kpis",
  },
  {
    title: "AI Monitoring",
    description: "Writer AI compliance scans, flags, and rewrites",
    href: "/team-kpis?tab=ai-compliance",
    icon: ShieldCheck,
    countKey: "ai_monitoring",
  },
  {
    title: "Goals vs Delivery",
    description: "Weekly CB/article delivery pacing against monthly goals",
    href: "/editorial-clients?tab=deliverables-sow",
    icon: TrendingUp,
    countKey: "goals_delivery",
  },
  {
    title: "Cumulative Pipeline",
    description: "All-time pipeline metrics per client — topics, CBs, articles",
    href: "/editorial-clients?tab=contract-timeline",
    icon: Layers,
    countKey: "cumulative",
  },
  {
    title: "Import Data",
    description: "Import from Google Sheets (3 spreadsheets, 14 sheets)",
    href: "/data-management/import",
    icon: Upload,
    countKey: "import",
  },
];

export default function DataManagementPage() {
  const [counts, setCounts] = useState<Record<string, number | null>>({
    clients: null,
    deliverables: null,
    capacity: null,
    kpis: null,
    import: null,
  });

  useEffect(() => {
    async function fetchCounts() {
      try {
        const [clientsRes, capacityRes] = await Promise.allSettled([
          apiGet<Client[]>("/api/clients/?limit=200"),
          apiGet<CapacityProjection[]>("/api/capacity/?limit=200"),
        ]);

        setCounts((prev) => ({
          ...prev,
          clients:
            clientsRes.status === "fulfilled" ? clientsRes.value.length : 0,
          capacity:
            capacityRes.status === "fulfilled" ? capacityRes.value.length : 0,
        }));
      } catch {
        // silently fail
      }
    }
    fetchCounts();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Data Management</h2>
        <p className="mt-1 text-muted-foreground">
          Manage editorial data, clients, deliverables, and team capacity.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => (
          <Link key={section.href} href={section.href}>
            <Card className="h-full transition-colors hover:border-graphite-green/40 hover:bg-graphite-surface-hover">
              <CardHeader className="flex flex-row items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-graphite-green/10">
                  <section.icon className="h-5 w-5 text-graphite-green" />
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold">
                      {section.title}
                    </CardTitle>
                    {counts[section.countKey] !== null &&
                    counts[section.countKey] !== undefined ? (
                      <Badge variant="secondary" className="font-mono text-xs">
                        {counts[section.countKey]}
                      </Badge>
                    ) : section.countKey !== "import" &&
                      section.countKey !== "kpis" &&
                      section.countKey !== "deliverables" ? (
                      <Skeleton className="h-5 w-8" />
                    ) : null}
                  </div>
                  <CardDescription className="text-xs">
                    {section.description}
                  </CardDescription>
                </div>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
