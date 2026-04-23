"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { apiGet, apiPost } from "@/lib/api";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SyncResultDetail,
  type ImportResultItem as SyncResultItem,
} from "./SyncResultDetail";

interface SheetInfo {
  name: string;
  row_count: number;
  description: string;
}

interface ImportResponse {
  results: SyncResultItem[];
  total_imported: number;
  all_ok: boolean;
}

type SheetStatus = "pending" | "importing" | "done" | "error";

// Mirrors the wizard's isImportable() so the one-click modal syncs the same
// sheets the wizard would have auto-selected — nothing more, nothing less.
const IMPORTABLE_EXACT = new Set([
  "Editorial SOW overview",
  "Delivered vs Invoiced v2",
  "Model Assumptions",
  "Editorial Operating Model",
  "Delivery Schedules",
  "Editorial Engagement Requirements",
  "Meta Calendar Month Deliveries",
  "AI Monitoring - Data",
  "AI Monitoring - Rewrites",
  "AI Monitoring - Flags",
  "AI Monitoring - Surfer Usage",
  "Master Tracker - Cumulative",
  "Master Tracker - Goals vs Delivery",
  "Notion Database",
  "Growth Pods",
]);
const IMPORTABLE_PREFIXES = [
  "ET CP 2026",
  "Monthly KPI Scores",
  "[Mock] Monthly KPI Scores",
];
function isImportable(name: string): boolean {
  if (IMPORTABLE_EXACT.has(name)) return true;
  return IMPORTABLE_PREFIXES.some((p) => name.startsWith(p));
}

export function SyncAllModal({
  open,
  onOpenChange,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: (allOk: boolean) => void;
}) {
  const [phase, setPhase] = useState<"loading" | "importing" | "done" | "error">(
    "loading",
  );
  const [sheets, setSheets] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<Record<string, SheetStatus>>({});
  const [results, setResults] = useState<SyncResultItem[]>([]);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const runIdRef = useRef(0);

  const runSync = useCallback(async () => {
    const runId = ++runIdRef.current;
    setPhase("loading");
    setResults([]);
    setStatuses({});
    setFatalError(null);

    let importable: string[];
    try {
      const all = await apiGet<SheetInfo[]>("/api/migrate/sheets");
      importable = all.map((s) => s.name).filter(isImportable);
    } catch (err) {
      if (runId !== runIdRef.current) return;
      setFatalError(err instanceof Error ? err.message : "Failed to list sheets");
      setPhase("error");
      return;
    }

    if (runId !== runIdRef.current) return;
    setSheets(importable);
    setStatuses(Object.fromEntries(importable.map((s) => [s, "pending"])));
    setPhase("importing");

    const acc: SyncResultItem[] = [];
    for (const sheet of importable) {
      if (runId !== runIdRef.current) return;
      setStatuses((prev) => ({ ...prev, [sheet]: "importing" }));
      try {
        const resp = await apiPost<ImportResponse>("/api/migrate/import", {
          sheets: [sheet],
        });
        const r = resp.results[0];
        acc.push(r);
        setResults([...acc]);
        setStatuses((prev) => ({
          ...prev,
          [sheet]: r.success ? "done" : "error",
        }));
      } catch (err) {
        const errResult: SyncResultItem = {
          sheet,
          rows_parsed: 0,
          rows_imported: 0,
          success: false,
          errors: [err instanceof Error ? err.message : "Import failed"],
        };
        acc.push(errResult);
        setResults([...acc]);
        setStatuses((prev) => ({ ...prev, [sheet]: "error" }));
      }
    }

    if (runId !== runIdRef.current) return;
    const allOk = acc.every((r) => r.success);
    setPhase("done");
    // Single fire at the end so dashboards do one clean refetch instead of
    // flickering through N intermediate states.
    window.dispatchEvent(new Event("data-synced"));
    onComplete?.(allOk);
  }, [onComplete]);

  // Kick off when the modal opens; cancel if it closes mid-run by bumping
  // the runId so any in-flight iteration short-circuits.
  useEffect(() => {
    if (open) {
      runSync();
    } else {
      runIdRef.current++;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const doneCount = Object.values(statuses).filter(
    (s) => s === "done" || s === "error",
  ).length;
  const progressPct = sheets.length > 0 ? (doneCount / sheets.length) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl bg-[#0d0d0d] border-[#2a2a2a]">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
            {phase === "done" ? "Sync Complete" : "Syncing Google Sheets"}
          </DialogTitle>
        </DialogHeader>

        {phase === "loading" && (
          <div className="flex items-center gap-3 py-8 justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-[#42CA80]" />
            <span className="text-sm text-[#C4BCAA]">Fetching sheet list…</span>
          </div>
        )}

        {phase === "error" && fatalError && (
          <div className="py-6 text-center">
            <XCircle className="h-8 w-8 text-[#ED6958] mx-auto mb-2" />
            <p className="font-mono text-sm text-[#ED6958]">{fatalError}</p>
          </div>
        )}

        {(phase === "importing" || phase === "done") && sheets.length > 0 && (
          <div className="space-y-4 max-h-[min(70vh,640px)] overflow-y-auto pr-1">
            {/* Overall progress */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-[#606060] uppercase tracking-wider">
                  Overall Progress
                </span>
                <span className="font-mono text-[11px] text-[#C4BCAA]">
                  {doneCount} of {sheets.length} sheets
                </span>
              </div>
              <Progress value={progressPct}>
                <span className="sr-only">{Math.round(progressPct)}%</span>
              </Progress>
            </div>

            {/* Per-sheet status while importing; swap to the rich detail view
                once every sheet has a result. */}
            {phase === "importing" ? (
              <div className="space-y-1.5">
                {sheets.map((sheet) => {
                  const status = statuses[sheet] ?? "pending";
                  const result = results.find((r) => r.sheet === sheet);
                  return (
                    <div
                      key={sheet}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
                        status === "done" && "border-[#42CA80]/30 bg-[#42CA80]/5",
                        status === "error" && "border-[#ED6958]/30 bg-[#ED6958]/5",
                        (status === "pending" || status === "importing") &&
                          "border-[#2a2a2a] bg-[#161616]",
                      )}
                    >
                      <div className="shrink-0">
                        {status === "importing" && (
                          <Loader2 className="h-4 w-4 animate-spin text-[#42CA80]" />
                        )}
                        {status === "pending" && (
                          <div className="h-4 w-4 rounded-full border-2 border-[#333]" />
                        )}
                        {status === "done" && (
                          <CheckCircle2 className="h-4 w-4 text-[#42CA80]" />
                        )}
                        {status === "error" && (
                          <XCircle className="h-4 w-4 text-[#ED6958]" />
                        )}
                      </div>
                      <span className="flex-1 min-w-0 truncate font-medium text-white text-sm">
                        {sheet}
                      </span>
                      {result && status === "done" && (
                        <span className="shrink-0 font-mono text-[11px] text-[#42CA80] tabular-nums">
                          {result.rows_imported.toLocaleString()} rows
                        </span>
                      )}
                      {result && status === "error" && result.errors[0] && (
                        <span className="shrink-0 truncate font-mono text-[11px] text-[#ED6958] max-w-[200px]">
                          {result.errors[0]}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <SyncResultDetail results={results} />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
