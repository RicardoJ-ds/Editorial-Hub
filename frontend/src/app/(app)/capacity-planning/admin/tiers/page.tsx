"use client";

import { StickyPageChrome } from "../../_StickyPageChrome";
import { useCP2Store, type DimEngagementTier } from "../../_store";
import { AdminNav } from "../_AdminNav";
import { AdminTable, type AdminField } from "../_AdminTable";

const FIELDS: AdminField<DimEngagementTier>[] = [
  { key: "name", label: "Name", type: "text", required: true },
  { key: "description", label: "Description", type: "text" },
];

const EMPTY: Omit<DimEngagementTier, "id"> = { name: "", description: "" };

export default function TiersAdmin() {
  const { dims, addDimRow, updateDimRow, deleteDimRow } = useCP2Store();
  return (
    <div className="flex flex-col gap-6">
      <StickyPageChrome subtitle="Engagement tiers. Used to group clients by service level — Premium / Standard / Custom." />
      <AdminNav />
      <AdminTable<DimEngagementTier>
        title="Engagement tiers"
        description="cp2_dim_engagement_tier — reference lookup."
        rows={dims.tiers}
        fields={FIELDS}
        newRowTemplate={EMPTY}
        onAdd={(row) => addDimRow("tiers", row)}
        onUpdate={(row) => updateDimRow("tiers", row)}
        onDelete={(id) => deleteDimRow("tiers", id)}
      />
    </div>
  );
}
