"""Admin · Analytics — in-app usage tracking.

Endpoints:
    POST  /api/analytics/event   — append-only event ingest (batched)
    GET   /api/analytics/summary — pre-aggregated rollups for the dashboard

The event endpoint is open to any authenticated user — every consumer
of the Hub is a candidate event source. The summary endpoint is gated
behind `admin.analytics`, which only the Admin group holds (forced
grant in `_DEFAULT_PERMISSIONS`).

Privacy notes:
  • Email is the only PII captured (already in the JWT cookie).
  • No client_ids beyond the filter chips the user already sees.
  • props is a small JSON blob; clients are responsible for not
    sending freeform text. Server-side, length is capped.
  • Retention is 6 months — enforced via startup trim in main.py.

The summary endpoint stays inside a SINGLE SQL query per card so the
page renders fast even with months of accumulated events. Five cards,
five queries — each scoped to the requested range (7d / 30d / 90d).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_deps import current_email, require_view
from app.database import get_db
from app.models import AccessGroup, AccessGroupMember, UsageEvent
from app.services.access import AccessProfile

router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/analytics/event — batched event ingest
# ─────────────────────────────────────────────────────────────────────────────


class EventIn(BaseModel):
    """One event as sent by the frontend. The server adds occurred_at
    if the client didn't supply it (clock drift safety net)."""

    event_type: str = Field(min_length=1, max_length=40)
    route: str = Field(min_length=1, max_length=255)
    section_id: str | None = Field(default=None, max_length=80)
    props: dict | None = None
    session_id: str = Field(min_length=1, max_length=40)
    # ISO-8601 from the client. Optional — server falls back to NOW().
    # Useful when the frontend buffers events across a network hiccup
    # and flushes them later; we want the original occurrence time, not
    # the flush time.
    occurred_at: datetime | None = None


class EventBatchIn(BaseModel):
    events: list[EventIn] = Field(min_length=1, max_length=50)


# Soft per-user rate limit — naive in-memory counter. The frontend
# batches every 10s and never sends more than 5 events at once, so a
# user pushing 60 events/min is already misbehaving. We just drop the
# excess.
_RATE_WINDOW_SECONDS = 60
_RATE_LIMIT_PER_WINDOW = 200  # generous — accounts for legitimate
# cross-page-load batches stacking up
_RATE_BUCKETS: dict[str, list[float]] = {}


def _allowed_under_rate_limit(email: str) -> bool:
    """Sliding-window rate limit, per email. Keeps state in-process —
    fine for our scale (one backend instance) and intentionally not
    in Redis: an admin gaming the events with a tab open won't move the
    needle on summary statistics."""
    now = datetime.utcnow().timestamp()
    cutoff = now - _RATE_WINDOW_SECONDS
    bucket = _RATE_BUCKETS.setdefault(email, [])
    # Drop expired timestamps
    while bucket and bucket[0] < cutoff:
        bucket.pop(0)
    if len(bucket) >= _RATE_LIMIT_PER_WINDOW:
        return False
    bucket.append(now)
    return True


class IngestResult(BaseModel):
    """Returned to keep the frontend's apiPost happy — it calls
    res.json() unconditionally, so a 204 would silently throw inside
    the batched flush() and we'd lose every event. Always 200 + tiny
    body."""

    accepted: int
    dropped: int = 0


