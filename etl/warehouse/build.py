"""Warehouse builders — RAW (16 topic tables) and INT (8 transform tables).

RAW reuses the proven extract/canonical code from the phase-1 ETL; INT applies
every business rule via the verbatim ports in `pyrules.py` plus the SHARED
`app/services/capacity_calc.py` (same module the API uses). All tables get a
`synced_at` stamp; time-anchored INT tables also get `as_of_date`.
"""

from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone

from sqlalchemy import select, text

from app import models as m
from etl import transform
from etl.extract import fetch_model_rows, get_session
from etl.load import get_bq, load_rows, schema_for_model, schema_from_spec
from etl.warehouse import pyrules as R

logger = logging.getLogger("etl.warehouse.build")

_BUILD_TS: datetime | None = None


def _stamp(rows: list[dict]) -> list[dict]:
    # One timestamp per build_all run (NOT module import time — the manifest
    # runs builds in the long-lived backend process — and not per-table, so
    # cross-table freshness comparisons stay exact).
    ts = _BUILD_TS or datetime.now(timezone.utc)
    for r in rows:
        r["synced_at"] = ts
    return rows


# One job = (bq table name, rows, schema). Extraction/compute stays serial
# (one SQLAlchemy session, fast); the BQ LOAD jobs are network-bound and run
# in parallel — this is what turns the ~2 min publish into ~25-35 s.
Job = tuple[str, list[dict], list]


def flush_jobs(bq, jobs: list[Job], pg_engine=None, max_workers: int = 8) -> dict[str, int]:
    """Load all jobs to BOTH sinks in parallel. Per-job failures are isolated
    (every other table still loads) and re-raised AGGREGATED at the end so the
    sync UI can name exactly which tables are stale."""
    from etl.warehouse import pg_sink

    def _one(job: Job) -> tuple[str, int, str | None]:
        name, rows, schema = job
        try:
            n = load_rows(bq, name, rows, schema)
            # Dual sink: the processed layer ALSO lands in Postgres (schema
            # `warehouse`) — same in-memory rows, so the two stores can't drift.
            if pg_engine is not None and pg_sink.sinks_to_pg(name):
                pg_sink.write_table(pg_engine, name, rows, schema)
            return name, n, None
        except Exception as exc:  # noqa: BLE001 — aggregated below
            return name, 0, f"{type(exc).__name__}: {exc}"

    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        results = list(ex.map(_one, jobs))
    failures = [(n, e) for n, _c, e in results if e]
    if failures:
        raise RuntimeError(
            "warehouse load failed for " + "; ".join(f"{n} ({e})" for n, e in failures)
        )
    return {n: c for n, c, _e in results}


# ──────────────────────────────────────────────────────────────────────────────
# RAW layer — topic tables (model → table name, optional canonical transform)
# ──────────────────────────────────────────────────────────────────────────────

RAW_TABLES: list[tuple[type, str, str | None]] = [
    (m.Client, "editorial_raw_clients", "client_canonicals"),
    (m.DeliverableMonthly, "editorial_raw_deliverables", None),
    (m.ProductionHistory, "editorial_raw_production", None),
    (m.GoalsVsDelivery, "editorial_raw_goals", None),
    (m.CumulativeMetric, "editorial_raw_cumulative", None),
    (m.CapacityProjection, "editorial_raw_capacity", None),
    (m.EditorialMemberCapacity, "editorial_raw_capacity_members", None),
    (m.ClientPodHistory, "editorial_raw_client_pod_history", None),
    (m.ArticleRecord, "editorial_raw_articles", "article_canonicals"),
    (m.ArticleRevision, "editorial_raw_article_revisions", None),
    (m.EditorialWeek, "editorial_raw_calendar", None),
    (m.KpiScore, "editorial_raw_kpi_scores", None),
    (m.AIMonitoringRecord, "editorial_raw_ai_monitoring", None),
    (m.SurferAPIUsage, "editorial_raw_surfer_usage", None),
    (m.TeamMember, "editorial_raw_team_members", None),
    # Pacing templates: the /api/dashboard/pacing endpoint still FETCHES them
    # (its result is currently unrendered, but the page request must not 500).
    (m.DeliveryTemplate, "editorial_raw_delivery_templates", None),
    (m.PodAssignmentHistory, "editorial_raw_pod_history", None),
    (m.ModelAssumption, "editorial_raw_model_assumptions", None),
]

_EXTRA_BY_TRANSFORM = {
    "client_canonicals": [
        ("sf_client_name", "STRING"),
        ("sf_account_id", "STRING"),
        ("sf_match_status", "STRING"),
    ],
    "article_canonicals": [
        ("editor_canonical", "STRING"),
        ("editor_match_status", "STRING"),
        ("writer_canonical", "STRING"),
        ("writer_match_status", "STRING"),
    ],
}

NAME_MAPPINGS_SPEC = [
    ("kind", "STRING"),
    ("raw_name", "STRING"),
    ("canonical_name", "STRING"),
    ("status", "STRING"),
    ("note", "STRING"),
    ("synced_at", "TIMESTAMP"),
]


