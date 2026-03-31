"""Admin router — BigQuery sync and operational endpoints."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AuditLog
from app.services.bigquery_sync import sync_all

router = APIRouter()


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class TableSyncResult(BaseModel):
    table: str
    rows: int
    success: bool
    error: str | None = None


class SyncResponse(BaseModel):
    started_at: datetime
    finished_at: datetime | None
    all_ok: bool
    results: list[TableSyncResult]


class SyncStatusEntry(BaseModel):
    performed_at: datetime
    performed_by: str | None
    all_ok: bool
    tables_synced: int


class SyncStatusResponse(BaseModel):
    last_syncs: list[SyncStatusEntry]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/sync-bigquery", response_model=SyncResponse)
async def trigger_bigquery_sync(db: AsyncSession = Depends(get_db)):
    """Trigger a full BigQuery sync of all editorial hub tables."""
    try:
        result = await sync_all(db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Sync failed: {exc}") from exc

    return SyncResponse(
        started_at=result.started_at,
        finished_at=result.finished_at,
        all_ok=result.all_ok,
        results=[
            TableSyncResult(
                table=r.table,
                rows=r.rows,
                success=r.success,
                error=r.error,
            )
            for r in result.results
        ],
    )


@router.get("/sync-status", response_model=SyncStatusResponse)
async def get_sync_status(db: AsyncSession = Depends(get_db)):
    """Return the last BigQuery sync timestamps from the audit log."""
    import json

    stmt = (
        select(AuditLog)
        .where(
            AuditLog.entity_type == "bigquery_sync",
            AuditLog.action == "SYNC",
        )
        .order_by(AuditLog.performed_at.desc())
        .limit(10)
    )
    result = await db.execute(stmt)
    logs = result.scalars().all()

    entries: list[SyncStatusEntry] = []
    for log in logs:
        all_ok = False
        tables_synced = 0
        if log.changes_json:
            try:
                data = json.loads(log.changes_json)
                all_ok = data.get("all_ok", False)
                tables_synced = len(data.get("tables", []))
            except (json.JSONDecodeError, TypeError):
                pass

        entries.append(
            SyncStatusEntry(
                performed_at=log.performed_at,
                performed_by=log.performed_by,
                all_ok=all_ok,
                tables_synced=tables_synced,
            )
        )

    return SyncStatusResponse(last_syncs=entries)
