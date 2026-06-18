"use client";

/**
 * In-app Help + Changelog modal.
 *
 * Two entry points (both in the Sidebar):
 *   1. Click the version chip at the bottom → opens with the "Changelog"
 *      tab active so the user sees what just shipped.
 *   2. Click the dedicated Help icon → opens with the "Help" tab active
 *      so non-technical users get a glossary + quick guide.
 *
 * The two tabs share a single Dialog so closing snaps back to the app
 * with a "Back to app" button in the footer (in addition to the ✕).
 *
 * Markdown is rendered with `react-markdown` + `remark-gfm` (for tables,
 * checklists, etc.). Styling is inline via Tailwind utility classes on
 * a `components` map — keeps the dark-theme palette consistent with
 * the rest of the dashboard.
 */

import { ArrowLeftToLine, BookOpen, Lock, ScrollText, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HELP_MARKDOWN } from "@/content/help";
import { CHANGELOG_MARKDOWN } from "@/content/changelog";
import { VERSION } from "@/lib/version";
import type { AccessProfile } from "@/lib/accessClient";

export type HelpModalTab = "help" | "changelog";

function canViewChangelog(profile: AccessProfile | null): boolean {
  // Changelog hidden from everyone (including admins) per request.
  void profile;
  return false;
}

export function HelpModal({
  open,
  onOpenChange,
  initialTab = "help",
  profile = null,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  initialTab?: HelpModalTab;
  profile?: AccessProfile | null;
}) {
  const showChangelog = canViewChangelog(profile);
  const resolvedTab =
    initialTab === "changelog" && !showChangelog ? "help" : initialTab;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] sm:max-w-[780px] border-[#2a2a2a] bg-[#0a0a0a] p-0 sm:rounded-lg overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[#1f1f1f] bg-[#0d0d0d] px-4 py-2.5">
          <DialogTitle className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-[#C4BCAA]">
            <BookOpen className="h-3.5 w-3.5 text-[#42CA80]" />
            Editorial Hub
            <span className="rounded-sm border border-[#42CA80]/30 bg-[#42CA80]/10 px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-[#42CA80]">
              v{VERSION}
            </span>
          </DialogTitle>
          <DialogClose
            className="inline-flex h-6 w-6 items-center justify-center rounded text-[#606060] transition-colors hover:bg-[#1f1f1f] hover:text-white"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </DialogClose>
        </div>

        <Tabs defaultValue={resolvedTab} className="flex flex-col">
          <div className="flex items-center gap-3 mx-4 mt-3 mb-0">
            <TabsList variant="line" className="self-start">
              <TabsTrigger value="help" className="gap-1.5">
                <BookOpen className="h-3.5 w-3.5" />
                Help &amp; Glossary
              </TabsTrigger>
              {showChangelog && (
                <TabsTrigger value="changelog" className="gap-1.5">
                  <ScrollText className="h-3.5 w-3.5" />
                  Changelog
                </TabsTrigger>
              )}
            </TabsList>
            {showChangelog && (
              <span className="flex items-center gap-1 font-mono text-[10px] text-[#606060]">
                <Lock className="h-2.5 w-2.5" />
                Changelog visible to Admin · Leadership · BI Team only
              </span>
            )}
          </div>

          <TabsContent
            value="help"
            keepMounted
            className="data-[state=inactive]:hidden"
          >
            <MarkdownPane source={HELP_MARKDOWN} />
          </TabsContent>
          {showChangelog && (
            <TabsContent
              value="changelog"
              keepMounted
              className="data-[state=inactive]:hidden"
            >
              <MarkdownPane source={CHANGELOG_MARKDOWN} />
            </TabsContent>
          )}
        </Tabs>

        <div className="flex items-center justify-end gap-2 border-t border-[#1f1f1f] bg-[#0d0d0d] px-4 py-2.5">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#42CA80]/30 bg-[#42CA80]/10 px-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#42CA80] transition-colors hover:border-[#42CA80]/50 hover:bg-[#42CA80]/20 hover:text-[#65FFAA]"
          >
            <ArrowLeftToLine className="h-3 w-3" />
            Back to app
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Markdown renderer styled to match the dashboard palette. Long-form
 *  content (CHANGELOG can be > 250 lines) gets a max-height + scroll so
 *  the modal frame stays consistent. */
function MarkdownPane({ source }: { source: string }) {
  return (
    <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
      <article className="prose-invert text-[12.5px] leading-relaxed text-[#C4BCAA]">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <h1 className="mb-2 mt-0 font-mono text-base font-bold uppercase tracking-[0.18em] text-white">
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="mb-2 mt-5 font-mono text-[13px] font-bold uppercase tracking-[0.16em] text-[#65FFAA]">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="mb-1.5 mt-4 font-mono text-[12px] font-semibold uppercase tracking-wider text-[#C4BCAA]">
                {children}
              </h3>
            ),
            h4: ({ children }) => (
              <h4 className="mb-1 mt-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#909090]">
                {children}
              </h4>
            ),
            p: ({ children }) => (
              <p className="mb-2.5 last:mb-0">{children}</p>
            ),
            ul: ({ children }) => (
              <ul className="mb-2.5 ml-4 list-disc space-y-1 marker:text-[#3a3a3a]">
                {children}
              </ul>
            ),
            ol: ({ children }) => (
              <ol className="mb-2.5 ml-4 list-decimal space-y-1 marker:text-[#3a3a3a]">
                {children}
              </ol>
            ),
            li: ({ children }) => <li className="pl-1">{children}</li>,
            strong: ({ children }) => (
              <strong className="font-semibold text-white">{children}</strong>
            ),
            em: ({ children }) => (
              <em className="italic text-[#909090]">{children}</em>
            ),
            code: ({ children }) => (
              <code className="rounded bg-[#161616] px-1 py-px font-mono text-[11px] text-[#65FFAA]">
                {children}
              </code>
            ),
            a: ({ children, href }) => (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#65FFAA] underline decoration-dotted underline-offset-2 hover:text-[#42CA80]"
              >
                {children}
              </a>
            ),
            hr: () => <hr className="my-4 border-[#1f1f1f]" />,
            table: ({ children }) => (
              <div className="mb-3 overflow-x-auto rounded-md border border-[#1f1f1f]">
                <table className="w-full border-collapse text-[11.5px]">
                  {children}
                </table>
              </div>
            ),
            thead: ({ children }) => (
              <thead className="bg-[#161616] text-[#909090]">{children}</thead>
            ),
            th: ({ children }) => (
              <th className="border-b border-[#1f1f1f] px-3 py-1.5 text-left font-mono text-[10px] uppercase tracking-wider">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border-t border-[#161616] px-3 py-1.5 align-top text-[#C4BCAA]">
                {children}
              </td>
            ),
            blockquote: ({ children }) => (
              <blockquote className="my-3 rounded-md border-l-2 border-[#42CA80]/40 bg-[#42CA80]/[0.04] py-1.5 pl-3 pr-2 text-[#909090]">
                {children}
              </blockquote>
            ),
          }}
        >
          {source}
        </ReactMarkdown>
      </article>
    </div>
  );
}
