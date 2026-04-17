"use client";

import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { StickyPageChrome } from "../_StickyPageChrome";
import { useCP2Store } from "../_store";
import type { DimClient } from "../_store";

type Milestone = {
  key: string;
  label: string;
  field: keyof DimClient;
  color: string;
};

const MILESTONES: Milestone[] = [
  { key: "cko", label: "Consulting KO", field: "contract_start", color: "#F28D59" },
  { key: "eko", label: "Editorial KO", field: "contract_start", color: "#F5BC4E" },
  { key: "first_cb", label: "1st CB", field: "contract_start", color: "#42CA80" },
  { key: "first_art", label: "1st Article", field: "contract_start", color: "#8FB5D9" },
  { key: "first_fb", label: "1st Feedback", field: "contract_start", color: "#F5C542" },
  { key: "first_pub", label: "1st Published", field: "contract_start", color: "#CEBCF4" },
];

const POD_COLOR: Record<string, string> = {
  "editorial-1": "#5B9BF5",
  "editorial-2": "#42CA80",
  "editorial-3": "#F5C542",
  "editorial-4": "#F28D59",
  "editorial-5": "#ED6958",
};

function toMillis(date: string | null | undefined): number | null {
  if (!date) return null;
  const t = Date.parse(date);
  return Number.isNaN(t) ? null : t;
}

