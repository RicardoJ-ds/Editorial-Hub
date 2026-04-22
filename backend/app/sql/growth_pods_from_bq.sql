-- Growth Pod → client mapping, sourced from BigQuery.
--
-- Joins `team_pod_assignments` (one row per member assignment, append-only)
-- with the Salesforce account mirror to attach the canonical Client_Name and
-- Pod. For each display_name we keep only the most recent assignment row
-- (created_at = last_created_at), so a member who moved pods shows only
-- their current pod.
--
-- The app reads the distinct (client_name, growth_pod) pairs from this
-- result set and upserts them onto `clients.growth_pod` by name match.
--
-- Source tables:
--   graphite-data.graphite_bi_sandbox.team_pod_assignments
--   graphite-data.graphite_bi.salesforce_int_Account

WITH __growth_pods AS (
  SELECT
    a.*,
    b.Client_Name,
    b.Pod,
    MAX(created_at) OVER (PARTITION BY display_name) AS last_created_at
  FROM `graphite-data.graphite_bi_sandbox.team_pod_assignments` a
  LEFT JOIN `graphite-data.graphite_bi.salesforce_int_Account` b
    ON a.account_id = b.AccountId
)
SELECT
  display_name      AS member_name,
  client_name,
  pod               AS growth_pod,
  created_at        AS last_created_at,
  role,
  sr_growth_director,
  growth_director
FROM __growth_pods
WHERE created_at = last_created_at
ORDER BY pod, display_name, created_at
