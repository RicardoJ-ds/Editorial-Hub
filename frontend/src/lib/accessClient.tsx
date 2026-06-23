"use client";

/**
 * Client-side cache for `/api/access/me` plus the admin-only "preview as"
 * impersonation state. Single source of truth for:
 *   - what views the current user can render (frontend gating mirror of
 *     the backend's per-endpoint guard)
 *   - whether the pod-axis toggle should appear
 *   - the active "preview as" email (shared with the API client so every
 *     backend call carries the X-Preview-As header)
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { apiGet } from "@/lib/api";

export interface AccessProfile {
  email: string;
  is_authenticated: boolean;
  is_admin: boolean;
  group_slugs: string[];
  view_slugs: string[];
  pod_kind_lock: "editorial" | "growth" | null;
  can_toggle_axis: boolean;
  pod_number_lock: string | null;
  client_scope: "all" | "assigned";
  is_preview: boolean;
}

let cachedProfile: AccessProfile | null = null;
let inFlight: Promise<void> | null = null;
const subscribers = new Set<() => void>();

let previewAsEmail: string | null = null;
// Path the admin was on when they entered preview mode. The exit handler
// reads this to send them back where they came from instead of leaving
// them on whatever the previewed user's first accessible page was.
let previewReturnPath: string | null = null;

function notify() {
  for (const fn of subscribers) fn();
}

function loadOnce(): void {
  if (cachedProfile !== null || inFlight !== null) return;
  inFlight = apiGet<AccessProfile>("/api/access/me")
    .then((p) => {
      cachedProfile = p;
      notify();
    })
    .catch(() => {
      cachedProfile = {
        email: "",
        is_authenticated: false,
        is_admin: false,
        group_slugs: [],
        view_slugs: [],
        pod_kind_lock: null,
        can_toggle_axis: false,
        pod_number_lock: null,
        client_scope: "assigned",
        is_preview: false,
      };
      notify();
    })
    .finally(() => {
      inFlight = null;
    });
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
function getSnapshot(): AccessProfile | null {
  return cachedProfile;
}
function getServerSnapshot(): AccessProfile | null {
  return null;
}

/** Forces an immediate refetch — call after mutating access state. */
export async function refreshAccessProfile(): Promise<AccessProfile | null> {
  cachedProfile = null;
  inFlight = null;
  loadOnce();
  // Wait for the in-flight promise to settle.
  while (inFlight) {
    await inFlight;
  }
  return cachedProfile;
}

// Shallow comparison of the fields that change observable UI. Used by the
// silent refresh to skip notify+re-render when nothing meaningful moved.
function profilesEqual(a: AccessProfile | null, b: AccessProfile): boolean {
  if (!a) return false;
  if (
    a.email !== b.email ||
    a.is_authenticated !== b.is_authenticated ||
    a.is_admin !== b.is_admin ||
    a.pod_kind_lock !== b.pod_kind_lock ||
    a.can_toggle_axis !== b.can_toggle_axis ||
    a.pod_number_lock !== b.pod_number_lock ||
    a.client_scope !== b.client_scope ||
    a.is_preview !== b.is_preview
  )
    return false;
  if (a.group_slugs.length !== b.group_slugs.length) return false;
  if (a.group_slugs.some((g, i) => g !== b.group_slugs[i])) return false;
  if (a.view_slugs.length !== b.view_slugs.length) return false;
  if (a.view_slugs.some((v, i) => v !== b.view_slugs[i])) return false;
  return true;
}

// Silent refetch — does NOT blank the cache before fetching, so consumers
// keep showing the existing profile during the round-trip and only re-
// render if the new profile actually differs. Used by the tab-focus
// listener below; skipped on failure (keep the stale cache).
let inFlightSilent: Promise<void> | null = null;
function refreshAccessProfileSilent(): Promise<void> {
  if (inFlightSilent) return inFlightSilent;
  inFlightSilent = apiGet<AccessProfile>("/api/access/me")
    .then((fresh) => {
      if (!profilesEqual(cachedProfile, fresh)) {
        cachedProfile = fresh;
        notify();
      }
    })
    .catch(() => {
      // Network blip — keep the stale cache rather than wiping it.
    })
    .finally(() => {
      inFlightSilent = null;
    });
  return inFlightSilent;
}

