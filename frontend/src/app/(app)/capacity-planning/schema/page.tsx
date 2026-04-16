"use client";

import { useMemo } from "react";
import dagre from "dagre";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { SubNav } from "../_SubNav";
import { ProposalBanner } from "../_ProposalBanner";
import { TABLES, RELATIONS, type TableSpec } from "../_erd";
import { TableNode, type TableNodeType } from "../_TableNode";

const NODE_WIDTH = 280;
const ROW_HEIGHT = 22;
const HEADER_HEIGHT = 32;

function estimateHeight(table: TableSpec): number {
  return HEADER_HEIGHT + table.columns.length * ROW_HEIGHT + 4;
}

function layout(tables: TableSpec[], relations: typeof RELATIONS) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 120, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const t of tables) {
    g.setNode(t.id, { width: NODE_WIDTH, height: estimateHeight(t) });
  }
  for (const r of relations) {
    g.setEdge(r.from, r.to);
  }
  dagre.layout(g);

  const nodes: Node[] = tables.map((t) => {
    const { x, y } = g.node(t.id);
    const h = estimateHeight(t);
    return {
      id: t.id,
      type: "table",
      position: { x: x - NODE_WIDTH / 2, y: y - h / 2 },
      data: { table: t },
      draggable: true,
    } satisfies TableNodeType;
  });

  const edges: Edge[] = relations.map((r, i) => ({
    id: `${r.from}->${r.to}-${i}`,
    source: r.from,
    target: r.to,
    label: r.label,
    type: "smoothstep",
    animated: false,
    style: { stroke: "#42CA80", strokeOpacity: 0.55, strokeWidth: 1.2 },
    labelStyle: {
      fill: "#C4BCAA",
      fontFamily: "var(--font-jetbrains-mono)",
      fontSize: 10,
    },
    labelBgStyle: { fill: "#0a0a0a" },
    labelBgPadding: [4, 2] as [number, number],
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "#42CA80",
      width: 14,
      height: 14,
    },
  }));

  return { nodes, edges };
}

const NODE_TYPES = { table: TableNode };

export default function SchemaPage() {
  const { nodes, edges } = useMemo(() => layout(TABLES, RELATIONS), []);

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Data Model</h2>
          <p className="mt-1 text-sm text-[#C4BCAA]">
            ERD for the proposed <span className="font-mono text-[#65FFAA]">cp2_*</span> schema.
            Drag tables to rearrange; scroll to zoom.
          </p>
        </div>
        <SubNav />
      </div>

      <ProposalBanner />

      <div className="flex items-center gap-4 font-mono text-xs text-[#C4BCAA]">
        <LegendChip color="#42CA80" label="Dimension" />
        <LegendChip color="#5B8EFF" label="Fact" />
        <LegendChip color="#F5C542" label="Primary key" />
        <LegendChip color="#8EB0FF" label="Foreign key" />
      </div>

      <div className="flex-1 overflow-hidden rounded-xl border border-[#1f1f1f] bg-[#050505]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
          maxZoom={1.8}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          colorMode="dark"
        >
          <Background color="#1f1f1f" gap={24} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => {
              const t = (n.data as { table?: TableSpec } | undefined)?.table;
              return t?.group === "fact" ? "#5B8EFF" : "#42CA80";
            }}
            maskColor="rgba(0,0,0,0.7)"
            style={{ background: "#0a0a0a", border: "1px solid #1f1f1f" }}
          />
          <Controls showInteractive={false} className="!bg-[#0a0a0a] !border-[#1f1f1f]" />
        </ReactFlow>
      </div>
    </div>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
