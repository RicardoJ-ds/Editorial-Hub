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

interface ImportResponse {
  results: SyncResultItem[];
  total_imported: number;
  all_ok: boolean;
}

// One step in the canonical sync plan, served by the backend's sync manifest
// (`GET /api/migrate/sync-plan`). The frontend no longer hardcodes which
// sheets sync — the backend is the single source of truth, so adding an
// importer there makes it appear here automatically.
interface PlanStep {
  key: string;
  label: string;
  scope: string;
}

interface SyncPlanResponse {
  scope: string;
  steps: PlanStep[];
}

interface MonthlyResyncStatus {
  due: boolean;
  current_month: string | null;
}

type SheetStatus = "pending" | "importing" | "done" | "error";

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
  const [plan, setPlan] = useState<PlanStep[]>([]);
  const [scope, setScope] = useState<string>("current");
  const [statuses, setStatuses] = useState<Record<string, SheetStatus>>({});
  const [stepInfo, setStepInfo] = useState<
    Record<string, { rows: number; error?: string }>
  >({});
  const [results, setResults] = useState<SyncResultItem[]>([]);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const runIdRef = useRef(0);

  const runSync = useCallback(async () => {
    const runId = ++runIdRef.current;
    setPhase("loading");
    setResults([]);
    setStatuses({});
    setStepInfo({});
    setFatalError(null);

    // 1. First sync of a new editorial month → run the FULL scope (= SYNC +
    //    Re-sync Past Months) so the just-closed month's final numbers land.
    //    Otherwise just the current sheets. Non-fatal if the check fails.
    let resolvedScope = "current";
    try {
      const status = await apiGet<MonthlyResyncStatus>(
        "/api/migrate/monthly-resync-status",
      );
      if (status?.due) resolvedScope = "full";
    } catch {
      // ignore — fall back to current-month sync
    }
    if (runId !== runIdRef.current) return;
    setScope(resolvedScope);

    // 2. Pull the plan from the backend (the single source of truth).
    let steps: PlanStep[];
    try {
      const resp = await apiGet<SyncPlanResponse>(
        `/api/migrate/sync-plan?scope=${resolvedScope}`,
      );
      steps = resp.steps ?? [];
    } catch (err) {
      if (runId !== runIdRef.current) return;
      setFatalError(err instanceof Error ? err.message : "Failed to load sync plan");
      setPhase("error");
      return;
    }
    if (runId !== runIdRef.current) return;
    if (steps.length === 0) {
      setFatalError("Sync plan is empty — nothing to sync.");
      setPhase("error");
      return;
    }

    setPlan(steps);
    setStatuses(Object.fromEntries(steps.map((s) => [s.key, "pending"])));
    setPhase("importing");

    // 3. Run each step in order via the manifest's executor.
    const acc: SyncResultItem[] = [];
    for (const step of steps) {
      if (runId !== runIdRef.current) return;
      setStatuses((prev) => ({ ...prev, [step.key]: "importing" }));
      try {
        const resp = await apiPost<ImportResponse>("/api/migrate/sync-step", {
          key: step.key,
        });
        for (const r of resp.results) acc.push(r);
        setResults([...acc]);
        const rows = resp.results.reduce((a, r) => a + r.rows_imported, 0);
        const firstErr = resp.results.find((r) => !r.success)?.errors?.[0];
        setStepInfo((prev) => ({ ...prev, [step.key]: { rows, error: firstErr } }));
        setStatuses((prev) => ({
          ...prev,
          [step.key]: resp.all_ok ? "done" : "error",
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Step failed";
        acc.push({
          sheet: step.label,
          rows_parsed: 0,
          rows_imported: 0,
          success: false,
          errors: [message],
        });
        setResults([...acc]);
        setStepInfo((prev) => ({ ...prev, [step.key]: { rows: 0, error: message } }));
        setStatuses((prev) => ({ ...prev, [step.key]: "error" }));
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
  const progressPct = plan.length > 0 ? (doneCount / plan.length) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl bg-[#0d0d0d] border-[#2a2a2a]">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
            {phase === "done" ? "Sync Complete" : "Syncing Google Sheets"}
          </DialogTitle>
          {scope === "full" && phase !== "error" && (
            <p className="font-mono text-[11px] text-[#F5BC4E]">
              New month detected — also refreshing past months (last month&apos;s final numbers).
            </p>
          )}
        </DialogHeader>

        {phase === "loading" && (
          <div className="flex items-center gap-3 py-8 justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-[#42CA80]" />
            <span className="text-sm text-[#C4BCAA]">Building sync plan…</span>
          </div>
        )}

        {phase === "error" && fatalError && (
          <div className="py-6 text-center">
            <XCircle className="h-8 w-8 text-[#ED6958] mx-auto mb-2" />
            <p className="font-mono text-sm text-[#ED6958]">{fatalError}</p>
          </div>
        )}

        {(phase === "importing" || phase === "done") && plan.length > 0 && (
          <div className="space-y-4 max-h-[min(70vh,640px)] overflow-y-auto pr-1">
            {/* Overall progress */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-[#606060] uppercase tracking-wider">
                  Overall Progress
                </span>
                <span className="font-mono text-[11px] text-[#C4BCAA]">
                  {doneCount} of {plan.length} steps
                </span>
              </div>
              <Progress value={progressPct}>
                <span className="sr-only">{Math.round(progressPct)}%</span>
              </Progress>
            </div>

            {/* Per-step status while importing; swap to the rich detail view
                once every step has a result. */}
            {phase === "importing" ? (
              <div className="space-y-1.5">
                {plan.map((step) => {
                  const status = statuses[step.key] ?? "pending";
                  const info = stepInfo[step.key];
                  return (
                    <div
                      key={step.key}
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
                        {step.label}
                        {step.scope === "past" && (
                          <span className="ml-2 rounded-sm bg-[#F5BC4E]/15 px-1 py-px font-mono text-[9px] uppercase tracking-wider text-[#F5BC4E]">
                            past months
                          </span>
                        )}
                      </span>
                      {info && status === "done" && (
                        <span className="shrink-0 font-mono text-[11px] text-[#42CA80] tabular-nums">
                          {info.rows.toLocaleString()} rows
                        </span>
                      )}
                      {info?.error && status === "error" && (
                        <span className="shrink-0 truncate font-mono text-[11px] text-[#ED6958] max-w-[200px]">
                          {info.error}
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
