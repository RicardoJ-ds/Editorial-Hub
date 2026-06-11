"""Extract layer — reads the Postgres tables the proven importers populate.

The sheet → Postgres step itself is NOT reimplemented here: `run.py` invokes
the same `sync_manifest` steps the dashboard's SYNC button runs, so ingestion
behavior is identical by construction. This module only reads the results.
"""

from __future__ import annotations

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import prepare_sync_url


_ENGINE = None


def get_engine():
    # One engine (pool) per process — builds run inside the long-lived backend
    # via the sync manifest; per-call engines would leak pooled connections.
    global _ENGINE
    if _ENGINE is None:
        _ENGINE = create_engine(prepare_sync_url(settings.database_url), echo=False)
    return _ENGINE


def get_session(engine=None) -> Session:
    return Session(engine or get_engine())


def fetch_model_rows(session: Session, model) -> list[dict]:
    """All rows of a SQLAlchemy model as plain dicts (mapper-column order)."""
    cols = [c.key for c in model.__mapper__.columns]
    out = []
    for obj in session.query(model).all():
        out.append({k: getattr(obj, k) for k in cols})
    return out


def distinct_capacity_months(session: Session) -> list[tuple[int, int]]:
    rows = session.execute(
        text(
            "SELECT DISTINCT year, month FROM editorial_member_capacity ORDER BY year, month"
        )
    ).all()
    return [(r.year, r.month) for r in rows]


def fetch_month_inputs(session: Session, year: int, month: int):
    """The 4 origin row-sets for one month, as the dicts `capacity_calc`
    consumes — mirrors `app/routers/capacity._fetch_month_inputs` exactly."""
    cph = [
        dict(r._mapping)
        for r in session.execute(
            text(
                "SELECT client_id, editorial_pod, category FROM client_pod_history "
                "WHERE year=:y AND month=:m AND client_id IS NOT NULL"
            ),
            {"y": year, "m": month},
        )
    ]
    ph = [
        dict(r._mapping)
        for r in session.execute(
            text(
                "SELECT client_id, projected_original, articles_actual "
                "FROM production_history WHERE year=:y AND month=:m"
            ),
            {"y": year, "m": month},
        )
    ]
    ar = [
        dict(r._mapping)
        for r in session.execute(
            text("SELECT editor_name FROM article_records WHERE year=:y AND month=:m"),
            {"y": year, "m": month},
        )
    ]
    emc = [
        dict(r._mapping)
        for r in session.execute(
            text(
                "SELECT pod, role, member_raw, member_breakdown, capacity "
                "FROM editorial_member_capacity WHERE year=:y AND month=:m"
            ),
            {"y": year, "m": month},
        )
    ]
    return cph, ph, ar, emc


def client_names(session: Session) -> dict[int, str]:
    return {
        r.id: r.name for r in session.execute(text("SELECT id, name FROM clients"))
    }
