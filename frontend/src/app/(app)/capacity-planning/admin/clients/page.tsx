"use client";

import { useMemo } from "react";
import { ProposalBanner } from "../../_ProposalBanner";
import { SubNav } from "../../_SubNav";
import { useCP2Store, type DimClient } from "../../_store";
import { AdminNav } from "../_AdminNav";
import { AdminTable, type AdminField } from "../_AdminTable";

const EMPTY: Omit<DimClient, "id"> = {
  client_id_fk: 0,
  engagement_tier_id: null,
  cadence: "monthly",
  sow_articles_total: 0,
  sow_articles_per_month: 0,
  contract_start: new Date().toISOString().slice(0, 10),
  contract_end: new Date().toISOString().slice(0, 10),
  is_active_in_cp2: true,
};

export default function ClientsAdmin() {
  const { dims, addDimRow, updateDimRow, deleteDimRow } = useCP2Store();

  const fields = useMemo<AdminField<DimClient>[]>(() => {
    const tierOptions = [
      { value: "", label: "— none —" },
      ...dims.tiers.map((t) => ({ value: t.id, label: t.name })),
    ];
    return [
      { key: "client_id_fk", label: "FK → clients.id", type: "number" },
      {
        key: "engagement_tier_id",
        label: "Tier",
        type: "select",
        options: tierOptions,
      },
      {
        key: "cadence",
        label: "Cadence",
        type: "select",
        options: [
          { value: "monthly", label: "monthly" },
          { value: "quarterly", label: "quarterly" },
          { value: "custom", label: "custom" },
        ],
      },
      { key: "sow_articles_total", label: "SOW total", type: "number" },
      { key: "sow_articles_per_month", label: "Per mo", type: "number" },
      { key: "contract_start", label: "Start", type: "date" },
      { key: "contract_end", label: "End", type: "date" },
      { key: "is_active_in_cp2", label: "Active", type: "bool" },
    ];
  }, [dims.tiers]);

  return (
    <div className="flex flex-col gap-6">
      <ProposalBanner subtitle="CP v2 client extensions — contract window, SOW cadence, engagement tier. client_id_fk points to the existing clients.id." />
      <SubNav />
      <AdminNav />
      <AdminTable<DimClient>
        title="Clients (cp2)"
        description="cp2_dim_client — thin CP2 projection of clients with SOW + cadence + tier."
        rows={dims.clients}
        fields={fields}
        newRowTemplate={EMPTY}
        onAdd={(row) => addDimRow("clients", row)}
        onUpdate={(row) => updateDimRow("clients", row)}
        onDelete={(id) => deleteDimRow("clients", id)}
      />
    </div>
  );
}
