"""Unified client delivery service — joins data across all delivery tables."""

from __future__ import annotations

import logging
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Client,
    CumulativeMetric,
    DeliverableMonthly,
    GoalsVsDelivery,
    ProductionHistory,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Month-year parsing
# ---------------------------------------------------------------------------

MONTH_MAP = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}

MONTH_LABELS = [
    "",
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
]


def parse_month_year(month_year: str) -> tuple[int, int] | None:
    """Parse 'March 2026' -> (2026, 3)."""
    parts = month_year.strip().split()
    if len(parts) != 2:
        return None
    month_name, year_str = parts
    month = MONTH_MAP.get(month_name.lower())
    if month is None:
        return None
    try:
        year = int(year_str)
    except ValueError:
        return None
    return (year, month)


def _build_name_index(clients: Sequence[Client]) -> dict[str, int]:
    """Case-insensitive client name -> id lookup."""
    index: dict[str, int] = {}
    for c in clients:
        index[c.name.strip().lower()] = c.id
    return index


# ---------------------------------------------------------------------------
# Monthly overview (client × month)
# ---------------------------------------------------------------------------


def get_monthly_overview(
    session: Session,
    *,
    year: int | None = None,
    month: int | None = None,
    growth_pod: str | None = None,
    editorial_pod: str | None = None,
    status: str | None = None,
    search: str | None = None,
) -> list[dict]:
    """Return joined client-month rows from DeliverableMonthly + ProductionHistory + GoalsVsDelivery."""

    # 1. Query clients with filters
    stmt = select(Client)
    if status:
        stmt = stmt.where(Client.status == status)
    if growth_pod:
        stmt = stmt.where(Client.growth_pod == growth_pod)
    if editorial_pod:
        stmt = stmt.where(Client.editorial_pod == editorial_pod)
    if search:
        stmt = stmt.where(Client.name.ilike(f"%{search}%"))

    clients = session.execute(stmt.order_by(Client.name)).scalars().all()
    if not clients:
        return []

    client_map = {c.id: c for c in clients}
    client_ids = list(client_map.keys())
    name_index = _build_name_index(clients)

    # 2. Query DeliverableMonthly
    dm_stmt = select(DeliverableMonthly).where(DeliverableMonthly.client_id.in_(client_ids))
    if year:
        dm_stmt = dm_stmt.where(DeliverableMonthly.year == year)
    if month:
        dm_stmt = dm_stmt.where(DeliverableMonthly.month == month)
    dm_rows = session.execute(dm_stmt).scalars().all()
    dm_map: dict[tuple[int, int, int], DeliverableMonthly] = {}
    for dm in dm_rows:
        dm_map[(dm.client_id, dm.year, dm.month)] = dm

    # 3. Query ProductionHistory
    ph_stmt = select(ProductionHistory).where(ProductionHistory.client_id.in_(client_ids))
    if year:
        ph_stmt = ph_stmt.where(ProductionHistory.year == year)
    if month:
        ph_stmt = ph_stmt.where(ProductionHistory.month == month)
    ph_rows = session.execute(ph_stmt).scalars().all()
    ph_map: dict[tuple[int, int, int], ProductionHistory] = {}
    for ph in ph_rows:
        key = (ph.client_id, ph.year, ph.month)
        # Keep the actual row over projected if both exist
        if key not in ph_map or ph.is_actual:
            ph_map[key] = ph

    # 4. Query GoalsVsDelivery and aggregate to month level
    gvd_stmt = select(GoalsVsDelivery)
    if growth_pod:
        gvd_stmt = gvd_stmt.where(
            (GoalsVsDelivery.growth_team_pod == growth_pod)
            | (GoalsVsDelivery.editorial_team_pod == growth_pod)
        )
    if editorial_pod:
        gvd_stmt = gvd_stmt.where(GoalsVsDelivery.editorial_team_pod == editorial_pod)
    gvd_rows = session.execute(gvd_stmt).scalars().all()

    # Aggregate weekly → monthly: MAX(to_date), first non-null goal, count weeks
    gvd_map: dict[tuple[int, int, int], dict] = {}
    for gvd in gvd_rows:
        parsed = parse_month_year(gvd.month_year)
        if not parsed:
            continue
        gvd_year, gvd_month = parsed
        if year and gvd_year != year:
            continue
        if month and gvd_month != month:
            continue

        cid = name_index.get(gvd.client_name.strip().lower())
        if cid is None or cid not in client_map:
            continue

        key = (cid, gvd_year, gvd_month)
        if key not in gvd_map:
            gvd_map[key] = {
                "cb_delivered_to_date": None,
                "cb_monthly_goal": None,
                "ad_delivered_to_date": None,
                "ad_monthly_goal": None,
                "ad_revisions": None,
                "ad_cb_backlog": None,
                "weeks_with_data": 0,
            }
        agg = gvd_map[key]
        agg["weeks_with_data"] += 1
        # MAX of to_date fields across weeks
        if gvd.cb_delivered_to_date is not None:
            agg["cb_delivered_to_date"] = max(
                agg["cb_delivered_to_date"] or 0, gvd.cb_delivered_to_date
            )
        if gvd.ad_delivered_to_date is not None:
            agg["ad_delivered_to_date"] = max(
                agg["ad_delivered_to_date"] or 0, gvd.ad_delivered_to_date
            )
        # First non-null goals
        if agg["cb_monthly_goal"] is None and gvd.cb_monthly_goal is not None:
            agg["cb_monthly_goal"] = gvd.cb_monthly_goal
        if agg["ad_monthly_goal"] is None and gvd.ad_monthly_goal is not None:
            agg["ad_monthly_goal"] = gvd.ad_monthly_goal
        # Latest revisions and backlog
        if gvd.ad_revisions is not None:
            agg["ad_revisions"] = gvd.ad_revisions
        if gvd.ad_cb_backlog is not None:
            agg["ad_cb_backlog"] = gvd.ad_cb_backlog

    # 5. Union all keys and build rows
    all_keys: set[tuple[int, int, int]] = set()
    all_keys.update(dm_map.keys())
    all_keys.update(ph_map.keys())
    all_keys.update(gvd_map.keys())

    rows: list[dict] = []
    for cid, yr, mo in sorted(
        all_keys,
        key=lambda k: (
            k[1],
            k[2],
            client_map.get(k[0], Client()).name if k[0] in client_map else "",
        ),
    ):
        c = client_map.get(cid)
        if c is None:
            continue

        dm = dm_map.get((cid, yr, mo))
        ph = ph_map.get((cid, yr, mo))
        gvd_agg = gvd_map.get((cid, yr, mo))

        sow = (dm.articles_sow_target if dm else None) or 0
        delivered = (dm.articles_delivered if dm else None) or 0
        pct = round((delivered / sow) * 100) if sow > 0 else 0

        cb_to_date = gvd_agg["cb_delivered_to_date"] if gvd_agg else None
        cb_goal = gvd_agg["cb_monthly_goal"] if gvd_agg else None
        ad_to_date = gvd_agg["ad_delivered_to_date"] if gvd_agg else None
        ad_goal = gvd_agg["ad_monthly_goal"] if gvd_agg else None

        cb_pct = (
            round((cb_to_date / cb_goal) * 100) if cb_to_date and cb_goal and cb_goal > 0 else None
        )
        ad_pct = (
            round((ad_to_date / ad_goal) * 100) if ad_to_date and ad_goal and ad_goal > 0 else None
        )

        rows.append(
            {
                "client_id": cid,
                "client_name": c.name,
                "status": c.status,
                "growth_pod": c.growth_pod,
                "editorial_pod": c.editorial_pod,
                "year": yr,
                "month": mo,
                "month_label": f"{MONTH_LABELS[mo]} {yr}",
                # DeliverableMonthly
                "articles_sow_target": dm.articles_sow_target if dm else None,
                "articles_delivered": dm.articles_delivered if dm else None,
                "articles_invoiced": dm.articles_invoiced if dm else None,
                "variance": dm.variance if dm else None,
                # ProductionHistory
                "articles_actual": ph.articles_actual if ph else None,
                "articles_projected": ph.articles_projected if ph else None,
                "is_actual": ph.is_actual if ph else None,
                # GoalsVsDelivery (aggregated)
                "cb_delivered_to_date": cb_to_date,
                "cb_monthly_goal": cb_goal,
                "cb_pct": cb_pct,
                "ad_delivered_to_date": ad_to_date,
                "ad_monthly_goal": ad_goal,
                "ad_pct": ad_pct,
                "ad_revisions": gvd_agg["ad_revisions"] if gvd_agg else None,
                "ad_cb_backlog": gvd_agg["ad_cb_backlog"] if gvd_agg else None,
                "weeks_with_data": gvd_agg["weeks_with_data"] if gvd_agg else 0,
                # Computed
                "pct_complete": pct,
            }
        )

    return rows


