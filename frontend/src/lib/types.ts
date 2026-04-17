// Client
export interface Client {
  id: number;
  name: string;
  domain: string | null;
  status: string;
  growth_pod: string | null;
  editorial_pod: string | null;
  start_date: string | null;
  end_date: string | null;
  term_months: number | null;
  cadence: string | null;
  cadence_q1: number | null;
  cadence_q2: number | null;
  cadence_q3: number | null;
  cadence_q4: number | null;
  articles_sow: number | null;
  articles_delivered: number | null;
  articles_invoiced: number | null;
  articles_paid: number | null;
  word_count_min: number | null;
  word_count_max: number | null;
  sow_link: string | null;
  project_type: string | null;
  consulting_ko_date: string | null;
  editorial_ko_date: string | null;
  first_cb_approved_date: string | null;
  first_article_delivered_date: string | null;
  first_feedback_date: string | null;
  first_article_published_date: string | null;
  managing_director: string | null;
  account_director: string | null;
  account_manager: string | null;
  jr_am: string | null;
  cs_team: string | null;
  comments: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface ClientCreate {
  name: string;
  domain?: string;
  status?: string;
  growth_pod?: string;
  editorial_pod?: string;
  start_date?: string;
  end_date?: string;
  term_months?: number;
  cadence?: string;
  cadence_q1?: number;
  cadence_q2?: number;
  cadence_q3?: number;
  cadence_q4?: number;
  articles_sow?: number;
  articles_delivered?: number;
  articles_invoiced?: number;
  articles_paid?: number;
  word_count_min?: number;
  word_count_max?: number;
  sow_link?: string;
  project_type?: string;
  consulting_ko_date?: string;
  editorial_ko_date?: string;
  first_cb_approved_date?: string;
  first_article_delivered_date?: string;
  first_feedback_date?: string;
  first_article_published_date?: string;
  managing_director?: string;
  account_director?: string;
  account_manager?: string;
  jr_am?: string;
  cs_team?: string;
  comments?: string;
}

export type ClientUpdate = Partial<ClientCreate>;

// Deliverable Monthly
export interface DeliverableMonthly {
  id: number;
  client_id: number;
  year: number;
  month: number;
  articles_sow_target: number | null;
  articles_delivered: number | null;
  articles_invoiced: number | null;
  variance: number | null;
  content_briefs_delivered: number | null;
  content_briefs_goal: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeliverableCreate {
  client_id: number;
  year: number;
  month: number;
  articles_sow_target?: number;
  articles_delivered?: number;
  articles_invoiced?: number;
  variance?: number;
  content_briefs_delivered?: number;
  content_briefs_goal?: number;
  notes?: string;
}

export interface DeliverableUpdate {
  articles_sow_target?: number;
  articles_delivered?: number;
  articles_invoiced?: number;
  content_briefs_delivered?: number;
  content_briefs_goal?: number;
  notes?: string;
}

// Team Member
export interface TeamMember {
  id: number;
  name: string;
  role: string;
  pod: string | null;
  is_active: boolean;
  monthly_capacity: number | null;
  email: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamMemberCreate {
  name: string;
  role: string;
  pod?: string;
  is_active?: boolean;
  monthly_capacity?: number;
  email?: string;
}

// Capacity Projection
export interface CapacityProjection {
  id: number;
  pod: string;
  year: number;
  month: number;
  total_capacity: number | null;
  projected_used_capacity: number | null;
  actual_used_capacity: number | null;
  version: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CapacityCreate {
  pod: string;
  year: number;
  month: number;
  total_capacity?: number;
  projected_used_capacity?: number;
  actual_used_capacity?: number;
  version?: string;
  notes?: string;
}

export interface CapacityUpdate {
  total_capacity?: number;
  projected_used_capacity?: number;
  actual_used_capacity?: number;
  version?: string;
  notes?: string;
}

// KPI Score
export interface KpiScore {
  id: number;
  team_member_id: number;
  year: number;
  month: number;
  kpi_type: string;
  score: number | null;
  target: number | null;
  client_id: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface KpiScoreCreate {
  team_member_id: number;
  year: number;
  month: number;
  kpi_type: string;
  score?: number;
  target?: number;
  client_id?: number;
  notes?: string;
}

export interface KpiScoreUpdate {
  score?: number;
  target?: number;
  notes?: string;
}

// Dashboard
export interface DashboardSummary {
  total_active_clients: number;
  total_articles_sow: number;
  total_articles_delivered: number;
  total_articles_invoiced: number;
  avg_time_to_first_article_days: number | null;
}

export interface TimeToMetric {
  client_name: string;
  ko_to_first_cb_days: number | null;
  ko_to_first_article_days: number | null;
  ko_to_first_feedback_days: number | null;
  ko_to_first_published_days: number | null;
  cb_to_first_article_days: number | null;
}

export interface CapacitySummary {
  pod: string;
  month: number;
  year: number;
  total_capacity: number;
  projected_used: number;
  actual_used: number | null;
  utilization_pct: number;
  status: string;
}

export interface ProductionHistoryRecord {
  id: number;
  client_id: number;
  year: number;
  month: number;
  articles_actual: number | null;
  articles_projected: number | null;
  is_actual: boolean;
}

export interface ProductionTrendPoint {
  year: number;
  month: number;
  total_actual: number;
  total_projected: number;
  is_actual: boolean;
}

export interface ClientProductionMonth {
  year: number;
  month: number;
  actual: number;
  projected: number;
}

export interface ClientProductionTotals {
  projected: number;
  delivered: number;
  sow: number;
  reconciliation: number;
}

export interface ClientProductionRow {
  client_name: string;
  editorial_pod: string | null;
  monthly: ClientProductionMonth[];
  totals: ClientProductionTotals;
}

export interface DeliveryTemplate {
  id: number;
  sow_size: number;
  month_number: number;
  invoicing_target: number | null;
  invoicing_cumulative: number | null;
  delivery_target: number | null;
  delivery_cumulative: number | null;
}

export interface ClientPacing {
  client_name: string;
  sow_size: number;
  months_elapsed: number;
  actual_cumulative: number;
  expected_cumulative: number;
  delta_pct: number;
  status: 'AHEAD' | 'ON_TRACK' | 'BEHIND' | 'AT_RISK';
}

export interface EngagementRule {
  id: number;
  rule_number: number;
  area: string;
  rule_name: string;
  description: string | null;
  owner: string | null;
  timing: string | null;
  consequences: string | null;
}

export interface EngagementCompliance {
  client_name: string;
  rules_met: number;
  rules_total: number;
  score_pct: number;
  details: Array<{ rule_number: number; rule_name: string; met: boolean }>;
}

// AI Monitoring
export interface AIMonitoringSummary {
  total: number;
  full_pass: number;
  partial_pass: number;
  review_rewrite: number;
  full_pass_rate: number;
  partial_pass_rate: number;
  review_rewrite_rate: number;
}

export interface AIMonitoringBreakdown {
  name: string;
  full_pass: number;
  partial_pass: number;
  review_rewrite: number;
  total: number;
}

export interface AIMonitoringRecord {
  id: number;
  pod: string;
  client: string;
  topic_title: string;
  topic_content: string | null;
  surfer_v1_score: number | null;
  surfer_v2_score: number | null;
  recommendation: string;
  manual_review_notes: string | null;
  action: string | null;
  writer_name: string | null;
  editor_name: string | null;
  article_link: string | null;
  date_processed: string | null;
  month: string | null;
  is_rewrite: boolean;
  is_flagged: boolean;
}

export interface SurferAPIUsage {
  id: number;
  year_month: string;
  start_date: string | null;
  end_date: string | null;
  pod_1: number;
  pod_2: number;
  pod_3: number;
  pod_4: number;
  pod_5: number;
  auditioning_writers: number;
  rewrites: number;
  total_spent: number;
  remaining_calls: number | null;
}

// Cumulative Metrics
export interface CumulativeMetric {
  id: number;
  status: string | null;
  account_team_pod: string | null;
  client_name: string;
  client_type: string | null;
  content_type: string | null;
  topics_sent: number | null;
  topics_approved: number | null;
  topics_pct_approved: string | null;
  cbs_sent: number | null;
  cbs_approved: number | null;
  cbs_pct_approved: string | null;
  articles_sent: number | null;
  articles_approved: number | null;
  articles_difference: number | null;
  articles_pct_approved: string | null;
  published_live: number | null;
  published_pct_live: string | null;
  last_update: string | null;
  comments: string | null;
}

// Goals vs Delivery
export interface GoalsVsDeliveryRow {
  id: number;
  month_year: string;
  week_number: number;
  week_date: string | null;
  client_name: string;
  growth_team_pod: string | null;
  editorial_team_pod: string | null;
  client_type: string | null;
  content_type: string | null;
  ratios: string | null;
  cb_delivered_today: number | null;
  cb_projection: number | null;
  cb_delivered_to_date: number | null;
  cb_monthly_goal: number | null;
  cb_pct_of_goal: string | null;
  cb_comments: string | null;
  ad_revisions: number | null;
  ad_delivered_today: number | null;
  ad_projection: number | null;
  ad_cb_backlog: number | null;
  ad_delivered_to_date: number | null;
  ad_monthly_goal: number | null;
  ad_pct_of_goal: string | null;
  ad_comments: string | null;
}

// --- Unified Client Delivery ---

export interface ClientMonthRow {
  client_id: number;
  client_name: string;
  status: string;
  growth_pod: string | null;
  editorial_pod: string | null;
  year: number;
  month: number;
  month_label: string;
  articles_sow_target: number | null;
  articles_delivered: number | null;
  articles_invoiced: number | null;
  variance: number | null;
  articles_actual: number | null;
  articles_projected: number | null;
  is_actual: boolean | null;
  cb_delivered_to_date: number | null;
  cb_monthly_goal: number | null;
  cb_pct: number | null;
  ad_delivered_to_date: number | null;
  ad_monthly_goal: number | null;
  ad_pct: number | null;
  ad_revisions: number | null;
  ad_cb_backlog: number | null;
  weeks_with_data: number;
  pct_complete: number | null;
}

export interface ClientAlltimeRow {
  client_id: number | null;
  client_name: string;
  status: string | null;
  growth_pod: string | null;
  editorial_pod: string | null;
  account_team_pod: string | null;
  articles_sow: number | null;
  articles_delivered: number | null;
  articles_invoiced: number | null;
  topics_sent: number | null;
  topics_approved: number | null;
  cbs_sent: number | null;
  cbs_approved: number | null;
  articles_sent: number | null;
  articles_approved: number | null;
  articles_difference: number | null;
  published_live: number | null;
  topics_approval_pct: number | null;
  cbs_approval_pct: number | null;
  articles_approval_pct: number | null;
}

export interface WeeklyDetailRow {
  client_name: string;
  month_year: string;
  week_number: number;
  week_date: string | null;
  cb_delivered_today: number | null;
  cb_projection: number | null;
  cb_delivered_to_date: number | null;
  cb_monthly_goal: number | null;
  cb_pct_of_goal: string | null;
  ad_revisions: number | null;
  ad_delivered_today: number | null;
  ad_projection: number | null;
  ad_cb_backlog: number | null;
  ad_delivered_to_date: number | null;
  ad_monthly_goal: number | null;
  ad_pct_of_goal: string | null;
}

export interface ClientDeliveryResponse {
  view: string;
  monthly_rows: ClientMonthRow[] | null;
  alltime_rows: ClientAlltimeRow[] | null;
  weekly_rows: WeeklyDetailRow[] | null;
}
