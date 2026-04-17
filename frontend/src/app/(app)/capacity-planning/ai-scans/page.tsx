"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Info, Plus, Trash2, XCircle } from "lucide-react";
import { StickyPageChrome } from "../_StickyPageChrome";
import { useCP2Store, monthLabel, type AiRecommendation } from "../_store";

const RECS: AiRecommendation[] = ["FULL_PASS", "PARTIAL_PASS", "REVIEW_REWRITE"];

const REC_TONE: Record<AiRecommendation, string> = {
  FULL_PASS: "border-[#42CA80]/40 bg-[#42CA80]/10 text-[#65FFAA]",
  PARTIAL_PASS: "border-[#F5C542]/40 bg-[#F5C542]/10 text-[#F5C542]",
  REVIEW_REWRITE: "border-[#ED6958]/40 bg-[#ED6958]/10 text-[#ED6958]",
};

export default function AiScansPage() {
  const { dims, aiScans, addAiScan, updateAiScan, deleteAiScan, selectedMonth } = useCP2Store();

  const [view, setView] = useState<"all" | "flagged" | "rewrites">("all");
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    let list = aiScans;
    if (view === "flagged") list = list.filter((s) => s.isFlagged);
    else if (view === "rewrites") list = list.filter((s) => s.isRewrite);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.topicTitle.toLowerCase().includes(q) ||
          s.writerName.toLowerCase().includes(q) ||
          s.editorName.toLowerCase().includes(q),
      );
    }
    return list.slice().sort((a, b) => b.dateProcessed.localeCompare(a.dateProcessed));
  }, [aiScans, view, search]);

  // Rollups for the selected month, non-rewrite only (dashboard rule).
  const summary = useMemo(() => {
    const month = aiScans.filter((s) => !s.isRewrite && s.monthKey === selectedMonth);
    const total = month.length;
    const full = month.filter((s) => s.recommendation === "FULL_PASS").length;
    const partial = month.filter((s) => s.recommendation === "PARTIAL_PASS").length;
    const rewrite = month.filter((s) => s.recommendation === "REVIEW_REWRITE").length;
    return { total, full, partial, rewrite, fullPct: total > 0 ? Math.round((full / total) * 100) : 0 };
  }, [aiScans, selectedMonth]);

  const clientName = (id: number) => dims.clients.find((c) => c.id === id)?.name ?? `#${id}`;
  const podName = (id: number | null) => (id === null ? "—" : dims.pods.find((p) => p.id === id)?.display_name ?? `Pod #${id}`);

  function handleAdd() {
    const defaultClient = dims.clients[0];
    if (!defaultClient) return;
    addAiScan({
      articleId: null,
      clientId: defaultClient.id,
      podId: null,
      monthKey: selectedMonth,
      topicTitle: "New scan",
      writerName: "",
      editorName: "",
      dateProcessed: new Date().toISOString().slice(0, 10),
      surferV1Score: null,
      surferV2Score: null,
      recommendation: "FULL_PASS",
      isRewrite: false,
      isFlagged: false,
      action: "",
      notes: "",
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <StickyPageChrome subtitle="AI compliance scans. Flip Flagged / Rewrite, change recommendation, edit Surfer scores. Feeds cp2_fact_ai_scan and the AI Compliance tab on Team KPIs." />

      {/* Rollups */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Roll label="Scans this month" value={summary.total} />
        <Roll label="Full pass rate" value={`${summary.fullPct}%`} tone={summary.fullPct >= 95 ? "green" : summary.fullPct >= 85 ? "yellow" : "red"} />
        <Roll label="Partial pass" value={summary.partial} tone="yellow" />
        <Roll label="Review / rewrite" value={summary.rewrite} tone="red" />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-[#606060]">
        {(["all", "flagged", "rewrites"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-md border px-2 py-0.5 ${
              view === v
                ? "border-[#42CA80]/40 bg-[#42CA80]/10 text-[#65FFAA]"
                : "border-[#2a2a2a] bg-[#161616] text-[#C4BCAA] hover:text-white"
            }`}
          >
            {v}
          </button>
        ))}
        <input
          type="search"
          placeholder="Search title / writer / editor"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-6 rounded border border-[#2a2a2a] bg-[#161616] px-2 font-sans text-xs text-white placeholder:text-[#606060] focus:border-[#42CA80]/50 focus:outline-none"
        />
        <span className="ml-auto">{visible.length} rows</span>
        <button
          type="button"
          onClick={handleAdd}
          className="flex items-center gap-1.5 rounded-md border border-[#42CA80]/40 bg-[#42CA80]/10 px-2 py-0.5 text-[#65FFAA] hover:bg-[#42CA80]/20"
        >
          <Plus className="h-3 w-3" />
          New scan
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#1f1f1f] bg-[#0a0a0a]">
        <table className="w-full min-w-[1100px] border-collapse font-mono text-[11px]">
          <thead>
            <tr className="border-b border-[#1a1a1a] bg-[#050505] text-[10px] uppercase tracking-wider text-[#606060]">
              <th className="px-3 py-2 text-left">Title</th>
              <th className="px-2 py-2 text-left">Client</th>
              <th className="px-2 py-2 text-left">Pod</th>
              <th className="px-2 py-2 text-left">Writer</th>
              <th className="px-2 py-2 text-left">Editor</th>
              <th className="px-2 py-2 text-right">v1</th>
              <th className="px-2 py-2 text-right">v2</th>
              <th className="px-2 py-2 text-left">Recommendation</th>
              <th className="px-2 py-2 text-center">Flagged</th>
              <th className="px-2 py-2 text-center">Rewrite</th>
              <th className="px-2 py-2 text-right">Date</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {visible.map((s, idx) => (
              <tr
                key={s.id}
                className={`${idx % 2 === 0 ? "bg-[#0a0a0a]" : "bg-[#0c0c0c]"} border-t border-[#111]`}
              >
                <td className="px-3 py-1.5 text-xs text-white">
                  <input
                    value={s.topicTitle}
                    onChange={(e) => updateAiScan(s.id, { topicTitle: e.target.value })}
                    className="w-full min-w-[220px] bg-transparent outline-none focus:border-b focus:border-[#42CA80]/50"
                  />
                  <div className="mt-0.5 text-[10px] text-[#606060]">
                    {monthLabel(s.monthKey)}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-[#C4BCAA]">{clientName(s.clientId)}</td>
                <td className="px-2 py-1.5 text-[#C4BCAA]">{podName(s.podId)}</td>
                <td className="px-2 py-1.5">
                  <input
                    value={s.writerName}
                    onChange={(e) => updateAiScan(s.id, { writerName: e.target.value })}
                    placeholder="—"
                    className="w-28 bg-transparent text-[#C4BCAA] outline-none focus:border-b focus:border-[#42CA80]/50"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    value={s.editorName}
                    onChange={(e) => updateAiScan(s.id, { editorName: e.target.value })}
                    placeholder="—"
                    className="w-28 bg-transparent text-[#C4BCAA] outline-none focus:border-b focus:border-[#42CA80]/50"
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="number"
                    step="0.1"
                    value={s.surferV1Score ?? ""}
                    onChange={(e) => updateAiScan(s.id, { surferV1Score: e.target.value === "" ? null : parseFloat(e.target.value) })}
                    placeholder="—"
                    className="h-6 w-14 rounded border border-[#2a2a2a] bg-[#161616] px-1 text-right text-[#C4BCAA] outline-none focus:border-[#42CA80]/50"
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="number"
                    step="0.1"
                    value={s.surferV2Score ?? ""}
                    onChange={(e) => updateAiScan(s.id, { surferV2Score: e.target.value === "" ? null : parseFloat(e.target.value) })}
                    placeholder="—"
                    className="h-6 w-14 rounded border border-[#2a2a2a] bg-[#161616] px-1 text-right text-[#C4BCAA] outline-none focus:border-[#42CA80]/50"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={s.recommendation}
                    onChange={(e) => updateAiScan(s.id, { recommendation: e.target.value as AiRecommendation })}
                    className={`h-6 rounded border px-2 font-semibold uppercase tracking-wider ${REC_TONE[s.recommendation]}`}
                  >
                    {RECS.map((r) => (
                      <option key={r} value={r} className="bg-[#0a0a0a] text-white">
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5 text-center">
                  <BoolToggle value={s.isFlagged} onToggle={(v) => updateAiScan(s.id, { isFlagged: v })} />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <BoolToggle value={s.isRewrite} onToggle={(v) => updateAiScan(s.id, { isRewrite: v })} />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="date"
                    value={s.dateProcessed}
                    onChange={(e) => updateAiScan(s.id, { dateProcessed: e.target.value })}
                    className="bg-transparent text-[#C4BCAA] outline-none"
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Delete scan "${s.topicTitle}"?`)) deleteAiScan(s.id);
                    }}
                    className="text-[#606060] hover:text-[#ED6958]"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-6 text-center text-[#606060]">
                  No scans match the filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3 text-[11px] text-[#C4BCAA]">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#42CA80]" />
        <span>
          The <b>Full pass rate</b> card mirrors the AI Compliance KPI. Rewrites are excluded from the denominator (dashboard rule).
        </span>
      </div>
    </div>
  );
}

function BoolToggle({ value, onToggle }: { value: boolean; onToggle: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!value)}
      className={`inline-flex h-6 w-6 items-center justify-center rounded border ${
        value
          ? "border-[#ED6958]/40 bg-[#ED6958]/10 text-[#ED6958]"
          : "border-[#2a2a2a] text-[#606060] hover:text-white"
      }`}
    >
      {value ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
    </button>
  );
}

function Roll({ label, value, tone }: { label: string; value: string | number; tone?: "green" | "yellow" | "red" }) {
  const color = tone === "green" ? "text-[#65FFAA]" : tone === "red" ? "text-[#ED6958]" : tone === "yellow" ? "text-[#F5C542]" : "text-white";
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">{label}</span>
      <span className={`font-mono text-xl font-semibold ${color}`}>{value}</span>
    </div>
  );
}
