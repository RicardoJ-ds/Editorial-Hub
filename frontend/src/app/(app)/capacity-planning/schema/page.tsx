"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Maximize2, Minimize2, X } from "lucide-react";

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
  g.setGraph({
    rankdir: "LR",
    nodesep: 120,
    ranksep: 340,
    edgesep: 80,
    ranker: "network-simplex",
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const t of tables) {
    g.setNode(t.id, { width: NODE_WIDTH, height: estimateHeight(t) });
  }
  for (const r of relations) {
    // minlen=2 forces edges to span more of a gap, giving dagre room to route
    // labels without clipping other nodes.
    g.setEdge(r.from, r.to, { minlen: 2, weight: 1 });
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
    type: "bezier",
    animated: false,
    style: { stroke: "#42CA80", strokeOpacity: 0.5, strokeWidth: 1.1 },
    labelStyle: {
      fill: "#C4BCAA",
      fontFamily: "var(--font-jetbrains-mono)",
      fontSize: 10,
    },
    labelBgStyle: {
      fill: "#0a0a0a",
      fillOpacity: 0.95,
      stroke: "#1f1f1f",
      strokeWidth: 1,
    },
    labelBgPadding: [6, 3] as [number, number],
    labelBgBorderRadius: 3,
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

/** Lookup every column on `tableId` that is marked as a connector key:
 *  `pk`, `pk-fk`, or `fk`. Used to emphasize the join surface when a
 *  neighbor of the selected table is highlighted. */
function connectorColumns(tableId: string): Set<string> {
  const table = TABLES.find((t) => t.id === tableId);
  if (!table) return new Set();
  return new Set(
    table.columns
      .filter((c) => c.kind === "pk" || c.kind === "pk-fk" || c.kind === "fk")
      .map((c) => c.name),
  );
}

export default function SchemaPage() {
  const base = useMemo(() => layout(TABLES, RELATIONS), []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Sync fullscreen flag with browser state (Esc, F11, programmatic exits)
  useEffect(() => {
    function onChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = canvasRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await el.requestFullscreen();
    }
  }, []);

  const neighborIds = useMemo(() => {
    if (!selectedId) return new Set<string>();
    const set = new Set<string>();
    for (const r of RELATIONS) {
      if (r.from === selectedId) set.add(r.to);
      else if (r.to === selectedId) set.add(r.from);
    }
    return set;
  }, [selectedId]);

  // Apply highlight state to each node based on current selection
  const nodes = useMemo<Node[]>(() => {
    return base.nodes.map((n) => {
      const tableData = (n.data as { table: TableSpec }).table;
      let state: "idle" | "selected" | "neighbor" | "dim" = "idle";
      let highlightCols: Set<string> | undefined;
      if (selectedId) {
        if (n.id === selectedId) {
          state = "selected";
          highlightCols = connectorColumns(n.id);
        } else if (neighborIds.has(n.id)) {
          state = "neighbor";
          highlightCols = connectorColumns(n.id);
        } else {
          state = "dim";
        }
      }
      return {
        ...n,
        type: "table",
        selected: n.id === selectedId,
        data: { table: tableData, state, highlightCols },
      } as TableNodeType;
    });
  }, [base.nodes, selectedId, neighborIds]);

  // Re-style edges based on selection
  const edges = useMemo<Edge[]>(() => {
    return base.edges.map((e) => {
      const touchesSelection =
        !!selectedId && (e.source === selectedId || e.target === selectedId);
      const anySelection = !!selectedId;
      const stroke = touchesSelection ? "#F5C542" : "#42CA80";
      const strokeOpacity = !anySelection ? 0.5 : touchesSelection ? 0.95 : 0.08;
      const strokeWidth = touchesSelection ? 1.8 : 1.1;
      return {
        ...e,
        animated: touchesSelection,
        style: { ...(e.style ?? {}), stroke, strokeOpacity, strokeWidth },
        labelStyle: {
          ...(e.labelStyle ?? {}),
          fill: touchesSelection ? "#F5C542" : "#C4BCAA",
          opacity: !anySelection ? 1 : touchesSelection ? 1 : 0.25,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: touchesSelection ? "#F5C542" : "#42CA80",
          width: 14,
          height: 14,
        },
      };
    });
  }, [base.edges, selectedId]);

  const selectedTable = selectedId ? TABLES.find((t) => t.id === selectedId) : undefined;

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Data Model</h2>
          <p className="mt-1 text-sm text-[#C4BCAA]">
            ERD for the proposed <span className="font-mono text-[#65FFAA]">cp2_*</span> schema.
            Click a table to highlight its connections. Drag to rearrange; scroll to zoom.
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

      <div
        ref={canvasRef}
        className={`relative flex-1 overflow-hidden rounded-xl border border-[#1f1f1f] bg-[#050505] ${
          isFullscreen ? "!h-screen !w-screen !rounded-none" : ""
        }`}
      >
        {/* Top-right overlay: selection info + fullscreen toggle */}
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2 font-mono text-[11px]">
          {selectedTable && (
            <div className="flex items-center gap-2 rounded-md border border-[#F5C542]/40 bg-[#0a0a0a]/95 px-3 py-1.5 text-[#F5C542] shadow-lg">
              <span className="uppercase tracking-wider text-[9px] text-[#F5C542]/70">Selected</span>
              <span>{selectedTable.name}</span>
              <span className="text-[9px] text-[#606060]">{neighborIds.size} linked</span>
              <button
                onClick={() => setSelectedId(null)}
                className="ml-1 text-[#606060] hover:text-[#F5C542]"
                aria-label="Clear selection"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          <button
            onClick={toggleFullscreen}
            className="flex items-center gap-1.5 rounded-md border border-[#1f1f1f] bg-[#0a0a0a]/95 px-2.5 py-1.5 text-[#C4BCAA] shadow-lg hover:border-[#42CA80]/50 hover:text-white transition-colors"
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            <span>{isFullscreen ? "Exit fullscreen" : "Fullscreen"}</span>
          </button>
        </div>

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
          onNodeClick={(_, node) => {
            setSelectedId((prev) => (prev === node.id ? null : node.id));
          }}
          onPaneClick={() => setSelectedId(null)}
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
