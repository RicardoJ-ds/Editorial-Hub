"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Key, Link2 } from "lucide-react";
import type { TableSpec } from "./_erd";

type TableNodeData = {
  table: TableSpec;
};

type TableNodeType = Node<TableNodeData, "table">;

const GROUP_ACCENT: Record<TableSpec["group"], string> = {
  dim: "border-[#42CA80]/50 bg-[#0c1510]",
  fact: "border-[#5B8EFF]/40 bg-[#0b1018]",
};

const GROUP_HEADER: Record<TableSpec["group"], string> = {
  dim: "bg-[#42CA80]/10 text-[#65FFAA]",
  fact: "bg-[#5B8EFF]/10 text-[#8EB0FF]",
};

function TableNodeInner({ data }: NodeProps<TableNodeType>) {
  const { table } = data;

  return (
    <div
      className={`min-w-[260px] rounded-md border ${GROUP_ACCENT[table.group]} font-mono text-[11px] shadow-lg shadow-black/40`}
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
          {table.group}
        </span>
      </div>

      {/* Columns */}
      <ul className="divide-y divide-[#1f1f1f]">
        {table.columns.map((c) => {
          const isKey = c.kind === "pk" || c.kind === "pk-fk";
          const isFk = c.kind === "fk" || c.kind === "pk-fk";
          return (
            <li
              key={c.name}
              className="flex items-center gap-2 px-3 py-1 hover:bg-white/[0.02]"
            >
              <span className="flex w-4 shrink-0 items-center justify-center text-[#C4BCAA]">
                {isKey ? (
                  <Key className="h-3 w-3 text-[#F5C542]" />
                ) : isFk ? (
                  <Link2 className="h-3 w-3 text-[#8EB0FF]" />
                ) : null}
              </span>
              <span
                className={`flex-1 truncate ${isKey ? "font-semibold text-white" : "text-[#C4BCAA]"}`}
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
