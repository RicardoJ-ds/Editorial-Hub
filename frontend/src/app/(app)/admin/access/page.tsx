"use client";

// Access Control — UI mockup only. No backend wiring; all state is local
// to this page. Will plug into real auth + permission system once design
// is signed off.

import { useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, Shield, Users as UsersIcon, History } from "lucide-react";

// ─── Mock data ───────────────────────────────────────────────────────────────

interface MockUser {
  id: string;
  name: string;
  email: string;
  role: "Editor" | "SE" | "Lead" | "Director" | "Admin";
  pod: string | null;
  team: "editorial" | "growth" | "leadership" | "bi";
}

interface MockGroup {
  id: string;
  name: string;
  description: string;
  memberIds: string[];
  defaultPerms: Permission[];
}

type Permission = "view" | "edit" | "none";

interface ViewSection {
  id: string;
  label: string;
  parent: string;
}

const VIEW_SECTIONS: ViewSection[] = [
  { id: "d1.contract", label: "Contract & Timeline", parent: "Editorial Clients" },
  { id: "d1.deliverables", label: "Deliverables vs SOW", parent: "Editorial Clients" },
  { id: "d2.kpi", label: "KPI Performance", parent: "Team KPIs" },
  { id: "d2.capacity", label: "Capacity Projections", parent: "Team KPIs" },
  { id: "d2.ai", label: "AI Compliance", parent: "Team KPIs" },
  { id: "cp2", label: "Capacity Planning v2", parent: "Proposal" },
  { id: "data.import", label: "Import Data", parent: "Data" },
  { id: "admin.access", label: "Access Control", parent: "Admin" },
];

const MOCK_USERS: MockUser[] = [
  { id: "u1", name: "Ricardo Jaramillo", email: "ricardo@graphitehq.com", role: "Admin", pod: null, team: "bi" },
  { id: "u2", name: "Alex Kim", email: "alex.kim@graphitehq.com", role: "Director", pod: null, team: "leadership" },
  { id: "u3", name: "Maria López", email: "maria@graphitehq.com", role: "Lead", pod: "Editorial Pod 1", team: "editorial" },
  { id: "u4", name: "Jordan Patel", email: "jordan@graphitehq.com", role: "Editor", pod: "Editorial Pod 1", team: "editorial" },
  { id: "u5", name: "Sam Reyes", email: "sam@graphitehq.com", role: "Editor", pod: "Editorial Pod 2", team: "editorial" },
  { id: "u6", name: "Priya Singh", email: "priya@graphitehq.com", role: "Editor", pod: "Editorial Pod 3", team: "editorial" },
  { id: "u7", name: "Liu Wei", email: "liu@graphitehq.com", role: "Lead", pod: "Editorial Pod 4", team: "editorial" },
  { id: "u8", name: "Devon Brown", email: "devon@graphitehq.com", role: "Editor", pod: "Editorial Pod 5", team: "editorial" },
  { id: "u9", name: "Hana Sato", email: "hana@graphitehq.com", role: "SE", pod: "Growth Pod 1", team: "growth" },
  { id: "u10", name: "Noah Becker", email: "noah@graphitehq.com", role: "SE", pod: "Growth Pod 2", team: "growth" },
  { id: "u11", name: "Yara Ahmed", email: "yara@graphitehq.com", role: "SE", pod: "Growth Pod 3", team: "growth" },
  { id: "u12", name: "Kai Andersen", email: "kai@graphitehq.com", role: "Director", pod: null, team: "leadership" },
];

