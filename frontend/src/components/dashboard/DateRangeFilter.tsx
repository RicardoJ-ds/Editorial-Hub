"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Calendar as CalendarIcon, ChevronLeft, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";

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

type View = "years" | "months";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const YEARS = [2022, 2023, 2024, 2025, 2026, 2027];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Slider spans every month covered by YEARS. Index 0 = Jan of YEARS[0],
// last index = Dec of YEARS[last].
const SLIDER_START_YEAR = YEARS[0];
const SLIDER_MONTH_COUNT = YEARS.length * 12;

function idxToMonthStart(idx: number): Date {
  const clamped = Math.max(0, Math.min(SLIDER_MONTH_COUNT - 1, idx));
  return new Date(SLIDER_START_YEAR + Math.floor(clamped / 12), clamped % 12, 1);
}
function idxToMonthEnd(idx: number): Date {
  const clamped = Math.max(0, Math.min(SLIDER_MONTH_COUNT - 1, idx));
  return new Date(SLIDER_START_YEAR + Math.floor(clamped / 12), (clamped % 12) + 1, 0);
}
function dateToIdx(d: Date): number {
  return (d.getFullYear() - SLIDER_START_YEAR) * 12 + d.getMonth();
}

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

// ---------------------------------------------------------------------------
// Dual-handle month slider (keeps click-grid intact, adds drag-based selection)
// ---------------------------------------------------------------------------