def build_raw(session, mappings) -> list[Job]:
    jobs: list[Job] = []
    for model, table, tkey in RAW_TABLES:
        rows = fetch_model_rows(session, model)
        if tkey == "client_canonicals":
            rows = transform.add_client_canonicals(rows, mappings)
        elif tkey == "article_canonicals":
            rows = transform.add_article_canonicals(rows, mappings)
        extra = _EXTRA_BY_TRANSFORM.get(tkey or "", []) + [("synced_at", "TIMESTAMP")]
        jobs.append((table, _stamp(rows), schema_for_model(model, extra)))

    # The 3 mapping dictionaries collapsed into ONE table with a `kind` column.
    map_rows = transform.mapping_table_rows(mappings)
    union: list[dict] = []
    for kind, key_raw, key_canon in (
        ("editor", "raw_name", "canonical_name"),
        ("writer", "raw_name", "canonical_name"),
        ("client", "hub_name", "sf_client_name"),
    ):
        for r in map_rows[f"editorial_map_{kind}s"]:
            union.append(
                {
                    "kind": kind,
                    "raw_name": r.get(key_raw),
                    "canonical_name": r.get(key_canon),
                    "status": r.get("status"),
                    "note": r.get("note") or r.get("candidates"),
                }
            )
    jobs.append(
        ("editorial_raw_name_mappings", _stamp(union), schema_from_spec(NAME_MAPPINGS_SPEC))
    )
    return jobs


# ──────────────────────────────────────────────────────────────────────────────
# INT layer
# ──────────────────────────────────────────────────────────────────────────────

INT_CLIENT_MONTHS_SPEC = [
    ("client_id", "INTEGER"),
    ("client_name", "STRING"),
    ("year", "INTEGER"),
    ("month", "INTEGER"),
    ("delivered", "INTEGER"),
    ("invoiced", "INTEGER"),
    ("sow_target", "INTEGER"),
    ("is_future", "BOOLEAN"),
    ("prod_actual", "INTEGER"),
    ("prod_projected", "INTEGER"),
    ("prod_projected_original", "INTEGER"),
    ("prod_is_actual", "BOOLEAN"),
    ("ovr_period_idx", "INTEGER"),
    ("ovr_period_label", "STRING"),
    ("ovr_is_prelude", "BOOLEAN"),
    ("d1_period_idx", "INTEGER"),
    ("d1_period_label", "STRING"),
    ("d1_is_prelude", "BOOLEAN"),
    ("d1_is_post_contract", "BOOLEAN"),
    ("as_of_date", "DATE"),
    ("synced_at", "TIMESTAMP"),
]

INT_Q_SNAPSHOT_SPEC = [
    ("client_id", "INTEGER"),
    ("client_name", "STRING"),
    ("status", "STRING"),
    ("editorial_pod", "STRING"),
    ("growth_pod", "STRING"),
    # lifetime (Overview buildLifetimeSummaries semantics)
    ("lifetime_delivered", "INTEGER"),
    ("lifetime_invoiced", "INTEGER"),
    ("articles_sow", "INTEGER"),
    ("lifetime_variance", "INTEGER"),
    ("pct_complete", "INTEGER"),
    ("published_live", "INTEGER"),
    ("pct_published", "INTEGER"),
    # Overview current Q (computeCurrentQ)
    ("ovr_q_label", "STRING"),
    ("ovr_q_month_in_q", "INTEGER"),
    ("ovr_q_length", "INTEGER"),
    ("ovr_q_delivered", "INTEGER"),
    ("ovr_q_projected_remaining", "INTEGER"),
    ("ovr_q_projected_end", "INTEGER"),
    ("ovr_q_invoiced", "INTEGER"),
    ("ovr_q_projected_variance", "INTEGER"),
    ("ovr_is_first_q", "BOOLEAN"),
    ("ovr_tier", "STRING"),
    # Overview last full Q (computeLastFullQ)
    ("ovr_lq_label", "STRING"),
    ("ovr_lq_delivered", "INTEGER"),
    ("ovr_lq_invoiced", "INTEGER"),
    ("ovr_lq_cum_delivered", "INTEGER"),
    ("ovr_lq_cum_invoiced", "INTEGER"),
    ("ovr_lq_cum_variance", "INTEGER"),
    ("ovr_lq_is_first_q", "BOOLEAN"),
    # D1 (deliveryMeta override + detectBillingPeriods + quarterMetaFromPeriods)
    ("d1_effective_start", "DATE"),
    ("d1_term_months", "INTEGER"),
    ("d1_lifetime_sow", "INTEGER"),
    ("d1_q_label", "STRING"),
    ("d1_q_month_in_q", "INTEGER"),
    ("d1_q_length", "INTEGER"),
    ("d1_q_delivered_actual", "INTEGER"),
    ("d1_q_invoiced", "INTEGER"),
    ("d1_q_projected_end_cum_delivered", "INTEGER"),
    ("d1_q_actual_cum_delivered", "INTEGER"),
    ("d1_q_end_of_q_cum_invoiced", "INTEGER"),
    ("d1_q_projected_end_cum_variance", "INTEGER"),
    ("d1_is_first_q", "BOOLEAN"),
    ("d1_tier", "STRING"),
    ("d1_lq_label", "STRING"),
    ("d1_lq_delivered", "INTEGER"),
    ("d1_lq_invoiced", "INTEGER"),
    ("d1_lq_cum_delivered", "INTEGER"),
    ("d1_lq_cum_invoiced", "INTEGER"),
    ("d1_lq_cum_variance", "INTEGER"),
    ("as_of_date", "DATE"),
    ("synced_at", "TIMESTAMP"),
]

