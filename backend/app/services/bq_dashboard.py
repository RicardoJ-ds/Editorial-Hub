"""BigQuery read layer for the dashboard endpoints (the warehouse repoint).

Each function mirrors one Postgres-backed endpoint EXACTLY (same filters, same
aggregation, same shapes — see etl/WAREHOUSE_DESIGN.md). Routers branch here
when the data source resolves to "bq" (settings.dashboard_source, overridable
per-request via the X-Data-Source header for the parity harness).

Reads are served from the layered warehouse in graphite_bi_sandbox:
row-shaped endpoints read `editorial_raw_*`; aggregate endpoints read the
`editorial_int_*` tables that already carry every business rule.
"""

from __future__ import annotations

from datetime import date, datetime

from fastapi import Request
from google.cloud import bigquery

from app.config import settings

_client: bigquery.Client | None = None


def get_data_source(request: Request) -> str:
    """The per-request data source: X-Data-Source header (parity harness;
    honored only when the override flag is on — keep it OFF in prod) else the
    configured default."""
    if settings.data_source_override_enabled:
        hdr = (request.headers.get("X-Data-Source") or "").strip().lower()
        if hdr in ("bq", "postgres"):
            return hdr
    return settings.dashboard_source


def bq() -> bigquery.Client:
    global _client
    if _client is None:
        from app.services.google_auth import get_google_credentials

        creds = get_google_credentials(scopes=["https://www.googleapis.com/auth/bigquery"])
        _client = bigquery.Client(project=settings.bq_project, credentials=creds)
    return _client


DS = f"`{settings.bq_project}.{settings.bq_dataset}`"


def q(sql: str, params: list | None = None) -> list[dict]:
    # Served from the publish-token cache (services/bq_cache.py) so neither BQ
    # nor Neon is hit on every request; a SYNC bumps the token → fresh numbers.
    from app.services import bq_cache

    def _run() -> list[dict]:
        job = bq().query(sql, job_config=bigquery.QueryJobConfig(query_parameters=params or []))
        rows = [dict(r) for r in job.result()]
        # Postgres stores naive UTC datetimes; BQ returns tz-aware. Normalize so
        # both sources serialize identically through the response models.
        for r in rows:
            for k, v in r.items():
                if isinstance(v, datetime) and v.tzinfo is not None:
                    r[k] = v.replace(tzinfo=None)
        return rows

    return bq_cache.cached_query(sql, params, _run)


def _p(name: str, type_: str, value):
    return bigquery.ScalarQueryParameter(name, type_, value)


def _arr(name: str, type_: str, values):
    return bigquery.ArrayQueryParameter(name, type_, values)


# ──────────────────────────────────────────────────────────────────────────────
# /api/clients/  (RBAC scope filter applied by the ROUTER — app state stays PG)
# ──────────────────────────────────────────────────────────────────────────────


def list_clients(
    search: str | None,
    status: str | None,
    growth_pod: str | None,
    editorial_pod: str | None,
    skip: int,
    limit: int,
    allowed_names: set[str] | None,
) -> list[dict]:
    where, params = ["TRUE"], []
    if search:
        where.append("LOWER(name) LIKE LOWER(@search)")
        params.append(_p("search", "STRING", f"%{search}%"))
    if status:
        where.append("status = @status")
        params.append(_p("status", "STRING", status))
    if growth_pod:
        where.append("growth_pod = @gpod")
        params.append(_p("gpod", "STRING", growth_pod))
    if editorial_pod:
        where.append("editorial_pod = @epod")
        params.append(_p("epod", "STRING", editorial_pod))
    if allowed_names is not None:
        # Case-insensitive RBAC scope match — twin of the Postgres
        # func.lower(Client.name) filter; keeps PG/BQ in parity.
        where.append("LOWER(name) IN UNNEST(@allowed)")
        params.append(_arr("allowed", "STRING", sorted({n.lower() for n in allowed_names})))
    params += [_p("limit", "INT64", limit), _p("skip", "INT64", skip)]
    rows = q(
        f"SELECT * FROM {DS}.editorial_raw_clients WHERE {' AND '.join(where)} "
        f"ORDER BY name, id LIMIT @limit OFFSET @skip",
        params,
    )
    ids = [r["id"] for r in rows]
    end_map: dict[int, date] = {}
    if ids:
        for r in q(
            f"""SELECT client_id, MAX(year * 100 + month) AS ym
                FROM {DS}.editorial_raw_production
                WHERE client_id IN UNNEST(@ids)
                  AND (articles_actual > 0 OR articles_projected > 0)
                GROUP BY client_id""",
            [_arr("ids", "INT64", ids)],
        ):
            y, m = divmod(int(r["ym"]), 100)
            end_map[r["client_id"]] = date(y, m, 1)
    for r in rows:
        r["operating_model_end_date"] = end_map.get(r["id"])
    return rows


