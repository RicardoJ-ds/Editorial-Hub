from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import KpiScore
from app.schemas import KpiScoreCreate, KpiScoreResponse, KpiScoreUpdate

router = APIRouter()


@router.get("/", response_model=list[KpiScoreResponse])
async def list_kpi_scores(
    team_member_id: int | None = None,
    year: int | None = None,
    month: int | None = None,
    # Inclusive (year, month) range — clients use these to fetch a span
    # (e.g. "Jan 2026 → Apr 2026") in one call so the frontend can aggregate
    # across the active date filter without N round-trips. The boundaries
    # are converted to a YYYY*100+MM ordinal so the comparison handles
    # cross-year ranges (e.g. Nov 2025 → Feb 2026) correctly.
    year_from: int | None = None,
    month_from: int | None = None,
    year_to: int | None = None,
    month_to: int | None = None,
    kpi_type: str | None = None,
    client_id: int | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=10000),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(KpiScore)

    if team_member_id is not None:
        stmt = stmt.where(KpiScore.team_member_id == team_member_id)
    if year is not None:
        stmt = stmt.where(KpiScore.year == year)
    if month is not None:
        stmt = stmt.where(KpiScore.month == month)
    if kpi_type:
        stmt = stmt.where(KpiScore.kpi_type == kpi_type)
    if client_id is not None:
        stmt = stmt.where(KpiScore.client_id == client_id)

    # Range filter — only applies if both year_from + month_from are given
    # (and matching pair on the upper bound). Each side is independent.
    ordinal = KpiScore.year * 100 + KpiScore.month
    if year_from is not None and month_from is not None:
        stmt = stmt.where(ordinal >= year_from * 100 + month_from)
    if year_to is not None and month_to is not None:
        stmt = stmt.where(ordinal <= year_to * 100 + month_to)

    stmt = stmt.offset(skip).limit(limit).order_by(KpiScore.year.desc(), KpiScore.month.desc())
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{kpi_id}", response_model=KpiScoreResponse)
async def get_kpi_score(
    kpi_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(KpiScore).where(KpiScore.id == kpi_id))
    kpi = result.scalar_one_or_none()
    if not kpi:
        raise HTTPException(status_code=404, detail="KPI score not found")
    return kpi


@router.post("/", response_model=KpiScoreResponse, status_code=201)
async def create_kpi_score(
    payload: KpiScoreCreate,
    db: AsyncSession = Depends(get_db),
):
    kpi = KpiScore(**payload.model_dump())
    db.add(kpi)
    await db.commit()
    await db.refresh(kpi)
    return kpi


@router.put("/{kpi_id}", response_model=KpiScoreResponse)
async def update_kpi_score(
    kpi_id: int,
    payload: KpiScoreUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(KpiScore).where(KpiScore.id == kpi_id))
    kpi = result.scalar_one_or_none()
    if not kpi:
        raise HTTPException(status_code=404, detail="KPI score not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(kpi, field, value)

    await db.commit()
    await db.refresh(kpi)
    return kpi


@router.post("/bulk", response_model=list[KpiScoreResponse], status_code=201)
async def bulk_create_kpi_scores(
    payloads: list[KpiScoreCreate],
    db: AsyncSession = Depends(get_db),
):
    kpis = []
    for payload in payloads:
        kpi = KpiScore(**payload.model_dump())
        db.add(kpi)
        kpis.append(kpi)

    await db.commit()
    for kpi in kpis:
        await db.refresh(kpi)
    return kpis
