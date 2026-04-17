"use client";

import { useState } from "react";
import {
  Copy,
  CopyPlus,
  Lock,
  Unlock,
  ChevronDown,
  ArrowLeftToLine,
  ArrowRightToLine,
} from "lucide-react";
import { useCP2Store, monthLabel } from "./_store";

export function ClosedMonthBanner() {
  const { selectedMonth, isMonthClosed, reopenMonth } = useCP2Store();
  if (!isMonthClosed(selectedMonth)) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[#8EB0FF]/30 bg-[#5B8EFF]/5 px-4 py-2 text-xs text-[#8EB0FF]">
      <Lock className="h-4 w-4" />
      <span className="font-medium">{monthLabel(selectedMonth)} is closed.</span>
      <span className="text-[#C4BCAA]">
        Future edits need a capacity override, not a direct change.
      </span>
      <button
        type="button"
        onClick={() => reopenMonth(selectedMonth)}
        className="ml-auto flex items-center gap-1.5 rounded-md border border-[#5B8EFF]/40 bg-[#5B8EFF]/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[#8EB0FF] hover:bg-[#5B8EFF]/20"
      >
        <Unlock className="h-3 w-3" />
        Reopen
      </button>
    </div>
  );
}

export function CopyMonthMenu() {
  const {
    selectedMonth,
    copyMonthForward,
    copyFromPreviousMonth,
    isMonthClosed,
  } = useCP2Store();
  const [open, setOpen] = useState(false);
  const closed = isMonthClosed(selectedMonth);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={closed}
        className="flex items-center gap-1.5 rounded-md border border-[#2a2a2a] bg-[#161616] px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider text-[#C4BCAA] hover:border-[#42CA80]/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        title={closed ? "Month is closed — reopen to edit" : "Copy data across months"}
      >
        <Copy className="h-3.5 w-3.5" />
        Copy
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && !closed && (
        <div
          className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] shadow-lg shadow-black/40"
          onMouseLeave={() => setOpen(false)}
        >
          <MenuItem
            icon={<ArrowLeftToLine className="h-3.5 w-3.5" />}
            label="From previous month"
            hint="overwrites this month"
            onClick={() => {
              if (
                confirm(`Copy previous month's setup into ${monthLabel(selectedMonth)}? Existing data will be replaced.`)
              ) {
                copyFromPreviousMonth(selectedMonth);
                setOpen(false);
              }
            }}
          />
          <div className="border-t border-[#111]" />
          <MenuItem
            icon={<ArrowRightToLine className="h-3.5 w-3.5" />}
            label="To next month"
            hint="1 month forward"
            onClick={() => {
              copyMonthForward(selectedMonth, 1);
              setOpen(false);
            }}
          />
          <MenuItem
            icon={<CopyPlus className="h-3.5 w-3.5" />}
            label="To next 3 months"
            hint="common quarter"
            onClick={() => {
              copyMonthForward(selectedMonth, 3);
              setOpen(false);
            }}
          />
          <MenuItem
            icon={<CopyPlus className="h-3.5 w-3.5" />}
            label="To next 6 months"
            hint="half year forward"
            onClick={() => {
              copyMonthForward(selectedMonth, 6);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

export function CloseMonthButton() {
  const { selectedMonth, isMonthClosed, closeMonth, reopenMonth } = useCP2Store();
  const closed = isMonthClosed(selectedMonth);

  return (
    <button
      type="button"
      onClick={() => {
        if (closed) {
          reopenMonth(selectedMonth);
        } else if (
          confirm(
            `Close ${monthLabel(selectedMonth)}? It becomes read-only; use Reopen or an override to make changes.`,
          )
        ) {
          closeMonth(selectedMonth);
        }
      }}
      className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider transition-colors ${
        closed
          ? "border-[#8EB0FF]/40 bg-[#5B8EFF]/10 text-[#8EB0FF] hover:bg-[#5B8EFF]/20"
          : "border-[#2a2a2a] bg-[#161616] text-[#C4BCAA] hover:border-[#42CA80]/40 hover:text-white"
      }`}
      title={closed ? "Reopen this month" : "Close this month — freeze state"}
    >
      {closed ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
      {closed ? "Reopen" : "Close"}
    </button>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[#C4BCAA] hover:bg-[#161616]"
    >
      <span className="text-[#42CA80]">{icon}</span>
      <span className="flex-1">
        <span className="block text-xs font-medium text-white">{label}</span>
        {hint && <span className="block font-mono text-[10px] text-[#606060]">{hint}</span>}
      </span>
    </button>
  );
}
