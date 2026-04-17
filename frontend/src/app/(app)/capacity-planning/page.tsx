"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Info, Pencil, Plus, RotateCcw } from "lucide-react";
import { ProposalBanner } from "./_ProposalBanner";
import { SubNav } from "./_SubNav";
import { ValidationBanner } from "./_ValidationBanner";
import { ClosedMonthBanner, CloseMonthButton, CopyMonthMenu } from "./_MonthActions";
import { DiffButton } from "./_MonthDiff";
import {
  type ClientChip,
  type MemberRow,
  type MonthKey,
  type PodBoard,
  computeMemberEffective,
  computePodTotals,
} from "./_mock";
import { useCP2Store } from "./_store";
import {
  AddMemberDialog,
  EditClientDialog,
  EditMemberDialog,
} from "./_EditDialogs";

const ROLE_LABEL: Record<string, string> = {
  SE: "Senior Editor",
  ED: "Editor",
  WR: "Writer",
  AD: "Account Director",
  PM: "Project Manager",
};

function formatShare(share: number): string {
  if (share === 1) return "1.00";
  return share.toFixed(2);
}

function variancePill(delta: number): { color: string; label: string } {
  if (delta === 0) return { color: "text-[#606060]", label: "0" };
  const sign = delta > 0 ? "+" : "";
  const color =
    delta > 0 ? "text-[#42CA80]" : delta < -2 ? "text-[#ED6958]" : "text-[#E6B450]";
  return { color, label: `${sign}${delta}` };
}

function utilizationBadge(pct: number): { color: string; label: string } {
  if (pct > 100)
    return {
      color: "border-[#ED6958]/30 bg-[#ED6958]/10 text-[#ED6958]",
      label: "Over capacity",
    };
  if (pct < 70)
    return {
      color: "border-[#E6B450]/30 bg-[#E6B450]/10 text-[#E6B450]",
      label: "Under-utilized",
    };
  return {
    color: "border-[#42CA80]/30 bg-[#42CA80]/10 text-[#42CA80]",
    label: "Healthy",
  };
}

