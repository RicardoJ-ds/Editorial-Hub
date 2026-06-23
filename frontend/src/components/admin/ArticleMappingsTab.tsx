"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGet } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";

// Data Quality → "Article mappings": READ-ONLY normalization review for the
// Monthly Article Count importer. Three columns — Clients · Editors · Writers.
// Shows every value (mapped / canonical / unmapped) with a per-column filter so
// the running normalization state is visible. Editing is NOT done here anymore —
// the raw→canonical decisions live in the "Editorial Name Mappings" Google Sheet
// (one tab per kind), which syncs to BigQuery `editorial_name_map` on the next
// SYNC; the importer resolves from there. This tab is the result view.

const MAP_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1p0tFg4D8BypZlG6Rfch7KKsqaNa8xUUZRn2BFv6oLsc/edit";

interface ClientRow {
  raw_value: string;
  occurrences: number;
  status: "unmapped" | "canonical" | "alias";
  resolved_to: string | null;
  first_month: string | null;
  last_month: string | null;
}
interface NameRow {
  name: string;
  count: number;
  tab_count: number;
  tabs: string[];
}
interface AliasRow {
  kind: string;
  raw_value: string;
  canonical_value: string;
}
interface UnmappedResp {
  clients: ClientRow[];
  editors: NameRow[];
  writers: NameRow[];
  client_options: string[];
  aliases: AliasRow[];
}

type ColFilter = "all" | "unmapped" | "mapped";

function fmtSpan(a: string | null, b: string | null): string | null {
  if (!a && !b) return null;
  return a === b ? a : `${a ?? "?"} → ${b ?? "?"}`;
}

