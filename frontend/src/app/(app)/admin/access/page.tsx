"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import {
  firstAccessibleRoute,
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
  // Three-level header: parent_label is the section (Dashboards / Data / Admin),
  // dashboard_label is the dashboard within that section (Editorial Clients,
  // Team KPIs, Overview, …), and `label` is the leaf — a tab inside the
  // dashboard, or = dashboard_label when the dashboard has no tabs.
  parent_label: string;
  dashboard_label: string;
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
  // Seeded admin (Daniela / Ricardo). Their View + Edit pills under
  // Access Control are locked for EVERYONE, including other admins —
  // protects the original admin baseline from accidental lockout.
  // Backend mirrors this with a 403 on override mutations.
  is_seeded_admin?: boolean;
}
// View slugs the matrix treats specially.
//   ACCESS_VIEW = "see the matrix" — users with this can read but not edit.
//   ACCESS_EDIT = "edit the matrix" — toggling this is the privilege admins
//                 selectively grant; mirrors a second "Edit" pill rendered
//                 inside the Access Control cell rather than its own column.
const ACCESS_VIEW = "admin.access";
const ACCESS_EDIT = "admin.access.edit";

// Granting/revoking these is the privilege-escalation door, so editing them
// stays restricted to true admins regardless of who else holds ACCESS_EDIT.
const SENSITIVE_VIEWS = new Set([ACCESS_VIEW, ACCESS_EDIT]);
const SENSITIVE_GROUPS = new Set(["admin"]);

