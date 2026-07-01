"use client";

/**
 * Singleton client cache for `editorial_weeks`. Annual config — fetched once
 * on first mount, reused for the lifetime of the SPA. The past-months resync
 * is the only thing that updates it, so a hard refresh after running that
 * resync is enough to pick up changes.
 */

import { useSyncExternalStore } from "react";
import { apiGet } from "@/lib/api";
import {
  currentEditorialMonth,
  lastClosedEditorialMonth,
  lastCompletedEditorialAsOf,
  type CurrentEditorialMonth,
  type EditorialAsOf,
  type EditorialWeek,
} from "@/lib/editorialWeeks";

interface EditorialWeekRow {
  id: number;
  year: number;
  month: number;
  week_number: number;
  start_date: string;
  end_date: string;
}

let cache: EditorialWeek[] | null = null;
let inFlight: Promise<void> | null = null;
const subscribers = new Set<() => void>();

function notify() {
  for (const fn of subscribers) fn();
}

function loadOnce(): void {
  if (cache !== null || inFlight !== null) return;
  inFlight = apiGet<EditorialWeekRow[]>("/api/migrate/editorial-weeks")
    .then((rows) => {
      cache = (rows ?? []).map((r) => ({
        year: r.year,
        month: r.month,
        weekNumber: r.week_number,
        start: r.start_date,
        end: r.end_date,
      }));
      notify();
    })
    .catch(() => {
      // Treat a failed fetch as "no weeks" so the badge falls through to
      // calendar with the "cal." chip rather than hanging on stale data.
      cache = [];
      notify();
    })
    .finally(() => {
      inFlight = null;
    });
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function getSnapshot(): EditorialWeek[] | null {
  return cache;
}

function getServerSnapshot(): EditorialWeek[] | null {
  return null;
}

/** Hook → `{ label, isFallback }` for `<AsOfBadge>`. The first render kicks
 *  off the fetch; once it resolves, every consumer re-renders with the live
 *  Editorial month. Empty / failed fetch → calendar-month fallback. */
export function useEditorialAsOf(now: Date = new Date()): EditorialAsOf {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (typeof window !== "undefined" && snapshot === null) {
    loadOnce();
  }
  return lastCompletedEditorialAsOf(now, snapshot ?? []);
}

/** Hook returning the in-progress Editorial month — i.e. the month the
 *  team is currently working in. Used by the Monthly Goals gauges on D1
 *  so the rings show THIS month's progress regardless of the date filter. */
export function useCurrentEditorialMonth(now: Date = new Date()): CurrentEditorialMonth {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (typeof window !== "undefined" && snapshot === null) {
    loadOnce();
  }
  return currentEditorialMonth(now, snapshot ?? []);
}

/** Hook → the last fully-closed Editorial month `{ year, month }` (grace
 *  applied), or `null` when weeks aren't loaded / today sits outside coverage.
 *  Used by the Overview Goals column so its anchor + "Current month" option
 *  flip on the same day as the "As of" badge. */
export function useLastClosedEditorialMonth(
  now: Date = new Date(),
): { year: number; month: number } | null {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (typeof window !== "undefined" && snapshot === null) {
    loadOnce();
  }
  return lastClosedEditorialMonth(now, snapshot ?? []);
}