// Small segmented filter (All / Unmapped / Mapped).
function Seg({
  options,
  value,
  onChange,
}: {
  options: { key: ColFilter; label: string }[];
  value: ColFilter;
  onChange: (v: ColFilter) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-[#1e1e1e] bg-[#0d0d0d] p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            "rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
            value === o.key ? "bg-[#42CA80]/15 text-[#42CA80]" : "text-[#606060] hover:text-[#C4BCAA]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// One read-only mapping row: a value + a status/origin subline.
function MappingRow({ label, count, subline }: { label: string; count: number; subline?: ReactNode }) {
  return (
    <div className="border-b border-[#1f1f1f] px-3 py-2 last:border-b-0 hover:bg-[#1a1a1a]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-semibold text-white" title={label}>
          {label}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-[#606060]">{count}</span>
      </div>
      {subline && <div className="mt-0.5 truncate font-mono text-[10px]">{subline}</div>}
    </div>
  );
}

function MappingColumn({
  title,
  subtitle,
  filter,
  children,
}: {
  title: string;
  subtitle: string;
  filter: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-[#2a2a2a] bg-[#161616]">
      <div className="shrink-0 border-b border-[#2a2a2a] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#C4BCAA]">{title}</h3>
          {filter}
        </div>
        <p className="mt-0.5 font-mono text-[10px] text-[#606060]">{subtitle}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main tab — read-only
// ---------------------------------------------------------------------------

export function ArticleMappingsTab() {
  const [data, setData] = useState<UnmappedResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientFilter, setClientFilter] = useState<ColFilter>("all");
  const [editorFilter, setEditorFilter] = useState<ColFilter>("all");
  const [writerFilter, setWriterFilter] = useState<ColFilter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiGet<UnmappedResp>("/api/articles/unmapped"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load mappings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const aliasByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of data?.aliases ?? []) m.set(`${a.kind}:${a.raw_value}`, a.canonical_value);
    return m;
  }, [data?.aliases]);

  if (loading && !data) {
    return (
      <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-8 text-center font-mono text-[12px] text-[#606060]">
        Loading article mappings…
      </div>
    );
  }
  if (!data) {
    return error ? (
      <div className="rounded-md border border-[#ED6958]/40 bg-[#ED6958]/10 px-3 py-2 font-mono text-[11px] text-[#ED6958]">
        {error}
      </div>
    ) : null;
  }

  // ----- counts + filtered views -----
  const clientUnmapped = data.clients.filter((c) => c.status === "unmapped").length;
  const editorMerged = data.editors.filter((e) => aliasByKey.has(`editor:${e.name}`)).length;
  const writerMerged = data.writers.filter((w) => aliasByKey.has(`writer:${w.name}`)).length;

  const shownClients = data.clients.filter((c) =>
    clientFilter === "all"
      ? true
      : clientFilter === "unmapped"
        ? c.status === "unmapped"
        : c.status !== "unmapped",
  );
  const filterNames = (rows: NameRow[], kind: "editor" | "writer", f: ColFilter) =>
    rows.filter((r) => {
      const mapped = aliasByKey.has(`${kind}:${r.name}`);
      return f === "all" ? true : f === "mapped" ? mapped : !mapped;
    });
  const shownEditors = filterNames(data.editors, "editor", editorFilter);
  const shownWriters = filterNames(data.writers, "writer", writerFilter);

  const clientFilterOpts: { key: ColFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "unmapped", label: "To map" },
    { key: "mapped", label: "Mapped" },
  ];
  const mergeFilterOpts: { key: ColFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "mapped", label: "Merged" },
  ];

  const clientSubline = (c: ClientRow): ReactNode => {
    const span = fmtSpan(c.first_month, c.last_month);
    const spanText = span ? <span className="text-[#606060]"> · {span}</span> : null;
    if (c.status === "unmapped") return <span className="text-[#ED6958]">Unmapped{spanText}</span>;
    if (c.status === "alias")
      return (
        <span className="text-[#42CA80]">
          → {c.resolved_to} <span className="text-[#606060]">(alias · next sync)</span>
          {spanText}
        </span>
      );
    return (
      <span className="text-[#42CA80]">
        resolves to {c.resolved_to}
        {spanText}
      </span>
    );
  };

  const mergeSubline = (name: string, kind: "editor" | "writer", tabs: string[], tabCount: number) => {
    const existing = aliasByKey.get(`${kind}:${name}`);
    return (
      <>
        {existing && <span className="text-[#42CA80]">→ {existing} · </span>}
        <span className="text-[#606060]">
          in {tabs.slice(0, 3).join(", ")}
          {tabCount > 3 ? ` +${tabCount - 3}` : ""}
        </span>
      </>
    );
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="shrink-0 space-y-2">
        <div className="flex items-center justify-between gap-3 rounded-md border border-[#2a2a2a] bg-[#161616] px-3 py-2">
          <p className="font-mono text-[11px] leading-relaxed text-[#606060]">
            Read-only normalization review for the Monthly Article Count source. Raw→canonical
            decisions are maintained in the <span className="text-[#C4BCAA]">Editorial Name Mappings</span>{" "}
            sheet and apply on the next <span className="text-[#C4BCAA]">SYNC</span>. This view shows
            what currently resolves and what is still unmapped.
          </p>
          <a
            href={MAP_SHEET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#42CA80]/40 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[#42CA80] hover:bg-[#42CA80]/10"
          >
            <ExternalLink className="h-3 w-3" />
            Edit in the sheet
          </a>
        </div>
        {error && (
          <div className="rounded-md border border-[#ED6958]/40 bg-[#ED6958]/10 px-3 py-2 font-mono text-[11px] text-[#ED6958]">
            {error}
          </div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-3">
        {/* Clients */}
        <MappingColumn
          title={`Clients (${data.clients.length})`}
          subtitle={`${clientUnmapped} to map · ${data.clients.length - clientUnmapped} resolved`}
          filter={<Seg options={clientFilterOpts} value={clientFilter} onChange={setClientFilter} />}
        >
          {shownClients.length === 0 ? (
            <p className="px-3 py-6 text-center font-mono text-xs text-[#606060]">Nothing here.</p>
          ) : (
            shownClients.map((c) => (
              <MappingRow
                key={c.raw_value}
                label={c.raw_value}
                count={c.occurrences}
                subline={clientSubline(c)}
              />
            ))
          )}
        </MappingColumn>

        {/* Editors */}
        <MappingColumn
          title={`Editors (${data.editors.length})`}
          subtitle={`${editorMerged} merged`}
          filter={<Seg options={mergeFilterOpts} value={editorFilter} onChange={setEditorFilter} />}
        >
          {shownEditors.map((ed) => (
            <MappingRow
              key={ed.name}
              label={ed.name}
              count={ed.count}
              subline={mergeSubline(ed.name, "editor", ed.tabs, ed.tab_count)}
            />
          ))}
        </MappingColumn>

        {/* Writers */}
        <MappingColumn
          title={`Writers (${data.writers.length})`}
          subtitle={`${writerMerged} merged`}
          filter={<Seg options={mergeFilterOpts} value={writerFilter} onChange={setWriterFilter} />}
        >
          {shownWriters.map((w) => (
            <MappingRow
              key={w.name}
              label={w.name}
              count={w.count}
              subline={mergeSubline(w.name, "writer", w.tabs, w.tab_count)}
            />
          ))}
        </MappingColumn>
      </div>
    </div>
  );
}