@router.post("/event", response_model=IngestResult)
async def ingest_events(
    body: EventBatchIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    email: Annotated[str, Depends(current_email)],
):
    """Accept a batch of events and append-only insert. Always 200 —
    even when some events were dropped due to rate-limit — because the
    frontend fires-and-forgets; telemetry shouldn't break user flow.
    Returns a tiny `{accepted, dropped}` body so the apiPost helper's
    `res.json()` call succeeds."""
    if not _allowed_under_rate_limit(email):
        # Silent drop — caller's batch lost, but the request succeeds.
        return IngestResult(accepted=0, dropped=len(body.events))

    rows = []
    for ev in body.events:
        # Defensive: clamp props blob if absurdly large (Postgres jsonb
        # can hold ~1 GB but we don't want a single misbehaving client
        # to bloat the table).
        props = ev.props if ev.props is not None else None
        if props is not None and len(str(props)) > 4000:
            props = {"_truncated": True}

        # Normalize occurred_at to naive UTC. The frontend sends ISO-
        # 8601 with `Z` (tz-aware), but the `usage_events.occurred_at`
        # column is tz-naive `DateTime` to match every other timestamp
        # in this codebase. Inserting a tz-aware value otherwise
        # raises `can't subtract offset-naive and offset-aware
        # datetimes` and the whole batch rolls back.
        occurred = ev.occurred_at or datetime.utcnow()
        if occurred.tzinfo is not None:
            occurred = occurred.astimezone(timezone.utc).replace(tzinfo=None)

        rows.append(
            UsageEvent(
                user_email=email,
                event_type=ev.event_type[:40],
                route=ev.route[:255],
                section_id=(ev.section_id or None),
                props=props,
                session_id=ev.session_id[:40],
                occurred_at=occurred,
            )
        )

    db.add_all(rows)
    await db.commit()
    return IngestResult(accepted=len(rows))


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/analytics/summary — pre-aggregated rollups
# ─────────────────────────────────────────────────────────────────────────────


class TopRouteRow(BaseModel):
    route: str
    page_views: int
    unique_users: int


class TopSectionRow(BaseModel):
    route: str
    section_id: str
    views: int
    avg_dwell_ms: int | None  # NULL when section emits view events without dwell


class PerUserRow(BaseModel):
    user_email: str
    last_seen_at: datetime
    sessions_count: int
    events_count: int
    top_route: str | None


class FilterRow(BaseModel):
    dimension: str  # "pod_axis", "editorial_pod", "growth_pod", "status", "date_range"
    value: str
    count: int


class ReturnCadenceRow(BaseModel):
    user_email: str
    median_gap_days: float
    visits: int


class DailyActivityRow(BaseModel):
    """One row per (day × event_type) for the activity timeline."""

    day: str  # YYYY-MM-DD
    event_type: str
    count: int


class DrillDownRow(BaseModel):
    """Variant breakdown of DrillDownOpened events — which popover
    cell users click most (lastQ / currentQ / goals / lifetime /
    client)."""

    variant: str
    count: int
    unique_users: int


class CommentActivityRow(BaseModel):
    day: str
    posted: int
    edited: int
    resolved: int
    deleted: int


class ClickInteractionRow(BaseModel):
    """One row per click-target label — e.g.
    'production-history.view-toggle.per-pod', 'pod-axis.editorial'."""

    label: str
    section_id: str | None
    count: int
    unique_users: int


class AnalyticsSummary(BaseModel):
    range_label: str  # "7d" / "30d" / "90d"
    range_start: datetime
    range_end: datetime
    total_events: int
    total_users: int
    top_routes: list[TopRouteRow]
    top_sections: list[TopSectionRow]
    per_user: list[PerUserRow]
    filter_usage: list[FilterRow]
    return_cadence: list[ReturnCadenceRow]
    daily_activity: list[DailyActivityRow]
    drill_downs: list[DrillDownRow]
    comment_activity: list[CommentActivityRow]
    click_interactions: list[ClickInteractionRow]


def _resolve_range(range_label: str) -> tuple[datetime, datetime, int]:
    """Convert a range label to (start, end, days)."""
    end = datetime.utcnow()
    if range_label == "7d":
        days = 7
    elif range_label == "30d":
        days = 30
    elif range_label == "90d":
        days = 90
    else:
        raise HTTPException(status_code=400, detail="range must be 7d / 30d / 90d")
    start = end - timedelta(days=days)
    return start, end, days


async def _resolve_group_emails(db: AsyncSession, groups_csv: str | None) -> list[str] | None:
    """Resolve a CSV of group slugs to the set of member emails.

    Returns None when no filter is active (caller skips the WHERE clause
    entirely). Returns [] when the user passed groups but none of them
    resolve — that's a legitimate "show nothing" state and the caller
    must apply the empty-set filter so all aggregations return 0 rows."""
    if not groups_csv:
        return None
    slugs = [s.strip() for s in groups_csv.split(",") if s.strip()]
    if not slugs:
        return None
    rows = (
        await db.execute(
            select(AccessGroupMember.email)
            .join(AccessGroup, AccessGroup.id == AccessGroupMember.group_id)
            .where(AccessGroup.slug.in_(slugs))
        )
    ).all()
    # De-dup; one user can be in multiple selected groups.
    return sorted({r[0] for r in rows})


