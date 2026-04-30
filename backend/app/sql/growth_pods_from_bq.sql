  SELECT
    a.*,
    b.Client_Name AS client_name,
    b.Pod AS growth_pod
  FROM `graphite-data.graphite_bi_sandbox.team_pod_assignments` a
  LEFT JOIN `graphite-data.graphite_bi.salesforce_int_Account` b
    ON a.account_id = b.AccountId