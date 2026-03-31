"""Goals vs Delivery + Cumulative metrics endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import CumulativeMetric, GoalsVsDelivery
from app.schemas import CumulativeMetricResponse, GoalsVsDeliveryResponse

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
):
    """Get all-time cumulative pipeline metrics per client."""
    stmt = select(CumulativeMetric).order_by(CumulativeMetric.client_name)
    if pod:
        stmt = stmt.where(CumulativeMetric.account_team_pod == pod)
    if status:
        stmt = stmt.where(CumulativeMetric.status == status)
    result = await db.execute(stmt)
    return result.scalars().all()
