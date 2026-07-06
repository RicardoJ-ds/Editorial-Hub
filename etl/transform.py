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
    # Authoritative editor roster (v_editorial_roster, injected by build_all).
    # Clean editors need no alias entry, so they were falling through to
    # 'unresolved' even though the article name IS already the roster canonical
    # (100% of 2026 rows). Match the full editor_name against the roster so
    # editor_canonical is populated for downstream canonical-keyed joins.
    ed_roster = mappings.get("editor_roster_canon", {})
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
        elif ek in ed_roster:
            r["editor_canonical"] = ed_roster[ek]
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
            out.append(
                {
                    "year": year,
                    "month": month,
                    **r,
                    "member_canonical": canon,
                    "member_match_status": status,
                }
            )
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


def build_month_basis_mart(session: Session) -> list[dict]:
    """Per (client, year, month): Operating Model actual (calendar month) vs the
    article log counted two ways — by EDITORIAL month (week distribution, what
    the dashboards use) and by CALENDAR month (the article's submitted date).

    This is the evidence table for the month-definition question: for CLOSED
    months and well-logged clients the editorial-month count equals the
    Operating Model actual exactly, proving the data isn't lost — only the month
    boundary + completeness differ. `verdict` tags each row for quick scanning."""
    rows = session.execute(
        text(
            """
            WITH ph AS (
              SELECT client_id, year, month, SUM(COALESCE(articles_actual,0)) AS act
              FROM production_history WHERE is_actual AND client_id IS NOT NULL
              GROUP BY 1,2,3),
            le AS (
              SELECT client_id, year, month, COUNT(DISTINCT article_uid) AS c
              FROM article_records WHERE client_id IS NOT NULL AND year IS NOT NULL
              GROUP BY 1,2,3),
            lc AS (
              SELECT client_id,
                     EXTRACT(YEAR FROM submitted_date)::int AS year,
                     EXTRACT(MONTH FROM submitted_date)::int AS month,
                     COUNT(DISTINCT article_uid) AS c
              FROM article_records
              WHERE client_id IS NOT NULL AND submitted_date IS NOT NULL
              GROUP BY 1,2,3)
            SELECT c.name AS client_name,
                   COALESCE(ph.year, le.year, lc.year) AS year,
                   COALESCE(ph.month, le.month, lc.month) AS month,
                   COALESCE(ph.act, 0) AS operating_model_actual,
                   COALESCE(le.c, 0) AS log_editorial_month,
                   COALESCE(lc.c, 0) AS log_calendar_month
            FROM ph
            FULL JOIN le USING (client_id, year, month)
            FULL JOIN lc USING (client_id, year, month)
            JOIN clients c
              ON c.id = COALESCE(ph.client_id, le.client_id, lc.client_id)
            ORDER BY 1, 2, 3
            """
        )
    )
    out: list[dict] = []
    for r in rows:
        prod, edit, cal = r.operating_model_actual, r.log_editorial_month, r.log_calendar_month
        diff = edit - prod
        if prod == 0 and edit == 0 and cal == 0:
            continue
        if prod == 0:
            verdict = "no_operating_model"
        elif edit == prod:
            verdict = "exact_match"
        elif abs(diff) <= 2:
            verdict = "close"
        elif edit == 0:
            verdict = "missing_from_log"
        elif abs(cal - prod) < abs(diff):
            verdict = "month_boundary"  # calendar count is closer → boundary effect
        else:
            verdict = "gap"
        out.append(
            {
                "client_name": r.client_name,
                "year": r.year,
                "month": r.month,
                "operating_model_actual": prod,
                "log_editorial_month": edit,
                "log_calendar_month": cal,
                "edit_minus_prod": diff,
                "verdict": verdict,
            }
        )
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
                   COUNT(*) FILTER (WHERE second_review IS NOT NULL AND second_review <> '') AS second_reviews,
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
