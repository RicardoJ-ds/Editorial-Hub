---
name: decision-2026-06-09-etl-bq-migration
description: Decision to move all ingestion + transforms + dashboard processing into a dedicated etl/ pipeline that lands canonical processed tables in BigQuery graphite_bi_sandbox.editorial_*; dashboard becomes a thin reader.
metadata: 
  node_type: memory
  type: project
  originSessionId: 16aec1b2-de33-466e-9e21-3d91480b6a82
---

# Decision — ETL → BigQuery migration (2026-06-09)

**Context:** ingestion (`backend/app/services/migration_service.py`, ~5.8k lines, 18
importers, 22 Postgres tables, ~40 transform helpers) PLUS dashboard-side processing
(capacity utilization, weighting, month bucketing, fuzzy joins) have accumulated many
manual mappings + data-quality caveats. Names aren't canonical.

**Decision (Ricardo):** build a dedicated **`etl/`** pipeline:
- **Extract** each spreadsheet → **Transform** with all current cleanups (lifted as pure
  functions) + **canonical name mapping** (editors→`v_team_pods_editorial.employee_name`,
  clients→`salesforce_int_Account.Client_Name`) → **Load** to BigQuery
  **`graphite_bi_sandbox.editorial_*`**.
- Dashboard then **only reads** BQ — no processing dashboard-side. Improve the ETL +
  origins; the dashboard just consumes.

**Why:** single processed source of truth, canonical names, kill duplication + the
in-dashboard math, make data quality auditable in one place.

**Approach:** phased, not big-bang — pattern ET CP end-to-end first, port transforms with
parity tests vs current Postgres, repoint dashboards one at a time behind a flag, then
decommission old importers. Full plan: `editorial-hub/etl/README.md`.

**Access:** SA key `sa-key.json` (`GOOGLE_APPLICATION_CREDENTIALS=/app/sa-key.json`),
project `graphite-data`, `google-cloud-bigquery`. **Do NOT use the BI Hub MCP** (Ricardo
disabled it for this work).

**Artifacts produced 2026-06-09** (in `etl/`): README (architecture/plan), ETL_INVENTORY
(what to port), NAME_MAPPINGS (dictionaries + ⚠️ unresolved), DATA_QUALITY_CAVEATS_for_DaniQ.

**Carries forward:** the capacity-utilization model ([[analysis_capacity_utilization]]) and
the month-definition finding ([[analysis_article_count_data_quality]]) become ETL/BQ
transforms/marts. Caveats + name decisions in [[now]] must be resolved with DaniQ before
the ETL applies the mappings.
