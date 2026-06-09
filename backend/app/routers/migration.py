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
from app.models import AuditLog, EditorialWeek
from app.schemas import EditorialWeekResponse
from app.services import sync_manifest
from app.services.migration_service import (
    CAPACITY_PLAN_PREFIX,
    IMPORT_DISPATCH,
    import_all,
    list_available_sheets,
    preview_sheet,
    refresh_computed_kpis,
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


class TabDetailResponse(BaseModel):
    tab_name: str
    month_year: str
    rows_parsed: int
    rows_imported: int
    status: str
    skipped_reason: str | None = None
    preview_key: str | None = None


class ImportResultResponse(BaseModel):
    sheet: str
    rows_parsed: int
    rows_imported: int
    success: bool
    errors: list[str]
    details: list[TabDetailResponse] = []


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
                details=[
                    TabDetailResponse(
                        tab_name=d.tab_name,
                        month_year=d.month_year,
                        rows_parsed=d.rows_parsed,
                        rows_imported=d.rows_imported,
                        status=d.status,
                        skipped_reason=d.skipped_reason,
                        preview_key=d.preview_key,
                    )
                    for d in r.details
                ],
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
                details=[
                    TabDetailResponse(
                        tab_name=d.tab_name,
                        month_year=d.month_year,
                        rows_parsed=d.rows_parsed,
                        rows_imported=d.rows_imported,
                        status=d.status,
                        skipped_reason=d.skipped_reason,
                        preview_key=d.preview_key,
                    )
                    for d in r.details
                ],
            )
            for r in results
        ],
        total_imported=sum(r.rows_imported for r in results),
        all_ok=all(r.success for r in results),
    )


@router.post("/goals-historical-resync", response_model=list[ImportResultResponse])
async def resync_historical_goals():
    """Force re-import of past-only / annual sheets the regular SYNC button
    skips. Today that's:
      • Every Goals vs Delivery monthly tab (the normal SYNC only refreshes
        the current month's tab + skips months recorded in
        `sheet_sync_history`).
      • The '<YYYY> Week Distribution' tabs from the Master Tracker — annual
        config that defines when each Editorial month starts. The "as of"
        badge across the dashboards reads from this.
      • Team Pods (Editorial + Growth) so RBAC group auto-membership stays
        in sync with the latest sheet.
      • ET CP Pod History — walks every historical ET CP version tab and
        writes the confirmed pod assignment per client per month into
        `client_pod_history`. Surfaces unmatched names as IncompleteClient
        rows for ops to add to the SOW Overview.
      • Backfill Editorial Pod from history — fills `clients.editorial_pod`
        for any client where the current ET CP tab has no entry but
        historical tabs do, so inactive / paused clients keep their last
        confirmed pod visible across the dashboards.

    Each importer runs in its own session and is wrapped in a guard so one
    failure doesn't abort the others — failed steps come back as
    `success=False` ImportResults with the error message, letting the UI
    surface partial results.

    Run when someone retroactively edits older numbers, or at the start of a
    new calendar year once the next-year week distribution is locked in.
    """

    # Steps come from the manifest's "past" scope — the single source of truth
    # (no separate hardcoded list to keep in sync). Equivalent to /sync-run?scope=past.
    def _run():
        results: list = []
        for st in sync_manifest.PAST_STEPS:
            session = _get_sync_session()
            try:
                results.extend(sync_manifest.run_step(session, st.key))
            except Exception as exc:
                logger.exception("%s failed during historical resync", st.label)
                from app.services.migration_service import ImportResult as _IR

                results.append(
                    _IR(
                        sheet=st.label,
                        success=False,
                        errors=[f"{type(exc).__name__}: {exc}"],
                    )
                )
                try:
                    session.rollback()
                except Exception:
                    logger.warning("Rollback failed for %s (continuing)", st.label)
            finally:
                session.close()
        return results

    results = await asyncio.to_thread(_run)

    return [
        ImportResultResponse(
            sheet=r.sheet,
            rows_parsed=r.rows_parsed,
            rows_imported=r.rows_imported,
            success=r.success,
            errors=r.errors,
            details=[
                TabDetailResponse(
                    tab_name=d.tab_name,
                    month_year=d.month_year,
                    rows_parsed=d.rows_parsed,
                    rows_imported=d.rows_imported,
                    status=d.status,
                    skipped_reason=d.skipped_reason,
                    preview_key=d.preview_key,
                )
                for d in r.details
            ],
        )
        for r in results
    ]


