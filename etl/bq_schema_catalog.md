# BQ schema catalog — `graphite-data.graphite_bi_sandbox` (editorial warehouse)

**Auto-generated** by `etl/gen_bq_schema_catalog.py` — do not hand-edit. Re-run after adding/renaming a table or view in `etl/warehouse/build.py` / `views.py`.

- **Dataset:** `graphite-data.graphite_bi_sandbox` (everything is `graphite-data.graphite_bi_sandbox.<name>`)
- **Generated:** 2026-07-05 19:47:45 UTC
- **Source:** live BigQuery `INFORMATION_SCHEMA`
- **Inventory:** 38 tables · 21 views · 886 columns

> **Read the `v_editorial_*` views** for anything with business math applied (variance, weighting, utilization). `editorial_raw_*` = faithful sheet mirrors; `editorial_int_*` = where the math is computed (the intermediate values a capacity model wants). Every published row carries `synced_at` (the publish timestamp).

## RAW — source-sheet mirrors (`editorial_raw_*`)

| Name | Grain | Rows | Fresh (synced_at) | Purpose / key columns |
|---|---|---:|---|---|
| `editorial_raw_ai_monitoring` | one row per monitored article | 3,372 | 2026-07-05 19:45:51 UTC | AI compliance monitoring records<br>`id`, `pod`, `writer_name`, `editor_name`, `date_processed`, `month`, `updated_at`, `client` … |
| `editorial_raw_article_revisions` | one row per revision | 3,896 | 2026-07-05 19:45:51 UTC | revision events<br>`id`, `article_uid`, `client_name`, `editor_name`, `writer_name`, `editorial_pod`, `growth_pod`, `revision_date` … |
| `editorial_raw_articles` | article × editor | 16,148 | 2026-07-05 19:45:51 UTC | article log; collaborations explode per editor<br>`id`, `article_uid`, `client_name`, `client_id`, `editor_name`, `writer_name`, `editorial_pod`, `growth_pod` … |
| `editorial_raw_calendar` | year × month × week | 52 | 2026-07-05 19:45:51 UTC | editorial calendar weeks<br>`id`, `year`, `month`, `start_date`, `end_date`, `updated_at`, `week_number`, `created_at` |
| `editorial_raw_capacity` | pod × month × version | 305 | 2026-07-05 19:45:51 UTC | capacity projection inputs<br>`id`, `pod`, `year`, `month`, `updated_at`, `updated_by`, `total_capacity`, `projected_used_capacity` … |
| `editorial_raw_capacity_members` | member × month | 417 | 2026-07-05 19:45:51 UTC | per-member capacity inputs<br>`id`, `year`, `month`, `pod`, `role`, `updated_at`, `slot`, `member_raw` … |
| `editorial_raw_client_pod_history` | client × month | 513 | 2026-07-05 19:45:51 UTC | historical editorial-pod assignment per client<br>`id`, `client_id`, `client_name_raw`, `year`, `month`, `editorial_pod`, `updated_at`, `category` … |
| `editorial_raw_clients` | one row per client | 84 | 2026-07-05 19:45:51 UTC | client master + SF identity + pods<br>`id`, `name`, `status`, `growth_pod`, `editorial_pod`, `start_date`, `end_date`, `term_months` … |
| `editorial_raw_cumulative` | one row per client | 52 | 2026-07-05 19:45:51 UTC | lifetime pipeline counters (topics/CBs/articles/published)<br>`id`, `status`, `account_team_pod`, `client_name`, `last_update`, `updated_at`, `client_type`, `content_type` … |
| `editorial_raw_deliverables` | client × month | 631 | 2026-07-05 19:45:51 UTC | delivered / invoiced / sow_target per month<br>`id`, `client_id`, `year`, `month`, `updated_at`, `updated_by`, `articles_sow_target`, `articles_delivered` … |
| `editorial_raw_delivery_templates` | delivery template rows | 60 | 2026-07-05 19:45:51 UTC | pacing templates (fetched, currently unrendered)<br>`id`, `month_number`, `sow_size`, `invoicing_target`, `invoicing_cumulative`, `delivery_target`, `delivery_cumulative`, `created_at` |
| `editorial_raw_goals` | client × month × week × content_type | 2,212 | 2026-07-05 19:45:51 UTC | goals-vs-delivery weekly rows<br>`id`, `month_year`, `week_date`, `client_name`, `growth_team_pod`, `editorial_team_pod`, `cb_delivered_to_date`, `cb_monthly_goal` … |
| `editorial_raw_kpi_scores` | member × month × kpi_type | 1,481 | 2026-07-05 19:45:51 UTC | KPI scores vs target<br>`id`, `team_member_id`, `year`, `month`, `client_id`, `updated_at`, `updated_by`, `kpi_type` … |
| `editorial_raw_model_assumptions` | model assumption rows | 14 | 2026-07-05 19:45:51 UTC | always-on capacity model assumptions<br>`id`, `updated_at`, `category`, `key`, `value`, `description` |
| `editorial_raw_name_mappings` | kind × raw_name | 471 | 2026-07-05 19:45:51 UTC | editor/writer/client name → canonical dictionary<br>`kind`, `raw_name`, `canonical_name`, `status`, `note` |
| `editorial_raw_pod_history` | year × month × kind × pod × client × role × person | 17,184 | 2026-07-05 19:45:51 UTC | raw per-month staffing history (editorial + growth)<br>`id`, `year`, `month`, `pod_kind`, `pod_number`, `client_name`, `role`, `display_name` … |
| `editorial_raw_production` | client × month | 4,424 | 2026-07-05 19:45:51 UTC | actual vs projected article production<br>`id`, `client_id`, `year`, `month`, `updated_at`, `articles_actual`, `articles_projected`, `projected_original` … |
| `editorial_raw_surfer_usage` | Surfer API usage rows | 25 | 2026-07-05 19:45:51 UTC | Surfer SEO API usage<br>`id`, `year_month`, `start_date`, `end_date`, `pod_1`, `pod_2`, `pod_3`, `pod_4` … |
| `editorial_raw_team_members` | one row per team member | 12 | 2026-07-05 19:45:51 UTC | roster (name, role, pod, capacity, email)<br>`id`, `name`, `role`, `pod`, `monthly_capacity`, `updated_at`, `is_active`, `email` … |

