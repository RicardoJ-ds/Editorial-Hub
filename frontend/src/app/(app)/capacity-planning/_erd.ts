export type ColumnKind = "pk" | "fk" | "pk-fk";

export type Column = {
  name: string;
  type: string;
  kind?: ColumnKind;
  nullable?: boolean;
  note?: string;
};

export type TableGroup = "dim" | "fact";

export type TableSpec = {
  id: string;
  name: string;
  group: TableGroup;
  domain:
    | "capacity"
    | "kpi"
    | "delivery"
    | "pipeline"
    | "ai"
    | "reference";
  description: string;
  columns: Column[];
};

export type Relation = {
  from: string;
  to: string;
  label: string;
};

export const TABLES: TableSpec[] = [
  // ---------- Capacity domain (existing) ----------
  {
    id: "cp2_dim_team_member",
    name: "cp2_dim_team_member",
    group: "dim",
    domain: "capacity",
    description: "Editorial team roster — identity, role, baseline capacity.",
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
    domain: "capacity",
    description: "Pods — the unit that owns clients and members for a month.",
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
    domain: "reference",
    description: "Clients under editorial SOW — contract dates, cadence, SOW totals.",
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "client_id_fk", type: "int", kind: "fk", note: "clients.id" },
      { name: "engagement_tier_id", type: "int", kind: "fk", nullable: true },
      { name: "cadence", type: "enum", note: "quarterly|monthly|custom" },
      { name: "sow_articles_total", type: "int" },
      { name: "sow_articles_per_month", type: "int" },
      { name: "contract_start", type: "date" },
      { name: "contract_end", type: "date" },
      { name: "first_cb_approved_date", type: "date", nullable: true },
      { name: "first_article_delivered_date", type: "date", nullable: true },
      { name: "first_article_published_date", type: "date", nullable: true },
      { name: "is_active_in_cp2", type: "bool" },
    ],
  },
  {
    id: "cp2_dim_engagement_tier",
    name: "cp2_dim_engagement_tier",
    group: "dim",
    domain: "reference",
    description: "Engagement tiers — pricing and service-level labels.",
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
    domain: "reference",
    description: "Month calendar — the planning grain for capacity and KPIs.",
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
    domain: "reference",
    description: "ISO weeks — the measurement grain for actuals and goals.",
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
    domain: "capacity",
    description: "Per-month assignment of a member to a pod with a capacity share.",
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
    domain: "capacity",
    description: "Per-month client → pod allocation with projected article count.",
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
    domain: "capacity",
    description: "PTO / leave per member for a month, as a fraction of working time.",
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
    domain: "capacity",
    description: "Manual corrections to effective capacity at member or pod level.",
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
    domain: "delivery",
    description: "Weekly delivered vs goal — rolls up to month for dashboards.",
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

  // ---------- KPI domain ----------
  {
    id: "cp2_dim_kpi_metric",
    name: "cp2_dim_kpi_metric",
    group: "dim",
    domain: "kpi",
    description: "Catalog of every KPI — display name, unit, target, direction.",
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "metric_key", type: "string", note: "e.g. internal_quality" },
      { name: "display_name", type: "string" },
      { name: "unit", type: "enum", note: "percent|score|days|count" },
      { name: "target_value", type: "float" },
      { name: "direction", type: "enum", note: "higher_is_better|lower_is_better|band" },
      { name: "formula", type: "text", note: "human-readable definition" },
      { name: "applies_to_roles", type: "string", note: "CSV: SE,ED,WR" },
    ],
  },
  {
    id: "cp2_fact_kpi_score",
    name: "cp2_fact_kpi_score",
    group: "fact",
    domain: "kpi",
    description: "Monthly KPI score per team member × metric (quality, mentorship, etc.).",
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "month_key", type: "string", kind: "fk" },
      { name: "team_member_id", type: "int", kind: "fk" },
      { name: "metric_id", type: "int", kind: "fk" },
      { name: "score", type: "float", nullable: true },
      { name: "target_snapshot", type: "float", note: "target at time of entry" },
      { name: "source", type: "enum", note: "manual|notion|ai_scan|capacity" },
      { name: "entered_by", type: "string", nullable: true },
      { name: "entered_at", type: "timestamp" },
      { name: "notes", type: "text" },
    ],
  },

  // ---------- Article + AI (drives Revision Rate, Turnaround, Second Reviews, AI Compliance) ----------
  {
    id: "cp2_fact_article",
    name: "cp2_fact_article",
    group: "fact",
    domain: "kpi",
    description: "Article-level workflow tracking — powers Revision Rate, Turnaround, Second Reviews.",
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "notion_case_id", type: "string", note: "FK to notion_articles.case_id" },
      { name: "client_id", type: "int", kind: "fk" },
      { name: "pod_id", type: "int", kind: "fk", nullable: true },
      { name: "writer_id", type: "int", kind: "fk", nullable: true },
      { name: "editor_id", type: "int", kind: "fk", nullable: true },
      { name: "sr_editor_id", type: "int", kind: "fk", nullable: true },
      { name: "month_key", type: "string", kind: "fk", note: "bucket for KPI rollups" },
      { name: "cb_approved_date", type: "date", nullable: true },
      { name: "delivered_date", type: "date", nullable: true },
      { name: "published_date", type: "date", nullable: true },
      { name: "turnaround_days", type: "int", nullable: true, note: "derived" },
      { name: "revision_count", type: "int" },
      { name: "had_second_review", type: "bool" },
      { name: "status", type: "enum", note: "drafting|review|delivered|published|killed" },
    ],
  },
  {
    id: "cp2_fact_ai_scan",
    name: "cp2_fact_ai_scan",
    group: "fact",
    domain: "ai",
    description: "AI-detection scans per article — powers the AI Compliance KPI.",
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "article_id", type: "int", kind: "fk" },
      { name: "client_id", type: "int", kind: "fk" },
      { name: "pod_id", type: "int", kind: "fk", nullable: true },
      { name: "month_key", type: "string", kind: "fk" },
      { name: "scanned_at", type: "timestamp" },
      { name: "surfer_v1_score", type: "float", nullable: true },
      { name: "surfer_v2_score", type: "float", nullable: true },
      { name: "recommendation", type: "enum", note: "FULL_PASS|PARTIAL_PASS|REVIEW_REWRITE" },
      { name: "is_rewrite", type: "bool" },
      { name: "is_flagged", type: "bool" },
      { name: "notes", type: "text" },
    ],
  },

  // ---------- Delivery (invoicing + pipeline) ----------
  {
    id: "cp2_fact_delivery_monthly",
    name: "cp2_fact_delivery_monthly",
    group: "fact",
    domain: "delivery",
    description: "Monthly delivered vs invoiced per client — feeds Delivery Overview + Client Delivery Matrix.",
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "month_key", type: "string", kind: "fk" },
      { name: "client_id", type: "int", kind: "fk" },
      { name: "articles_delivered", type: "int" },
      { name: "articles_invoiced", type: "int" },
      { name: "variance", type: "int", note: "delivered - invoiced" },
      { name: "cumulative_delivered", type: "int" },
      { name: "cumulative_invoiced", type: "int" },
      { name: "source", type: "enum", note: "manual|operating_model|sheet_import" },
    ],
  },
  {
    id: "cp2_fact_pipeline_snapshot",
    name: "cp2_fact_pipeline_snapshot",
    group: "fact",
    domain: "pipeline",
    description: "All-time cumulative pipeline per client — feeds the Cumulative Pipeline section.",
    columns: [
      { name: "id", type: "int", kind: "pk" },
      { name: "snapshot_date", type: "date" },
      { name: "client_id", type: "int", kind: "fk" },
      { name: "topics_submitted", type: "int" },
      { name: "cbs_approved", type: "int" },
      { name: "articles_delivered", type: "int" },
      { name: "articles_published", type: "int" },
      { name: "articles_killed", type: "int" },
    ],
  },
];

