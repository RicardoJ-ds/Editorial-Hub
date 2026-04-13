from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


# --- Client schemas ---
class ClientBase(BaseModel):
    name: str
    domain: str | None = None
    status: str = "ACTIVE"
    growth_pod: str | None = None
    editorial_pod: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    term_months: int | None = None
    cadence: str | None = None
    cadence_q1: int | None = None
    cadence_q2: int | None = None
    cadence_q3: int | None = None
    cadence_q4: int | None = None
    articles_sow: int | None = None
    articles_delivered: int | None = 0
    articles_invoiced: int | None = 0
    articles_paid: int | None = 0
    word_count_min: int | None = None
    word_count_max: int | None = None
    sow_link: str | None = None
    project_type: str | None = None
    consulting_ko_date: date | None = None
    editorial_ko_date: date | None = None
    first_cb_approved_date: date | None = None
    first_article_delivered_date: date | None = None
    first_feedback_date: date | None = None
    first_article_published_date: date | None = None
    managing_director: str | None = None
    account_director: str | None = None
    account_manager: str | None = None
    jr_am: str | None = None
    cs_team: str | None = None
    comments: str | None = None


class ClientCreate(ClientBase):
    pass


class ClientUpdate(BaseModel):
    name: str | None = None
    domain: str | None = None
    status: str | None = None
    growth_pod: str | None = None
    editorial_pod: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    term_months: int | None = None
    cadence: str | None = None
    cadence_q1: int | None = None
    cadence_q2: int | None = None
    cadence_q3: int | None = None
    cadence_q4: int | None = None
    articles_sow: int | None = None
    articles_delivered: int | None = None
    articles_invoiced: int | None = None
    articles_paid: int | None = None
    word_count_min: int | None = None
    word_count_max: int | None = None
    sow_link: str | None = None
    project_type: str | None = None
    consulting_ko_date: date | None = None
    editorial_ko_date: date | None = None
    first_cb_approved_date: date | None = None
    first_article_delivered_date: date | None = None
    first_feedback_date: date | None = None
    first_article_published_date: date | None = None
    managing_director: str | None = None
    account_director: str | None = None
    account_manager: str | None = None
    jr_am: str | None = None
    cs_team: str | None = None
    comments: str | None = None


class ClientResponse(ClientBase):
    id: int
    created_at: datetime
    updated_at: datetime
    updated_by: str | None = None

    model_config = ConfigDict(from_attributes=True)


# --- Deliverable schemas ---
class DeliverableBase(BaseModel):
    client_id: int
    year: int
    month: int
    articles_sow_target: int | None = 0
    articles_delivered: int | None = 0
    articles_invoiced: int | None = 0
    variance: int | None = 0
    content_briefs_delivered: int | None = 0
    content_briefs_goal: int | None = 0
    notes: str | None = None


class DeliverableCreate(DeliverableBase):
    pass


class DeliverableUpdate(BaseModel):
    articles_sow_target: int | None = None
    articles_delivered: int | None = None
    articles_invoiced: int | None = None
    variance: int | None = None
    content_briefs_delivered: int | None = None
    content_briefs_goal: int | None = None
    notes: str | None = None


