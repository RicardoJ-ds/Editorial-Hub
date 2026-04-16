// Mock data for the Capacity Planning v2 prototype.
// Shape intentionally mirrors the views described in CAPACITY_PLANNING_V2.md
// so the real API can drop in later without UI changes.

export type Role = "SE" | "ED" | "WR" | "AD" | "PM";

export type MemberRow = {
  id: number;
  fullName: string;
  role: Role;
  capacityShare: number; // 0..1
  defaultCapacity: number; // articles/month at share=1, leave=0
  leaveShare: number; // 0..1
  overrideDelta: number; // signed articles
  actualDelivered: number;
};

export type ClientChip = {
  id: number;
  name: string;
  projectedArticles: number;
  source: "manual" | "operating_model" | "sow";
};

export type PodBoard = {
  id: number;
  podNumber: number;
  displayName: string;
  members: MemberRow[];
  clients: ClientChip[];
  actualDeliveredTotal: number;
};

export type MonthKey =
  | "2026-02"
  | "2026-03"
  | "2026-04"
  | "2026-05"
  | "2026-06";

export const MONTH_LABELS: Record<MonthKey, string> = {
  "2026-02": "Feb 2026",
  "2026-03": "Mar 2026",
  "2026-04": "Apr 2026",
  "2026-05": "May 2026",
  "2026-06": "Jun 2026",
};

export const MONTHS: MonthKey[] = [
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
];

export const MOCK_DATA: Record<MonthKey, PodBoard[]> = {
  "2026-02": [],
  "2026-03": [],
  "2026-04": [
    {
      id: 1,
      podNumber: 1,
      displayName: "Nina's Pod",
      members: [
        {
          id: 101,
          fullName: "Nina Derossi",
          role: "SE",
          capacityShare: 1.0,
          defaultCapacity: 12,
          leaveShare: 0,
          overrideDelta: 0,
          actualDelivered: 11,
        },
        {
          id: 102,
          fullName: "Robert Trampe",
          role: "ED",
          capacityShare: 1.0,
          defaultCapacity: 10,
          leaveShare: 0,
          overrideDelta: 0,
          actualDelivered: 10,
        },
        {
          id: 103,
          fullName: "Jimmy Bowes",
          role: "ED",
          capacityShare: 0.5,
          defaultCapacity: 8,
          leaveShare: 0,
          overrideDelta: 0,
          actualDelivered: 5,
        },
      ],
      clients: [
        { id: 201, name: "College of BP", projectedArticles: 10, source: "sow" },
        { id: 202, name: "Harvard", projectedArticles: 8, source: "operating_model" },
        { id: 203, name: "Cornell", projectedArticles: 6, source: "operating_model" },
      ],
      actualDeliveredTotal: 26,
    },
    {
      id: 2,
      podNumber: 2,
      displayName: "Kennedy's Pod",
      members: [
        {
          id: 104,
          fullName: "Kennedy Stevens",
          role: "SE",
          capacityShare: 1.0,
          defaultCapacity: 12,
          leaveShare: 0,
          overrideDelta: 0,
          actualDelivered: 10,
        },
        {
          id: 105,
          fullName: "Samantha McEniff",
          role: "ED",
          capacityShare: 1.0,
          defaultCapacity: 10,
          leaveShare: 0.25,
          overrideDelta: 0,
          actualDelivered: 7,
        },
        {
          id: 106,
          fullName: "Tiffany Anderson",
          role: "ED",
          capacityShare: 1.0,
          defaultCapacity: 8,
          leaveShare: 0,
          overrideDelta: -2,
          actualDelivered: 6,
        },
      ],
      clients: [
        { id: 204, name: "Athena", projectedArticles: 8, source: "sow" },
        { id: 205, name: "Brown", projectedArticles: 6, source: "operating_model" },
        { id: 206, name: "Berkeley", projectedArticles: 5, source: "manual" },
      ],
      actualDeliveredTotal: 23,
    },
    {
      id: 3,
      podNumber: 3,
      displayName: "Maggie's Pod",
      members: [
        {
          id: 107,
          fullName: "Maggie Eastwick",
          role: "SE",
          capacityShare: 1.0,
          defaultCapacity: 12,
          leaveShare: 0,
          overrideDelta: 0,
          actualDelivered: 12,
        },
        {
          id: 108,
          fullName: "Lauren Pfau",
          role: "ED",
          capacityShare: 1.0,
          defaultCapacity: 10,
          leaveShare: 0,
          overrideDelta: 0,
          actualDelivered: 9,
        },
        {
          id: 103,
          fullName: "Jimmy Bowes",
          role: "ED",
          capacityShare: 0.5,
          defaultCapacity: 8,
          leaveShare: 0,
          overrideDelta: 0,
          actualDelivered: 4,
        },
      ],
      clients: [
        { id: 207, name: "Drexel", projectedArticles: 4, source: "sow" },
        { id: 208, name: "Emory", projectedArticles: 7, source: "operating_model" },
        { id: 209, name: "Fordham", projectedArticles: 9, source: "operating_model" },
      ],
      actualDeliveredTotal: 25,
    },
  ],
  "2026-05": [],
  "2026-06": [],
};

