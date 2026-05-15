"use client";

import { Filter, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ColumnFilterValue =
  | { kind: "text"; q: string }
  | { kind: "combobox"; q: string }
  | { kind: "select"; selected: string[] }
  | { kind: "range"; min: number | null; max: number | null }
  | { kind: "date"; from: string | null; to: string | null };

export type ColumnFilterDef =
  | { kind: "text" }
  | { kind: "combobox"; options: string[] }
  | { kind: "select"; options: string[] }
  | { kind: "range" }
  | { kind: "date" };

export function isFilterActive(v: ColumnFilterValue | undefined): boolean {
  if (!v) return false;
  if (v.kind === "text" || v.kind === "combobox") return v.q.trim().length > 0;
  if (v.kind === "select") return v.selected.length > 0;
  if (v.kind === "range") return v.min !== null || v.max !== null;
  if (v.kind === "date") return v.from !== null || v.to !== null;
  return false;
}

export function emptyFilter(def: ColumnFilterDef): ColumnFilterValue {
  if (def.kind === "text") return { kind: "text", q: "" };
  if (def.kind === "combobox") return { kind: "combobox", q: "" };
  if (def.kind === "select") return { kind: "select", selected: [] };
  if (def.kind === "range") return { kind: "range", min: null, max: null };
  return { kind: "date", from: null, to: null };
}

export function matchesFilter(
  cellValue: unknown,
  filter: ColumnFilterValue,
): boolean {
  if (!isFilterActive(filter)) return true;
  if (filter.kind === "text" || filter.kind === "combobox") {
    const q = filter.q.trim().toLowerCase();
    if (Array.isArray(cellValue)) {
      return cellValue.some((v) => String(v ?? "").toLowerCase().includes(q));
    }
    return String(cellValue ?? "").toLowerCase().includes(q);
  }
  if (filter.kind === "select") {
    const sel = new Set(filter.selected);
    if (Array.isArray(cellValue)) {
      return cellValue.some((v) => sel.has(String(v ?? "")));
    }
    return sel.has(String(cellValue ?? ""));
  }
  if (filter.kind === "range") {
    const n = typeof cellValue === "number" ? cellValue : Number(cellValue);
    if (!Number.isFinite(n)) return false;
    if (filter.min !== null && n < filter.min) return false;
    if (filter.max !== null && n > filter.max) return false;
    return true;
  }
  if (filter.kind === "date") {
    const s = typeof cellValue === "string" ? cellValue : "";
    if (filter.from !== null && s < filter.from) return false;
    if (filter.to !== null && s > filter.to) return false;
    return true;
  }
  return true;
}

interface ColumnFilterProps {
  label: string;
  def: ColumnFilterDef;
  value: ColumnFilterValue | undefined;
  onChange: (next: ColumnFilterValue) => void;
}

export function ColumnFilter({ label, def, value, onChange }: ColumnFilterProps) {
  const [open, setOpen] = useState(false);
  const active = isFilterActive(value);
  const current = value ?? emptyFilter(def);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "inline-flex h-4 w-4 items-center justify-center rounded-sm transition-colors",
          active
            ? "bg-[#42CA80]/20 text-[#42CA80]"
            : "text-[#404040] hover:bg-[#161616] hover:text-[#909090]",
        )}
        aria-label={`Filter ${label}`}
      >
        <Filter className="h-2.5 w-2.5" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[240px] rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] p-2 font-mono text-[11px] text-[#C4BCAA] shadow-xl"
      >
        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#606060]">
            {label}
          </span>
          {active && (
            <button
              type="button"
              onClick={() => {
                onChange(emptyFilter(def));
                setOpen(false);
              }}
              className="inline-flex items-center gap-0.5 text-[10px] text-[#909090] hover:text-white"
            >
              <X className="h-2.5 w-2.5" />
              Clear
            </button>
          )}
        </div>

        {def.kind === "text" && current.kind === "text" && (
          <TextFilterBody
            value={current.q}
            placeholder="Contains…"
            onChange={(q) => onChange({ kind: "text", q })}
          />
        )}

        {def.kind === "combobox" && current.kind === "combobox" && (
          <ComboboxFilterBody
            value={current.q}
            options={def.options}
            onChange={(q) => onChange({ kind: "combobox", q })}
            onCommit={(q) => {
              onChange({ kind: "combobox", q });
              setOpen(false);
            }}
          />
        )}

        {def.kind === "select" && current.kind === "select" && (
          <SelectFilterBody
            options={def.options}
            selected={current.selected}
            onChange={(s) => onChange({ kind: "select", selected: s })}
          />
        )}

        {def.kind === "range" && current.kind === "range" && (
          <div className="flex items-center gap-2 p-1">
            <Input
              type="number"
              autoFocus
              value={current.min ?? ""}
              onChange={(e) =>
                onChange({
                  kind: "range",
                  min: e.target.value === "" ? null : Number(e.target.value),
                  max: current.max,
                })
              }
              placeholder="Min"
              className="h-7 text-[11px] bg-transparent border-[#1e1e1e] focus:border-[#42CA80]/50 rounded-md font-mono"
            />
            <span className="text-[#606060]">–</span>
            <Input
              type="number"
              value={current.max ?? ""}
              onChange={(e) =>
                onChange({
                  kind: "range",
                  min: current.min,
                  max: e.target.value === "" ? null : Number(e.target.value),
                })
              }
              placeholder="Max"
              className="h-7 text-[11px] bg-transparent border-[#1e1e1e] focus:border-[#42CA80]/50 rounded-md font-mono"
            />
          </div>
        )}

        {def.kind === "date" && current.kind === "date" && (
          <div className="space-y-2 p-1">
            <div>
              <label className="mb-0.5 block text-[10px] uppercase tracking-wider text-[#606060]">
                From
              </label>
              <Input
                type="date"
                value={current.from ?? ""}
                onChange={(e) =>
                  onChange({
                    kind: "date",
                    from: e.target.value || null,
                    to: current.to,
                  })
                }
                className="h-7 text-[11px] bg-transparent border-[#1e1e1e] focus:border-[#42CA80]/50 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] uppercase tracking-wider text-[#606060]">
                To
              </label>
              <Input
                type="date"
                value={current.to ?? ""}
                onChange={(e) =>
                  onChange({
                    kind: "date",
                    from: current.from,
                    to: e.target.value || null,
                  })
                }
                className="h-7 text-[11px] bg-transparent border-[#1e1e1e] focus:border-[#42CA80]/50 rounded-md font-mono"
              />
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Simple text-contains filter — single input, matches the dashboard search. */
function TextFilterBody({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#606060]" />
      <Input
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 pl-7 pr-2 text-[11px] bg-transparent border-[#1e1e1e] focus:border-[#42CA80]/50 rounded-md font-mono"
      />
    </div>
  );
}

/** Typeahead combobox — text input with a dropdown list of matching options.
 *  Mirrors the dashboard "Search clients..." UX: typing filters by contains,
 *  clicking an option commits to that exact value and closes the popover. */
function ComboboxFilterBody({
  value,
  options,
  onChange,
  onCommit,
}: {
  value: string;
  options: string[];
  onChange: (next: string) => void;
  onCommit: (next: string) => void;
}) {
  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options.slice(0, 50);
    return options
      .filter((o) => o.toLowerCase().includes(q))
      .slice(0, 50);
  }, [options, value]);

  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#606060]" />
        <Input
          autoFocus
          value={value}
          placeholder="Search…"
          onChange={(e) => onChange(e.target.value)}
          className="h-7 pl-7 pr-2 text-[11px] bg-transparent border-[#1e1e1e] focus:border-[#42CA80]/50 rounded-md font-mono"
        />
      </div>
      {filtered.length > 0 && (
        <div className="max-h-[220px] overflow-y-auto rounded-md border border-[#2a2a2a] bg-[#0d0d0d]">
          {filtered.map((opt) => (
            <button
              key={opt}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onCommit(opt);
              }}
              className={cn(
                "block w-full truncate px-2.5 py-1 text-left text-[11px] transition-colors",
                value === opt
                  ? "bg-[#42CA80]/15 text-[#42CA80]"
                  : "text-[#C4BCAA] hover:bg-[#1F1F1F] hover:text-white",
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      {filtered.length === 0 && value.trim() && (
        <div className="px-2 py-1 text-[10px] text-[#606060]">No matches</div>
      )}
    </div>
  );
}

function SelectFilterBody({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(
    () =>
      q.trim()
        ? options.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase()))
        : options,
    [options, q],
  );
  const allChecked = selected.length === options.length && options.length > 0;
  const noneChecked = selected.length === 0;
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#606060]" />
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search values…"
          className="h-7 pl-7 pr-2 text-[11px] bg-transparent border-[#1e1e1e] focus:border-[#42CA80]/50 rounded-md font-mono"
        />
      </div>
      <div className="flex items-center justify-between px-1 text-[10px] text-[#606060]">
        <button
          type="button"
          onClick={() => onChange(allChecked ? [] : [...options])}
          className="text-[#42CA80] hover:text-[#65FFAA]"
        >
          {allChecked ? "Deselect all" : "Select all"}
        </button>
        <span>
          {selected.length}/{options.length}
        </span>
      </div>
      <div className="max-h-[180px] space-y-0.5 overflow-y-auto rounded-md border border-[#2a2a2a] bg-[#0d0d0d] p-0.5">
        {filtered.length === 0 ? (
          <div className="py-2 text-center text-[10px] text-[#606060]">No matches</div>
        ) : (
          filtered.map((opt) => {
            const checked = selected.includes(opt);
            return (
              <label
                key={opt}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-0.5 transition-colors",
                  checked
                    ? "bg-[#42CA80]/10 text-[#42CA80]"
                    : "text-[#C4BCAA] hover:bg-[#1F1F1F] hover:text-white",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    if (e.target.checked) {
                      onChange([...selected, opt]);
                    } else {
                      onChange(selected.filter((s) => s !== opt));
                    }
                  }}
                  className="h-3 w-3 accent-[#42CA80]"
                />
                <span className="truncate text-[11px]">{opt || "(empty)"}</span>
              </label>
            );
          })
        )}
      </div>
      {!noneChecked && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="w-full rounded-md border border-[#1e1e1e] bg-transparent px-2 py-1 text-[10px] uppercase tracking-wider text-[#909090] hover:border-[#42CA80]/50 hover:text-white"
        >
          Clear selection
        </button>
      )}
    </div>
  );
}

/** Helper to render a column header with an inline filter trigger. */
export function FilterableHeader({
  label,
  filterKey,
  def,
  filters,
  setFilters,
}: {
  label: string;
  filterKey: string;
  def: ColumnFilterDef;
  filters: Record<string, ColumnFilterValue>;
  setFilters: (next: Record<string, ColumnFilterValue>) => void;
}) {
  const value = filters[filterKey];
  return (
    <div className="inline-flex items-center gap-1">
      <span>{label}</span>
      <ColumnFilter
        label={label}
        def={def}
        value={value}
        onChange={(v) => setFilters({ ...filters, [filterKey]: v })}
      />
    </div>
  );
}

/** Reset-all button to clear every active filter on a tab. Styled to match
 *  the dashboard filter chips (rounded-md, subtle border, tight padding). */
export function ClearFiltersButton({
  filters,
  setFilters,
}: {
  filters: Record<string, ColumnFilterValue>;
  setFilters: (next: Record<string, ColumnFilterValue>) => void;
}) {
  const activeCount = Object.values(filters).filter(isFilterActive).length;
  if (activeCount === 0) return null;
  return (
    <button
      type="button"
      onClick={() => setFilters({})}
      className="inline-flex h-7 items-center gap-1 rounded-md border border-[#1e1e1e] bg-transparent px-2 font-mono text-[11px] text-[#909090] transition-colors hover:border-[#ED6958]/40 hover:text-[#ED6958]"
    >
      <X className="h-3 w-3" />
      Clear {activeCount} filter{activeCount > 1 ? "s" : ""}
    </button>
  );
}
