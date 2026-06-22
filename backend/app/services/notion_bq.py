"""Read the Notion "content machine" directly from BigQuery.

Source: ``graphite-data.graphite_bi.notion_raw_revenue_content`` — the RAW layer
published by the `revenue-content-machine-etl` BI pipeline, which REPLACED the
legacy Google Sheet the Hub used to import into Neon `notion_articles`. We no
longer ingest the sheet; the two consumers below read this table at SYNC time.
Both `graphite_bi` and `graphite_bi_sandbox` are us-central1, so this
cross-dataset read works with the same warehouse service account.

Consumed by:
  - ``migration_service._apply_notion_published`` — bakes is_published /
    published_url / notion_matched onto ``article_records`` (matched by Case_ID,
    then a unique Topic-as-title fallback).
  - ``notion_kpi_service.refresh_notion_kpis`` — Revision Rate / Turnaround /
    Second Reviews → ``kpi_scores``.

Parity: the legacy Cloud Function filtered the sheet to rows carrying Topic +
Client + Account Team POD, so we reproduce that filter here — the published +
KPI numbers then match what the Hub showed before the cutover. (The table is the
unfiltered superset capped at the most-recent 10k rows, same as the old sheet.)
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

# Fully-qualified: lives in graphite_bi (read-only), NOT the warehouse's
# graphite_bi_sandbox — so it must be named in full (the bq_dashboard DS
# constant points at the sandbox and can't be reused here).
_NOTION_TABLE = "`graphite-data.graphite_bi.notion_raw_revenue_content`"


@dataclass
class NotionRow:
    """One content-machine row, shaped like the old NotionArticle columns the
    consumers read (so their logic is unchanged — only the source moved)."""

    case_id: str | None
    title: str | None
    client_name: str | None
    writer: str | None
    editor: str | None
    sr_editor: str | None
    editorial_pod: str | None
    article_status: str | None
    cms_status: str | None
    published_url: str | None
    month: str | None
    created_date: datetime | None
    cb_delivered_date: date | None
    article_delivered_date: date | None


def fetch_notion_content() -> list[NotionRow]:
    """Pull the content machine from BigQuery, column-mapped + date-parsed.

    `Created_time` is a BQ TIMESTAMP (tz-aware → normalized to naive UTC like the
    rest of the app); the delivered-date columns are free-text strings, parsed
    with the same lenient `parse_date` the sheet importer used.
    """
    from app.services.bq_dashboard import bq
    from app.services.migration_service import parse_date

    sql = f"""
        SELECT
          Case_ID, Topic, Client, Writer, Editor, Sr_Editor,
          Editorial_Team_POD, Article_Workflow_Status, CMS_Workflow_Status,
          Published_URL, Month, Created_time, CB_Delivered_Date, Article_Delivered_Date
        FROM {_NOTION_TABLE}
        WHERE Topic IS NOT NULL AND Topic != ''
          AND Client IS NOT NULL AND Client != ''
          AND Account_Team_POD IS NOT NULL AND Account_Team_POD != ''
    """
    rows: list[NotionRow] = []
    for r in bq().query(sql).result():
        created = r["Created_time"]
        if isinstance(created, datetime) and created.tzinfo is not None:
            created = created.replace(tzinfo=None)
        rows.append(
            NotionRow(
                case_id=r["Case_ID"],
                title=r["Topic"],
                client_name=r["Client"],
                writer=r["Writer"],
                editor=r["Editor"],
                sr_editor=r["Sr_Editor"],
                editorial_pod=r["Editorial_Team_POD"],
                article_status=r["Article_Workflow_Status"],
                cms_status=r["CMS_Workflow_Status"],
                published_url=r["Published_URL"],
                month=r["Month"],
                created_date=created,
                cb_delivered_date=parse_date(r["CB_Delivered_Date"]),
                article_delivered_date=parse_date(r["Article_Delivered_Date"]),
            )
        )
    return rows
