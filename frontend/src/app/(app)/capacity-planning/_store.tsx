"use client";

/**
 * Client-side store for the Capacity Planning v2 PROPOSAL only.
 *
 * Backed by localStorage so the maintainer can click around, make edits,
 * refresh, and see persistence — but **nothing is written to the DB**.
 * Resetting the store returns to the mock seed data.
 *
 * Shape mirrors the proposed cp2_* schema so the real API can drop in
 * later without UI refactor.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  MOCK_DATA,
  MONTH_LABELS,
  UNASSIGNED_CLIENTS_BY_MONTH,
  type ClientChip,
  type MemberRow,
  type MonthKey,
  type PodBoard,
  type Role,
} from "./_mock";

const STORAGE_KEY = "cp2.proposal.v1";
const SELECTED_MONTH_KEY = "cp2.proposal.selectedMonth";
const CLOSED_MONTHS_KEY = "cp2.proposal.closedMonths";
const LEAVES_KEY = "cp2.proposal.leaves";
const OVERRIDES_KEY = "cp2.proposal.overrides";
const WEEKLY_KEY = "cp2.proposal.weeklyActuals";
const DIMS_KEY = "cp2.proposal.dims";
const DELIVERY_KEY = "cp2.proposal.deliveryMonthly";
const KPI_SCORES_KEY = "cp2.proposal.kpiScores";
const ARTICLES_KEY = "cp2.proposal.articles";
const AI_SCANS_KEY = "cp2.proposal.aiScans";
const SURFER_KEY = "cp2.proposal.surferUsage";
const PIPELINE_KEY = "cp2.proposal.pipelineSnapshots";

export type LeaveReason = "PTO" | "Parental" | "Sick" | "Other";

export type LeaveRow = {
  id: number;
  teamMemberId: number;
  monthKey: string;
  leaveShare: number;
  reason: LeaveReason;
  notes?: string;
};

export type OverrideRow = {
  id: number;
  monthKey: string;
  teamMemberId: number | null;
  podId: number | null;
  deltaArticles: number;
  reason: string;
  createdBy: string;
  createdAt: string;
};

export type WeeklyActualRow = {
  id: number;
  weekKey: string;
  clientId: number;
  podId: number | null;
  deliveredArticles: number;
  goalArticles: number;
  ingestedAt: string;
};

export type DeliveryMonthlyRow = {
  id: number;
  monthKey: string;
  clientId: number;
  articlesSowTarget: number;
  articlesDelivered: number;
  articlesInvoiced: number;
  articlesPaid: number;
  articlesProjected: number | null;
  isActual: boolean;
  contentBriefsDelivered: number;
  contentBriefsGoal: number;
  notes: string;
};

export type KpiScoreRow = {
  id: number;
  monthKey: string;
  teamMemberId: number;
  metricId: number;
  clientId: number | null;
  score: number | null;
  targetSnapshot: number;
  source: "manual" | "notion" | "ai_scan" | "capacity";
  enteredBy: string | null;
  enteredAt: string;
  notes: string;
};

export type ArticleStatus = "drafting" | "review" | "delivered" | "published" | "killed";

export type ArticleRow = {
  id: number;
  notionCaseId: string;
  clientId: number;
  podId: number | null;
  writerId: number | null;
  editorId: number | null;
  srEditorId: number | null;
  monthKey: string;
  title: string;
  cbApprovedDate: string | null;
  deliveredDate: string | null;
  publishedDate: string | null;
  turnaroundDays: number | null;
  revisionCount: number;
  hadSecondReview: boolean;
  status: ArticleStatus;
  notionUrl: string;
};

export type AiRecommendation = "FULL_PASS" | "PARTIAL_PASS" | "REVIEW_REWRITE";

export type AiScanRow = {
  id: number;
  articleId: number | null;
  clientId: number;
  podId: number | null;
  monthKey: string;
  topicTitle: string;
  writerName: string;
  editorName: string;
  dateProcessed: string;
  surferV1Score: number | null;
  surferV2Score: number | null;
  recommendation: AiRecommendation;
  isRewrite: boolean;
  isFlagged: boolean;
  action: string;
  notes: string;
};

export type SurferUsageRow = {
  id: number;
  yearMonthKey: string;
  pod1: number;
  pod2: number;
  pod3: number;
  pod4: number;
  pod5: number;
  auditioningWriters: number;
  rewrites: number;
  totalSpent: number;
  remainingCalls: number | null;
};

export type PipelineSnapshotRow = {
  id: number;
  snapshotDate: string;
  clientId: number;
  topicsSubmitted: number;
  topicsApproved: number;
  cbsSubmitted: number;
  cbsApproved: number;
  articlesSent: number;
  articlesApproved: number;
  articlesDelivered: number;
  articlesPublished: number;
  articlesKilled: number;
  comments: string;
};

// ---------------------------------------------------------------------------
// Dim tables — admin-managed reference data.
// ---------------------------------------------------------------------------

export type DimMember = {
  id: number;
  full_name: string;
  email: string;
  role_default: "SE" | "ED" | "WR" | "AD" | "PM";
  default_monthly_capacity_articles: number;
  start_month: string;
  end_month: string | null;
  is_active: boolean;
  notes: string;
};

export type DimPod = {
  id: number;
  pod_number: number;
  display_name: string;
  active_from: string;
  active_to: string | null;
  notes: string;
};

export type ClientStatus =
  | "ACTIVE"
  | "COMPLETED"
  | "CANCELLED"
  | "SOON_TO_BE_ACTIVE"
  | "INACTIVE";

export type DimClient = {
  id: number;
  client_id_fk: number;
  name: string;
  domain: string | null;
  status: ClientStatus;
  growth_pod: string | null;
  editorial_pod: string | null;
  engagement_tier_id: number | null;
  project_type: string | null;
  cadence: "quarterly" | "monthly" | "custom";
  cadence_q1: number | null;
  cadence_q2: number | null;
  cadence_q3: number | null;
  cadence_q4: number | null;
  term_months: number | null;
  sow_articles_total: number;
  sow_articles_per_month: number;
  word_count_min: number | null;
  word_count_max: number | null;
  sow_link: string | null;
  contract_start: string;
  contract_end: string;
  consulting_ko_date: string | null;
  editorial_ko_date: string | null;
  first_cb_approved_date: string | null;
  first_article_delivered_date: string | null;
  first_feedback_date: string | null;
  first_article_published_date: string | null;
  managing_director: string | null;
  account_director: string | null;
  account_manager: string | null;
  jr_am: string | null;
  cs_team: string | null;
  articles_delivered: number;
  articles_invoiced: number;
  articles_paid: number;
  is_active_in_cp2: boolean;
  comments: string | null;
};

export type DimEngagementTier = {
  id: number;
  name: string;
  description: string;
};

export type DimKpiMetric = {
  id: number;
  metric_key: string;
  display_name: string;
  unit: "percent" | "score" | "days" | "count";
  target_value: number;
  direction: "higher_is_better" | "lower_is_better" | "band";
  formula: string;
  applies_to_roles: string;
};

export type DimsShape = {
  members: DimMember[];
  pods: DimPod[];
  clients: DimClient[];
  tiers: DimEngagementTier[];
  metrics: DimKpiMetric[];
};

export type DimKind = keyof DimsShape;

export type DimRow<K extends DimKind> = DimsShape[K][number];

// ---------------------------------------------------------------------------
// Month range — computed ±6 months from "today" so the picker follows the
// calendar, not a hardcoded window. Mocked months (MONTHS) still have data;
// other months just render empty state.
// ---------------------------------------------------------------------------

export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map((n) => parseInt(n, 10));
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthRange(center: string, before: number, after: number): string[] {
  const out: string[] = [];
  for (let i = -before; i <= after; i++) out.push(shiftMonth(center, i));
  return out;
}

export function monthLabel(monthKey: string): string {
  // Prefer pre-baked label; otherwise format from Date.
  if (monthKey in MONTH_LABELS) return MONTH_LABELS[monthKey as MonthKey];
  const [y, m] = monthKey.split("-").map((n) => parseInt(n, 10));
  const d = new Date(y, m - 1, 1);
  return `${d.toLocaleString("en-US", { month: "short" })} ${d.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// Week helpers — ISO weeks keyed as YYYY-Www (e.g. 2026-W14).
// ---------------------------------------------------------------------------

function isoWeekOf(date: Date): { year: number; week: number } {
  // Algorithm per ISO 8601.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

export function weekKeyOf(date: Date): string {
  const { year, week } = isoWeekOf(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** First day (Monday) of an ISO week. */
