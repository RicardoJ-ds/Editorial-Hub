"""Monthly Article Count read API — powers the Team KPIs → Monthly Articles tab.

Reads from `article_records` (one row per article-editor; see the importer in
migration_service.import_monthly_article_count). The aggregate endpoint returns
granular per-(month, pod, client, editor) counts so the frontend can pivot the
same payload into the timeline chart (Per Pod / Per Client / Per Editor) and the
configurable matrix without extra round-trips.

Count semantics: `count` is editor-credits (each participating editor of a
collaborative article gets +1). At the finest grain that equals the editor's
article count for that client+month; summing it up a pod/client groups editor
output (a collaborative article counts once per editor).

Reads are ungated at the endpoint (tab visibility is gated by RBAC in the
sidebar, matching the other dashboard read routers). The admin alias/unmapped
endpoints gate on `require_access_editor`.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_deps import require_access_editor
from app.database import get_db
from app.models import ArticleNameAlias, ArticleRecord, ArticleUnmappedName, Client

router = APIRouter()


def _csv(value: str | None) -> list[str]:
    """Split a comma-separated query param into a trimmed, non-empty list."""
    if not value:
        return []
    return [v.strip() for v in value.split(",") if v.strip()]


def _normalize_pod(raw: str) -> str:
    """'Pod1' / 'pod 1' / '1' → 'Pod 1' (matches the importer + FilterBar)."""
    t = str(raw).strip()
    digits = "".join(ch for ch in t if ch.isdigit())
    return f"Pod {int(digits)}" if digits else t


@router.get("/monthly")
async def monthly_article_counts(
    date_from: str | None = Query(None, description="Inclusive lower bound, 'YYYY-MM'"),
    date_to: str | None = Query(None, description="Inclusive upper bound, 'YYYY-MM'"),
    pod: str | None = Query(None, description="'Pod N', 'Unassigned', or 'All'/None"),
    clients: str | None = Query(None, description="CSV of canonical client names"),
    editors: str | None = Query(None, description="CSV of canonical editor names"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Granular monthly article counts, filtered, for the chart + matrix."""
    stmt = (
        select(
            ArticleRecord.month_year,
            ArticleRecord.editorial_pod,
            ArticleRecord.client_name,
            ArticleRecord.editor_name,
            func.count().label("count"),
        )
        .where(ArticleRecord.month_year.is_not(None))
        .group_by(
            ArticleRecord.month_year,
            ArticleRecord.editorial_pod,
            ArticleRecord.client_name,
            ArticleRecord.editor_name,
        )
    )

    if date_from:
        stmt = stmt.where(ArticleRecord.month_year >= date_from)
    if date_to:
        stmt = stmt.where(ArticleRecord.month_year <= date_to)
    if pod and pod.lower() != "all":
        if pod.lower() in ("unassigned", "(none)", "none"):
            stmt = stmt.where(ArticleRecord.editorial_pod.is_(None))
        else:
            stmt = stmt.where(ArticleRecord.editorial_pod == _normalize_pod(pod))
    client_list = _csv(clients)
    if client_list:
        stmt = stmt.where(ArticleRecord.client_name.in_(client_list))
    editor_list = _csv(editors)
    if editor_list:
        stmt = stmt.where(ArticleRecord.editor_name.in_(editor_list))

    result = await db.execute(stmt)
    rows = [
        {
            "month_year": r.month_year,
            "pod": r.editorial_pod or "Unassigned",
            "client_name": r.client_name,
            "editor_name": r.editor_name,
            "count": r.count,
        }
        for r in result
    ]
    months = sorted({row["month_year"] for row in rows})
    return {"rows": rows, "months": months}


@router.get("/editors")
async def list_editors(db: AsyncSession = Depends(get_db)) -> list[dict]:
    """Distinct editors with total article credits — source for the page's
    editor multi-select. Sorted by volume desc."""
    stmt = (
        select(ArticleRecord.editor_name, func.count().label("count"))
        .group_by(ArticleRecord.editor_name)
        .order_by(func.count().desc())
    )
    result = await db.execute(stmt)
    return [{"name": r.editor_name, "count": r.count} for r in result]


@router.get("/unmapped")
async def list_unmapped(
    _profile=Depends(require_access_editor),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Admin review payload: client tab names the importer could not resolve
    (so their articles carry no pod) + distinct editor names (to spot variants
    like 'NIcholas' vs 'Nicholas' for merging) + the Hub client list for the
    mapping dropdown."""
    unmapped = await db.execute(
        select(ArticleUnmappedName)
        .where(ArticleUnmappedName.kind == "client", ArticleUnmappedName.resolved_at.is_(None))
        .order_by(ArticleUnmappedName.occurrences.desc())
    )
    clients_unmapped = [
        {
            "raw_value": u.raw_value,
            "occurrences": u.occurrences,
            "last_seen_at": u.last_seen_at.isoformat() if u.last_seen_at else None,
        }
        for u in unmapped.scalars()
    ]

    editors_res = await db.execute(
        select(ArticleRecord.editor_name, func.count().label("count"))
        .group_by(ArticleRecord.editor_name)
        .order_by(ArticleRecord.editor_name)
    )
    editors = [{"name": r.editor_name, "count": r.count} for r in editors_res]

    client_names_res = await db.execute(select(Client.name).order_by(Client.name))
    client_options = [r[0] for r in client_names_res]

    aliases_res = await db.execute(select(ArticleNameAlias).order_by(ArticleNameAlias.kind))
    aliases = [
        {"kind": a.kind, "raw_value": a.raw_value, "canonical_value": a.canonical_value}
        for a in aliases_res.scalars()
    ]

    return {
        "clients": clients_unmapped,
        "editors": editors,
        "client_options": client_options,
        "aliases": aliases,
    }


class AliasBody(BaseModel):
    kind: str  # 'client' | 'editor'
    raw_value: str
    canonical_value: str


@router.post("/aliases")
async def upsert_alias(
    body: AliasBody,
    profile=Depends(require_access_editor),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Add/replace a name alias. Takes effect on the next Monthly Article Count
    sync (client aliases re-route to the canonical Hub client + pod; editor
    aliases merge name variants)."""
    kind = body.kind.strip().lower()
    raw = body.raw_value.strip()
    canonical = body.canonical_value.strip()
    if kind not in ("client", "editor") or not raw or not canonical:
        return {"ok": False, "error": "kind must be client|editor; raw/canonical required"}

    existing = await db.execute(
        select(ArticleNameAlias).where(
            ArticleNameAlias.kind == kind, ArticleNameAlias.raw_value == raw
        )
    )
    row = existing.scalar_one_or_none()
    if row is None:
        db.add(
            ArticleNameAlias(
                kind=kind,
                raw_value=raw,
                canonical_value=canonical,
                source="manual",
                created_by=profile.email or None,
            )
        )
    else:
        row.canonical_value = canonical
        row.created_by = profile.email or row.created_by

    # If a client alias resolves a previously-unmapped name, mark it resolved
    # so it drops out of the review list immediately (the next sync confirms).
    if kind == "client":
        unmapped = await db.execute(
            select(ArticleUnmappedName).where(
                ArticleUnmappedName.kind == "client", ArticleUnmappedName.raw_value == raw
            )
        )
        u = unmapped.scalar_one_or_none()
        if u is not None and u.resolved_at is None:
            u.resolved_at = datetime.utcnow()

    await db.commit()
    return {"ok": True}
