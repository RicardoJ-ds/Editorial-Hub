"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Compass,
  LayoutDashboard,
  Users,
  Download,
  Search,
  Sparkles,
  Shield,
  ShieldAlert,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { VERSION } from "@/lib/version";
import type { HeaderUser } from "@/components/layout/Header";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const dashboardNav: NavItem[] = [
  { label: "Overview", href: "/overview", icon: Compass },
  { label: "Editorial Clients", href: "/editorial-clients", icon: LayoutDashboard },
  { label: "Team KPIs", href: "/team-kpis", icon: Users },
];

// Maintain CRUD pages (Clients / Deliverables / Capacity / KPI Scores) are
// still routable but hidden from the nav — they'll be superseded by the
// Capacity Planning v2 maintain screens once that proposal lands. The
// "Capacity Maintenance" entry below is the proposal prototype; the
// proposal banner inside that page declares its prototype status.
const dataManagementNav: NavItem[] = [
  { label: "Import Data", href: "/data-management/import", icon: Download },
  { label: "Capacity Maintenance", href: "/capacity-planning", icon: Sparkles },
];

const adminNav: NavItem[] = [
  { label: "Access Control", href: "/admin/access", icon: Shield },
  { label: "Data Quality", href: "/admin/data-quality", icon: ShieldAlert },
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

export function Sidebar({ user }: { user: HeaderUser }) {
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
        <NavSection label="Data" items={dataManagementNav} pathname={pathname} />
        <NavSection label="Admin" items={adminNav} pathname={pathname} />
      </nav>

      {/* Footer — user identity + logout + version chip */}
      <div className="border-t border-[#1e1e1e] px-3 py-3">
        {/* Version chip — collapsed shows just the number; expanded shows the
            full label. Read from src/lib/version.ts (the single source of
            truth) so a release bumps every UI surface at once. */}
        <div
          className="mb-2 hidden items-center justify-between gap-2 group-hover/sidebar:flex"
          title={`Editorial Hub v${VERSION}`}
        >
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
            Version
          </span>
          <span className="rounded-sm border border-[#2a2a2a] bg-[#161616] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#C4BCAA]">
            v{VERSION}
          </span>
        </div>
        <div
          className="mb-2 flex justify-center group-hover/sidebar:hidden"
          title={`Editorial Hub v${VERSION}`}
        >
          <span className="rounded-sm border border-[#2a2a2a] bg-[#161616] px-1 py-0.5 font-mono text-[9px] font-semibold text-[#606060]">
            v{VERSION}
          </span>
        </div>
        {/* Collapsed: avatar only, centered */}
        <div className="flex items-center justify-center group-hover/sidebar:hidden" title={user.name}>
          {user.picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.picture}
              alt={user.name}
              className="h-8 w-8 rounded-full"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#42CA80] text-sm font-bold text-black">
              {getInitials(user.name)}
            </div>
          )}
        </div>

        {/* Expanded: avatar + name + logout */}
        <div className="hidden items-center gap-2 group-hover/sidebar:flex">
          {user.picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.picture}
              alt={user.name}
              className="h-8 w-8 shrink-0 rounded-full"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#42CA80] text-sm font-bold text-black">
              {getInitials(user.name)}
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <span
              className="truncate font-mono text-[11px] font-medium uppercase tracking-wider text-[#C4BCAA]"
              title={user.email}
            >
              {user.name}
            </span>
            <span className="truncate font-mono text-[10px] text-[#606060]">
              {user.email}
            </span>
          </div>
          <form action="/api/auth/logout" method="POST" className="shrink-0">
            <button
              type="submit"
              className="flex h-8 w-8 items-center justify-center rounded-md text-[#606060] transition-colors duration-[var(--transition-base)] hover:bg-[#1F1F1F] hover:text-white"
              aria-label="Logout"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
