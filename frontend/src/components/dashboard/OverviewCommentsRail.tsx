"use client";

/**
 * Per-section comment affordance for the Overview dashboard. Replaces the
 * previous right-side rail with a small chat icon rendered inline next to
 * each section's header. Clicking the icon opens a popover anchored to it
 * with that section's threads + an admin-only composer.
 *
 * Two exports:
 *   - `<SectionCommentIcon sectionId=…>` — the inline icon + popover. Drop
 *     this into each Section's `rightSlot`.
 *   - `useOverviewCommentsForSection(sectionId)` — hook so the icon can
 *     render an unresolved count badge without subscribing the entire
 *     section to the comments store. Internal use only.
 *
 * The page passes `filteredClients` via the `<OverviewCommentsContext>`
 * provider so all icons share the same list (no per-icon prop drilling).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useAccessProfile } from "@/lib/accessClient";
import { useOverviewComments, type OverviewComment } from "@/lib/overviewCommentsClient";
import type { Client } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface OverviewSectionDefinition {
  id: string;
  label: string;
}

// ──────────────────────────────────────────────────────────────────────
// Provider — every section's icon shares the same filteredClients list
// and the same comments store. Mount once on the Overview page; the
// icons read via context so the per-section markup stays tiny.
// ──────────────────────────────────────────────────────────────────────

interface OverviewCommentsContextValue {
  filteredClients: Client[];
  sections: OverviewSectionDefinition[];
}
const OverviewCommentsContext = createContext<OverviewCommentsContextValue | null>(
  null,
);

export function OverviewCommentsProvider({
  filteredClients,
  sections,
  children,
}: {
  filteredClients: Client[];
  sections: OverviewSectionDefinition[];
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => ({ filteredClients, sections }),
    [filteredClients, sections],
  );
  return (
    <OverviewCommentsContext.Provider value={value}>
      {children}
    </OverviewCommentsContext.Provider>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Section comment icon — drop into each `<Section rightSlot=…>`.
// ──────────────────────────────────────────────────────────────────────

export function SectionCommentIcon({
  sectionId,
  sectionLabel,
}: {
  sectionId: string;
  sectionLabel: string;
}) {
  const ctx = useContext(OverviewCommentsContext);
  const profile = useAccessProfile();
  const { comments, loading, create, resolve, reopen, remove } =
    useOverviewComments();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click + Esc. Per-section popover so multiple
  // sections can never be open at once.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filteredClients = ctx?.filteredClients ?? [];
  const filteredClientNames = useMemo(
    () => new Set(filteredClients.map((c) => c.name)),
    [filteredClients],
  );

  // Comments for THIS section, narrowed to the filter scope.
  const sectionComments = useMemo(
    () =>
      comments.filter(
        (c) => c.section_id === sectionId && filteredClientNames.has(c.client_name),
      ),
    [comments, sectionId, filteredClientNames],
  );

  const totalThreads = sectionComments.length;
  const unresolved = sectionComments.filter((c) => c.resolved_at === null).length;

  // Group by client for the panel display.
  const threadsByClient = useMemo(() => {
    const m = new Map<string, OverviewComment[]>();
    for (const c of sectionComments) {
      const arr = m.get(c.client_name) ?? [];
      arr.push(c);
      m.set(c.client_name, arr);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [sectionComments]);

  // Notion-style: a bare chat-bubble glyph (no bounding box) sitting
  // inline at the right edge of the section header. The popover anchors
  // directly below it, right-aligned so it never spills past the right
  // edge of the viewport. Hover-revealed for empty sections via the
  // parent `<section group/sec>` ancestor; always-on once threads exist.
  const hasComments = totalThreads > 0;
  const Icon = hasComments ? MessageSquare : MessageSquarePlus;
  return (
    <div ref={wrapperRef} className="relative z-20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={
          unresolved > 0
            ? `${unresolved} open comment${unresolved === 1 ? "" : "s"}`
            : hasComments
              ? `${totalThreads} comment${totalThreads === 1 ? "" : "s"} (all resolved)`
              : "Add a comment"
        }
        className={cn(
          "inline-flex h-7 items-center justify-center gap-1 rounded-sm bg-transparent px-1 transition-all duration-150",
          // Visibility rules: open or has-comments → always shown.
          // Empty + closed → fade in on parent-section hover.
          open || hasComments
            ? "opacity-100"
            : "opacity-0 group-hover/sec:opacity-100 focus-visible:opacity-100",
          open ? "text-[#65FFAA]" : "text-[#909090] hover:text-[#C4BCAA]",
        )}
      >
        <Icon className="h-4 w-4" />
        {hasComments && (
          <span
            className={cn(
              "font-mono text-[10px] tabular-nums",
              unresolved > 0 ? "text-[#F5BC4E]" : "text-[#606060]",
            )}
          >
            {unresolved > 0 ? unresolved : totalThreads}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-2 w-[340px] max-h-[480px] overflow-y-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] shadow-2xl shadow-black/60"
          role="dialog"
          aria-label={`Comments for ${sectionLabel}`}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[#1f1f1f] bg-[#0d0d0d] px-3 py-2">
            <div className="flex items-baseline gap-2">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#C4BCAA]">
                {sectionLabel}
              </p>
              <span
                className="font-mono text-[9px] tabular-nums"
                style={{ color: unresolved > 0 ? "#F5BC4E" : "#606060" }}
              >
                {loading
                  ? "loading"
                  : unresolved > 0
                    ? `${unresolved} open`
                    : totalThreads > 0
                      ? `${totalThreads} resolved`
                      : "no comments"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              title="Close"
              aria-label="Close"
              className="inline-flex h-5 w-5 items-center justify-center rounded text-[#606060] transition-colors hover:bg-[#1f1f1f] hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="px-3 py-2 space-y-3">
            {totalThreads === 0 ? (
              <p className="font-mono text-[10px] leading-relaxed text-[#606060]">
                No comments on this section yet.
              </p>
            ) : (
              threadsByClient.map(([clientName, list]) => (
                <ClientThreadBlock
                  key={clientName}
                  clientName={clientName}
                  comments={list}
                  isAdmin={!!profile?.is_admin}
                  onResolve={resolve}
                  onReopen={reopen}
                  onDelete={remove}
                />
              ))
            )}

            {profile?.is_admin && (
              <SectionComposer
                sectionId={sectionId}
                clientOptions={filteredClients}
                onCreate={async (clientName, body) => {
                  await create({
                    section_id: sectionId,
                    client_name: clientName,
                    body,
                  });
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Composer w/ typeahead client picker (mirrors FilterBar's "Search
// clients..." control so the visual language stays consistent).
// ──────────────────────────────────────────────────────────────────────

function SectionComposer({
  sectionId: _sectionId,
  clientOptions,
  onCreate,
}: {
  sectionId: string;
  clientOptions: Client[];
  onCreate: (clientName: string, body: string) => Promise<void>;
}) {
  // Pre-select the single filtered client when there is one.
  const defaultClient = clientOptions.length === 1 ? clientOptions[0].name : "";

  const [client, setClient] = useState<string>(defaultClient);
  const [query, setQuery] = useState<string>(defaultClient);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [body, setBody] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);

  // Re-sync when the parent filter scope changes (single-client preselect).
  useEffect(() => {
    if (clientOptions.length === 1) {
      setClient(clientOptions[0].name);
      setQuery(clientOptions[0].name);
    }
  }, [clientOptions]);

  // Close dropdown on outside click. Matches FilterBar's pattern exactly.
  useEffect(() => {
    if (!dropdownOpen) return;
    function onClick(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [dropdownOpen]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...clientOptions].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    if (!q) return sorted;
    return sorted.filter((c) => c.name.toLowerCase().includes(q));
  }, [clientOptions, query]);

  const submit = useCallback(async () => {
    if (!client || !body.trim()) return;
    setSubmitting(true);
    try {
      await onCreate(client, body.trim());
      setBody("");
      setComposerOpen(false);
    } finally {
      setSubmitting(false);
    }
  }, [client, body, onCreate]);

  if (!composerOpen) {
    return (
      <button
        type="button"
        onClick={() => setComposerOpen(true)}
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[#42CA80] hover:text-[#65FFAA]"
      >
        <Plus className="h-3 w-3" /> Add comment
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded border border-[#42CA80]/20 bg-[#0d1f15] p-2">
      {/* Client picker — mirrors FilterBar.tsx "Search clients..." */}
      <div className="relative" ref={comboRef}>
        <Search className="absolute left-2.5 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-[#606060]" />
        <Input
          placeholder={
            clientOptions.length === 0 ? "No clients in scope" : "Search clients..."
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Typing without picking clears the committed selection so
            // submission can't post against a stale name.
            if (e.target.value !== client) setClient("");
            setDropdownOpen(true);
          }}
          onFocus={() => setDropdownOpen(true)}
          disabled={clientOptions.length === 0}
          className="h-7 w-full rounded-md border-[#1e1e1e] bg-transparent pl-8 pr-7 text-xs focus:border-[#42CA80]/50"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setClient("");
              setDropdownOpen(true);
            }}
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 text-[#606060] hover:text-white"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        {dropdownOpen && filteredOptions.length > 0 && (
          <div className="absolute left-0 top-full z-50 mt-1 max-h-[220px] w-full overflow-y-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] shadow-xl">
            {filteredOptions.map((c) => (
              <button
                key={c.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setQuery(c.name);
                  setClient(c.name);
                  setDropdownOpen(false);
                }}
                className={cn(
                  "block w-full px-3 py-1.5 text-left text-xs transition-colors",
                  client === c.name
                    ? "bg-[#42CA80]/15 text-[#42CA80]"
                    : "text-[#C4BCAA] hover:bg-[#1F1F1F] hover:text-white",
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add comment…"
        className="w-full rounded border border-[#1e1e1e] bg-[#0d0d0d] px-2 py-1 font-mono text-[11px] text-white placeholder:text-[#606060] focus:border-[#42CA80]/50 focus:outline-none"
      />
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => {
            setComposerOpen(false);
            setBody("");
          }}
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

// ──────────────────────────────────────────────────────────────────────
// Read-only blocks for the popover body.
// ──────────────────────────────────────────────────────────────────────

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
  const fullDateTime = new Date(comment.created_at).toLocaleString();
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
        <span
          className="font-mono text-[9px] tracking-wider text-[#606060]"
          title={fullDateTime}
        >
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

// Notion-style timestamp. Recent comments read as "now / Xm / Xh" so the
// reader can tell at a glance how fresh they are. Anything older switches
// to a clock + date — "10:42 AM" for same-day, "Yesterday" for the day
// before, then "May 8" within the same calendar year, "May 8, 2024" for
// older. Hover (title attribute on the caller) still shows the full
// timestamp for precision.
function formatRelative(iso: string): string {
  const d = new Date(iso);
  const t = d.getTime();
  const now = Date.now();
  const ms = now - t;
  if (ms < 0) return "now";

  const sec = Math.round(ms / 1000);
  if (sec < 60) return "now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 6) return `${hr}h`;

  // Same calendar day → show the time of day so "today at 10:42 AM" is
  // visible without taking up extra width.
  const nowDate = new Date(now);
  const sameDay =
    d.getFullYear() === nowDate.getFullYear() &&
    d.getMonth() === nowDate.getMonth() &&
    d.getDate() === nowDate.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  // Yesterday (single calendar day back).
  const yesterday = new Date(nowDate);
  yesterday.setDate(nowDate.getDate() - 1);
  const sameYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (sameYesterday) return "Yesterday";

  // Within the same calendar year → "May 8". Older → "May 8, 2024".
  if (d.getFullYear() === nowDate.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ──────────────────────────────────────────────────────────────────────
// Legacy export retained so callers importing the old rail name still
// build — they should migrate to <OverviewCommentsProvider> +
// <SectionCommentIcon>.
// ──────────────────────────────────────────────────────────────────────

export function OverviewCommentsRail() {
  return null;
}
