"use client";

/**
 * Admin · Analytics — dashboard usage telemetry for the Editorial Hub.
 *
 * Source: `usage_events` table populated by the frontend's
 * analyticsClient. Layout grouped into three bands so the page reads
 * top → bottom as "what happened? → where? → who?":
 *
 *   1. KPI strip (4 hero tiles + range selector)
 *   2. Daily Activity area chart + event-mix donut (the "what")
 *   3. Top Dashboards / Top Sections side-by-side (the "where")
 *   4. Drill-Down + Click Interactions + Comment Activity (the "how")
 *   5. Per-User Activity + Filter Usage + Return Cadence (the "who")
 *
 * Six-month retention is enforced by the backend startup migration so
 * the 90-day range tab is always safely within the window.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  Check,
  CheckCircle2,
  Eye,
  Layers,
  ListChecks,
  MessageSquareText,
  MinusCircle,
  MousePointerClick,
  RefreshCw,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiGet } from "@/lib/api";
import { useRequireView } from "@/lib/accessClient";

type RangeKey = "7d" | "30d" | "90d";

interface GroupSummary {
  slug: string;
  name: string;
  description: string | null;
  member_count: number;
  is_seeded: boolean;
  is_pod_derived: boolean;
}

interface TopRouteRow {
  route: string;
  page_views: number;
  unique_users: number;
}

interface TopSectionRow {
  route: string;
  section_id: string;
  views: number;
  avg_dwell_ms: number | null;
}

interface PerUserRow {
  user_email: string;
  last_seen_at: string;
  sessions_count: number;
  events_count: number;
  top_route: string | null;
}

interface FilterRow {
  dimension: string;
  value: string;
  count: number;
}

interface ReturnCadenceRow {
  user_email: string;
  median_gap_days: number;
  visits: number;
}

interface DailyActivityRow {
  day: string;
  event_type: string;
  count: number;
}

interface DrillDownRow {
  variant: string;
  count: number;
  unique_users: number;
}

interface CommentActivityRow {
  day: string;
  posted: number;
  edited: number;
  resolved: number;
  deleted: number;
}

interface ClickInteractionRow {
  label: string;
  section_id: string | null;
  count: number;
  unique_users: number;
}

interface AnalyticsSummary {
  range_label: RangeKey;
  range_start: string;
  range_end: string;
  total_events: number;
  total_users: number;
  top_routes: TopRouteRow[];
  top_sections: TopSectionRow[];
  per_user: PerUserRow[];
  filter_usage: FilterRow[];
  return_cadence: ReturnCadenceRow[];
  daily_activity: DailyActivityRow[];
  drill_downs: DrillDownRow[];
  comment_activity: CommentActivityRow[];
  click_interactions: ClickInteractionRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Color tokens — keep in lockstep with the rest of the Hub palette.
// Different event types get distinct hues so the stacked area chart +
// legend chips read as one consistent visual language.
// ─────────────────────────────────────────────────────────────────────────────

const EVENT_COLORS: Record<string, string> = {
  PageView: "#42CA80",          // P2 green — most common event
  SectionEntered: "#65FFAA",    // P1 bright green
  SectionViewed: "#2E8C59",     // P3 deep green
  FilterChanged: "#F5C542",     // amber — interaction
  ClickInteraction: "#F28D59",  // orange — interaction
  DrillDownOpened: "#8FB5D9",   // sky blue — exploration
  SyncClicked: "#ED6958",       // red — write action
  CommentPosted: "#CEBCF4",     // light purple
  CommentEdited: "#A78BFA",     // purple
  CommentResolved: "#7FE8D6",   // teal
  CommentDeleted: "#606060",    // grey
};

const PRIMARY = "#42CA80";

// ─────────────────────────────────────────────────────────────────────────────
// Format helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatRoute(r: string): string {
  if (r === "/") return "Home";
  const last = r.split("/").filter(Boolean).pop() ?? r;
  return last.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDwell(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = sec / 60;
  return `${min.toFixed(1)} min`;
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const ms = Date.now() - t;
  if (ms < 60_000) return "just now";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function formatEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const first = local.split(".")[0] ?? local;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

// Donut label renderer — draws an L-shaped leader line out from each
// slice, then prints "NAME · 42%" anchored to whichever side the slice
// sits on. Tiny slices (< 4% by default) are suppressed to avoid the
// labels colliding into an unreadable blob; users still see them via
// the tooltip on hover.
const DEG_TO_RAD = Math.PI / 180;
const DONUT_LABEL_MIN_PCT = 0.03;

interface DonutLabelProps {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  percent?: number;
  name?: string;
  value?: number;
  fill?: string;
  index?: number;
}

function renderDonutLabel(props: DonutLabelProps) {
  const cx = props.cx ?? 0;
  const cy = props.cy ?? 0;
  const midAngle = props.midAngle ?? 0;
  const outerRadius = props.outerRadius ?? 0;
  const percent = props.percent ?? 0;
  const name = props.name ?? "";
  const fill = props.fill ?? "#909090";

  if (percent < DONUT_LABEL_MIN_PCT) return null;

  const sin = Math.sin(-DEG_TO_RAD * midAngle);
  const cos = Math.cos(-DEG_TO_RAD * midAngle);
  // Two-segment leader line: angled out from the slice, then a short
  // horizontal stub before the text.
  const x1 = cx + (outerRadius + 2) * cos;
  const y1 = cy + (outerRadius + 2) * sin;
  const x2 = cx + (outerRadius + 10) * cos;
  const y2 = cy + (outerRadius + 10) * sin;
  const stubDir = cos >= 0 ? 1 : -1;
  const x3 = x2 + stubDir * 4;
  const textAnchor = cos >= 0 ? "start" : "end";
  const textX = x3 + stubDir * 2;
  const pctText = `${Math.round(percent * 100)}%`;

  return (
    <g>
      <path
        d={`M${x1},${y1} L${x2},${y2} L${x3},${y2}`}
        stroke={fill}
        fill="none"
        strokeWidth={0.8}
        opacity={0.7}
      />
      <text
        x={textX}
        y={y2 - 2}
        textAnchor={textAnchor}
        fontSize={9}
        fontFamily="var(--font-mono)"
        fill="#C4BCAA"
        style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}
      >
        {name}
      </text>
      <text
        x={textX}
        y={y2 + 8}
        textAnchor={textAnchor}
        fontSize={9}
        fontFamily="var(--font-mono)"
        fill="#909090"
        fontWeight={600}
      >
        {pctText}
      </text>
    </g>
  );
}

function formatDayShort(day: string): string {
  // "2026-05-28" → "May 28"
  const [y, m, d] = day.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return day;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom dark tooltip — Recharts' default tooltip paints each item's text
// in the series's own color (so a dark-stroked Area renders unreadable
// item labels against a dark popover). This control forces every label,
// name, and value through the same readable palette regardless of series.
// ─────────────────────────────────────────────────────────────────────────────

interface DarkTooltipProps {
  active?: boolean;
  payload?: Array<{
    name?: string | number;
    value?: string | number;
    color?: string;
    payload?: Record<string, unknown>;
  }>;
  label?: string | number;
  labelFormatter?: (label: string) => string;
  nameFormatter?: (name: string) => string;
  valueFormatter?: (value: number, name: string) => string;
  showTotal?: boolean;
}

function DarkTooltip({
  active,
  payload,
  label,
  labelFormatter,
  nameFormatter,
  valueFormatter,
  showTotal,
}: DarkTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  // Stacked AreaCharts can include zero-valued series — hide them so the
  // popover only shows what the cursor actually touches.
  const visible = payload.filter((p) => Number(p.value) > 0);
  if (visible.length === 0) return null;
  const total = visible.reduce((s, p) => s + Number(p.value ?? 0), 0);
  return (
    <div
      style={{
        backgroundColor: "#0a0a0a",
        border: "1px solid #2a2a2a",
        borderRadius: 6,
        padding: "8px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        minWidth: 140,
      }}
    >
      {label !== undefined && label !== "" && (
        <div
          style={{
            color: "#909090",
            marginBottom: 6,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontSize: 10,
          }}
        >
          {labelFormatter ? labelFormatter(String(label)) : String(label)}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {visible.map((entry, i) => {
          const name = String(entry.name ?? "");
          const value = Number(entry.value ?? 0);
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                lineHeight: 1.3,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: entry.color ?? "#909090",
                  flexShrink: 0,
                }}
              />
              <span style={{ color: "#C4BCAA", flex: 1, minWidth: 0 }}>
                {nameFormatter ? nameFormatter(name) : name}
              </span>
              <span
                style={{
                  color: "#FFFFFF",
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {valueFormatter ? valueFormatter(value, name) : value.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
      {showTotal && visible.length > 1 && (
        <div
          style={{
            marginTop: 6,
            paddingTop: 6,
            borderTop: "1px solid #2a2a2a",
            display: "flex",
            justifyContent: "space-between",
            color: "#909090",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontSize: 10,
          }}
        >
          <span>Total</span>
          <span
            style={{
              color: "#FFFFFF",
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {total.toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const access = useRequireView("admin.analytics");
  const [range, setRange] = useState<RangeKey>("30d");
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  // selectedSlugs === null  ⇒ "All groups" (no filter sent)
  // selectedSlugs === []    ⇒ active filter, but nothing selected (shows nothing)
  // selectedSlugs === [...] ⇒ filter to those groups
  const [selectedSlugs, setSelectedSlugs] = useState<string[] | null>(null);
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load the group list once on mount. The dropdown reflects whatever
  // groups exist in `access_groups` — seed + pod-derived.
  useEffect(() => {
    if (!access) return;
    apiGet<GroupSummary[]>("/api/access/groups")
      .then(setGroups)
      .catch(() => {
        // Non-fatal — the filter just won't render group chips. The
        // dashboard still works, gated only by range.
      });
  }, [access]);

  useEffect(() => {
    if (!access) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ range });
    if (selectedSlugs !== null) {
      params.set("groups", selectedSlugs.join(","));
    }
    apiGet<AnalyticsSummary>(`/api/analytics/summary?${params.toString()}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"))
      .finally(() => setLoading(false));
  }, [range, selectedSlugs, access]);

  if (!access) return null;

  return (
    <div className="space-y-6">
      {/* Header band — title + range tabs aligned to the right */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
            Admin
          </p>
          <h1 className="flex items-center gap-2 font-mono text-lg font-bold uppercase tracking-[0.2em] text-white">
            <BarChart3 className="h-5 w-5 text-[#42CA80]" />
            Analytics
          </h1>
          <p className="max-w-2xl text-sm text-[#C4BCAA]">
            Hub usage telemetry. Pages visited, sections viewed, filters
            applied, and clicks per user. 6-month retention; admins only.
          </p>
        </div>
      </header>

      <Tabs defaultValue="dashboard" className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="dashboard">
              <BarChart3 className="mr-1.5 h-3.5 w-3.5" /> Dashboard
            </TabsTrigger>
            <TabsTrigger value="coverage">
              <ListChecks className="mr-1.5 h-3.5 w-3.5" /> Tracking Coverage
            </TabsTrigger>
          </TabsList>
          {/* Filters only matter for the Dashboard tab. Coverage is a
              static inventory — no time dimension. */}
          <div className="flex flex-wrap items-center gap-2">
            <GroupFilter
              groups={groups}
              selected={selectedSlugs}
              onChange={setSelectedSlugs}
            />
            <RangeTabs value={range} onChange={setRange} />
          </div>
        </div>

        <TabsContent value="dashboard" className="space-y-6">
          {error && (
            <div className="rounded-md border border-[#ED6958]/40 bg-[#ED6958]/10 px-3 py-2 font-mono text-[11px] text-[#ED6958]">
              Failed to load analytics: {error}
            </div>
          )}

          {loading && (
            <div className="flex h-32 items-center justify-center gap-2 font-mono text-[11px] text-[#606060]">
              <Activity className="h-3.5 w-3.5 animate-pulse" />
              Loading analytics…
            </div>
          )}

          {data && !loading && (
            <>
              <KpiStrip data={data} />
              <DailyActivityCard data={data} />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <TopDashboardsCard rows={data.top_routes} />
                <TopSectionsCard rows={data.top_sections} />
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <DrillDownCard rows={data.drill_downs} />
                <ClickInteractionsCard rows={data.click_interactions} />
              </div>
              <CommentActivityCard rows={data.comment_activity} />
              <PerUserCard rows={data.per_user} />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <FilterUsageCard rows={data.filter_usage} />
                <ReturnCadenceCard rows={data.return_cadence} />
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="coverage" className="space-y-6">
          <TrackingCoverageTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components — KPI strip, range tabs, cards
// ─────────────────────────────────────────────────────────────────────────────

function RangeTabs({
  value,
  onChange,
}: {
  value: RangeKey;
  onChange: (next: RangeKey) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] p-1">
      {(["7d", "30d", "90d"] as const).map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={
            "rounded-md px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider transition-all " +
            (value === r
              ? "bg-[#42CA80] text-black shadow-sm"
              : "text-[#909090] hover:bg-[#161616] hover:text-white")
          }
        >
          Last {r}
        </button>
      ))}
    </div>
  );
}

