"""Compute real KPI values from NotionArticle data."""

from __future__ import annotations

import logging
from collections import Counter

from sqlalchemy import extract, func, select
from sqlalchemy.orm import Session

from app.models import CapacityProjection, KpiScore, NotionArticle, TeamMember

logger = logging.getLogger(__name__)

REVISION_STATUSES = {
    "Client Revision Needed",
    "Client Revision Ready",
    "Client Revision In Progress (Account Team)",
}


def compute_revision_rate(
    session: Session,
    *,
    editor: str | None = None,
    pod: str | None = None,
    client: str | None = None,
    year: int | None = None,
    month_str: str | None = None,
) -> dict:
    """Compute revision rate from article workflow statuses."""
    stmt = select(NotionArticle).where(NotionArticle.article_status.isnot(None))

    if editor:
        stmt = stmt.where((NotionArticle.editor == editor) | (NotionArticle.sr_editor == editor))
    if pod:
        stmt = stmt.where(NotionArticle.editorial_pod.ilike(f"%{pod}%"))
    if client:
        stmt = stmt.where(NotionArticle.client_name == client)
    if year:
        stmt = stmt.where(extract("year", NotionArticle.created_date) == year)
    if month_str:
        stmt = stmt.where(NotionArticle.month == month_str)

    articles = session.execute(stmt).scalars().all()
    total = len(articles)
    revisions = sum(1 for a in articles if a.article_status in REVISION_STATUSES)
    rate = round((revisions / total) * 100, 1) if total > 0 else 0.0

    return {
        "rate": rate,
        "revision_count": revisions,
        "total_count": total,
    }


def compute_turnaround_time(
    session: Session,
    *,
    editor: str | None = None,
    pod: str | None = None,
    client: str | None = None,
    year: int | None = None,
) -> dict:
    """Compute days from CB Delivered → Article Delivered."""
    stmt = select(NotionArticle).where(
        NotionArticle.cb_delivered_date.isnot(None),
        NotionArticle.article_delivered_date.isnot(None),
    )

    if editor:
        stmt = stmt.where((NotionArticle.editor == editor) | (NotionArticle.sr_editor == editor))
    if pod:
        stmt = stmt.where(NotionArticle.editorial_pod.ilike(f"%{pod}%"))
    if client:
        stmt = stmt.where(NotionArticle.client_name == client)
    if year:
        stmt = stmt.where(extract("year", NotionArticle.article_delivered_date) == year)

    articles = session.execute(stmt).scalars().all()
    days_list = []
    for a in articles:
        delta = (a.article_delivered_date - a.cb_delivered_date).days
        if 0 < delta < 365:
            days_list.append(delta)

    if not days_list:
        return {
            "avg_days": None,
            "median_days": None,
            "count": 0,
            "min_days": None,
            "max_days": None,
        }

    days_list.sort()
    mid = len(days_list) // 2
    median = (
        days_list[mid] if len(days_list) % 2 == 1 else (days_list[mid - 1] + days_list[mid]) / 2
    )

    return {
        "avg_days": round(sum(days_list) / len(days_list), 1),
        "median_days": round(median, 1),
        "count": len(days_list),
        "min_days": min(days_list),
        "max_days": max(days_list),
    }


def compute_second_reviews(
    session: Session,
    *,
    year: int | None = None,
) -> dict:
    """Count articles reviewed by each Sr Editor."""
    stmt = select(NotionArticle).where(
        NotionArticle.sr_editor.isnot(None),
        NotionArticle.sr_editor != "",
    )

    if year:
        stmt = stmt.where(extract("year", NotionArticle.created_date) == year)

    articles = session.execute(stmt).scalars().all()
    by_member: Counter[str] = Counter()
    for a in articles:
        if a.sr_editor:
            by_member[a.sr_editor.strip()] += 1

    return {
        "by_member": dict(by_member.most_common()),
        "total": sum(by_member.values()),
    }


def compute_summary(session: Session) -> dict:
    """Full summary stats from Notion articles."""
    total = session.execute(select(func.count(NotionArticle.id))).scalar() or 0

    # Status breakdown
    status_rows = session.execute(
        select(NotionArticle.article_status, func.count(NotionArticle.id))
        .where(NotionArticle.article_status.isnot(None))
        .group_by(NotionArticle.article_status)
    ).all()
    status_breakdown = {s: c for s, c in status_rows}

    # Revision rate
    rev = compute_revision_rate(session)

    # Turnaround
    turn = compute_turnaround_time(session)

    # Second reviews
    sr = compute_second_reviews(session)

    # Client count
    clients_count = (
        session.execute(select(func.count(func.distinct(NotionArticle.client_name)))).scalar() or 0
    )

    # Pod breakdown
    pod_rows = session.execute(
        select(NotionArticle.editorial_pod, func.count(NotionArticle.id))
        .where(NotionArticle.editorial_pod.isnot(None))
        .group_by(NotionArticle.editorial_pod)
    ).all()
    pods_breakdown = {p: c for p, c in pod_rows}

    return {
        "total_articles": total,
        "status_breakdown": status_breakdown,
        "revision_rate": rev["rate"],
        "revision_count": rev["revision_count"],
        "avg_turnaround_days": turn["avg_days"],
        "median_turnaround_days": turn["median_days"],
        "turnaround_count": turn["count"],
        "second_review_count": sr["total"],
        "clients_count": clients_count,
        "pods_breakdown": pods_breakdown,
    }


