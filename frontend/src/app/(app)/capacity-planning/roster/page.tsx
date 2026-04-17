"use client";

import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { StickyPageChrome } from "../_StickyPageChrome";
import { ValidationBanner } from "../_ValidationBanner";
import { ClosedMonthBanner, CopyMonthMenu } from "../_MonthActions";
import {
  MONTHS,
  MONTH_LABELS,
  type MonthKey,
  type RosterCell,
  type RosterRow,
  type MemberRow,
  type Role,
} from "../_mock";
import { useCP2Store } from "../_store";

const POD_COLORS: Record<number, string> = {
  1: "border-[#65FFAA]/40 bg-[#65FFAA]/10 text-[#65FFAA]",
  2: "border-[#9D8DF1]/40 bg-[#9D8DF1]/10 text-[#9D8DF1]",
  3: "border-[#E6B450]/40 bg-[#E6B450]/10 text-[#E6B450]",
  4: "border-[#5BA8FF]/40 bg-[#5BA8FF]/10 text-[#5BA8FF]",
  5: "border-[#FF7AB6]/40 bg-[#FF7AB6]/10 text-[#FF7AB6]",
};

function podColor(podNumber: number): string {
  return (
    POD_COLORS[podNumber] ?? "border-[#42CA80]/40 bg-[#42CA80]/10 text-[#42CA80]"
  );
}

function CellChip({ cell }: { cell: RosterCell }) {
  const split = cell.capacityShare < 1;
  const onLeave = cell.leaveShare > 0;
  return (
    <div
      className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium ${podColor(cell.podNumber)}`}
      title={`Pod ${cell.podNumber} · ${cell.role} · share ${cell.capacityShare.toFixed(2)}${onLeave ? ` · leave ${Math.round(cell.leaveShare * 100)}%` : ""}`}
    >
      <span>P{cell.podNumber}</span>
      {split && <span className="text-[9px] opacity-80">·{cell.capacityShare.toFixed(2)}</span>}
      {onLeave && <span className="text-[9px] opacity-80">PTO</span>}
    </div>
  );
}

function buildRosterFromState(
  monthly: Record<MonthKey, { id: number; podNumber: number; members: MemberRow[] }[]>,
): RosterRow[] {
  const byMember = new Map<number, RosterRow>();
  for (const month of MONTHS) {
    for (const pod of monthly[month] ?? []) {
      for (const m of pod.members) {
        let row = byMember.get(m.id);
        if (!row) {
          row = {
            memberId: m.id,
            fullName: m.fullName,
            defaultRole: m.role as Role,
            defaultCapacity: m.defaultCapacity,
            cellsByMonth: {},
          };
          byMember.set(m.id, row);
        }
        const cells = row.cellsByMonth[month] ?? [];
        cells.push({
          podId: pod.id,
          podNumber: pod.podNumber,
          capacityShare: m.capacityShare,
          role: m.role as Role,
          leaveShare: m.leaveShare,
        });
        row.cellsByMonth[month] = cells;
      }
    }
  }
  return Array.from(byMember.values()).sort((a, b) =>
    a.fullName.localeCompare(b.fullName),
  );
}

export default function RosterPage() {
  const { state, resetToSeed, selectedMonth } = useCP2Store();
  const [filter, setFilter] = useState("");
  const roster = useMemo(() => buildRosterFromState(state.monthly), [state.monthly]);
  const filtered = roster.filter((r) =>
    r.fullName.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-6">
      <StickyPageChrome subtitle="Roster editor — drag-and-drop members across pods and months. Splitting a chip captures shared capacity. (Editing ships in Phase 2.)" />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
            Filter
          </span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Member name…"
            className="h-8 w-56 rounded-md border border-[#2a2a2a] bg-[#161616] px-2 font-sans text-xs text-white placeholder:text-[#606060] outline-none focus:border-[#42CA80]/50"
          />
        </div>
        <div className="flex items-center gap-2">
          <CopyMonthMenu />
          <button
            type="button"
            onClick={() => {
              if (confirm("Reset all edits and restore seed data?")) resetToSeed();
            }}
            className="flex items-center gap-1.5 rounded-md border border-[#2a2a2a] bg-[#161616] px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider text-[#C4BCAA] hover:border-[#ED6958]/40 hover:text-[#ED6958]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        </div>
      </div>

      <ClosedMonthBanner />
      <ValidationBanner />

      <div className="overflow-x-auto rounded-lg border border-[#1f1f1f] bg-[#0a0a0a]">
        <table className="w-full min-w-[900px] border-collapse">
          <thead>
            <tr className="border-b border-[#1a1a1a]">
              <th className="sticky left-0 z-10 bg-[#0a0a0a] px-4 py-3 text-left font-mono text-[10px] uppercase tracking-wider text-[#606060]">
                Member
              </th>
              <th className="px-3 py-3 text-left font-mono text-[10px] uppercase tracking-wider text-[#606060]">
                Role
              </th>
              <th className="px-3 py-3 text-right font-mono text-[10px] uppercase tracking-wider text-[#606060]">
                Cap
              </th>
              {MONTHS.map((m) => {
                const isSelected = m === selectedMonth;
                return (
                  <th
                    key={m}
                    className={`px-3 py-3 text-left font-mono text-[10px] uppercase tracking-wider ${
                      isSelected
                        ? "bg-[#42CA80]/10 text-[#65FFAA]"
                        : "text-[#606060]"
                    }`}
                  >
                    {MONTH_LABELS[m]}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.memberId}
                className="border-b border-[#161616] last:border-0 hover:bg-[#111111]"
              >
                <td className="sticky left-0 z-10 bg-[#0a0a0a] px-4 py-2 text-xs font-medium text-white">
                  {row.fullName}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-[#C4BCAA]">
                  {row.defaultRole}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[11px] text-[#C4BCAA]">
                  {row.defaultCapacity}
                </td>
                {MONTHS.map((m) => {
                  const cells = row.cellsByMonth[m as MonthKey] ?? [];
                  const isSelected = m === selectedMonth;
                  return (
                    <td
                      key={m}
                      className={`px-3 py-2 align-middle ${isSelected ? "bg-[#42CA80]/5" : ""}`}
                    >
                      {cells.length === 0 ? (
                        <span
                          className="font-mono text-[10px] text-[#404040]"
                          title="Not assigned to any pod this month"
                        >
                          —
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {cells.map((c, i) => (
                            <CellChip key={`${m}-${i}`} cell={c} />
                          ))}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={3 + MONTHS.length}
                  className="px-4 py-8 text-center text-xs text-[#606060]"
                >
                  No members match {`"${filter}"`}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3 text-[11px] text-[#C4BCAA]">
        <span className="font-semibold text-white">Live view.</span>{" "}
        This grid reflects the edits you make on the Overview page in real time.
        Each chip corresponds to one{" "}
        <code className="rounded bg-[#1a1a1a] px-1 font-mono text-[11px]">
          cp2_fact_pod_membership
        </code>{" "}
        row (member, month, pod, share, role).
      </div>
    </div>
  );
}