function GroupFilter({
  groups,
  selected,
  onChange,
}: {
  groups: GroupSummary[];
  selected: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const allSlugs = groups.map((g) => g.slug);

  const isAll = selected === null;
  const selectedCount = isAll ? allSlugs.length : selected?.length ?? 0;

  // Human-readable label for the dropdown trigger.
  let label: string;
  if (isAll) label = "All groups";
  else if (selectedCount === 0) label = "No groups";
  else if (selectedCount === 1) {
    const g = groups.find((gr) => gr.slug === selected?.[0]);
    label = g?.name ?? selected?.[0] ?? "";
  } else label = `${selectedCount} groups`;

  const isActive = !isAll;

  function toggleSlug(slug: string) {
    const current = selected ?? allSlugs;
    const next = current.includes(slug)
      ? current.filter((s) => s !== slug)
      : [...current, slug];
    // Toggling everything back ON collapses to "All" (null sentinel)
    // so the URL stays clean.
    if (next.length === allSlugs.length) onChange(null);
    else onChange(next);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider transition-all " +
          (isActive
            ? "border-[#42CA80]/50 bg-[#42CA80]/10 text-[#42CA80]"
            : "border-[#2a2a2a] bg-[#0d0d0d] text-[#909090] hover:text-white")
        }
      >
        <Users className="h-3 w-3" />
        {label}
        {isActive && (
          <span className="rounded-sm bg-[#42CA80]/20 px-1 text-[#42CA80] tabular-nums">
            {selectedCount}
          </span>
        )}
        <span
          className={
            "ml-1 inline-block transition-transform " + (open ? "rotate-180" : "")
          }
          aria-hidden
        >
          ▾
        </span>
      </button>
      {open && (
        <>
          {/* Click-outside backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1.5 w-72 overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#1f1f1f] bg-[#161616] px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-widest text-[#C4BCAA]">
                Filter by group
              </p>
              <button
                type="button"
                onClick={() => onChange(null)}
                disabled={isAll}
                className={
                  "font-mono text-[9px] uppercase tracking-wider transition-colors " +
                  (isAll
                    ? "cursor-default text-[#404040]"
                    : "text-[#42CA80] hover:text-[#65FFAA]")
                }
              >
                {isAll ? "All shown" : "Reset"}
              </button>
            </div>
            {/* Per-group checkboxes */}
            <div className="max-h-80 overflow-y-auto py-1">
              {groups.map((g) => {
                const isChecked = isAll || (selected ?? []).includes(g.slug);
                return (
                  <button
                    key={g.slug}
                    type="button"
                    onClick={() => toggleSlug(g.slug)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[#161616]"
                  >
                    <span
                      className={
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border transition-all " +
                        (isChecked
                          ? "border-[#42CA80] bg-[#42CA80]"
                          : "border-[#3a3a3a] bg-[#0d0d0d] group-hover:border-[#525252]")
                      }
                    >
                      {isChecked && (
                        <Check className="h-3 w-3 text-black" strokeWidth={3} />
                      )}
                    </span>
                    <span
                      className={
                        "flex-1 truncate font-mono text-[11px] uppercase tracking-wider transition-colors " +
                        (isChecked ? "text-white" : "text-[#909090]")
                      }
                    >
                      {g.name}
                    </span>
                    <span className="font-mono text-[10px] tabular-nums text-[#606060]">
                      {g.member_count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiStrip({ data }: { data: AnalyticsSummary }) {
  // Derived metrics for the strip — keep these in sync with the
  // primary `data` view so users don't have to hunt across cards.
  const sessions = data.per_user.reduce((s, u) => s + u.sessions_count, 0);
  const avgEventsPerUser =
    data.total_users > 0
      ? Math.round(data.total_events / data.total_users)
      : 0;
  const topRoute = data.top_routes[0];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KpiTile
        icon={Activity}
        label="Total events"
        value={data.total_events.toLocaleString()}
        accent="#42CA80"
      />
      <KpiTile
        icon={Users}
        label="Active users"
        value={data.total_users.toLocaleString()}
        accent="#8FB5D9"
      />
      <KpiTile
        icon={RefreshCw}
        label="Sessions"
        value={sessions.toLocaleString()}
        accent="#F5C542"
        sublabel={`${avgEventsPerUser} events / user avg`}
      />
      <KpiTile
        icon={TrendingUp}
        label="Top dashboard"
        value={topRoute ? formatRoute(topRoute.route) : "—"}
        accent="#65FFAA"
        sublabel={
          topRoute ? `${topRoute.page_views} views · ${topRoute.unique_users} users` : ""
        }
      />
    </div>
  );
}

function KpiTile({
  icon: Icon,
  label,
  value,
  sublabel,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sublabel?: string;
  accent: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-lg border border-[#2a2a2a] bg-gradient-to-br from-[#161616] to-[#0d0d0d] p-4 transition-colors hover:border-[#3a3a3a]">
      <div className="flex items-start justify-between">
        <p className="font-mono text-[10px] uppercase tracking-wider text-[#909090]">
          {label}
        </p>
        <div
          className="rounded-md p-1.5"
          style={{ backgroundColor: `${accent}15`, color: accent }}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <p
        className="mt-2 font-mono text-2xl font-bold tabular-nums leading-tight"
        style={{ color: accent }}
      >
        {value}
      </p>
      {sublabel && (
        <p className="mt-1 font-mono text-[10px] text-[#606060]">{sublabel}</p>
      )}
      {/* Subtle accent bar at the bottom */}
      <div
        className="absolute inset-x-0 bottom-0 h-0.5 opacity-40 transition-opacity group-hover:opacity-100"
        style={{ backgroundColor: accent }}
      />
    </div>
  );
}

function CardShell({
  title,
  subtitle,
  icon: Icon,
  iconColor,
  children,
  rightSlot,
  empty,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  iconColor?: string;
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
  empty?: boolean;
}) {
  return (
    <section className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
            {Icon && (
              <span style={{ color: iconColor ?? "#42CA80" }}>
                <Icon className="h-3.5 w-3.5" />
              </span>
            )}
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-[#606060]">
              {subtitle}
            </p>
          )}
        </div>
        {rightSlot}
      </div>
      {empty ? (
        <p className="font-mono text-[11px] text-[#606060]">No data in this range.</p>
      ) : (
        children
      )}
    </section>
  );
}

function DailyActivityCard({ data }: { data: AnalyticsSummary }) {
  // Pivot the day × event_type rows into chart-ready records: one row
  // per day, one column per event type.
  const chartData = useMemo(() => {
    const byDay = new Map<string, Record<string, number | string>>();
    for (const r of data.daily_activity) {
      const cur =
        byDay.get(r.day) ?? ({ day: r.day, total: 0 } as Record<string, number | string>);
      cur[r.event_type] = r.count;
      cur.total = (cur.total as number) + r.count;
      byDay.set(r.day, cur);
    }
    return Array.from(byDay.values()).sort((a, b) =>
      String(a.day).localeCompare(String(b.day)),
    );
  }, [data.daily_activity]);

  // Stable event ordering for stacking (most common first → most rare).
  const eventTypes = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of data.daily_activity) {
      totals.set(r.event_type, (totals.get(r.event_type) ?? 0) + r.count);
    }
    return Array.from(totals.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([et]) => et);
  }, [data.daily_activity]);

  // Event-mix donut — % of each event type across the entire range.
  const mixData = useMemo(() => {
    return eventTypes.map((et) => ({
      name: et,
      value: data.daily_activity
        .filter((r) => r.event_type === et)
        .reduce((s, r) => s + r.count, 0),
      color: EVENT_COLORS[et] ?? "#909090",
    }));
  }, [eventTypes, data.daily_activity]);

  const subtitle = `${data.total_events.toLocaleString()} events across ${chartData.length} day${chartData.length === 1 ? "" : "s"}`;
  if (chartData.length === 0) {
    return (
      <CardShell
        title="Daily Activity"
        subtitle={subtitle}
        icon={Activity}
        iconColor="#42CA80"
        empty
      >
        <></>
      </CardShell>
    );
  }
  // Bypass CardShell so the donut column can span the FULL card height
  // (title row included), while the area chart on the left keeps its
  // existing h-56 sizing below the title block.
  return (
    <section className="rounded-lg border border-[#2a2a2a] bg-[#161616] p-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        {/* Left column: title + subtitle + stacked area chart */}
        <div className="flex flex-col">
          <div className="mb-3">
            <h2 className="flex items-center gap-2 font-mono text-sm font-semibold uppercase tracking-widest text-[#C4BCAA]">
              <span style={{ color: "#42CA80" }}>
                <Activity className="h-3.5 w-3.5" />
              </span>
              Daily Activity
            </h2>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-[#606060]">
              {subtitle}
            </p>
          </div>
          <div className="h-56 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                {eventTypes.map((et) => (
                  <linearGradient key={et} id={`gradient-${et}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={EVENT_COLORS[et] ?? "#909090"} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={EVENT_COLORS[et] ?? "#909090"} stopOpacity={0.05} />
                  </linearGradient>
                ))}
              </defs>
              <XAxis
                dataKey="day"
                stroke="#404040"
                fontSize={10}
                tickFormatter={formatDayShort}
                tickLine={false}
                axisLine={{ stroke: "#2a2a2a" }}
              />
              <YAxis
                stroke="#404040"
                fontSize={10}
                tickLine={false}
                axisLine={{ stroke: "#2a2a2a" }}
                width={32}
              />
              <RTooltip
                content={
                  <DarkTooltip
                    labelFormatter={(l) => formatDayShort(l)}
                    showTotal
                  />
                }
                cursor={{ stroke: "#42CA80", strokeWidth: 1, strokeDasharray: "3 3" }}
              />
              {eventTypes.map((et) => (
                <Area
                  key={et}
                  type="monotone"
                  dataKey={et}
                  stackId="1"
                  stroke={EVENT_COLORS[et] ?? "#909090"}
                  fill={`url(#gradient-${et})`}
                  strokeWidth={1.5}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
          </div>
        </div>

        {/* Right column: donut sized to the same vertical band as the
            title-block + area-chart on the left (~308px). Explicit
            height avoids the Recharts ResponsiveContainer `width(-1)
            height(-1)` warnings — flex-1 measures as 0 before layout
            settles, which trips the chart's first render. */}
        <div className="flex flex-col items-center">
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 16, right: 36, bottom: 16, left: 36 }}>
                <Pie
                  data={mixData}
                  cx="50%"
                  cy="50%"
                  innerRadius={42}
                  outerRadius={64}
                  dataKey="value"
                  paddingAngle={2}
                  labelLine={false}
                  label={renderDonutLabel}
                  isAnimationActive={false}
                  minAngle={6}
                >
                  {mixData.map((d, i) => (
                    <Cell key={i} fill={d.color} stroke="none" />
                  ))}
                </Pie>
                <RTooltip content={<DarkTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-[#606060]">
            Event mix
          </p>
        </div>
      </div>
    </section>
  );
}

function TopDashboardsCard({ rows }: { rows: TopRouteRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.page_views));
  return (
    <CardShell
      title="Top Dashboards"
      subtitle="Pages by view count"
      icon={Eye}
      iconColor="#65FFAA"
      empty={rows.length === 0}
    >
      <ul className="space-y-2.5">
        {rows.map((r, i) => (
          <li key={r.route} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-[10px] text-[#606060] tabular-nums">
                  #{i + 1}
                </span>
                <span className="font-mono text-[11px] uppercase tracking-wider text-[#C4BCAA]">
                  {formatRoute(r.route)}
                </span>
              </span>
              <span className="flex items-baseline gap-2 font-mono text-[10px] tabular-nums">
                <span className="font-semibold text-white">
                  {r.page_views.toLocaleString()}
                </span>
                <span className="text-[#606060]">views</span>
                <span className="text-[#65FFAA]">·</span>
                <span className="text-[#909090]">{r.unique_users}</span>
                <span className="text-[#606060]">users</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#1f1f1f]">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${(r.page_views / max) * 100}%`,
                  backgroundColor: PRIMARY,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

function TopSectionsCard({ rows }: { rows: TopSectionRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.views));
  return (
    <CardShell
      title="Top Sections"
      subtitle="Sections by view count + avg dwell time"
      icon={Layers}
      iconColor="#65FFAA"
      empty={rows.length === 0}
    >
      <ul className="space-y-2.5">
        {rows.map((r, i) => (
          <li key={`${r.route}|${r.section_id}`} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex items-baseline gap-2 min-w-0">
                <span className="font-mono text-[10px] text-[#606060] tabular-nums">
                  #{i + 1}
                </span>
                <span className="truncate font-mono text-[11px] uppercase tracking-wider text-[#C4BCAA]">
                  {r.section_id}
                </span>
                <span className="truncate font-mono text-[9px] text-[#606060]">
                  {formatRoute(r.route)}
                </span>
              </span>
              <span className="flex shrink-0 items-baseline gap-2 font-mono text-[10px] tabular-nums">
                <span className="font-semibold text-white">{r.views.toLocaleString()}</span>
                <DwellBadge ms={r.avg_dwell_ms} />
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#1f1f1f]">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${(r.views / max) * 100}%`,
                  backgroundColor: "#65FFAA",
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

function DwellBadge({ ms }: { ms: number | null }) {
  if (ms === null || ms === undefined) {
    return <span className="text-[#404040]">— dwell</span>;
  }
  // Color by dwell tier: < 2s glance, 2-10s skim, > 10s read.
  const tier = ms < 2000 ? "glance" : ms < 10_000 ? "skim" : "read";
  const color = tier === "glance" ? "#909090" : tier === "skim" ? "#F5C542" : "#42CA80";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm border px-1 py-px text-[9px] uppercase tracking-wider"
      style={{ borderColor: `${color}40`, backgroundColor: `${color}10`, color }}
    >
      {formatDwell(ms)}
    </span>
  );
}

function DrillDownCard({ rows }: { rows: DrillDownRow[] }) {
  // Horizontal bar chart — drill-down popover variants ordered by count.
  const chartData = useMemo(
    () => rows.map((r) => ({ name: r.variant, value: r.count, users: r.unique_users })),
    [rows],
  );
  return (
    <CardShell
      title="Drill-Down Activity"
      subtitle="Pod Snapshot popover opens by variant"
      icon={MousePointerClick}
      iconColor="#8FB5D9"
      empty={rows.length === 0}
    >
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
            <XAxis
              type="number"
              stroke="#404040"
              fontSize={10}
              tickLine={false}
              axisLine={{ stroke: "#2a2a2a" }}
            />
            <YAxis
              type="category"
              dataKey="name"
              stroke="#909090"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              width={80}
            />
            <RTooltip
              cursor={{ fill: "#1a1a1a" }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              content={((props: any) => {
                if (!props.active || !props.payload?.length) return null;
                const p = props.payload[0];
                const variant = p?.payload?.variant ?? "";
                const opens = Number(p?.value ?? 0);
                const users = Number(p?.payload?.users ?? 0);
                return (
                  <div
                    style={{
                      backgroundColor: "#0a0a0a",
                      border: "1px solid #2a2a2a",
                      borderRadius: 6,
                      padding: "8px 10px",
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                      minWidth: 160,
                    }}
                  >
                    <div
                      style={{
                        color: "#909090",
                        marginBottom: 6,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        fontSize: 10,
                      }}
                    >
                      {variant}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <span style={{ color: "#C4BCAA" }}>Opens</span>
                      <span
                        style={{
                          color: "#FFFFFF",
                          fontWeight: 600,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {opens.toLocaleString()}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 2 }}>
                      <span style={{ color: "#C4BCAA" }}>Unique users</span>
                      <span
                        style={{
                          color: "#FFFFFF",
                          fontWeight: 600,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {users.toLocaleString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            />
            <Bar dataKey="value" fill="#8FB5D9" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </CardShell>
  );
}

function ClickInteractionsCard({ rows }: { rows: ClickInteractionRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <CardShell
      title="Click Interactions"
      subtitle="Toggles, chart controls, button clicks"
      icon={MousePointerClick}
      iconColor="#F28D59"
      empty={rows.length === 0}
    >
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={`${r.label}|${r.section_id ?? ""}`} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0">
                <p className="truncate font-mono text-[11px] text-[#C4BCAA]" title={r.label}>
                  {r.label}
                </p>
                {r.section_id && (
                  <p className="truncate font-mono text-[9px] uppercase tracking-wider text-[#606060]">
                    {r.section_id}
                  </p>
                )}
              </span>
              <span className="flex shrink-0 items-baseline gap-2 font-mono text-[10px] tabular-nums">
                <span className="font-semibold text-white">{r.count.toLocaleString()}</span>
                <span className="text-[#606060]">{r.unique_users} u</span>
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-[#1f1f1f]">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${(r.count / max) * 100}%`, backgroundColor: "#F28D59" }}
              />
            </div>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

function CommentActivityCard({ rows }: { rows: CommentActivityRow[] }) {
  const totals = rows.reduce(
    (acc, r) => ({
      posted: acc.posted + r.posted,
      edited: acc.edited + r.edited,
      resolved: acc.resolved + r.resolved,
      deleted: acc.deleted + r.deleted,
    }),
    { posted: 0, edited: 0, resolved: 0, deleted: 0 },
  );

  const chartData = useMemo(() => rows.map((r) => ({ ...r, day: r.day })), [rows]);

  return (
    <CardShell
      title="Comment Activity"
      subtitle="Posts, edits, resolves, deletes over time"
      icon={MessageSquareText}
      iconColor="#CEBCF4"
      empty={rows.length === 0}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_1fr]">
        {/* Headline totals */}
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="Posted" value={totals.posted} color="#CEBCF4" />
          <MiniStat label="Edited" value={totals.edited} color="#A78BFA" />
          <MiniStat label="Resolved" value={totals.resolved} color="#7FE8D6" />
          <MiniStat label="Deleted" value={totals.deleted} color="#ED6958" />
        </div>
        {/* Stacked area chart */}
        <div className="h-32 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="cmt-posted" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#CEBCF4" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#CEBCF4" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="cmt-edited" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#A78BFA" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#A78BFA" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="cmt-resolved" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7FE8D6" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#7FE8D6" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="cmt-deleted" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ED6958" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#ED6958" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="day"
                stroke="#404040"
                fontSize={9}
                tickFormatter={formatDayShort}
                tickLine={false}
                axisLine={{ stroke: "#2a2a2a" }}
              />
              <YAxis stroke="#404040" fontSize={9} tickLine={false} axisLine={false} width={20} />
              <RTooltip
                content={
                  <DarkTooltip
                    labelFormatter={(l) => formatDayShort(l)}
                    showTotal
                  />
                }
              />
              <Area type="monotone" dataKey="posted" stackId="c" stroke="#CEBCF4" fill="url(#cmt-posted)" />
              <Area type="monotone" dataKey="edited" stackId="c" stroke="#A78BFA" fill="url(#cmt-edited)" />
              <Area type="monotone" dataKey="resolved" stackId="c" stroke="#7FE8D6" fill="url(#cmt-resolved)" />
              <Area type="monotone" dataKey="deleted" stackId="c" stroke="#ED6958" fill="url(#cmt-deleted)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </CardShell>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-md border border-[#2a2a2a] bg-[#0a0a0a] px-2 py-1.5">
      <p className="font-mono text-[9px] uppercase tracking-wider text-[#606060]">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-base font-bold tabular-nums" style={{ color }}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function PerUserCard({ rows }: { rows: PerUserRow[] }) {
  return (
    <CardShell
      title="Per-User Activity"
      subtitle="Most active users in the range"
      icon={Users}
      iconColor="#8FB5D9"
      empty={rows.length === 0}
    >
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-[11px] tabular-nums">
          <thead>
            <tr className="border-b border-[#1f1f1f] text-left text-[#606060]">
              <th className="pb-2 pr-3 font-normal uppercase tracking-wider">User</th>
              <th className="pb-2 pr-3 font-normal uppercase tracking-wider">Last seen</th>
              <th className="pb-2 pr-3 text-right font-normal uppercase tracking-wider">Sessions</th>
              <th className="pb-2 pr-3 text-right font-normal uppercase tracking-wider">Events</th>
              <th className="pb-2 font-normal uppercase tracking-wider">Top route</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.user_email}
                className={
                  "border-t border-[#1a1a1a] transition-colors hover:bg-[#1a1a1a]/40 " +
                  (i % 2 === 1 ? "bg-[#0a0a0a]" : "")
                }
              >
                <td className="py-2 pr-3">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold text-white">{formatEmail(r.user_email)}</span>
                    <span className="truncate text-[10px] text-[#606060]">{r.user_email}</span>
                  </div>
                </td>
                <td
                  className="py-2 pr-3 text-[#C4BCAA]"
                  title={new Date(r.last_seen_at).toLocaleString()}
                >
                  {formatRelative(r.last_seen_at)}
                </td>
                <td className="py-2 pr-3 text-right text-[#C4BCAA]">{r.sessions_count}</td>
                <td className="py-2 pr-3 text-right">
                  <span
                    className="inline-flex items-center rounded-sm border border-[#42CA80]/30 bg-[#42CA80]/10 px-1.5 py-px text-[10px] text-[#42CA80]"
                  >
                    {r.events_count.toLocaleString()}
                  </span>
                </td>
                <td className="py-2 text-[#C4BCAA]">
                  {r.top_route ? formatRoute(r.top_route) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CardShell>
  );
}

function FilterUsageCard({ rows }: { rows: FilterRow[] }) {
  const byDim = useMemo(() => {
    const m = new Map<string, FilterRow[]>();
    for (const r of rows) {
      const arr = m.get(r.dimension) ?? [];
      arr.push(r);
      m.set(r.dimension, arr);
    }
    return Array.from(m.entries()).sort(
      ([, a], [, b]) =>
        b.reduce((s, x) => s + x.count, 0) - a.reduce((s, x) => s + x.count, 0),
    );
  }, [rows]);

  return (
    <CardShell
      title="Filter Usage"
      subtitle="Which filters are used most"
      icon={MousePointerClick}
      iconColor="#F5C542"
      empty={rows.length === 0}
    >
      <ul className="space-y-3">
        {byDim.map(([dim, items]) => {
          const total = items.reduce((s, r) => s + r.count, 0);
          return (
            <li key={dim} className="space-y-1.5">
              <div className="flex items-baseline justify-between font-mono">
                <span className="text-[11px] uppercase tracking-wider text-[#C4BCAA]">
                  {dim}
                </span>
                <span className="rounded-sm border border-[#F5C542]/30 bg-[#F5C542]/10 px-1.5 py-px text-[9px] uppercase tracking-wider text-[#F5C542] tabular-nums">
                  {total.toLocaleString()} changes
                </span>
              </div>
              <ul className="space-y-0.5 border-l border-[#1f1f1f] pl-3">
                {items.slice(0, 5).map((r) => {
                  const pct = total > 0 ? (r.count / total) * 100 : 0;
                  return (
                    <li
                      key={`${dim}|${r.value}`}
                      className="flex items-baseline justify-between font-mono text-[10px]"
                    >
                      <span className="truncate text-[#909090]" title={r.value}>
                        {r.value}
                      </span>
                      <span className="flex items-baseline gap-2 tabular-nums">
                        <span className="text-[#606060]">{pct.toFixed(0)}%</span>
                        <span className="text-[#C4BCAA]">{r.count}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </CardShell>
  );
}

function ReturnCadenceCard({ rows }: { rows: ReturnCadenceRow[] }) {
  return (
    <CardShell
      title="Return Cadence"
      subtitle="Median days between consecutive visits"
      icon={RefreshCw}
      iconColor="#7FE8D6"
      empty={rows.length === 0}
    >
      <table className="w-full font-mono text-[11px] tabular-nums">
        <thead>
          <tr className="border-b border-[#1f1f1f] text-left text-[#606060]">
            <th className="pb-2 font-normal uppercase tracking-wider">User</th>
            <th className="pb-2 text-right font-normal uppercase tracking-wider">Visits</th>
            <th className="pb-2 text-right font-normal uppercase tracking-wider">Median gap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.user_email}
              className={
                "border-t border-[#1a1a1a] " + (i % 2 === 1 ? "bg-[#0a0a0a]" : "")
              }
            >
              <td className="py-1.5 pr-2 text-white">{formatEmail(r.user_email)}</td>
              <td className="py-1.5 pr-2 text-right text-[#C4BCAA]">{r.visits}</td>
              <td className="py-1.5 text-right">
                <CadenceBadge days={r.median_gap_days} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </CardShell>
  );
}

function CadenceBadge({ days }: { days: number }) {
  // Colour by tier: < 2 days = daily, 2-7 = weekly, > 7 = occasional.
  const tier = days < 2 ? "daily" : days < 7 ? "weekly" : "occasional";
  const color = tier === "daily" ? "#42CA80" : tier === "weekly" ? "#F5C542" : "#ED6958";
  return (
    <span
      className="inline-flex items-center rounded-sm border px-1.5 py-px text-[10px] uppercase tracking-wider tabular-nums"
      style={{ borderColor: `${color}40`, backgroundColor: `${color}10`, color }}
    >
      {days.toFixed(1)}d
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tracking Coverage tab — static inventory of every trackable event in
// the Hub, with current status + recommended next batch. Read-only docs
// page; no API calls. Source of truth lives here (not in markdown) so
// the matrix and the actual `trackEvent` call sites stay in sync — when
// we add tracking to a new surface, we flip the entry's status here.
// ─────────────────────────────────────────────────────────────────────────────

type CoverageStatus = "tracked" | "partial" | "missing";

interface CoverageEntry {
  event: string;
  status: CoverageStatus;
  where: string;
  notes?: string;
}

interface CoverageCategory {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  summary: string;
  rows: CoverageEntry[];
}

const COVERAGE: CoverageCategory[] = [
  {
    title: "Navigation",
    icon: Eye,
    iconColor: "#65FFAA",
    summary: "Page entry events. Most basic signal.",
    rows: [
      {
        event: "PageView (any route)",
        status: "tracked",
        where: "(app)/layout.tsx PageViewTracker",
        notes: "Fires on every URL change incl. query-param changes",
      },
      {
        event: "Sub-tab switch (Contract & Timeline / Deliverables vs SOW)",
        status: "missing",
        where: "Editorial Clients tab toggle",
        notes: "Currently invisible — tab swap doesn't change the route",
      },
      {
        event: "Sidebar item click",
        status: "partial",
        where: "Sidebar.tsx",
        notes: "Tracked indirectly via PageView; no hover-without-click signal",
      },
    ],
  },
  {
    title: "Section visibility + dwell",
    icon: Layers,
    iconColor: "#65FFAA",
    summary: "SectionEntered + SectionViewed (with dwell_ms) per section.",
    rows: [
      { event: "Overview · period-snapshot", status: "tracked", where: "useSectionDwell" },
      { event: "Overview · production-history", status: "tracked", where: "useSectionDwell" },
      { event: "Overview · pod-pace", status: "tracked", where: "useSectionDwell" },
      { event: "Editorial Clients · delivery-overview", status: "tracked", where: "useSectionDwellById" },
      { event: "Editorial Clients · cumulative-pipeline", status: "tracked", where: "useSectionDwellById" },
      { event: "Editorial Clients · monthly-goals", status: "tracked", where: "useSectionDwellById" },
      { event: "Editorial Clients · contract-timeline", status: "tracked", where: "useSectionDwellById" },
      { event: "Team KPIs · ai-flagged / ai-rewrites / ai-surfer", status: "tracked", where: "useSectionDwellById" },
      {
        event: "Capacity Planning sub-pages",
        status: "missing",
        where: "—",
        notes: "Allocation / Leave / Overrides / Weekly Actuals / Roster / etc.",
      },
      { event: "Data Management sub-pages", status: "missing", where: "—" },
      {
        event: "Admin · Access Control tabs",
        status: "missing",
        where: "—",
        notes: "Groups / Users × Views / Audit Log",
      },
      {
        event: "Admin · Data Quality tabs",
        status: "missing",
        where: "—",
        notes: "End-date drift / Delivered drift / Pod History / Modeling Limitations",
      },
    ],
  },
  {
    title: "Filters",
    icon: MousePointerClick,
    iconColor: "#F5C542",
    summary: "Filter-bar setters go through one choke point.",
    rows: [
      { event: "Search clients", status: "tracked", where: "FilterBar.updateParams" },
      { event: "Editorial Pod", status: "tracked", where: "same" },
      { event: "Growth Pod", status: "tracked", where: "same" },
      { event: "Status", status: "tracked", where: "same" },
      { event: "Date range", status: "tracked", where: "same" },
      {
        event: "Pod axis toggle (Editorial / Growth)",
        status: "missing",
        where: "SyncControls.PodAxisToggle",
        notes: "Global setter — not in FilterBar choke point",
      },
      { event: "Goals period selector (Pod Snapshot)", status: "missing", where: "—" },
      { event: "Per-Client Days metric dropdown", status: "missing", where: "—" },
    ],
  },
  {
    title: "Drill-downs / popovers",
    icon: MousePointerClick,
    iconColor: "#8FB5D9",
    summary: "Click-anchored popovers and detail expanders.",
    rows: [
      {
        event: "Pod Snapshot cell click",
        status: "tracked",
        where: "PeriodSnapshotSection.openCell",
        notes: "variant (lastQ / currentQ / goals / lifetime / client) in props",
      },
      {
        event: "Pod Timelines client click (click-to-focus)",
        status: "missing",
        where: "—",
        notes: "High-signal — surfaces who the team focuses on",
      },
      { event: "Time-to-Metrics card hover (cross-card highlight)", status: "missing", where: "—" },
      { event: "Per-Client Days bar click", status: "missing", where: "—" },
      { event: "Contract Timeline milestone click", status: "missing", where: "—" },
      {
        event: "Client Delivery card click",
        status: "missing",
        where: "—",
        notes: "Cards below Delivery Overview on Editorial Clients",
      },
      { event: "Cumulative Pipeline section drill-down", status: "missing", where: "—" },
      { event: "Production History tooltip hover", status: "missing", where: "—" },
    ],
  },
  {
    title: "Toggle / chart / button clicks",
    icon: MousePointerClick,
    iconColor: "#F28D59",
    summary: "Explicit interactive clicks via trackClick(label).",
    rows: [
      {
        event: "Production History view toggle (All / Per pod / Per client)",
        status: "tracked",
        where: "ProductionTrendChart.ViewModeToggle",
      },
      { event: "Pod axis toggle (Editorial / Growth)", status: "missing", where: "—" },
      { event: "SectionIndex anchor click", status: "missing", where: "—" },
      {
        event: "Comment icon click (open popover)",
        status: "partial",
        where: "—",
        notes: "Comment*-actions are tracked, but not the icon click itself; can't measure abandon rate",
      },
      { event: "Link cards toggle (Time to Milestones)", status: "missing", where: "—" },
      { event: "Time-to-Metrics contributor popup open", status: "missing", where: "—" },
      { event: "Help modal open", status: "missing", where: "—" },
      { event: "Version chip click (opens Help/Changelog)", status: "missing", where: "—" },
      {
        event: "Pod row expand/collapse (Pod Snapshot)",
        status: "missing",
        where: "—",
        notes: "Per-client breakdown — high-signal",
      },
      { event: "Admin Analytics range tab (this page)", status: "missing", where: "—" },
    ],
  },
  {
    title: "Write actions",
    icon: AlertCircle,
    iconColor: "#ED6958",
    summary: "Mutations + sync actions.",
    rows: [
      { event: "Comment posted", status: "tracked", where: "useOverviewComments.create" },
      { event: "Comment edited", status: "tracked", where: "useOverviewComments.update" },
      { event: "Comment resolved", status: "tracked", where: "useOverviewComments.resolve" },
      { event: "Comment deleted", status: "tracked", where: "useOverviewComments.remove" },
      {
        event: "Comment composer opened",
        status: "missing",
        where: "—",
        notes: "Lets us compute post-abandon rate (opened but didn't post)",
      },
      { event: "SYNC clicked", status: "tracked", where: "SyncControls.handleSyncClick" },
      {
        event: "Per-step re-sync clicked",
        status: "missing",
        where: "—",
        notes: "Goals vs Delivery / Week Distribution / Team Pods / ET CP History / Backfill",
      },
      {
        event: "Re-sync step result (success / failure)",
        status: "missing",
        where: "—",
        notes: "High-signal — surfaces which steps fail in the wild",
      },
      { event: "Admin · matrix cell toggle", status: "missing", where: "—" },
      { event: "Admin · group member add/remove", status: "missing", where: "—" },
      { event: "Admin · user override set/cleared", status: "missing", where: "—" },
    ],
  },
  {
    title: "Hover / read engagement",
    icon: Eye,
    iconColor: "#42CA80",
    summary: "Lower-volume engagement signals beyond clicks.",
    rows: [
      { event: "Tooltip hover with dwell ≥ 1s", status: "missing", where: "—" },
      { event: "Card hover (without click)", status: "missing", where: "—" },
      { event: "Chart point / cell hover", status: "missing", where: "—" },
    ],
  },
  {
    title: "Errors / failures",
    icon: XCircle,
    iconColor: "#ED6958",
    summary: "What broke for users.",
    rows: [
      {
        event: "Fetch / API error (4xx / 5xx)",
        status: "missing",
        where: "—",
        notes: "Could wrap api.ts helpers to emit FetchError",
      },
      { event: "React error boundary fallback", status: "missing", where: "—" },
      { event: "Form validation rejection", status: "missing", where: "—" },
    ],
  },
  {
    title: "Session lifecycle",
    icon: RefreshCw,
    iconColor: "#7FE8D6",
    summary: "Session boundaries and idle detection.",
    rows: [
      {
        event: "SessionStart / SessionEnded",
        status: "partial",
        where: "Derivable from MIN/MAX per session_id",
        notes: "Implicit in the data; not surfaced as a named event yet",
      },
      { event: "Session length", status: "partial", where: "Derived" },
      { event: "Tab hidden / visible", status: "missing", where: "—" },
      { event: "Idle (no activity > N min)", status: "missing", where: "—" },
    ],
  },
  {
    title: "Help / docs",
    icon: ListChecks,
    iconColor: "#A78BFA",
    summary: "Where users seek help — currently invisible.",
    rows: [
      { event: "Help modal open", status: "missing", where: "—" },
      { event: "Glossary section scroll (which terms get read)", status: "missing", where: "—" },
      { event: "Changelog modal open", status: "missing", where: "—" },
    ],
  },
];

const PRIORITIZED_NEXT: Array<{ rank: number; label: string; rationale: string }> = [
  {
    rank: 1,
    label: "Pod axis toggle (Editorial / Growth)",
    rationale:
      "Currently invisible, but central to how the team works — Editorial vs Growth lens.",
  },
  {
    rank: 2,
    label: "Per-step re-sync clicks + results",
    rationale: "Surfaces which sync steps fail in the wild; complements Data Quality.",
  },
  {
    rank: 3,
    label: "Comment composer opened",
    rationale: "Enables post-abandon rate computation (opened but didn't post).",
  },
  {
    rank: 4,
    label: "Section instrumentation for Capacity Planning + Admin tabs",
    rationale: "Closes the section coverage gap across the remaining dashboards.",
  },
  {
    rank: 5,
    label: "Pod Timelines client click (click-to-focus)",
    rationale: "High-signal — surfaces who the team focuses on most often.",
  },
  {
    rank: 6,
    label: "Fetch error events",
    rationale: "Wrap api.ts to emit FetchError on 4xx/5xx — visibility into broken flows.",
  },
  {
    rank: 7,
    label: "Tooltip hover with dwell ≥ 1s",
    rationale: "Engagement signal without requiring a click.",
  },
  {
    rank: 8,
    label: "Tab visibility / idle",
    rationale: "Cleaner session-length math (excludes time-with-tab-buried).",
  },
];

const NOT_TRACKED: Array<{ label: string; reason: string }> = [
  {
    label: "Per-keystroke logging (search, comment composer)",
    reason: "High volume, low signal, privacy concern.",
  },
  {
    label: "Mouse positions / heatmaps",
    reason: "Bloats the events table by orders of magnitude.",
  },
  {
    label: "Full comment text in props",
    reason:
      "Already capped at 4 KB; comments table is the source of truth — analytics never stores comment body.",
  },
  {
    label: "Other users' visible content during preview-as",
    reason: "Already suppressed — trackEvent short-circuits when getPreviewAs() !== null.",
  },
];

function TrackingCoverageTab() {
  // Compute rollup counts per category so the summary table reads as
  // "N tracked / M total".
  const summary = useMemo(() => {
    return COVERAGE.map((cat) => {
      const tracked = cat.rows.filter((r) => r.status === "tracked").length;
      const partial = cat.rows.filter((r) => r.status === "partial").length;
      const missing = cat.rows.filter((r) => r.status === "missing").length;
      return { ...cat, tracked, partial, missing, total: cat.rows.length };
    });
  }, []);

  const grandTotals = useMemo(() => {
    const tracked = summary.reduce((s, c) => s + c.tracked, 0);
    const partial = summary.reduce((s, c) => s + c.partial, 0);
    const missing = summary.reduce((s, c) => s + c.missing, 0);
    return { tracked, partial, missing, total: tracked + partial + missing };
  }, [summary]);

  return (
    <div className="space-y-6">
      {/* Headline rollup */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile
          icon={CheckCircle2}
          label="Tracked"
          value={`${grandTotals.tracked} / ${grandTotals.total}`}
          accent="#42CA80"
          sublabel={`${Math.round((grandTotals.tracked / grandTotals.total) * 100)}% coverage`}
        />
        <KpiTile
          icon={MinusCircle}
          label="Partial"
          value={`${grandTotals.partial}`}
          accent="#F5C542"
          sublabel="Indirectly captured or low-signal"
        />
        <KpiTile
          icon={XCircle}
          label="Missing"
          value={`${grandTotals.missing}`}
          accent="#ED6958"
          sublabel="No instrumentation yet"
        />
      </div>

      {/* Category rollup table */}
      <CardShell
        title="Coverage by Category"
        subtitle="How instrumented each surface is today"
        icon={ListChecks}
        iconColor="#42CA80"
      >
        <ul className="space-y-1.5">
          {summary.map((cat) => {
            const pct = (cat.tracked / cat.total) * 100;
            return (
              <li key={cat.title} className="grid grid-cols-[1fr_auto] items-center gap-3 py-1.5 border-t border-[#1a1a1a] first:border-t-0">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] uppercase tracking-wider text-[#C4BCAA]">
                    {cat.title}
                  </p>
                  <p className="truncate font-mono text-[10px] text-[#606060]">
                    {cat.summary}
                  </p>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-[#1f1f1f]">
                    <div className="flex h-full">
                      <div
                        className="h-full bg-[#42CA80]"
                        style={{ width: `${(cat.tracked / cat.total) * 100}%` }}
                      />
                      <div
                        className="h-full bg-[#F5C542]"
                        style={{ width: `${(cat.partial / cat.total) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
                <span className="font-mono text-[10px] tabular-nums text-[#909090]">
                  <span className="text-[#42CA80]">{cat.tracked}</span>
                  <span className="text-[#606060]"> / </span>
                  <span className="text-[#C4BCAA]">{cat.total}</span>
                  <span className="ml-1 text-[#606060]">({Math.round(pct)}%)</span>
                </span>
              </li>
            );
          })}
        </ul>
      </CardShell>

      {/* Recommended next batch */}
      <CardShell
        title="Recommended Next Batch"
        subtitle="Prioritised list of additions if we ship another round"
        icon={TrendingUp}
        iconColor="#65FFAA"
      >
        <ul className="space-y-2">
          {PRIORITIZED_NEXT.map((p) => (
            <li
              key={p.rank}
              className="flex items-start gap-3 rounded-md border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#65FFAA]/30 bg-[#65FFAA]/10 font-mono text-[10px] font-bold text-[#65FFAA] tabular-nums">
                {p.rank}
              </span>
              <div className="min-w-0">
                <p className="font-mono text-[11px] uppercase tracking-wider text-[#C4BCAA]">
                  {p.label}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-[#909090]">
                  {p.rationale}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </CardShell>

      {/* Detailed per-category tables */}
      <div className="space-y-4">
        {COVERAGE.map((cat) => (
          <CoverageCategoryCard key={cat.title} cat={cat} />
        ))}
      </div>

      {/* Intentionally not tracked */}
      <CardShell
        title="Intentionally Not Tracked"
        subtitle="Cost / privacy / signal-to-noise reasons"
        icon={MinusCircle}
        iconColor="#606060"
      >
        <ul className="space-y-2">
          {NOT_TRACKED.map((n) => (
            <li
              key={n.label}
              className="flex items-start gap-3 rounded-md border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2"
            >
              <MinusCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#606060]" />
              <div>
                <p className="font-mono text-[11px] uppercase tracking-wider text-[#909090]">
                  {n.label}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-[#606060]">
                  {n.reason}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </CardShell>
    </div>
  );
}

function CoverageCategoryCard({ cat }: { cat: CoverageCategory }) {
  return (
    <CardShell
      title={cat.title}
      subtitle={cat.summary}
      icon={cat.icon}
      iconColor={cat.iconColor}
    >
      <table className="w-full font-mono text-[11px]">
        <thead>
          <tr className="border-b border-[#1f1f1f] text-left text-[#606060]">
            <th className="pb-2 pr-3 font-normal uppercase tracking-wider w-12">Status</th>
            <th className="pb-2 pr-3 font-normal uppercase tracking-wider">Event</th>
            <th className="pb-2 font-normal uppercase tracking-wider">Where</th>
          </tr>
        </thead>
        <tbody>
          {cat.rows.map((r) => (
            <tr key={r.event} className="border-t border-[#1a1a1a]">
              <td className="py-2 pr-3 align-top">
                <CoverageStatusBadge status={r.status} />
              </td>
              <td className="py-2 pr-3 align-top">
                <p className="text-[#C4BCAA]">{r.event}</p>
                {r.notes && (
                  <p className="mt-0.5 text-[10px] text-[#606060] leading-snug">
                    {r.notes}
                  </p>
                )}
              </td>
              <td className="py-2 align-top font-mono text-[10px] text-[#909090]">
                {r.where}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </CardShell>
  );
}

function CoverageStatusBadge({ status }: { status: CoverageStatus }) {
  if (status === "tracked") {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm border border-[#42CA80]/40 bg-[#42CA80]/10 px-1.5 py-px text-[9px] uppercase tracking-wider text-[#42CA80]">
        <CheckCircle2 className="h-3 w-3" /> Tracked
      </span>
    );
  }
  if (status === "partial") {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm border border-[#F5C542]/40 bg-[#F5C542]/10 px-1.5 py-px text-[9px] uppercase tracking-wider text-[#F5C542]">
        <MinusCircle className="h-3 w-3" /> Partial
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-[#ED6958]/40 bg-[#ED6958]/10 px-1.5 py-px text-[9px] uppercase tracking-wider text-[#ED6958]">
      <XCircle className="h-3 w-3" /> Missing
    </span>
  );
}

