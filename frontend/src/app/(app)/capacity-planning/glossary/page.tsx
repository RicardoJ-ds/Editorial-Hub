"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { SubNav } from "../_SubNav";
import { ProposalBanner } from "../_ProposalBanner";
import { KPI_GLOSSARY, type KpiMapping } from "../_erd";

const DASHBOARD_LABEL: Record<KpiMapping["dashboard"], string> = {
  "team-kpis": "Team KPIs",
  "editorial-clients": "Editorial Clients",
};

const DIRECTION_LABEL: Record<KpiMapping["direction"], string> = {
  higher_is_better: "↑ higher is better",
  lower_is_better: "↓ lower is better",
  band: "↔ target band",
};

const DIRECTION_CLASS: Record<KpiMapping["direction"], string> = {
  higher_is_better: "text-[#42CA80]",
  lower_is_better: "text-[#F28D59]",
  band: "text-[#F5C542]",
};

type Filter = "all" | KpiMapping["dashboard"];

export default function GlossaryPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const filtered = useMemo(
    () => (filter === "all" ? KPI_GLOSSARY : KPI_GLOSSARY.filter((k) => k.dashboard === filter)),
    [filter]
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-10 z-20 flex flex-col gap-3 bg-black pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-white">KPI Glossary</h2>
            <p className="mt-1 text-sm text-[#C4BCAA]">
              Every metric shown on current dashboards, mapped to the ERD table and columns that will feed it after the transition.
            </p>
          </div>
          <SubNav />
        </div>
        <ProposalBanner />
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2 font-mono text-xs">
        {(["all", "team-kpis", "editorial-clients"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-md border px-3 py-1.5 uppercase tracking-wider transition-colors ${
              filter === f
                ? "border-[#42CA80]/50 bg-[#42CA80]/10 text-[#65FFAA]"
                : "border-[#1f1f1f] bg-[#0a0a0a] text-[#C4BCAA] hover:border-[#333]"
            }`}
          >
            {f === "all" ? "All dashboards" : DASHBOARD_LABEL[f]}
          </button>
        ))}
        <span className="ml-auto font-mono text-[11px] text-[#606060]">
          {filtered.length} metric{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Glossary cards */}
      <div className="grid gap-3 lg:grid-cols-2">
        {filtered.map((k) => (
          <article
            key={k.metric_key}
            className="rounded-xl border border-[#1f1f1f] bg-[#0a0a0a] p-5"
          >
            <header className="flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold text-white">
                  <BookOpen className="h-4 w-4 text-[#42CA80]" />
                  {k.display_name}
                </h3>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-widest text-[#606060]">
                  <span>{DASHBOARD_LABEL[k.dashboard]}</span>
                  <span>·</span>
                  <span>{k.unit}</span>
                  <span>·</span>
                  <span>target {k.target}</span>
                </div>
              </div>
              <span className={`shrink-0 font-mono text-[10px] ${DIRECTION_CLASS[k.direction]}`}>
                {DIRECTION_LABEL[k.direction]}
              </span>
            </header>

            <div className="mt-4 grid gap-3 text-xs">
              <div className="flex items-center gap-2 font-mono">
                <span className="rounded border border-[#333] px-2 py-0.5 text-[#C4BCAA]">
                  Today: {k.currentSource}
                </span>
                <ArrowRight className="h-3 w-3 text-[#606060]" />
                <span className="rounded border border-[#42CA80]/40 bg-[#42CA80]/5 px-2 py-0.5 text-[#65FFAA]">
                  {k.erdTable}
                </span>
              </div>

              <div>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-[#606060]">
                  Columns
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {k.erdColumns.map((c) => (
                    <code
                      key={c}
                      className="rounded bg-[#161616] px-1.5 py-0.5 font-mono text-[11px] text-[#C4BCAA]"
                    >
                      {c}
                    </code>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-[#606060]">
                  Formula
                </div>
                <p className="text-[12px] leading-relaxed text-[#C4BCAA]">{k.formula}</p>
              </div>

              {k.notes && (
                <p className="text-[11px] italic text-[#606060]">{k.notes}</p>
              )}
            </div>
          </article>
        ))}
      </div>

      <footer className="rounded-xl border border-[#1f1f1f] bg-[#0a0a0a] p-4 text-xs text-[#C4BCAA]">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#606060]">
          Transition note
        </span>
        <p className="mt-1 leading-relaxed">
          Once the <span className="font-mono text-[#65FFAA]">cp2_*</span> tables are populated, each
          dashboard cell pulls from the ERD table listed above. Nothing changes in the UI — only the
          data pipeline behind it. See{" "}
          <Link href="/capacity-planning/schema" className="text-[#65FFAA] hover:underline">
            Schema
          </Link>{" "}
          for the diagram, and{" "}
          <Link href="/capacity-planning/tables" className="text-[#65FFAA] hover:underline">
            Tables
          </Link>{" "}
          for mock rows.
        </p>
      </footer>
    </div>
  );
}
