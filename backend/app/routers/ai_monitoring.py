"""AI Monitoring endpoints — Writer AI percentage tracking and compliance."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AIMonitoringRecord, SurferAPIUsage
from app.schemas import (
    AIMonitoringBreakdown,
    AIMonitoringRecordResponse,
    AIMonitoringSummary,
    SurferAPIUsageResponse,
)

router = APIRouter()


def _recommendation_agg():
    """Return SQLAlchemy column expressions for recommendation counts."""
    return (
        func.count().label("total"),
        func.sum(case((AIMonitoringRecord.recommendation == "FULL_PASS", 1), else_=0)).label(
            "full_pass"
        ),
        func.sum(case((AIMonitoringRecord.recommendation == "PARTIAL_PASS", 1), else_=0)).label(
            "partial_pass"
        ),
        func.sum(case((AIMonitoringRecord.recommendation == "REVIEW_REWRITE", 1), else_=0)).label(
            "review_rewrite"
        ),
    )


def _apply_filters(stmt, pod=None, client=None, month=None, writer=None, editor=None):
    """Apply optional filters to a query."""
    if pod:
        stmt = stmt.where(AIMonitoringRecord.pod == pod)
    if client:
        stmt = stmt.where(AIMonitoringRecord.client == client)
    if month:
        stmt = stmt.where(AIMonitoringRecord.month == month)
    if writer:
        stmt = stmt.where(AIMonitoringRecord.writer_name == writer)
    if editor:
        stmt = stmt.where(AIMonitoringRecord.editor_name == editor)
    # Exclude rewrites from main stats by default
    stmt = stmt.where(AIMonitoringRecord.is_rewrite == False)  # noqa: E712
    return stmt


@router.get("/summary", response_model=AIMonitoringSummary)
async def ai_monitoring_summary(
    pod: str | None = None,
    client: str | None = None,
    month: str | None = None,
    writer: str | None = None,
    editor: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    total_col, fp_col, pp_col, rr_col = _recommendation_agg()
    stmt = select(total_col, fp_col, pp_col, rr_col)
    stmt = _apply_filters(stmt, pod, client, month, writer, editor)
    result = await db.execute(stmt)
    row = result.one()

    total = row[0] or 0
    full_pass = row[1] or 0
    partial_pass = row[2] or 0
    review_rewrite = row[3] or 0

    return AIMonitoringSummary(
        total=total,
        full_pass=full_pass,
        partial_pass=partial_pass,
        review_rewrite=review_rewrite,
        full_pass_rate=round(full_pass / total * 100, 1) if total > 0 else 0,
        partial_pass_rate=round(partial_pass / total * 100, 1) if total > 0 else 0,
        review_rewrite_rate=round(review_rewrite / total * 100, 1) if total > 0 else 0,
    )


@router.get("/by-pod", response_model=list[AIMonitoringBreakdown])
async def ai_monitoring_by_pod(
    month: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    total_col, fp_col, pp_col, rr_col = _recommendation_agg()
    stmt = (
        select(AIMonitoringRecord.pod, total_col, fp_col, pp_col, rr_col)
        .where(AIMonitoringRecord.is_rewrite == False)  # noqa: E712
        .group_by(AIMonitoringRecord.pod)
        .order_by(AIMonitoringRecord.pod)
    )
    if month:
        stmt = stmt.where(AIMonitoringRecord.month == month)
    result = await db.execute(stmt)
    return [
        AIMonitoringBreakdown(
            name=r[0], total=r[1], full_pass=r[2], partial_pass=r[3], review_rewrite=r[4]
        )
        for r in result.all()
    ]


@router.get("/by-client", response_model=list[AIMonitoringBreakdown])
async def ai_monitoring_by_client(
    pod: str | None = None,
    month: str | None = None,
    limit: int = Query(default=25, le=100),
    db: AsyncSession = Depends(get_db),
):
    total_col, fp_col, pp_col, rr_col = _recommendation_agg()
    stmt = (
        select(AIMonitoringRecord.client, total_col, fp_col, pp_col, rr_col)
        .where(AIMonitoringRecord.is_rewrite == False)  # noqa: E712
        .group_by(AIMonitoringRecord.client)
        .order_by(func.count().desc())
        .limit(limit)
    )
    if pod:
        stmt = stmt.where(AIMonitoringRecord.pod == pod)
    if month:
        stmt = stmt.where(AIMonitoringRecord.month == month)
    result = await db.execute(stmt)
    return [
        AIMonitoringBreakdown(
            name=r[0], total=r[1], full_pass=r[2], partial_pass=r[3], review_rewrite=r[4]
        )
        for r in result.all()
    ]


@router.get("/by-writer", response_model=list[AIMonitoringBreakdown])
async def ai_monitoring_by_writer(
    pod: str | None = None,
    month: str | None = None,
    limit: int = Query(default=25, le=100),
    db: AsyncSession = Depends(get_db),
):
    total_col, fp_col, pp_col, rr_col = _recommendation_agg()
    stmt = (
        select(AIMonitoringRecord.writer_name, total_col, fp_col, pp_col, rr_col)
        .where(
            AIMonitoringRecord.is_rewrite == False,  # noqa: E712
            AIMonitoringRecord.writer_name.isnot(None),
            AIMonitoringRecord.writer_name != "",
        )
        .group_by(AIMonitoringRecord.writer_name)
        .order_by(func.count().desc())
        .limit(limit)
    )
    if pod:
        stmt = stmt.where(AIMonitoringRecord.pod == pod)
    if month:
        stmt = stmt.where(AIMonitoringRecord.month == month)
    result = await db.execute(stmt)
    return [
        AIMonitoringBreakdown(
            name=r[0], total=r[1], full_pass=r[2], partial_pass=r[3], review_rewrite=r[4]
        )
        for r in result.all()
    ]


@router.get("/by-month", response_model=list[AIMonitoringBreakdown])
async def ai_monitoring_by_month(
    pod: str | None = None,
    client: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    total_col, fp_col, pp_col, rr_col = _recommendation_agg()
    stmt = (
        select(AIMonitoringRecord.month, total_col, fp_col, pp_col, rr_col)
        .where(
            AIMonitoringRecord.is_rewrite == False,  # noqa: E712
            AIMonitoringRecord.month.isnot(None),
            AIMonitoringRecord.month != "",
        )
        .group_by(AIMonitoringRecord.month)
        .order_by(AIMonitoringRecord.month)
    )
    if pod:
        stmt = stmt.where(AIMonitoringRecord.pod == pod)
    if client:
        stmt = stmt.where(AIMonitoringRecord.client == client)
    result = await db.execute(stmt)
    return [
        AIMonitoringBreakdown(
            name=r[0], total=r[1], full_pass=r[2], partial_pass=r[3], review_rewrite=r[4]
        )
        for r in result.all()
    ]


@router.get("/flags", response_model=list[AIMonitoringRecordResponse])
async def ai_monitoring_flags(
    pod: str | None = None,
    client: str | None = None,
    limit: int = Query(default=50, le=200),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(AIMonitoringRecord)
        .where(AIMonitoringRecord.is_flagged == True)  # noqa: E712
        .order_by(AIMonitoringRecord.date_processed.desc())
        .limit(limit)
        .offset(offset)
    )
    if pod:
        stmt = stmt.where(AIMonitoringRecord.pod == pod)
    if client:
        stmt = stmt.where(AIMonitoringRecord.client == client)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/rewrites", response_model=list[AIMonitoringRecordResponse])
async def ai_monitoring_rewrites(
    client: str | None = None,
    limit: int = Query(default=50, le=200),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(AIMonitoringRecord)
        .where(AIMonitoringRecord.is_rewrite == True)  # noqa: E712
        .order_by(AIMonitoringRecord.date_processed.desc())
        .limit(limit)
        .offset(offset)
    )
    if client:
        stmt = stmt.where(AIMonitoringRecord.client == client)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/surfer-usage", response_model=list[SurferAPIUsageResponse])
async def surfer_usage(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SurferAPIUsage).order_by(SurferAPIUsage.id))
    return result.scalars().all()