# ──────────────────────────────────────────────────────────────────────────────
# /api/deliverables/, /api/kpis/, /api/team-members/, /api/migrate/editorial-weeks
# ──────────────────────────────────────────────────────────────────────────────


def list_deliverables(client_id, year, month, skip, limit) -> list[dict]:
    where, params = ["TRUE"], []
    if client_id is not None:
        where.append("client_id = @cid")
        params.append(_p("cid", "INT64", client_id))
    if year is not None:
        where.append("year = @y")
        params.append(_p("y", "INT64", year))
    if month is not None:
        where.append("month = @m")
        params.append(_p("m", "INT64", month))
    params += [_p("limit", "INT64", limit), _p("skip", "INT64", skip)]
    return q(
        f"SELECT * FROM {DS}.editorial_raw_deliverables WHERE {' AND '.join(where)} "
        f"ORDER BY year DESC, month DESC, id LIMIT @limit OFFSET @skip",
        params,
    )


def list_kpis(
    team_member_id,
    year,
    month,
    year_from,
    month_from,
    year_to,
    month_to,
    kpi_type,
    client_id,
    skip,
    limit,
) -> list[dict]:
    where, params = ["TRUE"], []
    if team_member_id is not None:
        where.append("team_member_id = @tm")
        params.append(_p("tm", "INT64", team_member_id))
    if year is not None:
        where.append("year = @y")
        params.append(_p("y", "INT64", year))
    if month is not None:
        where.append("month = @m")
        params.append(_p("m", "INT64", month))
    if kpi_type:
        where.append("kpi_type = @kt")
        params.append(_p("kt", "STRING", kpi_type))
    if client_id is not None:
        where.append("client_id = @cid")
        params.append(_p("cid", "INT64", client_id))
    if year_from is not None and month_from is not None:
        where.append("year * 100 + month >= @ord_from")
        params.append(_p("ord_from", "INT64", year_from * 100 + month_from))
    if year_to is not None and month_to is not None:
        where.append("year * 100 + month <= @ord_to")
        params.append(_p("ord_to", "INT64", year_to * 100 + month_to))
    params += [_p("limit", "INT64", limit), _p("skip", "INT64", skip)]
    return q(
        f"SELECT * FROM {DS}.editorial_raw_kpi_scores WHERE {' AND '.join(where)} "
        f"ORDER BY year DESC, month DESC, id LIMIT @limit OFFSET @skip",
        params,
    )


def list_team_members(role, pod, is_active, skip, limit) -> list[dict]:
    where, params = ["TRUE"], []
    if role:
        where.append("role = @role")
        params.append(_p("role", "STRING", role))
    if pod:
        where.append("pod = @pod")
        params.append(_p("pod", "STRING", pod))
    if is_active is not None:
        where.append("is_active = @act")
        params.append(_p("act", "BOOL", is_active))
    params += [_p("limit", "INT64", limit), _p("skip", "INT64", skip)]
    return q(
        f"SELECT * FROM {DS}.editorial_raw_team_members WHERE {' AND '.join(where)} "
        f"ORDER BY name, id LIMIT @limit OFFSET @skip",
        params,
    )


