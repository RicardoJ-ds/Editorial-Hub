"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Check, Loader2, Search, X } from "lucide-react";

// Data Quality → "Article mappings": normalization review for the Monthly
// Article Count importer. Three columns — Clients · Editors · Writers.
// Shows EVERY value (mapped, canonical, and unmapped) with a per-column filter,
// so nothing disappears after you map it — merges/maps stay visible as a
// running normalization log. Each value shows its origin/status so it can also
// be fixed at the source sheet. Every change posts an alias that self-heals on
// the next sync (the variant's rows take the canonical name, so the list
// naturally reduces over time).

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

// ---------------------------------------------------------------------------
// Searchable combobox — mirrors the dashboard FilterCombobox styling.
// ---------------------------------------------------------------------------

function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setDraft("");
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const visible = useMemo(() => {
    const q = draft.trim().toLowerCase();
    const base = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
    return base.slice(0, 50);
  }, [options, draft]);

  return (
    <div className="relative w-full" ref={wrapRef}>
      <Search className="pointer-events-none absolute left-2 top-1/2 z-10 h-3 w-3 -translate-y-1/2 text-[#606060]" />
      <input
        value={open ? draft : value}
        placeholder={value || placeholder}
        onFocus={() => {
          setDraft("");
          setOpen(true);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          setOpen(true);
        }}
        className="h-7 w-full rounded-md border border-[#1e1e1e] bg-transparent pl-7 pr-7 text-xs text-white outline-none focus:border-[#42CA80]/50"
      />
      {value && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChange("");
            setDraft("");
            setOpen(false);
          }}
          className="absolute right-2 top-1/2 z-10 -translate-y-1/2 text-[#606060] hover:text-white"
          aria-label="Clear"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      {open && visible.length > 0 && (
        <div className="absolute top-full left-0 z-50 mt-1 max-h-[240px] w-full overflow-y-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] shadow-xl">
          {visible.map((o) => (
            <button
              key={o}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(o);
                setDraft("");
                setOpen(false);
              }}
              className={cn(
                "block w-full truncate px-3 py-1.5 text-left text-xs transition-colors",
                value === o
                  ? "bg-[#42CA80]/15 text-[#42CA80]"
                  : "text-[#C4BCAA] hover:bg-[#1F1F1F] hover:text-white",
              )}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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

// ---------------------------------------------------------------------------
// One mapping row (a value + a status/origin subline + target picker + action).
// ---------------------------------------------------------------------------

function MappingRow({
  label,
  count,
  subline,
  options,
  draft,
  onDraft,
  onApply,
  saving,
  actionLabel,
  pickerPlaceholder,
}: {
  label: string;
  count: number;
  subline?: ReactNode;
  options: string[];
  draft: string;
  onDraft: (v: string) => void;
  onApply: () => void;
  saving: boolean;
  actionLabel: string;
  pickerPlaceholder: string;
}) {
  return (
    <div className="border-b border-[#1f1f1f] px-3 py-2 last:border-b-0 hover:bg-[#1a1a1a]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-semibold text-white" title={label}>
          {label}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-[#606060]">{count}</span>
      </div>
      {subline && <div className="mt-0.5 truncate font-mono text-[10px]">{subline}</div>}
      <div className="mt-1.5 flex items-center gap-1.5">
        <SearchableSelect options={options} value={draft} onChange={onDraft} placeholder={pickerPlaceholder} />
        <button
          type="button"
          disabled={!draft || saving}
          onClick={onApply}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#42CA80]/40 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#42CA80] hover:bg-[#42CA80]/10 disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          {actionLabel}
        </button>
      </div>
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
// Main tab
// ---------------------------------------------------------------------------

export function ArticleMappingsTab() {
  const [data, setData] = useState<UnmappedResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
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

  const saveAlias = useCallback(
    async (kind: "client" | "editor" | "writer", raw: string, canonical: string) => {
      if (!canonical) return;
      const key = `${kind}:${raw}`;
      setSavingKey(key);
      setError(null);
      try {
        await apiPost("/api/articles/aliases", { kind, raw_value: raw, canonical_value: canonical });
        setDrafts((p) => ({ ...p, [key]: "" }));
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save alias");
      } finally {
        setSavingKey(null);
      }
    },
    [load],
  );

  const aliasByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of data?.aliases ?? []) m.set(`${a.kind}:${a.raw_value}`, a.canonical_value);
    return m;
  }, [data?.aliases]);

  const editorNames = useMemo(() => (data?.editors ?? []).map((e) => e.name), [data?.editors]);
  const writerNames = useMemo(() => (data?.writers ?? []).map((w) => w.name), [data?.writers]);

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

  const draftOf = (key: string) => drafts[key] ?? "";
  const setDraft = (key: string, v: string) => setDrafts((p) => ({ ...p, [key]: v }));

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
    if (c.status === "unmapped")
      return (
        <span className="text-[#ED6958]">
          Unmapped{spanText}
        </span>
      );
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

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="shrink-0 space-y-1">
        <p className="font-mono text-[11px] leading-relaxed text-[#606060]">
          Normalization for the Monthly Article Count source. Mapping a name writes an alias that
          takes effect on the <span className="text-[#C4BCAA]">next sync</span> — or fix it at the
          source sheet using the origin tab shown under each value. Mapped values stay listed (filter
          per column) as a running normalization log; merges consolidate on the next sync. Client
          aliases re-route the tab to a Hub client (its articles inherit that client&apos;s pod);
          editor/writer aliases merge name variants.
        </p>
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
          subtitle={`${clientUnmapped} to map · ${data.clients.length - clientUnmapped} resolved. Map a tab to a Hub client.`}
          filter={<Seg options={clientFilterOpts} value={clientFilter} onChange={setClientFilter} />}
        >
          {shownClients.length === 0 ? (
            <p className="px-3 py-6 text-center font-mono text-xs text-[#606060]">Nothing here.</p>
          ) : (
            shownClients.map((c) => {
              const key = `client:${c.raw_value}`;
              return (
                <MappingRow
                  key={c.raw_value}
                  label={c.raw_value}
                  count={c.occurrences}
                  subline={clientSubline(c)}
                  options={data.client_options}
                  draft={draftOf(key)}
                  onDraft={(v) => setDraft(key, v)}
                  onApply={() => saveAlias("client", c.raw_value, draftOf(key))}
                  saving={savingKey === key}
                  actionLabel={c.status === "unmapped" ? "Map" : "Remap"}
                  pickerPlaceholder="Hub client…"
                />
              );
            })
          )}
        </MappingColumn>

        {/* Editors */}
        <MappingColumn
          title={`Editors (${data.editors.length})`}
          subtitle={`${editorMerged} merged. Merge a typo / variant into its canonical name.`}
          filter={<Seg options={mergeFilterOpts} value={editorFilter} onChange={setEditorFilter} />}
        >
          {shownEditors.map((ed) => {
            const key = `editor:${ed.name}`;
            const existing = aliasByKey.get(key);
            return (
              <MappingRow
                key={ed.name}
                label={ed.name}
                count={ed.count}
                subline={
                  <>
                    {existing && <span className="text-[#42CA80]">→ {existing} · </span>}
                    <span className="text-[#606060]">
                      in {ed.tabs.slice(0, 3).join(", ")}
                      {ed.tab_count > 3 ? ` +${ed.tab_count - 3}` : ""}
                    </span>
                  </>
                }
                options={editorNames.filter((n) => n !== ed.name)}
                draft={draftOf(key)}
                onDraft={(v) => setDraft(key, v)}
                onApply={() => saveAlias("editor", ed.name, draftOf(key))}
                saving={savingKey === key}
                actionLabel="Merge"
                pickerPlaceholder="merge into…"
              />
            );
          })}
        </MappingColumn>

        {/* Writers */}
        <MappingColumn
          title={`Writers (${data.writers.length})`}
          subtitle={`${writerMerged} merged. Merge a typo / variant into its canonical name.`}
          filter={<Seg options={mergeFilterOpts} value={writerFilter} onChange={setWriterFilter} />}
        >
          {shownWriters.map((w) => {
            const key = `writer:${w.name}`;
            const existing = aliasByKey.get(key);
            return (
              <MappingRow
                key={w.name}
                label={w.name}
                count={w.count}
                subline={
                  <>
                    {existing && <span className="text-[#42CA80]">→ {existing} · </span>}
                    <span className="text-[#606060]">
                      in {w.tabs.slice(0, 3).join(", ")}
                      {w.tab_count > 3 ? ` +${w.tab_count - 3}` : ""}
                    </span>
                  </>
                }
                options={writerNames.filter((n) => n !== w.name)}
                draft={draftOf(key)}
                onDraft={(v) => setDraft(key, v)}
                onApply={() => saveAlias("writer", w.name, draftOf(key))}
                saving={savingKey === key}
                actionLabel="Merge"
                pickerPlaceholder="merge into…"
              />
            );
          })}
        </MappingColumn>
      </div>
    </div>
  );
}
