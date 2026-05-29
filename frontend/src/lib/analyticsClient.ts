/**
 * Frontend analytics client — batched event sender for Admin · Analytics.
 *
 * Mounts as a singleton on the page. Components and hooks call
 * `trackEvent(...)` (or the `useAnalytics()` hook below). Events buffer
 * in-memory; the buffer is flushed on a 10s timer OR when 5 events
 * accumulate, whichever is sooner. The flush also runs on `pagehide`
 * so we don't lose the last events when the tab closes.
 *
 * Privacy / behavior:
 *   • Events posted as the current session's authenticated user
 *     (email read from the JWT cookie on the server side).
 *   • While preview-as is active, NO events are sent — the previewed
 *     user isn't actually using the app, the admin is.
 *   • props is a small object; large strings get clipped server-side.
 *   • Failures are silent (telemetry shouldn't interrupt the user).
 */

import { apiPost } from "@/lib/api";
import { getPreviewAs } from "@/lib/accessClient";

const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_AT_COUNT = 5;
const MAX_BATCH = 50;

type EventType =
  | "PageView"
  | "SectionEntered"   // section just became visible (≥ 50% in viewport)
  | "SectionViewed"    // section left viewport — props.dwell_ms
  | "FilterChanged"
  | "DrillDownOpened"
  | "SyncClicked"
  | "ClickInteraction" // generic UI click (toggle, chart, anchor) — props.label
  | "CommentPosted"
  | "CommentEdited"
  | "CommentResolved"
  | "CommentDeleted";

interface PendingEvent {
  event_type: EventType;
  route: string;
  section_id?: string | null;
  props?: Record<string, unknown> | null;
  session_id: string;
  occurred_at: string; // ISO-8601
}

// One UUID per browser tab — sessionStorage scoping keeps return-cadence
// metrics meaningful (a refresh = same session; a new tab = new session).
function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  const KEY = "eh_analytics_session";
  let id = window.sessionStorage.getItem(KEY);
  if (!id) {
    // crypto.randomUUID is available in every browser we support.
    id = (typeof crypto !== "undefined" && "randomUUID" in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      window.sessionStorage.setItem(KEY, id);
    } catch {
      /* sessionStorage can be disabled — fall through, lose persistence */
    }
  }
  return id;
}

let queue: PendingEvent[] = [];
let flushTimer: number | null = null;
// Track in-flight flushes so multiple events queued during a slow
// POST don't trigger redundant flushes.
let flushing = false;

function scheduleFlush() {
  if (flushTimer !== null || typeof window === "undefined") return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

async function flush(): Promise<void> {
  if (flushing) return;
  if (queue.length === 0) return;
  flushing = true;
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(MAX_BATCH);
  try {
    await apiPost("/api/analytics/event", { events: batch });
  } catch {
    // Silent — events are best-effort. We deliberately do NOT re-queue
    // failed batches; a network blip won't snowball into a megabatch.
  } finally {
    flushing = false;
    // If more queued up while we were posting, schedule another flush.
    if (queue.length >= FLUSH_AT_COUNT) {
      void flush();
    } else if (queue.length > 0) {
      scheduleFlush();
    }
  }
}

// Flush on tab close — last-ditch attempt to ship any pending events.
// Has to be a sync sendBeacon since the browser kills async fetches
// when the tab unloads. We don't include auth headers here; the
// session cookie travels via credentials:include automatically.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (queue.length === 0) return;
    try {
      const payload = JSON.stringify({ events: queue });
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon?.("/api/analytics/event", blob);
      queue = [];
    } catch {
      /* nothing else we can do — tab is closing */
    }
  });
}

/**
 * Append an event to the in-memory queue. Returns immediately; the
 * actual POST happens on the next flush cycle (≤10s away).
 *
 * Skipped silently when:
 *   • Preview-as is active (the previewed user isn't really using the app)
 *   • SSR (no window object)
 */
export function trackEvent(
  eventType: EventType,
  opts: {
    route: string;
    section_id?: string | null;
    props?: Record<string, unknown> | null;
  },
): void {
  if (typeof window === "undefined") return;
  if (getPreviewAs() !== null) return;

  queue.push({
    event_type: eventType,
    route: opts.route,
    section_id: opts.section_id ?? null,
    props: opts.props ?? null,
    session_id: getSessionId(),
    occurred_at: new Date().toISOString(),
  });

  if (queue.length >= FLUSH_AT_COUNT) {
    void flush();
  } else {
    scheduleFlush();
  }
}

/** Hook variant — returns a stable `track` function. Components that
 *  only fire one type of event might prefer importing `trackEvent`
 *  directly; this exists for consistency with other React-style hooks
 *  in the codebase. */
export function useAnalytics() {
  return { track: trackEvent };
}

/**
 * Sugar for `trackEvent("ClickInteraction", ...)` — the canonical way
 * to log a button / toggle / chart click. `label` is a human-readable
 * identifier (e.g. "production-history.view-toggle.per-pod") that
 * shows up in the admin · analytics breakdown.
 */
export function trackClick(
  label: string,
  opts: { section_id?: string | null; props?: Record<string, unknown> | null } = {},
): void {
  trackEvent("ClickInteraction", {
    route: typeof window !== "undefined" ? window.location.pathname : "/",
    section_id: opts.section_id ?? null,
    props: { label, ...(opts.props ?? {}) },
  });
}
