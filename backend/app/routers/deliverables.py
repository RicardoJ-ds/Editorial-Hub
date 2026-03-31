from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import DeliverableMonthly
from app.schemas import DeliverableCreate, DeliverableResponse, DeliverableUpdate

router = APIRouter()


@router.get("/", response_model=list[DeliverableResponse])
async def list_deliverables(
    client_id: int | None = None,
    year: int | None = None,
    month: int | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(DeliverableMonthly)

    if client_id is not None:
        stmt = stmt.where(DeliverableMonthly.client_id == client_id)
    if year is not None:
        stmt = stmt.where(DeliverableMonthly.year == year)
    if month is not None:
        stmt = stmt.where(DeliverableMonthly.month == month)

    stmt = (
        stmt.offset(skip)
        .limit(limit)
        .order_by(DeliverableMonthly.year.desc(), DeliverableMonthly.month.desc())
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{deliverable_id}", response_model=DeliverableResponse)
async def get_deliverable(
    deliverable_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DeliverableMonthly).where(DeliverableMonthly.id == deliverable_id)
    )
    deliverable = result.scalar_one_or_none()
    if not deliverable:
        raise HTTPException(status_code=404, detail="Deliverable not found")
    return deliverable


@router.post("/", response_model=DeliverableResponse, status_code=201)
async def create_deliverable(
    payload: DeliverableCreate,
    db: AsyncSession = Depends(get_db),
):
    deliverable = DeliverableMonthly(**payload.model_dump())
    db.add(deliverable)
    await db.commit()
    await db.refresh(deliverable)
    return deliverable


@router.put("/{deliverable_id}", response_model=DeliverableResponse)
async def update_deliverable(
    deliverable_id: int,
    payload: DeliverableUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DeliverableMonthly).where(DeliverableMonthly.id == deliverable_id)
    )
    deliverable = result.scalar_one_or_none()
    if not deliverable:
        raise HTTPException(status_code=404, detail="Deliverable not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(deliverable, field, value)

    await db.commit()
    await db.refresh(deliverable)
    return deliverable


@router.post("/bulk", response_model=list[DeliverableResponse], status_code=201)
async def bulk_create_deliverables(
    payloads: list[DeliverableCreate],
    db: AsyncSession = Depends(get_db),
):
    results = []
    for payload in payloads:
        # Check for existing record by client_id + year + month
        stmt = select(DeliverableMonthly).where(
            DeliverableMonthly.client_id == payload.client_id,
            DeliverableMonthly.year == payload.year,
            DeliverableMonthly.month == payload.month,
        )
        result = await db.execute(stmt)
        existing = result.scalar_one_or_none()

        if existing:
            # Update existing record
            for field, value in payload.model_dump().items():
                setattr(existing, field, value)
            results.append(existing)
        else:
            # Create new record
            deliverable = DeliverableMonthly(**payload.model_dump())
            db.add(deliverable)
            results.append(deliverable)

    await db.commit()
    for item in results:
        await db.refresh(item)
    return results
