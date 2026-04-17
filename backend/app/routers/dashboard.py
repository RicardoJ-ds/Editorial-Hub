from datetime import date

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    CapacityProjection,
    Client,
    DeliverableMonthly,
    DeliveryTemplate,
    EngagementRule,
    ProductionHistory,
)
from app.schemas import (
    CapacitySummary,
    ClientPacing,
    ClientProductionMonth,
    ClientProductionRow,
    ClientProductionTotals,
    DashboardSummary,
    EngagementCompliance,
    ProductionTrendPoint,
    TimeToMetric,
)
from app.services.calculations import (
    capacity_status,
    capacity_utilization_pct,
    pacing_status,
    time_to_metric,
)

router = APIRouter()


@router.get("/clients/summary", response_model=DashboardSummary)
async def clients_summary(db: AsyncSession = Depends(get_db)):
    # Aggregate stats for active clients
    stmt = select(
        func.count(Client.id),
        func.coalesce(func.sum(Client.articles_sow), 0),
        func.coalesce(func.sum(Client.articles_delivered), 0),
        func.coalesce(func.sum(Client.articles_invoiced), 0),
    ).where(Client.status == "ACTIVE")

    result = await db.execute(stmt)
    row = result.one()

    total_active, total_sow, total_delivered, total_invoiced = row

    # Average time from editorial KO to first article delivered (active clients only)
    clients_result = await db.execute(
        select(Client.editorial_ko_date, Client.first_article_delivered_date).where(
            Client.status == "ACTIVE",
            Client.editorial_ko_date.isnot(None),
            Client.first_article_delivered_date.isnot(None),
        )
    )
    rows = clients_result.all()

    avg_days = None
    if rows:
        deltas = [
            time_to_metric(ko, delivered)
            for ko, delivered in rows
            if time_to_metric(ko, delivered) is not None
        ]
        if deltas:
            avg_days = round(sum(deltas) / len(deltas), 1)

    return DashboardSummary(
        total_active_clients=total_active,
        total_articles_sow=total_sow,
        total_articles_delivered=total_delivered,
        total_articles_invoiced=total_invoiced,
        avg_time_to_first_article_days=avg_days,
    )


@router.get("/clients/time-to-metrics", response_model=list[TimeToMetric])
async def clients_time_to_metrics(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Client).where(Client.status == "ACTIVE").order_by(Client.name))
    clients = result.scalars().all()

    metrics = []
    for client in clients:
        ko = client.editorial_ko_date
        metrics.append(
            TimeToMetric(
                client_name=client.name,
                ko_to_first_cb_days=time_to_metric(ko, client.first_cb_approved_date),
                ko_to_first_article_days=time_to_metric(ko, client.first_article_delivered_date),
                ko_to_first_feedback_days=time_to_metric(ko, client.first_feedback_date),
                ko_to_first_published_days=time_to_metric(ko, client.first_article_published_date),
                cb_to_first_article_days=time_to_metric(
                    client.first_cb_approved_date,
                    client.first_article_delivered_date,
                ),
            )
        )

    return metrics


