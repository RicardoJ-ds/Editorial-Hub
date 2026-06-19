from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class CacheVersion(Base):
    """Single-row (id=1) monotonic token bumped on every warehouse publish.
    The BQ dashboard read cache (services/bq_cache.py) keys its entries by this
    token, so a SYNC invalidates them across every instance."""

    __tablename__ = "cache_version"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    token: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    bumped_at: Mapped[datetime | None] = mapped_column(DateTime)


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


class EditorialMemberCapacity(Base):
    """Per-(month, pod, role-slot) editorial team-member capacity, parsed from the
    ET CP "EDITORIAL TEAM CAPACITY" block. The block has a variable number of pods
    and role rows per pod, so we key on a `slot` ordinal (position of the role row
    within the pod group) rather than assuming a fixed Senior Editor + Editor 1-3
    layout. `member_breakdown` splits combined cells (e.g. "Lauren K (28) +
    Anabelle (15)") into [{name, capacity}] best-effort. Pod-level totals stay in
    capacity_projections. Foundation for a future %-utilization-per-editor metric.
    """

    __tablename__ = "editorial_member_capacity"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    pod: Mapped[str] = mapped_column(String(50), nullable=False)
    slot: Mapped[int] = mapped_column(Integer, nullable=False)  # ordinal within the pod group
    role: Mapped[str | None] = mapped_column(String(100))
    member_raw: Mapped[str | None] = mapped_column(String(255))
    member_breakdown: Mapped[list | None] = mapped_column(JSONB)
    capacity: Mapped[int | None] = mapped_column(Integer)
    source_version: Mapped[str | None] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("year", "month", "pod", "slot", name="uq_member_capacity_ymps"),
    )


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
    # The Operating Model importer upserts by (client_id, year, month).
    # Enforce the invariant at the DB level so future races / autoflush
    # quirks can't reintroduce the duplicates we found in prod (Apr 2026).
    __table_args__ = (
        UniqueConstraint("client_id", "year", "month", name="uq_production_history_client_ym"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("clients.id", ondelete="CASCADE"), nullable=False
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    articles_actual: Mapped[int | None] = mapped_column(Integer)
    articles_projected: Mapped[int | None] = mapped_column(Integer)
    # The ORIGINAL projection for this client+month, from the ET CP per-month
    # client block's "Projected" column — kept for ALL months (for past/actual
    # months it's the projection that existed before the month closed; for
    # future months it mirrors the live projection). Separate from
    # articles_actual / articles_projected, which keep their existing behavior.
    projected_original: Mapped[int | None] = mapped_column(Integer)
    is_actual: Mapped[bool] = mapped_column(Boolean, default=True)
    source: Mapped[str] = mapped_column(String(50), default="operating_model")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class OverviewComment(Base):
    """Notion/Docs-style comments anchored to Overview-dashboard sections.

    `section_id` is the slug of the section (e.g. 'delivery-overview') —
    mirrors the anchor IDs the page already uses for SectionIndex
    scroll-spy. `client_name` ties the comment to one client at a time;
    when the user has multiple clients in their filter the rail groups
    threads per client, narrowing to one when filtered.

    Admin-only create (per spec). Anyone with overview access can read.
    Resolution is tracked so DaniQ can clear handled comments without
    losing history."""

    __tablename__ = "overview_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    section_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    # Optional: `general` comments posted in the right-side rail can be
    # global (no client anchor). Section-anchored threads still pass a
    # client. Old rows that pre-date this change all have a client_name.
    client_name: Mapped[str | None] = mapped_column(String(255), index=True)
    author_email: Mapped[str] = mapped_column(String(255), nullable=False)
    author_name: Mapped[str | None] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text, nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime)
    resolved_by_email: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class AccessView(Base):
    """Catalog of dashboard views that participate in the access matrix.
    Slug is the stable key the frontend + API speak in. The matrix renders
    a 3-level header: `parent_label` is the section (Dashboards / Data /
    Admin), `dashboard_label` is the dashboard within that section
    (Overview / Editorial Clients / Team KPIs / Capacity Planning v2 / …),
    and `label` is the leaf — the tab inside the dashboard, or the
    dashboard itself when it has no tabs. `sort_order` orders columns."""

    __tablename__ = "access_views"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    parent_label: Mapped[str] = mapped_column(String(80), nullable=False)
    dashboard_label: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class AccessGroup(Base):
    """RBAC group. Seeded groups (Admin / VPs / Leadership / BI Team /
    Editorial Team / Growth Team) get `is_seeded=True` so the seed-member
    rows tied to them are protected. `is_pod_derived` flags groups whose
    membership is recomputed on every Team Pods import. `sort_order`
    controls left-rail + matrix-row ordering — assigned from the
    canonical `_GROUPS` list in `app/services/access.py` on every seed
    run so reordering only requires a code change + restart."""

    __tablename__ = "access_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_seeded: Mapped[bool] = mapped_column(Boolean, default=True)
    is_pod_derived: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class AccessGroupMember(Base):
    """Group membership. `source` is what protects the seeded list:
      - `seed`     → from the original spec, can never be removed.
      - `manual`   → admin added them via the UI, can be removed.
      - `derived`  → auto-populated from `pod_assignments`, refreshed on
                     each Team Pods import. The whole `derived` set is
                     wiped + rewritten per refresh — manual rows survive.
    UNIQUE on (group_id, email) so the same person can't be in a group twice."""

    __tablename__ = "access_group_members"
    __table_args__ = (
        UniqueConstraint("group_id", "email", name="uq_access_group_members_group_email"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("access_groups.id", ondelete="CASCADE"), nullable=False
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False)  # seed | manual | derived
    added_by_email: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class AccessGroupViewPermission(Base):
    """Default view permission for a group. View-only across the board —
    `can_view=False` means the view is hidden / forbidden for that group's
    members (unless overridden per-user)."""

    __tablename__ = "access_group_view_permissions"
    __table_args__ = (
        UniqueConstraint(
            "group_id",
            "view_id",
            name="uq_access_group_view_permissions_group_view",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("access_groups.id", ondelete="CASCADE"), nullable=False
    )
    view_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("access_views.id", ondelete="CASCADE"), nullable=False
    )
    can_view: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class AccessUserOverride(Base):
    """Per-user override on a single view. Trumps every group default the
    user inherits from. `can_view=True` grants access the user wouldn't
    otherwise have; `can_view=False` revokes a view their groups grant."""

    __tablename__ = "access_user_overrides"
    __table_args__ = (
        UniqueConstraint("email", "view_id", name="uq_access_user_overrides_email_view"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    view_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("access_views.id", ondelete="CASCADE"), nullable=False
    )
    can_view: Mapped[bool] = mapped_column(Boolean, nullable=False)
    set_by_email: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class PodAssignment(Base):
    """One row per (email, client, role) tuple imported from the Team Pods
    spreadsheet's Editorial Team / Growth Team tabs. Source-of-truth for "who
    works on what" — feeds the RBAC layer (group auto-population, pod-aware
    client filtering) and any future "show clients I'm assigned to" UI.

    `pod_kind` distinguishes editorial vs growth; the same email can appear
    under both kinds (rare, but the schema doesn't preclude it).

    Email is whatever the Sheets people-chip exposes. The same person may
    have multiple workspace emails (e.g. `derrik@` and `derrik.chinn@`); we
    don't try to canonicalize — we store the chip's email verbatim and let
    the auth layer match against whichever email the session carries.
    """

    __tablename__ = "pod_assignments"
    __table_args__ = (
        UniqueConstraint(
            "email",
            "client_name",
            "pod_kind",
            "role",
            name="uq_pod_assignments_email_client_kind_role",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    pod_kind: Mapped[str] = mapped_column(String(20), nullable=False)  # 'editorial' | 'growth'
    pod_number: Mapped[str | None] = mapped_column(String(20))
    client_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(40), nullable=False)
    # Tab the row was imported from — preserved so we can reconcile against
    # the source sheet when debugging assignments.
    source_tab: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class PodAssignmentHistory(Base):
    """Per-month snapshot of Team Pods assignments — every monthly tab
    (Editorial Team / Growth Team / the growth side's older "Account Team"
    name) parsed into (year, month, pod_kind, pod, client, role, person).

    Unlike `pod_assignments` (latest month only — drives RBAC), this is the
    backfilled HISTORY used for per-month attribution and for cross-checking
    the ET CP capacity blocks (the second editorial-assignment source).
    Slice-rewritten per (year, month, pod_kind) on each import.

    `email` is nullable: chip-era tabs carry it, older text-only tabs don't.
    Editorial tabs also yield role='writer' rows (WRITER column, emails
    paired from WRITER EMAIL when the counts line up).
    """

    __tablename__ = "pod_assignment_history"
    __table_args__ = (Index("ix_pod_history_ym_kind", "year", "month", "pod_kind"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    pod_kind: Mapped[str] = mapped_column(String(20), nullable=False)  # 'editorial' | 'growth'
    pod_number: Mapped[str | None] = mapped_column(String(20))
    client_name: Mapped[str | None] = mapped_column(String(255), index=True)
    role: Mapped[str] = mapped_column(String(60), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), index=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    source_tab: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class EditorialWeek(Base):
    """Editorial-calendar week distribution per (year, month, week_number).
    Sourced from the Master Tracker's '{Year} Week Distribution' tab. Defines
    when each Editorial month begins for "as of" math — Week 1's start is the
    first day the team considers itself in that month, regardless of where
    Gregorian month boundaries fall."""

    __tablename__ = "editorial_weeks"
    __table_args__ = (
        UniqueConstraint("year", "month", "week_number", name="uq_editorial_weeks_ymw"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    week_number: Mapped[int] = mapped_column(Integer, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
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

    __table_args__ = (
        # Multi-content-type clients (e.g. article + LP, article + jumbo)
        # need each variant as its own row per (month × week × client).
        # Without content_type in the key, the importer's upsert silently
        # overwrites its own work depending on row order — that's how
        # College HUNKS lost its LP rows for months until the importer
        # forward-fill fix landed in 0.3.16.
        UniqueConstraint(
            "month_year",
            "week_number",
            "client_name",
            "content_type",
            name="uq_goals_vs_delivery_mw_client_ctype",
        ),
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


class PodImportIssue(Base):
    """Unmatched client names found during Growth Pod imports.

    Written by import_growth_pods() when a BQ client name cannot be resolved
    to a DB client (even after fuzzy matching). Surfaced in the Data Quality
    page so maintainers can add an explicit override or rename the client.
    `resolved_at` is set when the same name successfully matches on a later
    import run.
    """

    __tablename__ = "pod_import_issues"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    raw_name: Mapped[str] = mapped_column(String(255), nullable=False)
    pod_kind: Mapped[str] = mapped_column(String(50), nullable=False)
    pod_label: Mapped[str | None] = mapped_column(String(100))
    first_seen_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (UniqueConstraint("raw_name", "pod_kind", name="uq_pod_import_issue"),)


class PodNameOverride(Base):
    """User-defined BQ-name → DB-client mappings, editable from the Data Quality UI.

    Checked by import_growth_pods() before the static _GROWTH_POD_NAME_OVERRIDES
    dict so operators can fix name mismatches without a code deploy. When a row
    here resolves an import, the corresponding PodImportIssue is cleared.
    """

    __tablename__ = "pod_name_overrides"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    raw_name: Mapped[str] = mapped_column(String(255), nullable=False)
    pod_kind: Mapped[str] = mapped_column(String(50), nullable=False)
    client_id: Mapped[int] = mapped_column(Integer, ForeignKey("clients.id"), nullable=False)
    created_by: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    client: Mapped["Client"] = relationship("Client")

    __table_args__ = (UniqueConstraint("raw_name", "pod_kind", name="uq_pod_name_override"),)


class ClientPodHistory(Base):
    """One authoritative editorial-pod assignment per client per month.

    Built by import_et_cp_pod_history() by reading the column that matches
    the tab's own month from every ET CP version tab — that column is the
    confirmed historical assignment for that month; columns after it are
    projections and are intentionally ignored.

    client_id is NULL for clients not yet in the clients table (stubs
    tracked by IncompleteClient). It is back-filled when the client is
    added to SOW Overview and a subsequent sync resolves the raw name.
    """

    __tablename__ = "client_pod_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("clients.id"), nullable=True, index=True
    )
    client_name_raw: Mapped[str] = mapped_column(String(255), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    editorial_pod: Mapped[str | None] = mapped_column(String(100))
    # Per-(client, month) standard/specialized tag read from the same ET CP
    # client-block row as the pod (column pod_col+2). Drives the sheet's
    # specialized ×1.4 used-capacity weighting. NULL when the source cell is
    # blank or unrecognized.
    category: Mapped[str | None] = mapped_column(String(50))
    source_tab: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    client: Mapped["Client | None"] = relationship("Client")

    __table_args__ = (
        UniqueConstraint("client_name_raw", "year", "month", name="uq_client_pod_history"),
    )


class IncompleteClient(Base):
    """Client name found in ET CP tabs but absent from the clients table.

    Created when import_et_cp_pod_history() encounters a name that
    _resolve_client() cannot match. Gives the Ops team a list of names
    to backfill into the SOW Overview sheet. When a subsequent sync
    resolves the name, resolved_at is set and the row is no longer shown
    in the Data Quality dashboard.
    """

    __tablename__ = "incomplete_clients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name_raw: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    first_seen_tab: Mapped[str] = mapped_column(String(255), nullable=False)
    last_seen_tab: Mapped[str] = mapped_column(String(255), nullable=False)
    first_seen_year: Mapped[int] = mapped_column(Integer, nullable=False)
    first_seen_month: Mapped[int] = mapped_column(Integer, nullable=False)
    last_seen_year: Mapped[int] = mapped_column(Integer, nullable=False)
    last_seen_month: Mapped[int] = mapped_column(Integer, nullable=False)
    known_pods: Mapped[str | None] = mapped_column(String(500))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ArticleRecord(Base):
    """One row per (delivered article, editor) from the Monthly Article Count
    sheet. Pair-edited articles (e.g. "Shelby/Maggie") are exploded into one
    row per editor so per-editor counts are a trivial GROUP BY; `article_uid`
    is shared across an article's exploded rows so client-level distinct-article
    counts use COUNT(DISTINCT article_uid).

    `editorial_pod` is denormalized from the resolved client's CURRENT/last pod
    at import time (Editorial pod is assigned per-client, not per-editor). It is
    NULL when the source tab can't be resolved to a known client. Per-month pod
    accuracy is a known pending follow-up — see
    memory/project_monthly_article_count.md.

    Rebuilt wholesale on every import (the source has no reliable row key), so
    this table is never upserted in place.
    """

    __tablename__ = "article_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Stable per-physical-article key (sha1 of source_tab|source_row), shared
    # across the exploded per-editor rows.
    article_uid: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    client_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    client_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("clients.id"), nullable=True, index=True
    )
    source_tab: Mapped[str] = mapped_column(String(255), nullable=False)
    editor_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    editor_raw: Mapped[str | None] = mapped_column(String(255))
    collaboration: Mapped[bool] = mapped_column(Boolean, default=False)
    writer_name: Mapped[str | None] = mapped_column(String(255))
    writer_raw: Mapped[str | None] = mapped_column(String(255))
    editorial_pod: Mapped[str | None] = mapped_column(String(50), index=True)
    growth_pod: Mapped[str | None] = mapped_column(String(50), index=True)
    article_title: Mapped[str | None] = mapped_column(Text)
    copy_name: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(Text)
    word_count: Mapped[int | None] = mapped_column(Integer)
    date_submitted_raw: Mapped[str | None] = mapped_column(String(255))
    # Parsed calendar date of the article (day precision when available).
    submitted_date: Mapped[date | None] = mapped_column(Date)
    # year / month / month_year hold the EDITORIAL month — submitted_date is
    # mapped through the editorial week distribution (editorial_weeks) so a date
    # near a month boundary lands in the right editorial month. Falls back to the
    # calendar month when the date predates week-distribution coverage.
    year: Mapped[int | None] = mapped_column(Integer)
    month: Mapped[int | None] = mapped_column(Integer)
    month_year: Mapped[str | None] = mapped_column(String(7), index=True)  # "YYYY-MM"
    # Raw REVISED cell + parsed revision events. revision_count = number of
    # revision dates found; revision_dates = parsed ISO dates. The Revision rate
    # metric pivots on the article's creation month (this row); revision VOLUME
    # pivots on each revision's own date — see ArticleRevision.
    revised_raw: Mapped[str | None] = mapped_column(String(255))
    revision_count: Mapped[int] = mapped_column(Integer, default=0)
    revision_dates: Mapped[list | None] = mapped_column(JSONB)
    task_id: Mapped[str | None] = mapped_column(String(64), index=True)
    # Published status from the Notion Content Machine DB, matched by TASK ID
    # then normalized title. notion_matched distinguishes "not published" from
    # "no Notion match" (unknown). Shown as a reference; not a metric basis.
    is_published: Mapped[bool] = mapped_column(Boolean, default=False)
    published_url: Mapped[str | None] = mapped_column(Text)
    notion_matched: Mapped[bool] = mapped_column(Boolean, default=False)
    source_row: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_article_records_pod_month", "editorial_pod", "month_year"),
        Index("ix_article_records_editor_month", "editor_name", "month_year"),
    )


class ArticleRevision(Base):
    """One row per (article, editor, revision event), exploded from the REVISED
    cell. Lets the Revisions metric aggregate by the revision's OWN editorial
    month (capacity lands when the rework happens) — distinct from the parent
    ArticleRecord, whose month_year is the article's creation month. Rebuilt
    wholesale alongside article_records on every Monthly Article Count sync.
    """

    __tablename__ = "article_revisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    article_uid: Mapped[str] = mapped_column(String(64), index=True)
    client_name: Mapped[str] = mapped_column(String(255), nullable=False)
    editor_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    writer_name: Mapped[str | None] = mapped_column(String(255))
    editorial_pod: Mapped[str | None] = mapped_column(String(50), index=True)
    growth_pod: Mapped[str | None] = mapped_column(String(50), index=True)
    revision_date: Mapped[date] = mapped_column(Date, nullable=False)
    month_year: Mapped[str | None] = mapped_column(
        String(7), index=True
    )  # editorial month of the revision

    __table_args__ = (
        Index("ix_article_revisions_pod_month", "editorial_pod", "month_year"),
        Index("ix_article_revisions_editor_month", "editor_name", "month_year"),
    )


class ArticleNameAlias(Base):
    """Manual / seeded name-canonicalization for the Monthly Article Count
    importer. `kind='client'` maps a raw source-tab name to a canonical Hub
    client name (merged into the fuzzy client lookup); `kind='editor'` merges
    editor-name variants. Posted from the admin "Unmapped names" review screen;
    self-heals the next import.
    """

    __tablename__ = "article_name_aliases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # 'client' | 'editor'
    raw_value: Mapped[str] = mapped_column(String(255), nullable=False)
    canonical_value: Mapped[str] = mapped_column(String(255), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    created_by: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    # Optional date window ('YYYY-MM', inclusive) — lets one raw name map to
    # different people over time (e.g. "Sam" → Samantha McGrail through
    # 2026-01, → Samantha Marceau from 2026-02; tenure windows from the
    # Rippling headcount). NULL bound = open-ended; both NULL = always.
    valid_from: Mapped[str | None] = mapped_column(String(7))
    valid_to: Mapped[str | None] = mapped_column(String(7))

    __table_args__ = (
        UniqueConstraint("kind", "raw_value", "valid_from", name="uq_article_name_alias_window"),
    )


class ClientNameAlias(Base):
    """User-confirmed mapping from a source-sheet client name → a canonical Hub
    client name, for the SOW-client resolution shared by the Operating Model /
    Delivered vs Invoiced / Meta / ET CP importers. Complements the static
    `_CLIENT_NAME_ALIASES` with variants the fuzzy matcher can't catch
    (acronyms, rebrands) — e.g. 'WL/SG support (Feb)' → 'Workleap+Sharegate'.
    Written from the Data Quality → Missing from Hub tab; self-heals on the
    next sync (the name then resolves and stops being flagged)."""

    __tablename__ = "client_name_aliases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    raw_name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    client_name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_by: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ArticleUnmappedName(Base):
    """Source-tab client names the Monthly Article Count importer could not
    resolve to a Hub client (so their articles carry no pod). Surfaced in the
    admin review screen; `resolved_at` is set once a later import resolves the
    name (via a new alias or a new SOW client). Mirrors PodImportIssue /
    IncompleteClient.
    """

    __tablename__ = "article_unmapped_names"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="client")
    raw_value: Mapped[str] = mapped_column(String(255), nullable=False)
    occurrences: Mapped[int] = mapped_column(Integer, default=0)
    sample_tab: Mapped[str | None] = mapped_column(String(255))
    first_seen_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (UniqueConstraint("kind", "raw_value", name="uq_article_unmapped_name"),)


class UsageEvent(Base):
    """Append-only stream of in-app user actions for the Admin Analytics
    dashboard. One row per user-visible event:

      • PageView          — route entered
      • SectionViewed     — section scrolled into view (with dwell ms)
      • FilterChanged     — filter bar setter fired (dimension + value)
      • DrillDownOpened   — click-anchored popover opened
      • SyncClicked       — SYNC button or per-step re-sync clicked
      • CommentPosted     — new comment created
      • CommentEdited     — existing comment PATCHed
      • CommentResolved   — comment marked resolved
      • CommentDeleted    — comment removed

    Events are posted in batches by the frontend (`/api/analytics/event`,
    flush on 5 events or 10s, whichever is sooner). `props` is a JSON
    blob carrying event-specific metadata (selected pod, milestone slug,
    dwell ms, etc.) so adding a new event type doesn't require a schema
    change. `session_id` is a UUIDv4 generated client-side per tab so
    return-cadence and session-length metrics work without a server-side
    session table.

    A startup retention job trims rows older than 6 months on every
    boot — keeps the table bounded without an external cron.
    """

    __tablename__ = "usage_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_email: Mapped[str] = mapped_column(String(255), nullable=False)
    # Route the user was on (e.g. "/overview", "/editorial-clients"). For
    # admin/data-management subpages, the full pathname is stored so we
    # can disambiguate tabs at the analytics layer.
    route: Mapped[str] = mapped_column(String(255), nullable=False)
    # Optional section id on the current route (e.g. "period-snapshot",
    # "time-to-milestones"). NULL for events that aren't section-scoped
    # (PageView itself, FilterChanged, SyncClicked).
    section_id: Mapped[str | None] = mapped_column(String(80))
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    # Free-form metadata — kept small (< ~1 KB per event). The summary
    # endpoint expects specific keys per event_type (see docstring).
    # JSONB so we can use the `?` key-existence operator + jsonb_extract
    # operators in the summary queries (top sections' dwell_ms filter).
    props: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Tab-scoped session UUID minted by the frontend; lets analytics
    # join events into sessions without server-side state.
    session_id: Mapped[str] = mapped_column(String(40), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    __table_args__ = (
        # The two query shapes the analytics summary endpoint runs:
        # (a) timeline aggregates → range scan by occurred_at, narrowed
        #     by user_email for the per-user activity card.
        # (b) top-N rollups by (route, event_type) → covering index for
        #     GROUP BY route, event_type, date_trunc('day', occurred_at).
        Index("ix_usage_events_occurred_user", "occurred_at", "user_email"),
        Index("ix_usage_events_route_event", "route", "event_type"),
    )
