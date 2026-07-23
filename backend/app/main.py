import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

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
    # 0. cache_version: ensure the single token row exists (id=1, token=0).
    #    The table itself is created by Base.metadata.create_all; the BQ read
    #    cache reads/bumps this row (see services/bq_cache.py).
    await conn.execute(
        text(
            "INSERT INTO cache_version (id, token, bumped_at) "
            "VALUES (1, 0, now()) ON CONFLICT (id) DO NOTHING"
        )
    )

    # 0b. notion_articles: retired. The Notion "content machine" is no longer
    #     ingested into Neon — it's read live from BigQuery
    #     (graphite_bi.notion_raw_revenue_content) by notion_bq.fetch_notion_content().
    #     Drop the now-orphaned table so the schema reflects reality.
    try:
        await conn.execute(text("DROP TABLE IF EXISTS notion_articles"))
    except Exception:
        logger.exception("drop notion_articles migration failed (continuing)")

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

    # 11. cumulative_metrics: allow multiple content_type rows per client.
    #     client_name was UNIQUE, so the importer only ever kept the first
    #     (article) row per client — a multi-content-type client (Webflow:
    #     article/jumbo/glossary, Front: article/glossary) lost its non-article
    #     rows. Drop the single-column unique, dedupe on (client_name,
    #     content_type) keeping the earliest row, then add the composite
    #     constraint. Postgres auto-named the old constraint
    #     `cumulative_metrics_client_name_key`; the non-unique index
    #     `ix_cumulative_metrics_client_name` (index=True) is left in place.
    try:
        await conn.execute(
            text(
                "ALTER TABLE cumulative_metrics "
                "DROP CONSTRAINT IF EXISTS cumulative_metrics_client_name_key"
            )
        )
        await conn.execute(
            text(
                """
                DELETE FROM cumulative_metrics c1
                USING cumulative_metrics c2
                WHERE c1.client_name = c2.client_name
                  AND c1.content_type IS NOT DISTINCT FROM c2.content_type
                  AND c1.id < c2.id
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
                        WHERE conname = 'uq_cumulative_client_ctype'
                    ) THEN
                        ALTER TABLE cumulative_metrics
                            ADD CONSTRAINT uq_cumulative_client_ctype
                            UNIQUE (client_name, content_type);
                    END IF;
                END
                $$;
                """
            )
        )
    except Exception:
        logger.exception("cumulative_metrics dedupe/constraint migration failed (continuing)")

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
        await conn.execute(
            text("ALTER TABLE article_records ADD COLUMN IF NOT EXISTS second_review VARCHAR(255)")
        )
    except Exception:
        logger.exception("article_records.submitted_date migration failed (continuing)")

    # 10. article_records revision + Notion-published columns (added after the
    #     table shipped). Populated on the next Monthly Article Count sync;
    #     article_revisions is a new table created by create_all.
    try:
        await conn.execute(
            text(
                "ALTER TABLE article_records ADD COLUMN IF NOT EXISTS revision_count INTEGER NOT NULL DEFAULT 0"
            )
        )
        await conn.execute(
            text("ALTER TABLE article_records ADD COLUMN IF NOT EXISTS revision_dates JSONB")
        )
        await conn.execute(
            text("ALTER TABLE article_records ADD COLUMN IF NOT EXISTS task_id VARCHAR(64)")
        )
        await conn.execute(
            text(
                "ALTER TABLE article_records ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT FALSE"
            )
        )
        await conn.execute(
            text("ALTER TABLE article_records ADD COLUMN IF NOT EXISTS published_url TEXT")
        )
        await conn.execute(
            text(
                "ALTER TABLE article_records ADD COLUMN IF NOT EXISTS notion_matched BOOLEAN NOT NULL DEFAULT FALSE"
            )
        )
        await conn.execute(
            text("ALTER TABLE article_records ADD COLUMN IF NOT EXISTS growth_pod VARCHAR(50)")
        )
        await conn.execute(
            text("ALTER TABLE article_revisions ADD COLUMN IF NOT EXISTS growth_pod VARCHAR(50)")
        )
    except Exception:
        logger.exception("article_records revision/published columns migration failed (continuing)")

    # 11. production_history.projected_original — the ET CP client-block original
    #     projection per client/month (added after the table shipped). Populated
    #     on the next ET CP capacity-plan sync. editorial_member_capacity is a new
    #     table created by create_all.
    try:
        await conn.execute(
            text(
                "ALTER TABLE production_history ADD COLUMN IF NOT EXISTS projected_original INTEGER"
            )
        )
    except Exception:
        logger.exception("production_history.projected_original migration failed (continuing)")

    # 12. client_pod_history.category — per-(client, month) standard/specialized
    #     tag from the ET CP client block (column pod_col+2). Populated on the
    #     next ET CP sync / past-months resync. Drives the specialized ×1.4
    #     used-capacity weighting.
    try:
        await conn.execute(
            text("ALTER TABLE client_pod_history ADD COLUMN IF NOT EXISTS category VARCHAR(50)")
        )
    except Exception:
        logger.exception("client_pod_history.category migration failed (continuing)")

    # 13. article_name_aliases date windows — one raw name can map to different
    #     people over time (e.g. "Sam" → Samantha McGrail through 2026-01,
    #     → Samantha Marceau from 2026-02, per Rippling headcount tenure).
    #     The old (kind, raw_value) unique constraint is replaced with one that
    #     includes valid_from so windowed rows can coexist.
    try:
        await conn.execute(
            text("ALTER TABLE article_name_aliases ADD COLUMN IF NOT EXISTS valid_from VARCHAR(7)")
        )
        await conn.execute(
            text("ALTER TABLE article_name_aliases ADD COLUMN IF NOT EXISTS valid_to VARCHAR(7)")
        )
        await conn.execute(
            text("ALTER TABLE article_name_aliases DROP CONSTRAINT IF EXISTS uq_article_name_alias")
        )
        await conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_article_name_alias_window "
                "ON article_name_aliases (kind, raw_value, COALESCE(valid_from, ''))"
            )
        )
    except Exception:
        logger.exception("article_name_aliases window migration failed (continuing)")

    # 14. capacity_projections used-capacity → double precision. The sheet's
    #     per-pod Projected/Actual Used carry ×1.4 specialized weighting (e.g.
    #     109.4); an INTEGER column rounded each pod, so the pod rollup drifted
    #     ±1 from the float per-client itemization + the sheet. Widen to float so
    #     the fraction survives ingestion. Idempotent (re-ALTER to double is a
    #     no-op). Values re-land unrounded on the next ET CP capacity-plan sync.
    try:
        await conn.execute(
            text(
                "ALTER TABLE capacity_projections "
                "ALTER COLUMN projected_used_capacity TYPE double precision"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE capacity_projections "
                "ALTER COLUMN actual_used_capacity TYPE double precision"
            )
        )
    except Exception:
        logger.exception("capacity_projections used-capacity float migration failed (continuing)")

    # 15. production_history.projected_comment — the per-(client, month) note
    #     from the ET-CP ARTICLE BREAKDOWN "Comments" column. Populated on the
    #     next ET-CP capacity-plan sync alongside projected_original.
    try:
        await conn.execute(
            text("ALTER TABLE production_history ADD COLUMN IF NOT EXISTS projected_comment TEXT")
        )
    except Exception:
        logger.exception("production_history.projected_comment migration failed (continuing)")

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


