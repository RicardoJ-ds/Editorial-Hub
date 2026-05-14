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
  Undo2,
  X,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  firstAccessibleRoute,
  refreshAccessProfile,
  setPreviewAs,
  useAccessProfile,
  type AccessProfile,
} from "@/lib/accessClient";
import {
  confirmDiscardIfUnsaved,
  setUnsavedChanges,
} from "@/lib/unsavedChangesClient";

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

      <AccessTabs profile={profile} />
    </div>
  );
}

/** Controlled Tabs wrapper. Two responsibilities:
 *   1. Force-mount every panel so switching between Groups / Users ×
 *      Views / Audit Log keeps each tab's local React state alive —
 *      otherwise a draft staged in Groups would be wiped the moment
 *      the user clicked Users × Views and back.
 *   2. Gate tab swaps on `confirmDiscardIfUnsaved()` so the actor
 *      can't silently drop a draft by clicking another tab. (The
 *      forceMount on point 1 makes this mostly cosmetic — state is
 *      preserved either way — but the confirm is the same one fired
 *      by sidebar navigation, so the UX stays consistent.) */
function AccessTabs({ profile }: { profile: AccessProfile }) {
  const [tab, setTab] = useState("groups");
  return (
    <Tabs
      value={tab}
      onValueChange={(next) => {
        if (next === tab) return;
        if (!confirmDiscardIfUnsaved()) return;
        setTab(next);
      }}
    >
      <TabsList variant="line">
        <TabsTrigger value="groups">Groups</TabsTrigger>
        <TabsTrigger value="users">Users × Views</TabsTrigger>
        <TabsTrigger value="audit">Audit Log</TabsTrigger>
      </TabsList>

      <TabsContent value="groups" keepMounted className="data-[state=inactive]:hidden">
        <GroupsTab profile={profile} />
      </TabsContent>
      <TabsContent value="users" keepMounted className="data-[state=inactive]:hidden">
        <UsersViewsTab profile={profile} />
      </TabsContent>
      <TabsContent value="audit" keepMounted className="data-[state=inactive]:hidden">
        <AuditTab />
      </TabsContent>
    </Tabs>
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
            variant="outline"
            size="sm"
            className="h-7 border-[#42CA80]/40 bg-[#42CA80]/10 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#42CA80] hover:border-[#42CA80] hover:bg-[#42CA80]/20 hover:text-[#65FFAA]"
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
// Group behavior catalog — descriptive copy for each seeded group. Keep in
// sync with backend `_DEFAULT_PERMISSIONS` + the resolver's `client_scope`
// and `pod_kind_lock`/`can_toggle_axis` outputs in `app/services/access.py`.
// Surfaces the spec from `feedback/project_access_control_v1_original_prompt`
// (Admin: all sections + toggle; Leadership + BI Team: toggle, all clients;
// Editorial / Growth Team: locked to their pod kind + their pod's clients).
// The old pod-derived `leadership` group was retired — its members (Senior
// Editors / Growth Leads / Directors) get access via `editorial_team` /
// `growth_team` instead.
// ────────────────────────────────────────────────────────────────────────

interface GroupBehavior {
  sections: string; // Top-level sections this group can open
  podAxis: "toggle" | "editorial" | "growth" | "none";
  clientScope: "all" | "assigned" | "own_pod";
}

const GROUP_BEHAVIOR: Record<string, GroupBehavior> = {
  admin: { sections: "Dashboards · Data · Admin", podAxis: "toggle", clientScope: "all" },
  leadership: {
    // Seeded VPs / managers of the Editorial + Growth orgs. Only
    // non-admin group with Capacity Planning v2 access.
    sections: "Dashboards · Capacity Planning v2 · Admin (Access Control)",
    podAxis: "toggle",
    clientScope: "all",
  },
  bi_team: {
    sections: "Dashboards · Import Data · Admin (Access Control + Data Quality)",
    podAxis: "toggle",
    clientScope: "all",
  },
  editorial_team: {
    sections: "Dashboards (no Overview)",
    podAxis: "editorial",
    clientScope: "own_pod",
  },
  growth_team: {
    sections: "Dashboards (no Overview, no Team KPIs)",
    podAxis: "growth",
    clientScope: "own_pod",
  },
};

function PodAxisChip({ kind }: { kind: GroupBehavior["podAxis"] }) {
  if (kind === "toggle") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-sm border border-[#65FFAA]/30 bg-[#42CA80]/10 px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-[#65FFAA]"
        title="Can flip the Editorial / Growth toggle in the header."
      >
        Toggle · Editorial ↔ Growth
      </span>
    );
  }
  if (kind === "editorial") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-sm border border-[#65FFAA]/30 bg-[#42CA80]/10 px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-[#65FFAA]"
        title="Pod axis is locked to Editorial — toggle is hidden."
      >
        Locked · Editorial
      </span>
    );
  }
  if (kind === "growth") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-sm border border-[#4ECBE5]/30 bg-[#4ECBE5]/10 px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-[#4ECBE5]"
        title="Pod axis is locked to Growth — toggle is hidden."
      >
        Locked · Growth
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm border border-[#2a2a2a] bg-[#161616] px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-[#909090]"
      title="Pod-axis toggle isn't shown for this group."
    >
      No toggle
    </span>
  );
}

function ClientScopeChip({ kind }: { kind: GroupBehavior["clientScope"] }) {
  if (kind === "all") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-sm border border-[#2a2a2a] bg-[#161616] px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-[#C4BCAA]"
        title="Every client across both pods is visible."
      >
        All clients
      </span>
    );
  }
  if (kind === "assigned") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-sm border border-[#F5BC4E]/30 bg-[#F5BC4E]/10 px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-[#F5BC4E]"
        title="Only clients this user is assigned to."
      >
        Assigned clients (both pods)
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm border border-[#F5BC4E]/30 bg-[#F5BC4E]/10 px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-[#F5BC4E]"
      title="Only their own pod's clients. Other pods are hidden."
    >
      Own pod only
    </span>
  );
}

function GroupCapabilitiesCard({ slug }: { slug: string }) {
  const behavior = GROUP_BEHAVIOR[slug];
  if (!behavior) return null;
  return (
    <div className="rounded-md border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
        What this group can do
      </p>
      <div className="mt-1.5 grid gap-1.5 text-[11px] sm:grid-cols-3">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-wider text-[#606060]">
            Sections
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-[#C4BCAA]">
            {behavior.sections}
          </p>
        </div>
        <div>
          <p className="font-mono text-[9px] uppercase tracking-wider text-[#606060]">
            Pod axis
          </p>
          <div className="mt-0.5">
            <PodAxisChip kind={behavior.podAxis} />
          </div>
        </div>
        <div>
          <p className="font-mono text-[9px] uppercase tracking-wider text-[#606060]">
            Client scope
          </p>
          <div className="mt-0.5">
            <ClientScopeChip kind={behavior.clientScope} />
          </div>
        </div>
      </div>
    </div>
  );
}

function HowGroupsWorkLegend() {
  return (
    <details className="group/legend rounded-md border border-[#1f1f1f] bg-[#0a0a0a]">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-[#909090] transition-colors hover:text-[#C4BCAA]">
        <span className="font-semibold text-[#606060] group-open/legend:hidden">▸</span>
        <span className="font-semibold text-[#606060] hidden group-open/legend:inline">▾</span>
        How groups work
        <span className="ml-auto text-[#606060] font-normal normal-case tracking-normal">
          Click for the full Editorial / Growth + scope reference
        </span>
      </summary>
      <div className="border-t border-[#1f1f1f] px-3 py-2.5 font-mono text-[11px] text-[#C4BCAA]">
        <p className="mb-2 text-[#909090]">
          Each group&apos;s row below carries a small "What this group can do"
          card. As a quick reference, here&apos;s the spec all five seeded
          groups follow:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-[#1f1f1f] text-[10px] uppercase tracking-wider text-[#606060]">
                <th className="py-1.5 pr-3">Group</th>
                <th className="py-1.5 pr-3">Sections</th>
                <th className="py-1.5 pr-3">Pod axis</th>
                <th className="py-1.5">Client scope</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["admin", "Admin"],
                ["leadership", "Leadership + Ops"],
                ["bi_team", "BI Team"],
                ["editorial_team", "Editorial Team"],
                ["growth_team", "Growth Team"],
              ].map(([slug, name]) => {
                const b = GROUP_BEHAVIOR[slug];
                if (!b) return null;
                return (
                  <tr key={slug} className="border-b border-[#161616]">
                    <td className="py-1.5 pr-3 text-white">{name}</td>
                    <td className="py-1.5 pr-3 text-[#C4BCAA]">{b.sections}</td>
                    <td className="py-1.5 pr-3"><PodAxisChip kind={b.podAxis} /></td>
                    <td className="py-1.5"><ClientScopeChip kind={b.clientScope} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2.5 text-[10px] text-[#606060]">
          Per-user overrides in the <b>Users × Views</b> tab can grant or
          revoke specific views on top of the group default — the group
          baseline shown here is what every member starts with.
        </p>
      </div>
    </details>
  );
}


// ────────────────────────────────────────────────────────────────────────
// Groups tab
// ────────────────────────────────────────────────────────────────────────

interface GroupsConflict {
  key: string;
  groupSlug: string;
  viewSlug: string;
  staged: boolean;
  serverWas: boolean;
  serverNow: boolean;
}

interface UsersConflict {
  key: string;
  email: string;
  viewSlug: string;
  staged: { type: "set"; canView: boolean } | { type: "clear" };
  serverWas: boolean | undefined;
  serverNow: boolean | undefined;
}

function GroupsTab({ profile }: { profile: AccessProfile }) {
  const [groups, setGroups] = useState<ApiGroupSummary[] | null>(null);
  const [views, setViews] = useState<ApiView[] | null>(null);
  const [details, setDetails] = useState<Map<string, ApiGroupDetail>>(new Map());
  const [filter, setFilter] = useState("");
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  // Draft mode — cell clicks accumulate here instead of hitting the API
  // immediately. Save flushes them in a batch; Discard rolls them back.
  // Map key = `${groupSlug}::${viewSlug}`; value = desired `can_view`.
  // A key is removed from the map when the user toggles back to the
  // server value (so "edit, then undo" leaves the map clean).
  const [pendingPerms, setPendingPerms] = useState<Map<string, boolean>>(
    new Map(),
  );
  // Server value captured the first time each key was staged. Used by
  // the stale-data guard at Save time: refetch, compare snapshot to
  // current server, surface conflicts if another admin moved the cell
  // out from under us.
  const [permsSnapshot, setPermsSnapshot] = useState<Map<string, boolean>>(
    new Map(),
  );
  const [conflicts, setConflicts] = useState<GroupsConflict[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Browser-level "unsaved changes" warning. Active whenever there's
  // at least one staged edit; tab close / refresh / nav-away triggers
  // the native confirm dialog. Next.js client-side navigation does NOT
  // fire `beforeunload`, so we also publish to the shared
  // `unsavedChangesClient` store — the sidebar reads from it before
  // every Link click and gates with `confirmDiscardIfUnsaved()`.
  useEffect(() => {
    setUnsavedChanges("access.groups", pendingPerms.size > 0);
    return () => setUnsavedChanges("access.groups", false);
  }, [pendingPerms.size]);
  useEffect(() => {
    if (pendingPerms.size === 0) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [pendingPerms.size]);

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

  // Cell-click in draft mode: stage the desired value in `pendingPerms`.
  // If the staged value matches the server's value, drop the key so the
  // cell renders clean. This means toggling and toggling back leaves no
  // pending edit (and no spurious API call on Save).
  const togglePending = (slug: string, viewSlug: string, nextCanView: boolean) => {
    const key = `${slug}::${viewSlug}`;
    const server = !!details.get(slug)?.permissions[viewSlug];
    setSaveError(null);
    // Snapshot the server value the first time this cell is touched —
    // we'll compare against it on Save to detect concurrent edits.
    setPermsSnapshot((prev) => {
      if (prev.has(key)) return prev;
      const next = new Map(prev);
      next.set(key, server);
      return next;
    });
    setPendingPerms((prev) => {
      const next = new Map(prev);
      if (nextCanView === server) next.delete(key);
      else next.set(key, nextCanView);
      return next;
    });
  };

  const discardPending = () => {
    setPendingPerms(new Map());
    setPermsSnapshot(new Map());
    setConflicts([]);
    setSaveError(null);
  };

  // Save flow:
  //   1. Refetch the matrix to see if anything moved server-side since
  //      we started drafting.
  //   2. For each pending key, compare the snapshot (server value at
  //      stage time) to the freshly-fetched value. Any mismatch → a
  //      concurrent edit conflict. Halt the save and surface a modal.
  //   3. If clean, fire one PUT per pending key sequentially so audit
  //      log entries stay in order, then refresh access profile +
  //      every touched group's detail.
  const commitPending = async (overrideConflicts = false) => {
    if (pendingPerms.size === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Stale-data guard: re-pull every group's detail. Cheap enough
      // (≤ a handful of groups) and the source of truth right before
      // we mutate.
      const gs = await apiGet<ApiGroupSummary[]>("/api/access/groups");
      const ds = await Promise.all(
        gs.map((g) => apiGet<ApiGroupDetail>(`/api/access/groups/${g.slug}`)),
      );
      const fresh = new Map(ds.map((d) => [d.slug, d]));

      if (!overrideConflicts) {
        const detected: GroupsConflict[] = [];
        for (const [key] of pendingPerms) {
          const [slug, viewSlug] = key.split("::");
          const serverWas = permsSnapshot.get(key) ?? false;
          const serverNow = !!fresh.get(slug)?.permissions[viewSlug];
          if (serverWas !== serverNow) {
            detected.push({
              key,
              groupSlug: slug,
              viewSlug,
              staged: pendingPerms.get(key)!,
              serverWas,
              serverNow,
            });
          }
        }
        if (detected.length > 0) {
          // Push fresh data into local state so the user sees current
          // truth when the modal closes.
          setGroups(gs);
          setDetails(fresh);
          setConflicts(detected);
          setSaving(false);
          return;
        }
      }

      // Clean to save (or user explicitly chose to overwrite).
      const touchedGroups = new Set<string>();
      for (const [key, canView] of pendingPerms) {
        const [slug, viewSlug] = key.split("::");
        await apiPut(`/api/access/groups/${slug}/permissions/${viewSlug}`, {
          can_view: canView,
        });
        touchedGroups.add(slug);
      }
      await refreshAccessProfile();
      await Promise.all(Array.from(touchedGroups).map((s) => refreshOneGroup(s)));
      setPendingPerms(new Map());
      setPermsSnapshot(new Map());
      setConflicts([]);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  /** Drop the conflicted keys from the draft and re-snapshot any that
   *  remain. The user can re-stage the conflicts if they still want
   *  them. */
  const discardConflicts = () => {
    setPendingPerms((prev) => {
      const next = new Map(prev);
      for (const c of conflicts) next.delete(c.key);
      return next;
    });
    setPermsSnapshot((prev) => {
      const next = new Map(prev);
      for (const c of conflicts) next.delete(c.key);
      return next;
    });
    setConflicts([]);
  };

  return (
    <div className="space-y-3">
      <HowGroupsWorkLegend />

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
                  pendingPerms={pendingPerms}
                  isExpanded={isExpanded}
                  onToggleExpand={() =>
                    setExpandedSlug(isExpanded ? null : g.slug)
                  }
                  onSetPerm={(viewSlug, canView) =>
                    togglePending(g.slug, viewSlug, canView)
                  }
                  onMembersChanged={() => refreshOneGroup(g.slug)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="font-mono text-[10px] text-[#606060]">
        Click any cell to stage a grant / revoke. Edits don&apos;t hit the
        backend until you click <b>Save changes</b> in the banner above.
        Click the chevron to expand a group&apos;s members inline.
      </p>

      {/* Pending-edits banner — only shown when there's at least one
          staged change. Sticks to the bottom of the viewport so the
          actor can save / discard from anywhere on the page without
          scrolling. Same idea as the unsaved-changes bar on Notion /
          Google Docs forms. */}
      <PendingChangesBanner
        count={pendingPerms.size}
        saving={saving}
        error={saveError}
        onSave={() => void commitPending()}
        onDiscard={discardPending}
      />

      {conflicts.length > 0 && (
        <ConflictModal
          title="Group permissions changed on the server"
          lines={conflicts.map((c) => {
            const groupName =
              groups.find((g) => g.slug === c.groupSlug)?.name ?? c.groupSlug;
            const viewLabel =
              views.find((v) => v.slug === c.viewSlug)?.label ?? c.viewSlug;
            return {
              key: c.key,
              label: `${groupName} · ${viewLabel}`,
              detail: `Was ${c.serverWas ? "granted" : "revoked"} when you started; another admin set it to ${c.serverNow ? "granted" : "revoked"}. You staged ${c.staged ? "granted" : "revoked"}.`,
            };
          })}
          onOverwrite={() => void commitPending(true)}
          onDiscardConflicts={discardConflicts}
          onClose={() => setConflicts([])}
        />
      )}
    </div>
  );
}

function PendingChangesBanner({
  count,
  saving,
  error,
  onSave,
  onDiscard,
}: {
  count: number;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onDiscard: () => void;
}) {
  if (count === 0 && !error) return null;
  return (
    <div className="sticky bottom-4 z-30 mx-auto flex max-w-2xl items-center gap-3 rounded-lg border border-[#F5BC4E]/50 bg-[#1a1408] px-3 py-2 shadow-2xl shadow-black/60 backdrop-blur-md">
      <span className="relative inline-flex h-2 w-2 shrink-0">
        <span className="absolute inset-0 animate-ping rounded-full bg-[#F5BC4E] opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#F5BC4E]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#F5BC4E]">
          {count} unsaved {count === 1 ? "edit" : "edits"}
        </p>
        {error ? (
          <p className="mt-0.5 truncate font-mono text-[10px] text-[#ED6958]">
            {error}
          </p>
        ) : (
          <p className="mt-0.5 truncate font-mono text-[10px] text-[#C4BCAA]">
            Click cells to stage changes; nothing is sent to the backend
            until you save.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onDiscard}
        disabled={saving}
        className="h-7 rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#C4BCAA] transition-colors hover:border-[#3a3a3a] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        Discard
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving || count === 0}
        className="h-7 rounded-md bg-[#42CA80] px-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-black transition-colors hover:bg-[#65FFAA] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving ? "Saving…" : `Save ${count > 0 ? `(${count})` : ""}`}
      </button>
    </div>
  );
}

interface ConflictLine {
  key: string;
  label: string;
  detail: string;
}

/** Modal shown after a Save when at least one staged cell has been
 *  modified server-side since the user started drafting. Three exits:
 *    • Overwrite — re-runs the save bypassing the conflict check
 *      (user's staged values win).
 *    • Discard conflicts — drops the conflicted keys from the draft,
 *      keeping the rest of the staged edits.
 *    • Close — keeps the draft + the latest server values visible so
 *      the user can review each conflicted cell individually before
 *      saving again. */
function ConflictModal({
  title,
  lines,
  onOverwrite,
  onDiscardConflicts,
  onClose,
}: {
  title: string;
  lines: ConflictLine[];
  onOverwrite: () => void;
  onDiscardConflicts: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        role="dialog"
        aria-label={title}
        className="w-[520px] max-w-[90vw] max-h-[80vh] overflow-y-auto rounded-lg border border-[#F5BC4E]/40 bg-[#0d0d0d] shadow-2xl shadow-black/80"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[#1f1f1f] px-4 py-3">
          <p className="font-mono text-[12px] font-bold uppercase tracking-wider text-[#F5BC4E]">
            {title}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-[#606060] transition-colors hover:bg-[#1f1f1f] hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-3 space-y-3">
          <p className="font-mono text-[11px] leading-relaxed text-[#C4BCAA]">
            {lines.length === 1
              ? "1 cell"
              : `${lines.length} cells`}{" "}
            you staged moved on the server while you were editing. Pick
            how to resolve before saving.
          </p>
          <ul className="space-y-2 rounded-md border border-[#1f1f1f] bg-[#0a0a0a] p-2">
            {lines.map((l) => (
              <li
                key={l.key}
                className="rounded border border-[#1f1f1f] bg-[#161616] px-2 py-1.5"
              >
                <p className="font-mono text-[11px] font-semibold text-white">
                  {l.label}
                </p>
                <p className="mt-0.5 font-mono text-[10px] leading-snug text-[#909090]">
                  {l.detail}
                </p>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#1f1f1f] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-7 rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#C4BCAA] transition-colors hover:border-[#3a3a3a] hover:text-white"
          >
            Review manually
          </button>
          <button
            type="button"
            onClick={onDiscardConflicts}
            className="h-7 rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#F5BC4E] transition-colors hover:border-[#F5BC4E]/50 hover:bg-[#F5BC4E]/10"
          >
            Discard conflicts
          </button>
          <button
            type="button"
            onClick={onOverwrite}
            className="h-7 rounded-md bg-[#ED6958] px-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-black transition-colors hover:bg-[#FF8773]"
          >
            Overwrite & save
          </button>
        </div>
      </div>
    </div>
  );
}

function FragmentRow({
  group,
  detail,
  views,
  editView,
  profile,
  pendingPerms,
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
  /** Staged edits keyed by `${groupSlug}::${viewSlug}`. A cell is dirty
   *  when its key is in this Map; effective value = the map value;
   *  otherwise effective = server value from `detail.permissions`. */
  pendingPerms: Map<string, boolean>;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSetPerm: (viewSlug: string, canView: boolean) => void;
  onMembersChanged: () => Promise<void>;
}) {
  const effective = (viewSlug: string): { canView: boolean; dirty: boolean } => {
    const key = `${group.slug}::${viewSlug}`;
    if (pendingPerms.has(key)) {
      return { canView: pendingPerms.get(key)!, dirty: true };
    }
    return { canView: !!detail?.permissions[viewSlug], dirty: false };
  };
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
          const { canView, dirty } = effective(v.slug);
          const dividerCls = dividerClass(cellDividerKind(views, idx));
          const editable = canEditCell(group.slug, v.slug, profile) && !!detail;

          // Special case: the Access Control cell renders TWO pills
          // (View + Edit). The Edit pill maps to the hidden
          // `admin.access.edit` view; toggling it grants/revokes the
          // matrix-edit privilege for this group.
          if (v.slug === ACCESS_VIEW && editView) {
            const editEff = effective(editView.slug);
            const editableEditPill =
              canEditCell(group.slug, editView.slug, profile) && !!detail && canView;
            return (
              <td key={v.slug} className={`px-2 py-2 text-center ${dividerCls}`}>
                <div className="inline-flex items-center gap-1">
                  <PermPill
                    canView={canView}
                    editable={editable}
                    dirty={dirty}
                    onClick={() => {
                      if (!editable) return;
                      onSetPerm(v.slug, !canView);
                    }}
                    label="View"
                  />
                  <PermPill
                    canView={editEff.canView}
                    editable={editableEditPill}
                    dirty={editEff.dirty}
                    onClick={() => {
                      if (!editableEditPill) return;
                      onSetPerm(editView.slug, !editEff.canView);
                    }}
                    label="Edit"
                    tone="blue"
                    title={
                      !canView
                        ? "Grant View first — Edit requires View access"
                        : editEff.canView
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
                dirty={dirty}
                onClick={() => {
                  if (!editable) return;
                  onSetPerm(v.slug, !canView);
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
            className="border-t border-[#1a1a1a] px-3 py-3 space-y-3"
          >
            <GroupCapabilitiesCard slug={detail.slug} />
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
  dirty,
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
  /** Draft-mode flag: cell carries a staged edit that hasn't been
   *  committed to the backend yet. Renders an amber ring + dashed
   *  border so the user can see at a glance what they'd save. */
  dirty?: boolean;
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
  // Draft-mode visual: amber outline ring + dashed border so a staged
  // edit is impossible to miss in a long matrix. The base `cls` (color
  // tied to the staged value) still applies — the ring is additive.
  const dirtyCls = dirty
    ? " border-dashed border-[#F5BC4E] ring-1 ring-[#F5BC4E]/40"
    : "";
  const tooltip =
    title ??
    (dirty
      ? "Unsaved edit — click Save in the banner to commit."
      : override === "grant"
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
        dirtyCls +
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
  // Slug → display name lookup so each user row can render proper
  // group labels ("Growth Team") instead of the raw API slugs
  // ("growth_team").
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [onlyOverrides, setOnlyOverrides] = useState(false);
  // Draft mode for per-user overrides. Keyed by `${email}::${viewSlug}`.
  // A `{ type: "set" }` pending will fire a PUT on Save; a `{ type:
  // "clear" }` pending will fire a DELETE. Auto-cleanup: if the staged
  // value matches the server's override state, the key is dropped so
  // toggle-and-undo leaves the map clean.
  const [pendingOverrides, setPendingOverrides] = useState<
    Map<string, { type: "set"; canView: boolean } | { type: "clear" }>
  >(new Map());
  // Server's override value at stage time, indexed the same way as
  // `pendingOverrides`. `undefined` is a valid snapshot (means: no
  // override existed when the user touched this cell). Used by the
  // stale-data guard at Save to detect concurrent edits.
  const [overridesSnapshot, setOverridesSnapshot] = useState<
    Map<string, boolean | undefined>
  >(new Map());
  const [conflicts, setConflicts] = useState<UsersConflict[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Browser-level "unsaved changes" warning. Same pattern as Groups tab.
  useEffect(() => {
    setUnsavedChanges("access.users", pendingOverrides.size > 0);
    return () => setUnsavedChanges("access.users", false);
  }, [pendingOverrides.size]);
  useEffect(() => {
    if (pendingOverrides.size === 0) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [pendingOverrides.size]);

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
    setGroupNames(Object.fromEntries(gs.map((g) => [g.slug, g.name])));
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
  // Pending-aware: users with any staged override (set or clear) are
  // also surfaced by the "Show only overrides" filter so the actor can
  // narrow the matrix down to just what they're editing before saving.
  for (const key of pendingOverrides.keys()) {
    const email = key.split("::")[0];
    usersWithOverrides.add(email);
  }

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

  /** Cell-click handler in draft mode. Replicates the two-state cycle
   *  used previously (no-override ↔ override-flip) but writes to local
   *  state instead of firing an API call. */
  const cycleOverridePending = (
    u: ApiUserMatrixRow,
    viewSlug: string,
  ) => {
    const key = `${u.email}::${viewSlug}`;
    const serverOverride: boolean | undefined = Object.prototype.hasOwnProperty.call(
      u.overrides,
      viewSlug,
    )
      ? u.overrides[viewSlug]
      : undefined;
    const serverHasOverride = serverOverride !== undefined;

    // Effective override = pending if staged, else server.
    const currentPending = pendingOverrides.get(key);
    let effectiveOv: boolean | undefined;
    if (currentPending?.type === "set") effectiveOv = currentPending.canView;
    else if (currentPending?.type === "clear") effectiveOv = undefined;
    else effectiveOv = serverOverride;

    const groupDefault = getGroupDefault(u, viewSlug);
    const currentEffective = effectiveOv !== undefined ? effectiveOv : groupDefault;

    // Same cycle the old `cycleOverride` used: if an override is in
    // play, clear it; otherwise add an override flipping the effective.
    let next: { type: "set"; canView: boolean } | { type: "clear" };
    if (effectiveOv !== undefined) {
      next = { type: "clear" };
    } else {
      next = { type: "set", canView: !currentEffective };
    }

    setSaveError(null);
    setOverridesSnapshot((prev) => {
      if (prev.has(key)) return prev;
      const nextMap = new Map(prev);
      nextMap.set(key, serverOverride);
      return nextMap;
    });
    setPendingOverrides((prev) => {
      const nextMap = new Map(prev);
      // Auto-cleanup: drop the key if `next` brings us back to the
      // server state so toggle-and-undo doesn't leave a phantom edit.
      if (next.type === "clear" && !serverHasOverride) {
        nextMap.delete(key);
      } else if (
        next.type === "set" &&
        serverHasOverride &&
        serverOverride === next.canView
      ) {
        nextMap.delete(key);
      } else {
        nextMap.set(key, next);
      }
      return nextMap;
    });
  };

  const discardPending = () => {
    setPendingOverrides(new Map());
    setOverridesSnapshot(new Map());
    setConflicts([]);
    setSaveError(null);
  };

  const commitPending = async (overrideConflicts = false) => {
    if (pendingOverrides.size === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Stale-data guard: refresh the user matrix before mutating so
      // we can compare server values at stage time vs right now.
      const fresh = await apiGet<ApiUserMatrixRow[]>("/api/access/users");

      if (!overrideConflicts) {
        const detected: UsersConflict[] = [];
        for (const [key, change] of pendingOverrides) {
          const [email, viewSlug] = key.split("::");
          const serverWas = overridesSnapshot.get(key);
          const row = fresh.find((u) => u.email === email);
          const serverNow =
            row && Object.prototype.hasOwnProperty.call(row.overrides, viewSlug)
              ? row.overrides[viewSlug]
              : undefined;
          if (serverWas !== serverNow) {
            detected.push({
              key,
              email,
              viewSlug,
              staged: change,
              serverWas,
              serverNow,
            });
          }
        }
        if (detected.length > 0) {
          setUsers(fresh);
          setConflicts(detected);
          setSaving(false);
          return;
        }
      }

      for (const [key, change] of pendingOverrides) {
        const [email, viewSlug] = key.split("::");
        if (change.type === "set") {
          await apiPut(
            `/api/access/users/${encodeURIComponent(email)}/overrides/${viewSlug}`,
            { can_view: change.canView },
          );
        } else {
          try {
            await apiDelete(
              `/api/access/users/${encodeURIComponent(email)}/overrides/${viewSlug}`,
            );
          } catch {
            // 404 when there was nothing to clear is harmless.
          }
        }
      }
      await refreshAccessProfile();
      await load();
      setPendingOverrides(new Map());
      setOverridesSnapshot(new Map());
      setConflicts([]);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const discardConflicts = () => {
    setPendingOverrides((prev) => {
      const next = new Map(prev);
      for (const c of conflicts) next.delete(c.key);
      return next;
    });
    setOverridesSnapshot((prev) => {
      const next = new Map(prev);
      for (const c of conflicts) next.delete(c.key);
      return next;
    });
    setConflicts([]);
  };
  const resetOverrides = async (email: string) => {
    if (
      !confirm(
        `Reset ${email} to their group default? This clears every per-user override on their row.`,
      )
    ) {
      return;
    }
    try {
      await apiDelete(`/api/access/users/${encodeURIComponent(email)}/overrides`);
    } catch (e) {
      alert(
        e instanceof Error ? e.message : "Failed to reset user's overrides",
      );
      return;
    }
    // Drop any pending edits that touched this user — server is now
    // the source of truth for them again.
    setPendingOverrides((prev) => {
      const next = new Map(prev);
      const prefix = `${email}::`;
      for (const k of Array.from(next.keys())) {
        if (k.startsWith(prefix)) next.delete(k);
      }
      return next;
    });
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
        {/* Render the toggle whenever:
              • there's at least one user with an override / pending edit, OR
              • the filter is currently ON.
            The second clause is the bugfix — without it, a user could
            enable "Showing overrides", revert the only override that
            qualified, and then have no UI to turn the filter back off
            (since the button vanished with usersWithOverrides.size = 0).
            The clear-X is always available when the filter is active. */}
        {(usersWithOverrides.size > 0 || onlyOverrides) && (
          <div className="inline-flex h-7 items-center gap-1 rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-0.5">
            <button
              type="button"
              onClick={() => setOnlyOverrides((v) => !v)}
              className={
                "inline-flex h-6 items-center gap-1.5 rounded px-2 font-mono text-[10px] uppercase tracking-wider transition " +
                (onlyOverrides
                  ? "bg-[#F5BC4E]/10 text-[#F5BC4E]"
                  : "text-[#909090] hover:text-white")
              }
              title={
                onlyOverrides
                  ? "Showing only users with at least one override; click to show everyone again."
                  : "Show only users whose effective access differs from their group default."
              }
            >
              {onlyOverrides ? "Showing overrides" : "Show only overrides"}
              <span
                className={cn(
                  "rounded-sm px-1 font-mono text-[10px]",
                  usersWithOverrides.size > 0
                    ? "bg-[#F5BC4E]/15 text-[#F5BC4E]"
                    : "bg-[#1f1f1f] text-[#606060]",
                )}
              >
                {usersWithOverrides.size}
              </span>
            </button>
            {onlyOverrides && (
              <button
                type="button"
                onClick={() => setOnlyOverrides(false)}
                title="Clear filter — show every user again"
                aria-label="Clear filter"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[#606060] transition-colors hover:bg-[#1f1f1f] hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
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
                      {/* Reset-to-group-default button — only shown when
                          the user has at least one override that actually
                          differs from their group default. Hidden for
                          seeded admins (they can't carry overrides) and
                          for view-only viewers (no edit access). */}
                      {counts &&
                        (counts.grants > 0 || counts.revokes > 0) &&
                        !u.is_seeded_admin &&
                        hasEditAccess(profile) && (
                          <button
                            type="button"
                            onClick={() => void resetOverrides(u.email)}
                            title="Reset this user to their group default."
                            className="ml-1 inline-flex h-5 items-center gap-1 rounded-sm border border-[#2a2a2a] bg-[#161616] px-1.5 font-mono text-[9px] uppercase tracking-wider text-[#909090] transition-colors hover:border-[#F5BC4E]/40 hover:bg-[#F5BC4E]/10 hover:text-[#F5BC4E]"
                          >
                            <Undo2 className="h-2.5 w-2.5" strokeWidth={2.5} />
                            Reset
                          </button>
                        )}
                    </div>
                    <div className="font-mono text-[10px] text-[#606060]">
                      {u.email}
                      {u.groups.length > 0 && (
                        <span className="ml-1 text-[#404040]">
                          ·{" "}
                          {u.groups
                            .map((slug) => groupNames[slug] ?? slug)
                            .join(", ")}
                        </span>
                      )}
                    </div>
                  </td>
                  {displayViews.map((v, idx) => {
                    // Effective state with pending edits applied. We
                    // need (1) the displayed cell value, (2) the
                    // override direction (grant / revoke / none) so
                    // the chip colors match, and (3) a dirty flag for
                    // the amber draft outline.
                    const effective = (vSlug: string) => {
                      const key = `${u.email}::${vSlug}`;
                      const pending = pendingOverrides.get(key);
                      const groupDefault = getGroupDefault(u, vSlug);
                      const serverOv: boolean | undefined =
                        Object.prototype.hasOwnProperty.call(
                          u.overrides,
                          vSlug,
                        )
                          ? u.overrides[vSlug]
                          : undefined;
                      let effOv: boolean | undefined;
                      if (pending?.type === "set") effOv = pending.canView;
                      else if (pending?.type === "clear") effOv = undefined;
                      else effOv = serverOv;
                      const canView =
                        effOv !== undefined ? effOv : groupDefault;
                      let direction: "grant" | "revoke" | undefined;
                      if (effOv === undefined || effOv === groupDefault) {
                        direction = undefined;
                      } else {
                        direction = effOv ? "grant" : "revoke";
                      }
                      return { canView, direction, dirty: pending !== undefined };
                    };

                    const main = effective(v.slug);
                    const dividerCls = dividerClass(
                      cellDividerKind(displayViews, idx),
                    );
                    const isSeededAdmin = !!u.is_seeded_admin;
                    const editable = canEditOverride(v.slug, profile, isSeededAdmin);

                    // Two-pill rendering for the Access Control cell.
                    if (v.slug === ACCESS_VIEW && editView) {
                      const editEff = effective(editView.slug);
                      const editPillEditable =
                        canEditOverride(editView.slug, profile, isSeededAdmin) &&
                        main.canView;
                      return (
                        <td
                          key={v.slug}
                          className={`px-2 py-2 text-center ${dividerCls}`}
                        >
                          <div className="inline-flex items-center gap-1">
                            <PermPill
                              canView={main.canView}
                              editable={editable}
                              override={main.direction}
                              dirty={main.dirty}
                              onClick={() => {
                                if (!editable) return;
                                cycleOverridePending(u, v.slug);
                              }}
                              label="View"
                              title={
                                isSeededAdmin
                                  ? "Seeded Admin — locked across the whole matrix. The original admin baseline can't be overridden."
                                  : undefined
                              }
                            />
                            <PermPill
                              canView={editEff.canView}
                              editable={editPillEditable}
                              override={editEff.direction}
                              dirty={editEff.dirty}
                              onClick={() => {
                                if (!editPillEditable) return;
                                cycleOverridePending(u, editView.slug);
                              }}
                              label="Edit"
                              tone="blue"
                              title={
                                isSeededAdmin
                                  ? "Seeded Admin — locked across the whole matrix. The original admin baseline can't be overridden."
                                  : !main.canView
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
                          canView={main.canView}
                          editable={editable}
                          override={main.direction}
                          dirty={main.dirty}
                          onClick={() => {
                            if (!editable) return;
                            cycleOverridePending(u, v.slug);
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
          · Click any cell to stage an override; nothing is sent until
          you click <b>Save changes</b> in the banner.
        </span>
      </div>

      <PendingChangesBanner
        count={pendingOverrides.size}
        saving={saving}
        error={saveError}
        onSave={() => void commitPending()}
        onDiscard={discardPending}
      />

      {conflicts.length > 0 && (
        <ConflictModal
          title="User overrides changed on the server"
          lines={conflicts.map((c) => {
            const viewLabel =
              viewsSorted.find((v) => v.slug === c.viewSlug)?.label ?? c.viewSlug;
            const fmt = (v: boolean | undefined) =>
              v === undefined
                ? "no override (inherits group)"
                : v
                  ? "granted"
                  : "revoked";
            const stagedStr =
              c.staged.type === "clear"
                ? "no override"
                : c.staged.canView
                  ? "granted"
                  : "revoked";
            return {
              key: c.key,
              label: `${c.email} · ${viewLabel}`,
              detail: `Was ${fmt(c.serverWas)} when you started; another admin set it to ${fmt(c.serverNow)}. You staged ${stagedStr}.`,
            };
          })}
          onOverwrite={() => void commitPending(true)}
          onDiscardConflicts={discardConflicts}
          onClose={() => setConflicts([])}
        />
      )}
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
