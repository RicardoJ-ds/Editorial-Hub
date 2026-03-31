"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type DataOrigin = "live" | "mock";

interface DataSourceBadgeProps {
  type: DataOrigin;
  /** Plain text description — parsed into structured bullets automatically.
   *  Format: "Sheet: 'name' — Spreadsheet: name. Description."
   *  Or just free text for simpler sources. */
  source: string;
  className?: string;
}

/**
 * Parses source string like:
 * "Sheet: 'Editorial SOW overview' — Spreadsheet: Editorial Capacity Planning. Some description."
 * into structured parts.
 */
function parseSource(source: string) {
  const parts: { label: string; value: string }[] = [];

  // Extract Sheet name(s)
  const sheetMatch = source.match(/Sheet:\s*(.+?)(?:\s*—\s*|$)/);
  if (sheetMatch) {
    parts.push({ label: "Sheet", value: sheetMatch[1].trim() });
  }

  // Extract Spreadsheet name
  const ssMatch = source.match(/Spreadsheet:\s*(.+?)(?:\.\s*|$)/);
  if (ssMatch) {
    // Remove the ID in parentheses if present
    const val = ssMatch[1].replace(/\s*\([^)]*\)\s*$/, "").trim();
    parts.push({ label: "Spreadsheet", value: val });
  }

  // Extract remaining description (everything after the last period following Spreadsheet)
  const descMatch = source.match(/Spreadsheet:\s*.+?\.\s*(.+)$/);
  if (descMatch) {
    parts.push({ label: "Fields", value: descMatch[1].trim() });
  } else if (!sheetMatch && !ssMatch) {
    // Fallback: if no structured format, use entire source as description
    parts.push({ label: "Source", value: source });
  }

  return parts;
}

export function DataSourceBadge({ type, source, className }: DataSourceBadgeProps) {
  const isLive = type === "live";
  const parsed = parseSource(source);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider cursor-default select-none",
              isLive ? "text-[#42CA80]/70" : "text-[#F5A623]/70",
              className
            )}
          >
            <span
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                isLive ? "bg-[#42CA80]" : "bg-[#F5A623]"
              )}
            />
            {isLive ? "live" : "sim"}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="!block bg-[#0d0d0d] border border-[#2a2a2a] text-xs !p-0 !w-auto !max-w-none"
        >
          <div style={{ display: "flex", flexDirection: "column", width: 420 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px" }}>
              <span className={cn("inline-block h-2 w-2 rounded-full shrink-0", isLive ? "bg-[#42CA80]" : "bg-[#F5A623]")} />
              <span className="font-semibold text-white text-[12px]">{isLive ? "Live Data" : "Simulated Data"}</span>
            </div>
            <div style={{ borderTop: "1px solid #2a2a2a", padding: "10px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
              {parsed.map((p, i) => (
                <div key={i} style={{ display: "flex", gap: 8 }}>
                  <span className="text-[10px] font-mono text-[#606060] shrink-0" style={{ minWidth: 80 }}>{p.label}:</span>
                  <span className="text-[11px] text-[#C4BCAA] leading-relaxed">{p.value}</span>
                </div>
              ))}
            </div>
            <div style={{ borderTop: "1px solid #2a2a2a", padding: "6px 16px" }}>
              <span className="text-[9px] italic text-[#606060]">
                {isLive ? "Pulled from Google Sheets via service account" : "Generated mock data — enter real values via Data Management"}
              </span>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
