"use client";

/** Shared client for `/api/overview/comments`. Every consumer subscribes
 *  to the same module-level store via `useSyncExternalStore`, so when one
 *  surface posts/resolves/deletes, every other surface (the section
 *  icons + the right-side ClientCommentsRail) refreshes in lockstep.
 *
 *  The previous implementation kept state per-hook-instance, which meant
 *  posting a comment in a section icon never showed up in the rail until
 *  the rail re-mounted. This module fixes that. */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { apiDelete, apiGet, apiPost } from "@/lib/api";

export interface OverviewComment {
  id: number;
  section_id: string;
  /** Optional — the right-rail "general" composer lets admins/leadership
   *  post comments that aren't tied to any one client. Section-anchored
   *  threads (inline icons) still require a client. */
  client_name: string | null;
  author_email: string;
  author_name: string | null;
  body: string;
  resolved_at: string | null;
  resolved_by_email: string | null;
  created_at: string;
  updated_at: string;
}

interface CommentsSnapshot {
  comments: OverviewComment[];
  loading: boolean;
  error: string | null;
}

// One snapshot reference that all subscribers read. `useSyncExternalStore`
// compares by identity, so we replace the whole object on every change to
// trigger a re-render across every mounted hook.
let _state: CommentsSnapshot = { comments: [], loading: true, error: null };
let _fetchInFlight: Promise<void> | null = null;
let _initialFetchStarted = false;
const _subscribers = new Set<() => void>();

function notify() {
  for (const fn of _subscribers) fn();
}

function setState(next: Partial<CommentsSnapshot>) {
  _state = { ..._state, ...next };
  notify();
}

async function refetch(): Promise<void> {
  if (_fetchInFlight) return _fetchInFlight;
  setState({ loading: true, error: null });
  _fetchInFlight = (async () => {
    try {
      const rows = await apiGet<OverviewComment[]>("/api/overview/comments/");
      setState({ comments: rows, loading: false, error: null });
    } catch (e) {
      setState({
        comments: [],
        loading: false,
        error: e instanceof Error ? e.message : "Failed to load comments",
      });
    } finally {
      _fetchInFlight = null;
    }
  })();
  return _fetchInFlight;
}

function subscribe(cb: () => void): () => void {
  _subscribers.add(cb);
  return () => {
    _subscribers.delete(cb);
  };
}
function getSnapshot(): CommentsSnapshot {
  return _state;
}
function getServerSnapshot(): CommentsSnapshot {
  return { comments: [], loading: true, error: null };
}

export interface CreateCommentInput {
  section_id: string;
  /** Null/undefined = "general" comment with no client anchor. */
  client_name?: string | null;
  body: string;
}

export function useOverviewComments() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // First mount across the whole app triggers the initial fetch. Every
  // subsequent mount reuses the cached state — no duplicate network calls.
  useEffect(() => {
    if (_initialFetchStarted) return;
    _initialFetchStarted = true;
    void refetch();
  }, []);

  const create = useCallback(async (input: CreateCommentInput) => {
    await apiPost<OverviewComment>("/api/overview/comments/", {
      section_id: input.section_id,
      client_name: input.client_name ?? null,
      body: input.body,
    });
    await refetch();
  }, []);

  const resolve = useCallback(async (id: number) => {
    await apiPost<OverviewComment>(`/api/overview/comments/${id}/resolve`, {});
    await refetch();
  }, []);

  const reopen = useCallback(async (id: number) => {
    await apiPost<OverviewComment>(`/api/overview/comments/${id}/reopen`, {});
    await refetch();
  }, []);

  const remove = useCallback(async (id: number) => {
    await apiDelete(`/api/overview/comments/${id}`);
    await refetch();
  }, []);

  return {
    comments: snapshot.comments,
    loading: snapshot.loading,
    error: snapshot.error,
    refetch,
    create,
    resolve,
    reopen,
    remove,
  };
}
