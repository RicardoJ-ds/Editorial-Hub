"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Building2,
  FileText,
  BarChart3,
  Target,
  Download,
  Search,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const dashboardNav: NavItem[] = [
  { label: "Editorial Clients", href: "/editorial-clients", icon: LayoutDashboard },
  { label: "Team KPIs", href: "/team-kpis", icon: Users },
];

const dataManagementNav: NavItem[] = [
  { label: "Clients", href: "/data-management/clients", icon: Building2 },
  { label: "Deliverables", href: "/data-management/deliverables", icon: FileText },
  { label: "Capacity", href: "/data-management/capacity", icon: BarChart3 },
  { label: "KPI Scores", href: "/data-management/kpi-entry", icon: Target },
  { label: "Import Data", href: "/data-management/import", icon: Download },
];

const proposalNav: NavItem[] = [
  { label: "Capacity Planning v2", href: "/capacity-planning", icon: Sparkles },
];

function NavSection({
  label,
  items,
  pathname,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
}) {
  return (
    <div>
      {/* Section label — shown only when sidebar is expanded */}
      <p className="ds-section-label mb-2 hidden px-3 group-hover/sidebar:block">
        {label}
      </p>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                title={item.label}
                className={cn(
                  "group/item relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
                  "transition-all duration-[var(--transition-base)]",
                  isActive
                    ? "bg-[rgba(66,202,128,.06)] text-[#65FFAA]"
                    : "text-[#C4BCAA] hover:bg-[#1F1F1F] hover:text-white",
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-[#42CA80]" />
                )}
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="hidden whitespace-nowrap group-hover/sidebar:inline">
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "group/sidebar fixed inset-y-0 left-0 z-40 flex flex-col",
        "w-[64px] overflow-hidden border-r border-[#1e1e1e] bg-[#0a0a0a]",
        "transition-[width] duration-200 ease-in-out",
        "hover:w-[240px] hover:shadow-2xl hover:shadow-black/60",
      )}
    >
      {/* Logo + title */}
      <div className="px-3 pt-5 pb-4">
        <Link href="/" className="flex items-center gap-2.5 px-1" title="Editorial Hub">
          <Image
            src="/graphite-logo.png"
            alt="Graphite"
            width={32}
            height={32}
            className="shrink-0 rounded"
          />
          <div className="hidden flex-col group-hover/sidebar:flex">
            <span className="whitespace-nowrap font-mono text-xs font-semibold uppercase tracking-[0.12em] text-white">
              Editorial Hub
            </span>
            <span className="whitespace-nowrap font-mono text-[10px] font-medium text-[#606060]">
              Analytics Dashboard
            </span>
          </div>
        </Link>
      </div>

      {/* Search — input shown only when expanded; icon-only placeholder while collapsed */}
      <div className="px-3 pb-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#606060]" />
          <input
            type="text"
            placeholder="Search..."
            className={cn(
              "hidden h-9 w-full rounded-md border border-[#2a2a2a] bg-[#161616] pl-8 pr-3",
              "font-sans text-sm text-white placeholder:text-[#606060]",
              "outline-none transition-colors duration-[var(--transition-base)]",
              "focus:border-[#42CA80]/50 focus:ring-1 focus:ring-[#42CA80]/20",
              "group-hover/sidebar:block",
            )}
          />
          {/* Placeholder pill shown only while collapsed, purely visual */}
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-[#2a2a2a] bg-[#161616] group-hover/sidebar:hidden" />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-6 overflow-y-auto overflow-x-hidden px-3 py-2">
        <NavSection label="Dashboards" items={dashboardNav} pathname={pathname} />
        <NavSection label="Data Management" items={dataManagementNav} pathname={pathname} />
        <NavSection label="Proposal" items={proposalNav} pathname={pathname} />
      </nav>

      {/* Footer */}
      <div className="border-t border-[#1e1e1e] px-3 py-3">
        <div className="hidden items-center justify-between group-hover/sidebar:flex">
          <span className="font-mono text-[10px] font-medium text-[#606060]">v0.1</span>
          <span className="font-mono text-[10px] text-[#404040]">&copy; Graphite</span>
        </div>
      </div>
    </aside>
  );
}
