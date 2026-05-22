"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X, Check } from "lucide-react";
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
  /** Optional list of years (sorted asc) that have actual data. When
   *  supplied, the year picker grid, year stepper, and month slider are
   *  all bounded to this range so the user can't navigate to empty years
   *  (e.g. 2028 / 2029) where there's nothing to show. Defaults to a
   *  hardcoded multi-year span if not provided. */
  availableYears?: number[];
}

type View = "years" | "months";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_YEARS = [2022, 2023, 2024, 2025, 2026, 2027];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Slider helpers are parametrised by startYear / monthCount so the same
// component can adapt to whatever year range the data actually spans.

function idxToMonthStart(idx: number, startYear: number, count: number): Date {
  const clamped = Math.max(0, Math.min(count - 1, idx));
  return new Date(startYear + Math.floor(clamped / 12), clamped % 12, 1);
}
function idxToMonthEnd(idx: number, startYear: number, count: number): Date {
  const clamped = Math.max(0, Math.min(count - 1, idx));
  return new Date(startYear + Math.floor(clamped / 12), (clamped % 12) + 1, 0);
}
function dateToIdx(d: Date, startYear: number): number {
  return (d.getFullYear() - startYear) * 12 + d.getMonth();
}

function buildPresets(): { label: string; from: Date; to: Date }[] {
  // Computed relative to today so the list doesn't go stale year over year.
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth(); // 0-11
  const monthStart = (yr: number, mo: number) => new Date(yr, mo, 1);
  const monthEnd = (yr: number, mo: number) => new Date(yr, mo + 1, 0);
  // Current month
  const curStart = monthStart(y, m);
  const curEnd = monthEnd(y, m);
  // Last completed month
  const lastY = m === 0 ? y - 1 : y;
  const lastM = m === 0 ? 11 : m - 1;
  const lastStart = monthStart(lastY, lastM);
  const lastEnd = monthEnd(lastY, lastM);
  // Last 3 completed months (inclusive)
  const l3Cell = lastY * 12 + lastM - 2;
  const l3Start = monthStart(Math.floor(l3Cell / 12), l3Cell % 12);
  // Last 6 / 12 months (anchored to last completed month, like Last 3)
  const l6Cell = lastY * 12 + lastM - 5;
  const l6Start = monthStart(Math.floor(l6Cell / 12), l6Cell % 12);
  const l12Cell = lastY * 12 + lastM - 11;
  const l12Start = monthStart(Math.floor(l12Cell / 12), l12Cell % 12);
  // Year-anchored
  const thisYearStart = monthStart(y, 0);
  const thisYearEnd = monthEnd(y, 11);
  const lastYearStart = monthStart(y - 1, 0);
  const lastYearEnd = monthEnd(y - 1, 11);
  // Quarter-anchored (calendar quarters of current year)
  const q1Start = monthStart(y, 0);
  const q1End = monthEnd(y, 2);
  const q2Start = monthStart(y, 3);
  const q2End = monthEnd(y, 5);
  return [
    { label: "Current month", from: curStart, to: curEnd },
    { label: "Last month", from: lastStart, to: lastEnd },
    { label: "Last 3 months", from: l3Start, to: lastEnd },
    { label: "Last 6 months", from: l6Start, to: lastEnd },
    { label: "Last 12 months", from: l12Start, to: lastEnd },
    { label: "This Year", from: thisYearStart, to: thisYearEnd },
    { label: "Last Year", from: lastYearStart, to: lastYearEnd },
    { label: `Q1 ${y}`, from: q1Start, to: q1End },
    { label: `Q2 ${y}`, from: q2Start, to: q2End },
  ];
}

const PRESETS = buildPresets();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Is the user's current value an exact match for this preset? Used to
 *  highlight the active Quick Select chip — compare start + end at month
 *  resolution (presets always span whole-month boundaries). */
function isPresetActive(
  value: DateRange,
  preset: { from: Date; to: Date },
): boolean {
  if (value.type !== "range" || !value.from || !value.to) return false;
  const sameMonth = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  return sameMonth(value.from, preset.from) && sameMonth(value.to, preset.to);
}

/** Classify a (year, monthIdx 0-11) as past / current / future relative to
 *  today's date. Past = completed months (actuals). Current = in-progress
 *  month, still partly projected. Future = pure projection. */
