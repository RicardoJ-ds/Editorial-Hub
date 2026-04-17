"use client";

import { StickyPageChrome } from "../../_StickyPageChrome";
import { useCP2Store, type DimMember } from "../../_store";
import { AdminNav } from "../_AdminNav";
import { AdminTable, type AdminField } from "../_AdminTable";

const FIELDS: AdminField<DimMember>[] = [
  { key: "full_name", label: "Full name", type: "text", required: true },
  { key: "email", label: "Email", type: "email" },
  {
    key: "role_default",
    label: "Role",
    type: "select",
    options: [
      { value: "SE", label: "SE" },
      { value: "ED", label: "ED" },
      { value: "WR", label: "WR" },
      { value: "AD", label: "AD" },
      { value: "PM", label: "PM" },
    ],
  },
  { key: "default_monthly_capacity_articles", label: "Cap/mo", type: "number" },
  { key: "start_month", label: "Start", type: "date" },
  { key: "end_month", label: "End", type: "date" },
  { key: "is_active", label: "Active", type: "bool" },
  { key: "notes", label: "Notes", type: "text" },
];

const EMPTY: Omit<DimMember, "id"> = {
  full_name: "",
  email: "",
  role_default: "ED",
  default_monthly_capacity_articles: 10,
  start_month: new Date().toISOString().slice(0, 10),
  end_month: null,
  is_active: true,
  notes: "",
};

export default function MembersAdmin() {
  const { dims, addDimRow, updateDimRow, deleteDimRow } = useCP2Store();
  return (
    <div className="flex flex-col gap-6">
      <StickyPageChrome subtitle="Team roster CRUD. Start/end month controls who appears on the roster matrix and the KPI cards." />
      <AdminNav />
      <AdminTable<DimMember>
        title="Members"
        description="cp2_dim_team_member — one row per editor / writer / SE / PM across all pods."
        rows={dims.members}
        fields={FIELDS}
        newRowTemplate={EMPTY}
        onAdd={(row) => addDimRow("members", row)}
        onUpdate={(row) => updateDimRow("members", row)}
        onDelete={(id) => deleteDimRow("members", id)}
      />
    </div>
  );
}
