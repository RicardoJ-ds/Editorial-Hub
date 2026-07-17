-- v_editorial_production_committed — editorial_raw_production with Hub-flagged
-- FORECAST client-months removed.
--
-- The planning hub (editorial-team-pods) owns the client-grain forecast and
-- flags speculative future months (unconfirmed renewals, what-ifs) with
-- `is_forecast = TRUE` on its published table `editorial_capacity_plan_demand`
-- (grain ym × pod × client_id). Those months must NOT reach the Editorial-Hub
-- PRODUCTION/OM surfaces (Production History chart, client-production timeline,
-- client end-date), which read `editorial_raw_production` directly.
--
-- This view is a thin, null-safe filter over the raw production mirror:
--   • LEFT JOIN — a client-month with no demand row keeps `is_forecast` NULL,
--     COALESCE(...,FALSE) keeps it (never drops a row the hub didn't flag).
--   • LOGICAL_OR over (client_id, ym) — a client is one editorial pod/month, but
--     the demand table is keyed by pod; collapse to one flag per client-month so
--     the join can't fan out rows.
--   • Only rows explicitly flagged is_forecast=TRUE are dropped.
-- `editorial_raw_production` stays a faithful sheet mirror (untouched); the
-- forecast boundary lives here. Standalone / always-live (applied like
-- v_editorial_roster, NOT part of the warehouse publish) because it reads a
-- hub-published table outside this ETL's publish cycle. Rollback = repoint the
-- bq_dashboard.py reads back to editorial_raw_production.
--
-- Scope: PRODUCTION/OM only. The Current-Q on-track variance is
-- Delivered-vs-Invoiced-sourced (contract invoicing) and is intentionally NOT
-- filtered here — an unconfirmed renewal is never in the contracted invoicing.

CREATE OR REPLACE VIEW `graphite-data.graphite_bi_sandbox.v_editorial_production_committed` AS
SELECT p.*
FROM `graphite-data.graphite_bi_sandbox.editorial_raw_production` p
LEFT JOIN (
  SELECT client_id, ym, LOGICAL_OR(is_forecast) AS is_forecast
  FROM `graphite-data.graphite_bi_sandbox.editorial_capacity_plan_demand`
  GROUP BY client_id, ym
) d
  ON d.client_id = p.client_id
  AND d.ym = FORMAT('%04d-%02d', p.year, p.month)
WHERE COALESCE(d.is_forecast, FALSE) = FALSE;
