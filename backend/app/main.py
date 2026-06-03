import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import settings
from app.database import engine
from app.models import Base  # noqa: F401 — importing module registers all models with Base.metadata
from app.routers import (
    access,
    admin,
    ai_monitoring,
    analytics,
    articles,
    capacity,
    client_delivery,
    clients,
    dashboard,
    deliverables,
    goals_delivery,
    kpis,
    migration,
    notion_articles,
    overview_comments,
    team_members,
)

logger = logging.getLogger(__name__)


async def _run_data_migrations(conn) -> None:
    """One-shot data migrations applied at app startup.

    Why this lives here: the project doesn't use Alembic — schema is created
    via `Base.metadata.create_all`. That handles new tables but never alters
    an existing table's constraints. So any invariant we want to enforce on
    a long-lived production DB has to be applied explicitly here.

    Each migration must be idempotent (safe to re-run on every deploy).
    """
    # 1. production_history: dedupe + add unique (client_id, year, month).
    #    The Operating Model importer has always upserted by that triple,
    #    but the upsert ran without DB-level enforcement, so any historical
    #    race / autoflush hiccup left duplicate rows behind in prod (~60%
    #    of keys had two copies). The duplicates double the bar values on
    #    the Client Engagement Timeline because the dashboard sums by
    #    (client, month). Dedupe first, then add the constraint so future
    #    bad INSERTs fail loudly.
    try:
        await conn.execute(
            text(
                """
                DELETE FROM production_history p1
                USING production_history p2
                WHERE p1.client_id = p2.client_id
                  AND p1.year = p2.year
                  AND p1.month = p2.month
                  AND p1.id < p2.id
                """
            )
        )
        await conn.execute(
            text(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'uq_production_history_client_ym'
                    ) THEN
                        ALTER TABLE production_history
                            ADD CONSTRAINT uq_production_history_client_ym
                            UNIQUE (client_id, year, month);
                    END IF;
                END
                $$;
                """
            )
        )
    except Exception:
        logger.exception("production_history dedupe/constraint migration failed (continuing)")

    # 2. access_views: add `dashboard_label` for the 3-level matrix header.
    #    The seed step refreshes label/parent/dashboard on every restart, so
    #    once the column exists, values get populated automatically.
    try:
        await conn.execute(
            text(
                "ALTER TABLE access_views "
                "ADD COLUMN IF NOT EXISTS dashboard_label VARCHAR(120) NOT NULL DEFAULT ''"
            )
        )
    except Exception:
        logger.exception("access_views dashboard_label migration failed (continuing)")

    # 3. access_groups: add `sort_order` so left-rail + matrix-row order is
    #    decoupled from auto-increment ID. Seed step writes values from
    #    the canonical `_GROUPS` list index on every restart.
    try:
        await conn.execute(
            text(
                "ALTER TABLE access_groups "
                "ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0"
            )
        )
    except Exception:
        logger.exception("access_groups sort_order migration failed (continuing)")

    # 5. overview_comments.client_name: make nullable so the right-rail
    #    "general" composer can post comments that aren't tied to a
    #    specific client (per the new comments-rail spec). Existing rows
    #    keep their non-null client_name; no data backfill required.
    #    Idempotent — DROP NOT NULL is a no-op after the first run.
    try:
        await conn.execute(
            text("ALTER TABLE overview_comments ALTER COLUMN client_name DROP NOT NULL")
        )
    except Exception:
        logger.exception("overview_comments.client_name nullability migration failed (continuing)")

    # 6. goals_vs_delivery: enforce uniqueness on
    #    (month_year, week_number, client_name, content_type). Pre-0.3.16
    #    the importer's upsert ignored content_type, so a row with
    #    content_type=NULL or "article" would silently overwrite an
    #    LP / jumbo row for the same client + week. We dedupe first
    #    (keep the lowest id per natural key, which is the earliest
    #    insert) then add the constraint so future bad imports fail
    #    loudly. Postgres treats NULLs as distinct in unique
    #    constraints by default, which is what we want — legacy rows
    #    without a content_type stay in their own slot.
    try:
        await conn.execute(
            text(
                """
                DELETE FROM goals_vs_delivery g1
                USING goals_vs_delivery g2
                WHERE g1.month_year = g2.month_year
                  AND g1.week_number = g2.week_number
                  AND g1.client_name = g2.client_name
                  AND g1.content_type IS NOT DISTINCT FROM g2.content_type
                  AND g1.id < g2.id
                """
            )
        )
        await conn.execute(
            text(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'uq_goals_vs_delivery_mw_client_ctype'
                    ) THEN
                        ALTER TABLE goals_vs_delivery
                            ADD CONSTRAINT uq_goals_vs_delivery_mw_client_ctype
                            UNIQUE (month_year, week_number, client_name, content_type);
                    END IF;
                END
                $$;
                """
            )
        )
    except Exception:
        logger.exception("goals_vs_delivery dedupe/constraint migration failed (continuing)")

    # 4. access_groups: collapse the old pod-derived `leadership` group into
    #    the renamed `vps_managers` (now also called `leadership`). Old
    #    leadership members were Senior Editors / Growth Leads / Directors
    #    — all of whom are also members of `editorial_team` / `growth_team`
    #    via their pod role, so deleting the row doesn't strand anyone.
    #    Members + permissions cascade via FK ON DELETE CASCADE.
    #    Idempotent: after first run, the old slug is gone, and the
    #    rename is a no-op.
    try:
        await conn.execute(
            text("DELETE FROM access_groups WHERE slug = 'leadership' AND is_pod_derived = true")
        )
        await conn.execute(
            text("UPDATE access_groups SET slug = 'leadership' WHERE slug = 'vps_managers'")
        )
    except Exception:
        logger.exception("access_groups leadership/vps_managers consolidation failed (continuing)")

    # 7. usage_events: ensure the props column is JSONB (not generic
    #    JSON). The summary endpoint uses jsonb-only operators (`?`
    #    key-existence, `->>` text extraction) to compute average
    #    dwell time per section. If the table was created on an older
    #    boot before this fix, the column is plain `json` and queries
    #    fail with "operator does not exist: json ?". The ALTER is
    #    idempotent — Postgres lets us widen json→jsonb in place.
    try:
        await conn.execute(
            text("ALTER TABLE usage_events ALTER COLUMN props TYPE jsonb USING props::jsonb")
        )
    except Exception:
        logger.exception("usage_events.props json→jsonb migration failed (continuing)")

    # 9. article_records.submitted_date — parsed calendar date used to map each
    #    article to its editorial month via editorial_weeks. Added after the
    #    table shipped, so ALTER it in for existing prod DBs. Populated on the
    #    next Monthly Article Count sync.
    try:
        await conn.execute(
            text("ALTER TABLE article_records ADD COLUMN IF NOT EXISTS submitted_date DATE")
        )
    except Exception:
        logger.exception("article_records.submitted_date migration failed (continuing)")

    # 10. article_records revision + Notion-published columns (added after the
    #     table shipped). Populated on the next Monthly Article Count sync;
    #     article_revisions is a new table created by create_all.
    try:
        await conn.execute(
            text("ALTER TABLE article_records ADD COLUMN IF NOT EXISTS revision_count INTEGER NOT NULL DEFAULT 0")
        )
        await conn.execute(
            text("ALTER TABLE article_records ADD COLUMN IF NOT EXISTS revision_dates JSONB")
        )
        await conn.execute(
            text("ALTER TABLE article_records ADD COLUMN IF NOT EXISTS task_id VARCHAR(64)")
        )
        await conn.execute(
            text("ALTER TABLE article_records ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT FALSE")
        )
        await conn.execute(
            text("ALTER TABLE article_records ADD COLUMN IF NOT EXISTS published_url TEXT")
        )
        await conn.execute(
            text("ALTER TABLE article_records ADD COLUMN IF NOT EXISTS notion_matched BOOLEAN NOT NULL DEFAULT FALSE")
        )
    except Exception:
        logger.exception("article_records revision/published columns migration failed (continuing)")

    # 8. usage_events retention — trim rows older than 6 months on every
    #    boot. Cheap, bounded, and avoids needing a cron. The model
    #    itself is created by Base.metadata.create_all; this DELETE
    #    just keeps the table from growing unbounded over years.
    try:
        await conn.execute(
            text(
                "DELETE FROM usage_events "
                "WHERE occurred_at < (CURRENT_TIMESTAMP - INTERVAL '6 months')"
            )
        )
    except Exception:
        logger.exception("usage_events retention trim failed (continuing)")


