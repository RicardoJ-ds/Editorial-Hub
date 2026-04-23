"use client";

import { useCallback, useState } from "react";
import {
  CheckCircle2,
  AlertCircle,
  XCircle,
  ChevronRight,
  Loader2,
  Minus,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { apiGet } from "@/lib/api";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TabDetail {
  tab_name: string;
  month_year: string;
  rows_parsed: number;
  rows_imported: number;
  status: "imported" | "skipped" | "failed" | string;
  skipped_reason?: string | null;
  preview_key?: string | null;
}

export interface ImportResultItem {
  sheet: string;
  rows_parsed: number;
  rows_imported: number;
  success: boolean;
  errors: string[];
  details?: TabDetail[];
}

interface PreviewData {
  sheet_name: string;
  headers: string[];
  rows: string[][];
  total_rows: number;
}

// ---------------------------------------------------------------------------
// Tab preview row — lazy loads preview data on first expand
// ---------------------------------------------------------------------------

function TabRow({ detail }: { detail: TabDetail }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expandable = detail.status !== "skipped";

  const toggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    if (next && !preview && !loading && expandable) {
      setLoading(true);
      setError(null);
      try {
        const key = detail.preview_key ?? detail.tab_name;
        const data = await apiGet<PreviewData>(
          `/api/migrate/preview/${encodeURIComponent(key)}`
        );
        setPreview(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load preview");
      } finally {
        setLoading(false);
      }
    }
  }, [open, preview, loading, expandable, detail.tab_name]);

  const statusChip = (() => {
    if (detail.status === "imported") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-medium badge-success">
          <CheckCircle2 className="h-3 w-3" />
          Imported
        </span>
      );
    }
    if (detail.status === "skipped") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#333333] px-2 py-0.5 font-mono text-[10px] font-medium text-[#909090]">
          <Minus className="h-3 w-3" />
          Skipped
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-medium badge-error">
        <XCircle className="h-3 w-3" />
        Failed
      </span>
    );
  })();

  return (
    <div className="border-b border-[#2a2a2a] last:border-b-0">
      <button
        type="button"
        onClick={toggle}
        disabled={!expandable}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
          expandable && "hover:bg-[#1F1F1F]",
          !expandable && "cursor-default opacity-70"
        )}
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-[#606060] transition-transform",
            open && "rotate-90",
            !expandable && "invisible"
          )}
        />
        <span className="flex-1 font-medium text-white text-sm">
          {detail.month_year}
        </span>
        <span className="font-mono text-[11px] text-[#606060] hidden sm:inline">
          {detail.tab_name}
        </span>
        {detail.status === "imported" && (
          <span className="font-mono text-[11px] text-[#42CA80]">
            {detail.rows_imported.toLocaleString()} rows
          </span>
        )}
        {detail.status === "skipped" && detail.skipped_reason && (
          <span className="font-mono text-[11px] text-[#606060] italic max-w-[220px] truncate">
            {detail.skipped_reason}
          </span>
        )}
        {statusChip}
      </button>

      {open && expandable && (
        <div className="border-t border-[#2a2a2a] bg-[#0d0d0d] px-4 py-3">
          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-5/6" />
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Preview failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {preview && !loading && (
            <ScrollArea className="w-full">
              <div className="min-w-max">
                <Table>
                  <TableHeader>
                    <TableRow className="border-[#2a2a2a] hover:bg-transparent">
                      {preview.headers.map((header, i) => (
                        <TableHead key={i} className="ds-table-header h-8 px-3">
                          {header}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.slice(0, 10).map((row, ri) => (
                      <TableRow key={ri} className="border-[#2a2a2a]">
                        {row.map((cell, ci) => (
                          <TableCell
                            key={ci}
                            className="px-3 font-mono text-xs text-[#C4BCAA]"
                          >
                            {cell || "—"}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          )}
          {preview && (
            <p className="mt-2 font-mono text-[10px] text-[#606060]">
              Showing first {Math.min(10, preview.rows.length)} of{" "}
              {preview.total_rows.toLocaleString()} total rows in the sheet tab.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheet result row (summary + expandable tab list if details present)
// ---------------------------------------------------------------------------

function SheetResultRow({
  result,
  defaultOpen = false,
}: {
  result: ImportResultItem;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasTabs = result.details && result.details.length > 0;
  // If no per-tab details, allow expanding to preview the sheet itself
  const canPreviewSheet = !hasTabs && result.success;

  const toggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    if (next && canPreviewSheet && !preview && !loading) {
      setLoading(true);
      setError(null);
      try {
        const data = await apiGet<PreviewData>(
          `/api/migrate/preview/${encodeURIComponent(result.sheet)}`
        );
        setPreview(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load preview");
      } finally {
        setLoading(false);
      }
    }
  }, [open, canPreviewSheet, preview, loading, result.sheet]);

  const importedTabs = (result.details ?? []).filter((d) => d.status === "imported").length;
  const skippedTabs = (result.details ?? []).filter((d) => d.status === "skipped").length;

  const expandable = hasTabs || canPreviewSheet;

  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#161616] overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        disabled={!expandable}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
          expandable && "hover:bg-[#1F1F1F]",
          !expandable && "cursor-default"
        )}
      >
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-[#606060] transition-transform",
            open && "rotate-90",
            !expandable && "invisible"
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-white break-words" title={result.sheet}>
            {result.sheet}
          </div>
          {hasTabs && (
            <div className="mt-0.5 font-mono text-[11px] text-[#606060]">
              {importedTabs} tab{importedTabs !== 1 ? "s" : ""} imported
              {skippedTabs > 0 && ` · ${skippedTabs} skipped`}
            </div>
          )}
        </div>
        <div className="hidden sm:flex items-center gap-4 font-mono text-[11px] text-[#C4BCAA]">
          <span>
            <span className="text-[#606060]">parsed </span>
            {result.rows_parsed.toLocaleString()}
          </span>
          <span>
            <span className="text-[#606060]">imported </span>
            <span className="text-[#42CA80]">
              {result.rows_imported.toLocaleString()}
            </span>
          </span>
        </div>
        {result.success ? (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-medium badge-success">
            <CheckCircle2 className="h-3 w-3" />
            Success
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-medium badge-error">
            <XCircle className="h-3 w-3" />
            Failed
          </span>
        )}
      </button>

      {open && hasTabs && (
        <div className="border-t border-[#2a2a2a] bg-[#0d0d0d]">
          {result.details!.map((d) => (
            <TabRow key={d.tab_name} detail={d} />
          ))}
        </div>
      )}

      {open && canPreviewSheet && (
        <div className="border-t border-[#2a2a2a] bg-[#0d0d0d] px-4 py-3">
          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-5/6" />
            </div>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Preview failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {preview && !loading && (
            <ScrollArea className="w-full">
              <div className="min-w-max">
                <Table>
                  <TableHeader>
                    <TableRow className="border-[#2a2a2a] hover:bg-transparent">
                      {preview.headers.map((header, i) => (
                        <TableHead key={i} className="ds-table-header h-8 px-3">
                          {header}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.slice(0, 10).map((row, ri) => (
                      <TableRow key={ri} className="border-[#2a2a2a]">
                        {row.map((cell, ci) => (
                          <TableCell
                            key={ci}
                            className="px-3 font-mono text-xs text-[#C4BCAA]"
                          >
                            {cell || "—"}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          )}
          {preview && (
            <p className="mt-2 font-mono text-[10px] text-[#606060]">
              Showing first {Math.min(10, preview.rows.length)} of{" "}
              {preview.total_rows.toLocaleString()} total rows.
            </p>
          )}
        </div>
      )}

      {result.errors.length > 0 && (
        <div className="border-t border-[#2a2a2a] bg-[#ED6958]/5 px-4 py-2">
          {result.errors.map((e, i) => (
            <p key={i} className="font-mono text-[11px] text-[#ED6958]">
              {e}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-level sync result detail
// ---------------------------------------------------------------------------

export function SyncResultDetail({
  results,
  title,
}: {
  results: ImportResultItem[];
  title?: string;
}) {
  const totalImported = results.reduce((sum, r) => sum + r.rows_imported, 0);
  const totalParsed = results.reduce((sum, r) => sum + r.rows_parsed, 0);
  const allOk = results.every((r) => r.success);
  const successCount = results.filter((r) => r.success).length;

  // If there's only one result and it has tab-level details, default it open.
  const autoOpen = results.length === 1 && (results[0].details?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "flex items-center gap-4 rounded-xl border p-5",
          allOk
            ? "border-[#42CA80]/30 bg-[#42CA80]/5"
            : "border-[#ED6958]/30 bg-[#ED6958]/5"
        )}
      >
        {allOk ? (
          <CheckCircle2 className="h-7 w-7 text-[#42CA80] shrink-0" />
        ) : (
          <AlertCircle className="h-7 w-7 text-[#ED6958] shrink-0" />
        )}
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-white">
            {title ?? (allOk ? "Sync Complete" : "Sync Completed with Errors")}
          </h3>
          <p className="mt-1 text-xs text-[#C4BCAA]">
            {totalImported.toLocaleString()} rows imported ·{" "}
            {totalParsed.toLocaleString()} rows parsed · {successCount} of{" "}
            {results.length} sheet{results.length !== 1 ? "s" : ""} succeeded
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {results.map((r) => (
          <SheetResultRow key={r.sheet} result={r} defaultOpen={autoOpen} />
        ))}
      </div>
    </div>
  );
}
