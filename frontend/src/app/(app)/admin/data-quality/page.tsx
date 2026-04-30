"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, CalendarClock, Database, RefreshCcw } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGet } from "@/lib/api";

// ─────────────────────────────────────────────────────────────────────────────
// Data Quality dashboard
//
// Surfaces per-client discrepancies that the maintainer should reconcile —
// today the data lives across multiple sheets/tables that the Ops team edits
// independently, so the same metric drifts between sources.
//
// Initial discrepancy types:
//   1. End-date mismatch  → SOW Overview vs Editorial Operating Model
//   2. Delivered drift    → SOW Overview cumulative vs Delivered vs Invoiced v2
//                            per-month sum
//
// Threshold filters (`min_end_date_diff_months=2`, `min_delivered_delta=1`)
// keep ±1-month calendar-rounding noise out of the list.
// ─────────────────────────────────────────────────────────────────────────────

interface EndDateDiscrepancy {
  client_id: number;
  client_name: string;
  status: string;
  sow_end: string;
  ops_end: string;
  diff_months: number;
  direction: "ops_after_sow" | "ops_before_sow";
}

interface DeliveredDriftDiscrepancy {
  client_id: number;
  client_name: string;
  status: string;
  sow_delivered: number;
  monthly_delivered: number;
  delta: number;
}

