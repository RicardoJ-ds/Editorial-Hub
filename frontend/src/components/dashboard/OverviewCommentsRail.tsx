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
  useReducer,
  useRef,
  useState,
} from "react";
import {
  Bold,
  Check,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TiptapLink from "@tiptap/extension-link";
import { useAccessProfile, type AccessProfile } from "@/lib/accessClient";
import { useOverviewComments, type OverviewComment } from "@/lib/overviewCommentsClient";
import type { Client } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Mirrors the backend `require_admin_or_leadership` dependency. Admins
 *  and members of the seeded `leadership` group can post / resolve /
 *  delete comments; everyone else is read-only. Keep in lockstep with
 *  `backend/app/auth_deps.py::require_admin_or_leadership` so the UI
 *  doesn't show controls the server will 403 on. */
function canManageComments(profile: AccessProfile | null): boolean {
  if (!profile) return false;
  if (profile.is_admin) return true;
  return profile.group_slugs.includes("leadership");
}

/** Section_id used by the new client-level comments rail. Anything else
 *  (e.g. "time-to-metrics") is a section-anchored comment rendered by
 *  the inline SectionCommentIcon. */
const GENERAL_SECTION_ID = "general";

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
  const { comments, loading, create, update, resolve, reopen, remove } =
    useOverviewComments();
  const [open, setOpen] = useState(false);
  // True while the section composer is in "writing mode" (the textarea
  // is open) OR a CommentItem is in edit mode. Used to render the
  // modal scrim as a sibling of the popover panel — same stacking
  // context, so z-index ordering works regardless of any ancestor
  // stacking traps.
  const [isComposing, setIsComposing] = useState(false);
  // Counter rather than a boolean because multiple CommentItems can
  // momentarily report transitions in/out of edit mode — using a
  // counter avoids one item's close racing another's open and
  // dropping the scrim early.
  const [editingCount, setEditingCount] = useState(0);
  const handleEditOpenChange = useCallback((open: boolean) => {
    setEditingCount((n) => Math.max(0, n + (open ? 1 : -1)));
  }, []);
  const isLocked = isComposing || editingCount > 0;

  // Close on Esc. Outside-click closing is handled by a transparent
  // backdrop rendered alongside the popover — that pattern is more
  // robust than `document.addEventListener('mousedown')` + a `contains`
  // check, which was failing when the composer's typeahead dropdown
  // (positioned absolutely inside the popover) extended visually past
  // the popover bounds. With the backdrop, every click outside the
  // popover panel hits the backdrop and closes; every click inside
  // the panel is naturally blocked by z-index stacking.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      // Escape closes the popover — but NOT while a comment is being
      // written or edited. The composer's / editor's own Cancel button
      // is the only exit path so users can't lose in-progress text.
      if (e.key === "Escape" && !isLocked) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, isLocked]);

  const filteredClients = ctx?.filteredClients ?? [];
  const filteredClientNames = useMemo(
    () => new Set(filteredClients.map((c) => c.name)),
    [filteredClients],
  );

  // Comments for THIS section, narrowed to the filter scope.
  // Client_name is OPTIONAL on the composer — comments without a
  // client are accepted as a section-wide note and rendered under a
  // "General" group at the top of the popover.
  const sectionComments = useMemo(
    () =>
      comments.filter(
        (c) =>
          c.section_id === sectionId &&
          (c.client_name === null || filteredClientNames.has(c.client_name)),
      ),
    [comments, sectionId, filteredClientNames],
  );
  // How many comments exist on this section across ALL clients, so we
  // can tell the user when threads are hidden by their current filter
  // (otherwise the "no comments" empty state looks like the section is
  // empty when it actually has threads under other clients).
  const allSectionCommentsCount = useMemo(
    () => comments.filter((c) => c.section_id === sectionId).length,
    [comments, sectionId],
  );
  const hiddenByFilter = allSectionCommentsCount - sectionComments.length;

  const totalThreads = sectionComments.length;
  const unresolved = sectionComments.filter((c) => c.resolved_at === null).length;

  // Group by client. Null-client comments land under the "" (empty
  // string) key, which we render with a "General" label at the top of
  // the list.
  const threadsByClient = useMemo(() => {
    const m = new Map<string, OverviewComment[]>();
    for (const c of sectionComments) {
      const name = c.client_name ?? "";
      const arr = m.get(name) ?? [];
      arr.push(c);
      m.set(name, arr);
    }
    // Sort: General (null/"") first, then alphabetical by client name.
    return Array.from(m.entries()).sort(([a], [b]) => {
      if (a === "" && b !== "") return -1;
      if (b === "" && a !== "") return 1;
      return a.localeCompare(b);
    });
  }, [sectionComments]);

  // Notion-style: a bare chat-bubble glyph (no bounding box) sitting
  // inline at the right edge of the section header. The popover anchors
  // directly below it, right-aligned so it never spills past the right
  // edge of the viewport. Hover-revealed for empty sections via the
  // parent `<section group/sec>` ancestor; always-on once threads exist.
  const hasComments = totalThreads > 0;
  const Icon = hasComments ? MessageSquare : MessageSquarePlus;
  return (
    // No z-index on the wrapper — that would create a stacking context
    // that sits above other absolute-positioned dropdowns on the page
    // (e.g. the FilterBar's Search clients typeahead, which bleeds
    // through behind the icon otherwise). The popover panel below
    // handles its own z-50 when open.
    <div className="relative">
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
          // Visibility: always at least faintly visible so the icon
          // doesn't vanish when the user filters to a client with no
          // comments on this section. Active states are full opacity,
          // empty/idle is dimmed but still legible.
          open || hasComments ? "opacity-100" : "opacity-60 hover:opacity-100",
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
        // Transparent, full-viewport backdrop. Clicking anywhere
        // outside the popover panel below lands on this and closes the
        // popover — UNLESS the composer is actively being written
        // (then the modal scrim above this catches the click first and
        // prevents accidental dismissal of in-progress work).
        <div
          className="fixed inset-0 z-40"
          onMouseDown={() => setOpen(false)}
          aria-hidden
        />
      )}
      {open && isLocked && (
        // Modal scrim — dims the dashboard while a comment is being
        // written OR edited. Rendered as a sibling of the popover
        // panel so they share the SAME stacking context (the
        // `relative` wrapper), avoiding z-index traps from any
        // ancestor that creates an isolated context. Sits at z-45:
        // above the z-40 backdrop (so accidental outside-clicks don't
        // close the popover during writing) and below the z-50 panel
        // (so the composer stays
        // sharp + clickable on top).
        <div
          className="fixed inset-0 z-[45] bg-black/55 backdrop-blur-[2px]"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          aria-hidden
        />
      )}
      {open && (
        <div
          // No overflow-y-auto — the typeahead dropdown inside the
          // composer uses absolute positioning and was being clipped
          // when the popover scrolled. Let the popover grow naturally;
          // the page scrolls if it gets tall.
          // Clicks INSIDE this panel stop the backdrop's close handler
          // via stopPropagation on mousedown.
          className="absolute left-0 top-full z-50 mt-2 w-[360px] rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] shadow-2xl shadow-black/60"
          onMouseDown={(e) => e.stopPropagation()}
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
            {/* Hidden while composing or editing — the composer's /
                editor's own Cancel / Save are the only exit paths. */}
            {!isLocked && (
              <button
                type="button"
                onClick={() => setOpen(false)}
                title="Close"
                aria-label="Close"
                className="inline-flex h-5 w-5 items-center justify-center rounded text-[#606060] transition-colors hover:bg-[#1f1f1f] hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="px-3 py-2 space-y-3">
            {totalThreads === 0 ? (
              <p className="font-mono text-[10px] leading-relaxed text-[#606060]">
                {hiddenByFilter > 0
                  ? `No comments for the current filter. ${hiddenByFilter} thread${
                      hiddenByFilter === 1 ? "" : "s"
                    } on this section ${
                      hiddenByFilter === 1 ? "is" : "are"
                    } scoped to other clients — clear the filter above to see them.`
                  : "No comments on this section yet."}
              </p>
            ) : (
              threadsByClient.map(([clientName, list]) => (
                <ClientThreadBlock
                  key={clientName}
                  clientName={clientName}
                  comments={list}
                  isAdmin={canManageComments(profile)}
                  onResolve={resolve}
                  onReopen={reopen}
                  onDelete={remove}
                  onUpdate={update}
                  onEditOpenChange={handleEditOpenChange}
                />
              ))
            )}

            {canManageComments(profile) && (
              <SectionComposer
                sectionId={sectionId}
                clientOptions={filteredClients}
                optionalClient
                onComposerOpenChange={setIsComposing}
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
// Rich-text composer (Tiptap) + read-only renderer.
//
// Comments are stored as Tiptap HTML (e.g. "<p><strong>Hi</strong></p>").
// Old plain-text comments (no leading "<") render as a plain paragraph
// for backwards compat.
// ──────────────────────────────────────────────────────────────────────

/** Read-only body renderer — HTML for new comments, plain text for old. */
function CommentBody({ body, muted = false }: { body: string; muted?: boolean }) {
  const isHtml = body.trimStart().startsWith("<");
  const base =
    "comment-body text-[11px] leading-snug [&_p]:mb-1 [&_p:last-child]:mb-0 " +
    "[&_strong]:font-semibold [&_strong]:text-white [&_em]:italic " +
    "[&_a]:text-[#65FFAA] [&_a]:underline [&_a]:decoration-dotted [&_a]:underline-offset-2 [&_a]:hover:text-[#42CA80] " +
    "[&_ul]:my-1 [&_ul]:ml-3.5 [&_ul]:list-disc [&_ul]:space-y-0.5 " +
    "[&_ol]:my-1 [&_ol]:ml-3.5 [&_ol]:list-decimal [&_ol]:space-y-0.5 " +
    "[&_code]:rounded [&_code]:bg-[#0d0d0d] [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[10px] [&_code]:text-[#65FFAA] " +
    (muted ? "text-[#606060] line-through" : "text-[#C4BCAA]");

  if (isHtml) {
    return (
      <div
        className={base}
        // Safe: content is produced by our own Tiptap editor (bold/italic/link/list/code only).
        dangerouslySetInnerHTML={{ __html: body }}
      />
    );
  }
  return (
    <p className={base + " whitespace-pre-wrap break-words"}>{body}</p>
  );
}

/** Tiptap-powered composer with WYSIWYG toolbar (bold, italic, link, lists). */
function RichComposer({
  onSubmit,
  onCancel,
  submitting,
  canSubmit,
  initialBody,
  submitLabel = "Post",
  submittingLabel = "Posting",
}: {
  onSubmit: (html: string) => void;
  onCancel: () => void;
  submitting: boolean;
  canSubmit: boolean;
  /** Prefill the editor with existing content — used when editing an
   *  existing comment. Stored as Tiptap HTML; plain-text bodies (old
   *  back-compat comments) are wrapped in a single paragraph. */
  initialBody?: string;
  /** Label for the primary action button. Defaults to "Post" for new
   *  comments; pass "Save" for edits. */
  submitLabel?: string;
  /** Label shown while the submit is in flight. */
  submittingLabel?: string;
}) {
  const [linkBarOpen, setLinkBarOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");
  const linkInputRef = useRef<HTMLInputElement>(null);

  // Tiptap v3's `useEditor` doesn't trigger React re-renders on every
  // editor change by default — so `editor.isEmpty` / `editor.isActive(...)`
  // stay stale until something else forces a re-render. We hook the
  // editor's `onUpdate` (content change) and `onSelectionUpdate`
  // (cursor moved into/out of a bold range, etc.) to force a re-render
  // via a counter — this keeps the Post button and toolbar active
  // states in sync with what the user sees in the editor.
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  // Coerce initial body to valid HTML — wrap legacy plain-text comments
  // in a single <p> so the editor doesn't render literal text without
  // a block container.
  const initialContent = initialBody
    ? initialBody.trimStart().startsWith("<")
      ? initialBody
      : `<p>${initialBody.replace(/\n/g, "<br>")}</p>`
    : "";
  const editor = useEditor({
    extensions: [
      StarterKit,
      TiptapLink.configure({ openOnClick: false, autolink: true }),
    ],
    content: initialContent,
    onUpdate: () => forceUpdate(),
    onSelectionUpdate: () => forceUpdate(),
    editorProps: {
      attributes: {
        class:
          "min-h-[80px] max-h-[240px] overflow-y-auto px-2.5 py-2 text-[12px] text-[#C4BCAA] focus:outline-none " +
          "[&_p]:mb-1 [&_p:last-child]:mb-0 " +
          "[&_strong]:font-semibold [&_strong]:text-white [&_em]:italic " +
          "[&_a]:text-[#65FFAA] [&_a]:underline [&_a]:decoration-dotted [&_a]:underline-offset-2 " +
          "[&_ul]:my-1 [&_ul]:ml-3.5 [&_ul]:list-disc [&_ul]:space-y-0.5 " +
          "[&_ol]:my-1 [&_ol]:ml-3.5 [&_ol]:list-decimal [&_ol]:space-y-0.5 " +
          "[&_code]:rounded [&_code]:bg-[#0d0d0d] [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[10px] [&_code]:text-[#65FFAA]",
      },
    },
  });

  // Cmd+Enter submits
  useEffect(() => {
    if (!editor) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (canSubmit && !editor.isEmpty) onSubmit(editor.getHTML());
      }
    };
    editor.view.dom.addEventListener("keydown", handler);
    return () => editor.view.dom.removeEventListener("keydown", handler);
  }, [editor, canSubmit, onSubmit]);

  const applyLink = useCallback(() => {
    if (!editor || !linkUrl.trim() || linkUrl === "https://") return;
    editor.chain().focus().setLink({ href: linkUrl.trim() }).run();
    setLinkBarOpen(false);
    setLinkUrl("https://");
  }, [editor, linkUrl]);

  const removeLink = useCallback(() => {
    editor?.chain().focus().unsetLink().run();
    setLinkBarOpen(false);
  }, [editor]);

  const isEmpty = editor?.isEmpty ?? true;

  const btnClass = (active?: boolean) =>
    "inline-flex h-6 w-6 items-center justify-center rounded transition-colors " +
    (active
      ? "bg-[#42CA80]/20 text-[#65FFAA]"
      : "text-[#909090] hover:bg-[#1F1F1F] hover:text-white");

  return (
    <div className="overflow-hidden rounded-md border border-[#2a2a2a] bg-[#161616] focus-within:border-[#42CA80] focus-within:ring-1 focus-within:ring-[#42CA80]/30">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 border-b border-[#1F1F1F] bg-[#101010] px-1 py-1">
        <button
          type="button"
          className={btnClass(editor?.isActive("bold"))}
          title="Bold (Cmd+B)"
          onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBold().run(); }}
        >
          <Bold className="h-3 w-3" />
        </button>
        <button
          type="button"
          className={btnClass(editor?.isActive("italic"))}
          title="Italic (Cmd+I)"
          onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleItalic().run(); }}
        >
          <Italic className="h-3 w-3" />
        </button>
        <button
          type="button"
          className={btnClass(editor?.isActive("link"))}
          title="Link (Cmd+K)"
          onMouseDown={(e) => {
            e.preventDefault();
            if (editor?.isActive("link")) {
              removeLink();
            } else {
              setLinkBarOpen((v) => !v);
              requestAnimationFrame(() => linkInputRef.current?.focus());
            }
          }}
        >
          <LinkIcon className="h-3 w-3" />
        </button>
        <span className="mx-1 h-3 w-px bg-[#2a2a2a]" />
        <button
          type="button"
          className={btnClass(editor?.isActive("bulletList"))}
          title="Bulleted list"
          onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBulletList().run(); }}
        >
          <List className="h-3 w-3" />
        </button>
        <button
          type="button"
          className={btnClass(editor?.isActive("orderedList"))}
          title="Numbered list"
          onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleOrderedList().run(); }}
        >
          <ListOrdered className="h-3 w-3" />
        </button>
      </div>

      {/* Inline link bar — slides open when Link button is clicked */}
      {linkBarOpen && (
        <div className="flex items-center gap-1.5 border-b border-[#1F1F1F] bg-[#0d0d0d] px-2 py-1">
          <LinkIcon className="h-3 w-3 shrink-0 text-[#606060]" />
          <input
            ref={linkInputRef}
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); applyLink(); }
              if (e.key === "Escape") { setLinkBarOpen(false); editor?.commands.focus(); }
            }}
            placeholder="https://..."
            className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-white placeholder:text-[#606060] focus:outline-none"
          />
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); applyLink(); }}
            className="font-mono text-[9px] uppercase tracking-wider text-[#42CA80] hover:text-[#65FFAA]"
          >
            Apply
          </button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); setLinkBarOpen(false); editor?.commands.focus(); }}
            className="text-[#606060] hover:text-white"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Tiptap editor area — auto-grows with content */}
      <EditorContent editor={editor} />

      {/* Footer actions */}
      <div className="flex items-center justify-end gap-1.5 border-t border-[#1F1F1F] bg-[#101010] px-2 py-1.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2.5 font-mono text-[10px] uppercase tracking-wider text-[#909090] transition-colors hover:bg-[#1f1f1f] hover:text-white"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => { if (editor) onSubmit(editor.getHTML()); }}
          disabled={submitting || isEmpty || !canSubmit}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-[#42CA80] px-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-black transition-colors hover:bg-[#65FFAA] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? (
            <><MoreHorizontal className="h-3 w-3 animate-pulse" /> {submittingLabel}</>
          ) : (
            <><MessageSquare className="h-3 w-3" /> {submitLabel}</>
          )}
        </button>
      </div>
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
  optionalClient = false,
  onComposerOpenChange,
}: {
  sectionId: string;
  clientOptions: Client[];
  /** Called with the chosen client name (or `null` when the composer is
   *  in `optionalClient` mode and the user left the picker blank). */
  onCreate: (clientName: string | null, body: string) => Promise<void>;
  /** When true, the Client field is optional — the composer accepts a
   *  body alone and posts the comment as a global note (no anchor).
   *  Used by the right-side ClientCommentsRail; section-anchored icons
   *  still require a client (default false). */
  optionalClient?: boolean;
  /** Notifies the parent popover when the writing mode opens / closes
   *  so the parent can render the modal scrim as a sibling of the
   *  popover panel (sharing the same stacking context). */
  onComposerOpenChange?: (open: boolean) => void;
}) {
  // Pre-select the single filtered client when there is one — but only
  // outside `optionalClient` mode. The rail composer should default to
  // "no client" so admins can write quick global notes without the
  // picker hijacking what they typed.
  const defaultClient =
    !optionalClient && clientOptions.length === 1 ? clientOptions[0].name : "";

  const [client, setClient] = useState<string>(defaultClient);
  const [query, setQuery] = useState<string>(defaultClient);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);

  // Bubble open/close to the popover wrapper so it can render the scrim
  // as a sibling of the popover panel (correct stacking — see note in
  // SectionCommentIcon below).
  useEffect(() => {
    onComposerOpenChange?.(composerOpen);
  }, [composerOpen, onComposerOpenChange]);

  // Re-sync when the parent filter scope changes (single-client preselect).
  // Skipped in optionalClient mode so the rail composer doesn't snap to a
  // client the moment the user narrows the filter.
  useEffect(() => {
    if (optionalClient) return;
    if (clientOptions.length === 1) {
      setClient(clientOptions[0].name);
      setQuery(clientOptions[0].name);
    }
  }, [clientOptions, optionalClient]);

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

  const submit = useCallback(async (html: string) => {
    if (!html.trim()) return;
    if (!optionalClient && !client) return;
    setSubmitting(true);
    try {
      await onCreate(client || null, html);
      setComposerOpen(false);
    } finally {
      setSubmitting(false);
    }
  }, [client, onCreate, optionalClient]);

  if (!composerOpen) {
    return (
      <button
        type="button"
        onClick={() => setComposerOpen(true)}
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#2a2a2a] bg-[#161616] px-2.5 font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA] transition-colors hover:border-[#42CA80]/40 hover:bg-[#42CA80]/10 hover:text-[#65FFAA]"
      >
        <Plus className="h-3 w-3" /> Add comment
      </button>
    );
  }

  return (
    <div className="space-y-2.5 border-t border-[#2a2a2a] pt-2.5">
      {/* Field label */}
      <div className="space-y-1">
        <label className="block font-mono text-[9px] uppercase tracking-wider text-[#606060]">
          Client {optionalClient && <span className="text-[#606060]">(optional)</span>}
        </label>
        {/* Client picker — mirrors FilterBar.tsx "Search clients..."
            with a brighter, more legible style (no green tint). */}
        <div className="relative" ref={comboRef}>
          <Search className="pointer-events-none absolute left-2 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-[#909090]" />
          <input
            type="text"
            placeholder={
              clientOptions.length === 0
                ? "No clients in scope"
                : "Search clients..."
            }
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value !== client) setClient("");
              setDropdownOpen(true);
            }}
            onFocus={() => setDropdownOpen(true)}
            disabled={clientOptions.length === 0}
            className="h-8 w-full rounded-md border border-[#2a2a2a] bg-[#161616] pl-8 pr-7 font-mono text-[12px] text-white placeholder:text-[#606060] focus:border-[#42CA80] focus:outline-none focus:ring-1 focus:ring-[#42CA80]/30 disabled:cursor-not-allowed disabled:opacity-50"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setClient("");
                setDropdownOpen(true);
              }}
              className="absolute right-2 top-1/2 z-10 -translate-y-1/2 text-[#909090] transition-colors hover:text-white"
              aria-label="Clear"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          {dropdownOpen && filteredOptions.length > 0 && (
            <div className="absolute left-0 top-full z-50 mt-1 max-h-[220px] w-full overflow-y-auto rounded-md border border-[#2a2a2a] bg-[#161616] shadow-2xl shadow-black/60">
              {filteredOptions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setQuery(c.name);
                    setClient(c.name);
                    setDropdownOpen(false);
                  }}
                  className={cn(
                    "block w-full px-3 py-1.5 text-left font-mono text-[11px] transition-colors",
                    client === c.name
                      ? "bg-[#42CA80]/15 text-[#65FFAA]"
                      : "text-[#C4BCAA] hover:bg-[#1F1F1F] hover:text-white",
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <label className="block font-mono text-[9px] uppercase tracking-wider text-[#606060]">
          Comment
        </label>
        <RichComposer
          onSubmit={(html) => void submit(html)}
          onCancel={() => setComposerOpen(false)}
          submitting={submitting}
          canSubmit={optionalClient ? true : !!client}
        />
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
  onUpdate,
  onEditOpenChange,
}: {
  clientName: string;
  comments: OverviewComment[];
  isAdmin: boolean;
  onResolve: (id: number) => Promise<void>;
  onReopen: (id: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onUpdate?: (id: number, body: string) => Promise<void>;
  onEditOpenChange?: (open: boolean) => void;
}) {
  // Empty clientName key means the comment was posted without a
  // client attribution — render it as a "General" group.
  const isGeneral = clientName === "";
  return (
    <div className="rounded border border-[#1a1a1a] bg-[#161616] p-2">
      <p
        className={
          "truncate font-mono text-[10px] uppercase tracking-wider " +
          (isGeneral ? "text-[#42CA80]" : "text-[#909090]")
        }
        title={isGeneral ? "Section-wide note (no client)" : clientName}
      >
        {isGeneral ? "General" : clientName}
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
            onUpdate={onUpdate}
            onEditOpenChange={onEditOpenChange}
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
  onUpdate,
  onEditOpenChange,
}: {
  comment: OverviewComment;
  isAdmin: boolean;
  onResolve: (id: number) => Promise<void>;
  onReopen: (id: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onUpdate?: (id: number, body: string) => Promise<void>;
  /** Notifies the popover wrapper when this item enters / exits edit
   *  mode so the modal scrim lock follows the same rules as creating
   *  a new comment. */
  onEditOpenChange?: (open: boolean) => void;
}) {
  const resolved = comment.resolved_at !== null;
  const author =
    comment.author_name ??
    comment.author_email.split("@")[0].replace(/\./g, " ");
  const when = formatRelative(comment.created_at);
  const fullDateTime = new Date(comment.created_at).toLocaleString();
  // Inline two-step confirmation — clicking Delete swaps the action
  // row to "Delete? [Confirm] [Cancel]" instead of triggering the
  // browser's native confirm() dialog (which ignores the Hub's theme).
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [submittingEdit, setSubmittingEdit] = useState(false);

  useEffect(() => {
    onEditOpenChange?.(isEditing);
  }, [isEditing, onEditOpenChange]);

  const handleSaveEdit = async (html: string) => {
    if (!onUpdate) return;
    setSubmittingEdit(true);
    try {
      await onUpdate(comment.id, html);
      setIsEditing(false);
    } finally {
      setSubmittingEdit(false);
    }
  };

  return (
    <li
      className={
        "rounded border border-[#1f1f1f] bg-[#0d0d0d] px-2 py-1.5 " +
        (resolved && !isEditing ? "opacity-60" : "")
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
      {isEditing ? (
        <div className="mt-1.5">
          <RichComposer
            initialBody={comment.body}
            submitLabel="Save"
            submittingLabel="Saving"
            submitting={submittingEdit}
            canSubmit={true}
            onSubmit={(html) => void handleSaveEdit(html)}
            onCancel={() => setIsEditing(false)}
          />
        </div>
      ) : (
        <div className="mt-1">
          <CommentBody body={comment.body} muted={resolved} />
        </div>
      )}
      {isAdmin && !isEditing && (
        confirmingDelete ? (
          <div className="mt-1.5 space-y-1.5 rounded-sm border border-[#ED6958]/40 bg-[#ED6958]/8 px-2 py-1.5">
            <div className="space-y-0.5">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#ED6958]">
                Delete this comment?
              </p>
              <p className="font-mono text-[9px] text-[#909090] leading-snug">
                This can't be undone. The comment and its thread will be permanently removed.
              </p>
            </div>
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="inline-flex h-5 items-center px-2 font-mono text-[9px] uppercase tracking-wider text-[#909090] rounded-sm hover:bg-[#1f1f1f] hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingDelete(false);
                  void onDelete(comment.id);
                }}
                className="inline-flex h-5 items-center gap-1 px-2 font-mono text-[9px] font-semibold uppercase tracking-wider text-white bg-[#ED6958] rounded-sm hover:bg-[#ED6958]/80 transition-colors"
              >
                <Trash2 className="h-2.5 w-2.5" />
                Delete
              </button>
            </div>
          </div>
        ) : (
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
            {onUpdate && (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                title="Edit"
                className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-[#606060] hover:text-[#4ECBE5]"
              >
                <Pencil className="h-2.5 w-2.5" /> Edit
              </button>
            )}
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              title="Delete"
              className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-[#606060] hover:text-[#ED6958]"
            >
              <Trash2 className="h-2.5 w-2.5" /> Delete
            </button>
          </div>
        )
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
  // en-US so timestamps stay English regardless of browser locale.
  if (d.getFullYear() === nowDate.getFullYear()) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ──────────────────────────────────────────────────────────────────────
// Comments Sidebar — right-edge rail that mirrors the left navigation
// sidebar's UX: thin always-visible strip with the chat icon + unread
// count; expands on hover to show every thread (general + section-
// anchored), narrowed to the current filter. Single source of truth so
// posting from a section icon refreshes here automatically (and vice
// versa — both surfaces subscribe to the shared comments store).
//
// Spec:
//   • Pinned to the viewport's right edge (fixed), starts below the
//     global header (top-12). Sits above page content via z-40 — same
//     layer as the left sidebar.
//   • Hover the strip → panel slides open (w-12 → w-[420px]). Mouse
//     leaving collapses it. Esc closes. Click-pin keeps it open while
//     the user composes (so moving the mouse to the textarea doesn't
//     auto-close the panel mid-write).
//   • Composer's client picker is OPTIONAL — admins/leadership can
//     post quick global notes (no client anchor) here. Section-anchored
//     icons still require a client.
// ──────────────────────────────────────────────────────────────────────

export function ClientCommentsRail() {
  const ctx = useContext(OverviewCommentsContext);
  const profile = useAccessProfile();
  const { comments, loading, create, update, resolve, reopen, remove } =
    useOverviewComments();
  const [hovered, setHovered] = useState(false);
  // Click-to-pin so the panel stays open while the user types. Hover
  // alone would collapse the panel the moment the mouse moves to the
  // textarea inside an absolutely-positioned dropdown.
  const [pinned, setPinned] = useState(false);
  // True while the rail's composer is in writing mode OR any comment
  // is being edited — locks the page behind a dim scrim so accidental
  // clicks don't dismiss in-progress work. Bumps the rail z-index so
  // it sits above the scrim itself, and forces the rail open
  // regardless of hover/pin state so it can't collapse while a draft
  // is in flight. Uses a counter for the edit case so multiple items
  // transitioning don't race each other.
  const [isComposing, setIsComposing] = useState(false);
  const [editingCount, setEditingCount] = useState(0);
  const handleEditOpenChange = useCallback((opened: boolean) => {
    setEditingCount((n) => Math.max(0, n + (opened ? 1 : -1)));
  }, []);
  const isLocked = isComposing || editingCount > 0;
  const open = hovered || pinned || isLocked;

  // Esc closes (releases the pin too) — but NOT while composing or
  // editing, so an accidental keypress doesn't discard in-progress
  // content. The composer's / editor's own Cancel is the only exit.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isLocked) {
        setPinned(false);
        setHovered(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, isLocked]);

  const filteredClients = ctx?.filteredClients ?? [];
  const allowedSectionIds = useMemo(() => {
    const ids = new Set<string>([GENERAL_SECTION_ID]);
    for (const s of ctx?.sections ?? []) ids.add(s.id);
    return ids;
  }, [ctx?.sections]);
  const sectionLookup = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of ctx?.sections ?? []) m.set(s.id, s.label);
    return m;
  }, [ctx?.sections]);
  const filteredClientNames = useMemo(
    () => new Set(filteredClients.map((c) => c.name)),
    [filteredClients],
  );

  // Scope rule:
  //   • client_name === null  → global note, ALWAYS visible regardless
  //     of the active client filter (it's not anchored to anyone).
  //   • client_name !== null  → only when that client is in scope.
  // Covers both general ("general") and section-anchored threads so the
  // rail is the unified view across all comments.
  const scoped = useMemo(
    () =>
      comments.filter(
        (c) =>
          allowedSectionIds.has(c.section_id) &&
          (c.client_name === null || filteredClientNames.has(c.client_name)),
      ),
    [allowedSectionIds, comments, filteredClientNames],
  );
  const totalAll = comments.length;
  const hiddenByFilter = totalAll - scoped.length;
  const unresolved = scoped.filter((c) => c.resolved_at === null).length;
  const totalScoped = scoped.length;

  // Group: client (or "global") → section_id → comments. Global block
  // sorts first, then clients alphabetically. Within a block, general
  // section sorts first too.
  const groupedByClient = useMemo(() => {
    const GLOBAL_KEY = "__global__";
    const byClient = new Map<string, Map<string, OverviewComment[]>>();
    for (const c of scoped) {
      const key = c.client_name ?? GLOBAL_KEY;
      let sectionMap = byClient.get(key);
      if (!sectionMap) {
        sectionMap = new Map();
        byClient.set(key, sectionMap);
      }
      const list = sectionMap.get(c.section_id) ?? [];
      list.push(c);
      sectionMap.set(c.section_id, list);
    }
    return Array.from(byClient.entries())
      .sort(([a], [b]) => {
        if (a === GLOBAL_KEY) return -1;
        if (b === GLOBAL_KEY) return 1;
        return a.localeCompare(b);
      })
      .map(([client, sectionMap]) => {
        const sections = Array.from(sectionMap.entries()).sort(([a], [b]) => {
          if (a === GENERAL_SECTION_ID) return -1;
          if (b === GENERAL_SECTION_ID) return 1;
          return (sectionLookup.get(a) ?? a).localeCompare(
            sectionLookup.get(b) ?? b,
          );
        });
        return [client, sections] as const;
      });
  }, [scoped, sectionLookup]);

  const canWrite = canManageComments(profile);

  return (
    // Real sidebar — `fixed` so it floats above the page chrome and
    // expands in-place on hover (no separate popover). Discreet: starts
    // below the sticky filter band, caps its height so it doesn't run
    // to the bottom of the viewport, and sits 12px in from the right
    // edge so it never overlaps the browser's vertical scrollbar.
    //
    // While composing, the rail bumps to z-50 and a modal scrim is
    // rendered at z-45 to lock the page until Save / Cancel.
    <>
    {isLocked && (
      <div
        className="fixed inset-0 z-[45] bg-black/55 backdrop-blur-[2px]"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        aria-hidden
      />
    )}
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "fixed right-3 top-[140px] flex flex-col rounded-lg border border-[#1f1f1f] bg-[#0a0a0a]",
        isLocked ? "z-[50]" : "z-40",
        "transition-[width,max-height] duration-200 ease-in-out overflow-hidden",
        open
          ? "w-[380px] max-h-[calc(100vh-180px)] shadow-2xl shadow-black/60"
          : "w-10 max-h-10 hover:border-[#2a2a2a]",
      )}
      aria-label="Comments"
    >
      {/* Collapsed strip — single icon button. Click to pin the panel
          open so the cursor can leave the strip without auto-collapsing
          (matches the standard sidebar pattern). */}
      <button
        type="button"
        onClick={() => setPinned((v) => !v)}
        title={
          pinned
            ? "Click to unpin"
            : open
              ? "Click to pin while composing"
              : unresolved > 0
                ? `${unresolved} open comment${unresolved === 1 ? "" : "s"} · hover to view`
                : totalScoped > 0
                  ? `${totalScoped} comment${totalScoped === 1 ? "" : "s"} (all resolved) · hover to view`
                  : "Hover to view comments"
        }
        className={cn(
          "flex h-10 shrink-0 items-center gap-2 px-3 transition-colors",
          pinned
            ? "bg-[#42CA80]/10 text-[#65FFAA]"
            : "text-[#909090] hover:text-white",
        )}
      >
        <div className="relative shrink-0">
          <MessageSquare className="h-4 w-4" />
          {unresolved > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5 rounded-full bg-[#F5BC4E] px-1 font-mono text-[9px] font-semibold text-black leading-[14px] min-w-[14px] text-center"
              aria-label={`${unresolved} unresolved`}
            >
              {unresolved}
            </span>
          )}
        </div>
        {open && (
          <span className="font-mono text-[11px] uppercase tracking-wider truncate">
            Comments
            {!loading && totalScoped > 0 && (
              <span
                className="ml-2 font-mono text-[9px] tabular-nums"
                style={{ color: unresolved > 0 ? "#F5BC4E" : "#606060" }}
              >
                {unresolved > 0
                  ? `${unresolved} open · ${totalScoped} total`
                  : `${totalScoped} resolved`}
              </span>
            )}
          </span>
        )}
        {pinned && (
          <span className="ml-auto rounded-sm border border-[#42CA80]/30 bg-[#42CA80]/10 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-[#65FFAA]">
            Pinned
          </span>
        )}
      </button>

      {/* Expanded body — only mounted when open so the collapsed state
          doesn't keep mounting the composer + thread list off-screen. */}
      {open && (
        <div className="flex flex-1 flex-col overflow-hidden border-t border-[#1f1f1f]">
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
            {groupedByClient.length === 0 ? (
              <p className="font-mono text-[10px] leading-relaxed text-[#606060]">
                {hiddenByFilter > 0
                  ? `No comments for the current filter. ${hiddenByFilter} thread${
                      hiddenByFilter === 1 ? "" : "s"
                    } scoped to other clients — clear the filter above to see them.`
                  : "No comments yet."}
              </p>
            ) : (
              groupedByClient.map(([clientKey, sections]) => {
                const isGlobal = clientKey === "__global__";
                return (
                  <div
                    key={clientKey}
                    className={cn(
                      "rounded border p-2",
                      isGlobal
                        ? "border-[#42CA80]/30 bg-[#42CA80]/[0.04]"
                        : "border-[#1a1a1a] bg-[#161616]",
                    )}
                  >
                    <p
                      className={cn(
                        "truncate font-mono text-[10px] uppercase tracking-wider",
                        isGlobal ? "text-[#65FFAA]" : "text-[#909090]",
                      )}
                      title={
                        isGlobal ? "Global notes — no client anchor" : clientKey
                      }
                    >
                      {isGlobal ? "Global" : clientKey}
                    </p>
                    {sections.map(([sectionId, list]) => {
                      const label =
                        sectionId === GENERAL_SECTION_ID
                          ? "Note"
                          : (sectionLookup.get(sectionId) ?? sectionId);
                      return (
                        <div key={sectionId} className="mt-2">
                          {!(isGlobal && sectionId === GENERAL_SECTION_ID) && (
                            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#606060]">
                              {label}
                            </p>
                          )}
                          <ul className="mt-1 space-y-2">
                            {list.map((c) => (
                              <CommentItem
                                key={c.id}
                                comment={c}
                                isAdmin={canWrite}
                                onResolve={resolve}
                                onReopen={reopen}
                                onDelete={remove}
                                onUpdate={update}
                                onEditOpenChange={handleEditOpenChange}
                              />
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}

            {canWrite && (
              <SectionComposer
                sectionId={GENERAL_SECTION_ID}
                clientOptions={filteredClients}
                optionalClient
                onComposerOpenChange={setIsComposing}
                onCreate={async (clientName, body) => {
                  await create({
                    section_id: GENERAL_SECTION_ID,
                    client_name: clientName,
                    body,
                  });
                }}
              />
            )}
          </div>
        </div>
      )}
    </aside>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Legacy export retained so callers importing the old rail name still
// build — they should migrate to <ClientCommentsRail>.
// ──────────────────────────────────────────────────────────────────────

export function OverviewCommentsRail() {
  return null;
}
