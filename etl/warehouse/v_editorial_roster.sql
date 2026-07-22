-- v_editorial_roster — single source of truth for the editorial roster.
--
-- Unions all editorial headcount and carries the source IDs so the roster is
-- reproducible (no hand-maintained list):
--   1. Rippling editors  (v_headcount, title LIKE '%editor%')  -> worker_id + slack_id
--   2. Slack writers     (slack_raw_users, ext.writing email)  -> slack id
--   3. Legacy bucket     (confirmed name-map canonicals not in 1/2) -> historical people
--
-- `work_email` is the CANONICAL identity email, projected from each row's own
-- source: editors -> Rippling `v_headcount.work_email` (@graphitehq.com),
-- writers -> the Slack `ext.writing` mailbox that is the writer filter criterion
-- itself (so it is never null for an active writer). Legacy rows have none.
-- This is the address downstream consumers (editorial-team-pods Planning Hub
-- roster picker) should DISPLAY -- do NOT fall back to the pod-sheet email, which
-- carries writers' personal gmail. Match/identity key stays `canonical_name`
-- (or `slack_id`), so re-emailing a person can never re-key their assignments.
--
-- Names are canonicalised via editorial_name_map (so the roster matches the same
-- normalization applied to the article log), and rows are filtered by the
-- DaniQ-editable editorial_roster_exclusions table — that is how someone who
-- shows up in Rippling/Slack but is NOT actually an editor/writer is removed
-- permanently (e.g. a "Editorial Lead" title who never edited). The Apps Script
-- roster_refresh materialises this into the master Roster tab -> MAC dropdowns.
--
-- Always-live VIEW: recomputes from its sources on every read, so the roster
-- auto-tracks Rippling/Slack/name-map/exclusion changes with no populate job.
CREATE OR REPLACE VIEW `graphite-data.graphite_bi_sandbox.v_editorial_roster` AS
WITH
nm AS (
  SELECT kind, raw_value, canonical_value, LOWER(TRIM(status)) AS status
  FROM `graphite-data.graphite_bi_sandbox.editorial_name_map`
  WHERE canonical_value IS NOT NULL AND TRIM(canonical_value) != ''
),
-- role-aware: a blank role excludes the person from every role; a specific role
-- (editor/sr_editor/writer) excludes only that role. So "Miles is a writer, not an
-- editor" = one row {Miles Forrester, editor} drops the editor row, keeps the writer.
excl AS (
  SELECT DISTINCT LOWER(TRIM(name)) AS k, LOWER(TRIM(IFNULL(role, ''))) AS r
  FROM `graphite-data.graphite_bi_sandbox.editorial_roster_exclusions`
  WHERE name IS NOT NULL AND TRIM(name) != ''
),
editors AS (
  SELECT
    h.employee_name AS raw_name,
    CASE
      WHEN h.title_trimmed LIKE 'Sr.%' OR h.title_trimmed LIKE '%Lead%'
        OR h.title_trimmed LIKE '%Director%' OR h.title_trimmed LIKE '%VP%'
      THEN 'sr_editor' ELSE 'editor'
    END AS role,
    'rippling' AS source,
    CAST(h.worker_id AS STRING) AS source_id,
    h.slack_id AS slack_id,
    h.work_email AS work_email,
    CASE WHEN h.is_active THEN 'active' ELSE 'terminated' END AS status,
    h.start_date AS hire_date,
    h.termination_date AS term_date
  FROM `graphite-data.graphite_bi_sandbox.v_headcount` h
  WHERE LOWER(h.title) LIKE '%editor%' AND h.is_present_dated
),
-- Slack scrubs the top-level real_name to the literal 'nan' when an account is
-- DEACTIVATED, but keeps the real name in profile.real_name -- so prefer the profile
-- name (this recovers terminated writers, which the top-level column drops as 'nan').
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
    CASE WHEN u.deleted THEN 'inactive' ELSE 'active' END AS status,
    CAST(NULL AS DATE) AS hire_date,
    CAST(NULL AS DATE) AS term_date
  FROM `graphite-data.graphite_bi.slack_raw_users` u
  WHERE JSON_VALUE(u.profile, '$.email') LIKE '%@ext.writing.graphitehq.com'
    AND u.is_bot = FALSE
),
headcount AS (
  SELECT * FROM editors
  UNION ALL
  SELECT * FROM writers
),
resolved AS (
  SELECT
    COALESCE(nm.canonical_value, h.raw_name) AS canonical_name,
    h.role, h.source, h.source_id, h.slack_id, h.work_email, h.status, h.hire_date, h.term_date
  FROM headcount h
  LEFT JOIN nm
    ON nm.raw_value = h.raw_name
   AND ((h.role = 'writer' AND nm.kind = 'writer')
     OR (h.role IN ('editor', 'sr_editor') AND nm.kind = 'editor'))
),
nm_canon AS (
  -- one row per (role, canonical). A canonical is an ACTIVE synthetic bucket when
  -- ANY of its name-map rows is flagged STATUS='active' (e.g. "Backlog",
  -- "Auditioning Writer") -- that is how a not-a-real-person entry still shows in
  -- the ACTIVE writer/editor dropdowns. Everything else stays inactive (legacy).
  SELECT
    CASE WHEN kind = 'writer' THEN 'writer' ELSE 'editor' END AS role,
    canonical_value AS canonical_name,
    LOGICAL_OR(status = 'active') AS is_active_bucket
  FROM nm
  WHERE kind IN ('writer', 'editor')
  GROUP BY 1, 2
),
legacy AS (
  SELECT
    nc.canonical_name, nc.role, 'legacy' AS source,
    CAST(NULL AS STRING) AS source_id, CAST(NULL AS STRING) AS slack_id,
    CAST(NULL AS STRING) AS work_email,
    CASE WHEN nc.is_active_bucket THEN 'active' ELSE 'inactive' END AS status,
    CAST(NULL AS DATE) AS hire_date, CAST(NULL AS DATE) AS term_date
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
  canonical_name, role, source, source_id, slack_id, work_email, status, hire_date, term_date,
  (status = 'active') AS is_active
FROM allrows a
WHERE canonical_name IS NOT NULL AND TRIM(canonical_name) != ''
  AND LOWER(TRIM(canonical_name)) NOT IN ('nan', 'none', 'null', '#n/a', '#ref!')
  AND NOT REGEXP_CONTAINS(canonical_name, r'^[0-9.]+$')
  AND NOT EXISTS (
    SELECT 1 FROM excl e
    WHERE e.k = LOWER(TRIM(a.canonical_name))
      AND (e.r = '' OR e.r = a.role OR (e.r = 'editor' AND a.role = 'sr_editor'))
  )
