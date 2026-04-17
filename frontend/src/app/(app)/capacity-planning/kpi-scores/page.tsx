"use client";

import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { StickyPageChrome } from "../_StickyPageChrome";
import { ClosedMonthBanner } from "../_MonthActions";
import { useCP2Store, monthLabel } from "../_store";

const LOWER_IS_BETTER = new Set(["revision_rate", "turnaround_time"]);

export default function KpiScoresPage() {
  const {
    dims,
    selectedMonth,
    kpiScores,
    upsertKpiScore,
    isMonthClosed,
  } = useCP2Store();
  const closed = isMonthClosed(selectedMonth);

  const [selectedMetricKey, setSelectedMetricKey] = useState<string>(
    dims.metrics[0]?.metric_key ?? "",
  );
  const metric = dims.metrics.find((m) => m.metric_key === selectedMetricKey);

  const activeMembers = useMemo(
    () => dims.members.filter((m) => m.is_active).slice().sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [dims.members],
  );

  // Show the 7 most recent months (selected in the middle).
  const months = useMemo(() => {
    const m = selectedMonth;
    const [y, mm] = m.split("-").map((n) => parseInt(n, 10));
    const out: string[] = [];
    for (let i = -3; i <= 3; i++) {
      const d = new Date(y, mm - 1 + i, 1);
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return out;
  }, [selectedMonth]);

  function scoreFor(memberId: number, monthKey: string): number | null {
    if (!metric) return null;
    const row = kpiScores.find(
      (s) =>
        s.teamMemberId === memberId &&
        s.monthKey === monthKey &&
        s.metricId === metric.id &&
        s.clientId === null,
    );
    return row?.score ?? null;
  }

  function toneFor(score: number | null): string {
    if (score === null || !metric) return "text-[#606060]";
    const target = metric.target_value;
    const lowerBetter = LOWER_IS_BETTER.has(metric.metric_key) || metric.direction === "lower_is_better";
    if (lowerBetter) {
      if (score <= target) return "text-[#65FFAA]";
      if (score <= target * 1.1) return "text-[#F5C542]";
      return "text-[#ED6958]";
    }
    if (score >= target) return "text-[#65FFAA]";
    if (score >= target * 0.9) return "text-[#F5C542]";
    return "text-[#ED6958]";
  }

  // Summary: members meeting target vs not, for the selected month.
  const summary = useMemo(() => {
    if (!metric) return { meeting: 0, missing: 0, empty: 0 };
    let meeting = 0;
    let missing = 0;
    let empty = 0;
    for (const m of activeMembers) {
      const s = scoreFor(m.id, selectedMonth);
      if (s === null) {
        empty += 1;
        continue;
      }
      const lowerBetter = metric.direction === "lower_is_better";
      if (lowerBetter ? s <= metric.target_value : s >= metric.target_value) meeting += 1;
      else missing += 1;
    }
    return { meeting, missing, empty };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, activeMembers, kpiScores, selectedMonth]);

  return (
    <div className="flex flex-col gap-4">
      <StickyPageChrome subtitle="Enter monthly KPI scores per team member. One metric at a time; switch tabs to see each. Null = no entry yet." />
      <ClosedMonthBanner />

      {/* Metric tabs */}
      <div className="flex flex-wrap gap-1 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] p-1">
        {dims.metrics.map((m) => {
          const active = m.metric_key === selectedMetricKey;
          return (
            <button
              key={m.id}
              onClick={() => setSelectedMetricKey(m.metric_key)}
              className={`rounded-md px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                active
                  ? "bg-[#42CA80]/10 text-[#65FFAA]"
                  : "text-[#C4BCAA] hover:bg-[#161616] hover:text-white"
              }`}
            >
              {m.display_name}
            </button>
          );
        })}
      </div>

      {metric && (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <SummaryCard label="Target" value={`${metric.target_value} ${metric.unit}`} />
            <SummaryCard label="Direction" value={metric.direction.replace(/_/g, " ")} />
            <SummaryCard
              label={`Meeting target · ${monthLabel(selectedMonth)}`}
              value={`${summary.meeting} / ${activeMembers.length}`}
              tone="green"
            />
            <SummaryCard
              label="Missing / empty"
              value={`${summary.missing} below · ${summary.empty} blank`}
              tone={summary.empty > 0 ? "yellow" : "white"}
            />
          </div>

          {/* Grid */}
          <div className="overflow-x-auto rounded-lg border border-[#1f1f1f] bg-[#0a0a0a]">
            <table className="w-full min-w-[900px] border-collapse font-mono text-[11px]">
              <thead>
                <tr className="border-b border-[#1a1a1a] bg-[#050505]">
                  <th className="sticky left-0 z-10 bg-[#050505] px-4 py-2 text-left text-[10px] uppercase tracking-wider text-[#606060]">
                    Member
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-[#606060]">
                    Role
                  </th>
                  {months.map((m) => {
                    const isSelected = m === selectedMonth;
                    return (
                      <th
                        key={m}
                        className={`px-3 py-2 text-center text-[10px] uppercase tracking-wider ${isSelected ? "bg-[#42CA80]/10 text-[#65FFAA]" : "text-[#606060]"}`}
                      >
                        {monthLabel(m)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {activeMembers.map((member, idx) => (
                  <tr
                    key={member.id}
                    className={`${idx % 2 === 0 ? "bg-[#0a0a0a]" : "bg-[#0c0c0c]"} border-b border-[#111]`}
                  >
                    <td className={`sticky left-0 z-10 ${idx % 2 === 0 ? "bg-[#0a0a0a]" : "bg-[#0c0c0c]"} px-4 py-1.5 text-xs font-medium text-white`}>
                      {member.full_name}
                    </td>
                    <td className="px-3 py-1.5 text-[#C4BCAA]">{member.role_default}</td>
                    {months.map((m) => {
                      const score = scoreFor(member.id, m);
                      const isSelected = m === selectedMonth;
                      return (
                        <td
                          key={m}
                          className={`px-2 py-1 text-center ${isSelected ? "bg-[#42CA80]/5" : ""}`}
                        >
                          <input
                            type="number"
                            step="0.1"
                            value={score ?? ""}
                            disabled={closed}
                            placeholder="—"
                            onChange={(e) => {
                              const raw = e.target.value;
                              const parsed = raw === "" ? null : parseFloat(raw);
                              upsertKpiScore(m, member.id, metric.id, null, {
                                score: parsed,
                                targetSnapshot: metric.target_value,
                                source: metric.metric_key === "ai_compliance"
                                  ? "ai_scan"
                                  : ["revision_rate", "turnaround_time", "second_reviews"].includes(metric.metric_key)
                                    ? "notion"
                                    : "manual",
                              });
                            }}
                            className={`h-7 w-20 rounded border border-[#2a2a2a] bg-[#161616] px-2 text-center font-mono text-[11px] outline-none focus:border-[#42CA80]/50 ${toneFor(score)}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {activeMembers.length === 0 && (
                  <tr>
                    <td colSpan={months.length + 2} className="px-4 py-6 text-center text-[#606060]">
                      No active members — add some via Admin → Members.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3 text-[11px] text-[#C4BCAA]">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#42CA80]" />
            <span>
              Writes <span className="font-mono text-[#65FFAA]">cp2_fact_kpi_score</span> rows with{" "}
              <span className="font-mono">client_id = null</span> (aggregate). Per-client breakdowns
              arrive in the Admin editor for a member. Target at entry time is captured in{" "}
              <span className="font-mono">target_snapshot</span>.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "green" | "yellow" | "white";
}) {
  const color = tone === "green" ? "text-[#65FFAA]" : tone === "yellow" ? "text-[#F5C542]" : "text-white";
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">{label}</span>
      <span className={`font-mono text-sm ${color}`}>{value}</span>
    </div>
  );
}
