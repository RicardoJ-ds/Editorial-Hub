"use client";

/**
 * Right-side comments rail for the Overview dashboard. Mirrors the Notion
 * / Google Docs convention — comments sit alongside the page content, one
 * thread per "anchor" (here: per Overview section). Per-client when the
 * filter narrows; grouped by client when broader.
 *
 * Admin-only create. Resolved threads collapse to a small footer; an
 * admin can re-open or delete from the same affordance.
 */

import { useMemo, useState } from "react";
import { Check, MessageSquare, MoreHorizontal, Plus, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccessProfile } from "@/lib/accessClient";
import { useOverviewComments, type OverviewComment } from "@/lib/overviewCommentsClient";
import type { Client } from "@/lib/types";

export interface OverviewSectionDefinition {
  id: string;
  label: string;
}

interface Props {
  sections: OverviewSectionDefinition[];
  filteredClients: Client[];
}

export function OverviewCommentsRail({ sections, filteredClients }: Props) {
  const profile = useAccessProfile();
  const { comments, loading, create, resolve, reopen, remove } =
    useOverviewComments();

  // The rail is one column on the right. Each section gets a stack of
  // threads — narrowed to the active client when one is selected,
  // grouped by client otherwise.
  const filteredClientNames = useMemo(
    () => new Set(filteredClients.map((c) => c.name)),
    [filteredClients],
  );

  // Group comments by section, then by client. Only includes threads whose
  // client is in the current filter — so when someone narrows to "ChatGPT"
  // the rail only shows ChatGPT comments.
  const bySection = useMemo(() => {
    const out = new Map<string, Map<string, OverviewComment[]>>();
    for (const c of comments) {
      if (!filteredClientNames.has(c.client_name)) continue;
      const perSection = out.get(c.section_id) ?? new Map();
      const perClient = perSection.get(c.client_name) ?? [];
      perClient.push(c);
      perSection.set(c.client_name, perClient);
      out.set(c.section_id, perSection);
    }
    return out;
  }, [comments, filteredClientNames]);

  return (
    <aside className="hidden w-[300px] shrink-0 xl:block">
      <div className="sticky top-[140px] space-y-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-[#909090]">
            Comments
          </h3>
          <span className="font-mono text-[9px] text-[#606060] tabular-nums">
            {loading ? "loading" : `${comments.length} total`}
          </span>
        </div>
        {sections.map((s) => (
          <SectionThread
            key={s.id}
            section={s}
            threadsByClient={bySection.get(s.id) ?? new Map()}
            filteredClients={filteredClients}
            isAdmin={!!profile?.is_admin}
            onCreate={(client_name, body) =>
              create({ section_id: s.id, client_name, body })
            }
            onResolve={resolve}
            onReopen={reopen}
            onDelete={remove}
          />
        ))}
      </div>
    </aside>
  );
}

// ──────────────────────────────────────────────────────────────────────