// Mock groups mirror the PRD §7 spec:
//   • All primary users see Editorial Client Data (D1)
//   • Account Team blocked from Editorial Team KPIs (D2)
//   • Editorial + Account teams = read-only
//   • Capacity Planner + Leadership = edit ("configuration access")
//   • Editors see own metrics only; Senior Editors see own + pod + client
//   • BI team has full edit (build / troubleshoot)
// Permissions order matches VIEW_SECTIONS:
// d1.contract, d1.deliverables, d2.kpi, d2.capacity, d2.ai, cp2, data.import, admin.access
const MOCK_GROUPS: MockGroup[] = [
  {
    id: "g.leadership",
    name: "Leadership / Capacity Planner",
    description: "PRD §7 — configuration / edit access across both dashboards plus CP v2.",
    memberIds: ["u2", "u12"],
    defaultPerms: ["edit", "edit", "edit", "edit", "edit", "edit", "edit", "view"],
  },
  {
    id: "g.bi",
    name: "BI Team",
    description: "PRD §7 — full edit for build + troubleshoot. Owns admin / access matrix.",
    memberIds: ["u1"],
    defaultPerms: ["edit", "edit", "edit", "edit", "edit", "edit", "edit", "edit"],
  },
  {
    id: "g.editorial.leads",
    name: "Senior Editors / Pod Leads",
    description: "PRD §7 — read-only D1; D2 limited to own + pod + client metrics.",
    memberIds: ["u3", "u7"],
    defaultPerms: ["view", "view", "view", "view", "view", "view", "none", "none"],
  },
  {
    id: "g.editorial.editors",
    name: "Editors",
    description: "PRD §7 — read-only D1 for their pod; D2 limited to own metrics only.",
    memberIds: ["u4", "u5", "u6", "u8"],
    defaultPerms: ["view", "view", "view", "none", "none", "none", "none", "none"],
  },
  {
    id: "g.account.team",
    name: "Account Team",
    description: "PRD §7 — read-only D1 only. Explicitly blocked from D2 (Team KPIs).",
    memberIds: ["u9", "u10", "u11"],
    defaultPerms: ["view", "view", "none", "none", "none", "none", "none", "none"],
  },
];

interface AuditEntry {
  id: string;
  when: string; // ISO
  actor: string;
  affected: string;
  change: string;
}

const MOCK_AUDIT: AuditEntry[] = [
  { id: "a1", when: "2026-04-26T22:14:00Z", actor: "Alex Kim", affected: "Yara Ahmed", change: "Granted view on Capacity Projections" },
  { id: "a2", when: "2026-04-25T15:42:00Z", actor: "Ricardo Jaramillo", affected: "Editorial Editors (group)", change: "Removed edit on D1: Contract & Timeline" },
  { id: "a3", when: "2026-04-24T11:08:00Z", actor: "Alex Kim", affected: "Kai Andersen", change: "Added to group: Leadership" },
  { id: "a4", when: "2026-04-23T18:30:00Z", actor: "Ricardo Jaramillo", affected: "BI Team (group)", change: "Created group with edit on all sections" },
  { id: "a5", when: "2026-04-22T09:55:00Z", actor: "Alex Kim", affected: "Devon Brown", change: "Granted view on D2: AI Compliance" },
  { id: "a6", when: "2026-04-20T14:01:00Z", actor: "Ricardo Jaramillo", affected: "All users", change: "Initial access matrix seeded from team_members table" },
];

// ─── Tab 1: Users × Views matrix ────────────────────────────────────────────

const PERM_STYLE: Record<Permission, { label: string; bg: string; color: string; border: string }> = {
  view: { label: "View",  bg: "rgba(143,181,217,0.10)",  color: "#8FB5D9", border: "rgba(143,181,217,0.30)" },
  edit: { label: "Edit",  bg: "rgba(66,202,128,0.10)",   color: "#42CA80", border: "rgba(66,202,128,0.30)" },
  none: { label: "—",     bg: "transparent",              color: "#404040", border: "#1f1f1f" },
};

function PermPill({ perm }: { perm: Permission }) {
  const s = PERM_STYLE[perm];
  return (
    <span
      className="inline-flex h-6 min-w-[44px] items-center justify-center rounded border font-mono text-[10px] uppercase tracking-wider"
      style={{ background: s.bg, color: s.color, borderColor: s.border }}
    >
      {s.label}
    </span>
  );
}

function buildInitialMatrix(): Record<string, Record<string, Permission>> {
  // Seed each user's permission row from the first group they're in (mock).
  const matrix: Record<string, Record<string, Permission>> = {};
  for (const u of MOCK_USERS) {
    const group = MOCK_GROUPS.find((g) => g.memberIds.includes(u.id));
    const row: Record<string, Permission> = {};
    VIEW_SECTIONS.forEach((sec, idx) => {
      row[sec.id] = group?.defaultPerms[idx] ?? "none";
    });
    matrix[u.id] = row;
  }
  return matrix;
}

