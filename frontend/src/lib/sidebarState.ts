"use client";

/**
 * Tiny client-only store for sidebar-expanded state. The sidebar uses
 * `hover:w-[240px]` for its expand animation, but other top-level chrome
 * (e.g. the PreviewBanner) needs to react to the same hover so it can
 * shift out of the sidebar's way. Sidebar broadcasts via
 * `setSidebarExpanded` on mouseenter/leave; consumers subscribe with
 * `useSidebarExpanded()`.
 */

import { useSyncExternalStore } from "react";

let expanded = false;
const subscribers = new Set<() => void>();

export function setSidebarExpanded(value: boolean): void {
  if (expanded === value) return;
  expanded = value;
  for (const fn of subscribers) fn();
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}
function getSnapshot(): boolean {
  return expanded;
}
function getServerSnapshot(): boolean {
  return false;
}

export function useSidebarExpanded(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
