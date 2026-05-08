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

export function useAccessProfile(): AccessProfile | null {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (typeof window !== "undefined" && snapshot === null) {
    loadOnce();
  }
  return snapshot;
}

/** Set the "preview as" email — caller must be admin. The API client reads
 *  this to inject `X-Preview-As` on every subsequent request. Triggers a
 *  profile refetch so the UI reflects the impersonated permissions. */
export async function setPreviewAs(email: string | null): Promise<void> {
  previewAsEmail = email && email.trim() ? email.trim().toLowerCase() : null;
  await refreshAccessProfile();
}

export function getPreviewAs(): string | null {
  return previewAsEmail;
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
