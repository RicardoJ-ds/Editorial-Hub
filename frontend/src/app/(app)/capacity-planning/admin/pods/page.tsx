"use client";

import { StickyPageChrome } from "../../_StickyPageChrome";
import { useCP2Store, type DimPod } from "../../_store";
import { AdminNav } from "../_AdminNav";
import { AdminTable, type AdminField } from "../_AdminTable";

const FIELDS: AdminField<DimPod>[] = [
  { key: "pod_number", label: "#", type: "number" },
  { key: "display_name", label: "Display name", type: "text", required: true },
  { key: "active_from", label: "Active from", type: "date" },
  { key: "active_to", label: "Active to", type: "date" },
  { key: "notes", label: "Notes", type: "text" },
];

const EMPTY: Omit<DimPod, "id"> = {
  pod_number: 0,
  display_name: "",
  active_from: new Date().toISOString().slice(0, 10),
  active_to: null,
  notes: "",
};

export default function PodsAdmin() {
  const { dims, addDimRow, updateDimRow, deleteDimRow } = useCP2Store();
  return (
    <div className="flex flex-col gap-6">
      <StickyPageChrome subtitle="Pod catalog. active_to lets you retire a pod without deleting history." />
      <AdminNav />
      <AdminTable<DimPod>
        title="Pods"
        description="cp2_dim_pod — the unit that owns clients and members for a month."
        rows={dims.pods}
        fields={FIELDS}
        newRowTemplate={EMPTY}
        onAdd={(row) => addDimRow("pods", row)}
        onUpdate={(row) => updateDimRow("pods", row)}
        onDelete={(id) => deleteDimRow("pods", id)}
      />
    </div>
  );
}
