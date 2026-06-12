"""Admin router — data-quality, discrepancy, and operational endpoints."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import (
    ArticleRecord,
    AuditLog,
    Client,
    ClientPodHistory,
    CumulativeMetric,
    DeliverableMonthly,
    EditorialWeek,
    PodImportIssue,
    PodNameOverride,
    ProductionHistory,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class SyncStatusEntry(BaseModel):
    performed_at: datetime
    performed_by: str | None
    all_ok: bool
    tables_synced: int


class SyncStatusResponse(BaseModel):
    last_syncs: list[SyncStatusEntry]


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
    """Three-source comparison of total articles delivered. Surfaces disagreements
    between the dashboards' delivery data sources:
      A. Editorial Operating Model  (production_history.articles_actual, through as-of)
      B. Delivered vs Invoiced v2   (deliverables_monthly.articles_delivered, through as-of)
      C. Cumulative Pipeline        (cumulative_metrics.articles_sent, snapshot)
    Plus the static SOW Overview cumulative (clients.articles_delivered) as a reference."""

    client_id: int
    client_name: str
    status: str
    as_of_label: str  # e.g. "April 2026"
    # Source A — Editorial Operating Model actuals (summed through as-of)
    ops_delivered: int
    # Source B — Delivered vs Invoiced v2 (summed through as-of)
    dvi_delivered: int
    # Source C — Cumulative Pipeline snapshot (cumulative_metrics.articles_sent)
    cumul_delivered: int | None
    # Source D — SOW Overview static cumulative (clients.articles_delivered)
    sow_delivered: int
    # Max disagreement across available sources (max − min of non-null values)
    span: int


class PodImportIssueItem(BaseModel):
    """BQ client name that could not be matched to any DB client during a
    Growth Pod import. Cleared automatically when the same name matches on a
    subsequent run (fuzzy self-heal or manual override)."""

    id: int
    raw_name: str
    pod_kind: str
    pod_label: str | None
    first_seen_at: datetime
    last_seen_at: datetime
    # Lifecycle so mapped rows stay visible instead of vanishing:
    #   open     — still unmatched, needs an override
    #   mapped   — an override exists but the next SYNC hasn't applied it yet
    #   resolved — matched on a later sync (via override or fuzzy self-heal)
    status: str = "open"
    mapped_to: str | None = None  # target client name when an override exists


class UnassignedArticlePodItem(BaseModel):
    """An article-month with NO as-of editorial pod (client_pod_history had no row
    for that client+month). Surfaces the coverage gap created by per-month pod
    attribution so ops can decide to fix it at the source ET CP sheet or accept it."""

    client_name: str
    client_id: int | None
    year: int
    month: int
    article_count: int  # distinct articles affected
    # "missing_month" = client has ET CP pod history for OTHER months but not this
    # one; "never_in_et_cp" = client never appears in client_pod_history (or its
    # source tab is unresolved). Separates a one-month gap from an unmapped client.
    hint: str


class MissingClientItem(BaseModel):
    """A client name found in a source sheet (Editorial Operating Model,
    Delivered vs Invoiced, Meta Deliveries, or ET CP) but with no row in the
    Hub's `clients` table — so all of its data is silently dropped from the
    dashboards. `*_seen_tab` tells the user which source sheet flagged it so
    they know where to add it. Self-heals once the client is added to the SOW
    Overview and re-synced."""

    id: int
    name_raw: str
    first_seen_tab: str
    last_seen_tab: str
    # Lifecycle so the row stays visible after the operator acts on it:
    #   open      — unmatched, still dropping data
    #   mapped    — aliased to a Hub client (resolves on next SYNC)
    #   dismissed — flagged as noise (header / placeholder), not a real client
    #   resolved  — added to SOW Overview since it was flagged (self-healed)
    status: str = "open"
    mapped_to: str | None = None  # target client name when status == "mapped"


class DiscrepanciesResponse(BaseModel):
    end_date_mismatches: list[EndDateDiscrepancy]
    delivered_drift: list[DeliveredDriftDiscrepancy]
    pod_import_issues: list[PodImportIssueItem]
    unassigned_article_pods: list[UnassignedArticlePodItem]
    missing_clients: list[MissingClientItem]
    generated_at: datetime
    as_of_label: str  # editorial "as of" month used for source-B and source-C sums


def _editorial_as_of(today: date, ew_rows: Any) -> tuple[int, int]:
    """Return (year, month) of the last completed editorial month.

    Mirrors the frontend's `lastCompletedEditorialAsOf` logic: finds the most
    recent Week 1 whose start_date ≤ today, then checks whether today still
    sits inside that editorial month. If yes → prior month is last completed;
    if no (today is past the month's last week) → that month is last completed.
    Falls back to previous calendar month when editorial_weeks is empty.
    """
    # Find the most recent Week 1 that has already started.
    current_year: int | None = None
    current_month: int | None = None
    current_start: date | None = None
    for year, month, week_num, start_date, _end in ew_rows:
        if week_num != 1 or start_date > today:
            continue
        if current_start is None or start_date > current_start:
            current_year, current_month, current_start = year, month, start_date

    if current_year is None or current_month is None:
        # No editorial weeks imported yet — fall back to previous calendar month.
        if today.month == 1:
            return today.year - 1, 12
        return today.year, today.month - 1

    # Is today still inside the current editorial month?
    last_end: date | None = None
    for year, month, _wn, _start, end_date in ew_rows:
        if year == current_year and month == current_month:
            if last_end is None or end_date > last_end:
                last_end = end_date

    if last_end is not None and today <= last_end:
        # We're inside the current editorial month — last completed is the prior one.
        if current_month == 1:
            return current_year - 1, 12
        return current_year, current_month - 1

    # Today is past every known week of the current month — it IS last completed.
    return current_year, current_month


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

    # ── Compute editorial "as of" month from editorial_weeks ─────────────
    ew_result = await db.execute(
        select(
            EditorialWeek.year,
            EditorialWeek.month,
            EditorialWeek.week_number,
            EditorialWeek.start_date,
            EditorialWeek.end_date,
        ).order_by(EditorialWeek.year, EditorialWeek.month, EditorialWeek.week_number)
    )
    ew_rows = ew_result.all()
    today = date.today()
    as_of_year, as_of_month = _editorial_as_of(today, ew_rows)
    as_of_ym = as_of_year * 100 + as_of_month
    as_of_label = date(as_of_year, as_of_month, 1).strftime("%B %Y")

    # ── Source A: production_history actuals summed through as-of ─────────
    ops_stmt = (
        select(
            ProductionHistory.client_id,
            func.coalesce(func.sum(ProductionHistory.articles_actual), 0).label("ops_total"),
        )
        .where(ProductionHistory.year * 100 + ProductionHistory.month <= as_of_ym)
        .group_by(ProductionHistory.client_id)
    )
    ops_result2 = await db.execute(ops_stmt)
    ops_delivered_map: dict[int, int] = {cid: int(v) for cid, v in ops_result2.all()}

    # ── Source B: deliverables_monthly sum through as-of ─────────────────
    dvi_stmt = (
        select(
            DeliverableMonthly.client_id,
            func.coalesce(func.sum(DeliverableMonthly.articles_delivered), 0).label("dvi_total"),
        )
        .where(DeliverableMonthly.year * 100 + DeliverableMonthly.month <= as_of_ym)
        .group_by(DeliverableMonthly.client_id)
    )
    dvi_result = await db.execute(dvi_stmt)
    dvi_delivered_map: dict[int, int] = {cid: int(v) for cid, v in dvi_result.all()}

    # ── Source C: Cumulative Pipeline snapshot (cumulative_metrics) ─────────
    # articles_sent is a manually-maintained cumulative total — no as-of cap.
    cumul_result = await db.execute(
        select(CumulativeMetric.client_name, CumulativeMetric.articles_sent)
    )
    cumul_delivered_map: dict[str, int | None] = {
        name: (int(sent) if sent is not None else None) for name, sent in cumul_result.all()
    }

    # ── Build drift list across all clients ───────────────────────────────
    clients_result2 = await db.execute(select(Client))
    drift: list[DeliveredDriftDiscrepancy] = []
    for c in clients_result2.scalars():
        sow_d = c.articles_delivered or 0
        ops_d = ops_delivered_map.get(c.id, 0)
        dvi_d = dvi_delivered_map.get(c.id, 0)
        cumul_d: int | None = cumul_delivered_map.get(c.name)

        # Compute span: max − min across non-None sources
        sources = [v for v in [ops_d, dvi_d, cumul_d, sow_d] if v is not None]
        if not sources:
            continue
        span = max(sources) - min(sources)
        if span < min_delivered_delta:
            continue
        # Skip clients where every source is 0 (nothing delivered yet)
        if max(sources) == 0:
            continue

        drift.append(
            DeliveredDriftDiscrepancy(
                client_id=c.id,
                client_name=c.name,
                status=c.status or "UNKNOWN",
                as_of_label=as_of_label,
                ops_delivered=ops_d,
                dvi_delivered=dvi_d,
                cumul_delivered=cumul_d,
                sow_delivered=sow_d,
                span=span,
            )
        )
    drift.sort(key=lambda d: (d.status != "ACTIVE", -d.span))

    # ── Pod import issues (unmatched BQ client names) ────────────────────
    # Return ALL rows (not just unresolved) so a name the operator already
    # mapped stays visible with its status — the frontend filters by status.
    from app.models import PodNameOverride

    override_rows = await db.execute(
        select(PodNameOverride.raw_name, PodNameOverride.pod_kind, Client.name).join(
            Client, PodNameOverride.client_id == Client.id
        )
    )
    override_map = {(r.raw_name, r.pod_kind): r.name for r in override_rows.all()}

    pod_issues_result = await db.execute(
        select(PodImportIssue).order_by(PodImportIssue.last_seen_at.desc())
    )
    pod_issues: list[PodImportIssueItem] = []
    for row in pod_issues_result.scalars():
        mapped_to = override_map.get((row.raw_name, row.pod_kind))
        if row.resolved_at is not None:
            status = "resolved"
        elif mapped_to is not None:
            status = "mapped"
        else:
            status = "open"
        pod_issues.append(
            PodImportIssueItem(
                id=row.id,
                raw_name=row.raw_name,
                pod_kind=row.pod_kind,
                pod_label=row.pod_label,
                first_seen_at=row.first_seen_at,
                last_seen_at=row.last_seen_at,
                status=status,
                mapped_to=mapped_to,
            )
        )
    # Open first, then mapped (pending sync), then resolved; newest within each.
    _pod_rank = {"open": 0, "mapped": 1, "resolved": 2}
    pod_issues.sort(key=lambda p: (_pod_rank.get(p.status, 0), -p.last_seen_at.timestamp()))

    # ── Unassigned article pods (per-month pod coverage gaps) ────────────
    # Articles whose editorial month had no client_pod_history row → no as-of
    # pod → they fall into "Unassigned" on Monthly Articles. Group by client+month
    # so ops can see exactly where the source ET CP sheet is missing the client.
    cph_client_ids = set(
        (
            await db.execute(
                select(ClientPodHistory.client_id)
                .where(ClientPodHistory.client_id.is_not(None))
                .distinct()
            )
        ).scalars()
    )
    unassigned_result = await db.execute(
        select(
            ArticleRecord.client_name,
            ArticleRecord.client_id,
            ArticleRecord.year,
            ArticleRecord.month,
            func.count(func.distinct(ArticleRecord.article_uid)).label("article_count"),
        )
        .where(ArticleRecord.editorial_pod.is_(None))
        .where(ArticleRecord.year.is_not(None))
        .where(ArticleRecord.month.is_not(None))
        .group_by(
            ArticleRecord.client_name,
            ArticleRecord.client_id,
            ArticleRecord.year,
            ArticleRecord.month,
        )
        .order_by(ArticleRecord.year.desc(), ArticleRecord.month.desc())
    )
    unassigned_article_pods = [
        UnassignedArticlePodItem(
            client_name=row.client_name,
            client_id=row.client_id,
            year=row.year,
            month=row.month,
            article_count=row.article_count,
            hint=(
                "missing_month"
                if row.client_id is not None and row.client_id in cph_client_ids
                else "never_in_et_cp"
            ),
        )
        for row in unassigned_result
    ]
    unassigned_article_pods.sort(key=lambda u: (-(u.year * 12 + u.month), -u.article_count))

    # ── Missing clients — in a source sheet but not in the Hub ──────────────
    # `incomplete_clients` is populated by the production importers (Operating
    # Model / Delivered vs Invoiced / Meta) + ET CP history with the source tab.
    # Return ALL of them tagged with a status (the read-only self-heal becomes a
    # "resolved" tag rather than a hide) so the operator keeps a running log of
    # what was mapped / dismissed vs what's still open — the frontend filters.
    from app.models import ClientNameAlias, IncompleteClient

    def _norm_name(s: str) -> str:
        return "".join(ch for ch in s.lower() if ch.isalnum())

    name_rows = await db.execute(select(Client.name))
    live_norm = {_norm_name(n) for (n,) in name_rows.all() if n}

    alias_rows = await db.execute(select(ClientNameAlias.raw_name, ClientNameAlias.client_name))
    alias_map = {r.raw_name: r.client_name for r in alias_rows.all()}

    ic_rows = await db.execute(select(IncompleteClient))
    missing_clients: list[MissingClientItem] = []
    for ic in ic_rows.scalars():
        mapped_to = alias_map.get(ic.name_raw)
        if mapped_to is not None:
            status = "mapped"
        elif ic.resolved_at is not None:
            status = "dismissed"
        elif _norm_name(ic.name_raw) in live_norm:
            status = "resolved"  # added to SOW Overview since flagged
        else:
            status = "open"
        missing_clients.append(
            MissingClientItem(
                id=ic.id,
                name_raw=ic.name_raw,
                first_seen_tab=ic.first_seen_tab,
                last_seen_tab=ic.last_seen_tab,
                status=status,
                mapped_to=mapped_to,
            )
        )
    # Open first (still needs action), then the resolved kinds; alpha within.
    _mc_rank = {"open": 0, "mapped": 1, "resolved": 1, "dismissed": 2}
    missing_clients.sort(key=lambda m: (_mc_rank.get(m.status, 0), m.name_raw.lower()))

    return DiscrepanciesResponse(
        end_date_mismatches=end_mismatches,
        delivered_drift=drift,
        pod_import_issues=pod_issues,
        unassigned_article_pods=unassigned_article_pods,
        missing_clients=missing_clients,
        generated_at=datetime.utcnow(),
        as_of_label=as_of_label,
    )


@router.post("/missing-clients/{item_id}/dismiss")
async def dismiss_missing_client(item_id: int, db: AsyncSession = Depends(get_db)):
    """Dismiss a 'missing client' row — for noise rows that aren't real clients
    (e.g. 'Sales', 'New clients', section headers). Sets `resolved_at` so it
    drops off the Data Quality list and won't be re-flagged on the next sync
    (the importers skip names already resolved)."""
    from app.models import IncompleteClient

    ic = (
        (await db.execute(select(IncompleteClient).where(IncompleteClient.id == item_id)))
        .scalars()
        .first()
    )
    if ic is None:
        raise HTTPException(status_code=404, detail="Missing-client row not found")
    if ic.resolved_at is None:
        ic.resolved_at = datetime.utcnow()
        await db.commit()
    return {"dismissed": True, "id": item_id}


class MapMissingClientRequest(BaseModel):
    client_id: int


@router.post("/missing-clients/{item_id}/map")
async def map_missing_client(
    item_id: int, body: MapMissingClientRequest, db: AsyncSession = Depends(get_db)
):
    """Map a 'missing client' row to an existing Hub client — for sheet names
    that are a variant/acronym of a real client the fuzzy matcher can't catch
    (e.g. 'WL/SG support (Feb)' → 'Workleap+Sharegate'). Writes a
    `client_name_aliases` row so the SOW-client resolution picks it up on the
    next sync, and resolves the flag now so it drops off the list."""
    from app.models import ClientNameAlias, IncompleteClient

    ic = (
        (await db.execute(select(IncompleteClient).where(IncompleteClient.id == item_id)))
        .scalars()
        .first()
    )
    if ic is None:
        raise HTTPException(status_code=404, detail="Missing-client row not found")

    client = (await db.execute(select(Client).where(Client.id == body.client_id))).scalars().first()
    if client is None:
        raise HTTPException(status_code=404, detail="Target client not found")

    existing = (
        (await db.execute(select(ClientNameAlias).where(ClientNameAlias.raw_name == ic.name_raw)))
        .scalars()
        .first()
    )
    if existing is None:
        db.add(ClientNameAlias(raw_name=ic.name_raw, client_name=client.name))
    else:
        existing.client_name = client.name
    # Clear the flag now; it stays cleared because the alias resolves the name
    # on the next sync.
    ic.resolved_at = datetime.utcnow()
    await db.commit()
    return {"mapped": True, "raw_name": ic.name_raw, "client": client.name}


@router.post("/missing-clients/{item_id}/reopen")
async def reopen_missing_client(item_id: int, db: AsyncSession = Depends(get_db)):
    """Undo a map/dismiss — drops any alias for the name and clears `resolved_at`
    so the row returns to 'open'. Lets the operator correct a wrong mapping."""
    from app.models import ClientNameAlias, IncompleteClient

    ic = (
        (await db.execute(select(IncompleteClient).where(IncompleteClient.id == item_id)))
        .scalars()
        .first()
    )
    if ic is None:
        raise HTTPException(status_code=404, detail="Missing-client row not found")

    aliases = (
        (await db.execute(select(ClientNameAlias).where(ClientNameAlias.raw_name == ic.name_raw)))
        .scalars()
        .all()
    )
    for a in aliases:
        await db.delete(a)
    ic.resolved_at = None
    await db.commit()
    return {"reopened": True, "id": item_id}


@router.post("/pod-import-issues/{item_id}/reopen")
async def reopen_pod_import_issue(item_id: int, db: AsyncSession = Depends(get_db)):
    """Undo a pod-name override — drops the override for this (raw_name, pod_kind)
    and clears `resolved_at` so the row returns to 'open'."""
    from app.models import PodNameOverride

    issue = (
        (await db.execute(select(PodImportIssue).where(PodImportIssue.id == item_id)))
        .scalars()
        .first()
    )
    if issue is None:
        raise HTTPException(status_code=404, detail="Pod-import-issue row not found")

    overrides = (
        (
            await db.execute(
                select(PodNameOverride).where(
                    PodNameOverride.raw_name == issue.raw_name,
                    PodNameOverride.pod_kind == issue.pod_kind,
                )
            )
        )
        .scalars()
        .all()
    )
    for o in overrides:
        await db.delete(o)
    issue.resolved_at = None
    await db.commit()
    return {"reopened": True, "id": item_id}


# ---------------------------------------------------------------------------
# Pod-name overrides — user-editable BQ→DB client name mappings
# ---------------------------------------------------------------------------


class PodNameOverrideItem(BaseModel):
    id: int
    raw_name: str
    pod_kind: str
    client_id: int
    client_name: str
    created_by: str | None
    created_at: datetime


class PodNameOverrideCreate(BaseModel):
    raw_name: str
    pod_kind: str
    client_id: int


@router.get("/pod-name-overrides", response_model=list[PodNameOverrideItem])
async def list_pod_name_overrides(db: AsyncSession = Depends(get_db)):
    """Return all active pod-name overrides."""
    result = await db.execute(
        select(PodNameOverride).order_by(PodNameOverride.pod_kind, PodNameOverride.raw_name)
    )
    rows = result.scalars().all()
    return [
        PodNameOverrideItem(
            id=row.id,
            raw_name=row.raw_name,
            pod_kind=row.pod_kind,
            client_id=row.client_id,
            client_name=row.client.name,
            created_by=row.created_by,
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.post("/pod-name-overrides", response_model=PodNameOverrideItem, status_code=201)
async def create_pod_name_override(
    body: PodNameOverrideCreate,
    db: AsyncSession = Depends(get_db),
    user_email: str | None = None,
):
    """Create or replace a pod-name override mapping."""
    # Verify the client exists.
    client_result = await db.execute(select(Client).where(Client.id == body.client_id))
    client = client_result.scalars().first()
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")

    # Upsert on (raw_name, pod_kind).
    existing_result = await db.execute(
        select(PodNameOverride).where(
            PodNameOverride.raw_name == body.raw_name,
            PodNameOverride.pod_kind == body.pod_kind,
        )
    )
    existing = existing_result.scalars().first()
    if existing:
        existing.client_id = body.client_id
        existing.created_by = user_email
        row = existing
    else:
        row = PodNameOverride(
            raw_name=body.raw_name,
            pod_kind=body.pod_kind,
            client_id=body.client_id,
            created_by=user_email,
        )
        db.add(row)

    # NOTE: get_db() does not auto-commit — must commit explicitly or the row
    # rolls back on session close (this silently broke override persistence).
    await db.commit()
    await db.refresh(row)

    return PodNameOverrideItem(
        id=row.id,
        raw_name=row.raw_name,
        pod_kind=row.pod_kind,
        client_id=row.client_id,
        client_name=client.name,
        created_by=row.created_by,
        created_at=row.created_at,
    )


@router.delete("/pod-name-overrides/{override_id}", status_code=204)
async def delete_pod_name_override(override_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a pod-name override by ID."""
    result = await db.execute(select(PodNameOverride).where(PodNameOverride.id == override_id))
    row = result.scalars().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Override not found")
    await db.delete(row)
    await db.commit()


# ---------------------------------------------------------------------------
# Incomplete clients — names in ET CP tabs with no SOW Overview entry
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Pod history — per-client historical pod assignments from ET CP tabs
# ---------------------------------------------------------------------------


class PodHistoryEntry(BaseModel):
    client_name_raw: str
    client_id: int | None
    client_name: str | None
    current_pod: str | None  # clients.editorial_pod (live value from current ET CP tab)
    year: int
    month: int
    editorial_pod: str | None
    # standard / specialized tag for this client-month (drives the ×1.4
    # used-capacity weighting). None when the source cell was blank/unrecognized.
    category: str | None
    source_tab: str
    # SOW completeness — same shape as `/incomplete-clients`. Empty when the
    # client is fully populated. For unmatched names (client_id is None) this
    # is always ["sow_entry"]. Lets the frontend collapse "Missing SOW data"
    # + "Pod history" into a single tab.
    missing_fields: list[str]


def _client_missing_fields(client: Client | None) -> list[str]:
    """SOW fields missing on a Client row. Mirrors the same logic as the
    `/incomplete-clients` endpoint so the two surfaces stay aligned."""
    if client is None:
        return ["sow_entry"]
    missing: list[str] = []
    if client.start_date is None:
        missing.append("start_date")
    if client.end_date is None:
        missing.append("end_date")
    if client.articles_sow is None or client.articles_sow == 0:
        missing.append("articles_sow")
    return missing


@router.get("/pod-history", response_model=list[PodHistoryEntry])
async def list_pod_history(db: AsyncSession = Depends(get_db)):
    """Return all client_pod_history rows ordered by client name then month.

    Each row also carries the linked Hub client's `missing_fields` (start_date /
    end_date / articles_sow) so the frontend can render "Pod history" and
    "Missing SOW data" as a single tab — the same client appears once, with
    chips for both its pod history AND its missing SOW columns.
    """
    result = await db.execute(
        select(ClientPodHistory)
        .options(selectinload(ClientPodHistory.client))
        .order_by(
            ClientPodHistory.client_name_raw,
            ClientPodHistory.year,
            ClientPodHistory.month,
        )
    )
    rows = result.scalars().all()
    return [
        PodHistoryEntry(
            client_name_raw=row.client_name_raw,
            client_id=row.client_id,
            client_name=row.client.name if row.client else None,
            current_pod=row.client.editorial_pod if row.client else None,
            year=row.year,
            month=row.month,
            editorial_pod=row.editorial_pod,
            category=row.category,
            source_tab=row.source_tab,
            missing_fields=_client_missing_fields(row.client),
        )
        for row in rows
    ]


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
