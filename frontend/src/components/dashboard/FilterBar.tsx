"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, parseISODateLocal } from "@/lib/utils";
import type { Client } from "@/lib/types";
import { Search, X } from "lucide-react";
import { DateRangeFilter, type DateRange } from "./DateRangeFilter";
import { PodAxisToggle } from "@/components/layout/SyncControls";
import { displayPod } from "./shared-helpers";
import { useCurrentPodAxis } from "@/lib/podAxisClient";
export type { DateRange } from "./DateRangeFilter";

const STATUS_OPTIONS = ["All", "Active", "Soon to be active", "Inactive/Completed"] as const;

/** Collapse pod variants ("1", "pod 1", "Pod 1") into canonical "Pod N". */
function normalizePod(raw: string | null | undefined): string {
  if (raw == null) return "";
  const t = String(raw).trim();
  if (!t || t === "-" || t === "—") return "";
  const n = t.match(/^(\d+)$/);
  if (n) return `Pod ${n[1]}`;
  const p = t.match(/^p(?:od)?\s*(\d+)$/i);
  if (p) return `Pod ${p[1]}`;
  return t;
}

interface FilterBarProps {
  clients: Client[];
  /** Optional per-client *data* range (first → last month with any row in
   *  deliverables_monthly). When provided, the auto-fit uses these bounds
   *  instead of the contract `start_date`/`end_date` so the resulting date
   *  filter covers every month we actually have data for — including
   *  post-contract reconciliations and historical pre-current-contract
   *  engagements. Falls back to contract dates per-client when missing. */
  dataRanges?: Map<number, { start: Date; end: Date }>;
  onFilterChange: (filtered: Client[]) => void;
  onDateRangeChange?: (range: DateRange) => void;
}