def _seed_access(_conn) -> None:
    """Run the RBAC seed inside a sync session bound to the same connection
    used for `Base.metadata.create_all`. Idempotent."""
    from sqlalchemy.orm import Session as SyncSession

    from app.services.access import seed_access_baseline

    with SyncSession(bind=_conn) as session:
        seed_access_baseline(session)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup, then apply idempotent data migrations,
    # then seed the RBAC baseline (views + groups + seed members + default
    # permission matrix). All idempotent.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _run_data_migrations(conn)
        await conn.run_sync(_seed_access)
    yield
    await engine.dispose()


app = FastAPI(
    title="Editorial Hub API",
    description="Backend API for Editorial Hub BI Dashboard",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(clients.router, prefix="/api/clients", tags=["clients"])
app.include_router(deliverables.router, prefix="/api/deliverables", tags=["deliverables"])
app.include_router(team_members.router, prefix="/api/team-members", tags=["team-members"])
app.include_router(capacity.router, prefix="/api/capacity", tags=["capacity"])
app.include_router(kpis.router, prefix="/api/kpis", tags=["kpis"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(ai_monitoring.router, prefix="/api/ai-monitoring", tags=["ai-monitoring"])
app.include_router(goals_delivery.router, prefix="/api/goals-delivery", tags=["goals-delivery"])
app.include_router(access.router, prefix="/api/access", tags=["access"])
app.include_router(
    overview_comments.router, prefix="/api/overview/comments", tags=["overview-comments"]
)
app.include_router(migration.router, prefix="/api/migrate", tags=["migration"])
app.include_router(
    client_delivery.router, prefix="/api/dashboard/client-delivery", tags=["dashboard"]
)
app.include_router(notion_articles.router, prefix="/api/notion-articles", tags=["notion-articles"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])
app.include_router(articles.router, prefix="/api/articles", tags=["articles"])


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "editorial-hub-api"}
