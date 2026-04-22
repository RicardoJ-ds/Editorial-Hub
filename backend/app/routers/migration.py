"""Migration router — Google Sheets import endpoints."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session as SyncSession

from app.config import settings
from app.database import get_db, prepare_sync_url
from app.models import AuditLog
from app.services.migration_service import (
    CAPACITY_PLAN_PREFIX,
    IMPORT_DISPATCH,
    import_all,
    import_goals_vs_delivery,
    list_available_sheets,
    preview_sheet,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class SheetInfo(BaseModel):
    name: str
    row_count: int
    description: str


class PreviewResponse(BaseModel):
    sheet_name: str
    headers: list[str]
    rows: list[list[str]]
    total_rows: int


class ImportRequest(BaseModel):
    sheets: list[str]


class ImportResultResponse(BaseModel):
    sheet: str
    rows_parsed: int
    rows_imported: int
    success: bool
    errors: list[str]


class ImportResponse(BaseModel):
    results: list[ImportResultResponse]
    total_imported: int
    all_ok: bool


class MigrationStatusEntry(BaseModel):
    performed_at: datetime
    performed_by: str | None
    sheets_imported: list[str]
    total_imported: int
    all_ok: bool


class MigrationStatusResponse(BaseModel):
    last_imports: list[MigrationStatusEntry]


# ---------------------------------------------------------------------------
# Sync DB helper
# ---------------------------------------------------------------------------


def _get_sync_session() -> SyncSession:
    """Create a synchronous SQLAlchemy session for Google Sheets import work.

    Uses `prepare_sync_url` so libpq-style params (sslmode=require) survive
    and asyncpg-style params (ssl=require) are translated — Railway's
    DATABASE_URL carries whichever the connection string renderer emits, and
    psycopg2 rejects `ssl=…` outright.
    """
    sync_engine = create_engine(prepare_sync_url(settings.database_url), echo=False)
    return SyncSession(sync_engine)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/sheets", response_model=list[SheetInfo])
async def get_available_sheets():
    """List all available sheets in the migration spreadsheet."""
    try:
        sheets = await asyncio.to_thread(list_available_sheets)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=f"SA key not found: {exc}") from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list sheets: {exc}",
        ) from exc

    return [
        SheetInfo(name=s["name"], row_count=s["row_count"], description=s["description"])
        for s in sheets
    ]


@router.get("/preview/{sheet_name}", response_model=PreviewResponse)
async def get_sheet_preview(sheet_name: str, max_rows: int = 20):
    """Preview the first N rows of a sheet."""
    try:
        data = await asyncio.to_thread(preview_sheet, sheet_name, max_rows)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to preview sheet '{sheet_name}': {exc}",
        ) from exc

    return PreviewResponse(
        sheet_name=data["sheet_name"],
        headers=data["headers"],
        rows=data["rows"],
        total_rows=data["total_rows"],
    )


@router.post("/import", response_model=ImportResponse)
async def trigger_import(body: ImportRequest):
    """Import data from the specified Google Sheets into the database.

    Uses a synchronous session via asyncio.to_thread because the Google Sheets
    API client is synchronous.
    """
    if not body.sheets:
        raise HTTPException(status_code=400, detail="No sheets specified for import")

    def _run_import():
        session = _get_sync_session()
        try:
            results = import_all(session, body.sheets)
            return results
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    try:
        results = await asyncio.to_thread(_run_import)
    except Exception as exc:
        logger.exception("Import failed")
        raise HTTPException(
            status_code=500,
            detail=f"Import failed: {exc}",
        ) from exc

    return ImportResponse(
        results=[
            ImportResultResponse(
                sheet=r.sheet,
                rows_parsed=r.rows_parsed,
                rows_imported=r.rows_imported,
                success=r.success,
                errors=r.errors,
            )
            for r in results
        ],
        total_imported=sum(r.rows_imported for r in results),
        all_ok=all(r.success for r in results),
    )


@router.post("/sync-all", response_model=ImportResponse)
async def sync_all():
    """One-click sync: import ALL sheets + refresh Notion KPIs."""

    def _run_sync():
        session = _get_sync_session()
        try:
            # Discover capacity plan sheet dynamically
            all_sheets = list(IMPORT_DISPATCH.keys())
            try:
                available = list_available_sheets()
                for s in available:
                    if s["name"].startswith(CAPACITY_PLAN_PREFIX) and s["name"] not in all_sheets:
                        all_sheets.append(s["name"])
            except Exception:
                logger.warning("Could not list sheets to detect capacity plan; skipping")

            results = import_all(session, all_sheets)

            # Refresh Notion KPIs for recent months
            try:
                from app.services.notion_kpi_service import refresh_notion_kpis

                now = datetime.now()
                for offset in range(7):
                    m = now.month - offset
                    y = now.year
                    if m <= 0:
                        m += 12
                        y -= 1
                    refresh_notion_kpis(session, y, m)
                session.commit()
            except Exception:
                logger.warning(
                    "Notion KPI refresh failed; sheet data still imported", exc_info=True
                )

            return results
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    try:
        results = await asyncio.to_thread(_run_sync)
    except Exception as exc:
        logger.exception("Sync-all failed")
        raise HTTPException(status_code=500, detail=f"Sync failed: {exc}") from exc

    return ImportResponse(
        results=[
            ImportResultResponse(
                sheet=r.sheet,
                rows_parsed=r.rows_parsed,
                rows_imported=r.rows_imported,
                success=r.success,
                errors=r.errors,
            )
            for r in results
        ],
        total_imported=sum(r.rows_imported for r in results),
        all_ok=all(r.success for r in results),
    )


@router.post("/goals-historical-resync", response_model=ImportResultResponse)
async def resync_historical_goals():
    """Force re-import of every Goals vs Delivery tab, including past months.

    The normal SYNC button only re-imports the current calendar month's tab
    and skips past-month tabs that are already recorded in `sheet_sync_history`.
    Use this endpoint when someone retroactively edits an older month's numbers
    and you want the dashboard to reflect the corrected values.
    """

    def _run():
        session = _get_sync_session()
        try:
            return import_goals_vs_delivery(session, mode="all")
        finally:
            session.close()

    try:
        r = await asyncio.to_thread(_run)
    except Exception as exc:
        logger.exception("Historical Goals vs Delivery resync failed")
        raise HTTPException(status_code=500, detail=f"Resync failed: {exc}") from exc

    return ImportResultResponse(
        sheet=r.sheet,
        rows_parsed=r.rows_parsed,
        rows_imported=r.rows_imported,
        success=r.success,
        errors=r.errors,
    )


@router.get("/status", response_model=MigrationStatusResponse)
async def get_migration_status(db: AsyncSession = Depends(get_db)):
    """Return the last import statuses from the audit log."""
    stmt = (
        select(AuditLog)
        .where(
            AuditLog.entity_type == "sheets_migration",
            AuditLog.action == "IMPORT",
        )
        .order_by(AuditLog.performed_at.desc())
        .limit(10)
    )
    result = await db.execute(stmt)
    logs = result.scalars().all()

    entries: list[MigrationStatusEntry] = []
    for log in logs:
        sheets_imported: list[str] = []
        total_imported = 0
        all_ok = False

        if log.changes_json:
            try:
                data = json.loads(log.changes_json)
                all_ok = data.get("all_ok", False)
                total_imported = data.get("total_imported", 0)
                sheets_imported = [s.get("sheet", "") for s in data.get("sheets", [])]
            except (json.JSONDecodeError, TypeError):
                pass

        entries.append(
            MigrationStatusEntry(
                performed_at=log.performed_at,
                performed_by=log.performed_by,
                sheets_imported=sheets_imported,
                total_imported=total_imported,
                all_ok=all_ok,
            )
        )

    return MigrationStatusResponse(last_imports=entries)
