"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Check, Loader2 } from "lucide-react";

// Data Quality → "Article mappings": the normalization review surface for the
// Monthly Article Count importer. Unresolved client tabs (their articles carry
// no pod) and editor-name variants are surfaced here; mapping one posts an
// alias that self-heals on the next sync.

interface UnmappedClient {
  raw_value: string;
  occurrences: number;
  last_seen_at: string | null;
}
interface EditorOpt {
  name: string;
  count: number;
}
interface AliasRow {
  kind: string;
  raw_value: string;
  canonical_value: string;
}
interface UnmappedResp {
  clients: UnmappedClient[];
  editors: EditorOpt[];
  client_options: string[];
  aliases: AliasRow[];
}

export function ArticleMappingsTab() {
  const [data, setData] = useState<UnmappedResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  // Local draft of the chosen target per row (keyed by raw value).
  const [clientDraft, setClientDraft] = useState<Record<string, string>>({});
  const [editorDraft, setEditorDraft] = useState<Record<string, string>>({});

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
    async (kind: "client" | "editor", raw: string, canonical: string) => {
      if (!canonical) return;
      setSavingKey(`${kind}:${raw}`);
      setError(null);
      try {
        await apiPost("/api/articles/aliases", { kind, raw_value: raw, canonical_value: canonical });
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

  return (
    <div className="h-full space-y-6 overflow-auto pr-1">
      <p className="font-mono text-[11px] leading-relaxed text-[#606060]">
        Normalization for the Monthly Article Count source. Mapping a name writes an alias that takes
        effect on the <span className="text-[#C4BCAA]">next sync</span> — client aliases re-route the
        tab to a Hub client (so its articles inherit that client&apos;s pod); editor aliases merge
        name variants.
      </p>

      {error && (
        <div className="rounded-md border border-[#ED6958]/40 bg-[#ED6958]/10 px-3 py-2 font-mono text-[11px] text-[#ED6958]">
          {error}
        </div>
      )}

      {/* Unmapped clients */}
      <section className="space-y-2">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#C4BCAA]">
          Unmapped clients ({data.clients.length})
        </h3>
        <p className="font-mono text-[10px] text-[#606060]">
          Article-sheet tabs that don&apos;t match a Hub client. Their articles show under
          &quot;Unassigned&quot; pod until mapped.
        </p>
        <div className="overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#161616]">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#2a2a2a]">
                <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-[#606060]">Client tab</th>
                <th className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-wider text-[#606060]">Articles</th>
                <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-[#606060]">Map to Hub client</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.clients.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center font-mono text-[#42CA80]">
                    All client tabs resolve to a Hub client.
                  </td>
                </tr>
              ) : (
                data.clients.map((c) => {
                  const key = `client:${c.raw_value}`;
                  const draft = clientDraft[c.raw_value] ?? "";
                  const saving = savingKey === key;
                  return (
                    <tr key={c.raw_value} className="border-t border-[#1f1f1f] hover:bg-[#1F1F1F]">
                      <td className="px-3 py-2 font-semibold text-white">{c.raw_value}</td>
                      <td className="px-3 py-2 text-right font-mono text-[#C4BCAA]">{c.occurrences}</td>
                      <td className="px-3 py-2">
                        <select
                          value={draft}
                          onChange={(e) =>
                            setClientDraft((p) => ({ ...p, [c.raw_value]: e.target.value }))
                          }
                          className="h-7 w-full max-w-[260px] rounded-md border border-[#1e1e1e] bg-[#0d0d0d] px-2 text-xs text-[#C4BCAA] outline-none focus:border-[#42CA80]/50"
                        >
                          <option value="">— select client —</option>
                          {data.client_options.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          disabled={!draft || saving}
                          onClick={() => saveAlias("client", c.raw_value, draft)}
                          className="inline-flex items-center gap-1 rounded-md border border-[#42CA80]/40 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#42CA80] hover:bg-[#42CA80]/10 disabled:opacity-40"
                        >
                          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                          Map
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Editor name cleanup */}
      <section className="space-y-2">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-[#C4BCAA]">
          Editor name cleanup ({data.editors.length})
        </h3>
        <p className="font-mono text-[10px] text-[#606060]">
          Distinct editor names from the sheet. Merge a typo / variant (e.g. &quot;NIcholas&quot;)
          into its canonical name to combine their counts.
        </p>
        <div className="overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#161616]">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#2a2a2a]">
                <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-[#606060]">Editor</th>
                <th className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-wider text-[#606060]">Credits</th>
                <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-[#606060]">Merge into</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.editors.map((ed) => {
                const key = `editor:${ed.name}`;
                const draft = editorDraft[ed.name] ?? "";
                const saving = savingKey === key;
                const existing = aliasByKey.get(key);
                return (
                  <tr key={ed.name} className="border-t border-[#1f1f1f] hover:bg-[#1F1F1F]">
                    <td className="px-3 py-2 font-semibold text-white">
                      {ed.name}
                      {existing && (
                        <span className="ml-2 font-mono text-[10px] text-[#606060]">→ {existing}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[#C4BCAA]">{ed.count}</td>
                    <td className="px-3 py-2">
                      <select
                        value={draft}
                        onChange={(e) =>
                          setEditorDraft((p) => ({ ...p, [ed.name]: e.target.value }))
                        }
                        className="h-7 w-full max-w-[220px] rounded-md border border-[#1e1e1e] bg-[#0d0d0d] px-2 text-xs text-[#C4BCAA] outline-none focus:border-[#42CA80]/50"
                      >
                        <option value="">— keep as-is —</option>
                        {editorNames
                          .filter((n) => n !== ed.name)
                          .map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        disabled={!draft || saving}
                        onClick={() => saveAlias("editor", ed.name, draft)}
                        className="inline-flex items-center gap-1 rounded-md border border-[#42CA80]/40 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#42CA80] hover:bg-[#42CA80]/10 disabled:opacity-40"
                      >
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        Merge
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
