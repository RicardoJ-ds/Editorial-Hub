"""Consumption views — the dashboard read contract (`v_editorial_dim_/fct_*`).

House rule (audited): consumers read VIEWS, never tables. Each view maps 1:1 to
a dashboard surface; every number it exposes is final (already weighted /
classified / collapsed upstream). Column basis is labeled where two month
definitions coexist (calendar vs editorial).
"""

from __future__ import annotations

from app.config import settings

DS = f"`{settings.bq_project}.{settings.bq_dataset}`"


def _v(name: str, sql: str) -> tuple[str, str]:
    return name, f"CREATE OR REPLACE VIEW {DS}.{name} AS\n{sql}"


VIEWS: list[tuple[str, str]] = [
    # ── dims ────────────────────────────────────────────────────────────────
    _v(
        "v_editorial_dim_client",
        f"""
SELECT
  id AS client_id, name AS client_name, status, editorial_pod, growth_pod,
  start_date, end_date, term_months, cadence,
  cadence_q1, cadence_q2, cadence_q3, cadence_q4,
  articles_sow, articles_delivered, articles_invoiced,
  word_count_min, word_count_max, project_type,
  consulting_ko_date, editorial_ko_date, first_cb_approved_date,
  first_article_delivered_date, first_feedback_date, first_article_published_date,
  managing_director, account_director, account_manager,
  sf_client_name, sf_account_id, sf_match_status, synced_at
FROM {DS}.editorial_raw_clients
""",
    ),
    _v(
        "v_editorial_dim_member",
        f"SELECT id AS member_id, name, role, pod, is_active, monthly_capacity, email, synced_at FROM {DS}.editorial_raw_team_members",
    ),
    _v(
        "v_editorial_dim_calendar",
        f"""
SELECT year, month, week_number, start_date, end_date, synced_at
FROM {DS}.editorial_raw_calendar
""",
    ),
    # ── delivery / variance (Overview Pod Snapshot + D1 cards) ─────────────
    _v(
        "v_editorial_fct_client_q_snapshot",
        f"SELECT * FROM {DS}.editorial_int_client_q_snapshot",
    ),
    _v(
        "v_editorial_fct_client_months",
        f"SELECT * FROM {DS}.editorial_int_client_months",
    ),
    _v(
        "v_editorial_fct_pod_snapshot",
        f"""
-- Pod rows of the Overview Pod Snapshot, on BOTH pod axes. Audited rules:
-- delivered/invoiced/projected_end sums INCLUDE 1st-Q clients; the variance sum
-- EXCLUDES them (they're counted in new_count instead). Clients with no
-- current Q or invoiced <= 0 are excluded from Q sums entirely.
WITH base AS (
  SELECT s.*, pod_axis,
         CASE pod_axis WHEN 'editorial' THEN COALESCE(s.editorial_pod, 'Unassigned')
                       ELSE COALESCE(s.growth_pod, 'Unassigned') END AS pod
  FROM {DS}.editorial_int_client_q_snapshot s
  CROSS JOIN UNNEST(['editorial', 'growth']) AS pod_axis
)
SELECT
  pod_axis, pod, as_of_date,
  COUNT(*) AS client_count,
  COUNTIF(ovr_tier = 'new') AS new_count,
  SUM(IF(ovr_q_label IS NOT NULL AND ovr_q_invoiced > 0, ovr_q_delivered, 0)) AS q_actual_delivered,
  SUM(IF(ovr_q_label IS NOT NULL AND ovr_q_invoiced > 0, ovr_q_projected_end, 0)) AS q_projected_end,
  SUM(IF(ovr_q_label IS NOT NULL AND ovr_q_invoiced > 0, ovr_q_invoiced, 0)) AS q_invoiced,
  SUM(IF(ovr_q_label IS NOT NULL AND ovr_q_invoiced > 0 AND ovr_tier != 'new',
         ovr_q_projected_end - ovr_q_invoiced, 0)) AS q_variance_excl_new,
  SUM(lifetime_delivered) AS lifetime_delivered,
  SUM(lifetime_invoiced) AS lifetime_invoiced,
  SUM(articles_sow) AS articles_sow,
  SUM(published_live) AS published_live
FROM base
GROUP BY pod_axis, pod, as_of_date
""",
    ),
    # ── goals ───────────────────────────────────────────────────────────────
    _v(
        "v_editorial_fct_goals_monthly",
        f"""
-- Client × month × content_type after max-of-week + contentTypeRatio weighting.
-- Raw and weighted measures both exposed (popovers show raw; pod bars weighted).
-- Month basis: the sheet's "Month Year" label (calendar-anchored editorial tabs).
SELECT * FROM {DS}.editorial_int_goals_month_ct
""",
    ),
    _v(
        "v_editorial_fct_goals_client_totals",
        f"""
-- Step-3 of the goals aggregation IN SQL: per client, month totals are gated
-- on that month's weighted goal > 0 (independently for CB and AD) — exactly
-- aggregateGoalsSummary. Summing the monthly view directly would overcount
-- whenever a client-month has deliveries but no goal in that dimension.
WITH cm AS (
  SELECT client_name, month_year,
         SUM(w_cb_goal) AS cb_goal, SUM(w_cb_delivered) AS cb_del,
         SUM(w_ad_goal) AS ad_goal, SUM(w_ad_delivered) AS ad_del
  FROM {DS}.editorial_int_goals_month_ct
  GROUP BY client_name, month_year
)
SELECT client_name,
       SUM(IF(cb_goal > 0, cb_goal, 0)) AS cb_goal,
       SUM(IF(cb_goal > 0, cb_del, 0)) AS cb_delivered,
       SUM(IF(ad_goal > 0, ad_goal, 0)) AS ad_goal,
       SUM(IF(ad_goal > 0, ad_del, 0)) AS ad_delivered
FROM cm
GROUP BY client_name
""",
    ),
    # ── production ──────────────────────────────────────────────────────────
    _v(
        "v_editorial_fct_production_monthly",
        f"""
SELECT
  p.client_id, c.name AS client_name, c.editorial_pod, c.growth_pod,
  p.year, p.month, p.articles_actual, p.articles_projected,
  p.projected_original, p.projected_comment, p.is_actual, p.synced_at
FROM {DS}.editorial_raw_production p
LEFT JOIN {DS}.editorial_raw_clients c ON c.id = p.client_id
""",
    ),
    # ── pipeline ────────────────────────────────────────────────────────────
    _v(
        "v_editorial_fct_pipeline",
        f"""
-- Stage field choices (audited): Topics/CBs = approved; Articles = SENT
-- (billable on delivery); Published = published_live. articles_approved kept
-- for the approval-rate matrix.
-- editorial_raw_cumulative now carries one row per (client, content_type); we
-- roll up to one row per client applying content-type weighting (article x1,
-- jumbo x2, glossary/LP x0.5 -- same factors as Goals vs Delivery). EXCEPTION:
-- Webflow is summed RAW (x1 for every type) because its per-type figures are
-- already converted to article-equivalents at the source (see the sheet notes:
-- "116 ADs = 462 glossary terms", jumbo already in AD units).
SELECT
  cm.client_name, ANY_VALUE(c.id) AS client_id,
  ANY_VALUE(c.editorial_pod) AS editorial_pod, ANY_VALUE(c.growth_pod) AS growth_pod,
  ANY_VALUE(c.articles_sow) AS articles_sow,
  CAST(ROUND(SUM(cm.topics_sent     * cm.w)) AS INT64) AS topics_sent,
  CAST(ROUND(SUM(cm.topics_approved * cm.w)) AS INT64) AS topics_approved,
  CAST(ROUND(SUM(cm.cbs_sent        * cm.w)) AS INT64) AS cbs_sent,
  CAST(ROUND(SUM(cm.cbs_approved    * cm.w)) AS INT64) AS cbs_approved,
  CAST(ROUND(SUM(cm.articles_sent   * cm.w)) AS INT64) AS articles_sent,
  CAST(ROUND(SUM(cm.articles_approved * cm.w)) AS INT64) AS articles_approved,
  CAST(ROUND(SUM(cm.articles_sent * cm.w) - SUM(cm.articles_approved * cm.w)) AS INT64) AS articles_difference,
  CAST(ROUND(SUM(cm.published_live  * cm.w)) AS INT64) AS published_live,
  ANY_VALUE(cm.status) AS sheet_status, MAX(cm.synced_at) AS synced_at
FROM (
  SELECT *,
    CASE
      WHEN client_name = 'Webflow' THEN 1.0
      WHEN LOWER(content_type) = 'jumbo' THEN 2.0
      WHEN LOWER(content_type) IN ('lp', 'landing page', 'landing pages', 'glossary') THEN 0.5
      ELSE 1.0
    END AS w
  FROM {DS}.editorial_raw_cumulative
) cm
LEFT JOIN {DS}.editorial_raw_clients c ON c.name = cm.client_name
GROUP BY cm.client_name
""",
    ),
    # ── milestones / TTM ────────────────────────────────────────────────────
    _v(
        "v_editorial_fct_milestone_transitions",
        f"""
-- The 8 audited transitions, calendar-day diffs (negatives INCLUDED — the
-- stats-card filters days >= 0 at read time; timelines include them. Bug B5.)
WITH c AS (SELECT * FROM {DS}.editorial_raw_clients)
SELECT client_id, client_name, editorial_pod, growth_pod, transition, days FROM (
  SELECT id AS client_id, name AS client_name, editorial_pod, growth_pod,
         transition,
         CASE transition
           WHEN 'cko_eko' THEN DATE_DIFF(editorial_ko_date, consulting_ko_date, DAY)
           WHEN 'cko_cb' THEN DATE_DIFF(first_cb_approved_date, consulting_ko_date, DAY)
           WHEN 'cko_art' THEN DATE_DIFF(first_article_delivered_date, consulting_ko_date, DAY)
           WHEN 'cko_fb' THEN DATE_DIFF(first_feedback_date, consulting_ko_date, DAY)
           WHEN 'cb_art' THEN DATE_DIFF(first_article_delivered_date, first_cb_approved_date, DAY)
           WHEN 'cko_pub' THEN DATE_DIFF(first_article_published_date, consulting_ko_date, DAY)
           WHEN 'art_fb' THEN DATE_DIFF(first_feedback_date, first_article_delivered_date, DAY)
           WHEN 'fb_pub' THEN DATE_DIFF(first_article_published_date, first_feedback_date, DAY)
         END AS days
  FROM c
  CROSS JOIN UNNEST(['cko_eko','cko_cb','cko_art','cko_fb','cb_art','cko_pub','art_fb','fb_pub']) AS transition
)
WHERE days IS NOT NULL
""",
    ),
    # ── KPI scores ──────────────────────────────────────────────────────────
    _v(
        "v_editorial_fct_kpi_scores",
        f"""
SELECT k.team_member_id, tm.name AS member_name, tm.role, tm.pod,
       k.year, k.month, k.kpi_type, k.score, k.target, k.client_id, k.synced_at
FROM {DS}.editorial_raw_kpi_scores k
LEFT JOIN {DS}.editorial_raw_team_members tm ON tm.id = k.team_member_id
""",
    ),
    # ── capacity ────────────────────────────────────────────────────────────
    _v(
        "v_editorial_fct_pod_assignments",
        # The backfill surface for the editorial-team-pods Hub: resolved
        # per-month staffing, editorial only. Writer rows excluded (free-text
        # blobs — canonical writer history is the article log); pod_member
        # rows kept (generic membership) and distinguishable via `role`.
        # writers included since 2026-06-12: normalized in the int layer
        # (dictionary blob-split + 1:1 plausibility-guarded emails); filter
        # out confidence='unparsed' if you want only fully-identified people.
        f"SELECT * FROM {DS}.editorial_int_pod_assignments "
        "WHERE pod_kind = 'editorial'",
    ),
    _v(
        "v_editorial_fct_capacity_pods",
        f"SELECT * FROM {DS}.editorial_int_capacity_pod_months",
    ),
    _v(
        "v_editorial_fct_member_utilization",
        f"SELECT * FROM {DS}.editorial_int_member_months",
    ),
    _v(
        "v_editorial_fct_client_contributions",
        f"SELECT * FROM {DS}.editorial_int_client_pod_months",
    ),
    # ── monthly articles ────────────────────────────────────────────────────
    _v(
        "v_editorial_fct_articles_monthly",
        f"""
-- Editorial-month basis (creation month). Editor-credit grain; both pod axes.
SELECT * FROM {DS}.editorial_int_articles_creation
""",
    ),
    _v(
        "v_editorial_fct_article_revisions",
        f"""
-- Editorial-month basis (each revision's OWN month).
SELECT * FROM {DS}.editorial_int_articles_revisions
""",
    ),
    # ── AI compliance ───────────────────────────────────────────────────────
    _v(
        "v_editorial_fct_ai_recommendations",
        f"""
-- Recommendation counts at (pod × client × writer × month) grain; every tab
-- rollup is a SUM over this. Rewrites EXCLUDED (audited rule); month kept as
-- the source text AND parsed to a date for chronological order (bug B10:
-- the live UI orders lexically — readers replicating today's chart must
-- ORDER BY month (text)).
SELECT
  pod, client, writer_name, editor_name, month,
  SAFE.PARSE_DATE('%B %Y', month) AS month_date,
  COUNT(*) AS total,
  COUNTIF(recommendation = 'FULL_PASS') AS full_pass,
  COUNTIF(recommendation = 'PARTIAL_PASS') AS partial_pass,
  COUNTIF(recommendation = 'REVIEW_REWRITE') AS review_rewrite
FROM {DS}.editorial_raw_ai_monitoring
WHERE is_rewrite = FALSE
GROUP BY pod, client, writer_name, editor_name, month
""",
    ),
    _v(
        "v_editorial_fct_ai_flagged",
        f"""
SELECT * FROM {DS}.editorial_raw_ai_monitoring
WHERE is_flagged = TRUE OR is_rewrite = TRUE
""",
    ),
]


def create_views(bq) -> list[str]:
    from concurrent.futures import ThreadPoolExecutor

    def _one(v):
        name, ddl = v
        bq.query(ddl).result()
        return name

    with ThreadPoolExecutor(max_workers=8) as ex:
        return list(ex.map(_one, VIEWS))
