"use client";

import React, { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { ClientStatusCard } from "./FilterContextCard";
import {
  PIPELINE_STAGE_COLORS,
  TooltipBody,
  displayPod,
  elapsedContractPct,
  pacingColor,
  podBadge,
  type PipelineStage,
} from "./shared-helpers";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { normalizePod, sortPodKey } from "./ContractClientProgress";
import type { Client, CumulativeMetric } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Card title with explainer tooltip — used on the portfolio overview cards
// (Approval Progress / Bottleneck / Funnel Health / Most Stuck / Pod
// Attention) so a reviewer hovering the title sees what the card actually
// computes. Dotted underline hints there's an explanation behind the label.
// ─────────────────────────────────────────────────────────────────────────────

function CardTitleWithTooltip({
  label,
  body,
}: {
  label: string;
  body: { title: string; bullets: React.ReactNode[] };
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#C4BCAA] cursor-help underline decoration-dotted underline-offset-2 decoration-[#404040] inline-block" />
          }
        >
          {label}
        </TooltipTrigger>
        <TooltipContent>
          <TooltipBody {...body} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pacing — neutralizes the "mature pod has higher %, new pod looks bad"
// bias. For each client we compute where they SHOULD be at this point in
// their contract (elapsed_pct × SOW) and compare to actual approved articles.
// Pod-level pacing rolls up by SOW so big-SOW clients dominate the signal,
// which matches how the pod's revenue-weighted attention should flow.
// ─────────────────────────────────────────────────────────────────────────────

type Pacing = "behind" | "on-pace" | "ahead";

const PACING_STYLE: Record<Pacing, { label: string; color: string; bg: string }> = {
  behind:    { label: "Behind",    color: "#ED6958", bg: "rgba(237,105,88,0.12)" },
  "on-pace": { label: "On Pace",   color: "#42CA80", bg: "rgba(66,202,128,0.12)" },
  ahead:     { label: "Ahead",     color: "#8FB5D9", bg: "rgba(143,181,217,0.12)" },
};

const PACING_THRESHOLD_PP = 10; // ≤-10pp behind · ≥+10pp ahead · else on-pace

function pacingFor(deltaPp: number | null): Pacing | null {
  if (deltaPp === null) return null;
  if (deltaPp <= -PACING_THRESHOLD_PP) return "behind";
  if (deltaPp >= PACING_THRESHOLD_PP) return "ahead";
  return "on-pace";
}

// Approved-article volume the client should have shipped by today, given
// elapsed contract time. Returns null when we can't compute honestly.
function expectedApproved(
  sow: number,
  start: Date | null,
  end: Date | null,
): number | null {
  if (sow <= 0 || !start || !end) return null;
  const total = end.getTime() - start.getTime();
  if (total <= 0) return null;
  const elapsed = Math.max(0, Math.min(total, Date.now() - start.getTime()));
  return (elapsed / total) * sow;
}

interface Aggregate {
  sow: number;
  expected: number;
  topics: number;
  cbs: number;
  articles: number;
  published: number;
  clients: number;
  /** Number of clients we could compute pacing for (start_date + end_date). */
  withTime: number;
}

function emptyAggregate(): Aggregate {
  return {
    sow: 0,
    expected: 0,
    topics: 0,
    cbs: 0,
    articles: 0,
    published: 0,
    clients: 0,
    withTime: 0,
  };
}

function pacingDelta(agg: Aggregate): number | null {
  if (agg.sow <= 0 || agg.withTime === 0) return null;
  return ((agg.articles - agg.expected) / agg.sow) * 100;
}

// SOW-weighted average elapsed contract % across the aggregate's clients.
// Used to drive pacing-aware bar colors on pod / portfolio cards.
function aggElapsedPct(agg: Aggregate): number | null {
  if (agg.sow <= 0 || agg.withTime === 0) return null;
  return (agg.expected / agg.sow) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry — top 5 cards row, scope-aware. Mirrors DeliveryOverviewCards.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  filteredClients: Client[];
  rows: CumulativeMetric[];
}

const CARD_TRANSITION = { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const };

export function CumulativePipelineCards({ filteredClients, rows }: Props) {
  const ctx = useMemo(() => buildContext(filteredClients, rows), [filteredClients, rows]);

  const cards = useMemo(() => buildCards(ctx), [ctx]);

  // Column count tracks card count so a row never has empty slots: 5 cards in
  // client / pod scope (status + 4 stages), 4 cards in portfolio scope.
  const lgCols = cards.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4";
  const smCols = cards.length === 5 ? "sm:grid-cols-3" : "sm:grid-cols-2";

  return (
    <motion.div
      layout
      transition={CARD_TRANSITION}
      className={`grid grid-cols-1 gap-3 ${smCols} ${lgCols}`}
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
// Per-pod card grid — replaces the wide pipeline matrix
// ─────────────────────────────────────────────────────────────────────────────

export function PodPipelineCardsGrid({ filteredClients, rows }: Props) {
  const ctx = useMemo(() => buildContext(filteredClients, rows), [filteredClients, rows]);
  const pods = useMemo(() => {
    return Array.from(ctx.byPod.entries())
      .filter(([, agg]) => agg.clients > 0)
      .sort(([a], [b]) => sortPodKey(a, b));
  }, [ctx]);

  if (pods.length <= 1) {
    // 1 pod (or 0) → no value in pod cards; section header below renders the
    // per-client cards directly.
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
          Pipeline by Pod
        </h3>
        <span className="font-mono text-[11px] text-[#606060]">
          Pacing-aware aggregates · {pods.length} pods
        </span>
      </div>
      <motion.div
        layout
        transition={CARD_TRANSITION}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {pods.map(([pod, agg]) => (
            <motion.div
              key={`pod-${pod}`}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={CARD_TRANSITION}
            >
              <PodPipelineCard pod={pod} agg={agg} />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Context: filter scope + per-pod aggregates + portfolio aggregate
// ─────────────────────────────────────────────────────────────────────────────

interface Context {
  scope:
    | { kind: "client"; client: Client; row: CumulativeMetric | null; sow: number }
    | { kind: "pod"; pod: string; clients: Client[] }
    | { kind: "portfolio"; clients: Client[] };
  byClient: Map<string, ClientPipelineDatum>; // by client name
  byPod: Map<string, Aggregate>; // editorial pod → aggregate
  portfolio: Aggregate;
}

interface ClientPipelineDatum {
  client: Client;
  sow: number;
  topics: number;
  cbs: number;
  articles: number;
  published: number;
  expected: number | null;
  deltaPp: number | null;
}

function buildContext(filteredClients: Client[], rows: CumulativeMetric[]): Context {
  const byName = new Map<string, ClientPipelineDatum>();
  for (const c of filteredClients) {
    const r = rows.find((row) => row.client_name === c.name);
    const sow = typeof c.articles_sow === "number" && c.articles_sow > 0 ? c.articles_sow : 0;
    const start = c.start_date ? new Date(c.start_date) : null;
    const end = c.end_date ? new Date(c.end_date) : null;
    const validStart = start && !isNaN(start.getTime()) ? start : null;
    const validEnd = end && !isNaN(end.getTime()) ? end : null;
    const expected = expectedApproved(sow, validStart, validEnd);
    const articles = r?.articles_approved ?? 0;
    const deltaPp =
      expected !== null && sow > 0
        ? ((articles - expected) / sow) * 100
        : null;
    byName.set(c.name, {
      client: c,
      sow,
      topics: r?.topics_approved ?? 0,
      cbs: r?.cbs_approved ?? 0,
      articles,
      published: r?.published_live ?? 0,
      expected,
      deltaPp,
    });
  }

  const byPod = new Map<string, Aggregate>();
  const portfolio = emptyAggregate();
  for (const [, datum] of byName) {
    const pod = datum.client.editorial_pod
      ? normalizePod(datum.client.editorial_pod)
      : "Unassigned";
    const slot = byPod.get(pod) ?? emptyAggregate();
    slot.clients += 1;
    slot.sow += datum.sow;
    slot.topics += datum.topics;
    slot.cbs += datum.cbs;
    slot.articles += datum.articles;
    slot.published += datum.published;
    if (datum.expected !== null) {
      slot.expected += datum.expected;
      slot.withTime += 1;
    }
    byPod.set(pod, slot);

    portfolio.clients += 1;
    portfolio.sow += datum.sow;
    portfolio.topics += datum.topics;
    portfolio.cbs += datum.cbs;
    portfolio.articles += datum.articles;
    portfolio.published += datum.published;
    if (datum.expected !== null) {
      portfolio.expected += datum.expected;
      portfolio.withTime += 1;
    }
  }

  let scope: Context["scope"];
  if (filteredClients.length === 1) {
    const c = filteredClients[0];
    const datum = byName.get(c.name) ?? null;
    scope = {
      kind: "client",
      client: c,
      row: rows.find((r) => r.client_name === c.name) ?? null,
      sow: datum?.sow ?? 0,
    };
  } else {
    const pods = new Set(
      filteredClients.map((c) =>
        c.editorial_pod ? normalizePod(c.editorial_pod) : "Unassigned",
      ),
    );
    if (filteredClients.length > 1 && pods.size === 1) {
      scope = {
        kind: "pod",
        pod: Array.from(pods)[0],
        clients: filteredClients,
      };
    } else {
      scope = { kind: "portfolio", clients: filteredClients };
    }
  }

  return { scope, byClient: byName, byPod, portfolio };
}

// ─────────────────────────────────────────────────────────────────────────────
// Top 5 cards — by scope
// ─────────────────────────────────────────────────────────────────────────────

function buildCards(ctx: Context): { key: string; node: React.ReactNode }[] {
  if (ctx.scope.kind === "client") {
    const { client, sow } = ctx.scope;
    const datum = ctx.byClient.get(client.name);
    if (!datum) {
      return [{ key: "client-status", node: <ClientStatusCard client={client} /> }];
    }
    const eClient = elapsedContractPct(client.start_date, {
      endDate: client.end_date,
      termMonths: client.term_months,
    });
    return [
      { key: "client-status", node: <ClientStatusCard client={client} /> },
      {
        key: "client-topics",
        node: <StageCard title="Topics ÷ SOW" current={datum.topics} sow={sow} elapsedPct={eClient} />,
      },
      {
        key: "client-cbs",
        node: <StageCard title="CBs ÷ SOW" current={datum.cbs} sow={sow} elapsedPct={eClient} />,
      },
      {
        key: "client-articles",
        node: <StageCard title="Articles ÷ SOW" current={datum.articles} sow={sow} elapsedPct={eClient} />,
      },
      {
        key: "client-pub",
        node: (
          <StageCard title="Published ÷ SOW" current={datum.published} sow={sow} elapsedPct={eClient} />
        ),
      },
    ];
  }

  if (ctx.scope.kind === "pod") {
    const agg = ctx.byPod.get(ctx.scope.pod) ?? emptyAggregate();
    const podLabel = displayPod(ctx.scope.pod, "editorial");
    // SOW-weighted average elapsed contract % for the pod — derived directly
    // from the aggregate's expected (Σ expected_articles) ÷ sow.
    const ePod = aggElapsedPct(agg);
    return [
      {
        key: "pod-mix",
        node: (
          <ApprovalMixCard
            byClient={Array.from(ctx.byClient.values())}
            subtitle={`${podLabel} · ${agg.clients} clients`}
          />
        ),
      },
      {
        key: "pod-topics",
        node: (
          <StageCard
            title="Topics ÷ SOW"
            current={agg.topics}
            sow={agg.sow}
            subtitle={podLabel}
            elapsedPct={ePod}
          />
        ),
      },
      {
        key: "pod-cbs",
        node: (
          <StageCard
            title="CBs ÷ SOW"
            current={agg.cbs}
            sow={agg.sow}
            subtitle={podLabel}
            elapsedPct={ePod}
          />
        ),
      },
      {
        key: "pod-articles",
        node: (
          <StageCard
            title="Articles ÷ SOW"
            current={agg.articles}
            sow={agg.sow}
            subtitle={podLabel}
            elapsedPct={ePod}
          />
        ),
      },
      {
        key: "pod-pub",
        node: (
          <StageCard
            title="Published ÷ SOW"
            current={agg.published}
            sow={agg.sow}
            subtitle={podLabel}
            elapsedPct={ePod}
          />
        ),
      },
    ];
  }

  // portfolio
  return [
    {
      key: "port-mix",
      node: (
        <ApprovalMixCard
          byClient={Array.from(ctx.byClient.values())}
          subtitle={`${ctx.portfolio.clients} clients`}
        />
      ),
    },
    { key: "port-bottleneck", node: <BottleneckCard agg={ctx.portfolio} /> },
    {
      key: "port-stuck",
      node: <MostStuckCard data={Array.from(ctx.byClient.values())} />,
    },
    { key: "port-pod-attn", node: <PodAttentionCard byPod={ctx.byPod} /> },
  ];
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

function StageCard({
  title,
  current,
  sow,
  subtitle,
  elapsedPct = null,
}: {
  title: string;
  current: number;
  sow: number;
  subtitle?: string;
  elapsedPct?: number | null;
}) {
  const pct = sow > 0 ? Math.round((current / sow) * 100) : null;
  const color = pct === null ? "#606060" : pacingColor(pct, elapsedPct);
  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#C4BCAA]">
          {title}
        </p>
        {subtitle && (
          <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">{subtitle}</p>
        )}
        <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-white">
          {current.toLocaleString()}
          <span className="text-[#606060] font-normal"> / {sow.toLocaleString()}</span>
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

function ApprovalMixCard({
  byClient,
  subtitle,
}: {
  byClient: ClientPipelineDatum[];
  subtitle: string;
}) {
  const counts: Record<Pacing, number> = { behind: 0, "on-pace": 0, ahead: 0 };
  let totalArticles = 0;
  let totalSow = 0;
  let withTime = 0;
  for (const d of byClient) {
    if (d.sow <= 0) continue;
    totalArticles += d.articles;
    totalSow += d.sow;
    const p = pacingFor(d.deltaPp);
    if (p) {
      counts[p] += 1;
      withTime += 1;
    }
  }
  const totalPct = totalSow > 0 ? Math.round((totalArticles / totalSow) * 100) : 0;
  const headlineColor = ratioColor(totalPct);
  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <CardTitleWithTooltip
          label="Approval Progress"
          body={{
            title: "Approval Progress",
            bullets: [
              "Big number: how much of the contracted work has been approved across the clients you're seeing — approved articles ÷ contracted articles.",
              "Behind / On Pace / Ahead = how many clients are tracking with where their contract should be by now (within ±10 points of expected).",
              "Clients without contract dates are counted in the big number but skipped in the pacing buckets — no expected pace to compare against.",
            ],
          }}
        />
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          {subtitle}{withTime > 0 ? ` · ${withTime} with contract time` : ""}
        </p>
        <p
          className="mt-1.5 font-mono text-2xl font-bold tabular-nums"
          style={{ color: headlineColor }}
        >
          {totalPct}%
          <span className="ml-1 text-xs text-[#606060] font-normal">overall</span>
        </p>
        <div className="mt-2 space-y-0.5">
          {(["behind", "on-pace", "ahead"] as Pacing[]).map((p) => {
            const style = PACING_STYLE[p];
            return (
              <div
                key={p}
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
                  {counts[p]}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// "Where does the funnel hemorrhage volume?" Computes the per-stage drop
// (T→CB, CB→Art, Art→Pub) across the portfolio and surfaces the largest one.
function BottleneckCard({ agg }: { agg: Aggregate }) {
  const drops = useMemo(() => {
    const stages = [
      { from: "Topics", to: "CBs", a: agg.topics, b: agg.cbs },
      { from: "CBs", to: "Articles", a: agg.cbs, b: agg.articles },
      { from: "Articles", to: "Published", a: agg.articles, b: agg.published },
    ];
    return stages
      .map((s) => {
        if (s.a <= 0) return null;
        const conv = (s.b / s.a) * 100;
        return { ...s, conv, drop: 100 - conv, lost: s.a - s.b };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [agg]);

  const bottleneckTooltip = {
    title: "Bottleneck Stage",
    bullets: [
      "Where the pipeline loses the most volume between stages (Topics → CBs → Articles → Published).",
      "Big label: the stage with the biggest drop-off.",
      "‘73% pass’ = 73 of every 100 items make it to the next stage. ‘902 lost’ = how many got stuck at this step across all clients.",
    ],
  };
  if (drops.length === 0) {
    return (
      <Card className="h-full border-[#2a2a2a] bg-[#161616]">
        <CardContent className="pt-0">
          <CardTitleWithTooltip label="Bottleneck Stage" body={bottleneckTooltip} />
          <p className="mt-0.5 text-[11px] text-[#909090]">No data</p>
          <p className="mt-1.5 font-mono text-2xl font-bold text-[#606060]">—</p>
        </CardContent>
      </Card>
    );
  }
  const worst = [...drops].sort((a, b) => b.drop - a.drop)[0];
  const color = ratioColor(worst.conv);
  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <CardTitleWithTooltip label="Bottleneck Stage" body={bottleneckTooltip} />
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          Biggest funnel drop
        </p>
        <p
          className="mt-1.5 font-mono text-xl font-bold text-white truncate"
          title={`${worst.from} → ${worst.to}`}
        >
          {worst.from} → {worst.to}
        </p>
        <p className="mt-1 font-mono text-[11px] tabular-nums" style={{ color }}>
          {Math.round(worst.conv)}% pass · {worst.lost.toLocaleString()} lost
        </p>
        <ul className="mt-1 space-y-0.5">
          {drops
            .filter((d) => d !== worst)
            .map((d) => (
              <li
                key={`${d.from}-${d.to}`}
                className="flex items-baseline justify-between gap-2 font-mono text-[10px]"
              >
                <span className="truncate text-[#C4BCAA]">
                  {d.from} → {d.to}
                </span>
                <span
                  className="shrink-0 tabular-nums"
                  style={{ color: ratioColor(d.conv) }}
                >
                  {Math.round(d.conv)}%
                </span>
              </li>
            ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function MostStuckCard({ data }: { data: ClientPipelineDatum[] }) {
  const top = useMemo(() => {
    return [...data]
      .filter((d) => d.deltaPp !== null && d.deltaPp < 0)
      .sort((a, b) => (a.deltaPp ?? 0) - (b.deltaPp ?? 0))
      .slice(0, 3);
  }, [data]);
  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <CardTitleWithTooltip
          label="Most Stuck"
          body={{
            title: "Most Stuck",
            bullets: [
              "The 3 clients furthest behind their contract pace.",
              "Each client's % of articles approved is compared to where they should be at this point in their contract.",
              "‘-25pp’ = 25 points behind expected. Clients without contract dates are skipped (no pace to compare against).",
            ],
          }}
        />
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          Articles vs. expected pacing
        </p>
        {top.length === 0 ? (
          <>
            <p className="mt-1.5 font-mono text-2xl font-bold text-[#42CA80]">
              All on pace
            </p>
            <p className="mt-1 font-mono text-[11px] text-[#606060]">
              No client behind their contract pace
            </p>
          </>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {top.map((d) => (
              <li
                key={d.client.id}
                className="flex items-baseline justify-between gap-2 font-mono text-[12px]"
              >
                <span
                  className="min-w-0 truncate text-white"
                  title={d.client.name}
                >
                  {d.client.name}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-[#ED6958]">
                  {Math.round(d.deltaPp ?? 0)}pp
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PodAttentionCard({ byPod }: { byPod: Map<string, Aggregate> }) {
  const stats = useMemo(() => {
    return Array.from(byPod.entries())
      .map(([pod, agg]) => ({ pod, agg, delta: pacingDelta(agg) }))
      .filter((x) => x.delta !== null)
      .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0));
  }, [byPod]);

  const podAttentionTooltip = {
    title: "Pod Attention",
    bullets: [
      "Which editorial pod most needs attention right now.",
      "Each pod is scored by how far behind its clients are vs. where their contracts say they should be. Bigger contracts weigh more in the pod's score.",
      "Big label = the worst-pacing pod. ‘-20pp pacing’ = 20 points behind expected.",
    ],
  };
  if (stats.length === 0) {
    return (
      <Card className="h-full border-[#2a2a2a] bg-[#161616]">
        <CardContent className="pt-0">
          <CardTitleWithTooltip label="Pod Attention" body={podAttentionTooltip} />
          <p className="mt-0.5 text-[11px] text-[#909090]">No pod data</p>
          <p className="mt-1.5 font-mono text-2xl font-bold text-[#606060]">—</p>
        </CardContent>
      </Card>
    );
  }
  const worst = stats[0];
  const worstColor =
    worst.delta !== null && worst.delta <= -PACING_THRESHOLD_PP
      ? "#ED6958"
      : worst.delta !== null && worst.delta >= PACING_THRESHOLD_PP
      ? "#8FB5D9"
      : "#42CA80";
  return (
    <Card className="h-full border-[#2a2a2a] bg-[#161616]">
      <CardContent className="pt-0">
        <CardTitleWithTooltip label="Pod Attention" body={podAttentionTooltip} />
        <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
          Articles pacing across pods
        </p>
        <p
          className="mt-1.5 font-mono text-xl font-bold text-white truncate"
          title={displayPod(worst.pod, "editorial")}
        >
          {displayPod(worst.pod, "editorial")}
        </p>
        <p
          className="mt-1 font-mono text-[11px] tabular-nums"
          style={{ color: worstColor }}
        >
          {worst.delta !== null
            ? `${worst.delta >= 0 ? "+" : ""}${Math.round(worst.delta)}pp pacing`
            : "—"}
        </p>
        <ul className="mt-1 space-y-0.5">
          {stats.slice(1, 3).map((s) => {
            const c =
              s.delta !== null && s.delta <= -PACING_THRESHOLD_PP
                ? "#ED6958"
                : s.delta !== null && s.delta >= PACING_THRESHOLD_PP
                ? "#8FB5D9"
                : "#42CA80";
            return (
              <li
                key={s.pod}
                className="flex items-baseline justify-between gap-2 font-mono text-[10px]"
              >
                <span className="truncate text-[#C4BCAA]">
                  {displayPod(s.pod, "editorial")}
                </span>
                <span className="shrink-0 tabular-nums" style={{ color: c }}>
                  {s.delta === null
                    ? "—"
                    : `${s.delta >= 0 ? "+" : ""}${Math.round(s.delta)}pp`}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-pod pipeline card
// ─────────────────────────────────────────────────────────────────────────────

function PodPipelineCard({ pod, agg }: { pod: string; agg: Aggregate }) {
  const delta = pacingDelta(agg);
  const pacing = pacingFor(delta);

  const tToCb = agg.topics > 0 ? Math.round((agg.cbs / agg.topics) * 100) : null;
  const cbToArt = agg.cbs > 0 ? Math.round((agg.articles / agg.cbs) * 100) : null;
  const artToPub =
    agg.articles > 0 ? Math.round((agg.published / agg.articles) * 100) : null;

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">{podBadge(pod)}</div>
          <p className="mt-1 font-mono text-[11px] text-[#606060] tabular-nums">
            {agg.sow.toLocaleString()} SOW · {agg.clients} clients
          </p>
        </div>
        {pacing && (
          <span
            className="shrink-0 inline-flex items-center gap-1 rounded-sm px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-wider tabular-nums"
            style={{
              color: PACING_STYLE[pacing].color,
              backgroundColor: PACING_STYLE[pacing].bg,
            }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: PACING_STYLE[pacing].color }}
            />
            {PACING_STYLE[pacing].label}
            {delta !== null && (
              <span className="font-normal opacity-80">
                {" "}
                {delta >= 0 ? "+" : ""}
                {Math.round(delta)}pp
              </span>
            )}
          </span>
        )}
      </div>

      {/* Stage bars — colored by funnel stage (Topics → Published). Pacing
          status lives on the chip in the header, not on the bars. */}
      <div className="mt-3 space-y-1.5">
        <PodStageBar label="Topics" stage="topics" current={agg.topics} sow={agg.sow} />
        <PodStageBar label="CBs" stage="cbs" current={agg.cbs} sow={agg.sow} />
        <PodStageBar label="Articles" stage="articles" current={agg.articles} sow={agg.sow} />
        <PodStageBar label="Published" stage="published" current={agg.published} sow={agg.sow} />
      </div>

      {/* Conversion footer */}
      <div className="mt-3 border-t border-[#2a2a2a] pt-2">
        <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-[#606060]">
          Funnel conversion
        </p>
        <div className="mt-1 grid grid-cols-3 gap-2 font-mono text-[11px]">
          <PodConv label="T→CB" pct={tToCb} />
          <PodConv label="CB→Art" pct={cbToArt} />
          <PodConv label="Art→Pub" pct={artToPub} />
        </div>
      </div>
    </div>
  );
}

function PodStageBar({
  label,
  stage,
  current,
  sow,
}: {
  label: string;
  stage: PipelineStage;
  current: number;
  sow: number;
}) {
  // Stage colors only — funnel progression (Topics → Published). The
  // "behind / ahead" status lives on the pacing chip in the card header,
  // so the bars themselves stay calm and stage-marked.
  const pct = sow > 0 ? Math.round((current / sow) * 100) : null;
  const barPct = pct === null ? 0 : Math.min(pct, 100);
  const fill = PIPELINE_STAGE_COLORS[stage];
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 font-mono text-[10px] uppercase tracking-wider text-[#909090]">
        {label}
      </span>
      <div className="flex-1 h-2 rounded-full bg-[#1f1f1f] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${barPct}%`, backgroundColor: fill, opacity: 0.9 }}
        />
      </div>
      <span className="w-10 shrink-0 text-right font-mono text-[10px] font-semibold tabular-nums text-[#C4BCAA]">
        {pct === null ? "—" : `${pct}%`}
      </span>
      <span className="w-16 shrink-0 text-right font-mono text-[10px] tabular-nums text-[#606060]">
        {current.toLocaleString()}
        <span className="text-[#404040]">/{sow.toLocaleString()}</span>
      </span>
    </div>
  );
}

function PodConv({ label, pct }: { label: string; pct: number | null }) {
  const color = ratioColor(pct);
  return (
    <div className="flex items-baseline justify-between gap-1">
      <span className="text-[10px] uppercase tracking-wider text-[#606060]">
        {label}
      </span>
      <span className="tabular-nums font-semibold" style={{ color }}>
        {pct === null ? "—" : `${pct}%`}
      </span>
    </div>
  );
}
