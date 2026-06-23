"use client";

import { useEffect, useState } from "react";

import { apiGet } from "@/lib/api";

// Live replacement for the static "Name & Client Normalization Map" artifact.
// Reads /api/admin/normalization-summary so the numbers never drift, and draws
// the CURRENT lineage (one BigQuery source, not the old Neon-JSON layer).

interface NormSummary {
  distinct_articles: number;
  editor_credits: number;
  auditioning_writers: number;
  distinct_editors: number;
  distinct_writers: number;
  total_client_tabs: number;
  unresolved_client_tabs: number;
  tab_coverage_pct: number;
  mappings_writer: number;
  mappings_editor: number;
  mappings_client: number;
  generated_at: string;
}

const SOURCES = [
  "Monthly Article Count sheet",
  "Meta Editorial Tracker",
  "Editorial Name Mappings sheet",
  "Notion content machine",
  "Rippling v_headcount",
  "Slack · Salesforce",
];

const CONSUMERS = [
  "Team KPIs · Monthly Articles",
  "Capacity · per-editor",
  "Warehouse · Postgres + BigQuery",
  "Proposal sheets · STANDARD cols",
];

export function NormalizationMapTab() {
  const [d, setD] = useState<NormSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<NormSummary>("/api/admin/normalization-summary")
      .then(setD)
      .catch((e) => setErr(String(e)));
  }, []);

  if (err)
    return <div className="p-4 font-mono text-[12px] text-[#ED6958]">Failed to load: {err}</div>;
  if (!d) return <div className="p-4 font-mono text-[12px] text-[#606060]">Loading…</div>;

  const resolved = d.total_client_tabs - d.unresolved_client_tabs;
  const totalMappings = d.mappings_writer + d.mappings_editor + d.mappings_client;

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto pr-1">
      {/* live KPI strip */}
      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Article rows"
          value={d.distinct_articles}
          helper={`${d.editor_credits.toLocaleString()} editor-credits`}
          color="#42CA80"
        />
        <Stat
          label="Name mappings"
          value={totalMappings}
          helper={`${d.mappings_writer} wr · ${d.mappings_editor} ed · ${d.mappings_client} cl`}
          color="#65FFAA"
        />
        <Stat
          label="Auditioning writers"
          value={d.auditioning_writers}
          helper="collapsed bucket"
          color="#F5BC4E"
        />
        <Stat
          label="Editors / writers"
          value={`${d.distinct_editors} / ${d.distinct_writers}`}
          helper="distinct canonical"
          color="#C4BCAA"
        />
        <Stat
          label="Unresolved tabs"
          value={d.unresolved_client_tabs}
          helper={`of ${d.total_client_tabs} client tabs`}
          color={d.unresolved_client_tabs ? "#ED6958" : "#42CA80"}
        />
        <Stat
          label="Tab coverage"
          value={`${d.tab_coverage_pct}%`}
          helper={`${resolved}/${d.total_client_tabs} resolved`}
          color={d.tab_coverage_pct >= 90 ? "#42CA80" : "#F5BC4E"}
        />
      </div>

      {/* lineage: raw values → canonical entities → dashboards */}
      <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] p-4">
        <p className="mb-3 font-mono text-[11px] uppercase tracking-wider text-[#606060]">
          Raw spreadsheet values → canonical entities → dashboards
        </p>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
          <Stage title="① Sources" items={SOURCES} />
          <Arrow />
          <Stage
            title="② Mapping layer"
            highlight
            items={[
              "editorial_name_map (BigQuery)",
              "← DaniQ's Editorial Name Mappings sheet",
              `${totalMappings} rows · ${d.mappings_writer} wr / ${d.mappings_editor} ed / ${d.mappings_client} cl`,
            ]}
          />
          <Arrow />
          <Stage
            title="③ Resolved (Neon)"
            items={["article_records · editor / writer / client", "article_revisions"]}
          />
          <Arrow />
          <Stage title="④ Consumed" items={CONSUMERS} />
        </div>
        <p className="mt-3 font-mono text-[10px] text-[#606060]">
          Live · generated {new Date(`${d.generated_at}Z`).toLocaleString()} · edits are made in the
          Editorial Name Mappings sheet and land on the next SYNC (the{" "}
          <span className="text-[#65FFAA]">@name-mappings</span> step publishes the sheet to
          BigQuery).
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  helper,
  color,
}: {
  label: string;
  value: number | string;
  helper?: string;
  color: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-[#2a2a2a] bg-[#161616] px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">{label}</p>
      <p className="font-mono text-lg font-bold tabular-nums" style={{ color }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {helper && <p className="font-mono text-[10px] text-[#909090]">{helper}</p>}
    </div>
  );
}

function Stage({
  title,
  items,
  highlight = false,
}: {
  title: string;
  items: string[];
  highlight?: boolean;
}) {
  return (
    <div
      className="flex-1 rounded-lg border bg-[#161616] p-3"
      style={{ borderColor: highlight ? "#42CA80" : "#2a2a2a" }}
    >
      <p
        className="mb-2 font-mono text-[10px] uppercase tracking-wider"
        style={{ color: highlight ? "#65FFAA" : "#909090" }}
      >
        {title}
      </p>
      <ul className="flex flex-col gap-1">
        {items.map((it) => (
          <li
            key={it}
            className="rounded border border-[#2a2a2a] bg-[#0d0d0d] px-2 py-1 font-mono text-[11px] text-[#C4BCAA]"
          >
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex items-center justify-center font-mono text-[#42CA80] lg:px-0.5">
      <span className="rotate-90 lg:rotate-0">→</span>
    </div>
  );
}