export function FilterBar({
  clients,
  dataRanges,
  onFilterChange,
  onDateRangeChange,
}: FilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Flip the pod-axis toggle whenever the user filters by a specific
  // Editorial / Growth pod, so the chart groupings stay consistent with
  // what's actually being filtered. No-ops for pod-locked users (their
  // setter from `useCurrentPodAxis` is a no-op when `canToggle` is false).
  const { setAxis: setPodAxis } = useCurrentPodAxis();

  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [editorialPod, setEditorialPod] = useState(
    searchParams.get("editorial_pod") ?? "All"
  );
  const [growthPod, setGrowthPod] = useState(
    searchParams.get("growth_pod") ?? "All"
  );
  // Default to Active so a fresh page load shows only the book that's
  // currently being managed. COMPLETED / CANCELLED / INACTIVE clients are
  // still one click away via the dropdown.
  const [status, setStatus] = useState(
    searchParams.get("status") ?? "Active"
  );
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    // End-of-month for (current + 6): start-of-month for (current + 7) minus 1 day
    const to = new Date(now.getFullYear(), now.getMonth() + 7, 0);
    return { type: "range", from, to };
  });

  // Derive pods from actual data — normalize so "1" and "Pod 1" collapse into one option
  const sortPodOptions = (a: string, b: string) => {
    const na = parseInt(a.replace(/\D/g, ""), 10);
    const nb = parseInt(b.replace(/\D/g, ""), 10);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
    return a.localeCompare(b);
  };
  const editorialPods = useMemo(() => {
    const pods = new Set<string>();
    clients.forEach((c) => {
      const v = normalizePod(c.editorial_pod);
      if (v) pods.add(v);
    });
    return ["All", ...Array.from(pods).sort(sortPodOptions)];
  }, [clients]);

  const growthPods = useMemo(() => {
    const pods = new Set<string>();
    clients.forEach((c) => {
      const v = normalizePod(c.growth_pod);
      if (v) pods.add(v);
    });
    return ["All", ...Array.from(pods).sort(sortPodOptions)];
  }, [clients]);

  // Years where ANY client in scope actually has contract activity. The
  // date picker uses these bounds so users can't navigate to empty years
  // (e.g. 2028 / 2029 when nothing ships past 2027). Always includes the
  // current calendar year so today is reachable even when the dataset is
  // sparse, and pads ±1 around the contract envelope to make in-progress
  // contracts plus their immediate projections selectable.
  const availableYears = useMemo<number[]>(() => {
    let minYear = Infinity;
    let maxYear = -Infinity;
    for (const c of clients) {
      const start = c.start_date ? new Date(c.start_date) : null;
      const end = c.end_date ? new Date(c.end_date) : null;
      if (start && !Number.isNaN(start.getTime())) {
        minYear = Math.min(minYear, start.getFullYear());
      }
      if (end && !Number.isNaN(end.getTime())) {
        maxYear = Math.max(maxYear, end.getFullYear());
      }
    }
    const today = new Date().getFullYear();
    if (!Number.isFinite(minYear)) minYear = today;
    if (!Number.isFinite(maxYear)) maxYear = today;
    // Pad: include this calendar year and one year of buffer beyond the
    // last contract end so end-of-engagement projections render.
    minYear = Math.min(minYear, today);
    maxYear = Math.max(maxYear, today);
    const out: number[] = [];
    for (let y = minYear; y <= maxYear; y++) out.push(y);
    return out;
  }, [clients]);

  const updateParams = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === "All" || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  // Auto-fit the date range chip to span the contracts of the clients matching
  // the *non-date* filter criteria (so picking a pod resets the date to that
  // pod's actual data window). Each pod / status / client-pick triggers this;
  // user-set date ranges still survive until the next non-date change.
  const autoFitDateRange = useCallback(
    (criteria: {
      search?: string;
      editorialPod?: string;
      growthPod?: string;
      status?: string;
    }) => {
      const s = criteria.search ?? search;
      const ep = criteria.editorialPod ?? editorialPod;
      const gp = criteria.growthPod ?? growthPod;
      const st = criteria.status ?? status;

      let pool = clients;
      if (s) {
        const q = s.toLowerCase();
        pool = pool.filter((c) => c.name.toLowerCase().includes(q));
      }
      if (ep !== "All") {
        pool = pool.filter((c) => normalizePod(c.editorial_pod) === ep);
      }
      if (gp !== "All") {
        pool = pool.filter((c) => normalizePod(c.growth_pod) === gp);
      }
      if (st === "Active") {
        pool = pool.filter((c) => c.status === "ACTIVE");
      } else if (st === "Soon to be active") {
        pool = pool.filter((c) => c.status === "SOON_TO_BE_ACTIVE");
      } else if (st === "Inactive/Completed") {
        pool = pool.filter(
          (c) =>
            c.status === "COMPLETED" ||
            c.status === "CANCELLED" ||
            c.status === "INACTIVE",
        );
      }

      // No clients left under those filters → fall back to "All Time" so the
      // user isn't stuck with a meaningless empty range.
      if (pool.length === 0) {
        setDateRange({ type: "all" });
        return;
      }

      let minStart: Date | null = null;
      let maxEnd: Date | null = null;
      for (const c of pool) {
        // Prefer the actual deliverables_monthly span when available — that
        // covers historical pre-contract engagements and post-contract
        // reconciliations that the SOW contract dates miss. Falls back to
        // contract dates when a client has no rows yet.
        const range = dataRanges?.get(c.id);
        const ds = range?.start ?? parseISODateLocal(c.start_date);
        const de = range?.end ?? parseISODateLocal(c.end_date);
        if (ds && (!minStart || ds < minStart)) minStart = ds;
        if (de && (!maxEnd || de > maxEnd)) maxEnd = de;
      }
      if (minStart && maxEnd) {
        setDateRange({ type: "range", from: minStart, to: maxEnd });
      } else {
        setDateRange({ type: "all" });
      }
    },
    [clients, dataRanges, search, editorialPod, growthPod, status],
  );

  useEffect(() => {
    let filtered = clients;

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((c) => c.name.toLowerCase().includes(q));
    }

    if (editorialPod !== "All") {
      filtered = filtered.filter((c) => normalizePod(c.editorial_pod) === editorialPod);
    }

    if (growthPod !== "All") {
      filtered = filtered.filter((c) => normalizePod(c.growth_pod) === growthPod);
    }

    if (status === "Active") {
      filtered = filtered.filter((c) => c.status === "ACTIVE");
    } else if (status === "Soon to be active") {
      filtered = filtered.filter((c) => c.status === "SOON_TO_BE_ACTIVE");
    } else if (status === "Inactive/Completed") {
      filtered = filtered.filter(
        (c) =>
          c.status === "COMPLETED" ||
          c.status === "CANCELLED" ||
          c.status === "INACTIVE"
      );
    }

    // Date range filter — engagement period overlap
    if (dateRange.type === "range" && dateRange.from) {
      const rangeStart = dateRange.from;
      const rangeEnd = dateRange.to ?? dateRange.from;

      filtered = filtered.filter((c) => {
        const clientStart = parseISODateLocal(c.start_date);
        const clientEnd = parseISODateLocal(c.end_date);
        if (!clientStart) return true;
        if (clientStart > rangeEnd) return false;
        if (clientEnd && clientEnd < rangeStart) return false;
        return true;
      });
    }

    onFilterChange(filtered);
  }, [clients, search, editorialPod, growthPod, status, dateRange, onFilterChange]);

  useEffect(() => {
    onDateRangeChange?.(dateRange);
  }, [dateRange, onDateRangeChange]);

  // Combobox state
  const [showDropdown, setShowDropdown] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);

  const filteredClientNames = useMemo(() => {
    // Scope the dropdown to clients matching the active pod + status
    // filters. Without this the search showed every client even after
    // a pod was selected, which forced the user to remember the pod
    // membership in their head.
    let pool = clients;
    if (editorialPod !== "All") {
      pool = pool.filter((c) => normalizePod(c.editorial_pod) === editorialPod);
    }
    if (growthPod !== "All") {
      pool = pool.filter((c) => normalizePod(c.growth_pod) === growthPod);
    }
    if (status === "Active") {
      pool = pool.filter((c) => c.status === "ACTIVE");
    } else if (status === "Soon to be active") {
      pool = pool.filter((c) => c.status === "SOON_TO_BE_ACTIVE");
    } else if (status === "Inactive/Completed") {
      pool = pool.filter(
        (c) =>
          c.status === "COMPLETED" ||
          c.status === "CANCELLED" ||
          c.status === "INACTIVE",
      );
    }
    const names = Array.from(new Set(pool.map((c) => c.name))).sort();
    if (!search) return names;
    const q = search.toLowerCase();
    return names.filter((n) => n.toLowerCase().includes(q));
  }, [clients, search, editorialPod, growthPod, status]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Count active filters
  const activeFilters = [
    search ? 1 : 0,
    editorialPod !== "All" ? 1 : 0,
    growthPod !== "All" ? 1 : 0,
    status !== "All" ? 1 : 0,
    dateRange.type !== "all" ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-[#1e1e1e] bg-[#0d0d0d] px-2 py-1.5">
      {/* Search */}
      <div className="relative" ref={comboRef}>
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#606060] z-10" />
        <Input
          placeholder="Search clients..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            updateParams("search", e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          className="h-7 w-[160px] pl-8 pr-7 text-xs bg-transparent border-[#1e1e1e] focus:border-[#42CA80]/50 rounded-md"
        />
        {search && (
          <button
            type="button"
            onClick={() => { setSearch(""); updateParams("search", ""); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[#606060] hover:text-white z-10"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        {showDropdown && filteredClientNames.length > 0 && (
          <div className="absolute top-full left-0 z-50 mt-1 w-[200px] max-h-[260px] overflow-y-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] shadow-xl">
            {filteredClientNames.map((name) => (
              <button
                key={name}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setSearch(name);
                  updateParams("search", name);
                  setShowDropdown(false);
                  autoFitDateRange({ search: name });
                }}
                className={cn(
                  "block w-full px-3 py-1.5 text-left text-xs transition-colors",
                  search === name
                    ? "bg-[#42CA80]/15 text-[#42CA80]"
                    : "text-[#C4BCAA] hover:bg-[#1F1F1F] hover:text-white"
                )}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Separator */}
      <div className="h-4 w-px bg-[#1e1e1e]" />

      {/* Pod — Editorial and Growth Pod filters are mutually exclusive.
          Picking one clears the other so the result set isn't an empty
          intersection (clients almost never sit in both axes by design). */}
      <Select
        value={editorialPod}
        onValueChange={(val) => {
          const v = val ?? "All";
          setEditorialPod(v);
          updateParams("editorial_pod", v);
          if (v !== "All" && growthPod !== "All") {
            setGrowthPod("All");
            updateParams("growth_pod", "All");
          }
          // Lock the toggle to Editorial whenever an Editorial Pod is
          // picked — viewing Editorial-pod-filtered clients through the
          // Growth axis would group them under the wrong pod buckets.
          if (v !== "All") setPodAxis("editorial");
          autoFitDateRange({
            editorialPod: v,
            growthPod: v !== "All" ? "All" : undefined,
          });
        }}
      >
        <SelectTrigger className="h-7 w-auto min-w-[110px] text-xs border-0 bg-transparent gap-1 px-2">
          <span className="text-[10px] font-mono text-[#606060] uppercase tracking-wider mr-0.5">Editorial Pod</span>
          {editorialPod !== "All" ? (
            <span className="inline-flex items-center rounded-full bg-[#42CA80]/15 px-2 py-0.5 text-[11px] font-mono font-semibold text-[#42CA80] border border-[#42CA80]/30">
              {displayPod(editorialPod, "editorial")}
            </span>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          {editorialPods.map((pod) => (
            <SelectItem key={pod} value={pod}>{displayPod(pod, "editorial")}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Growth Pod — see note above the Editorial Pod select; the two
          are mutually exclusive. */}
      <Select
        value={growthPod}
        onValueChange={(val) => {
          const v = val ?? "All";
          setGrowthPod(v);
          updateParams("growth_pod", v);
          if (v !== "All" && editorialPod !== "All") {
            setEditorialPod("All");
            updateParams("editorial_pod", "All");
          }
          // Mirror of the Editorial branch above — picking a Growth Pod
          // forces the axis to Growth so chart groupings line up.
          if (v !== "All") setPodAxis("growth");
          autoFitDateRange({
            growthPod: v,
            editorialPod: v !== "All" ? "All" : undefined,
          });
        }}
      >
        <SelectTrigger className="h-7 w-auto min-w-[100px] text-xs border-0 bg-transparent gap-1 px-2">
          <span className="text-[10px] font-mono text-[#606060] uppercase tracking-wider mr-0.5">Growth Pod</span>
          {growthPod !== "All" ? (
            <span className="inline-flex items-center rounded-full bg-[#42CA80]/15 px-2 py-0.5 text-[11px] font-mono font-semibold text-[#42CA80] border border-[#42CA80]/30">
              {displayPod(growthPod, "growth")}
            </span>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          {growthPods.map((pod) => (
            <SelectItem key={pod} value={pod}>{displayPod(pod, "growth")}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Pod-axis toggle (Editorial / Growth) — sits between Growth Pod
          and Status so it reads as a grouping control next to the pod
          filters. Auto-hides for users without canToggle or off pod-axis
          routes (see PodAxisToggle in SyncControls). */}
      <PodAxisToggle label="Pod Axis" />

      {/* Separator */}
      <div className="h-4 w-px bg-[#1e1e1e]" />

      {/* Status */}
      <Select
        value={status}
        onValueChange={(val) => {
          const v = val ?? "All";
          setStatus(v);
          updateParams("status", v);
          autoFitDateRange({ status: v });
        }}
      >
        <SelectTrigger className="h-7 w-auto min-w-[80px] text-xs border-0 bg-transparent gap-1 px-2">
          <span className="text-[10px] font-mono text-[#606060] uppercase tracking-wider mr-0.5">Status</span>
          {status !== "All" ? (
            <span className="inline-flex items-center rounded-full bg-[#42CA80]/15 px-2 py-0.5 text-[11px] font-mono font-semibold text-[#42CA80] border border-[#42CA80]/30">
              {status}
            </span>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Separator */}
      <div className="h-4 w-px bg-[#1e1e1e]" />

      {/* Date */}
      <DateRangeFilter
        value={dateRange}
        onChange={setDateRange}
        availableYears={availableYears}
      />

      {/* Active filter count */}
      {activeFilters > 0 && (
        <>
          <div className="h-4 w-px bg-[#1e1e1e]" />
          <button
            type="button"
            onClick={() => {
              setSearch(""); updateParams("search", "");
              setEditorialPod("All"); updateParams("editorial_pod", "All");
              setGrowthPod("All"); updateParams("growth_pod", "All");
              setStatus("All"); updateParams("status", "All");
              setDateRange({ type: "all" });
            }}
            className="flex items-center gap-1 text-[11px] font-mono text-[#606060] hover:text-[#ED6958] transition-colors px-1"
          >
            <X className="h-3 w-3" />
            <span>{activeFilters}</span>
          </button>
        </>
      )}
    </div>
  );
}
