"use client";

/**
 * Tiny module-level store tracking whether the current page has any
 * unsaved draft edits. Consumers (e.g. the Access Control Groups +
 * Users × Views tabs) register a stable id and toggle their flag; the
 * sidebar reads the aggregate via `useHasUnsavedChanges()` to gate
 * client-side navigation.
 *
 * Why this exists: Next.js App Router does NOT fire `beforeunload` for
 * client-side `router.push` (sidebar Link clicks, programmatic
 * navigation). The native warning only catches hard reloads / tab
 * closes. To cover in-app nav we need an explicit confirm gate; the
 * sidebar wraps each link click in `confirmDiscardIfUnsaved()`.
 */

import { useSyncExternalStore } from "react";

const flags = new Map<string, boolean>();
const subscribers = new Set<() => void>();

function notify() {
  for (const fn of subscribers) fn();
}

/** Register / update a draft owner's unsaved-state flag. Pass `false`
 *  on cleanup (e.g. unmount) so the aggregate doesn't get stuck. */
export function setUnsavedChanges(ownerId: string, hasChanges: boolean): void {
  const prev = flags.get(ownerId) ?? false;
  if (prev === hasChanges) return;
  if (hasChanges) flags.set(ownerId, true);
  else flags.delete(ownerId);
  notify();
}

function hasAny(): boolean {
  for (const v of flags.values()) {
    if (v) return true;
  }
  return false;
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}
function getSnapshot(): boolean {
  return hasAny();
}
function getServerSnapshot(): boolean {
  return false;
}

export function useHasUnsavedChanges(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Returns `true` when it's safe to proceed (no unsaved edits, or the
 *  user explicitly confirmed they're OK losing them). Returns `false`
 *  when the user cancels. Use this to gate router pushes + tab swaps. */
export function confirmDiscardIfUnsaved(): boolean {
  if (!hasAny()) return true;
  return window.confirm(
    "You have unsaved access-control changes. Leave this page and discard them?",
  );
}
