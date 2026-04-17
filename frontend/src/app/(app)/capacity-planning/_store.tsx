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
};

const StoreContext = createContext<CP2StoreCtx | null>(null);

export function CP2StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<StoreShape>(seed);
  const [closedMonths, setClosedMonths] = useState<string[]>([]);

  const today = useMemo(currentMonthKey, []);
  const monthOptions = useMemo(() => monthRange(today, 6, 6), [today]);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlMonth = searchParams.get("m");

  // Initial selected month: URL > localStorage > today
  const [selectedMonth, setSelectedMonthState] = useState<string>(today);

  useEffect(() => {
    setState(load());
    setClosedMonths(loadClosedMonths());
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

  const resetToSeed = useCallback(() => setState(seed()), []);

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
