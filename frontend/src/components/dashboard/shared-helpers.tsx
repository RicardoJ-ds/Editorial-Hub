"use client";

import React, { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { TableHead } from "@/components/ui/table";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const POD_COLORS: Record<string, string> = {
  "Pod 1": "bg-[#5B9BF5]/15 text-[#5B9BF5] border-[#5B9BF5]/30",
  "Pod 2": "bg-[#42CA80]/15 text-[#42CA80] border-[#42CA80]/30",
  "Pod 3": "bg-[#F5C542]/15 text-[#F5C542] border-[#F5C542]/30",
  "Pod 4": "bg-[#F28D59]/15 text-[#F28D59] border-[#F28D59]/30",
  "Pod 5": "bg-[#ED6958]/15 text-[#ED6958] border-[#ED6958]/30",
};

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------

type StatusVariant = "default" | "secondary" | "destructive" | "outline";

export function statusBadge(status: string) {
  const map: Record<string, { label: string; className: string; variant: StatusVariant }> = {
    ACTIVE: { label: "Active", className: "bg-[#42CA80]/15 text-[#42CA80] border-[#42CA80]/30", variant: "outline" },
    COMPLETED: { label: "Completed", className: "bg-[#606060]/15 text-[#909090] border-[#606060]/30", variant: "outline" },
    CANCELLED: { label: "Cancelled", className: "bg-[#ED6958]/15 text-[#ED6958] border-[#ED6958]/30", variant: "outline" },
    SOON_TO_BE_ACTIVE: { label: "Soon Active", className: "bg-[#F5C542]/15 text-[#F5C542] border-[#F5C542]/30", variant: "outline" },
    INACTIVE: { label: "Inactive", className: "bg-[#606060]/15 text-[#909090] border-[#606060]/30", variant: "outline" },
  };
  const info = map[status] ?? { label: status, className: "", variant: "secondary" as StatusVariant };
  return <Badge variant={info.variant} className={info.className}>{info.label}</Badge>;
}

/**
 * Display-only formatter for pod labels.
 *
 * Internal keys stay as "Pod 1" / "Pod 2" / "Unassigned" so POD_COLORS lookups,
 * Map keys, and filter-value equality keep working. This helper is for UI
 * rendering only — it prepends "Editorial" (default) or "Growth" so a viewer
 * can tell at a glance which pod taxonomy they're looking at.
 */
export function displayPod(
  pod: string | null | undefined,
  kind: "editorial" | "growth" = "editorial",
): string {
  if (!pod) return "—";
  const s = String(pod).trim();
  if (!s || s === "—" || s === "-") return "—";
  if (/^unassigned$/i.test(s)) return "Unassigned";
  // Already disambiguated — leave as-is.
  if (/^(editorial|growth)\s+pod/i.test(s)) return s;
  const prefix = kind === "growth" ? "Growth Pod" : "Editorial Pod";
  // Handle "Pod 1", "pod 1", "P1", "1".
  const m = s.match(/^pod\s*(\d+)$/i) ?? s.match(/^p\s*(\d+)$/i) ?? s.match(/^(\d+)$/);
  if (m) return `${prefix} ${m[1]}`;
  return s;
}

export function podBadge(pod: string | null, kind: "editorial" | "growth" = "editorial") {
  if (!pod) return <span className="text-[#606060]">{"\u2014"}</span>;
  const color = POD_COLORS[pod] ?? "bg-secondary text-secondary-foreground";
  return <Badge variant="outline" className={color}>{displayPod(pod, kind)}</Badge>;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

export function pctColor(pctStr: string | null): string {
  if (!pctStr) return "text-[#606060]";
  const num = parseFloat(pctStr.replace("%", "")); // nosemgrep
  if (isNaN(num)) return "text-[#606060]";
  if (num >= 75) return "text-[#42CA80]";
  if (num >= 50) return "text-[#F5C542]";
  return "text-[#ED6958]";
}

export function pctColorNum(v: number | null): string {
  if (v == null) return "text-[#606060]";
  if (v >= 75) return "text-[#42CA80]";
  if (v >= 50) return "text-[#F5C542]";
  return "text-[#ED6958]";
}

export function parsePctValue(pctStr: string | null): number {
  if (!pctStr) return 0;
  const num = parseFloat(pctStr.replace("%", "")); // nosemgrep
  return isNaN(num) ? 0 : num;
}

export function displayPct(pctStr: string | null): string {
  if (!pctStr) return "-%";
  const trimmed = pctStr.trim();
  if (trimmed === "" || trimmed === "0" || trimmed === "0%") return "0%";
  return trimmed.includes("%") ? trimmed : `${trimmed}%`;
}

// ---------------------------------------------------------------------------
// Goal status badge
// ---------------------------------------------------------------------------

export function goalStatusBadge(cbPct: number, adPct: number) {
  const avg = (cbPct + adPct) / 2;
  if (avg >= 75) return (
    <span className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider"
      style={{ backgroundColor: "rgba(66,202,128,.12)", color: "#42CA80" }}>On Track</span>
  );
  if (avg >= 50) return (
    <span className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider"
      style={{ backgroundColor: "rgba(245,188,78,.12)", color: "#F5BC4E" }}>Behind</span>
  );
  return (
    <span className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider"
      style={{ backgroundColor: "rgba(237,105,88,.12)", color: "#ED6958" }}>At Risk</span>
  );
}

// ---------------------------------------------------------------------------
// Sort hook
// ---------------------------------------------------------------------------

type SortDir = "asc" | "desc" | null;

export function useSortableData<T>(data: T[]) {
  const [sortKey, setSortKey] = useState<keyof T | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return data;
    return [...data].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });
  }, [data, sortKey, sortDir]);

  const toggleSort = useCallback(
    (key: keyof T) => {
      if (sortKey === key) {
        if (sortDir === "asc") setSortDir("desc");
        else if (sortDir === "desc") { setSortKey(null); setSortDir(null); }
      } else { setSortKey(key); setSortDir("asc"); }
    },
    [sortKey, sortDir]
  );

  const getSortIcon = useCallback(
    (key: keyof T) => {
      if (sortKey !== key) return <ArrowUpDown className="ml-1 inline h-3 w-3 text-[#606060]" />;
      if (sortDir === "asc") return <ArrowUp className="ml-1 inline h-3 w-3 text-[#42CA80]" />;
      return <ArrowDown className="ml-1 inline h-3 w-3 text-[#42CA80]" />;
    },
    [sortKey, sortDir]
  );

  return { sorted, toggleSort, getSortIcon };
}

// ---------------------------------------------------------------------------
// Sortable Table Head
// ---------------------------------------------------------------------------

export function SortableHead<T>({
  label, field, toggle, icon,
}: {
  label: string;
  field: keyof T;
  toggle: (key: keyof T) => void;
  icon: (key: keyof T) => React.ReactNode;
}) {
  return (
    <TableHead
      className="cursor-pointer select-none text-xs text-[#C4BCAA] hover:text-white"
      onClick={() => toggle(field)}
    >
      {label}{icon(field)}
    </TableHead>
  );
}
