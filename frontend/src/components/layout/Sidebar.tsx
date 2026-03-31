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
      <p className="ds-section-label mb-2 px-3">{label}</p>
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
                className={cn(
                  "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
                  "transition-all duration-[var(--transition-base)]",
                  isActive
                    ? "bg-[rgba(66,202,128,.06)] text-[#65FFAA]"
                    : "text-[#C4BCAA] hover:bg-[#1F1F1F] hover:text-white"
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-[#42CA80]" />
                )}
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
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
    <aside className="fixed inset-y-0 left-0 z-30 flex w-[240px] flex-col border-r border-[#1e1e1e] bg-[#0a0a0a]">
      {/* Logo + Title */}
      <div className="px-5 pt-5 pb-4">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/graphite-logo.png"
            alt="Graphite"
            width={32}
            height={32}
            className="rounded"
          />
          <div className="flex flex-col">
            <span
              className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-white"
            >
              Editorial Hub
            </span>
            <span className="font-mono text-[10px] font-medium text-[#606060]">
              Analytics Dashboard
            </span>
          </div>
        </Link>
      </div>

      {/* Search */}
      <div className="px-4 pb-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#606060]" />
          <input
            type="text"
            placeholder="Search..."
            className={cn(
              "h-9 w-full rounded-md border border-[#2a2a2a] bg-[#161616] pl-8 pr-3",
              "font-sans text-sm text-white placeholder:text-[#606060]",
              "outline-none transition-colors duration-[var(--transition-base)]",
              "focus:border-[#42CA80]/50 focus:ring-1 focus:ring-[#42CA80]/20"
            )}
          />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
        <NavSection label="Dashboards" items={dashboardNav} pathname={pathname} />
        <NavSection label="Data Management" items={dataManagementNav} pathname={pathname} />
      </nav>

      {/* Footer */}
      <div className="border-t border-[#1e1e1e] px-5 py-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] font-medium text-[#606060]">
            v0.1
          </span>
          <span className="font-mono text-[10px] text-[#404040]">
            &copy; Graphite
          </span>
        </div>
      </div>
    </aside>
  );
}
