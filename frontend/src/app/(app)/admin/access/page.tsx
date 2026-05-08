"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Loader2, Plus, RefreshCw, ShieldCheck, X } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import {
  refreshAccessProfile,
  setPreviewAs,
  useAccessProfile,
  type AccessProfile,
} from "@/lib/accessClient";

// ────────────────────────────────────────────────────────────────────────
// Types — mirror backend `app/routers/access.py` schemas.
// ────────────────────────────────────────────────────────────────────────

interface ApiView {
  slug: string;
  label: string;
  parent_label: string;
  sort_order: number;
}
interface ApiGroupSummary {
  slug: string;
  name: string;
  description: string | null;
  is_seeded: boolean;
  is_pod_derived: boolean;
  last_synced_at: string | null;
  member_count: number;
}
interface ApiGroupMember {
  email: string;
  source: "seed" | "manual" | "derived";
  can_remove: boolean;
}
interface ApiGroupDetail {
  slug: string;
  name: string;
  description: string | null;
  is_seeded: boolean;
  is_pod_derived: boolean;
  last_synced_at: string | null;
  members: ApiGroupMember[];
  permissions: Record<string, boolean>;
}
interface ApiUserMatrixRow {
  email: string;
  display_name: string;
  groups: string[];
  pod_kind: string | null;
  pod_number: string | null;
  role: string | null;
  permissions: Record<string, boolean>;
  overrides: Record<string, boolean>;
}
interface ApiAuditEntry {
  id: number;
  when: string;
  actor: string;
  action: string;
  affected: string | null;
  detail: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────────
// Page shell — gates on access.access view; shows a no-access message
// otherwise so the redirect doesn't bounce admins into a black screen.
// ────────────────────────────────────────────────────────────────────────

export default function AccessControlPage() {
  const profile = useAccessProfile();

  if (!profile) {
    return (
      <div className="flex h-64 items-center justify-center text-[#606060]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading access profile…
      </div>
    );
  }

  if (!profile.is_authenticated || !profile.view_slugs.includes("admin.access")) {
    return (
      <div className="mx-auto max-w-xl rounded-lg border border-[#2a2a2a] bg-[#161616] p-6">
        <h2 className="font-mono text-base font-bold uppercase tracking-[0.2em] text-white">
          No Access
        </h2>
        <p className="mt-2 text-sm text-[#C4BCAA]">
          You don&apos;t have permission to view the Access Control matrix. If you
          believe this is a mistake, contact an Admin.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">Admin</p>
        <h1 className="mt-1 font-mono text-lg font-bold uppercase tracking-[0.2em] text-white">
          Access Control
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[#C4BCAA]">
          Per-user and per-group permissions. View-only across the matrix —
          nobody can edit dashboard data through these grants. Group defaults
          flow to every member; per-user overrides win when both apply.
        </p>
      </header>

      {profile.is_preview && (
        <div className="flex items-center justify-between gap-4 rounded-md border border-[#F5BC4E]/30 bg-[#F5BC4E]/10 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-[#F5BC4E]">
          <span className="inline-flex items-center gap-2">
            <Eye className="h-3.5 w-3.5" /> Previewing as <b>{profile.email}</b>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto py-1 text-[11px] uppercase tracking-wider text-[#F5BC4E] hover:bg-[#F5BC4E]/15"
            onClick={() => void setPreviewAs(null)}
          >
            <X className="mr-1 h-3 w-3" /> Exit preview
          </Button>
        </div>
      )}

      {profile.is_admin && !profile.is_preview && <PreviewAsControl />}

      <Tabs defaultValue="groups">
        <TabsList variant="line">
          <TabsTrigger value="groups">Groups</TabsTrigger>
          <TabsTrigger value="users">Users × Views</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="groups">
          <GroupsTab profile={profile} />
        </TabsContent>
        <TabsContent value="users">
          <UsersViewsTab profile={profile} />
        </TabsContent>
        <TabsContent value="audit">
          <AuditTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Preview-as control (admin only)
// ────────────────────────────────────────────────────────────────────────

function PreviewAsControl() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const onSubmit = useCallback(async () => {
    if (!email.trim()) return;
    await setPreviewAs(email.trim().toLowerCase());
    setOpen(false);
    setEmail("");
  }, [email]);
  return (
    <div className="rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-[#909090]">
          <ShieldCheck className="h-3.5 w-3.5" /> Preview Access
        </span>
        <p className="text-[11px] text-[#606060]">
          Render the dashboard as another user — admin-only, in-memory, no
          persisted state.
        </p>
        {!open && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-auto py-1 text-[11px]"
            onClick={() => setOpen(true)}
          >
            Start preview
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            placeholder="email@graphitehq.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-8 max-w-[280px] text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter") void onSubmit();
              if (e.key === "Escape") setOpen(false);
            }}
          />
          <Button size="sm" onClick={onSubmit} disabled={!email.trim()}>
            Apply
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Groups tab
// ────────────────────────────────────────────────────────────────────────

function GroupsTab({ profile }: { profile: AccessProfile }) {
  const [groups, setGroups] = useState<ApiGroupSummary[] | null>(null);
  const [views, setViews] = useState<ApiView[] | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [detail, setDetail] = useState<ApiGroupDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadGroups = useCallback(async () => {
    const [gs, vs] = await Promise.all([
      apiGet<ApiGroupSummary[]>("/api/access/groups"),
      apiGet<ApiView[]>("/api/access/views"),
    ]);
    setGroups(gs);
    setViews(vs);
    if (selectedSlug == null && gs.length > 0) setSelectedSlug(gs[0].slug);
  }, [selectedSlug]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const loadDetail = useCallback(async (slug: string) => {
    setLoadingDetail(true);
    try {
      const d = await apiGet<ApiGroupDetail>(`/api/access/groups/${slug}`);
      setDetail(d);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selectedSlug) void loadDetail(selectedSlug);
  }, [selectedSlug, loadDetail]);

  if (!groups || !views) {
    return <LoadingBlock label="Loading groups…" />;
  }

  // Sort views by parent label then sort_order so the matrix groups together.
  const viewsSorted = [...views].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="grid grid-cols-12 gap-4">
      <aside className="col-span-12 lg:col-span-3">
        <ul className="space-y-1">
          {groups.map((g) => {
            const active = g.slug === selectedSlug;
            return (
              <li key={g.slug}>
                <button
                  type="button"
                  onClick={() => setSelectedSlug(g.slug)}
                  className={
                    "w-full rounded-md border px-3 py-2 text-left transition-colors " +
                    (active
                      ? "border-[#42CA80]/40 bg-[#42CA80]/10"
                      : "border-[#2a2a2a] bg-[#0d0d0d] hover:border-[#3a3a3a]")
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-white">
                      {g.name}
                    </span>
                    <span className="font-mono text-[10px] text-[#606060] tabular-nums">
                      {g.member_count}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-[#606060]">
                    {g.is_pod_derived && <SyncBadge syncedAt={g.last_synced_at} />}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="col-span-12 lg:col-span-9">
        {!detail || loadingDetail ? (
          <LoadingBlock label="Loading group…" />
        ) : (
          <GroupDetailPane
            detail={detail}
            views={viewsSorted}
            isAdmin={profile.is_admin}
            onChanged={async () => {
              await loadDetail(detail.slug);
              await loadGroups();
            }}
          />
        )}
      </section>
    </div>
  );
}

function SyncBadge({ syncedAt }: { syncedAt: string | null }) {
  return (
    <span
      title={
        syncedAt
          ? `Auto-populated from Team Pods sheet · last synced ${new Date(syncedAt).toLocaleString()}`
          : "Auto-populated from Team Pods sheet"
      }
      className="inline-flex items-center gap-1 rounded-sm border border-[#42CA80]/30 bg-[#42CA80]/10 px-1 py-px font-mono text-[9px] uppercase tracking-wider text-[#42CA80]"
    >
      <RefreshCw className="h-2.5 w-2.5" /> sync
    </span>
  );
}

function GroupDetailPane({
  detail,
  views,
  isAdmin,
  onChanged,
}: {
  detail: ApiGroupDetail;
  views: ApiView[];
  isAdmin: boolean;
  onChanged: () => Promise<void>;
}) {
  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">Group</p>
        <h2 className="mt-1 font-mono text-base font-bold uppercase tracking-[0.2em] text-white">
          {detail.name}
        </h2>
        {detail.description && (
          <p className="mt-1 max-w-3xl text-sm text-[#C4BCAA]">{detail.description}</p>
        )}
      </div>

      <PermissionMatrix
        views={views}
        permissions={detail.permissions}
        editable={isAdmin}
        onSet={async (viewSlug, canView) => {
          await apiPut(`/api/access/groups/${detail.slug}/permissions/${viewSlug}`, {
            can_view: canView,
          });
          await refreshAccessProfile();
          await onChanged();
        }}
      />

      <MembersBlock
        slug={detail.slug}
        members={detail.members}
        isAdmin={isAdmin}
        onChanged={onChanged}
      />
    </div>
  );
}

function PermissionMatrix({
  views,
  permissions,
  editable,
  onSet,
}: {
  views: ApiView[];
  permissions: Record<string, boolean>;
  editable: boolean;
  onSet: (viewSlug: string, canView: boolean) => Promise<void>;
}) {
  // Group views by parent so the columns stack visually.
  const grouped = useMemo(() => {
    const out = new Map<string, ApiView[]>();
    for (const v of views) {
      const arr = out.get(v.parent_label) ?? [];
      arr.push(v);
      out.set(v.parent_label, arr);
    }
    return Array.from(out.entries());
  }, [views]);

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
        Default permissions
      </p>
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 lg:grid-cols-4">
        {grouped.map(([parent, vs]) => (
          <div key={parent}>
            <p className="font-mono text-[10px] uppercase tracking-wider text-[#909090]">{parent}</p>
            <ul className="mt-1.5 space-y-1">
              {vs.map((v) => (
                <li
                  key={v.slug}
                  className="flex items-center justify-between gap-2 rounded border border-[#1f1f1f] bg-[#161616] px-2 py-1.5"
                >
                  <span className="font-mono text-[11px] text-[#C4BCAA] truncate" title={v.label}>
                    {v.label}
                  </span>
                  <PermPill
                    canView={!!permissions[v.slug]}
                    editable={editable}
                    onClick={() => void onSet(v.slug, !permissions[v.slug])}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function PermPill({
  canView,
  editable,
  onClick,
  hasOverride,
}: {
  canView: boolean;
  editable: boolean;
  onClick: () => void;
  hasOverride?: boolean;
}) {
  const cls = canView
    ? "border-[#42CA80]/30 bg-[#42CA80]/10 text-[#42CA80]"
    : "border-[#1f1f1f] bg-transparent text-[#404040]";
  const interactive = editable
    ? "cursor-pointer hover:brightness-125 transition"
    : "cursor-default";
  return (
    <button
      type="button"
      disabled={!editable}
      onClick={onClick}
      className={
        "inline-flex h-6 min-w-[44px] items-center justify-center gap-1 rounded border font-mono text-[10px] uppercase tracking-wider " +
        cls + " " + interactive
      }
    >
      {canView ? "View" : "—"}
      {hasOverride && (
        <span
          title="Per-user override active"
          className="inline-block h-1.5 w-1.5 rounded-full bg-[#F5BC4E]"
        />
      )}
    </button>
  );
}

function MembersBlock({
  slug,
  members,
  isAdmin,
  onChanged,
}: {
  slug: string;
  members: ApiGroupMember[];
  isAdmin: boolean;
  onChanged: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!newEmail.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      await apiPost(`/api/access/groups/${slug}/members`, { email: newEmail.trim() });
      setNewEmail("");
      setAdding(false);
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add member");
    } finally {
      setSubmitting(false);
    }
  }, [newEmail, slug, onChanged]);

  const removeMember = useCallback(
    async (email: string) => {
      if (!confirm(`Remove ${email} from this group?`)) return;
      try {
        await apiDelete(`/api/access/groups/${slug}/members/${encodeURIComponent(email)}`);
        await onChanged();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Failed to remove member");
      }
    },
    [slug, onChanged],
  );

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
          Members ({members.length})
        </p>
        {isAdmin && !adding && (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-3 w-3" /> Add member
          </Button>
        )}
      </div>

      {adding && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            placeholder="email@graphitehq.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="h-8 max-w-[280px] text-xs"
            disabled={submitting}
          />
          <Button size="sm" onClick={submit} disabled={!newEmail.trim() || submitting}>
            {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAdding(false);
              setErr(null);
              setNewEmail("");
            }}
          >
            Cancel
          </Button>
          {err && <span className="text-xs text-[#ED6958]">{err}</span>}
        </div>
      )}

      {members.length === 0 ? (
        <p className="mt-3 text-xs text-[#606060]">No members yet.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-1.5 md:grid-cols-2">
          {members.map((m) => (
            <li
              key={m.email}
              className="flex items-center justify-between gap-2 rounded border border-[#1f1f1f] bg-[#161616] px-2 py-1.5"
            >
              <div className="min-w-0 flex-1 truncate">
                <span className="font-mono text-[11px] text-white">{m.email}</span>
                <span className="ml-2 inline-block rounded-sm border border-[#2a2a2a] px-1 py-px font-mono text-[9px] uppercase tracking-wider text-[#909090]">
                  {m.source}
                </span>
              </div>
              {isAdmin && m.can_remove && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[#ED6958] hover:bg-[#ED6958]/10"
                  onClick={() => void removeMember(m.email)}
                  title={
                    m.source === "derived"
                      ? "Auto-populated from Team Pods — will reappear on next sync"
                      : "Remove this member"
                  }
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Users × Views tab
// ────────────────────────────────────────────────────────────────────────

function UsersViewsTab({ profile }: { profile: AccessProfile }) {
  const [users, setUsers] = useState<ApiUserMatrixRow[] | null>(null);
  const [views, setViews] = useState<ApiView[] | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    const [us, vs] = await Promise.all([
      apiGet<ApiUserMatrixRow[]>("/api/access/users"),
      apiGet<ApiView[]>("/api/access/views"),
    ]);
    setUsers(us);
    setViews(vs);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!users || !views) return <LoadingBlock label="Loading users…" />;

  const viewsSorted = [...views].sort((a, b) => a.sort_order - b.sort_order);
  const q = filter.trim().toLowerCase();
  const filtered = q
    ? users.filter(
        (u) =>
          u.email.toLowerCase().includes(q) ||
          u.display_name.toLowerCase().includes(q) ||
          u.groups.some((g) => g.toLowerCase().includes(q)),
      )
    : users;

  const setOverride = async (email: string, viewSlug: string, canView: boolean) => {
    await apiPut(`/api/access/users/${encodeURIComponent(email)}/overrides/${viewSlug}`, {
      can_view: canView,
    });
    await refreshAccessProfile();
    await load();
  };
  const clearOverride = async (email: string, viewSlug: string) => {
    try {
      await apiDelete(
        `/api/access/users/${encodeURIComponent(email)}/overrides/${viewSlug}`,
      );
    } catch {
      // No-op when there's no override to clear.
    }
    await refreshAccessProfile();
    await load();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Input
          placeholder="Filter users…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-8 max-w-[320px] text-xs"
        />
        <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
          {filtered.length} users
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
        <table className="w-full border-collapse text-left">
          <thead className="bg-[#161616]">
            <tr>
              <th className="sticky left-0 z-10 bg-[#161616] px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-[#909090]">
                User
              </th>
              {viewsSorted.map((v) => (
                <th
                  key={v.slug}
                  className="px-2 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-[#909090]"
                  title={`${v.parent_label} · ${v.label}`}
                >
                  {v.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.email} className="border-t border-[#1a1a1a] hover:bg-[#161616]">
                <td className="sticky left-0 z-10 bg-inherit px-3 py-2">
                  <div className="font-mono text-[12px] text-white">{u.display_name}</div>
                  <div className="font-mono text-[10px] text-[#606060]">
                    {u.email}
                    {u.groups.length > 0 && (
                      <span className="ml-1 text-[#404040]">
                        · {u.groups.join(", ")}
                      </span>
                    )}
                  </div>
                </td>
                {viewsSorted.map((v) => {
                  const can = !!u.permissions[v.slug];
                  const hasOverride = Object.prototype.hasOwnProperty.call(u.overrides, v.slug);
                  return (
                    <td key={v.slug} className="px-2 py-2 text-center">
                      <PermPill
                        canView={can}
                        editable={profile.is_admin}
                        hasOverride={hasOverride}
                        onClick={() => {
                          if (!profile.is_admin) return;
                          // Cycle: no-override → override-grant → override-revoke → clear.
                          if (!hasOverride) {
                            void setOverride(u.email, v.slug, !can);
                          } else {
                            void clearOverride(u.email, v.slug);
                          }
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="font-mono text-[10px] text-[#606060]">
        Click a cell to set / clear a per-user override. Amber dot = override
        in place. Cells without a dot inherit from the user&apos;s group(s).
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Audit log tab
// ────────────────────────────────────────────────────────────────────────

function AuditTab() {
  const [entries, setEntries] = useState<ApiAuditEntry[] | null>(null);
  useEffect(() => {
    apiGet<ApiAuditEntry[]>("/api/access/audit?limit=200")
      .then(setEntries)
      .catch(() => setEntries([]));
  }, []);

  if (!entries) return <LoadingBlock label="Loading audit log…" />;
  if (entries.length === 0) {
    return (
      <p className="text-sm text-[#606060]">
        No access-control changes recorded yet.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5">
      {entries.map((e) => (
        <li
          key={e.id}
          className="rounded border border-[#1f1f1f] bg-[#0d0d0d] px-3 py-2"
        >
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[#909090]">
              {new Date(e.when).toLocaleString()}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-[#42CA80]">
              {e.action}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-white">
            {e.actor} → {e.affected ?? "(group)"}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-[#606060]">
            {Object.entries(e.detail)
              .filter(([k]) => k !== "affected")
              .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
              .join(" · ")}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Misc
// ────────────────────────────────────────────────────────────────────────

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex h-32 items-center justify-center font-mono text-[11px] text-[#606060]">
      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> {label}
    </div>
  );
}
