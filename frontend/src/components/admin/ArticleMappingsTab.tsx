"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Check, Loader2, Search, X } from "lucide-react";

// Data Quality → "Article mappings": normalization review for the Monthly
// Article Count importer. Three columns — Clients · Editors · Writers.
// Unresolved client tabs (their articles carry no pod) map to a Hub client;
// editor/writer name variants merge into a canonical name. Each posts an alias
// that self-heals on the next sync. Every value shows its origin tab(s) so it
// can also be fixed at the source sheet.

interface UnmappedClient {
  raw_value: string;
  occurrences: number;
  last_seen_at: string | null;
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
  clients: UnmappedClient[];
  editors: NameRow[];
  writers: NameRow[];
  client_options: string[];
  aliases: AliasRow[];
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

// ---------------------------------------------------------------------------
// One mapping row (a value + its origin tabs + a target picker + action).
// ---------------------------------------------------------------------------

function MappingRow({
  label,
  count,
  origins,
  tabCount,
  existing,
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
  origins?: string[];
  tabCount?: number;
  existing?: string;
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
          {existing && <span className="ml-2 font-mono text-[10px] text-[#42CA80]">→ {existing}</span>}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-[#606060]">{count}</span>
      </div>
      {origins && origins.length > 0 && (
        <p className="mt-0.5 truncate font-mono text-[10px] text-[#606060]" title={origins.join(", ")}>
          in {origins.slice(0, 3).join(", ")}
          {tabCount && tabCount > 3 ? ` +${tabCount - 3}` : ""}
        </p>
      )}
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
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-[#2a2a2a] bg-[#161616]">
      <div className="shrink-0 border-b border-[#2a2a2a] px-3 py-2">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#C4BCAA]">{title}</h3>
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

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="shrink-0 space-y-1">
        <p className="font-mono text-[11px] leading-relaxed text-[#606060]">
          Normalization for the Monthly Article Count source. Mapping a name writes an alias that
          takes effect on the <span className="text-[#C4BCAA]">next sync</span> — or fix it at the
          source sheet using the origin tab shown under each value. Client aliases re-route the tab to
          a Hub client (its articles inherit that client&apos;s pod); editor/writer aliases merge name
          variants.
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
          title={`Unmapped clients (${data.clients.length})`}
          subtitle="Sheet tabs with no Hub client → articles show Unassigned. Map to a Hub client."
        >
          {data.clients.length === 0 ? (
            <p className="px-3 py-6 text-center font-mono text-xs text-[#42CA80]">
              All client tabs resolve.
            </p>
          ) : (
            data.clients.map((c) => {
              const key = `client:${c.raw_value}`;
              return (
                <MappingRow
                  key={c.raw_value}
                  label={c.raw_value}
                  count={c.occurrences}
                  origins={[c.raw_value]}
                  tabCount={1}
                  options={data.client_options}
                  draft={draftOf(key)}
                  onDraft={(v) => setDraft(key, v)}
                  onApply={() => saveAlias("client", c.raw_value, draftOf(key))}
                  saving={savingKey === key}
                  actionLabel="Map"
                  pickerPlaceholder="Hub client…"
                />
              );
            })
          )}
        </MappingColumn>

        {/* Editors */}
        <MappingColumn
          title={`Editors (${data.editors.length})`}
          subtitle="Merge a typo / variant into its canonical editor name."
        >
          {data.editors.map((ed) => {
            const key = `editor:${ed.name}`;
            return (
              <MappingRow
                key={ed.name}
                label={ed.name}
                count={ed.count}
                origins={ed.tabs}
                tabCount={ed.tab_count}
                existing={aliasByKey.get(key)}
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
          subtitle="Merge a typo / variant into its canonical writer name."
        >
          {data.writers.map((w) => {
            const key = `writer:${w.name}`;
            return (
              <MappingRow
                key={w.name}
                label={w.name}
                count={w.count}
                origins={w.tabs}
                tabCount={w.tab_count}
                existing={aliasByKey.get(key)}
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
