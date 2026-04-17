"use client";

import { useMemo, useState } from "react";
import { ArrowRight, GitCompare, Minus, Plus, X } from "lucide-react";
import { shiftMonth, monthLabel, useCP2Store } from "./_store";
import type { PodBoard, ClientChip } from "./_mock";

type MemberDiff = {
  kind: "added" | "removed" | "share_changed";
  podId: number;
  podName: string;
  memberId: number;
  memberName: string;
  prev?: number;
  next?: number;
};

type ClientDiff = {
  kind: "added" | "removed" | "moved" | "projection_changed";
  clientId: number;
  clientName: string;
  fromPodName?: string;
  toPodName?: string;
  prev?: number;
  next?: number;
};

function computeDiff(prevPods: PodBoard[], nextPods: PodBoard[]) {
  const memberDiffs: MemberDiff[] = [];
  const clientDiffs: ClientDiff[] = [];

  const prevByPod = new Map(prevPods.map((p) => [p.id, p]));
  const nextByPod = new Map(nextPods.map((p) => [p.id, p]));

  // Member diffs by pod
  const podIds = new Set([...prevByPod.keys(), ...nextByPod.keys()]);
  for (const podId of podIds) {
    const prev = prevByPod.get(podId);
    const next = nextByPod.get(podId);
    const podName = next?.displayName ?? prev?.displayName ?? `Pod ${podId}`;

    const prevMembers = new Map((prev?.members ?? []).map((m) => [m.id, m]));
    const nextMembers = new Map((next?.members ?? []).map((m) => [m.id, m]));
    for (const mid of new Set([...prevMembers.keys(), ...nextMembers.keys()])) {
      const pm = prevMembers.get(mid);
      const nm = nextMembers.get(mid);
      if (pm && !nm) {
        memberDiffs.push({
          kind: "removed",
          podId,
          podName,
          memberId: mid,
          memberName: pm.fullName,
          prev: pm.capacityShare,
        });
      } else if (!pm && nm) {
        memberDiffs.push({
          kind: "added",
          podId,
          podName,
          memberId: mid,
          memberName: nm.fullName,
          next: nm.capacityShare,
        });
      } else if (pm && nm && pm.capacityShare !== nm.capacityShare) {
        memberDiffs.push({
          kind: "share_changed",
          podId,
          podName,
          memberId: mid,
          memberName: nm.fullName,
          prev: pm.capacityShare,
          next: nm.capacityShare,
        });
      }
    }
  }

  // Client diffs — detect added / removed / moved / projection changes
  const prevClientIndex = new Map<number, { podId: number; chip: ClientChip }>();
  const nextClientIndex = new Map<number, { podId: number; chip: ClientChip }>();
  for (const p of prevPods) for (const c of p.clients) prevClientIndex.set(c.id, { podId: p.id, chip: c });
  for (const p of nextPods) for (const c of p.clients) nextClientIndex.set(c.id, { podId: p.id, chip: c });

  for (const clientId of new Set([...prevClientIndex.keys(), ...nextClientIndex.keys()])) {
    const pv = prevClientIndex.get(clientId);
    const nv = nextClientIndex.get(clientId);
    if (pv && !nv) {
      clientDiffs.push({
        kind: "removed",
        clientId,
        clientName: pv.chip.name,
        fromPodName: prevByPod.get(pv.podId)?.displayName,
      });
    } else if (!pv && nv) {
      clientDiffs.push({
        kind: "added",
        clientId,
        clientName: nv.chip.name,
        toPodName: nextByPod.get(nv.podId)?.displayName,
        next: nv.chip.projectedArticles,
      });
    } else if (pv && nv) {
      if (pv.podId !== nv.podId) {
        clientDiffs.push({
          kind: "moved",
          clientId,
          clientName: nv.chip.name,
          fromPodName: prevByPod.get(pv.podId)?.displayName,
          toPodName: nextByPod.get(nv.podId)?.displayName,
        });
      }
      if (pv.chip.projectedArticles !== nv.chip.projectedArticles) {
        clientDiffs.push({
          kind: "projection_changed",
          clientId,
          clientName: nv.chip.name,
          prev: pv.chip.projectedArticles,
          next: nv.chip.projectedArticles,
        });
      }
    }
  }

  return { memberDiffs, clientDiffs };
}

