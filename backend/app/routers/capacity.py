import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    ArticleRecord,
    CapacityProjection,
    Client,
    ClientPodHistory,
    EditorialMemberCapacity,
    ProductionHistory,
)
from app.schemas import CapacityCreate, CapacityResponse, CapacityUpdate
from app.services.capacity_calc import (
    compute_client_contributions,
    compute_member_utilization,
    version_num as _version_num,
)
from app.services import bq_dashboard
from app.services.bq_dashboard import get_data_source

router = APIRouter()


class CapacityPodSummary(BaseModel):
    """One row per (pod, year, month) using ONLY the latest ET CP version —
    the source for the per-pod capacity KPI matrix."""

    year: int
    month: int
    pod: str
    version: str | None
    total_capacity: int | None
    projected_used_capacity: int | None
    actual_used_capacity: int | None


@router.get("/", response_model=list[CapacityResponse])
async def list_capacity_projections(
    pod: str | None = None,
    year: int | None = None,
    month: int | None = None,
    version: str | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(CapacityProjection)

    if pod:
        stmt = stmt.where(CapacityProjection.pod == pod)
    if year is not None:
        stmt = stmt.where(CapacityProjection.year == year)
    if month is not None:
        stmt = stmt.where(CapacityProjection.month == month)
    if version:
        stmt = stmt.where(CapacityProjection.version == version)

    stmt = (
        stmt.offset(skip)
        .limit(limit)
        .order_by(CapacityProjection.year.desc(), CapacityProjection.month.desc())
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/pod-summary", response_model=list[CapacityPodSummary])
async def capacity_pod_summary(
    db: AsyncSession = Depends(get_db),
    source: str = Depends(get_data_source),
):
    if source == "bq":
        return await asyncio.to_thread(bq_dashboard.capacity_pod_summary)
    """Latest-version-per-(pod, year, month) capacity rows for the per-pod KPI
    matrix. capacity_projections holds several ET CP versions for the same month
    (V9/V11/V13/V14…); only the highest version number is current truth, so we
    collapse to the max numeric V## per (pod, year, month). Declared BEFORE the
    `/{capacity_id}` route so it isn't captured as an id."""
    rows = (await db.execute(select(CapacityProjection))).scalars().all()
    latest: dict[tuple[int, int, str], CapacityProjection] = {}
    for r in rows:
        key = (r.year, r.month, r.pod)
        cur = latest.get(key)
        if cur is None or _version_num(r.version) > _version_num(cur.version):
            latest[key] = r
    return [
        CapacityPodSummary(
            year=r.year,
            month=r.month,
            pod=r.pod,
            version=r.version,
            total_capacity=r.total_capacity,
            projected_used_capacity=r.projected_used_capacity,
            actual_used_capacity=r.actual_used_capacity,
        )
        for r in sorted(latest.values(), key=lambda r: (r.year, r.month, r.pod))
    ]


class MemberUtilizationRow(BaseModel):
    """Per-(member, month) capacity utilization. Joins-only over the canonical
    origins (nothing stored/duplicated). Implements the agreed model:

      %allocation   = capacity ÷ pod total capacity            (editorial_member_capacity)
      %distribution = member articles ÷ pod total articles     (article_records)
      projected_used (member) = %allocation × pod RAW projected (production_history)
      actual_used    (member) = %distribution × pod RAW actual  ← FALLBACK:
            articles are only a *distribution key*; the magnitude comes from the
            authoritative pod actual, because the article log under-counts.
      %util_real     = actual_used ÷ capacity        (use of max capacity)
      %util_weighted = actual_used ÷ projected_used  (delivery vs plan)

    Pod RAW totals (no ×1.4) drive the per-member math; the category-weighted
    (specialized ×1.4) pod totals are carried for the pod-level reference util.
    `matched` = the member name resolved to an editor in the article log."""

    pod: str
    role: str | None
    member: str
    capacity: int | None
    matched: bool
    articles: int
    pct_allocation: float          # 0–1
    pct_distribution: float        # 0–1
    projected_used: float          # member's share of pod raw projected
    actual_used: float             # member's share of pod raw actual (fallback)
    pct_util_real: float | None    # actual_used ÷ capacity
    pct_util_weighted: float | None  # actual_used ÷ projected_used
    # Pod context (same for every member of the pod)
    pod_total_capacity: int
    pod_total_articles: int
    pod_projected_raw: int
    pod_actual_raw: int
    pod_projected_weighted: float
    pod_actual_weighted: float
    pod_util_projected_weighted: float | None  # pod weighted projected ÷ total cap
    pod_util_actual_weighted: float | None     # pod weighted actual ÷ total cap


async def _fetch_month_inputs(
    db: AsyncSession, year: int, month: int
) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    """Fetch the 4 origin row-sets for one month, as the plain dicts
    `capacity_calc` consumes. Shared by the single-month and matrix endpoints."""
    cph = (
        await db.execute(
            select(
                ClientPodHistory.client_id,
                ClientPodHistory.editorial_pod,
                ClientPodHistory.category,
            ).where(
                ClientPodHistory.year == year,
                ClientPodHistory.month == month,
                ClientPodHistory.client_id.is_not(None),
            )
        )
    ).all()
    ph = (
        await db.execute(
            select(
                ProductionHistory.client_id,
                ProductionHistory.projected_original,
                ProductionHistory.articles_actual,
            ).where(ProductionHistory.year == year, ProductionHistory.month == month)
        )
    ).all()
    ar = (
        await db.execute(
            select(ArticleRecord.editor_name).where(
                ArticleRecord.year == year, ArticleRecord.month == month
            )
        )
    ).all()
    emc = (
        (
            await db.execute(
                select(EditorialMemberCapacity).where(
                    EditorialMemberCapacity.year == year,
                    EditorialMemberCapacity.month == month,
                )
            )
        )
        .scalars()
        .all()
    )
    return (
        [
            {"client_id": r.client_id, "editorial_pod": r.editorial_pod, "category": r.category}
            for r in cph
        ],
        [
            {
                "client_id": r.client_id,
                "projected_original": r.projected_original,
                "articles_actual": r.articles_actual,
            }
            for r in ph
        ],
        [{"editor_name": r.editor_name} for r in ar],
        [
            {
                "pod": m.pod,
                "role": m.role,
                "member_raw": m.member_raw,
                "member_breakdown": m.member_breakdown,
                "capacity": m.capacity,
            }
            for m in emc
        ],
    )


@router.get("/member-utilization", response_model=list[MemberUtilizationRow])
async def member_utilization(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    db: AsyncSession = Depends(get_db),
    source: str = Depends(get_data_source),
):
    if source == "bq":
        return await asyncio.to_thread(bq_dashboard.member_utilization, year, month)
    """% of capacity per editor for one month. JOINS-ONLY over 4 origins — no
    column is stored or duplicated; everything is brought together at read time.
    The math lives in `services/capacity_calc.compute_member_utilization`, shared
    with the ETL's BigQuery mart so both can never drift. Declared before
    `/{capacity_id}` so the path isn't captured as an id."""
    cph, ph, ar, emc = await _fetch_month_inputs(db, year, month)
    return [MemberUtilizationRow(**r) for r in compute_member_utilization(cph, ph, ar, emc)]


class MemberUtilizationMatrixRow(MemberUtilizationRow):
    """A member-utilization row tagged with its month — the multi-month feed
    for the utilization-trend matrix in the UI."""

    year: int
    month: int


@router.get("/member-utilization-matrix", response_model=list[MemberUtilizationMatrixRow])
async def member_utilization_matrix(
    db: AsyncSession = Depends(get_db),
    source: str = Depends(get_data_source),
):
    if source == "bq":
        return await asyncio.to_thread(bq_dashboard.member_utilization_matrix)
    """Member utilization for EVERY month that has staffed capacity — one flat
    list with (year, month) on each row. Months come from
    editorial_member_capacity (the staffing source of truth)."""
    months = (
        await db.execute(
            select(EditorialMemberCapacity.year, EditorialMemberCapacity.month)
            .distinct()
            .order_by(EditorialMemberCapacity.year, EditorialMemberCapacity.month)
        )
    ).all()
    out: list[MemberUtilizationMatrixRow] = []
    for ym in months:
        cph, ph, ar, emc = await _fetch_month_inputs(db, ym.year, ym.month)
        for r in compute_member_utilization(cph, ph, ar, emc):
            out.append(MemberUtilizationMatrixRow(year=ym.year, month=ym.month, **r))
    return out


class ClientContributionRow(BaseModel):
    """One (pod, client) row for one month: the processed table that DRIVES the
    pod projected/actual totals used in member utilization. Raw values come from
    production_history (projected_original / articles_actual); weight ×1.4 when
    the client's as-of-month category is 'specialized'."""

    pod: str
    client_id: int
    client_name: str
    category: str | None
    weight: float
    projected_raw: int
    actual_raw: int
    projected_weighted: float
    actual_weighted: float


@router.get("/client-contributions", response_model=list[ClientContributionRow])
async def client_contributions(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    db: AsyncSession = Depends(get_db),
    source: str = Depends(get_data_source),
):
    if source == "bq":
        return await asyncio.to_thread(bq_dashboard.client_contributions, year, month)
    """Per-client production contributions for one month — the intermediate
    ('processed') table between the raw origins and the pod utilization
    numbers. Same joins as member-utilization, exposed at client grain."""
    cph, ph, _, _ = await _fetch_month_inputs(db, year, month)
    ids = [r["client_id"] for r in cph]
    names: dict[int, str] = {}
    if ids:
        for c in (
            await db.execute(select(Client.id, Client.name).where(Client.id.in_(ids)))
        ).all():
            names[c.id] = c.name
    return [
        ClientContributionRow(**r) for r in compute_client_contributions(cph, ph, names)
    ]


@router.get("/{capacity_id}", response_model=CapacityResponse)
async def get_capacity_projection(
    capacity_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CapacityProjection).where(CapacityProjection.id == capacity_id)
    )
    projection = result.scalar_one_or_none()
    if not projection:
        raise HTTPException(status_code=404, detail="Capacity projection not found")
    return projection


@router.post("/", response_model=CapacityResponse, status_code=201)
async def create_capacity_projection(
    payload: CapacityCreate,
    db: AsyncSession = Depends(get_db),
):
    projection = CapacityProjection(**payload.model_dump())
    db.add(projection)
    await db.commit()
    await db.refresh(projection)
    return projection


@router.put("/{capacity_id}", response_model=CapacityResponse)
async def update_capacity_projection(
    capacity_id: int,
    payload: CapacityUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CapacityProjection).where(CapacityProjection.id == capacity_id)
    )
    projection = result.scalar_one_or_none()
    if not projection:
        raise HTTPException(status_code=404, detail="Capacity projection not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(projection, field, value)

    await db.commit()
    await db.refresh(projection)
    return projection


@router.post("/bulk", response_model=list[CapacityResponse], status_code=201)
async def bulk_create_capacity_projections(
    payloads: list[CapacityCreate],
    db: AsyncSession = Depends(get_db),
):
    results = []
    for payload in payloads:
        # Check for existing record by pod + year + month + version
        stmt = select(CapacityProjection).where(
            CapacityProjection.pod == payload.pod,
            CapacityProjection.year == payload.year,
            CapacityProjection.month == payload.month,
            CapacityProjection.version == payload.version,
        )
        result = await db.execute(stmt)
        existing = result.scalar_one_or_none()

        if existing:
            for field, value in payload.model_dump().items():
                setattr(existing, field, value)
            results.append(existing)
        else:
            projection = CapacityProjection(**payload.model_dump())
            db.add(projection)
            results.append(projection)

    await db.commit()
    for item in results:
        await db.refresh(item)
    return results