async def _daily_sync_loop() -> None:
    """Daily server-side sync (env-gated by SYNC_CRON_ENABLED): runs the same
    manifest plan as the SYNC button (scope=current — auto-escalates to full on
    editorial month rollover), which ends with the dual-sink warehouse publish,
    so Neon + BigQuery stay fresh with no human in the loop. Per-step failure
    isolation mirrors POST /api/migrate/sync-run; the publish itself is
    additionally guarded by a cross-process pg advisory lock."""
    from app.routers.migration import _get_sync_session
    from app.services import sync_manifest

    while True:
        now = datetime.now(timezone.utc)
        target = now.replace(hour=settings.sync_cron_utc_hour, minute=0, second=0, microsecond=0)
        if target <= now:
            target += timedelta(days=1)
        logger.info("daily sync scheduled for %s UTC", target.isoformat())
        await asyncio.sleep((target - now).total_seconds())

        def _run() -> tuple[int, int]:
            ok = failed = 0
            for step in sync_manifest.resolve_plan("current"):
                session = _get_sync_session()
                try:
                    rs = sync_manifest.run_step(session, step["key"])
                    ok += sum(1 for r in rs if r.success)
                    failed += sum(1 for r in rs if not r.success)
                except Exception:
                    logger.exception("daily sync step '%s' failed (continuing)", step["key"])
                    try:
                        session.rollback()
                    except Exception:
                        logger.warning("rollback failed for daily sync step %s", step["key"])
                    failed += 1
                finally:
                    session.close()
            return ok, failed

        try:
            ok, failed = await asyncio.to_thread(_run)
            logger.info("daily sync finished: %s ok, %s failed", ok, failed)
        except Exception:
            logger.exception("daily sync run crashed — loop continues")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup, then apply idempotent data migrations,
    # then seed the RBAC baseline (views + groups + seed members + default
    # permission matrix). All idempotent.
    async with engine.begin() as conn:
        # Serialize startup DDL across overlapping instances (two deploys racing,
        # or >1 replica) so the idempotent ALTERs in _run_data_migrations can't
        # deadlock on table locks and abort the whole startup transaction — which
        # otherwise cascades into the _seed_access read and crash-loops startup.
        # Advisory lock = wait, not deadlock; auto-released at txn end. Distinct
        # from the warehouse-publish lock 815001.
        await conn.execute(text("SELECT pg_advisory_xact_lock(815002)"))
        await conn.run_sync(Base.metadata.create_all)
        await _run_data_migrations(conn)
        await conn.run_sync(_seed_access)
    cron_task = None
    if settings.sync_cron_enabled:
        cron_task = asyncio.create_task(_daily_sync_loop())
        logger.info("daily sync cron ENABLED (%02d:00 UTC)", settings.sync_cron_utc_hour)
    yield
    if cron_task:
        cron_task.cancel()
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
app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])
app.include_router(articles.router, prefix="/api/articles", tags=["articles"])


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "editorial-hub-api"}
