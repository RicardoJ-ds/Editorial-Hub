"use client";

import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataSourceBadge } from "@/components/dashboard/DataSourceBadge";
import { displayPod } from "@/components/dashboard/shared-helpers";
import type { Client } from "@/lib/types";

const POD_COLORS: Record<string, string> = {
  "Pod 1": "#8FB5D9",
  "Pod 2": "#42CA80",
  "Pod 3": "#F5C542",
  "Pod 4": "#F28D59",
  "Pod 5": "#ED6958",
  "Pod 6": "#CEBCF4",
  "Pod 7": "#7FE8D6",
  Unassigned: "#606060",
};

function normalizePod(raw: string | null | undefined): string {
  if (raw == null) return "Unassigned";
  const t = String(raw).trim();
  if (!t || t === "-" || t === "—") return "Unassigned";
  const n = t.match(/^(\d+)$/);
  if (n) return `Pod ${n[1]}`;
  const p = t.match(/^p(?:od)?\s*(\d+)$/i);
  if (p) return `Pod ${p[1]}`;
  return t;
}

function sortPodKey(a: string, b: string): number {
  if (a === "Unassigned" && b !== "Unassigned") return 1;
  if (b === "Unassigned" && a !== "Unassigned") return -1;
  const na = parseInt(a.replace(/\D/g, ""), 10);
  const nb = parseInt(b.replace(/\D/g, ""), 10);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

// Render free-text comments with inline hyperlinks intact. We support two
// encodings for links so both the Sheets-API sync path and any bare URLs
// pasted into the sheet render correctly:
//
//   1. Markdown  "[text](https://url)"  — produced by the migration service
//      when the Google Sheets cell has a rich-text hyperlink on a substring.
//   2. Bare URLs "https://url"          — future-proof for comments where
//      someone just pastes the raw link into the sheet.
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_URL_RE = /(https?:\/\/[^\s)]+)/g;

const linkClass =
  "text-[#8FB5D9] underline decoration-dotted underline-offset-2 hover:text-[#7FE8D6]";

function renderBareUrls(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(BARE_URL_RE);
  return parts.map((part, i) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={`${keyPrefix}-u${i}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
        >
          {part}
        </a>
      );
    }
    return <React.Fragment key={`${keyPrefix}-t${i}`}>{part}</React.Fragment>;
  });
}

function renderNoteText(text: string): React.ReactNode {
  const tokens: React.ReactNode[] = [];
  let cursor = 0;
  MD_LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MD_LINK_RE.exec(text)) !== null) {
    const start = m.index;
    if (start > cursor) {
      tokens.push(...renderBareUrls(text.slice(cursor, start), `p${cursor}`));
    }
    tokens.push(
      <a
        key={`md-${start}`}
        href={m[2]}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
      >
        {m[1]}
      </a>,
    );
    cursor = start + m[0].length;
  }
  if (cursor < text.length) {
    tokens.push(...renderBareUrls(text.slice(cursor), `p${cursor}`));
  }
  return tokens;
}

// Comments from the SOW sheet are free-text. Treat the obvious "no-content"
// placeholders as empty so they don't clutter the panel.
export function hasClientNote(c: Client): boolean {
  const t = (c.comments ?? "").trim();
  if (!t) return false;
  const low = t.toLowerCase();
  return low !== "-" && low !== "—" && low !== "tbd" && low !== "n/a" && low !== "na";
}

export function ClientNotesPanel({ clients }: { clients: Client[] }) {
  const rows = useMemo(
    () =>
      clients.filter(hasClientNote).map((c) => ({
        id: c.id,
        name: c.name,
        pod: normalizePod(c.editorial_pod),
        status: c.status,
        comments: (c.comments ?? "").trim(),
      })),
    [clients],
  );

  const { byPod, pods } = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = m.get(r.pod) ?? [];
      arr.push(r);
      m.set(r.pod, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return { byPod: m, pods: Array.from(m.keys()).sort(sortPodKey) };
  }, [rows]);

  return (
    <Card className="border-[#2a2a2a] bg-[#161616]">
      <CardHeader>
        <CardTitle className="text-white">
          Client Notes{" "}
          <DataSourceBadge
            type="live"
            source="Sheet: 'Editorial SOW overview' → Comments column — Spreadsheet: Editorial Capacity Planning. Scope changes, opt-outs, and other editorial-relevant context. Respects the Client + Pod filters above."
            shows={[
              "Freeform notes the Editorial team maintains on each client — scope changes, opt-outs, context you need before looking at their delivery numbers.",
              "Grouped by editorial pod so you can scan one pod's context at a time.",
              "URLs and [text](url) links in the comments column render as clickable links inline.",
              "Only clients with notes appear — silence here means no flagged context.",
            ]}
          />
        </CardTitle>
        <p className="mt-1 font-mono text-[11px] leading-relaxed text-[#C4BCAA]">
          {rows.length} client{rows.length === 1 ? "" : "s"} with notes in the current filter.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="max-h-[380px] space-y-3 overflow-y-auto pr-1">
          {pods.map((pod) => {
            const list = byPod.get(pod) ?? [];
            const color = POD_COLORS[pod] ?? "#606060";
            return (
              <div key={pod}>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                  <span
                    className="font-mono text-xs font-semibold uppercase tracking-wider"
                    style={{ color }}
                  >
                    {displayPod(pod, "editorial")}
                  </span>
                  <span className="font-mono text-[10px] text-[#606060]">({list.length})</span>
                </div>
                <div className="ml-3.5 space-y-2">
                  {list.map((r) => (
                    <div
                      key={r.id}
                      className="rounded border border-[#2a2a2a] bg-[#0d0d0d] p-2.5"
                    >
                      <p className="font-mono text-xs font-semibold text-white">{r.name}</p>
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[#C4BCAA]">
                        {renderNoteText(r.comments)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