## INT — computed intermediates (`editorial_int_*`)

| Name | Grain | Rows | Fresh (synced_at) | Purpose / key columns |
|---|---|---:|---|---|
| `editorial_int_articles_creation` | editor × client × creation-month | 1,780 | 2026-07-05 19:45:51 UTC | monthly articles mart (editor credit)<br>`month_year`, `editorial_pod`, `growth_pod`, `client_name`, `editor_name`, `count`, `revised`, `second_reviews` … |
| `editorial_int_articles_revisions` | revision × month | 824 | 2026-07-05 19:45:51 UTC | monthly revisions mart<br>`month_year`, `editorial_pod`, `growth_pod`, `client_name`, `editor_name`, `revisions` |
| `editorial_int_capacity_pod_months` | pod × month × version | 105 | 2026-07-05 19:45:51 UTC | pod capacity mart (total / projected-used / actual-used)<br>`year`, `month`, `pod`, `version`, `total_capacity`, `projected_used_capacity`, `actual_used_capacity` |
| `editorial_int_client_months` | client × month | 4,425 | 2026-07-05 19:45:51 UTC | the variance brain: delivered/invoiced/sow + Overview & D1 period assignment<br>`client_id`, `client_name`, `year`, `month`, `ovr_period_idx`, `d1_period_idx`, `as_of_date`, `delivered` … |
| `editorial_int_client_pod_months` | client × pod × month | 425 | 2026-07-05 19:45:51 UTC | client contribution mart<br>`year`, `month`, `pod`, `client_id`, `client_name`, `sf_client_name`, `category`, `weight` … |
| `editorial_int_client_q_snapshot` | one row per client | 84 | 2026-07-05 19:45:51 UTC | lifetime + current-Q + last-full-Q variance on both Overview & D1 paths<br>`client_id`, `client_name`, `status`, `editorial_pod`, `growth_pod`, `ovr_q_month_in_q`, `d1_term_months`, `d1_q_month_in_q` … |
| `editorial_int_goals_month_ct` | client × month × content_type | 509 | 2026-07-05 19:45:51 UTC | weighted goals after max-of-week + contentTypeRatio<br>`client_name`, `month_year`, `content_type`, `ratio`, `cb_goal`, `cb_delivered`, `ad_goal`, `ad_delivered` … |
| `editorial_int_member_months` | member × month | 303 | 2026-07-05 19:45:51 UTC | member utilization mart<br>`year`, `month`, `pod`, `role`, `member_match_status`, `pod_total_capacity`, `pod_total_articles`, `pod_projected_raw` … |
| `editorial_int_pod_assignments` | year × month × kind × pod × client × role × person | 17,184 | 2026-07-05 19:45:51 UTC | resolved per-month staffing (editorial + growth) — the backfill surface<br>`year`, `month`, `pod_kind`, `pod`, `client_id`, `client_name`, `role`, `person_raw` … |