export default function GanttPage() {
  const { dims } = useCP2Store();
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const clients = useMemo(() => {
    const filtered = statusFilter === "ALL"
      ? dims.clients
      : dims.clients.filter((c) => c.status === statusFilter);
    return filtered.slice().sort((a, b) => {
      const ta = toMillis(a.contract_start) ?? 0;
      const tb = toMillis(b.contract_start) ?? 0;
      return ta - tb;
    });
  }, [dims.clients, statusFilter]);

  const { minMs, maxMs, months } = useMemo(() => {
    let minMs = Number.POSITIVE_INFINITY;
    let maxMs = Number.NEGATIVE_INFINITY;
    for (const c of clients) {
      const s = toMillis(c.contract_start);
      const e = toMillis(c.contract_end);
      if (s && s < minMs) minMs = s;
      if (e && e > maxMs) maxMs = e;
    }
    if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) {
      const now = Date.now();
      minMs = now - 1000 * 60 * 60 * 24 * 180;
      maxMs = now + 1000 * 60 * 60 * 24 * 180;
    }
    // Pad by one month each side.
    minMs -= 1000 * 60 * 60 * 24 * 30;
    maxMs += 1000 * 60 * 60 * 24 * 30;

    const months: { ms: number; label: string }[] = [];
    const d = new Date(minMs);
    d.setUTCDate(1);
    while (d.getTime() <= maxMs) {
      months.push({
        ms: d.getTime(),
        label: `${d.toLocaleString("en-US", { month: "short" })} ${String(d.getUTCFullYear()).slice(-2)}`,
      });
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return { minMs, maxMs, months };
  }, [clients]);

  const xPct = (ms: number) =>
    Math.max(0, Math.min(100, ((ms - minMs) / (maxMs - minMs)) * 100));

  const today = Date.now();

  return (
    <div className="flex flex-col gap-4">
      <StickyPageChrome subtitle="Client engagement Gantt. One row per client — contract window as a bar, milestones as dots, pod as the bar color. Hover for detail." />

      <div className="flex items-center gap-3 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-[#606060]">
        <span>Status</span>
        {(["ALL", "ACTIVE", "COMPLETED", "SOON_TO_BE_ACTIVE", "CANCELLED", "INACTIVE"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-md border px-2 py-0.5 transition-colors ${
              statusFilter === s
                ? "border-[#42CA80]/40 bg-[#42CA80]/10 text-[#65FFAA]"
                : "border-[#2a2a2a] bg-[#161616] text-[#C4BCAA] hover:text-white"
            }`}
          >
            {s}
          </button>
        ))}
        <span className="ml-auto">{clients.length} clients</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#1f1f1f] bg-[#0a0a0a]">
        <div className="min-w-[1100px]">
          {/* Month header */}
          <div className="sticky top-0 z-10 border-b border-[#1a1a1a] bg-[#050505]">
            <div className="grid grid-cols-[240px_1fr]">
              <div className="px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-[#606060]">
                Client
              </div>
              <div className="relative h-7">
                {months.map((m) => (
                  <div
                    key={m.ms}
                    style={{ left: `${xPct(m.ms)}%` }}
                    className="absolute top-0 h-full border-l border-[#111] pl-1 font-mono text-[9px] uppercase tracking-wider text-[#606060]"
                  >
                    {m.label}
                  </div>
                ))}
                {/* Today marker */}
                {today >= minMs && today <= maxMs && (
                  <div
                    className="absolute top-0 h-full border-l-2 border-[#65FFAA]/60"
                    style={{ left: `${xPct(today)}%` }}
                    title="Today"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Rows */}
          {clients.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-[#606060]">
              No clients match the filter.
            </div>
          ) : (
            clients.map((c, i) => {
              const s = toMillis(c.contract_start);
              const e = toMillis(c.contract_end);
              if (!s || !e) {
                return (
                  <div
                    key={c.id}
                    className="grid grid-cols-[240px_1fr] border-t border-[#111] py-2"
                  >
                    <div className="px-4 text-xs text-[#C4BCAA]">{c.name}</div>
                    <div className="px-2 text-[10px] text-[#606060]">Missing contract dates</div>
                  </div>
                );
              }
              const barLeft = xPct(s);
              const barRight = xPct(e);
              const barWidth = Math.max(0.5, barRight - barLeft);
              const color = POD_COLOR[c.editorial_pod ?? ""] ?? "#42CA80";

              return (
                <div
                  key={c.id}
                  className={`grid grid-cols-[240px_1fr] items-center border-t border-[#111] py-2 ${i % 2 === 0 ? "bg-[#0a0a0a]" : "bg-[#0c0c0c]"}`}
                >
                  <div className="px-4">
                    <div className="text-xs font-medium text-white">{c.name}</div>
                    <div className="font-mono text-[10px] text-[#606060]">
                      {c.editorial_pod ?? "—"} · {c.status} · {c.sow_articles_total} SOW
                    </div>
                  </div>
                  <div className="relative h-8">
                    {/* Month grid lines */}
                    {months.map((m) => (
                      <div
                        key={m.ms}
                        className="absolute top-0 h-full border-l border-[#141414]"
                        style={{ left: `${xPct(m.ms)}%` }}
                      />
                    ))}
                    {/* Today */}
                    {today >= minMs && today <= maxMs && (
                      <div
                        className="absolute top-0 h-full border-l-2 border-[#65FFAA]/30"
                        style={{ left: `${xPct(today)}%` }}
                      />
                    )}
                    {/* Contract bar */}
                    <div
                      className="absolute top-1/2 h-4 -translate-y-1/2 rounded"
                      style={{
                        left: `${barLeft}%`,
                        width: `${barWidth}%`,
                        backgroundColor: `${color}33`,
                        borderLeft: `2px solid ${color}`,
                        borderRight: `2px solid ${color}`,
                      }}
                      title={`${c.name}: ${c.contract_start} → ${c.contract_end}`}
                    />
                    {/* Milestone dots */}
                    <MilestoneDot ms={toMillis(c.consulting_ko_date)} xPct={xPct} color="#F28D59" label={`Consulting KO · ${c.consulting_ko_date ?? ""}`} />
                    <MilestoneDot ms={toMillis(c.editorial_ko_date)} xPct={xPct} color="#F5BC4E" label={`Editorial KO · ${c.editorial_ko_date ?? ""}`} />
                    <MilestoneDot ms={toMillis(c.first_cb_approved_date ?? null)} xPct={xPct} color="#42CA80" label={`First CB approved · ${c.first_cb_approved_date ?? ""}`} />
                    <MilestoneDot ms={toMillis(c.first_article_delivered_date ?? null)} xPct={xPct} color="#8FB5D9" label={`First article delivered · ${c.first_article_delivered_date ?? ""}`} />
                    <MilestoneDot ms={toMillis(c.first_article_published_date ?? null)} xPct={xPct} color="#CEBCF4" label={`First article published · ${c.first_article_published_date ?? ""}`} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3 text-[11px] text-[#C4BCAA]">
        <Info className="h-4 w-4 shrink-0 text-[#42CA80]" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
          Milestones
        </span>
        <LegendDot color="#F28D59" label="Consulting KO" />
        <LegendDot color="#F5BC4E" label="Editorial KO" />
        <LegendDot color="#42CA80" label="First CB" />
        <LegendDot color="#8FB5D9" label="First Article" />
        <LegendDot color="#CEBCF4" label="First Published" />
        <span className="ml-auto font-mono text-[10px] text-[#606060]">
          cp2_dim_client
        </span>
      </div>
    </div>
  );
}

function MilestoneDot({ ms, xPct, color, label }: { ms: number | null; xPct: (ms: number) => number; color: string; label: string }) {
  if (ms === null) return null;
  return (
    <div
      className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[#0a0a0a]"
      style={{ left: `${xPct(ms)}%`, backgroundColor: color }}
      title={label}
    />
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
