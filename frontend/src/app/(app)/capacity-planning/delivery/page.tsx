"use client";

import { useMemo, useState } from "react";
import { Info, TrendingDown, TrendingUp } from "lucide-react";
import { StickyPageChrome } from "../_StickyPageChrome";
import { ClosedMonthBanner } from "../_MonthActions";
import { useCP2Store, monthLabel, monthRange } from "../_store";

type Column = "articlesSowTarget" | "articlesDelivered" | "articlesInvoiced" | "articlesPaid" | "contentBriefsDelivered" | "contentBriefsGoal";

const COL_LABEL: Record<Column, string> = {
  articlesSowTarget: "SOW target",
  articlesDelivered: "Delivered",
  articlesInvoiced: "Invoiced",
  articlesPaid: "Paid",
  contentBriefsDelivered: "CB delivered",
  contentBriefsGoal: "CB goal",
};

const COL_TONE: Record<Column, string> = {
  articlesSowTarget: "text-[#C4BCAA]",
  articlesDelivered: "text-white",
  articlesInvoiced: "text-[#8EB0FF]",
  articlesPaid: "text-[#65FFAA]",
  contentBriefsDelivered: "text-white",
  contentBriefsGoal: "text-[#C4BCAA]",
};

export default function DeliveryPage() {
  const { dims, selectedMonth, deliveryMonthly, upsertDelivery, isMonthClosed } = useCP2Store();
  const closed = isMonthClosed(selectedMonth);

  const [selectedClient, setSelectedClient] = useState<number | "all">("all");

  // Show 7 months centered on selected.
  const months = useMemo(() => monthRange(selectedMonth, 3, 3), [selectedMonth]);

  // Active clients only
  const clients = useMemo(
    () => dims.clients.filter((c) => c.is_active_in_cp2).sort((a, b) => a.id - b.id),
    [dims.clients],
  );

  const visibleClients = useMemo(
    () => (selectedClient === "all" ? clients : clients.filter((c) => c.id === selectedClient)),
    [clients, selectedClient],
  );

  const rowFor = (clientId: number, monthKey: string) =>
    deliveryMonthly.find((r) => r.clientId === clientId && r.monthKey === monthKey);

  // Rollups for cards
  const selectedRow = useMemo(() => {
    const rows = deliveryMonthly.filter((r) => r.monthKey === selectedMonth);
    return rows.reduce(
      (acc, r) => ({
        target: acc.target + r.articlesSowTarget,
        delivered: acc.delivered + r.articlesDelivered,
        invoiced: acc.invoiced + r.articlesInvoiced,
        paid: acc.paid + r.articlesPaid,
        cbDelivered: acc.cbDelivered + r.contentBriefsDelivered,
        cbGoal: acc.cbGoal + r.contentBriefsGoal,
      }),
      { target: 0, delivered: 0, invoiced: 0, paid: 0, cbDelivered: 0, cbGoal: 0 },
    );
  }, [deliveryMonthly, selectedMonth]);

  const deliveredPct = selectedRow.target > 0 ? Math.round((selectedRow.delivered / selectedRow.target) * 100) : 0;
  const cbPct = selectedRow.cbGoal > 0 ? Math.round((selectedRow.cbDelivered / selectedRow.cbGoal) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <StickyPageChrome subtitle="Client × month delivery grid. Edit inline; totals update live. Columns: SOW target → delivered → invoiced → paid plus CB delivered vs CB goal. Feeds cp2_fact_delivery_monthly." />
      <ClosedMonthBanner />

      {/* Rollup cards for the selected month */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <RollupCard label="SOW target" value={selectedRow.target} subtitle={`${visibleClients.length} clients`} />
        <RollupCard
          label="Delivered"
          value={selectedRow.delivered}
          subtitle={`${deliveredPct}% of target`}
          tone={deliveredPct >= 100 ? "green" : deliveredPct >= 90 ? "yellow" : "red"}
        />
        <RollupCard label="Invoiced" value={selectedRow.invoiced} subtitle={`${selectedRow.delivered - selectedRow.invoiced} not invoiced`} tone="blue" />
        <RollupCard
          label="CB delivered"
          value={selectedRow.cbDelivered}
          subtitle={`${cbPct}% of CB goal`}
          tone={cbPct >= 100 ? "green" : cbPct >= 90 ? "yellow" : "red"}
        />
      </div>

      {/* Client filter */}
      <div className="flex items-center gap-2 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-[#606060]">
        <span>Client</span>
        <select
          value={selectedClient === "all" ? "all" : String(selectedClient)}
          onChange={(e) =>
            setSelectedClient(e.target.value === "all" ? "all" : parseInt(e.target.value, 10))
          }
          className="h-6 rounded border border-[#2a2a2a] bg-[#161616] px-2 font-sans text-xs text-white focus:border-[#42CA80]/50 focus:outline-none"
        >
          <option value="all">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · #{c.client_id_fk}
            </option>
          ))}
        </select>
        <span className="ml-auto">{months.length} months shown · {visibleClients.length} clients</span>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto rounded-lg border border-[#1f1f1f] bg-[#0a0a0a]">
        <table className="w-full min-w-[1100px] border-collapse font-mono text-[11px]">
          <thead>
            <tr className="border-b border-[#1a1a1a] bg-[#050505]">
              <th className="sticky left-0 z-10 bg-[#050505] px-3 py-2 text-left text-[10px] uppercase tracking-wider text-[#606060]">
                Client
              </th>
              <th className="px-2 py-2 text-left text-[10px] uppercase tracking-wider text-[#606060]">
                Metric
              </th>
              {months.map((m) => (
                <th
                  key={m}
                  className={`px-2 py-2 text-center text-[10px] uppercase tracking-wider ${m === selectedMonth ? "bg-[#42CA80]/10 text-[#65FFAA]" : "text-[#606060]"}`}
                >
                  {monthLabel(m)}
                </th>
              ))}
              <th className="px-2 py-2 text-right text-[10px] uppercase tracking-wider text-[#606060]">
                Row total
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleClients.map((client, idx) => (
              <ClientRowGroup
                key={client.id}
                client={client}
                months={months}
                selectedMonth={selectedMonth}
                rowFor={rowFor}
                onChange={(monthKey, col, value) =>
                  upsertDelivery(monthKey, client.id, { [col]: value })
                }
                disabled={closed}
                striped={idx % 2 === 0}
              />
            ))}
            {visibleClients.length === 0 && (
              <tr>
                <td colSpan={months.length + 3} className="px-4 py-6 text-center text-xs text-[#606060]">
                  No active clients — add some via Admin → Clients.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3 text-[11px] text-[#C4BCAA]">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#42CA80]" />
        <span>
          Inline edits flow into <span className="font-mono text-[#65FFAA]">cp2_fact_delivery_monthly</span>. The
          Editorial Clients dashboard reads the same rows. <b>Variance</b> = delivered − SOW target, computed at read time.
        </span>
      </div>
    </div>
  );
}

function ClientRowGroup({
  client,
  months,
  selectedMonth,
  rowFor,
  onChange,
  disabled,
  striped,
}: {
  client: { id: number; name: string; sow_articles_total: number; status: string };
  months: string[];
  selectedMonth: string;
  rowFor: (clientId: number, monthKey: string) => { articlesSowTarget: number; articlesDelivered: number; articlesInvoiced: number; articlesPaid: number; contentBriefsDelivered: number; contentBriefsGoal: number; articlesProjected: number | null } | undefined;
  onChange: (monthKey: string, col: Column, value: number) => void;
  disabled: boolean;
  striped: boolean;
}) {
  const metrics: Column[] = [
    "articlesSowTarget",
    "articlesDelivered",
    "articlesInvoiced",
    "articlesPaid",
    "contentBriefsDelivered",
    "contentBriefsGoal",
  ];

  const rowTotal = (col: Column) =>
    months.reduce((s, m) => {
      const r = rowFor(client.id, m);
      const v = r ? (r[col] ?? 0) : 0;
      return s + (typeof v === "number" ? v : 0);
    }, 0);

  const bgClass = striped ? "bg-[#0a0a0a]" : "bg-[#0c0c0c]";

  return (
    <>
      {metrics.map((col, mi) => (
        <tr
          key={`${client.id}-${col}`}
          className={`${bgClass} ${mi === 0 ? "border-t-2 border-[#1a1a1a]" : "border-t border-[#111]"}`}
        >
          {mi === 0 ? (
            <td
              rowSpan={metrics.length}
              className={`sticky left-0 z-10 ${bgClass} align-top px-3 py-2 font-sans text-xs`}
            >
              <div className="font-semibold text-white">{client.name}</div>
              <div className="mt-0.5 font-mono text-[10px] text-[#606060]">
                SOW {client.sow_articles_total} · {client.status}
              </div>
            </td>
          ) : null}
          <td className={`px-2 py-1.5 text-[10px] uppercase tracking-wider ${COL_TONE[col]}`}>
            {COL_LABEL[col]}
          </td>
          {months.map((m) => {
            const r = rowFor(client.id, m);
            const value = r ? (r[col] ?? 0) : 0;
            const isSelected = m === selectedMonth;

            let tone = "";
            if (col === "articlesDelivered" && r) {
              const pct = r.articlesSowTarget > 0 ? value / r.articlesSowTarget : 0;
              tone = pct >= 1 ? "text-[#65FFAA]" : pct < 0.9 ? "text-[#ED6958]" : "text-[#F5C542]";
            }

            return (
              <td
                key={m}
                className={`px-1 py-1 text-center ${isSelected ? "bg-[#42CA80]/5" : ""}`}
              >
                <input
                  type="number"
                  min={0}
                  value={value}
                  disabled={disabled}
                  onChange={(e) => onChange(m, col, parseInt(e.target.value || "0", 10))}
                  className={`h-7 w-16 rounded border border-[#2a2a2a] bg-[#161616] px-1 text-center font-mono text-[11px] outline-none focus:border-[#42CA80]/50 ${tone || "text-white"}`}
                />
              </td>
            );
          })}
          <td className={`px-2 py-1.5 text-right font-semibold ${COL_TONE[col]}`}>
            {rowTotal(col)}
          </td>
        </tr>
      ))}
    </>
  );
}

function RollupCard({
  label,
  value,
  subtitle,
  tone,
}: {
  label: string;
  value: number;
  subtitle: string;
  tone?: "green" | "yellow" | "red" | "blue";
}) {
  const Icon = tone === "green" ? TrendingUp : tone === "red" ? TrendingDown : null;
  const color = tone === "green"
    ? "text-[#65FFAA]"
    : tone === "red"
      ? "text-[#ED6958]"
      : tone === "yellow"
        ? "text-[#F5C542]"
        : tone === "blue"
          ? "text-[#8EB0FF]"
          : "text-white";
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-4 py-3">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className={`font-mono text-xl font-semibold ${color}`}>{value.toLocaleString()}</span>
        {Icon && <Icon className={`h-3.5 w-3.5 ${color}`} />}
      </div>
      <span className="font-mono text-[10px] text-[#606060]">{subtitle}</span>
    </div>
  );
}
