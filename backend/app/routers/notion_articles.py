"""Notion articles endpoints — article-level pipeline and computed KPIs."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session as SyncSession

from app.config import settings
from app.models import NotionArticle
from app.schemas import NotionArticleResponse, NotionSummaryResponse
from app.services.notion_kpi_service import (
    compute_revision_rate,
    compute_second_reviews,
    compute_summary,
    compute_turnaround_time,
    refresh_notion_kpis,
)

router = APIRouter()


def _get_sync_session() -> SyncSession:
    url = settings.database_url
    if "+asyncpg" in url:
        url = url.replace("+asyncpg", "")
    engine = create_engine(url, echo=False)
    return SyncSession(engine)


@router.get("/", response_model=list[NotionArticleResponse])
async def list_articles(
    client: str | None = None,
    pod: str | None = None,
    status: str | None = None,
    writer: str | None = None,
    editor: str | None = None,
    month: str | None = None,
    skip: int = 0,
    limit: int = 100,
):
    """List Notion articles with filters."""

    def _run():
        session = _get_sync_session()
        try:
            stmt = select(NotionArticle)
            if client:
                stmt = stmt.where(NotionArticle.client_name == client)
            if pod:
                stmt = stmt.where(NotionArticle.editorial_pod.ilike(f"%{pod}%"))
            if status:
                stmt = stmt.where(NotionArticle.article_status == status)
            if writer:
                stmt = stmt.where(NotionArticle.writer == writer)
            if editor:
                stmt = stmt.where(
                    (NotionArticle.editor == editor) | (NotionArticle.sr_editor == editor)
                )
            if month:
                stmt = stmt.where(NotionArticle.month == month)
            stmt = stmt.order_by(NotionArticle.created_date.desc()).offset(skip).limit(limit)
            return session.execute(stmt).scalars().all()
        finally:
            session.close()

    rows = await asyncio.to_thread(_run)
    return rows


@router.get("/summary", response_model=NotionSummaryResponse)
async def get_summary():
    """Aggregated summary statistics from Notion article data."""

    def _run():
        session = _get_sync_session()
        try:
            return compute_summary(session)
        finally:
            session.close()

    return await asyncio.to_thread(_run)


@router.get("/by-client/{client_name}", response_model=list[NotionArticleResponse])
async def articles_by_client(client_name: str, limit: int = 500):
    """Get all articles for a specific client."""

    def _run():
        session = _get_sync_session()
        try:
            stmt = (
                select(NotionArticle)
                .where(NotionArticle.client_name == client_name)
                .order_by(NotionArticle.created_date.desc())
                .limit(limit)
            )
            return session.execute(stmt).scalars().all()
        finally:
            session.close()

    return await asyncio.to_thread(_run)


@router.get("/kpis")
async def get_kpis(
    editor: str | None = None,
    pod: str | None = None,
    client: str | None = None,
    year: int | None = None,
):
    """Computed KPI values from Notion article data."""

    def _run():
        session = _get_sync_session()
        try:
            rev = compute_revision_rate(session, editor=editor, pod=pod, client=client, year=year)
            turn = compute_turnaround_time(
                session, editor=editor, pod=pod, client=client, year=year
            )
            sr = compute_second_reviews(session, year=year)
            return {
                "revision_rate": rev,
                "turnaround_time": turn,
                "second_reviews": sr,
            }
        finally:
            session.close()

    return await asyncio.to_thread(_run)


@router.post("/refresh-kpis")
async def refresh_kpis(year: int = 2026, month: int = 3):
    """Compute real KPIs from Notion data and write into kpi_scores table."""

    def _run():
        session = _get_sync_session()
        try:
            return refresh_notion_kpis(session, year=year, month=month)
        finally:
            session.close()

    return await asyncio.to_thread(_run)