INT_GOALS_SPEC = [
    ("client_name", "STRING"),
    ("month_year", "STRING"),
    ("content_type", "STRING"),
    ("ratio", "FLOAT"),
    ("cb_goal", "FLOAT"),
    ("cb_delivered", "FLOAT"),
    ("ad_goal", "FLOAT"),
    ("ad_delivered", "FLOAT"),
    ("w_cb_goal", "FLOAT"),
    ("w_cb_delivered", "FLOAT"),
    ("w_ad_goal", "FLOAT"),
    ("w_ad_delivered", "FLOAT"),
    ("synced_at", "TIMESTAMP"),
]


def _month_key(y: int, mth: int) -> tuple[int, int]:
    return (y, mth)


def build_int_delivery(session, as_of: date) -> list[Job]:
    """int_client_months + int_client_q_snapshot — the variance brain."""
    clients = fetch_model_rows(session, m.Client)
    deliverables = fetch_model_rows(session, m.DeliverableMonthly)
    production = fetch_model_rows(session, m.ProductionHistory)
    cumulative = fetch_model_rows(session, m.CumulativeMetric)
    # cumulative now has one row per (client, content_type); sum published_live
    # per client with content-type weighting (article x1, jumbo x2, glossary/LP
    # x0.5; Webflow raw x1 -- same factors as v_editorial_fct_pipeline). Was a
    # dict comprehension that silently kept only the LAST content-type row.
    published_by_name: dict[str, int] = {}
    for _c in cumulative:
        _name = _c["client_name"]
        _ct = (_c.get("content_type") or "").strip().lower()
        if _name == "Webflow":
            _w = 1.0
        elif _ct == "jumbo":
            _w = 2.0
        elif _ct in ("lp", "landing page", "landing pages", "glossary"):
            _w = 0.5
        else:
            _w = 1.0
        published_by_name[_name] = published_by_name.get(_name, 0) + round(
            (_c.get("published_live") or 0) * _w
        )

    by_client_deliv: dict[int, list[dict]] = {}
    for d in deliverables:
        by_client_deliv.setdefault(d["client_id"], []).append(d)
    by_client_prod: dict[int, dict[tuple, dict]] = {}
    for p in production:
        by_client_prod.setdefault(p["client_id"], {})[(p["year"], p["month"])] = p

    month_rows_out: list[dict] = []
    snapshot_out: list[dict] = []

    for c in clients:
        cid = c["id"]
        drows = by_client_deliv.get(cid, [])
        month_rows = [
            {
                "year": d["year"],
                "month": d["month"],
                "delivered": d.get("articles_delivered") or 0,
                "invoiced": d.get("articles_invoiced") or 0,
                "sow_target": d.get("articles_sow_target") or 0,
            }
            for d in drows
        ]
        lifetime = R.build_lifetime_summary(month_rows, c.get("articles_sow"), as_of)
        breakdown = lifetime.monthly_breakdown

        # Overview path
        ovr_periods = R.detect_summary_billing_periods(breakdown, c.get("start_date"))
        ovr_cq = R.compute_current_q(ovr_periods, as_of)
        ovr_lq = R.compute_last_full_q(ovr_periods, as_of)
        ovr_new = R.is_first_contract_q(ovr_periods, as_of)
        ovr_tier = (
            R.variance_tier(ovr_cq["projected_variance"], ovr_new)
            if ovr_cq is not None and ovr_cq["invoiced"] > 0
            else None
        )

        # D1 path: deliveryMeta override (page.tsx:1420-1467) — month-grain
        # min(first active month, sheet start); lifetimeSow = Σ sow_target.
        active = sorted(
            (
                r
                for r in month_rows
                if r["delivered"] > 0 or r["invoiced"] > 0 or r["sow_target"] > 0
            ),
            key=lambda r: (r["year"], r["month"]),
        )
        meta_start = None
        d1_term = c.get("term_months")
        lifetime_sow = sum(r["sow_target"] for r in month_rows)
        if active:
            first_ym = _month_key(active[0]["year"], active[0]["month"])
            last_planned = next((r for r in reversed(active) if r["sow_target"] > 0), active[-1])
            last_ym = _month_key(last_planned["year"], last_planned["month"])
            s = c.get("start_date")
            if s:
                first_ym = min(first_ym, (s.year, s.month))
            e = c.get("end_date")
            if e:
                last_ym = max(last_ym, (e.year, e.month))
            meta_start = date(first_ym[0], first_ym[1], 1)
            d1_term = (last_ym[0] - first_ym[0]) * 12 + (last_ym[1] - first_ym[1]) + 1
        d1_start = meta_start or c.get("start_date")
        d1_sow = lifetime_sow if lifetime_sow > 0 else (c.get("articles_sow") or 0)

        d1_periods = R.detect_d1_billing_periods(
            breakdown, d1_start, c.get("end_date"), c.get("status")
        )
        qm = R.quarter_meta_from_periods(d1_periods, as_of)
        d1_cq, d1_lq = qm["current_q"], qm["last_full_q"]
        d1_first = bool(d1_cq and d1_cq["label"] == "Q1")
        d1_tier = (
            R.variance_tier(d1_cq["projected_end_cum_variance"], d1_first)
            if d1_cq is not None and d1_cq["invoiced"] > 0
            else None
        )

        # per-month period assignment maps
        ovr_by_month: dict[tuple, tuple] = {}
        for p in ovr_periods:
            for mo in p.months:
                ovr_by_month[(mo["year"], mo["month"])] = (p.q_idx, p.label, p.is_prelude)
        d1_by_month: dict[tuple, tuple] = {}
        for p in d1_periods:
            for mo in p.months:
                d1_by_month[(mo["year"], mo["month"])] = (
                    p.q_idx,
                    p.label,
                    p.is_prelude,
                    p.is_post_contract,
                )

        prod_map = by_client_prod.get(cid, {})
        all_months = sorted(
            set(list(prod_map.keys()) + [(r["year"], r["month"]) for r in breakdown])
        )
        bd_map = {(r["year"], r["month"]): r for r in breakdown}
        st_map = {(r["year"], r["month"]): r["sow_target"] for r in month_rows}
        for ym in all_months:
            bd = bd_map.get(ym)
            pr = prod_map.get(ym)
            ov = ovr_by_month.get(ym)
            dd = d1_by_month.get(ym)
            month_rows_out.append(
                {
                    "client_id": cid,
                    "client_name": c["name"],
                    "year": ym[0],
                    "month": ym[1],
                    "delivered": bd["delivered"] if bd else None,
                    "invoiced": bd["invoiced"] if bd else None,
                    "sow_target": st_map.get(ym),
                    "is_future": bd["is_future"] if bd else None,
                    "prod_actual": pr.get("articles_actual") if pr else None,
                    "prod_projected": pr.get("articles_projected") if pr else None,
                    "prod_projected_original": pr.get("projected_original") if pr else None,
                    "prod_is_actual": pr.get("is_actual") if pr else None,
                    "ovr_period_idx": ov[0] if ov else None,
                    "ovr_period_label": ov[1] if ov else None,
                    "ovr_is_prelude": ov[2] if ov else None,
                    "d1_period_idx": dd[0] if dd else None,
                    "d1_period_label": dd[1] if dd else None,
                    "d1_is_prelude": dd[2] if dd else None,
                    "d1_is_post_contract": dd[3] if dd else None,
                    "as_of_date": as_of,
                }
            )

        sow = lifetime.sow
        published = published_by_name.get(c["name"], 0)
        snapshot_out.append(
            {
                "client_id": cid,
                "client_name": c["name"],
                "status": c.get("status"),
                "editorial_pod": c.get("editorial_pod"),
                "growth_pod": c.get("growth_pod"),
                "lifetime_delivered": lifetime.delivered,
                "lifetime_invoiced": lifetime.invoiced,
                "articles_sow": sow,
                "lifetime_variance": lifetime.variance,
                "pct_complete": lifetime.pct_complete,
                "published_live": published,
                "pct_published": R.js_round(published / sow * 100) if sow > 0 else None,
                "ovr_q_label": ovr_cq["label"] if ovr_cq else None,
                "ovr_q_month_in_q": ovr_cq["month_in_q"] if ovr_cq else None,
                "ovr_q_length": ovr_cq["q_length"] if ovr_cq else None,
                "ovr_q_delivered": ovr_cq["delivered"] if ovr_cq else None,
                "ovr_q_projected_remaining": ovr_cq["projected_remaining"] if ovr_cq else None,
                "ovr_q_projected_end": ovr_cq["projected_end"] if ovr_cq else None,
                "ovr_q_invoiced": ovr_cq["invoiced"] if ovr_cq else None,
                "ovr_q_projected_variance": ovr_cq["projected_variance"] if ovr_cq else None,
                "ovr_is_first_q": ovr_new,
                "ovr_tier": ovr_tier,
                "ovr_lq_label": ovr_lq["label"] if ovr_lq else None,
                "ovr_lq_delivered": ovr_lq["delivered"] if ovr_lq else None,
                "ovr_lq_invoiced": ovr_lq["invoiced"] if ovr_lq else None,
                "ovr_lq_cum_delivered": ovr_lq["cum_delivered"] if ovr_lq else None,
                "ovr_lq_cum_invoiced": ovr_lq["cum_invoiced"] if ovr_lq else None,
                "ovr_lq_cum_variance": ovr_lq["cum_variance"] if ovr_lq else None,
                "ovr_lq_is_first_q": ovr_lq["is_first_q"] if ovr_lq else None,
                "d1_effective_start": d1_start,
                "d1_term_months": d1_term,
                "d1_lifetime_sow": d1_sow,
                "d1_q_label": d1_cq["label"] if d1_cq else None,
                "d1_q_month_in_q": d1_cq["month_in_q"] if d1_cq else None,
                "d1_q_length": d1_cq["q_length"] if d1_cq else None,
                "d1_q_delivered_actual": d1_cq["delivered_actual"] if d1_cq else None,
                "d1_q_invoiced": d1_cq["invoiced"] if d1_cq else None,
                "d1_q_projected_end_cum_delivered": d1_cq["projected_end_cum_delivered"]
                if d1_cq
                else None,
                "d1_q_actual_cum_delivered": d1_cq["actual_cum_delivered"] if d1_cq else None,
                "d1_q_end_of_q_cum_invoiced": d1_cq["end_of_q_cum_invoiced"] if d1_cq else None,
                "d1_q_projected_end_cum_variance": d1_cq["projected_end_cum_variance"]
                if d1_cq
                else None,
                "d1_is_first_q": d1_first if d1_cq else None,
                "d1_tier": d1_tier,
                "d1_lq_label": d1_lq["label"] if d1_lq else None,
                "d1_lq_delivered": d1_lq["delivered"] if d1_lq else None,
                "d1_lq_invoiced": d1_lq["invoiced"] if d1_lq else None,
                "d1_lq_cum_delivered": d1_lq["cum_delivered"] if d1_lq else None,
                "d1_lq_cum_invoiced": d1_lq["cum_invoiced"] if d1_lq else None,
                "d1_lq_cum_variance": d1_lq["cum_variance"] if d1_lq else None,
                "as_of_date": as_of,
            }
        )

    return [
        (
            "editorial_int_client_months",
            _stamp(month_rows_out),
            schema_from_spec(INT_CLIENT_MONTHS_SPEC),
        ),
        (
            "editorial_int_client_q_snapshot",
            _stamp(snapshot_out),
            schema_from_spec(INT_Q_SNAPSHOT_SPEC),
        ),
    ]


