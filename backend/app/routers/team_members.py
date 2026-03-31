from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import TeamMember
from app.schemas import TeamMemberCreate, TeamMemberResponse, TeamMemberUpdate

router = APIRouter()


@router.get("/", response_model=list[TeamMemberResponse])
async def list_team_members(
    role: str | None = None,
    pod: str | None = None,
    is_active: bool | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(TeamMember)

    if role:
        stmt = stmt.where(TeamMember.role == role)
    if pod:
        stmt = stmt.where(TeamMember.pod == pod)
    if is_active is not None:
        stmt = stmt.where(TeamMember.is_active == is_active)

    stmt = stmt.offset(skip).limit(limit).order_by(TeamMember.name)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{member_id}", response_model=TeamMemberResponse)
async def get_team_member(
    member_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(TeamMember).where(TeamMember.id == member_id))
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")
    return member


@router.post("/", response_model=TeamMemberResponse, status_code=201)
async def create_team_member(
    payload: TeamMemberCreate,
    db: AsyncSession = Depends(get_db),
):
    member = TeamMember(**payload.model_dump())
    db.add(member)
    await db.commit()
    await db.refresh(member)
    return member


@router.put("/{member_id}", response_model=TeamMemberResponse)
async def update_team_member(
    member_id: int,
    payload: TeamMemberUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(TeamMember).where(TeamMember.id == member_id))
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(member, field, value)

    await db.commit()
    await db.refresh(member)
    return member


@router.delete("/{member_id}", status_code=204)
async def delete_team_member(
    member_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(TeamMember).where(TeamMember.id == member_id))
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")

    await db.delete(member)
    await db.commit()
