from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import engine
from app.models import Base  # noqa: F401 — importing module registers all models with Base.metadata
from app.routers import (
    admin,
    ai_monitoring,
    capacity,
    clients,
    dashboard,
    deliverables,
    goals_delivery,
    kpis,
    migration,
    team_members,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
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


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "editorial-hub-api"}
