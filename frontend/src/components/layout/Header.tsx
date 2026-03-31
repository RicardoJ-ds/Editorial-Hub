"use client";

import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";

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

export function Header() {
  const pathname = usePathname();
  const title = pageTitles[pathname] || "Editorial Hub";
  const breadcrumbs = getBreadcrumbs(pathname);

  return (
    <header className="flex h-14 items-center justify-between border-b border-[#1e1e1e] bg-black px-6">
      {/* Left: Page title + breadcrumb */}
      <div className="flex flex-col justify-center">
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
        <h1 className="text-sm font-semibold text-white">{title}</h1>
      </div>

      {/* Right: User info + avatar + logout */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs font-medium uppercase tracking-wider text-[#C4BCAA]">
          Ricardo Jaramillo
        </span>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#42CA80] text-sm font-bold text-black">
          G
        </div>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-md text-[#606060] transition-colors duration-[var(--transition-base)] hover:bg-[#1F1F1F] hover:text-white"
          aria-label="Logout"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