@router.get("/summary", response_model=AnalyticsSummary)
async def analytics_summary(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[AccessProfile, Depends(require_view("admin.analytics"))],
    range: Literal["7d", "30d", "90d"] = Query(default="30d"),
    groups: str | None = Query(
        default=None,
        description="Comma-separated AccessGroup slugs to filter by. "
        "Omit (or empty) for all users.",
    ),
):
    start, end, _days = _resolve_range(range)
    emails = await _resolve_group_emails(db, groups)
    # When `emails == []`, the user selected at least one group but none
    # of its members have any events yet. Every query below should
    # return zero rows — easiest way is to short-circuit with a
    # sentinel email that can never match a real user.
    if emails is not None and len(emails) == 0:
        emails = ["__no_such_user__"]
    use_email_filter = emails is not None
    # Every `text()` query below carries a static `(:emails::text[] IS
    # NULL OR user_email = ANY(:emails::text[]))` clause. When the
    # filter is inactive, we pass `emails=None` and Postgres sees
    # `NULL::text[] IS NULL` → true, so all rows match. When the filter
    # is active, we pass a list and the second clause narrows the set.
    # This keeps the SQL string fully static (no f-string into text()),
    # which appeases the SQLAlchemy-text audit rule.
    base_params: dict[str, object | None] = {
        "start": start,
        "emails": emails if use_email_filter else None,
    }

    # Total events + unique user count for the headline pill.
    headline_q = select(
        func.count(UsageEvent.id),
        func.count(func.distinct(UsageEvent.user_email)),
    ).where(UsageEvent.occurred_at >= start)
    if use_email_filter:
        headline_q = headline_q.where(UsageEvent.user_email.in_(emails or []))
    headline = (await db.execute(headline_q)).one()
    total_events = int(headline[0] or 0)
    total_users = int(headline[1] or 0)

    # Top routes — PageView events grouped by route, ordered by count.
    # Top-10 cap so the card stays scannable.
    top_routes_q = (
        select(
            UsageEvent.route,
            func.count(UsageEvent.id).label("views"),
            func.count(func.distinct(UsageEvent.user_email)).label("uniq"),
        )
        .where(UsageEvent.occurred_at >= start)
        .where(UsageEvent.event_type == "PageView")
        .group_by(UsageEvent.route)
        .order_by(desc("views"))
        .limit(10)
    )
    if use_email_filter:
        top_routes_q = top_routes_q.where(UsageEvent.user_email.in_(emails or []))
    top_routes_rows = (await db.execute(top_routes_q)).all()
    top_routes = [
        TopRouteRow(route=r[0], page_views=int(r[1]), unique_users=int(r[2]))
        for r in top_routes_rows
    ]

    # Top sections — SectionViewed events with avg dwell time.
    # Dwell ms lives in props['dwell_ms'] as JSON; we extract via
    # postgres jsonb operator (safe — the column is JSON-typed).
    top_sections_rows = (
        await db.execute(
            text(
                """
                SELECT route, section_id,
                       COUNT(*) AS views,
                       AVG( (props->>'dwell_ms')::int ) FILTER (WHERE props ? 'dwell_ms') AS avg_dwell
                FROM usage_events
                WHERE occurred_at >= :start
                  AND event_type = 'SectionViewed'
                  AND section_id IS NOT NULL
                  AND (CAST(:emails AS text[]) IS NULL OR user_email = ANY(CAST(:emails AS text[])))
                GROUP BY route, section_id
                ORDER BY views DESC
                LIMIT 15
                """
            ),
            base_params,
        )
    ).all()
    top_sections = [
        TopSectionRow(
            route=r[0],
            section_id=r[1],
            views=int(r[2]),
            avg_dwell_ms=int(r[3]) if r[3] is not None else None,
        )
        for r in top_sections_rows
    ]

    # Per-user activity card — last seen, sessions, total events,
    # and the user's most-visited route. Top 30 most-active users.
    per_user_rows = (
        await db.execute(
            text(
                """
                WITH base AS (
                    SELECT user_email,
                           occurred_at,
                           session_id,
                           route,
                           event_type
                    FROM usage_events
                    WHERE occurred_at >= :start
                      AND (CAST(:emails AS text[]) IS NULL OR user_email = ANY(CAST(:emails AS text[])))
                ),
                top_route_per_user AS (
                    SELECT user_email,
                           route,
                           COUNT(*) AS views,
                           ROW_NUMBER() OVER (
                               PARTITION BY user_email
                               ORDER BY COUNT(*) DESC
                           ) AS rn
                    FROM base
                    WHERE event_type = 'PageView'
                    GROUP BY user_email, route
                )
                SELECT b.user_email,
                       MAX(b.occurred_at) AS last_seen_at,
                       COUNT(DISTINCT b.session_id) AS sessions_count,
                       COUNT(*) AS events_count,
                       (SELECT route FROM top_route_per_user t
                          WHERE t.user_email = b.user_email AND t.rn = 1) AS top_route
                FROM base b
                GROUP BY b.user_email
                ORDER BY events_count DESC
                LIMIT 30
                """
            ),
            base_params,
        )
    ).all()
    per_user = [
        PerUserRow(
            user_email=r[0],
            last_seen_at=r[1],
            sessions_count=int(r[2]),
            events_count=int(r[3]),
            top_route=r[4],
        )
        for r in per_user_rows
    ]

    # Filter usage card — FilterChanged events grouped by dimension
    # (pod_axis, editorial_pod, growth_pod, status, date_range) + value.
    # Top 20 across all dimensions.
    filter_rows = (
        await db.execute(
            text(
                """
                SELECT props->>'dimension' AS dimension,
                       props->>'value' AS value,
                       COUNT(*) AS count
                FROM usage_events
                WHERE occurred_at >= :start
                  AND event_type = 'FilterChanged'
                  AND props ? 'dimension'
                  AND props ? 'value'
                  AND (CAST(:emails AS text[]) IS NULL OR user_email = ANY(CAST(:emails AS text[])))
                GROUP BY dimension, value
                ORDER BY count DESC
                LIMIT 20
                """
            ),
            base_params,
        )
    ).all()
    filter_usage = [FilterRow(dimension=r[0], value=r[1], count=int(r[2])) for r in filter_rows]

    # Return cadence — median gap-between-visit days per user. A "visit"
    # = a distinct date_trunc('day', occurred_at). Computed in SQL via
    # array of consecutive-day-diffs → percentile_cont(0.5).
    # Top 30 most-frequent visitors.
    cadence_rows = (
        await db.execute(
            text(
                """
                WITH user_days AS (
                    SELECT user_email, DATE(occurred_at) AS d
                    FROM usage_events
                    WHERE occurred_at >= :start
                      AND (CAST(:emails AS text[]) IS NULL OR user_email = ANY(CAST(:emails AS text[])))
                    GROUP BY user_email, DATE(occurred_at)
                ),
                gaps AS (
                    SELECT user_email,
                           d - LAG(d) OVER (
                               PARTITION BY user_email ORDER BY d
                           ) AS gap_days
                    FROM user_days
                )
                SELECT user_email,
                       PERCENTILE_CONT(0.5) WITHIN GROUP (
                           ORDER BY gap_days
                       ) AS median_gap,
                       (SELECT COUNT(*) FROM user_days u
                          WHERE u.user_email = gaps.user_email) AS visits
                FROM gaps
                WHERE gap_days IS NOT NULL
                GROUP BY user_email
                ORDER BY visits DESC
                LIMIT 30
                """
            ),
            base_params,
        )
    ).all()
    return_cadence = [
        ReturnCadenceRow(
            user_email=r[0],
            median_gap_days=float(r[1]) if r[1] is not None else 0.0,
            visits=int(r[2]),
        )
        for r in cadence_rows
    ]

    # Daily activity timeline — events per day, broken out by type so
    # the chart can stack them. Date is bucketed in UTC; the frontend
    # is responsible for tz formatting if needed.
    daily_rows = (
        await db.execute(
            text(
                """
                SELECT TO_CHAR(DATE_TRUNC('day', occurred_at), 'YYYY-MM-DD') AS day,
                       event_type,
                       COUNT(*) AS count
                FROM usage_events
                WHERE occurred_at >= :start
                  AND (CAST(:emails AS text[]) IS NULL OR user_email = ANY(CAST(:emails AS text[])))
                GROUP BY day, event_type
                ORDER BY day ASC, event_type ASC
                """
            ),
            base_params,
        )
    ).all()
    daily_activity = [
        DailyActivityRow(day=r[0], event_type=r[1], count=int(r[2])) for r in daily_rows
    ]

    # Drill-down breakdown — which popover variant (lastQ, currentQ,
    # goals, lifetime, client) users open most often.
    drill_rows = (
        await db.execute(
            text(
                """
                SELECT props->>'variant' AS variant,
                       COUNT(*) AS count,
                       COUNT(DISTINCT user_email) AS uniq
                FROM usage_events
                WHERE occurred_at >= :start
                  AND event_type = 'DrillDownOpened'
                  AND props ? 'variant'
                  AND (CAST(:emails AS text[]) IS NULL OR user_email = ANY(CAST(:emails AS text[])))
                GROUP BY variant
                ORDER BY count DESC
                """
            ),
            base_params,
        )
    ).all()
    drill_downs = [
        DrillDownRow(variant=r[0], count=int(r[1]), unique_users=int(r[2])) for r in drill_rows
    ]

    # Comment activity timeline — per day, broken out into the four
    # comment-state transitions.
    comment_rows = (
        await db.execute(
            text(
                """
                SELECT TO_CHAR(DATE_TRUNC('day', occurred_at), 'YYYY-MM-DD') AS day,
                       SUM(CASE WHEN event_type = 'CommentPosted'   THEN 1 ELSE 0 END) AS posted,
                       SUM(CASE WHEN event_type = 'CommentEdited'   THEN 1 ELSE 0 END) AS edited,
                       SUM(CASE WHEN event_type = 'CommentResolved' THEN 1 ELSE 0 END) AS resolved,
                       SUM(CASE WHEN event_type = 'CommentDeleted'  THEN 1 ELSE 0 END) AS deleted
                FROM usage_events
                WHERE occurred_at >= :start
                  AND event_type IN (
                      'CommentPosted', 'CommentEdited',
                      'CommentResolved', 'CommentDeleted'
                  )
                  AND (CAST(:emails AS text[]) IS NULL OR user_email = ANY(CAST(:emails AS text[])))
                GROUP BY day
                ORDER BY day ASC
                """
            ),
            base_params,
        )
    ).all()
    comment_activity = [
        CommentActivityRow(
            day=r[0],
            posted=int(r[1] or 0),
            edited=int(r[2] or 0),
            resolved=int(r[3] or 0),
            deleted=int(r[4] or 0),
        )
        for r in comment_rows
    ]

    # Click interactions — every ClickInteraction event carries a
    # props.label identifying the target (e.g.
    # "production-history.view-toggle"). Rolled up to top-20 by count.
    click_rows = (
        await db.execute(
            text(
                """
                SELECT props->>'label' AS label,
                       section_id,
                       COUNT(*) AS count,
                       COUNT(DISTINCT user_email) AS uniq
                FROM usage_events
                WHERE occurred_at >= :start
                  AND event_type = 'ClickInteraction'
                  AND props ? 'label'
                  AND (CAST(:emails AS text[]) IS NULL OR user_email = ANY(CAST(:emails AS text[])))
                GROUP BY label, section_id
                ORDER BY count DESC
                LIMIT 20
                """
            ),
            base_params,
        )
    ).all()
    click_interactions = [
        ClickInteractionRow(
            label=r[0],
            section_id=r[1],
            count=int(r[2]),
            unique_users=int(r[3]),
        )
        for r in click_rows
    ]

    return AnalyticsSummary(
        range_label=range,
        range_start=start,
        range_end=end,
        total_events=total_events,
        total_users=total_users,
        top_routes=top_routes,
        top_sections=top_sections,
        per_user=per_user,
        filter_usage=filter_usage,
        return_cadence=return_cadence,
        daily_activity=daily_activity,
        drill_downs=drill_downs,
        comment_activity=comment_activity,
        click_interactions=click_interactions,
    )