def list_editorial_weeks(year: int | None) -> list[dict]:
    where, params = "TRUE", []
    if year is not None:
        where = "year = @y"
        params = [_p("y", "INT64", year)]
    return q(
        f"SELECT * FROM {DS}.editorial_raw_calendar WHERE {where} "
        f"ORDER BY year, month, week_number",
        params,
    )


# ──────────────────────────────────────────────────────────────────────────────
# /api/goals-delivery/all + /cumulative
# ──────────────────────────────────────────────────────────────────────────────


def goals_all(pod: str | None) -> list[dict]:
    where, params = "TRUE", []
    if pod:
        where = "(growth_team_pod = @pod OR editorial_team_pod = @pod)"
        params = [_p("pod", "STRING", pod)]
    return q(
        f"SELECT * FROM {DS}.editorial_raw_goals WHERE {where} "
        f"ORDER BY month_year, week_number, client_name, id",
        params,
    )


def goals_cumulative(pod: str | None, status: str | None) -> list[dict]:
    where, params = ["TRUE"], []
    if pod:
        where.append("account_team_pod = @pod")
        params.append(_p("pod", "STRING", pod))
    if status:
        where.append("status = @status")
        params.append(_p("status", "STRING", status))
    return q(
        f"SELECT * FROM {DS}.editorial_raw_cumulative WHERE {' AND '.join(where)} "
        f"ORDER BY client_name, id",
        params,
    )


# ──────────────────────────────────────────────────────────────────────────────
# /api/dashboard/* — production-trend, client-production, pacing
# ──────────────────────────────────────────────────────────────────────────────


def production_trend() -> list[dict]:
    return q(
        f"""SELECT year, month,
                   COALESCE(SUM(articles_actual), 0) AS total_actual,
                   COALESCE(SUM(articles_projected), 0) AS total_projected,
                   is_actual
            FROM {DS}.editorial_raw_production
            GROUP BY year, month, is_actual
            ORDER BY year, month"""
    )


def client_production() -> list[dict]:
    clients = q(
        f"SELECT id, name, editorial_pod, articles_delivered, articles_sow "
        f"FROM {DS}.editorial_raw_clients ORDER BY name"
    )
    ph = q(
        f"SELECT client_id, year, month, articles_actual, articles_projected "
        f"FROM {DS}.editorial_raw_production"
    )
    ph_by: dict[int, list[dict]] = {}
    actual_tot: dict[int, int] = {}
    proj_tot: dict[int, int] = {}
    for r in ph:
        a = int(r["articles_actual"] or 0)
        p = int(r["articles_projected"] or 0)
        ph_by.setdefault(r["client_id"], []).append(
            {"year": int(r["year"]), "month": int(r["month"]), "actual": a, "projected": p}
        )
        actual_tot[r["client_id"]] = actual_tot.get(r["client_id"], 0) + a
        proj_tot[r["client_id"]] = proj_tot.get(r["client_id"], 0) + p
    out = []
    for c in clients:
        monthly = sorted(ph_by.get(c["id"], []), key=lambda m: (m["year"], m["month"]))
        delivered = actual_tot.get(c["id"], 0) or int(c["articles_delivered"] or 0)
        projected = proj_tot.get(c["id"], 0)
        sow = int(c["articles_sow"] or 0)
        if not monthly and sow == 0 and delivered == 0 and projected == 0:
            continue
        out.append(
            {
                "client_name": c["name"],
                "editorial_pod": c["editorial_pod"],
                "monthly": monthly,
                "totals": {
                    "projected": projected,
                    "delivered": delivered,
                    "sow": sow,
                    "reconciliation": sow - delivered - projected,
                },
            }
        )
    return out


