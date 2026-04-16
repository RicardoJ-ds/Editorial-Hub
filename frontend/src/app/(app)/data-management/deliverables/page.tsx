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
import type { Client, DeliverableMonthly, DeliverableCreate } from "@/lib/types";

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface EditingCell {
  id: number;
  field: string;
  value: string;
}

export default function DeliverablesPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [deliverables, setDeliverables] = useState<DeliverableMonthly[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [loadingDeliverables, setLoadingDeliverables] = useState(false);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newRow, setNewRow] = useState({ year: 2026, month: 1, articles_sow_target: 0 });

  const fetchClients = useCallback(async () => {
    setLoadingClients(true);
    try {
      const data = await apiGet<Client[]>("/api/clients/?limit=200");
      setClients(data);
    } catch {
      // silently fail
    } finally {
      setLoadingClients(false);
    }
  }, []);

  const fetchDeliverables = useCallback(async (clientId: string) => {
    if (!clientId) return;
    setLoadingDeliverables(true);
    try {
      const data = await apiGet<DeliverableMonthly[]>(
        `/api/deliverables/?client_id=${clientId}&limit=200`
      );
      setDeliverables(data);
    } catch {
      setDeliverables([]);
    } finally {
      setLoadingDeliverables(false);
    }
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  useEffect(() => {
    if (selectedClientId) {
      fetchDeliverables(selectedClientId);
    } else {
      setDeliverables([]);
    }
  }, [selectedClientId, fetchDeliverables]);

  function startEdit(id: number, field: string, currentValue: number | string | null) {
    setEditingCell({
      id,
      field,
      value: String(currentValue ?? ""),
    });
  }

  async function saveEdit() {
    if (!editingCell) return;
    const { id, field, value } = editingCell;
    const numValue = field === "notes" ? value : (value === "" ? 0 : Number(value));
    try {
      await apiPut(`/api/deliverables/${id}`, { [field]: numValue });
      setDeliverables((prev) =>
        prev.map((d) =>
          d.id === id ? { ...d, [field]: numValue } : d
        )
      );
    } catch {
      // silently fail
    }
    setEditingCell(null);
  }

  async function handleAddRow() {
    if (!selectedClientId) return;
    const payload: DeliverableCreate = {
      client_id: Number(selectedClientId),
      year: newRow.year,
      month: newRow.month,
      articles_sow_target: newRow.articles_sow_target,
    };
    try {
      await apiPost("/api/deliverables/", payload);
      setAddDialogOpen(false);
      fetchDeliverables(selectedClientId);
    } catch {
      // silently fail
    }
  }

  function renderEditableCell(
    row: DeliverableMonthly,
    field: keyof DeliverableMonthly,
    value: number | string | null
  ) {
    if (editingCell?.id === row.id && editingCell?.field === field) {
      return (
        <Input
          autoFocus
          className="h-7 w-20 font-mono text-xs"
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

  function computeVariance(d: DeliverableMonthly) {
    return (d.articles_delivered ?? 0) - (d.articles_invoiced ?? 0);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Deliverables Tracker
          </h2>
          <p className="mt-1 text-muted-foreground">
            Track monthly article deliveries and invoicing by client.
          </p>
        </div>
        {selectedClientId && (
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Month
          </Button>
        )}
      </div>

      {/* Client Selector */}
      <div className="max-w-xs">
        <Label className="mb-1.5 font-mono text-xs">Select Client</Label>
        {loadingClients ? (
          <Skeleton className="h-8 w-full" />
        ) : (
          <Select
            value={selectedClientId}
            onValueChange={(v) => setSelectedClientId(v ?? "")}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a client..." />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Table */}
      {selectedClientId && (
        <div className="rounded-lg border border-border bg-[#161616]">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="font-mono text-xs">Year</TableHead>
                <TableHead className="font-mono text-xs">Month</TableHead>
                <TableHead className="font-mono text-xs text-right">
                  SOW Target
                </TableHead>
                <TableHead className="font-mono text-xs text-right">
                  Delivered
                </TableHead>
                <TableHead className="font-mono text-xs text-right">
                  Invoiced
                </TableHead>
                <TableHead className="font-mono text-xs text-right">
                  Variance
                </TableHead>
                <TableHead className="font-mono text-xs">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingDeliverables ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i} className="border-border">
                    <TableCell><Skeleton className="h-4 w-10" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="ml-auto h-4 w-8" /></TableCell>
                    <TableCell><Skeleton className="ml-auto h-4 w-8" /></TableCell>
                    <TableCell><Skeleton className="ml-auto h-4 w-8" /></TableCell>
                    <TableCell><Skeleton className="ml-auto h-4 w-8" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  </TableRow>
                ))
              ) : deliverables.length === 0 ? (
                <TableRow className="border-border">
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No deliverables found for this client.
                  </TableCell>
                </TableRow>
              ) : (
                deliverables.map((d) => {
                  const variance = computeVariance(d);
                  return (
                    <TableRow key={d.id} className="border-border">
                      <TableCell className="font-mono text-xs">
                        {d.year}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {MONTH_NAMES[d.month] ?? d.month}
                      </TableCell>
                      <TableCell className="text-right">
                        {renderEditableCell(d, "articles_sow_target", d.articles_sow_target)}
                      </TableCell>
                      <TableCell className="text-right">
                        {renderEditableCell(d, "articles_delivered", d.articles_delivered)}
                      </TableCell>
                      <TableCell className="text-right">
                        {renderEditableCell(d, "articles_invoiced", d.articles_invoiced)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant="outline"
                          className={
                            variance > 0
                              ? "bg-graphite-green/20 text-graphite-green-light border-graphite-green/30"
                              : variance < 0
                                ? "bg-graphite-red/20 text-graphite-red border-graphite-red/30"
                                : ""
                          }
                        >
                          {variance > 0 ? "+" : ""}
                          {variance}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {renderEditableCell(d, "notes", d.notes)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Month Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Monthly Deliverable</DialogTitle>
            <DialogDescription>
              Add a new month entry for tracking deliverables.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="font-mono text-xs">Year</Label>
                <Input
                  type="number"
                  value={newRow.year}
                  onChange={(e) =>
                    setNewRow((prev) => ({ ...prev, year: Number(e.target.value) }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="font-mono text-xs">Month</Label>
                <Select
                  value={String(newRow.month)}
                  onValueChange={(v) =>
                    setNewRow((prev) => ({ ...prev, month: Number(v) }))
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
              <Label className="font-mono text-xs">SOW Target</Label>
              <Input
                type="number"
                value={newRow.articles_sow_target}
                onChange={(e) =>
                  setNewRow((prev) => ({
                    ...prev,
                    articles_sow_target: Number(e.target.value),
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button onClick={handleAddRow}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
