"use client";

import { StickyPageChrome } from "../../_StickyPageChrome";
import { useCP2Store, type DimKpiMetric } from "../../_store";
import { AdminNav } from "../_AdminNav";
import { AdminTable, type AdminField } from "../_AdminTable";

const FIELDS: AdminField<DimKpiMetric>[] = [
  { key: "metric_key", label: "Key", type: "text", required: true },
  { key: "display_name", label: "Display name", type: "text", required: true },
  {
    key: "unit",
    label: "Unit",
    type: "select",
    options: [
      { value: "percent", label: "percent" },
      { value: "score", label: "score" },
      { value: "days", label: "days" },
      { value: "count", label: "count" },
    ],
  },
  { key: "target_value", label: "Target", type: "number" },
  {
    key: "direction",
    label: "Direction",
    type: "select",
    options: [
      { value: "higher_is_better", label: "↑ higher" },
      { value: "lower_is_better", label: "↓ lower" },
      { value: "band", label: "↔ band" },
    ],
  },
  { key: "applies_to_roles", label: "Roles", type: "text" },
  { key: "formula", label: "Formula", type: "text" },
];

const EMPTY: Omit<DimKpiMetric, "id"> = {
  metric_key: "",
  display_name: "",
  unit: "score",
  target_value: 0,
  direction: "higher_is_better",
  formula: "",
  applies_to_roles: "",
};

export default function MetricsAdmin() {
  const { dims, addDimRow, updateDimRow, deleteDimRow } = useCP2Store();
  return (
    <div className="flex flex-col gap-6">
      <StickyPageChrome subtitle="KPI catalog. Each row here becomes a column of cp2_fact_kpi_score via metric_id. Edits to targets are audit-logged in production." />
      <AdminNav />
      <AdminTable<DimKpiMetric>
        title="KPI metrics"
        description="cp2_dim_kpi_metric — one row per KPI the dashboards display."
        rows={dims.metrics}
        fields={FIELDS}
        newRowTemplate={EMPTY}
        onAdd={(row) => addDimRow("metrics", row)}
        onUpdate={(row) => updateDimRow("metrics", row)}
        onDelete={(id) => deleteDimRow("metrics", id)}
      />
    </div>
  );
}
