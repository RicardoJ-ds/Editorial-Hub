"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { SyncAllModal } from "@/components/data-management/SyncAllModal";
import { apiGet } from "@/lib/api";
import { useCurrentPodAxis } from "@/lib/podAxisClient";

// Routes that group data by pod and benefit from the Editorial / Growth
// switcher. Other pages (Admin, Data Management, Capacity Planning) hide
// the toggle — it's not actionable there and adds visual noise.
const POD_AXIS_ROUTES = new Set(["/overview", "/editorial-clients", "/team-kpis"]);

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
      {/* PodAxisToggle moved into FilterBar so it sits next to the date
          range. Still exported below for direct callers. */}
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
 *  so every chart subscribed via `useCurrentPodAxis` re-renders.
 *
 *  Visual: segmented control with a sliding indicator pill. The active
 *  pill rides via framer-motion `layoutId`, so changing the selection
 *  animates the green highlight across instead of a hard color swap.
 *  Each option also gets its own hover ring + axis-tinted active color
 *  (Graphite green for Editorial, sky-blue for Growth) so admins can
 *  glance at the badge and know which axis is live. */
export function PodAxisToggle({ label }: { label?: string } = {}) {
  const { axis, canToggle, setAxis } = useCurrentPodAxis();
  const pathname = usePathname();
  // Hide outside the dashboards — the toggle has no effect on Admin,
  // Data Management, or Capacity Planning pages and was just adding chrome.
  if (!canToggle) return null;
  if (!pathname || !POD_AXIS_ROUTES.has(pathname)) return null;
  const options = [
    {
      kind: "editorial" as const,
      label: "Editorial",
      hint: "Group charts by Editorial Pod",
      // Graphite primary green tint when active.
      activeBg: "bg-[#42CA80]/15",
      activeText: "text-[#65FFAA]",
      activeRing: "ring-[#65FFAA]/30",
    },
    {
      kind: "growth" as const,
      label: "Growth",
      hint: "Group charts by Growth Pod",
      // Sky-blue tint distinguishes Growth from Editorial at a glance.
      activeBg: "bg-[#4ECBE5]/15",
      activeText: "text-[#4ECBE5]",
      activeRing: "ring-[#4ECBE5]/30",
    },
  ];
  const inner = (
    <div
      role="tablist"
      aria-label="Pod grouping"
      className="relative inline-flex items-center rounded-md border border-[#2a2a2a] bg-[#0d0d0d] p-0.5 font-mono text-[10px] uppercase tracking-wider"
    >
      {options.map((opt) => {
        const active = axis === opt.kind;
        return (
          <button
            key={opt.kind}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setAxis(opt.kind)}
            title={opt.hint}
            className={
              "relative z-10 rounded-sm px-2.5 py-1 transition-colors duration-200 " +
              (active
                ? opt.activeText
                : "text-[#606060] hover:text-[#C4BCAA]")
            }
          >
            {active && (
              <motion.span
                layoutId="pod-axis-indicator"
                aria-hidden
                transition={{ type: "spring", stiffness: 360, damping: 32 }}
                className={
                  "absolute inset-0 rounded-sm ring-1 " +
                  `${opt.activeBg} ${opt.activeRing}`
                }
              />
            )}
            <span className="relative z-10">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );

  if (!label) return inner;
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
        {label}
      </span>
      {inner}
    </div>
  );
}
