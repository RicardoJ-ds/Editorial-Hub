"use client";

import { useMemo, useState } from "react";
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

const PODS = ["All", "Pod 1", "Pod 2", "Pod 3", "Pod 4", "Pod 5"];
const MONTHS = [
  { value: "1", label: "January" }, { value: "2", label: "February" },
  { value: "3", label: "March" }, { value: "4", label: "April" },
  { value: "5", label: "May" }, { value: "6", label: "June" },
  { value: "7", label: "July" }, { value: "8", label: "August" },
  { value: "9", label: "September" }, { value: "10", label: "October" },
  { value: "11", label: "November" }, { value: "12", label: "December" },
];

const POD_COLORS: Record<string, string> = {
  "Pod 1": "bg-[#5B9BF5]/15 text-[#5B9BF5] border-[#5B9BF5]/30",
  "Pod 2": "bg-[#42CA80]/15 text-[#42CA80] border-[#42CA80]/30",
  "Pod 3": "bg-[#F5C542]/15 text-[#F5C542] border-[#F5C542]/30",
  "Pod 4": "bg-[#F28D59]/15 text-[#F28D59] border-[#F28D59]/30",
  "Pod 5": "bg-[#ED6958]/15 text-[#ED6958] border-[#ED6958]/30",
};

export interface TeamKpiFilters {
  search: string;
  pod: string;
  growthPod: string;
  month: number;
  year: number;
  memberId: string;
  clientId: string;
}

interface Props {
  teamMembers: TeamMember[];
  clients: Client[];
  yearOptions: number[];
  filters: TeamKpiFilters;
  onFiltersChange: (filters: TeamKpiFilters) => void;
}

export function TeamKpiFilterBar({ teamMembers, clients, yearOptions, filters, onFiltersChange }: Props) {
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

  // Clients narrowed by the Growth filter — feeds the Client dropdown.
  const filteredClients = useMemo(() => {
    if (filters.growthPod === "All") return clients;
    return clients.filter((c) => c.growth_pod === filters.growthPod);
  }, [clients, filters.growthPod]);

  const activeCount = [
    filters.search ? 1 : 0,
    filters.pod !== "All" ? 1 : 0,
    filters.growthPod !== "All" ? 1 : 0,
    filters.memberId !== "All" ? 1 : 0,
    filters.clientId !== "All" ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-[#1e1e1e] bg-[#0d0d0d] px-2 py-1.5">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#606060] z-10" />
        <Input
          placeholder="Search members..."
          value={filters.search}
          onChange={(e) => update({ search: e.target.value })}
          className="h-7 w-[150px] pl-8 pr-7 text-xs bg-transparent border-[#1e1e1e] focus:border-[#42CA80]/50 rounded-md"
        />
        {filters.search && (
          <button
            type="button"
            onClick={() => update({ search: "" })}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[#606060] hover:text-white z-10"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="h-4 w-px bg-[#1e1e1e]" />

      {/* Editorial Pod */}
      <Select value={filters.pod} onValueChange={(v) => v && update({ pod: v })}>
        <SelectTrigger className="h-7 w-auto min-w-[80px] text-xs border-0 bg-transparent gap-1 px-2">
          <span className="text-[9px] font-mono text-[#606060] uppercase tracking-wider mr-0.5">Pod</span>
          {filters.pod !== "All" ? (
            <span className="inline-flex items-center rounded-full bg-[#42CA80]/15 px-2 py-0.5 text-[10px] font-mono font-semibold text-[#42CA80] border border-[#42CA80]/30">
              {filters.pod}
            </span>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          {PODS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
        </SelectContent>
      </Select>

      {/* Growth Pod — narrows the Client dropdown */}
      <Select value={filters.growthPod} onValueChange={(v) => v && update({ growthPod: v, clientId: "All" })}>
        <SelectTrigger className="h-7 w-auto min-w-[90px] text-xs border-0 bg-transparent gap-1 px-2">
          <span className="text-[9px] font-mono text-[#606060] uppercase tracking-wider mr-0.5">Growth</span>
          {filters.growthPod !== "All" ? (
            <span className="inline-flex items-center rounded-full bg-[#42CA80]/15 px-2 py-0.5 text-[10px] font-mono font-semibold text-[#42CA80] border border-[#42CA80]/30">
              {filters.growthPod}
            </span>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          {growthPods.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
        </SelectContent>
      </Select>

      <div className="h-4 w-px bg-[#1e1e1e]" />

      {/* Month */}
      <Select value={String(filters.month)} onValueChange={(v) => v && update({ month: Number(v) })}>
        <SelectTrigger className="h-7 w-auto min-w-[80px] text-xs border-0 bg-transparent gap-1 px-2">
          <span className="text-[9px] font-mono text-[#606060] uppercase tracking-wider mr-0.5">Month</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MONTHS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
        </SelectContent>
      </Select>

      {/* Year */}
      <Select value={String(filters.year)} onValueChange={(v) => v && update({ year: Number(v) })}>
        <SelectTrigger className="h-7 w-auto min-w-[60px] text-xs border-0 bg-transparent gap-1 px-2">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
        </SelectContent>
      </Select>

      <div className="h-4 w-px bg-[#1e1e1e]" />

      {/* Member */}
      <Select value={filters.memberId} onValueChange={(v) => v && update({ memberId: v })}>
        <SelectTrigger className="h-7 w-auto min-w-[100px] text-xs border-0 bg-transparent gap-1 px-2">
          <span className="text-[9px] font-mono text-[#606060] uppercase tracking-wider mr-0.5">Member</span>
          {filters.memberId !== "All" ? (
            <span className="inline-flex items-center rounded-full bg-[#42CA80]/15 px-2 py-0.5 text-[10px] font-mono font-semibold text-[#42CA80] border border-[#42CA80]/30 max-w-[120px] truncate">
              {teamMembers.find((m) => String(m.id) === filters.memberId)?.name ?? filters.memberId}
            </span>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="All">All</SelectItem>
          {teamMembers.map((m) => (
            <SelectItem key={m.id} value={String(m.id)}>
              <span className="flex items-center gap-1.5">
                {m.name}
                {m.pod && (
                  <Badge variant="outline" className={cn("scale-75 text-[9px]", POD_COLORS[m.pod])}>
                    {m.pod}
                  </Badge>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="h-4 w-px bg-[#1e1e1e]" />

      {/* Client */}
      <Select value={filters.clientId} onValueChange={(v) => v && update({ clientId: v })}>
        <SelectTrigger className="h-7 w-auto min-w-[100px] text-xs border-0 bg-transparent gap-1 px-2">
          <span className="text-[9px] font-mono text-[#606060] uppercase tracking-wider mr-0.5">Client</span>
          {filters.clientId !== "All" ? (
            <span className="inline-flex items-center rounded-full bg-[#42CA80]/15 px-2 py-0.5 text-[10px] font-mono font-semibold text-[#42CA80] border border-[#42CA80]/30 max-w-[120px] truncate">
              {clients.find((c) => String(c.id) === filters.clientId)?.name ?? filters.clientId}
            </span>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="All">All</SelectItem>
          {filteredClients.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
        </SelectContent>
      </Select>

      {/* Active filter count + clear */}
      {activeCount > 0 && (
        <>
          <div className="h-4 w-px bg-[#1e1e1e]" />
          <button
            type="button"
            onClick={() => update({ search: "", pod: "All", growthPod: "All", memberId: "All", clientId: "All" })}
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
