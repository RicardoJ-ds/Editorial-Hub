from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    domain: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="ACTIVE")
    growth_pod: Mapped[str | None] = mapped_column(String(50))
    editorial_pod: Mapped[str | None] = mapped_column(String(50))
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    term_months: Mapped[int | None] = mapped_column(Integer)
    cadence: Mapped[str | None] = mapped_column(String(500))
    cadence_q1: Mapped[int | None] = mapped_column(Integer)
    cadence_q2: Mapped[int | None] = mapped_column(Integer)
    cadence_q3: Mapped[int | None] = mapped_column(Integer)
    cadence_q4: Mapped[int | None] = mapped_column(Integer)
    articles_sow: Mapped[int | None] = mapped_column(Integer)
    articles_delivered: Mapped[int | None] = mapped_column(Integer, default=0)
    articles_invoiced: Mapped[int | None] = mapped_column(Integer, default=0)
    articles_paid: Mapped[int | None] = mapped_column(Integer, default=0)
    word_count_min: Mapped[int | None] = mapped_column(Integer)
    word_count_max: Mapped[int | None] = mapped_column(Integer)
    sow_link: Mapped[str | None] = mapped_column(Text)
    project_type: Mapped[str | None] = mapped_column(String(100))
    consulting_ko_date: Mapped[date | None] = mapped_column(Date)
    editorial_ko_date: Mapped[date | None] = mapped_column(Date)
    first_cb_approved_date: Mapped[date | None] = mapped_column(Date)
    first_article_delivered_date: Mapped[date | None] = mapped_column(Date)
    first_feedback_date: Mapped[date | None] = mapped_column(Date)
    first_article_published_date: Mapped[date | None] = mapped_column(Date)
    managing_director: Mapped[str | None] = mapped_column(String(255))
    account_director: Mapped[str | None] = mapped_column(String(255))
    account_manager: Mapped[str | None] = mapped_column(String(255))
    jr_am: Mapped[str | None] = mapped_column(String(255))
    cs_team: Mapped[str | None] = mapped_column(Text)
    comments: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[str | None] = mapped_column(String(255))

    deliverables: Mapped[list["DeliverableMonthly"]] = relationship(
        back_populates="client", cascade="all, delete-orphan"
    )


class DeliverableMonthly(Base):
    __tablename__ = "deliverables_monthly"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("clients.id", ondelete="CASCADE"), nullable=False
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    articles_sow_target: Mapped[int | None] = mapped_column(Integer, default=0)
    articles_delivered: Mapped[int | None] = mapped_column(Integer, default=0)
    articles_invoiced: Mapped[int | None] = mapped_column(Integer, default=0)
    variance: Mapped[int | None] = mapped_column(Integer, default=0)
    content_briefs_delivered: Mapped[int | None] = mapped_column(Integer, default=0)
    content_briefs_goal: Mapped[int | None] = mapped_column(Integer, default=0)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[str | None] = mapped_column(String(255))

    client: Mapped["Client"] = relationship(back_populates="deliverables")


class TeamMember(Base):
    __tablename__ = "team_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False)
    pod: Mapped[str | None] = mapped_column(String(50))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    monthly_capacity: Mapped[int | None] = mapped_column(Integer)
    email: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    kpi_scores: Mapped[list["KpiScore"]] = relationship(
        back_populates="team_member", cascade="all, delete-orphan"
    )


class CapacityProjection(Base):
    __tablename__ = "capacity_projections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pod: Mapped[str] = mapped_column(String(50), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    total_capacity: Mapped[int | None] = mapped_column(Integer)
    projected_used_capacity: Mapped[int | None] = mapped_column(Integer)
    actual_used_capacity: Mapped[int | None] = mapped_column(Integer)
    version: Mapped[str | None] = mapped_column(String(50))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[str | None] = mapped_column(String(255))


class KpiScore(Base):
    __tablename__ = "kpi_scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    team_member_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("team_members.id", ondelete="CASCADE"), nullable=False
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    kpi_type: Mapped[str] = mapped_column(String(50), nullable=False)
    score: Mapped[float | None] = mapped_column(Float)
    target: Mapped[float | None] = mapped_column(Float)
    client_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("clients.id", ondelete="SET NULL")
    )
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[str | None] = mapped_column(String(255))

    team_member: Mapped["TeamMember"] = relationship(back_populates="kpi_scores")