def pacing() -> list[dict]:
    from dateutil.relativedelta import relativedelta

    from app.services.calculations import pacing_status

    clients = q(
        f"SELECT id, name, articles_sow, start_date FROM {DS}.editorial_raw_clients "
        f"WHERE status = 'ACTIVE' ORDER BY name"
    )
    templates = q(f"SELECT * FROM {DS}.editorial_raw_delivery_templates")
    tmpl_map: dict[int, dict[int, dict]] = {}
    for t in templates:
        tmpl_map.setdefault(t["sow_size"], {})[t["month_number"]] = t
    delivered_by = {
        r["client_id"]: int(r["s"] or 0)
        for r in q(
            f"SELECT client_id, COALESCE(SUM(articles_delivered), 0) AS s "
            f"FROM {DS}.editorial_raw_deliverables GROUP BY client_id"
        )
    }
    today = date.today()
    out = []
    sizes = sorted(tmpl_map.keys())
    for c in clients:
        sow = c["articles_sow"] or 0
        start = c["start_date"]
        if sow <= 0 or start is None or not sizes:
            continue
        closest = min(sizes, key=lambda s: abs(s - sow))
        delta = relativedelta(today, start)
        months = delta.years * 12 + delta.months + (1 if delta.days > 0 else 0)
        months = max(1, min(12, months))
        mt = tmpl_map[closest].get(months)
        expected = (mt.get("delivery_cumulative") or 0) if mt else 0
        actual = delivered_by.get(c["id"], 0)
        delta_pct = round((actual - expected) / expected * 100, 1) if expected > 0 else 0.0
        out.append(
            {
                "client_name": c["name"],
                "sow_size": sow,
                "months_elapsed": months,
                "actual_cumulative": actual,
                "expected_cumulative": expected,
                "delta_pct": delta_pct,
                "status": pacing_status(actual, expected),
            }
        )
    return out


# ──────────────────────────────────────────────────────────────────────────────
# /api/capacity/* — served from the int tables (already endpoint-identical)
# ──────────────────────────────────────────────────────────────────────────────

_MEMBER_COLS = (
    "pod, role, member, capacity, matched, articles, pct_allocation, "
    "pct_distribution, projected_used, actual_used, pct_util_real, "
    "pct_util_weighted, pod_total_capacity, pod_total_articles, "
    "pod_projected_raw, pod_actual_raw, pod_projected_weighted, "
    "pod_actual_weighted, pod_util_projected_weighted, pod_util_actual_weighted"
)


def capacity_pod_summary() -> list[dict]:
    return q(
        f"SELECT year, month, pod, version, total_capacity, projected_used_capacity, "
        f"actual_used_capacity FROM {DS}.v_editorial_fct_capacity_pods "
        f"ORDER BY year, month, pod"
    )


def member_utilization(year: int, month: int) -> list[dict]:
    rows = q(
        f"SELECT {_MEMBER_COLS} FROM {DS}.v_editorial_fct_member_utilization "
        f"WHERE year = @y AND month = @m",
        [_p("y", "INT64", year), _p("m", "INT64", month)],
    )
    rows.sort(key=lambda r: (r["pod"], -(r["capacity"] or 0), r["member"]))
    return rows


def member_utilization_matrix() -> list[dict]:
    rows = q(f"SELECT year, month, {_MEMBER_COLS} FROM {DS}.v_editorial_fct_member_utilization")
    months = sorted({(r["year"], r["month"]) for r in rows})
    out: list[dict] = []
    for ym in months:
        chunk = [r for r in rows if (r["year"], r["month"]) == ym]
        chunk.sort(key=lambda r: (r["pod"], -(r["capacity"] or 0), r["member"]))
        out.extend(chunk)
    return out


def client_contributions(year: int, month: int) -> list[dict]:
    rows = q(
        f"SELECT pod, client_id, client_name, category, weight, projected_raw, "
        f"actual_raw, projected_weighted, actual_weighted "
        f"FROM {DS}.v_editorial_fct_client_contributions WHERE year = @y AND month = @m",
        [_p("y", "INT64", year), _p("m", "INT64", month)],
    )
    rows.sort(key=lambda r: (r["pod"], -r["actual_raw"], r["client_name"]))
    return rows


# ──────────────────────────────────────────────────────────────────────────────
# /api/articles/monthly + /editors
# ──────────────────────────────────────────────────────────────────────────────


