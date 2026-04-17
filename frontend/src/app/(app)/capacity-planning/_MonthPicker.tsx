"use client";

import { ChevronLeft, ChevronRight, CalendarClock, Lock } from "lucide-react";
import { useCP2Store, currentMonthKey, monthLabel, shiftMonth } from "./_store";

export function MonthPicker() {
  const { selectedMonth, setSelectedMonth, goToCurrentMonth, monthOptions, isMonthClosed } = useCP2Store();
  const today = currentMonthKey();

  const prev = () => setSelectedMonth(shiftMonth(selectedMonth, -1));
  const next = () => setSelectedMonth(shiftMonth(selectedMonth, +1));

  return (
    <div className="flex items-center gap-1 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] p-1">
      <button
        type="button"
        onClick={prev}
        className="flex h-7 w-7 items-center justify-center rounded-md text-[#C4BCAA] transition-colors hover:bg-[#161616] hover:text-white"
        aria-label="Previous month"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <div className="flex items-center gap-1 overflow-x-auto">
        {monthOptions.map((m) => {
          const active = m === selectedMonth;
          const isToday = m === today;
          const closed = isMonthClosed(m);
          return (
            <button
              key={m}
              type="button"
              onClick={() => setSelectedMonth(m)}
              title={
                closed
                  ? `${monthLabel(m)} (closed)`
                  : isToday
                    ? "Current month"
                    : monthLabel(m)
              }
              className={`relative flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider transition-all ${
                active
                  ? "bg-[#42CA80]/15 text-[#65FFAA]"
                  : isToday
                    ? "text-[#65FFAA] hover:bg-[#161616]"
                    : "text-[#C4BCAA] hover:bg-[#161616] hover:text-white"
              }`}
            >
              {monthLabel(m)}
              {closed && <Lock className="h-2.5 w-2.5 text-[#8EB0FF]" />}
              {isToday && !active && !closed && (
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full bg-[#65FFAA]"
                />
              )}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={next}
        className="flex h-7 w-7 items-center justify-center rounded-md text-[#C4BCAA] transition-colors hover:bg-[#161616] hover:text-white"
        aria-label="Next month"
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      <div className="mx-1 h-5 w-px bg-[#1f1f1f]" />

      <button
        type="button"
        onClick={goToCurrentMonth}
        className="flex h-7 items-center gap-1.5 rounded-md px-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#C4BCAA] transition-colors hover:bg-[#161616] hover:text-white"
        title="Jump to current month"
      >
        <CalendarClock className="h-3.5 w-3.5" />
        Today
      </button>
    </div>
  );
}