function dateOfIsoWeek(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7);
  return monday;
}

/** Return all ISO weeks whose Thursday lies inside the given YYYY-MM. */
export function weeksInMonth(monthKey: string): Array<{
  weekKey: string;
  start: Date;
  end: Date;
  label: string;
}> {
  const [y, m] = monthKey.split("-").map((n) => parseInt(n, 10));
  const firstOfMonth = new Date(Date.UTC(y, m - 1, 1));
  const lastOfMonth = new Date(Date.UTC(y, m, 0));
  const { year: startYear, week: startWeek } = isoWeekOf(firstOfMonth);
  const { year: endYear, week: endWeek } = isoWeekOf(lastOfMonth);

  const weeks: Array<{ weekKey: string; start: Date; end: Date; label: string }> = [];
  let yr = startYear;
  let wk = startWeek;
  while (yr < endYear || (yr === endYear && wk <= endWeek)) {
    const start = dateOfIsoWeek(yr, wk);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    weeks.push({
      weekKey: `${yr}-W${String(wk).padStart(2, "0")}`,
      start,
      end,
      label: `W${wk}`,
    });
    // advance
    const next = new Date(start);
    next.setUTCDate(start.getUTCDate() + 7);
    const iso = isoWeekOf(next);
    yr = iso.year;
    wk = iso.week;
    if (weeks.length > 6) break; // safety
  }
  return weeks;
}

/** Return the last N ISO week keys ending at (and including) weekKey. */
export function previousWeeks(weekKey: string, count: number): string[] {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!m) return [];
  let yr = parseInt(m[1], 10);
  let wk = parseInt(m[2], 10);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.unshift(`${yr}-W${String(wk).padStart(2, "0")}`);
    wk -= 1;
    if (wk <= 0) {
      yr -= 1;
      // Approx: most years have 52 weeks, some 53. Good enough for sparklines.
      wk = 52;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type StoreShape = {
  monthly: Record<string, PodBoard[]>;
  unassigned: Record<string, ClientChip[]>;
};

function seed(): StoreShape {
  return JSON.parse(
    JSON.stringify({ monthly: MOCK_DATA, unassigned: UNASSIGNED_CLIENTS_BY_MONTH }),
  );
}

function load(): StoreShape {
  if (typeof window === "undefined") return seed();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed();
    const parsed = JSON.parse(raw);
    if (parsed && parsed.monthly && parsed.unassigned) return parsed;
    return seed();
  } catch {
    return seed();
  }
}

function loadSelectedMonth(fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(SELECTED_MONTH_KEY) ?? fallback;
  } catch {
    return fallback;
  }
}

function loadClosedMonths(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CLOSED_MONTHS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function loadLeaves(): Record<string, LeaveRow[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LEAVES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, LeaveRow[]>) : {};
  } catch {
    return {};
  }
}

function loadOverrides(): Record<string, OverrideRow[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(OVERRIDES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, OverrideRow[]>) : {};
  } catch {
    return {};
  }
}

function loadWeekly(): Record<string, WeeklyActualRow[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(WEEKLY_KEY);
    return raw ? (JSON.parse(raw) as Record<string, WeeklyActualRow[]>) : {};
  } catch {
    return {};
  }
}

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function loadDims(): DimsShape | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DIMS_KEY);
    return raw ? (JSON.parse(raw) as DimsShape) : null;
  } catch {
    return null;
  }
}

