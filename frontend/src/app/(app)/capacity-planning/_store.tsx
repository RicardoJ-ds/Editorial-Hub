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
};

const StoreContext = createContext<CP2StoreCtx | null>(null);

export function CP2StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<StoreShape>(seed);
  const [closedMonths, setClosedMonths] = useState<string[]>([]);
  const [leaves, setLeaves] = useState<Record<string, LeaveRow[]>>({});
  const [overrides, setOverrides] = useState<Record<string, OverrideRow[]>>({});
  const [weeklyActuals, setWeeklyActuals] = useState<Record<string, WeeklyActualRow[]>>({});

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
