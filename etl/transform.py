"""Transform layer — canonical-name columns + the processed marts.

Canonical columns are ADDED next to the original values, never replacing them,
so the BQ tables stay byte-comparable to Postgres (parity) while every
downstream consumer can join on the clean names. The capacity marts call the
SAME `app.services.capacity_calc` functions the dashboard endpoints use, so the
mart and the API can never drift.
"""

from __future__ import annotations

import json
import os
from collections import defaultdict

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.capacity_calc import (
    compute_client_contributions,
    compute_member_utilization,
    version_num,
)

from etl.extract import client_names, distinct_capacity_months, fetch_month_inputs
from etl.util import norm_key, strip_member_annotations

MAPPINGS_DIR = os.path.join(os.path.dirname(__file__), "mappings")


def load_mappings() -> dict:
    out = {}
    for name in ("editor_aliases", "client_aliases", "writer_aliases"):
        with open(os.path.join(MAPPINGS_DIR, f"{name}.json")) as f:
            out[name] = json.load(f)
    return out


# ---------------------------------------------------------------------------
# Canonical-column transforms (applied per published table)
# ---------------------------------------------------------------------------


def _alias_lookup(aliases: dict) -> dict[str, dict]:
    return {norm_key(v["raw"]): v for v in aliases.values()}


def add_article_canonicals(rows: list[dict], mappings: dict) -> list[dict]:
    """article_records → + editor_canonical / editor_match_status /
    writer_canonical / writer_match_status.

    Lookup order: alias dictionary → already-canonical (the name IS a known
    canonical, e.g. after the self-healing aliases were applied at import) →
    unresolved."""
    ed = _alias_lookup(mappings["editor_aliases"]["aliases"])
    wr = _alias_lookup(mappings["writer_aliases"]["aliases"])
    ed_canon = {
        norm_key(v["canonical"]): v["canonical"]
        for v in mappings["editor_aliases"]["aliases"].values()
        if v.get("canonical")
    }
    wr_canon = {
        norm_key(r["canonical"]): r["canonical"]
        for r in mappings["writer_aliases"]["roster"].values()
    }
    for r in rows:
        ek = norm_key(r.get("editor_name"))
        e = ed.get(ek)
        if e:
            r["editor_canonical"] = e.get("canonical")
            r["editor_match_status"] = e["status"]
        elif ek in ed_canon:
            r["editor_canonical"] = ed_canon[ek]
            r["editor_match_status"] = "confirmed"
        else:
            r["editor_canonical"] = None
            r["editor_match_status"] = "unresolved"
        if not r.get("writer_name"):
            r["writer_canonical"] = None
            r["writer_match_status"] = None
            continue
        wk = norm_key(r.get("writer_name"))
        w = wr.get(wk)
        if w:
            r["writer_canonical"] = w.get("canonical")
            r["writer_match_status"] = w["status"]
        elif wk in wr_canon:
            r["writer_canonical"] = wr_canon[wk]
            r["writer_match_status"] = "confirmed"
        else:
            r["writer_canonical"] = None
            r["writer_match_status"] = "unresolved"
    return rows


def add_client_canonicals(rows: list[dict], mappings: dict) -> list[dict]:
    """clients → + sf_client_name / sf_account_id / sf_match_status."""
    cmap = mappings["client_aliases"]["hub_to_salesforce"]
    for r in rows:
        m = cmap.get(r.get("name"), {})
        r["sf_client_name"] = m.get("sf_name")
        r["sf_account_id"] = m.get("sf_account_id")
        r["sf_match_status"] = m.get("status", "no_sf_match")
    return rows


def _member_canonical(name: str, mappings: dict) -> tuple[str | None, str]:
    """Canonical HR name for a capacity member (post-breakdown person name)."""
    members = mappings["editor_aliases"]["capacity_members"]
    hit = members.get(name)
    if hit and hit.get("canonical"):
        return hit["canonical"], hit["status"]
    bare = strip_member_annotations(name)
    for m in members.values():
        if norm_key(strip_member_annotations(m["raw"])) == norm_key(bare) and m.get("canonical"):
            return m["canonical"], m["status"]
    return None, (hit or {}).get("status", "unresolved")


# ---------------------------------------------------------------------------
# Marts
# ---------------------------------------------------------------------------


def build_capacity_pod_mart(capacity_rows: list[dict]) -> list[dict]:
    """Latest-version collapse per (pod, year, month) — IDENTICAL rule to
    GET /api/capacity/pod-summary (rank by the integer after 'V')."""
    latest: dict[tuple, dict] = {}
    for r in capacity_rows:
        key = (r["year"], r["month"], r["pod"])
        cur = latest.get(key)
        if cur is None or version_num(r["version"]) > version_num(cur["version"]):
            latest[key] = r
    return [
        {
            "year": r["year"],
            "month": r["month"],
            "pod": r["pod"],
            "version": r["version"],
            "total_capacity": r["total_capacity"],
            "projected_used_capacity": r["projected_used_capacity"],
            "actual_used_capacity": r["actual_used_capacity"],
        }
        for r in sorted(latest.values(), key=lambda r: (r["year"], r["month"], r["pod"]))
    ]