# ---------------------------------------------------------------------------
# All-time overview (client only)
# ---------------------------------------------------------------------------


def get_alltime_overview(
    session: Session,
    *,
    growth_pod: str | None = None,
    editorial_pod: str | None = None,
    status: str | None = None,
    search: str | None = None,
) -> list[dict]:
    """Return joined client + CumulativeMetric rows."""

    # 1. Query clients
    stmt = select(Client)
    if status:
        stmt = stmt.where(Client.status == status)
    if growth_pod:
        stmt = stmt.where(Client.growth_pod == growth_pod)
    if editorial_pod:
        stmt = stmt.where(Client.editorial_pod == editorial_pod)
    if search:
        stmt = stmt.where(Client.name.ilike(f"%{search}%"))
    clients = session.execute(stmt.order_by(Client.name)).scalars().all()
    name_index = _build_name_index(clients)

    # 2. Query CumulativeMetric
    cm_stmt = select(CumulativeMetric)
    cm_rows = session.execute(cm_stmt).scalars().all()
    cm_map: dict[int, CumulativeMetric] = {}
    for cm in cm_rows:
        cid = name_index.get(cm.client_name.strip().lower())
        if cid is not None:
            cm_map[cid] = cm

    # 3. Build rows
    rows: list[dict] = []
    for c in clients:
        cm = cm_map.get(c.id)

        def safe_pct(approved: int | None, sent: int | None) -> float | None:
            if not approved or not sent or sent == 0:
                return None
            return round((approved / sent) * 100, 1)

        rows.append(
            {
                "client_id": c.id,
                "client_name": c.name,
                "status": c.status,
                "growth_pod": c.growth_pod,
                "editorial_pod": c.editorial_pod,
                "account_team_pod": cm.account_team_pod if cm else None,
                # Client aggregates
                "articles_sow": c.articles_sow,
                "articles_delivered": c.articles_delivered,
                "articles_invoiced": c.articles_invoiced,
                # CumulativeMetric
                "topics_sent": cm.topics_sent if cm else None,
                "topics_approved": cm.topics_approved if cm else None,
                "cbs_sent": cm.cbs_sent if cm else None,
                "cbs_approved": cm.cbs_approved if cm else None,
                "articles_sent": cm.articles_sent if cm else None,
                "articles_approved": cm.articles_approved if cm else None,
                "articles_difference": cm.articles_difference if cm else None,
                "published_live": cm.published_live if cm else None,
                # Computed
                "topics_approval_pct": safe_pct(
                    cm.topics_approved if cm else None, cm.topics_sent if cm else None
                ),
                "cbs_approval_pct": safe_pct(
                    cm.cbs_approved if cm else None, cm.cbs_sent if cm else None
                ),
                "articles_approval_pct": safe_pct(
                    cm.articles_approved if cm else None, cm.articles_sent if cm else None
                ),
            }
        )

    return rows


