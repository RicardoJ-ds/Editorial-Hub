"use client";

import { useMemo, useState } from "react";
import { Plus, Sparkles, Trash2, X } from "lucide-react";
import { StickyPageChrome } from "../_StickyPageChrome";
import { ValidationBanner } from "../_ValidationBanner";
import { ClosedMonthBanner } from "../_MonthActions";
import { useAllMembers, useCP2Store, monthLabel } from "../_store";
import type { MonthKey } from "../_mock";
import { computeMemberEffective } from "../_mock";

export default function OverridesPage() {
  const {
    state,
    selectedMonth,
    overrides,
    addOverride,
    removeOverride,
    isMonthClosed,
  } = useCP2Store();
  const allMembers = useAllMembers();
  const month = selectedMonth as MonthKey;
  const closed = isMonthClosed(month);
  const [showNew, setShowNew] = useState(false);

  const monthOverrides = overrides[month] ?? [];
  const pods = state.monthly[month] ?? [];

  const memberName = useMemo(() => {
    const map = new Map<number, string>();
    for (const m of allMembers) map.set(m.id, m.fullName);
    return (id: number | null) => (id == null ? "—" : map.get(id) ?? `#${id}`);
  }, [allMembers]);

  const podName = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of pods) map.set(p.id, p.displayName);
    return (id: number | null) => (id == null ? "—" : map.get(id) ?? `Pod ${id}`);
  }, [pods]);

  return (
    <div className="flex flex-col gap-6">
      <StickyPageChrome subtitle="Manual corrections to effective capacity. One row per override, signed delta in articles. Member-level overrides feed the Overview math; pod-level overrides are recorded but not yet summed into the pod card (proposal-only)." />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#606060]">
          {monthOverrides.length} override{monthOverrides.length === 1 ? "" : "s"} in{" "}
          {monthLabel(month)}
        </span>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          disabled={closed}
          className="flex items-center gap-1.5 rounded-md border border-[#42CA80]/40 bg-[#42CA80]/10 px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider text-[#65FFAA] hover:bg-[#42CA80]/20 disabled:cursor-not-allowed disabled:opacity-50"
          title={closed ? "Month is closed" : "Create a new override"}
        >
          <Plus className="h-3.5 w-3.5" />
          New override
        </button>
      </div>

      <ClosedMonthBanner />
      <ValidationBanner />

      {monthOverrides.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-[#2a2a2a] bg-[#0a0a0a] px-4 py-6 text-sm text-[#606060]">
          <Sparkles className="h-4 w-4 text-[#42CA80]" />
          No overrides yet for {monthLabel(month)}. Use{" "}
          <b className="text-white">New override</b> when a member's actual capacity differs
          from the formula.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#1f1f1f] bg-[#0a0a0a]">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[#1a1a1a] bg-[#050505] font-mono text-[10px] uppercase tracking-wider text-[#606060]">
                <th className="px-4 py-2 text-left">Target</th>
                <th className="px-3 py-2 text-right">Delta (articles)</th>
                <th className="px-3 py-2 text-left">Reason</th>
                <th className="px-3 py-2 text-left">Author</th>
                <th className="px-3 py-2 text-left">Created</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {monthOverrides
                .slice()
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                .map((o) => (
                  <tr
                    key={o.id}
                    className="border-b border-[#161616] last:border-0 hover:bg-[#111111]"
                  >
                    <td className="px-4 py-2 text-xs text-white">
                      {o.teamMemberId != null ? (
                        <span>
                          <span className="font-medium">{memberName(o.teamMemberId)}</span>
                          <span className="ml-2 font-mono text-[10px] text-[#606060]">
                            member
                          </span>
                        </span>
                      ) : o.podId != null ? (
                        <span>
                          <span className="font-medium">{podName(o.podId)}</span>
                          <span className="ml-2 font-mono text-[10px] text-[#606060]">
                            pod
                          </span>
                        </span>
                      ) : (
                        <span className="text-[#606060]">unknown</span>
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono text-xs font-semibold ${
                        o.deltaArticles > 0
                          ? "text-[#65FFAA]"
                          : o.deltaArticles < 0
                            ? "text-[#ED6958]"
                            : "text-[#C4BCAA]"
                      }`}
                    >
                      {o.deltaArticles > 0 ? `+${o.deltaArticles}` : o.deltaArticles}
                    </td>
                    <td className="px-3 py-2 text-xs text-[#C4BCAA]">{o.reason || "—"}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-[#C4BCAA]">
                      {o.createdBy}
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-[#606060]">
                      {new Date(o.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!closed && (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm("Remove this override?")) removeOverride(o.id);
                          }}
                          className="text-[#606060] hover:text-[#ED6958]"
                          title="Remove override"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <NewOverrideDialog
          month={month}
          onClose={() => setShowNew(false)}
          onCreate={(row) => {
            addOverride(row);
            setShowNew(false);
          }}
        />
      )}
    </div>
  );
}

function NewOverrideDialog({
  month,
  onClose,
  onCreate,
}: {
  month: MonthKey;
  onClose: () => void;
  onCreate: (row: {
    monthKey: string;
    teamMemberId: number | null;
    podId: number | null;
    deltaArticles: number;
    reason: string;
    createdBy: string;
  }) => void;
}) {
  const { state } = useCP2Store();
  const allMembers = useAllMembers();
  const pods = state.monthly[month] ?? [];

  const [targetType, setTargetType] = useState<"member" | "pod">("member");
  const [memberId, setMemberId] = useState<number | null>(allMembers[0]?.id ?? null);
  const [podId, setPodId] = useState<number | null>(pods[0]?.id ?? null);
  const [delta, setDelta] = useState<number>(-2);
  const [reason, setReason] = useState<string>("");
  const [createdBy, setCreatedBy] = useState<string>("you@graphitehq.com");

  // Before/after preview for the target
  const preview = useMemo(() => {
    if (targetType === "member" && memberId != null) {
      // Sum effective capacity across all pod instances of this member for the month
      let current = 0;
      for (const p of pods) {
        for (const m of p.members) {
          if (m.id === memberId) current += computeMemberEffective(m);
        }
      }
      return {
        label: allMembers.find((m) => m.id === memberId)?.fullName ?? `Member #${memberId}`,
        before: current,
        after: current + delta,
      };
    }
    if (targetType === "pod" && podId != null) {
      const pod = pods.find((p) => p.id === podId);
      if (!pod) return null;
      const current = pod.members.reduce((s, m) => s + computeMemberEffective(m), 0);
      return { label: pod.displayName, before: current, after: current + delta };
    }
    return null;
  }, [targetType, memberId, podId, delta, pods, allMembers]);

  const canSubmit = delta !== 0 && reason.trim().length > 0 && (
    (targetType === "member" && memberId != null) ||
    (targetType === "pod" && podId != null)
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] p-5 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#65FFAA]">
            New override · {monthLabel(month)}
          </h3>
          <button type="button" onClick={onClose} className="text-[#606060] hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Target type toggle */}
        <div className="mt-4 flex gap-1 rounded-md border border-[#1f1f1f] bg-[#050505] p-1">
          {(["member", "pod"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTargetType(t)}
              className={`flex-1 rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                targetType === t
                  ? "bg-[#42CA80]/15 text-[#65FFAA]"
                  : "text-[#C4BCAA] hover:bg-[#161616]"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Target picker */}
        <label className="mt-4 block">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#606060]">
            Target
          </span>
          {targetType === "member" ? (
            <select
              value={memberId ?? ""}
              onChange={(e) => setMemberId(e.target.value ? parseInt(e.target.value, 10) : null)}
              className="mt-1 h-8 w-full rounded-md border border-[#2a2a2a] bg-[#161616] px-2 font-sans text-xs text-white focus:border-[#42CA80]/50 focus:outline-none"
            >
              {allMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName} · {m.role}
                </option>
              ))}
            </select>
          ) : (
            <select
              value={podId ?? ""}
              onChange={(e) => setPodId(e.target.value ? parseInt(e.target.value, 10) : null)}
              className="mt-1 h-8 w-full rounded-md border border-[#2a2a2a] bg-[#161616] px-2 font-sans text-xs text-white focus:border-[#42CA80]/50 focus:outline-none"
            >
              {pods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          )}
        </label>

        {/* Delta */}
        <label className="mt-3 block">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#606060]">
            Delta (signed articles)
          </span>
          <input
            type="number"
            step={1}
            value={delta}
            onChange={(e) => setDelta(parseInt(e.target.value || "0", 10))}
            className="mt-1 h-8 w-full rounded-md border border-[#2a2a2a] bg-[#161616] px-2 font-mono text-sm text-white focus:border-[#42CA80]/50 focus:outline-none"
          />
        </label>

        {/* Reason */}
        <label className="mt-3 block">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#606060]">
            Reason
          </span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. onboarding ramp, emergency re-staff"
            className="mt-1 h-8 w-full rounded-md border border-[#2a2a2a] bg-[#161616] px-2 font-sans text-xs text-white placeholder:text-[#606060] focus:border-[#42CA80]/50 focus:outline-none"
          />
        </label>

        {/* Author */}
        <label className="mt-3 block">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#606060]">
            Author
          </span>
          <input
            value={createdBy}
            onChange={(e) => setCreatedBy(e.target.value)}
            className="mt-1 h-8 w-full rounded-md border border-[#2a2a2a] bg-[#161616] px-2 font-sans text-xs text-white focus:border-[#42CA80]/50 focus:outline-none"
          />
        </label>

        {/* Before / after preview */}
        {preview && (
          <div className="mt-4 rounded-md border border-[#1f1f1f] bg-[#050505] p-3">
            <div className="font-mono text-[10px] uppercase tracking-widest text-[#606060]">
              Effective capacity for {preview.label}
            </div>
            <div className="mt-1 flex items-baseline gap-3 font-mono text-sm">
              <span className="text-[#C4BCAA]">{preview.before.toFixed(1)}</span>
              <span className="text-[#606060]">→</span>
              <span
                className={
                  preview.after > preview.before
                    ? "text-[#65FFAA]"
                    : preview.after < preview.before
                      ? "text-[#ED6958]"
                      : "text-[#C4BCAA]"
                }
              >
                {preview.after.toFixed(1)}
              </span>
              <span className="ml-auto text-[10px] text-[#606060]">
                {delta > 0 ? `+${delta}` : delta} articles
              </span>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#2a2a2a] px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-[#C4BCAA] hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() =>
              onCreate({
                monthKey: month,
                teamMemberId: targetType === "member" ? memberId : null,
                podId: targetType === "pod" ? podId : null,
                deltaArticles: delta,
                reason: reason.trim(),
                createdBy: createdBy.trim() || "you@graphitehq.com",
              })
            }
            className="rounded-md border border-[#42CA80]/40 bg-[#42CA80]/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-[#65FFAA] hover:bg-[#42CA80]/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
