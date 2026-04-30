from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Client, ProductionHistory
from app.schemas import ClientCreate, ClientResponse, ClientUpdate

router = APIRouter()


async def _operating_model_end_dates(db: AsyncSession, client_ids: list[int]) -> dict[int, date]:
    """For each client, find the latest (year, month) with non-zero production
    (actual or projected) in `production_history`. Returns a map of
    client_id -> date(year, month, 1). Empty when no rows exist."""
    if not client_ids:
        return {}
    stmt = (
        select(
            ProductionHistory.client_id,
            func.max(ProductionHistory.year * 100 + ProductionHistory.month).label("ym"),
        )
        .where(ProductionHistory.client_id.in_(client_ids))
        .where(
            or_(
                ProductionHistory.articles_actual > 0,
                ProductionHistory.articles_projected > 0,
            )
        )
        .group_by(ProductionHistory.client_id)
    )
    result = await db.execute(stmt)
    out: dict[int, date] = {}
    for cid, ym in result.all():
        if ym is None:
            continue
        y, m = divmod(int(ym), 100)
        out[cid] = date(y, m, 1)
    return out


@router.get("/", response_model=list[ClientResponse])
async def list_clients(
    search: str | None = None,
    status: str | None = None,
    growth_pod: str | None = None,
    editorial_pod: str | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Client)

    if search:
        stmt = stmt.where(Client.name.ilike(f"%{search}%"))
    if status:
        stmt = stmt.where(Client.status == status)
    if growth_pod:
        stmt = stmt.where(Client.growth_pod == growth_pod)
    if editorial_pod:
        stmt = stmt.where(Client.editorial_pod == editorial_pod)

    stmt = stmt.offset(skip).limit(limit).order_by(Client.name)
    result = await db.execute(stmt)
    clients = result.scalars().all()

    end_map = await _operating_model_end_dates(db, [c.id for c in clients])
    out: list[ClientResponse] = []
    for c in clients:
        item = ClientResponse.model_validate(c)
        item.operating_model_end_date = end_map.get(c.id)
        out.append(item)
    return out


@router.get("/{client_id}", response_model=ClientResponse)
async def get_client(
    client_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    end_map = await _operating_model_end_dates(db, [client.id])
    item = ClientResponse.model_validate(client)
    item.operating_model_end_date = end_map.get(client.id)
    return item


@router.post("/", response_model=ClientResponse, status_code=201)
async def create_client(
    payload: ClientCreate,
    db: AsyncSession = Depends(get_db),
):
    client = Client(**payload.model_dump())
    db.add(client)
    await db.commit()
    await db.refresh(client)
    return client


@router.put("/{client_id}", response_model=ClientResponse)
async def update_client(
    client_id: int,
    payload: ClientUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(client, field, value)

    await db.commit()
    await db.refresh(client)
    return client


@router.delete("/{client_id}", status_code=204)
async def delete_client(
    client_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    await db.delete(client)
    await db.commit()
