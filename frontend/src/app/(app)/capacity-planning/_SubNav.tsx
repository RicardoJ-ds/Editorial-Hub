"use client";

import { usePathname } from "next/navigation";
import { MonthPicker } from "./_MonthPicker";
import { GlobalSearch } from "./_GlobalSearch";

// The left rail is the primary nav. This small header strip only renders
// month-aware controls (picker) plus global search. Hidden entirely on
// month-agnostic views to keep the header calm.
const MONTH_AGNOSTIC_EXACT = new Set<string>([
  "/capacity-planning/schema",
  "/capacity-planning/tables",
  "/capacity-planning/glossary",
  "/capacity-planning/migration",
]);
const MONTH_AGNOSTIC_PREFIXES = ["/capacity-planning/admin"];

export function SubNav() {
  const pathname = usePathname();
  const showMonth =
    !MONTH_AGNOSTIC_EXACT.has(pathname) &&
    !MONTH_AGNOSTIC_PREFIXES.some((p) => pathname.startsWith(p));

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {showMonth && <MonthPicker />}
      <GlobalSearch />
    </div>
  );
}