class ModelAssumption(Base):
    __tablename__ = "model_assumptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    key: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[int | None] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    changes_json: Mapped[str | None] = mapped_column(Text)
    performed_by: Mapped[str | None] = mapped_column(String(255))
    performed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ProductionHistory(Base):
    __tablename__ = "production_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("clients.id", ondelete="CASCADE"), nullable=False
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    articles_actual: Mapped[int | None] = mapped_column(Integer)
    articles_projected: Mapped[int | None] = mapped_column(Integer)
    is_actual: Mapped[bool] = mapped_column(Boolean, default=True)
    source: Mapped[str] = mapped_column(String(50), default="operating_model")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class DeliveryTemplate(Base):
    __tablename__ = "delivery_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sow_size: Mapped[int] = mapped_column(Integer, nullable=False)
    month_number: Mapped[int] = mapped_column(Integer, nullable=False)
    invoicing_target: Mapped[int | None] = mapped_column(Integer)
    invoicing_cumulative: Mapped[int | None] = mapped_column(Integer)
    delivery_target: Mapped[int | None] = mapped_column(Integer)
    delivery_cumulative: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class EngagementRule(Base):
    __tablename__ = "engagement_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rule_number: Mapped[int] = mapped_column(Integer, nullable=False)
    area: Mapped[str] = mapped_column(String(50), nullable=False)
    rule_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    owner: Mapped[str | None] = mapped_column(String(255))
    timing: Mapped[str | None] = mapped_column(String(255))
    consequences: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class AIMonitoringRecord(Base):
    __tablename__ = "ai_monitoring_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pod: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    client: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    topic_title: Mapped[str] = mapped_column(String(500), nullable=False)
    topic_content: Mapped[str | None] = mapped_column(Text)
    surfer_v1_score: Mapped[float | None] = mapped_column(Float)
    surfer_v2_score: Mapped[float | None] = mapped_column(Float)
    recommendation: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    manual_review_notes: Mapped[str | None] = mapped_column(Text)
    action: Mapped[str | None] = mapped_column(String(50))
    writer_name: Mapped[str | None] = mapped_column(String(255), index=True)
    editor_name: Mapped[str | None] = mapped_column(String(255), index=True)
    article_link: Mapped[str | None] = mapped_column(Text)
    date_processed: Mapped[date | None] = mapped_column(Date)
    month: Mapped[str | None] = mapped_column(String(50), index=True)
    is_rewrite: Mapped[bool] = mapped_column(Boolean, default=False)
    is_flagged: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class SurferAPIUsage(Base):
    __tablename__ = "surfer_api_usage"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    year_month: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    start_date: Mapped[str | None] = mapped_column(String(100))
    end_date: Mapped[str | None] = mapped_column(String(100))
    pod_1: Mapped[int] = mapped_column(Integer, default=0)
    pod_2: Mapped[int] = mapped_column(Integer, default=0)
    pod_3: Mapped[int] = mapped_column(Integer, default=0)
    pod_4: Mapped[int] = mapped_column(Integer, default=0)
    pod_5: Mapped[int] = mapped_column(Integer, default=0)
    auditioning_writers: Mapped[int] = mapped_column(Integer, default=0)
    rewrites: Mapped[int] = mapped_column(Integer, default=0)
    total_spent: Mapped[int] = mapped_column(Integer, default=0)
    remaining_calls: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class CumulativeMetric(Base):
    __tablename__ = "cumulative_metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    status: Mapped[str | None] = mapped_column(String(50))
    account_team_pod: Mapped[str | None] = mapped_column(String(50))
    client_name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    client_type: Mapped[str | None] = mapped_column(String(100))
    content_type: Mapped[str | None] = mapped_column(String(50))
    topics_sent: Mapped[int | None] = mapped_column(Integer)
    topics_approved: Mapped[int | None] = mapped_column(Integer)
    topics_pct_approved: Mapped[str | None] = mapped_column(String(10))
    cbs_sent: Mapped[int | None] = mapped_column(Integer)
    cbs_approved: Mapped[int | None] = mapped_column(Integer)
    cbs_pct_approved: Mapped[str | None] = mapped_column(String(10))
    articles_sent: Mapped[int | None] = mapped_column(Integer)
    articles_approved: Mapped[int | None] = mapped_column(Integer)
    articles_difference: Mapped[int | None] = mapped_column(Integer)
    articles_pct_approved: Mapped[str | None] = mapped_column(String(10))
    published_live: Mapped[int | None] = mapped_column(Integer)
    published_pct_live: Mapped[str | None] = mapped_column(String(10))
    last_update: Mapped[date | None] = mapped_column(Date)
    comments: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class SheetSyncHistory(Base):
    """Tracks which month-partitioned sheet tabs have already been imported.

    Used by `import_goals_vs_delivery`: the Master Tracker has one tab per
    month (`[January 2026] Goals vs Delivery`, …). Past-month tabs are
    frozen in practice, so the normal SYNC button only re-imports the
    current-month tab and skips any past-month tab already recorded here.
    A new tab (e.g. you haven't synced for two months) is auto-imported
    once on first sight and then frozen. A separate "Re-sync historical"
    action forces a full re-import.
    """

    __tablename__ = "sheet_sync_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sheet_name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    tab_name: Mapped[str] = mapped_column(String(200), nullable=False)
    month_year: Mapped[str] = mapped_column(String(50), nullable=False)
    rows_imported: Mapped[int] = mapped_column(Integer, default=0)
    synced_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (UniqueConstraint("sheet_name", "tab_name", name="uq_sheet_sync_tab"),)