function seedDims(): DimsShape {
  // Kept local to avoid a cyclic import with _tableMocks.ts.
  const members: DimMember[] = [
    { id: 101, full_name: "Nina Derossi", email: "nina@graphitehq.com", role_default: "SE", default_monthly_capacity_articles: 12, start_month: "2024-09-01", end_month: null, is_active: true, notes: "" },
    { id: 102, full_name: "Robert Trampe", email: "robert@graphitehq.com", role_default: "ED", default_monthly_capacity_articles: 10, start_month: "2024-09-01", end_month: null, is_active: true, notes: "" },
    { id: 103, full_name: "Jimmy Bowes", email: "jimmy@graphitehq.com", role_default: "ED", default_monthly_capacity_articles: 8, start_month: "2025-02-01", end_month: null, is_active: true, notes: "split across Pod 1 and Pod 2" },
    { id: 201, full_name: "Kennedy Stevens", email: "kennedy@graphitehq.com", role_default: "SE", default_monthly_capacity_articles: 12, start_month: "2024-09-01", end_month: null, is_active: true, notes: "" },
    { id: 202, full_name: "Samantha McEniff", email: "samantha@graphitehq.com", role_default: "ED", default_monthly_capacity_articles: 10, start_month: "2024-09-01", end_month: null, is_active: true, notes: "" },
    { id: 203, full_name: "Tiffany Anderson", email: "tiffany@graphitehq.com", role_default: "ED", default_monthly_capacity_articles: 8, start_month: "2025-06-01", end_month: null, is_active: true, notes: "onboarding ramp" },
    { id: 301, full_name: "Meredith Shaw", email: "meredith@graphitehq.com", role_default: "SE", default_monthly_capacity_articles: 12, start_month: "2025-03-01", end_month: null, is_active: true, notes: "" },
    { id: 302, full_name: "Drew Anand", email: "drew@graphitehq.com", role_default: "WR", default_monthly_capacity_articles: 14, start_month: "2025-03-01", end_month: null, is_active: true, notes: "" },
    { id: 303, full_name: "Lena Voss", email: "lena@graphitehq.com", role_default: "WR", default_monthly_capacity_articles: 14, start_month: "2025-03-01", end_month: null, is_active: true, notes: "" },
  ];
  const pods: DimPod[] = [
    { id: 1, pod_number: 1, display_name: "Nina's Pod", active_from: "2024-09-01", active_to: null, notes: "" },
    { id: 2, pod_number: 2, display_name: "Kennedy's Pod", active_from: "2024-09-01", active_to: null, notes: "" },
    { id: 3, pod_number: 3, display_name: "Meredith's Pod", active_from: "2025-03-01", active_to: null, notes: "AI-sector clients" },
  ];
  const tiers: DimEngagementTier[] = [
    { id: 1, name: "Premium", description: "Full CB + article + senior review" },
    { id: 2, name: "Standard", description: "Article + editorial review" },
    { id: 3, name: "Custom", description: "Bespoke SOW — see notes" },
  ];
  const clients: DimClient[] = [
    {
      id: 1, client_id_fk: 42, name: "College of BP", domain: "collegeofbp.com",
      status: "ACTIVE", growth_pod: "growth-1", editorial_pod: "editorial-1",
      engagement_tier_id: 1, project_type: "content-program",
      cadence: "monthly", cadence_q1: 60, cadence_q2: 60, cadence_q3: 60, cadence_q4: 60,
      term_months: 12, sow_articles_total: 300, sow_articles_per_month: 25,
      word_count_min: 1500, word_count_max: 2500,
      sow_link: "https://docs.google.com/document/d/abc123",
      contract_start: "2025-01-01", contract_end: "2026-12-31",
      consulting_ko_date: "2024-12-10", editorial_ko_date: "2024-12-20",
      first_cb_approved_date: "2025-01-18", first_article_delivered_date: "2025-02-02",
      first_feedback_date: "2025-02-08", first_article_published_date: "2025-02-10",
      managing_director: "Sarah Chen", account_director: "Marcus Wang",
      account_manager: "Priya Shah", jr_am: "Luis Ortiz",
      cs_team: "Emma Park, Dan Levitt",
      articles_delivered: 312, articles_invoiced: 310, articles_paid: 295,
      is_active_in_cp2: true, comments: "",
    },
    {
      id: 2, client_id_fk: 58, name: "Harvard", domain: "harvard.edu",
      status: "ACTIVE", growth_pod: "growth-2", editorial_pod: "editorial-1",
      engagement_tier_id: 2, project_type: "thought-leadership",
      cadence: "quarterly", cadence_q1: 15, cadence_q2: 15, cadence_q3: 15, cadence_q4: 15,
      term_months: 12, sow_articles_total: 60, sow_articles_per_month: 5,
      word_count_min: 2000, word_count_max: 3000,
      sow_link: "https://docs.google.com/document/d/def456",
      contract_start: "2025-06-01", contract_end: "2026-06-30",
      consulting_ko_date: "2025-05-15", editorial_ko_date: "2025-05-28",
      first_cb_approved_date: "2025-06-14", first_article_delivered_date: "2025-06-28",
      first_feedback_date: "2025-07-05", first_article_published_date: null,
      managing_director: "Sarah Chen", account_director: "Jonathan Park",
      account_manager: "Fatima Rahman", jr_am: null, cs_team: "Dan Levitt",
      articles_delivered: 50, articles_invoiced: 50, articles_paid: 45,
      is_active_in_cp2: true, comments: "",
    },
    {
      id: 3, client_id_fk: 71, name: "Cornell", domain: "cornell.edu",
      status: "ACTIVE", growth_pod: "growth-3", editorial_pod: "editorial-1",
      engagement_tier_id: 1, project_type: "content-program",
      cadence: "monthly", cadence_q1: 30, cadence_q2: 30, cadence_q3: 30, cadence_q4: 30,
      term_months: 18, sow_articles_total: 120, sow_articles_per_month: 10,
      word_count_min: 1500, word_count_max: 2500,
      sow_link: null,
      contract_start: "2025-04-01", contract_end: "2026-10-31",
      consulting_ko_date: null, editorial_ko_date: null,
      first_cb_approved_date: null, first_article_delivered_date: null,
      first_feedback_date: null, first_article_published_date: null,
      managing_director: null, account_director: null,
      account_manager: null, jr_am: null, cs_team: null,
      articles_delivered: 60, articles_invoiced: 55, articles_paid: 50,
      is_active_in_cp2: true, comments: "",
    },
  ];
  const metrics: DimKpiMetric[] = [
    { id: 1, metric_key: "internal_quality", display_name: "Internal Quality", unit: "score", target_value: 85, direction: "higher_is_better", formula: "Manual score by SE", applies_to_roles: "SE,ED" },
    { id: 2, metric_key: "external_quality", display_name: "External Quality", unit: "score", target_value: 85, direction: "higher_is_better", formula: "Client satisfaction", applies_to_roles: "SE,ED" },
    { id: 3, metric_key: "revision_rate", display_name: "Revision Rate", unit: "percent", target_value: 15, direction: "lower_is_better", formula: "revisions / delivered × 100", applies_to_roles: "SE,ED,WR" },
    { id: 4, metric_key: "turnaround_time", display_name: "Turnaround Time", unit: "days", target_value: 14, direction: "lower_is_better", formula: "avg(delivered − cb_approved)", applies_to_roles: "SE,ED" },
    { id: 5, metric_key: "second_reviews", display_name: "Second Reviews", unit: "count", target_value: 5, direction: "higher_is_better", formula: "count(had_second_review)", applies_to_roles: "SE" },
    { id: 6, metric_key: "ai_compliance", display_name: "AI Compliance", unit: "percent", target_value: 95, direction: "higher_is_better", formula: "FULL_PASS / total × 100", applies_to_roles: "SE,ED,WR" },
    { id: 7, metric_key: "mentorship", display_name: "Mentorship", unit: "score", target_value: 80, direction: "higher_is_better", formula: "Mentorship effectiveness", applies_to_roles: "SE" },
    { id: 8, metric_key: "feedback_adoption", display_name: "Feedback Adoption", unit: "score", target_value: 80, direction: "higher_is_better", formula: "Rate of feedback incorporation", applies_to_roles: "ED" },
    { id: 9, metric_key: "capacity_utilization", display_name: "Capacity Utilization", unit: "percent", target_value: 82, direction: "band", formula: "projected / capacity × 100", applies_to_roles: "SE,ED,WR" },
  ];
  return { members, pods, clients, tiers, metrics };
}

/** Deterministic seed of weekly actuals so the grid + sparklines have data to
 *  show. Generates ~8 weeks of history per client for each month with pods. */
function deriveSeedWeeklyActuals(
  monthly: Record<string, PodBoard[]>,
): Record<string, WeeklyActualRow[]> {
  const byWeek: Record<string, WeeklyActualRow[]> = {};
  let seq = 1;
  for (const [monthKey, pods] of Object.entries(monthly)) {
    const weeks = weeksInMonth(monthKey);
    for (const pod of pods) {
      for (const client of pod.clients) {
        const perWeekGoal = Math.max(1, Math.round(client.projectedArticles / weeks.length));
        weeks.forEach(({ weekKey }, i) => {
          // Slightly varied delivery around the goal for realism.
          const jitter = ((client.id + i) % 3) - 1; // -1 | 0 | +1
          const delivered = Math.max(0, perWeekGoal + jitter);
          (byWeek[weekKey] ??= []).push({
            id: seq++,
            weekKey,
            clientId: client.id,
            podId: pod.id,
            deliveredArticles: delivered,
            goalArticles: perWeekGoal,
            ingestedAt: new Date().toISOString(),
          });
        });
      }
    }
  }
  return byWeek;
}

/** Seed delivery monthly, kpi scores, articles, ai scans, surfer, pipeline —
 *  deterministic values derived from the mock pods + clients so every editor
 *  has rows to show on first load. */
