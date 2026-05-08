"use client";

/** Thin client for `/api/overview/comments`. Fetched per Overview-page
 *  mount + after every admin mutation; the rail subscribes via the
 *  exported hook so all section threads re-render in lockstep. */

import { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost } from "@/lib/api";

export interface OverviewComment {
  id: number;
  section_id: string;
  client_name: string;
  author_email: string;
  author_name: string | null;
  body: string;
  resolved_at: string | null;
  resolved_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export function useOverviewComments() {
  const [comments, setComments] = useState<OverviewComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiGet<OverviewComment[]>("/api/overview/comments/");
      setComments(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load comments");
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const create = useCallback(
    async (input: { section_id: string; client_name: string; body: string }) => {
      await apiPost<OverviewComment>("/api/overview/comments/", input);
      await refetch();
    },
    [refetch],
  );

  const resolve = useCallback(
    async (id: number) => {
      await apiPost<OverviewComment>(`/api/overview/comments/${id}/resolve`, {});
      await refetch();
    },
    [refetch],
  );

  const reopen = useCallback(
    async (id: number) => {
      await apiPost<OverviewComment>(`/api/overview/comments/${id}/reopen`, {});
      await refetch();
    },
    [refetch],
  );

  const remove = useCallback(
    async (id: number) => {
      await apiDelete(`/api/overview/comments/${id}`);
      await refetch();
    },
    [refetch],
  );

  return { comments, loading, error, refetch, create, resolve, reopen, remove };
}
