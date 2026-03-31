"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import type { CapacityProjection, CapacityCreate } from "@/lib/types";

const MONTH_NAMES = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const POD_OPTIONS = ["Pod 1", "Pod 2", "Pod 3", "Pod 4", "Pod 5"];

interface EditingCell {
  id: number;
  field: string;
  value: string;
}

function utilizationBadge(pct: number) {
  if (pct >= 80 && pct <= 85) {
    return (
      <Badge variant="outline" className="bg-graphite-green/20 text-graphite-green-light border-graphite-green/30">
        {pct.toFixed(1)}%
      </Badge>
    );
  }
  if (pct > 85 && pct <= 100) {
    return (
      <Badge variant="outline" className="bg-graphite-yellow/20 text-graphite-yellow border-graphite-yellow/30">
        {pct.toFixed(1)}%
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-graphite-red/20 text-graphite-red border-graphite-red/30">
      {pct.toFixed(1)}%
    </Badge>
  );
}

export default function CapacityPage() {
  const [entries, setEntries] = useState<CapacityProjection[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newEntry, setNewEntry] = useState<CapacityCreate>({
    pod: "Pod 1",
    year: 2026,
    month: 1,
    total_capacity: 0,
    projected_used_capacity: 0,
    actual_used_capacity: 0,
  });

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<CapacityProjection[]>("/api/capacity/?limit=200");
      setEntries(data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  function startEdit(id: number, field: string, currentValue: number | null) {
    setEditingCell({
      id,
      field,
      value: String(currentValue ?? 0),
    });
  }

  async function saveEdit() {
    if (!editingCell) return;
    const { id, field, value } = editingCell;
    const numValue = value === "" ? 0 : Number(value);
    try {
      await apiPut(`/api/capacity/${id}`, { [field]: numValue });
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, [field]: numValue } : e))
      );
    } catch {
      // silently fail
    }
    setEditingCell(null);
  }

  function renderEditableCell(
    row: CapacityProjection,
    field: "total_capacity" | "projected_used_capacity" | "actual_used_capacity",
    value: number | null
  ) {
    if (editingCell?.id === row.id && editingCell?.field === field) {
      return (
        <Input
          autoFocus
          className="h-7 w-20 font-mono text-xs"
          type="number"
          value={editingCell.value}
          onChange={(e) =>
            setEditingCell({ ...editingCell, value: e.target.value })
          }
          onBlur={saveEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveEdit();
            if (e.key === "Escape") setEditingCell(null);
          }}
        />
      );
    }
    return (
      <span
        className="cursor-pointer rounded px-1.5 py-0.5 font-mono text-xs hover:bg-graphite-surface-hover"
        onClick={() => startEdit(row.id, field, value)}
      >
        {value ?? 0}
      </span>
    );
  }

  function computeUtilization(entry: CapacityProjection) {
    const total = entry.total_capacity ?? 0;
    if (total === 0) return 0;
    const used = entry.actual_used_capacity ?? entry.projected_used_capacity ?? 0;
    return (used / total) * 100;
  }

  async function handleAdd() {
    try {
      await apiPost("/api/capacity/", newEntry);
      setAddDialogOpen(false);
      fetchEntries();
    } catch {
      // silently fail
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Capacity Planning
          </h2>
          <p className="mt-1 text-muted-foreground">
            Manage pod capacity projections and utilization.
          </p>
        </div>
        <Button onClick={() => setAddDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Entry
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-[#161616]">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="font-mono text-xs">Pod</TableHead>
              <TableHead className="font-mono text-xs">Year</TableHead>
              <TableHead className="font-mono text-xs">Month</TableHead>
              <TableHead className="font-mono text-xs text-right">
                Total Capacity
              </TableHead>
              <TableHead className="font-mono text-xs text-right">
                Projected Used
              </TableHead>
              <TableHead className="font-mono text-xs text-right">
                Actual Used
              </TableHead>
              <TableHead className="font-mono text-xs text-right">
                Utilization %
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i} className="border-border">
                  <TableCell><Skeleton className="h-4 w-14" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-10" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-10" /></TableCell>
                  <TableCell><Skeleton className="ml-auto h-4 w-10" /></TableCell>
                  <TableCell><Skeleton className="ml-auto h-4 w-10" /></TableCell>
                  <TableCell><Skeleton className="ml-auto h-4 w-10" /></TableCell>
                  <TableCell><Skeleton className="ml-auto h-5 w-16" /></TableCell>
                </TableRow>
              ))
            ) : entries.length === 0 ? (
              <TableRow className="border-border">
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No capacity entries found. Add your first entry.
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => {
                const utilPct = computeUtilization(entry);
                return (
                  <TableRow key={entry.id} className="border-border">
                    <TableCell className="font-mono text-xs font-medium">
                      {entry.pod}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {entry.year}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {MONTH_NAMES[entry.month] ?? entry.month}
                    </TableCell>
                    <TableCell className="text-right">
                      {renderEditableCell(entry, "total_capacity", entry.total_capacity)}
                    </TableCell>
                    <TableCell className="text-right">
                      {renderEditableCell(entry, "projected_used_capacity", entry.projected_used_capacity)}
                    </TableCell>
                    <TableCell className="text-right">
                      {renderEditableCell(entry, "actual_used_capacity", entry.actual_used_capacity)}
                    </TableCell>
                    <TableCell className="text-right">
                      {utilizationBadge(utilPct)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add Entry Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Capacity Entry</DialogTitle>
            <DialogDescription>
              Add a new capacity projection for a pod.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="font-mono text-xs">Pod</Label>
              <Select
                value={newEntry.pod}
                onValueChange={(v) =>
                  setNewEntry((prev) => ({ ...prev, pod: v ?? "Pod 1" }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POD_OPTIONS.map((pod) => (
                    <SelectItem key={pod} value={pod}>
                      {pod}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="font-mono text-xs">Year</Label>
                <Input
                  type="number"
                  value={newEntry.year}
                  onChange={(e) =>
                    setNewEntry((prev) => ({
                      ...prev,
                      year: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="font-mono text-xs">Month</Label>
                <Select
                  value={String(newEntry.month)}
                  onValueChange={(v) =>
                    setNewEntry((prev) => ({ ...prev, month: Number(v) }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTH_NAMES.slice(1).map((name, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="font-mono text-xs">Total Capacity</Label>
              <Input
                type="number"
                value={newEntry.total_capacity ?? 0}
                onChange={(e) =>
                  setNewEntry((prev) => ({
                    ...prev,
                    total_capacity: Number(e.target.value),
                  }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="font-mono text-xs">Projected Used</Label>
                <Input
                  type="number"
                  value={newEntry.projected_used_capacity ?? 0}
                  onChange={(e) =>
                    setNewEntry((prev) => ({
                      ...prev,
                      projected_used_capacity: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="font-mono text-xs">Actual Used</Label>
                <Input
                  type="number"
                  value={newEntry.actual_used_capacity ?? 0}
                  onChange={(e) =>
                    setNewEntry((prev) => ({
                      ...prev,
                      actual_used_capacity: Number(e.target.value),
                    }))
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button onClick={handleAdd}>Add Entry</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
