"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { StickyPageChrome } from "../_StickyPageChrome";
import { useCP2Store, type DimClient, type DimMember } from "../_store";
import { apiGet } from "@/lib/api";

type MappingRow = {
  label: string;
  source: string;
  sourcePath: string;
  target: string;
  cp2Count: () => number;
};

type FetchState = {
  loading: boolean;
  count: number | null;
  error: string | null;
};

export default function MigrationPage() {
  const { dims, weeklyActuals, overrides, leaves, state, addDimRow } = useCP2Store();

  const mapping: MappingRow[] = [
    {
      label: "Clients",
      source: "clients",
      sourcePath: "/api/clients/",
      target: "cp2_dim_client",
      cp2Count: () => dims.clients.length,
    },
    {
      label: "Team members",
      source: "team_members",
      sourcePath: "/api/team-members/",
      target: "cp2_dim_team_member",
      cp2Count: () => dims.members.length,
    },
    {
      label: "Capacity projections",
      source: "capacity_projections",
      sourcePath: "/api/capacity/",
      target: "cp2_fact_pod_membership + allocation",
      cp2Count: () =>
        Object.values(state.monthly).reduce(
          (sum, pods) =>
            sum +
            pods.reduce(
              (s, p) => s + p.members.length + p.clients.length,
              0,
            ),
          0,
        ),
    },
    {
      label: "Deliverables (monthly)",
      source: "deliverables_monthly",
      sourcePath: "/api/deliverables/",
      target: "cp2_fact_delivery_monthly",
      cp2Count: () => 0, // not materialised in the prototype store
    },
    {
      label: "KPI scores (monthly)",
      source: "kpi_scores",
      sourcePath: "/api/kpis/",
      target: "cp2_fact_kpi_score",
      cp2Count: () => 0,
    },
    {
      label: "Notion articles",
      source: "notion_articles",
      sourcePath: "/api/notion-articles/",
      target: "cp2_fact_article",
      cp2Count: () => 0,
    },
    {
      label: "AI Monitoring",
      source: "ai_monitoring_records",
      sourcePath: "/api/ai-monitoring/flags",
      target: "cp2_fact_ai_scan",
      cp2Count: () => 0,
    },
    {
      label: "Goals vs Delivery (weekly)",
      source: "goals_vs_delivery",
      sourcePath: "/api/goals-delivery/",
      target: "cp2_fact_actuals_weekly",
      cp2Count: () => Object.values(weeklyActuals).flat().length,
    },
    {
      label: "Capacity overrides",
      source: "(not tracked today)",
      sourcePath: "",
      target: "cp2_fact_capacity_override",
      cp2Count: () => Object.values(overrides).flat().length,
    },
    {
      label: "Member leave",
      source: "(not tracked today)",
      sourcePath: "",
      target: "cp2_fact_member_leave",
      cp2Count: () => Object.values(leaves).flat().length,
    },
  ];

  const [counts, setCounts] = useState<Record<string, FetchState>>(() => {
    const init: Record<string, FetchState> = {};
    for (const row of mapping) init[row.source] = { loading: false, count: null, error: null };
    return init;
  });
  const [populating, setPopulating] = useState(false);
  const [populateLog, setPopulateLog] = useState<string[]>([]);

  const refreshCounts = useCallback(async () => {
    for (const row of mapping) {
      if (!row.sourcePath) continue;
      setCounts((c) => ({ ...c, [row.source]: { loading: true, count: null, error: null } }));
      try {
        const data = await apiGet<unknown>(row.sourcePath);
        const count = Array.isArray(data)
          ? data.length
          : Array.isArray((data as { items?: unknown[] })?.items)
            ? (data as { items: unknown[] }).items.length
            : null;
        setCounts((c) => ({
          ...c,
          [row.source]: { loading: false, count, error: count === null ? "not an array" : null },
        }));
      } catch (err) {
        setCounts((c) => ({
          ...c,
          [row.source]: {
            loading: false,
            count: null,
            error: err instanceof Error ? err.message : "fetch failed",
          },
        }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);

  const dryRunPopulate = useCallback(async () => {
    setPopulating(true);
    const log: string[] = [];

    try {
      // Pull real clients and map the ones not yet in dims.clients into cp2 shape.
      type RawClient = {
        id: number;
        name?: string;
        domain?: string;
        status?: string;
        growth_pod?: string;
        editorial_pod?: string;
        articles_sow?: number;
        articles_per_month?: number;
        cadence?: string;
        start_date?: string;
        end_date?: string;
        term_months?: number;
      };
      const clients = await apiGet<RawClient[]>("/api/clients/");
      const existingIds = new Set(dims.clients.map((c) => c.client_id_fk));
      let addedClients = 0;
      for (const c of clients) {
        if (existingIds.has(c.id)) continue;
        const row: Omit<DimClient, "id"> = {
          client_id_fk: c.id,
          name: c.name ?? `Client #${c.id}`,
          domain: c.domain ?? null,
          status: (c.status as DimClient["status"]) ?? "ACTIVE",
          growth_pod: c.growth_pod ?? null,
          editorial_pod: c.editorial_pod ?? null,
          engagement_tier_id: null,
          project_type: null,
          cadence: (c.cadence as DimClient["cadence"]) ?? "monthly",
          cadence_q1: null,
          cadence_q2: null,
          cadence_q3: null,
          cadence_q4: null,
          term_months: c.term_months ?? null,
          sow_articles_total: c.articles_sow ?? 0,
          sow_articles_per_month: c.articles_per_month ?? 0,
          word_count_min: null,
          word_count_max: null,
          sow_link: null,
          contract_start: c.start_date ?? "",
          contract_end: c.end_date ?? "",
          consulting_ko_date: null,
          editorial_ko_date: null,
          first_cb_approved_date: null,
          first_article_delivered_date: null,
          first_feedback_date: null,
          first_article_published_date: null,
          managing_director: null,
          account_director: null,
          account_manager: null,
          jr_am: null,
          cs_team: null,
          articles_delivered: 0,
          articles_invoiced: 0,
          articles_paid: 0,
          is_active_in_cp2: true,
          comments: null,
        };
        addDimRow("clients", row);
        addedClients += 1;
      }
      log.push(`✓ Added ${addedClients} clients into cp2_dim_client`);
    } catch (err) {
      log.push(`✗ Clients: ${err instanceof Error ? err.message : "failed"}`);
    }

    try {
      type RawMember = {
        id: number;
        name?: string;
        full_name?: string;
        email?: string;
        role?: string;
        monthly_capacity?: number;
      };
      const members = await apiGet<RawMember[]>("/api/team-members/");
      const existingIds = new Set(dims.members.map((m) => m.id));
      let addedMembers = 0;
      for (const m of members) {
        if (existingIds.has(m.id)) continue;
        const row: Omit<DimMember, "id"> = {
          full_name: m.full_name ?? m.name ?? `Member ${m.id}`,
          email: m.email ?? "",
          role_default: (m.role as DimMember["role_default"]) ?? "ED",
          default_monthly_capacity_articles: m.monthly_capacity ?? 10,
          start_month: new Date().toISOString().slice(0, 10),
          end_month: null,
          is_active: true,
          notes: "imported via dry-run",
        };
        addDimRow("members", row);
        addedMembers += 1;
      }
      log.push(`✓ Added ${addedMembers} members into cp2_dim_team_member`);
    } catch (err) {
      log.push(`✗ Members: ${err instanceof Error ? err.message : "failed"}`);
    }

    log.push("— dry-run complete. Review Admin → Members/Clients to confirm.");
    setPopulateLog(log);
    setPopulating(false);
    await refreshCounts();
  }, [addDimRow, dims.clients, dims.members, refreshCounts]);

  const allChecked = mapping.every((m) => {
    const c = counts[m.source];
    return !c || !c.loading;
  });
  const anyError = mapping.some(
    (m) => m.sourcePath && counts[m.source]?.error,
  );

  return (
    <div className="flex flex-col gap-6">
      <StickyPageChrome subtitle="Dry-run migration validator. Checks live source counts vs what's in the proposal store. Nothing here writes to the production schema — cp2_* doesn't exist as SQL tables yet." />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#606060]">
          {mapping.length} source ↔ target pairs
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refreshCounts}
            disabled={!allChecked}
            className="flex items-center gap-1.5 rounded-md border border-[#2a2a2a] bg-[#161616] px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider text-[#C4BCAA] hover:border-[#42CA80]/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${!allChecked ? "animate-spin" : ""}`} />
            Recheck counts
          </button>
          <button
            type="button"
            onClick={dryRunPopulate}
            disabled={populating}
            className="flex items-center gap-1.5 rounded-md border border-[#42CA80]/40 bg-[#42CA80]/10 px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider text-[#65FFAA] hover:bg-[#42CA80]/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {populating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Dry-run populate
          </button>
        </div>
      </div>

      {/* Mapping table */}
      <div className="overflow-hidden rounded-lg border border-[#1f1f1f] bg-[#0a0a0a]">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[#1a1a1a] bg-[#050505] font-mono text-[10px] uppercase tracking-wider text-[#606060]">
              <th className="px-4 py-2 text-left">Source (today)</th>
              <th className="px-3 py-2 text-right">Source rows</th>
              <th className="px-3 py-2 text-left">→ cp2 target</th>
              <th className="px-3 py-2 text-right">cp2 rows</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {mapping.map((row) => {
              const fetchState = counts[row.source];
              const cp2 = row.cp2Count();
              const src = fetchState?.count ?? null;
              const status = statusFor({ src, cp2, hasSource: !!row.sourcePath, error: fetchState?.error ?? null });
              return (
                <tr
                  key={row.source}
                  className="border-b border-[#161616] last:border-0 hover:bg-[#111111]"
                >
                  <td className="px-4 py-2 text-xs">
                    <span className="font-medium text-white">{row.label}</span>
                    <span className="ml-2 font-mono text-[10px] text-[#606060]">
                      {row.source}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[11px] text-[#C4BCAA]">
                    {!row.sourcePath ? (
                      <span className="text-[#606060]">n/a</span>
                    ) : fetchState?.loading ? (
                      <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-[#606060]" />
                    ) : fetchState?.error ? (
                      <span className="text-[#ED6958]" title={fetchState.error}>
                        error
                      </span>
                    ) : src != null ? (
                      src.toLocaleString()
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-[#65FFAA]">
                    {row.target}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[11px] text-[#C4BCAA]">
                    {cp2.toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Populate log */}
      {populateLog.length > 0 && (
        <div className="rounded-lg border border-[#1f1f1f] bg-[#050505] px-4 py-3 font-mono text-[11px] text-[#C4BCAA]">
          <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#606060]">
            <Database className="h-3.5 w-3.5" />
            Dry-run log
          </div>
          <ul className="space-y-0.5">
            {populateLog.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Approval gate */}
      <div
        className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-xs ${
          anyError
            ? "border-[#ED6958]/30 bg-[#ED6958]/5 text-[#ED6958]"
            : "border-[#42CA80]/30 bg-[#42CA80]/5 text-[#65FFAA]"
        }`}
      >
        {anyError ? (
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        ) : (
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        )}
        <div className="flex flex-col gap-1">
          <span className="font-medium">
            {anyError ? "Not ready to promote" : "Validator green — ready for cutover planning"}
          </span>
          <span className="text-[#C4BCAA]">
            Promotion to the production <span className="font-mono text-[#65FFAA]">cp2_*</span>{" "}
            schema is gated on (a) a clean validator, (b) product sign-off, and (c) the real
            Alembic migrations. This page only runs dry-runs.
          </span>
          <button
            type="button"
            disabled
            title="Blocked — backend migrations not yet applied"
            className="mt-1 inline-flex w-fit cursor-not-allowed items-center gap-1.5 rounded-md border border-[#2a2a2a] bg-[#161616] px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-[#606060]"
          >
            <CheckCircle2 className="h-3 w-3" />
            Promote to production (disabled)
          </button>
        </div>
      </div>
    </div>
  );
}

type Status = "ready" | "partial" | "unmapped" | "error" | "empty";

function statusFor({
  src,
  cp2,
  hasSource,
  error,
}: {
  src: number | null;
  cp2: number;
  hasSource: boolean;
  error: string | null;
}): Status {
  if (!hasSource) return "unmapped";
  if (error) return "error";
  if (src === null) return "empty";
  if (src === 0 && cp2 === 0) return "empty";
  if (cp2 === 0) return "partial";
  if (cp2 >= src) return "ready";
  return "partial";
}

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { label: string; tone: string }> = {
    ready: { label: "Ready", tone: "border-[#42CA80]/40 bg-[#42CA80]/10 text-[#65FFAA]" },
    partial: { label: "Partial", tone: "border-[#F5C542]/40 bg-[#F5C542]/10 text-[#F5C542]" },
    unmapped: { label: "Out-of-scope", tone: "border-[#333] bg-[#161616] text-[#C4BCAA]" },
    error: { label: "Error", tone: "border-[#ED6958]/40 bg-[#ED6958]/10 text-[#ED6958]" },
    empty: { label: "Empty", tone: "border-[#2a2a2a] bg-[#161616] text-[#606060]" },
  };
  const cfg = map[status];
  return (
    <span
      className={`inline-flex rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${cfg.tone}`}
    >
      {cfg.label}
    </span>
  );
}
