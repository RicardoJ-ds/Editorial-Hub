"""Postgres sink — the SAME processed warehouse tables, materialized in the
app's database (schema `warehouse`).

Architecture decision (Ricardo, 2026-06-11): the app serves from Postgres
(operational speed, ~10ms reads), while BigQuery stays the always-fresh
analytics mirror + backup for other projects. Drift is impossible by
construction: each publish computes the processed rows ONCE in memory and
writes them to BOTH sinks.

What lands in Postgres:
- every `editorial_int_*` table (the processed layer — all business rules
  applied), plus the canonical-enriched raws (`editorial_raw_clients`,
  `editorial_raw_articles`, `editorial_raw_name_mappings`) whose extra columns
  don't exist on the operational tables.
- the consumption views, translated to Postgres SQL. Views over plain raw
  topics point at the OPERATIONAL tables (public schema) — duplicating those
  into `warehouse` would be Postgres-into-Postgres copying for nothing.
"""

from __future__ import annotations

import logging

from sqlalchemy import text

logger = logging.getLogger(__name__)

SCHEMA = "warehouse"

# Which publish jobs ALSO land in Postgres (everything else raw = already an
# operational table).
PG_TABLES_PREFIXES = ("editorial_int_",)
PG_TABLES_EXACT = {
    "editorial_raw_clients",
    "editorial_raw_articles",
    "editorial_raw_name_mappings",
}


def sinks_to_pg(table: str) -> bool:
    return table.startswith(PG_TABLES_PREFIXES) or table in PG_TABLES_EXACT


_PG_TYPE = {
    "INTEGER": "BIGINT",
    "INT64": "BIGINT",
    "FLOAT": "DOUBLE PRECISION",
    "FLOAT64": "DOUBLE PRECISION",
    "BOOLEAN": "BOOLEAN",
    "BOOL": "BOOLEAN",
    "DATE": "DATE",
    "TIMESTAMP": "TIMESTAMPTZ",
    "STRING": "TEXT",
}


def ensure_schema(engine) -> None:
    with engine.begin() as cx:
        cx.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}"))


def write_table(engine, name: str, rows: list[dict], schema_fields) -> int:
    """Full-replace one warehouse table in Postgres (mirrors WRITE_TRUNCATE).
    CASCADE drops dependent views — create_pg_views() recreates them right
    after the table loads in the same publish."""
    cols = [(f.name, _PG_TYPE.get(f.field_type, "TEXT")) for f in schema_fields]
    col_ddl = ", ".join(f'"{n}" {t}' for n, t in cols)
    col_names = ", ".join(f'"{n}"' for n, _ in cols)
    with engine.begin() as cx:
        cx.execute(text(f'DROP TABLE IF EXISTS {SCHEMA}."{name}" CASCADE'))
        cx.execute(text(f'CREATE TABLE {SCHEMA}."{name}" ({col_ddl})'))
        if rows:
            # JSONB/dict/list payloads were already serialized for BQ shapes;
            # serialize any stragglers the same way.
            import json as _json

            clean = []
            for r in rows:
                clean.append(tuple(
                    _json.dumps(v, ensure_ascii=False, default=str)
                    if isinstance(v := r.get(n), (dict, list)) else v
                    for n, _t in cols
                ))
            # execute_values batches multi-row INSERTs — textual executemany
            # would be one round-trip PER ROW (minutes against Neon for the
            # 13k-row tables).
            from psycopg2.extras import execute_values

            raw = cx.connection.dbapi_connection
            with raw.cursor() as cur:
                execute_values(
                    cur,
                    f'INSERT INTO {SCHEMA}."{name}" ({col_names}) VALUES %s',
                    clean,
                    page_size=1000,
                )
    return len(rows)


# ──────────────────────────────────────────────────────────────────────────────
# Consumption views, translated BQ → Postgres dialect.
# Raw-topic references map to the operational tables (public schema); the
# canonical-enriched raws + every int table live in `warehouse`.
# ──────────────────────────────────────────────────────────────────────────────

W = SCHEMA