# ---------------------------------------------------------------------------
# Weekly detail (one client, one month)
# ---------------------------------------------------------------------------


def get_weekly_detail(
    session: Session,
    *,
    client_name: str,
    year: int,
    month: int,
) -> list[dict]:
    """Return raw weekly GoalsVsDelivery rows for one client-month."""

    # Build month_year candidates (e.g., "March 2026")
    month_names = [
        "",
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ]
    target_month_year = f"{month_names[month]} {year}"

    stmt = (
        select(GoalsVsDelivery)
        .where(
            GoalsVsDelivery.client_name == client_name,
            GoalsVsDelivery.month_year == target_month_year,
        )
        .order_by(GoalsVsDelivery.week_number)
    )

    gvd_rows = session.execute(stmt).scalars().all()

    return [
        {
            "client_name": g.client_name,
            "month_year": g.month_year,
            "week_number": g.week_number,
            "week_date": str(g.week_date) if g.week_date else None,
            "cb_delivered_today": g.cb_delivered_today,
            "cb_projection": g.cb_projection,
            "cb_delivered_to_date": g.cb_delivered_to_date,
            "cb_monthly_goal": g.cb_monthly_goal,
            "cb_pct_of_goal": g.cb_pct_of_goal,
            "ad_revisions": g.ad_revisions,
            "ad_delivered_today": g.ad_delivered_today,
            "ad_projection": g.ad_projection,
            "ad_cb_backlog": g.ad_cb_backlog,
            "ad_delivered_to_date": g.ad_delivered_to_date,
            "ad_monthly_goal": g.ad_monthly_goal,
            "ad_pct_of_goal": g.ad_pct_of_goal,
        }
        for g in gvd_rows
    ]