## VIEWS — public read contract (`v_editorial_*`)

| Name | Grain | Rows | Fresh (synced_at) | Purpose / key columns |
|---|---|---:|---|---|
| `v_editorial_dim_calendar` | year × month × week | 52 | 2026-07-05 19:45:51 UTC | calendar dim<br>`year`, `month`, `start_date`, `end_date`, `week_number` |
| `v_editorial_dim_client` | one row per client | 84 | 2026-07-05 19:45:51 UTC | client master + SF identity (public)<br>`client_id`, `client_name`, `status`, `editorial_pod`, `growth_pod`, `start_date`, `end_date`, `term_months` … |
| `v_editorial_dim_member` | one row per member | 12 | 2026-07-05 19:45:51 UTC | roster dim<br>`member_id`, `name`, `role`, `pod`, `monthly_capacity`, `is_active`, `email` |
| `v_editorial_fct_ai_flagged` | one row per flagged/rewrite article | 378 | 2026-07-05 19:45:51 UTC | AI flagged / rewrite records<br>`id`, `pod`, `writer_name`, `editor_name`, `date_processed`, `month`, `updated_at`, `client` … |
| `v_editorial_fct_ai_recommendations` | pod × client × writer × editor × month | 802 | — | AI recommendation counts (rewrites excluded)<br>`pod`, `writer_name`, `editor_name`, `month`, `month_date`, `client`, `total`, `full_pass` … |
| `v_editorial_fct_article_revisions` | revision × month | 824 | 2026-07-05 19:45:51 UTC | monthly revisions (each revision's own month)<br>`month_year`, `editorial_pod`, `growth_pod`, `client_name`, `editor_name`, `revisions` |
| `v_editorial_fct_articles_monthly` | editor × client × creation-month | 1,780 | 2026-07-05 19:45:51 UTC | monthly articles (editorial-month basis)<br>`month_year`, `editorial_pod`, `growth_pod`, `client_name`, `editor_name`, `count`, `revised`, `second_reviews` … |
| `v_editorial_fct_capacity_pods` | pod × month × version | 105 | 2026-07-05 19:45:51 UTC | pod capacity (public)<br>`year`, `month`, `pod`, `version`, `total_capacity`, `projected_used_capacity`, `actual_used_capacity` |
| `v_editorial_fct_client_contributions` | client × pod × month | 425 | 2026-07-05 19:45:51 UTC | client contribution (public)<br>`year`, `month`, `pod`, `client_id`, `client_name`, `sf_client_name`, `category`, `weight` … |
| `v_editorial_fct_client_months` | client × month | 4,425 | 2026-07-05 19:45:51 UTC | per-month delivery/variance detail<br>`client_id`, `client_name`, `year`, `month`, `ovr_period_idx`, `d1_period_idx`, `as_of_date`, `delivered` … |
| `v_editorial_fct_client_q_snapshot` | one row per client | 84 | 2026-07-05 19:45:51 UTC | delivery/variance snapshot (Overview + D1)<br>`client_id`, `client_name`, `status`, `editorial_pod`, `growth_pod`, `ovr_q_month_in_q`, `d1_term_months`, `d1_q_month_in_q` … |
| `v_editorial_fct_goals_client_totals` | one row per client | 76 | — | goal totals gated on weighted goal > 0<br>`client_name`, `cb_goal`, `cb_delivered`, `ad_goal`, `ad_delivered` |
| `v_editorial_fct_goals_monthly` | client × month × content_type | 509 | 2026-07-05 19:45:51 UTC | weighted goals (raw + weighted measures)<br>`client_name`, `month_year`, `content_type`, `ratio`, `cb_goal`, `cb_delivered`, `ad_goal`, `ad_delivered` … |
| `v_editorial_fct_kpi_scores` | member × month × kpi_type | 1,481 | 2026-07-05 19:45:51 UTC | KPI scores + member/role/pod<br>`team_member_id`, `member_name`, `role`, `pod`, `year`, `month`, `client_id`, `kpi_type` … |
| `v_editorial_fct_member_utilization` | member × month | 303 | 2026-07-05 19:45:51 UTC | member utilization (public)<br>`year`, `month`, `pod`, `role`, `member_match_status`, `pod_total_capacity`, `pod_total_articles`, `pod_projected_raw` … |
| `v_editorial_fct_milestone_transitions` | client × transition | 492 | — | 8 milestone transitions, calendar-day diffs<br>`client_id`, `client_name`, `editorial_pod`, `growth_pod`, `transition`, `days` |
| `v_editorial_fct_pipeline` | one row per client | 52 | 2026-07-05 19:45:51 UTC | pipeline counters (topics/CBs/articles/published)<br>`client_name`, `client_id`, `editorial_pod`, `growth_pod`, `sheet_status`, `articles_sow`, `topics_sent`, `topics_approved` … |
| `v_editorial_fct_pod_assignments` | year × month × pod × client × role × person | 2,407 | 2026-07-05 19:45:51 UTC | resolved editorial-only per-month staffing<br>`year`, `month`, `pod_kind`, `pod`, `client_id`, `client_name`, `role`, `person_raw` … |
| `v_editorial_fct_pod_snapshot` | pod_axis × pod | 15 | — | Overview Pod Snapshot rollup, both pod axes<br>`pod_axis`, `pod`, `as_of_date`, `client_count`, `new_count`, `q_actual_delivered`, `q_projected_end`, `q_invoiced` … |
| `v_editorial_fct_production_monthly` | client × month | 4,424 | 2026-07-05 19:45:51 UTC | production actual vs projected + pods<br>`client_id`, `client_name`, `editorial_pod`, `growth_pod`, `year`, `month`, `articles_actual`, `articles_projected` … |
| `v_editorial_roster` | one row per person × role | 140 | — | single-source editorial roster (Rippling editors + Slack writers + legacy); carries canonical work_email — DISPLAY this, key on canonical_name/slack_id<br>`canonical_name`, `role`, `source_id`, `slack_id`, `status`, `hire_date`, `term_date`, `source` … |

## HUB-PUBLISHED — written by the planning-hub app, not this ETL

| Name | Grain | Rows | Fresh (synced_at) | Purpose / key columns |
|---|---|---:|---|---|
| `editorial_capacity_plan` | ym × pod | 92 | — | published capacity plan: supply, projected/actual demand, utilization<br>`pod`, `ym`, `supply`, `projected_demand`, `actual_demand`, `util_projected`, `util_actual`, `source` … |
| `editorial_capacity_plan_demand` | ym × pod × client_id (NEGATIVE ids = planned/unsigned clients) | 1,017 | — | published per-client demand incl. Hub edits (note/status_override); joins on client_id drop planned rows<br>`pod`, `client_id`, `client_name`, `ym`, `articles`, `weight`, `projected_weighted`, `base_weighted` … |
| `editorial_capacity_plan_members` | ym × pod × member | 259 | — | published per-member capacity (base + effective)<br>`pod`, `role`, `ym`, `member`, `email`, `capacity`, `base_capacity`, `source` … |
| `editorial_writer_plan` | ym × writer | 1,032 | — | published writer bandwidth plan (computed/override/effective bw, allocated, delivered)<br>`override_bw`, `status`, `ym`, `writer`, `computed_bw`, `effective_bw`, `allocated`, `delivered` … |
| `editorial_writer_plan_allocations` | ym × writer × client | 0 | — | published writer→client article allocations<br>`client_id`, `client_name`, `ym`, `writer`, `articles`, `note`, `source`, `reason` … |
| `editorial_writer_plan_client_verticals` | one row per client | 32 | — | client vertical tags for writer matching<br>`client_id`, `client_name`, `sf_account_id`, `vertical_name`, `vertical`, `note`, `published_at` |
| `editorial_writer_plan_verticals` | writer × vertical | 144 | — | writer vertical skills/difficulty<br>`vertical_name`, `writer`, `vertical`, `vertical_group`, `difficulty`, `published_at` |
| `team_pod_assignments` | one row per assignment (growth, current) | 377 | — | growth Team-tab current assignments<br>`id`, `account_id`, `worker_id`, `display_name`, `role`, `slack_id`, `sr_growth_director_slack_id`, `growth_director_slack_id` … |
| `team_pod_assignments_editorial` | one row per assignment (editorial, current) | 117 | — | editorial Team-tab current assignments<br>`id`, `account_id`, `pod`, `client_name`, `worker_id`, `display_name`, `role`, `slack_id` … |
| `team_pod_assignments_editorial_history` | ym × pod × client × role × person (soft-delete via deleted_at) | 2,551 | — | canonical editorial assignment history — the Hub-first source this ETL reads (people-loop cutover 2026-06-12)<br>`pod`, `client_id`, `client_name`, `role`, `display_name`, `confidence`, `ym`, `email` … |

---

*Companion: `etl/handoff_planning_hub_capacity_data.md` (consumer guide with SQL recipes) and `etl/WAREHOUSE_DESIGN.md` (design + bug register). Grain/family come from `etl/warehouse/build.py` + `views.py`; columns/counts/freshness are live from BQ.*