PG_VIEWS: list[tuple[str, str]] = [
    ("v_editorial_dim_client", f"""
SELECT id AS client_id, name AS client_name, status, editorial_pod, growth_pod,
       start_date, end_date, term_months, cadence,
       cadence_q1, cadence_q2, cadence_q3, cadence_q4,
       articles_sow, articles_delivered, articles_invoiced,
       word_count_min, word_count_max, project_type,
       consulting_ko_date, editorial_ko_date, first_cb_approved_date,
       first_article_delivered_date, first_feedback_date, first_article_published_date,
       managing_director, account_director, account_manager,
       sf_client_name, sf_account_id, sf_match_status, synced_at
FROM {W}.editorial_raw_clients"""),
    ("v_editorial_dim_member", """
SELECT id AS member_id, name, role, pod, is_active, monthly_capacity, email
FROM public.team_members"""),
    ("v_editorial_dim_calendar", """
SELECT year, month, week_number, start_date, end_date FROM public.editorial_weeks"""),
    ("v_editorial_fct_client_q_snapshot",
     f"SELECT * FROM {W}.editorial_int_client_q_snapshot"),
    ("v_editorial_fct_client_months",
     f"SELECT * FROM {W}.editorial_int_client_months"),
    ("v_editorial_fct_pod_snapshot", f"""
WITH base AS (
  SELECT s.*, pod_axis,
         CASE pod_axis WHEN 'editorial' THEN COALESCE(s.editorial_pod, 'Unassigned')
                       ELSE COALESCE(s.growth_pod, 'Unassigned') END AS pod
  FROM {W}.editorial_int_client_q_snapshot s
  CROSS JOIN unnest(ARRAY['editorial', 'growth']) AS pod_axis
)
SELECT pod_axis, pod, as_of_date,
       COUNT(*) AS client_count,
       COUNT(*) FILTER (WHERE ovr_tier = 'new') AS new_count,
       SUM(CASE WHEN ovr_q_label IS NOT NULL AND ovr_q_invoiced > 0 THEN ovr_q_delivered ELSE 0 END) AS q_actual_delivered,
       SUM(CASE WHEN ovr_q_label IS NOT NULL AND ovr_q_invoiced > 0 THEN ovr_q_projected_end ELSE 0 END) AS q_projected_end,
       SUM(CASE WHEN ovr_q_label IS NOT NULL AND ovr_q_invoiced > 0 THEN ovr_q_invoiced ELSE 0 END) AS q_invoiced,
       SUM(CASE WHEN ovr_q_label IS NOT NULL AND ovr_q_invoiced > 0 AND ovr_tier != 'new'
                THEN ovr_q_projected_end - ovr_q_invoiced ELSE 0 END) AS q_variance_excl_new,
       SUM(lifetime_delivered) AS lifetime_delivered,
       SUM(lifetime_invoiced) AS lifetime_invoiced,
       SUM(articles_sow) AS articles_sow,
       SUM(published_live) AS published_live
FROM base
GROUP BY pod_axis, pod, as_of_date"""),
    ("v_editorial_fct_goals_monthly",
     f"SELECT * FROM {W}.editorial_int_goals_month_ct"),
    ("v_editorial_fct_goals_client_totals", f"""
WITH cm AS (
  SELECT client_name, month_year,
         SUM(w_cb_goal) AS cb_goal, SUM(w_cb_delivered) AS cb_del,
         SUM(w_ad_goal) AS ad_goal, SUM(w_ad_delivered) AS ad_del
  FROM {W}.editorial_int_goals_month_ct
  GROUP BY client_name, month_year
)
SELECT client_name,
       SUM(CASE WHEN cb_goal > 0 THEN cb_goal ELSE 0 END) AS cb_goal,
       SUM(CASE WHEN cb_goal > 0 THEN cb_del ELSE 0 END) AS cb_delivered,
       SUM(CASE WHEN ad_goal > 0 THEN ad_goal ELSE 0 END) AS ad_goal,
       SUM(CASE WHEN ad_goal > 0 THEN ad_del ELSE 0 END) AS ad_delivered
FROM cm
GROUP BY client_name"""),
    ("v_editorial_fct_production_monthly", """
SELECT p.client_id, c.name AS client_name, c.editorial_pod, c.growth_pod,
       p.year, p.month, p.articles_actual, p.articles_projected,
       p.projected_original, p.is_actual
FROM public.production_history p
LEFT JOIN public.clients c ON c.id = p.client_id"""),
    ("v_editorial_fct_pipeline", """
SELECT cm.client_name, c.id AS client_id, c.editorial_pod, c.growth_pod,
       c.articles_sow,
       cm.topics_sent, cm.topics_approved,
       cm.cbs_sent, cm.cbs_approved,
       cm.articles_sent, cm.articles_approved, cm.articles_difference,
       cm.published_live, cm.status AS sheet_status
FROM public.cumulative_metrics cm
LEFT JOIN public.clients c ON c.name = cm.client_name"""),
    ("v_editorial_fct_milestone_transitions", """
SELECT client_id, client_name, editorial_pod, growth_pod, transition, days FROM (
  SELECT id AS client_id, name AS client_name, editorial_pod, growth_pod,
         t.transition,
         CASE t.transition
           WHEN 'cko_eko' THEN (editorial_ko_date - consulting_ko_date)
           WHEN 'cko_cb' THEN (first_cb_approved_date - consulting_ko_date)
           WHEN 'cko_art' THEN (first_article_delivered_date - consulting_ko_date)
           WHEN 'cko_fb' THEN (first_feedback_date - consulting_ko_date)
           WHEN 'cb_art' THEN (first_article_delivered_date - first_cb_approved_date)
           WHEN 'cko_pub' THEN (first_article_published_date - consulting_ko_date)
           WHEN 'art_fb' THEN (first_feedback_date - first_article_delivered_date)
           WHEN 'fb_pub' THEN (first_article_published_date - first_feedback_date)
         END AS days
  FROM public.clients
  CROSS JOIN unnest(ARRAY['cko_eko','cko_cb','cko_art','cko_fb','cb_art','cko_pub','art_fb','fb_pub']) AS t(transition)
) x
WHERE days IS NOT NULL"""),
    ("v_editorial_fct_kpi_scores", """
SELECT k.team_member_id, tm.name AS member_name, tm.role, tm.pod,
       k.year, k.month, k.kpi_type, k.score, k.target, k.client_id
FROM public.kpi_scores k
LEFT JOIN public.team_members tm ON tm.id = k.team_member_id"""),
    ("v_editorial_fct_pod_assignments",
     f"SELECT * FROM {W}.editorial_int_pod_assignments "
     "WHERE pod_kind = 'editorial' AND role != 'writer'"),
    ("v_editorial_fct_capacity_pods",
     f"SELECT * FROM {W}.editorial_int_capacity_pod_months"),
    ("v_editorial_fct_member_utilization",
     f"SELECT * FROM {W}.editorial_int_member_months"),
    ("v_editorial_fct_client_contributions",
     f"SELECT * FROM {W}.editorial_int_client_pod_months"),
    ("v_editorial_fct_articles_monthly",
     f"SELECT * FROM {W}.editorial_int_articles_creation"),
    ("v_editorial_fct_article_revisions",
     f"SELECT * FROM {W}.editorial_int_articles_revisions"),
    ("v_editorial_fct_ai_recommendations", """
SELECT pod, client, writer_name, editor_name, month,
       CASE WHEN month ~ '^(January|February|March|April|May|June|July|August|September|October|November|December) [0-9]{4}$'
            THEN to_date(month, 'FMMonth YYYY') END AS month_date,
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE recommendation = 'FULL_PASS') AS full_pass,
       COUNT(*) FILTER (WHERE recommendation = 'PARTIAL_PASS') AS partial_pass,
       COUNT(*) FILTER (WHERE recommendation = 'REVIEW_REWRITE') AS review_rewrite
FROM public.ai_monitoring_records
WHERE is_rewrite = FALSE
GROUP BY pod, client, writer_name, editor_name, month"""),
    ("v_editorial_fct_ai_flagged", """
SELECT * FROM public.ai_monitoring_records
WHERE is_flagged = TRUE OR is_rewrite = TRUE"""),
]


def create_pg_views(engine) -> list[str]:
    created = []
    with engine.begin() as cx:
        for name, sql in PG_VIEWS:
            cx.execute(text(f'DROP VIEW IF EXISTS {SCHEMA}."{name}"'))
            cx.execute(text(f'CREATE VIEW {SCHEMA}."{name}" AS {sql}'))
            created.append(name)
    return created