function SectionThread({
  section,
  threadsByClient,
  filteredClients,
  isAdmin,
  onCreate,
  onResolve,
  onReopen,
  onDelete,
}: {
  section: OverviewSectionDefinition;
  threadsByClient: Map<string, OverviewComment[]>;
  filteredClients: Client[];
  isAdmin: boolean;
  onCreate: (client_name: string, body: string) => Promise<void>;
  onResolve: (id: number) => Promise<void>;
  onReopen: (id: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [composerOpen, setComposerOpen] = useState(false);
  // Pre-select the client that's been filtered to — the most common case
  // is "I'm looking at one client and want to leave a comment".
  const defaultClient =
    filteredClients.length === 1 ? filteredClients[0].name : "";

  // Sort clients alphabetically for the dropdown.
  const clientOptions = useMemo(
    () => [...filteredClients].sort((a, b) => a.name.localeCompare(b.name)),
    [filteredClients],
  );

  const totalThreads = Array.from(threadsByClient.values()).reduce(
    (a, t) => a + t.length,
    0,
  );
  const unresolved = Array.from(threadsByClient.values()).reduce(
    (a, t) => a + t.filter((c) => c.resolved_at === null).length,
    0,
  );

  return (
    <div className="rounded-md border border-[#1f1f1f] bg-[#0d0d0d] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <a
          href={`#${section.id}`}
          className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#C4BCAA] hover:text-white"
          title="Jump to section"
        >
          {section.label}
        </a>
        <span
          className="font-mono text-[9px] tabular-nums"
          title={`${totalThreads} total · ${unresolved} unresolved`}
          style={{ color: unresolved > 0 ? "#F5BC4E" : "#404040" }}
        >
          {unresolved > 0 ? `${unresolved} open` : "—"}
        </span>
      </div>

      {/* Threads — one block per client */}
      {totalThreads > 0 && (
        <div className="mt-2 space-y-3">
          {Array.from(threadsByClient.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([clientName, comments]) => (
              <ClientThreadBlock
                key={clientName}
                clientName={clientName}
                comments={comments}
                isAdmin={isAdmin}
                onResolve={onResolve}
                onReopen={onReopen}
                onDelete={onDelete}
              />
            ))}
        </div>
      )}

      {totalThreads === 0 && (
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-[#404040]">
          No comments on this section.
        </p>
      )}

      {/* Add-comment affordance — admin only. The dropdown picks from
          currently-filtered clients per spec. */}
      {isAdmin && !composerOpen && (
        <button
          type="button"
          onClick={() => setComposerOpen(true)}
          className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[#42CA80] hover:text-[#65FFAA]"
        >
          <Plus className="h-3 w-3" /> Add comment
        </button>
      )}

      {composerOpen && (
        <Composer
          defaultClient={defaultClient}
          clientOptions={clientOptions}
          onCancel={() => setComposerOpen(false)}
          onSubmit={async (clientName, body) => {
            await onCreate(clientName, body);
            setComposerOpen(false);
          }}
        />
      )}
    </div>
  );
}

function ClientThreadBlock({
  clientName,
  comments,
  isAdmin,
  onResolve,
  onReopen,
  onDelete,
}: {
  clientName: string;
  comments: OverviewComment[];
  isAdmin: boolean;
  onResolve: (id: number) => Promise<void>;
  onReopen: (id: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  return (
    <div className="rounded border border-[#1a1a1a] bg-[#161616] p-2">
      <p
        className="truncate font-mono text-[10px] uppercase tracking-wider text-[#909090]"
        title={clientName}
      >
        {clientName}
      </p>
      <ul className="mt-1.5 space-y-2">
        {comments.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            isAdmin={isAdmin}
            onResolve={onResolve}
            onReopen={onReopen}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </div>
  );
}

function CommentItem({
  comment,
  isAdmin,
  onResolve,
  onReopen,
  onDelete,
}: {
  comment: OverviewComment;
  isAdmin: boolean;
  onResolve: (id: number) => Promise<void>;
  onReopen: (id: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const resolved = comment.resolved_at !== null;
  const author =
    comment.author_name ??
    comment.author_email.split("@")[0].replace(/\./g, " ");
  const when = formatRelative(comment.created_at);
  return (
    <li
      className={
        "rounded border border-[#1f1f1f] bg-[#0d0d0d] px-2 py-1.5 " +
        (resolved ? "opacity-60" : "")
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-[10px] font-semibold text-white">
          {author}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-[#606060]">
          {when}
        </span>
      </div>
      <p
        className={
          "mt-1 whitespace-pre-wrap text-[11px] leading-snug " +
          (resolved ? "text-[#606060] line-through" : "text-[#C4BCAA]")
        }
      >
        {comment.body}
      </p>
      {isAdmin && (
        <div className="mt-1 flex gap-2">
          {!resolved ? (
            <button
              type="button"
              onClick={() => void onResolve(comment.id)}
              title="Mark resolved"
              className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-[#606060] hover:text-[#42CA80]"
            >
              <Check className="h-2.5 w-2.5" /> Resolve
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void onReopen(comment.id)}
              title="Re-open"
              className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-[#606060] hover:text-[#F5BC4E]"
            >
              <Undo2 className="h-2.5 w-2.5" /> Reopen
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (confirm("Delete this comment?")) void onDelete(comment.id);
            }}
            title="Delete"
            className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-[#606060] hover:text-[#ED6958]"
          >
            <Trash2 className="h-2.5 w-2.5" /> Delete
          </button>
        </div>
      )}
    </li>
  );
}

function Composer({
  defaultClient,
  clientOptions,
  onCancel,
  onSubmit,
}: {
  defaultClient: string;
  clientOptions: Client[];
  onCancel: () => void;
  onSubmit: (clientName: string, body: string) => Promise<void>;
}) {
  const [client, setClient] = useState<string>(
    defaultClient || clientOptions[0]?.name || "",
  );
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!client || !body.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit(client, body.trim());
      setBody("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-2 space-y-1.5 rounded border border-[#42CA80]/20 bg-[#0d1f15] p-2">
      <select
        value={client}
        onChange={(e) => setClient(e.target.value)}
        className="w-full rounded border border-[#2a2a2a] bg-[#0d0d0d] px-2 py-1 font-mono text-[10px] text-white"
      >
        {clientOptions.length === 0 ? (
          <option value="">No clients in scope</option>
        ) : (
          clientOptions.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))
        )}
      </select>
      <textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add comment…"
        className="w-full rounded border border-[#2a2a2a] bg-[#0d0d0d] px-2 py-1 font-mono text-[10px] text-white placeholder:text-[#606060]"
      />
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="inline-flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#606060] hover:bg-[#1f1f1f] hover:text-white"
        >
          <X className="h-3 w-3" /> Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !body.trim() || !client}
          className="inline-flex items-center gap-1 rounded bg-[#42CA80] px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-black disabled:opacity-50"
        >
          {submitting ? (
            <>
              <MoreHorizontal className="h-3 w-3 animate-pulse" /> Posting
            </>
          ) : (
            <>
              <MessageSquare className="h-3 w-3" /> Post
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const ms = now - t;
  if (ms < 0) return "now";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString();
}
