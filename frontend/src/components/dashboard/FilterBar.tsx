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
import { cn } from "@/lib/utils";
import type { Client } from "@/lib/types";
import { Search, X } from "lucide-react";
import { DateRangeFilter, type DateRange } from "./DateRangeFilter";

const STATUS_OPTIONS = ["All", "Active", "Inactive/Completed"] as const;

interface FilterBarProps {
  clients: Client[];
  onFilterChange: (filtered: Client[]) => void;
}

export function FilterBar({ clients, onFilterChange }: FilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [editorialPod, setEditorialPod] = useState(
    searchParams.get("editorial_pod") ?? "All"
  );
  const [growthPod, setGrowthPod] = useState(
    searchParams.get("growth_pod") ?? "All"
  );
  const [status, setStatus] = useState(
    searchParams.get("status") ?? "All"
  );
  const [dateRange, setDateRange] = useState<DateRange>({ type: "all" });

  // Derive pods from actual data
  const editorialPods = useMemo(() => {
    const pods = new Set<string>();
    clients.forEach((c) => { if (c.editorial_pod) pods.add(c.editorial_pod); });
    return ["All", ...Array.from(pods).sort()];
  }, [clients]);

  const growthPods = useMemo(() => {
    const pods = new Set<string>();
    clients.forEach((c) => { if (c.growth_pod) pods.add(c.growth_pod); });
    return ["All", ...Array.from(pods).sort()];
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

  useEffect(() => {
    let filtered = clients;

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((c) => c.name.toLowerCase().includes(q));
    }

    if (editorialPod !== "All") {
      filtered = filtered.filter((c) => c.editorial_pod === editorialPod);
    }

    if (growthPod !== "All") {
      filtered = filtered.filter((c) => c.growth_pod === growthPod);
    }

    if (status === "Active") {
      filtered = filtered.filter((c) => c.status === "ACTIVE");
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
        const clientStart = c.start_date ? new Date(c.start_date) : null;
        const clientEnd = c.end_date ? new Date(c.end_date) : null;
        if (!clientStart) return true;
        if (clientStart > rangeEnd) return false;
        if (clientEnd && clientEnd < rangeStart) return false;
        return true;
      });
    }

    onFilterChange(filtered);
  }, [clients, search, editorialPod, growthPod, status, dateRange, onFilterChange]);

  // Combobox state
  const [showDropdown, setShowDropdown] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);

  const filteredClientNames = useMemo(() => {
    const names = Array.from(new Set(clients.map((c) => c.name))).sort();
    if (!search) return names;
    const q = search.toLowerCase();
    return names.filter((n) => n.toLowerCase().includes(q));
  }, [clients, search]);

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

      {/* Pod */}
      <Select
        value={editorialPod}
        onValueChange={(val) => {
          const v = val ?? "All";
          setEditorialPod(v);
          updateParams("editorial_pod", v);
        }}
      >
        <SelectTrigger className="h-7 w-auto min-w-[80px] text-xs border-0 bg-transparent gap-1 px-2">
          <span className="text-[9px] font-mono text-[#606060] uppercase tracking-wider mr-0.5">Pod</span>
          {editorialPod !== "All" ? (
            <span className="inline-flex items-center rounded-full bg-[#42CA80]/15 px-2 py-0.5 text-[10px] font-mono font-semibold text-[#42CA80] border border-[#42CA80]/30">
              {editorialPod}
            </span>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          {editorialPods.map((pod) => (
            <SelectItem key={pod} value={pod}>{pod}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Growth Pod */}
      <Select
        value={growthPod}
        onValueChange={(val) => {
          const v = val ?? "All";
          setGrowthPod(v);
          updateParams("growth_pod", v);
        }}
      >
        <SelectTrigger className="h-7 w-auto min-w-[80px] text-xs border-0 bg-transparent gap-1 px-2">
          <span className="text-[9px] font-mono text-[#606060] uppercase tracking-wider mr-0.5">Growth</span>
          {growthPod !== "All" ? (
            <span className="inline-flex items-center rounded-full bg-[#42CA80]/15 px-2 py-0.5 text-[10px] font-mono font-semibold text-[#42CA80] border border-[#42CA80]/30">
              {growthPod}
            </span>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          {growthPods.map((pod) => (
            <SelectItem key={pod} value={pod}>{pod}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Separator */}
      <div className="h-4 w-px bg-[#1e1e1e]" />

      {/* Status */}
      <Select
        value={status}
        onValueChange={(val) => {
          const v = val ?? "All";
          setStatus(v);
          updateParams("status", v);
        }}
      >
        <SelectTrigger className="h-7 w-auto min-w-[80px] text-xs border-0 bg-transparent gap-1 px-2">
          <span className="text-[9px] font-mono text-[#606060] uppercase tracking-wider mr-0.5">Status</span>
          {status !== "All" ? (
            <span className="inline-flex items-center rounded-full bg-[#42CA80]/15 px-2 py-0.5 text-[10px] font-mono font-semibold text-[#42CA80] border border-[#42CA80]/30">
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
      <DateRangeFilter value={dateRange} onChange={setDateRange} />

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
            className="flex items-center gap-1 text-[10px] font-mono text-[#606060] hover:text-[#ED6958] transition-colors px-1"
          >
            <X className="h-3 w-3" />
            <span>{activeFilters}</span>
          </button>
        </>
      )}
    </div>
  );
}