function deriveSeedMaintainData(
  monthly: Record<string, PodBoard[]>,
  dims: DimsShape,
): {
  delivery: DeliveryMonthlyRow[];
  kpi: KpiScoreRow[];
  articles: ArticleRow[];
  aiScans: AiScanRow[];
  surfer: SurferUsageRow[];
  pipeline: PipelineSnapshotRow[];
} {
  const delivery: DeliveryMonthlyRow[] = [];
  const kpi: KpiScoreRow[] = [];
  const articles: ArticleRow[] = [];
  const aiScans: AiScanRow[] = [];
  const surfer: SurferUsageRow[] = [];
  const pipeline: PipelineSnapshotRow[] = [];

  let dSeq = 1;
  let kSeq = 1;
  let aSeq = 1;
  let sSeq = 1;
  let sufSeq = 1;
  let pSeq = 1;

  // Delivery monthly — one row per (client, month) for each month that has pods.
  const seenClients = new Set<number>();
  for (const [monthKey, pods] of Object.entries(monthly)) {
    for (const pod of pods) {
      for (const client of pod.clients) {
        seenClients.add(client.id);
        const target = Math.max(3, Math.round(client.projectedArticles * 0.9));
        const delivered = Math.max(0, target - ((client.id + monthKey.length) % 3));
        const invoiced = Math.max(0, delivered - 1);
        const paid = Math.max(0, invoiced - 1);
        delivery.push({
          id: dSeq++,
          monthKey,
          clientId: client.id,
          articlesSowTarget: target,
          articlesDelivered: delivered,
          articlesInvoiced: invoiced,
          articlesPaid: paid,
          articlesProjected: target,
          isActual: true,
          contentBriefsDelivered: Math.max(0, delivered - 1),
          contentBriefsGoal: target,
          notes: "",
        });
      }
    }
  }

  // KPI scores — every active member × every metric × current seeded months.
  const MONTHS_FOR_KPI = Object.keys(monthly).filter(
    (k) => (monthly[k] ?? []).length > 0,
  );
  for (const monthKey of MONTHS_FOR_KPI) {
    for (const member of dims.members) {
      if (!member.is_active) continue;
      for (const metric of dims.metrics) {
        // Simple deterministic score around the target.
        const jitter = ((member.id + metric.id) % 7) - 3;
        const raw = metric.direction === "lower_is_better"
          ? Math.max(0, metric.target_value + jitter * 0.2)
          : Math.min(100, metric.target_value + jitter);
        kpi.push({
          id: kSeq++,
          monthKey,
          teamMemberId: member.id,
          metricId: metric.id,
          clientId: null,
          score: Math.round(raw * 10) / 10,
          targetSnapshot: metric.target_value,
          source: metric.metric_key === "ai_compliance" ? "ai_scan" :
            metric.metric_key.startsWith("revision_") || metric.metric_key.startsWith("turnaround") || metric.metric_key.startsWith("second_")
              ? "notion" : "manual",
          enteredBy: null,
          enteredAt: new Date().toISOString(),
          notes: "",
        });
      }
    }
  }

  // Articles — 2 per (pod, month) using pod.clients.
  for (const [monthKey, pods] of Object.entries(monthly)) {
    for (const pod of pods) {
      for (const client of pod.clients.slice(0, 2)) {
        const members = pod.members;
        const writer = members.find((m) => m.role === "WR") ?? members[members.length - 1];
        const editor = members.find((m) => m.role === "ED");
        const srEditor = members.find((m) => m.role === "SE");
        const revisions = (client.id + monthKey.length) % 3;
        articles.push({
          id: aSeq++,
          notionCaseId: `CASE-${String(aSeq).padStart(5, "0")}`,
          clientId: client.id,
          podId: pod.id,
          writerId: writer?.id ?? null,
          editorId: editor?.id ?? null,
          srEditorId: srEditor?.id ?? null,
          monthKey,
          title: `${client.name} · Draft ${aSeq}`,
          cbApprovedDate: `${monthKey}-02`,
          deliveredDate: `${monthKey}-${String(10 + revisions * 4).padStart(2, "0")}`,
          publishedDate: revisions === 0 ? `${monthKey}-20` : null,
          turnaroundDays: 8 + revisions * 3,
          revisionCount: revisions,
          hadSecondReview: revisions === 0,
          status: revisions === 0 ? "published" : "delivered",
          notionUrl: `https://notion.so/case-${aSeq}`,
        });
      }
    }
  }

  // AI scans — one per article, deterministic.
  for (const a of articles) {
    const s1 = 2 + (a.id % 20);
    const s2 = s1 - 1;
    const pass: AiRecommendation = s1 < 5 ? "FULL_PASS" : s1 < 12 ? "PARTIAL_PASS" : "REVIEW_REWRITE";
    aiScans.push({
      id: sSeq++,
      articleId: a.id,
      clientId: a.clientId,
      podId: a.podId,
      monthKey: a.monthKey,
      topicTitle: a.title,
      writerName: dims.members.find((m) => m.id === a.writerId)?.full_name ?? "",
      editorName: dims.members.find((m) => m.id === a.editorId)?.full_name ?? "",
      dateProcessed: a.deliveredDate ?? `${a.monthKey}-15`,
      surferV1Score: s1,
      surferV2Score: s2,
      recommendation: pass,
      isRewrite: false,
      isFlagged: pass !== "FULL_PASS",
      action: pass === "FULL_PASS" ? "publish" : "revise",
      notes: "",
    });
  }

  // Surfer API usage — one row per month with activity.
  for (const monthKey of MONTHS_FOR_KPI) {
    surfer.push({
      id: sufSeq++,
      yearMonthKey: monthKey,
      pod1: 60 + ((sufSeq * 7) % 20),
      pod2: 70 + ((sufSeq * 5) % 20),
      pod3: 55 + ((sufSeq * 3) % 20),
      pod4: 0,
      pod5: 0,
      auditioningWriters: 8 + (sufSeq % 6),
      rewrites: 12 + (sufSeq % 8),
      totalSpent: 220 + ((sufSeq * 11) % 30),
      remainingCalls: 180 - ((sufSeq * 11) % 30),
    });
  }

  // Pipeline snapshots — latest snapshot per client that appears in mock.
  const snapshotDate = new Date().toISOString().slice(0, 10);
  for (const clientId of seenClients) {
    const c = dims.clients.find((cc) => cc.id === clientId);
    const total = c?.sow_articles_total ?? 200;
    pipeline.push({
      id: pSeq++,
      snapshotDate,
      clientId,
      topicsSubmitted: total + 20,
      topicsApproved: total + 10,
      cbsSubmitted: total + 5,
      cbsApproved: total + 3,
      articlesSent: total - 5,
      articlesApproved: total - 8,
      articlesDelivered: total - 5,
      articlesPublished: Math.max(0, total - 30),
      articlesKilled: 5,
      comments: "",
    });
  }

  return { delivery, kpi, articles, aiScans, surfer, pipeline };
}

/** Seed leaves + overrides from the flat MemberRow fields so the proposal
 *  pages have example rows to show on day 1. */
function deriveSeedLeavesOverrides(
  monthly: Record<string, PodBoard[]>,
): { leaves: Record<string, LeaveRow[]>; overrides: Record<string, OverrideRow[]> } {
  const leaves: Record<string, LeaveRow[]> = {};
  const overrides: Record<string, OverrideRow[]> = {};
  let leaveSeq = 1;
  let overrideSeq = 1;

  for (const [monthKey, pods] of Object.entries(monthly)) {
    const seenLeaveMembers = new Set<number>();
    for (const pod of pods) {
      for (const m of pod.members) {
        if (m.leaveShare > 0 && !seenLeaveMembers.has(m.id)) {
          (leaves[monthKey] ??= []).push({
            id: leaveSeq++,
            teamMemberId: m.id,
            monthKey,
            leaveShare: m.leaveShare,
            reason: "PTO",
          });
          seenLeaveMembers.add(m.id);
        }
        if (m.overrideDelta !== 0) {
          (overrides[monthKey] ??= []).push({
            id: overrideSeq++,
            monthKey,
            teamMemberId: m.id,
            podId: null,
            deltaArticles: m.overrideDelta,
            reason: "Seed data",
            createdBy: "system",
            createdAt: new Date().toISOString(),
          });
        }
      }
    }
  }
  return { leaves, overrides };
}

