"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Key, Link2 } from "lucide-react";
import type { TableSpec } from "./_erd";

/** Selection state propagated from SchemaPage into every TableNode so we can
 *  style the clicked table, its neighbors, and the dimmed rest of the graph. */
type HighlightState = "selected" | "neighbor" | "dim" | "idle";

type TableNodeData = {
  table: TableSpec;
  state?: HighlightState;
  /** Column names that are part of connecting keys for the current selection
   *  (PKs of the selected/neighbor tables, plus FKs that reference them). */
  highlightCols?: Set<string>;
};

type TableNodeType = Node<TableNodeData, "table">;

const GROUP_ACCENT: Record<TableSpec["group"], string> = {
  dim: "border-[#42CA80]/50 bg-[#0c1510]",
  fact: "border-[#5B8EFF]/40 bg-[#0b1018]",
};

const SELECTED_ACCENT: Record<TableSpec["group"], string> = {
  dim: "border-[#65FFAA] bg-[#0c1510] ring-2 ring-[#65FFAA]/40",
  fact: "border-[#8EB0FF] bg-[#0b1018] ring-2 ring-[#8EB0FF]/40",
};

const NEIGHBOR_ACCENT: Record<TableSpec["group"], string> = {
  dim: "border-[#42CA80] bg-[#0c1510]",
  fact: "border-[#5B8EFF] bg-[#0b1018]",
};

const GROUP_HEADER: Record<TableSpec["group"], string> = {
  dim: "bg-[#42CA80]/10 text-[#65FFAA]",
  fact: "bg-[#5B8EFF]/10 text-[#8EB0FF]",
};

function TableNodeInner({ data }: NodeProps<TableNodeType>) {
  const { table, state = "idle", highlightCols } = data;

  const border =
    state === "selected"
      ? SELECTED_ACCENT[table.group]
      : state === "neighbor"
      ? NEIGHBOR_ACCENT[table.group]
      : GROUP_ACCENT[table.group];
  const wrapperOpacity = state === "dim" ? "opacity-30" : "opacity-100";

  return (
    <div
      className={`min-w-[260px] rounded-md border ${border} ${wrapperOpacity} font-mono text-[11px] shadow-lg shadow-black/40 transition-opacity`}
    >
      {/* Hidden source+target handles on the table — edges attach to the whole card */}
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <Handle type="source" position={Position.Right} className="!opacity-0" />

      {/* Header */}
      <div
        className={`flex items-center justify-between rounded-t-md px-3 py-1.5 ${GROUP_HEADER[table.group]}`}
      >
        <span className="font-semibold tracking-wide">{table.name}</span>
        <span className="text-[9px] uppercase tracking-[0.14em] opacity-70">
          {table.group} · {table.domain}
        </span>
      </div>

      {/* Columns */}
      <ul className="divide-y divide-[#1f1f1f]">
        {table.columns.map((c) => {
          const isKey = c.kind === "pk" || c.kind === "pk-fk";
          const isFk = c.kind === "fk" || c.kind === "pk-fk";
          const emphasized = !!highlightCols?.has(c.name);
          return (
            <li
              key={c.name}
              className={`flex items-center gap-2 px-3 py-1 hover:bg-white/[0.02] ${
                emphasized ? "bg-[#F5C542]/10" : ""
              }`}
            >
              <span className="flex w-4 shrink-0 items-center justify-center text-[#C4BCAA]">
                {isKey ? (
                  <Key className={`h-3 w-3 ${emphasized ? "text-[#F5C542]" : "text-[#F5C542]"}`} />
                ) : isFk ? (
                  <Link2 className={`h-3 w-3 ${emphasized ? "text-[#8EB0FF]" : "text-[#8EB0FF]"}`} />
                ) : null}
              </span>
              <span
                className={`flex-1 truncate ${
                  emphasized
                    ? "font-semibold text-[#F5C542]"
                    : isKey
                    ? "font-semibold text-white"
                    : "text-[#C4BCAA]"
                }`}
                title={c.note}
              >
                {c.name}
              </span>
              <span className="shrink-0 text-[10px] text-[#606060]">
                {c.type}
                {c.nullable ? "?" : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export const TableNode = memo(TableNodeInner);
export type { TableNodeType };
