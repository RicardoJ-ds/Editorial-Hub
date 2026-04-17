"use client";

import Link from "next/link";
import { ArrowRight, Briefcase, Building2, Gauge, Layers, Users } from "lucide-react";
import { ProposalBanner } from "../_ProposalBanner";
import { SubNav } from "../_SubNav";
import { useCP2Store } from "../_store";

export default function AdminIndex() {
  const { dims } = useCP2Store();

  const CARDS = [
    {
      href: "/capacity-planning/admin/members",
      icon: Users,
      title: "Team members",
      subtitle: "cp2_dim_team_member",
      count: dims.members.length,
      blurb: "Roster. Default capacity, role, start/end month.",
    },
    {
      href: "/capacity-planning/admin/pods",
      icon: Layers,
      title: "Pods",
      subtitle: "cp2_dim_pod",
      count: dims.pods.length,
      blurb: "Pod catalog. Active-from / active-to lifecycle.",
    },
    {
      href: "/capacity-planning/admin/clients",
      icon: Building2,
      title: "Clients (cp2)",
      subtitle: "cp2_dim_client",
      count: dims.clients.length,
      blurb: "SOW totals, cadence, engagement tier.",
    },
    {
      href: "/capacity-planning/admin/tiers",
      icon: Briefcase,
      title: "Engagement tiers",
      subtitle: "cp2_dim_engagement_tier",
      count: dims.tiers.length,
      blurb: "Premium / Standard / Custom + descriptions.",
    },
    {
      href: "/capacity-planning/admin/metrics",
      icon: Gauge,
      title: "KPI metrics",
      subtitle: "cp2_dim_kpi_metric",
      count: dims.metrics.length,
      blurb: "Targets, direction, formulas, applicable roles.",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <ProposalBanner subtitle="Admin is where the dim tables live. Edits here are proposal-only (localStorage) — when the real cp2 schema lands, these screens write to it directly." />
      <SubNav />

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group flex flex-col gap-2 rounded-xl border border-[#1f1f1f] bg-[#0a0a0a] p-5 transition-colors hover:border-[#42CA80]/30 hover:bg-[#0c1510]"
          >
            <div className="flex items-start justify-between">
              <c.icon className="h-5 w-5 text-[#42CA80]" />
              <span className="rounded border border-[#42CA80]/30 bg-[#42CA80]/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#65FFAA]">
                {c.count} rows
              </span>
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">{c.title}</h3>
              <p className="mt-0.5 font-mono text-[10px] text-[#606060]">{c.subtitle}</p>
            </div>
            <p className="text-xs text-[#C4BCAA]">{c.blurb}</p>
            <span className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[#42CA80] group-hover:text-[#65FFAA]">
              Open
              <ArrowRight className="h-3 w-3" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