interface DiscrepanciesResponse {
  end_date_mismatches: EndDateDiscrepancy[];
  delivered_drift: DeliveredDriftDiscrepancy[];
  generated_at: string;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatYM(iso: string): string {
  // ISO date "YYYY-MM-DD" → "Mon yy" without timezone bugs.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTH_SHORT[Number(m[2]) - 1]} ${m[1].slice(-2)}`;
}

function statusPill(status: string) {
  const styles: Record<string, { bg: string; fg: string }> = {
    ACTIVE: { bg: "rgba(66,202,128,0.14)", fg: "#42CA80" },
    SOON_TO_BE_ACTIVE: { bg: "rgba(245,188,78,0.14)", fg: "#F5BC4E" },
    COMPLETED: { bg: "rgba(96,96,96,0.18)", fg: "#909090" },
    CANCELLED: { bg: "rgba(237,105,88,0.14)", fg: "#ED6958" },
    INACTIVE: { bg: "rgba(96,96,96,0.18)", fg: "#909090" },
  };
  const s = styles[status] ?? styles.INACTIVE;
  return (
    <span
      className="inline-flex items-center rounded-sm px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-wider"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {status.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

function severityColor(absMonths: number): string {
  if (absMonths >= 6) return "#ED6958";
  if (absMonths >= 3) return "#F5BC4E";
  return "#909090";
}

function deltaColor(absDelta: number): string {
  if (absDelta >= 100) return "#ED6958";
  if (absDelta >= 20) return "#F5BC4E";
  return "#909090";
}

function EndDateDiscrepancyTab({ rows }: { rows: EndDateDiscrepancy[] }) {
  const [filter, setFilter] = useState<"all" | "active" | "ops_after" | "ops_before">("active");
  const filtered = useMemo(() => {
    let r = rows;
    if (filter === "active") r = r.filter((d) => d.status === "ACTIVE");
    else if (filter === "ops_after") r = r.filter((d) => d.direction === "ops_after_sow");
    else if (filter === "ops_before") r = r.filter((d) => d.direction === "ops_before_sow");
    return r;
  }, [rows, filter]);

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-[#909090] max-w-3xl">
        SOW Overview <code className="text-[#C4BCAA]">end_date</code> vs the
        last month with non-zero production in the Editorial Operating Model.
        <span className="block mt-1">
          <span className="text-[#42CA80]">Ops after SOW</span> usually means a
          renewal was signed but not entered into the SOW Overview yet.{" "}
          <span className="text-[#ED6958]">Ops before SOW</span> means the team
          stopped projecting deliveries before the contract close — often
          silent churn or an overdue status update.
        </span>
        <span className="block mt-1 text-[#606060]">
          ±1-month calendar rounding (SOW end mid-month vs ops end last full
          month) is filtered out automatically.
        </span>
      </p>

      <div className="flex items-center gap-2">
        <FilterChip label={`All · ${rows.length}`} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterChip
          label={`Active only · ${rows.filter((d) => d.status === "ACTIVE").length}`}
          active={filter === "active"}
          onClick={() => setFilter("active")}
        />
        <FilterChip
          label={`Ops after SOW · ${rows.filter((d) => d.direction === "ops_after_sow").length}`}
          active={filter === "ops_after"}
          onClick={() => setFilter("ops_after")}
          icon={<ArrowUpFromLine className="h-3 w-3" />}
        />
        <FilterChip
          label={`Ops before SOW · ${rows.filter((d) => d.direction === "ops_before_sow").length}`}
          active={filter === "ops_before"}
          onClick={() => setFilter("ops_before")}
          icon={<ArrowDownToLine className="h-3 w-3" />}
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
        <table className="w-full border-collapse font-mono text-[12px]">
          <thead className="bg-[#161616] text-[#606060]">
            <tr>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">Client</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">Status</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider">SOW end</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider">Ops end</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider">Δ months</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">Direction</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-[#606060]">
                  No discrepancies match this filter.
                </td>
              </tr>
            ) : (
              filtered.map((d) => (
                <tr key={d.client_id} className="border-t border-[#1a1a1a] hover:bg-[#161616]">
                  <td className="px-3 py-1.5 text-white">{d.client_name}</td>
                  <td className="px-3 py-1.5">{statusPill(d.status)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#C4BCAA]">{formatYM(d.sow_end)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#C4BCAA]">{formatYM(d.ops_end)}</td>
                  <td
                    className="px-3 py-1.5 text-right font-semibold tabular-nums"
                    style={{ color: severityColor(Math.abs(d.diff_months)) }}
                  >
                    {d.diff_months > 0 ? "+" : ""}
                    {d.diff_months}
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className="inline-flex items-center gap-1 text-[11px]"
                      style={{ color: d.direction === "ops_after_sow" ? "#42CA80" : "#ED6958" }}
                    >
                      {d.direction === "ops_after_sow" ? (
                        <ArrowUpFromLine className="h-3 w-3" />
                      ) : (
                        <ArrowDownToLine className="h-3 w-3" />
                      )}
                      {d.direction === "ops_after_sow" ? "Ops after SOW" : "Ops before SOW"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeliveredDriftTab({ rows }: { rows: DeliveredDriftDiscrepancy[] }) {
  const [filter, setFilter] = useState<"all" | "active" | "monthly_higher" | "sow_higher">("active");
  const filtered = useMemo(() => {
    let r = rows;
    if (filter === "active") r = r.filter((d) => d.status === "ACTIVE");
    else if (filter === "monthly_higher") r = r.filter((d) => d.delta > 0);
    else if (filter === "sow_higher") r = r.filter((d) => d.delta < 0);
    return r;
  }, [rows, filter]);

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-[#909090] max-w-3xl">
        <code className="text-[#C4BCAA]">clients.articles_delivered</code>{" "}
        (cumulative from SOW Overview) vs{" "}
        <code className="text-[#C4BCAA]">SUM(deliverables_monthly.articles_delivered)</code>{" "}
        (per-month from Delivered vs Invoiced v2). The dashboards prefer the
        monthly sum, but the SOW Overview cumulative is what maintainers
        update by hand — drift surfaces whenever one side gets edited and the
        other doesn&apos;t.
      </p>

      <div className="flex items-center gap-2">
        <FilterChip label={`All · ${rows.length}`} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterChip
          label={`Active only · ${rows.filter((d) => d.status === "ACTIVE").length}`}
          active={filter === "active"}
          onClick={() => setFilter("active")}
        />
        <FilterChip
          label={`Monthly > SOW · ${rows.filter((d) => d.delta > 0).length}`}
          active={filter === "monthly_higher"}
          onClick={() => setFilter("monthly_higher")}
        />
        <FilterChip
          label={`SOW > Monthly · ${rows.filter((d) => d.delta < 0).length}`}
          active={filter === "sow_higher"}
          onClick={() => setFilter("sow_higher")}
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
        <table className="w-full border-collapse font-mono text-[12px]">
          <thead className="bg-[#161616] text-[#606060]">
            <tr>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">Client</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider">Status</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider">SOW delivered</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider">Monthly Σ delivered</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider">Δ (monthly − SOW)</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-[#606060]">
                  No discrepancies match this filter.
                </td>
              </tr>
            ) : (
              filtered.map((d) => (
                <tr key={d.client_id} className="border-t border-[#1a1a1a] hover:bg-[#161616]">
                  <td className="px-3 py-1.5 text-white">{d.client_name}</td>
                  <td className="px-3 py-1.5">{statusPill(d.status)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#C4BCAA]">
                    {d.sow_delivered.toLocaleString()}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#C4BCAA]">
                    {d.monthly_delivered.toLocaleString()}
                  </td>
                  <td
                    className="px-3 py-1.5 text-right font-semibold tabular-nums"
                    style={{ color: deltaColor(Math.abs(d.delta)) }}
                  >
                    {d.delta > 0 ? "+" : ""}
                    {d.delta.toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors " +
        (active
          ? "border-[#42CA80]/40 bg-[#42CA80]/10 text-[#42CA80]"
          : "border-[#2a2a2a] bg-[#0d0d0d] text-[#909090] hover:text-[#C4BCAA]")
      }
    >
      {icon}
      {label}
    </button>
  );
}

export default function DataQualityPage() {
  const [data, setData] = useState<DiscrepanciesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await apiGet<DiscrepanciesResponse>("/api/admin/discrepancies");
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load discrepancies");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const totalActive = useMemo(() => {
    if (!data) return 0;
    return (
      data.end_date_mismatches.filter((d) => d.status === "ACTIVE").length +
      data.delivered_drift.filter((d) => d.status === "ACTIVE").length
    );
  }, [data]);

  const generatedAt = data?.generated_at
    ? new Date(data.generated_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
            Admin
          </p>
          <h1 className="mt-1 font-mono text-base font-bold uppercase tracking-[0.2em] text-white">
            Data Quality
          </h1>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-[#909090]">
            Per-client discrepancies between source sheets. Each tab is one
            class of drift the maintainer should reconcile — fixing them
            keeps the dashboards honest. The data is read live from the DB
            on every load (no cache).
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {generatedAt && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
              Updated {generatedAt}
            </span>
          )}
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-[#C4BCAA] hover:border-[#42CA80]/40 hover:text-white disabled:opacity-50"
          >
            <RefreshCcw className={"h-3 w-3 " + (loading ? "animate-spin" : "")} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-[#ED6958]/40 bg-[#ED6958]/10 px-3 py-2 font-mono text-[11px] text-[#ED6958]">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-8 text-center font-mono text-[12px] text-[#606060]">
          Loading discrepancies…
        </div>
      ) : data ? (
        <>
          <SummaryRow
            endDateCount={data.end_date_mismatches.length}
            driftCount={data.delivered_drift.length}
            activeCount={totalActive}
          />

          <Tabs defaultValue="end_date">
            <TabsList variant="line">
              <TabsTrigger
                value="end_date"
                className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
              >
                <CalendarClock className="mr-2 inline-block h-3.5 w-3.5" />
                End-date mismatch ({data.end_date_mismatches.length})
              </TabsTrigger>
              <TabsTrigger
                value="delivered"
                className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
              >
                <Database className="mr-2 inline-block h-3.5 w-3.5" />
                Delivered drift ({data.delivered_drift.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="end_date" className="mt-4">
              <EndDateDiscrepancyTab rows={data.end_date_mismatches} />
            </TabsContent>
            <TabsContent value="delivered" className="mt-4">
              <DeliveredDriftTab rows={data.delivered_drift} />
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  );
}

function SummaryRow({
  endDateCount,
  driftCount,
  activeCount,
}: {
  endDateCount: number;
  driftCount: number;
  activeCount: number;
}) {
  const total = endDateCount + driftCount;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <SummaryCard
        label="Total discrepancies"
        value={total}
        icon={<AlertTriangle className="h-3.5 w-3.5" />}
        color={total > 0 ? "#F5BC4E" : "#42CA80"}
      />
      <SummaryCard
        label="On active clients"
        value={activeCount}
        icon={<AlertTriangle className="h-3.5 w-3.5" />}
        color={activeCount > 0 ? "#ED6958" : "#42CA80"}
        helper="Reconcile these first"
      />
      <SummaryCard
        label="By type"
        value=""
        helper={`${endDateCount} end-date · ${driftCount} delivered`}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  helper,
  icon,
  color = "#C4BCAA",
}: {
  label: string;
  value: number | string;
  helper?: string;
  icon?: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-3">
      <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[#606060]">
        {icon}
        {label}
      </p>
      {value !== "" && (
        <p className="mt-1 font-mono text-2xl font-bold tabular-nums" style={{ color }}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
      )}
      {helper && (
        <p className={(value !== "" ? "mt-0.5" : "mt-1") + " font-mono text-[11px] text-[#909090]"}>
          {helper}
        </p>
      )}
    </div>
  );
}
