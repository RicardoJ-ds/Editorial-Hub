import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import settings
from app.database import engine
from app.models import Base  # noqa: F401 — importing module registers all models with Base.metadata
from app.routers import (
    admin,
    ai_monitoring,
    capacity,
    client_delivery,
    clients,
    dashboard,
    deliverables,
    goals_delivery,
    kpis,
    migration,
    notion_articles,
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup, then apply idempotent data migrations.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _run_data_migrations(conn)
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
app.include_router(migration.router, prefix="/api/migrate", tags=["migration"])
app.include_router(
    client_delivery.router, prefix="/api/dashboard/client-delivery", tags=["dashboard"]
)
app.include_router(notion_articles.router, prefix="/api/notion-articles", tags=["notion-articles"])


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "editorial-hub-api"}