export const RELATIONS: Relation[] = [
  // capacity
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

  // delivery
  { from: "cp2_dim_pod", to: "cp2_fact_actuals_weekly", label: "delivers" },
  { from: "cp2_dim_client", to: "cp2_fact_actuals_weekly", label: "receives" },
  { from: "cp2_dim_week", to: "cp2_fact_actuals_weekly", label: "in week" },
  { from: "cp2_dim_month", to: "cp2_fact_delivery_monthly", label: "in month" },
  { from: "cp2_dim_client", to: "cp2_fact_delivery_monthly", label: "for client" },

  // kpi
  { from: "cp2_dim_kpi_metric", to: "cp2_fact_kpi_score", label: "measures" },
  { from: "cp2_dim_team_member", to: "cp2_fact_kpi_score", label: "scored for" },
  { from: "cp2_dim_month", to: "cp2_fact_kpi_score", label: "for month" },

  // article + AI
  { from: "cp2_dim_client", to: "cp2_fact_article", label: "article for" },
  { from: "cp2_dim_pod", to: "cp2_fact_article", label: "produced by pod" },
  { from: "cp2_dim_team_member", to: "cp2_fact_article", label: "writer/editor" },
  { from: "cp2_dim_month", to: "cp2_fact_article", label: "delivered in" },
  { from: "cp2_fact_article", to: "cp2_fact_ai_scan", label: "scanned" },
  { from: "cp2_dim_client", to: "cp2_fact_ai_scan", label: "article for" },
  { from: "cp2_dim_month", to: "cp2_fact_ai_scan", label: "in month" },

  // pipeline
  { from: "cp2_dim_client", to: "cp2_fact_pipeline_snapshot", label: "pipeline for" },

  // reference
  { from: "cp2_dim_month", to: "cp2_dim_week", label: "contains" },
  { from: "cp2_dim_engagement_tier", to: "cp2_dim_client", label: "tier of" },
];

