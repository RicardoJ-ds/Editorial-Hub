export type ColumnKind = "pk" | "fk" | "pk-fk";

export type Column = {
  name: string;
  type: string;
  kind?: ColumnKind;
  nullable?: boolean;
  note?: string;
};

export type TableSpec = {
  id: string;
  name: string;
  group: "dim" | "fact";
  columns: Column[];
};

export type Relation = {
  from: string;
  to: string;
  label: string;
};

export const TABLES: TableSpec[] = [
  {
    id: "cp2_dim_team_member",
    name: "cp2_dim_team_member",
    group: "dim",
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "full_name", type: "string" },
      { name: "email", type: "string" },
      { name: "role_default", type: "enum", note: "SE|ED|WR|AD|PM" },
      { name: "default_monthly_capacity_articles", type: "float" },
      { name: "start_month", type: "date" },
      { name: "end_month", type: "date", nullable: true },
      { name: "is_active", type: "bool" },
      { name: "notes", type: "text" },
    ],
  },
  {
    id: "cp2_dim_pod",
    name: "cp2_dim_pod",
    group: "dim",
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "pod_number", type: "int" },
      { name: "display_name", type: "string" },
      { name: "active_from", type: "date" },
      { name: "active_to", type: "date", nullable: true },
      { name: "notes", type: "text" },
    ],
  },
  {
    id: "cp2_dim_client",
    name: "cp2_dim_client",
    group: "dim",
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "client_id_fk", type: "int", kind: "fk", note: "clients.id" },
      { name: "engagement_tier_id", type: "int", kind: "fk", nullable: true },
      { name: "sow_articles_per_month", type: "int" },
      { name: "contract_start", type: "date" },
      { name: "contract_end", type: "date" },
      { name: "is_active_in_cp2", type: "bool" },
    ],
  },
  {
    id: "cp2_dim_engagement_tier",
    name: "cp2_dim_engagement_tier",
    group: "dim",
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "name", type: "string", note: "Premium|Standard|Custom" },
      { name: "description", type: "text" },
    ],
  },
  {
    id: "cp2_dim_month",
    name: "cp2_dim_month",
    group: "dim",
    columns: [
      { name: "month_key", type: "string", kind: "pk", note: "YYYY-MM" },
      { name: "year", type: "int" },
      { name: "month_num", type: "int" },
      { name: "quarter", type: "string" },
      { name: "is_current", type: "bool" },
      { name: "is_forecast", type: "bool" },
    ],
  },
  {
    id: "cp2_dim_week",
    name: "cp2_dim_week",
    group: "dim",
    columns: [
      { name: "week_key", type: "string", kind: "pk", note: "YYYY-Www" },
      { name: "month_key", type: "string", kind: "fk" },
      { name: "week_start", type: "date" },
      { name: "week_end", type: "date" },
      { name: "iso_year", type: "int" },
      { name: "iso_week", type: "int" },
    ],
  },
  {
    id: "cp2_fact_pod_membership",
    name: "cp2_fact_pod_membership",
    group: "fact",
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "month_key", type: "string", kind: "fk" },
      { name: "pod_id", type: "int", kind: "fk" },
      { name: "team_member_id", type: "int", kind: "fk" },
      { name: "role_in_pod", type: "enum", note: "SE|ED|WR|AD|PM" },
      { name: "capacity_share", type: "float", note: "0.0 – 1.0" },
      { name: "notes", type: "text" },
    ],
  },
  {
    id: "cp2_fact_client_allocation",
    name: "cp2_fact_client_allocation",
    group: "fact",
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "month_key", type: "string", kind: "fk" },
      { name: "pod_id", type: "int", kind: "fk" },
      { name: "client_id", type: "int", kind: "fk" },
      { name: "projected_articles", type: "int" },
      { name: "projected_source", type: "enum", note: "manual|operating_model|sow" },
      { name: "projected_articles_manual", type: "int", nullable: true },
      { name: "notes", type: "text" },
    ],
  },
  {
    id: "cp2_fact_member_leave",
    name: "cp2_fact_member_leave",
    group: "fact",
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "team_member_id", type: "int", kind: "fk" },
      { name: "month_key", type: "string", kind: "fk" },
      { name: "leave_share", type: "float", note: "0.0 – 1.0 of month" },
      { name: "reason", type: "string", note: "PTO|Parental|Sick|Other" },
      { name: "notes", type: "text" },
    ],
  },
  {
    id: "cp2_fact_capacity_override",
    name: "cp2_fact_capacity_override",
    group: "fact",
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "month_key", type: "string", kind: "fk" },
      { name: "team_member_id", type: "int", kind: "fk", nullable: true },
      { name: "pod_id", type: "int", kind: "fk", nullable: true },
      { name: "delta_articles", type: "int", note: "signed" },
      { name: "reason", type: "text" },
      { name: "created_by", type: "string" },
      { name: "created_at", type: "timestamp" },
    ],
  },
  {
    id: "cp2_fact_actuals_weekly",
    name: "cp2_fact_actuals_weekly",
    group: "fact",
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "week_key", type: "string", kind: "fk" },
      { name: "pod_id", type: "int", kind: "fk" },
      { name: "client_id", type: "int", kind: "fk" },
      { name: "delivered_articles", type: "int" },
      { name: "goal_articles", type: "int" },
      { name: "ingested_at", type: "timestamp" },
    ],
  },
];

export const RELATIONS: Relation[] = [
  { from: "cp2_dim_team_member", to: "cp2_fact_pod_membership", label: "assigned to" },
  { from: "cp2_dim_pod", to: "cp2_fact_pod_membership", label: "has members" },
  { from: "cp2_dim_month", to: "cp2_fact_pod_membership", label: "for month" },

  { from: "cp2_dim_pod", to: "cp2_fact_client_allocation", label: "owns clients" },
  { from: "cp2_dim_client", to: "cp2_fact_client_allocation", label: "allocated to pod" },
  { from: "cp2_dim_month", to: "cp2_fact_client_allocation", label: "for month" },

  { from: "cp2_dim_team_member", to: "cp2_fact_member_leave", label: "takes leave" },
  { from: "cp2_dim_month", to: "cp2_fact_member_leave", label: "affects month" },

  { from: "cp2_dim_team_member", to: "cp2_fact_capacity_override", label: "override on" },
  { from: "cp2_dim_pod", to: "cp2_fact_capacity_override", label: "override on" },
  { from: "cp2_dim_month", to: "cp2_fact_capacity_override", label: "for month" },

  { from: "cp2_dim_pod", to: "cp2_fact_actuals_weekly", label: "delivers" },
  { from: "cp2_dim_client", to: "cp2_fact_actuals_weekly", label: "receives" },
  { from: "cp2_dim_week", to: "cp2_fact_actuals_weekly", label: "in week" },

  { from: "cp2_dim_month", to: "cp2_dim_week", label: "contains" },
  { from: "cp2_dim_engagement_tier", to: "cp2_dim_client", label: "tier of" },
];
