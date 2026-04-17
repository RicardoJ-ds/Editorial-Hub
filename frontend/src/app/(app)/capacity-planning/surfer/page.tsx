"use client";

import { useMemo } from "react";
import { Info } from "lucide-react";
import { StickyPageChrome } from "../_StickyPageChrome";
import {
  useCP2Store,
  monthLabel,
  monthRange,
  type SurferUsageRow,
} from "../_store";

type PodCol = "pod1" | "pod2" | "pod3" | "pod4" | "pod5";
type Col = PodCol | "auditioningWriters" | "rewrites" | "totalSpent" | "remainingCalls";

const COLS: { key: Col; label: string }[] = [
  { key: "pod1", label: "Pod 1" },
  { key: "pod2", label: "Pod 2" },
  { key: "pod3", label: "Pod 3" },
  { key: "pod4", label: "Pod 4" },
  { key: "pod5", label: "Pod 5" },
  { key: "auditioningWriters", label: "Auditioning" },
  { key: "rewrites", label: "Rewrites" },
  { key: "totalSpent", label: "Total spent" },
  { key: "remainingCalls", label: "Remaining" },
];

export default function SurferPage() {
  const { selectedMonth, surferUsage, upsertSurferUsage } = useCP2Store();

  // Show 12 months ending at selected
  const months = useMemo(() => {
    const all = monthRange(selectedMonth, 11, 0);
    return all;
  }, [selectedMonth]);

  const rowFor = (monthKey: string): SurferUsageRow | undefined =>
    surferUsage.find((r) => r.yearMonthKey === monthKey);

  // Current month summary
  const current = rowFor(selectedMonth);
  const pod1To5 = current ? current.pod1 + current.pod2 + current.pod3 + current.pod4 + current.pod5 : 0;

  return (
    <div className="flex flex-col gap-4">
      <StickyPageChrome subtitle="Monthly Surfer API usage per pod. Edit totals and remaining calls inline. Feeds cp2_fact_surfer_api_usage and the AI Compliance tab's Surfer table." />

      {/* Current-month rollup */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Roll label={`Pods total · ${monthLabel(selectedMonth)}`} value={pod1To5} />
        <Roll
          label="Auditioning writers"
          value={current?.auditioningWriters ?? 0}
          tone="blue"
        />
        <Roll label="Rewrites" value={current?.rewrites ?? 0} tone="yellow" />
        <Roll
          label="Remaining"
          value={current?.remainingCalls ?? "—"}
          tone={
            current?.remainingCalls === null || current?.remainingCalls === undefined
              ? undefined
              : current.remainingCalls < 100
                ? "red"
                : "green"
          }
        />
      </div>

      {/* Grid: Month × pod columns */}
      <div className="overflow-x-auto rounded-lg border border-[#1f1f1f] bg-[#0a0a0a]">
        <table className="w-full min-w-[900px] border-collapse font-mono text-[11px]">
          <thead>
            <tr className="border-b border-[#1a1a1a] bg-[#050505] text-[10px] uppercase tracking-wider text-[#606060]">
              <th className="sticky left-0 z-10 bg-[#050505] px-3 py-2 text-left">Month</th>
              {COLS.map((c) => (
                <th key={c.key} className="px-2 py-2 text-right">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {months.map((m, idx) => {
              const r = rowFor(m);
              const isSelected = m === selectedMonth;
              return (
                <tr
                  key={m}
                  className={`${idx % 2 === 0 ? "bg-[#0a0a0a]" : "bg-[#0c0c0c]"} ${isSelected ? "ring-1 ring-inset ring-[#42CA80]/30" : ""} border-t border-[#111]`}
                >
                  <td className={`sticky left-0 z-10 ${idx % 2 === 0 ? "bg-[#0a0a0a]" : "bg-[#0c0c0c]"} px-3 py-1.5 text-xs font-medium ${isSelected ? "text-[#65FFAA]" : "text-white"}`}>
                    {monthLabel(m)}
                  </td>
                  {COLS.map((c) => {
                    const raw = r ? (r[c.key as keyof SurferUsageRow] as number | null) : null;
                    const value = raw === null ? "" : String(raw);
                    const tone =
                      c.key === "remainingCalls"
                        ? raw === null
                          ? "text-[#606060]"
                          : (raw as number) < 100
                            ? "text-[#ED6958]"
                            : "text-[#65FFAA]"
                        : "text-[#C4BCAA]";
                    return (
                      <td key={c.key} className="px-1 py-1 text-right">
                        <input
                          type="number"
                          min={0}
                          value={value}
                          placeholder="—"
                          onChange={(e) => {
                            const raw = e.target.value;
                            const parsed = raw === "" ? (c.key === "remainingCalls" ? null : 0) : parseInt(raw, 10);
                            upsertSurferUsage(m, { [c.key]: parsed });
                          }}
                          className={`h-7 w-20 rounded border border-[#2a2a2a] bg-[#161616] px-1 text-right font-mono text-[11px] outline-none focus:border-[#42CA80]/50 ${tone}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3 text-[11px] text-[#C4BCAA]">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#42CA80]" />
        <span>
          <b>Remaining</b> goes red below 100. The AI Compliance dashboard card hits the same threshold.
        </span>
      </div>
    </div>
  );
}

function Roll({ label, value, tone }: { label: string; value: string | number; tone?: "green" | "red" | "yellow" | "blue" }) {
  const color =
    tone === "green" ? "text-[#65FFAA]" :
    tone === "red" ? "text-[#ED6958]" :
    tone === "yellow" ? "text-[#F5C542]" :
    tone === "blue" ? "text-[#8EB0FF]" :
    "text-white";
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">{label}</span>
      <span className={`font-mono text-xl font-semibold ${color}`}>{value}</span>
    </div>
  );
}