// ---------------------------------------------------------------------------
// KPI glossary — maps current dashboards to ERD columns + formula
// ---------------------------------------------------------------------------

export type KpiMapping = {
  metric_key: string;
  display_name: string;
  dashboard: "team-kpis" | "editorial-clients";
  unit: string;
  target: string;
  direction: "higher_is_better" | "lower_is_better" | "band";
  currentSource: string;
  erdTable: string;
  erdColumns: string[];
  formula: string;
  notes?: string;
};

export const KPI_GLOSSARY: KpiMapping[] = [
  {
    metric_key: "internal_quality",
    display_name: "Internal Quality",
    dashboard: "team-kpis",
    unit: "score 0–100",
    target: "≥85",
    direction: "higher_is_better",
    currentSource: "Monthly KPI Scores (Google Sheet)",
    erdTable: "cp2_fact_kpi_score",
    erdColumns: ["score", "metric_id=internal_quality"],
    formula: "Manual monthly score entered by SE, per editor.",
  },
  {
    metric_key: "external_quality",
    display_name: "External Quality",
    dashboard: "team-kpis",
    unit: "score 0–100",
    target: "≥85",
    direction: "higher_is_better",
    currentSource: "Monthly KPI Scores (Google Sheet)",
    erdTable: "cp2_fact_kpi_score",
    erdColumns: ["score", "metric_id=external_quality"],
    formula: "Client satisfaction score from post-delivery feedback.",
  },
  {
    metric_key: "mentorship",
    display_name: "Mentorship",
    dashboard: "team-kpis",
    unit: "score 0–100",
    target: "≥80",
    direction: "higher_is_better",
    currentSource: "Monthly KPI Scores (Google Sheet)",
    erdTable: "cp2_fact_kpi_score",
    erdColumns: ["score", "metric_id=mentorship"],
    formula: "Effectiveness of mentorship from Editor feedback.",
  },
  {
    metric_key: "feedback_adoption",
    display_name: "Feedback Adoption",
    dashboard: "team-kpis",
    unit: "score 0–100",
    target: "≥80",
    direction: "higher_is_better",
    currentSource: "Monthly KPI Scores (Google Sheet)",
    erdTable: "cp2_fact_kpi_score",
    erdColumns: ["score", "metric_id=feedback_adoption"],
    formula: "Rate of incorporating editorial feedback into subsequent articles.",
  },
  {
    metric_key: "revision_rate",
    display_name: "Revision Rate",
    dashboard: "team-kpis",
    unit: "percent",
    target: "≤15%",
    direction: "lower_is_better",
    currentSource: "Notion Database",
    erdTable: "cp2_fact_article",
    erdColumns: ["revision_count", "status"],
    formula:
      "articles_with_revision / articles_delivered per month × 100, aggregated to member via writer_id/editor_id.",
  },
  {
    metric_key: "turnaround_time",
    display_name: "Turnaround Time",
    dashboard: "team-kpis",
    unit: "days",
    target: "≤14",
    direction: "lower_is_better",
    currentSource: "Notion Database",
    erdTable: "cp2_fact_article",
    erdColumns: ["cb_approved_date", "delivered_date", "turnaround_days"],
    formula: "avg(delivered_date - cb_approved_date) over articles in the month.",
  },
  {
    metric_key: "second_reviews",
    display_name: "Second Reviews",
    dashboard: "team-kpis",
    unit: "count / month",
    target: "≥5",
    direction: "higher_is_better",
    currentSource: "Notion Database",
    erdTable: "cp2_fact_article",
    erdColumns: ["had_second_review", "sr_editor_id"],
    formula: "count(articles where had_second_review = true) grouped by sr_editor, month.",
  },
  {
    metric_key: "ai_compliance",
    display_name: "AI Compliance",
    dashboard: "team-kpis",
    unit: "percent",
    target: "≥95%",
    direction: "higher_is_better",
    currentSource: "Writer AI Monitoring 2.0 sheet",
    erdTable: "cp2_fact_ai_scan",
    erdColumns: ["recommendation", "is_flagged"],
    formula: "count(recommendation = FULL_PASS) / count(*) per month × 100.",
  },
  {
    metric_key: "capacity_utilization",
    display_name: "Capacity Utilization",
    dashboard: "team-kpis",
    unit: "percent",
    target: "80–85% (band)",
    direction: "band",
    currentSource: "ET CP 2026 capacity_projections",
    erdTable: "cp2_v_pod_monthly (view)",
    erdColumns: ["projected_use", "total_capacity"],
    formula: "projected_use / total_capacity × 100; view joins allocation + membership + leave + override.",
  },
  {
    metric_key: "articles_delivered_monthly",
    display_name: "Articles Delivered (monthly)",
    dashboard: "editorial-clients",
    unit: "count",
    target: "= SOW articles/month",
    direction: "band",
    currentSource: "Delivered vs Invoiced v2",
    erdTable: "cp2_fact_delivery_monthly",
    erdColumns: ["articles_delivered"],
    formula: "Monthly sum; compared to cp2_dim_client.sow_articles_per_month.",
  },
  {
    metric_key: "articles_invoiced_monthly",
    display_name: "Articles Invoiced (monthly)",
    dashboard: "editorial-clients",
    unit: "count",
    target: "≈ delivered",
    direction: "band",
    currentSource: "Delivered vs Invoiced v2",
    erdTable: "cp2_fact_delivery_monthly",
    erdColumns: ["articles_invoiced", "variance"],
    formula: "Monthly sum; variance = delivered - invoiced.",
  },
  {
    metric_key: "goals_weekly",
    display_name: "Weekly Goals vs Delivery",
    dashboard: "editorial-clients",
    unit: "count / week",
    target: "meet weekly goal",
    direction: "higher_is_better",
    currentSource: "Master Tracker Goals vs Delivery",
    erdTable: "cp2_fact_actuals_weekly",
    erdColumns: ["goal_articles", "delivered_articles"],
    formula: "Per client × pod × week; rolled up to month for display.",
  },
  {
    metric_key: "cumulative_pipeline",
    display_name: "Cumulative Pipeline",
    dashboard: "editorial-clients",
    unit: "count",
    target: "monotonically increasing",
    direction: "higher_is_better",
    currentSource: "Master Tracker Cumulative",
    erdTable: "cp2_fact_pipeline_snapshot",
    erdColumns: [
      "topics_submitted",
      "cbs_approved",
      "articles_delivered",
      "articles_published",
    ],
    formula: "Latest snapshot per client; snapshots stored daily/weekly for trend lines.",
  },
  {
    metric_key: "client_timeline",
    display_name: "Client Engagement Timeline",
    dashboard: "editorial-clients",
    unit: "date range",
    target: "n/a",
    direction: "band",
    currentSource: "Editorial SOW overview",
    erdTable: "cp2_dim_client",
    erdColumns: ["contract_start", "contract_end", "cadence", "sow_articles_total"],
    formula: "Pure dim lookup — no aggregation.",
  },
];