// When the user switches back to this tab, refresh the access profile in
// the background so changes another admin made while the tab was idle
// take effect without requiring a manual refresh. Module-scoped so it
// registers once, not per-component-mount.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && cachedProfile !== null) {
      void refreshAccessProfileSilent();
    }
  });
}

export function useAccessProfile(): AccessProfile | null {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (typeof window !== "undefined" && snapshot === null) {
    loadOnce();
  }
  return snapshot;
}

/** Set the "preview as" email — caller must be admin. The API client reads
 *  this to inject `X-Preview-As` on every subsequent request. Triggers a
 *  profile refetch so the UI reflects the impersonated permissions.
 *  Pass `returnPath` when entering preview to remember where to send the
 *  admin back when they exit. Returns the freshly-refreshed profile so
 *  callers can immediately route based on the previewed user's views. */
export async function setPreviewAs(
  email: string | null,
  returnPath?: string,
): Promise<AccessProfile | null> {
  if (email && email.trim()) {
    previewAsEmail = email.trim().toLowerCase();
    if (returnPath) previewReturnPath = returnPath;
  } else {
    previewAsEmail = null;
    // Don't clear previewReturnPath here — the exit handler reads it via
    // consumePreviewReturnPath() right after this call resolves.
  }
  return await refreshAccessProfile();
}

export function getPreviewAs(): string | null {
  return previewAsEmail;
}

/** Read-and-clear the return path saved when preview was entered. Called
 *  by the Exit-preview button to navigate the admin back. Returns null
 *  if no path was saved (preview started outside the standard flow). */
export function consumePreviewReturnPath(): string | null {
  const p = previewReturnPath;
  previewReturnPath = null;
  return p;
}

// Routes ordered by descending preference for the "first accessible page"
// resolver. Mirrors the Sidebar's nav order — Overview is the most
// natural landing, admin pages last. Each entry needs ≥1 of `views` in
// the user's view_slugs to qualify.
const ROUTE_PRIORITY: Array<{ views: string[]; href: string }> = [
  { views: ["overview"], href: "/overview" },
  { views: ["d1.contract", "d1.deliverables"], href: "/editorial-clients" },
  { views: ["d2.kpi", "d2.capacity", "d2.ai"], href: "/team-kpis" },
  { views: ["data.import"], href: "/data-management/import" },
  { views: ["admin.access"], href: "/admin/access" },
  { views: ["admin.data_quality"], href: "/admin/data-quality" },
];

/** Returns the first route in the sidebar order that the given views can
 *  open. Used by the Preview-as flow to land the admin on a page the
 *  previewed user can actually use, rather than a "No Access" wall. */
export function firstAccessibleRoute(viewSlugs: string[]): string | null {
  const granted = new Set(viewSlugs);
  for (const r of ROUTE_PRIORITY) {
    if (r.views.some((v) => granted.has(v))) return r.href;
  }
  return null;
}

/** Redirect users without `viewSlug` access to a fallback page. Used by
 *  pages that don't otherwise gate their content (Overview, Data Quality
 *  etc.) so a stranger / pod-locked user typing the URL directly bounces
 *  to a page they can use. Returns the access profile so the caller can
 *  also conditionally render. */
export function useRequireView(
  viewSlug: string,
  fallbackHref = "/editorial-clients",
): AccessProfile | null {
  const profile = useAccessProfile();
  const router = useRouter();
  useEffect(() => {
    if (!profile) return; // still loading
    if (!profile.is_authenticated) return; // proxy.ts handles redirect
    if (profile.view_slugs.includes(viewSlug)) return;
    router.replace(fallbackHref);
  }, [profile, viewSlug, fallbackHref, router]);
  return profile;
}