@router.get("/kpis/capacity-summary", response_model=list[CapacitySummary])
async def kpis_capacity_summary(
    year: int | None = None,
    pod: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(CapacityProjection)

    if year is not None:
        stmt = stmt.where(CapacityProjection.year == year)
    if pod:
        stmt = stmt.where(CapacityProjection.pod == pod)

    stmt = stmt.order_by(CapacityProjection.pod, CapacityProjection.year, CapacityProjection.month)
    result = await db.execute(stmt)
    projections = result.scalars().all()

    summaries = []
    for proj in projections:
        total = proj.total_capacity or 0
        used = proj.actual_used_capacity or proj.projected_used_capacity or 0
        pct = capacity_utilization_pct(used, total)

        summaries.append(
            CapacitySummary(
                pod=proj.pod,
                month=proj.month,
                year=proj.year,
                total_capacity=total,
                projected_used=proj.projected_used_capacity or 0,
                actual_used=proj.actual_used_capacity,
                utilization_pct=pct,
                status=capacity_status(pct),
            )
        )

    return summaries


@router.get("/client-production", response_model=list[ClientProductionRow])
async def client_production(db: AsyncSession = Depends(get_db)):
    """Per-client monthly production (actual vs projected from the Editorial
    Operating Model) plus per-client totals used by the Client Engagement
    Timeline's % Delivered view and its right-hand summary sidebar.

    Shape:
        [
          {
            client_name, editorial_pod,
            monthly: [{year, month, actual, projected}, ...],
            totals: {projected, delivered, sow, reconciliation},
          },
          ...
        ]

    Reconciliation is `sow - delivered - projected`; negative means the
    client is over-committed relative to contract.
    """
    # Fetch every client that has an SOW or any production row — avoids missing
    # clients whose Operating Model rows are all zero but have a SOW on file.
    clients_result = await db.execute(
        select(Client).order_by(Client.name)
    )
    clients = list(clients_result.scalars().all())

    # Load all production history rows in one shot, group in-memory by client.
    ph_result = await db.execute(
        select(
            ProductionHistory.client_id,
            ProductionHistory.year,
            ProductionHistory.month,
            ProductionHistory.articles_actual,
            ProductionHistory.articles_projected,
        )
    )
    ph_by_client: dict[int, list[ClientProductionMonth]] = {}
    actual_totals: dict[int, int] = {}
    projected_totals: dict[int, int] = {}
    for client_id, year, month, actual, projected in ph_result.all():
        actual_int = int(actual or 0)
        projected_int = int(projected or 0)
        ph_by_client.setdefault(client_id, []).append(
            ClientProductionMonth(
                year=int(year),
                month=int(month),
                actual=actual_int,
                projected=projected_int,
            )
        )
        actual_totals[client_id] = actual_totals.get(client_id, 0) + actual_int
        projected_totals[client_id] = projected_totals.get(client_id, 0) + projected_int

    rows: list[ClientProductionRow] = []
    for client in clients:
        monthly = sorted(
            ph_by_client.get(client.id, []),
            key=lambda m: (m.year, m.month),
        )
        # Prefer ProductionHistory sum for delivered when available, otherwise
        # fall back to the Client.articles_delivered column.
        delivered = actual_totals.get(client.id, 0) or int(client.articles_delivered or 0)
        projected = projected_totals.get(client.id, 0)
        sow = int(client.articles_sow or 0)
        reconciliation = sow - delivered - projected

        # Skip clients with no SOW and no production history entirely.
        if not monthly and sow == 0 and delivered == 0 and projected == 0:
            continue

        rows.append(
            ClientProductionRow(
                client_name=client.name,
                editorial_pod=client.editorial_pod,
                monthly=monthly,
                totals=ClientProductionTotals(
                    projected=projected,
                    delivered=delivered,
                    sow=sow,
                    reconciliation=reconciliation,
                ),
            )
        )

    return rows


@router.get("/production-trend", response_model=list[ProductionTrendPoint])
async def production_trend(db: AsyncSession = Depends(get_db)):
    """Aggregate production history by year/month across all clients."""
    stmt = (
        select(
            ProductionHistory.year,
            ProductionHistory.month,
            func.coalesce(func.sum(ProductionHistory.articles_actual), 0),
            func.coalesce(func.sum(ProductionHistory.articles_projected), 0),
            ProductionHistory.is_actual,
        )
        .group_by(
            ProductionHistory.year,
            ProductionHistory.month,
            ProductionHistory.is_actual,
        )
        .order_by(ProductionHistory.year, ProductionHistory.month)
    )
    result = await db.execute(stmt)
    rows = result.all()

    return [
        ProductionTrendPoint(
            year=row[0],
            month=row[1],
            total_actual=row[2],
            total_projected=row[3],
            is_actual=row[4],
        )
        for row in rows
    ]


@router.get("/pacing", response_model=list[ClientPacing])
async def client_pacing(db: AsyncSession = Depends(get_db)):
    """Calculate delivery pacing for each active client against delivery templates."""
    # Get active clients with SOW info
    clients_result = await db.execute(
        select(Client).where(Client.status == "ACTIVE").order_by(Client.name)
    )
    clients = clients_result.scalars().all()

    # Load all delivery templates
    templates_result = await db.execute(select(DeliveryTemplate))
    templates = templates_result.scalars().all()
    # Organize templates by sow_size -> {month_number: template}
    template_map: dict[int, dict[int, DeliveryTemplate]] = {}
    for t in templates:
        template_map.setdefault(t.sow_size, {})[t.month_number] = t

    today = date.today()
    pacing_list: list[ClientPacing] = []

    for client in clients:
        sow_size = client.articles_sow or 0
        start = client.start_date
        if sow_size <= 0 or start is None:
            continue

        # Find the closest matching template SOW size
        available_sow_sizes = sorted(template_map.keys())
        if not available_sow_sizes:
            continue
        closest_sow = min(available_sow_sizes, key=lambda s: abs(s - sow_size))
        tmpl = template_map[closest_sow]

        # Calculate months elapsed
        delta = relativedelta(today, start)
        months_elapsed = delta.years * 12 + delta.months + (1 if delta.days > 0 else 0)
        if months_elapsed < 1:
            months_elapsed = 1
        if months_elapsed > 12:
            months_elapsed = 12

        # Get expected cumulative from template
        month_template = tmpl.get(months_elapsed)
        expected_cumulative = (month_template.delivery_cumulative or 0) if month_template else 0

        # Get actual cumulative delivered from deliverables_monthly
        delivered_result = await db.execute(
            select(func.coalesce(func.sum(DeliverableMonthly.articles_delivered), 0)).where(
                DeliverableMonthly.client_id == client.id
            )
        )
        actual_cumulative = delivered_result.scalar() or 0

        # Calculate delta_pct
        if expected_cumulative > 0:
            delta_pct = round(
                (actual_cumulative - expected_cumulative) / expected_cumulative * 100, 1
            )
        else:
            delta_pct = 0.0

        status = pacing_status(actual_cumulative, expected_cumulative)

        pacing_list.append(
            ClientPacing(
                client_name=client.name,
                sow_size=sow_size,
                months_elapsed=months_elapsed,
                actual_cumulative=actual_cumulative,
                expected_cumulative=expected_cumulative,
                delta_pct=delta_pct,
                status=status,
            )
        )

    return pacing_list


@router.get("/engagement-health", response_model=list[EngagementCompliance])
async def engagement_health(db: AsyncSession = Depends(get_db)):
    """Evaluate compliance of active clients against engagement rules."""
    # Get all engagement rules
    rules_result = await db.execute(select(EngagementRule).order_by(EngagementRule.rule_number))
    rules = rules_result.scalars().all()

    if not rules:
        return []

    # Get active clients
    clients_result = await db.execute(
        select(Client).where(Client.status == "ACTIVE").order_by(Client.name)
    )
    clients = clients_result.scalars().all()

    compliance_list: list[EngagementCompliance] = []

    for client in clients:
        details: list[dict] = []
        rules_met = 0

        for rule in rules:
            met = _evaluate_rule(client, rule)
            if met:
                rules_met += 1
            details.append(
                {
                    "rule_number": rule.rule_number,
                    "rule_name": rule.rule_name,
                    "met": met,
                }
            )

        rules_total = len(rules)
        score_pct = round((rules_met / rules_total * 100), 1) if rules_total > 0 else 0.0

        compliance_list.append(
            EngagementCompliance(
                client_name=client.name,
                rules_met=rules_met,
                rules_total=rules_total,
                score_pct=score_pct,
                details=details,
            )
        )

    return compliance_list


def _evaluate_rule(client: Client, rule: EngagementRule) -> bool:
    """Heuristic evaluation of whether a client meets a given engagement rule.

    Uses available client data to make a best-effort assessment.
    Rules that cannot be evaluated from available data default to True (met).
    """
    rn = rule.rule_number

    if rn == 1:
        # CBs approved and editorial KO completed before production starts
        return client.first_cb_approved_date is not None and client.editorial_ko_date is not None

    if rn == 2:
        # Deliver 1-2 articles in M1 — check that first article delivery date
        # is close to editorial KO date (within ~45 days)
        if client.editorial_ko_date and client.first_article_delivered_date:
            days = (client.first_article_delivered_date - client.editorial_ko_date).days
            return days <= 45
        return False

    if rn == 3:
        # Deliver first 5 articles in M2 — heuristic: first article delivered
        # within 60 days of editorial KO
        if client.editorial_ko_date and client.first_article_delivered_date:
            days = (client.first_article_delivered_date - client.editorial_ko_date).days
            return days <= 60
        return False

    if rn == 4:
        # Cannot scale past 5 without feedback — check feedback date exists
        return client.first_feedback_date is not None

    if rn == 5:
        # Plan for 2-week turnaround after CB approval
        if client.first_cb_approved_date and client.first_article_delivered_date:
            days = (client.first_article_delivered_date - client.first_cb_approved_date).days
            return days >= 10  # at least ~2 weeks of lead time expected
        return False

    if rn == 6:
        # AMs/SEs accountable for delivery counts — check that delivery data exists
        return (client.articles_delivered or 0) > 0

    if rn == 7:
        # Match delivered to invoiced (variance <= 5)
        delivered = client.articles_delivered or 0
        invoiced = client.articles_invoiced or 0
        return abs(delivered - invoiced) <= 5

    # Rules 8, 9: process rules that cannot be evaluated from data
    if rn in (8, 9):
        return True

    if rn == 10:
        # Finish scope by M12 — check if completed or on track
        if client.end_date:
            return (client.articles_delivered or 0) >= (client.articles_sow or 0)
        return True

    # Default: cannot evaluate, assume met
    return True