function MonthRangeSlider({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<"from" | "to" | null>(null);
  const maxIdx = SLIDER_MONTH_COUNT - 1;

  const fromIdx = value.type === "range" && value.from ? dateToIdx(value.from) : 0;
  const toIdx = value.type === "range" && value.to ? dateToIdx(value.to) : maxIdx;

  const idxFromPointer = (clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(maxIdx, Math.round(ratio * maxIdx)));
  };

  const updateRange = (next: { from?: number; to?: number }) => {
    const nextFrom = next.from ?? fromIdx;
    const nextTo = next.to ?? toIdx;
    const a = Math.min(nextFrom, nextTo);
    const b = Math.max(nextFrom, nextTo);
    onChange({ type: "range", from: idxToMonthStart(a), to: idxToMonthEnd(b) });
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const idx = idxFromPointer(e.clientX);
      if (drag === "from") updateRange({ from: idx });
      else updateRange({ to: idx });
    };
    const up = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, fromIdx, toIdx]);

  // Click on track: move nearest thumb to that spot
  const onTrackPointerDown = (e: React.PointerEvent) => {
    const idx = idxFromPointer(e.clientX);
    const distFrom = Math.abs(idx - fromIdx);
    const distTo = Math.abs(idx - toIdx);
    const which: "from" | "to" = distFrom <= distTo ? "from" : "to";
    if (which === "from") updateRange({ from: idx });
    else updateRange({ to: idx });
    setDrag(which);
  };

  const pct = (idx: number) => (maxIdx === 0 ? 0 : (idx / maxIdx) * 100);

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[9px] font-mono text-[#606060] uppercase tracking-wider">Drag to pick a range</p>
        <p className="text-[10px] font-mono text-[#42CA80]">
          {fmtShort(idxToMonthStart(fromIdx))} – {fmtShort(idxToMonthEnd(toIdx))}
        </p>
      </div>
      <div
        ref={trackRef}
        onPointerDown={onTrackPointerDown}
        className="relative h-10 flex items-center cursor-pointer touch-none"
      >
        {/* Track background — thicker bar so drag target is big */}
        <div className="absolute inset-x-0 h-2 bg-[#1e1e1e] rounded-full" />
        {/* Active fill */}
        <div
          className="absolute h-2 bg-[#42CA80]/60 rounded-full"
          style={{ left: `${pct(Math.min(fromIdx, toIdx))}%`, right: `${100 - pct(Math.max(fromIdx, toIdx))}%` }}
        />
        {/* Thumbs — larger hit area with visible ring on hover/drag */}
        {(["from", "to"] as const).map((handle) => {
          const idx = handle === "from" ? fromIdx : toIdx;
          const active = drag === handle;
          return (
            <div
              key={handle}
              onPointerDown={(e) => { e.stopPropagation(); setDrag(handle); }}
              role="slider"
              aria-valuemin={0}
              aria-valuemax={maxIdx}
              aria-valuenow={idx}
              tabIndex={0}
              className={cn(
                "absolute -translate-x-1/2 w-5 h-5 rounded-full bg-[#42CA80] border-2 border-[#0a0a0a] cursor-grab transition-shadow hover:shadow-[0_0_0_3px_rgba(66,202,128,0.2)]",
                active && "cursor-grabbing shadow-[0_0_0_5px_rgba(66,202,128,0.28)] scale-110",
              )}
              style={{ left: `${pct(idx)}%` }}
            />
          );
        })}
      </div>
      {/* Year ticks */}
      <div className="relative h-3 mt-1">
        {YEARS.map((y, i) => (
          <span
            key={y}
            className="absolute -translate-x-1/2 text-[9px] font-mono text-[#606060]"
            style={{ left: `${(i / (YEARS.length - 1)) * 100}%` }}
          >
            {String(y).slice(2)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("months");
  const [year, setYear] = useState(new Date().getFullYear());
  const [anim, setAnim] = useState("");
  const [animKey, setAnimKey] = useState(0);
  // Range-building state while in month view: first click sets start, second
  // click sets end. Reset by clicking the same month again or via Clear.
  const [rangeAnchor, setRangeAnchor] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const isActive = value.type === "range";

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

  // Reset on open — default to month view
  useEffect(() => {
    if (open) {
      setView("months");
      setAnim("");
      setRangeAnchor(null);
    }
  }, [open]);

  const selectRange = (from: Date, to: Date, close = false) => {
    onChange({ type: "range", from, to });
    if (close) setTimeout(() => setOpen(false), 150);
  };

  /** Two-click month range builder:
   *  1st click → anchor the start, mark the month
   *  2nd click → finalize the range from min(anchor, click) through end of max(anchor, click)
   *  Clicking the same month resets.
   *  Panel stays open after selection — user closes it by clicking outside,
   *  Esc, or the Clear button. Gives them room to tweak the range. */
  const handleMonthClick = (i: number) => {
    if (rangeAnchor === null) {
      setRangeAnchor(i);
      selectRange(new Date(year, i, 1), new Date(year, i + 1, 0));
      return;
    }
    if (rangeAnchor === i) {
      // Same month — lock in as a single-month range.
      selectRange(new Date(year, i, 1), new Date(year, i + 1, 0));
      setRangeAnchor(null);
      return;
    }
    const startMonth = Math.min(rangeAnchor, i);
    const endMonth = Math.max(rangeAnchor, i);
    selectRange(new Date(year, startMonth, 1), new Date(year, endMonth + 1, 0));
    setRangeAnchor(null);
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
        <div className="absolute top-full left-0 z-50 mt-2 rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] shadow-2xl drf-panel-in" style={{ width: 340 }}>

          {/* Nav bar */}
          <div className="flex items-center h-10 px-3 border-b border-[#1e1e1e]">
            {view !== "years" ? (
              <button
                type="button"
                onClick={() => goTo("years", "out")}
                className="flex items-center gap-1 text-[11px] font-mono text-[#606060] hover:text-white transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                {String(year)}
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
                onClick={() => { onChange({ type: "all" }); setRangeAnchor(null); setOpen(false); }}
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
                <div className="grid grid-cols-3 gap-1.5">
                  {YEARS.map((y) => {
                    const isCurrent = y === new Date().getFullYear();
                    const isInRange = value.from && value.to && value.from.getFullYear() <= y && value.to.getFullYear() >= y;
                    return (
                      <button
                        key={y}
                        type="button"
                        onClick={() => { setYear(y); goTo("months", "in"); }}
                        className={cn(
                          "group relative flex flex-col items-center justify-center rounded-md py-2 transition-all duration-200 border",
                          isInRange
                            ? "bg-[#42CA80]/10 text-[#42CA80] border-[#42CA80]/25"
                            : "bg-[#111] text-[#C4BCAA] border-[#1e1e1e] hover:bg-[#1a1a1a] hover:text-white hover:border-[#333]"
                        )}
                      >
                        <span className="text-sm font-mono font-bold leading-none">{y}</span>
                        {isCurrent && <span className="text-[8px] font-mono text-[#42CA80] mt-0.5 leading-none">current</span>}
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
                <p className="text-[9px] font-mono text-[#606060] text-center">
                  Click a month to pick it. Click a second month to make a range.
                </p>
                <div className="grid grid-cols-4 gap-1.5">
                  {MONTHS.map((m, i) => {
                    const monthStart = new Date(year, i, 1);
                    const monthEnd = new Date(year, i + 1, 0);
                    const isInRange = value.from && value.to && monthEnd >= value.from && monthStart <= value.to;
                    const isAnchor = rangeAnchor === i;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => handleMonthClick(i)}
                        className={cn(
                          "flex flex-col items-center justify-center rounded-md py-1.5 transition-all duration-200 border",
                          isAnchor
                            ? "bg-[#42CA80]/25 text-[#65FFAA] border-[#42CA80] ring-1 ring-[#42CA80]/40"
                            : isInRange
                              ? "bg-[#42CA80]/10 text-[#42CA80] border-[#42CA80]/25"
                              : "bg-[#111] text-[#C4BCAA] border-[#1e1e1e] hover:bg-[#1a1a1a] hover:text-white hover:border-[#333]"
                        )}
                      >
                        <span className="text-[11px] font-mono font-semibold leading-none">{m}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Range slider — alternative to two-click grid selection */}
                <div className="border-t border-[#1e1e1e] pt-3">
                  <MonthRangeSlider value={value} onChange={onChange} />
                </div>

                {/* Quick presets — same list as the Years view so users get to them without navigating back */}
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

                {/* Select full year */}
                <div className="border-t border-[#1e1e1e] pt-2.5 flex items-center justify-between">
                  <p className="text-[9px] font-mono text-[#606060]">Or select the full year</p>
                  <button
                    type="button"
                    onClick={() => {
                      selectRange(new Date(year, 0, 1), new Date(year, 11, 31));
                      setRangeAnchor(null);
                    }}
                    className="flex items-center gap-1 text-[10px] font-mono text-[#42CA80] hover:text-[#65FFAA] transition-colors"
                  >
                    <Check className="h-3 w-3" />
                    All of {year}
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
