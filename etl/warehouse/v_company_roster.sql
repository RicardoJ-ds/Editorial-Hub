-- v_company_roster — ALL-COMPANY member roster (the superset of v_editorial_roster).
--
-- Same union + canonicalization recipe as v_editorial_roster, but WITHOUT the
-- editor-title filter and WITHOUT the editorial exclusions — so it covers every
-- member you might pick in a dropdown:
--   1. ALL Rippling employees   (v_headcount, every department)   -> role editor/sr_editor if an
--                                                                    editor title, else 'employee'
--   2. Slack writer contractors (slack_raw_users, ext.writing)    -> role 'writer'
--   3. Legacy bucket            (name-map editorial canonicals not in 1/2)
--
-- Names canonicalised via editorial_name_map (editors/writers only; non-editorial
-- employees pass through with their clean Rippling name). Grain = one row per
-- (canonical_name, role) — a person who is both a Rippling employee AND a Slack
-- writer appears once per role; SELECT DISTINCT canonical_name for a flat list.
--
-- `is_editorial` = role IN (editor, sr_editor, writer) — the editorial subset.
-- NOTE: editorial exclusions are NOT applied here (they demote wrongly-titled
-- people from the EDITORIAL roster; here everyone who is a real employee/writer
-- appears). For the curated editorial roster (exclusions applied) use
-- v_editorial_roster — which is unchanged. Always-live view.
CREATE OR REPLACE VIEW `graphite-data.graphite_bi_sandbox.v_company_roster` AS
WITH
nm AS (
  SELECT kind, raw_value, canonical_value
  FROM `graphite-data.graphite_bi_sandbox.editorial_name_map`
  WHERE canonical_value IS NOT NULL AND TRIM(canonical_value) != ''
),
employees AS (
  SELECT
    h.employee_name AS raw_name,
    CASE
      WHEN LOWER(h.title) LIKE '%editor%' AND (
        h.title_trimmed LIKE 'Sr.%' OR h.title_trimmed LIKE '%Lead%'
        OR h.title_trimmed LIKE '%Director%' OR h.title_trimmed LIKE '%VP%')
        THEN 'sr_editor'
      WHEN LOWER(h.title) LIKE '%editor%' THEN 'editor'
      ELSE 'employee'
    END AS role,
    'rippling' AS source,
    CAST(h.worker_id AS STRING) AS source_id,
    h.slack_id AS slack_id,
    h.work_email AS work_email,
    h.title AS title,
    h.department AS department,
    CASE WHEN h.is_active THEN 'active' ELSE 'terminated' END AS status,
    h.start_date AS hire_date,
    h.termination_date AS term_date
  FROM `graphite-data.graphite_bi_sandbox.v_headcount` h
  WHERE h.is_present_dated
),
writers AS (
  SELECT
    COALESCE(
      NULLIF(TRIM(JSON_VALUE(u.profile, '$.real_name')), ''),
      CASE WHEN LOWER(TRIM(u.real_name)) IN ('nan', 'null', 'none', '') THEN NULL ELSE TRIM(u.real_name) END
    ) AS raw_name,
    'writer' AS role,
    'slack' AS source,
    u.id AS source_id,
    u.id AS slack_id,
    JSON_VALUE(u.profile, '$.email') AS work_email,
    CAST(NULL AS STRING) AS title,
    'Editorial (Writer)' AS department,
    CASE WHEN u.deleted THEN 'inactive' ELSE 'active' END AS status,
    CAST(NULL AS DATE) AS hire_date,
    CAST(NULL AS DATE) AS term_date
  FROM `graphite-data.graphite_bi.slack_raw_users` u
  WHERE JSON_VALUE(u.profile, '$.email') LIKE '%@ext.writing.graphitehq.com'
    AND u.is_bot = FALSE
),
headcount AS (
  SELECT * FROM employees
  UNION ALL
  SELECT * FROM writers
),
resolved AS (
  SELECT
    COALESCE(nm.canonical_value, h.raw_name) AS canonical_name,
    h.role, h.source, h.source_id, h.slack_id, h.work_email, h.title, h.department,
    h.status, h.hire_date, h.term_date
  FROM headcount h
  LEFT JOIN nm
    ON nm.raw_value = h.raw_name
   AND ((h.role = 'writer' AND nm.kind = 'writer')
     OR (h.role IN ('editor', 'sr_editor') AND nm.kind = 'editor'))
),
nm_canon AS (
  SELECT DISTINCT
    CASE WHEN kind = 'writer' THEN 'writer' ELSE 'editor' END AS role,
    canonical_value AS canonical_name
  FROM nm
  WHERE kind IN ('writer', 'editor')
),
legacy AS (
  SELECT
    nc.canonical_name, nc.role, 'legacy' AS source,
    CAST(NULL AS STRING) AS source_id, CAST(NULL AS STRING) AS slack_id,
    CAST(NULL AS STRING) AS work_email, CAST(NULL AS STRING) AS title,
    CAST(NULL AS STRING) AS department,
    'inactive' AS status, CAST(NULL AS DATE) AS hire_date, CAST(NULL AS DATE) AS term_date
  FROM nm_canon nc
  WHERE NOT EXISTS (
    SELECT 1 FROM resolved r
    WHERE r.canonical_name = nc.canonical_name
      AND ((r.role = 'writer') = (nc.role = 'writer'))
  )
),
allrows AS (
  SELECT * FROM resolved
  UNION ALL
  SELECT * FROM legacy
)
SELECT
  canonical_name,
  role,
  role IN ('editor', 'sr_editor', 'writer') AS is_editorial,
  source, source_id, slack_id, work_email, title, department, status,
  (status = 'active') AS is_active,
  hire_date, term_date
FROM allrows a
WHERE canonical_name IS NOT NULL AND TRIM(canonical_name) != ''
  AND LOWER(TRIM(canonical_name)) NOT IN ('nan', 'none', 'null', '#n/a', '#ref!')
  AND NOT REGEXP_CONTAINS(canonical_name, r'^[0-9.]+$')
