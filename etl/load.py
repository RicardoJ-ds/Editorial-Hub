"""Load layer — writes tables to BigQuery `graphite_bi_sandbox.editorial_*`.

Schemas are derived from the SQLAlchemy models (one source of truth) with the
canonical columns appended; marts/mappings carry explicit schemas. Loads are
JSON load jobs (no pyarrow/pandas dependency) with WRITE_TRUNCATE (full
replace) — the same idempotence the legacy bigquery_sync had.
"""

from __future__ import annotations

import json
import logging
import math
from datetime import date, datetime

from google.cloud import bigquery
from sqlalchemy import Boolean, Date, DateTime, Float, Integer

from app.config import settings

logger = logging.getLogger(__name__)


def get_bq() -> bigquery.Client:
    from app.services.google_auth import get_google_credentials

    creds = get_google_credentials(scopes=["https://www.googleapis.com/auth/bigquery"])
    return bigquery.Client(project=settings.bq_project, credentials=creds)


def _bq_type(sa_type) -> str:
    if isinstance(sa_type, Boolean):
        return "BOOLEAN"
    if isinstance(sa_type, Integer):
        return "INTEGER"
    if isinstance(sa_type, Float):
        return "FLOAT"
    if isinstance(sa_type, DateTime):
        return "TIMESTAMP"
    if isinstance(sa_type, Date):
        return "DATE"
    return "STRING"  # String/Text/JSONB(serialized)


def schema_for_model(model, extra: list[tuple[str, str]] | None = None) -> list[bigquery.SchemaField]:
    fields = []
    for col in model.__mapper__.columns:
        tname = _bq_type(col.type) if col.type.__class__.__name__ != "JSONB" else "STRING"
        fields.append(bigquery.SchemaField(col.key, tname))
    for name, tname in extra or []:
        fields.append(bigquery.SchemaField(name, tname))
    return fields


def schema_from_spec(spec: list[tuple[str, str]]) -> list[bigquery.SchemaField]:
    return [bigquery.SchemaField(n, t) for n, t in spec]


def _json_value(v, field_type: str):
    if v is None:
        return None
    if field_type in ("INTEGER", "INT64"):
        return int(v)
    if field_type in ("FLOAT", "FLOAT64"):
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    if field_type in ("BOOLEAN", "BOOL"):
        return bool(v)
    if field_type == "TIMESTAMP":
        return v.isoformat() if isinstance(v, datetime) else str(v)
    if field_type == "DATE":
        if isinstance(v, datetime):
            return v.date().isoformat()
        return v.isoformat() if isinstance(v, date) else str(v)
    # STRING — serialize dict/list (JSONB) payloads
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False, default=str)
    return str(v)


def load_rows(
    bq: bigquery.Client,
    table_name: str,
    rows: list[dict],
    schema: list[bigquery.SchemaField],
) -> int:
    table_id = f"{settings.bq_project}.{settings.bq_dataset}.{table_name}"
    payload = [
        {f.name: _json_value(r.get(f.name), f.field_type) for f in schema} for r in rows
    ]
    job_config = bigquery.LoadJobConfig(
        schema=schema,
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
    )
    if not payload:
        # JSON load jobs reject empty input — recreate the table empty instead.
        bq.delete_table(table_id, not_found_ok=True)
        bq.create_table(bigquery.Table(table_id, schema=schema))
        logger.info("loaded 0 rows → %s (recreated empty)", table_id)
        return 0
    job = bq.load_table_from_json(payload, table_id, job_config=job_config)
    job.result()
    logger.info("loaded %s rows → %s", len(payload), table_id)
    return len(payload)
