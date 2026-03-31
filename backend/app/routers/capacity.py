from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import CapacityProjection
from app.schemas import CapacityCreate, CapacityResponse, CapacityUpdate

router = APIRouter()


@router.get("/", response_model=list[CapacityResponse])
async def list_capacity_projections(
    pod: str | None = None,
    year: int | None = None,
    month: int | None = None,
    version: str | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(CapacityProjection)

    if pod:
        stmt = stmt.where(CapacityProjection.pod == pod)
    if year is not None:
        stmt = stmt.where(CapacityProjection.year == year)
    if month is not None:
        stmt = stmt.where(CapacityProjection.month == month)
    if version:
        stmt = stmt.where(CapacityProjection.version == version)

    stmt = (
        stmt.offset(skip)
        .limit(limit)
        .order_by(CapacityProjection.year.desc(), CapacityProjection.month.desc())
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{capacity_id}", response_model=CapacityResponse)
async def get_capacity_projection(
    capacity_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CapacityProjection).where(CapacityProjection.id == capacity_id)
    )
    projection = result.scalar_one_or_none()
    if not projection:
        raise HTTPException(status_code=404, detail="Capacity projection not found")
    return projection


@router.post("/", response_model=CapacityResponse, status_code=201)
async def create_capacity_projection(
    payload: CapacityCreate,
    db: AsyncSession = Depends(get_db),
):
    projection = CapacityProjection(**payload.model_dump())
    db.add(projection)
    await db.commit()
    await db.refresh(projection)
    return projection


@router.put("/{capacity_id}", response_model=CapacityResponse)
async def update_capacity_projection(
    capacity_id: int,
    payload: CapacityUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CapacityProjection).where(CapacityProjection.id == capacity_id)
    )
    projection = result.scalar_one_or_none()
    if not projection:
        raise HTTPException(status_code=404, detail="Capacity projection not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(projection, field, value)

    await db.commit()
    await db.refresh(projection)
    return projection


@router.post("/bulk", response_model=list[CapacityResponse], status_code=201)
async def bulk_create_capacity_projections(
    payloads: list[CapacityCreate],
    db: AsyncSession = Depends(get_db),
):
    results = []
    for payload in payloads:
        # Check for existing record by pod + year + month + version
        stmt = select(CapacityProjection).where(
            CapacityProjection.pod == payload.pod,
            CapacityProjection.year == payload.year,
            CapacityProjection.month == payload.month,
            CapacityProjection.version == payload.version,
        )
        result = await db.execute(stmt)
        existing = result.scalar_one_or_none()

        if existing:
            for field, value in payload.model_dump().items():
                setattr(existing, field, value)
            results.append(existing)
        else:
            projection = CapacityProjection(**payload.model_dump())
            db.add(projection)
            results.append(projection)

    await db.commit()
    for item in results:
        await db.refresh(item)
    return results
