"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";

export type AdminFieldType = "text" | "number" | "email" | "date" | "bool" | "select";

export type AdminField<T> = {
  key: keyof T & string;
  label: string;
  type: AdminFieldType;
  options?: Array<{ value: string | number; label: string }>;
  required?: boolean;
  width?: string;
  format?: (value: unknown) => string;
};

type Props<T extends { id: number }> = {
  title: string;
  description: string;
  rows: T[];
  fields: AdminField<T>[];
  newRowTemplate: Omit<T, "id">;
  onAdd: (row: Omit<T, "id">) => void;
  onUpdate: (row: T) => void;
  onDelete: (id: number) => void;
};

export function AdminTable<T extends { id: number }>({
  title,
  description,
  rows,
  fields,
  newRowTemplate,
  onAdd,
  onUpdate,
  onDelete,
}: Props<T>) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<T>>({});
  const [creating, setCreating] = useState(false);
  const [newDraft, setNewDraft] = useState<Partial<T>>(newRowTemplate as Partial<T>);

  function startEdit(row: T) {
    setEditingId(row.id);
    setDraft(row);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft({});
  }

  function saveEdit() {
    if (editingId == null) return;
    onUpdate({ ...(draft as T), id: editingId });
    cancelEdit();
  }

  function saveNew() {
    onAdd(newDraft as Omit<T, "id">);
    setCreating(false);
    setNewDraft(newRowTemplate as Partial<T>);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <p className="mt-1 text-xs text-[#C4BCAA]">{description}</p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          disabled={creating}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-[#42CA80]/40 bg-[#42CA80]/10 px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider text-[#65FFAA] hover:bg-[#42CA80]/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          New row
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#1f1f1f] bg-[#0a0a0a]">
        <table className="w-full min-w-[780px] border-collapse font-mono text-[11px]">
          <thead>
            <tr className="border-b border-[#1a1a1a] bg-[#050505] text-[10px] uppercase tracking-wider text-[#606060]">
              <th className="px-3 py-2 text-left">id</th>
              {fields.map((f) => (
                <th key={f.key} className="px-3 py-2 text-left" style={f.width ? { minWidth: f.width } : undefined}>
                  {f.label}
                </th>
              ))}
              <th className="w-20 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {creating && (
              <tr className="border-b border-[#161616] bg-[#111111]">
                <td className="px-3 py-2 text-[#606060]">new</td>
                {fields.map((f) => (
                  <td key={f.key} className="px-3 py-1.5">
                    <FieldInput
                      field={f}
                      value={(newDraft as Record<string, unknown>)[f.key]}
                      onChange={(v) =>
                        setNewDraft((d) => ({ ...d, [f.key]: v }) as Partial<T>)
                      }
                    />
                  </td>
                ))}
                <td className="px-3 py-1.5">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={saveNew}
                      className="rounded-md border border-[#42CA80]/40 bg-[#42CA80]/10 p-1 text-[#65FFAA] hover:bg-[#42CA80]/20"
                      title="Save"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCreating(false);
                        setNewDraft(newRowTemplate as Partial<T>);
                      }}
                      className="rounded-md border border-[#2a2a2a] p-1 text-[#606060] hover:text-white"
                      title="Discard"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            )}

            {rows.map((row) => {
              const isEditing = editingId === row.id;
              return (
                <tr
                  key={row.id}
                  className="border-b border-[#161616] last:border-0 hover:bg-[#111111]"
                >
                  <td className="px-3 py-2 text-[#606060]">{row.id}</td>
                  {fields.map((f) => {
                    const raw = isEditing
                      ? (draft as Record<string, unknown>)[f.key]
                      : (row as Record<string, unknown>)[f.key];
                    return (
                      <td key={f.key} className="px-3 py-1.5 text-[#C4BCAA]">
                        {isEditing ? (
                          <FieldInput
                            field={f}
                            value={raw}
                            onChange={(v) =>
                              setDraft((d) => ({ ...d, [f.key]: v }) as Partial<T>)
                            }
                          />
                        ) : (
                          <DisplayCell field={f} value={raw} />
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-end gap-1">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={saveEdit}
                            className="rounded-md border border-[#42CA80]/40 bg-[#42CA80]/10 p-1 text-[#65FFAA] hover:bg-[#42CA80]/20"
                            title="Save"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="rounded-md border border-[#2a2a2a] p-1 text-[#606060] hover:text-white"
                            title="Cancel"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            className="rounded-md border border-transparent p-1 text-[#606060] hover:border-[#2a2a2a] hover:text-white"
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Delete row #${row.id}?`)) onDelete(row.id);
                            }}
                            className="rounded-md border border-transparent p-1 text-[#606060] hover:border-[#ED6958]/40 hover:text-[#ED6958]"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}

            {rows.length === 0 && !creating && (
              <tr>
                <td
                  colSpan={fields.length + 2}
                  className="px-4 py-6 text-center text-xs text-[#606060]"
                >
                  No rows yet. Click <b className="text-white">New row</b> to add one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DisplayCell<T>({ field, value }: { field: AdminField<T>; value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-[#444]">—</span>;
  }
  if (field.format) return <>{field.format(value)}</>;
  if (field.type === "bool") {
    return (
      <span className={value ? "text-[#65FFAA]" : "text-[#606060]"}>
        {value ? "yes" : "no"}
      </span>
    );
  }
  if (field.type === "select" && field.options) {
    const opt = field.options.find((o) => o.value === value);
    return <>{opt?.label ?? String(value)}</>;
  }
  return <>{String(value)}</>;
}

function FieldInput<T>({
  field,
  value,
  onChange,
}: {
  field: AdminField<T>;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const common =
    "h-7 w-full rounded border border-[#2a2a2a] bg-[#161616] px-2 font-mono text-[11px] text-white placeholder:text-[#606060] outline-none focus:border-[#42CA80]/50";

  if (field.type === "bool") {
    return (
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[#42CA80]"
      />
    );
  }
  if (field.type === "select" && field.options) {
    return (
      <select
        value={value == null ? "" : String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          const found = field.options?.find((o) => String(o.value) === raw);
          onChange(found ? found.value : raw);
        }}
        className={common}
      >
        {field.options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "number") {
    return (
      <input
        type="number"
        step="any"
        value={value == null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : parseFloat(e.target.value))}
        className={common}
      />
    );
  }
  if (field.type === "date") {
    return (
      <input
        type="date"
        value={value ? String(value).slice(0, 10) : ""}
        onChange={(e) => onChange(e.target.value || null)}
        className={common}
      />
    );
  }
  return (
    <input
      type={field.type === "email" ? "email" : "text"}
      value={value == null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value)}
      className={common}
    />
  );
}
