"""Warehouse builders — RAW (16 topic tables) and INT (8 transform tables).

RAW reuses the proven extract/canonical code from the phase-1 ETL; INT applies
every business rule via the verbatim ports in `pyrules.py` plus the SHARED
`app/services/capacity_calc.py` (same module the API uses). All tables get a
`synced_at` stamp; time-anchored INT tables also get `as_of_date`.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import text

from app import models as m

from etl import transform
from etl.extract import fetch_model_rows, get_session
from etl.load import get_bq, load_rows, schema_for_model, schema_from_spec
from etl.warehouse import pyrules as R

SYNCED_AT = datetime.now(timezone.utc)


def _stamp(rows: list[dict]) -> list[dict]:
    for r in rows:
        r["synced_at"] = SYNCED_AT
    return rows


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
]

_EXTRA_BY_TRANSFORM = {
    "client_canonicals": [
        ("sf_client_name", "STRING"), ("sf_account_id", "STRING"),
        ("sf_match_status", "STRING"),
    ],
    "article_canonicals": [
        ("editor_canonical", "STRING"), ("editor_match_status", "STRING"),
        ("writer_canonical", "STRING"), ("writer_match_status", "STRING"),
    ],
}

NAME_MAPPINGS_SPEC = [
    ("kind", "STRING"), ("raw_name", "STRING"), ("canonical_name", "STRING"),
    ("status", "STRING"), ("note", "STRING"), ("synced_at", "TIMESTAMP"),
]


def build_raw(bq, session, mappings) -> dict[str, int]:
    counts: dict[str, int] = {}
    for model, table, tkey in RAW_TABLES:
        rows = fetch_model_rows(session, model)
        if tkey == "client_canonicals":
            rows = transform.add_client_canonicals(rows, mappings)
        elif tkey == "article_canonicals":
            rows = transform.add_article_canonicals(rows, mappings)
        extra = _EXTRA_BY_TRANSFORM.get(tkey or "", []) + [("synced_at", "TIMESTAMP")]
        counts[table] = load_rows(bq, table, _stamp(rows), schema_for_model(model, extra))

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
    counts["editorial_raw_name_mappings"] = load_rows(
        bq, "editorial_raw_name_mappings", _stamp(union), schema_from_spec(NAME_MAPPINGS_SPEC)
    )
    return counts


# ──────────────────────────────────────────────────────────────────────────────
# INT layer
# ──────────────────────────────────────────────────────────────────────────────

INT_CLIENT_MONTHS_SPEC = [
    ("client_id", "INTEGER"), ("client_name", "STRING"),
    ("year", "INTEGER"), ("month", "INTEGER"),
    ("delivered", "INTEGER"), ("invoiced", "INTEGER"), ("sow_target", "INTEGER"),
    ("is_future", "BOOLEAN"),
    ("prod_actual", "INTEGER"), ("prod_projected", "INTEGER"),
    ("prod_projected_original", "INTEGER"), ("prod_is_actual", "BOOLEAN"),
    ("ovr_period_idx", "INTEGER"), ("ovr_period_label", "STRING"),
    ("ovr_is_prelude", "BOOLEAN"),
    ("d1_period_idx", "INTEGER"), ("d1_period_label", "STRING"),
    ("d1_is_prelude", "BOOLEAN"), ("d1_is_post_contract", "BOOLEAN"),
    ("as_of_date", "DATE"), ("synced_at", "TIMESTAMP"),
]

INT_Q_SNAPSHOT_SPEC = [
    ("client_id", "INTEGER"), ("client_name", "STRING"), ("status", "STRING"),
    ("editorial_pod", "STRING"), ("growth_pod", "STRING"),
    # lifetime (Overview buildLifetimeSummaries semantics)
    ("lifetime_delivered", "INTEGER"), ("lifetime_invoiced", "INTEGER"),
    ("articles_sow", "INTEGER"), ("lifetime_variance", "INTEGER"),
    ("pct_complete", "INTEGER"),
    ("published_live", "INTEGER"), ("pct_published", "INTEGER"),
    # Overview current Q (computeCurrentQ)
    ("ovr_q_label", "STRING"), ("ovr_q_month_in_q", "INTEGER"),
    ("ovr_q_length", "INTEGER"), ("ovr_q_delivered", "INTEGER"),
    ("ovr_q_projected_remaining", "INTEGER"), ("ovr_q_projected_end", "INTEGER"),
    ("ovr_q_invoiced", "INTEGER"), ("ovr_q_projected_variance", "INTEGER"),
    ("ovr_is_first_q", "BOOLEAN"), ("ovr_tier", "STRING"),
    # Overview last full Q (computeLastFullQ)
    ("ovr_lq_label", "STRING"), ("ovr_lq_delivered", "INTEGER"),
    ("ovr_lq_invoiced", "INTEGER"), ("ovr_lq_cum_delivered", "INTEGER"),
    ("ovr_lq_cum_invoiced", "INTEGER"), ("ovr_lq_cum_variance", "INTEGER"),
    ("ovr_lq_is_first_q", "BOOLEAN"),
    # D1 (deliveryMeta override + detectBillingPeriods + quarterMetaFromPeriods)
    ("d1_effective_start", "DATE"), ("d1_term_months", "INTEGER"),
    ("d1_lifetime_sow", "INTEGER"),
    ("d1_q_label", "STRING"), ("d1_q_month_in_q", "INTEGER"),
    ("d1_q_length", "INTEGER"), ("d1_q_delivered_actual", "INTEGER"),
    ("d1_q_invoiced", "INTEGER"),
    ("d1_q_projected_end_cum_delivered", "INTEGER"),
    ("d1_q_actual_cum_delivered", "INTEGER"),
    ("d1_q_end_of_q_cum_invoiced", "INTEGER"),
    ("d1_q_projected_end_cum_variance", "INTEGER"),
    ("d1_is_first_q", "BOOLEAN"), ("d1_tier", "STRING"),
    ("d1_lq_label", "STRING"), ("d1_lq_delivered", "INTEGER"),
    ("d1_lq_invoiced", "INTEGER"), ("d1_lq_cum_delivered", "INTEGER"),
    ("d1_lq_cum_invoiced", "INTEGER"), ("d1_lq_cum_variance", "INTEGER"),
    ("as_of_date", "DATE"), ("synced_at", "TIMESTAMP"),
]

INT_GOALS_SPEC = [
    ("client_name", "STRING"), ("month_year", "STRING"), ("content_type", "STRING"),
    ("ratio", "FLOAT"),
    ("cb_goal", "FLOAT"), ("cb_delivered", "FLOAT"),
    ("ad_goal", "FLOAT"), ("ad_delivered", "FLOAT"),
    ("w_cb_goal", "FLOAT"), ("w_cb_delivered", "FLOAT"),
    ("w_ad_goal", "FLOAT"), ("w_ad_delivered", "FLOAT"),
    ("synced_at", "TIMESTAMP"),
]


def _month_key(y: int, mth: int) -> tuple[int, int]:
    return (y, mth)


def build_int_delivery(bq, session, as_of: date) -> dict[str, int]:
    """int_client_months + int_client_q_snapshot — the variance brain."""
    clients = fetch_model_rows(session, m.Client)
    deliverables = fetch_model_rows(session, m.DeliverableMonthly)
    production = fetch_model_rows(session, m.ProductionHistory)
    cumulative = fetch_model_rows(session, m.CumulativeMetric)
    published_by_name = {c["client_name"]: (c.get("published_live") or 0) for c in cumulative}

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
            (r for r in month_rows if r["delivered"] > 0 or r["invoiced"] > 0 or r["sow_target"] > 0),
            key=lambda r: (r["year"], r["month"]),
        )
        meta_start = None
        d1_term = c.get("term_months")
        lifetime_sow = sum(r["sow_target"] for r in month_rows)
        if active:
            first_ym = _month_key(active[0]["year"], active[0]["month"])
            last_planned = next(
                (r for r in reversed(active) if r["sow_target"] > 0), active[-1]
            )
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
                    p.q_idx, p.label, p.is_prelude, p.is_post_contract,
                )

        prod_map = by_client_prod.get(cid, {})
        all_months = sorted(set(list(prod_map.keys()) + [(r["year"], r["month"]) for r in breakdown]))
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
                "pct_published": R.js_round(published / sow * 100) if sow > 0 else 0,
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
                "d1_q_projected_end_cum_delivered": d1_cq["projected_end_cum_delivered"] if d1_cq else None,
                "d1_q_actual_cum_delivered": d1_cq["actual_cum_delivered"] if d1_cq else None,
                "d1_q_end_of_q_cum_invoiced": d1_cq["end_of_q_cum_invoiced"] if d1_cq else None,
                "d1_q_projected_end_cum_variance": d1_cq["projected_end_cum_variance"] if d1_cq else None,
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

    return {
        "editorial_int_client_months": load_rows(
            bq, "editorial_int_client_months", _stamp(month_rows_out),
            schema_from_spec(INT_CLIENT_MONTHS_SPEC),
        ),
        "editorial_int_client_q_snapshot": load_rows(
            bq, "editorial_int_client_q_snapshot", _stamp(snapshot_out),
            schema_from_spec(INT_Q_SNAPSHOT_SPEC),
        ),
    }


def build_int_goals(bq, session) -> dict[str, int]:
    rows = [
        dict(r._mapping)
        for r in session.execute(
            text(
                "SELECT client_name, month_year, content_type, ratios, "
                "cb_monthly_goal, ad_monthly_goal, cb_delivered_to_date, "
                "ad_delivered_to_date FROM goals_vs_delivery"
            )
        )
    ]
    out = R.goals_month_ct_rows(rows)
    return {
        "editorial_int_goals_month_ct": load_rows(
            bq, "editorial_int_goals_month_ct", _stamp(out), schema_from_spec(INT_GOALS_SPEC)
        )
    }


def build_int_capacity_articles(bq, session, mappings) -> dict[str, int]:
    """Capacity + articles INT tables — reuse the phase-1 mart builders (which
    share `capacity_calc` with the API) under the new layered names."""
    from etl.run import MART_SCHEMAS  # canonical specs from phase 1

    counts = {}
    counts["editorial_int_capacity_pod_months"] = load_rows(
        bq, "editorial_int_capacity_pod_months",
        _stamp(transform.build_capacity_pod_mart(fetch_model_rows(session, m.CapacityProjection))),
        schema_from_spec(MART_SCHEMAS["editorial_capacity_pod"] + [("synced_at", "TIMESTAMP")]),
    )
    counts["editorial_int_member_months"] = load_rows(
        bq, "editorial_int_member_months",
        _stamp(transform.build_member_utilization_mart(session, mappings)),
        schema_from_spec(
            MART_SCHEMAS["editorial_capacity_member_utilization"] + [("synced_at", "TIMESTAMP")]
        ),
    )
    counts["editorial_int_client_pod_months"] = load_rows(
        bq, "editorial_int_client_pod_months",
        _stamp(transform.build_client_contributions_mart(session, mappings)),
        schema_from_spec(
            MART_SCHEMAS["editorial_capacity_client_contributions"] + [("synced_at", "TIMESTAMP")]
        ),
    )
    counts["editorial_int_articles_creation"] = load_rows(
        bq, "editorial_int_articles_creation",
        _stamp(transform.build_articles_monthly_mart(session)),
        schema_from_spec(MART_SCHEMAS["editorial_articles_monthly"] + [("synced_at", "TIMESTAMP")]),
    )
    counts["editorial_int_articles_revisions"] = load_rows(
        bq, "editorial_int_articles_revisions",
        _stamp(transform.build_revisions_monthly_mart(session)),
        schema_from_spec(MART_SCHEMAS["editorial_revisions_monthly"] + [("synced_at", "TIMESTAMP")]),
    )
    return counts


def build_all(layers: set[str] | None = None, as_of: date | None = None) -> dict[str, int]:
    layers = {"raw", "int"} if layers is None else layers
    if not layers:
        return {}
    as_of = as_of or date.today()
    bq = get_bq()
    mappings = transform.load_mappings()
    counts: dict[str, int] = {}
    with get_session() as session:
        if "raw" in layers:
            counts.update(build_raw(bq, session, mappings))
        if "int" in layers:
            counts.update(build_int_delivery(bq, session, as_of))
            counts.update(build_int_goals(bq, session))
            counts.update(build_int_capacity_articles(bq, session, mappings))
    return counts