function SourceBadge({ source }: { source: ClientChip["source"] }) {
  const labels = { manual: "MANUAL", operating_model: "OP MODEL", sow: "SOW" };
  const colors = {
    manual: "bg-[#E6B450]/10 text-[#E6B450]",
    operating_model: "bg-[#65FFAA]/10 text-[#65FFAA]",
    sow: "bg-[#C4BCAA]/10 text-[#C4BCAA]",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[9px] tracking-wider ${colors[source]}`}
    >
      {labels[source]}
    </span>
  );
}

function PodCard({
  pod,
  month,
  onEditMember,
  onAddMember,
  onEditClient,
  allPods,
}: {
  pod: PodBoard;
  month: MonthKey;
  onEditMember: (m: MemberRow) => void;
  onAddMember: () => void;
  onEditClient: (c: ClientChip) => void;
  allPods: PodBoard[];
}) {
  void allPods;
  const totals = computePodTotals(pod);
  const badge = utilizationBadge(totals.utilizationPct);
  const variance = variancePill(totals.varianceVsProjected);

  return (
    <div className="rounded-lg border border-[#1f1f1f] bg-[#0a0a0a]">
      <div className="flex items-center justify-between border-b border-[#1f1f1f] px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#42CA80]/15 font-mono text-xs font-bold text-[#65FFAA]">
            P{pod.podNumber}
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-white">{pod.displayName}</span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
              Pod {pod.podNumber} · {pod.members.length} members
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider ${badge.color}`}
          >
            {badge.label}
          </span>
          <button
            type="button"
            onClick={onAddMember}
            className="flex items-center gap-1 rounded-md border border-[#2a2a2a] bg-[#161616] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA] hover:border-[#42CA80]/40 hover:text-white"
            title="Add member"
          >
            <Plus className="h-3 w-3" />
            Member
          </button>
        </div>
      </div>

      <div className="px-5 py-4">
        <div className="grid grid-cols-[1.6fr_0.6fr_0.5fr_0.5fr_0.5fr_0.7fr_0.6fr_0.5fr_0.3fr] gap-2 border-b border-[#1a1a1a] pb-2 font-mono text-[10px] uppercase tracking-wider text-[#606060]">
          <span>Member</span>
          <span>Role</span>
          <span className="text-right">Share</span>
          <span className="text-right">Cap</span>
          <span className="text-right">Leave</span>
          <span className="text-right">Effective</span>
          <span className="text-right">Actual</span>
          <span className="text-right">Δ</span>
          <span></span>
        </div>
        {pod.members.map((m) => {
          const effective = computeMemberEffective(m);
          const delta = m.actualDelivered - effective;
          const v = variancePill(Math.round(delta));
          return (
            <button
              key={`${pod.id}-${m.id}`}
              type="button"
              onClick={() => onEditMember(m)}
              className="grid w-full grid-cols-[1.6fr_0.6fr_0.5fr_0.5fr_0.5fr_0.7fr_0.6fr_0.5fr_0.3fr] items-center gap-2 rounded py-1.5 pl-1 text-left text-xs text-white transition-colors hover:bg-[#161616]"
              title="Click to edit"
            >
              <span className="flex items-center gap-2 truncate">
                {m.fullName}
                {m.capacityShare < 1 && (
                  <span
                    className="flex h-4 items-center rounded bg-[#E6B450]/10 px-1 font-mono text-[9px] tracking-wider text-[#E6B450]"
                    title={`Split: ${formatShare(m.capacityShare)}`}
                  >
                    SPLIT
                  </span>
                )}
                {m.overrideDelta !== 0 && (
                  <span
                    className="flex h-4 items-center rounded bg-[#E6B450]/10 px-1 font-mono text-[9px] tracking-wider text-[#E6B450]"
                    title={`Override: ${m.overrideDelta > 0 ? "+" : ""}${m.overrideDelta}`}
                  >
                    OVERRIDE
                  </span>
                )}
              </span>
              <span
                className="font-mono text-[11px] text-[#C4BCAA]"
                title={ROLE_LABEL[m.role]}
              >
                {m.role}
              </span>
              <span className="text-right font-mono text-[11px] text-[#C4BCAA]">
                {formatShare(m.capacityShare)}
              </span>
              <span className="text-right font-mono text-[11px] text-[#C4BCAA]">
                {m.defaultCapacity}
              </span>
              <span className="text-right font-mono text-[11px] text-[#C4BCAA]">
                {m.leaveShare > 0 ? `${Math.round(m.leaveShare * 100)}%` : "—"}
              </span>
              <span className="text-right font-mono text-[11px] font-semibold text-white">
                {effective.toFixed(1)}
              </span>
              <span className="text-right font-mono text-[11px] text-[#C4BCAA]">
                {m.actualDelivered}
              </span>
              <span className={`text-right font-mono text-[11px] font-medium ${v.color}`}>
                {v.label}
              </span>
              <Pencil className="h-3 w-3 justify-self-end text-[#404040]" />
            </button>
          );
        })}

        <div className="mt-3 grid grid-cols-3 gap-3 border-t border-[#1a1a1a] pt-3">
          <div className="flex flex-col">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
              Total Capacity
            </span>
            <span className="font-mono text-lg font-semibold text-white">
              {totals.totalCapacity.toFixed(1)}
              <span className="ml-1 text-[10px] text-[#606060]">articles</span>
            </span>
          </div>
          <div className="flex flex-col">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
              Projected Use
            </span>
            <span className="font-mono text-lg font-semibold text-white">
              {totals.projectedUse}
              <span className="ml-1 text-[10px] text-[#606060]">
                ({totals.utilizationPct.toFixed(0)}%)
              </span>
            </span>
          </div>
          <div className="flex flex-col">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
              Actual Delivered
            </span>
            <span className="font-mono text-lg font-semibold text-white">
              {totals.actualDelivered}
              <span className={`ml-1 text-[10px] ${variance.color}`}>
                ({variance.label})
              </span>
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
            Clients · {pod.clients.length}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {pod.clients.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onEditClient(c)}
                className="flex items-center gap-1.5 rounded-md border border-[#2a2a2a] bg-[#161616] px-2 py-1 transition-colors hover:border-[#42CA80]/40 hover:bg-[#1a1a1a]"
                title={`${c.name} · click to edit`}
              >
                <span className="text-xs text-white">{c.name}</span>
                <span className="font-mono text-[10px] font-semibold text-[#65FFAA]">
                  {c.projectedArticles}
                </span>
                <SourceBadge source={c.source} />
                <Pencil className="h-3 w-3 text-[#404040]" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CapacityPlanningV2() {
  const { state, resetToSeed, selectedMonth, isMonthClosed } = useCP2Store();
  const month = selectedMonth as MonthKey;
  const closed = isMonthClosed(month);

  const pods = state.monthly[month] ?? [];

  const [editMember, setEditMember] = useState<{
    podId: number;
    member: MemberRow;
  } | null>(null);
  const [addMemberPod, setAddMemberPod] = useState<PodBoard | null>(null);
  const [editClient, setEditClient] = useState<{
    podId: number | "unassigned";
    client: ClientChip;
  } | null>(null);

  const globalTotals = useMemo(() => {
    return pods.reduce(
      (acc, pod) => {
        const t = computePodTotals(pod);
        acc.capacity += t.totalCapacity;
        acc.projected += t.projectedUse;
        acc.actual += t.actualDelivered;
        acc.members += pod.members.length;
        return acc;
      },
      { capacity: 0, projected: 0, actual: 0, members: 0 },
    );
  }, [pods]);

  return (
    <div className="flex flex-col gap-6">
      <ProposalBanner subtitle="Editable prototype. All edits are stored in your browser (localStorage) — nothing is written to the database. Use Reset to restore seed data." />
      <SubNav />

      {/* Toolbar — month lives in the SubNav above; this row is just actions. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <DiffButton />
        <CopyMonthMenu />
        <CloseMonthButton />
        <button
          type="button"
          onClick={() => {
            if (confirm("Reset all edits and restore seed data?")) resetToSeed();
          }}
          className="flex items-center gap-1.5 rounded-md border border-[#2a2a2a] bg-[#161616] px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider text-[#C4BCAA] hover:border-[#ED6958]/40 hover:text-[#ED6958]"
          title="Discard all edits"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </button>
      </div>

      <ClosedMonthBanner />
      <ValidationBanner />

      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Pods", value: pods.length, unit: "" },
          { label: "Team members", value: globalTotals.members, unit: "" },
          {
            label: "Total capacity",
            value: globalTotals.capacity.toFixed(0),
            unit: "articles",
          },
          {
            label: "Projected use",
            value: globalTotals.projected,
            unit: `${globalTotals.capacity > 0 ? Math.round((globalTotals.projected / globalTotals.capacity) * 100) : 0}% util`,
          },
        ].map((k) => (
          <div
            key={k.label}
            className="flex flex-col gap-1 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3"
          >
            <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
              {k.label}
            </span>
            <span className="font-mono text-xl font-semibold text-white">
              {k.value}
              {k.unit && (
                <span className="ml-1 text-[10px] font-normal text-[#606060]">
                  {k.unit}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        {pods.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-[#2a2a2a] bg-[#0a0a0a] px-4 py-6 text-sm text-[#606060]">
            <AlertTriangle className="h-4 w-4" />
            No pods configured for this month. Use{" "}
            <b className="text-white">Copy → next 3</b> from a populated month.
          </div>
        ) : (
          pods.map((pod) => (
            <PodCard
              key={pod.id}
              pod={pod}
              month={month}
              allPods={pods}
              onEditMember={(m) => {
                if (!closed) setEditMember({ podId: pod.id, member: m });
              }}
              onAddMember={() => {
                if (!closed) setAddMemberPod(pod);
              }}
              onEditClient={(c) => {
                if (!closed) setEditClient({ podId: pod.id, client: c });
              }}
            />
          ))
        )}
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#606060]" />
        <div className="flex flex-col gap-1 text-[11px] text-[#C4BCAA]">
          <span>
            <b className="text-white">Click a member row</b> to edit share, leave, role or
            capacity override. <b className="text-white">Click a client chip</b> to edit
            projection or move it to another pod.
          </span>
          <span>
            <b className="text-white">Effective</b> = default_capacity × share × (1 −
            leave) + override.
          </span>
        </div>
      </div>

      <EditMemberDialog
        key={editMember ? `${editMember.podId}-${editMember.member.id}` : "none"}
        open={!!editMember}
        onOpenChange={(o) => !o && setEditMember(null)}
        month={month}
        podId={editMember?.podId ?? 0}
        member={editMember?.member ?? null}
      />
      <AddMemberDialog
        key={addMemberPod ? `add-${addMemberPod.id}` : "none"}
        open={!!addMemberPod}
        onOpenChange={(o) => !o && setAddMemberPod(null)}
        month={month}
        pod={addMemberPod}
      />
      <EditClientDialog
        key={editClient ? `c-${editClient.client.id}` : "none"}
        open={!!editClient}
        onOpenChange={(o) => !o && setEditClient(null)}
        month={month}
        podId={editClient?.podId ?? 0}
        client={editClient?.client ?? null}
        availablePods={pods}
      />
    </div>
  );
}
