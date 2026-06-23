"""Read the unified name/client mapping live from BigQuery `editorial_name_map`.

Replaces the per-sync reads of the Neon `article_name_aliases` table (the
normalization mappings moved to BigQuery — Phase 1b). Returns the windowed
alias-map shape the importer + warehouse already expect:

    {raw_lower: [(valid_from, valid_to, canonical), ...]}

`valid_from` / `valid_to` are 'YYYY-MM' (inclusive) or None (windowless). Falls
back to the Neon `article_name_aliases` table when BQ is empty/unavailable, so
the cutover is non-breaking. Mirrors `notion_bq.py` (direct BQ read, no cache).
"""

from __future__ import annotations

from typing import Any

_TABLE = "`graphite-data.graphite_bi_sandbox.editorial_name_map`"

NameMap = dict[str, list[tuple[str | None, str | None, str]]]


def fetch_name_map(kind: str, session: Any | None = None) -> NameMap:
    """raw_lower → [(valid_from, valid_to, canonical)] for one kind
    (writer | editor | client). BigQuery first; Neon fallback if BQ is
    empty/unavailable (so a missing/!published map never breaks a sync)."""
    out: NameMap = {}
    try:
        from google.cloud.bigquery import QueryJobConfig, ScalarQueryParameter

        from app.services.bq_dashboard import bq

        job = QueryJobConfig(query_parameters=[ScalarQueryParameter("kind", "STRING", kind)])
        rows = (
            bq()
            .query(
                f"SELECT raw_value, canonical_value, valid_from, valid_to FROM {_TABLE} "
                "WHERE kind = @kind",
                job_config=job,
            )
            .result()
        )
        for r in rows:
            raw = (r.raw_value or "").strip().lower()
            if raw and r.canonical_value:
                out.setdefault(raw, []).append((r.valid_from, r.valid_to, r.canonical_value))
    except Exception:
        out = {}
    if out:
        return out
    # Fallback: Neon article_name_aliases — keeps the cutover non-breaking while
    # the BQ map is being established / if a publish hasn't run yet.
    if session is not None:
        from sqlalchemy import select

        from app.models import ArticleNameAlias

        for a in (
            session.execute(select(ArticleNameAlias).where(ArticleNameAlias.kind == kind))
            .scalars()
            .all()
        ):
            out.setdefault(a.raw_value.strip().lower(), []).append(
                (a.valid_from, a.valid_to, a.canonical_value)
            )
    return out