# ---------------------------------------------------------------------------
# Sync Manifest endpoints — the canonical "what gets synced" surface. Every
# trigger (SYNC button, Re-sync Past Months, month-rollover, cron, agent)
# reads its plan from /sync-plan and executes via /sync-step or /sync-run, all
# backed by the single declaration in services/sync_manifest.py. Add an
# importer there once (tagged current/past) and it flows into all of these.
# ---------------------------------------------------------------------------


def _to_response(r) -> ImportResultResponse:
    """Map an ImportResult → its API response shape (used by every sync path)."""
    return ImportResultResponse(
        sheet=r.sheet,
        rows_parsed=r.rows_parsed,
        rows_imported=r.rows_imported,
        success=r.success,
        errors=r.errors,
        details=[
            TabDetailResponse(
                tab_name=d.tab_name,
                month_year=d.month_year,
                rows_parsed=d.rows_parsed,
                rows_imported=d.rows_imported,
                status=d.status,
                skipped_reason=d.skipped_reason,
                preview_key=d.preview_key,
            )
            for d in r.details
        ],
    )


class SyncPlanStep(BaseModel):
    key: str
    label: str
    scope: str
    description: str | None = None


class SyncPlanResponse(BaseModel):
    scope: str
    steps: list[SyncPlanStep]


class SyncStepRequest(BaseModel):
    key: str


class MonthlyResyncStatusResponse(BaseModel):
    due: bool
    current_month: str | None = None
    month_start: str | None = None
    last_goals_sync: str | None = None


_VALID_SCOPES = {"current", "past", "full"}


@router.get("/sync-plan", response_model=SyncPlanResponse)
async def get_sync_plan(scope: str = "current"):
    """Ordered step list for a scope — the single source the SYNC modal and
    Re-sync Past Months UI render from (no more hardcoded frontend lists).
    Dynamic tabs (ET CP version, KPI scores) expand against the live sheets."""
    if scope not in _VALID_SCOPES:
        raise HTTPException(status_code=400, detail=f"Invalid scope '{scope}' (current|past|full)")
    try:
        steps = await asyncio.to_thread(sync_manifest.resolve_plan, scope)
    except Exception as exc:
        logger.exception("sync-plan failed")
        raise HTTPException(status_code=500, detail=f"Failed to build sync plan: {exc}") from exc
    return SyncPlanResponse(scope=scope, steps=[SyncPlanStep(**s) for s in steps])


@router.post("/sync-step", response_model=ImportResponse)
async def run_sync_step(body: SyncStepRequest):
    """Run a single manifest step by key (a sheet name, or a fixed step id like
    `goals-vs-delivery` / `@refresh-kpis`). Drives per-step progress in the
    SYNC + Re-sync UIs. Errors come back as a failed result so one bad step
    doesn't abort the run."""
    key = body.key

    def _run():
        session = _get_sync_session()
        try:
            return sync_manifest.run_step(session, key)
        except Exception as exc:
            logger.exception("sync-step '%s' failed", key)
            from app.services.migration_service import ImportResult as _IR

            try:
                session.rollback()
            except Exception:
                logger.warning("Rollback failed for sync-step %s (continuing)", key)
            return [_IR(sheet=key, success=False, errors=[f"{type(exc).__name__}: {exc}"])]
        finally:
            session.close()

    results = await asyncio.to_thread(_run)
    return ImportResponse(
        results=[_to_response(r) for r in results],
        total_imported=sum(r.rows_imported for r in results),
        all_ok=all(r.success for r in results),
    )


