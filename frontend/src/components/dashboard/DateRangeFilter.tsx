"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Calendar as CalendarIcon, ChevronLeft, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DateRange as RDPDateRange } from "react-day-picker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DateRange {
  type: "all" | "range";
  from?: Date;
  to?: Date;
}

export interface DateRangeFilterProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

type View = "years" | "months" | "days";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const YEARS = [2022, 2023, 2024, 2025, 2026, 2027];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const PRESETS = [
  { label: "This Year", from: new Date(2026, 0, 1), to: new Date(2026, 11, 31) },
  { label: "Last Year", from: new Date(2025, 0, 1), to: new Date(2025, 11, 31) },
  { label: "Q1 2026", from: new Date(2026, 0, 1), to: new Date(2026, 2, 31) },
  { label: "Q2 2026", from: new Date(2026, 3, 1), to: new Date(2026, 5, 30) },
  { label: "Last 6 months", from: new Date(2025, 9, 1), to: new Date(2026, 2, 31) },
  { label: "Last 12 months", from: new Date(2025, 3, 1), to: new Date(2026, 2, 31) },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtShort(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatLabel(range: DateRange): string {
  if (range.type === "all" || !range.from) return "All Time";
  if (!range.to || range.from.getTime() === range.to.getTime()) return fmtShort(range.from);
  // Same month
  if (range.from.getMonth() === range.to.getMonth() && range.from.getFullYear() === range.to.getFullYear()) {
    return fmtShort(range.from);
  }
  return `${fmtShort(range.from)} – ${fmtShort(range.to)}`;
}

// ---------------------------------------------------------------------------
// Styles injected once
// ---------------------------------------------------------------------------

const STYLES = `
@keyframes drfZoomIn{from{opacity:0;transform:scale(.94) translateY(4px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes drfZoomOut{from{opacity:0;transform:scale(1.06) translateY(-4px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes drfPanelIn{from{opacity:0;transform:translateY(-8px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
.drf-zoom-in{animation:drfZoomIn .22s ease-out both}
.drf-zoom-out{animation:drfZoomOut .22s ease-out both}
.drf-panel-in{animation:drfPanelIn .25s cubic-bezier(.16,1,.3,1) both}

/* Calendar dark theme overrides for date range filter */
.drf-cal [data-slot=calendar]{--cell-size:2rem}
.drf-cal button[data-day]{color:#C4BCAA;border-radius:6px;transition:all .15s ease}
.drf-cal button[data-day]:hover{background:#1F1F1F !important;color:#fff !important;transform:scale(1.1)}
.drf-cal button[data-range-start=true],.drf-cal button[data-range-end=true]{background:#42CA80 !important;color:#000 !important;font-weight:700;box-shadow:0 0 12px rgba(66,202,128,.35)}
.drf-cal button[data-range-middle=true]{background:rgba(66,202,128,.12) !important;color:#42CA80 !important;border-radius:0}
.drf-cal button[data-selected-single=true]{background:#42CA80 !important;color:#000 !important;font-weight:700;box-shadow:0 0 12px rgba(66,202,128,.35)}
.drf-cal .rdp-range_start,.drf-cal .rdp-range_end{background:rgba(66,202,128,.12) !important}
.drf-cal .rdp-range_middle{background:rgba(66,202,128,.08) !important}
.drf-cal .rdp-today button[data-day]{border:1px solid #42CA80;color:#42CA80}
.drf-cal .rdp-weekday{color:#606060;font-size:11px}
.drf-cal .rdp-month_caption{color:#C4BCAA;font-size:13px}
.drf-cal .rdp-button_previous,.drf-cal .rdp-button_next{color:#606060}
.drf-cal .rdp-button_previous:hover,.drf-cal .rdp-button_next:hover{color:#fff;background:#1F1F1F}
.drf-cal .rdp-outside button[data-day]{color:#333}
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("years");
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(0);
  const [anim, setAnim] = useState("");
  const [animKey, setAnimKey] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const isActive = value.type === "range";

  const rdpSelected: RDPDateRange | undefined =
    value.from && value.to ? { from: value.from, to: value.to }
      : value.from ? { from: value.from, to: undefined } : undefined;

  // Zoom helpers
  const goTo = useCallback((v: View, dir: "in" | "out") => {
    setAnim(dir === "in" ? "drf-zoom-in" : "drf-zoom-out");
    setAnimKey((k) => k + 1);
    requestAnimationFrame(() => setView(v));
  }, []);

  // Close handlers
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open]);

  // Reset on open — default to day view
  useEffect(() => { if (open) { setView("days"); setAnim(""); } }, [open]);

  const selectRange = (from: Date, to: Date, close = false) => {
    onChange({ type: "range", from, to });
    if (close) setTimeout(() => setOpen(false), 150);
  };

  return (
    <div className="relative" ref={panelRef}>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      {/* Trigger chip */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all duration-200 border",
          isActive
            ? "bg-[#42CA80]/10 text-[#42CA80] border-[#42CA80]/20"
            : "bg-[#161616] text-[#C4BCAA] border-[#2a2a2a] hover:bg-[#1F1F1F] hover:text-white"
        )}
      >
        <CalendarIcon className="h-3 w-3 shrink-0" />
        <span className="font-mono text-[11px]">{formatLabel(value)}</span>
        {isActive && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onChange({ type: "all" }); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onChange({ type: "all" }); } }}
            className="ml-0.5 hover:text-white transition-colors"
          >
            <X className="h-3 w-3" />
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div className="absolute top-full left-0 z-50 mt-2 rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] shadow-2xl drf-panel-in" style={{ width: view === "days" ? "auto" : 340 }}>

          {/* Nav bar */}
          <div className="flex items-center h-10 px-3 border-b border-[#1e1e1e]">
            {view !== "years" ? (
              <button
                type="button"
                onClick={() => goTo(view === "days" ? "months" : "years", "out")}
                className="flex items-center gap-1 text-[11px] font-mono text-[#606060] hover:text-white transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                {view === "days" ? `${MONTHS[month]} ${year}` : String(year)}
              </button>
            ) : (
              <span className="text-[11px] font-mono font-semibold text-[#C4BCAA] uppercase tracking-wider">Select period</span>
            )}
            <div className="ml-auto flex items-center gap-2">
              {isActive && (
                <span className="text-[9px] font-mono text-[#42CA80] bg-[#42CA80]/10 rounded-full px-2 py-0.5">{formatLabel(value)}</span>
              )}
              <button
                type="button"
                onClick={() => { onChange({ type: "all" }); setOpen(false); }}
                className="text-[10px] font-mono text-[#606060] hover:text-white transition-colors"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Animated content area */}
          <div key={animKey} className={anim} style={{ transformOrigin: "top center" }}>

            {/* ===== YEARS ===== */}
            {view === "years" && (
              <div className="p-3 space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  {YEARS.map((y) => {
                    const isCurrent = y === new Date().getFullYear();
                    const isInRange = value.from && value.to && value.from.getFullYear() <= y && value.to.getFullYear() >= y;
                    return (
                      <button
                        key={y}
                        type="button"
                        onClick={() => { setYear(y); goTo("months", "in"); }}
                        className={cn(
                          "group relative flex flex-col items-center justify-center rounded-lg py-4 transition-all duration-200 border",
                          isInRange
                            ? "bg-[#42CA80]/10 text-[#42CA80] border-[#42CA80]/25"
                            : "bg-[#111] text-[#C4BCAA] border-[#1e1e1e] hover:bg-[#1a1a1a] hover:text-white hover:border-[#333]"
                        )}
                      >
                        <span className="text-xl font-mono font-bold">{y}</span>
                        {isCurrent && <span className="text-[8px] font-mono text-[#42CA80] mt-0.5">current</span>}
                        {/* Double-click hint */}
                        <span className="absolute bottom-1 text-[7px] font-mono text-[#333] group-hover:text-[#606060] transition-colors">
                          dbl-click to select
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Presets */}
                <div className="border-t border-[#1e1e1e] pt-2.5">
                  <p className="text-[8px] font-mono text-[#333] uppercase tracking-widest mb-2">Quick select</p>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => selectRange(p.from, p.to)}
                        className="rounded-full px-2.5 py-1 text-[10px] font-mono text-[#888] bg-[#111] border border-[#1e1e1e] hover:bg-[#1a1a1a] hover:text-white hover:border-[#333] transition-all duration-150"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ===== MONTHS ===== */}
            {view === "months" && (
              <div className="p-3 space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  {MONTHS.map((m, i) => {
                    const monthStart = new Date(year, i, 1);
                    const monthEnd = new Date(year, i + 1, 0);
                    const isInRange = value.from && value.to && monthEnd >= value.from && monthStart <= value.to;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => { setMonth(i); goTo("days", "in"); }}
                        onDoubleClick={() => selectRange(new Date(year, i, 1), new Date(year, i + 1, 0), true)}
                        className={cn(
                          "flex flex-col items-center justify-center rounded-lg py-3 transition-all duration-200 border",
                          isInRange
                            ? "bg-[#42CA80]/10 text-[#42CA80] border-[#42CA80]/25"
                            : "bg-[#111] text-[#C4BCAA] border-[#1e1e1e] hover:bg-[#1a1a1a] hover:text-white hover:border-[#333]"
                        )}
                      >
                        <span className="text-sm font-mono font-semibold">{m}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Select full year */}
                <div className="border-t border-[#1e1e1e] pt-2.5 flex items-center justify-between">
                  <p className="text-[9px] font-mono text-[#606060]">Or select the full year</p>
                  <button
                    type="button"
                    onClick={() => selectRange(new Date(year, 0, 1), new Date(year, 11, 31), true)}
                    className="flex items-center gap-1 text-[10px] font-mono text-[#42CA80] hover:text-[#65FFAA] transition-colors"
                  >
                    <Check className="h-3 w-3" />
                    All of {year}
                  </button>
                </div>
              </div>
            )}

            {/* ===== DAYS ===== */}
            {view === "days" && (
              <div className="p-3 drf-cal">
                <Calendar
                  mode="range"
                  selected={rdpSelected}
                  onSelect={(range) => {
                    if (!range?.from) return;
                    onChange({ type: "range", from: range.from, to: range.to ?? range.from });
                  }}
                  numberOfMonths={2}
                  defaultMonth={new Date(year, month)}
                  className="bg-transparent"
                />

                {/* Actions */}
                <div className="mt-2 pt-2.5 border-t border-[#1e1e1e] flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => selectRange(new Date(year, month, 1), new Date(year, month + 1, 0))}
                    className="text-[10px] font-mono text-[#606060] hover:text-[#42CA80] transition-colors"
                  >
                    Select all of {MONTHS_FULL[month]}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-1.5 text-[11px] font-mono font-medium text-black bg-[#42CA80] hover:bg-[#65FFAA] rounded-full px-4 py-1.5 transition-all duration-200 shadow-md shadow-[#42CA80]/20"
                  >
                    <Check className="h-3 w-3" />
                    Apply
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function dateRangeLabel(range: DateRange): string {
  return formatLabel(range);
}