type CP2StoreCtx = {
  state: StoreShape;
  resetToSeed: () => void;

  // Unified month context
  selectedMonth: string;
  setSelectedMonth: (m: string) => void;
  goToCurrentMonth: () => void;
  monthOptions: string[];

  // Close-month workflow
  closedMonths: string[];
  isMonthClosed: (m: string) => boolean;
  closeMonth: (m: string) => void;
  reopenMonth: (m: string) => void;

  // Membership
  updateMember: (
    month: MonthKey,
    podId: number,
    memberId: number,
    patch: Partial<MemberRow>,
  ) => void;
  addMember: (month: MonthKey, podId: number, member: MemberRow) => void;
  removeMember: (month: MonthKey, podId: number, memberId: number) => void;
  // Allocation
  moveClient: (
    month: MonthKey,
    fromPodId: number | "unassigned",
    toPodId: number | "unassigned",
    clientId: number,
  ) => void;
  updateClient: (
    month: MonthKey,
    podId: number | "unassigned",
    clientId: number,
    patch: Partial<ClientChip>,
  ) => void;
  setActualDelivered: (month: MonthKey, podId: number, value: number) => void;
  copyMonthForward: (source: string, count: number) => void;
  copyFromPreviousMonth: (target: string) => void;

  // Leaves + overrides — separate arrays mirroring the cp2 schema.
  leaves: Record<string, LeaveRow[]>;
  overrides: Record<string, OverrideRow[]>;
  setLeave: (
    teamMemberId: number,
    monthKey: string,
    leaveShare: number,
    reason: LeaveReason,
    notes?: string,
  ) => void;
  removeLeave: (teamMemberId: number, monthKey: string) => void;
  addOverride: (
    row: Omit<OverrideRow, "id" | "createdAt">,
  ) => void;
  removeOverride: (id: number) => void;

  // Weekly actuals
  weeklyActuals: Record<string, WeeklyActualRow[]>;
  setWeeklyActual: (
    weekKey: string,
    clientId: number,
    podId: number | null,
    patch: { deliveredArticles?: number; goalArticles?: number },
  ) => void;
  importWeeklyFromSheet: () => void;

  // Dims (admin-managed reference data)
  dims: DimsShape;
  addDimRow: <K extends DimKind>(kind: K, row: Omit<DimRow<K>, "id">) => void;
  updateDimRow: <K extends DimKind>(kind: K, row: DimRow<K>) => void;
  deleteDimRow: <K extends DimKind>(kind: K, id: number) => void;

  // Delivery monthly — editable client × month grid
  deliveryMonthly: DeliveryMonthlyRow[];
  upsertDelivery: (
    monthKey: string,
    clientId: number,
    patch: Partial<Omit<DeliveryMonthlyRow, "id" | "monthKey" | "clientId">>,
  ) => void;

  // KPI scores — editable member × month × metric matrix
  kpiScores: KpiScoreRow[];
  upsertKpiScore: (
    monthKey: string,
    teamMemberId: number,
    metricId: number,
    clientId: number | null,
    patch: Partial<Pick<KpiScoreRow, "score" | "targetSnapshot" | "source" | "notes">>,
  ) => void;

  // Articles (workflow rows)
  articles: ArticleRow[];
  addArticle: (row: Omit<ArticleRow, "id">) => void;
  updateArticle: (id: number, patch: Partial<ArticleRow>) => void;
  deleteArticle: (id: number) => void;

  // AI scans
  aiScans: AiScanRow[];
  addAiScan: (row: Omit<AiScanRow, "id">) => void;
  updateAiScan: (id: number, patch: Partial<AiScanRow>) => void;
  deleteAiScan: (id: number) => void;

  // Surfer usage — single row per month
  surferUsage: SurferUsageRow[];
  upsertSurferUsage: (
    yearMonthKey: string,
    patch: Partial<Omit<SurferUsageRow, "id" | "yearMonthKey">>,
  ) => void;

  // Pipeline snapshots — latest per client
  pipelineSnapshots: PipelineSnapshotRow[];
  upsertPipelineSnapshot: (
    clientId: number,
    patch: Partial<Omit<PipelineSnapshotRow, "id" | "clientId">>,
  ) => void;
};

const StoreContext = createContext<CP2StoreCtx | null>(null);

