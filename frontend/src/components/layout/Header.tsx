"use client";

import { usePathname } from "next/navigation";
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

// Routes that render their own SyncControls inline with the filter bar.
// On those routes we hide the global header bar entirely so the dashboard
// can use that vertical space.
const HEADER_HIDDEN_ROUTES = new Set([
  "/overview",
  "/editorial-clients",
  "/team-kpis",
]);

export function Header() {
  const pathname = usePathname();
  const breadcrumbs = getBreadcrumbs(pathname);

  if (HEADER_HIDDEN_ROUTES.has(pathname)) return null;

  return (
    <header className="flex h-10 items-center justify-between border-b border-[#1e1e1e] bg-black px-6">
      {/* Left: breadcrumb (only multi-segment routes) */}
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
      </div>

      {/* Right: sync controls */}
      <SyncControls />
    </header>
  );
}
