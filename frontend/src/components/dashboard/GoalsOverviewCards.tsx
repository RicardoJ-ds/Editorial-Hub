"use client";

import React, { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { ClientStatusCard } from "./FilterContextCard";
import { displayPod } from "./shared-helpers";
import { normalizePod } from "./ContractClientProgress";
import type { Client } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Scope-aware Goals vs Delivery overview cards.
//
//   • single client    → client status + their CBs / Articles / avg
//   • single pod       → pod goal totals + clients on-track in that pod
//   • all / multi-pod  → portfolio triage signals (drops cumulative sums:
//                        sums across all pods aren't actionable on their own).
//
// On-track rule everywhere: cumulative cb_pct ≥ 75% AND cumulative ad_pct ≥ 75%
// over the active date range. Same denominators the goals table column uses,
// so the card / table / gauges can't disagree.
// ─────────────────────────────────────────────────────────────────────────────

export interface ClientGoalAgg {
  client: string;
  cbGoal: number;
  cbDel: number;
  adGoal: number;
  adDel: number;
}

interface Props {
  filteredClients: Client[];
  perClient: Map<string, ClientGoalAgg>;
  /** Aggregate sums for the active scope (already client-deduped). */
  totals: {
    cbGoal: number;
    cbDel: number;
    adGoal: number;
    adDel: number;
  };
  /** "As of …" label for the section header — derived from latest (month, week). */
  asOfLabel: string | null;
}

type Tier = "on-track" | "behind" | "at-risk";

const TIER_STYLE: Record<Tier, { label: string; color: string; bg: string }> = {
  "on-track": { label: "On Track", color: "#42CA80", bg: "rgba(66,202,128,0.12)" },
  behind: { label: "Behind", color: "#F5C542", bg: "rgba(245,197,66,0.12)" },
  "at-risk": { label: "At Risk", color: "#ED6958", bg: "rgba(237,105,88,0.12)" },
};

const TIER_ORDER: Tier[] = ["at-risk", "behind", "on-track"];

const CARD_TRANSITION = { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const };

function tierFor(cbPct: number | null, adPct: number | null): Tier | null {
  if (cbPct === null && adPct === null) return null;
  // Use the worse of the two when both are measurable; otherwise the lone
  // measurable side. Mirrors the "both must clear 75%" rule.
  const candidates = [cbPct, adPct].filter((x): x is number => x !== null);
  if (candidates.length === 0) return null;
  const worst = Math.min(...candidates);
  if (worst >= 75) return "on-track";
  if (worst >= 50) return "behind";
  return "at-risk";
}

function clientPcts(c: ClientGoalAgg) {
  return {
    cbPct: c.cbGoal > 0 ? (c.cbDel / c.cbGoal) * 100 : null,
    adPct: c.adGoal > 0 ? (c.adDel / c.adGoal) * 100 : null,
  };
}

export function GoalsOverviewCards({
  filteredClients,
  perClient,
  totals,
  asOfLabel,
}: Props) {
  const scope = useMemo(() => detectScope(filteredClients), [filteredClients]);
  const cards = useMemo(
    () => buildCards(scope, perClient, totals, asOfLabel),
    [scope, perClient, totals, asOfLabel],
  );

  return (
    <motion.div
      layout
      transition={CARD_TRANSITION}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {cards.map(({ key, node }) => (
          <motion.div
            key={key}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={CARD_TRANSITION}
          >
            {node}
          </motion.div>
        ))}
      </AnimatePresence>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

type Scope =
  | { kind: "client"; client: Client }
  | { kind: "pod"; pod: string; clients: Client[] }
  | { kind: "portfolio"; clients: Client[] };

function detectScope(filteredClients: Client[]): Scope {
  if (filteredClients.length === 1) {
    return { kind: "client", client: filteredClients[0] };
  }
  const pods = new Set(
    filteredClients.map((c) =>
      c.editorial_pod ? normalizePod(c.editorial_pod) : "Unassigned",
    ),
  );
  if (filteredClients.length > 1 && pods.size === 1) {
    return {
      kind: "pod",
      pod: Array.from(pods)[0],
      clients: filteredClients,
    };
  }
  return { kind: "portfolio", clients: filteredClients };
}

function buildCards(
  scope: Scope,
  perClient: Map<string, ClientGoalAgg>,
  totals: Props["totals"],
  asOfLabel: string | null,
): { key: string; node: React.ReactNode }[] {
  if (scope.kind === "client") {
    const c = scope.client;
    const datum = perClient.get(c.name);
    if (!datum) {
      return [{ key: "client-status", node: <ClientStatusCard client={c} /> }];
    }
    const { cbPct, adPct } = clientPcts(datum);
    const tier = tierFor(cbPct, adPct);
    return [
      { key: "client-status", node: <ClientStatusCard client={c} /> },
      {
        key: "client-cb",
        node: (
          <RatioCard
            title="CBs Delivered ÷ Goal"
            current={datum.cbDel}
            target={datum.cbGoal}
            asOfLabel={asOfLabel}
          />
        ),
      },
      {
        key: "client-ad",
        node: (
          <RatioCard
            title="Articles Delivered ÷ Goal"
            current={datum.adDel}
            target={datum.adGoal}
            asOfLabel={asOfLabel}
          />
        ),
      },
      {
        key: "client-tier",
        node: <ClientStatusTierCard tier={tier} cbPct={cbPct} adPct={adPct} />,
      },
    ];
  }

  if (scope.kind === "pod") {
    const podLabel = displayPod(scope.pod, "editorial");
    const podClientNames = new Set(scope.clients.map((c) => c.name));
    const podClients: ClientGoalAgg[] = [];
    for (const [name, datum] of perClient) {
      if (podClientNames.has(name)) podClients.push(datum);
    }

    const totDelCb = podClients.reduce((a, c) => a + c.cbDel, 0);
    const totGoalCb = podClients.reduce((a, c) => a + c.cbGoal, 0);
    const totDelAd = podClients.reduce((a, c) => a + c.adDel, 0);
    const totGoalAd = podClients.reduce((a, c) => a + c.adGoal, 0);
    return [
      {
        key: "pod-mix",
        node: (
          <GoalStatusMixCard
            clients={podClients}
            subtitle={`${podLabel} · ${podClients.length} clients`}
            asOfLabel={asOfLabel}
          />
        ),
      },
      {
        key: "pod-cb",
        node: (
          <RatioCard
            title="CBs Delivered ÷ Goal"
            current={totDelCb}
            target={totGoalCb}
            asOfLabel={asOfLabel}
          />
        ),
      },
      {
        key: "pod-ad",
        node: (
          <RatioCard
            title="Articles Delivered ÷ Goal"
            current={totDelAd}
            target={totGoalAd}
            asOfLabel={asOfLabel}
          />
        ),
      },
      {
        key: "pod-on-track",
        node: <ClientsOnTrackCard clients={podClients} subtitle={podLabel} />,
      },
    ];
  }

  // portfolio
  const allClients = Array.from(perClient.values());
  return [
    {
      key: "port-mix",
      node: (
        <GoalStatusMixCard
          clients={allClients}
          subtitle={`${allClients.length} clients`}
          asOfLabel={asOfLabel}
        />
      ),
    },
    {
      key: "port-most-behind",
      node: <MostBehindCard clients={allClients} />,
    },
    {
      key: "port-pod-attn",
      node: (
        <PodAttentionCard
          perClient={perClient}
          filteredClients={[]} // filled later for pod lookup
        />
      ),
    },
    {
      key: "port-on-track",
      node: <ClientsOnTrackCard clients={allClients} subtitle="Across portfolio" />,
    },
  ];
  // Note: the portfolio Avg Achievement card lives inline as a 5th slot if/when
  // we decide to grow this row. With 4 columns and the layouts above, four
  // cards fits the visual rhythm of the rest of the dashboard.
  void totals;
}

// ─────────────────────────────────────────────────────────────────────────────
// Card components
// ─────────────────────────────────────────────────────────────────────────────

function ratioColor(pct: number | null): string {
  if (pct === null) return "#606060";
  if (pct >= 75) return "#42CA80";
  if (pct >= 50) return "#F5C542";
  return "#ED6958";
}

function RatioCard({
  title,
  current,
  target,
  asOfLabel,
}: {
  title: string;
  current: number;
  target: number;
  asOfLabel: string | null;
}) {
  const pct = target > 0 ? Math.round((current / target) * 100) : null;
  const color = ratioColor(pct);
  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#C4BCAA]">
          {title}
        </p>
        {asOfLabel && (
          <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
            {asOfLabel}
          </p>
        )}
        <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-white">
          {current.toLocaleString()}
          <span className="text-[#606060] font-normal"> / {target.toLocaleString()}</span>
        </p>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-[#1f1f1f] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${pct === null ? 0 : Math.min(pct, 100)}%`,
                backgroundColor: color,
              }}
            />
          </div>
          <span
            className="font-mono text-[11px] font-semibold tabular-nums"
            style={{ color }}
          >
            {pct === null ? "—" : `${pct}%`}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function ClientStatusTierCard({
  tier,
  cbPct,
  adPct,
}: {
  tier: Tier | null;
  cbPct: number | null;
  adPct: number | null;
}) {
  const style = tier ? TIER_STYLE[tier] : null;
  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#C4BCAA]">
          Goal Status
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          Worse-of-two against threshold
        </p>
        <p
          className="mt-1.5 font-mono text-2xl font-bold tabular-nums"
          style={{ color: style?.color ?? "#606060" }}
        >
          {style?.label ?? "—"}
        </p>
        <div className="mt-1.5 grid grid-cols-2 gap-2 font-mono text-[11px]">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-wider text-[#606060]">CBs</span>
            <span
              className="tabular-nums font-semibold"
              style={{ color: ratioColor(cbPct) }}
            >
              {cbPct === null ? "—" : `${Math.round(cbPct)}%`}
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-wider text-[#606060]">Articles</span>
            <span
              className="tabular-nums font-semibold"
              style={{ color: ratioColor(adPct) }}
            >
              {adPct === null ? "—" : `${Math.round(adPct)}%`}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function GoalStatusMixCard({
  clients,
  subtitle,
  asOfLabel,
}: {
  clients: ClientGoalAgg[];
  subtitle: string;
  asOfLabel: string | null;
}) {
  const counts: Record<Tier, number> = { "on-track": 0, behind: 0, "at-risk": 0 };
  let withGoal = 0;
  let totalCbDel = 0;
  let totalCbGoal = 0;
  let totalAdDel = 0;
  let totalAdGoal = 0;
  for (const c of clients) {
    if (c.cbGoal === 0 && c.adGoal === 0) continue;
    withGoal += 1;
    totalCbDel += c.cbDel;
    totalCbGoal += c.cbGoal;
    totalAdDel += c.adDel;
    totalAdGoal += c.adGoal;
    const { cbPct, adPct } = clientPcts(c);
    const tier = tierFor(cbPct, adPct);
    if (tier) counts[tier] += 1;
  }
  const cbPct = totalCbGoal > 0 ? Math.round((totalCbDel / totalCbGoal) * 100) : 0;
  const adPct = totalAdGoal > 0 ? Math.round((totalAdDel / totalAdGoal) * 100) : 0;
  const avg = Math.round((cbPct + adPct) / 2);
  const headlineColor = ratioColor(avg);

  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#C4BCAA]">
          Goal Status
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          {subtitle}
          {asOfLabel ? ` · ${asOfLabel}` : ""}
        </p>
        <p
          className="mt-1.5 font-mono text-2xl font-bold tabular-nums"
          style={{ color: headlineColor }}
        >
          {avg}%
          <span className="ml-1 text-xs text-[#606060] font-normal">avg achievement</span>
        </p>
        <div className="mt-2 space-y-0.5">
          {TIER_ORDER.map((t) => {
            const style = TIER_STYLE[t];
            return (
              <div
                key={t}
                className="flex items-center justify-between gap-2 font-mono text-[11px]"
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: style.color }}
                  />
                  <span className="uppercase tracking-wider text-[#C4BCAA]">
                    {style.label}
                  </span>
                </span>
                <span
                  className="tabular-nums font-semibold"
                  style={{ color: style.color }}
                >
                  {counts[t]}
                </span>
              </div>
            );
          })}
        </div>
        {withGoal > 0 && (
          <p className="mt-1 font-mono text-[10px] text-[#606060]">
            CB {cbPct}% · Articles {adPct}%
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MostBehindCard({ clients }: { clients: ClientGoalAgg[] }) {
  const top = useMemo(() => {
    return clients
      .map((c) => {
        const { cbPct, adPct } = clientPcts(c);
        const candidates = [cbPct, adPct].filter(
          (x): x is number => x !== null,
        );
        if (candidates.length === 0) return null;
        const worst = Math.min(...candidates);
        return { client: c.client, worst };
      })
      .filter((x): x is { client: string; worst: number } => x !== null && x.worst < 75)
      .sort((a, b) => a.worst - b.worst)
      .slice(0, 3);
  }, [clients]);

  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#C4BCAA]">
          Most Behind on Goals
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          By worse of CB or Article %
        </p>
        {top.length === 0 ? (
          <>
            <p className="mt-1.5 font-mono text-2xl font-bold text-[#42CA80]">
              All on track
            </p>
            <p className="mt-1 font-mono text-[11px] text-[#606060]">
              Every client at or above 75% on both metrics
            </p>
          </>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {top.map((row) => (
              <li
                key={row.client}
                className="flex items-baseline justify-between gap-2 font-mono text-[12px]"
              >
                <span
                  className="min-w-0 truncate text-white"
                  title={row.client}
                >
                  {row.client}
                </span>
                <span
                  className="shrink-0 font-semibold tabular-nums"
                  style={{ color: ratioColor(row.worst) }}
                >
                  {Math.round(row.worst)}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PodAttentionCard({
  perClient,
}: {
  perClient: Map<string, ClientGoalAgg>;
  filteredClients: Client[];
}) {
  // We don't have client→pod here; the parent could pass it but we keep this
  // self-contained by deriving pod from client name lookups it already passes
  // upstream. For now we render a placeholder when we can't compute pods.
  const stats = useMemo(() => {
    // Fallback: compute average achievement per client and pick the worst.
    // Pod-level breakdown lives in PodGoalsRow below — this card is the
    // headline alarm.
    const buckets: { client: string; pct: number }[] = [];
    for (const c of perClient.values()) {
      const { cbPct, adPct } = clientPcts(c);
      const candidates = [cbPct, adPct].filter(
        (x): x is number => x !== null,
      );
      if (candidates.length === 0) continue;
      const worst = Math.min(...candidates);
      buckets.push({ client: c.client, pct: worst });
    }
    return buckets.sort((a, b) => a.pct - b.pct);
  }, [perClient]);

  const atRisk = stats.filter((s) => s.pct < 50).length;
  const behind = stats.filter((s) => s.pct >= 50 && s.pct < 75).length;
  const onTrack = stats.length - atRisk - behind;
  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#C4BCAA]">
          Avg Achievement
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          Distribution across {stats.length} clients
        </p>
        <p
          className="mt-1.5 font-mono text-2xl font-bold tabular-nums"
          style={{
            color: atRisk > 0 ? "#ED6958" : behind > 0 ? "#F5C542" : "#42CA80",
          }}
        >
          {stats.length === 0
            ? "—"
            : `${Math.round(
                stats.reduce((a, s) => a + s.pct, 0) / stats.length,
              )}%`}
          <span className="ml-1 text-xs text-[#606060] font-normal">avg</span>
        </p>
        <ul className="mt-1.5 space-y-0.5 font-mono text-[11px]">
          <li className="flex items-center justify-between">
            <span className="text-[#C4BCAA]">At Risk</span>
            <span className="tabular-nums font-semibold text-[#ED6958]">{atRisk}</span>
          </li>
          <li className="flex items-center justify-between">
            <span className="text-[#C4BCAA]">Behind</span>
            <span className="tabular-nums font-semibold text-[#F5C542]">{behind}</span>
          </li>
          <li className="flex items-center justify-between">
            <span className="text-[#C4BCAA]">On Track</span>
            <span className="tabular-nums font-semibold text-[#42CA80]">{onTrack}</span>
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

function ClientsOnTrackCard({
  clients,
  subtitle,
}: {
  clients: ClientGoalAgg[];
  subtitle: string;
}) {
  const evaluable = clients.filter((c) => c.cbGoal > 0 || c.adGoal > 0);
  let onTrack = 0;
  for (const c of evaluable) {
    const { cbPct, adPct } = clientPcts(c);
    const cbOk = cbPct === null || cbPct >= 75;
    const adOk = adPct === null || adPct >= 75;
    if (cbOk && adOk) onTrack += 1;
  }
  const total = evaluable.length;
  const ratio = total > 0 ? onTrack / total : 0;
  const color =
    ratio >= 0.75 ? "#42CA80" : ratio >= 0.5 ? "#F5C542" : "#ED6958";
  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#C4BCAA]">
          Clients On Track
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          {subtitle}
        </p>
        <p
          className="mt-1.5 font-mono text-2xl font-bold tabular-nums"
          style={{ color }}
        >
          {onTrack} <span className="text-[#606060] font-normal">/ {total}</span>
        </p>
        <p className="mt-1 font-mono text-[11px] text-[#606060]">
          Both CBs and Articles ≥ 75% over scope
        </p>
      </CardContent>
    </Card>
  );
}
