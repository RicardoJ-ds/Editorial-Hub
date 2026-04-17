"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  Move3D,
  Users,
  Database,
  Table2,
  BookOpen,
  Plane,
  Sliders,
  CalendarRange,
  Settings,
} from "lucide-react";
import { MonthPicker } from "./_MonthPicker";

const TABS = [
  { href: "/capacity-planning", label: "Overview", icon: LayoutGrid },
  { href: "/capacity-planning/roster", label: "Roster", icon: Users },
  { href: "/capacity-planning/allocation", label: "Allocation", icon: Move3D },
  { href: "/capacity-planning/weekly", label: "Weekly", icon: CalendarRange },
  { href: "/capacity-planning/leave", label: "Leave", icon: Plane },
  { href: "/capacity-planning/overrides", label: "Overrides", icon: Sliders },
  { href: "/capacity-planning/admin", label: "Admin", icon: Settings },
  { href: "/capacity-planning/schema", label: "Schema", icon: Database },
  { href: "/capacity-planning/tables", label: "Tables", icon: Table2 },
  { href: "/capacity-planning/glossary", label: "Glossary", icon: BookOpen },
];

// Tabs that don't depend on the selected month — hide the picker there to
// reduce noise.
const MONTH_AGNOSTIC_EXACT = new Set<string>([
  "/capacity-planning/schema",
  "/capacity-planning/tables",
  "/capacity-planning/glossary",
]);
const MONTH_AGNOSTIC_PREFIXES = ["/capacity-planning/admin"];

export function SubNav() {
  const pathname = usePathname();
  const showMonth =
    !MONTH_AGNOSTIC_EXACT.has(pathname) &&
    !MONTH_AGNOSTIC_PREFIXES.some((p) => pathname.startsWith(p));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] p-1">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider transition-all ${
                active
                  ? "bg-[#42CA80]/10 text-[#65FFAA]"
                  : "text-[#C4BCAA] hover:bg-[#161616] hover:text-white"
              }`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </Link>
          );
        })}
      </div>
      {showMonth && <MonthPicker />}
    </div>
  );
}
