"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, LogOut, RefreshCw, XCircle } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";

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
  "/capacity-planning": "Capacity Planning v2 [Proposal]",
  "/capacity-planning/roster": "Roster [Proposal]",
  "/capacity-planning/allocation": "Allocation [Proposal]",
  "/capacity-planning/schema": "Data Model [Proposal]",
  "/capacity-planning/tables": "Data Tables [Proposal]",
  "/capacity-planning/glossary": "KPI Glossary [Proposal]",
  "/capacity-planning/leave": "Leave [Proposal]",
  "/capacity-planning/overrides": "Overrides [Proposal]",
  "/capacity-planning/weekly": "Weekly Actuals [Proposal]",
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

type SyncState = "idle" | "syncing" | "success" | "error";

export type HeaderUser = {
  name: string;
  email: string;
  picture?: string;
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatMonthKey(m: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  const [y, mm] = m.split("-").map((n) => parseInt(n, 10));
  const d = new Date(y, mm - 1, 1);
  return `${d.toLocaleString("en-US", { month: "short" })} ${y}`;
}

export function Header({ user }: { user: HeaderUser }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const title = pageTitles[pathname] || "Editorial Hub";
  const breadcrumbs = getBreadcrumbs(pathname);
  const urlMonth = searchParams.get("m");
  const monthChip =
    pathname.startsWith("/capacity-planning") && urlMonth ? formatMonthKey(urlMonth) : null;
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncError, setSyncError] = useState<string | null>(null);

  async function handleSync() {
    setSyncState("syncing");
    setSyncError(null);
    try {
      // Get all importable sheets
      const sheets = await apiGet<{ name: string }[]>("/api/migrate/sheets");
      const importable = sheets.map((s) => s.name);

      // Import one sheet at a time to avoid timeout
      let failed = 0;
      for (const sheet of importable) {
        try {
          await apiPost("/api/migrate/import", { sheets: [sheet] });
        } catch {
          failed++;
        }
      }

      if (failed > 0) {
        setSyncState("error");
        setSyncError(`${failed} of ${importable.length} sheets failed`);
        setTimeout(() => setSyncState("idle"), 5000);
      } else {
        setSyncState("success");
        setTimeout(() => setSyncState("idle"), 3000);
      }
      // Notify dashboard pages to refetch
      window.dispatchEvent(new Event("data-synced"));
    } catch (err) {
      setSyncState("error");
      setSyncError(err instanceof Error ? err.message : "Sync failed");
      setTimeout(() => setSyncState("idle"), 5000);
    }
  }

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
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-white">{title}</h1>
          {monthChip && (
            <span className="rounded border border-[#42CA80]/40 bg-[#42CA80]/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#65FFAA]">
              {monthChip}
            </span>
          )}
        </div>
      </div>

      {/* Right: Sync button + User info + avatar + logout */}
      <div className="flex items-center gap-3">
        {/* Sync button (disabled for now) */}
        <button
          type="button"
          onClick={handleSync}
          disabled
          title={syncError ?? "Sync all data from Google Sheets"}
          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider transition-all duration-200 ${
            syncState === "syncing"
              ? "cursor-wait border-[#333] bg-[#1a1a1a] text-[#606060]"
              : syncState === "success"
                ? "border-[#42CA80]/30 bg-[#42CA80]/10 text-[#42CA80]"
                : syncState === "error"
                  ? "border-[#ED6958]/30 bg-[#ED6958]/10 text-[#ED6958]"
                  : "border-[#333] bg-[#1a1a1a] text-[#999] hover:border-[#42CA80]/40 hover:text-white"
          }`}
        >
          {syncState === "syncing" && (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          )}
          {syncState === "success" && (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          {syncState === "error" && <XCircle className="h-3.5 w-3.5" />}
          {syncState === "idle" && <RefreshCw className="h-3.5 w-3.5" />}
          <span>
            {syncState === "syncing"
              ? "Syncing..."
              : syncState === "success"
                ? "Synced"
                : syncState === "error"
                  ? "Failed"
                  : "Sync"}
          </span>
        </button>

        <div className="h-5 w-px bg-[#333]" />

        <span
          className="font-mono text-xs font-medium uppercase tracking-wider text-[#C4BCAA]"
          title={user.email}
        >
          {user.name}
        </span>
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
        <form action="/api/auth/logout" method="POST">
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
    </header>
  );
}
