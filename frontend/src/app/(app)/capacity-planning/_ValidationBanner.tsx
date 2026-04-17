"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, AlertCircle, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import { useCP2Store, monthLabel } from "./_store";
import type { MonthKey } from "./_mock";
import { computeMonthIssues, issuesByLevel } from "./_validation";

export function ValidationBanner() {
  const { state, selectedMonth } = useCP2Store();
  const month = selectedMonth as MonthKey;

  const issues = useMemo(
    () =>
      computeMonthIssues(
        state.monthly[month] ?? [],
        state.unassigned[month] ?? [],
      ),
    [state, month],
  );
  const { errors, warnings } = issuesByLevel(issues);

  const [expanded, setExpanded] = useState<boolean>(errors.length > 0);

  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[#42CA80]/30 bg-[#42CA80]/5 px-4 py-2 text-xs text-[#65FFAA]">
        <CheckCircle2 className="h-4 w-4" />
        <span className="font-medium">{monthLabel(selectedMonth)} is valid</span>
        <span className="text-[#C4BCAA]">— no warnings for this month.</span>
      </div>
    );
  }

  const hasErrors = errors.length > 0;
  const barClass = hasErrors
    ? "border-[#ED6958]/30 bg-[#ED6958]/5 text-[#ED6958]"
    : "border-[#F5C542]/30 bg-[#F5C542]/5 text-[#F5C542]";

  return (
    <div className={`rounded-lg border ${barClass}`}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left"
      >
        {hasErrors ? (
          <AlertCircle className="h-4 w-4 shrink-0" />
        ) : (
          <AlertTriangle className="h-4 w-4 shrink-0" />
        )}
        <span className="text-xs font-medium">
          {errors.length > 0 && (
            <span className="mr-2 text-[#ED6958]">
              {errors.length} error{errors.length === 1 ? "" : "s"}
            </span>
          )}
          {warnings.length > 0 && (
            <span className="text-[#F5C542]">
              {warnings.length} warning{warnings.length === 1 ? "" : "s"}
            </span>
          )}
          <span className="ml-2 text-[#C4BCAA]">in {monthLabel(selectedMonth)}</span>
        </span>
        <span className="ml-auto shrink-0 text-[#C4BCAA]">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>

      {expanded && (
        <ul className="divide-y divide-white/5 border-t border-white/5 text-xs">
          {[...errors, ...warnings].map((issue, i) => (
            <li
              key={`${issue.code}-${i}`}
              className="flex items-start gap-2 px-4 py-2 text-[#C4BCAA]"
            >
              {issue.level === "error" ? (
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#ED6958]" />
              ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#F5C542]" />
              )}
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
