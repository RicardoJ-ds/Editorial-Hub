"""Admin router — data-quality, discrepancy, and operational endpoints."""

from __future__ import annotations

import asyncio
from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
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


# ---------------------------------------------------------------------------
# Normalization summary — live stats for the Data Quality "Normalization" tab.
# Replaces the static claude.ai artifact; reads real counts so it never drifts.
# ---------------------------------------------------------------------------


class NormalizationSummary(BaseModel):
    distinct_articles: int  # COUNT(DISTINCT article_uid) — physical articles
    editor_credits: int  # article_records rows (one per article-editor)
    auditioning_writers: int  # distinct articles credited to "Auditioning Writer"
    distinct_editors: int
    distinct_writers: int
    total_client_tabs: int
    unresolved_client_tabs: int  # source tabs with no resolved Hub client
    tab_coverage_pct: float
    mappings_writer: int  # rows in BQ editorial_name_map by kind
    mappings_editor: int
    mappings_client: int
    generated_at: datetime


@router.get("/normalization-summary", response_model=NormalizationSummary)
async def normalization_summary(db: AsyncSession = Depends(get_db)):
    """Live counts behind the DQ Normalization tab: article volume, mapping
    inventory (BQ `editorial_name_map`), and client-tab resolution coverage."""

    async def _scalar(stmt) -> int:
        return (await db.execute(stmt)).scalar() or 0

    distinct_articles = await _scalar(select(func.count(func.distinct(ArticleRecord.article_uid))))
    editor_credits = await _scalar(select(func.count(ArticleRecord.id)))
    auditioning = await _scalar(
        select(func.count(func.distinct(ArticleRecord.article_uid))).where(
            ArticleRecord.writer_name == "Auditioning Writer"
        )
    )
    distinct_editors = await _scalar(select(func.count(func.distinct(ArticleRecord.editor_name))))
    distinct_writers = await _scalar(select(func.count(func.distinct(ArticleRecord.writer_name))))
    total_tabs = await _scalar(select(func.count(func.distinct(ArticleRecord.source_tab))))
    unresolved_tabs = await _scalar(
        select(func.count(func.distinct(ArticleRecord.source_tab))).where(
            ArticleRecord.client_id.is_(None)
        )
    )

    # BQ editorial_name_map row counts by kind (blocking client → thread).
    def _map_counts() -> dict[str, int]:
        from app.services.name_map_bq import fetch_name_map

        return {k: len(fetch_name_map(k)) for k in ("writer", "editor", "client")}

    mc = await asyncio.to_thread(_map_counts)

    coverage = round((total_tabs - unresolved_tabs) / total_tabs * 100, 1) if total_tabs else 0.0
    return NormalizationSummary(
        distinct_articles=distinct_articles,
        editor_credits=editor_credits,
        auditioning_writers=auditioning,
        distinct_editors=distinct_editors,
        distinct_writers=distinct_writers,
        total_client_tabs=total_tabs,
        unresolved_client_tabs=unresolved_tabs,
        tab_coverage_pct=coverage,
        mappings_writer=mc["writer"],
        mappings_editor=mc["editor"],
        mappings_client=mc["client"],
        generated_at=datetime.utcnow(),
    )


# ── Unmapped Names — one place to see names that didn't reconcile ────────────
# Every source that canonicalizes a name against the editorial roster/name-map
# emits its "misses" here so they get manual attention (add a row to the
# DaniQ-editable Editorial Name Mappings sheet → next SYNC re-resolves them).
# Signals are BQ-native: editorial_writer_desired.matched + editorial_raw_articles
# .editor/writer_match_status. Junk cells ("Writer", "Both", numbers) are filtered
# so the list is real, actionable gaps only.


class UnmappedNameItem(BaseModel):
    source: str  # writer_form | article_writer | article_editor
    source_label: str
    raw_name: str
    occurrences: int
    context: str | None = None  # ym / ym-range for the form source
    suggestion: str | None = None  # fuzzy roster match ("did you mean?")
    fix_hint: str  # where to fix it at the source


class UnmappedSourceCount(BaseModel):
    key: str
    label: str
    count: int


class UnmappedNamesResponse(BaseModel):
    items: list[UnmappedNameItem]
    sources: list[UnmappedSourceCount]
    generated_at: datetime


# Cells that are NOT names — markers/garbage seen in editor/writer columns.
_NAME_JUNK = {
    "", "-", "—", "n/a", "na", "no edits", "^", "^^", "tbd", "tbc", "?", "and",
    "both", "writer", "writers", "editor", "editors", "new writer", "unknown",
    "uknown", "none", "same", "self",
}
# Substrings that mark a cell as a note, not a clean name.
_JUNK_MARKERS = (
    "rewritten by", "trial", "aud writer", "auditioning", "onboarding",
    "backlog", "hasn't started", "hasnt started", "actively recruiting",
    "not hired", "not started",
)

