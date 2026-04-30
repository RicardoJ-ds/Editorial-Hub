"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { ClientForm } from "@/components/data-management/ClientForm";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { apiGet, apiDelete } from "@/lib/api";
import { displayPod } from "@/components/dashboard/shared-helpers";
import type { Client } from "@/lib/types";

function statusBadgeClass(status: string) {
  switch (status) {
    case "ACTIVE":
      return "bg-graphite-green/20 text-graphite-green-light border-graphite-green/30";
    case "SOON_TO_BE_ACTIVE":
      return "bg-graphite-yellow/20 text-graphite-yellow border-graphite-yellow/30";
    case "COMPLETED":
      return "bg-graphite-text-muted/20 text-graphite-text-muted border-graphite-text-muted/30";
    case "CANCELLED":
      return "bg-graphite-red/20 text-graphite-red border-graphite-red/30";
    case "INACTIVE":
      return "bg-graphite-text-muted/20 text-graphite-text-muted border-graphite-text-muted/30";
    default:
      return "";
  }
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ");
}

export default function ClientManagementPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editClient, setEditClient] = useState<Client | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<Client[]>("/api/clients/?limit=200");
      setClients(data);
    } catch {
      // silently fail, user sees empty table
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const filteredClients = clients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  function openCreate() {
    setEditClient(undefined);
    setSheetOpen(true);
  }

  function openEdit(client: Client) {
    setEditClient(client);
    setSheetOpen(true);
  }

  function handleFormSuccess() {
    setSheetOpen(false);
    setEditClient(undefined);
    fetchClients();
  }

  function handleFormClose() {
    setSheetOpen(false);
    setEditClient(undefined);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/clients/${deleteTarget.id}`);
      setDeleteTarget(null);
      fetchClients();
    } catch {
      // silently fail
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Client Management
          </h2>
          <p className="mt-1 text-muted-foreground">
            Manage client SOW data, status, and milestones.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add Client
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clients..."
          className="pl-9"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-[#161616]">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="font-mono text-xs">Name</TableHead>
              <TableHead className="font-mono text-xs">Status</TableHead>
              <TableHead className="font-mono text-xs">Editorial Pod</TableHead>
              <TableHead className="font-mono text-xs">Growth Pod</TableHead>
              <TableHead className="font-mono text-xs">Start Date</TableHead>
              <TableHead className="font-mono text-xs text-right">
                Articles SOW
              </TableHead>
              <TableHead className="font-mono text-xs text-right">
                Delivered
              </TableHead>
              <TableHead className="font-mono text-xs text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i} className="border-border">
                  <TableCell>
                    <Skeleton className="h-4 w-32" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-14" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-14" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="ml-auto h-4 w-8" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="ml-auto h-4 w-8" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="ml-auto h-4 w-16" />
                  </TableCell>
                </TableRow>
              ))
            ) : filteredClients.length === 0 ? (
              <TableRow className="border-border">
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  {search
                    ? "No clients match your search."
                    : "No clients found. Add your first client to get started."}
                </TableCell>
              </TableRow>
            ) : (
              filteredClients.map((client) => (
                <TableRow key={client.id} className="border-border">
                  <TableCell className="font-medium">{client.name}</TableCell>
                  <TableCell>
                    <Badge
                      className={statusBadgeClass(client.status)}
                      variant="outline"
                    >
                      {statusLabel(client.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {client.editorial_pod ? displayPod(client.editorial_pod, "editorial") : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {client.growth_pod ? displayPod(client.growth_pod, "growth") : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {client.start_date ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {client.articles_sow ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {client.articles_delivered ?? 0}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEdit(client)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setDeleteTarget(client)}
                        className="text-graphite-red hover:text-graphite-red"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Client Form Sheet */}
      <ClientForm
        key={editClient?.id ?? "new"}
        client={editClient}
        open={sheetOpen}
        onSuccess={handleFormSuccess}
        onClose={handleFormClose}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Client</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-semibold text-foreground">
                {deleteTarget?.name}
              </span>
              ? This action cannot be undone. All associated deliverables will
              also be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
