"use client";

import { useMemo, useState } from "react";
import { GripVertical, Pencil, Plus, RotateCcw } from "lucide-react";
import { ProposalBanner } from "../_ProposalBanner";
import { SubNav } from "../_SubNav";
import { ValidationBanner } from "../_ValidationBanner";
import { ClosedMonthBanner, CopyMonthMenu } from "../_MonthActions";
import {
  computeMemberEffective,
  type ClientChip,
  type MonthKey,
  type PodBoard,
} from "../_mock";
import { useCP2Store } from "../_store";
import { EditClientDialog } from "../_EditDialogs";

const SOURCE_LABEL: Record<ClientChip["source"], string> = {
  manual: "MANUAL",
  operating_model: "OP MODEL",
  sow: "SOW",
};
const SOURCE_COLOR: Record<ClientChip["source"], string> = {
  manual: "bg-[#E6B450]/10 text-[#E6B450]",
  operating_model: "bg-[#65FFAA]/10 text-[#65FFAA]",
  sow: "bg-[#C4BCAA]/10 text-[#C4BCAA]",
};

type DragData = {
  clientId: number;
  fromPodId: number | "unassigned";
};

function ClientCard({
  client,
  fromPodId,
  onEdit,
  onDragStart,
}: {
  client: ClientChip;
  fromPodId: number | "unassigned";
  onEdit: () => void;
  onDragStart: (data: DragData, e: React.DragEvent) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart({ clientId: client.id, fromPodId }, e)}
      className="group flex cursor-grab items-center justify-between gap-2 rounded-md border border-[#2a2a2a] bg-[#161616] px-2.5 py-1.5 transition-colors hover:border-[#42CA80]/40 active:cursor-grabbing"
      title={`${client.name} · drag to move, click pencil to edit`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-[#404040] group-hover:text-[#C4BCAA]" />
        <span className="truncate text-xs text-white">{client.name}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="font-mono text-xs font-semibold text-[#65FFAA]">
          {client.projectedArticles}
        </span>
        <span
          className={`rounded px-1 py-0.5 font-mono text-[9px] tracking-wider ${SOURCE_COLOR[client.source]}`}
        >
          {SOURCE_LABEL[client.source]}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="rounded p-0.5 text-[#404040] transition-colors hover:text-white"
          title="Edit projection & source"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function PodColumn({
  pod,
  capacity,
  onEditClient,
  onDragStart,
  onDrop,
  isDropTarget,
  setDropTarget,
}: {
  pod: PodBoard;
  capacity: number;
  onEditClient: (c: ClientChip) => void;
  onDragStart: (data: DragData, e: React.DragEvent) => void;
  onDrop: (toPodId: number | "unassigned") => void;
  isDropTarget: boolean;
  setDropTarget: (target: number | "unassigned" | null) => void;
}) {
  const projected = pod.clients.reduce((s, c) => s + c.projectedArticles, 0);
  const utilization = capacity > 0 ? (projected / capacity) * 100 : 0;
  const utilColor =
    utilization > 100
      ? "text-[#ED6958]"
      : utilization < 70
        ? "text-[#E6B450]"
        : "text-[#65FFAA]";
  const barColor =
    utilization > 100
      ? "bg-[#ED6958]"
      : utilization < 70
        ? "bg-[#E6B450]"
        : "bg-[#42CA80]";

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDropTarget(pod.id);
      }}
      onDragLeave={() => setDropTarget(null)}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(pod.id);
        setDropTarget(null);
      }}
      className={`flex w-72 shrink-0 flex-col rounded-lg border transition-colors ${
        isDropTarget
          ? "border-[#42CA80] bg-[#42CA80]/5"
          : "border-[#1f1f1f] bg-[#0a0a0a]"
      }`}
    >
      <div className="border-b border-[#1f1f1f] px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-[#42CA80]/15 font-mono text-[10px] font-bold text-[#65FFAA]">
              P{pod.podNumber}
            </div>
            <span className="truncate text-xs font-semibold text-white">
              {pod.displayName}
            </span>
          </div>
          <span className={`font-mono text-[10px] font-medium ${utilColor}`}>
            {projected}/{capacity.toFixed(0)}
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded bg-[#1a1a1a]">
          <div
            className={`h-full ${barColor}`}
            style={{ width: `${Math.min(utilization, 100)}%` }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-wider text-[#606060]">
          <span>{utilization.toFixed(0)}% util</span>
          <span>{pod.clients.length} clients</span>
        </div>
      </div>
      <div className="flex min-h-[6rem] flex-col gap-1 p-2">
        {pod.clients.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-[#2a2a2a] text-[10px] text-[#606060]">
            Drop client here
          </div>
        ) : (
          pod.clients.map((c) => (
            <ClientCard
              key={c.id}
              client={c}
              fromPodId={pod.id}
              onEdit={() => onEditClient(c)}
              onDragStart={onDragStart}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default function AllocationPage() {
  const { state, moveClient, resetToSeed, selectedMonth, isMonthClosed } = useCP2Store();
  const month = selectedMonth as MonthKey;
  const closed = isMonthClosed(month);
  const [dragging, setDragging] = useState<DragData | null>(null);
  const [dropTarget, setDropTarget] = useState<
    number | "unassigned" | null
  >(null);
  const [editClient, setEditClient] = useState<{
    podId: number | "unassigned";
    client: ClientChip;
  } | null>(null);

  const pods = state.monthly[month] ?? [];
  const unassigned = state.unassigned[month] ?? [];

  const podCapacities = useMemo(
    () =>
      pods.map((p) => ({
        ...p,
        capacity: p.members.reduce((s, m) => s + computeMemberEffective(m), 0),
      })),
    [pods],
  );

  const handleDragStart = (data: DragData, e: React.DragEvent) => {
    if (closed) {
      e.preventDefault();
      return;
    }
    setDragging(data);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(data.clientId));
  };

  const handleDrop = (to: number | "unassigned") => {
    if (closed || !dragging) return;
    moveClient(month, dragging.fromPodId, to, dragging.clientId);
    setDragging(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <ProposalBanner subtitle="Drag-and-drop clients between pods. Click pencil to edit a projection or change its source (SOW / OP MODEL / MANUAL)." />
      <SubNav />

      <div className="flex flex-wrap items-center justify-end gap-2">
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

      <ClosedMonthBanner />
      <ValidationBanner />

      {/* Kanban */}
      <div className="flex gap-4 overflow-x-auto pb-2">
        {podCapacities.map((p) => (
          <PodColumn
            key={p.id}
            pod={p}
            capacity={p.capacity}
            onEditClient={(c) => setEditClient({ podId: p.id, client: c })}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            isDropTarget={dropTarget === p.id}
            setDropTarget={setDropTarget}
          />
        ))}
      </div>

      {/* Unassigned tray */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDropTarget("unassigned");
        }}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => {
          e.preventDefault();
          handleDrop("unassigned");
          setDropTarget(null);
        }}
        className={`rounded-lg border p-3 transition-colors ${
          dropTarget === "unassigned"
            ? "border-[#ED6958] bg-[#ED6958]/5"
            : "border-[#1f1f1f] bg-[#0a0a0a]"
        }`}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
            Unassigned this month · {unassigned.length}
          </span>
          <span className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-[#404040]">
            <Plus className="h-3 w-3" />
            Drag onto a pod to allocate · drag here to un-allocate
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {unassigned.length === 0 ? (
            <span className="text-xs text-[#606060]">All clients allocated.</span>
          ) : (
            unassigned.map((c) => (
              <div key={c.id} className="w-64">
                <ClientCard
                  client={c}
                  fromPodId="unassigned"
                  onEdit={() =>
                    setEditClient({ podId: "unassigned", client: c })
                  }
                  onDragStart={handleDragStart}
                />
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3 text-[11px] text-[#C4BCAA]">
        <span className="font-semibold text-white">How this maps to cp2_*:</span>{" "}
        drop target writes{" "}
        <code className="rounded bg-[#1a1a1a] px-1 font-mono text-[11px]">
          cp2_fact_client_allocation
        </code>{" "}
        · projection edit sets{" "}
        <code className="rounded bg-[#1a1a1a] px-1 font-mono text-[11px]">
          projected_articles_manual
        </code>{" "}
        (manual wins over SOW / OP MODEL).
      </div>

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