class DeliverableResponse(DeliverableBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --- Team Member schemas ---
class TeamMemberBase(BaseModel):
    name: str
    role: str
    pod: str | None = None
    is_active: bool = True
    monthly_capacity: int | None = None
    email: str | None = None


class TeamMemberCreate(TeamMemberBase):
    pass


class TeamMemberUpdate(BaseModel):
    name: str | None = None
    role: str | None = None
    pod: str | None = None
    is_active: bool | None = None
    monthly_capacity: int | None = None
    email: str | None = None


class TeamMemberResponse(TeamMemberBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --- Capacity Projection schemas ---
class CapacityBase(BaseModel):
    pod: str
    year: int
    month: int
    total_capacity: int | None = None
    projected_used_capacity: int | None = None
    actual_used_capacity: int | None = None
    version: str | None = None
    notes: str | None = None


class CapacityCreate(CapacityBase):
    pass


class CapacityUpdate(BaseModel):
    total_capacity: int | None = None
    projected_used_capacity: int | None = None
    actual_used_capacity: int | None = None
    version: str | None = None
    notes: str | None = None


class CapacityResponse(CapacityBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --- KPI Score schemas ---
class KpiScoreBase(BaseModel):
    team_member_id: int
    year: int
    month: int
    kpi_type: str
    score: float | None = None
    target: float | None = None
    client_id: int | None = None
    notes: str | None = None


class KpiScoreCreate(KpiScoreBase):
    pass


class KpiScoreUpdate(BaseModel):
    score: float | None = None
    target: float | None = None
    notes: str | None = None


class KpiScoreResponse(KpiScoreBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --- Model Assumption schemas ---
class ModelAssumptionResponse(BaseModel):
    id: int
    category: str
    key: str
    value: str
    description: str | None = None

    model_config = ConfigDict(from_attributes=True)


# --- Audit Log ---
class AuditLogResponse(BaseModel):
    id: int
    entity_type: str
    entity_id: int | None = None
    action: str
    changes_json: str | None = None
    performed_by: str | None = None
    performed_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --- Dashboard aggregate schemas ---
class DashboardSummary(BaseModel):
    total_active_clients: int
    total_articles_sow: int
    total_articles_delivered: int
    total_articles_invoiced: int
    avg_time_to_first_article_days: float | None = None


class TimeToMetric(BaseModel):
    client_name: str
    ko_to_first_cb_days: int | None = None
    ko_to_first_article_days: int | None = None
    ko_to_first_feedback_days: int | None = None
    ko_to_first_published_days: int | None = None
    cb_to_first_article_days: int | None = None


class CapacitySummary(BaseModel):
    pod: str
    month: int
    year: int
    total_capacity: int
    projected_used: int
    actual_used: int | None = None
    utilization_pct: float
    status: str  # UNDER, OPTIMAL, WARNING, OVER


# --- Production History schemas ---
class ProductionHistoryResponse(BaseModel):
    id: int
    client_id: int
    year: int
    month: int
    articles_actual: int | None = None
    articles_projected: int | None = None
    is_actual: bool

    model_config = ConfigDict(from_attributes=True)


# --- Delivery Template schemas ---
class DeliveryTemplateResponse(BaseModel):
    id: int
    sow_size: int
    month_number: int
    invoicing_target: int | None = None
    invoicing_cumulative: int | None = None
    delivery_target: int | None = None
    delivery_cumulative: int | None = None

    model_config = ConfigDict(from_attributes=True)


# --- Engagement Rule schemas ---
class EngagementRuleResponse(BaseModel):
    id: int
    rule_number: int
    area: str
    rule_name: str
    description: str | None = None
    owner: str | None = None
    timing: str | None = None
    consequences: str | None = None

    model_config = ConfigDict(from_attributes=True)


# --- Dashboard aggregate schemas (new) ---
class ProductionTrendPoint(BaseModel):
    year: int
    month: int
    total_actual: int
    total_projected: int
    is_actual: bool


class ClientPacing(BaseModel):
    client_name: str
    sow_size: int
    months_elapsed: int
    actual_cumulative: int
    expected_cumulative: int
    delta_pct: float
    status: str  # AHEAD, ON_TRACK, BEHIND, AT_RISK


class EngagementCompliance(BaseModel):
    client_name: str
    rules_met: int
    rules_total: int
    score_pct: float
    details: list[dict]  # [{rule_number, rule_name, met: bool}]


# --- AI Monitoring schemas ---
class AIMonitoringRecordResponse(BaseModel):
    id: int
    pod: str
    client: str
    topic_title: str
    topic_content: str | None = None
    surfer_v1_score: float | None = None
    surfer_v2_score: float | None = None
    recommendation: str
    manual_review_notes: str | None = None
    action: str | None = None
    writer_name: str | None = None
    editor_name: str | None = None
    article_link: str | None = None
    date_processed: date | None = None
    month: str | None = None
    is_rewrite: bool = False
    is_flagged: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AIMonitoringSummary(BaseModel):
    total: int
    full_pass: int
    partial_pass: int
    review_rewrite: int
    full_pass_rate: float
    partial_pass_rate: float
    review_rewrite_rate: float


class AIMonitoringBreakdown(BaseModel):
    name: str
    full_pass: int
    partial_pass: int
    review_rewrite: int
    total: int


class SurferAPIUsageResponse(BaseModel):
    id: int
    year_month: str
    start_date: str | None = None
    end_date: str | None = None
    pod_1: int = 0
    pod_2: int = 0
    pod_3: int = 0
    pod_4: int = 0
    pod_5: int = 0
    auditioning_writers: int = 0
    rewrites: int = 0
    total_spent: int = 0
    remaining_calls: int | None = None

    model_config = ConfigDict(from_attributes=True)


# --- Cumulative Metric schemas ---
class CumulativeMetricResponse(BaseModel):
    id: int
    status: str | None = None
    account_team_pod: str | None = None
    client_name: str
    client_type: str | None = None
    content_type: str | None = None
    topics_sent: int | None = None
    topics_approved: int | None = None
    topics_pct_approved: str | None = None
    cbs_sent: int | None = None
    cbs_approved: int | None = None
    cbs_pct_approved: str | None = None
    articles_sent: int | None = None
    articles_approved: int | None = None
    articles_difference: int | None = None
    articles_pct_approved: str | None = None
    published_live: int | None = None
    published_pct_live: str | None = None
    last_update: date | None = None
    comments: str | None = None

    model_config = ConfigDict(from_attributes=True)


# --- Goals vs Delivery schemas ---
class GoalsVsDeliveryResponse(BaseModel):
    id: int
    month_year: str
    week_number: int
    week_date: date | None = None
    client_name: str
    growth_team_pod: str | None = None
    editorial_team_pod: str | None = None
    client_type: str | None = None
    content_type: str | None = None
    ratios: str | None = None
    cb_delivered_today: int | None = None
    cb_projection: int | None = None
    cb_delivered_to_date: int | None = None
    cb_monthly_goal: int | None = None
    cb_pct_of_goal: str | None = None
    cb_comments: str | None = None
    ad_revisions: int | None = None
    ad_delivered_today: int | None = None
    ad_projection: int | None = None
    ad_cb_backlog: int | None = None
    ad_delivered_to_date: int | None = None
    ad_monthly_goal: int | None = None
    ad_pct_of_goal: str | None = None
    ad_comments: str | None = None

    model_config = ConfigDict(from_attributes=True)


# --- Unified Client Delivery schemas ---


class ClientMonthRow(BaseModel):
    client_id: int
    client_name: str
    status: str
    growth_pod: str | None = None
    editorial_pod: str | None = None
    year: int
    month: int
    month_label: str
    # DeliverableMonthly
    articles_sow_target: int | None = None
    articles_delivered: int | None = None
    articles_invoiced: int | None = None
    variance: int | None = None
    # ProductionHistory
    articles_actual: int | None = None
    articles_projected: int | None = None
    is_actual: bool | None = None
    # GoalsVsDelivery (aggregated to month)
    cb_delivered_to_date: int | None = None
    cb_monthly_goal: int | None = None
    cb_pct: float | None = None
    ad_delivered_to_date: int | None = None
    ad_monthly_goal: int | None = None
    ad_pct: float | None = None
    ad_revisions: int | None = None
    ad_cb_backlog: int | None = None
    weeks_with_data: int = 0
    # Computed
    pct_complete: float | None = None


class ClientAlltimeRow(BaseModel):
    client_id: int | None = None
    client_name: str
    status: str | None = None
    growth_pod: str | None = None
    editorial_pod: str | None = None
    account_team_pod: str | None = None
    articles_sow: int | None = None
    articles_delivered: int | None = None
    articles_invoiced: int | None = None
    topics_sent: int | None = None
    topics_approved: int | None = None
    cbs_sent: int | None = None
    cbs_approved: int | None = None
    articles_sent: int | None = None
    articles_approved: int | None = None
    articles_difference: int | None = None
    published_live: int | None = None
    topics_approval_pct: float | None = None
    cbs_approval_pct: float | None = None
    articles_approval_pct: float | None = None


class WeeklyDetailRow(BaseModel):
    client_name: str
    month_year: str
    week_number: int
    week_date: str | None = None
    cb_delivered_today: int | None = None
    cb_projection: int | None = None
    cb_delivered_to_date: int | None = None
    cb_monthly_goal: int | None = None
    cb_pct_of_goal: str | None = None
    ad_revisions: int | None = None
    ad_delivered_today: int | None = None
    ad_projection: int | None = None
    ad_cb_backlog: int | None = None
    ad_delivered_to_date: int | None = None
    ad_monthly_goal: int | None = None
    ad_pct_of_goal: str | None = None


class ClientDeliveryResponse(BaseModel):
    view: str
    monthly_rows: list[ClientMonthRow] | None = None
    alltime_rows: list[ClientAlltimeRow] | None = None
    weekly_rows: list[WeeklyDetailRow] | None = None


# --- Notion Article schemas ---


class NotionArticleResponse(BaseModel):
    id: int
    case_id: str
    title: str | None = None
    client_name: str | None = None
    writer: str | None = None
    editor: str | None = None
    sr_editor: str | None = None
    editorial_pod: str | None = None
    account_pod: str | None = None
    content_type: str | None = None
    client_type: str | None = None
    article_status: str | None = None
    cb_status: str | None = None
    cms_status: str | None = None
    created_date: datetime | None = None
    cb_delivered_date: datetime | None = None
    article_delivered_date: datetime | None = None
    cms_delivered_date: datetime | None = None
    published_url: str | None = None
    priority_month: str | None = None
    month: str | None = None

    model_config = ConfigDict(from_attributes=True)


class NotionSummaryResponse(BaseModel):
    total_articles: int
    status_breakdown: dict[str, int]
    revision_rate: float
    revision_count: int
    avg_turnaround_days: float | None = None
    median_turnaround_days: float | None = None
    turnaround_count: int = 0
    second_review_count: int = 0
    clients_count: int = 0
    pods_breakdown: dict[str, int] | None = None
