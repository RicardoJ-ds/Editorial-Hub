"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, Building2, Gauge, Layers, Users } from "lucide-react";

const TABS = [
  { href: "/capacity-planning/admin/members", label: "Members", icon: Users },
  { href: "/capacity-planning/admin/pods", label: "Pods", icon: Layers },
  { href: "/capacity-planning/admin/clients", label: "Clients", icon: Building2 },
  { href: "/capacity-planning/admin/tiers", label: "Tiers", icon: Briefcase },
  { href: "/capacity-planning/admin/metrics", label: "KPI Metrics", icon: Gauge },
];

export function AdminNav() {
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
