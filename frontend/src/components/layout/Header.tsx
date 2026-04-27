"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { SyncControls } from "@/components/layout/SyncControls";

const pageTitles: Record<string, string> = {
  "/": "Home",
  "/editorial-clients": "Editorial Clients Dashboard",
  "/team-kpis": "Team KPIs Dashboard",
  "/data-management": "Data Management",
  "/data-management/clients": "Client Management",
  "/data-management/deliverables": "Deliverables",
  "/data-management/capacity": "Capacity Planning",
  "/data-management/kpi-entry": "KPI Scores",
  "/data-management/import": "Import Data",
  "/admin/access": "Access Control",
  "/capacity-planning": "Capacity Planning v2 [Proposal]",
  "/capacity-planning/roster": "Roster [Proposal]",
  "/capacity-planning/allocation": "Allocation [Proposal]",
  "/capacity-planning/schema": "Data Model [Proposal]",
  "/capacity-planning/tables": "Data Tables [Proposal]",
  "/capacity-planning/glossary": "KPI Glossary [Proposal]",
  "/capacity-planning/leave": "Leave [Proposal]",
  "/capacity-planning/overrides": "Overrides [Proposal]",
  "/capacity-planning/weekly": "Weekly Actuals [Proposal]",
  "/capacity-planning/admin": "Admin [Proposal]",
  "/capacity-planning/admin/members": "Members [Admin]",
  "/capacity-planning/admin/pods": "Pods [Admin]",
  "/capacity-planning/admin/clients": "Clients [Admin]",
  "/capacity-planning/admin/tiers": "Engagement Tiers [Admin]",
  "/capacity-planning/admin/metrics": "KPI Metrics [Admin]",
  "/capacity-planning/migration": "Migration [Proposal]",
  "/capacity-planning/quarter": "Quarterly Rollup [Proposal]",
  "/capacity-planning/gantt": "Client Gantt [Proposal]",
  "/capacity-planning/delivery": "Delivery Monthly [Proposal]",
  "/capacity-planning/kpi-scores": "KPI Scores Entry [Proposal]",
  "/capacity-planning/articles": "Articles Workflow [Proposal]",
  "/capacity-planning/ai-scans": "AI Scans [Proposal]",
  "/capacity-planning/surfer": "Surfer API Usage [Proposal]",
  "/capacity-planning/pipeline": "Pipeline Snapshots [Proposal]",
};

function getBreadcrumbs(pathname: string): { label: string; href: string }[] {
  if (pathname === "/") return [];
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: { label: string; href: string }[] = [];
  let path = "";
  for (const segment of segments) {
    path += `/${segment}`;
    const label =
      pageTitles[path] ||
      segment
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    crumbs.push({ label, href: path });
  }
  return crumbs;
}

export type HeaderUser = {
  name: string;
  email: string;
  picture?: string;
};

function formatMonthKey(m: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  const [y, mm] = m.split("-").map((n) => parseInt(n, 10));
  const d = new Date(y, mm - 1, 1);
  return `${d.toLocaleString("en-US", { month: "short" })} ${y}`;
}

// Routes that render their own SyncControls inline with the filter bar.
// On those routes we hide the global header bar entirely so the dashboard
// can use that vertical space.
const HEADER_HIDDEN_ROUTES = new Set(["/editorial-clients", "/team-kpis"]);

export function Header() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const breadcrumbs = getBreadcrumbs(pathname);
  const urlMonth = searchParams.get("m");
  const monthChip =
    pathname.startsWith("/capacity-planning") && urlMonth ? formatMonthKey(urlMonth) : null;

  if (HEADER_HIDDEN_ROUTES.has(pathname)) return null;

  return (
    <header className="flex h-10 items-center justify-between border-b border-[#1e1e1e] bg-black px-6">
      {/* Left: breadcrumb (only multi-segment routes) + month chip */}
      <div className="flex items-center gap-3">
        {breadcrumbs.length > 1 && (
          <div className="flex items-center gap-1.5 text-[10px]">
            {breadcrumbs.slice(0, -1).map((crumb, i) => (
              <span key={crumb.href} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-[#404040]">/</span>}
                <span className="font-mono uppercase tracking-wider text-[#606060]">
                  {crumb.label}
                </span>
              </span>
            ))}
            <span className="text-[#404040]">/</span>
          </div>
        )}
        {monthChip && (
          <span className="rounded border border-[#42CA80]/40 bg-[#42CA80]/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#65FFAA]">
            {monthChip}
          </span>
        )}
      </div>

      {/* Right: sync controls */}
      <SyncControls />
    </header>
  );
}
