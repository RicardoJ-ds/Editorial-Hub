"use client";

import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { StickyPageChrome } from "../_StickyPageChrome";
import {
  useCP2Store,
  type PipelineSnapshotRow,
} from "../_store";

type Col =
  | "topicsSubmitted"
  | "topicsApproved"
  | "cbsSubmitted"
  | "cbsApproved"
  | "articlesSent"
  | "articlesApproved"
  | "articlesDelivered"
  | "articlesPublished"
  | "articlesKilled";

const COLS: { key: Col; label: string; tone?: string }[] = [
  { key: "topicsSubmitted", label: "Topics submitted" },
  { key: "topicsApproved", label: "Topics approved", tone: "text-[#65FFAA]" },
  { key: "cbsSubmitted", label: "CBs submitted" },
  { key: "cbsApproved", label: "CBs approved", tone: "text-[#65FFAA]" },
  { key: "articlesSent", label: "Articles sent" },
  { key: "articlesApproved", label: "Articles approved", tone: "text-[#65FFAA]" },
  { key: "articlesDelivered", label: "Articles delivered" },
  { key: "articlesPublished", label: "Articles published", tone: "text-[#65FFAA]" },
  { key: "articlesKilled", label: "Articles killed", tone: "text-[#ED6958]" },
];

export default function PipelinePage() {
  const { dims, pipelineSnapshots, upsertPipelineSnapshot } = useCP2Store();
  const [selectedClient, setSelectedClient] = useState<"all" | number>("all");

  const activeClients = useMemo(
    () => dims.clients.filter((c) => c.is_active_in_cp2).sort((a, b) => a.id - b.id),
    [dims.clients],
  );

  const visibleClients = selectedClient === "all"
    ? activeClients
    : activeClients.filter((c) => c.id === selectedClient);

  const snapshotFor = (clientId: number): PipelineSnapshotRow | undefined =>
    pipelineSnapshots.find((s) => s.clientId === clientId);

  // Rollup across all active clients
  const total = useMemo(() => {
    const init = {
      topicsSubmitted: 0,
      topicsApproved: 0,
      cbsSubmitted: 0,
      cbsApproved: 0,
      articlesSent: 0,
      articlesApproved: 0,
      articlesDelivered: 0,
      articlesPublished: 0,
      articlesKilled: 0,
    };
    for (const c of activeClients) {
      const s = snapshotFor(c.id);
      if (!s) continue;
      for (const col of COLS) {
        (init[col.key] as number) += s[col.key];
      }
    }
    return init;
  }, [activeClients, pipelineSnapshots]);

  const overallApprovalPct = total.articlesSent > 0
    ? Math.round((total.articlesApproved / total.articlesSent) * 100)
    : 0;

  return (
    <div className="flex flex-col gap-4">
      <StickyPageChrome subtitle="Cumulative pipeline snapshots per client. Edit the funnel counts — topics → CBs → articles → published. Each save stamps snapshot_date = today." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Roll label="Clients tracked" value={activeClients.length} />
        <Roll label="Topics approved" value={total.topicsApproved} />
        <Roll label="Articles published" value={total.articlesPublished} tone="green" />
        <Roll
          label="Overall article approval"
          value={`${overallApprovalPct}%`}
          tone={overallApprovalPct >= 95 ? "green" : overallApprovalPct >= 85 ? "yellow" : "red"}
        />
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-[#606060]">
        <span>Client</span>
        <select
          value={selectedClient === "all" ? "all" : String(selectedClient)}
          onChange={(e) =>
            setSelectedClient(e.target.value === "all" ? "all" : parseInt(e.target.value, 10))
          }
          className="h-6 rounded border border-[#2a2a2a] bg-[#161616] px-2 font-sans text-xs text-white focus:border-[#42CA80]/50 focus:outline-none"
        >
          <option value="all">All clients</option>
          {activeClients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="ml-auto">{visibleClients.length} clients</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#1f1f1f] bg-[#0a0a0a]">
        <table className="w-full min-w-[1100px] border-collapse font-mono text-[11px]">
          <thead>
            <tr className="border-b border-[#1a1a1a] bg-[#050505] text-[10px] uppercase tracking-wider text-[#606060]">
              <th className="sticky left-0 z-10 bg-[#050505] px-3 py-2 text-left">Client</th>
              {COLS.map((c) => (
                <th key={c.key} className="px-2 py-2 text-right">
                  {c.label}
                </th>
              ))}
              <th className="px-2 py-2 text-right">Approval %</th>
              <th className="px-2 py-2 text-right">Snapshot</th>
            </tr>
          </thead>
          <tbody>
            {visibleClients.map((c, idx) => {
              const s = snapshotFor(c.id);
              const approvalPct = s && s.articlesSent > 0
                ? Math.round((s.articlesApproved / s.articlesSent) * 100)
                : null;
              return (
                <tr
                  key={c.id}
                  className={`${idx % 2 === 0 ? "bg-[#0a0a0a]" : "bg-[#0c0c0c]"} border-t border-[#111]`}
                >
                  <td className={`sticky left-0 z-10 ${idx % 2 === 0 ? "bg-[#0a0a0a]" : "bg-[#0c0c0c]"} px-3 py-1.5 text-xs font-medium text-white`}>
                    {c.name}
                    <div className="mt-0.5 text-[10px] text-[#606060]">{c.status}</div>
                  </td>
                  {COLS.map((col) => {
                    const value = s ? s[col.key] : 0;
                    return (
                      <td key={col.key} className="px-1 py-1 text-right">
                        <input
                          type="number"
                          min={0}
                          value={value}
                          onChange={(e) =>
                            upsertPipelineSnapshot(c.id, {
                              [col.key]: parseInt(e.target.value || "0", 10),
                            })
                          }
                          className={`h-7 w-20 rounded border border-[#2a2a2a] bg-[#161616] px-1 text-right font-mono text-[11px] outline-none focus:border-[#42CA80]/50 ${col.tone ?? "text-white"}`}
                        />
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-right font-semibold">
                    {approvalPct === null ? (
                      <span className="text-[#606060]">—</span>
                    ) : (
                      <span className={approvalPct >= 95 ? "text-[#65FFAA]" : approvalPct >= 85 ? "text-[#F5C542]" : "text-[#ED6958]"}>
                        {approvalPct}%
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-[10px] text-[#606060]">
                    {s?.snapshotDate ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3 text-[11px] text-[#C4BCAA]">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#42CA80]" />
        <span>
          Rows write to <span className="font-mono text-[#65FFAA]">cp2_fact_pipeline_snapshot</span>.
          One snapshot per client; every edit advances <span className="font-mono">snapshot_date</span> to today.
        </span>
      </div>
    </div>
  );
}

function Roll({ label, value, tone }: { label: string; value: string | number; tone?: "green" | "yellow" | "red" }) {
  const color =
    tone === "green" ? "text-[#65FFAA]" :
    tone === "red" ? "text-[#ED6958]" :
    tone === "yellow" ? "text-[#F5C542]" :
    "text-white";
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">{label}</span>
      <span className={`font-mono text-xl font-semibold ${color}`}>{value}</span>
    </div>
  );
}
