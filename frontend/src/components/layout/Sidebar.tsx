"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Compass,
  LayoutDashboard,
  Users,
  Download,
  Search,
  Shield,
  ShieldAlert,
  BarChart3,
  LogOut,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { VERSION } from "@/lib/version";
import { useAccessProfile } from "@/lib/accessClient";
import { setSidebarExpanded } from "@/lib/sidebarState";
import { confirmDiscardIfUnsaved } from "@/lib/unsavedChangesClient";
import { HelpModal, type HelpModalTab } from "@/components/layout/HelpModal";
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
  /** View slugs that grant access. ANY-of semantics: user can see the
   *  link when their `view_slugs` intersects with this list. Empty / null
   *  = always visible (used for routes that don't participate in RBAC,
   *  but every entry below currently maps to something). */
  requiredViews?: string[];
}

const dashboardNav: NavItem[] = [
  { label: "Overview", href: "/overview", icon: Compass, requiredViews: ["overview"] },
  {
    label: "Editorial Clients",
    href: "/editorial-clients",
    icon: LayoutDashboard,
    requiredViews: ["d1.contract", "d1.deliverables"],
  },
  {
    label: "Team KPIs",
    href: "/team-kpis",
    icon: Users,
    requiredViews: ["d2.kpi", "d2.capacity", "d2.ai"],
  },
];

// Maintain CRUD pages (Clients / Deliverables / Capacity / KPI Scores) are
// still routable but hidden from the nav.
const dataManagementNav: NavItem[] = [
  { label: "Import Data", href: "/data-management/import", icon: Download, requiredViews: ["data.import"] },
];

const adminNav: NavItem[] = [
  { label: "Access Control", href: "/admin/access", icon: Shield, requiredViews: ["admin.access"] },
  { label: "Data Quality", href: "/admin/data-quality", icon: ShieldAlert, requiredViews: ["admin.data_quality"] },
  { label: "Analytics", href: "/admin/analytics", icon: BarChart3, requiredViews: ["admin.analytics"] },
];

function visibleItems(items: NavItem[], grantedViews: Set<string>): NavItem[] {
  return items.filter((item) => {
    const required = item.requiredViews ?? [];
    if (required.length === 0) return true; // always-visible item
    return required.some((slug) => grantedViews.has(slug));
  });
}

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
                onClick={(e) => {
                  // Gate client-side navigation on the shared unsaved
                  // changes store. Next.js router.push doesn't fire
                  // `beforeunload`, so without this an admin could
                  // silently drop a draft by clicking a sidebar item.
                  if (!confirmDiscardIfUnsaved()) e.preventDefault();
                }}
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
  const access = useAccessProfile();
  // Help modal state. `null` = closed; otherwise the active tab. Both the
  // Help button and the version chip open it on the "help" (glossary) tab —
  // the changelog tab is hidden for everyone. Sidebar owns this state because
  // both triggers live here.
  const [helpTab, setHelpTab] = useState<HelpModalTab | null>(null);
  // Until the access profile loads, render no permission-gated nav items.
  // Rendering every item during that gap exposes links the user may not
  // actually have, which is confusing on slow `/api/access/me` responses.
  const grantedViews = access ? new Set(access.view_slugs) : null;
  const dashItems = grantedViews
    ? visibleItems(dashboardNav, grantedViews)
    : [];
  const dataItems = grantedViews
    ? visibleItems(dataManagementNav, grantedViews)
    : [];
  const adminItems = grantedViews
    ? visibleItems(adminNav, grantedViews)
    : [];

  return (
    <aside
      onMouseEnter={() => setSidebarExpanded(true)}
      onMouseLeave={() => setSidebarExpanded(false)}
      className={cn(
        "group/sidebar fixed inset-y-0 left-0 z-40 flex flex-col",
        "w-[64px] overflow-hidden border-r border-[#1e1e1e] bg-[#0a0a0a]",
        "transition-[width] duration-200 ease-in-out",
        "hover:w-[240px] hover:shadow-2xl hover:shadow-black/60",
      )}
    >
      {/* Logo + title */}
      <div className="px-3 pt-5 pb-4">
        <Link
          href="/"
          className="flex items-center gap-2.5 px-1"
          title="Editorial Hub"
          onClick={(e) => {
            if (!confirmDiscardIfUnsaved()) e.preventDefault();
          }}
        >
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

      {/* Navigation — sections collapse out entirely when the user has no
          items in them (e.g. Editorial Team users see only Dashboards) */}
      <nav className="flex-1 space-y-6 overflow-y-auto overflow-x-hidden px-3 py-2">
        {dashItems.length > 0 && (
          <NavSection label="Dashboards" items={dashItems} pathname={pathname} />
        )}
        {dataItems.length > 0 && (
          <NavSection label="Data" items={dataItems} pathname={pathname} />
        )}
        {adminItems.length > 0 && (
          <NavSection label="Admin" items={adminItems} pathname={pathname} />
        )}
      </nav>

      {/* Footer — user identity + logout + version chip below */}
      <div className="border-t border-[#1e1e1e] px-3 py-3">
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

        {/* Help + version row — Help icon and the version chip both open
            HelpModal on the Help (glossary) tab. The changelog is hidden.
            Both are sidebar-aware: collapsed sidebar shows icons only,
            expanded shows labels. */}
        <div className="mt-2 hidden items-center justify-between gap-2 group-hover/sidebar:flex">
          <button
            type="button"
            onClick={() => setHelpTab("help")}
            title="Help & Glossary"
            className="inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[#909090] transition-colors hover:bg-[#1f1f1f] hover:text-white"
          >
            <HelpCircle className="h-3 w-3" />
            Help
          </button>
          <button
            type="button"
            onClick={() => setHelpTab("help")}
            title={`Editorial Hub v${VERSION}`}
            className="rounded-sm border border-[#2a2a2a] bg-[#161616] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#C4BCAA] transition-colors hover:border-[#42CA80]/40 hover:bg-[#42CA80]/10 hover:text-[#65FFAA]"
          >
            v{VERSION}
          </button>
        </div>
        <div className="mt-2 flex flex-col items-center gap-1.5 group-hover/sidebar:hidden">
          <button
            type="button"
            onClick={() => setHelpTab("help")}
            title="Help & Glossary"
            className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-[#606060] transition-colors hover:bg-[#1f1f1f] hover:text-white"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setHelpTab("help")}
            title={`Editorial Hub v${VERSION}`}
            className="rounded-sm border border-[#2a2a2a] bg-[#161616] px-1 py-0.5 font-mono text-[9px] font-semibold text-[#606060] transition-colors hover:border-[#42CA80]/40 hover:bg-[#42CA80]/10 hover:text-[#65FFAA]"
          >
            v{VERSION}
          </button>
        </div>
      </div>

      <HelpModal
        open={helpTab !== null}
        onOpenChange={(next) => setHelpTab(next ? helpTab ?? "help" : null)}
        initialTab={helpTab ?? "help"}
        profile={access}
      />
    </aside>
  );
}
