"use client";

import { useMemo } from "react";
import { StickyPageChrome } from "../../_StickyPageChrome";
import { useCP2Store, type DimClient } from "../../_store";
import { AdminNav } from "../_AdminNav";
import { AdminTable, type AdminField } from "../_AdminTable";

const EMPTY: Omit<DimClient, "id"> = {
  client_id_fk: 0,
  name: "",
  domain: null,
  status: "SOON_TO_BE_ACTIVE",
  growth_pod: null,
  editorial_pod: null,
  engagement_tier_id: null,
  project_type: null,
  cadence: "monthly",
  cadence_q1: null,
  cadence_q2: null,
  cadence_q3: null,
  cadence_q4: null,
  term_months: null,
  sow_articles_total: 0,
  sow_articles_per_month: 0,
  word_count_min: null,
  word_count_max: null,
  sow_link: null,
  contract_start: new Date().toISOString().slice(0, 10),
  contract_end: new Date().toISOString().slice(0, 10),
  consulting_ko_date: null,
  editorial_ko_date: null,
  first_cb_approved_date: null,
  first_article_delivered_date: null,
  first_feedback_date: null,
  first_article_published_date: null,
  managing_director: null,
  account_director: null,
  account_manager: null,
  jr_am: null,
  cs_team: null,
  articles_delivered: 0,
  articles_invoiced: 0,
  articles_paid: 0,
  is_active_in_cp2: true,
  comments: null,
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
      <StickyPageChrome subtitle="CP v2 client extensions — contract window, SOW cadence, engagement tier. client_id_fk points to the existing clients.id." />
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
