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
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_deps import require_access_editor
from app.database import get_db
from app.models import (
    ArticleNameAlias,
    ArticleRecord,
    ArticleRevision,
    ArticleUnmappedName,
    Client,
)

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


def _apply_article_filters(stmt, model, date_from, date_to, pod, client_list, editor_list):
    """Apply the shared pod/client/editor/date filters to a query over `model`
    (ArticleRecord or ArticleRevision — both expose month_year/editorial_pod/
    client_name/editor_name)."""
    stmt = stmt.where(model.month_year.is_not(None))
    if date_from:
        stmt = stmt.where(model.month_year >= date_from)
    if date_to:
        stmt = stmt.where(model.month_year <= date_to)
    if pod and pod.lower() != "all":
        if pod.lower() in ("unassigned", "(none)", "none"):
            stmt = stmt.where(model.editorial_pod.is_(None))
        else:
            stmt = stmt.where(model.editorial_pod == _normalize_pod(pod))
    if client_list:
        stmt = stmt.where(model.client_name.in_(client_list))
    if editor_list:
        stmt = stmt.where(model.editor_name.in_(editor_list))
    return stmt


@router.get("/monthly")
async def monthly_article_counts(
    date_from: str | None = Query(None, description="Inclusive lower bound, 'YYYY-MM'"),
    date_to: str | None = Query(None, description="Inclusive upper bound, 'YYYY-MM'"),
    pod: str | None = Query(None, description="'Pod N', 'Unassigned', or 'All'/None"),
    clients: str | None = Query(None, description="CSV of canonical client names"),
    editors: str | None = Query(None, description="CSV of canonical editor names"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Two filtered, granular aggregates for the chart + matrix:

    - `creation`: per (month, pod, client, editor) bucketed by the article's
      CREATION month — count + revised (≥1 revision) + published + matched.
      Drives the Articles metric, Revision rate %, and the published reference.
    - `revisions`: per (month, pod, client, editor) bucketed by each REVISION's
      own month (from article_revisions). Drives the Revisions metric.
    """
    client_list = _csv(clients)
    editor_list = _csv(editors)

    creation_stmt = _apply_article_filters(
        select(
            ArticleRecord.month_year,
            ArticleRecord.editorial_pod,
            ArticleRecord.client_name,
            ArticleRecord.editor_name,
            func.count().label("count"),
            func.count().filter(ArticleRecord.revision_count > 0).label("revised"),
            func.count().filter(ArticleRecord.is_published.is_(True)).label("published"),
            func.count()
            .filter(and_(ArticleRecord.is_published.is_(True), ArticleRecord.revision_count > 0))
            .label("published_revised"),
            func.count().filter(ArticleRecord.notion_matched.is_(True)).label("matched"),
        ).group_by(
            ArticleRecord.month_year,
            ArticleRecord.editorial_pod,
            ArticleRecord.client_name,
            ArticleRecord.editor_name,
        ),
        ArticleRecord,
        date_from,
        date_to,
        pod,
        client_list,
        editor_list,
    )
    revision_stmt = _apply_article_filters(
        select(
            ArticleRevision.month_year,
            ArticleRevision.editorial_pod,
            ArticleRevision.client_name,
            ArticleRevision.editor_name,
            func.count().label("revisions"),
        ).group_by(
            ArticleRevision.month_year,
            ArticleRevision.editorial_pod,
            ArticleRevision.client_name,
            ArticleRevision.editor_name,
        ),
        ArticleRevision,
        date_from,
        date_to,
        pod,
        client_list,
        editor_list,
    )

    creation_res = await db.execute(creation_stmt)
    creation = [
        {
            "month_year": r.month_year,
            "pod": r.editorial_pod or "Unassigned",
            "client_name": r.client_name,
            "editor_name": r.editor_name,
            "count": r.count,
            "revised": r.revised,
            "published": r.published,
            "published_revised": r.published_revised,
            "matched": r.matched,
        }
        for r in creation_res
    ]
    revision_res = await db.execute(revision_stmt)
    revisions = [
        {
            "month_year": r.month_year,
            "pod": r.editorial_pod or "Unassigned",
            "client_name": r.client_name,
            "editor_name": r.editor_name,
            "revisions": r.revisions,
        }
        for r in revision_res
    ]
    return {"creation": creation, "revisions": revisions}


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
    """Admin review payload for the Monthly Article Count normalization tab.

    Returns EVERY client tab (not just unresolved ones) with its resolution
    status, so mapped/canonical clients stay visible; plus every distinct editor
    + writer name with origin tabs; plus the Hub client list + active aliases."""
    aliases_res = await db.execute(select(ArticleNameAlias).order_by(ArticleNameAlias.kind))
    aliases = [
        {"kind": a.kind, "raw_value": a.raw_value, "canonical_value": a.canonical_value}
        for a in aliases_res.scalars()
    ]
    client_alias_map = {a["raw_value"]: a["canonical_value"] for a in aliases if a["kind"] == "client"}

    # Every client tab that produced articles, with status + article date span.
    # status: "alias" (a saved alias re-routes it — applies next sync) >
    #         "canonical" (resolves to a Hub client naturally) > "unmapped".
    tab_res = await db.execute(
        select(
            ArticleRecord.source_tab,
            func.count().label("c"),
            func.min(ArticleRecord.month_year).label("min_my"),
            func.max(ArticleRecord.month_year).label("max_my"),
            func.max(ArticleRecord.client_id).label("cid"),
            func.max(ArticleRecord.client_name).label("cname"),
        ).group_by(ArticleRecord.source_tab)
    )
    clients = []
    for tab, c, min_my, max_my, cid, cname in tab_res:
        if tab in client_alias_map:
            status, target = "alias", client_alias_map[tab]
        elif cid is not None:
            status, target = "canonical", cname
        else:
            status, target = "unmapped", None
        clients.append(
            {
                "raw_value": tab,
                "occurrences": c,
                "status": status,
                "resolved_to": target,
                "first_month": min_my,
                "last_month": max_my,
            }
        )
    # Unmapped first (by volume), then the resolved set alphabetically.
    clients.sort(key=lambda r: (r["status"] != "unmapped", -r["occurrences"] if r["status"] == "unmapped" else 0, r["raw_value"].lower()))

    # Editors + writers: distinct names with total credits AND their origin
    # tabs (which client sheets a name appears in) so the value can be fixed at
    # source. Top 6 tabs by volume per name + a total tab count.
    async def _names_with_origins(col) -> list[dict]:
        res = await db.execute(
            select(col, ArticleRecord.source_tab, func.count().label("c"))
            .where(col.is_not(None))
            .group_by(col, ArticleRecord.source_tab)
        )
        agg: dict[str, dict] = {}
        for name, tab, c in res:
            row = agg.setdefault(name, {"name": name, "count": 0, "tab_counts": {}})
            row["count"] += c
            row["tab_counts"][tab] = row["tab_counts"].get(tab, 0) + c
        out = []
        for row in agg.values():
            tabs_sorted = sorted(row["tab_counts"].items(), key=lambda kv: -kv[1])
            out.append(
                {
                    "name": row["name"],
                    "count": row["count"],
                    "tab_count": len(tabs_sorted),
                    "tabs": [t for t, _ in tabs_sorted[:6]],
                }
            )
        out.sort(key=lambda r: r["name"].lower())
        return out

    editors = await _names_with_origins(ArticleRecord.editor_name)
    writers = await _names_with_origins(ArticleRecord.writer_name)

    client_names_res = await db.execute(select(Client.name).order_by(Client.name))
    client_options = [r[0] for r in client_names_res]

    return {
        "clients": clients,
        "editors": editors,
        "writers": writers,
        "client_options": client_options,
        "aliases": aliases,
    }


class AliasBody(BaseModel):
    kind: str  # 'client' | 'editor' | 'writer'
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
    if kind not in ("client", "editor", "writer") or not raw or not canonical:
        return {"ok": False, "error": "kind must be client|editor|writer; raw/canonical required"}

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
