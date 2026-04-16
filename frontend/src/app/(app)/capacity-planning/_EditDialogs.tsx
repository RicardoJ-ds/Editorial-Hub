"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  useCP2Store,
  useAllMembers,
} from "./_store";
import type { ClientChip, MemberRow, MonthKey, PodBoard, Role } from "./_mock";

const ROLES: Role[] = ["SE", "ED", "WR", "AD", "PM"];

export function EditMemberDialog({
  open,
  onOpenChange,
  month,
  podId,
  member,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: MonthKey;
  podId: number;
  member: MemberRow | null;
}) {
  const { updateMember, removeMember } = useCP2Store();
  const [share, setShare] = useState(member?.capacityShare ?? 1);
  const [leave, setLeave] = useState(member?.leaveShare ?? 0);
  const [override, setOverride] = useState(member?.overrideDelta ?? 0);
  const [role, setRole] = useState<Role>(member?.role ?? "ED");
  const [actual, setActual] = useState(member?.actualDelivered ?? 0);

  // Re-sync when a different member opens the dialog.
  if (member && open && member.id !== (member as MemberRow).id) {
    // no-op — state resets via key prop on parent
  }

  if (!member) return null;

  const save = () => {
    updateMember(month, podId, member.id, {
      capacityShare: share,
      leaveShare: leave,
      overrideDelta: override,
      role,
      actualDelivered: actual,
    });
    onOpenChange(false);
  };
  const remove = () => {
    removeMember(month, podId, member.id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit — {member.fullName}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Role in pod</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Capacity share (0–1)</Label>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={share}
                onChange={(e) => setShare(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Leave share (0–1)</Label>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={leave}
                onChange={(e) => setLeave(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Override Δ (articles)</Label>
              <Input
                type="number"
                value={override}
                onChange={(e) => setOverride(parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label>Actual delivered this month</Label>
              <Input
                type="number"
                min={0}
                value={actual}
                onChange={(e) => setActual(parseInt(e.target.value) || 0)}
              />
              <span className="font-mono text-[10px] text-[#606060]">
                In v2 this field will be read from <code>goals_vs_delivery</code> — editable here only for demo.
              </span>
            </div>
          </div>
          <div className="rounded-md border border-[#1a1a1a] bg-[#0a0a0a] px-3 py-2 text-[11px] text-[#C4BCAA]">
            Effective ={" "}
            <b className="text-white">
              {(member.defaultCapacity * share * (1 - leave) + override).toFixed(1)}
            </b>{" "}
            articles (default {member.defaultCapacity} × share {share.toFixed(2)} × (1 −{" "}
            {leave.toFixed(2)} leave) + {override} override)
          </div>
        </div>

        <DialogFooter className="justify-between">
          <Button
            variant="ghost"
            onClick={remove}
            className="text-[#ED6958] hover:bg-[#ED6958]/10 hover:text-[#ED6958]"
          >
            Remove from pod
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddMemberDialog({
  open,
  onOpenChange,
  month,
  pod,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: MonthKey;
  pod: PodBoard | null;
}) {
  const all = useAllMembers();
  const { addMember } = useCP2Store();
  const existingIds = new Set(pod?.members.map((m) => m.id));
  const candidates = all.filter((m) => !existingIds.has(m.id));
  const [pick, setPick] = useState<number | null>(null);
  const [role, setRole] = useState<Role>("ED");
  const [share, setShare] = useState(1);

  if (!pod) return null;

  const save = () => {
    if (pick == null) return;
    const src = all.find((m) => m.id === pick);
    if (!src) return;
    addMember(month, pod.id, {
      id: src.id,
      fullName: src.fullName,
      role,
      capacityShare: share,
      defaultCapacity: src.defaultCapacity,
      leaveShare: 0,
      overrideDelta: 0,
      actualDelivered: 0,
    });
    onOpenChange(false);
    setPick(null);
    setShare(1);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add member to {pod.displayName}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Team member</Label>
            <Select
              value={pick ? String(pick) : ""}
              onValueChange={(v) => setPick(v ? parseInt(v) : null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick a team member…" />
              </SelectTrigger>
              <SelectContent>
                {candidates.length === 0 && (
                  <SelectItem value="none" disabled>
                    Every known member is already on this pod
                  </SelectItem>
                )}
                {candidates.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.fullName} — {m.role} · cap {m.defaultCapacity}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Role in pod</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Capacity share</Label>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={share}
                onChange={(e) => setShare(parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pick == null}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditClientDialog({
  open,
  onOpenChange,
  month,
  podId,
  client,
  availablePods,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: MonthKey;
  podId: number | "unassigned";
  client: ClientChip | null;
  availablePods: PodBoard[];
}) {
  const { updateClient, moveClient } = useCP2Store();
  const [projected, setProjected] = useState(client?.projectedArticles ?? 0);
  const [source, setSource] = useState<ClientChip["source"]>(
    client?.source ?? "operating_model",
  );
  const [targetPod, setTargetPod] = useState<string>(String(podId));

  if (!client) return null;

  const save = () => {
    updateClient(month, podId, client.id, {
      projectedArticles: projected,
      source,
    });
    if (targetPod !== String(podId)) {
      const to: number | "unassigned" =
        targetPod === "unassigned" ? "unassigned" : parseInt(targetPod);
      moveClient(month, podId, to, client.id);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit — {client.name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Projected articles</Label>
              <Input
                type="number"
                min={0}
                value={projected}
                onChange={(e) => setProjected(parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Source</Label>
              <Select
                value={source}
                onValueChange={(v) => setSource(v as ClientChip["source"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sow">SOW (contract)</SelectItem>
                  <SelectItem value="operating_model">Operating Model</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Pod</Label>
            <Select value={targetPod} onValueChange={(v) => v && setTargetPod(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {availablePods.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    P{p.podNumber} — {p.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-md border border-[#1a1a1a] bg-[#0a0a0a] px-3 py-2 text-[11px] text-[#C4BCAA]">
            Changing the pod writes a <code>cp2_fact_client_allocation</code> row
            for this month. Setting source to <b>Manual</b> pins{" "}
            <code>projected_articles_manual</code> so SOW / OP-model refreshes
            won&apos;t overwrite it.
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