// Edit-permission helpers. The matrix only ever calls these — no place
// references `profile.is_admin` directly for cell-level edits anymore.
function hasEditAccess(profile: AccessProfile): boolean {
  return profile.is_admin || profile.view_slugs.includes(ACCESS_EDIT);
}
function canEditCell(
  groupSlug: string,
  viewSlug: string,
  profile: AccessProfile,
): boolean {
  // Admin group permissions are immutable — admin = full access by
  // definition; toggling any cell off would brick the matrix for
  // everyone. Backend mirrors this with a 403.
  if (SENSITIVE_GROUPS.has(groupSlug)) return false;
  if (SENSITIVE_VIEWS.has(viewSlug)) return profile.is_admin;
  return hasEditAccess(profile);
}
function canEditOverride(
  viewSlug: string,
  profile: AccessProfile,
  isSeededAdmin: boolean = false,
): boolean {
  // Seeded admins (Daniela / Ricardo) are immutable across the WHOLE
  // matrix — even other admins can't override them. Protects the
  // original admin baseline from accidental access changes anywhere.
  if (isSeededAdmin) return false;
  // Access Control overrides are admin-only (true Admin group).
  if (SENSITIVE_VIEWS.has(viewSlug)) return profile.is_admin;
  return hasEditAccess(profile);
}
function canEditMembers(groupSlug: string, profile: AccessProfile): boolean {
  if (SENSITIVE_GROUPS.has(groupSlug)) return profile.is_admin;
  return hasEditAccess(profile);
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

      {/* Preview-as banner is rendered globally in the app layout via
          `PreviewBanner`, so it's visible on every page (including the
          previewed user's first accessible route, not just here). */}

      {!hasEditAccess(profile) && (
        <div className="flex items-center gap-2 rounded-md border border-[#2a2a2a] bg-[#161616] px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-[#909090]">
          <ShieldCheck className="h-3.5 w-3.5 text-[#606060]" />
          View-only mode — you can read the matrix but can&apos;t change
          permissions or memberships. Ask an Admin for the
          <span className="text-[#65FFAA]"> Edit Access Control </span>
          privilege if you need to make changes.
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
  const router = useRouter();
  const pathname = usePathname();
  const onSubmit = useCallback(async () => {
    if (!email.trim()) return;
    // Capture the admin's current path so the Exit Preview button can
    // return them here. Then redirect to the previewed user's first
    // accessible route — otherwise they'd land on Access Control's
    // No Access wall when previewing as a non-admin.
    const fresh = await setPreviewAs(email.trim().toLowerCase(), pathname);
    setOpen(false);
    setEmail("");
    if (fresh && !fresh.view_slugs.includes("admin.access")) {
      const target = firstAccessibleRoute(fresh.view_slugs);
      if (target) router.push(target);
    }
  }, [email, pathname, router]);
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
// Shared matrix header — three-row header:
//   Row 1: section (parent_label) — Dashboards / Data / Admin
//   Row 2: dashboard (dashboard_label) — Editorial Clients, Team KPIs, …
//   Row 3: tab (view label) — only present for dashboards with multiple
//          tabs; single-tab dashboards rowSpan over rows 2+3.
// Used by both Groups and Users × Views tabs so column alignment matches.
// ────────────────────────────────────────────────────────────────────────

interface DashboardRun {
  dashboard_label: string;
  views: ApiView[];
}
interface SectionRun {
  parent_label: string;
  dashboards: DashboardRun[];
  total_views: number;
}

// Defensive normalizer — older backend responses omit `dashboard_label`
// (the field was added with the 3-level header rollout). Fill in sensible
// defaults so the matrix renders cleanly during the deploy window when
// the API and the frontend are temporarily out of sync.
function normalizeViews(views: ApiView[]): ApiView[] {
  return views.map((v) => ({
    ...v,
    dashboard_label: v.dashboard_label || v.label,
    parent_label: v.parent_label || "Other",
  }));
}

function buildSectionRuns(views: ApiView[]): SectionRun[] {
  // Walk the (already-sorted) views and double-RLE by section then dashboard.
  const sections: SectionRun[] = [];
  for (const v of views) {
    const sTail = sections[sections.length - 1];
    if (sTail && sTail.parent_label === v.parent_label) {
      const dTail = sTail.dashboards[sTail.dashboards.length - 1];
      if (dTail && dTail.dashboard_label === v.dashboard_label) {
        dTail.views.push(v);
      } else {
        sTail.dashboards.push({ dashboard_label: v.dashboard_label, views: [v] });
      }
      sTail.total_views += 1;
    } else {
      sections.push({
        parent_label: v.parent_label,
        dashboards: [{ dashboard_label: v.dashboard_label, views: [v] }],
        total_views: 1,
      });
    }
  }
  return sections;
}

// A dashboard "is a leaf" (no tabs) when it has exactly one view AND that
// view's label matches the dashboard label. The middle-row cell then
// rowSpan=2 over the empty tab row beneath.
function isLeafDashboard(d: DashboardRun): boolean {
  return d.views.length === 1 && d.views[0].label === d.dashboard_label;
}

function MatrixHeader({ rowLabel, views }: { rowLabel: string; views: ApiView[] }) {
  const sections = buildSectionRuns(views);
  return (
    <thead className="bg-[#161616]">
      {/* Row 1: sections */}
      <tr>
        <th
          rowSpan={3}
          className="sticky left-0 z-10 bg-[#161616] border-b border-[#2a2a2a] border-r-2 border-r-[#3a3a3a] px-3 py-2 align-bottom font-mono text-[10px] uppercase tracking-wider text-[#909090]"
        >
          {rowLabel}
        </th>
        {sections.map((s, si) => (
          <th
            key={`s-${si}-${s.dashboards[0]?.views[0]?.slug ?? "x"}`}
            colSpan={s.total_views}
            className={
              "px-2 pt-2 pb-1 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-[#65FFAA] bg-[#1F1F1F] " +
              (si > 0 ? "border-l-2 border-[#3a3a3a]" : "")
            }
          >
            {s.parent_label}
          </th>
        ))}
      </tr>
      {/* Row 2: dashboards (leaf dashboards rowSpan=2 over the tab row) */}
      <tr>
        {sections.flatMap((s, si) =>
          s.dashboards.map((d, di) => {
            const isFirstInSection = di === 0;
            const dividerCls =
              si > 0 && isFirstInSection ? "border-l-2 border-[#3a3a3a]" : "";
            const subDividerCls =
              !isFirstInSection ? "border-l border-[#2a2a2a]" : "";
            const baseCls =
              "px-2 py-1.5 text-center font-mono text-[10px] uppercase tracking-wider text-white " +
              `${dividerCls} ${subDividerCls}`.trim();
            if (isLeafDashboard(d)) {
              return (
                <th
                  key={`d-${si}-${di}-${d.views[0]?.slug ?? "x"}`}
                  rowSpan={2}
                  className={
                    "border-b border-[#2a2a2a] align-middle " + baseCls
                  }
                >
                  {d.dashboard_label}
                </th>
              );
            }
            return (
              <th
                key={`d-${si}-${di}-${d.views[0]?.slug ?? "x"}`}
                colSpan={d.views.length}
                className={baseCls}
              >
                {d.dashboard_label}
              </th>
            );
          }),
        )}
      </tr>
      {/* Row 3: tabs — only for non-leaf dashboards */}
      <tr>
        {sections.flatMap((s, si) =>
          s.dashboards.flatMap((d, di) => {
            if (isLeafDashboard(d)) return [];
            return d.views.map((v, vi) => {
              const isFirstInDashboard = vi === 0;
              const isFirstInSection = di === 0 && isFirstInDashboard;
              const dividerCls =
                si > 0 && isFirstInSection
                  ? "border-l-2 border-[#3a3a3a]"
                  : "";
              const subDividerCls =
                !isFirstInSection && isFirstInDashboard
                  ? "border-l border-[#2a2a2a]"
                  : "";
              return (
                <th
                  key={v.slug}
                  className={
                    "border-b border-[#2a2a2a] px-2 pt-1 pb-2 text-center font-mono text-[10px] uppercase tracking-wider text-[#909090] " +
                    `${dividerCls} ${subDividerCls}`.trim()
                  }
                  title={`${v.parent_label} · ${v.dashboard_label} · ${v.label}`}
                >
                  {v.label}
                </th>
              );
            });
          }),
        )}
      </tr>
    </thead>
  );
}

// Body-cell divider: returns "section" when this cell starts a new section
// (heavy border), "dashboard" when it starts a new dashboard inside the
// same section (subtle border), or "" otherwise. Carries the column
// gutters through every body row so the grouping stays visible while
// scrolling.
function cellDividerKind(
  views: ApiView[],
  idx: number,
): "section" | "dashboard" | "" {
  if (idx === 0) return "";
  const prev = views[idx - 1];
  const cur = views[idx];
  if (prev.parent_label !== cur.parent_label) return "section";
  if (prev.dashboard_label !== cur.dashboard_label) return "dashboard";
  return "";
}
function dividerClass(kind: "section" | "dashboard" | ""): string {
  // Section breaks get a heavier, brighter rule so the eye lands on
  // Dashboards / Data / Admin clearly when scanning across columns.
  // Dashboard breaks use a thinner line so the inner grouping is visible
  // but doesn't compete with section boundaries.
  if (kind === "section") return "border-l-2 border-[#3a3a3a]";
  if (kind === "dashboard") return "border-l border-[#2a2a2a]";
  return "";
}

// ────────────────────────────────────────────────────────────────────────
// Groups tab
// ────────────────────────────────────────────────────────────────────────

function GroupsTab({ profile }: { profile: AccessProfile }) {
  const [groups, setGroups] = useState<ApiGroupSummary[] | null>(null);
  const [views, setViews] = useState<ApiView[] | null>(null);
  const [details, setDetails] = useState<Map<string, ApiGroupDetail>>(new Map());
  const [filter, setFilter] = useState("");
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const [gs, vs] = await Promise.all([
      apiGet<ApiGroupSummary[]>("/api/access/groups"),
      apiGet<ApiView[]>("/api/access/views"),
    ]);
    const ds = await Promise.all(
      gs.map((g) => apiGet<ApiGroupDetail>(`/api/access/groups/${g.slug}`)),
    );
    setGroups(gs);
    setViews(normalizeViews(vs));
    setDetails(new Map(ds.map((d) => [d.slug, d])));
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const refreshOneGroup = useCallback(async (slug: string) => {
    const [d, gs] = await Promise.all([
      apiGet<ApiGroupDetail>(`/api/access/groups/${slug}`),
      apiGet<ApiGroupSummary[]>("/api/access/groups"),
    ]);
    setDetails((prev) => {
      const next = new Map(prev);
      next.set(slug, d);
      return next;
    });
    setGroups(gs);
  }, []);

  if (!groups || !views) return <LoadingBlock label="Loading groups…" />;

  // Sort views identically to Users × Views so the columns line up.
  // `admin.access.edit` is filtered out of the column header — it renders
  // as a second pill inside the `admin.access` cell, not as its own column.
  const viewsSorted = [...views].sort((a, b) => a.sort_order - b.sort_order);
  const displayViews = viewsSorted.filter((v) => v.slug !== ACCESS_EDIT);
  const editView = viewsSorted.find((v) => v.slug === ACCESS_EDIT);

  // Filter on group name OR any member email so admins can also "find the
  // group X is in." Member match requires details to be loaded — which they
  // are after the initial parallel fetch.
  const q = filter.trim().toLowerCase();
  const filtered = q
    ? groups.filter((g) => {
        if (g.name.toLowerCase().includes(q)) return true;
        if (g.slug.toLowerCase().includes(q)) return true;
        const d = details.get(g.slug);
        return !!d?.members.some((m) => m.email.toLowerCase().includes(q));
      })
    : groups;

  const setGroupPerm = async (slug: string, viewSlug: string, canView: boolean) => {
    await apiPut(`/api/access/groups/${slug}/permissions/${viewSlug}`, {
      can_view: canView,
    });
    await refreshAccessProfile();
    await refreshOneGroup(slug);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Input
          placeholder="Filter groups…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-8 max-w-[320px] text-xs"
        />
        <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
          {filtered.length} {filtered.length === 1 ? "group" : "groups"}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
        <table className="w-full border-collapse text-left">
          <MatrixHeader rowLabel="Group" views={displayViews} />
          <tbody>
            {filtered.map((g) => {
              const detail = details.get(g.slug);
              const isExpanded = expandedSlug === g.slug;
              return (
                <FragmentRow
                  key={g.slug}
                  group={g}
                  detail={detail}
                  views={displayViews}
                  editView={editView}
                  profile={profile}
                  isExpanded={isExpanded}
                  onToggleExpand={() =>
                    setExpandedSlug(isExpanded ? null : g.slug)
                  }
                  onSetPerm={(viewSlug, canView) =>
                    setGroupPerm(g.slug, viewSlug, canView)
                  }
                  onMembersChanged={() => refreshOneGroup(g.slug)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="font-mono text-[10px] text-[#606060]">
        Click any cell to grant or revoke a group&apos;s view access. Click the
        chevron to expand a group&apos;s members inline.
      </p>
    </div>
  );
}

function FragmentRow({
  group,
  detail,
  views,
  editView,
  profile,
  isExpanded,
  onToggleExpand,
  onSetPerm,
  onMembersChanged,
}: {
  group: ApiGroupSummary;
  detail: ApiGroupDetail | undefined;
  views: ApiView[];
  // The hidden `admin.access.edit` view, rendered as a second pill inside
  // the Access Control cell. May be missing if the backend hasn't seeded
  // it yet (e.g. older deploy) — render the row gracefully without it.
  editView: ApiView | undefined;
  profile: AccessProfile;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSetPerm: (viewSlug: string, canView: boolean) => Promise<void>;
  onMembersChanged: () => Promise<void>;
}) {
  const Chevron = isExpanded ? ChevronDown : ChevronRight;
  return (
    <>
      <tr className="border-t border-[#1a1a1a] hover:bg-[#161616]">
        <td className="sticky left-0 z-10 bg-inherit border-r-2 border-r-[#3a3a3a] px-3 py-2">
          <button
            type="button"
            onClick={onToggleExpand}
            className="flex w-full items-center gap-2 text-left"
          >
            <Chevron className="h-3.5 w-3.5 shrink-0 text-[#606060]" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] font-semibold uppercase tracking-wider text-white">
                  {group.name}
                </span>
                <span className="font-mono text-[10px] text-[#606060] tabular-nums">
                  {group.member_count}
                </span>
                {group.is_pod_derived && <SyncBadge syncedAt={group.last_synced_at} />}
              </div>
              {group.description && (
                <div className="mt-0.5 max-w-md truncate font-mono text-[10px] text-[#606060]">
                  {group.description}
                </div>
              )}
            </div>
          </button>
        </td>
        {views.map((v, idx) => {
          const canView = !!detail?.permissions[v.slug];
          const dividerCls = dividerClass(cellDividerKind(views, idx));
          const editable = canEditCell(group.slug, v.slug, profile) && !!detail;

          // Special case: the Access Control cell renders TWO pills
          // (View + Edit). The Edit pill maps to the hidden
          // `admin.access.edit` view; toggling it grants/revokes the
          // matrix-edit privilege for this group.
          if (v.slug === ACCESS_VIEW && editView) {
            const canEdit = !!detail?.permissions[editView.slug];
            const editableEditPill =
              canEditCell(group.slug, editView.slug, profile) && !!detail && canView;
            return (
              <td key={v.slug} className={`px-2 py-2 text-center ${dividerCls}`}>
                <div className="inline-flex items-center gap-1">
                  <PermPill
                    canView={canView}
                    editable={editable}
                    onClick={() => {
                      if (!editable) return;
                      void onSetPerm(v.slug, !canView);
                    }}
                    label="View"
                  />
                  <PermPill
                    canView={canEdit}
                    editable={editableEditPill}
                    onClick={() => {
                      if (!editableEditPill) return;
                      void onSetPerm(editView.slug, !canEdit);
                    }}
                    label="Edit"
                    tone="blue"
                    title={
                      !canView
                        ? "Grant View first — Edit requires View access"
                        : canEdit
                          ? "Revoke matrix-edit privilege"
                          : "Grant matrix-edit privilege"
                    }
                  />
                </div>
              </td>
            );
          }

          return (
            <td key={v.slug} className={`px-2 py-2 text-center ${dividerCls}`}>
              <PermPill
                canView={canView}
                editable={editable}
                onClick={() => {
                  if (!editable) return;
                  void onSetPerm(v.slug, !canView);
                }}
              />
            </td>
          );
        })}
      </tr>
      {isExpanded && detail && (
        <tr className="bg-[#0a0a0a]">
          <td
            colSpan={views.length + 1}
            className="border-t border-[#1a1a1a] px-3 py-3"
          >
            <MembersBlock
              slug={detail.slug}
              members={detail.members}
              isAdmin={canEditMembers(detail.slug, profile)}
              onChanged={onMembersChanged}
            />
          </td>
        </tr>
      )}
    </>
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

function PermPill({
  canView,
  editable,
  onClick,
  override,
  label,
  title,
  tone = "green",
}: {
  canView: boolean;
  editable: boolean;
  onClick: () => void;
  // "grant"  → user has MORE access than their group(s) provide
  // "revoke" → user has LESS access than their group(s) provide
  // undefined → effective state matches the group default (no override active)
  override?: "grant" | "revoke";
  // Custom on-pill text. Defaults to "View" / "—". The Access Control cell
  // uses two pills with labels "View" + "Edit" rendered side-by-side.
  label?: string;
  // Optional explicit tooltip; falls back to the override-direction copy
  // when present, otherwise no title.
  title?: string;
  // Default tone is green (View pills). The Edit pill uses "blue" so the
  // two are visually distinguishable inside the same Access Control cell.
  tone?: "green" | "blue";
}) {
  // Base palette per tone (used when there's no override and the cell is
  // granted). Override states (grant / revoke) use the same green / red
  // regardless of tone — the override-direction read shouldn't depend on
  // which kind of pill it's on.
  const grantedCls =
    tone === "blue"
      ? "border-[#4ECBE5]/40 bg-[#4ECBE5]/10 text-[#4ECBE5]"
      : "border-[#42CA80]/30 bg-[#42CA80]/10 text-[#42CA80]";
  let cls: string;
  if (override === "grant") {
    cls =
      "border-[#65FFAA] bg-[#42CA80]/15 text-[#65FFAA] ring-1 ring-[#65FFAA]/30";
  } else if (override === "revoke") {
    cls = "border-[#ED6958] bg-[#ED6958]/10 text-[#ED6958] ring-1 ring-[#ED6958]/30";
  } else if (canView) {
    cls = grantedCls;
  } else {
    cls = "border-[#1f1f1f] bg-transparent text-[#404040]";
  }
  const interactive = editable
    ? "cursor-pointer hover:brightness-125 transition"
    : "cursor-default";
  const tooltip =
    title ??
    (override === "grant"
      ? "Per-user override grants this user MORE access than their group(s) provide. Click to clear."
      : override === "revoke"
        ? "Per-user override REVOKES access this user's group(s) would otherwise grant. Click to clear."
        : undefined);
  const onLabel = label ?? "View";
  const offLabel = label ?? "—";
  return (
    <button
      type="button"
      disabled={!editable}
      onClick={onClick}
      title={tooltip}
      className={
        "inline-flex h-6 min-w-[44px] items-center justify-center gap-1 rounded border font-mono text-[10px] uppercase tracking-wider " +
        cls +
        " " +
        interactive
      }
    >
      {canView ? onLabel : offLabel}
      {override === "grant" && <ArrowUp className="h-3 w-3" strokeWidth={2.5} />}
      {override === "revoke" && (
        <ArrowDown className="h-3 w-3" strokeWidth={2.5} />
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
        <ul className="mt-3 grid grid-cols-1 gap-1.5 md:grid-cols-2 xl:grid-cols-3">
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
  // Group permissions are needed so we can show the *direction* of each
  // override (grant beyond group, or revoke below group). We fetch them
  // once on mount; the matrix rebuilds whenever permissions change.
  const [groupPerms, setGroupPerms] = useState<Record<string, Record<string, boolean>>>({});
  const [filter, setFilter] = useState("");
  const [onlyOverrides, setOnlyOverrides] = useState(false);

  const load = useCallback(async () => {
    const [us, vs, gs] = await Promise.all([
      apiGet<ApiUserMatrixRow[]>("/api/access/users"),
      apiGet<ApiView[]>("/api/access/views"),
      apiGet<ApiGroupSummary[]>("/api/access/groups"),
    ]);
    const ds = await Promise.all(
      gs.map((g) => apiGet<ApiGroupDetail>(`/api/access/groups/${g.slug}`)),
    );
    setUsers(us);
    setViews(normalizeViews(vs));
    setGroupPerms(Object.fromEntries(ds.map((d) => [d.slug, d.permissions])));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!users || !views) return <LoadingBlock label="Loading users…" />;

  const viewsSorted = [...views].sort((a, b) => a.sort_order - b.sort_order);
  // `admin.access.edit` rides inside the Access Control cell as a second
  // pill — keep it out of the column header but reachable for cell logic.
  const displayViews = viewsSorted.filter((v) => v.slug !== ACCESS_EDIT);
  const editView = viewsSorted.find((v) => v.slug === ACCESS_EDIT);

  // Compute group-default access for a (user, view) pair. Default is the OR
  // of every group the user belongs to. Missing group → treat as false so
  // we don't claim coverage we can't prove.
  const getGroupDefault = (u: ApiUserMatrixRow, viewSlug: string): boolean => {
    for (const g of u.groups) {
      if (groupPerms[g]?.[viewSlug]) return true;
    }
    return false;
  };

  // Override direction relative to the group default. Only flagged when the
  // override actually moves the cell — a redundant override (override matches
  // group default) reads as a regular cell.
  const getOverrideDirection = (
    u: ApiUserMatrixRow,
    viewSlug: string,
  ): "grant" | "revoke" | undefined => {
    const ov = u.overrides[viewSlug];
    if (ov === undefined) return undefined;
    const groupDefault = getGroupDefault(u, viewSlug);
    if (ov === groupDefault) return undefined;
    return ov ? "grant" : "revoke";
  };

  // Per-user override summary so we can (a) gate the "only overrides" filter
  // and (b) drive the "N users have overrides" chip.
  const overrideCounts = users.map((u) => ({
    email: u.email,
    grants: viewsSorted.filter((v) => getOverrideDirection(u, v.slug) === "grant")
      .length,
    revokes: viewsSorted.filter((v) => getOverrideDirection(u, v.slug) === "revoke")
      .length,
  }));
  const usersWithOverrides = new Set(
    overrideCounts.filter((c) => c.grants + c.revokes > 0).map((c) => c.email),
  );

  const q = filter.trim().toLowerCase();
  const filtered = users.filter((u) => {
    if (onlyOverrides && !usersWithOverrides.has(u.email)) return false;
    if (!q) return true;
    return (
      u.email.toLowerCase().includes(q) ||
      u.display_name.toLowerCase().includes(q) ||
      u.groups.some((g) => g.toLowerCase().includes(q))
    );
  });

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
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Filter users…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-8 max-w-[320px] text-xs"
        />
        <span className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
          {filtered.length} {filtered.length === 1 ? "user" : "users"}
        </span>
        {usersWithOverrides.size > 0 && (
          <button
            type="button"
            onClick={() => setOnlyOverrides((v) => !v)}
            className={
              "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 font-mono text-[10px] uppercase tracking-wider transition " +
              (onlyOverrides
                ? "border-[#F5BC4E]/50 bg-[#F5BC4E]/10 text-[#F5BC4E]"
                : "border-[#2a2a2a] bg-[#0d0d0d] text-[#909090] hover:border-[#3a3a3a]")
            }
            title={
              onlyOverrides
                ? "Showing only users with at least one override; click to show everyone again."
                : "Show only users whose effective access differs from their group default."
            }
          >
            {onlyOverrides ? "Showing overrides" : "Show only overrides"}
            <span className="rounded-sm bg-[#F5BC4E]/15 px-1 font-mono text-[10px] text-[#F5BC4E]">
              {usersWithOverrides.size}
            </span>
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#2a2a2a] bg-[#0d0d0d]">
        <table className="w-full border-collapse text-left">
          <MatrixHeader rowLabel="User" views={displayViews} />
          <tbody>
            {filtered.map((u) => {
              const counts = overrideCounts.find((c) => c.email === u.email);
              return (
                <tr key={u.email} className="border-t border-[#1a1a1a] hover:bg-[#161616]">
                  <td className="sticky left-0 z-10 bg-inherit border-r-2 border-r-[#3a3a3a] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="font-mono text-[12px] text-white">
                        {u.display_name}
                      </div>
                      {counts && counts.grants > 0 && (
                        <span
                          className="inline-flex items-center gap-0.5 rounded-sm border border-[#65FFAA]/40 bg-[#42CA80]/10 px-1 py-px font-mono text-[9px] text-[#65FFAA]"
                          title={`${counts.grants} extra grant${counts.grants === 1 ? "" : "s"} beyond this user's group(s)`}
                        >
                          <ArrowUp className="h-2.5 w-2.5" strokeWidth={2.5} />
                          {counts.grants}
                        </span>
                      )}
                      {counts && counts.revokes > 0 && (
                        <span
                          className="inline-flex items-center gap-0.5 rounded-sm border border-[#ED6958]/40 bg-[#ED6958]/10 px-1 py-px font-mono text-[9px] text-[#ED6958]"
                          title={`${counts.revokes} access${counts.revokes === 1 ? "" : "es"} revoked below this user's group default`}
                        >
                          <ArrowDown className="h-2.5 w-2.5" strokeWidth={2.5} />
                          {counts.revokes}
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[10px] text-[#606060]">
                      {u.email}
                      {u.groups.length > 0 && (
                        <span className="ml-1 text-[#404040]">
                          · {u.groups.join(", ")}
                        </span>
                      )}
                    </div>
                  </td>
                  {displayViews.map((v, idx) => {
                    const can = !!u.permissions[v.slug];
                    const direction = getOverrideDirection(u, v.slug);
                    const dividerCls = dividerClass(
                      cellDividerKind(displayViews, idx),
                    );
                    const isSeededAdmin = !!u.is_seeded_admin;
                    const editable = canEditOverride(v.slug, profile, isSeededAdmin);
                    const cycleOverride = (
                      vSlug: string,
                      currentEffective: boolean,
                    ) => {
                      const hasOverride = Object.prototype.hasOwnProperty.call(
                        u.overrides,
                        vSlug,
                      );
                      if (!hasOverride) {
                        void setOverride(u.email, vSlug, !currentEffective);
                      } else {
                        void clearOverride(u.email, vSlug);
                      }
                    };

                    // Two-pill rendering for the Access Control cell.
                    if (v.slug === ACCESS_VIEW && editView) {
                      const canEdit = !!u.permissions[editView.slug];
                      const editDirection = getOverrideDirection(u, editView.slug);
                      const editPillEditable =
                        canEditOverride(editView.slug, profile, isSeededAdmin) && can;
                      return (
                        <td
                          key={v.slug}
                          className={`px-2 py-2 text-center ${dividerCls}`}
                        >
                          <div className="inline-flex items-center gap-1">
                            <PermPill
                              canView={can}
                              editable={editable}
                              override={direction}
                              onClick={() => {
                                if (!editable) return;
                                cycleOverride(v.slug, can);
                              }}
                              label="View"
                              title={
                                isSeededAdmin
                                  ? "Seeded Admin — locked across the whole matrix. The original admin baseline can't be overridden."
                                  : undefined
                              }
                            />
                            <PermPill
                              canView={canEdit}
                              editable={editPillEditable}
                              override={editDirection}
                              onClick={() => {
                                if (!editPillEditable) return;
                                cycleOverride(editView.slug, canEdit);
                              }}
                              label="Edit"
                              tone="blue"
                              title={
                                isSeededAdmin
                                  ? "Seeded Admin — locked across the whole matrix. The original admin baseline can't be overridden."
                                  : !can
                                    ? "Grant View first — Edit requires View access"
                                    : undefined
                              }
                            />
                          </div>
                        </td>
                      );
                    }

                    return (
                      <td key={v.slug} className={`px-2 py-2 text-center ${dividerCls}`}>
                        <PermPill
                          canView={can}
                          editable={editable}
                          override={direction}
                          onClick={() => {
                            if (!editable) return;
                            cycleOverride(v.slug, can);
                          }}
                          title={
                            isSeededAdmin
                              ? "Seeded Admin — locked across the whole matrix. The original admin baseline can't be overridden."
                              : undefined
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2 font-mono text-[10px] text-[#909090]">
        <span className="font-semibold uppercase tracking-wider text-[#606060]">
          Legend
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex h-5 min-w-[40px] items-center justify-center rounded border border-[#42CA80]/30 bg-[#42CA80]/10 px-1.5 text-[#42CA80]">
            View
          </span>
          Inherits from this user&apos;s group(s)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex h-5 min-w-[40px] items-center justify-center gap-0.5 rounded border border-[#65FFAA] bg-[#42CA80]/15 px-1.5 text-[#65FFAA] ring-1 ring-[#65FFAA]/30">
            View
            <ArrowUp className="h-2.5 w-2.5" strokeWidth={2.5} />
          </span>
          Extra grant — user has MORE access than their group(s)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex h-5 min-w-[40px] items-center justify-center gap-0.5 rounded border border-[#ED6958] bg-[#ED6958]/10 px-1.5 text-[#ED6958] ring-1 ring-[#ED6958]/30">
            —
            <ArrowDown className="h-2.5 w-2.5" strokeWidth={2.5} />
          </span>
          Revoked — user has LESS access than their group(s)
        </span>
        <span className="text-[#606060]">
          · Click any cell to set or clear an override.
        </span>
      </div>
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
