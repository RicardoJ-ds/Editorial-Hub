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
  /** Technical provenance — parsed into Sheet / Spreadsheet / Fields bullets.
   *  Format: "Sheet: 'name' — Spreadsheet: name. Description of derivation."
   *  Or just free text for simpler sources. */
  source: string;
  /** Short bullets explaining how to read the chart. Rendered FIRST in the
   *  tooltip under a "How to read it" header, because it's the most useful
   *  thing for a reader scanning the chart for the first time. Each item is
   *  one short sentence — aim for 2–4 bullets total. */
  shows?: string[];
  className?: string;
}

interface ParsedPart {
  label: string;
  /** Single-value entry (Sheet, Spreadsheet). */
  value?: string;
  /** Multi-value entry rendered as a bulleted list (Fields). */
  bullets?: string[];
}

/** Split a prose Fields string into one bullet per sentence. Splits on a
 *  period followed by whitespace followed by a capital letter so abbrevs
 *  like "vs." or "e.g." don't trigger a split. */
function fieldsToBullets(text: string): string[] {
  return text
    .split(/\.\s+(?=[A-Z])/)
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter(Boolean);
}

/**
 * Parses source string like:
 * "Sheet: 'Editorial SOW overview' — Spreadsheet: Editorial Capacity Planning. Some description."
 * Rendered in Spreadsheet → Sheet → Fields order — spreadsheet is the
 * broadest scope (the file) so it reads top-down.
 */
function parseSource(source: string): ParsedPart[] {
  const parts: ParsedPart[] = [];

  const ssMatch = source.match(/Spreadsheet:\s*(.+?)(?:\.\s*|$)/);
  const sheetMatch = source.match(/Sheet:\s*(.+?)(?:\s*—\s*|$)/);
  const descMatch = source.match(/Spreadsheet:\s*.+?\.\s*(.+)$/);

  if (ssMatch) {
    const val = ssMatch[1].replace(/\s*\([^)]*\)\s*$/, "").trim();
    parts.push({ label: "Spreadsheet", value: val });
  }
  if (sheetMatch) {
    parts.push({ label: "Sheet", value: sheetMatch[1].trim() });
  }
  if (descMatch) {
    parts.push({ label: "Fields", bullets: fieldsToBullets(descMatch[1].trim()) });
  } else if (!sheetMatch && !ssMatch) {
    parts.push({ label: "Source", value: source });
  }

  return parts;
}

export function DataSourceBadge({ type, source, shows, className }: DataSourceBadgeProps) {
  const isLive = type === "live";
  const parsed = parseSource(source);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider cursor-default select-none",
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
            {shows && shows.length > 0 && (
              <div style={{ borderTop: "1px solid #2a2a2a", padding: "10px 16px" }}>
                <p className="text-[11px] font-mono uppercase tracking-wider text-[#909090] mb-1.5">
                  How to read it
                </p>
                <ul className="space-y-1">
                  {shows.map((line, i) => (
                    <li
                      key={i}
                      className="text-xs text-[#E0DACC] leading-relaxed flex gap-2"
                    >
                      <span className="text-[#42CA80] shrink-0 leading-relaxed">•</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div style={{ borderTop: "1px solid #2a2a2a", padding: "10px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
              {parsed.map((p, i) => (
                <div key={i} style={{ display: "flex", gap: 8 }}>
                  <span className="text-[11px] font-mono text-[#909090] shrink-0" style={{ minWidth: 80 }}>{p.label}:</span>
                  {p.bullets && p.bullets.length > 0 ? (
                    <ul className="space-y-0.5 flex-1">
                      {p.bullets.map((b, j) => (
                        <li key={j} className="text-xs text-[#C4BCAA] leading-relaxed flex gap-2">
                          <span className="text-[#606060] shrink-0 leading-relaxed">•</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-xs text-[#C4BCAA] leading-relaxed">{p.value}</span>
                  )}
                </div>
              ))}
            </div>
            <div style={{ borderTop: "1px solid #2a2a2a", padding: "6px 16px" }}>
              <span className="text-[10px] italic text-[#909090]">
                {isLive ? "Pulled from Google Sheets via service account" : "Generated mock data — enter real values via Data Management"}
              </span>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
