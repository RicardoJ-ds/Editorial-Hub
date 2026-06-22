"""Compute the Notion-derived KPIs (Revision Rate / Turnaround / Second Reviews)
from the BigQuery content machine and upsert them into `kpi_scores`.

The Notion data is no longer ingested into Neon — it's read live from BigQuery
via `notion_bq.fetch_notion_content()`. Capacity Utilization still comes from
`capacity_projections`.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CapacityProjection, KpiScore, TeamMember
from app.services.notion_bq import NotionRow, fetch_notion_content

logger = logging.getLogger(__name__)

REVISION_STATUSES = {
    "Client Revision Needed",
    "Client Revision Ready",
    "Client Revision In Progress (Account Team)",
}


def _normalize_team_name(name: str) -> str:
    """Normalize team member names for matching."""
    return name.strip().lower()


def refresh_notion_kpis(
    session: Session,
    year: int,
    month: int,
    notion_rows: list[NotionRow] | None = None,
) -> dict:
    """Compute real KPIs from the BQ content machine + capacity data and upsert
    into kpi_scores: revision_rate, turnaround_time, second_reviews,
    capacity_utilization.

    Pass `notion_rows` to reuse a single BQ fetch across a multi-month loop
    (`refresh_computed_kpis` does this); otherwise it fetches once here.
    """
    if notion_rows is None:
        notion_rows = fetch_notion_content()

    members = (
        session.execute(select(TeamMember).where(TeamMember.is_active.is_(True))).scalars().all()
    )

    # Per-pod capacity utilization for the requested month.
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

    # Build editor → rows mapping (by normalized name).
    editor_articles: dict[str, list[NotionRow]] = {}
    sr_editor_articles: dict[str, list[NotionRow]] = {}
    for a in notion_rows:
        if a.editor:
            editor_articles.setdefault(_normalize_team_name(a.editor), []).append(a)
        if a.sr_editor:
            sr_editor_articles.setdefault(_normalize_team_name(a.sr_editor), []).append(a)

    updated = 0
    for member in members:
        norm_name = _normalize_team_name(member.name)
        my_articles = editor_articles.get(norm_name, []) + sr_editor_articles.get(norm_name, [])

        # --- Revision Rate ---
        if my_articles:
            total = len(my_articles)
            revisions = sum(1 for a in my_articles if a.article_status in REVISION_STATUSES)
            rev_score = round((revisions / total) * 100, 1) if total > 0 else 0.0
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
            monthly_sr = [
                a
                for a in sr_articles
                if a.created_date and a.created_date.year == year and a.created_date.month == month
            ]
            sr_count = len(monthly_sr) if monthly_sr else len(sr_articles) // max(1, 6)
            _upsert_kpi(session, member.id, year, month, "second_reviews", float(sr_count), 5.0)
            updated += 1

        # --- Capacity Utilization (from capacity_projections, per pod) ---
        if member.pod and member.pod in pod_utilization:
            util_score = pod_utilization[member.pod]
            _upsert_kpi(session, member.id, year, month, "capacity_utilization", util_score, 82.5)
            updated += 1

    session.commit()
    logger.info("Notion KPIs refreshed: %d scores updated for %d-%02d", updated, year, month)
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
        existing.notes = "computed from Notion content machine (BigQuery)"
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
                notes="computed from Notion content machine (BigQuery)",
                updated_by="notion_kpi_refresh",
            )
        )