def _normalize_pod(raw: str) -> str:
    t = str(raw).strip()
    digits = "".join(ch for ch in t if ch.isdigit())
    return f"Pod {int(digits)}" if digits else t


def _article_where(pod_col: str, date_from, date_to, pod, client_list, editor_list):
    where, params = ["TRUE"], []
    if date_from:
        where.append("month_year >= @df")
        params.append(_p("df", "STRING", date_from))
    if date_to:
        where.append("month_year <= @dt")
        params.append(_p("dt", "STRING", date_to))
    if pod and pod.lower() != "all":
        if pod.lower() in ("unassigned", "(none)", "none"):
            where.append(f"{pod_col} IS NULL")
        else:
            where.append(f"{pod_col} = @pod")
            params.append(_p("pod", "STRING", _normalize_pod(pod)))
    if client_list:
        where.append("client_name IN UNNEST(@clients)")
        params.append(_arr("clients", "STRING", client_list))
    if editor_list:
        where.append("editor_name IN UNNEST(@editors)")
        params.append(_arr("editors", "STRING", editor_list))
    return " AND ".join(where), params


def articles_monthly(date_from, date_to, pod, pod_axis, client_list, editor_list) -> dict:
    pod_col = "growth_pod" if pod_axis == "growth" else "editorial_pod"
    where, params = _article_where(pod_col, date_from, date_to, pod, client_list, editor_list)
    creation = q(
        f"""SELECT month_year, IFNULL({pod_col}, 'Unassigned') AS pod, client_name,
                   editor_name, SUM(count) AS count, SUM(revised) AS revised,
                   SUM(second_reviews) AS second_reviews,
                   SUM(published) AS published, SUM(published_revised) AS published_revised,
                   SUM(matched) AS matched
            FROM {DS}.v_editorial_fct_articles_monthly WHERE {where}
            GROUP BY month_year, pod, client_name, editor_name""",
        params,
    )
    revisions = q(
        f"""SELECT month_year, IFNULL({pod_col}, 'Unassigned') AS pod, client_name,
                   editor_name, SUM(revisions) AS revisions
            FROM {DS}.v_editorial_fct_article_revisions WHERE {where}
            GROUP BY month_year, pod, client_name, editor_name""",
        params,
    )
    return {"creation": creation, "revisions": revisions}


def articles_editors() -> list[dict]:
    # NOTE: reads RAW (not int) — the live endpoint counts ALL article rows,
    # including NULL-month ones the int tables exclude.
    return [
        {"name": r["editor_name"], "count": r["count"]}
        for r in q(
            f"SELECT editor_name, COUNT(*) AS count FROM {DS}.editorial_raw_articles "
            f"GROUP BY editor_name ORDER BY count DESC, editor_name"
        )
    ]


# ──────────────────────────────────────────────────────────────────────────────
# /api/ai-monitoring/*
# ──────────────────────────────────────────────────────────────────────────────


def _ai_where(pod=None, client=None, month=None, writer=None, editor=None):
    where, params = ["is_rewrite = FALSE"], []
    if pod:
        where.append("pod = @pod")
        params.append(_p("pod", "STRING", pod))
    if client:
        where.append("client = @client")
        params.append(_p("client", "STRING", client))
    if month:
        where.append("month = @month")
        params.append(_p("month", "STRING", month))
    if writer:
        where.append("writer_name = @writer")
        params.append(_p("writer", "STRING", writer))
    if editor:
        where.append("editor_name = @editor")
        params.append(_p("editor", "STRING", editor))
    return " AND ".join(where), params


_AI_AGG = (
    "COUNT(*) AS total, "
    "COUNTIF(recommendation = 'FULL_PASS') AS full_pass, "
    "COUNTIF(recommendation = 'PARTIAL_PASS') AS partial_pass, "
    "COUNTIF(recommendation = 'REVIEW_REWRITE') AS review_rewrite"
)