_SRC_ORDER = {"writer_form": 0, "article_writer": 1, "article_editor": 2}
_SRC_LABEL = {
    "writer_form": "Writer form",
    "article_writer": "Article log (writer)",
    "article_editor": "Article log (editor)",
}
_SRC_FIX = {
    "writer_form": "Editorial Name Mappings ▸ Writers",
    "article_writer": "Editorial Name Mappings ▸ Writers",
    "article_editor": "Editorial Name Mappings ▸ Editors",
}


def _norm_name(raw: str) -> str:
    import re
    import unicodedata

    t = unicodedata.normalize("NFKD", str(raw or "").lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def _looks_like_name(raw: str) -> bool:
    n = _norm_name(raw)
    if not n or n in _NAME_JUNK:
        return False
    if not any(c.isalpha() for c in n) or len(n.replace(" ", "")) < 3:
        return False
    low = str(raw or "").lower()
    return not any(m in low for m in _JUNK_MARKERS)


def _fmt_ym(ym: int | None) -> str | None:
    if ym is None:
        return None
    return f"{ym // 100:04d}-{ym % 100:02d}"


@router.get("/unmapped-names", response_model=UnmappedNamesResponse)
async def list_unmapped_names():
    """Unresolved names across every reconciled source, junk-filtered, with a
    fuzzy roster suggestion + where to fix each at the source. Read-only — the
    fix is a row in the Editorial Name Mappings sheet; the next SYNC clears it.
    Degrades to an empty list if BigQuery is unreachable (never 500s the page)."""
    ds = f"{settings.bq_project}.{settings.bq_dataset}"

    def _fetch() -> dict:
        from app.services.bq_dashboard import q

        return {
            "wf": q(
                f"SELECT raw_name, COUNT(*) AS occ, MIN(ym) AS min_ym, MAX(ym) AS max_ym "
                f"FROM `{ds}.editorial_writer_desired` "
                "WHERE NOT matched AND raw_name IS NOT NULL GROUP BY raw_name"
            ),
            # 'unresolved' only — 'first_name_only' (pre-2025 writers kept under a
            # bare first name) is an accepted state, not an actionable mapping gap.
            "aw": q(
                f"SELECT writer_name AS raw_name, COUNT(*) AS occ "
                f"FROM `{ds}.editorial_raw_articles` "
                "WHERE writer_match_status = 'unresolved' "
                "AND writer_name IS NOT NULL GROUP BY writer_name"
            ),
            "ae": q(
                f"SELECT editor_name AS raw_name, COUNT(*) AS occ "
                f"FROM `{ds}.editorial_raw_articles` "
                "WHERE editor_match_status = 'unresolved' AND editor_name IS NOT NULL "
                "GROUP BY editor_name"
            ),
            "roster": q(
                f"SELECT DISTINCT canonical_name FROM `{ds}.v_editorial_roster` "
                "WHERE canonical_name IS NOT NULL"
            ),
        }

    try:
        data = await asyncio.to_thread(_fetch)
    except Exception:
        return UnmappedNamesResponse(items=[], sources=[], generated_at=datetime.utcnow())

    # Fuzzy "did you mean?" — exact norm, then first-name / prefix overlap.
    roster_norm: dict[str, str] = {}
    first_idx: dict[str, list[str]] = {}
    for r in data["roster"]:
        nm = r["canonical_name"]
        k = _norm_name(nm)
        if not k:
            continue
        roster_norm.setdefault(k, nm)
        first_idx.setdefault(k.split(" ")[0], []).append(nm)

    def _suggest(raw: str) -> str | None:
        k = _norm_name(raw)
        if k in roster_norm:
            return roster_norm[k]
        # Exact first-name only — loose prefix overlap mis-suggests
        # (e.g. "Daniela" → "Daniel …"), so require the first token to match.
        ft = k.split(" ")[0]
        hits = sorted(set(first_idx.get(ft, [])))
        if len(hits) == 1:
            return hits[0]
        if len(hits) > 1:
            return f"{len(hits)} candidates: " + ", ".join(hits[:3]) + ("…" if len(hits) > 3 else "")
        return None

    items: list[UnmappedNameItem] = []
    for src, rows in (("writer_form", data["wf"]), ("article_writer", data["aw"]), ("article_editor", data["ae"])):
        for r in rows:
            raw = str(r["raw_name"]).strip()
            if not _looks_like_name(raw):
                continue
            ctx = None
            if src == "writer_form":
                lo, hi = _fmt_ym(r.get("min_ym")), _fmt_ym(r.get("max_ym"))
                ctx = lo if lo == hi else f"{lo}..{hi}"
            items.append(
                UnmappedNameItem(
                    source=src,
                    source_label=_SRC_LABEL[src],
                    raw_name=raw,
                    occurrences=int(r["occ"]),
                    context=ctx,
                    suggestion=_suggest(raw),
                    fix_hint=_SRC_FIX[src],
                )
            )

    items.sort(key=lambda it: (_SRC_ORDER.get(it.source, 9), -it.occurrences, it.raw_name.lower()))
    sources = [
        UnmappedSourceCount(key=k, label=_SRC_LABEL[k], count=sum(1 for it in items if it.source == k))
        for k in ("writer_form", "article_writer", "article_editor")
    ]
    return UnmappedNamesResponse(items=items, sources=sources, generated_at=datetime.utcnow())
