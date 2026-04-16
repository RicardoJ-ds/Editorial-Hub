"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Move3D, Users } from "lucide-react";

const TABS = [
  { href: "/capacity-planning", label: "Overview", icon: LayoutGrid },
  { href: "/capacity-planning/roster", label: "Roster", icon: Users },
  { href: "/capacity-planning/allocation", label: "Allocation", icon: Move3D },
];

export function SubNav() {
  const pathname = usePathname();
  return (
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
  );
}
