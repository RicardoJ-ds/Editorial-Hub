"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCcw } from "lucide-react";

import {
  ClearFiltersButton,
  type ColumnFilterValue,
  FilterableHeader,
  matchesFilter,
} from "@/components/admin/ColumnFilter";
import { apiGet } from "@/lib/api";
import { cn } from "@/lib/utils";

// DaniQ-editable source of truth for name normalization (Writers / Editors tabs).
const NAME_MAP_SHEET =
  "https://docs.google.com/spreadsheets/d/1p0tFg4D8BypZlG6Rfch7KKsqaNa8xUUZRn2BFv6oLsc";

type Item = {
  source: string;
  source_label: string;
  raw_name: string;
  occurrences: number;
  context: string | null;
  suggestion: string | null;
  origin_label: string;
  origin_url: string | null;
  fix_hint: string;
};
type Resp = {
  items: Item[];
  sources: { key: string; label: string; count: number }[];
  generated_at: string;
};

type Group = "all" | "writer_form" | "article_log";
const groupOf = (src: string): Group => (src === "writer_form" ? "writer_form" : "article_log");

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors",
        active
          ? "border-[#42CA80]/40 bg-[#42CA80]/10 text-[#42CA80]"
          : "border-[#2a2a2a] bg-[#0d0d0d] text-[#606060] hover:text-[#909090]",
      )}
    >
      {label}
    </button>
  );
}

export function UnmappedNamesTab() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<Group>("all");
  const [colFilters, setColFilters] = useState<Record<string, ColumnFilterValue>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiGet<Resp>("/api/admin/unmapped-names"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const wfCount = items.filter((i) => groupOf(i.source) === "writer_form").length;
  const alCount = items.filter((i) => groupOf(i.source) === "article_log").length;
  const sourceOptions = useMemo(
    () => Array.from(new Set(items.map((i) => i.source_label))).sort(),
    [items],
  );

  const filtered = useMemo(
    () =>
      items.filter((i) => {
        if (group !== "all" && groupOf(i.source) !== group) return false;
        if (colFilters.source && !matchesFilter(i.source_label, colFilters.source)) return false;
        if (colFilters.name && !matchesFilter(i.raw_name, colFilters.name)) return false;
        if (colFilters.suggestion && !matchesFilter(i.suggestion ?? "", colFilters.suggestion))
          return false;
        return true;
      }),
    [items, group, colFilters],
  );

  if (loading && !data)
    return (
      <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-8 text-center font-mono text-[12px] text-[#606060]">
        Loading…
      </div>
    );
  if (!data)
    return error ? (
      <div className="rounded-md border border-[#ED6958]/40 bg-[#ED6958]/10 px-3 py-2 font-mono text-[11px] text-[#ED6958]">
        {error}
      </div>
    ) : null;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="shrink-0 space-y-1 font-mono text-[11px] leading-relaxed text-[#606060]">
        <p>
          <span className="text-[#909090]">What&apos;s flagged:</span> names from every source we
          canonicalize (the writers&apos; desired-article form, the article log) that don&apos;t
          resolve to a roster canonical — real gaps only, junk cells filtered out.
        </p>
        <p>
          <span className="text-[#909090]">How to fix (at the source):</span> add the raw → canonical
          row in the{" "}
          <a
            href={NAME_MAP_SHEET}
            target="_blank"
            rel="noreferrer"
            className="text-[#42CA80] hover:text-[#65FFAA]"
          >
            Editorial Name Mappings sheet <ExternalLink className="inline h-3 w-3" />
          </a>{" "}
          (Writers / Editors tab), or onboard the person in the roster. The next{" "}
          <span className="text-[#909090]">SYNC</span> re-resolves it and the row disappears here.
          Read-only — no edits in the app.
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <FilterChip label={`All · ${items.length}`} active={group === "all"} onClick={() => setGroup("all")} />
        <FilterChip
          label={`Writer form · ${wfCount}`}
          active={group === "writer_form"}
          onClick={() => setGroup("writer_form")}
        />
        <FilterChip
          label={`Article log · ${alCount}`}
          active={group === "article_log"}
          onClick={() => setGroup("article_log")}
        />
        <div className="ml-auto">
          <ClearFiltersButton filters={colFilters} setFilters={setColFilters} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
        <table className="w-full border-collapse font-mono text-[12px]">
          <thead className="sticky top-0 z-10 bg-[#161616] text-[#606060]">
            <tr>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                <FilterableHeader
                  label="Source"
                  filterKey="source"
                  def={{ kind: "select", options: sourceOptions }}
                  filters={colFilters}
                  setFilters={setColFilters}
                />
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                <FilterableHeader
                  label="Name in sheet"
                  filterKey="name"
                  def={{ kind: "text" }}
                  filters={colFilters}
                  setFilters={setColFilters}
                />
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                Where to find it
              </th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider">
                Seen
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                <FilterableHeader
                  label="Did you mean?"
                  filterKey="suggestion"
                  def={{ kind: "text" }}
                  filters={colFilters}
                  setFilters={setColFilters}
                />
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">
                Fix (at the source)
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-[#42CA80]">
                  No unmapped names — every reconciled name resolves.
                </td>
              </tr>
            ) : (
              filtered.map((it, i) => (
                <tr
                  key={`${it.source}-${it.raw_name}-${i}`}
                  className="border-t border-[#1a1a1a] hover:bg-[#161616]"
                >
                  <td className="whitespace-nowrap px-3 py-1.5 text-[#909090]">{it.source_label}</td>
                  <td className="px-3 py-1.5 text-white">
                    {it.raw_name}
                    {it.context && (
                      <span className="ml-2 text-[10px] text-[#606060]">{it.context}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-[#606060]">
                    {it.origin_url ? (
                      <a
                        href={it.origin_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#606060] hover:text-[#42CA80]"
                      >
                        {it.origin_label}
                      </a>
                    ) : (
                      it.origin_label
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#C4BCAA]">
                    {it.occurrences}
                  </td>
                  <td className="px-3 py-1.5">
                    {it.suggestion ? (
                      <span className="text-[#42CA80]">{it.suggestion}</span>
                    ) : (
                      <span className="text-[#404040]">— no roster match</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <a
                      href={NAME_MAP_SHEET}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#606060] hover:text-[#42CA80]"
                    >
                      {it.fix_hint}
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-[#606060]">
        <RefreshCcw className="h-3 w-3 text-[#42CA80]" />
        Cleared automatically on the next SYNC once the sheet row lands.
        <button onClick={load} className="ml-auto text-[#606060] hover:text-[#909090]">
          Refresh
        </button>
      </div>
    </div>
  );
}