function UsersMatrixTab() {
  const [search, setSearch] = useState("");
  const [matrix] = useState(() => buildInitialMatrix());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return MOCK_USERS;
    return MOCK_USERS.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.pod ?? "").toLowerCase().includes(q),
    );
  }, [search]);

  // Group sections by parent for the column header band.
  const sectionGroups = useMemo(() => {
    const groups: { parent: string; sections: ViewSection[] }[] = [];
    for (const sec of VIEW_SECTIONS) {
      const last = groups[groups.length - 1];
      if (last && last.parent === sec.parent) last.sections.push(sec);
      else groups.push({ parent: sec.parent, sections: [sec] });
    }
    return groups;
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#606060]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter users…"
            className="h-9 pl-8 bg-[#161616] border-[#2a2a2a] text-sm"
          />
        </div>
        <p className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
          {filtered.length} user{filtered.length === 1 ? "" : "s"}
        </p>
      </div>

      <Card className="border-[#2a2a2a] bg-[#0d0d0d]">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse font-mono text-[11px]">
              <thead>
                <tr className="border-b border-[#1f1f1f] bg-[#0a0a0a]">
                  <th
                    rowSpan={2}
                    className="sticky left-0 z-10 bg-[#0a0a0a] px-3 py-2 text-left font-semibold uppercase tracking-wider text-[#C4BCAA]"
                  >
                    User
                  </th>
                  {sectionGroups.map((g) => (
                    <th
                      key={g.parent}
                      colSpan={g.sections.length}
                      className="border-l border-[#1f1f1f] px-3 py-1.5 text-center font-semibold uppercase tracking-wider text-[#909090]"
                    >
                      {g.parent}
                    </th>
                  ))}
                </tr>
                <tr className="border-b border-[#1f1f1f] bg-[#0a0a0a]">
                  {VIEW_SECTIONS.map((sec, i) => (
                    <th
                      key={sec.id}
                      className={`px-3 py-2 text-center text-[10px] font-medium uppercase tracking-wider text-[#606060] ${
                        i === 0 ||
                        VIEW_SECTIONS[i - 1]?.parent !== sec.parent
                          ? "border-l border-[#1f1f1f]"
                          : ""
                      }`}
                    >
                      {sec.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-[#161616] hover:bg-[#141414]"
                  >
                    <td className="sticky left-0 z-10 bg-[#0d0d0d] px-3 py-2 align-middle">
                      <div className="flex flex-col leading-tight">
                        <span className="text-white normal-case font-sans text-sm">
                          {u.name}
                        </span>
                        <span className="text-[10px] text-[#606060]">
                          {u.email}
                          {u.pod ? ` · ${u.pod}` : ""}
                          {` · ${u.role}`}
                        </span>
                      </div>
                    </td>
                    {VIEW_SECTIONS.map((sec, i) => {
                      const parentChange =
                        i === 0 || VIEW_SECTIONS[i - 1]?.parent !== sec.parent;
                      return (
                        <td
                          key={sec.id}
                          className={`px-3 py-2 text-center ${
                            parentChange ? "border-l border-[#1f1f1f]" : ""
                          }`}
                        >
                          <PermPill perm={matrix[u.id][sec.id]} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="font-mono text-[10px] text-[#606060]">
        Mockup — no permission changes are saved. Wiring deferred until the
        access model is signed off.
      </p>
    </div>
  );
}

// ─── Tab 2: Groups ──────────────────────────────────────────────────────────

function GroupsTab() {
  const [selectedId, setSelectedId] = useState<string>(MOCK_GROUPS[0].id);
  const selected = MOCK_GROUPS.find((g) => g.id === selectedId)!;
  const members = MOCK_USERS.filter((u) => selected.memberIds.includes(u.id));

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      {/* Group list */}
      <Card className="border-[#2a2a2a] bg-[#0d0d0d] h-fit">
        <CardContent className="p-0">
          <ul>
            {MOCK_GROUPS.map((g) => {
              const active = g.id === selectedId;
              return (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(g.id)}
                    className={`block w-full px-4 py-3 text-left transition-colors ${
                      active
                        ? "bg-[#1a1a1a]"
                        : "hover:bg-[#141414]"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={`font-mono text-[11px] uppercase tracking-wider ${
                          active ? "text-white" : "text-[#C4BCAA]"
                        }`}
                      >
                        {g.name}
                      </span>
                      <span className="font-mono text-[10px] text-[#606060] tabular-nums">
                        {g.memberIds.length}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-[#909090] line-clamp-2">
                      {g.description}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {/* Detail */}
      <div className="space-y-4">
        <Card className="border-[#2a2a2a] bg-[#0d0d0d]">
          <CardContent className="space-y-3 p-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
                Group
              </p>
              <h3 className="mt-1 font-mono text-base font-bold uppercase tracking-[0.15em] text-white">
                {selected.name}
              </h3>
              <p className="mt-1 text-[12px] text-[#909090]">
                {selected.description}
              </p>
            </div>

            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-[#606060] mb-2">
                Default Permissions
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {VIEW_SECTIONS.map((sec, idx) => (
                  <div
                    key={sec.id}
                    className="flex items-center justify-between gap-3 rounded border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[10px] uppercase tracking-wider text-[#909090]">
                        {sec.parent}
                      </p>
                      <p className="truncate text-[12px] text-white">
                        {sec.label}
                      </p>
                    </div>
                    <PermPill perm={selected.defaultPerms[idx]} />
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-[#2a2a2a] bg-[#0d0d0d]">
          <CardContent className="p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[#606060] mb-3">
              Members ({members.length})
            </p>
            {members.length === 0 ? (
              <p className="text-[12px] text-[#606060]">No members in this group.</p>
            ) : (
              <ul className="divide-y divide-[#161616]">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] text-white">{m.name}</p>
                      <p className="truncate font-mono text-[10px] text-[#606060]">
                        {m.email}
                        {m.pod ? ` · ${m.pod}` : ""}
                        {` · ${m.role}`}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Tab 3: Audit log ───────────────────────────────────────────────────────

function AuditTab() {
  return (
    <Card className="border-[#2a2a2a] bg-[#0d0d0d]">
      <CardContent className="p-0">
        <ul>
          {MOCK_AUDIT.map((a) => {
            const date = new Date(a.when);
            return (
              <li
                key={a.id}
                className="flex items-baseline justify-between gap-4 border-b border-[#161616] px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-white leading-snug">
                    <span className="text-[#C4BCAA]">{a.actor}</span>
                    {" · "}
                    {a.change}
                    {" · "}
                    <span className="text-[#909090]">{a.affected}</span>
                  </p>
                </div>
                <span
                  className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-[#606060]"
                  title={date.toLocaleString()}
                >
                  {date.toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AccessControlPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-[#606060]">
            Admin
          </p>
          <h1 className="mt-1 font-mono text-base font-bold uppercase tracking-[0.2em] text-white">
            Access Control
          </h1>
          <p className="mt-1 text-[12px] text-[#909090] max-w-2xl">
            Per-user and per-group access to dashboards and admin sections.
            Mockup — no permissions are enforced yet; the real auth + RBAC
            wiring lands once the matrix design is signed off.
          </p>
        </div>
        <span className="rounded border border-[#F5BC4E]/30 bg-[#F5BC4E]/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[#F5BC4E]">
          UI Mockup
        </span>
      </div>

      <Tabs defaultValue="users">
        <TabsList variant="line">
          <TabsTrigger
            value="users"
            className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
          >
            <UsersIcon className="mr-2 inline-block h-3.5 w-3.5" />
            Users × Views
          </TabsTrigger>
          <TabsTrigger
            value="groups"
            className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
          >
            <Shield className="mr-2 inline-block h-3.5 w-3.5" />
            Groups
          </TabsTrigger>
          <TabsTrigger
            value="audit"
            className="data-active:border-b-2 data-active:border-[#42CA80] data-active:text-white text-[#606060]"
          >
            <History className="mr-2 inline-block h-3.5 w-3.5" />
            Audit Log
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <UsersMatrixTab />
        </TabsContent>
        <TabsContent value="groups" className="mt-4">
          <GroupsTab />
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <AuditTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