class GoalsVsDelivery(Base):
    __tablename__ = "goals_vs_delivery"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    month_year: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    week_number: Mapped[int] = mapped_column(Integer, nullable=False)
    week_date: Mapped[date | None] = mapped_column(Date)
    client_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    growth_team_pod: Mapped[str | None] = mapped_column(String(50))
    editorial_team_pod: Mapped[str | None] = mapped_column(String(50))
    client_type: Mapped[str | None] = mapped_column(String(100))
    content_type: Mapped[str | None] = mapped_column(String(50))
    ratios: Mapped[str | None] = mapped_column(String(20))
    cb_delivered_today: Mapped[int | None] = mapped_column(Integer)
    cb_projection: Mapped[int | None] = mapped_column(Integer)
    cb_delivered_to_date: Mapped[int | None] = mapped_column(Integer)
    cb_monthly_goal: Mapped[int | None] = mapped_column(Integer)
    cb_pct_of_goal: Mapped[str | None] = mapped_column(String(20))
    cb_comments: Mapped[str | None] = mapped_column(Text)
    ad_revisions: Mapped[int | None] = mapped_column(Integer)
    ad_delivered_today: Mapped[int | None] = mapped_column(Integer)
    ad_projection: Mapped[int | None] = mapped_column(Integer)
    ad_cb_backlog: Mapped[int | None] = mapped_column(Integer)
    ad_delivered_to_date: Mapped[int | None] = mapped_column(Integer)
    ad_monthly_goal: Mapped[int | None] = mapped_column(Integer)
    ad_pct_of_goal: Mapped[str | None] = mapped_column(String(20))
    ad_comments: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class NotionArticle(Base):
    __tablename__ = "notion_articles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    title: Mapped[str | None] = mapped_column(String(500))
    client_name: Mapped[str | None] = mapped_column(String(255), index=True)
    writer: Mapped[str | None] = mapped_column(String(255), index=True)
    editor: Mapped[str | None] = mapped_column(String(255), index=True)
    sr_editor: Mapped[str | None] = mapped_column(String(255), index=True)
    current_assignee: Mapped[str | None] = mapped_column(String(255))
    cb_creator: Mapped[str | None] = mapped_column(String(255))
    cb_reviewer: Mapped[str | None] = mapped_column(String(255))
    editorial_pod: Mapped[str | None] = mapped_column(String(100), index=True)
    account_pod: Mapped[str | None] = mapped_column(String(100))
    cms_pod: Mapped[str | None] = mapped_column(String(100))
    content_type: Mapped[str | None] = mapped_column(String(100))
    client_type: Mapped[str | None] = mapped_column(String(100))
    article_status: Mapped[str | None] = mapped_column(String(100), index=True)
    cb_status: Mapped[str | None] = mapped_column(String(100))
    cms_status: Mapped[str | None] = mapped_column(String(100))
    workflow: Mapped[str | None] = mapped_column(String(100))
    client_folder: Mapped[str | None] = mapped_column(String(255))
    created_date: Mapped[datetime | None] = mapped_column(DateTime)
    cb_delivered_date: Mapped[datetime | None] = mapped_column(DateTime)
    cb_deadline: Mapped[datetime | None] = mapped_column(DateTime)
    article_delivered_date: Mapped[datetime | None] = mapped_column(DateTime)
    article_deadline: Mapped[datetime | None] = mapped_column(DateTime)
    cms_delivered_date: Mapped[datetime | None] = mapped_column(DateTime)
    published_url: Mapped[str | None] = mapped_column(Text)
    wa_link: Mapped[str | None] = mapped_column(Text)
    article_link: Mapped[str | None] = mapped_column(Text)
    cb_link: Mapped[str | None] = mapped_column(Text)
    notion_url: Mapped[str | None] = mapped_column(Text)
    priority_month: Mapped[str | None] = mapped_column(String(50))
    priority_level: Mapped[str | None] = mapped_column(String(50))
    month: Mapped[str | None] = mapped_column(String(50), index=True)
    uploader: Mapped[str | None] = mapped_column(String(255))
    created_by: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