export function DiffButton() {
  const { selectedMonth } = useCP2Store();
  const [open, setOpen] = useState(false);
  const prev = shiftMonth(selectedMonth, -1);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border border-[#2a2a2a] bg-[#161616] px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider text-[#C4BCAA] hover:border-[#42CA80]/40 hover:text-white"
        title={`See what changed from ${monthLabel(prev)} to ${monthLabel(selectedMonth)}`}
      >
        <GitCompare className="h-3.5 w-3.5" />
        Diff
      </button>
      {open && <DiffModal onClose={() => setOpen(false)} />}
    </>
  );
}

function DiffModal({ onClose }: { onClose: () => void }) {
  const { state, selectedMonth } = useCP2Store();
  const prev = shiftMonth(selectedMonth, -1);
  const { memberDiffs, clientDiffs } = useMemo(
    () =>
      computeDiff(state.monthly[prev] ?? [], state.monthly[selectedMonth] ?? []),
    [state, prev, selectedMonth],
  );

  const total = memberDiffs.length + clientDiffs.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] p-5 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#65FFAA]">
              Diff
            </h3>
            <div className="mt-1 flex items-center gap-2 text-sm text-white">
              <span className="font-mono text-[11px] text-[#C4BCAA]">
                {monthLabel(prev)}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-[#606060]" />
              <span className="font-mono text-[11px] text-[#65FFAA]">
                {monthLabel(selectedMonth)}
              </span>
              <span className="ml-3 font-mono text-[10px] text-[#606060]">
                {total} change{total === 1 ? "" : "s"}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#606060] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {total === 0 ? (
          <div className="mt-6 text-center text-sm text-[#606060]">
            No changes between these months.
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {memberDiffs.length > 0 && (
              <Section title={`Members (${memberDiffs.length})`}>
                {memberDiffs.map((d, i) => (
                  <li key={`m-${i}`} className="flex items-center gap-2">
                    <DiffIcon kind={d.kind} />
                    <span className="text-xs text-white">{d.memberName}</span>
                    <span className="font-mono text-[10px] text-[#606060]">
                      in {d.podName}
                    </span>
                    <span className="ml-auto font-mono text-[10px]">
                      {d.kind === "share_changed" ? (
                        <>
                          <span className="text-[#C4BCAA]">
                            {((d.prev ?? 0) * 100).toFixed(0)}%
                          </span>
                          <span className="mx-1 text-[#606060]">→</span>
                          <span className="text-[#65FFAA]">
                            {((d.next ?? 0) * 100).toFixed(0)}%
                          </span>
                        </>
                      ) : d.kind === "added" ? (
                        <span className="text-[#65FFAA]">
                          +{((d.next ?? 0) * 100).toFixed(0)}%
                        </span>
                      ) : (
                        <span className="text-[#ED6958]">
                          −{((d.prev ?? 0) * 100).toFixed(0)}%
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </Section>
            )}

            {clientDiffs.length > 0 && (
              <Section title={`Clients (${clientDiffs.length})`}>
                {clientDiffs.map((d, i) => (
                  <li key={`c-${i}`} className="flex items-center gap-2">
                    <DiffIcon kind={d.kind} />
                    <span className="text-xs text-white">{d.clientName}</span>
                    <span className="ml-auto font-mono text-[10px]">
                      {d.kind === "moved" ? (
                        <>
                          <span className="text-[#C4BCAA]">{d.fromPodName}</span>
                          <span className="mx-1 text-[#606060]">→</span>
                          <span className="text-[#65FFAA]">{d.toPodName}</span>
                        </>
                      ) : d.kind === "projection_changed" ? (
                        <>
                          <span className="text-[#C4BCAA]">{d.prev}</span>
                          <span className="mx-1 text-[#606060]">→</span>
                          <span className="text-[#65FFAA]">{d.next}</span>
                          <span className="ml-1 text-[#606060]">articles</span>
                        </>
                      ) : d.kind === "added" ? (
                        <span className="text-[#65FFAA]">+{d.next} into {d.toPodName}</span>
                      ) : (
                        <span className="text-[#ED6958]">
                          from {d.fromPodName}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </Section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[#606060]">
        {title}
      </div>
      <ul className="space-y-1 rounded-md border border-[#1f1f1f] bg-[#050505] p-2">
        {children}
      </ul>
    </div>
  );
}

function DiffIcon({ kind }: { kind: string }) {
  if (kind === "added")
    return <Plus className="h-3 w-3 shrink-0 text-[#65FFAA]" />;
  if (kind === "removed")
    return <Minus className="h-3 w-3 shrink-0 text-[#ED6958]" />;
  return <ArrowRight className="h-3 w-3 shrink-0 text-[#F5C542]" />;
}
