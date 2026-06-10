"""ETL manifest — the declarative plan, mirroring the app's sync-scope model.

INGEST delegates to `app.services.sync_manifest` (current / past / full — the
same steps the SYNC button and Re-sync Past Months run; never re-hardcoded
here). PUBLISH declares every dashboard-feeding table → BigQuery, the
canonical-column transform it gets, plus the computed marts and the mapping
review tables. Adding a new origin = one ManifestStep in the app's
sync_manifest (ingest follows automatically) + one TABLES entry here if a new
destination table appears.

Excluded from publish (app state, not sheet-derived dashboard data):
access_* (RBAC), overview_comments / client comments, usage_events (telemetry),
audit_log.
"""

from __future__ import annotations

from dataclasses import dataclass

from app import models as m


@dataclass(frozen=True)
class TableSpec:
    model: type
    bq_name: str
    transform: str | None = None  # key into transform-fn registry in run.py


# Every dashboard-feeding Postgres table, published 1:1 (+ canonical columns).
TABLES: list[TableSpec] = [
    TableSpec(m.Client, "editorial_clients", transform="client_canonicals"),
    TableSpec(m.DeliverableMonthly, "editorial_deliverables_monthly"),
    TableSpec(m.TeamMember, "editorial_team_members"),
    TableSpec(m.CapacityProjection, "editorial_capacity_projections"),
    TableSpec(m.EditorialMemberCapacity, "editorial_member_capacity"),
    TableSpec(m.KpiScore, "editorial_kpi_scores"),
    TableSpec(m.ModelAssumption, "editorial_model_assumptions"),
    TableSpec(m.ProductionHistory, "editorial_production_history"),
    TableSpec(m.PodAssignment, "editorial_pod_assignments"),
    TableSpec(m.EditorialWeek, "editorial_week_distribution"),
    TableSpec(m.DeliveryTemplate, "editorial_delivery_templates"),
    TableSpec(m.EngagementRule, "editorial_engagement_rules"),
    TableSpec(m.AIMonitoringRecord, "editorial_ai_monitoring_records"),
    TableSpec(m.SurferAPIUsage, "editorial_surfer_api_usage"),
    TableSpec(m.CumulativeMetric, "editorial_cumulative_metrics"),
    TableSpec(m.GoalsVsDelivery, "editorial_goals_vs_delivery"),
    TableSpec(m.NotionArticle, "editorial_notion_articles"),
    TableSpec(m.ClientPodHistory, "editorial_client_pod_history"),
    TableSpec(m.IncompleteClient, "editorial_incomplete_clients"),
    TableSpec(m.ArticleRecord, "editorial_articles", transform="article_canonicals"),
    TableSpec(m.ArticleRevision, "editorial_article_revisions"),
    TableSpec(m.ArticleNameAlias, "editorial_article_name_aliases"),
    TableSpec(m.ClientNameAlias, "editorial_client_name_aliases"),
    TableSpec(m.ArticleUnmappedName, "editorial_article_unmapped_names"),
    TableSpec(m.PodImportIssue, "editorial_pod_import_issues"),
    TableSpec(m.PodNameOverride, "editorial_pod_name_overrides"),
    TableSpec(m.SheetSyncHistory, "editorial_sheet_sync_history"),
]

# Canonical columns appended per transform key (name, BQ type).
TRANSFORM_EXTRA_COLUMNS: dict[str, list[tuple[str, str]]] = {
    "client_canonicals": [
        ("sf_client_name", "STRING"),
        ("sf_account_id", "STRING"),
        ("sf_match_status", "STRING"),
    ],
    "article_canonicals": [
        ("editor_canonical", "STRING"),
        ("editor_match_status", "STRING"),
        ("writer_canonical", "STRING"),
        ("writer_match_status", "STRING"),
    ],
}

# Computed marts (explicit schemas live in run.py next to their builders).
MARTS = [
    "editorial_capacity_pod",
    "editorial_capacity_member_utilization",
    "editorial_capacity_client_contributions",
    "editorial_articles_monthly",
    "editorial_revisions_monthly",
    "editorial_month_basis",
]

MAPPING_TABLES = [
    "editorial_map_editors",
    "editorial_map_clients",
    "editorial_map_writers",
]


def ingest_plan(scope: str) -> list[dict]:
    """The ordered ingest steps for a scope — straight from the app's sync
    manifest (single source of truth)."""
    from app.services.sync_manifest import resolve_plan

    return resolve_plan(scope)