def build_int_goals(session) -> list[Job]:
    rows = [
        dict(r._mapping)
        for r in session.execute(
            text(
                "SELECT client_name, month_year, content_type, ratios, "
                "cb_monthly_goal, ad_monthly_goal, cb_delivered_to_date, "
                "ad_delivered_to_date FROM goals_vs_delivery "
                # Same ordering the API serves — the per-group ratio is
                # first-row-wins, so ordering is load-bearing.
                "ORDER BY month_year, week_number, client_name"
            )
        )
    ]
    out = R.goals_month_ct_rows(rows)
    return [("editorial_int_goals_month_ct", _stamp(out), schema_from_spec(INT_GOALS_SPEC))]


def build_int_capacity_articles(session, mappings) -> list[Job]:
    """Capacity + articles INT tables — reuse the phase-1 mart builders (which
    share `capacity_calc` with the API) under the new layered names."""
    from etl.run import MART_SCHEMAS  # canonical specs from phase 1

    def spec(key):
        return schema_from_spec(MART_SCHEMAS[key] + [("synced_at", "TIMESTAMP")])

    return [
        (
            "editorial_int_capacity_pod_months",
            _stamp(
                transform.build_capacity_pod_mart(fetch_model_rows(session, m.CapacityProjection))
            ),
            spec("editorial_capacity_pod"),
        ),
        (
            "editorial_int_member_months",
            _stamp(transform.build_member_utilization_mart(session, mappings)),
            spec("editorial_capacity_member_utilization"),
        ),
        (
            "editorial_int_client_pod_months",
            _stamp(transform.build_client_contributions_mart(session, mappings)),
            spec("editorial_capacity_client_contributions"),
        ),
        (
            "editorial_int_articles_creation",
            _stamp(transform.build_articles_monthly_mart(session)),
            spec("editorial_articles_monthly"),
        ),
        (
            "editorial_int_articles_revisions",
            _stamp(transform.build_revisions_monthly_mart(session)),
            spec("editorial_revisions_monthly"),
        ),
    ]


