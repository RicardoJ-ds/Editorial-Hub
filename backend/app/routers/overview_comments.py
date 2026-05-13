"""Right-rail comments for the Overview dashboard.

Endpoints:
    GET    /api/overview/comments            — list, filterable by section/client
    POST   /api/overview/comments            — admin OR leadership, create
    POST   /api/overview/comments/{id}/resolve — admin OR leadership, mark resolved
    POST   /api/overview/comments/{id}/reopen  — admin OR leadership, clear resolution
    DELETE /api/overview/comments/{id}        — admin OR leadership, remove

Comments are read by anyone with the `overview` view permission so the
rail renders for VPs and Leadership too. Mutations are gated to admins
and the seeded Leadership group (VPs / managers) per spec — Editorial
Team / Growth Team / BI Team are read-only.

Two flavors of comment live in the same `overview_comments` table:
  • `section_id = "general"` — top-level client notes shown in the new
    upper-right Client Comments rail.
  • any other `section_id` — section-anchored (e.g. "time-to-metrics")
    rendered inline next to the section's title via SectionCommentIcon.

Both render together in the new rail (filtered by the current client /
pod selection); section comments also keep their inline icon for now.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_deps import require_admin_or_leadership, require_view
from app.database import get_db
from app.models import OverviewComment
from app.schemas import OverviewCommentResponse
from app.services.access import AccessProfile

router = APIRouter()


class CreateCommentBody(BaseModel):
    section_id: str = Field(min_length=1, max_length=80)
    # Optional — the right-rail "general" composer leaves this null when
    # the comment isn't tied to a specific client.
    client_name: str | None = Field(default=None, max_length=255)
    body: str = Field(min_length=1, max_length=4000)


@router.get("/", response_model=list[OverviewCommentResponse])
async def list_comments(
    db: Annotated[AsyncSession, Depends(get_db)],
    section_id: str | None = Query(default=None),
    client_name: str | None = Query(default=None),
    include_resolved: bool = Query(default=True),
    _: AccessProfile = Depends(require_view("overview")),
):
    stmt = select(OverviewComment).order_by(OverviewComment.created_at.asc())
    if section_id:
        stmt = stmt.where(OverviewComment.section_id == section_id)
    if client_name:
        stmt = stmt.where(OverviewComment.client_name == client_name)
    if not include_resolved:
        stmt = stmt.where(OverviewComment.resolved_at.is_(None))
    rows = (await db.execute(stmt)).scalars().all()
    return rows


@router.post("/", response_model=OverviewCommentResponse, status_code=201)
async def create_comment(
    body: CreateCommentBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: AccessProfile = Depends(require_admin_or_leadership),
):
    client_name = body.client_name.strip() if body.client_name else None
    comment = OverviewComment(
        section_id=body.section_id.strip(),
        client_name=client_name or None,
        author_email=actor.email,
        author_name=None,  # frontend can backfill from /api/me cache later
        body=body.body.strip(),
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return comment


@router.post("/{comment_id}/resolve", response_model=OverviewCommentResponse)
async def resolve_comment(
    comment_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: AccessProfile = Depends(require_admin_or_leadership),
):
    comment = (
        await db.execute(select(OverviewComment).where(OverviewComment.id == comment_id))
    ).scalar_one_or_none()
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    comment.resolved_at = datetime.utcnow()
    comment.resolved_by_email = actor.email
    await db.commit()
    await db.refresh(comment)
    return comment


@router.post("/{comment_id}/reopen", response_model=OverviewCommentResponse)
async def reopen_comment(
    comment_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: AccessProfile = Depends(require_admin_or_leadership),
):
    comment = (
        await db.execute(select(OverviewComment).where(OverviewComment.id == comment_id))
    ).scalar_one_or_none()
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    comment.resolved_at = None
    comment.resolved_by_email = None
    await db.commit()
    await db.refresh(comment)
    return comment


@router.delete("/{comment_id}", status_code=204)
async def delete_comment(
    comment_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: AccessProfile = Depends(require_admin_or_leadership),
):
    comment = (
        await db.execute(select(OverviewComment).where(OverviewComment.id == comment_id))
    ).scalar_one_or_none()
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    await db.delete(comment)
    await db.commit()
    return None
