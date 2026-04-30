"""Admin router — BigQuery sync and operational endpoints."""

from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AuditLog, Client, DeliverableMonthly, ProductionHistory
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


# ---------------------------------------------------------------------------
# Data quality / discrepancies
# ---------------------------------------------------------------------------


class EndDateDiscrepancy(BaseModel):
    """SOW Overview end_date differs from the last projected month in the
    Editorial Operating Model (`production_history`). Either the SOW is
    behind on a renewal (`ops_end > sow_end`) or ops has stopped projecting
    deliveries before the SOW close (`ops_end < sow_end`)."""

    client_id: int
    client_name: str
    status: str
    sow_end: date
    ops_end: date
    diff_months: int
    direction: str  # "ops_after_sow" | "ops_before_sow"


class DeliveredDriftDiscrepancy(BaseModel):
    """`clients.articles_delivered` (cumulative from SOW Overview) disagrees
    with `SUM(deliverables_monthly.articles_delivered)` (per-month from
    Delivered vs Invoiced v2). Same metric, two source sheets — the dashboards
    prefer the monthly sum, but the SOW cumulative drives the SOW Overview
    table that maintainers edit by hand."""

    client_id: int
    client_name: str
    status: str
    sow_delivered: int
    monthly_delivered: int
    delta: int  # monthly − sow


class DiscrepanciesResponse(BaseModel):
    end_date_mismatches: list[EndDateDiscrepancy]
    delivered_drift: list[DeliveredDriftDiscrepancy]
    generated_at: datetime


@router.get("/discrepancies", response_model=DiscrepanciesResponse)
async def list_discrepancies(
    db: AsyncSession = Depends(get_db),
    min_end_date_diff_months: int = 2,
    min_delivered_delta: int = 1,
):
    """List per-client data discrepancies the maintainer should reconcile.

    `min_end_date_diff_months` filters out the ±1-month calendar-rounding
    noise (SOW end is mid-month, ops projects to last full month before).
    `min_delivered_delta` filters trivial off-by-one drift.
    """
    # ── End-date mismatches ──────────────────────────────────────────────
    ops_stmt = (
        select(
            ProductionHistory.client_id,
            func.max(ProductionHistory.year * 100 + ProductionHistory.month).label("ym"),
        )
        .where(
            or_(
                ProductionHistory.articles_actual > 0,
                ProductionHistory.articles_projected > 0,
            )
        )
        .group_by(ProductionHistory.client_id)
    )
    ops_result = await db.execute(ops_stmt)
    ops_map: dict[int, date] = {}
    for cid, ym in ops_result.all():
        if ym is None:
            continue
        y, m = divmod(int(ym), 100)
        ops_map[cid] = date(y, m, 1)

    clients_result = await db.execute(select(Client).where(Client.end_date.is_not(None)))
    end_mismatches: list[EndDateDiscrepancy] = []
    for c in clients_result.scalars():
        ops_end = ops_map.get(c.id)
        if ops_end is None:
            continue
        diff = (ops_end.year - c.end_date.year) * 12 + (ops_end.month - c.end_date.month)
        if abs(diff) < min_end_date_diff_months:
            continue
        end_mismatches.append(
            EndDateDiscrepancy(
                client_id=c.id,
                client_name=c.name,
                status=c.status,
                sow_end=c.end_date,
                ops_end=ops_end,
                diff_months=diff,
                direction="ops_after_sow" if diff > 0 else "ops_before_sow",
            )
        )
    end_mismatches.sort(key=lambda d: (d.status != "ACTIVE", -abs(d.diff_months)))

    # ── Delivered drift (SOW cumulative vs deliverables_monthly sum) ─────
    dm_stmt = select(
        DeliverableMonthly.client_id,
        func.coalesce(func.sum(DeliverableMonthly.articles_delivered), 0).label("dm_delivered"),
    ).group_by(DeliverableMonthly.client_id)
    dm_result = await db.execute(dm_stmt)
    dm_map: dict[int, int] = {cid: int(v) for cid, v in dm_result.all()}

    clients_result2 = await db.execute(select(Client).where(Client.articles_delivered.is_not(None)))
    drift: list[DeliveredDriftDiscrepancy] = []
    for c in clients_result2.scalars():
        sow_d = c.articles_delivered or 0
        dm_d = dm_map.get(c.id, 0)
        delta = dm_d - sow_d
        if abs(delta) < min_delivered_delta:
            continue
        drift.append(
            DeliveredDriftDiscrepancy(
                client_id=c.id,
                client_name=c.name,
                status=c.status,
                sow_delivered=sow_d,
                monthly_delivered=dm_d,
                delta=delta,
            )
        )
    drift.sort(key=lambda d: (d.status != "ACTIVE", -abs(d.delta)))

    return DiscrepanciesResponse(
        end_date_mismatches=end_mismatches,
        delivered_drift=drift,
        generated_at=datetime.utcnow(),
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
