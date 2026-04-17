"use client";

import { useMemo, useState } from "react";
import { Key, Link2, Database, LayoutPanelTop } from "lucide-react";
import { SubNav } from "../_SubNav";
import { ProposalBanner } from "../_ProposalBanner";
import { TABLES, type TableSpec } from "../_erd";
import { TABLE_MOCK_ROWS } from "../_tableMocks";

const DOMAIN_LABEL: Record<TableSpec["domain"], string> = {
  capacity: "Capacity",
  kpi: "KPIs",
  delivery: "Delivery",
  pipeline: "Pipeline",
  ai: "AI Compliance",
  reference: "Reference",
};

const DOMAIN_ACCENT: Record<TableSpec["domain"], string> = {
  capacity: "text-[#65FFAA] border-[#42CA80]/40",
  kpi: "text-[#F5C542] border-[#F5C542]/40",
  delivery: "text-[#8EB0FF] border-[#5B8EFF]/40",
  pipeline: "text-[#CEBCF4] border-[#CEBCF4]/40",
  ai: "text-[#F28D59] border-[#F28D59]/40",
  reference: "text-[#C4BCAA] border-[#333]",
};

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

export default function TablesPage() {
  const grouped = useMemo(() => {
    const by: Record<string, TableSpec[]> = {};
    for (const t of TABLES) {
      (by[t.domain] ??= []).push(t);
    }
    return by;
  }, []);

  const [selectedId, setSelectedId] = useState<string>(TABLES[0].id);
  const selected = TABLES.find((t) => t.id === selectedId) ?? TABLES[0];
  const rows = TABLE_MOCK_ROWS[selected.id] ?? [];
  const columnOrder = selected.columns.map((c) => c.name);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Data Tables</h2>
          <p className="mt-1 text-sm text-[#C4BCAA]">
            Every <span className="font-mono text-[#65FFAA]">cp2_*</span> table, grouped by domain.
            Pick one to see its columns and a few mock rows.
          </p>
        </div>
        <SubNav />
      </div>

      <ProposalBanner />

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Table list */}
        <aside className="space-y-4 rounded-xl border border-[#1f1f1f] bg-[#0a0a0a] p-3">
          {Object.keys(grouped).map((domain) => (
            <div key={domain}>
              <div className="px-2 pb-1 font-mono text-[10px] uppercase tracking-widest text-[#606060]">
                {DOMAIN_LABEL[domain as TableSpec["domain"]]}
              </div>
              <ul className="space-y-1">
                {grouped[domain].map((t) => {
                  const active = t.id === selectedId;
                  const Icon = t.group === "dim" ? LayoutPanelTop : Database;
                  return (
                    <li key={t.id}>
                      <button
                        onClick={() => setSelectedId(t.id)}
                        className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[11px] transition-colors ${
                          active
                            ? "bg-[#42CA80]/10 text-[#65FFAA]"
                            : "text-[#C4BCAA] hover:bg-[#161616] hover:text-white"
                        }`}
                      >
                        <Icon className="mt-0.5 h-3 w-3 shrink-0 opacity-70" />
                        <span className="flex-1 break-all">{t.name}</span>
                        <span
                          className={`rounded-sm border px-1 py-[1px] text-[9px] uppercase ${DOMAIN_ACCENT[t.domain]}`}
                        >
                          {t.group}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </aside>

        {/* Table detail */}
        <section className="space-y-4">
          <header className="rounded-xl border border-[#1f1f1f] bg-[#0a0a0a] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-mono text-lg font-semibold text-white">{selected.name}</h3>
                <p className="mt-1 text-sm text-[#C4BCAA]">{selected.description}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span
                  className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${DOMAIN_ACCENT[selected.domain]}`}
                >
                  {selected.group} · {DOMAIN_LABEL[selected.domain]}
                </span>
                <span className="font-mono text-[10px] text-[#606060]">
                  {selected.columns.length} columns · {rows.length} mock rows
                </span>
              </div>
            </div>
          </header>

          {/* Columns */}
          <div className="overflow-hidden rounded-xl border border-[#1f1f1f] bg-[#0a0a0a]">
            <div className="border-b border-[#1f1f1f] px-5 py-2 font-mono text-[10px] uppercase tracking-widest text-[#606060]">
              Columns
            </div>
            <table className="w-full font-mono text-xs">
              <thead className="bg-[#050505] text-[10px] uppercase tracking-wider text-[#606060]">
                <tr>
                  <th className="w-8 px-3 py-2" />
                  <th className="px-3 py-2 text-left">name</th>
                  <th className="px-3 py-2 text-left">type</th>
                  <th className="px-3 py-2 text-left">null?</th>
                  <th className="px-3 py-2 text-left">note</th>
                </tr>
              </thead>
              <tbody>
                {selected.columns.map((c) => {
                  const isPk = c.kind === "pk" || c.kind === "pk-fk";
                  const isFk = c.kind === "fk" || c.kind === "pk-fk";
                  return (
                    <tr key={c.name} className="border-t border-[#111]">
                      <td className="px-3 py-1.5 align-top">
                        {isPk ? (
                          <Key className="h-3 w-3 text-[#F5C542]" aria-label="primary key" />
                        ) : isFk ? (
                          <Link2 className="h-3 w-3 text-[#8EB0FF]" aria-label="foreign key" />
                        ) : null}
                      </td>
                      <td className={`px-3 py-1.5 align-top ${isPk ? "font-semibold text-white" : "text-[#C4BCAA]"}`}>
                        {c.name}
                      </td>
                      <td className="px-3 py-1.5 align-top text-[#C4BCAA]">{c.type}</td>
                      <td className="px-3 py-1.5 align-top text-[#606060]">{c.nullable ? "yes" : ""}</td>
                      <td className="px-3 py-1.5 align-top text-[#C4BCAA]">{c.note ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mock rows */}
          <div className="overflow-hidden rounded-xl border border-[#1f1f1f] bg-[#0a0a0a]">
            <div className="border-b border-[#1f1f1f] px-5 py-2 font-mono text-[10px] uppercase tracking-widest text-[#606060]">
              Mock rows — for illustration only
            </div>
            {rows.length === 0 ? (
              <div className="px-5 py-6 text-sm text-[#606060]">
                No mock rows yet for this table.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full font-mono text-[11px]">
                  <thead className="bg-[#050505] text-[10px] uppercase tracking-wider text-[#606060]">
                    <tr>
                      {columnOrder.map((col) => (
                        <th key={col} className="whitespace-nowrap px-3 py-2 text-left">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className="border-t border-[#111]">
                        {columnOrder.map((col) => {
                          const v = row[col];
                          const isNull = v === null || v === undefined;
                          return (
                            <td
                              key={col}
                              className={`whitespace-nowrap px-3 py-1.5 ${isNull ? "text-[#444]" : "text-[#C4BCAA]"}`}
                            >
                              {formatCell(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
