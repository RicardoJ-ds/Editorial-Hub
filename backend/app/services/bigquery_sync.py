"""BigQuery sync service — pushes PostgreSQL data to BigQuery (WRITE_TRUNCATE)."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import pandas as pd
from google.cloud import bigquery
from google.oauth2 import service_account
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import (
    AuditLog,
    CapacityProjection,
    Client,
    DeliverableMonthly,
    KpiScore,
    ModelAssumption,
    TeamMember,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# BQ table name → SQLAlchemy model mapping
# ---------------------------------------------------------------------------

TABLE_MODEL_MAP: dict[str, type] = {
    "editorial_hub_clients": Client,
    "editorial_hub_deliverables": DeliverableMonthly,
    "editorial_hub_team_members": TeamMember,
    "editorial_hub_capacity_plans": CapacityProjection,
    "editorial_hub_kpi_scores": KpiScore,
    "editorial_hub_model_assumptions": ModelAssumption,
    "editorial_hub_audit_log": AuditLog,
}

# ---------------------------------------------------------------------------
# BQ schema definitions (one per table)
# ---------------------------------------------------------------------------

BQ_SCHEMAS: dict[str, list[bigquery.SchemaField]] = {
    "editorial_hub_clients": [
        bigquery.SchemaField("id", "INTEGER", mode="REQUIRED"),
        bigquery.SchemaField("name", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("domain", "STRING"),
        bigquery.SchemaField("status", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("growth_pod", "STRING"),
        bigquery.SchemaField("editorial_pod", "STRING"),
        bigquery.SchemaField("start_date", "DATE"),
        bigquery.SchemaField("end_date", "DATE"),
        bigquery.SchemaField("term_months", "INTEGER"),
        bigquery.SchemaField("cadence", "STRING"),
        bigquery.SchemaField("cadence_q1", "INTEGER"),
        bigquery.SchemaField("cadence_q2", "INTEGER"),
        bigquery.SchemaField("cadence_q3", "INTEGER"),
        bigquery.SchemaField("cadence_q4", "INTEGER"),
        bigquery.SchemaField("articles_sow", "INTEGER"),
        bigquery.SchemaField("articles_delivered", "INTEGER"),
        bigquery.SchemaField("articles_invoiced", "INTEGER"),
        bigquery.SchemaField("articles_paid", "INTEGER"),
        bigquery.SchemaField("word_count_min", "INTEGER"),
        bigquery.SchemaField("word_count_max", "INTEGER"),
        bigquery.SchemaField("sow_link", "STRING"),
        bigquery.SchemaField("project_type", "STRING"),
        bigquery.SchemaField("consulting_ko_date", "DATE"),
        bigquery.SchemaField("editorial_ko_date", "DATE"),
        bigquery.SchemaField("first_cb_approved_date", "DATE"),
        bigquery.SchemaField("first_article_delivered_date", "DATE"),
        bigquery.SchemaField("first_feedback_date", "DATE"),
        bigquery.SchemaField("first_article_published_date", "DATE"),
        bigquery.SchemaField("managing_director", "STRING"),
        bigquery.SchemaField("account_director", "STRING"),
        bigquery.SchemaField("account_manager", "STRING"),
        bigquery.SchemaField("jr_am", "STRING"),
        bigquery.SchemaField("cs_team", "STRING"),
        bigquery.SchemaField("comments", "STRING"),
        bigquery.SchemaField("created_at", "TIMESTAMP"),
        bigquery.SchemaField("updated_at", "TIMESTAMP"),
        bigquery.SchemaField("updated_by", "STRING"),
    ],
    "editorial_hub_deliverables": [
        bigquery.SchemaField("id", "INTEGER", mode="REQUIRED"),
        bigquery.SchemaField("client_id", "INTEGER", mode="REQUIRED"),
        bigquery.SchemaField("year", "INTEGER", mode="REQUIRED"),
        bigquery.SchemaField("month", "INTEGER", mode="REQUIRED"),
        bigquery.SchemaField("articles_sow_target", "INTEGER"),
        bigquery.SchemaField("articles_delivered", "INTEGER"),
        bigquery.SchemaField("articles_invoiced", "INTEGER"),
        bigquery.SchemaField("content_briefs_delivered", "INTEGER"),
        bigquery.SchemaField("content_briefs_goal", "INTEGER"),
        bigquery.SchemaField("notes", "STRING"),
        bigquery.SchemaField("created_at", "TIMESTAMP"),
        bigquery.SchemaField("updated_at", "TIMESTAMP"),
        bigquery.SchemaField("updated_by", "STRING"),
    ],
    "editorial_hub_team_members": [
        bigquery.SchemaField("id", "INTEGER", mode="REQUIRED"),
        bigquery.SchemaField("name", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("role", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("pod", "STRING"),
        bigquery.SchemaField("is_active", "BOOLEAN"),
        bigquery.SchemaField("monthly_capacity", "INTEGER"),
        bigquery.SchemaField("email", "STRING"),
        bigquery.SchemaField("created_at", "TIMESTAMP"),
        bigquery.SchemaField("updated_at", "TIMESTAMP"),
    ],
    "editorial_hub_capacity_plans": [
        bigquery.SchemaField("id", "INTEGER", mode="REQUIRED"),
        bigquery.SchemaField("pod", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("year", "INTEGER", mode="REQUIRED"),
        bigquery.SchemaField("month", "INTEGER", mode="REQUIRED"),
        bigquery.SchemaField("total_capacity", "INTEGER"),
        bigquery.SchemaField("projected_used_capacity", "INTEGER"),
        bigquery.SchemaField("actual_used_capacity", "INTEGER"),
        bigquery.SchemaField("version", "STRING"),
        bigquery.SchemaField("notes", "STRING"),
        bigquery.SchemaField("created_at", "TIMESTAMP"),
        bigquery.SchemaField("updated_at", "TIMESTAMP"),
        bigquery.SchemaField("updated_by", "STRING"),
    ],
    "editorial_hub_kpi_scores": [
        bigquery.SchemaField("id", "INTEGER", mode="REQUIRED"),
        bigquery.SchemaField("team_member_id", "INTEGER", mode="REQUIRED"),
        bigquery.SchemaField("year", "INTEGER", mode="REQUIRED"),
        bigquery.SchemaField("month", "INTEGER", mode="REQUIRED"),
        bigquery.SchemaField("kpi_type", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("score", "FLOAT"),
        bigquery.SchemaField("target", "FLOAT"),
        bigquery.SchemaField("client_id", "INTEGER"),
        bigquery.SchemaField("notes", "STRING"),
        bigquery.SchemaField("created_at", "TIMESTAMP"),
        bigquery.SchemaField("updated_at", "TIMESTAMP"),
        bigquery.SchemaField("updated_by", "STRING"),
    ],
    "editorial_hub_model_assumptions": [
        bigquery.SchemaField("id", "INTEGER", mode="REQUIRED"),
        bigquery.SchemaField("category", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("key", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("value", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("description", "STRING"),
        bigquery.SchemaField("updated_at", "TIMESTAMP"),
    ],
    "editorial_hub_audit_log": [
        bigquery.SchemaField("id", "INTEGER", mode="REQUIRED"),
        bigquery.SchemaField("entity_type", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("entity_id", "INTEGER"),
        bigquery.SchemaField("action", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("changes_json", "STRING"),
        bigquery.SchemaField("performed_by", "STRING"),
        bigquery.SchemaField("performed_at", "TIMESTAMP"),
    ],
}

# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------


@dataclass
class SyncResult:
    table: str
    rows: int = 0
    success: bool = True
    error: str | None = None


@dataclass
class FullSyncResult:
    started_at: datetime = field(default_factory=datetime.utcnow)
    finished_at: datetime | None = None
    results: list[SyncResult] = field(default_factory=list)

    @property
    def all_ok(self) -> bool:
        return all(r.success for r in self.results)


# ---------------------------------------------------------------------------
# Client helper
# ---------------------------------------------------------------------------


def _get_bq_client() -> bigquery.Client:
    """Build an authenticated BigQuery client from the SA key file."""
    credentials = service_account.Credentials.from_service_account_file(
        settings.google_application_credentials,
        scopes=["https://www.googleapis.com/auth/bigquery"],
    )
    return bigquery.Client(
        project=settings.bq_project,
        credentials=credentials,
    )


# ---------------------------------------------------------------------------
# Table creation
# ---------------------------------------------------------------------------


def create_bq_tables() -> list[str]:
    """Create all editorial_hub_* tables in BigQuery if they don't already exist.

    Returns a list of fully-qualified table IDs that were checked/created.
    """
    client = _get_bq_client()
    dataset_ref = f"{settings.bq_project}.{settings.bq_dataset}"
    created: list[str] = []

    for table_name, schema in BQ_SCHEMAS.items():
        table_id = f"{dataset_ref}.{table_name}"
        table = bigquery.Table(table_id, schema=schema)
        client.create_table(table, exists_ok=True)
        created.append(table_id)
        logger.info("Ensured BQ table exists: %s", table_id)

    return created


# ---------------------------------------------------------------------------
# Row extraction helpers
# ---------------------------------------------------------------------------


def _model_to_dict(instance: Any) -> dict[str, Any]:
    """Convert a SQLAlchemy model instance to a plain dict, handling date/datetime."""
    d: dict[str, Any] = {}
    mapper = type(instance).__mapper__  # type: ignore[attr-defined]
    for col in mapper.columns:
        val = getattr(instance, col.key)
        d[col.key] = val
    return d


# ---------------------------------------------------------------------------
# Per-table sync
# ---------------------------------------------------------------------------


async def sync_table(table_name: str, session: AsyncSession) -> SyncResult:
    """Read all rows from a PostgreSQL table and write them to BigQuery (WRITE_TRUNCATE)."""
    model = TABLE_MODEL_MAP.get(table_name)
    if model is None:
        return SyncResult(table=table_name, success=False, error=f"Unknown table: {table_name}")

    schema = BQ_SCHEMAS.get(table_name)
    if schema is None:
        return SyncResult(table=table_name, success=False, error=f"No BQ schema for: {table_name}")

    try:
        # 1. Fetch all rows from PostgreSQL
        result = await session.execute(select(model))
        rows = result.scalars().all()

        bq_client = _get_bq_client()
        table_id = f"{settings.bq_project}.{settings.bq_dataset}.{table_name}"

        if not rows:
            # Truncate the BQ table by loading an empty DataFrame
            df = pd.DataFrame(columns=[f.name for f in schema])
            job_config = bigquery.LoadJobConfig(
                schema=schema,
                write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
            )
            job = bq_client.load_table_from_dataframe(df, table_id, job_config=job_config)
            job.result()
            return SyncResult(table=table_name, rows=0)

        # 2. Convert to DataFrame
        records = [_model_to_dict(row) for row in rows]
        df = pd.DataFrame(records)

        # Ensure column order matches schema
        schema_cols = [f.name for f in schema]
        for col in schema_cols:
            if col not in df.columns:
                df[col] = None
        df = df[schema_cols]

        # 3. Load to BigQuery
        job_config = bigquery.LoadJobConfig(
            schema=schema,
            write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
        )
        job = bq_client.load_table_from_dataframe(df, table_id, job_config=job_config)
        job.result()  # Wait for completion

        return SyncResult(table=table_name, rows=len(df))

    except Exception as exc:
        logger.exception("Error syncing table %s to BigQuery", table_name)
        return SyncResult(table=table_name, success=False, error=str(exc))


# ---------------------------------------------------------------------------
# Full sync
# ---------------------------------------------------------------------------


async def sync_all(session: AsyncSession) -> FullSyncResult:
    """Sync every mapped table to BigQuery and return aggregated results."""
    full = FullSyncResult()

    # Ensure tables exist first
    try:
        create_bq_tables()
    except Exception as exc:
        logger.exception("Failed to create BQ tables")
        full.finished_at = datetime.utcnow()
        full.results.append(SyncResult(table="__create_tables__", success=False, error=str(exc)))
        return full

    for table_name in TABLE_MODEL_MAP:
        result = await sync_table(table_name, session)
        full.results.append(result)

    full.finished_at = datetime.utcnow()

    # Write an audit log entry
    try:
        audit = AuditLog(
            entity_type="bigquery_sync",
            entity_id=None,
            action="SYNC",
            changes_json=json.dumps(
                {
                    "tables": [
                        {"table": r.table, "rows": r.rows, "success": r.success, "error": r.error}
                        for r in full.results
                    ],
                    "all_ok": full.all_ok,
                }
            ),
            performed_by="system",
        )
        session.add(audit)
        await session.commit()
    except Exception:
        logger.exception("Failed to write sync audit log entry")

    return full
