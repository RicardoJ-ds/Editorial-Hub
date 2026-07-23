"""Goals vs Delivery + Cumulative metrics endpoints."""

import asyncio

from fastapi import APIRouter, Depends
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import GoalsVsDelivery
from app.schemas import CumulativeMetricResponse, GoalsVsDeliveryResponse
from app.services import bq_dashboard
from app.services.bq_dashboard import get_data_source

router = APIRouter()


@router.get("/months", response_model=list[str])
async def available_months(db: AsyncSession = Depends(get_db)):
    """List all available month-year values for Goals vs Delivery data."""
    result = await db.execute(
        select(GoalsVsDelivery.month_year).distinct().order_by(GoalsVsDelivery.month_year)
    )
    return [r[0] for r in result.all()]


@router.get("/latest", response_model=list[GoalsVsDeliveryResponse])
async def goals_delivery_latest(
    pod: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Get Goals vs Delivery data for the latest available month."""
    # Find the latest month
    latest_result = await db.execute(
        select(GoalsVsDelivery.month_year)
        .distinct()
        .order_by(GoalsVsDelivery.month_year.desc())
        .limit(1)
    )
    latest_row = latest_result.first()
    if not latest_row:
        return []

    month_year = latest_row[0]
    stmt = (
        select(GoalsVsDelivery)
        .where(GoalsVsDelivery.month_year == month_year)
        .order_by(GoalsVsDelivery.client_name)
    )
    if pod:
        stmt = stmt.where(
            (GoalsVsDelivery.growth_team_pod == pod) | (GoalsVsDelivery.editorial_team_pod == pod)
        )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/all", response_model=list[GoalsVsDeliveryResponse])
async def goals_delivery_all(
    pod: str | None = None,
    db: AsyncSession = Depends(get_db),
    source: str = Depends(get_data_source),
):
    if source == "bq":
        return await asyncio.to_thread(bq_dashboard.goals_all, pod)
    """Return every Goals vs Delivery row we have on hand.

    Intended for the Deliverables-vs-SOW page's month-range view: the client
    slices rows by the global date-range filter without round-tripping per
    month. With ~9 month tabs × ~25 clients × 4 weeks ≈ 900 rows the payload
    is small and sortable.
    """
    stmt = select(GoalsVsDelivery).order_by(
        GoalsVsDelivery.month_year,
        GoalsVsDelivery.week_number,
        GoalsVsDelivery.client_name,
        GoalsVsDelivery.id,
    )
    if pod:
        stmt = stmt.where(
            (GoalsVsDelivery.growth_team_pod == pod) | (GoalsVsDelivery.editorial_team_pod == pod)
        )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/by-month/{month_year}", response_model=list[GoalsVsDeliveryResponse])
async def goals_delivery_by_month(
    month_year: str,
    pod: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Get Goals vs Delivery data for a specific month."""
    stmt = (
        select(GoalsVsDelivery)
        .where(GoalsVsDelivery.month_year == month_year)
        .order_by(GoalsVsDelivery.client_name)
    )
    if pod:
        stmt = stmt.where(
            (GoalsVsDelivery.growth_team_pod == pod) | (GoalsVsDelivery.editorial_team_pod == pod)
        )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/cumulative", response_model=list[CumulativeMetricResponse])
async def cumulative_metrics(
    pod: str | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    source: str = Depends(get_data_source),
):
    """Get all-time cumulative pipeline metrics per client."""
    if source == "bq":
        return await asyncio.to_thread(bq_dashboard.goals_cumulative, pod, status)
    # Postgres serving path (local / rollback): mirror the BQ weighted rollup —
    # one row per client, content-type weighted (article x1, jumbo x2, glossary/LP
    # x0.5; Webflow raw x1). cumulative_metrics has one row per (client, content_type).
    sql = text(
        """
        SELECT MIN(id) AS id, MAX(status) AS status,
               MAX(account_team_pod) AS account_team_pod, client_name,
               MAX(client_type) AS client_type, NULL::text AS content_type,
               CAST(ROUND(SUM(topics_sent * w)::numeric) AS INTEGER) AS topics_sent,
               CAST(ROUND(SUM(topics_approved * w)::numeric) AS INTEGER) AS topics_approved,
               CASE WHEN SUM(topics_sent * w) > 0 THEN ROUND(SUM(topics_approved * w)::numeric / SUM(topics_sent * w)::numeric * 100)::int::text || '%' END AS topics_pct_approved,
               CAST(ROUND(SUM(cbs_sent * w)::numeric) AS INTEGER) AS cbs_sent,
               CAST(ROUND(SUM(cbs_approved * w)::numeric) AS INTEGER) AS cbs_approved,
               CASE WHEN SUM(cbs_sent * w) > 0 THEN ROUND(SUM(cbs_approved * w)::numeric / SUM(cbs_sent * w)::numeric * 100)::int::text || '%' END AS cbs_pct_approved,
               CAST(ROUND(SUM(articles_sent * w)::numeric) AS INTEGER) AS articles_sent,
               CAST(ROUND(SUM(articles_approved * w)::numeric) AS INTEGER) AS articles_approved,
               CAST(ROUND((SUM(articles_sent * w) - SUM(articles_approved * w))::numeric) AS INTEGER) AS articles_difference,
               CASE WHEN SUM(articles_sent * w) > 0 THEN ROUND(SUM(articles_approved * w)::numeric / SUM(articles_sent * w)::numeric * 100)::int::text || '%' END AS articles_pct_approved,
               CAST(ROUND(SUM(published_live * w)::numeric) AS INTEGER) AS published_live,
               CASE WHEN SUM(articles_sent * w) > 0 THEN ROUND(SUM(published_live * w)::numeric / SUM(articles_sent * w)::numeric * 100)::int::text || '%' END AS published_pct_live,
               MAX(last_update) AS last_update, MAX(comments) AS comments
        FROM (
            SELECT *,
              CASE
                WHEN client_name = 'Webflow' THEN 1.0
                WHEN LOWER(content_type) = 'jumbo' THEN 2.0
                WHEN LOWER(content_type) IN ('lp', 'landing page', 'landing pages', 'glossary') THEN 0.5
                ELSE 1.0
              END AS w
            FROM cumulative_metrics
            WHERE (:pod IS NULL OR account_team_pod = :pod)
              AND (:status IS NULL OR status = :status)
        ) sub
        GROUP BY client_name
        ORDER BY client_name
        """
    )
    result = await db.execute(sql, {"pod": pod, "status": status})
    return [dict(r._mapping) for r in result]
