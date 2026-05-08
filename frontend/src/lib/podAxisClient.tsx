"use client";

/**
 * Global pod-axis state — controls whether charts that group by pod use
 * `editorial_pod` or `growth_pod` as the grouping key.
 *
 * Resolution rules (sourced from the access profile, single source of
 * truth: backend's `resolve_access`):
 *
 *   - Editorial Team / Growth Team users → axis is locked to their pod
 *     kind. The toggle is hidden. `useCurrentPodAxis()` returns the
 *     locked value regardless of user actions.
 *
 *   - Admin / VPs and Managers / BI Team → toggle visible. Default is
 *     "editorial" (matches today's behavior). The selection persists in
 *     localStorage so a refresh doesn't reset the dashboard.
 *
 *   - Leadership → no toggle (sees both axes implicitly via their own
 *     client list). Default to "editorial" but charts grouped by pod
 *     should usually fold both kinds together — that's per-chart logic,
 *     not handled here.
 *
 *   - Unauthenticated / no group → default "editorial".
 *
 * The single hook to use throughout the app: `useCurrentPodAxis()`.
 * Components that group by pod call it once and read `axis` to pick the
 * grouping field. The optional `setPodAxis` returned only mutates state
 * for users with `can_toggle_axis = true` (it no-ops otherwise).
 */

import { useSyncExternalStore } from "react";
import { useAccessProfile } from "@/lib/accessClient";

export type PodAxis = "editorial" | "growth";
const STORAGE_KEY = "eh.podAxis";

let stored: PodAxis | null = null;
const subscribers = new Set<() => void>();

function notify() {
  for (const fn of subscribers) fn();
}

function readStored(): PodAxis | null {
  if (typeof window === "undefined") return null;
  if (stored !== null) return stored;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "editorial" || v === "growth") {
      stored = v;
      return v;
    }
  } catch {
    // localStorage might throw in private browsing.
  }
  return null;
}

function writeStored(value: PodAxis): void {
  stored = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Tolerate localStorage failures — runtime state still works.
  }
  notify();
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
function getSnapshot(): PodAxis | null {
  return stored ?? readStored();
}
function getServerSnapshot(): PodAxis | null {
  return null;
}

interface PodAxisHookResult {
  axis: PodAxis;
  /** True when the access profile lets the user flip the axis (Admin /
   *  VPs and Managers / BI Team). False for pod-locked teams. */
  canToggle: boolean;
  /** Setter — no-ops when the user can't toggle. */
  setAxis: (next: PodAxis) => void;
}

export function useCurrentPodAxis(): PodAxisHookResult {
  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const profile = useAccessProfile();

  // Locked users always read their pod kind regardless of stored state.
  if (profile?.pod_kind_lock === "editorial" || profile?.pod_kind_lock === "growth") {
    const locked = profile.pod_kind_lock as PodAxis;
    return {
      axis: locked,
      canToggle: false,
      setAxis: () => {
        /* no-op — axis is locked for this user */
      },
    };
  }

  const canToggle = !!profile?.can_toggle_axis;
  const axis: PodAxis = stored ?? "editorial";
  return {
    axis,
    canToggle,
    setAxis: (next: PodAxis) => {
      if (!canToggle) return;
      writeStored(next);
    },
  };
}
