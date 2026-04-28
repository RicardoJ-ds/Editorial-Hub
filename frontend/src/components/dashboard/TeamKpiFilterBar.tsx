"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TeamMember, Client } from "@/lib/types";
import { Search, X } from "lucide-react";
import { DateRangeFilter, type DateRange } from "./DateRangeFilter";
import { displayPod } from "./shared-helpers";
export type { DateRange } from "./DateRangeFilter";

const PODS = ["All", "Pod 1", "Pod 2", "Pod 3", "Pod 4", "Pod 5"];

const POD_COLORS: Record<string, string> = {
  "Pod 1": "bg-[#5B9BF5]/15 text-[#5B9BF5] border-[#5B9BF5]/30",
  "Pod 2": "bg-[#42CA80]/15 text-[#42CA80] border-[#42CA80]/30",
  "Pod 3": "bg-[#F5C542]/15 text-[#F5C542] border-[#F5C542]/30",
  "Pod 4": "bg-[#F28D59]/15 text-[#F28D59] border-[#F28D59]/30",
  "Pod 5": "bg-[#ED6958]/15 text-[#ED6958] border-[#ED6958]/30",
};

export interface TeamKpiFilters {
  pod: string;
  growthPod: string;
  /** Date range — drives the year/month span of `/api/kpis/?year_from=…`. */
  dateRange: DateRange;
  /** "All" or a stringified team_member.id. */
  memberId: string;
  /** "All" or a stringified client.id. */
  clientId: string;
}

interface Props {
  teamMembers: TeamMember[];
  clients: Client[];
  filters: TeamKpiFilters;
  onFiltersChange: (filters: TeamKpiFilters) => void;
}

/**
 * Combobox: text input + dropdown. Mirrors the "search clients" pattern in
 * D1's FilterBar — typing filters the dropdown; clicking an option commits;
 * a typed value that doesn't exactly match any option keeps the typed text
 * as a free-form filter (so partial typing still narrows the heatmap).
 *
 * `value` is whatever's committed (display label of the chosen item, or the
 * typed substring); `selectedKey` is the stable key of the picked option
 * (e.g. team_member.id) — null when the user is still typing.
 */
