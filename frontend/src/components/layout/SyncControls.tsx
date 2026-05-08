"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { SyncAllModal } from "@/components/data-management/SyncAllModal";
import { apiGet } from "@/lib/api";
import { useCurrentPodAxis } from "@/lib/podAxisClient";

type SyncState = "idle" | "syncing" | "success" | "error";

// "Synced Apr 23, 10:18 PM" — reads /api/migrate/status (audit_log row written
// at the end of every import_all run). Naive backend datetimes are anchored
// to UTC so toLocaleString() resolves them in the browser's locale + timezone.
function LastSyncBadge() {
  const [iso, setIso] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await apiGet<{
          last_imports: Array<{ performed_at: string }>;
        }>("/api/migrate/status");
        if (cancelled) return;
        setIso(data.last_imports?.[0]?.performed_at ?? null);
      } catch {
        // Silent — leave the badge in its current state.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    load();
    const onSynced = () => load();
    window.addEventListener("data-synced", onSynced);
    return () => {
      cancelled = true;
      window.removeEventListener("data-synced", onSynced);
    };
  }, []);

  let label = "Synced —";
  let title = "Loading sync history…";
  if (loaded) {
    if (iso === null) {
      label = "Never synced";
      title = "No sync has been recorded yet";
    } else {
      const isoUtc = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
      const date = new Date(isoUtc);
      const formatted = date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      label = `Synced ${formatted}`;
      title = `Last sync: ${date.toLocaleString()}`;
    }
  }

  return (
    <span
      className="font-mono text-[10px] uppercase tracking-wider text-[#606060] whitespace-nowrap"
      title={title}
    >
      {label}
    </span>
  );
}

export function SyncControls() {
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  function handleSyncClick() {
    setSyncError(null);
    setSyncState("syncing");
    setModalOpen(true);
  }

  function handleSyncComplete(allOk: boolean) {
    if (allOk) {
      setSyncState("success");
      setTimeout(() => setSyncState("idle"), 5000);
    } else {
      setSyncState("error");
      setSyncError("Some sheets failed");
      setTimeout(() => setSyncState("idle"), 8000);
    }
  }

  return (
    <div className="flex items-center gap-3 shrink-0">
      <SyncAllModal
        open={modalOpen}
        onOpenChange={(v) => {
          setModalOpen(v);
          if (!v && syncState === "syncing") {
            setSyncState("idle");
          }
        }}
        onComplete={handleSyncComplete}
      />
      <PodAxisToggle />
      <LastSyncBadge />
      <button
        type="button"
        onClick={handleSyncClick}
        disabled={syncState === "syncing" && modalOpen}
        title={syncError ?? "Sync all data from Google Sheets"}
        className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider transition-all duration-200 ${
          syncState === "syncing"
            ? "cursor-wait border-[#333] bg-[#1a1a1a] text-[#606060]"
            : syncState === "success"
              ? "border-[#42CA80]/30 bg-[#42CA80]/10 text-[#42CA80]"
              : syncState === "error"
                ? "border-[#ED6958]/30 bg-[#ED6958]/10 text-[#ED6958]"
                : "border-[#333] bg-[#1a1a1a] text-[#999] hover:border-[#42CA80]/40 hover:text-white"
        }`}
      >
        {syncState === "syncing" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {syncState === "success" && <CheckCircle2 className="h-3.5 w-3.5" />}
        {syncState === "error" && <XCircle className="h-3.5 w-3.5" />}
        {syncState === "idle" && <RefreshCw className="h-3.5 w-3.5" />}
        <span>
          {syncState === "syncing"
            ? "Syncing..."
            : syncState === "success"
              ? "Synced"
              : syncState === "error"
                ? "Failed"
                : "Sync"}
        </span>
      </button>
    </div>
  );
}

/** Top-bar toggle that flips the dashboard's pod-axis between Editorial /
 *  Growth. Renders only when the access profile has `can_toggle_axis` —
 *  pod-locked teams (Editorial Team / Growth Team) get nothing here.
 *  Selection persists in localStorage; changing it emits a notification
 *  so every chart subscribed via `useCurrentPodAxis` re-renders. */
function PodAxisToggle() {
  const { axis, canToggle, setAxis } = useCurrentPodAxis();
  if (!canToggle) return null;
  return (
    <div
      role="tablist"
      aria-label="Pod grouping"
      className="inline-flex items-center rounded-md border border-[#2a2a2a] bg-[#0d0d0d] p-0.5 font-mono text-[10px] uppercase tracking-wider"
    >
      {(["editorial", "growth"] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          role="tab"
          aria-selected={axis === kind}
          onClick={() => setAxis(kind)}
          title={
            kind === "editorial"
              ? "Group charts by Editorial Pod"
              : "Group charts by Growth Pod"
          }
          className={
            "rounded-sm px-2 py-1 transition-colors " +
            (axis === kind
              ? "bg-[#1f1f1f] text-white"
              : "text-[#606060] hover:text-[#C4BCAA]")
          }
        >
          {kind === "editorial" ? "Editorial" : "Growth"}
        </button>
      ))}
    </div>
  );
}
