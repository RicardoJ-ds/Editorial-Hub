"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  CalendarDays,
  CalendarRange,
  Database,
  GitPullRequest,
  LayoutGrid,
  Move3D,
  Plane,
  Settings,
  Sliders,
  Sparkles,
  Table2,
  Users,
} from "lucide-react";

type TabGroup = {
  label: string;
  items: Array<{
    href: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }>;
};

const GROUPS: TabGroup[] = [
  {
    label: "Plan",
    items: [
      { href: "/capacity-planning", label: "Overview", icon: LayoutGrid },
      { href: "/capacity-planning/quarter", label: "Quarter", icon: CalendarDays },
      { href: "/capacity-planning/roster", label: "Roster", icon: Users },
      { href: "/capacity-planning/allocation", label: "Allocation", icon: Move3D },
    ],
  },
  {
    label: "Maintain",
    items: [
      { href: "/capacity-planning/weekly", label: "Weekly", icon: CalendarRange },
      { href: "/capacity-planning/leave", label: "Leave", icon: Plane },
      { href: "/capacity-planning/overrides", label: "Overrides", icon: Sliders },
      { href: "/capacity-planning/admin", label: "Admin", icon: Settings },
    ],
  },
  {
    label: "Data model",
    items: [
      { href: "/capacity-planning/schema", label: "Schema", icon: Database },
      { href: "/capacity-planning/tables", label: "Tables", icon: Table2 },
      { href: "/capacity-planning/glossary", label: "Glossary", icon: BookOpen },
      { href: "/capacity-planning/migration", label: "Migration", icon: GitPullRequest },
    ],
  },
];

export function LeftRail() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-fit w-[200px] shrink-0 flex-col gap-4 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] p-3">
      <div className="flex items-center gap-2 px-2 pt-1">
        <Sparkles className="h-4 w-4 text-[#42CA80]" />
        <div className="flex flex-col">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-[#65FFAA]">
            Capacity v2
          </span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-[#606060]">
            Proposal
          </span>
        </div>
      </div>

      {GROUPS.map((g) => (
        <div key={g.label} className="flex flex-col gap-0.5">
          <span className="px-2 pb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#606060]">
            {g.label}
          </span>
          {g.items.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/capacity-planning" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 font-mono text-[11px] font-medium uppercase tracking-wider transition-colors ${
                  active
                    ? "bg-[#42CA80]/10 text-[#65FFAA]"
                    : "text-[#C4BCAA] hover:bg-[#161616] hover:text-white"
                }`}
              >
                <item.icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