// Carry Apr forward as mock data for surrounding months so the picker shows something.
for (const key of ["2026-02", "2026-03", "2026-05", "2026-06"] as MonthKey[]) {
  MOCK_DATA[key] = MOCK_DATA["2026-04"].map((pod) => ({
    ...pod,
    actualDeliveredTotal: Math.round(pod.actualDeliveredTotal * (0.85 + Math.random() * 0.25)),
  }));
}

// Unassigned clients for the Allocation kanban — clients that exist
// in the dim but have no pod allocation for the selected month.
export const UNASSIGNED_CLIENTS_BY_MONTH: Record<MonthKey, ClientChip[]> = {
  "2026-02": [{ id: 210, name: "Drexel", projectedArticles: 4, source: "sow" }],
  "2026-03": [{ id: 211, name: "Emory", projectedArticles: 5, source: "operating_model" }],
  "2026-04": [
    { id: 212, name: "Georgetown", projectedArticles: 3, source: "sow" },
    { id: 213, name: "Howard", projectedArticles: 5, source: "operating_model" },
  ],
  "2026-05": [],
  "2026-06": [{ id: 214, name: "Iowa", projectedArticles: 6, source: "manual" }],
};

export function computeMemberEffective(m: MemberRow): number {
  return (
    m.defaultCapacity * m.capacityShare * (1 - m.leaveShare) + m.overrideDelta
  );
}

export function computePodTotals(pod: PodBoard) {
  const totalCapacity = pod.members.reduce(
    (sum, m) => sum + computeMemberEffective(m),
    0,
  );
  const projectedUse = pod.clients.reduce(
    (sum, c) => sum + c.projectedArticles,
    0,
  );
  return {
    totalCapacity,
    projectedUse,
    actualDelivered: pod.actualDeliveredTotal,
    utilizationPct:
      totalCapacity > 0 ? (projectedUse / totalCapacity) * 100 : 0,
    varianceVsProjected: pod.actualDeliveredTotal - projectedUse,
  };
}

// Roster matrix: one row per (member × month) showing pod assignment + share.
// Built by inverting MOCK_DATA so we can render the grid in image #3 style.
export type RosterCell = {
  podId: number;
  podNumber: number;
  capacityShare: number;
  role: Role;
  leaveShare: number;
};

export type RosterRow = {
  memberId: number;
  fullName: string;
  defaultRole: Role;
  defaultCapacity: number;
  cellsByMonth: Partial<Record<MonthKey, RosterCell[]>>;
};

export function buildRoster(): RosterRow[] {
  const byMember = new Map<number, RosterRow>();
  for (const month of MONTHS) {
    for (const pod of MOCK_DATA[month] ?? []) {
      for (const m of pod.members) {
        let row = byMember.get(m.id);
        if (!row) {
          row = {
            memberId: m.id,
            fullName: m.fullName,
            defaultRole: m.role,
            defaultCapacity: m.defaultCapacity,
            cellsByMonth: {},
          };
          byMember.set(m.id, row);
        }
        const cells = row.cellsByMonth[month] ?? [];
        cells.push({
          podId: pod.id,
          podNumber: pod.podNumber,
          capacityShare: m.capacityShare,
          role: m.role,
          leaveShare: m.leaveShare,
        });
        row.cellsByMonth[month] = cells;
      }
    }
  }
  return Array.from(byMember.values()).sort((a, b) =>
    a.fullName.localeCompare(b.fullName),
  );
}
