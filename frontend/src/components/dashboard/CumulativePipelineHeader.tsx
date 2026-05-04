"use client";

import React, { useMemo } from "react";
import {
  PIPELINE_STAGE_COLORS,
  TooltipBody,
  displayPod,
  type PipelineStage,
} from "./shared-helpers";
import { normalizePod } from "./ContractClientProgress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Client, CumulativeMetric } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Section header replacing the old top-row cards. Per-client cards below
// already carry the per-stage detail; this strip just gives a one-line scope
// summary so reviewers can read the top-of-section state at a glance.
//
//   • Portfolio / pod: clients-in-scope · overall % · 4 stage mini-bars
//     + anomaly chip if Topics ≥ CBs ≥ Articles ≥ Published is violated.
//   • Single client:  status pill · pod chips · contract window + days left.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  filteredClients: Client[];
  rows: CumulativeMetric[];
}

interface Aggregate {
  sow: number;
  topics: number;
  cbs: number;
  articles: number;
  published: number;
  clients: number;
}

export function CumulativePipelineHeader({ filteredClients, rows }: Props) {
  const scope = useMemo(() => buildScope(filteredClients, rows), [filteredClients, rows]);
  if (scope.kind === "client") return <ClientHeader client={scope.client} />;
  return <ScopeHeader subtitle={scope.subtitle} agg={scope.agg} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope detection
// ─────────────────────────────────────────────────────────────────────────────

type Scope =
  | { kind: "client"; client: Client }
  | { kind: "pod" | "portfolio"; subtitle: string; agg: Aggregate };

function buildScope(filteredClients: Client[], rows: CumulativeMetric[]): Scope {
  if (filteredClients.length === 1) {
    return { kind: "client", client: filteredClients[0] };
  }

  const agg: Aggregate = {
    sow: 0, topics: 0, cbs: 0, articles: 0, published: 0, clients: 0,
  };
  for (const c of filteredClients) {
    const r = rows.find((row) => row.client_name === c.name);
    const sow = typeof c.articles_sow === "number" && c.articles_sow > 0 ? c.articles_sow : 0;
    agg.clients += 1;
    agg.sow += sow;
    agg.topics += r?.topics_approved ?? 0;
    agg.cbs += r?.cbs_approved ?? 0;
    // Articles intentionally counts SENT, not approved — articles delivered
    // to the client get billed/counted regardless of whether the client has
    // marked them approved in the workflow yet. Topics and CBs still use
    // `approved` because those stages require explicit client sign-off.
    agg.articles += r?.articles_sent ?? 0;
    agg.published += r?.published_live ?? 0;
  }

  const pods = new Set(
    filteredClients.map((c) =>
      c.editorial_pod ? normalizePod(c.editorial_pod) : "Unassigned",
    ),
  );
  if (pods.size === 1) {
    const pod = Array.from(pods)[0];
    return {
      kind: "pod",
      subtitle: `${displayPod(pod)} · ${agg.clients} clients`,
      agg,
    };
  }
  return {
    kind: "portfolio",
    subtitle: `${agg.clients} clients · ${pods.size} pods`,
    agg,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio / pod view — scope summary + 4 stage mini-bars
// ─────────────────────────────────────────────────────────────────────────────

function ScopeHeader({ subtitle, agg }: { subtitle: string; agg: Aggregate }) {
  const stages = useMemo(() => {
    if (agg.sow <= 0) return null;
    const list: { key: PipelineStage; label: string; value: number }[] = [
      { key: "topics", label: "Topics", value: agg.topics },
      { key: "cbs", label: "CBs", value: agg.cbs },
      { key: "articles", label: "Articles", value: agg.articles },
      { key: "published", label: "Published", value: agg.published },
    ];
    return list.map((s, i) => {
      const pct = (s.value / agg.sow) * 100;
      const prior = i > 0 ? (list[i - 1].value / agg.sow) * 100 : null;
      // Anomaly = current stage has higher coverage than the prior stage,
      // which inverts the natural Topics ≥ CBs ≥ Articles ≥ Published funnel.
      const anomaly = prior !== null && pct > prior + 0.5;
      return { ...s, pct, anomaly };
    });
  }, [agg]);

  const overallPct = agg.sow > 0 ? Math.round((agg.articles / agg.sow) * 100) : null;
  const anyAnomaly = stages?.some((s) => s.anomaly) ?? false;

  return (
    <div className="rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {/* Scope summary */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
            Scope
          </span>
          <span className="font-mono text-xs text-[#C4BCAA]">{subtitle}</span>
        </div>

        {/* Overall articles ÷ SOW */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="cursor-help inline-flex items-center gap-2 underline decoration-dotted underline-offset-2 decoration-[#404040]" />
              }
            >
              <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
                Overall
              </span>
              <span className="font-mono text-sm font-bold tabular-nums text-white">
                {overallPct === null ? "—" : `${overallPct}%`}
              </span>
              <span className="font-mono text-[11px] text-[#606060] tabular-nums">
                {agg.articles.toLocaleString()} / {agg.sow.toLocaleString()}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              <TooltipBody
                title="Overall"
                bullets={[
                  "Σ articles ÷ Σ contracted SOW.",
                  "All-time, across the clients in scope.",
                ]}
              />
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Stage mini-bars */}
        {stages ? (
          <div className="flex flex-1 min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
            {stages.map((s) => (
              <StageMini key={s.key} stage={s.key} label={s.label} pct={s.pct} />
            ))}
          </div>
        ) : (
          <span className="font-mono text-[11px] text-[#606060]">No SOW in scope</span>
        )}

        {/* Anomaly chip */}
        {stages && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className="cursor-help inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
                    style={
                      anyAnomaly
                        ? { color: "#F5BC4E", borderColor: "rgba(245,188,78,0.4)", backgroundColor: "rgba(245,188,78,0.10)" }
                        : { color: "#606060", borderColor: "#2a2a2a", backgroundColor: "transparent" }
                    }
                  />
                }
              >
                {anyAnomaly ? "Anomaly" : "In order"}
              </TooltipTrigger>
              <TooltipContent side="top">
                <TooltipBody
                  title="Stage order"
                  bullets={[
                    "Topics ≥ CBs ≥ Articles ≥ Published is the normal funnel.",
                    "Anomaly = a downstream stage exceeds an upstream one.",
                    "Usually means an ingestion mismatch worth checking.",
                  ]}
                />
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  );
}

function StageMini({
  stage,
  label,
  pct,
}: {
  stage: PipelineStage;
  label: string;
  pct: number;
}) {
  const fill = PIPELINE_STAGE_COLORS[stage];
  const barPct = Math.min(pct, 100);
  return (
    <div className="flex items-center gap-1.5 min-w-[140px] flex-1">
      <span className="w-14 shrink-0 font-mono text-[10px] uppercase tracking-wider text-[#909090]">
        {label}
      </span>
      <div className="flex-1 h-1.5 rounded-full bg-[#1f1f1f] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${barPct}%`, backgroundColor: fill, opacity: 0.9 }}
        />
      </div>
      <span className="w-9 shrink-0 text-right font-mono text-[10px] font-semibold tabular-nums text-[#C4BCAA]">
        {Math.round(pct)}%
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Single-client view — status + pod chips + contract window
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<
  string,
  { label: string; fg: string; bg: string }
> = {
  ACTIVE: { label: "Active", fg: "#42CA80", bg: "#1f4d2e" },
  SOON_TO_BE_ACTIVE: { label: "Soon to be active", fg: "#8FB5D9", bg: "#1f3a5a" },
  INACTIVE: { label: "Inactive", fg: "#ED6958", bg: "#5b1e1e" },
  COMPLETED: { label: "Completed", fg: "#CEBCF4", bg: "#3a2452" },
  PAUSED: { label: "Paused", fg: "#F5C542", bg: "#6d4a1e" },
  TBD: { label: "TBD", fg: "#606060", bg: "#1a1a1a" },
};

function statusStyle(raw: string | null | undefined) {
  if (!raw) return STATUS_STYLES.TBD;
  const key = raw.toUpperCase().replace(/\s+/g, "_");
  return STATUS_STYLES[key] ?? { label: raw, fg: "#C4BCAA", bg: "#2a2a2a" };
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

function daysFromNow(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function ClientHeader({ client }: { client: Client }) {
  const style = statusStyle(client.status);
  const daysToEnd = daysFromNow(client.end_date);
  const daysSinceStart = client.start_date ? -1 * (daysFromNow(client.start_date) ?? 0) : null;
  const daysColor =
    daysToEnd === null
      ? "#C4BCAA"
      : daysToEnd < 0
      ? "#ED6958"
      : daysToEnd < 30
      ? "#F5C542"
      : "#42CA80";

  return (
    <div className="rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-xs">
        {/* Status pill */}
        <span
          className="rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: style.fg, backgroundColor: style.bg }}
        >
          {style.label}
        </span>

        {/* Pods */}
        <Field
          label="Editorial Pod"
          value={client.editorial_pod ? displayPod(client.editorial_pod, "editorial") : "—"}
        />
        <Field
          label="Growth Pod"
          value={client.growth_pod ? displayPod(client.growth_pod, "growth") : "—"}
        />

        {/* Contract window */}
        <Field
          label="Contract"
          value={`${fmtDate(client.start_date)} → ${fmtDate(client.end_date)}`}
        />

        {/* Days remaining */}
        {daysToEnd !== null && (
          <Field
            label={daysToEnd >= 0 ? "Remaining" : "Ended"}
            value={
              <span style={{ color: daysColor }} className="tabular-nums font-semibold">
                {Math.abs(daysToEnd)}d{daysToEnd < 0 ? " ago" : ""}
              </span>
            }
          />
        )}

        {/* Elapsed */}
        {daysSinceStart !== null && daysSinceStart >= 0 && (
          <Field label="Elapsed" value={<span className="tabular-nums">{daysSinceStart}d</span>} />
        )}

        {/* SOW */}
        {typeof client.articles_sow === "number" && client.articles_sow > 0 && (
          <Field
            label="SOW"
            value={
              <span className="tabular-nums">
                {client.articles_sow.toLocaleString()} articles
              </span>
            }
          />
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-[#606060]">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}