function FilterCombobox({
  label,
  options,
  selectedKey,
  onSelect,
  placeholder,
  width = 160,
}: {
  label: string;
  options: { key: string; label: string; subLabel?: string; subBadgeClass?: string }[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  placeholder: string;
  width?: number;
}) {
  // Commit-on-pick: the input shows the picked label; otherwise it shows
  // whatever the user is typing. We don't fold typed-only state into the
  // parent because partial-text filtering would force every consumer to
  // re-implement match logic.
  const selectedOption = options.find((o) => o.key === selectedKey) ?? null;
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setDraft("");
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const visible = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, draft]);

  return (
    <div className="relative flex items-center gap-1.5" ref={wrapRef}>
      <span className="text-[10px] font-mono text-[#606060] uppercase tracking-wider">
        {label}
      </span>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#606060] z-10" />
        <Input
          value={open ? draft : selectedOption?.label ?? ""}
          placeholder={selectedOption ? selectedOption.label : placeholder}
          onFocus={() => {
            setDraft("");
            setOpen(true);
          }}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
          }}
          className="h-7 pl-7 pr-7 text-xs bg-transparent border-[#1e1e1e] focus:border-[#42CA80]/50 rounded-md"
          style={{ width }}
        />
        {selectedOption && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(null);
              setDraft("");
              setOpen(false);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[#606060] hover:text-white z-10"
            aria-label="Clear"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        {open && visible.length > 0 && (
          <div className="absolute top-full left-0 z-50 mt-1 max-h-[260px] w-full overflow-y-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] shadow-xl">
            {visible.map((o) => (
              <button
                key={o.key}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(o.key);
                  setDraft("");
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                  selectedKey === o.key
                    ? "bg-[#42CA80]/15 text-[#42CA80]"
                    : "text-[#C4BCAA] hover:bg-[#1F1F1F] hover:text-white",
                )}
              >
                <span className="truncate">{o.label}</span>
                {o.subLabel && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "scale-75 text-[9px] shrink-0",
                      o.subBadgeClass ?? "",
                    )}
                  >
                    {o.subLabel}
                  </Badge>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function TeamKpiFilterBar({
  teamMembers,
  clients,
  filters,
  onFiltersChange,
}: Props) {
  const update = (partial: Partial<TeamKpiFilters>) => {
    onFiltersChange({ ...filters, ...partial });
  };

  // Derive growth pods from the active client list.
  const growthPods = useMemo(() => {
    const set = new Set<string>();
    for (const c of clients) {
      if (c.growth_pod) set.add(c.growth_pod);
    }
    return ["All", ...Array.from(set).sort()];
  }, [clients]);

  // Clients narrowed by the Growth filter — feeds the Client combobox.
  const filteredClients = useMemo(() => {
    if (filters.growthPod === "All") return clients;
    return clients.filter((c) => c.growth_pod === filters.growthPod);
  }, [clients, filters.growthPod]);

  const memberOptions = useMemo(
    () =>
      teamMembers.map((m) => ({
        key: String(m.id),
        label: m.name,
        subLabel: m.pod ?? undefined,
        subBadgeClass: m.pod ? POD_COLORS[m.pod] : undefined,
      })),
    [teamMembers],
  );

  const clientOptions = useMemo(
    () =>
      filteredClients.map((c) => ({
        key: String(c.id),
        label: c.name,
      })),
    [filteredClients],
  );

  const activeCount = [
    filters.pod !== "All" ? 1 : 0,
    filters.growthPod !== "All" ? 1 : 0,
    filters.memberId !== "All" ? 1 : 0,
    filters.clientId !== "All" ? 1 : 0,
    filters.dateRange.type !== "all" ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#1e1e1e] bg-[#0d0d0d] px-2 py-1.5">
      {/* Member — single combobox replaces the old "Search members…" input
          + Member dropdown duplication. Type to filter, click to pick. */}
      <FilterCombobox
        label="Member"
        options={memberOptions}
        selectedKey={filters.memberId === "All" ? null : filters.memberId}
        onSelect={(k) => update({ memberId: k ?? "All" })}
        placeholder="All members"
        width={170}
      />

      <div className="h-4 w-px bg-[#1e1e1e]" />

      {/* Editorial Pod */}
      <Select
        value={filters.pod}
        onValueChange={(v) => v && update({ pod: v })}
      >
        <SelectTrigger className="h-7 w-auto min-w-[110px] text-xs border-0 bg-transparent gap-1 px-2">
          <span className="text-[10px] font-mono text-[#606060] uppercase tracking-wider mr-0.5">
            Editorial Pod
          </span>
          {filters.pod !== "All" ? (
            <span className="inline-flex items-center rounded-full bg-[#42CA80]/15 px-2 py-0.5 text-[11px] font-mono font-semibold text-[#42CA80] border border-[#42CA80]/30">
              {displayPod(filters.pod, "editorial")}
            </span>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          {PODS.map((p) => (
            <SelectItem key={p} value={p}>
              {displayPod(p, "editorial")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Growth Pod — narrows the Client combobox */}
      <Select
        value={filters.growthPod}
        onValueChange={(v) =>
          v && update({ growthPod: v, clientId: "All" })
        }
      >
        <SelectTrigger className="h-7 w-auto min-w-[100px] text-xs border-0 bg-transparent gap-1 px-2">
          <span className="text-[10px] font-mono text-[#606060] uppercase tracking-wider mr-0.5">
            Growth Pod
          </span>
          {filters.growthPod !== "All" ? (
            <span className="inline-flex items-center rounded-full bg-[#42CA80]/15 px-2 py-0.5 text-[11px] font-mono font-semibold text-[#42CA80] border border-[#42CA80]/30">
              {displayPod(filters.growthPod, "growth")}
            </span>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          {growthPods.map((p) => (
            <SelectItem key={p} value={p}>
              {displayPod(p, "growth")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="h-4 w-px bg-[#1e1e1e]" />

      {/* Client — combobox style matches D1 client picker */}
      <FilterCombobox
        label="Client"
        options={clientOptions}
        selectedKey={filters.clientId === "All" ? null : filters.clientId}
        onSelect={(k) => update({ clientId: k ?? "All" })}
        placeholder="All clients"
        width={160}
      />

      <div className="h-4 w-px bg-[#1e1e1e]" />

      {/* Date range — same calendar + month-slider as D1 */}
      <DateRangeFilter
        value={filters.dateRange}
        onChange={(range) => update({ dateRange: range })}
      />

      {activeCount > 0 && (
        <>
          <div className="h-4 w-px bg-[#1e1e1e]" />
          <button
            type="button"
            onClick={() =>
              onFiltersChange({
                pod: "All",
                growthPod: "All",
                memberId: "All",
                clientId: "All",
                dateRange: { type: "all" },
              })
            }
            className="flex items-center gap-1 text-[10px] font-mono text-[#606060] hover:text-[#ED6958] transition-colors px-1"
          >
            <X className="h-3 w-3" />
            <span>{activeCount}</span>
          </button>
        </>
      )}
    </div>
  );
}