export function CP2StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<StoreShape>(seed);
  const [closedMonths, setClosedMonths] = useState<string[]>([]);
  const [leaves, setLeaves] = useState<Record<string, LeaveRow[]>>({});
  const [overrides, setOverrides] = useState<Record<string, OverrideRow[]>>({});
  const [weeklyActuals, setWeeklyActuals] = useState<Record<string, WeeklyActualRow[]>>({});
  const [dims, setDims] = useState<DimsShape>(seedDims);
  const [deliveryMonthly, setDeliveryMonthly] = useState<DeliveryMonthlyRow[]>([]);
  const [kpiScores, setKpiScores] = useState<KpiScoreRow[]>([]);
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [aiScans, setAiScans] = useState<AiScanRow[]>([]);
  const [surferUsage, setSurferUsage] = useState<SurferUsageRow[]>([]);
  const [pipelineSnapshots, setPipelineSnapshots] = useState<PipelineSnapshotRow[]>([]);

  const today = useMemo(currentMonthKey, []);
  const monthOptions = useMemo(() => monthRange(today, 6, 6), [today]);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlMonth = searchParams.get("m");

  // Initial selected month: URL > localStorage > today
  const [selectedMonth, setSelectedMonthState] = useState<string>(today);

  useEffect(() => {
    const loaded = load();
    setState(loaded);
    setClosedMonths(loadClosedMonths());

    const storedLeaves = loadLeaves();
    const storedOverrides = loadOverrides();
    if (Object.keys(storedLeaves).length === 0 && Object.keys(storedOverrides).length === 0) {
      // First-time hydration — seed from the flat MemberRow fields.
      const derived = deriveSeedLeavesOverrides(loaded.monthly);
      setLeaves(derived.leaves);
      setOverrides(derived.overrides);
    } else {
      setLeaves(storedLeaves);
      setOverrides(storedOverrides);
    }

    const storedWeekly = loadWeekly();
    if (Object.keys(storedWeekly).length === 0) {
      setWeeklyActuals(deriveSeedWeeklyActuals(loaded.monthly));
    } else {
      setWeeklyActuals(storedWeekly);
    }

    const storedDims = loadDims();
    const activeDims = storedDims ?? seedDims();
    if (storedDims) setDims(storedDims);

    // Delivery / KPI / Articles / AI / Surfer / Pipeline — seed from mocks
    // if nothing in storage, else hydrate.
    const storedDelivery = loadJson<DeliveryMonthlyRow[]>(DELIVERY_KEY, []);
    const storedKpi = loadJson<KpiScoreRow[]>(KPI_SCORES_KEY, []);
    const storedArticles = loadJson<ArticleRow[]>(ARTICLES_KEY, []);
    const storedAi = loadJson<AiScanRow[]>(AI_SCANS_KEY, []);
    const storedSurfer = loadJson<SurferUsageRow[]>(SURFER_KEY, []);
    const storedPipeline = loadJson<PipelineSnapshotRow[]>(PIPELINE_KEY, []);

    if (
      storedDelivery.length === 0 &&
      storedKpi.length === 0 &&
      storedArticles.length === 0
    ) {
      const derived = deriveSeedMaintainData(loaded.monthly, activeDims);
      setDeliveryMonthly(derived.delivery);
      setKpiScores(derived.kpi);
      setArticles(derived.articles);
      setAiScans(derived.aiScans);
      setSurferUsage(derived.surfer);
      setPipelineSnapshots(derived.pipeline);
    } else {
      setDeliveryMonthly(storedDelivery);
      setKpiScores(storedKpi);
      setArticles(storedArticles);
      setAiScans(storedAi);
      setSurferUsage(storedSurfer);
      setPipelineSnapshots(storedPipeline);
    }

    const fromStorage = loadSelectedMonth(today);
    setSelectedMonthState(urlMonth && /^\d{4}-\d{2}$/.test(urlMonth) ? urlMonth : fromStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep URL in sync with selectedMonth (scroll: false so nav doesn't jump)
  useEffect(() => {
    if (!pathname) return;
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("m") === selectedMonth) return;
    params.set("m", selectedMonth);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [selectedMonth, pathname, router, searchParams]);

  // Persist state + selected month
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore quota errors
    }
  }, [state]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SELECTED_MONTH_KEY, selectedMonth);
    } catch {
      // ignore
    }
  }, [selectedMonth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(CLOSED_MONTHS_KEY, JSON.stringify(closedMonths));
    } catch {
      // ignore
    }
  }, [closedMonths]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(LEAVES_KEY, JSON.stringify(leaves));
    } catch {
      // ignore
    }
  }, [leaves]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
    } catch {
      // ignore
    }
  }, [overrides]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(WEEKLY_KEY, JSON.stringify(weeklyActuals));
    } catch {
      // ignore
    }
  }, [weeklyActuals]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(DIMS_KEY, JSON.stringify(dims));
    } catch {
      // ignore
    }
  }, [dims]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(DELIVERY_KEY, JSON.stringify(deliveryMonthly));
    } catch {
      // ignore
    }
  }, [deliveryMonthly]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(KPI_SCORES_KEY, JSON.stringify(kpiScores));
    } catch {
      // ignore
    }
  }, [kpiScores]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(ARTICLES_KEY, JSON.stringify(articles));
    } catch {
      // ignore
    }
  }, [articles]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(AI_SCANS_KEY, JSON.stringify(aiScans));
    } catch {
      // ignore
    }
  }, [aiScans]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SURFER_KEY, JSON.stringify(surferUsage));
    } catch {
      // ignore
    }
  }, [surferUsage]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(PIPELINE_KEY, JSON.stringify(pipelineSnapshots));
    } catch {
      // ignore
    }
  }, [pipelineSnapshots]);

  const addDimRow = useCallback(<K extends DimKind>(
    kind: K,
    row: Omit<DimRow<K>, "id">,
  ) => {
    setDims((prev) => {
      const list = prev[kind] as DimRow<K>[];
      const nextId = list.reduce((mx, r) => Math.max(mx, r.id), 0) + 1;
      const newRow = { ...row, id: nextId } as DimRow<K>;
      return { ...prev, [kind]: [...list, newRow] } as DimsShape;
    });
  }, []);

  const updateDimRow = useCallback(<K extends DimKind>(
    kind: K,
    row: DimRow<K>,
  ) => {
    setDims((prev) => {
      const list = prev[kind] as DimRow<K>[];
      const next = list.map((r) => (r.id === row.id ? row : r));
      return { ...prev, [kind]: next } as DimsShape;
    });
  }, []);

  const deleteDimRow = useCallback(<K extends DimKind>(
    kind: K,
    id: number,
  ) => {
    setDims((prev) => {
      const list = prev[kind] as DimRow<K>[];
      return { ...prev, [kind]: list.filter((r) => r.id !== id) } as DimsShape;
    });
  }, []);

  // ------------------ Delivery monthly ------------------
  const upsertDelivery: CP2StoreCtx["upsertDelivery"] = useCallback(
    (monthKey, clientId, patch) => {
      setDeliveryMonthly((prev) => {
        const existing = prev.find(
          (r) => r.monthKey === monthKey && r.clientId === clientId,
        );
        if (existing) {
          return prev.map((r) =>
            r.id === existing.id ? { ...r, ...patch } : r,
          );
        }
        const defaults: DeliveryMonthlyRow = {
          id: Date.now() % 1_000_000_000,
          monthKey,
          clientId,
          articlesSowTarget: 0,
          articlesDelivered: 0,
          articlesInvoiced: 0,
          articlesPaid: 0,
          articlesProjected: null,
          isActual: true,
          contentBriefsDelivered: 0,
          contentBriefsGoal: 0,
          notes: "",
          ...patch,
        };
        return [...prev, defaults];
      });
    },
    [],
  );

  // ------------------ KPI scores ------------------
  const upsertKpiScore: CP2StoreCtx["upsertKpiScore"] = useCallback(
    (monthKey, teamMemberId, metricId, clientId, patch) => {
      setKpiScores((prev) => {
        const existing = prev.find(
          (r) =>
            r.monthKey === monthKey &&
            r.teamMemberId === teamMemberId &&
            r.metricId === metricId &&
            r.clientId === clientId,
        );
        if (existing) {
          return prev.map((r) =>
            r.id === existing.id
              ? { ...r, ...patch, enteredAt: new Date().toISOString() }
              : r,
          );
        }
        const row: KpiScoreRow = {
          id: Date.now() % 1_000_000_000,
          monthKey,
          teamMemberId,
          metricId,
          clientId,
          score: patch.score ?? null,
          targetSnapshot: patch.targetSnapshot ?? 0,
          source: patch.source ?? "manual",
          enteredBy: null,
          enteredAt: new Date().toISOString(),
          notes: patch.notes ?? "",
        };
        return [...prev, row];
      });
    },
    [],
  );

  // ------------------ Articles ------------------
  const addArticle: CP2StoreCtx["addArticle"] = useCallback((row) => {
    setArticles((prev) => [
      ...prev,
      { ...row, id: Date.now() % 1_000_000_000 },
    ]);
  }, []);
  const updateArticle: CP2StoreCtx["updateArticle"] = useCallback(
    (id, patch) => {
      setArticles((prev) =>
        prev.map((a) => {
          if (a.id !== id) return a;
          const next = { ...a, ...patch };
          // Auto-compute turnaround when both dates present.
          if (next.cbApprovedDate && next.deliveredDate) {
            const d1 = new Date(next.cbApprovedDate).getTime();
            const d2 = new Date(next.deliveredDate).getTime();
            if (!Number.isNaN(d1) && !Number.isNaN(d2)) {
              next.turnaroundDays = Math.max(0, Math.round((d2 - d1) / 86400000));
            }
          }
          return next;
        }),
      );
    },
    [],
  );
  const deleteArticle: CP2StoreCtx["deleteArticle"] = useCallback((id) => {
    setArticles((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // ------------------ AI scans ------------------
  const addAiScan: CP2StoreCtx["addAiScan"] = useCallback((row) => {
    setAiScans((prev) => [
      ...prev,
      { ...row, id: Date.now() % 1_000_000_000 },
    ]);
  }, []);
  const updateAiScan: CP2StoreCtx["updateAiScan"] = useCallback(
    (id, patch) => {
      setAiScans((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      );
    },
    [],
  );
  const deleteAiScan: CP2StoreCtx["deleteAiScan"] = useCallback((id) => {
    setAiScans((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // ------------------ Surfer usage ------------------
  const upsertSurferUsage: CP2StoreCtx["upsertSurferUsage"] = useCallback(
    (yearMonthKey, patch) => {
      setSurferUsage((prev) => {
        const existing = prev.find((r) => r.yearMonthKey === yearMonthKey);
        if (existing) {
          return prev.map((r) =>
            r.id === existing.id ? { ...r, ...patch } : r,
          );
        }
        const row: SurferUsageRow = {
          id: Date.now() % 1_000_000_000,
          yearMonthKey,
          pod1: 0,
          pod2: 0,
          pod3: 0,
          pod4: 0,
          pod5: 0,
          auditioningWriters: 0,
          rewrites: 0,
          totalSpent: 0,
          remainingCalls: null,
          ...patch,
        };
        return [...prev, row];
      });
    },
    [],
  );

  // ------------------ Pipeline snapshots ------------------
  const upsertPipelineSnapshot: CP2StoreCtx["upsertPipelineSnapshot"] =
    useCallback((clientId, patch) => {
      setPipelineSnapshots((prev) => {
        const existing = prev.find((r) => r.clientId === clientId);
        if (existing) {
          return prev.map((r) =>
            r.id === existing.id
              ? { ...r, ...patch, snapshotDate: new Date().toISOString().slice(0, 10) }
              : r,
          );
        }
        const row: PipelineSnapshotRow = {
          id: Date.now() % 1_000_000_000,
          snapshotDate: new Date().toISOString().slice(0, 10),
          clientId,
          topicsSubmitted: 0,
          topicsApproved: 0,
          cbsSubmitted: 0,
          cbsApproved: 0,
          articlesSent: 0,
          articlesApproved: 0,
          articlesDelivered: 0,
          articlesPublished: 0,
          articlesKilled: 0,
          comments: "",
          ...patch,
        };
        return [...prev, row];
      });
    }, []);

  const isMonthClosed = useCallback(
    (m: string) => closedMonths.includes(m),
    [closedMonths],
  );
  const closeMonth = useCallback((m: string) => {
    setClosedMonths((prev) => (prev.includes(m) ? prev : [...prev, m]));
  }, []);
  const reopenMonth = useCallback((m: string) => {
    setClosedMonths((prev) => prev.filter((x) => x !== m));
  }, []);

  const setSelectedMonth = useCallback((m: string) => {
    if (!/^\d{4}-\d{2}$/.test(m)) return;
    setSelectedMonthState(m);
  }, []);

  const goToCurrentMonth = useCallback(() => {
    setSelectedMonthState(currentMonthKey());
  }, []);

  const resetToSeed = useCallback(() => {
    const fresh = seed();
    setState(fresh);
    setClosedMonths([]);
    const derived = deriveSeedLeavesOverrides(fresh.monthly);
    setLeaves(derived.leaves);
    setOverrides(derived.overrides);
    setWeeklyActuals(deriveSeedWeeklyActuals(fresh.monthly));
    const freshDims = seedDims();
    setDims(freshDims);
    const maint = deriveSeedMaintainData(fresh.monthly, freshDims);
    setDeliveryMonthly(maint.delivery);
    setKpiScores(maint.kpi);
    setArticles(maint.articles);
    setAiScans(maint.aiScans);
    setSurferUsage(maint.surfer);
    setPipelineSnapshots(maint.pipeline);
  }, []);

  const updateMember: CP2StoreCtx["updateMember"] = useCallback(
    (month, podId, memberId, patch) => {
      setState((s) => {
        const pods = (s.monthly[month] ?? []).map((p) =>
          p.id !== podId
            ? p
            : {
                ...p,
                members: p.members.map((m) =>
                  m.id === memberId ? { ...m, ...patch } : m,
                ),
              },
        );
        return { ...s, monthly: { ...s.monthly, [month]: pods } };
      });
    },
    [],
  );

  const addMember: CP2StoreCtx["addMember"] = useCallback(
    (month, podId, member) => {
      setState((s) => {
        const pods = (s.monthly[month] ?? []).map((p) =>
          p.id !== podId ? p : { ...p, members: [...p.members, member] },
        );
        return { ...s, monthly: { ...s.monthly, [month]: pods } };
      });
    },
    [],
  );

  const removeMember: CP2StoreCtx["removeMember"] = useCallback(
    (month, podId, memberId) => {
      setState((s) => {
        const pods = (s.monthly[month] ?? []).map((p) =>
          p.id !== podId
            ? p
            : { ...p, members: p.members.filter((m) => m.id !== memberId) },
        );
        return { ...s, monthly: { ...s.monthly, [month]: pods } };
      });
    },
    [],
  );

  const moveClient: CP2StoreCtx["moveClient"] = useCallback(
    (month, fromPodId, toPodId, clientId) => {
      if (fromPodId === toPodId) return;
      setState((s) => {
        const pods = s.monthly[month] ?? [];
        const unassigned = s.unassigned[month] ?? [];

        let moving: ClientChip | undefined;
        let newPods = pods;
        let newUnassigned = unassigned;

        if (fromPodId === "unassigned") {
          moving = unassigned.find((c) => c.id === clientId);
          if (!moving) return s;
          newUnassigned = unassigned.filter((c) => c.id !== clientId);
        } else {
          const src = pods.find((p) => p.id === fromPodId);
          moving = src?.clients.find((c) => c.id === clientId);
          if (!moving) return s;
          newPods = pods.map((p) =>
            p.id !== fromPodId
              ? p
              : { ...p, clients: p.clients.filter((c) => c.id !== clientId) },
          );
        }

        if (toPodId === "unassigned") {
          newUnassigned = [...newUnassigned, moving];
        } else {
          newPods = newPods.map((p) =>
            p.id !== toPodId ? p : { ...p, clients: [...p.clients, moving!] },
          );
        }

        return {
          ...s,
          monthly: { ...s.monthly, [month]: newPods },
          unassigned: { ...s.unassigned, [month]: newUnassigned },
        };
      });
    },
    [],
  );

  const updateClient: CP2StoreCtx["updateClient"] = useCallback(
    (month, podId, clientId, patch) => {
      setState((s) => {
        if (podId === "unassigned") {
          const unassigned = (s.unassigned[month] ?? []).map((c) =>
            c.id === clientId ? { ...c, ...patch } : c,
          );
          return { ...s, unassigned: { ...s.unassigned, [month]: unassigned } };
        }
        const pods = (s.monthly[month] ?? []).map((p) =>
          p.id !== podId
            ? p
            : {
                ...p,
                clients: p.clients.map((c) =>
                  c.id === clientId ? { ...c, ...patch } : c,
                ),
              },
        );
        return { ...s, monthly: { ...s.monthly, [month]: pods } };
      });
    },
    [],
  );

  const setActualDelivered: CP2StoreCtx["setActualDelivered"] = useCallback(
    (month, podId, value) => {
      setState((s) => {
        const pods = (s.monthly[month] ?? []).map((p) =>
          p.id !== podId ? p : { ...p, actualDeliveredTotal: value },
        );
        return { ...s, monthly: { ...s.monthly, [month]: pods } };
      });
    },
    [],
  );

  const copyMonthForward: CP2StoreCtx["copyMonthForward"] = useCallback(
    (source, count) => {
      setState((s) => {
        const srcPods = s.monthly[source] ?? [];
        const srcUnassigned = s.unassigned[source] ?? [];
        if (srcPods.length === 0 && srcUnassigned.length === 0) return s;
        const newMonthly = { ...s.monthly };
        const newUnassigned = { ...s.unassigned };
        for (let i = 1; i <= count; i++) {
          const target = shiftMonth(source, i);
          newMonthly[target] = srcPods.map((p) => ({
            ...p,
            members: p.members.map((m) => ({ ...m, actualDelivered: 0 })),
            clients: p.clients.map((c) => ({ ...c })),
            actualDeliveredTotal: 0,
          }));
          newUnassigned[target] = srcUnassigned.map((c) => ({ ...c }));
        }
        return { ...s, monthly: newMonthly, unassigned: newUnassigned };
      });
    },
    [],
  );

  // ------------------ Leaves ------------------

  // Apply a member's aggregate leaveShare to every MemberRow that references
  // that member in a given month. Keeps computeMemberEffective honest.
  const syncMemberLeave = useCallback(
    (teamMemberId: number, monthKey: string, leaveShare: number) => {
      setState((s) => {
        const pods = (s.monthly[monthKey] ?? []).map((p) => ({
          ...p,
          members: p.members.map((m) =>
            m.id === teamMemberId ? { ...m, leaveShare } : m,
          ),
        }));
        return { ...s, monthly: { ...s.monthly, [monthKey]: pods } };
      });
    },
    [],
  );

  const setLeave: CP2StoreCtx["setLeave"] = useCallback(
    (teamMemberId, monthKey, leaveShare, reason, notes) => {
      setLeaves((prev) => {
        const list = prev[monthKey] ?? [];
        const existing = list.find((l) => l.teamMemberId === teamMemberId);
        let nextList: LeaveRow[];
        if (leaveShare <= 0) {
          nextList = list.filter((l) => l.teamMemberId !== teamMemberId);
        } else if (existing) {
          nextList = list.map((l) =>
            l.teamMemberId === teamMemberId
              ? { ...l, leaveShare, reason, notes }
              : l,
          );
        } else {
          const nextId = Date.now() % 1_000_000_000;
          nextList = [
            ...list,
            { id: nextId, teamMemberId, monthKey, leaveShare, reason, notes },
          ];
        }
        return { ...prev, [monthKey]: nextList };
      });
      syncMemberLeave(teamMemberId, monthKey, Math.max(0, leaveShare));
    },
    [syncMemberLeave],
  );

  const removeLeave: CP2StoreCtx["removeLeave"] = useCallback(
    (teamMemberId, monthKey) => {
      setLeaves((prev) => {
        const list = prev[monthKey] ?? [];
        return {
          ...prev,
          [monthKey]: list.filter((l) => l.teamMemberId !== teamMemberId),
        };
      });
      syncMemberLeave(teamMemberId, monthKey, 0);
    },
    [syncMemberLeave],
  );

  // ------------------ Overrides ------------------

  // Sum all member-level overrides for a given (member, month) and write that
  // sum back onto every MemberRow instance of that member in the month.
  const syncMemberOverride = useCallback(
    (
      teamMemberId: number,
      monthKey: string,
      nextOverridesForMonth: OverrideRow[],
    ) => {
      const delta = nextOverridesForMonth
        .filter((o) => o.teamMemberId === teamMemberId)
        .reduce((s, o) => s + o.deltaArticles, 0);
      setState((s) => {
        const pods = (s.monthly[monthKey] ?? []).map((p) => ({
          ...p,
          members: p.members.map((m) =>
            m.id === teamMemberId ? { ...m, overrideDelta: delta } : m,
          ),
        }));
        return { ...s, monthly: { ...s.monthly, [monthKey]: pods } };
      });
    },
    [],
  );

  const addOverride: CP2StoreCtx["addOverride"] = useCallback((row) => {
    setOverrides((prev) => {
      const list = prev[row.monthKey] ?? [];
      const nextList: OverrideRow[] = [
        ...list,
        {
          ...row,
          id: Date.now() % 1_000_000_000,
          createdAt: new Date().toISOString(),
        },
      ];
      if (row.teamMemberId !== null) {
        // Defer the sync so the `overrides` state update is visible when
        // computing the cumulative delta.
        queueMicrotask(() => syncMemberOverride(row.teamMemberId!, row.monthKey, nextList));
      }
      return { ...prev, [row.monthKey]: nextList };
    });
  }, [syncMemberOverride]);

  const removeOverride: CP2StoreCtx["removeOverride"] = useCallback(
    (id) => {
      setOverrides((prev) => {
        let touched: { teamMemberId: number; monthKey: string } | null = null;
        const next: Record<string, OverrideRow[]> = {};
        for (const [monthKey, list] of Object.entries(prev)) {
          const filtered = list.filter((o) => {
            if (o.id === id) {
              if (o.teamMemberId !== null) {
                touched = { teamMemberId: o.teamMemberId, monthKey };
              }
              return false;
            }
            return true;
          });
          next[monthKey] = filtered;
        }
        if (touched) {
          const t = touched as { teamMemberId: number; monthKey: string };
          queueMicrotask(() =>
            syncMemberOverride(t.teamMemberId, t.monthKey, next[t.monthKey] ?? []),
          );
        }
        return next;
      });
    },
    [syncMemberOverride],
  );

  // ------------------ Weekly actuals ------------------

  const setWeeklyActual: CP2StoreCtx["setWeeklyActual"] = useCallback(
    (weekKey, clientId, podId, patch) => {
      setWeeklyActuals((prev) => {
        const list = prev[weekKey] ?? [];
        const existing = list.find((r) => r.clientId === clientId);
        let nextList: WeeklyActualRow[];
        if (existing) {
          nextList = list.map((r) =>
            r.clientId === clientId
              ? {
                  ...r,
                  ...patch,
                  podId: podId ?? r.podId,
                  ingestedAt: new Date().toISOString(),
                }
              : r,
          );
        } else {
          nextList = [
            ...list,
            {
              id: Date.now() % 1_000_000_000,
              weekKey,
              clientId,
              podId,
              deliveredArticles: patch.deliveredArticles ?? 0,
              goalArticles: patch.goalArticles ?? 0,
              ingestedAt: new Date().toISOString(),
            },
          ];
        }
        return { ...prev, [weekKey]: nextList };
      });
    },
    [],
  );

  const importWeeklyFromSheet: CP2StoreCtx["importWeeklyFromSheet"] = useCallback(() => {
    // Proposal-only: rebuild from mock seed. In production this would call
    // the backend endpoint that ingests Master Tracker "Goals vs Delivery".
    setWeeklyActuals(deriveSeedWeeklyActuals(state.monthly));
  }, [state.monthly]);

  const copyFromPreviousMonth: CP2StoreCtx["copyFromPreviousMonth"] = useCallback(
    (target) => {
      setState((s) => {
        const source = shiftMonth(target, -1);
        const srcPods = s.monthly[source] ?? [];
        const srcUnassigned = s.unassigned[source] ?? [];
        if (srcPods.length === 0 && srcUnassigned.length === 0) return s;
        return {
          ...s,
          monthly: {
            ...s.monthly,
            [target]: srcPods.map((p) => ({
              ...p,
              members: p.members.map((m) => ({ ...m, actualDelivered: 0 })),
              clients: p.clients.map((c) => ({ ...c })),
              actualDeliveredTotal: 0,
            })),
          },
          unassigned: {
            ...s.unassigned,
            [target]: srcUnassigned.map((c) => ({ ...c })),
          },
        };
      });
    },
    [],
  );

  const value = useMemo<CP2StoreCtx>(
    () => ({
      state,
      resetToSeed,
      selectedMonth,
      setSelectedMonth,
      goToCurrentMonth,
      monthOptions,
      closedMonths,
      isMonthClosed,
      closeMonth,
      reopenMonth,
      updateMember,
      addMember,
      removeMember,
      moveClient,
      updateClient,
      setActualDelivered,
      copyMonthForward,
      copyFromPreviousMonth,
      leaves,
      overrides,
      setLeave,
      removeLeave,
      addOverride,
      removeOverride,
      weeklyActuals,
      setWeeklyActual,
      importWeeklyFromSheet,
      dims,
      addDimRow,
      updateDimRow,
      deleteDimRow,
      deliveryMonthly,
      upsertDelivery,
      kpiScores,
      upsertKpiScore,
      articles,
      addArticle,
      updateArticle,
      deleteArticle,
      aiScans,
      addAiScan,
      updateAiScan,
      deleteAiScan,
      surferUsage,
      upsertSurferUsage,
      pipelineSnapshots,
      upsertPipelineSnapshot,
    }),
    [
      state,
      resetToSeed,
      selectedMonth,
      setSelectedMonth,
      goToCurrentMonth,
      monthOptions,
      closedMonths,
      isMonthClosed,
      closeMonth,
      reopenMonth,
      updateMember,
      addMember,
      removeMember,
      moveClient,
      updateClient,
      setActualDelivered,
      copyMonthForward,
      copyFromPreviousMonth,
      leaves,
      overrides,
      setLeave,
      removeLeave,
      addOverride,
      removeOverride,
      weeklyActuals,
      setWeeklyActual,
      importWeeklyFromSheet,
      dims,
      addDimRow,
      updateDimRow,
      deleteDimRow,
      deliveryMonthly,
      upsertDelivery,
      kpiScores,
      upsertKpiScore,
      articles,
      addArticle,
      updateArticle,
      deleteArticle,
      aiScans,
      addAiScan,
      updateAiScan,
      deleteAiScan,
      surferUsage,
      upsertSurferUsage,
      pipelineSnapshots,
      upsertPipelineSnapshot,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useCP2Store(): CP2StoreCtx {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useCP2Store must be used inside CP2StoreProvider");
  return ctx;
}

// Helper: all known members across the store (for "add member" dropdowns).
export function useAllMembers(): Array<{
  id: number;
  fullName: string;
  role: Role;
  defaultCapacity: number;
}> {
  const { state } = useCP2Store();
  const map = new Map<number, MemberRow>();
  for (const month of Object.values(state.monthly)) {
    for (const pod of month) {
      for (const m of pod.members) if (!map.has(m.id)) map.set(m.id, m);
    }
  }
  return Array.from(map.values()).map((m) => ({
    id: m.id,
    fullName: m.fullName,
    role: m.role,
    defaultCapacity: m.defaultCapacity,
  }));
}
