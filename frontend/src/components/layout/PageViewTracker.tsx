"use client";

/**
 * Fires a `PageView` analytics event whenever the route changes.
 * Mounted once at the top of the (app) layout so every authenticated
 * page navigation gets tracked.
 *
 * Implementation note: Next.js' App Router doesn't expose a global
 * route-change event the way the Pages Router did, but `usePathname()`
 * + `useEffect` works as a lightweight equivalent — the effect runs
 * after every navigation since `pathname` is part of the dependency
 * array. We also include searchParams so a filter change that mutates
 * the URL counts as a separate "view" (matches how operators think:
 * "I refreshed the Overview with a different pod filter").
 */

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { trackEvent } from "@/lib/analyticsClient";
import { installRechartsWarningFilter } from "@/lib/suppressRechartsWarning";

export function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Side-effect: silence Recharts' benign first-paint warning across
  // the entire app. No-op in production. Mounted here only because
  // this component already runs once at the top of (app)/layout.tsx.
  useEffect(() => {
    installRechartsWarningFilter();
  }, []);

  useEffect(() => {
    if (!pathname) return;
    // Strip noisy params (e.g. `__next` internals) — keep only the
    // operator-visible filter keys so the analytics dimension stays
    // readable.
    const filterKeys = [
      "search",
      "editorial_pod",
      "growth_pod",
      "status",
      "tab",
    ];
    const props: Record<string, string> = {};
    for (const key of filterKeys) {
      const value = searchParams?.get(key);
      if (value) props[key] = value;
    }
    trackEvent("PageView", {
      route: pathname,
      props: Object.keys(props).length > 0 ? props : null,
    });
  }, [pathname, searchParams]);

  return null;
}