def build_int_pod_assignments(session) -> list[Job]:
    """Resolved per-month pod assignments — the backfill surface for the
    editorial-team-pods Hub. One row per (year, month, kind, pod, client,
    role, person) with everything resolved in Python: client → client_id via
    the same fuzzy resolver + ClientNameAlias the importers use (with a
    parenthetical-stripping retry for tab notes like "Better (April)"),
    person → canonical via the date-windowed editor aliases (Sam/Lauren).
    Writer rows pass through but are excluded from the fct view (free-text
    blobs; canonical writer history = the article log)."""
    from app.services.migration_service import _build_client_name_lookup, _resolve_client

    clients = session.execute(select(m.Client)).scalars().all()
    lookup = _build_client_name_lookup(clients, session)

    # date-windowed editor aliases (raw_lower -> [(from, to, canonical)]) from the
    # BigQuery editorial_name_map (Phase 1b); falls back to Neon if BQ is empty.
    from app.services.name_map_bq import fetch_name_map

    amap = fetch_name_map("editor", session)

    def canon_person(name: str, ym: str) -> str:
        # chip cells sometimes render the email as the display text
        if re.fullmatch(r"[\w.+-]+@[\w-]+\.[\w.]+", (name or "").strip()):
            name = name.split("@")[0].replace(".", " ").replace("_", " ").title()
        rows_ = amap.get((name or "").strip().lower())
        if not rows_:
            return name
        fallback = None
        for vfrom, vto, canon in rows_:
            if vfrom is None and vto is None:
                fallback = canon
                continue
            if (vfrom is None or vfrom <= ym) and (vto is None or ym <= vto):
                return canon
        return fallback or name

    # Date-windowed client identities (DaniQ 2026-06-12): "Tempo" before
    # 2026-06 = the old client, since renamed "Tempo.io"; from 2026-06 = the
    # new deal (ex "Tempo XYZ").
    CLIENT_WINDOWED = {"tempo": [(None, "2026-05", "Tempo.io"), ("2026-06", None, "Tempo")]}

    def resolve_client(raw: str, ym: str):
        for vfrom, vto, canon in CLIENT_WINDOWED.get((raw or "").strip().lower(), []):
            if (vfrom is None or vfrom <= ym) and (vto is None or ym <= vto):
                raw = canon
                break
        c = _resolve_client(lookup, raw)
        if c is None and "(" in raw:  # "Better (April)" → "Better"
            c = _resolve_client(lookup, re.sub(r"\s*\([^)]*\)\s*$", "", raw))
        return c

    # ── writer normalization (sheet writer cells are free text) ─────────────
    # Dictionary: writer-alias canonicals/raws + article-log writers + the
    # sheet's OWN clean single-name cells. Greedy longest-first matching splits
    # multi-name blobs — known names act as separators, so even glued text
    # ("Jack LimebearJacob McPhail") splits.
    from collections import defaultdict as _dd

    _W_JUNK = re.compile(
        r"(actively recruiting|also trying|hasn'?t started|but she|tbd|--|likely|"
        r"new writer|onboarding|backlog|hiring|unknown|uknown|no one'?s on|"
        r"not hired|not started)",
        re.I,
    )
    _NAME_RE = re.compile(r"^[A-Za-z][A-Za-z.'\-]+( [A-Za-z][A-Za-z.'\-]+){1,2}$")
    writer_canon: dict[str, str] = {}  # lower variant -> canonical
    # Writer normalization now comes from the LIVE BigQuery `editorial_name_map`
    # (DaniQ-editable sheet → BQ), not a stale local JSON — so her writer
    # corrections (incl. the "Auditioning Writer" bucket) flow into the
    # warehouse. Both the canonical and any multi-word raw variant become
    # dictionary keys for the greedy longest-first splitter below.
    wmap = fetch_name_map("writer", session)
    for raw_l, rows_ in wmap.items():
        canon = next((c for vf, vt, c in rows_ if vf is None and vt is None), None) or (
            rows_[0][2] if rows_ else None
        )
        if not canon:
            continue
        if " " in canon and len(canon) >= 7:
            writer_canon.setdefault(canon.lower(), canon)
        if " " in raw_l and len(raw_l) >= 7:
            writer_canon.setdefault(raw_l, canon)
    for (wn,) in session.execute(
        text(
            "SELECT DISTINCT writer_name FROM article_records "
            "WHERE writer_name LIKE '% %' AND LENGTH(writer_name) >= 7"
        )
    ):
        writer_canon.setdefault(wn.lower(), wn)
    hist = list(session.execute(select(m.PodAssignmentHistory)).scalars())
    for r in hist:  # sheet self-dictionary: clean single-name writer cells
        if r.role == "writer" and not _W_JUNK.search(r.display_name):
            nm = re.sub(r"\s+", " ", r.display_name).strip()
            if _NAME_RE.match(nm) and len(nm) >= 7:
                writer_canon.setdefault(nm.lower(), nm)
    _w_sorted = sorted(writer_canon, key=len, reverse=True)

    # Writer name -> email. CURATED map first (manually adjudicated by
    # Ricardo + this session on 2026-06-12 — every email observed in the
    # Team Pods WRITER EMAIL cells, assigned to the writer whose name it
    # matches or, for pun addresses, by row-elimination evidence). The
    # automatic fallback below only handles emails that appear AFTER this
    # review, and only on an unambiguous surname match.
    WRITER_EMAIL_CURATED: dict[str, str] = {
        "abby norwood": "abbyscottnorwood@gmail.com",
        "adaeze nwakaeze": "adaezeprincessnuel@gmail.com",
        "alex klocek": "aklocek16@gmail.com",
        "alex shoemaker": "alex.d.shoemaker@gmail.com",
        "amanda walgrove": "amandawalgrove@gmail.com",
        "aranyak nanda": "aranyaknanda98@gmail.com",
        "ashton playsted": "ashton.playsted@protonmail.com",
        "aysenur zaza": "aysenurxzaza@gmail.com",
        "bonniey josef": "bonnieyjosef@gmail.com",
        "brian abrams": "brnabrms@gmail.com",  # vowel-less local part
        "camille tovee": "camille.tovee@gmail.com",
        "carolina torres": "carolina1992torres@gmail.com",
        "chelsea oliver": "chelsea.m.oliver@gmail.com",
        "danielle mackinlay": "danielle.mackinlay@gmail.com",
        "eric swotinsky": "eric.swotinsky@gmail.com",
        "eric esposito": "ericespo23@gmail.com",
        "jack limebear": "jacklime31@gmail.com",
        "jacob mcphail": "jacobmcphailp@gmail.com",
        "jimmy bunes": "jbunes@jbuneswrites.com",
        "james bunes": "jbunes@jbuneswrites.com",  # same person
        "jordan finneseth": "jordan@synchronisticawareness.com",
        "jordan finnesth": "jordan@synchronisticawareness.com",  # sheet typo
        "kimberly kruge": "kimberly.a.kruge@gmail.com",
        "kevin vaughn": "kvz.vaughn@gmail.com",
        "mike ray": "mcray65@gmail.com",
        "meredith kane": "meredithmkane@gmail.com",
        "mike davis": "miked549@gmail.com",
        "michael davis": "miked549@gmail.com",  # same person
        # pun address — confirmed by row elimination (Abby's email was the
        # other one on Rocco's rows):
        "rocco pendola": "notascomposedasyouappear@gmail.com",
        "thea atkinson": "olsonthea@gmail.com",  # Olson = her other surname
        "paige greene": "paigelgreene1@gmail.com",
        "pat sather": "patrick.sather@gmail.com",
        "patrick sather": "patrick.sather@gmail.com",
        "dan pelberg": "pelbergwriting@gmail.com",
        "rich dezso": "rdezso@gmail.com",
        "sam mcgrail": "sammcgrail22@gmail.com",
        "samantha mcgrail": "sammcgrail22@gmail.com",
        # pun address — positional 2/2 evidence (Camille's was the other):
        "mindy born": "sinandvinegar@gmail.com",
        "marinda stuiver": "stuiverm66@gmail.com",
        # by elimination on Rob's rows (jordan@... was Jordan's):
        "rob harper": "clarks.tales@gmail.com",
        "telisa faye": "telisa.clarke@gmail.com",
        # jessjadesm@gmail.com co-occurred with Justine Smith but the local
        # part doesn't match her name — UNVERIFIED, left unassigned (DaniQ).
    }
    _EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+$")
    _seen_em: dict[str, set] = _dd(set)
    for r in hist:
        if (
            r.role == "writer"
            and r.email
            and r.display_name
            and _EMAIL_RE.fullmatch(r.email.strip())  # not a comma-joined pair
        ):
            _seen_em[r.display_name.strip().lower()].add(r.email.lower())
    writer_email: dict[str, str] = dict(WRITER_EMAIL_CURATED)
    curated_emails = set(WRITER_EMAIL_CURATED.values())
    for nm, ems in _seen_em.items():
        if nm in writer_email or len(ems) != 1:
            continue
        em = next(iter(ems))
        if em in curated_emails:
            continue  # already owned by someone in the curated map
        # conservative auto-fallback: unique surname (>=5 chars) match only
        local = re.sub(r"[^a-z]", "", em.split("@")[0])
        toks = re.sub(r"[^a-z ]", "", nm).split()
        if toks and len(toks[-1]) >= 5 and toks[-1] in local:
            writer_email[nm] = em

    def split_writers(cell: str) -> tuple[list[str], str]:
        rest = _W_JUNK.sub(" ", re.sub(r"[\n/]+", " ", cell)).lower()
        rest = re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+", " ", rest)  # strip emails
        found = []
        for nm in _w_sorted:
            if nm in rest:
                found.append(writer_canon[nm])
                rest = rest.replace(nm, " ")
        residue = " ".join(
            t
            for t in re.sub(r"[^a-z]+", " ", rest).split()
            if len(t) > 2 and t not in ("and", "also", "here", "yet")
        )
        return found, residue

    rows = []
    for r in hist:
        ym = f"{r.year:04d}-{r.month:02d}"
        c = resolve_client(r.client_name, ym) if r.client_name else None
        base = {
            "year": r.year,
            "month": r.month,
            "pod_kind": r.pod_kind,
            "pod": (
                r.pod_number if not str(r.pod_number or "").isdigit() else f"Pod {r.pod_number}"
            ),
            "client_raw": r.client_name,
            "client_id": c.id if c else None,
            "client_name": c.name if c else None,
            "role": r.role,
            "source_tab": r.source_tab,
        }
        if r.role != "writer":
            rows.append(
                {
                    **base,
                    "person_raw": r.display_name,
                    "person": canon_person(r.display_name, ym),
                    "email": r.email,
                    "confidence": "chip" if r.email else "text",
                }
            )
            continue
        found, residue = split_writers(r.display_name)
        single_clean = len(found) == 1 and not residue
        for nm in found:
            rows.append(
                {
                    **base,
                    "person_raw": r.display_name,
                    "person": nm,
                    # The curated/derived map is AUTHORITATIVE — row-level
                    # emails come from the sheet's positional pairing, which
                    # is exactly what produced the mispairs (eric ->
                    # ashton.playsted@...). Row email only for people the map
                    # has never adjudicated.
                    "email": writer_email.get(nm.lower())
                    or (
                        r.email
                        if single_clean and r.email and _EMAIL_RE.fullmatch(r.email.strip())
                        else None
                    ),
                    "confidence": "sheet" if single_clean else "sheet_split",
                }
            )
        if residue:
            rows.append(
                {
                    **base,
                    "person_raw": r.display_name,
                    "person": residue.title(),
                    "email": None,
                    "confidence": "unparsed",
                }
            )
    spec = schema_from_spec(
        [
            ("year", "INTEGER"),
            ("month", "INTEGER"),
            ("pod_kind", "STRING"),
            ("pod", "STRING"),
            ("client_raw", "STRING"),
            ("client_id", "INTEGER"),
            ("client_name", "STRING"),
            ("role", "STRING"),
            ("person_raw", "STRING"),
            ("person", "STRING"),
            ("email", "STRING"),
            ("confidence", "STRING"),
            ("source_tab", "STRING"),
            ("synced_at", "TIMESTAMP"),
        ]
    )
    return [("editorial_int_pod_assignments", _stamp(rows), spec)]


