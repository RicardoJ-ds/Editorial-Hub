"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Info, Plus, Trash2 } from "lucide-react";
import { StickyPageChrome } from "../_StickyPageChrome";
import { ClosedMonthBanner } from "../_MonthActions";
import {
  useCP2Store,
  monthLabel,
  type ArticleRow,
  type ArticleStatus,
} from "../_store";

const STATUSES: ArticleStatus[] = ["drafting", "review", "delivered", "published", "killed"];

const STATUS_TONE: Record<ArticleStatus, string> = {
  drafting: "border-[#F5C542]/40 bg-[#F5C542]/10 text-[#F5C542]",
  review: "border-[#8EB0FF]/40 bg-[#5B8EFF]/10 text-[#8EB0FF]",
  delivered: "border-[#42CA80]/40 bg-[#42CA80]/10 text-[#65FFAA]",
  published: "border-[#42CA80]/50 bg-[#42CA80]/20 text-[#65FFAA]",
  killed: "border-[#ED6958]/40 bg-[#ED6958]/10 text-[#ED6958]",
};

export default function ArticlesPage() {
  const {
    dims,
    articles,
    addArticle,
    updateArticle,
    deleteArticle,
    selectedMonth,
    isMonthClosed,
  } = useCP2Store();
  const closed = isMonthClosed(selectedMonth);

  const [clientFilter, setClientFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const clientName = (id: number) => dims.clients.find((c) => c.id === id)?.name ?? `#${id}`;
  const memberName = (id: number | null) => (id === null ? "—" : dims.members.find((m) => m.id === id)?.full_name ?? `#${id}`);

  const filtered = useMemo(() => {
    let list = articles.filter((a) => a.monthKey === selectedMonth);
    if (clientFilter !== "all") list = list.filter((a) => String(a.clientId) === clientFilter);
    if (statusFilter !== "all") list = list.filter((a) => a.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.notionCaseId.toLowerCase().includes(q) ||
          clientName(a.clientId).toLowerCase().includes(q),
      );
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articles, selectedMonth, clientFilter, statusFilter, search]);

  // Rollup metrics
  const rollup = useMemo(() => {
    const total = filtered.length;
    const withRevision = filtered.filter((a) => a.revisionCount > 0).length;
    const withSecondReview = filtered.filter((a) => a.hadSecondReview).length;
    const deliveredOrPublished = filtered.filter((a) => a.status === "delivered" || a.status === "published");
    const avgTurnaround = deliveredOrPublished.length === 0
      ? 0
      : Math.round(deliveredOrPublished.reduce((s, a) => s + (a.turnaroundDays ?? 0), 0) / deliveredOrPublished.length);
    return {
      total,
      revisionRatePct: total > 0 ? Math.round((withRevision / total) * 100) : 0,
      secondReviewCount: withSecondReview,
      avgTurnaround,
    };
  }, [filtered]);

  function handleAdd() {
    const defaultClient = dims.clients[0];
    if (!defaultClient) return;
    addArticle({
      notionCaseId: `CASE-${Math.floor(Math.random() * 100000)}`,
      clientId: defaultClient.id,
      podId: null,
      writerId: null,
      editorId: null,
      srEditorId: null,
      monthKey: selectedMonth,
      title: "New article",
      cbApprovedDate: null,
      deliveredDate: null,
      publishedDate: null,
      turnaroundDays: null,
      revisionCount: 0,
      hadSecondReview: false,
      status: "drafting",
      notionUrl: "",
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <StickyPageChrome subtitle="Article workflow tracking. Edit inline to update revision count, turnaround, and second-review flag — the three KPIs derived from cp2_fact_article." />
      <ClosedMonthBanner />

      {/* Rollups */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Roll label="Articles (this month)" value={rollup.total} />
        <Roll
          label="Revision rate"
          value={`${rollup.revisionRatePct}%`}
          tone={rollup.revisionRatePct <= 15 ? "green" : rollup.revisionRatePct <= 25 ? "yellow" : "red"}
        />
        <Roll
          label="Avg turnaround"
          value={`${rollup.avgTurnaround} d`}
          tone={rollup.avgTurnaround <= 14 ? "green" : rollup.avgTurnaround <= 20 ? "yellow" : "red"}
        />
        <Roll label="Second reviews" value={rollup.secondReviewCount} tone="green" />
      </div>

      {/* Filters + add */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-[#606060]">
        <select
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
          className="h-6 rounded border border-[#2a2a2a] bg-[#161616] px-2 font-sans text-xs text-white focus:border-[#42CA80]/50 focus:outline-none"
        >
          <option value="all">All clients</option>
          {dims.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-6 rounded border border-[#2a2a2a] bg-[#161616] px-2 font-sans text-xs text-white focus:border-[#42CA80]/50 focus:outline-none"
        >
          <option value="all">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Search title / case id"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-6 rounded border border-[#2a2a2a] bg-[#161616] px-2 font-sans text-xs text-white placeholder:text-[#606060] focus:border-[#42CA80]/50 focus:outline-none"
        />
        <span>{filtered.length} matching · {monthLabel(selectedMonth)}</span>
        <button
          type="button"
          onClick={handleAdd}
          disabled={closed}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-[#42CA80]/40 bg-[#42CA80]/10 px-2 py-0.5 text-[#65FFAA] hover:bg-[#42CA80]/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-3 w-3" />
          New article
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-[#1f1f1f] bg-[#0a0a0a]">
        <table className="w-full min-w-[1100px] border-collapse font-mono text-[11px]">
          <thead>
            <tr className="border-b border-[#1a1a1a] bg-[#050505] text-[10px] uppercase tracking-wider text-[#606060]">
              <th className="px-3 py-2 text-left">Title</th>
              <th className="px-2 py-2 text-left">Client</th>
              <th className="px-2 py-2 text-left">Writer</th>
              <th className="px-2 py-2 text-left">Editor</th>
              <th className="px-2 py-2 text-right">CB approved</th>
              <th className="px-2 py-2 text-right">Delivered</th>
              <th className="px-2 py-2 text-center">Turnaround (d)</th>
              <th className="px-2 py-2 text-center">Revisions</th>
              <th className="px-2 py-2 text-center">2nd review</th>
              <th className="px-2 py-2 text-left">Status</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((a, idx) => (
              <tr
                key={a.id}
                className={`${idx % 2 === 0 ? "bg-[#0a0a0a]" : "bg-[#0c0c0c]"} border-t border-[#111]`}
              >
                <td className="px-3 py-1.5 text-xs text-white">
                  <input
                    value={a.title}
                    disabled={closed}
                    onChange={(e) => updateArticle(a.id, { title: e.target.value })}
                    className="w-full min-w-[220px] bg-transparent outline-none focus:border-b focus:border-[#42CA80]/50"
                  />
                  <div className="mt-0.5 text-[10px] text-[#606060]">{a.notionCaseId}</div>
                </td>
                <td className="px-2 py-1.5 text-[#C4BCAA]">{clientName(a.clientId)}</td>
                <td className="px-2 py-1.5 text-[#C4BCAA]">{memberName(a.writerId)}</td>
                <td className="px-2 py-1.5 text-[#C4BCAA]">{memberName(a.editorId)}</td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="date"
                    value={a.cbApprovedDate ?? ""}
                    disabled={closed}
                    onChange={(e) => updateArticle(a.id, { cbApprovedDate: e.target.value || null })}
                    className="bg-transparent text-[11px] text-[#C4BCAA] outline-none"
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="date"
                    value={a.deliveredDate ?? ""}
                    disabled={closed}
                    onChange={(e) => updateArticle(a.id, { deliveredDate: e.target.value || null })}
                    className="bg-transparent text-[11px] text-[#C4BCAA] outline-none"
                  />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <span
                    className={`inline-block rounded border px-1.5 py-0.5 font-semibold ${
                      a.turnaroundDays === null
                        ? "border-[#333] text-[#606060]"
                        : a.turnaroundDays <= 14
                          ? "border-[#42CA80]/40 bg-[#42CA80]/10 text-[#65FFAA]"
                          : a.turnaroundDays <= 20
                            ? "border-[#F5C542]/40 bg-[#F5C542]/10 text-[#F5C542]"
                            : "border-[#ED6958]/40 bg-[#ED6958]/10 text-[#ED6958]"
                    }`}
                    title="Auto-computed from delivered − cb_approved"
                  >
                    {a.turnaroundDays ?? "—"}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-center">
                  <input
                    type="number"
                    min={0}
                    value={a.revisionCount}
                    disabled={closed}
                    onChange={(e) => updateArticle(a.id, { revisionCount: parseInt(e.target.value || "0", 10) })}
                    className={`h-6 w-14 rounded border border-[#2a2a2a] bg-[#161616] px-1 text-center outline-none focus:border-[#42CA80]/50 ${a.revisionCount === 0 ? "text-[#65FFAA]" : "text-white"}`}
                  />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <button
                    type="button"
                    disabled={closed}
                    onClick={() => updateArticle(a.id, { hadSecondReview: !a.hadSecondReview })}
                    className={`inline-flex h-6 w-6 items-center justify-center rounded border ${
                      a.hadSecondReview
                        ? "border-[#42CA80]/40 bg-[#42CA80]/10 text-[#65FFAA]"
                        : "border-[#2a2a2a] text-[#606060] hover:text-white"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {a.hadSecondReview ? <CheckCircle2 className="h-3.5 w-3.5" /> : "—"}
                  </button>
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={a.status}
                    disabled={closed}
                    onChange={(e) => updateArticle(a.id, { status: e.target.value as ArticleStatus })}
                    className={`h-6 rounded border px-2 font-semibold uppercase tracking-wider ${STATUS_TONE[a.status]}`}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s} className="bg-[#0a0a0a] text-white">
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    type="button"
                    disabled={closed}
                    onClick={() => {
                      if (confirm(`Delete article "${a.title}"?`)) deleteArticle(a.id);
                    }}
                    className="text-[#606060] hover:text-[#ED6958] disabled:cursor-not-allowed disabled:opacity-50"
                    title="Delete article"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-[#606060]">
                  No articles match the filter. Click <b className="text-white">New article</b> to add one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3 text-[11px] text-[#C4BCAA]">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#42CA80]" />
        <span>
          Rollups above drive the Team KPIs dashboard — revision rate, turnaround time, second reviews per month.{" "}
          Turnaround is auto-computed when both dates are present.
        </span>
      </div>
    </div>
  );
}

function Roll({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "green" | "yellow" | "red";
}) {
  const color =
    tone === "green"
      ? "text-[#65FFAA]"
      : tone === "red"
        ? "text-[#ED6958]"
        : tone === "yellow"
          ? "text-[#F5C542]"
          : "text-white";
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">{label}</span>
      <span className={`font-mono text-xl font-semibold ${color}`}>{value}</span>
    </div>
  );
}