@router.post("/sync-run", response_model=ImportResponse)
async def run_sync_scope(scope: str = "full"):
    """Run an ENTIRE scope server-side in one call — for cron / agent / headless
    triggers that want 'do everything' without orchestrating per-step from a
    client. `scope=full` == click SYNC then Re-sync Past Months. Each step is
    guarded so one failure doesn't abort the rest."""
    if scope not in _VALID_SCOPES:
        raise HTTPException(status_code=400, detail=f"Invalid scope '{scope}' (current|past|full)")

    def _run():
        plan = sync_manifest.resolve_plan(scope)
        results: list = []
        for step in plan:
            session = _get_sync_session()
            try:
                results.extend(sync_manifest.run_step(session, step["key"]))
            except Exception as exc:
                logger.exception("sync-run step '%s' failed (continuing)", step["key"])
                from app.services.migration_service import ImportResult as _IR

                try:
                    session.rollback()
                except Exception:
                    logger.warning("Rollback failed for sync-run %s", step["key"])
                results.append(
                    _IR(sheet=step["label"], success=False, errors=[f"{type(exc).__name__}: {exc}"])
                )
            finally:
                session.close()
        return results

    try:
        results = await asyncio.to_thread(_run)
    except Exception as exc:
        logger.exception("sync-run failed")
        raise HTTPException(status_code=500, detail=f"Sync run failed: {exc}") from exc
    return ImportResponse(
        results=[_to_response(r) for r in results],
        total_imported=sum(r.rows_imported for r in results),
        all_ok=all(r.success for r in results),
    )


@router.get("/monthly-resync-status", response_model=MonthlyResyncStatusResponse)
async def get_monthly_resync_status():
    """Whether the past-months resync is 'due' — a new editorial month began
    and last month's final numbers haven't been pulled yet. The SYNC modal
    uses this to run scope=full on the first sync of a new month."""

    def _check():
        session = _get_sync_session()
        try:
            return sync_manifest.monthly_resync_due(session)
        finally:
            session.close()

    status = await asyncio.to_thread(_check)
    return MonthlyResyncStatusResponse(**status)


@router.post("/resync/{step}", response_model=ImportResultResponse)
async def resync_single_step(step: str):
    """Back-compat per-step resync — now delegates to the manifest's `run_step`
    (the single source of truth). Past-step keys are unchanged. New callers
    should use /sync-step."""
    valid = [s.key for s in sync_manifest.PAST_STEPS]
    if step not in valid:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown resync step '{step}'. Valid: {', '.join(valid)}",
        )

    def _run():
        session = _get_sync_session()
        try:
            res = sync_manifest.run_step(session, step)
            return res[0] if res else None
        except Exception as exc:
            logger.exception("%s failed during single-step resync", step)
            from app.services.migration_service import ImportResult as _IR

            try:
                session.rollback()
            except Exception:
                logger.warning("Rollback failed for %s (continuing)", step)
            return _IR(sheet=step, success=False, errors=[f"{type(exc).__name__}: {exc}"])
        finally:
            session.close()

    result = await asyncio.to_thread(_run)
    if result is None:
        from app.services.migration_service import ImportResult as _IR

        result = _IR(sheet=step, success=True)
    return _to_response(result)


@router.get("/editorial-weeks", response_model=list[EditorialWeekResponse])
async def list_editorial_weeks(
    year: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Read-only feed of the editorial-week rows the past-months resync wrote.
    Lives on `/api/migrate/...` because it's tightly coupled to the importer
    that populates it; no separate router warranted."""
    stmt = select(EditorialWeek).order_by(
        EditorialWeek.year,
        EditorialWeek.month,
        EditorialWeek.week_number,
    )
    if year is not None:
        stmt = stmt.where(EditorialWeek.year == year)
    result = await db.execute(stmt)
    return result.scalars().all()


class RefreshKpisResponse(BaseModel):
    months_processed: int
    scores_updated: int
    months: list[str]


@router.post("/refresh-kpis", response_model=RefreshKpisResponse)
async def refresh_kpis():
    """Recompute Notion-derived KPIs (revision_rate, turnaround_time,
    second_reviews, capacity_utilization) for every (year, month) that has
    source data in `notion_articles` or `capacity_projections`.

    The frontend calls this after the per-sheet `/import` loop completes so
    every KPI on the heatmap reflects fresh source data — without it, the
    sheet-derived KPIs (Internal/External Quality, Mentorship, Feedback
    Adoption) update on every sync but the four computed ones never do.

    Capped at 36 months back from today so a runaway data pull doesn't
    iterate over a decade of stale rows.
    """

    def _run():
        session = _get_sync_session()
        try:
            return refresh_computed_kpis(session)
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    try:
        payload = await asyncio.to_thread(_run)
    except Exception as exc:
        logger.exception("refresh-kpis failed")
        raise HTTPException(status_code=500, detail=f"KPI refresh failed: {exc}") from exc

    return RefreshKpisResponse(**payload)


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