function monthTense(
  year: number,
  monthIdx: number,
): "past" | "current" | "future" {
  const now = new Date();
  const cur = now.getFullYear() * 12 + now.getMonth();
  const cell = year * 12 + monthIdx;
  if (cell < cur) return "past";
  if (cell === cur) return "current";
  return "future";
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
  years,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
  years: number[];
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<"from" | "to" | null>(null);
  const startYear = years[0];
  const monthCount = years.length * 12;
  const maxIdx = monthCount - 1;

  const fromIdx = value.type === "range" && value.from ? dateToIdx(value.from, startYear) : 0;
  const toIdx = value.type === "range" && value.to ? dateToIdx(value.to, startYear) : maxIdx;

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
    onChange({ type: "range", from: idxToMonthStart(a, startYear, monthCount), to: idxToMonthEnd(b, startYear, monthCount) });
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
          {fmtShort(idxToMonthStart(fromIdx, startYear, monthCount))} – {fmtShort(idxToMonthEnd(toIdx, startYear, monthCount))}
        </p>
      </div>
      <div
        ref={trackRef}
        onPointerDown={onTrackPointerDown}
        className="relative h-10 flex items-center cursor-pointer touch-none"
      >
        {/* Track background — thicker bar so drag target is big. The base
            is muted gray (past); we overlay an amber sliver for the
            current month and a soft blue band for the future. */}
        <div className="absolute inset-x-0 h-2 bg-[#1e1e1e] rounded-full overflow-hidden">
          {(() => {
            // Compute current-month index + future-band start.
            const now = new Date();
            const curIdx = (now.getFullYear() - startYear) * 12 + now.getMonth();
            const total = monthCount - 1;
            const curPct = (curIdx / total) * 100;
            const nextPct = ((curIdx + 1) / total) * 100;
            return (
              <>
                {curIdx >= 0 && curIdx <= total && (
                  <div
                    className="absolute top-0 bottom-0 bg-[#F5BC4E]/30"
                    style={{ left: `${curPct}%`, width: `${Math.max(0.4, nextPct - curPct)}%` }}
                  />
                )}
                {curIdx + 1 <= total && (
                  <div
                    className="absolute top-0 bottom-0 bg-[#8FB5D9]/12"
                    style={{ left: `${nextPct}%`, right: 0 }}
                  />
                )}
              </>
            );
          })()}
        </div>
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
        {years.map((y, i) => (
          <span
            key={y}
            className="absolute -translate-x-1/2 text-[9px] font-mono text-[#606060]"
            style={{ left: `${(i / Math.max(1, years.length - 1)) * 100}%` }}
          >
            {String(y).slice(2)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function DateRangeFilter({ value, onChange, availableYears }: DateRangeFilterProps) {
  // Use the supplied year list when given; fall back to a sensible default
  // multi-year span otherwise. Sorted ascending — used by the year picker
  // grid, year stepper bounds, and month slider scale.
  const years = useMemo(() => {
    if (!availableYears || availableYears.length === 0) return DEFAULT_YEARS;
    return [...availableYears].sort((a, b) => a - b);
  }, [availableYears]);
  const yearMin = years[0];
  const yearMax = years[years.length - 1];
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("months");
  const [year, setYear] = useState(new Date().getFullYear());
  const [anim, setAnim] = useState("");
  const [animKey, setAnimKey] = useState(0);
  // Range-building state while in month view: first click sets start, second
  // click sets end. Anchor stores YEAR + MONTH so the user can navigate to a
  // different year between clicks and still form a multi-year range (iOS-
  // calendar-style). Reset by clicking the same month or via Clear.
  const [rangeAnchor, setRangeAnchor] = useState<{ year: number; month: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Dynamic horizontal alignment so the panel doesn't truncate when the
  // trigger sits near the right edge of the viewport. Measured on open.
  const [panelAlign, setPanelAlign] = useState<"left" | "right">("left");

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

  // Reset on open — default to month view. Also measure trigger position
  // so the panel can flip its horizontal anchor if it would overflow the
  // viewport to the right.
  useEffect(() => {
    if (open) {
      setView("months");
      setAnim("");
      setRangeAnchor(null);
      // Clamp viewed year to the available data range so we never land on
      // a year that's outside the data envelope (e.g. 2028 when nothing
      // ships past 2027).
      setYear((y) => Math.max(yearMin, Math.min(yearMax, y)));
      const trigger = triggerRef.current;
      if (trigger && typeof window !== "undefined") {
        const r = trigger.getBoundingClientRect();
        const PANEL_W = 340;
        const EDGE = 8;
        const wouldOverflowRight = r.left + PANEL_W > window.innerWidth - EDGE;
        setPanelAlign(wouldOverflowRight ? "right" : "left");
      }
    }
  }, [open, yearMin, yearMax]);

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
      setRangeAnchor({ year, month: i });
      selectRange(new Date(year, i, 1), new Date(year, i + 1, 0));
      return;
    }
    if (rangeAnchor.year === year && rangeAnchor.month === i) {
      // Same month — lock in as a single-month range.
      selectRange(new Date(year, i, 1), new Date(year, i + 1, 0));
      setRangeAnchor(null);
      return;
    }
    // Form range from anchor → click. May span multiple years (iOS-style):
    // the anchor is preserved across year navigation so users can pick
    // March 2025 → August 2026 by clicking the year header to zoom out,
    // picking 2026, and clicking August.
    const anchorCell = rangeAnchor.year * 12 + rangeAnchor.month;
    const clickCell = year * 12 + i;
    const fromCell = Math.min(anchorCell, clickCell);
    const toCell = Math.max(anchorCell, clickCell);
    const fromY = Math.floor(fromCell / 12);
    const fromM = fromCell % 12;
    const toY = Math.floor(toCell / 12);
    const toM = toCell % 12;
    selectRange(new Date(fromY, fromM, 1), new Date(toY, toM + 1, 0));
    setRangeAnchor(null);
  };

  return (
    <div className="relative" ref={panelRef}>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      {/* Trigger chip */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          // Fixed width sized to the longest variant ("Mmm YYYY – Mmm YYYY")
          // so the trigger doesn't reflow the filter row when the selection
          // changes between single-month, range, and "All Time". Icon
          // anchored left, X anchored right, label centered in between.
          "relative flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all duration-200 border whitespace-nowrap w-[210px]",
          isActive
            ? "bg-[#42CA80]/10 text-[#42CA80] border-[#42CA80]/20"
            : "bg-[#161616] text-[#C4BCAA] border-[#2a2a2a] hover:bg-[#1F1F1F] hover:text-white"
        )}
      >
        <CalendarIcon className="h-3 w-3 shrink-0" />
        <span className="flex-1 text-center font-mono text-[11px] truncate">
          {formatLabel(value)}
        </span>
        {isActive ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onChange({ type: "all" }); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onChange({ type: "all" }); } }}
            className="hover:text-white transition-colors"
          >
            <X className="h-3 w-3" />
          </span>
        ) : (
          <span className="h-3 w-3 shrink-0" aria-hidden />
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          className={cn(
            "absolute top-full z-50 mt-2 rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] shadow-2xl drf-panel-in",
            panelAlign === "right" ? "right-0" : "left-0",
          )}
          style={{ width: 340 }}
        >

          {/* Nav bar — no more year nav here; year picker lives inside
              the month selector now (right above the month grid). */}
          <div className="flex items-center h-10 px-3 border-b border-[#1e1e1e]">
            <span className="text-[11px] font-mono font-semibold text-[#C4BCAA] uppercase tracking-wider">Select period</span>
            <div className="ml-auto flex items-center gap-2">
              {rangeAnchor !== null && rangeAnchor.year !== year && view === "months" && (
                <span className="flex items-center gap-1 rounded-full bg-[#42CA80]/8 px-2 py-0.5 text-[9px] font-mono text-[#42CA80]">
                  <span className="inline-block h-1 w-1 rounded-full bg-[#42CA80]" />
                  Anchored {MONTHS[rangeAnchor.month]} {rangeAnchor.year}
                </span>
              )}
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
                  {years.map((y) => {
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
                {/* Quick select — first so common shortcuts are immediate.
                    Active preset gets the green selection palette; the
                    in-progress month-grid anchor is wiped so a preset
                    can't accidentally combine with a half-built range. */}
                <div>
                  <p className="text-[8px] font-mono text-[#333] uppercase tracking-widest mb-2">Quick select</p>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map((p) => {
                      const presetActive = isPresetActive(value, p);
                      return (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => {
                            setRangeAnchor(null);
                            selectRange(p.from, p.to);
                          }}
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[10px] font-mono border transition-all duration-150",
                            presetActive
                              ? "bg-[#42CA80]/15 text-[#42CA80] border-[#42CA80]/40 hover:bg-[#42CA80]/20"
                              : "bg-[#111] text-[#888] border-[#1e1e1e] hover:bg-[#1a1a1a] hover:text-white hover:border-[#333]",
                          )}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Range slider — drag to pick */}
                <div className="border-t border-[#1e1e1e] pt-3">
                  <MonthRangeSlider value={value} onChange={onChange} years={years} />
                </div>

                {/* Month grid — pick individual months / make a range.
                    Each month is tagged by tense: past (completed),
                    current (in-progress, still partly projected), future
                    (pure projection). Tense colors layer with selection
                    state so the user can see at a glance which months
                    will contribute actuals vs projections to any range
                    they pick. */}
                <div className="border-t border-[#1e1e1e] pt-3 space-y-2">
                  {/* Year stepper sits with the month grid so year + month
                      navigation feel like one control. Prev/next arrows
                      move year by 1; clicking the year label zooms out
                      to the year picker. */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-1.5 rounded-md border border-[#1e1e1e] bg-[#111] px-1 py-0.5">
                      <button
                        type="button"
                        onClick={() => setYear((y) => Math.max(yearMin, y - 1))}
                        disabled={year <= yearMin}
                        aria-label="Previous year"
                        className="flex h-5 w-5 items-center justify-center rounded-sm text-[#606060] transition-colors hover:bg-[#1a1a1a] hover:text-white disabled:cursor-not-allowed disabled:text-[#2a2a2a] disabled:hover:bg-transparent disabled:hover:text-[#2a2a2a]"
                      >
                        <ChevronLeft className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => goTo("years", "out")}
                        className="font-mono text-[11px] font-semibold text-[#C4BCAA] hover:text-white transition-colors px-1"
                      >
                        {year}
                      </button>
                      <button
                        type="button"
                        onClick={() => setYear((y) => Math.min(yearMax, y + 1))}
                        disabled={year >= yearMax}
                        aria-label="Next year"
                        className="flex h-5 w-5 items-center justify-center rounded-sm text-[#606060] transition-colors hover:bg-[#1a1a1a] hover:text-white disabled:cursor-not-allowed disabled:text-[#2a2a2a] disabled:hover:bg-transparent disabled:hover:text-[#2a2a2a]"
                      >
                        <ChevronRight className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 font-mono text-[9px] text-[#606060]">
                      <span className="flex items-center gap-1">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#C4BCAA]" />
                        Past
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#F5BC4E]" />
                        Current
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#8FB5D9]" />
                        Projected
                      </span>
                    </div>
                  </div>
                  <p className="text-[9px] font-mono text-[#606060]">
                    Click a month / pair to make a range.
                  </p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {MONTHS.map((m, i) => {
                      const monthStart = new Date(year, i, 1);
                      const monthEnd = new Date(year, i + 1, 0);
                      const isInRange = value.from && value.to && monthEnd >= value.from && monthStart <= value.to;
                      const isAnchor =
                        rangeAnchor !== null &&
                        rangeAnchor.year === year &&
                        rangeAnchor.month === i;
                      const tense = monthTense(year, i);
                      // Tense classes layer with selection state. When a
                      // month is selected (in range or anchor), the green
                      // selection palette wins; when unselected, the tense
                      // class provides a tinted background + colored dot.
                      // Tense tints — visible enough to scan but not so
                      // loud that they fight with the green selection
                      // palette. Border carries the strongest signal,
                      // text picks up a hint of the tense color.
                      const tenseUnselected =
                        tense === "current"
                          ? "bg-[#F5BC4E]/[0.06] text-[#F5BC4E]/85 border-[#F5BC4E]/25 hover:bg-[#F5BC4E]/12 hover:text-[#F5BC4E] hover:border-[#F5BC4E]/40"
                          : tense === "future"
                          ? "bg-[#8FB5D9]/[0.05] text-[#8FB5D9]/85 border-[#8FB5D9]/20 hover:bg-[#8FB5D9]/10 hover:text-[#8FB5D9] hover:border-[#8FB5D9]/35"
                          : "bg-[#111] text-[#C4BCAA] border-[#1e1e1e] hover:bg-[#1a1a1a] hover:text-white hover:border-[#333]";
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => handleMonthClick(i)}
                          title={
                            tense === "current"
                              ? "Current month — partly projected (in progress)"
                              : tense === "future"
                              ? "Future month — pure projection"
                              : "Past month — actuals only"
                          }
                          className={cn(
                            "relative flex flex-col items-center justify-center rounded-md py-1.5 transition-all duration-200 border",
                            isAnchor
                              ? "bg-[#42CA80]/25 text-[#65FFAA] border-[#42CA80] ring-1 ring-[#42CA80]/40"
                              : isInRange
                                ? "bg-[#42CA80]/10 text-[#42CA80] border-[#42CA80]/25"
                                : tenseUnselected,
                          )}
                        >
                          <span className="text-[11px] font-mono font-semibold leading-none">{m}</span>
                        </button>
                      );
                    })}
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