def build_member_utilization_mart(session: Session, mappings: dict) -> list[dict]:
    """Per (year, month, pod, member) utilization — the SAME computation as
    GET /api/capacity/member-utilization, for every month with staffed
    capacity, plus the canonical member name."""
    out: list[dict] = []
    for year, month in distinct_capacity_months(session):
        cph, ph, ar, emc = fetch_month_inputs(session, year, month)
        for r in compute_member_utilization(cph, ph, ar, emc):
            canon, status = _member_canonical(r["member"], mappings)
            out.append({"year": year, "month": month, **r,
                        "member_canonical": canon, "member_match_status": status})
    return out


def build_client_contributions_mart(session: Session, mappings: dict) -> list[dict]:
    """Per (year, month, pod, client) production contributions — the processed
    table that drives the pod totals; same fn as GET /api/capacity/client-contributions."""
    names = client_names(session)
    cmap = mappings["client_aliases"]["hub_to_salesforce"]
    out: list[dict] = []
    for year, month in distinct_capacity_months(session):
        cph, ph, _, _ = fetch_month_inputs(session, year, month)
        for r in compute_client_contributions(cph, ph, names):
            r = {"year": year, "month": month, **r}
            r["sf_client_name"] = cmap.get(r["client_name"], {}).get("sf_name")
            out.append(r)
    return out


def build_articles_monthly_mart(session: Session) -> list[dict]:
    """Pre-aggregated article counts at (month, editorial_pod, growth_pod,
    client, editor) grain — the exact rollup GET /api/articles/monthly serves
    (its single-axis grouping is a further sum over this grain)."""
    rows = session.execute(
        text(
            """
            SELECT month_year, editorial_pod, growth_pod, client_name, editor_name,
                   COUNT(*) AS count,
                   COUNT(*) FILTER (WHERE revision_count > 0) AS revised,
                   COUNT(*) FILTER (WHERE is_published) AS published,
                   COUNT(*) FILTER (WHERE is_published AND revision_count > 0) AS published_revised,
                   COUNT(*) FILTER (WHERE notion_matched) AS matched
            FROM article_records
            WHERE month_year IS NOT NULL
            GROUP BY 1, 2, 3, 4, 5
            ORDER BY 1, 2, 3, 4, 5
            """
        )
    )
    return [dict(r._mapping) for r in rows]


def build_revisions_monthly_mart(session: Session) -> list[dict]:
    rows = session.execute(
        text(
            """
            SELECT month_year, editorial_pod, growth_pod, client_name, editor_name,
                   COUNT(*) AS revisions
            FROM article_revisions
            WHERE month_year IS NOT NULL
            GROUP BY 1, 2, 3, 4, 5
            ORDER BY 1, 2, 3, 4, 5
            """
        )
    )
    return [dict(r._mapping) for r in rows]


# ---------------------------------------------------------------------------
# Mapping dictionaries → BQ rows (review tables for DaniQ / Data Quality)
# ---------------------------------------------------------------------------


def mapping_table_rows(mappings: dict) -> dict[str, list[dict]]:
    ed = mappings["editor_aliases"]
    cl = mappings["client_aliases"]
    wr = mappings["writer_aliases"]
    editors = [
        {
            "raw_name": v["raw"],
            "canonical_name": v.get("canonical"),
            "status": v["status"],
            "hr_status": v.get("hr_status"),
            "article_rows": v.get("articles", 0),
            "candidates": json.dumps(v.get("candidates")) if v.get("candidates") else None,
            "note": v.get("note"),
        }
        for v in ed["aliases"].values()
    ]
    clients = [
        {
            "hub_name": v["hub_name"],
            "sf_client_name": v.get("sf_name"),
            "sf_account_id": v.get("sf_account_id"),
            "status": v["status"],
            "hub_status": v.get("hub_status"),
            "note": v.get("note"),
        }
        for v in cl["hub_to_salesforce"].values()
    ] + [
        {
            "hub_name": f"[tab] {v['tab']}",
            "sf_client_name": v.get("hub_client"),
            "sf_account_id": None,
            "status": f"tab_{v['status']}",
            "hub_status": None,
            "note": (v.get("note") or "") + f" ({v['articles']} article rows)",
        }
        for v in cl["article_tabs_unmapped"].values()
    ]
    writers = [
        {
            "raw_name": v["raw"],
            "canonical_name": v.get("canonical"),
            "status": v["status"],
            "article_rows": v.get("articles", 0),
            "candidates": json.dumps(v.get("candidates")) if v.get("candidates") else None,
        }
        for v in wr["aliases"].values()
    ]
    return {
        "editorial_map_editors": editors,
        "editorial_map_clients": clients,
        "editorial_map_writers": writers,
    }