# ---------------------------------------------------------------------------
# Write real KPIs into kpi_scores table
# ---------------------------------------------------------------------------


def _normalize_team_name(name: str) -> str:
    """Normalize team member names for matching."""
    return name.strip().lower()


def refresh_notion_kpis(session: Session, year: int, month: int) -> dict:
    """Compute real KPIs from Notion + capacity data and upsert into kpi_scores table.

    Replaces mock values for: revision_rate, turnaround_time, second_reviews, capacity_utilization.
    """
    # Get all team members
    members = (
        session.execute(select(TeamMember).where(TeamMember.is_active.is_(True))).scalars().all()
    )

    # Get capacity projections for the requested month (per pod)
    cap_rows = (
        session.execute(
            select(CapacityProjection).where(
                CapacityProjection.year == year,
                CapacityProjection.month == month,
            )
        )
        .scalars()
        .all()
    )
    pod_utilization: dict[str, float] = {}
    for cp in cap_rows:
        if cp.total_capacity and cp.total_capacity > 0:
            used = cp.projected_used_capacity or cp.actual_used_capacity or 0
            pod_utilization[cp.pod] = round((used / cp.total_capacity) * 100, 1)

    # Build lookup: normalized name → TeamMember
    member_by_name: dict[str, TeamMember] = {}
    for m in members:
        member_by_name[_normalize_team_name(m.name)] = m

    # Get all Notion articles for matching
    articles = session.execute(select(NotionArticle)).scalars().all()

    # Build editor → articles mapping
    editor_articles: dict[str, list[NotionArticle]] = {}
    sr_editor_articles: dict[str, list[NotionArticle]] = {}
    for a in articles:
        if a.editor:
            editor_articles.setdefault(_normalize_team_name(a.editor), []).append(a)
        if a.sr_editor:
            sr_editor_articles.setdefault(_normalize_team_name(a.sr_editor), []).append(a)

    updated = 0

    for member in members:
        norm_name = _normalize_team_name(member.name)

        # --- Revision Rate ---
        my_articles = editor_articles.get(norm_name, []) + sr_editor_articles.get(norm_name, [])
        if my_articles:
            total = len(my_articles)
            revisions = sum(1 for a in my_articles if a.article_status in REVISION_STATUSES)
            rev_score = round((revisions / total) * 100, 1) if total > 0 else 0.0
        else:
            rev_score = None

        if rev_score is not None:
            _upsert_kpi(session, member.id, year, month, "revision_rate", rev_score, 15.0)
            updated += 1

        # --- Turnaround Time ---
        turnaround_days = []
        for a in my_articles:
            if a.cb_delivered_date and a.article_delivered_date:
                delta = (a.article_delivered_date - a.cb_delivered_date).days
                if 0 < delta < 365:
                    turnaround_days.append(delta)

        if turnaround_days:
            avg_turn = round(sum(turnaround_days) / len(turnaround_days), 1)
            _upsert_kpi(session, member.id, year, month, "turnaround_time", avg_turn, 14.0)
            updated += 1

        # --- Second Reviews (SE only) ---
        if member.role == "SENIOR_EDITOR":
            sr_articles = sr_editor_articles.get(norm_name, [])
            # Filter by month using created_date for monthly granularity
            monthly_sr = [
                a
                for a in sr_articles
                if a.created_date and a.created_date.year == year and a.created_date.month == month
            ]
            sr_count = (
                len(monthly_sr) if monthly_sr else len(sr_articles) // max(1, 6)
            )  # fallback: avg over 6 months
            _upsert_kpi(session, member.id, year, month, "second_reviews", float(sr_count), 5.0)
            updated += 1

        # --- Capacity Utilization (from capacity_projections, per pod) ---
        if member.pod and member.pod in pod_utilization:
            util_score = pod_utilization[member.pod]
            _upsert_kpi(session, member.id, year, month, "capacity_utilization", util_score, 82.5)
            updated += 1

    session.commit()
    logger.info(f"Notion KPIs refreshed: {updated} scores updated for {year}-{month:02d}")
    return {"updated": updated, "members_processed": len(members)}


def _upsert_kpi(
    session: Session,
    team_member_id: int,
    year: int,
    month: int,
    kpi_type: str,
    score: float,
    target: float,
) -> None:
    """Insert or update a single KPI score."""
    existing = session.execute(
        select(KpiScore).where(
            KpiScore.team_member_id == team_member_id,
            KpiScore.year == year,
            KpiScore.month == month,
            KpiScore.kpi_type == kpi_type,
            KpiScore.client_id.is_(None),
        )
    ).scalar_one_or_none()

    if existing:
        existing.score = score
        existing.target = target
        existing.notes = "computed from Notion article data"
        existing.updated_by = "notion_kpi_refresh"
    else:
        session.add(
            KpiScore(
                team_member_id=team_member_id,
                year=year,
                month=month,
                kpi_type=kpi_type,
                score=score,
                target=target,
                notes="computed from Notion article data",
                updated_by="notion_kpi_refresh",
            )
        )
