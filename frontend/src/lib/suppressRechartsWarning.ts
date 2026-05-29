"use client";

/**
 * Dev-only filter for Recharts' first-paint warning:
 *
 *   "The width(-1) and height(-1) of chart should be greater than 0, ..."
 *
 * Recharts' `<ResponsiveContainer>` measures its parent via ResizeObserver.
 * Before the observer's first callback fires (one tick later), the container
 * reports a sentinel size of `-1` and Recharts logs the warning above. The
 * chart then renders correctly on the next frame — the warning is purely
 * informational but it floods the dev console and Docker logs, especially
 * on tab switches and route changes that remount many charts at once.
 *
 * This module patches `console.warn` ONCE in development to silently drop
 * that specific message. Every other warning is forwarded untouched.
 * In production builds the function is a no-op.
 */

let patched = false;

export function installRechartsWarningFilter() {
  if (patched) return;
  if (process.env.NODE_ENV === "production") return;
  if (typeof window === "undefined") return;

  const original = window.console.warn.bind(window.console);
  window.console.warn = (...args: unknown[]) => {
    const first = args[0];
    if (
      typeof first === "string" &&
      first.includes("width(-1) and height(-1) of chart should be greater than 0")
    ) {
      return;
    }
    original(...args);
  };
  patched = true;
}