def build_all(layers: set[str] | None = None, as_of: date | None = None) -> dict[str, int]:
    layers = {"raw", "int"} if layers is None else layers
    if not layers:
        return {}
    as_of = as_of or date.today()
    bq = get_bq()
    mappings = transform.load_mappings()
    # Inject the authoritative editor roster so add_article_canonicals can
    # resolve clean editor names (no alias entry) → editor_canonical. Guarded:
    # if the view is unreachable, fall back to alias-only (current behavior).
    from app.config import settings
    from etl.util import norm_key

    try:
        _ds = f"{settings.bq_project}.{settings.bq_dataset}"
        _loc = bq.get_dataset(f"{settings.bq_project}.{settings.bq_dataset}").location

        def _roster(*roles: str) -> dict:
            role_list = ", ".join(f"'{x}'" for x in roles)
            return {
                norm_key(r.canonical_name): r.canonical_name
                for r in bq.query(
                    f"SELECT DISTINCT canonical_name FROM `{_ds}.v_editorial_roster` "
                    f"WHERE role IN ({role_list}) AND canonical_name IS NOT NULL",
                    location=_loc,
                ).result()
            }

        mappings["editor_roster_canon"] = _roster("editor", "sr_editor")
        mappings["writer_roster_canon"] = _roster("writer")
        logger.info(
            "roster fetched: %d editors, %d writers",
            len(mappings["editor_roster_canon"]),
            len(mappings["writer_roster_canon"]),
        )
    except Exception:  # degrade to alias/roster-JSON resolution (still resolves most names)
        mappings["editor_roster_canon"] = {}
        mappings["writer_roster_canon"] = {}
        logger.exception("roster fetch failed — editor/writer_canonical via mappings only")
    from etl.extract import get_engine
    from etl.warehouse import pg_sink

    global _BUILD_TS
    _BUILD_TS = datetime.now(timezone.utc)
    pg_engine = get_engine()
    pg_sink.ensure_schema(pg_engine)
    # Cross-process publish lock (SYNC step, wizard import, refresh.sh can all
    # trigger a publish) — second publisher waits, never interleaves.
    with pg_engine.connect() as lock_cx:
        lock_cx.execute(text("SELECT pg_advisory_lock(815001)"))
        try:
            jobs: list[Job] = []
            with get_session() as session:
                if "raw" in layers:
                    jobs += build_raw(session, mappings)
                if "int" in layers:
                    jobs += build_int_delivery(session, as_of)
                    jobs += build_int_goals(session)
                    jobs += build_int_capacity_articles(session, mappings)
                    jobs += build_int_pod_assignments(session)
            try:
                counts = flush_jobs(bq, jobs, pg_engine=pg_engine)
            finally:
                # PG views are CASCADE-dropped with their tables — recreate
                # even on partial failure so the schema is never left bare.
                pg_sink.create_pg_views(pg_engine)
            return counts
        finally:
            _BUILD_TS = None
            lock_cx.execute(text("SELECT pg_advisory_unlock(815001)"))
