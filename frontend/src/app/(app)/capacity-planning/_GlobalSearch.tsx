"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useCP2Store } from "./_store";

type Hit = {
  id: string;
  label: string;
  sub: string;
  href: string;
};

export function GlobalSearch() {
  const { dims, state } = useCP2Store();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Global "/" to focus
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (
        e.key === "/" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hits: Hit[] = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const out: Hit[] = [];

    for (const m of dims.members) {
      if (
        m.full_name.toLowerCase().includes(term) ||
        m.email.toLowerCase().includes(term)
      ) {
        out.push({
          id: `m-${m.id}`,
          label: m.full_name,
          sub: `member · ${m.role_default} · ${m.email || "—"}`,
          href: "/capacity-planning/admin/members",
        });
      }
    }
    for (const p of dims.pods) {
      if (p.display_name.toLowerCase().includes(term)) {
        out.push({
          id: `p-${p.id}`,
          label: p.display_name,
          sub: `pod · #${p.pod_number}`,
          href: "/capacity-planning/admin/pods",
        });
      }
    }
    for (const c of dims.clients) {
      const name = `client #${c.client_id_fk}`;
      if (name.includes(term)) {
        out.push({
          id: `c-${c.id}`,
          label: name,
          sub: `client · ${c.cadence} · ${c.sow_articles_total} SOW`,
          href: "/capacity-planning/admin/clients",
        });
      }
    }
    // Also surface active clients by the chip name in current monthly data.
    const seenNames = new Set<string>();
    for (const pods of Object.values(state.monthly)) {
      for (const pod of pods) {
        for (const chip of pod.clients) {
          if (seenNames.has(chip.name)) continue;
          if (chip.name.toLowerCase().includes(term)) {
            seenNames.add(chip.name);
            out.push({
              id: `mc-${chip.id}`,
              label: chip.name,
              sub: `active client · ${pod.displayName}`,
              href: "/capacity-planning/allocation",
            });
          }
        }
      }
    }

    return out.slice(0, 12);
  }, [q, dims, state]);

  return (
    <div className="relative">
      <div className="flex items-center gap-1 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-2 py-1">
        <Search className="h-3.5 w-3.5 text-[#606060]" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder="Search   /"
          className="h-6 w-36 bg-transparent font-sans text-xs text-white placeholder:text-[#606060] outline-none md:w-44"
        />
      </div>

      {open && hits.length > 0 && (
        <div className="absolute right-0 top-[calc(100%+4px)] z-30 w-72 overflow-hidden rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] shadow-xl shadow-black/60">
          <ul>
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onMouseDown={() => {
                    router.push(h.href);
                    setOpen(false);
                    setQ("");
                  }}
                  className="flex w-full flex-col px-3 py-2 text-left hover:bg-[#161616]"
                >
                  <span className="text-xs font-medium text-white">{h.label}</span>
                  <span className="font-mono text-[10px] text-[#606060]">{h.sub}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
