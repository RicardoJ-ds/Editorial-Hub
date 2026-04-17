"use client";

import { useMemo, useState } from "react";
import { Plane, Trash2, X } from "lucide-react";
import { StickyPageChrome } from "../_StickyPageChrome";
import { useAllMembers, useCP2Store, monthLabel, type LeaveReason } from "../_store";

const LEAVE_REASONS: LeaveReason[] = ["PTO", "Parental", "Sick", "Other"];

function shareLabel(share: number): string {
  if (share <= 0) return "—";
  return `${Math.round(share * 100)}%`;
}

function shareTone(share: number): string {
  if (share <= 0) return "text-[#404040]";
  if (share < 0.25) return "text-[#C4BCAA]";
  if (share < 0.5) return "text-[#F5C542]";
  return "text-[#ED6958]";
}

export default function LeavePage() {
  const { leaves, setLeave, removeLeave, monthOptions, selectedMonth, isMonthClosed } = useCP2Store();
  const allMembers = useAllMembers();
  const [filter, setFilter] = useState("");
  const [activeCell, setActiveCell] = useState<{
    memberId: number;
    monthKey: string;
  } | null>(null);

  // Show 7 months centered on the selected one (less scrolling than ±6 from today).
  const displayMonths = useMemo(() => {
    const center = monthOptions.indexOf(selectedMonth);
    if (center === -1) return monthOptions.slice(0, 7);
    const start = Math.max(0, center - 3);
    return monthOptions.slice(start, start + 7);
  }, [monthOptions, selectedMonth]);

  const filteredMembers = useMemo(
    () =>
      allMembers.filter((m) =>
        m.fullName.toLowerCase().includes(filter.toLowerCase()),
      ),
    [allMembers, filter],
  );

  function leaveFor(memberId: number, monthKey: string) {
    return (leaves[monthKey] ?? []).find((l) => l.teamMemberId === memberId);
  }

  return (
    <div className="flex flex-col gap-6">
      <StickyPageChrome subtitle="Team PTO grid. Click a cell to record leave for a member in a month — share (0–100%) plus reason. Edits for closed months are blocked." />

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
        <span className="font-mono text-[10px] text-[#606060]">
          {filteredMembers.length} members · {displayMonths.length} months shown
        </span>
      </div>

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
              {displayMonths.map((m) => {
                const isSelected = m === selectedMonth;
                return (
                  <th
                    key={m}
                    className={`px-3 py-3 text-center font-mono text-[10px] uppercase tracking-wider ${
                      isSelected ? "bg-[#42CA80]/10 text-[#65FFAA]" : "text-[#606060]"
                    }`}
                  >
                    {monthLabel(m)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filteredMembers.map((mem) => (
              <tr
                key={mem.id}
                className="border-b border-[#161616] last:border-0 hover:bg-[#111111]"
              >
                <td className="sticky left-0 z-10 bg-[#0a0a0a] px-4 py-2 text-xs font-medium text-white">
                  {mem.fullName}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-[#C4BCAA]">
                  {mem.role}
                </td>
                {displayMonths.map((m) => {
                  const leave = leaveFor(mem.id, m);
                  const isSelected = m === selectedMonth;
                  const closed = isMonthClosed(m);
                  const isActive =
                    activeCell?.memberId === mem.id && activeCell.monthKey === m;
                  return (
                    <td
                      key={m}
                      className={`px-1 py-1 text-center align-middle ${isSelected ? "bg-[#42CA80]/5" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          !closed &&
                          setActiveCell({ memberId: mem.id, monthKey: m })
                        }
                        disabled={closed}
                        title={
                          closed
                            ? "Month is closed"
                            : leave
                              ? `${shareLabel(leave.leaveShare)} ${leave.reason}${leave.notes ? ` · ${leave.notes}` : ""}`
                              : "Click to add leave"
                        }
                        className={`flex h-8 w-full items-center justify-center rounded-md border font-mono text-[11px] transition-colors ${
                          leave
                            ? `border-[#F5C542]/30 bg-[#F5C542]/5 ${shareTone(leave.leaveShare)}`
                            : "border-transparent text-[#404040] hover:border-[#2a2a2a] hover:text-white"
                        } ${closed ? "cursor-not-allowed opacity-60" : ""}`}
                      >
                        {shareLabel(leave?.leaveShare ?? 0)}
                      </button>
                      {isActive && !closed && (
                        <LeavePopover
                          memberName={mem.fullName}
                          monthKey={m}
                          initialShare={leave?.leaveShare ?? 0}
                          initialReason={leave?.reason ?? "PTO"}
                          initialNotes={leave?.notes ?? ""}
                          onClose={() => setActiveCell(null)}
                          onSave={(share, reason, notes) => {
                            setLeave(mem.id, m, share, reason, notes);
                            setActiveCell(null);
                          }}
                          onRemove={
                            leave
                              ? () => {
                                  removeLeave(mem.id, m);
                                  setActiveCell(null);
                                }
                              : undefined
                          }
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {filteredMembers.length === 0 && (
              <tr>
                <td
                  colSpan={2 + displayMonths.length}
                  className="px-4 py-8 text-center font-mono text-xs text-[#606060]"
                >
                  No members match the filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3 text-[11px] text-[#C4BCAA]">
        <Plane className="mt-0.5 h-4 w-4 shrink-0 text-[#F5C542]" />
        <span>
          Maps to <span className="font-mono text-[#65FFAA]">cp2_fact_member_leave</span>. One
          row per member × month. The share propagates to every{" "}
          <span className="font-mono">pod_membership</span> for that member so the Overview
          capacity math stays correct.
        </span>
      </div>
    </div>
  );
}

function LeavePopover({
  memberName,
  monthKey,
  initialShare,
  initialReason,
  initialNotes,
  onClose,
  onSave,
  onRemove,
}: {
  memberName: string;
  monthKey: string;
  initialShare: number;
  initialReason: LeaveReason;
  initialNotes: string;
  onClose: () => void;
  onSave: (share: number, reason: LeaveReason, notes?: string) => void;
  onRemove?: () => void;
}) {
  const [pct, setPct] = useState(() => Math.round(initialShare * 100));
  const [reason, setReason] = useState<LeaveReason>(initialReason);
  const [notes, setNotes] = useState(initialNotes);

  return (
    <div className="relative z-20">
      <div
        className="absolute left-1/2 top-1 w-72 -translate-x-1/2 rounded-lg border border-[#2a2a2a] bg-[#0a0a0a] p-3 shadow-xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#606060]">
            {memberName} · {monthLabel(monthKey)}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-[#606060] hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <label className="mt-3 block">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#606060]">
            Share · {pct}%
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={pct}
            onChange={(e) => setPct(parseInt(e.target.value, 10))}
            className="mt-1 w-full accent-[#42CA80]"
          />
        </label>

        <div className="mt-3 flex flex-wrap gap-1">
          {LEAVE_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={`rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                reason === r
                  ? "border-[#42CA80]/50 bg-[#42CA80]/10 text-[#65FFAA]"
                  : "border-[#2a2a2a] bg-[#161616] text-[#C4BCAA] hover:text-white"
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <label className="mt-3 block">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#606060]">
            Notes
          </span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional context"
            className="mt-1 h-7 w-full rounded-md border border-[#2a2a2a] bg-[#161616] px-2 font-sans text-xs text-white placeholder:text-[#606060] outline-none focus:border-[#42CA80]/50"
          />
        </label>

        <div className="mt-3 flex items-center justify-between">
          {onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[#ED6958] hover:text-[#F5A99A]"
            >
              <Trash2 className="h-3 w-3" />
              Remove
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[#2a2a2a] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA] hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSave(pct / 100, reason, notes.trim() || undefined)}
              className="rounded-md border border-[#42CA80]/40 bg-[#42CA80]/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#65FFAA] hover:bg-[#42CA80]/20"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
