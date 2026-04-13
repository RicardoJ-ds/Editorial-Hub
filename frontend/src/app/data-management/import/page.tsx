"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { apiGet, apiPost } from "@/lib/api";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  XCircle,
  ArrowLeft,
  ArrowRight,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SheetInfo {
  name: string;
  row_count: number;
  description: string;
}

interface PreviewData {
  sheet_name: string;
  headers: string[];
  rows: string[][];
  total_rows: number;
}

interface ImportResultItem {
  sheet: string;
  rows_parsed: number;
  rows_imported: number;
  success: boolean;
  errors: string[];
}

interface ImportResponse {
  results: ImportResultItem[];
  total_imported: number;
  all_ok: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEPS = ["Connect", "Select Sheets", "Preview", "Import", "Complete"] as const;

/** Exact-match importable sheet names */
const IMPORTABLE_EXACT = [
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
];

/** Prefix-match importable sheet names (capacity plan versions, KPI scores variants) */
const IMPORTABLE_PREFIXES = [
  "ET CP 2026",
  "Monthly KPI Scores",
  "[Mock] Monthly KPI Scores",
  "Master Tracker - Notion Database",
];

function isImportable(name: string): boolean {
  if (IMPORTABLE_EXACT.includes(name)) return true;
  return IMPORTABLE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** Group sheets by source — capacity plan matched by prefix */
function getSheetGroup(name: string): string | null {
  const ecpSheets = [
    "Editorial SOW overview",
    "Delivered vs Invoiced v2",
    "Model Assumptions",
    "Editorial Operating Model",
    "Delivery Schedules",
    "Editorial Engagement Requirements",
    "Meta Calendar Month Deliveries",
  ];
  if (ecpSheets.includes(name) || name.startsWith("ET CP 2026") || name.includes("Monthly KPI Scores")) {
    return "Editorial Capacity Planning";
  }
  if (name.startsWith("AI Monitoring")) return "Writer AI Monitoring";
  if (name.startsWith("Master Tracker")) return "Master Tracker";
  if (name === "Notion Database") return "Master Tracker";
  return null;
}

// ---------------------------------------------------------------------------
// Step Indicator Component
// ---------------------------------------------------------------------------

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center justify-center px-4 py-6">
      {STEPS.map((label, i) => {
        const isCompleted = i < currentStep;
        const isActive = i === currentStep;
        const isFuture = i > currentStep;

        return (
          <div key={label} className="flex items-center">
            {/* Circle */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors",
                  isCompleted && "bg-[#42CA80] text-white",
                  isActive && "bg-[#42CA80] text-white",
                  isFuture && "bg-[#333333] text-[#606060]"
                )}
              >
                {isCompleted ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={cn(
                  "mt-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]",
                  isCompleted || isActive ? "text-[#42CA80]" : "text-[#606060]"
                )}
              >
                {label}
              </span>
            </div>

            {/* Connecting line */}
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  "mx-2 h-px w-12 sm:w-16 md:w-24 transition-colors",
                  i < currentStep ? "bg-[#42CA80]" : "bg-[#333333]"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Connect
// ---------------------------------------------------------------------------

function StepConnect({
  onSheetsLoaded,
}: {
  onSheetsLoaded: (sheets: SheetInfo[]) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const handleLoadSheets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sheets = await apiGet<SheetInfo[]>("/api/migrate/sheets");
      setConnected(true);
      // Brief delay so user sees the checkmark before advancing
      setTimeout(() => onSheetsLoaded(sheets), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to Google Sheets");
    } finally {
      setLoading(false);
    }
  }, [onSheetsLoaded]);

  return (
    <div className="mx-auto max-w-lg">
      <div className="rounded-xl border border-[#2a2a2a] bg-[#161616] p-8">
        {/* Logo + Title */}
        <div className="flex flex-col items-center text-center">
          <Image
            src="/graphite-logo.png"
            alt="Graphite"
            width={48}
            height={48}
            className="rounded-lg"
          />
          <h3 className="mt-4 text-lg font-semibold text-white">
            Google Sheets Connection
          </h3>
          <p className="mt-2 text-sm text-[#C4BCAA]">
            Connected to Editorial Planning Spreadsheet
          </p>
          <p className="mt-2 max-w-xs truncate font-mono text-xs text-[#606060]">
            1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
          </p>
        </div>

        {/* Status */}
        {connected && (
          <div className="mt-6 flex items-center justify-center gap-2 text-[#42CA80]">
            <CheckCircle2 className="h-5 w-5" />
            <span className="text-sm font-medium">Sheets loaded successfully</span>
          </div>
        )}

        {error && (
          <Alert variant="destructive" className="mt-6">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Connection Failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Action */}
        <div className="mt-6 flex justify-center">
          <Button
            onClick={handleLoadSheets}
            disabled={loading || connected}
            className="bg-[#42CA80] text-black hover:bg-[#42CA80]/80"
            size="lg"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {connected ? "Connected" : error ? "Retry" : "Load Available Sheets"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Select Sheets
// ---------------------------------------------------------------------------

function StepSelectSheets({
  sheets,
  onNext,
  onBack,
}: {
  sheets: SheetInfo[];
  onNext: (selected: string[]) => void;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => {
    return new Set(sheets.filter((s) => isImportable(s.name)).map((s) => s.name));
  });

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const allSelected = sheets.length > 0 && selected.size === sheets.length;
  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sheets.map((s) => s.name)));
    }
  };

  // isImportable is defined at module level

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header with Select All */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Select Sheets to Import</h3>
        <button
          onClick={toggleAll}
          className="font-mono text-xs font-medium text-[#42CA80] hover:text-[#65FFAA] transition-colors"
        >
          {allSelected ? "Deselect All" : "Select All"}
        </button>
      </div>

      {/* Sheet list — dynamically grouped by source */}
      <div className="space-y-6">
        {(() => {
          const groups: Record<string, SheetInfo[]> = {};
          const ungrouped: SheetInfo[] = [];
          for (const sheet of sheets) {
            const group = getSheetGroup(sheet.name);
            if (group) {
              (groups[group] ??= []).push(sheet);
            } else {
              ungrouped.push(sheet);
            }
          }

          const renderSheet = (sheet: SheetInfo) => {
            const canImport = isImportable(sheet.name);
            const checked = selected.has(sheet.name);
            return (
              <label
                key={sheet.name}
                className={cn(
                  "flex cursor-pointer items-center gap-4 rounded-xl border p-4 transition-colors",
                  checked
                    ? "border-[#42CA80]/40 bg-[#42CA80]/5"
                    : "border-[#2a2a2a] bg-[#161616] hover:border-[#2a2a2a]/80",
                  !canImport && "opacity-60"
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(sheet.name)}
                  disabled={!canImport}
                  className="h-4 w-4 rounded border-[#2a2a2a] bg-[#161616] text-[#42CA80] accent-[#42CA80]"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-white truncate">{sheet.name}</span>
                    <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
                      {sheet.row_count} rows
                    </Badge>
                    {!canImport && (
                      <span className="font-mono text-[10px] text-[#606060]">Preview only</span>
                    )}
                  </div>
                  {sheet.description && (
                    <p className="mt-1 text-sm text-[#C4BCAA] truncate">{sheet.description}</p>
                  )}
                </div>
              </label>
            );
          };

          return (
            <>
              {Object.entries(groups).map(([group, groupSheets]) => (
                <div key={group}>
                  <h4 className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-[#42CA80]">
                    {group}
                  </h4>
                  <div className="space-y-2">{groupSheets.map(renderSheet)}</div>
                </div>
              ))}
              {ungrouped.length > 0 && (
                <div>
                  <h4 className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-[#999]">
                    Other Sheets
                  </h4>
                  <div className="space-y-2">{ungrouped.map(renderSheet)}</div>
                </div>
              )}
            </>
          );
        })()}
      </div>


      {/* Navigation */}
      <div className="flex items-center justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button
          onClick={() => onNext(Array.from(selected))}
          disabled={selected.size === 0}
          className="bg-[#42CA80] text-black hover:bg-[#42CA80]/80"
        >
          Next
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Preview
// ---------------------------------------------------------------------------

function StepPreview({
  selectedSheets,
  onBack,
  onStartImport,
}: {
  selectedSheets: string[];
  onBack: () => void;
  onStartImport: () => void;
}) {
  const [previews, setPreviews] = useState<Record<string, PreviewData>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  const loadPreviews = useCallback(async () => {
    setLoaded(true);
    const loadingSet = new Set(selectedSheets);
    setLoading(loadingSet);

    const results: Record<string, PreviewData> = {};
    const errs: Record<string, string> = {};

    await Promise.allSettled(
      selectedSheets.map(async (sheetName) => {
        try {
          const data = await apiGet<PreviewData>(
            `/api/migrate/preview/${encodeURIComponent(sheetName)}`
          );
          results[sheetName] = data;
        } catch (err) {
          errs[sheetName] = err instanceof Error ? err.message : "Failed to load preview";
        } finally {
          setLoading((prev) => {
            const next = new Set(prev);
            next.delete(sheetName);
            return next;
          });
        }
      })
    );

    setPreviews(results);
    setErrors(errs);
  }, [selectedSheets]);

  // Auto-load previews on mount
  if (!loaded) {
    loadPreviews();
  }

  return (
    <div className="space-y-8">
      <h3 className="text-lg font-semibold text-white">Preview Data</h3>

      {selectedSheets.map((sheetName) => {
        const preview = previews[sheetName];
        const isLoading = loading.has(sheetName);
        const error = errors[sheetName];

        return (
          <div
            key={sheetName}
            className="rounded-xl border border-[#2a2a2a] bg-[#161616] overflow-hidden"
          >
            {/* Sheet heading */}
            <div className="border-b border-[#2a2a2a] px-4 py-3 flex items-center justify-between">
              <h4 className="font-medium text-white">{sheetName}</h4>
              {preview && (
                <span className="font-mono text-xs text-[#606060]">
                  {preview.total_rows} total rows
                </span>
              )}
            </div>

            {/* Content */}
            {isLoading && (
              <div className="space-y-2 p-4">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-3/4" />
              </div>
            )}

            {error && (
              <div className="p-4">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Preview Error</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              </div>
            )}

            {preview && !isLoading && (
              <ScrollArea className="w-full">
                <div className="min-w-max">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-[#2a2a2a] hover:bg-transparent">
                        {preview.headers.map((header, i) => (
                          <TableHead
                            key={i}
                            className="ds-table-header h-8 px-3"
                          >
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
                              {cell || "\u2014"}
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
          </div>
        );
      })}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button
          onClick={onStartImport}
          disabled={loading.size > 0}
          className="bg-[#42CA80] text-black hover:bg-[#42CA80]/80"
        >
          Start Import
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4: Importing
// ---------------------------------------------------------------------------

function StepImporting({
  selectedSheets,
  onComplete,
}: {
  selectedSheets: string[];
  onComplete: (response: ImportResponse) => void;
}) {
  const [sheetStatuses, setSheetStatuses] = useState<
    Record<string, "pending" | "importing" | "done" | "error">
  >(() => Object.fromEntries(selectedSheets.map((s) => [s, "pending"])));
  const [results, setResults] = useState<Record<string, ImportResultItem>>({});
  const [progress, setProgress] = useState(0);
  const [started, setStarted] = useState(false);

  const runImport = useCallback(async () => {
    setStarted(true);
    const allResults: ImportResultItem[] = [];
    let allOk = true;

    // Import sheets ONE AT A TIME to avoid timeout
    for (let i = 0; i < selectedSheets.length; i++) {
      const sheet = selectedSheets[i];
      setSheetStatuses((prev) => ({ ...prev, [sheet]: "importing" }));

      try {
        const response = await apiPost<ImportResponse>("/api/migrate/import", {
          sheets: [sheet],
        });
        const result = response.results[0];
        allResults.push(result);
        setResults((prev) => ({ ...prev, [sheet]: result }));
        setSheetStatuses((prev) => ({
          ...prev,
          [sheet]: result.success ? "done" : "error",
        }));
        if (!result.success) allOk = false;
      } catch (err) {
        const errorResult: ImportResultItem = {
          sheet,
          rows_parsed: 0,
          rows_imported: 0,
          success: false,
          errors: [err instanceof Error ? err.message : "Import failed"],
        };
        allResults.push(errorResult);
        setResults((prev) => ({ ...prev, [sheet]: errorResult }));
        setSheetStatuses((prev) => ({ ...prev, [sheet]: "error" }));
        allOk = false;
      }

      setProgress(((i + 1) / selectedSheets.length) * 100);
    }

    // Auto-advance after all sheets processed
    const finalResponse: ImportResponse = {
      results: allResults,
      total_imported: allResults.reduce((sum, r) => sum + r.rows_imported, 0),
      all_ok: allOk,
    };
    setTimeout(() => onComplete(finalResponse), 800);
  }, [selectedSheets, onComplete]);

  // Auto-start
  if (!started) {
    runImport();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h3 className="text-lg font-semibold text-white">Importing Data</h3>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs text-[#606060]">Overall Progress</span>
          <span className="font-mono text-xs text-[#C4BCAA]">
            {Object.values(sheetStatuses).filter((s) => s === "done" || s === "error").length} of{" "}
            {selectedSheets.length} sheets
          </span>
        </div>
        <Progress value={progress}>
          <span className="sr-only">{Math.round(progress)}%</span>
        </Progress>
      </div>

      {/* Per-sheet status */}
      <div className="space-y-2">
        {selectedSheets.map((sheetName) => {
          const status = sheetStatuses[sheetName];
          const result = results[sheetName];

          return (
            <div
              key={sheetName}
              className={cn(
                "flex items-center gap-4 rounded-xl border p-4 transition-colors",
                status === "done" && "border-[#42CA80]/30 bg-[#42CA80]/5",
                status === "error" && "border-[#ED6958]/30 bg-[#ED6958]/5",
                (status === "pending" || status === "importing") &&
                  "border-[#2a2a2a] bg-[#161616]"
              )}
            >
              {/* Status icon */}
              <div className="shrink-0">
                {status === "importing" && (
                  <Loader2 className="h-5 w-5 animate-spin text-[#42CA80]" />
                )}
                {status === "pending" && (
                  <div className="h-5 w-5 rounded-full border-2 border-[#333333]" />
                )}
                {status === "done" && (
                  <CheckCircle2 className="h-5 w-5 text-[#42CA80]" />
                )}
                {status === "error" && (
                  <XCircle className="h-5 w-5 text-[#ED6958]" />
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <span className="font-medium text-white">{sheetName}</span>
                {result && status === "done" && (
                  <span className="ml-3 font-mono text-xs text-[#42CA80]">
                    {result.rows_imported} rows imported
                  </span>
                )}
                {result && status === "error" && result.errors.length > 0 && (
                  <span className="ml-3 font-mono text-xs text-[#ED6958]">
                    {result.errors[0]}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5: Complete
// ---------------------------------------------------------------------------

function StepComplete({
  response,
  onImportAgain,
}: {
  response: ImportResponse;
  onImportAgain: () => void;
}) {
  const successCount = response.results.filter((r) => r.success).length;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Success banner */}
      <div
        className={cn(
          "flex items-center gap-4 rounded-xl border p-6",
          response.all_ok
            ? "border-[#42CA80]/30 bg-[#42CA80]/5"
            : "border-[#ED6958]/30 bg-[#ED6958]/5"
        )}
      >
        {response.all_ok ? (
          <CheckCircle2 className="h-8 w-8 text-[#42CA80] shrink-0" />
        ) : (
          <AlertCircle className="h-8 w-8 text-[#ED6958] shrink-0" />
        )}
        <div>
          <h3 className="text-lg font-semibold text-white">
            {response.all_ok ? "Import Complete" : "Import Completed with Errors"}
          </h3>
          <p className="mt-1 text-sm text-[#C4BCAA]">
            Imported {response.total_imported.toLocaleString()} total rows across{" "}
            {successCount} sheet{successCount !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Results table */}
      <div className="rounded-xl border border-[#2a2a2a] bg-[#161616] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-[#2a2a2a] hover:bg-transparent">
              <TableHead className="ds-table-header h-8 px-3">Sheet</TableHead>
              <TableHead className="ds-table-header h-8 px-3">Rows Parsed</TableHead>
              <TableHead className="ds-table-header h-8 px-3">Rows Imported</TableHead>
              <TableHead className="ds-table-header h-8 px-3">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {response.results.map((result) => (
              <TableRow key={result.sheet} className="border-[#2a2a2a]">
                <TableCell className="px-3 font-medium text-white">
                  {result.sheet}
                </TableCell>
                <TableCell className="px-3 font-mono text-xs text-[#C4BCAA]">
                  {result.rows_parsed.toLocaleString()}
                </TableCell>
                <TableCell className="px-3 font-mono text-xs text-[#C4BCAA]">
                  {result.rows_imported.toLocaleString()}
                </TableCell>
                <TableCell className="px-3">
                  {result.success ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium badge-success">
                      <CheckCircle2 className="h-3 w-3" />
                      Success
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium badge-error">
                      <XCircle className="h-3 w-3" />
                      Failed
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Error details */}
      {response.results.some((r) => r.errors.length > 0) && (
        <div className="space-y-2">
          {response.results
            .filter((r) => r.errors.length > 0)
            .map((r) => (
              <Alert key={r.sheet} variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{r.sheet}</AlertTitle>
                <AlertDescription>
                  {r.errors.map((e, i) => (
                    <p key={i}>{e}</p>
                  ))}
                </AlertDescription>
              </Alert>
            ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-4">
        <Button variant="outline" onClick={onImportAgain}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Import Again
        </Button>
        <Link href="/editorial-clients">
          <Button className="bg-[#42CA80] text-black hover:bg-[#42CA80]/80">
            View Editorial Clients Dashboard
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ImportWizardPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);
  const [importResponse, setImportResponse] = useState<ImportResponse | null>(null);

  const handleSheetsLoaded = useCallback((loadedSheets: SheetInfo[]) => {
    setSheets(loadedSheets);
    setCurrentStep(1);
  }, []);

  const handleSheetsSelected = useCallback((selected: string[]) => {
    setSelectedSheets(selected);
    setCurrentStep(2);
  }, []);

  const handleStartImport = useCallback(() => {
    setCurrentStep(3);
  }, []);

  const handleImportComplete = useCallback((response: ImportResponse) => {
    setImportResponse(response);
    setCurrentStep(4);
  }, []);

  const handleImportAgain = useCallback(() => {
    setCurrentStep(0);
    setSheets([]);
    setSelectedSheets([]);
    setImportResponse(null);
  }, []);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">Import Data</h2>
        <p className="mt-1 text-sm text-[#C4BCAA]">
          Import data from Google Sheets into the Editorial Hub.
        </p>
      </div>

      {/* Step indicator */}
      <StepIndicator currentStep={currentStep} />

      {/* Step content */}
      <div className="min-h-[400px]">
        {currentStep === 0 && (
          <StepConnect onSheetsLoaded={handleSheetsLoaded} />
        )}

        {currentStep === 1 && (
          <StepSelectSheets
            sheets={sheets}
            onNext={handleSheetsSelected}
            onBack={() => setCurrentStep(0)}
          />
        )}

        {currentStep === 2 && (
          <StepPreview
            selectedSheets={selectedSheets}
            onBack={() => setCurrentStep(1)}
            onStartImport={handleStartImport}
          />
        )}

        {currentStep === 3 && (
          <StepImporting
            selectedSheets={selectedSheets}
            onComplete={handleImportComplete}
          />
        )}

        {currentStep === 4 && importResponse && (
          <StepComplete
            response={importResponse}
            onImportAgain={handleImportAgain}
          />
        )}
      </div>
    </div>
  );
}