def ai_summary(pod, client, month, writer, editor) -> dict:
    where, params = _ai_where(pod, client, month, writer, editor)
    r = q(f"SELECT {_AI_AGG} FROM {DS}.editorial_raw_ai_monitoring WHERE {where}", params)[0]
    total = r["total"] or 0
    fp, pp, rr = r["full_pass"] or 0, r["partial_pass"] or 0, r["review_rewrite"] or 0
    return {
        "total": total,
        "full_pass": fp,
        "partial_pass": pp,
        "review_rewrite": rr,
        "full_pass_rate": round(fp / total * 100, 1) if total > 0 else 0,
        "partial_pass_rate": round(pp / total * 100, 1) if total > 0 else 0,
        "review_rewrite_rate": round(rr / total * 100, 1) if total > 0 else 0,
    }


def _ai_breakdown(
    group_col: str,
    order: str,
    limit: int | None,
    month: str | None = None,
    pod: str | None = None,
    skip_empty: bool = False,
) -> list[dict]:
    where, params = _ai_where(pod=pod, month=month)
    if skip_empty:
        where += f" AND {group_col} IS NOT NULL AND {group_col} != ''"
    lim = f" LIMIT {int(limit)}" if limit else ""
    return [
        {
            "name": r["name"],
            "total": r["total"],
            "full_pass": r["full_pass"],
            "partial_pass": r["partial_pass"],
            "review_rewrite": r["review_rewrite"],
        }
        for r in q(
            f"SELECT {group_col} AS name, {_AI_AGG} FROM {DS}.editorial_raw_ai_monitoring "
            f"WHERE {where} GROUP BY {group_col} ORDER BY {order}{lim}",
            params,
        )
    ]


def ai_by_pod(month):
    return _ai_breakdown("pod", "name", None, month=month)


def ai_by_client(pod, month, limit):
    return _ai_breakdown("client", "total DESC, name", limit, month=month, pod=pod)


def ai_by_writer(pod, month, limit):
    return _ai_breakdown(
        "writer_name", "total DESC, name", limit, month=month, pod=pod, skip_empty=True
    )


def ai_by_month(pod=None, client=None):
    # Lexical text ordering — replicates the live endpoint (bug register B10).
    where, params = _ai_where(pod=pod, client=client)
    where += " AND month IS NOT NULL AND month != ''"
    return [
        {
            "name": r["name"],
            "total": r["total"],
            "full_pass": r["full_pass"],
            "partial_pass": r["partial_pass"],
            "review_rewrite": r["review_rewrite"],
        }
        for r in q(
            f"SELECT month AS name, {_AI_AGG} FROM {DS}.editorial_raw_ai_monitoring "
            f"WHERE {where} GROUP BY month ORDER BY name",
            params,
        )
    ]


def ai_flags(pod, client, limit: int, offset: int) -> list[dict]:
    where, params = ["is_flagged = TRUE"], []
    if pod:
        where.append("pod = @pod")
        params.append(_p("pod", "STRING", pod))
    if client:
        where.append("client = @client")
        params.append(_p("client", "STRING", client))
    params += [_p("lim", "INT64", limit), _p("off", "INT64", offset)]
    return q(
        f"SELECT * FROM {DS}.editorial_raw_ai_monitoring WHERE {' AND '.join(where)} "
        f"ORDER BY date_processed DESC NULLS FIRST, id LIMIT @lim OFFSET @off",
        params,
    )


def ai_rewrites(client, limit: int, offset: int) -> list[dict]:
    where, params = ["is_rewrite = TRUE"], []
    if client:
        where.append("client = @client")
        params.append(_p("client", "STRING", client))
    params += [_p("lim", "INT64", limit), _p("off", "INT64", offset)]
    return q(
        f"SELECT * FROM {DS}.editorial_raw_ai_monitoring WHERE {' AND '.join(where)} "
        f"ORDER BY date_processed DESC NULLS FIRST, id LIMIT @lim OFFSET @off",
        params,
    )


def surfer_usage() -> list[dict]:
    return q(f"SELECT * FROM {DS}.editorial_raw_surfer_usage ORDER BY id")
