"""Unified client delivery overview endpoint — joins all delivery tables."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Query
from sqlalchemy import create_engine
from sqlalchemy.orm import Session as SyncSession

from app.config import settings
from app.schemas import (
    ClientAlltimeRow,
    ClientDeliveryResponse,
    ClientMonthRow,
    WeeklyDetailRow,
)
from app.services.client_delivery_service import (
    get_alltime_overview,
    get_monthly_overview,
    get_weekly_detail,
)

router = APIRouter()


def _get_sync_session() -> SyncSession:
    url = settings.database_url
    if "+asyncpg" in url:
        url = url.replace("+asyncpg", "")
    engine = create_engine(url, echo=False)
    return SyncSession(engine)


@router.get("", response_model=ClientDeliveryResponse)
async def client_delivery_overview(
    view: str = Query("monthly", regex="^(monthly|alltime|weekly)$"),
    year: int | None = None,
    month: int | None = None,
    growth_pod: str | None = None,
    editorial_pod: str | None = None,
    status: str | None = None,
    search: str | None = None,
    client_name: str | None = None,
):
    """Return joined client delivery data across all tables."""

    def _run():
        session = _get_sync_session()
        try:
            if view == "monthly":
                rows = get_monthly_overview(
                    session,
                    year=year,
                    month=month,
                    growth_pod=growth_pod,
                    editorial_pod=editorial_pod,
                    status=status,
                    search=search,
                )
                return ClientDeliveryResponse(
                    view="monthly",
                    monthly_rows=[ClientMonthRow(**r) for r in rows],
                )
            elif view == "alltime":
                rows = get_alltime_overview(
                    session,
                    growth_pod=growth_pod,
                    editorial_pod=editorial_pod,
                    status=status,
                    search=search,
                )
                return ClientDeliveryResponse(
                    view="alltime",
                    alltime_rows=[ClientAlltimeRow(**r) for r in rows],
                )
            elif view == "weekly":
                if not client_name or not year or not month:
                    return ClientDeliveryResponse(view="weekly", weekly_rows=[])
                rows = get_weekly_detail(
                    session,
                    client_name=client_name,
                    year=year,
                    month=month,
                )
                return ClientDeliveryResponse(
                    view="weekly",
                    weekly_rows=[WeeklyDetailRow(**r) for r in rows],
                )
            return ClientDeliveryResponse(view=view)
        finally:
            session.close()

    return await asyncio.to_thread(_run)
