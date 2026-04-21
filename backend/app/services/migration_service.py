"""Google Sheets migration service — reads live spreadsheet data and upserts into PostgreSQL."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime

from googleapiclient.discovery import build
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import (
    AIMonitoringRecord,
    AuditLog,
    CapacityProjection,
    Client,
    CumulativeMetric,
    DeliverableMonthly,
    DeliveryTemplate,
    EngagementRule,
    GoalsVsDelivery,
    KpiScore,
    ModelAssumption,
    NotionArticle,
    ProductionHistory,
    SheetSyncHistory,
    SurferAPIUsage,
    TeamMember,
)

logger = logging.getLogger(__name__)

SPREADSHEET_ID = settings.spreadsheet_id
MASTER_TRACKER_ID = settings.master_tracker_id
AI_MONITORING_ID = settings.ai_monitoring_id

# Human-readable descriptions for known sheets
SHEET_DESCRIPTIONS: dict[str, str] = {
    "Editorial SOW overview": "Client SOW contracts — status, dates, cadence, article counts",
    "Delivered vs Invoiced v2": "Monthly article delivery and invoicing tracker per client",
    "ET CP 2026 [V11 Mar 2026]": "Editorial team capacity plan — pod assignments and projections",
    "Model Assumptions": "Model parameters — categorisation rules, ramp-up periods, capacity targets",
    "Editorial Operating Model": "Monthly production history per client — actuals and projections",
    "Delivery Schedules": "Delivery template schedules by SOW size — invoicing and article targets",
    "Editorial Engagement Requirements": "The 10 Commandments — rules for editorial engagement success",
    "Meta Calendar Month Deliveries": "Meta client monthly delivery targets — BMG, Manus, RL, AI",
    "AI Monitoring - Data": "Writer AI monitoring scan results — FULL PASS / PARTIAL PASS / REVIEW/REWRITE per article",
    "AI Monitoring - Rewrites": "Rewritten articles from AI monitoring — flagged and reprocessed",
    "AI Monitoring - Flags": "Yellow/Red flag articles — PARTIAL PASS and REVIEW/REWRITE only",
    "AI Monitoring - Surfer Usage": "Monthly Surfer AI detector API usage per pod",
    "Master Tracker - Cumulative": "All-time cumulative pipeline metrics per client — topics, CBs, articles, published",
    "Master Tracker - Goals vs Delivery": "Weekly goals vs delivery tracking per month — CB and article delivery pacing",
    "Notion Database": "Article workflow tracking from Notion export — 13K+ records with statuses, dates, assignments",
    "Monthly KPI Scores": "Manual KPI scores entered by SEs — Internal Quality, External Quality, Mentorship, Feedback Adoption",
    "Team Pods": "Growth team → client mapping (POD NUMBER × CLIENT). Updates clients.growth_pod.",
}

# Map of importable sheet names to their import functions (populated below)
IMPORT_DISPATCH: dict[str, str] = {
    "Editorial SOW overview": "import_sow_overview",
    "Delivered vs Invoiced v2": "import_delivered_invoiced",
    "Model Assumptions": "import_model_assumptions",
    "Editorial Operating Model": "import_operating_model",
    "Delivery Schedules": "import_delivery_schedules",
    "Editorial Engagement Requirements": "import_engagement_requirements",
    "Meta Calendar Month Deliveries": "import_meta_deliveries",
    "AI Monitoring - Data": "import_ai_monitoring_data",
    "AI Monitoring - Rewrites": "import_ai_monitoring_rewrites",
    "AI Monitoring - Flags": "import_ai_monitoring_flags",
    "AI Monitoring - Surfer Usage": "import_ai_monitoring_surfer",
    "Master Tracker - Cumulative": "import_cumulative",
    "Master Tracker - Goals vs Delivery": "import_goals_vs_delivery",
    "Notion Database": "import_notion_database",
    "Monthly KPI Scores": "import_monthly_kpi_scores",
    "Team Pods": "import_team_pods",
}
# Capacity plan sheet name is detected dynamically but we keep a prefix for matching
CAPACITY_PLAN_PREFIX = "ET CP 2026"


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------


@dataclass
class ImportResult:
    sheet: str
    rows_parsed: int = 0
    rows_imported: int = 0
    success: bool = True
    errors: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Helper functions (adapted from seed_data.py for raw list-of-lists input)
# ---------------------------------------------------------------------------


def _is_empty(val) -> bool:
    """Check if a cell value is empty / missing."""
    if val is None:
        return True
    s = str(val).strip()
    return s in ("", "nan", "None")


def safe_int(val, default=None) -> int | None:
    """Convert a value to int, returning default if not possible."""
    if _is_empty(val):
        return default
    try:
        return int(float(str(val).replace(",", "").strip()))
    except (ValueError, TypeError):
        return default


def safe_pct(val, default=None) -> float | None:
    """Convert '99.29%' to 99.29 float."""
    if _is_empty(val):
        return default
    s = str(val).strip().rstrip("%")
    try:
        return float(s)
    except (ValueError, TypeError):
        return default


def parse_date(val, formats=None) -> date | None:
    """Parse a date string, returning None for TBD/N/A/empty."""
    if _is_empty(val):
        return None
    val_str = str(val).strip()
    if val_str.upper() in ("TBD", "N/A", "NA", "-", ""):
        return None

    if formats is None:
        formats = [
            "%m/%d/%Y",
            "%m/%d/%y",
            "%B %d, %Y",
            "%b %d %Y",
            "%Y-%m-%d",
            "%d/%m/%Y",
        ]

    for fmt in formats:
        try:
            return datetime.strptime(val_str, fmt).date()
        except ValueError:
            continue
    # Last resort: dateutil
    try:
        from dateutil.parser import parse as dateutil_parse

        return dateutil_parse(val_str).date()
    except Exception:
        return None


def parse_word_count(val) -> tuple[int | None, int | None]:
    """Parse '1,000 - 1,500' into (min, max) ints."""
    if _is_empty(val):
        return None, None
    val_str = str(val).replace(",", "").strip()
    match = re.match(r"(\d+)\s*[-\u2013]\s*(\d+)", val_str)
    if match:
        return int(match.group(1)), int(match.group(2))
    try:
        v = int(val_str)
        return v, v
    except ValueError:
        return None, None


def parse_cadence_quarters(cadence_str) -> dict[str, int | None]:
    """Parse 'Q1 = 30 / Q2 = 51 / Q3 = 60 / Q4 = 39' into {q1..q4}."""
    result: dict[str, int | None] = {"q1": None, "q2": None, "q3": None, "q4": None}
    if _is_empty(cadence_str):
        return result
    cadence_str = str(cadence_str)
    for q in range(1, 5):
        pattern = rf"Q{q}\s*=\s*(\d+)"
        match = re.search(pattern, cadence_str)
        if match:
            result[f"q{q}"] = int(match.group(1))
    return result


def map_status(raw) -> str | None:
    """Map raw status text to enum value."""
    if _is_empty(raw):
        return None
    raw = str(raw).strip().upper()
    mapping = {
        "SOON TO BE ACTIVE": "SOON_TO_BE_ACTIVE",
        "ACTIVE": "ACTIVE",
        "COMPLETED": "COMPLETED",
        "CANCELLED": "CANCELLED",
        "INACTIVE": "COMPLETED",
    }
    return mapping.get(raw, raw)


def parse_month_str(month_str) -> tuple[int | None, int | None]:
    """Parse 'Mar 2026' or 'Feb 2026' to (year, month)."""
    if _is_empty(month_str):
        return None, None
    try:
        dt = datetime.strptime(str(month_str).strip(), "%b %Y")
        return dt.year, dt.month
    except ValueError:
        return None, None


def _cell(row: list, idx: int, default: str = "") -> str:
    """Safely get a cell from a row list (Sheets API rows can be ragged)."""
    if idx < len(row):
        return str(row[idx]).strip() if row[idx] is not None else default
    return default


def _extract_hyperlinks(service, spreadsheet_id: str, range_str: str) -> dict[int, str]:
    """Extract hyperlinks from a column range. Returns {row_index: url}."""
    try:
        resp = (
            service.spreadsheets()
            .get(
                spreadsheetId=spreadsheet_id,
                ranges=[range_str],
                fields="sheets.data.rowData.values(hyperlink,formattedValue)",
            )
            .execute()
        )
        links: dict[int, str] = {}
        for sheet in resp.get("sheets", []):
            for data_block in sheet.get("data", []):
                for i, row_data in enumerate(data_block.get("rowData", [])):
                    for val in row_data.get("values", []):
                        link = val.get("hyperlink", "")
                        if link:
                            links[i] = link
        return links
    except Exception:
        logger.warning("Could not extract hyperlinks from %s", range_str)
        return {}


def _cell_to_markdown(cell) -> str:
    """Convert a Sheets API CellData to markdown, preserving inline hyperlinks.

    Google Sheets stores per-cell rich text as `textFormatRuns`: each run carries
    a `startIndex` into `formattedValue` and a `format` that may contain
    `link.uri`. We convert linked runs into `[text](url)` markdown so the URL
    survives into the database (plain `.values().get()` would drop it).

    Cells whose entire content is a single hyperlink expose the URL on the
    cell's top-level `hyperlink` field instead of on runs.
    """
    text = cell.get("formattedValue", "") or ""
    if not text:
        return ""

    runs = cell.get("textFormatRuns") or []
    if not runs:
        whole = cell.get("hyperlink")
        return f"[{text}]({whole})" if whole else text

    # Each run covers [startIndex, next_start_index). Linked runs get wrapped.
    parts: list[str] = []
    for i, run in enumerate(runs):
        start = run.get("startIndex", 0)
        end = runs[i + 1].get("startIndex", len(text)) if i + 1 < len(runs) else len(text)
        segment = text[start:end]
        if not segment:
            continue
        uri = (run.get("format") or {}).get("link", {}).get("uri")
        parts.append(f"[{segment}]({uri})" if uri else segment)
    return "".join(parts)


def _extract_rich_text_column(
    service, spreadsheet_id: str, range_str: str
) -> dict[int, str]:
    """Fetch a column as markdown, preserving inline hyperlinks on each cell.

    Returns {row_offset_within_range: markdown_string} so callers can align
    with their own iteration index.
    """
    try:
        resp = (
            service.spreadsheets()
            .get(
                spreadsheetId=spreadsheet_id,
                ranges=[range_str],
                fields="sheets.data.rowData.values(formattedValue,hyperlink,textFormatRuns(startIndex,format(link)))",
            )
            .execute()
        )
        out: dict[int, str] = {}
        for sheet in resp.get("sheets", []):
            for block in sheet.get("data", []):
                for i, row in enumerate(block.get("rowData", [])):
                    vals = row.get("values", [])
                    if not vals:
                        continue
                    md = _cell_to_markdown(vals[0])
                    if md:
                        out[i] = md
        return out
    except Exception:
        logger.warning("Could not extract rich text from %s", range_str, exc_info=True)
        return {}


# ---------------------------------------------------------------------------
# Google Sheets client
# ---------------------------------------------------------------------------


def get_sheets_client():
    """Build an authenticated Google Sheets API service."""
    from app.services.google_auth import get_google_credentials

    creds = get_google_credentials(scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"])
    return build("sheets", "v4", credentials=creds)


# ---------------------------------------------------------------------------
# list_available_sheets
# ---------------------------------------------------------------------------


def list_available_sheets() -> list[dict]:
    """Return metadata for every visible sheet in the spreadsheet."""
    service = get_sheets_client()
    meta = (
        service.spreadsheets()
        .get(spreadsheetId=SPREADSHEET_ID, fields="sheets.properties")
        .execute()
    )
    sheets_info: list[dict] = []
    for s in meta.get("sheets", []):
        props = s.get("properties", {})
        if props.get("hidden"):
            continue
        name = props.get("title", "")
        row_count = props.get("gridProperties", {}).get("rowCount", 0)
        description = SHEET_DESCRIPTIONS.get(name, "")
        sheets_info.append(
            {
                "name": name,
                "row_count": row_count,
                "description": description,
            }
        )

    # Also list sheets from Master Tracker and AI Monitoring
    for extra_id, prefix in [
        (MASTER_TRACKER_ID, "Master Tracker"),
        (AI_MONITORING_ID, "AI Monitoring"),
    ]:
        try:
            extra_meta = (
                service.spreadsheets()
                .get(spreadsheetId=extra_id, fields="sheets.properties")
                .execute()
            )
            for s in extra_meta.get("sheets", []):
                props = s.get("properties", {})
                if props.get("hidden"):
                    continue
                name = props.get("title", "")
                row_count = props.get("gridProperties", {}).get("rowCount", 0)
                sheets_info.append(
                    {
                        "name": f"{prefix} - {name}",
                        "row_count": row_count,
                        "description": SHEET_DESCRIPTIONS.get(
                            f"{prefix} - {name}", f"From {prefix} spreadsheet"
                        ),
                        "source": prefix,
                    }
                )
        except Exception:
            logger.warning("Could not list sheets from %s spreadsheet", prefix)

    # Also list the dedicated Notion Database spreadsheet
    notion_id = getattr(settings, "notion_database_id", None)
    if notion_id:
        try:
            notion_meta = (
                service.spreadsheets()
                .get(spreadsheetId=notion_id, fields="sheets.properties")
                .execute()
            )
            for s in notion_meta.get("sheets", []):
                props = s.get("properties", {})
                if props.get("hidden"):
                    continue
                title = props.get("title", "")
                if title == "Notion":
                    row_count = props.get("gridProperties", {}).get("rowCount", 0)
                    sheets_info.append(
                        {
                            "name": "Notion Database",
                            "row_count": row_count,
                            "description": SHEET_DESCRIPTIONS.get(
                                "Notion Database",
                                "Article workflow tracking from Notion export",
                            ),
                        }
                    )
        except Exception:
            logger.warning("Could not list sheets from Notion spreadsheet")

    # Also list the Team Pods spreadsheet (single "Team Pods" logical sheet)
    team_pods_id = getattr(settings, "team_pods_id", None)
    if team_pods_id:
        try:
            tp_meta = (
                service.spreadsheets()
                .get(spreadsheetId=team_pods_id, fields="sheets.properties")
                .execute()
            )
            sheets_info_pods = tp_meta.get("sheets", [])
            if sheets_info_pods:
                first = sheets_info_pods[0].get("properties", {})
                row_count = first.get("gridProperties", {}).get("rowCount", 0)
                sheets_info.append(
                    {
                        "name": "Team Pods",
                        "row_count": row_count,
                        "description": SHEET_DESCRIPTIONS.get(
                            "Team Pods",
                            "Growth team pod mapping per client",
                        ),
                    }
                )
        except Exception:
            logger.warning("Could not list sheets from Team Pods spreadsheet")

    return sheets_info


# ---------------------------------------------------------------------------
# preview_sheet
# ---------------------------------------------------------------------------


def _resolve_sheet_source(sheet_name: str) -> tuple[str, str]:
    """Return (spreadsheet_id, actual_sheet_title) for a given sheet name.

    Sheets prefixed with 'Master Tracker - ' or 'AI Monitoring - ' live in
    separate spreadsheets. The prefix is stripped to get the real tab name.
    """
    if sheet_name.startswith("Master Tracker - "):
        return MASTER_TRACKER_ID, sheet_name.removeprefix("Master Tracker - ")
    if sheet_name.startswith("AI Monitoring - "):
        return AI_MONITORING_ID, sheet_name.removeprefix("AI Monitoring - ")
    if sheet_name == "Notion Database":
        notion_id = getattr(settings, "notion_database_id", None)
        if notion_id:
            return notion_id, "Notion"
    if sheet_name == "Team Pods":
        team_pods_id = getattr(settings, "team_pods_id", None)
        if team_pods_id:
            # Preview the first tab — the Team Pods sheet has a single
            # "Growth Team Projects" table, tab name varies per month so we
            # resolve dynamically at preview/import time.
            return team_pods_id, ""
    return SPREADSHEET_ID, sheet_name


def preview_sheet(sheet_name: str, max_rows: int = 20) -> dict:
    """Read the first max_rows rows from a sheet and return headers + data."""
    service = get_sheets_client()
    ssid, tab_name = _resolve_sheet_source(sheet_name)
    # Empty tab_name → resolve to the first (non-hidden) tab of the spreadsheet.
    if not tab_name:
        meta_pre = (
            service.spreadsheets().get(spreadsheetId=ssid, fields="sheets.properties").execute()
        )
        for s in meta_pre.get("sheets", []):
            props = s.get("properties", {})
            if not props.get("hidden"):
                tab_name = props.get("title", "")
                break
    # Fetch enough rows: 1 header + max_rows data
    range_str = f"'{tab_name}'!1:{max_rows + 1}"
    result = service.spreadsheets().values().get(spreadsheetId=ssid, range=range_str).execute()
    values = result.get("values", [])
    if not values:
        return {"sheet_name": sheet_name, "headers": [], "rows": [], "total_rows": 0}

    headers = [str(h) for h in values[0]]
    rows = values[1:] if len(values) > 1 else []

    # Get total row count from sheet metadata
    meta = service.spreadsheets().get(spreadsheetId=ssid, fields="sheets.properties").execute()
    total_rows = 0
    for s in meta.get("sheets", []):
        if s.get("properties", {}).get("title") == tab_name:
            total_rows = s["properties"].get("gridProperties", {}).get("rowCount", 0)
            break

    return {
        "sheet_name": sheet_name,
        "headers": headers,
        "rows": [[str(c) if c is not None else "" for c in r] for r in rows],
        "total_rows": total_rows,
    }


# ---------------------------------------------------------------------------
# import_sow_overview
# ---------------------------------------------------------------------------


def import_sow_overview(session: Session) -> ImportResult:
    """Import 'Editorial SOW overview' sheet into the clients table.

    Reuses parsing logic from seed_data.py's seed_clients(), adapted for
    the Sheets API list-of-lists format instead of pandas DataFrames.
    """
    sheet_name = "Editorial SOW overview"
    result = ImportResult(sheet=sheet_name)

    try:
        service = get_sheets_client()
        resp = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=SPREADSHEET_ID, range=f"'{sheet_name}'")
            .execute()
        )
        all_rows = resp.get("values", [])

        if len(all_rows) < 7:
            result.errors.append("Sheet has fewer than 7 rows; cannot determine data")
            result.success = False
            return result

        # Skip first 5 header/meta rows, row 6 (index 5) is the column header,
        # data starts at index 6.
        # Column mapping (0-indexed):
        # 0: status, 1: client, 2: start, 3: term_months, 4: end, 5: cadence,
        # 6: articles_sow, 7: articles_delivered, 8: articles_invoiced, 9: articles_paid,
        # 10: word_count, 11: consulting_ko, 12: editorial_ko, 13: first_cb,
        # 14: first_article_delivery, 15: first_feedback, 16: first_article_published,
        # 17: comments, 18: sow
        data_rows = all_rows[6:]

        # Extract hyperlinks from SOW column (col S = col 19, 1-indexed)
        # Rows 7+ in sheet = data rows (sheet is 1-indexed, so row 7 = index 0 in data_rows)
        sow_hyperlinks = _extract_hyperlinks(service, SPREADSHEET_ID, f"'{sheet_name}'!S7:S200")
        # Comments live in col R (col 18, 1-indexed) and often contain inline
        # hyperlinks ("see here" linked to a doc). Fetch as markdown so URLs
        # survive; plain .values() drops them.
        comments_md = _extract_rich_text_column(
            service, SPREADSHEET_ID, f"'{sheet_name}'!R7:R200"
        )

        for row in data_rows:
            result.rows_parsed += 1

            status_raw = _cell(row, 0)
            client_name = _cell(row, 1)

            # Skip empty or summary rows
            if not client_name or not status_raw:
                continue
            if any(kw in client_name.lower() for kw in ("total", "median", "average", "client")):
                continue

            status = map_status(status_raw)
            if status is None:
                continue

            cadence_raw = _cell(row, 5) or None
            quarters = parse_cadence_quarters(cadence_raw)
            wc_min, wc_max = parse_word_count(_cell(row, 10))

            # Upsert: try to find existing client by name
            existing = (
                session.execute(select(Client).where(Client.name == client_name)).scalars().first()
            )

            client_data = dict(
                status=status,
                start_date=parse_date(_cell(row, 2)),
                term_months=safe_int(_cell(row, 3)),
                end_date=parse_date(_cell(row, 4)),
                cadence=cadence_raw,
                cadence_q1=quarters["q1"],
                cadence_q2=quarters["q2"],
                cadence_q3=quarters["q3"],
                cadence_q4=quarters["q4"],
                articles_sow=safe_int(_cell(row, 6)),
                articles_delivered=safe_int(_cell(row, 7), 0),
                articles_invoiced=safe_int(_cell(row, 8), 0),
                articles_paid=safe_int(_cell(row, 9), 0),
                word_count_min=wc_min,
                word_count_max=wc_max,
                consulting_ko_date=parse_date(_cell(row, 11)),
                editorial_ko_date=parse_date(_cell(row, 12)),
                first_cb_approved_date=parse_date(_cell(row, 13)),
                first_article_delivered_date=parse_date(_cell(row, 14)),
                first_feedback_date=parse_date(_cell(row, 15)),
                first_article_published_date=parse_date(_cell(row, 16)),
                comments=comments_md.get(result.rows_parsed - 1, _cell(row, 17)) or None,
                sow_link=sow_hyperlinks.get(result.rows_parsed - 1, _cell(row, 18)) or None,
                updated_by="sheets_migration",
            )

            if existing:
                for k, v in client_data.items():
                    setattr(existing, k, v)
            else:
                client = Client(name=client_name, **client_data)
                session.add(client)

            result.rows_imported += 1

        session.commit()
        result.success = True

    except Exception as exc:
        logger.exception("Error importing SOW overview")
        session.rollback()
        result.success = False
        result.errors.append(str(exc))

    return result


# ---------------------------------------------------------------------------
# import_delivered_invoiced
# ---------------------------------------------------------------------------


def import_delivered_invoiced(session: Session) -> ImportResult:
    """Import 'Delivered vs Invoiced v2' sheet into deliverables_monthly.

    Reuses the 6-row-per-client parsing pattern from seed_data.py.
    """
    sheet_name = "Delivered vs Invoiced v2"
    result = ImportResult(sheet=sheet_name)

    try:
        service = get_sheets_client()
        resp = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=SPREADSHEET_ID, range=f"'{sheet_name}'")
            .execute()
        )
        all_rows = resp.get("values", [])

        if len(all_rows) < 10:
            result.errors.append("Sheet has too few rows")
            result.success = False
            return result

        # Build client name -> id lookup
        clients = session.execute(select(Client)).scalars().all()
        name_lookup: dict[str, int] = {}
        for c in clients:
            name_lookup[c.name.lower().strip()] = c.id

        # Common aliases
        alias_map = {
            "get flex": "flex",
            "genstoreai": "genstoreai",
            "genstore ai": "genstoreai",
            "blvd": "boulevard",
            "meta fb": "meta bmg",
            "meta bmg": "meta bmg",
            "college hunks": "college hunks",
        }
        for alias, canonical in alias_map.items():
            if canonical in name_lookup and alias not in name_lookup:
                name_lookup[alias] = name_lookup[canonical]

        # Data starts at row index 3, groups of 6 rows per client.
        # Columns: 0..6 are metadata; month data starts at col 7 and extends
        # as far as the sheet is filled — Y2 contracts (renewals, multi-year
        # engagements like Gainbridge) use M13+ in additional columns. Hard
        # cap of 36 months is a safety limit that far exceeds today's
        # longest contracts.
        row_idx = 3
        MAX_MONTH_LIMIT = 36

        while row_idx + 5 < len(all_rows):
            header_row = all_rows[row_idx]
            result.rows_parsed += 1

            # col 0: status
            status_val = _cell(header_row, 0)
            if not status_val:
                row_idx += 1
                continue

            # col 3: client name
            client_name = _cell(header_row, 3)
            if not client_name:
                row_idx += 6
                continue

            # col 5: start month
            start_month_str = _cell(header_row, 5)
            start_year, start_month = parse_month_str(start_month_str)
            if start_year is None:
                row_idx += 6
                continue

            # Look up client_id
            client_id = name_lookup.get(client_name.lower().strip())
            if client_id is None:
                # Try partial matching
                for key, cid in name_lookup.items():
                    if client_name.lower().strip() in key or key in client_name.lower().strip():
                        client_id = cid
                        break

            if client_id is None:
                result.errors.append(f"Client '{client_name}' not found in DB, skipping")
                row_idx += 6
                continue

            # Rows: 0=SOW targets, 1=Invoicing, 2=Cumulative, 3=Article Deliveries,
            #        4=Variance, 5=Cumulative Delivered
            sow_row = all_rows[row_idx] if row_idx < len(all_rows) else []
            invoicing_row = all_rows[row_idx + 1] if row_idx + 1 < len(all_rows) else []
            deliveries_row = all_rows[row_idx + 3] if row_idx + 3 < len(all_rows) else []
            variance_row = all_rows[row_idx + 4] if row_idx + 4 < len(all_rows) else []

            # Iterate months until we exhaust the populated columns. Y2+
            # contracts extend past M12 so a fixed cap silently dropped those
            # rows before; now we read as many months as the sheet carries.
            widest_row = max(
                len(sow_row), len(invoicing_row), len(deliveries_row), len(variance_row)
            )
            months_available = max(0, min(widest_row - 7, MAX_MONTH_LIMIT))

            for m_offset in range(months_available):
                col_idx = 7 + m_offset

                # Calculate actual year/month
                from dateutil.relativedelta import relativedelta

                dt = date(start_year, start_month, 1) + relativedelta(months=m_offset)
                year = dt.year
                month = dt.month

                articles_delivered_val = safe_int(_cell(deliveries_row, col_idx))
                articles_invoiced_val = safe_int(_cell(invoicing_row, col_idx))
                articles_sow_val = safe_int(_cell(sow_row, col_idx))
                variance_val = safe_int(_cell(variance_row, col_idx))

                if articles_delivered_val is not None or articles_invoiced_val is not None:
                    # Upsert: check for existing record
                    existing = (
                        session.execute(
                            select(DeliverableMonthly).where(
                                DeliverableMonthly.client_id == client_id,
                                DeliverableMonthly.year == year,
                                DeliverableMonthly.month == month,
                            )
                        )
                        .scalars()
                        .first()
                    )

                    if existing:
                        existing.articles_sow_target = articles_sow_val or 0
                        existing.articles_delivered = articles_delivered_val or 0
                        existing.articles_invoiced = articles_invoiced_val or 0
                        existing.variance = variance_val or 0
                        existing.updated_by = "sheets_migration"
                    else:
                        dm = DeliverableMonthly(
                            client_id=client_id,
                            year=year,
                            month=month,
                            articles_sow_target=articles_sow_val or 0,
                            articles_delivered=articles_delivered_val or 0,
                            articles_invoiced=articles_invoiced_val or 0,
                            variance=variance_val or 0,
                            updated_by="sheets_migration",
                        )
                        session.add(dm)

                    result.rows_imported += 1

            row_idx += 6

        session.commit()
        result.success = True

    except Exception as exc:
        logger.exception("Error importing Delivered vs Invoiced")
        session.rollback()
        result.success = False
        result.errors.append(str(exc))

    return result


# ---------------------------------------------------------------------------
# import_capacity_plan
# ---------------------------------------------------------------------------


def _detect_capacity_sheet_name(service) -> str | None:
    """Find the latest 'ET CP 2026 [V...]' sheet name dynamically."""
    meta = (
        service.spreadsheets()
        .get(spreadsheetId=SPREADSHEET_ID, fields="sheets.properties")
        .execute()
    )
    candidates: list[str] = []
    for s in meta.get("sheets", []):
        title = s.get("properties", {}).get("title", "")
        if title.startswith(CAPACITY_PLAN_PREFIX):
            candidates.append(title)
    if not candidates:
        return None
    # Sort so the latest version comes last (V11 > V10, etc.)
    candidates.sort()
    return candidates[-1]


def import_capacity_plan(session: Session) -> ImportResult:
    """Import the capacity-plan sheet into team_members + capacity_projections.

    Reuses parsing logic from seed_data.py's seed_team_and_capacity().
    """
    service = get_sheets_client()
    sheet_name = _detect_capacity_sheet_name(service)
    if sheet_name is None:
        return ImportResult(
            sheet="ET CP 2026 [?]",
            success=False,
            errors=["No capacity-plan sheet found matching prefix 'ET CP 2026'"],
        )

    result = ImportResult(sheet=sheet_name)

    try:
        resp = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=SPREADSHEET_ID, range=f"'{sheet_name}'")
            .execute()
        )
        all_rows = resp.get("values", [])

        if len(all_rows) < 40:
            result.errors.append("Sheet has too few rows to parse")
            result.success = False
            return result

        # ------------------------------------------------------------------
        # Team members: parse pod assignments section
        # ------------------------------------------------------------------
        # The pod assignments are hardcoded in the same structure as seed_data.py
        # but we can also detect them from the sheet. For reliability, use the
        # same hardcoded structure (the sheet format is fragile).
        pod_teams = {
            "Pod 1": {
                "senior_editor": "Nina Denison",
                "editors": ["Robert Thorpe", "Jimmy Bunes"],
                "clients": ["College HUNKS", "Eventbrite", "Felt", "Gainbridge", "n8n"],
            },
            "Pod 2": {
                "senior_editor": "Kennedy Stevens",
                "editors": ["Jimmy Bunes", "Elliot Gardner", "Tiffany Anderson"],
                "clients": [
                    "Genstore AI",
                    "GenstoreAI",
                    "Get Flex",
                    "Flex",
                    "Huntress",
                    "Maven Clinic",
                    "Mistplay",
                    "Miter",
                    "Workleap + Sharegate",
                ],
            },
            "Pod 3": {
                "senior_editor": "Alyssa Zacharias",
                "editors": ["Lee Anderson", "Haley Drucker"],
                "clients": [
                    "BLVD",
                    "Boulevard",
                    "Cointracker",
                    "Leapsome",
                    "Pylon",
                    "Vimeo",
                    "Webflow",
                ],
            },
            "Pod 5": {
                "senior_editor": "Maggie Gowland",
                "editors": ["Lauren Friar", "Shivani Verma"],
                "clients": [
                    "Honeybook",
                    "Fivetran",
                    "Front",
                    "Meta fB",
                    "Meta BMG",
                    "Meta RL",
                    "Meta AI",
                    "Oyster",
                ],
            },
        }

        seen_members: set[str] = set()
        members_imported = 0

        for pod_name, pod_info in pod_teams.items():
            # Senior Editor
            se_name = pod_info["senior_editor"]
            if se_name not in seen_members:
                existing = (
                    session.execute(select(TeamMember).where(TeamMember.name == se_name))
                    .scalars()
                    .first()
                )
                if existing:
                    existing.role = "SENIOR_EDITOR"
                    existing.pod = pod_name
                    existing.is_active = True
                    existing.monthly_capacity = 20
                else:
                    session.add(
                        TeamMember(
                            name=se_name,
                            role="SENIOR_EDITOR",
                            pod=pod_name,
                            is_active=True,
                            monthly_capacity=20,
                        )
                    )
                seen_members.add(se_name)
                members_imported += 1

            # Editors
            for ed_name in pod_info["editors"]:
                if ed_name not in seen_members:
                    existing = (
                        session.execute(select(TeamMember).where(TeamMember.name == ed_name))
                        .scalars()
                        .first()
                    )
                    if existing:
                        existing.role = "EDITOR"
                        existing.pod = pod_name
                        existing.is_active = True
                        existing.monthly_capacity = 60
                    else:
                        session.add(
                            TeamMember(
                                name=ed_name,
                                role="EDITOR",
                                pod=pod_name,
                                is_active=True,
                                monthly_capacity=60,
                            )
                        )
                    seen_members.add(ed_name)
                    members_imported += 1

        session.flush()

        # Update client editorial_pod assignments
        clients_all = session.execute(select(Client)).scalars().all()
        client_name_map = {c.name.lower().strip(): c for c in clients_all}

        for pod_name, pod_info in pod_teams.items():
            for client_name in pod_info["clients"]:
                c = client_name_map.get(client_name.lower().strip())
                if c:
                    c.editorial_pod = pod_name

        # ------------------------------------------------------------------
        # Capacity projections: parse from the CAPACITY section (~row 79+)
        # ------------------------------------------------------------------
        months = [
            (2025, 12),
            (2026, 1),
            (2026, 2),
            (2026, 3),
            (2026, 4),
            (2026, 5),
            (2026, 6),
            (2026, 7),
            (2026, 8),
            (2026, 9),
            (2026, 10),
            (2026, 11),
            (2026, 12),
        ]

        # Extract version from sheet name
        version_match = re.search(r"\[(.*?)\]", sheet_name)
        version = version_match.group(1) if version_match else sheet_name

        capacity_count = 0

        for row_idx in range(75, min(len(all_rows), 120)):
            row = all_rows[row_idx]
            col3_val = _cell(row, 3)
            col4_val = _cell(row, 4)

            if col3_val.startswith("Pod") and col4_val == "Senior Editor":
                pod_name = col3_val

                for month_idx, (year, month) in enumerate(months):
                    base_col = 3 + (month_idx * 8)
                    total_cap_col = base_col + 5
                    projected_col = base_col + 6
                    actual_col = base_col + 7

                    total_cap = safe_int(_cell(row, total_cap_col))
                    projected = safe_int(_cell(row, projected_col))
                    actual = safe_int(_cell(row, actual_col))

                    # Upsert
                    existing = (
                        session.execute(
                            select(CapacityProjection).where(
                                CapacityProjection.pod == pod_name,
                                CapacityProjection.year == year,
                                CapacityProjection.month == month,
                                CapacityProjection.version == version,
                            )
                        )
                        .scalars()
                        .first()
                    )

                    if existing:
                        existing.total_capacity = total_cap
                        existing.projected_used_capacity = projected
                        existing.actual_used_capacity = actual
                        existing.updated_by = "sheets_migration"
                    else:
                        session.add(
                            CapacityProjection(
                                pod=pod_name,
                                year=year,
                                month=month,
                                total_capacity=total_cap,
                                projected_used_capacity=projected,
                                actual_used_capacity=actual,
                                version=version,
                                updated_by="sheets_migration",
                            )
                        )
                    capacity_count += 1

        result.rows_parsed = members_imported + capacity_count
        result.rows_imported = members_imported + capacity_count

        session.commit()
        result.success = True

    except Exception as exc:
        logger.exception("Error importing capacity plan")
        session.rollback()
        result.success = False
        result.errors.append(str(exc))

    return result


# ---------------------------------------------------------------------------
# import_model_assumptions
# ---------------------------------------------------------------------------


def import_model_assumptions(session: Session) -> ImportResult:
    """Import 'Model Assumptions' sheet into model_assumptions table.

    Simple key-value parsing, reusing logic from seed_data.py.
    """
    sheet_name = "Model Assumptions"
    result = ImportResult(sheet=sheet_name)

    try:
        service = get_sheets_client()
        resp = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=SPREADSHEET_ID, range=f"'{sheet_name}'")
            .execute()
        )
        all_rows = resp.get("values", [])

        if not all_rows:
            result.errors.append("Sheet is empty")
            result.success = False
            return result

        # Known category headers
        categories = {
            "CLIENT CATEGORIZATION": "CLIENT_CATEGORIZATION",
            "RAMP-UP PERIODS (TEAM)": "RAMP_UP_PERIODS",
            "WEEKLY & MONTHLY CAPACITY": "WEEKLY_MONTHLY_CAPACITY",
            "IDEAL CAPACITY": "IDEAL_CAPACITY",
            "NEW CLIENTS PER POD PER MONTH": "NEW_CLIENTS_PER_POD",
        }

        current_category: str | None = None

        for row in all_rows:
            result.rows_parsed += 1
            first_col = _cell(row, 0)

            # Check if this row is a category header
            if first_col in categories:
                current_category = categories[first_col]
                continue

            if current_category is None:
                continue

            # Skip empty/header rows
            if not first_col or first_col in ("MODEL ASSUMPTIONS", "nan", ""):
                continue

            def _upsert_assumption(
                category: str, key: str, value: str, description: str | None = None
            ):
                existing = (
                    session.execute(
                        select(ModelAssumption).where(
                            ModelAssumption.category == category,
                            ModelAssumption.key == key,
                        )
                    )
                    .scalars()
                    .first()
                )
                if existing:
                    existing.value = value
                    if description is not None:
                        existing.description = description
                else:
                    session.add(
                        ModelAssumption(
                            category=category,
                            key=key,
                            value=value,
                            description=description,
                        )
                    )
                result.rows_imported += 1

            if current_category == "CLIENT_CATEGORIZATION":
                key = first_col
                value = _cell(row, 1)
                if value and value != "nan":
                    _upsert_assumption(
                        current_category,
                        key,
                        value,
                        f"Client categorization: {key}",
                    )

            elif current_category == "RAMP_UP_PERIODS":
                role = first_col
                col1 = _cell(row, 1)
                col2 = _cell(row, 2)
                col3 = _cell(row, 3)
                col4 = _cell(row, 4) if len(row) > 4 else ""

                if col1 in ("percentage", "articles"):
                    key = f"{role}_{col1}"
                    value = f"M1={col2}, M2={col3}, M3+={col4}" if col4 else f"M1={col2}, M2={col3}"
                    _upsert_assumption(
                        current_category,
                        key,
                        value,
                        f"Ramp-up {col1} for {role}",
                    )
                elif col2 and col2 != "nan":
                    key = f"ramp_{role}"
                    value = (
                        f"M1={col1}, M2={col2}, M3={col3}, M4={col4}"
                        if col4
                        else f"M1={col1}, M2={col2}, M3={col3}"
                    )
                    _upsert_assumption(current_category, key, value)

            elif current_category == "WEEKLY_MONTHLY_CAPACITY":
                role = first_col
                per_week = _cell(row, 1)
                per_month = _cell(row, 2)
                comments_val = _cell(row, 3) if len(row) > 3 else ""

                if per_week and per_week != "nan" and per_week != "per week":
                    desc = comments_val if comments_val and comments_val != "nan" else None
                    _upsert_assumption(current_category, f"{role}_weekly", per_week, desc)
                    _upsert_assumption(current_category, f"{role}_monthly", per_month, desc)

            elif current_category == "IDEAL_CAPACITY":
                pct = first_col
                status_val = _cell(row, 1)
                desc = _cell(row, 2)

                if status_val and status_val != "nan" and status_val != "status":
                    _upsert_assumption(
                        current_category,
                        pct,
                        status_val,
                        desc if desc and desc != "nan" else None,
                    )

            elif current_category == "NEW_CLIENTS_PER_POD":
                key = first_col
                value = _cell(row, 1)
                if value and value != "nan":
                    _upsert_assumption(current_category, key, value)

        session.commit()
        result.success = True

    except Exception as exc:
        logger.exception("Error importing Model Assumptions")
        session.rollback()
        result.success = False
        result.errors.append(str(exc))

    return result


# ---------------------------------------------------------------------------
# import_operating_model
# ---------------------------------------------------------------------------


def import_operating_model(session: Session) -> ImportResult:
    """Import 'Editorial Operating Model' sheet into production_history.

    Row 1: Actual/Projection labels (col 1-41 = Actual, col 42-53 = Projection)
    Row 2: Month headers (col 1 = Oct 2022 through col 53 = Feb 2027)
    Row 3: Production total row (skip)
    Row 4+: Individual client rows (col 0 has indented client name)
    """
    sheet_name = "Editorial Operating Model"
    result = ImportResult(sheet=sheet_name)

    try:
        service = get_sheets_client()
        resp = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=SPREADSHEET_ID, range=f"'{sheet_name}'")
            .execute()
        )
        all_rows = resp.get("values", [])

        if len(all_rows) < 4:
            result.errors.append("Sheet has fewer than 4 rows; cannot determine data")
            result.success = False
            return result

        # Row 0 (index 0): Actual/Projection labels
        label_row = all_rows[0]
        # Row 1 (index 1): Month headers
        month_row = all_rows[1]

        # Determine the Actual/Projection boundary from the label row
        # Columns with "Actual" are actual, columns with "Projection" are projected
        actual_cols: set[int] = set()
        projection_cols: set[int] = set()
        for col_idx in range(1, len(label_row)):
            label = _cell(label_row, col_idx).strip()
            if label == "Actual":
                actual_cols.add(col_idx)
            elif label == "Projection":
                projection_cols.add(col_idx)

        # Parse month headers: col 1 = "Oct 2022", col 2 = "Nov 2022", etc.
        month_map: dict[int, tuple[int, int]] = {}  # col_idx -> (year, month)
        for col_idx in range(1, len(month_row)):
            year, month = parse_month_str(_cell(month_row, col_idx))
            if year is not None and month is not None:
                month_map[col_idx] = (year, month)

        # Build client name -> id lookup
        clients = session.execute(select(Client)).scalars().all()
        name_lookup: dict[str, int] = {}
        for c in clients:
            name_lookup[c.name.lower().strip()] = c.id

        # Common aliases (same as import_delivered_invoiced)
        alias_map = {
            "get flex": "flex",
            "genstoreai": "genstoreai",
            "genstore ai": "genstoreai",
            "blvd": "boulevard",
            "meta fb": "meta bmg",
            "meta bmg": "meta bmg",
            "college hunks": "college hunks",
        }
        for alias, canonical in alias_map.items():
            if canonical in name_lookup and alias not in name_lookup:
                name_lookup[alias] = name_lookup[canonical]

        # Skip row 0 (labels), row 1 (month headers), row 2 (Production total)
        # Data rows start at index 3
        data_rows = all_rows[3:]

        for row in data_rows:
            result.rows_parsed += 1

            client_name = _cell(row, 0).strip()
            if not client_name:
                continue
            # Skip summary/total rows
            if any(
                kw in client_name.lower() for kw in ("production", "total", "median", "average")
            ):
                continue

            # Look up client_id
            client_id = name_lookup.get(client_name.lower().strip())
            if client_id is None:
                # Try partial matching
                for key, cid in name_lookup.items():
                    if client_name.lower().strip() in key or key in client_name.lower().strip():
                        client_id = cid
                        break

            if client_id is None:
                result.errors.append(f"Client '{client_name}' not found in DB, skipping")
                continue

            for col_idx, (year, month) in month_map.items():
                val = safe_int(_cell(row, col_idx))
                if val is None:
                    continue

                is_actual = col_idx in actual_cols
                articles_actual = val if is_actual else None
                articles_projected = val if not is_actual else None

                # Upsert: match by (client_id, year, month)
                existing = (
                    session.execute(
                        select(ProductionHistory).where(
                            ProductionHistory.client_id == client_id,
                            ProductionHistory.year == year,
                            ProductionHistory.month == month,
                        )
                    )
                    .scalars()
                    .first()
                )

                if existing:
                    existing.articles_actual = articles_actual
                    existing.articles_projected = articles_projected
                    existing.is_actual = is_actual
                    existing.source = "operating_model"
                else:
                    session.add(
                        ProductionHistory(
                            client_id=client_id,
                            year=year,
                            month=month,
                            articles_actual=articles_actual,
                            articles_projected=articles_projected,
                            is_actual=is_actual,
                            source="operating_model",
                        )
                    )

                result.rows_imported += 1

        session.commit()
        result.success = True

    except Exception as exc:
        logger.exception("Error importing Editorial Operating Model")
        session.rollback()
        result.success = False
        result.errors.append(str(exc))

    return result


# ---------------------------------------------------------------------------
# import_delivery_schedules
# ---------------------------------------------------------------------------


def import_delivery_schedules(session: Session) -> ImportResult:
    """Import 'Delivery Schedules' sheet into delivery_templates.

    Structure: Multiple template sections for SOW sizes 240, 220, 180, 120, 125.
    Row 5 (index 4): "Total Articles" header with SOW sizes in cols 2, 7, 12, 17, 22.
    Row 6 (index 5): Column sub-headers.
    Rows 7-18 (index 6-17): M1-M12 data rows.
    Each template has: Invoicing, Cumulative, Articles, Cumulative, Difference columns.
    """
    sheet_name = "Delivery Schedules"
    result = ImportResult(sheet=sheet_name)

    try:
        service = get_sheets_client()
        resp = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=SPREADSHEET_ID, range=f"'{sheet_name}'")
            .execute()
        )
        all_rows = resp.get("values", [])

        if len(all_rows) < 18:
            result.errors.append("Sheet has too few rows to parse delivery schedules")
            result.success = False
            return result

        # The main template sections are side by side in the first table block.
        # Row index 4 has "Total Articles" and SOW sizes:
        #   col 2=240, col 7=220, col 12=180, col 17=120, col 22=125
        # Row index 5 has sub-headers.
        # Rows 6-17 have M1-M12 data.
        # For each SOW size template, columns are:
        #   Invoicing, Cumulative, Articles, Cumulative, Difference
        # Starting at the SOW size column offset.

        sow_configs = [
            # (sow_size, invoicing_col, inv_cum_col, articles_col, art_cum_col)
            (240, 2, 3, 4, 5),
            (220, 7, 8, 9, 10),
            (180, 12, 13, 14, 15),
            (120, 17, 18, 19, 20),
            (125, 22, 23, 24, 25),
        ]

        for sow_size, inv_col, inv_cum_col, art_col, art_cum_col in sow_configs:
            for month_idx in range(12):
                row_idx = 6 + month_idx  # M1 at index 6, M12 at index 17
                if row_idx >= len(all_rows):
                    break

                row = all_rows[row_idx]
                result.rows_parsed += 1

                month_number = month_idx + 1
                invoicing_target = safe_int(_cell(row, inv_col))
                invoicing_cumulative = safe_int(_cell(row, inv_cum_col))
                delivery_target = safe_int(_cell(row, art_col))
                delivery_cumulative = safe_int(_cell(row, art_cum_col))

                # Upsert: match by (sow_size, month_number)
                existing = (
                    session.execute(
                        select(DeliveryTemplate).where(
                            DeliveryTemplate.sow_size == sow_size,
                            DeliveryTemplate.month_number == month_number,
                        )
                    )
                    .scalars()
                    .first()
                )

                if existing:
                    existing.invoicing_target = invoicing_target
                    existing.invoicing_cumulative = invoicing_cumulative
                    existing.delivery_target = delivery_target
                    existing.delivery_cumulative = delivery_cumulative
                else:
                    session.add(
                        DeliveryTemplate(
                            sow_size=sow_size,
                            month_number=month_number,
                            invoicing_target=invoicing_target,
                            invoicing_cumulative=invoicing_cumulative,
                            delivery_target=delivery_target,
                            delivery_cumulative=delivery_cumulative,
                        )
                    )

                result.rows_imported += 1

        session.commit()
        result.success = True

    except Exception as exc:
        logger.exception("Error importing Delivery Schedules")
        session.rollback()
        result.success = False
        result.errors.append(str(exc))

    return result


# ---------------------------------------------------------------------------
# import_engagement_requirements
# ---------------------------------------------------------------------------


def import_engagement_requirements(session: Session) -> ImportResult:
    """Import 'Editorial Engagement Requirements' sheet into engagement_rules.

    Skips title/header rows, finds the column-header row (#, Area, Rule, ...),
    then parses 10 rules.
    """
    sheet_name = "Editorial Engagement Requirements"
    result = ImportResult(sheet=sheet_name)

    try:
        service = get_sheets_client()
        resp = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=SPREADSHEET_ID, range=f"'{sheet_name}'")
            .execute()
        )
        all_rows = resp.get("values", [])

        if not all_rows:
            result.errors.append("Sheet is empty")
            result.success = False
            return result

        # Find the header row containing "#" and "Area"
        header_row_idx = None
        for idx, row in enumerate(all_rows):
            for col_idx, cell_val in enumerate(row):
                if str(cell_val).strip() == "#":
                    # Check next column for "Area"
                    if col_idx + 1 < len(row) and str(row[col_idx + 1]).strip() == "Area":
                        header_row_idx = idx
                        # Record the column offset where "#" appears
                        col_offset = col_idx
                        break
            if header_row_idx is not None:
                break

        if header_row_idx is None:
            result.errors.append("Could not find header row with '#' and 'Area'")
            result.success = False
            return result

        # Parse data rows after the header
        data_rows = all_rows[header_row_idx + 1 :]

        for row in data_rows:
            result.rows_parsed += 1

            rule_num_str = _cell(row, col_offset)
            rule_num = safe_int(rule_num_str)
            if rule_num is None:
                continue

            area = _cell(row, col_offset + 1) or ""
            rule_name = _cell(row, col_offset + 2) or ""
            description = _cell(row, col_offset + 3) or None
            owner = _cell(row, col_offset + 4) or None
            timing = _cell(row, col_offset + 5) or None
            consequences = _cell(row, col_offset + 6) or None

            if not area or not rule_name:
                continue

            # Upsert: match by rule_number
            existing = (
                session.execute(
                    select(EngagementRule).where(
                        EngagementRule.rule_number == rule_num,
                    )
                )
                .scalars()
                .first()
            )

            if existing:
                existing.area = area
                existing.rule_name = rule_name
                existing.description = description
                existing.owner = owner
                existing.timing = timing
                existing.consequences = consequences
            else:
                session.add(
                    EngagementRule(
                        rule_number=rule_num,
                        area=area,
                        rule_name=rule_name,
                        description=description,
                        owner=owner,
                        timing=timing,
                        consequences=consequences,
                    )
                )

            result.rows_imported += 1

        session.commit()
        result.success = True

    except Exception as exc:
        logger.exception("Error importing Editorial Engagement Requirements")
        session.rollback()
        result.success = False
        result.errors.append(str(exc))

    return result


# ---------------------------------------------------------------------------
# import_meta_deliveries
# ---------------------------------------------------------------------------


def import_meta_deliveries(session: Session) -> ImportResult:
    """Import 'Meta Calendar Month Deliveries' sheet into deliverables_monthly.

    Row 0: Actual/Projection labels
    Row 1: Month headers (Oct 2025 - Sep 2026)
    Row 2: Meta BMG data
    Row 3: Manus data
    Row 4: Meta RL data
    Row 5: Meta AI data
    """
    sheet_name = "Meta Calendar Month Deliveries"
    result = ImportResult(sheet=sheet_name)

    try:
        service = get_sheets_client()
        resp = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=SPREADSHEET_ID, range=f"'{sheet_name}'")
            .execute()
        )
        all_rows = resp.get("values", [])

        if len(all_rows) < 6:
            result.errors.append("Sheet has too few rows")
            result.success = False
            return result

        # Row 1 (index 1): month headers
        month_row = all_rows[1]
        month_map: dict[int, tuple[int, int]] = {}
        for col_idx in range(1, len(month_row)):
            year, month = parse_month_str(_cell(month_row, col_idx))
            if year is not None and month is not None:
                month_map[col_idx] = (year, month)

        # Build client name -> id lookup
        clients = session.execute(select(Client)).scalars().all()
        name_lookup: dict[str, int] = {}
        for c in clients:
            name_lookup[c.name.lower().strip()] = c.id

        # Client data rows at indices 2-5
        client_rows = [
            (2, "Meta BMG"),
            (3, "Manus"),
            (4, "Meta RL"),
            (5, "Meta AI"),
        ]

        for row_idx, expected_name in client_rows:
            if row_idx >= len(all_rows):
                continue

            row = all_rows[row_idx]
            result.rows_parsed += 1

            client_name = _cell(row, 0).strip()
            if not client_name:
                client_name = expected_name

            # Look up client_id
            client_id = name_lookup.get(client_name.lower().strip())
            if client_id is None:
                # Try partial matching
                for key, cid in name_lookup.items():
                    if client_name.lower().strip() in key or key in client_name.lower().strip():
                        client_id = cid
                        break

            if client_id is None:
                result.errors.append(f"Client '{client_name}' not found in DB, skipping")
                continue

            for col_idx, (year, month) in month_map.items():
                val = safe_int(_cell(row, col_idx))
                if val is None:
                    continue

                # Upsert into deliverables_monthly
                existing = (
                    session.execute(
                        select(DeliverableMonthly).where(
                            DeliverableMonthly.client_id == client_id,
                            DeliverableMonthly.year == year,
                            DeliverableMonthly.month == month,
                        )
                    )
                    .scalars()
                    .first()
                )

                if existing:
                    existing.articles_delivered = val
                    existing.updated_by = "sheets_migration"
                else:
                    session.add(
                        DeliverableMonthly(
                            client_id=client_id,
                            year=year,
                            month=month,
                            articles_delivered=val,
                            updated_by="sheets_migration",
                        )
                    )

                result.rows_imported += 1

        session.commit()
        result.success = True

    except Exception as exc:
        logger.exception("Error importing Meta Calendar Month Deliveries")
        session.rollback()
        result.success = False
        result.errors.append(str(exc))

    return result


# ---------------------------------------------------------------------------
# import_ai_monitoring_data
# ---------------------------------------------------------------------------


def import_ai_monitoring_data(session: Session) -> ImportResult:
    sheet_name = "AI Monitoring - Data"
    result = ImportResult(sheet=sheet_name)
    try:
        service = get_sheets_client()
        resp = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=AI_MONITORING_ID, range="'Data'")
            .execute()
        )
        all_rows = resp.get("values", [])
        data_rows = all_rows[1:]  # skip header

        for row in data_rows:
            result.rows_parsed += 1
            pod = _cell(row, 0)
            client = _cell(row, 1)
            title = _cell(row, 2)
            if not client or not title:
                continue

            content = _cell(row, 3)
            v1 = safe_pct(_cell(row, 4))
            v2 = safe_pct(_cell(row, 5))
            rec = _cell(row, 6).upper().replace("/", "_").replace(" ", "_")
            # Normalize: "REVIEW/REWRITE" -> "REVIEW_REWRITE", "FULL PASS" -> "FULL_PASS", "PARTIAL PASS" -> "PARTIAL_PASS"
            notes = _cell(row, 7)
            action = _cell(row, 8)
            writer = _cell(row, 9)
            editor = _cell(row, 10)
            link = _cell(row, 11)
            date_proc = parse_date(_cell(row, 12))
            month_str = _cell(row, 13)

            existing = (
                session.execute(
                    select(AIMonitoringRecord).where(
                        AIMonitoringRecord.pod == pod,
                        AIMonitoringRecord.client == client,
                        AIMonitoringRecord.topic_title == title,
                        AIMonitoringRecord.date_processed == date_proc,
                        AIMonitoringRecord.is_rewrite.is_(False),
                    )
                )
                .scalars()
                .first()
            )

            data = dict(
                pod=pod,
                client=client,
                topic_title=title,
                topic_content=content[:2000] if content else None,
                surfer_v1_score=v1,
                surfer_v2_score=v2,
                recommendation=rec,
                manual_review_notes=notes,
                action=action,
                writer_name=writer,
                editor_name=editor,
                article_link=link,
                date_processed=date_proc,
                month=month_str,
                is_rewrite=False,
                is_flagged=False,
            )

            if existing:
                for k, v in data.items():
                    setattr(existing, k, v)
            else:
                session.add(AIMonitoringRecord(**data))
            result.rows_imported += 1

        session.commit()
    except Exception as exc:
        logger.exception("Error importing AI Monitoring Data")
        session.rollback()
        result.success = False
        result.errors.append(str(exc))
    return result


# ---------------------------------------------------------------------------
# import_ai_monitoring_rewrites
# ---------------------------------------------------------------------------


def import_ai_monitoring_rewrites(session: Session) -> ImportResult:
    sheet_name = "AI Monitoring - Rewrites"
    result = ImportResult(sheet=sheet_name)
    try:
        service = get_sheets_client()
        resp = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=AI_MONITORING_ID, range="'Rewrites'")
            .execute()
        )
        all_rows = resp.get("values", [])
        data_rows = all_rows[2:]  # headers at row 1, data from row 2

        for row in data_rows:
            result.rows_parsed += 1
            client = _cell(row, 0)
            title = _cell(row, 1)
            if not client or not title:
                continue

            content = _cell(row, 2)
            v1 = safe_pct(_cell(row, 3))
            v2 = safe_pct(_cell(row, 4))
            rec = _cell(row, 5).upper().replace("/", "_").replace(" ", "_")
            notes = _cell(row, 6)
            action = _cell(row, 7)
            writer = _cell(row, 8)
            editor = _cell(row, 9)
            link = _cell(row, 10)
            date_proc = parse_date(_cell(row, 11))

            existing = (
                session.execute(
                    select(AIMonitoringRecord).where(
                        AIMonitoringRecord.client == client,
                        AIMonitoringRecord.topic_title == title,
                        AIMonitoringRecord.is_rewrite.is_(True),
                    )
                )
                .scalars()
                .first()
            )

            data = dict(
                pod="Rewrites",
                client=client,
                topic_title=title,
                topic_content=content[:2000] if content else None,
                surfer_v1_score=v1,
                surfer_v2_score=v2,
                recommendation=rec,
                manual_review_notes=notes,
                action=action,
                writer_name=writer,
                editor_name=editor,
                article_link=link,
                date_processed=date_proc,
                month=None,
                is_rewrite=True,
                is_flagged=False,
            )

            if existing:
                for k, v in data.items():
                    setattr(existing, k, v)
            else:
                session.add(AIMonitoringRecord(**data))
            result.rows_imported += 1

        session.commit()
    except Exception as exc:
        logger.exception("Error importing AI Monitoring Rewrites")
        session.rollback()
        result.success = False
        result.errors.append(str(exc))
    return result


# ---------------------------------------------------------------------------
# import_ai_monitoring_flags
# ---------------------------------------------------------------------------


def import_ai_monitoring_flags(session: Session) -> ImportResult:
    sheet_name = "AI Monitoring - Flags"
    result = ImportResult(sheet=sheet_name)
    try:
        service = get_sheets_client()
        resp = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=AI_MONITORING_ID, range="'Yellow/Red Flags_v2'")
            .execute()
        )
        all_rows = resp.get("values", [])
        data_rows = all_rows[1:]

        for row in data_rows:
            result.rows_parsed += 1
            client = _cell(row, 0)
            title = _cell(row, 1)
            if not client or not title:
                continue

            date_proc = parse_date(_cell(row, 11))

            # Try to find existing record from Data import and mark as flagged
            existing = (
                session.execute(
                    select(AIMonitoringRecord).where(
                        AIMonitoringRecord.client == client,
                        AIMonitoringRecord.topic_title == title,
                        AIMonitoringRecord.date_processed == date_proc,
                        AIMonitoringRecord.is_rewrite.is_(False),
                    )
                )
                .scalars()
                .first()
            )

            if existing:
                existing.is_flagged = True
            else:
                # Insert as new flagged record
                content = _cell(row, 2)
                v1 = safe_pct(_cell(row, 3))
                v2 = safe_pct(_cell(row, 4))
                rec = _cell(row, 5).upper().replace("/", "_").replace(" ", "_")
                notes = _cell(row, 6)
                action = _cell(row, 7)
                writer = _cell(row, 8)
                editor = _cell(row, 9)
                link = _cell(row, 10)

                session.add(
                    AIMonitoringRecord(
                        pod="Flagged",
                        client=client,
                        topic_title=title,
                        topic_content=content[:2000] if content else None,
                        surfer_v1_score=v1,
                        surfer_v2_score=v2,
                        recommendation=rec,
                        manual_review_notes=notes,
                        action=action,
                        writer_name=writer,
                        editor_name=editor,
                        article_link=link,
                        date_processed=date_proc,
                        is_rewrite=False,
                        is_flagged=True,
                    )
                )
            result.rows_imported += 1

        session.commit()
    except Exception as exc:
        logger.exception("Error importing AI Monitoring Flags")
        session.rollback()
        result.success = False
        result.errors.append(str(exc))
    return result


# ---------------------------------------------------------------------------
# import_ai_monitoring_surfer
# ---------------------------------------------------------------------------


def import_ai_monitoring_surfer(session: Session) -> ImportResult:
    sheet_name = "AI Monitoring - Surfer Usage"
    result = ImportResult(sheet=sheet_name)
    try:
        service = get_sheets_client()
        resp = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=AI_MONITORING_ID, range="'Surfer''s API usage'")
            .execute()
        )
        all_rows = resp.get("values", [])
        data_rows = all_rows[1:]

        for row in data_rows:
            result.rows_parsed += 1
            year_month = _cell(row, 4)  # "Year/Month" column e.g. "Oct 23, 2025 - Nov 22, 2025"
            if not year_month:
                continue

            existing = (
                session.execute(
                    select(SurferAPIUsage).where(SurferAPIUsage.year_month == year_month)
                )
                .scalars()
                .first()
            )

            data = dict(
                year_month=year_month,
                start_date=f"{_cell(row, 0)} {_cell(row, 1)}",
                end_date=f"{_cell(row, 2)} {_cell(row, 3)}",
                pod_1=safe_int(_cell(row, 5), 0),
                pod_2=safe_int(_cell(row, 6), 0),
                pod_3=safe_int(_cell(row, 7), 0),
                pod_4=safe_int(_cell(row, 8), 0),
                pod_5=safe_int(_cell(row, 9), 0),
                auditioning_writers=safe_int(_cell(row, 10), 0),
                rewrites=safe_int(_cell(row, 11), 0),
                total_spent=safe_int(_cell(row, 13), 0),
                remaining_calls=safe_int(_cell(row, 14)),
            )

            if existing:
                for k, v in data.items():
                    setattr(existing, k, v)
            else:
                session.add(SurferAPIUsage(**data))
            result.rows_imported += 1

        session.commit()
    except Exception as exc:
        logger.exception("Error importing Surfer API Usage")
        session.rollback()
        result.success = False
        result.errors.append(str(exc))
    return result


# ---------------------------------------------------------------------------
# import_cumulative
# ---------------------------------------------------------------------------


def import_cumulative(session: Session) -> ImportResult:
    sheet_name = "Master Tracker - Cumulative"
    result = ImportResult(sheet=sheet_name)
    try:
        service = get_sheets_client()
        resp = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=MASTER_TRACKER_ID, range="'Cumulative'")
            .execute()
        )
        all_rows = resp.get("values", [])
        data_rows = all_rows[4:]  # headers at row 3, data from row 4

        for row in data_rows:
            result.rows_parsed += 1
            client_name = _cell(row, 2)
            if not client_name:
                continue

            existing = (
                session.execute(
                    select(CumulativeMetric).where(CumulativeMetric.client_name == client_name)
                )
                .scalars()
                .first()
            )

            data = dict(
                status=_cell(row, 0) or None,
                account_team_pod=_cell(row, 1) or None,
                client_name=client_name,
                client_type=_cell(row, 3) or None,
                content_type=_cell(row, 4) or None,
                topics_sent=safe_int(_cell(row, 5)),
                topics_approved=safe_int(_cell(row, 6)),
                topics_pct_approved=_cell(row, 7) or None,
                cbs_sent=safe_int(_cell(row, 8)),
                cbs_approved=safe_int(_cell(row, 9)),
                cbs_pct_approved=_cell(row, 10) or None,
                articles_sent=safe_int(_cell(row, 11)),
                articles_approved=safe_int(_cell(row, 12)),
                articles_difference=safe_int(_cell(row, 13)),
                articles_pct_approved=_cell(row, 14) or None,
                published_live=safe_int(_cell(row, 15)),
                published_pct_live=_cell(row, 16) or None,
                last_update=parse_date(_cell(row, 17)),
                comments=_cell(row, 18) or None,
            )

            if existing:
                for k, v in data.items():
                    setattr(existing, k, v)
            else:
                session.add(CumulativeMetric(**data))
            result.rows_imported += 1

        session.commit()
    except Exception as exc:
        logger.exception("Error importing Cumulative metrics")
        session.rollback()
        result.success = False
        result.errors.append(str(exc))
    return result


# ---------------------------------------------------------------------------
# import_goals_vs_delivery
# ---------------------------------------------------------------------------


def import_goals_vs_delivery(session: Session, mode: str = "current") -> ImportResult:
    """Import the per-month Goals vs Delivery tabs from the Master Tracker.

    mode="current" (default) — only re-import the current calendar month's tab,
    plus any past-month tabs that haven't been recorded in `sheet_sync_history`
    yet (auto first-seen import). Already-synced past-month tabs are skipped.

    mode="all" — force a full re-import of every tab. Intended for the
    "Sync historical months" action when someone retroactively edits an
    older month's numbers.
    """
    sheet_name = "Master Tracker - Goals vs Delivery"
    result = ImportResult(sheet=sheet_name)
    try:
        service = get_sheets_client()

        # First, discover all Goals vs Delivery sheets
        meta = (
            service.spreadsheets()
            .get(spreadsheetId=MASTER_TRACKER_ID, fields="sheets.properties")
            .execute()
        )
        gvd_sheets = []
        for s in meta.get("sheets", []):
            title = s.get("properties", {}).get("title", "")
            if "] Goals vs Delivery" in title and "[Template]" not in title:
                gvd_sheets.append(title)

        gvd_sheets.sort()

        # Sheet tabs use "<Month name> <YYYY>" — match against today's date in the
        # same locale-free format so we know which tab is "current" right now.
        current_month_year = datetime.now().strftime("%B %Y")

        # Snapshot the set of past-month tabs we've already imported, so the
        # normal (current-mode) sync can skip them without touching the DB
        # for each tab.
        synced_past_tabs: set[str] = set()
        if mode == "current":
            synced_rows = (
                session.execute(
                    select(SheetSyncHistory.tab_name).where(
                        SheetSyncHistory.sheet_name == sheet_name
                    )
                )
                .scalars()
                .all()
            )
            synced_past_tabs = set(synced_rows)

        tabs_imported = 0
        tabs_skipped = 0

        for gvd_sheet in gvd_sheets:
            # Extract month_year from sheet name like "[March 2026] Goals vs Delivery"
            match = re.match(r"\[(\w+ \d{4})\]", gvd_sheet)
            if not match:
                continue
            month_year = match.group(1)
            is_current_tab = month_year == current_month_year

            # In current-mode: always import the current-month tab, and any
            # past-month tab we've never recorded. Skip frozen past tabs.
            if mode == "current" and not is_current_tab and gvd_sheet in synced_past_tabs:
                tabs_skipped += 1
                continue

            resp = (
                service.spreadsheets()
                .values()
                .get(spreadsheetId=MASTER_TRACKER_ID, range=f"'{gvd_sheet}'")
                .execute()
            )
            all_rows = resp.get("values", [])
            if len(all_rows) < 5:
                continue

            # Row 2 has week dates, row 4 has column headers
            date_row = all_rows[2] if len(all_rows) > 2 else []
            header_row = all_rows[4] if len(all_rows) > 4 else []
            data_rows = all_rows[5:]

            # Detect week blocks: find all "Delivered today" positions in header_row for CB blocks
            # Each CB block starts with "Delivered today" after the fixed cols (0-5)
            week_starts = []
            for ci, h in enumerate(header_row):
                if ci >= 6 and str(h).strip().lower() == "delivered today":
                    week_starts.append(ci)

            # Pattern: fixed(6) + [CB block(6 cols) + AD block(8 cols)] per week = 14 per week
            num_weeks = (len(header_row) - 6) // 14 + 1

            rows_this_tab = 0
            for row in data_rows:
                result.rows_parsed += 1
                client_name = _cell(row, 0)
                if not client_name or client_name.lower() in ("client", ""):
                    continue

                growth_pod = _cell(row, 1) or None
                ed_pod = _cell(row, 2) or None
                client_type = _cell(row, 3) or None
                content_type = _cell(row, 4) or None
                ratios = _cell(row, 5) or None

                # Import ALL weeks (not just the latest)
                for w in range(num_weeks):
                    week_num = w + 1
                    cb_base = 6 + w * 14
                    ad_base = cb_base + 6

                    # Skip weeks with no data at all
                    has_cb = cb_base < len(row) and any(
                        _cell(row, cb_base + i) for i in range(6) if cb_base + i < len(row)
                    )
                    has_ad = ad_base < len(row) and any(
                        _cell(row, ad_base + i) for i in range(8) if ad_base + i < len(row)
                    )
                    if not has_cb and not has_ad:
                        continue

                    # Get week date from date_row
                    week_date = (
                        parse_date(_cell(date_row, cb_base)) if cb_base < len(date_row) else None
                    )

                    existing = (
                        session.execute(
                            select(GoalsVsDelivery).where(
                                GoalsVsDelivery.month_year == month_year,
                                GoalsVsDelivery.week_number == week_num,
                                GoalsVsDelivery.client_name == client_name,
                            )
                        )
                        .scalars()
                        .first()
                    )

                    data = dict(
                        month_year=month_year,
                        week_number=week_num,
                        week_date=week_date,
                        client_name=client_name,
                        growth_team_pod=growth_pod,
                        editorial_team_pod=ed_pod,
                        client_type=client_type,
                        content_type=content_type,
                        ratios=ratios,
                        cb_delivered_today=safe_int(_cell(row, cb_base)),
                        cb_projection=safe_int(_cell(row, cb_base + 1)),
                        cb_delivered_to_date=safe_int(_cell(row, cb_base + 2)),
                        cb_monthly_goal=safe_int(_cell(row, cb_base + 3)),
                        cb_pct_of_goal=_cell(row, cb_base + 4) or None,
                        cb_comments=_cell(row, cb_base + 5) or None,
                        ad_revisions=safe_int(_cell(row, ad_base)),
                        ad_delivered_today=safe_int(_cell(row, ad_base + 1)),
                        ad_projection=safe_int(_cell(row, ad_base + 2)),
                        ad_cb_backlog=safe_int(_cell(row, ad_base + 3)),
                        ad_delivered_to_date=safe_int(_cell(row, ad_base + 4)),
                        ad_monthly_goal=safe_int(_cell(row, ad_base + 5)),
                        ad_pct_of_goal=_cell(row, ad_base + 6) or None,
                        ad_comments=_cell(row, ad_base + 7) or None,
                    )

                    if existing:
                        for k, v in data.items():
                            setattr(existing, k, v)
                    else:
                        session.add(GoalsVsDelivery(**data))
                    rows_this_tab += 1

            result.rows_imported += rows_this_tab
            tabs_imported += 1

            # Record past-month tabs in sheet_sync_history so the normal sync
            # skips them next time. The current-month tab is NOT recorded —
            # it's always re-imported.
            if not is_current_tab:
                sync_row = (
                    session.execute(
                        select(SheetSyncHistory).where(
                            SheetSyncHistory.sheet_name == sheet_name,
                            SheetSyncHistory.tab_name == gvd_sheet,
                        )
                    )
                    .scalars()
                    .first()
                )
                if sync_row:
                    sync_row.rows_imported = rows_this_tab
                else:
                    session.add(
                        SheetSyncHistory(
                            sheet_name=sheet_name,
                            tab_name=gvd_sheet,
                            month_year=month_year,
                            rows_imported=rows_this_tab,
                        )
                    )

        session.commit()
        logger.info(
            "Goals vs Delivery sync (mode=%s): imported %d tabs, skipped %d frozen tabs",
            mode,
            tabs_imported,
            tabs_skipped,
        )
    except Exception as exc:
        logger.exception("Error importing Goals vs Delivery")
        session.rollback()
        result.success = False
        result.errors.append(str(exc))
    return result


# ---------------------------------------------------------------------------
# import_notion_database
# ---------------------------------------------------------------------------


def import_monthly_kpi_scores(session: Session) -> ImportResult:
    """Import 'Monthly KPI Scores' sheet into kpi_scores table.

    Reads manually-entered KPI scores for Internal Quality, External Quality,
    Mentorship, and Feedback Adoption. Upserts into kpi_scores matching on
    (team_member_id, year, month, kpi_type, client_id).
    """
    result = ImportResult(sheet="Monthly KPI Scores")

    try:
        service = get_sheets_client()

        # Find the sheet — it may have [Mock] prefix or not
        meta = (
            service.spreadsheets()
            .get(spreadsheetId=SPREADSHEET_ID, fields="sheets.properties")
            .execute()
        )
        sheet_name = None
        for s in meta.get("sheets", []):
            title = s.get("properties", {}).get("title", "")
            if "Monthly KPI Scores" in title:
                sheet_name = title
                break

        if not sheet_name:
            result.errors.append("Sheet 'Monthly KPI Scores' not found")
            result.success = False
            return result

        resp = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=SPREADSHEET_ID, range=f"'{sheet_name}'")
            .execute()
        )
        all_rows = resp.get("values", [])
        if len(all_rows) < 5:
            result.errors.append("Sheet has too few rows")
            result.success = False
            return result

        # Build team member lookup: name → id
        members = session.execute(select(TeamMember)).scalars().all()
        member_lookup: dict[str, int] = {}
        for m in members:
            member_lookup[m.name.strip().lower()] = m.id

        # Build client lookup: name → id
        clients_all = session.execute(select(Client)).scalars().all()
        client_lookup: dict[str, int] = {}
        for c in clients_all:
            client_lookup[c.name.strip().lower()] = c.id

        # KPI column mapping: col index → kpi_type
        KPI_COLS = {
            5: "internal_quality",
            6: "external_quality",
            7: "mentorship",
            8: "feedback_adoption",
        }

        # KPI targets
        TARGETS = {
            "internal_quality": 85.0,
            "external_quality": 85.0,
            "mentorship": 80.0,
            "feedback_adoption": 80.0,
        }

        # Data starts at row 4 (index 4, after title + empty + headers + guidance)
        data_rows = all_rows[4:]

        for row in data_rows:
            result.rows_parsed += 1

            month_year_str = _cell(row, 0)
            member_name = _cell(row, 1)
            client_name = _cell(row, 4)

            if not month_year_str or not member_name:
                continue

            # Parse month_year: "March 2026" → (2026, 3)
            parsed = None
            parts = month_year_str.strip().split()
            if len(parts) == 2:
                month_names = {
                    "january": 1,
                    "february": 2,
                    "march": 3,
                    "april": 4,
                    "may": 5,
                    "june": 6,
                    "july": 7,
                    "august": 8,
                    "september": 9,
                    "october": 10,
                    "november": 11,
                    "december": 12,
                }
                m = month_names.get(parts[0].lower())
                try:
                    y = int(parts[1])
                    if m:
                        parsed = (y, m)
                except ValueError:
                    pass

            if not parsed:
                continue
            year, month = parsed

            # Resolve team member
            member_id = member_lookup.get(member_name.strip().lower())
            if member_id is None:
                continue

            # Resolve client (None for aggregate rows)
            client_id = None
            if client_name and client_name != "(Aggregate)":
                client_id = client_lookup.get(client_name.strip().lower())

            # Import each KPI column
            for col_idx, kpi_type in KPI_COLS.items():
                raw = _cell(row, col_idx)
                if not raw:
                    continue

                score = safe_int(raw)
                if score is None:
                    try:
                        score = int(float(raw))
                    except (ValueError, TypeError):
                        continue

                target = TARGETS[kpi_type]

                # Upsert
                existing = (
                    session.execute(
                        select(KpiScore).where(
                            KpiScore.team_member_id == member_id,
                            KpiScore.year == year,
                            KpiScore.month == month,
                            KpiScore.kpi_type == kpi_type,
                            KpiScore.client_id == client_id
                            if client_id is not None
                            else KpiScore.client_id.is_(None),
                        )
                    )
                    .scalars()
                    .first()
                )

                if existing:
                    existing.score = float(score)
                    existing.target = target
                    existing.notes = "from Monthly KPI Scores sheet"
                    existing.updated_by = "kpi_sheet_import"
                else:
                    session.add(
                        KpiScore(
                            team_member_id=member_id,
                            year=year,
                            month=month,
                            kpi_type=kpi_type,
                            score=float(score),
                            target=target,
                            client_id=client_id,
                            notes="from Monthly KPI Scores sheet",
                            updated_by="kpi_sheet_import",
                        )
                    )
                result.rows_imported += 1

        session.commit()
        result.success = True
        logger.info(f"Monthly KPI Scores: {result.rows_imported} scores imported")

    except Exception as exc:
        logger.exception("Error importing Monthly KPI Scores")
        session.rollback()
        result.success = False
        result.errors.append(str(exc))

    return result


# ---------------------------------------------------------------------------
# import_notion_database
# ---------------------------------------------------------------------------


def import_notion_database(session: Session) -> ImportResult:
    """Import Notion database export from Google Sheet into notion_articles table.

    Strategy: the Notion sheet has ~23K rows × ~38 cols, so reading it all in one
    Sheets API call + per-row SELECT/INSERT overruns Railway's proxy timeout. We
    paginate the Sheets read and bulk-upsert with PostgreSQL ON CONFLICT.
    """
    from sqlalchemy import func as sa_func
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    sheet_name = "Notion Database"
    result = ImportResult(sheet=sheet_name)

    notion_sheet_id = settings.notion_database_id
    if not notion_sheet_id:
        result.errors.append("NOTION_DATABASE_ID not configured")
        result.success = False
        return result

    FIELD_MAP = {
        "Case ID": "case_id",
        "Property": "title",
        "Client": "client_name",
        "Writer": "writer",
        "Editor": "editor",
        "Sr Editor": "sr_editor",
        "Current Assignee": "current_assignee",
        "CB Creator": "cb_creator",
        "CB Reviewer": "cb_reviewer",
        "Editorial Team POD": "editorial_pod",
        "Account Team POD": "account_pod",
        "CMS POD": "cms_pod",
        "Content Type": "content_type",
        "Client Type": "client_type",
        "Article Workflow Status": "article_status",
        "CB Workflow Status": "cb_status",
        "CMS Workflow Status": "cms_status",
        "Workflow": "workflow",
        "Client Folder": "client_folder",
        "Published URL": "published_url",
        "WA Link": "wa_link",
        "Article Link": "article_link",
        "CB Link": "cb_link",
        "Page Url": "notion_url",
        "Priority Month": "priority_month",
        "Priority Level": "priority_level",
        "Month": "month",
        "Uploader": "uploader",
        "Created by": "created_by",
        "Notes": "notes",
    }
    DATE_FIELDS = {
        "Created time": "created_date",
        "CB Delivered Date": "cb_delivered_date",
        "CB Deadline": "cb_deadline",
        "Article Delivered Date": "article_delivered_date",
        "Article Deadline": "article_deadline",
        "CMS Delivered Date": "cms_delivered_date",
    }

    PAGE_SIZE = 5000
    BULK_BATCH = 500

    def _flush_upsert(records: list[dict]) -> int:
        if not records:
            return 0
        # De-duplicate on case_id within the same batch — ON CONFLICT can't see
        # two rows with the same conflict target in a single statement.
        by_case: dict[str, dict] = {}
        for r in records:
            by_case[r["case_id"]] = r
        deduped = list(by_case.values())

        stmt = pg_insert(NotionArticle).values(deduped)
        skip = {"id", "case_id", "created_at", "updated_at"}
        update_cols = {
            c.name: getattr(stmt.excluded, c.name)
            for c in NotionArticle.__table__.columns
            if c.name not in skip
        }
        update_cols["updated_at"] = sa_func.now()
        stmt = stmt.on_conflict_do_update(index_elements=["case_id"], set_=update_cols)
        session.execute(stmt)
        return len(deduped)

    try:
        service = get_sheets_client()

        # Fetch header row to establish column order
        header_resp = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=notion_sheet_id, range="'Notion'!1:1")
            .execute()
        )
        header_values = header_resp.get("values", [])
        if not header_values:
            result.errors.append("Sheet has no header row")
            result.success = False
            return result

        col_map: dict[str, int] = {}
        for i, h in enumerate(header_values[0]):
            if h and str(h).strip():
                col_map[str(h).strip()] = i

        case_id_col = col_map.get("Case ID")
        if case_id_col is None:
            result.errors.append("Sheet is missing 'Case ID' column")
            result.success = False
            return result

        # Discover total rows from sheet metadata so we can paginate
        meta = (
            service.spreadsheets()
            .get(spreadsheetId=notion_sheet_id, fields="sheets.properties")
            .execute()
        )
        total_rows = 0
        for s in meta.get("sheets", []):
            if s.get("properties", {}).get("title") == "Notion":
                total_rows = s["properties"].get("gridProperties", {}).get("rowCount", 0)
                break
        if total_rows <= 1:
            result.errors.append("Sheet has too few rows")
            result.success = False
            return result

        pending: list[dict] = []

        for start in range(2, total_rows + 1, PAGE_SIZE):
            end = min(start + PAGE_SIZE - 1, total_rows)
            page_resp = (
                service.spreadsheets()
                .values()
                .get(spreadsheetId=notion_sheet_id, range=f"'Notion'!{start}:{end}")
                .execute()
            )
            page_rows = page_resp.get("values", [])
            logger.info(
                "Notion import: fetched rows %d..%d (%d values)",
                start,
                end,
                len(page_rows),
            )

            for row in page_rows:
                result.rows_parsed += 1
                case_id = _cell(row, case_id_col)
                if not case_id:
                    continue

                data: dict = {"case_id": case_id}
                for sheet_col, model_field in FIELD_MAP.items():
                    ci = col_map.get(sheet_col)
                    if ci is not None:
                        data[model_field] = _cell(row, ci) or None
                for sheet_col, model_field in DATE_FIELDS.items():
                    ci = col_map.get(sheet_col)
                    if ci is not None:
                        raw = _cell(row, ci)
                        data[model_field] = parse_date(raw) if raw else None

                pending.append(data)
                if len(pending) >= BULK_BATCH:
                    result.rows_imported += _flush_upsert(pending)
                    pending = []

        if pending:
            result.rows_imported += _flush_upsert(pending)

        session.commit()
        result.success = True
        logger.info(
            "Notion import complete: parsed=%d imported=%d",
            result.rows_parsed,
            result.rows_imported,
        )

    except Exception as exc:
        logger.exception("Error importing Notion database")
        session.rollback()
        result.success = False
        result.errors.append(str(exc))

    return result


# ---------------------------------------------------------------------------
# import_team_pods
# ---------------------------------------------------------------------------


def import_team_pods(session: Session) -> ImportResult:
    """Read the Team Pods spreadsheet and write the growth pod for each
    matched client back to `clients.growth_pod`.

    Sheet layout (top rows are a title; the real header is a couple of rows
    down and may be repeated). Columns of interest:
      POD NUMBER | CLIENT | GROWTH DIRECTOR | SR GROWTH DIRECTOR
    We scan the whole first tab, tolerate merged-cell blanks on POD NUMBER
    (carry-forward), and match CLIENT against Client.name (case-insensitive).
    """
    sheet_name = "Team Pods"
    result = ImportResult(sheet=sheet_name)

    team_pods_id = getattr(settings, "team_pods_id", None)
    if not team_pods_id:
        result.errors.append("TEAM_PODS_ID not configured")
        result.success = False
        return result

    try:
        service = get_sheets_client()

        # Find the first non-hidden tab
        meta = (
            service.spreadsheets()
            .get(spreadsheetId=team_pods_id, fields="sheets.properties")
            .execute()
        )
        tab_name = ""
        for s in meta.get("sheets", []):
            props = s.get("properties", {})
            if not props.get("hidden"):
                tab_name = props.get("title", "")
                break
        if not tab_name:
            result.errors.append("Team Pods spreadsheet has no visible tab")
            result.success = False
            return result

        resp = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=team_pods_id, range=f"'{tab_name}'")
            .execute()
        )
        rows = resp.get("values", [])
        if len(rows) < 3:
            result.errors.append("Team Pods sheet has too few rows")
            result.success = False
            return result

        # Find the header row — look for one that contains BOTH "POD" and
        # "CLIENT" in the first ~10 rows.
        header_idx = -1
        for i, row in enumerate(rows[:12]):
            joined = " | ".join(str(c).strip().upper() for c in row)
            if ("POD NUMBER" in joined or "POD" in joined) and "CLIENT" in joined:
                header_idx = i
                break
        if header_idx == -1:
            result.errors.append("Could not find header row (POD NUMBER + CLIENT)")
            result.success = False
            return result

        headers = [str(h).strip().upper() for h in rows[header_idx]]

        def col_of(*names: str) -> int | None:
            for n in names:
                nu = n.upper()
                for i, h in enumerate(headers):
                    if h == nu or h.startswith(nu) or nu in h:
                        return i
            return None

        pod_col = col_of("POD NUMBER", "POD #", "POD")
        client_col = col_of("CLIENT")
        if pod_col is None or client_col is None:
            result.errors.append(f"Missing POD NUMBER or CLIENT column — headers: {headers}")
            result.success = False
            return result

        # Build pod→client mapping. POD NUMBER may be blank on repeated rows
        # (merged cells in the sheet), so carry forward.
        client_to_pod: dict[str, str] = {}
        current_pod: str | None = None
        for r in rows[header_idx + 1 :]:
            result.rows_parsed += 1
            raw_pod = _cell(r, pod_col)
            raw_client = _cell(r, client_col)
            if raw_pod:
                # Normalize "1" or "Pod 1" or " 1 " → "Pod 1"
                digits = "".join(ch for ch in raw_pod if ch.isdigit())
                if digits:
                    current_pod = f"Pod {int(digits)}"
            if not raw_client or current_pod is None:
                continue
            # Skip obvious non-client values
            name = raw_client.strip()
            if not name or name.upper() == "CLIENT":
                continue
            client_to_pod[name] = current_pod

        if not client_to_pod:
            result.errors.append("No client → pod mappings found in sheet")
            result.success = False
            return result

        # Update clients.growth_pod — case-insensitive client name match.
        all_clients = session.execute(select(Client)).scalars().all()
        by_lower = {c.name.lower(): c for c in all_clients}
        for sheet_client, pod in client_to_pod.items():
            key = sheet_client.lower()
            c = by_lower.get(key)
            if c is None:
                # Relaxed match: strip punctuation
                normalized = re.sub(r"[^a-z0-9]+", "", key)
                for lc, obj in by_lower.items():
                    if re.sub(r"[^a-z0-9]+", "", lc) == normalized:
                        c = obj
                        break
            if c is None:
                continue
            if c.growth_pod != pod:
                c.growth_pod = pod
            result.rows_imported += 1

        session.commit()
        result.success = True
        logger.info(
            "Team Pods import: parsed=%d matched=%d",
            result.rows_parsed,
            result.rows_imported,
        )

    except Exception as exc:
        logger.exception("Error importing Team Pods")
        session.rollback()
        result.success = False
        result.errors.append(str(exc))

    return result


# ---------------------------------------------------------------------------
# import_all
# ---------------------------------------------------------------------------


def _get_import_func(sheet_name: str):
    """Resolve sheet name to its import function."""
    # Direct match
    func_name = IMPORT_DISPATCH.get(sheet_name)
    if func_name:
        return globals()[func_name]  # nosemgrep

    # Capacity plan sheets match by prefix
    if sheet_name.startswith(CAPACITY_PLAN_PREFIX):
        return import_capacity_plan

    # [Mock] prefix variants — strip prefix and retry
    if sheet_name.startswith("[Mock] "):
        return _get_import_func(sheet_name.removeprefix("[Mock] "))

    # Goals vs Delivery sheets with month prefix
    if "Goals vs Delivery" in sheet_name:
        return import_goals_vs_delivery

    return None


def import_all(session: Session, sheet_names: list[str]) -> list[ImportResult]:
    """Import each requested sheet and return results."""
    results: list[ImportResult] = []

    for name in sheet_names:
        func = _get_import_func(name)
        if func is None:
            results.append(
                ImportResult(
                    sheet=name,
                    success=False,
                    errors=[f"No import handler for sheet '{name}'"],
                )
            )
            continue

        logger.info("Importing sheet: %s", name)
        r = func(session)
        results.append(r)

    # Write audit log
    try:
        audit = AuditLog(
            entity_type="sheets_migration",
            entity_id=None,
            action="IMPORT",
            changes_json=json.dumps(
                {
                    "sheets": [
                        {
                            "sheet": r.sheet,
                            "rows_parsed": r.rows_parsed,
                            "rows_imported": r.rows_imported,
                            "success": r.success,
                            "errors": r.errors,
                        }
                        for r in results
                    ],
                    "all_ok": all(r.success for r in results),
                    "total_imported": sum(r.rows_imported for r in results),
                }
            ),
            performed_by="system",
        )
        session.add(audit)
        session.commit()
    except Exception:
        logger.exception("Failed to write migration audit log entry")

    return results
