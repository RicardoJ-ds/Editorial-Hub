"""Google Sheets migration service — reads live spreadsheet data and upserts into PostgreSQL."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path as _Path

from googleapiclient.discovery import build
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import (
    AIMonitoringRecord,
    ArticleNameAlias,
    ArticleRecord,
    ArticleRevision,
    ArticleUnmappedName,
    AuditLog,
    CapacityProjection,
    Client,
    ClientPodHistory,
    CumulativeMetric,
    DeliverableMonthly,
    DeliveryTemplate,
    EditorialMemberCapacity,
    EditorialWeek,
    EngagementRule,
    GoalsVsDelivery,
    KpiScore,
    ModelAssumption,
    NotionArticle,
    PodAssignment,
    PodAssignmentHistory,
    PodImportIssue,
    PodNameOverride,
    ProductionHistory,
    SheetSyncHistory,
    SurferAPIUsage,
    TeamMember,
)

logger = logging.getLogger(__name__)

SPREADSHEET_ID = settings.spreadsheet_id
MASTER_TRACKER_ID = settings.master_tracker_id
AI_MONITORING_ID = settings.ai_monitoring_id
TEAM_PODS_ID = settings.team_pods_id
ARTICLE_COUNT_ID = settings.article_count_id

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
    "Team Pods - Editorial + Growth": "Per-client pod assignments — editor / writer / account team / growth lead by client. Source-of-truth for pod-aware filtering and group auto-population.",
    "Notion Database": "Article workflow tracking from Notion export — 13K+ records with statuses, dates, assignments",
    "Monthly KPI Scores": "Manual KPI scores entered by SEs — Internal Quality, External Quality, Mentorship, Feedback Adoption",
    "Growth Pods": "Growth team → client mapping from BigQuery (team_pod_assignments ⋈ salesforce_int_Account). Updates clients.growth_pod.",
    "Monthly Article Count": "Per-editor delivered-article log — one tab per client in the [Internal] Monthly Article Count/Revenue sheet. Drives the Team KPIs → Monthly Articles tab.",
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
    "Team Pods - Editorial + Growth": "import_team_pods",
    "Notion Database": "import_notion_database",
    "Monthly KPI Scores": "import_monthly_kpi_scores",
    "Growth Pods": "import_growth_pods",
    "ET CP Pod History": "import_et_cp_pod_history",
    "Monthly Article Count": "import_monthly_article_count",
    "Team Pods History": "import_pod_history",
}
# Capacity plan sheet name is detected dynamically but we keep a prefix for matching
CAPACITY_PLAN_PREFIX = "ET CP 2026"

# Synthetic / computed import steps that the frontend may try to preview
# (because they appear as result rows in SYNC + Re-sync UIs) but that
# have no underlying sheet — return an empty payload for these instead
# of raising. Keep this list in sync with frontend SYNTHETIC_STEPS.
_NON_PREVIEWABLE_STEPS = frozenset(
    {
        "Refresh computed KPIs",
        "Backfill Editorial Pod from history",
    }
)


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------


@dataclass
class TabImportDetail:
    """Per-tab detail for importers that fan out across multiple tabs
    (e.g. Goals vs Delivery has one tab per month)."""

    tab_name: str
    month_year: str
    rows_parsed: int = 0
    rows_imported: int = 0
    status: str = "imported"  # "imported" | "skipped" | "failed"
    skipped_reason: str | None = None
    # Key the /preview/{sheet_name} endpoint understands. Prefixed form
    # (e.g. "Master Tracker - [August 2025] Goals vs Delivery") so the
    # preview router knows which spreadsheet to read.
    preview_key: str | None = None


@dataclass
class ImportResult:
    sheet: str
    rows_parsed: int = 0
    rows_imported: int = 0
    success: bool = True
    errors: list[str] = field(default_factory=list)
    details: list[TabImportDetail] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Helper functions (adapted from seed_data.py for raw list-of-lists input)
# ---------------------------------------------------------------------------


def _record_incomplete_client(session: Session, name_raw: str, sheet_name: str) -> None:
    """Register a client name that appears in a source sheet but has no row in
    the `clients` table (so its data is dropped). Persists it to
    `incomplete_clients` — with the source tab — so Data Quality can list it
    and tell the user where to fix it (add the client to the SOW Overview).

    Upserts on `name_raw` (the column is globally unique); updates
    `last_seen_tab` to the most recent source. A row already marked
    `resolved_at` (matched later, or dismissed as noise) is left untouched so
    dismissed names stay dismissed.
    """
    from app.models import IncompleteClient

    existing = (
        session.execute(select(IncompleteClient).where(IncompleteClient.name_raw == name_raw))
        .scalars()
        .first()
    )
    if existing is None:
        session.add(
            IncompleteClient(
                name_raw=name_raw,
                first_seen_tab=sheet_name,
                last_seen_tab=sheet_name,
                first_seen_year=0,
                first_seen_month=0,
                last_seen_year=0,
                last_seen_month=0,
                known_pods=None,
            )
        )
    elif existing.resolved_at is None:
        existing.last_seen_tab = sheet_name


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
    """Parse a date string, returning None for TBD/N/A/empty.

    Maintainers regularly type contract end dates with appended notes
    ("7/22/2025 with auto renew for 12 mo"). Strict format parsing fails on
    those, leaving the dashboard with a null end_date. Until the source
    sheet is locked to date-only cells, fall back through:
      1. exact match against the standard formats
      2. dateutil strict parse (handles "January 1, 2026" etc.)
      3. regex-extract the first date-like substring and reparse
    A successful regex extraction is logged at WARNING so bad cells
    surface in the import logs.

    Deliberately NOT using dateutil's fuzzy=True — it invents today's
    month/day for incomplete inputs ("17 articles" → today @ day 17),
    which silently corrupts data. If the regex doesn't catch it, the
    cell genuinely doesn't carry a date.
    """
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

    # Strict dateutil — clean date strings in less-common formats
    try:
        from dateutil.parser import parse as dateutil_parse

        return dateutil_parse(val_str).date()
    except Exception:
        pass

    # Extract the first date-like substring and try again. Covers the
    # common "7/22/2025 with auto renew for ..." pattern without inventing
    # data when no real date is present.
    date_patterns = [
        r"\d{1,2}/\d{1,2}/\d{2,4}",  # 7/22/2025 or 7/22/25
        r"\d{4}-\d{1,2}-\d{1,2}",  # 2025-07-22
        r"[A-Za-z]+\s+\d{1,2},?\s+\d{4}",  # July 22, 2025
    ]
    for pattern in date_patterns:
        m = re.search(pattern, val_str)
        if not m:
            continue
        substr = m.group(0)
        for fmt in formats:
            try:
                parsed = datetime.strptime(substr, fmt).date()
                logger.warning("parse_date: extracted %r from messy cell %r", substr, val_str)
                return parsed
            except ValueError:
                continue
        try:
            from dateutil.parser import parse as dateutil_parse

            parsed = dateutil_parse(substr).date()
            logger.warning("parse_date: extracted %r from messy cell %r", substr, val_str)
            return parsed
        except Exception:
            continue

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


def _extract_rich_text_column(service, spreadsheet_id: str, range_str: str) -> dict[int, str]:
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
            has_gvd_tabs = False
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
                if "] Goals vs Delivery" in name and "[Template]" not in name:
                    has_gvd_tabs = True
            # Inject a synthetic aggregate entry so the SYNC button can discover
            # and trigger import_goals_vs_delivery (which handles all month tabs
            # internally). The individual "[Month YYYY] Goals vs Delivery" tabs
            # don't match IMPORTABLE_EXACT on the frontend, but this key does.
            if has_gvd_tabs and prefix == "Master Tracker":
                sheets_info.append(
                    {
                        "name": "Master Tracker - Goals vs Delivery",
                        "row_count": 0,
                        "description": SHEET_DESCRIPTIONS.get(
                            "Master Tracker - Goals vs Delivery",
                            "Monthly Goals vs Delivery tabs — current month always re-imported",
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

    # Growth Pods is not a Google Sheet — it's a BigQuery-backed source.
    # Surface it as a synthetic entry so the import wizard can select it.
    # Row count comes from the last successful import so users see a
    # meaningful number before they sync.
    sheets_info.append(
        {
            "name": "Growth Pods",
            "row_count": _last_imported_row_count("Growth Pods") or 0,
            "description": SHEET_DESCRIPTIONS.get(
                "Growth Pods",
                "Growth pod mapping per client (BigQuery source)",
            ),
        }
    )

    sheets_info.append(
        {
            "name": "ET CP Pod History",
            "row_count": _last_imported_row_count("ET CP Pod History") or 0,
            "description": "Historical editorial-pod assignments from all ET CP version tabs — one confirmed data point per tab per client",
        }
    )

    # Monthly Article Count lives in its own spreadsheet with ~94 client tabs.
    # Surface it as a single synthetic source (the importer fans out across
    # every client tab internally) rather than listing all 94 tabs.
    sheets_info.append(
        {
            "name": "Monthly Article Count",
            "row_count": _last_imported_row_count("Monthly Article Count") or 0,
            "description": SHEET_DESCRIPTIONS.get("Monthly Article Count", ""),
            "source": "Monthly Article Count",
        }
    )

    return sheets_info


def _last_imported_row_count(sheet_name: str) -> int | None:
    """Return `rows_imported` from the most recent successful import of
    `sheet_name`, by scanning recent `sheets_migration` audit log entries.

    Used to give synthetic (non-Sheets) sources like Growth Pods a meaningful
    row-count in the Import Wizard instead of always showing 0.
    """
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session as SyncSession

    from app.database import prepare_sync_url

    engine = create_engine(prepare_sync_url(settings.database_url), echo=False)
    try:
        with SyncSession(engine) as sess:
            logs = (
                sess.execute(
                    select(AuditLog)
                    .where(
                        AuditLog.entity_type == "sheets_migration",
                        AuditLog.action == "IMPORT",
                    )
                    .order_by(AuditLog.performed_at.desc())
                    .limit(25)
                )
                .scalars()
                .all()
            )
            for log in logs:
                if not log.changes_json:
                    continue
                try:
                    data = json.loads(log.changes_json)
                except (json.JSONDecodeError, TypeError):
                    continue
                for s in data.get("sheets", []):
                    if s.get("sheet") == sheet_name and s.get("success"):
                        return int(s.get("rows_imported") or 0)
    except Exception:
        logger.warning("Could not look up last imported row count for %s", sheet_name)
        return None
    finally:
        engine.dispose()
    return None


# ---------------------------------------------------------------------------
# preview_sheet
# ---------------------------------------------------------------------------


def _resolve_sheet_source(sheet_name: str) -> tuple[str, str]:
    """Return (spreadsheet_id, actual_sheet_title) for a given sheet name.

    Sheets prefixed with 'Master Tracker - ' or 'AI Monitoring - ' live in
    separate spreadsheets. The prefix is stripped to get the real tab name.
    Raw Master Tracker tab names (e.g. '[March 2026] Goals vs Delivery',
    'Cumulative') are also routed correctly.
    """
    if sheet_name.startswith("Master Tracker - "):
        return MASTER_TRACKER_ID, sheet_name.removeprefix("Master Tracker - ")
    if sheet_name.startswith("AI Monitoring - "):
        return AI_MONITORING_ID, sheet_name.removeprefix("AI Monitoring - ")
    if sheet_name == "Notion Database":
        notion_id = getattr(settings, "notion_database_id", None)
        if notion_id:
            return notion_id, "Notion"
    # Fallback: raw Master Tracker tab names (monthly Goals vs Delivery tabs
    # look like '[March 2026] Goals vs Delivery'; cumulative tab is 'Cumulative').
    if "] Goals vs Delivery" in sheet_name or sheet_name == "Cumulative":
        return MASTER_TRACKER_ID, sheet_name
    # Raw Team Pods tab names ('Editorial Team [May 2026]' / 'Growth Team [May 2026]')
    # surface as TabImportDetail.tab_name from import_team_pods; route to the
    # Team Pods spreadsheet so the post-import preview resolves.
    if sheet_name.startswith("Editorial Team [") or sheet_name.startswith("Growth Team ["):
        return TEAM_PODS_ID, sheet_name
    return SPREADSHEET_ID, sheet_name


def preview_sheet(sheet_name: str, max_rows: int = 20) -> dict:
    """Read the first max_rows rows from a sheet and return headers + data."""
    if sheet_name == "Growth Pods":
        return _preview_growth_pods(max_rows)
    if sheet_name == "ET CP Pod History":
        return _preview_et_cp_pod_history(max_rows)
    if sheet_name == "Monthly Article Count":
        return _preview_monthly_article_count(max_rows)

    # Individual ET CP version tab — e.g. "ET CP 2026 [V11 Mar 2026]".
    # Each historical version is its own tab inside the Editorial Capacity
    # Planning spreadsheet; route directly so the Re-sync UI's per-tab
    # dropdown can show the actual data from that month's snapshot.
    if _ET_CP_TAB_RE.match(sheet_name):
        return _preview_et_cp_version_tab(sheet_name, max_rows)

    # Empty / explicit-skip preview_key: caller signals "no drill-down".
    # Surface as an empty payload rather than a 500.
    if not sheet_name:
        return {"sheet_name": "", "headers": [], "rows": [], "total_rows": 0}

    # Synthetic / computed steps that aren't backed by a sheet — the
    # Refresh Computed KPIs row in the SYNC modal, the Backfill Editorial
    # Pod from history row in the Re-sync UI, etc. Return an empty payload
    # instead of trying to resolve them to a sheet (which 500's).
    if sheet_name in _NON_PREVIEWABLE_STEPS:
        return {"sheet_name": sheet_name, "headers": [], "rows": [], "total_rows": 0}

    service = get_sheets_client()
    ssid, tab_name = _resolve_sheet_source(sheet_name)

    # "Master Tracker - Week Distribution" is a logical name; the real tabs
    # are year-prefixed (e.g. "2026 Week Distribution"). Resolve to the
    # latest year's tab so the preview shows the most recent calendar.
    if sheet_name == "Master Tracker - Week Distribution":
        meta_pre = (
            service.spreadsheets().get(spreadsheetId=ssid, fields="sheets.properties").execute()
        )
        latest_year = -1
        latest_title: str | None = None
        for s in meta_pre.get("sheets", []):
            title = s.get("properties", {}).get("title", "")
            m = _YEAR_TAB_RE.search(title)
            if m:
                y = int(m.group("year"))
                if y > latest_year:
                    latest_year = y
                    latest_title = title
        if latest_title:
            tab_name = latest_title
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
        comments_md = _extract_rich_text_column(service, SPREADSHEET_ID, f"'{sheet_name}'!R7:R200")

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
        # User-confirmed client aliases (Data Quality → Missing from Hub).
        _add_user_client_aliases(session, name_lookup)

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
        # as far as the sheet is filled. No hard cap — we read every populated
        # column and rely on the null-check below to skip empty trailing cells.
        row_idx = 3

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
                _record_incomplete_client(session, client_name, sheet_name)
                row_idx += 6
                continue

            # Rows: 0=SOW targets, 1=Invoicing, 2=Cumulative, 3=Article Deliveries,
            #        4=Variance, 5=Cumulative Delivered
            sow_row = all_rows[row_idx] if row_idx < len(all_rows) else []
            invoicing_row = all_rows[row_idx + 1] if row_idx + 1 < len(all_rows) else []
            deliveries_row = all_rows[row_idx + 3] if row_idx + 3 < len(all_rows) else []
            variance_row = all_rows[row_idx + 4] if row_idx + 4 < len(all_rows) else []

            widest_row = max(
                len(sow_row), len(invoicing_row), len(deliveries_row), len(variance_row)
            )
            months_available = max(0, widest_row - 7)

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
    """Find the latest 'ET CP 2026 [V...]' sheet name dynamically.
    Sorts numerically on the V## portion so `V9` doesn't beat `V13`
    (alphabetical sort treats `'9' > '1'` and would pick the wrong tab),
    and `V100+` works too. Falls back to alphabetical sort for tabs that
    don't have a `V##` token."""
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

    def _sort_key(title: str) -> tuple[int, str]:
        m = re.search(r"\[V(\d+)\b", title)
        version = int(m.group(1)) if m else -1
        return (version, title)

    candidates.sort(key=_sort_key)
    return candidates[-1]


def _parse_et_cp_month_header(cell: str) -> tuple[int, int] | None:
    """'January 2026' → (2026, 1). None when the cell isn't a month header."""
    m = re.match(r"^\s*([A-Za-z]+)\s+(\d{4})\s*$", str(cell or ""))
    if not m:
        return None
    mm = _ARTICLE_MONTH_NAMES.get(m.group(1).upper())
    return (int(m.group(2)), mm) if mm else None


def _parse_member_breakdown(raw: str | None, total_cap: int | None) -> list[dict]:
    """Split a Team cell into [{name, capacity}]. Handles combined cells in
    both formats — 'Lauren K (28) + Anabelle (15)' AND the space-separated
    'Maggie Gowland (14) Anabelle Zaluski (10)' (no '+'); a lone name with no
    parens inherits the slot's total capacity. Annotation parens like
    '(backfill)' are not split points — only cells with ≥2 numeric '(N)'
    groups get the secondary split."""
    raw = (raw or "").strip()
    if not raw or raw in ("-", "—", "N/A"):
        return []
    out: list[dict] = []
    for part in re.split(r"\s*\+\s*", raw):
        part = part.strip()
        if not part:
            continue
        pieces = [part]
        if len(re.findall(r"\(\d+\)", part)) >= 2:
            pieces = [p.strip() for p in re.split(r"(?<=\))\s+(?=[A-Za-z])", part) if p.strip()]
        for piece in pieces:
            m = re.match(r"^(.*?)\s*\((\d+)\)\s*$", piece)
            if m:
                out.append({"name": m.group(1).strip(), "capacity": int(m.group(2))})
            else:
                out.append({"name": piece, "capacity": None})
    if len(out) == 1 and out[0]["capacity"] is None:
        out[0]["capacity"] = total_cap
    return out


def _ingest_et_cp_year(
    session: Session,
    service,
    tab_title: str,
    sheet_year: int,
    all_rows: list | None = None,
) -> dict:
    """Read ONE ET CP version tab and write the per-member capacity + client-block
    original projection for every month of `sheet_year`. Month↔column is derived
    from the header rows (not a fixed offset), so the layout can shift safely.

    Writes:
      • editorial_member_capacity — per (year, month, pod, slot) from the
        "EDITORIAL TEAM CAPACITY" block (variable pod / role counts).
      • capacity_projections — pod-level Total/Projected/Actual used (same block).
      • production_history.projected_original — from the per-month client block's
        "Projected" column (resolved clients only; never touches other columns).
    Returns counts for logging.
    """
    if all_rows is None:
        all_rows = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=SPREADSHEET_ID, range=f"'{tab_title}'")
            .execute()
            .get("values", [])
        )
    version_match = re.search(r"\[(.*?)\]", tab_title)
    version = version_match.group(1) if version_match else tab_title
    counts = {"members": 0, "capacity_pods": 0, "projected": 0}

    # ---- 1. Team-capacity block ------------------------------------------------
    # The label "EDITORIAL TEAM CAPACITY" appears twice — once on a hiring/roster
    # summary (no month headers) and once on the real monthly block. Require the
    # row to ALSO carry month headers so we land on the monthly block.
    cap_hdr_idx = next(
        (
            i
            for i, row in enumerate(all_rows)
            if any("editorial team capacity" in _cell(row, c).strip().lower() for c in range(6))
            and any(_parse_et_cp_month_header(cell) for cell in row)
        ),
        None,
    )
    if cap_hdr_idx is not None:
        cap_months = [
            (col, *ym)
            for col, cell in enumerate(all_rows[cap_hdr_idx])
            if (ym := _parse_et_cp_month_header(cell))
        ]
        # Clear this version's pod-level rows + the year's member rows so a
        # shrunk roster / corrected month mapping never leaves stale rows behind.
        from sqlalchemy import delete

        session.execute(delete(CapacityProjection).where(CapacityProjection.version == version))
        session.execute(
            delete(EditorialMemberCapacity).where(EditorialMemberCapacity.year == sheet_year)
        )
        session.flush()
        # Sub-header row carrying "Role" + "Team" within a few rows below.
        sub_idx = next(
            (
                i
                for i in range(cap_hdr_idx + 1, min(cap_hdr_idx + 5, len(all_rows)))
                if any(
                    _cell(all_rows[i], c).strip().lower() == "role" for c in range(len(all_rows[i]))
                )
            ),
            cap_hdr_idx + 2,
        )
        # Bound the walk to the capacity block — it ends at the block's grand
        # "totals" row, before the per-month CLIENT block further down (whose
        # rows are ALSO "Pod N" with Status/Category and would otherwise be
        # mis-parsed as members). Cap at the client header as a backstop.
        client_hdr_for_bound = next(
            (
                i
                for i in range(cap_hdr_idx + 1, len(all_rows))
                if any(
                    _cell(all_rows[i], c).strip().lower() == "client"
                    for c in range(min(8, len(all_rows[i])))
                )
            ),
            min(len(all_rows), cap_hdr_idx + 70),
        )
        current_pod: dict[int, str | None] = {}
        slot: dict[int, int] = {}
        for row_idx in range(sub_idx + 1, client_hdr_for_bound):
            row = all_rows[row_idx]
            c_label = _cell(row, 2).strip().lower()
            if c_label == "totals":
                break  # capacity block grand-total row → end of block
            is_total_row = c_label.startswith("total projects")
            for col, year, month in cap_months:
                if is_total_row:
                    current_pod[col] = None
                    continue
                pod_cell = _cell(row, col).strip()
                role_cell = _cell(row, col + 1).strip()
                team_cell = _cell(row, col + 2).strip()
                cap = safe_int(_cell(row, col + 4))
                if pod_cell.startswith("Pod"):
                    pod = _normalize_editorial_pod(pod_cell)
                    current_pod[col] = pod
                    slot[col] = 0
                    # Pod-level totals live on this (Senior Editor) row.
                    total_cap = safe_int(_cell(row, col + 5))
                    projected = safe_int(_cell(row, col + 6))
                    actual = safe_int(_cell(row, col + 7))
                    existing = (
                        session.execute(
                            select(CapacityProjection).where(
                                CapacityProjection.pod == pod,
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
                                pod=pod,
                                year=year,
                                month=month,
                                total_capacity=total_cap,
                                projected_used_capacity=projected,
                                actual_used_capacity=actual,
                                version=version,
                                updated_by="sheets_migration",
                            )
                        )
                    counts["capacity_pods"] += 1
                pod = current_pod.get(col)
                if not pod:
                    continue
                if not role_cell and (not team_cell or team_cell in ("-", "—")):
                    continue  # empty slot row
                s = slot.get(col, 0)
                member_existing = (
                    session.execute(
                        select(EditorialMemberCapacity).where(
                            EditorialMemberCapacity.year == year,
                            EditorialMemberCapacity.month == month,
                            EditorialMemberCapacity.pod == pod,
                            EditorialMemberCapacity.slot == s,
                        )
                    )
                    .scalars()
                    .first()
                )
                fields = dict(
                    role=role_cell or None,
                    member_raw=team_cell or None,
                    member_breakdown=_parse_member_breakdown(team_cell, cap) or None,
                    capacity=cap,
                    source_version=version,
                )
                if member_existing:
                    for k, v in fields.items():
                        setattr(member_existing, k, v)
                else:
                    session.add(
                        EditorialMemberCapacity(year=year, month=month, pod=pod, slot=s, **fields)
                    )
                slot[col] = s + 1
                counts["members"] += 1

    # ---- 2. Client block → production_history.projected_original ---------------
    client_hdr_idx = None
    pod_cols: list[int] = []
    for idx, row in enumerate(all_rows):
        if any(_cell(row, c).strip().lower() == "client" for c in range(min(8, len(row)))):
            pc = [c for c in range(len(row)) if _cell(row, c).strip().lower() == "pod"]
            if pc:
                client_hdr_idx = idx
                pod_cols = pc
                break
    if client_hdr_idx is not None and client_hdr_idx > 0:
        month_hdr = all_rows[client_hdr_idx - 1]
        # Map each per-month Pod column → (year, month) via the header above it.
        col_month = {}
        for pc in pod_cols:
            ym = _parse_et_cp_month_header(_cell(month_hdr, pc))
            if ym:
                col_month[pc] = ym
        client_col = next(
            (
                c
                for c in range(min(8, len(all_rows[client_hdr_idx])))
                if _cell(all_rows[client_hdr_idx], c).strip().lower() == "client"
            ),
            2,
        )
        lookup = _build_client_name_lookup(session.execute(select(Client)).scalars().all())
        for row_idx in range(client_hdr_idx + 1, len(all_rows)):
            row = all_rows[row_idx]
            if not row:
                continue
            name = _cell(row, client_col).strip()
            if not name or any(
                k in name.lower() for k in ("total", "median", "average", "production")
            ):
                continue
            c = _resolve_client(lookup, name)
            if c is None:
                continue
            for pc, (year, month) in col_month.items():
                projected = safe_int(_cell(row, pc + 4))
                if projected is None:
                    continue
                ph = (
                    session.execute(
                        select(ProductionHistory).where(
                            ProductionHistory.client_id == c.id,
                            ProductionHistory.year == year,
                            ProductionHistory.month == month,
                        )
                    )
                    .scalars()
                    .first()
                )
                if ph:
                    ph.projected_original = projected
                else:
                    session.add(
                        ProductionHistory(
                            client_id=c.id,
                            year=year,
                            month=month,
                            projected_original=projected,
                            is_actual=False,
                            source="et_cp_projection",
                        )
                    )
                counts["projected"] += 1
    return counts


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
        # Team-member roster (Senior Editor + Editors per pod). Still
        # hardcoded because the CP sheet doesn't surface this in a
        # parser-friendly format — that's a separate cleanup. The
        # client → pod mapping that used to live here was REMOVED and
        # replaced by sheet-derived parsing further down (see "Article
        # breakdown" block) so admins no longer have to edit code when
        # a client moves pods.
        pod_teams = {
            "Pod 1": {
                "senior_editor": "Nina Denison",
                "editors": ["Robert Thorpe", "Jimmy Bunes"],
            },
            "Pod 2": {
                "senior_editor": "Kennedy Stevens",
                "editors": ["Jimmy Bunes", "Elliot Gardner", "Tiffany Anderson"],
            },
            "Pod 3": {
                "senior_editor": "Alyssa Zacharias",
                "editors": ["Lee Anderson", "Haley Drucker"],
            },
            "Pod 5": {
                "senior_editor": "Maggie Gowland",
                "editors": ["Lauren Friar", "Shivani Verma"],
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

        # ------------------------------------------------------------------
        # Client → Editorial Pod (sheet-derived)
        # ------------------------------------------------------------------
        # The "ARTICLE BREAKDOWN" section of the CP sheet carries a per-
        # month block per client: `Pod | Status | Category | % | Projected
        # | Delivered | Comments`. Each month block repeats horizontally
        # (May 2026 starts around col AJ in V13). We find the header row
        # (the one that puts "Client" in col C and "Pod" labels in the
        # per-month blocks), collect every "Pod" column, and read the
        # RIGHTMOST non-empty Pod per client — that's the latest-known
        # editorial-pod assignment.
        #
        # Why rightmost non-empty (vs. always the last month):
        #   - If May (the latest column in V13) has values for everyone →
        #     it always wins. ✓
        #   - If a client is blank in May but filled in April → April
        #     wins instead of nuking their pod to NULL. Safer for
        #     incomplete snapshots.
        #   - When a V14 lands with June filled, June wins. ✓
        #
        # Existing values are PRESERVED when the sheet has nothing for a
        # client (no row, blank Pod cell, or no match) so a typo in the
        # sheet can't accidentally wipe a client's pod.
        clients_all = session.execute(select(Client)).scalars().all()
        client_lookup = _build_client_name_lookup(clients_all)

        header_row_idx: int | None = None
        pod_col_indices: list[int] = []
        for idx, row in enumerate(all_rows):
            # The header row has "Client" as a column label (any column,
            # but typically col index 2 / column "C") AND at least one
            # "Pod" label among the per-month blocks to its right.
            has_client = any(
                _cell(row, c).strip().lower() == "client" for c in range(min(8, len(row)))
            )
            if not has_client:
                continue
            pod_cols = [c for c in range(len(row)) if _cell(row, c).strip().lower() == "pod"]
            if pod_cols:
                header_row_idx = idx
                pod_col_indices = pod_cols
                break

        pod_assignments_written = 0
        if header_row_idx is None or not pod_col_indices:
            result.errors.append(
                "Article-breakdown header not found in CP sheet — skipping "
                "client → pod assignment. Capacity projections + team "
                "members were still imported."
            )
        else:
            # Find the client-name column inside the header. Defaults to
            # col 2 (column "C" in today's layout) but stays adaptive.
            client_col = next(
                (
                    c
                    for c in range(min(8, len(all_rows[header_row_idx])))
                    if _cell(all_rows[header_row_idx], c).strip().lower() == "client"
                ),
                2,
            )
            for row_idx in range(header_row_idx + 1, len(all_rows)):
                row = all_rows[row_idx]
                if not row:
                    continue
                client_name = _cell(row, client_col).strip()
                if not client_name:
                    continue
                if any(
                    kw in client_name.lower() for kw in ("total", "median", "average", "production")
                ):
                    continue
                c = _resolve_client(client_lookup, client_name)
                if c is None:
                    continue
                # Rightmost non-empty Pod cell wins.
                latest: str | None = None
                for pod_col in reversed(pod_col_indices):
                    val = _cell(row, pod_col).strip()
                    if val:
                        latest = val
                        break
                if not latest:
                    continue
                normalized = _normalize_editorial_pod(latest)
                if normalized and c.editorial_pod != normalized:
                    c.editorial_pod = normalized
                    pod_assignments_written += 1

        logger.info(
            "Capacity Plan: editorial_pod sheet-derived writes = %d",
            pod_assignments_written,
        )

        # ------------------------------------------------------------------
        # Capacity projections (pod-level) + per-member capacity + client-block
        # original projection. Month↔column is derived from the sheet header rows
        # inside _ingest_et_cp_year (the old hardcoded month offset mis-aligned
        # the V13 layout, where the capacity block starts at January, not Dec).
        # ------------------------------------------------------------------
        sheet_year_match = re.search(r"ET CP (\d{4})", sheet_name)
        sheet_year = int(sheet_year_match.group(1)) if sheet_year_match else 2026
        et_counts = _ingest_et_cp_year(session, service, sheet_name, sheet_year, all_rows=all_rows)

        result.rows_parsed = members_imported + et_counts["capacity_pods"]
        result.rows_imported = members_imported + et_counts["capacity_pods"]
        result.details.append(
            TabImportDetail(
                tab_name=sheet_name,
                month_year=str(sheet_year),
                rows_imported=et_counts["members"] + et_counts["projected"],
                status="imported",
            )
        )

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

        # Build client name → id lookup via the shared helper so we apply
        # the same alias table everywhere (Operating Model, Capacity
        # Plan, etc.). The helper returns Client objects; we project
        # down to id since the rest of this importer keys by id.
        clients = session.execute(select(Client)).scalars().all()
        client_lookup = _build_client_name_lookup(clients, session)
        name_lookup: dict[str, int] = {k: v.id for k, v in client_lookup.items()}

        # Pre-load every existing ProductionHistory row into an in-memory
        # dict keyed by (client_id, year, month). Without this we'd issue a
        # SELECT per (row × month_column) — ~50 clients × 53 months ≈ 2,650
        # round-trips to Neon, taking 60-180s and tripping the browser's
        # fetch timeout (and Vercel/Cloudflare 30s proxy cutoff).
        existing_rows = session.execute(select(ProductionHistory)).scalars().all()
        existing_by_key: dict[tuple[int, int, int], ProductionHistory] = {
            (r.client_id, r.year, r.month): r for r in existing_rows
        }

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
                # Track in incomplete_clients so Data Quality surfaces it + where to fix.
                _record_incomplete_client(session, client_name, sheet_name)
                continue

            for col_idx, (year, month) in month_map.items():
                val = safe_int(_cell(row, col_idx))
                if val is None:
                    continue

                is_actual = col_idx in actual_cols
                articles_actual = val if is_actual else None
                articles_projected = val if not is_actual else None

                # Upsert: match by (client_id, year, month) via the
                # pre-loaded in-memory dict.
                key = (client_id, year, month)
                existing = existing_by_key.get(key)

                if existing:
                    existing.articles_actual = articles_actual
                    existing.articles_projected = articles_projected
                    existing.is_actual = is_actual
                    existing.source = "operating_model"
                else:
                    new_row = ProductionHistory(
                        client_id=client_id,
                        year=year,
                        month=month,
                        articles_actual=articles_actual,
                        articles_projected=articles_projected,
                        is_actual=is_actual,
                        source="operating_model",
                    )
                    session.add(new_row)
                    existing_by_key[key] = new_row

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
        # User-confirmed client aliases (Data Quality → Missing from Hub).
        _add_user_client_aliases(session, name_lookup)

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
                _record_incomplete_client(session, client_name, sheet_name)
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
# import_week_distribution — annual config, runs only via the past-months
# resync flow. Intentionally NOT in IMPORT_DISPATCH so the import wizard and
# the regular SYNC button don't touch it.
# ---------------------------------------------------------------------------


_WEEK_CELL_RE = re.compile(
    r"Week\s*(?P<wn>\d+)\s*:\s*(?P<sm>\d{1,2})/(?P<sd>\d{1,2})\s*-\s*(?P<em>\d{1,2})/(?P<ed>\d{1,2})",
    re.IGNORECASE,
)
_YEAR_TAB_RE = re.compile(r"\b(?P<year>20\d{2})\b\s*Week\s*Distribution", re.IGNORECASE)
_MONTH_BY_NAME = {
    name.lower(): idx + 1
    for idx, name in enumerate(
        [
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
        ]
    )
}


def import_week_distribution(session: Session) -> ImportResult:
    """Import every '<YYYY> Week Distribution' tab from the Master Tracker
    into `editorial_weeks`. Sheet shape: row 2 carries month-name headers
    across columns; rows 3-7 carry per-week ranges in 'Week N: MM/DD - MM/DD'
    form. Year is inferred from the tab name. Idempotent upsert by
    (year, month, week_number)."""
    sheet_name = "Master Tracker - Week Distribution"
    result = ImportResult(sheet=sheet_name)

    try:
        service = get_sheets_client()
        meta = (
            service.spreadsheets()
            .get(spreadsheetId=MASTER_TRACKER_ID, fields="sheets.properties.title")
            .execute()
        )
        tab_titles = [s["properties"]["title"] for s in meta.get("sheets", [])]
        target_tabs: list[tuple[str, int]] = []
        for title in tab_titles:
            m = _YEAR_TAB_RE.search(title)
            if m:
                target_tabs.append((title, int(m.group("year"))))

        if not target_tabs:
            result.errors.append("No '<YYYY> Week Distribution' tab found in Master Tracker")
            result.success = False
            return result

        for tab_title, year in target_tabs:
            resp = (
                service.spreadsheets()
                .values()
                .get(spreadsheetId=MASTER_TRACKER_ID, range=f"'{tab_title}'")
                .execute()
            )
            all_rows = resp.get("values", [])
            if len(all_rows) < 3:
                continue
            month_header = all_rows[1] if len(all_rows) > 1 else []
            col_to_month: dict[int, int] = {}
            for col_idx, raw in enumerate(month_header):
                key = (raw or "").strip().lower()
                if key in _MONTH_BY_NAME:
                    col_to_month[col_idx] = _MONTH_BY_NAME[key]

            for week_row in all_rows[2:]:
                for col_idx, cell in enumerate(week_row):
                    month = col_to_month.get(col_idx)
                    if not month:
                        continue
                    text_val = (cell or "").strip()
                    if not text_val:
                        continue
                    m = _WEEK_CELL_RE.search(text_val)
                    if not m:
                        continue
                    wn = int(m.group("wn"))
                    sm = int(m.group("sm"))
                    sd = int(m.group("sd"))
                    em = int(m.group("em"))
                    ed = int(m.group("ed"))
                    # Year carry — a week wrapping Dec → Jan ends in the
                    # following calendar year.
                    end_year = year if em >= sm else year + 1
                    try:
                        start_date = date(year, sm, sd)
                        end_date = date(end_year, em, ed)
                    except ValueError as ve:
                        result.errors.append(f"{tab_title}: bad date in '{text_val}' ({ve})")
                        continue

                    result.rows_parsed += 1
                    existing = (
                        session.execute(
                            select(EditorialWeek).where(
                                EditorialWeek.year == year,
                                EditorialWeek.month == month,
                                EditorialWeek.week_number == wn,
                            )
                        )
                        .scalars()
                        .first()
                    )
                    if existing:
                        existing.start_date = start_date
                        existing.end_date = end_date
                    else:
                        session.add(
                            EditorialWeek(
                                year=year,
                                month=month,
                                week_number=wn,
                                start_date=start_date,
                                end_date=end_date,
                            )
                        )
                    result.rows_imported += 1

        session.commit()
    except Exception as exc:
        logger.exception("Error importing Week Distribution")
        session.rollback()
        result.success = False
        result.errors.append(str(exc))
    return result


# ---------------------------------------------------------------------------
# import_team_pods — Editorial + Growth pod rosters from the "[Int] Team Pods"
# spreadsheet. Source-of-truth for "which email works on which client" and
# "what pod is this person in". Powers RBAC group auto-population +
# pod-aware client filtering.
#
# Sheet shape (per latest "Editorial Team [<Mon> <YYYY>]" / "Growth Team
# [<Mon> <YYYY>]" tab):
#   Row 1: title banner ("EDITORIAL TEAM - MAY")
#   Row 2: black header row — POD NUMBER | POD MEMBERS | CLIENT | SENIOR
#                              EDITOR | EDITOR | WRITER (Editorial)
#                            | (Growth: similar but role columns differ)
#   Row 3+: data, with Pod # and Pod Members only on the FIRST row of each
#           pod's block. Subsequent rows in the same pod block leave
#           col A and col B blank but do populate cols C–F per client.
#
# Cells in cols B/D/E/F are Google Sheets people-chips. The chip carries
# the email; cell text is the rendered display name. We pull chip metadata
# via spreadsheets.get(includeGridData=True) with a chipRuns projection.
# ---------------------------------------------------------------------------


_MONTH_NAME_TO_NUM = {
    name.lower(): idx + 1
    for idx, name in enumerate(
        [
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
        ]
    )
}
_TEAM_TAB_RE = re.compile(
    r"^(?P<kind>Editorial|Growth)\s+Team\s*\[(?P<month>\w+)(?:\s+(?P<year>\d{4}))?\]\s*$",
    re.IGNORECASE,
)


def _pick_latest_team_tab(tabs: list[str], kind: str) -> str | None:
    """Pick the most recent '<kind> Team [<Mon> <YYYY>]' tab. Falls back to
    the latest by lexical sort when year is omitted (some legacy tabs use
    just the month name)."""
    candidates: list[tuple[int, int, str]] = []  # (year, month_num, tab_name)
    for t in tabs:
        m = _TEAM_TAB_RE.match(t.strip())
        if not m:
            continue
        if m.group("kind").lower() != kind.lower():
            continue
        month_num = _MONTH_NAME_TO_NUM.get(m.group("month").lower(), 0)
        year = int(m.group("year")) if m.group("year") else 0
        candidates.append((year, month_num, t))
    if not candidates:
        return None
    candidates.sort(reverse=True)
    return candidates[0][2]


def _emails_for_cell(cell: dict) -> list[tuple[str, str]]:
    """Return [(email, display_text)] for every people-chip in a cell.
    `display_text` is the chip's rendered substring within the cell text,
    used so the importer can store the original spelling. Cells with no
    chips return []."""
    chip_runs = cell.get("chipRuns") or []
    text = cell.get("formattedValue") or ""
    out: list[tuple[str, str]] = []
    if not chip_runs:
        return out
    # chipRuns are sorted by startIndex; the run's display name spans from
    # its startIndex to the next run's startIndex (or end of text).
    sorted_runs = sorted(chip_runs, key=lambda r: r.get("startIndex", 0))
    for i, run in enumerate(sorted_runs):
        start = run.get("startIndex", 0)
        end = (
            sorted_runs[i + 1].get("startIndex", len(text))
            if i + 1 < len(sorted_runs)
            else len(text)
        )
        chip = run.get("chip", {}).get("personProperties", {}) or {}
        email = (chip.get("email") or "").strip().lower()
        if not email:
            continue
        # Display name = whatever the chip span renders as in the cell. We
        # strip trailing role tags `(SE)` / `(E)` so the stored display name
        # is just the person's name.
        raw_span = text[start:end]
        # The role tag (if any) lives at the END of this chip's span — could
        # be Editorial-style `(SE)` or Growth-style `(SR GL)` / `(GD - external)`.
        cleaned = (
            re.sub(r"\([A-Za-z][A-Za-z\s\-]{0,20}\)\s*$", "", raw_span).strip().rstrip(",").strip()
        )
        out.append((email, cleaned or text[:80]))
    return out


def _role_tag_for_chip(cell: dict, chip_index: int) -> str | None:
    """Extract the role tag that follows the chip at `chip_index` in the
    cell text. Editorial uses single-letter tags like `(SE)` / `(E)`; Growth
    uses multi-letter tags like `(GD)`, `(SR GL)`, `(JR GL)`, `(GD - external)`.
    Returns the inner text (whitespace-squeezed, uppercased) or None."""
    chip_runs = sorted(
        (cell.get("chipRuns") or []),
        key=lambda r: r.get("startIndex", 0),
    )
    if chip_index >= len(chip_runs):
        return None
    text = cell.get("formattedValue") or ""
    start = chip_runs[chip_index].get("startIndex", 0)
    end = (
        chip_runs[chip_index + 1].get("startIndex", len(text))
        if chip_index + 1 < len(chip_runs)
        else len(text)
    )
    # Allow letters, spaces, and hyphens inside the parens — covers
    # `(SR GL)`, `(GD - external)`, etc.
    m = re.search(r"\(([A-Za-z][A-Za-z\s\-]{0,20})\)", text[start:end])
    if not m:
        return None
    return re.sub(r"\s+", " ", m.group(1).strip()).upper()


# Map role-tag (from Pod Members column) + role-by-column to canonical role.
# Keys are tag text after stripping parens, uppercasing, and squeezing internal
# whitespace to single spaces. Both Editorial-style (`SE` / `E` / `W`) and
# Growth-style (`SR GL` / `GD` / `JR GL`) tags are listed here.
_ROLE_TAG_CANONICAL = {
    "SE": "senior_editor",
    "E": "editor",
    "W": "writer",
    "AD": "account_director",
    "AM": "account_manager",
    "MD": "managing_director",
    "GLEAD": "growth_lead",
    "GL": "growth_lead",
    "SR GL": "sr_growth_lead",
    "JR GL": "jr_growth_lead",
    "GD": "growth_director",
    "SR GD": "sr_growth_director",
    "GD - EXTERNAL": "growth_director_external",
    "CS": "content_specialist",
}

# Header labels we explicitly DON'T treat as role columns. The importer also
# skips any header whose label contains "link", "comment", "type", "url", or
# "note", so this list only covers exact matches that the substring rule
# would miss.
_NON_ROLE_HEADERS = {
    "pod number",
    "pod members",
    "client-facing pod members",
    "non client-facing pod members",
    "non-client-facing pod members",
    "client",
}
_NON_ROLE_SUBSTRINGS = ("link", "comment", "type", "url", "note", "sharedrive")


def _is_role_header(label: str) -> bool:
    """Returns True when the (lowercased) header label looks like a role
    column. Permissive — anything that isn't a known structural / metadata
    column gets treated as a role."""
    if label in _NON_ROLE_HEADERS:
        return False
    for sub in _NON_ROLE_SUBSTRINGS:
        if sub in label:
            return False
    return True


def _canonical_role_from_header(label: str) -> str:
    """Convert a header like 'SR GROWTH DIRECTOR/ MANAGING DIRECTOR' to a
    snake_case role key. Slashes and ampersands collapse — these columns
    legitimately represent one of two interchangeable roles."""
    norm = label.lower()
    norm = re.sub(r"[\/\\&]", "_or_", norm)
    norm = re.sub(r"[^a-z0-9]+", "_", norm)
    norm = norm.strip("_")
    return norm or "role"


_TEAM_HISTORY_TAB_RE = re.compile(
    r"^(?P<kind>Editorial|Growth|Account)\s+Team\s*"
    r"(?P<open>[\[\(])(?P<month>[A-Za-z]+)(?:\s+(?P<year>\d{4}))?[\]\)]\s*$",
    re.IGNORECASE,
)
# Junk fragments in member/role/writer cells that aren't people.
_POD_HISTORY_JUNK = ("actively recruiting", "tbd", "n/a", "?", "-", "")


def _pods_text_entries(cell: dict) -> list[tuple[None, str, str | None]]:
    """Text fallback for pre-chip tabs: split the cell on newlines, strip
    parenthetical tags, return [(None, name, first_tag)]."""
    text_val = (cell.get("formattedValue") or "").strip()
    out: list[tuple[None, str, str | None]] = []
    for line in text_val.split("\n"):
        line = line.strip().rstrip(",")
        if not line:
            continue
        tag_m = re.search(r"\(([A-Za-z][A-Za-z\s\-\.]{0,24})\)", line)
        tag = tag_m.group(1).strip().upper() if tag_m else None
        name = re.sub(r"\([^)]*\)", "", line)
        name = re.sub(r"\s+", " ", name).strip().rstrip(",").strip()
        if name.lower() in _POD_HISTORY_JUNK or len(name) < 2:
            continue
        out.append((None, name, tag))
    return out


def _pods_cell_entries(cell: dict) -> list[tuple[str | None, str, str | None]]:
    """[(email|None, display_name, role_tag|None)] — chips when present,
    text fallback otherwise (older tabs predate people-chips)."""
    chips = _emails_for_cell(cell)
    if chips:
        return [(email, name, _role_tag_for_chip(cell, i)) for i, (email, name) in enumerate(chips)]
    return _pods_text_entries(cell)


def import_pod_history(session: Session) -> ImportResult:
    """Backfill pod_assignment_history from EVERY monthly Team Pods tab:
    'Editorial Team [<Mon> <YYYY>]', 'Growth Team [...]' and the growth
    side's older name 'Account Team [...]' / '(<Mon> <YYYY>)'. Yields the
    per-month member↔pod↔client history (and Editorial writers) that
    pod_assignments (latest-month, RBAC) intentionally forgets.

    Year inference: the two year-less bracket tabs ('Editorial Team
    [January]'/'[February]') are 2025 — they complete the otherwise
    contiguous Mar 2025+ series. Year-less PAREN tabs (2024 era) are
    skipped: ambiguous, and pre-2025 is outside the capacity-model window.
    """
    result = ImportResult(sheet="Team Pods History")
    try:
        service = get_sheets_client()
        meta = (
            service.spreadsheets()
            .get(spreadsheetId=TEAM_PODS_ID, fields="sheets(properties(title))")
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        result.success = False
        result.errors.append(f"Could not list Team Pods tabs: {exc}")
        return result

    targets: list[tuple[int, int, str, str]] = []  # (year, month, kind, tab)
    for s in meta.get("sheets", []):
        title = s["properties"]["title"]
        m = _TEAM_HISTORY_TAB_RE.match(title.strip())
        if not m:
            continue
        kind = m.group("kind").lower()
        pod_kind = "growth" if kind in ("growth", "account") else "editorial"
        month_num = _MONTH_NAME_TO_NUM.get(m.group("month").lower())
        if not month_num:
            continue
        if m.group("year"):
            year = int(m.group("year"))
        elif m.group("open") == "[" and month_num in (1, 2):
            year = 2025  # the two year-less bracket tabs complete the 2025 series
        else:
            continue  # year-less paren tabs (2024 era) — ambiguous, skipped
        targets.append((year, month_num, pod_kind, title))
    targets.sort()

    wiped: set[tuple[int, int, str]] = set()
    for year, month, pod_kind, tab in targets:
        try:
            resp = (
                service.spreadsheets()
                .get(
                    spreadsheetId=TEAM_PODS_ID,
                    ranges=[f"'{tab}'!A1:Z300"],
                    includeGridData=True,
                    fields=(
                        "sheets(data(rowData(values("
                        "formattedValue,"
                        "chipRuns(startIndex,chip(personProperties(email)))"
                        "))))"
                    ),
                )
                .execute()
            )
        except Exception as exc:  # noqa: BLE001
            result.errors.append(f"{tab}: fetch failed: {exc}")
            continue
        sheets_data = resp.get("sheets", [])
        rows = sheets_data[0]["data"][0].get("rowData", []) if sheets_data else []

        header_row_idx = None
        for hi, hrow in enumerate(rows[:12]):
            for hc in hrow.get("values", []):
                if (hc.get("formattedValue") or "").strip().lower() == "client":
                    header_row_idx = hi
                    break
            if header_row_idx is not None:
                break
        if header_row_idx is None:
            result.errors.append(f"{tab}: no CLIENT header in first 12 rows — skipped")
            continue

        header_cells = rows[header_row_idx].get("values", [])
        col_idx: dict[str, int] = {}
        for i, hc in enumerate(header_cells):
            label = (hc.get("formattedValue") or "").strip().lower()
            if label:
                col_idx.setdefault(label, i)
        c_pod_num = col_idx.get("pod number")
        c_client = col_idx["client"]
        c_writer_email = col_idx.get("writer email")
        pod_member_cols = [i for label, i in col_idx.items() if "pod members" in label]
        role_cols = [
            (idx, _canonical_role_from_header(label))
            for label, idx in col_idx.items()
            if _is_role_header(label) and label != "writer email"
        ]

        slice_key = (year, month, pod_kind)
        if slice_key not in wiped:
            session.query(PodAssignmentHistory).filter(
                PodAssignmentHistory.year == year,
                PodAssignmentHistory.month == month,
                PodAssignmentHistory.pod_kind == pod_kind,
            ).delete()
            wiped.add(slice_key)

        current_pod: str | None = None
        current_members: list[tuple[str | None, str, str | None]] = []
        seen: set[tuple] = set()
        n_rows = 0

        def emit(client, role, email, name):
            nonlocal n_rows
            key = (pod_kind, (email or name).lower(), client, role)
            if key in seen or not name:
                return
            seen.add(key)
            session.add(
                PodAssignmentHistory(
                    year=year,
                    month=month,
                    pod_kind=pod_kind,
                    pod_number=current_pod,
                    client_name=client,
                    role=role,
                    email=email,
                    display_name=name,
                    source_tab=tab,
                )
            )
            n_rows += 1

        for row in rows[header_row_idx + 1 :]:
            cells = row.get("values", [])
            if not cells:
                continue
            result.rows_parsed += 1
            if c_pod_num is not None and c_pod_num < len(cells):
                pn = (cells[c_pod_num].get("formattedValue") or "").strip()
                if pn:
                    current_pod = pn
                    current_members = []
            new_members: list[tuple[str | None, str, str | None]] = []
            any_pm = False
            for pm_col in pod_member_cols:
                if pm_col >= len(cells):
                    continue
                entries = _pods_cell_entries(cells[pm_col])
                if entries:
                    any_pm = True
                new_members.extend(entries)
            if any_pm:
                current_members = new_members

            client = (
                (cells[c_client].get("formattedValue") or "").strip()
                if c_client < len(cells)
                else ""
            )
            if not client:
                continue

            for col_index, role in role_cols:
                if col_index >= len(cells):
                    continue
                if role == "writer":
                    # WRITER cells are ' / '-separated; emails pair from the
                    # WRITER EMAIL column only when the counts line up.
                    wnames = [
                        n.strip()
                        for n in re.split(r"[/\n]", cells[col_index].get("formattedValue") or "")
                        if n.strip()
                        and n.strip().lower() not in _POD_HISTORY_JUNK
                        and len(n.strip()) > 2  # drop stray initials/fragments
                    ]
                    wemails: list[str] = []
                    if c_writer_email is not None and c_writer_email < len(cells):
                        wemails = [
                            e.strip().lower()
                            for e in re.split(
                                r"[/\n]", cells[c_writer_email].get("formattedValue") or ""
                            )
                            if e.strip()
                        ]
                    paired = len(wnames) == len(wemails)
                    for wi, wname in enumerate(wnames):
                        emit(client, "writer", wemails[wi] if paired else None, wname)
                    continue
                for email, name, _tag in _pods_cell_entries(cells[col_index]):
                    emit(client, role, email, name)

            for email, name, tag in current_members:
                emit(client, "pod_member", email, name)
                if tag:
                    canonical = _ROLE_TAG_CANONICAL.get(tag.upper())
                    if canonical:
                        emit(client, canonical, email, name)

        result.rows_imported += n_rows
        result.details.append(
            TabImportDetail(
                tab_name=tab,
                month_year=f"{year}-{month:02d}",
                preview_key=None,
                status="imported",
                rows_parsed=result.rows_parsed,
                rows_imported=n_rows,
            )
        )

    try:
        session.commit()
    except Exception as exc:  # noqa: BLE001
        session.rollback()
        result.success = False
        result.errors.append(f"commit failed: {exc}")
    if result.errors:
        result.success = result.rows_imported > 0
    return result


def import_team_pods(session: Session) -> ImportResult:
    """Import latest Editorial Team + Growth Team tabs into pod_assignments.
    Returns one ImportResult covering both kinds; per-kind status is tracked
    via `details` (one TabImportDetail per pod_kind) so the wizard can show
    them as separate rows."""
    sheet_name = "Team Pods - Editorial + Growth"
    result = ImportResult(sheet=sheet_name)

    try:
        service = get_sheets_client()
    except Exception as exc:
        logger.exception("Could not build Sheets client for Team Pods import")
        result.success = False
        result.errors.append(f"Auth failed: {exc}")
        return result

    try:
        meta = (
            service.spreadsheets()
            .get(spreadsheetId=TEAM_PODS_ID, fields="sheets(properties(title))")
            .execute()
        )
    except Exception as exc:
        logger.exception("Could not list Team Pods tabs")
        result.success = False
        result.errors.append(f"Could not list tabs: {exc}")
        return result

    all_tabs = [s["properties"]["title"] for s in meta.get("sheets", [])]

    for pod_kind in ("editorial", "growth"):
        detail = TabImportDetail(
            tab_name=f"{pod_kind.title()} Team",
            month_year="(latest)",
            preview_key=None,
        )
        tab = _pick_latest_team_tab(all_tabs, pod_kind)
        if not tab:
            detail.status = "failed"
            detail.skipped_reason = f"No '{pod_kind.title()} Team [<Mon> <YYYY>]' tab found"
            result.details.append(detail)
            result.errors.append(detail.skipped_reason)
            result.success = False
            continue
        detail.tab_name = tab
        # Surface the actual month/year inside the brackets ("May 2026")
        # instead of the literal "(latest)" placeholder so the wizard's
        # tab-detail row reads as a real label.
        bracket_match = re.search(r"\[([^\]]+)\]", tab)
        if bracket_match:
            detail.month_year = bracket_match.group(1).strip()

        try:
            resp = (
                service.spreadsheets()
                .get(
                    spreadsheetId=TEAM_PODS_ID,
                    ranges=[f"'{tab}'!A1:Z200"],
                    includeGridData=True,
                    fields=(
                        "sheets(data(rowData(values("
                        "formattedValue,"
                        "chipRuns(startIndex,chip(personProperties(email)))"
                        "))))"
                    ),
                )
                .execute()
            )
        except Exception as exc:
            logger.exception("Could not fetch Team Pods tab %s", tab)
            detail.status = "failed"
            detail.skipped_reason = f"Fetch failed: {exc}"
            result.details.append(detail)
            result.errors.append(f"Fetch failed for tab '{tab}': {exc}")
            result.success = False
            continue

        sheets = resp.get("sheets", [])
        rows = sheets[0]["data"][0].get("rowData", []) if sheets else []
        if len(rows) < 3:
            detail.status = "failed"
            detail.skipped_reason = "Fewer than 3 rows — header row missing?"
            result.details.append(detail)
            result.errors.append(f"Tab '{tab}' has fewer than 3 rows — header row missing?")
            result.success = False
            continue

        # Find the header row dynamically — Editorial keeps it at row 2,
        # Growth at row 3 (because of an extra title banner row). The header
        # row is whichever has a cell whose lowercased value is exactly
        # "client" (the column heading, not a client name in a data row).
        header_row_idx: int | None = None
        for hi, hrow in enumerate(rows[:6]):
            for hc in hrow.get("values", []):
                if (hc.get("formattedValue") or "").strip().lower() == "client":
                    header_row_idx = hi
                    break
            if header_row_idx is not None:
                break

        if header_row_idx is None:
            detail.status = "failed"
            detail.skipped_reason = "Could not locate header row (no 'CLIENT' column)"
            result.details.append(detail)
            result.errors.append(f"Tab '{tab}' missing CLIENT column in first 6 rows")
            result.success = False
            continue

        header_cells = rows[header_row_idx].get("values", [])
        col_idx: dict[str, int] = {}
        for i, hc in enumerate(header_cells):
            label = (hc.get("formattedValue") or "").strip().lower()
            if label:
                col_idx[label] = i

        c_pod_num = col_idx.get("pod number")
        c_client = col_idx.get("client")
        if c_client is None:
            detail.status = "failed"
            detail.skipped_reason = "Header row missing required 'CLIENT' column"
            result.details.append(detail)
            result.errors.append(f"Tab '{tab}' header row missing required 'CLIENT' column")
            result.success = False
            continue

        # Pod-member column(s). Editorial has one ("POD MEMBERS"); Growth has
        # two ("CLIENT-FACING POD MEMBERS" + "NON CLIENT-FACING POD MEMBERS").
        # We collect chips from ALL of them into the rolling pod-member list.
        pod_member_cols: list[int] = [i for label, i in col_idx.items() if "pod members" in label]

        # Role columns — anything that isn't structural / metadata. The
        # canonical role name comes from the header, normalized.
        role_cols: list[tuple[int, str]] = []
        for label, idx in col_idx.items():
            if not _is_role_header(label):
                continue
            role_cols.append((idx, _canonical_role_from_header(label)))

        # Wipe and rewrite this pod_kind's rows. Cleaner than upserting because
        # the team's roster shifts month-to-month; stale assignments would
        # accumulate otherwise.
        session.query(PodAssignment).filter(PodAssignment.pod_kind == pod_kind).delete()

        current_pod_num: str | None = None
        current_pod_members: list[tuple[str, str, str | None]] = []  # (email, name, role_tag)
        seen_keys: set[tuple[str, str, str, str]] = set()

        for row in rows[header_row_idx + 1 :]:
            cells = row.get("values", [])
            if not cells:
                continue
            detail.rows_parsed += 1

            # Pod # forwards-fills.
            if c_pod_num is not None and c_pod_num < len(cells):
                pn_text = (cells[c_pod_num].get("formattedValue") or "").strip()
                if pn_text:
                    current_pod_num = pn_text
                    current_pod_members = []  # reset on new pod block

            # Pod members — collect chips from EVERY pod-member column on
            # this row (Growth has 2 columns; Editorial has 1). Reset only
            # when at least one pod-member cell on this row carries chips,
            # so blank continuation rows keep the prior pod's roster.
            new_members: list[tuple[str, str, str | None]] = []
            any_pm_chip = False
            for pm_col in pod_member_cols:
                if pm_col >= len(cells):
                    continue
                pm_cell = cells[pm_col]
                chips = _emails_for_cell(pm_cell)
                if chips:
                    any_pm_chip = True
                for chip_i, (email, name) in enumerate(chips):
                    tag = _role_tag_for_chip(pm_cell, chip_i)
                    new_members.append((email, name, tag))
            if any_pm_chip:
                current_pod_members = new_members

            # Each row inside a pod block represents one client.
            client = (
                (cells[c_client].get("formattedValue") or "").strip()
                if c_client < len(cells)
                else ""
            )
            if not client:
                continue

            # 1) Per-row role columns (SE / E / W / AD / AM / etc).
            for col_index, role in role_cols:
                if col_index >= len(cells):
                    continue
                cell = cells[col_index]
                for email, display_name in _emails_for_cell(cell):
                    key = (email, client, pod_kind, role)
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)
                    session.add(
                        PodAssignment(
                            email=email,
                            display_name=display_name,
                            pod_kind=pod_kind,
                            pod_number=current_pod_num,
                            client_name=client,
                            role=role,
                            source_tab=tab,
                        )
                    )
                    detail.rows_imported += 1

            # 2) Pod members — emit a "pod_member" row per (member, this client)
            #    plus a role-tagged row when the tag maps to a canonical role.
            for email, name, tag in current_pod_members:
                # Generic membership entry — useful for "what pod is this
                # email in" lookups regardless of role.
                key = (email, client, pod_kind, "pod_member")
                if key not in seen_keys:
                    seen_keys.add(key)
                    session.add(
                        PodAssignment(
                            email=email,
                            display_name=name,
                            pod_kind=pod_kind,
                            pod_number=current_pod_num,
                            client_name=client,
                            role="pod_member",
                            source_tab=tab,
                        )
                    )
                    detail.rows_imported += 1
                # Role-tag entry — e.g. (SE) → senior_editor. Skip if we
                # already wrote the same row from the per-column pass.
                if tag:
                    canonical = _ROLE_TAG_CANONICAL.get(tag.upper())
                    if canonical:
                        key = (email, client, pod_kind, canonical)
                        if key not in seen_keys:
                            seen_keys.add(key)
                            session.add(
                                PodAssignment(
                                    email=email,
                                    display_name=name,
                                    pod_kind=pod_kind,
                                    pod_number=current_pod_num,
                                    client_name=client,
                                    role=canonical,
                                    source_tab=tab,
                                )
                            )
                            detail.rows_imported += 1

        try:
            session.commit()
            detail.status = "imported"
        except Exception as exc:
            logger.exception("Commit failed for Team Pods import (%s)", pod_kind)
            session.rollback()
            detail.status = "failed"
            detail.skipped_reason = str(exc)
            result.success = False
            result.errors.append(str(exc))

        result.rows_parsed += detail.rows_parsed
        result.rows_imported += detail.rows_imported
        result.details.append(detail)

    # Refresh the auto-populated RBAC groups (Editorial Team / Growth Team /
    # Leadership) from the freshly-imported pod_assignments. Wrap the whole
    # call so a downstream RBAC issue can't sink the Team Pods import — the
    # importer's primary contract is "data lands in pod_assignments".
    if result.rows_imported > 0:
        try:
            from app.services.access import refresh_pod_derived_members

            summary = refresh_pod_derived_members(session)
            logger.info("Refreshed RBAC derived members: %s", summary)
        except Exception:
            logger.exception("Could not refresh RBAC derived-member groups")
            result.errors.append(
                "Team Pods imported but RBAC derived-member refresh failed (see logs)."
            )

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
                result.details.append(
                    TabImportDetail(
                        tab_name=gvd_sheet,
                        month_year=month_year,
                        status="skipped",
                        skipped_reason="Already synced in a prior run",
                        preview_key=f"Master Tracker - {gvd_sheet}",
                    )
                )
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
            rows_parsed_this_tab = 0
            # Forward-fill state: maintainers commonly leave Column A blank
            # on continuation rows that share the previous client (e.g. an
            # LP / Jumbo row that visually belongs to the row above). The
            # importer used to silently drop those rows. We now carry over
            # the last seen client + pods, but ONLY when the row is a
            # real data row (has a content_type AND at least one numeric
            # column) — that protects against accidental blank rows or
            # divider rows inheriting the wrong client.
            last_client_name: str | None = None
            last_growth_pod: str | None = None
            last_ed_pod: str | None = None
            last_client_type: str | None = None
            for row in data_rows:
                result.rows_parsed += 1
                rows_parsed_this_tab += 1
                raw_client = _cell(row, 0)
                content_type = _cell(row, 4) or None

                if raw_client and raw_client.lower() not in ("client", ""):
                    # Normal row — anchor the forward-fill state.
                    client_name = raw_client
                    growth_pod = _cell(row, 1) or None
                    ed_pod = _cell(row, 2) or None
                    client_type = _cell(row, 3) or None
                    last_client_name = client_name
                    last_growth_pod = growth_pod
                    last_ed_pod = ed_pod
                    last_client_type = client_type
                else:
                    # Continuation row candidate. Only adopt the previous
                    # client when the row clearly belongs to a content-type
                    # variant — that means it has a content_type AND at
                    # least one numeric cell anywhere in the week blocks.
                    # An empty / divider row keeps getting dropped as
                    # before, so guesses stay safe.
                    if not last_client_name or not content_type:
                        continue
                    has_any_numeric = any(
                        safe_int(_cell(row, ci)) is not None for ci in range(6, len(row))
                    )
                    if not has_any_numeric:
                        continue
                    client_name = last_client_name
                    growth_pod = last_growth_pod
                    ed_pod = last_ed_pod
                    client_type = last_client_type

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

                    # Upsert key: (month_year, week_number, client_name,
                    # content_type). Without content_type in the key, a
                    # client with multiple content types (article + LP,
                    # or article + jumbo) would silently overwrite its
                    # own rows depending on import order — only the last
                    # type processed would survive. NULL content_type is
                    # treated as a distinct slot for legacy / unspecified
                    # rows.
                    existing_q = select(GoalsVsDelivery).where(
                        GoalsVsDelivery.month_year == month_year,
                        GoalsVsDelivery.week_number == week_num,
                        GoalsVsDelivery.client_name == client_name,
                    )
                    if content_type is None:
                        existing_q = existing_q.where(GoalsVsDelivery.content_type.is_(None))
                    else:
                        existing_q = existing_q.where(GoalsVsDelivery.content_type == content_type)
                    existing = session.execute(existing_q).scalars().first()

                    # Pre-treatment for LP rows from May 2026 onward.
                    # ──────────────────────────────────────────────────
                    # Starting with the May 2026 [Month YYYY] Goals vs
                    # Delivery tab, the team enters LP rows' delivery
                    # numbers as FINAL physical-unit counts (no longer
                    # adjusted for the 0.5 weighting at data-entry
                    # time). The Hub still applies LP's canonical ×0.5
                    # ratio at aggregation, so without compensation the
                    # Overall totals would halve the team's already-
                    # final numbers. To preserve the canonical content-
                    # type ratio table everywhere (article ×1, jumbo
                    # ×2, LP ×0.5) we instead DOUBLE both the CB and AR
                    # numeric columns at ingestion — the ×2 here
                    # cancels the ×0.5 at display, so Overall reads the
                    # same number that's in the spreadsheet. Per-type
                    # LP cells render the doubled stored value; that's
                    # expected (it's the "weighted unit" view).
                    #
                    # Article + Jumbo rows are unaffected — only LP
                    # rows on May 2026+ tabs get the doubling.
                    lp_mult = 1
                    ct_lower = (content_type or "").strip().lower()
                    is_lp_row = ct_lower in ("lp", "landing page", "landing pages")
                    if is_lp_row:
                        try:
                            row_month_dt = datetime.strptime(month_year, "%B %Y")
                            if row_month_dt.year * 12 + row_month_dt.month >= 2026 * 12 + 5:
                                lp_mult = 2
                        except ValueError:
                            lp_mult = 1

                    def _mul(v: int | None, k: int) -> int | None:
                        return v * k if (v is not None and k != 1) else v

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
                        cb_delivered_today=_mul(safe_int(_cell(row, cb_base)), lp_mult),
                        cb_projection=_mul(safe_int(_cell(row, cb_base + 1)), lp_mult),
                        cb_delivered_to_date=_mul(safe_int(_cell(row, cb_base + 2)), lp_mult),
                        cb_monthly_goal=_mul(safe_int(_cell(row, cb_base + 3)), lp_mult),
                        cb_pct_of_goal=_cell(row, cb_base + 4) or None,
                        cb_comments=_cell(row, cb_base + 5) or None,
                        ad_revisions=safe_int(_cell(row, ad_base)),
                        ad_delivered_today=_mul(safe_int(_cell(row, ad_base + 1)), lp_mult),
                        ad_projection=_mul(safe_int(_cell(row, ad_base + 2)), lp_mult),
                        ad_cb_backlog=safe_int(_cell(row, ad_base + 3)),
                        ad_delivered_to_date=_mul(safe_int(_cell(row, ad_base + 4)), lp_mult),
                        ad_monthly_goal=_mul(safe_int(_cell(row, ad_base + 5)), lp_mult),
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
            result.details.append(
                TabImportDetail(
                    tab_name=gvd_sheet,
                    month_year=month_year,
                    rows_parsed=rows_parsed_this_tab,
                    rows_imported=rows_this_tab,
                    status="imported",
                    preview_key=f"Master Tracker - {gvd_sheet}",
                )
            )

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

        # Sort details chronologically (parse month_year "April 2026" -> date)
        def _sort_key(d: TabImportDetail):
            try:
                return datetime.strptime(d.month_year, "%B %Y")
            except ValueError:
                return datetime.max

        result.details.sort(key=_sort_key)

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
# import_growth_pods — BigQuery-backed replacement for the old Team Pods sheet
# ---------------------------------------------------------------------------


# Path to the SQL query. Resolved at import time so we fail fast if the file is
# missing in a container image.
_GROWTH_PODS_SQL_PATH = _Path(__file__).resolve().parent.parent / "sql" / "growth_pods_from_bq.sql"

# BQ Salesforce names sometimes drift from the app's canonical client names
# (rebrands, acquisitions, etc.). Add one row per known drift so the matcher
# doesn't silently drop these assignments.
#   BQ client_name  →  app clients.name
_GROWTH_POD_NAME_OVERRIDES: dict[str, str] = {
    "Genstore": "GenstoreAI",
    "Workleap": "Workleap + Sharegate",
    "Workleap+Sharegate": "Workleap + Sharegate",
}


def _name_key(s: str) -> str:
    """Collapse to lowercase alphanumeric-only — used for fuzzy name matching."""
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def _normalize_growth_pod(raw: str | None) -> str | None:
    """'Pod1' / 'pod 1' / '1' → 'Pod 1'. Matches FilterBar.normalizePod()."""
    if not raw:
        return None
    t = str(raw).strip()
    if not t:
        return None
    digits = "".join(ch for ch in t if ch.isdigit())
    return f"Pod {int(digits)}" if digits else t


# Editorial pods follow the exact same shape — alias for clarity at call sites.
_normalize_editorial_pod = _normalize_growth_pod


def _normalize_category(raw: str | None) -> str | None:
    """ET CP client-block category cell → canonical 'standard' / 'specialized',
    or None when blank/unrecognized. Drives the specialized ×1.4 used-capacity
    weighting; tolerant of casing and minor variants."""
    t = str(raw or "").strip().lower()
    if t.startswith("special"):
        return "specialized"
    if t.startswith("standard"):
        return "standard"
    return None


# Client-name drift between the sheets we ingest and the canonical
# `clients.name` column. Keep this in lock-step with what import_sow_overview
# seeds (the source of truth for client names). Each entry is
# `lower(sheet_name) → lower(canonical_name)`. Used by every importer that
# joins a sheet row to a Client by name.
_CLIENT_NAME_ALIASES: dict[str, str] = {
    "get flex": "flex",
    "genstoreai": "genstoreai",
    "genstore ai": "genstoreai",
    "blvd": "boulevard",
    "meta fb": "meta bmg",
    "meta bmg": "meta bmg",
    "college hunks": "college hunks",
}


def _add_user_client_aliases(session: Session, lookup: dict) -> None:
    """Fold the user-editable `client_name_aliases` table into a lowercased-name
    lookup. Works whether the dict's values are Client objects or client_ids —
    it just points each alias key at whatever the canonical name already maps
    to. Source: the Data Quality → Missing from Hub "Map to client" action."""
    from app.models import ClientNameAlias

    for a in session.execute(select(ClientNameAlias)).scalars():
        raw = a.raw_name.strip().lower()
        canon = a.client_name.strip().lower()
        if canon in lookup and raw not in lookup:
            lookup[raw] = lookup[canon]


def _build_client_name_lookup(
    clients: list[Client], session: Session | None = None
) -> dict[str, Client]:
    """Build a `lowercased_name → Client` map enriched with `_CLIENT_NAME_ALIASES`.
    Pass in every Client from the DB; the alias entries map known sheet-side
    drift back to the canonical row. Centralizing this keeps every importer
    (Operating Model, Capacity Plan, …) matching client names the same way.

    Pass `session` to also fold in the user-editable `client_name_aliases`
    table (mappings confirmed from Data Quality → Missing from Hub)."""
    lookup: dict[str, Client] = {c.name.lower().strip(): c for c in clients}
    for alias, canonical in _CLIENT_NAME_ALIASES.items():
        if canonical in lookup and alias not in lookup:
            lookup[alias] = lookup[canonical]
    if session is not None:
        _add_user_client_aliases(session, lookup)
    return lookup


def _resolve_client(lookup: dict[str, Client], raw_name: str) -> Client | None:
    """Find the Client row matching `raw_name` from a sheet cell. Tries
    exact lowercase first, then aliases, then a fuzzy alphanumeric-only
    key match (`_name_key`) so 'Meta-AI' / 'Meta AI' / 'metaai' all
    resolve to the same row. Returns None when nothing matches."""
    if not raw_name:
        return None
    key = raw_name.strip().lower()
    hit = lookup.get(key)
    if hit:
        return hit
    # Fuzzy fallback — strip everything that isn't [a-z0-9].
    norm = _name_key(raw_name)
    for k, v in lookup.items():
        if _name_key(k) == norm:
            return v
    return None


def _fetch_growth_pod_pairs() -> list[dict]:
    """Run the Growth Pods BQ query and return the raw row dicts."""
    from google.cloud import bigquery

    from app.services.google_auth import get_google_credentials

    creds = get_google_credentials(scopes=["https://www.googleapis.com/auth/bigquery"])
    bq = bigquery.Client(project=settings.bq_project, credentials=creds)
    sql = _GROWTH_PODS_SQL_PATH.read_text()
    return [dict(r) for r in bq.query(sql).result()]


def _preview_et_cp_pod_history(max_rows: int = 20) -> dict:
    """Preview for ET CP Pod History — shows the most recent version tab."""
    service = get_sheets_client()
    meta = (
        service.spreadsheets()
        .get(spreadsheetId=SPREADSHEET_ID, fields="sheets.properties")
        .execute()
    )
    # Find the highest-versioned ET CP tab.
    latest_tab: str | None = None
    latest_version = -1
    for s in meta.get("sheets", []):
        title = s.get("properties", {}).get("title", "")
        m = _ET_CP_TAB_RE.match(title)
        if m and int(m.group(1)) > latest_version:
            latest_version = int(m.group(1))
            latest_tab = title

    if not latest_tab:
        return {"sheet_name": "ET CP Pod History", "headers": [], "rows": [], "total_rows": 0}

    resp = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=SPREADSHEET_ID, range=f"'{latest_tab}'!1:{max_rows + 1}")
        .execute()
    )
    values = resp.get("values", [])
    if not values:
        return {"sheet_name": "ET CP Pod History", "headers": [], "rows": [], "total_rows": 0}

    headers = [str(h) for h in values[0]]
    rows = values[1:]
    return {
        "sheet_name": f"ET CP Pod History (latest: {latest_tab})",
        "headers": headers,
        "rows": rows,
        "total_rows": len(rows),
    }


def _preview_et_cp_version_tab(tab_name: str, max_rows: int = 20) -> dict:
    """Preview a specific historical ET CP version tab (e.g. 'ET CP 2026 [V11
    Mar 2026]'). Used by the Re-sync UI's per-tab dropdown so each ET CP
    snapshot can be inspected independently — not just the latest one.
    """
    service = get_sheets_client()
    resp = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=SPREADSHEET_ID, range=f"'{tab_name}'!1:{max_rows + 1}")
        .execute()
    )
    values = resp.get("values", [])
    if not values:
        return {"sheet_name": tab_name, "headers": [], "rows": [], "total_rows": 0}

    # The ET CP sheets carry several pre-header banner rows before the actual
    # Client / Pod / Pod Members header row. Find that header line so the
    # preview shows a meaningful header (not a row of metadata cells).
    header_idx: int | None = None
    for idx, row in enumerate(values[:10]):
        cells = [str(c).strip().lower() for c in row[:8]]
        if "client" in cells and "pod" in cells:
            header_idx = idx
            break
    if header_idx is None:
        header_idx = 0

    headers = [str(h) for h in values[header_idx]]
    rows = values[header_idx + 1 :]

    # Total row count from grid metadata so the user knows the sheet extends
    # past the preview window.
    meta = (
        service.spreadsheets()
        .get(spreadsheetId=SPREADSHEET_ID, fields="sheets.properties")
        .execute()
    )
    total_rows = 0
    for s in meta.get("sheets", []):
        if s.get("properties", {}).get("title") == tab_name:
            total_rows = s["properties"].get("gridProperties", {}).get("rowCount", 0)
            break

    return {
        "sheet_name": tab_name,
        "headers": headers,
        "rows": [[str(c) if c is not None else "" for c in r] for r in rows],
        "total_rows": total_rows,
    }


def _preview_growth_pods(max_rows: int = 20) -> dict:
    """Return a preview row-set for the Growth Pods source (BigQuery)."""
    rows = _fetch_growth_pod_pairs()
    # Collapse to distinct (client, pod) for preview — the query is per member
    # so the raw result repeats clients across team rows.
    pairs: list[tuple[str, str]] = sorted(
        {
            (r.get("client_name") or "", _normalize_growth_pod(r.get("growth_pod")) or "")
            for r in rows
            if r.get("client_name") and r.get("growth_pod")
        }
    )
    headers = ["client_name", "growth_pod"]
    preview = [[c, p] for c, p in pairs[:max_rows]]
    return {
        "sheet_name": "Growth Pods",
        "headers": headers,
        "rows": preview,
        "total_rows": len(pairs),
    }


def import_growth_pods(session: Session) -> ImportResult:
    """Fetch growth-pod assignments from BigQuery and write them to
    `clients.growth_pod` for every matched client.

    Source query: app/sql/growth_pods_from_bq.sql
      team_pod_assignments (one row per team member × account)  ⋈
      salesforce_int_Account  →  (client_name, growth_pod)

    The BQ result is per-member, so each client repeats once per assigned
    member. We collapse to distinct (client, pod) here — assumption is that
    every member of a given client shares the same growth pod. If that ever
    breaks, we log a warning so the data quality issue is visible.

    Matching: case-insensitive + non-alphanumeric stripped, with a small
    overrides dict (see _GROWTH_POD_NAME_OVERRIDES) for known name drifts.
    BQ clients with no app-side match are surfaced on `result.errors` so the
    caller can eyeball them, but the import still succeeds.
    """
    sheet_name = "Growth Pods"
    result = ImportResult(sheet=sheet_name)

    try:
        bq_rows = _fetch_growth_pod_pairs()

        # Collapse per-member rows to a single pod per client. Members of
        # the same client are expected to share a pod; a member working in
        # a different team-pod doesn't change the client's growth pod.
        # Track every distinct pod we see per client so we can flag the
        # rare case where the assumption breaks.
        client_pods: dict[str, set[str]] = {}
        for r in bq_rows:
            cname = (r.get("client_name") or "").strip()
            pod = _normalize_growth_pod(r.get("growth_pod"))
            if not cname or not pod:
                continue
            client_pods.setdefault(cname, set()).add(pod)

        conflicts: list[str] = []
        pairs: dict[str, str] = {}
        for cname, pods in client_pods.items():
            if len(pods) == 1:
                pairs[cname] = next(iter(pods))
            else:
                # Sort gives a deterministic pick when the data is
                # inconsistent — better than relying on dict iteration
                # order. The warning surfaces the conflict for review.
                chosen = sorted(pods)[0]
                pairs[cname] = chosen
                conflicts.append(f"{cname}: {sorted(pods)} → picked {chosen}")

        if conflicts:
            msg = "Cross-pod members for client(s): " + "; ".join(conflicts)
            logger.warning(msg)
            result.errors.append(msg)

        result.rows_parsed = len(pairs)

        if not pairs:
            result.errors.append("BigQuery returned no (client, pod) pairs")
            result.success = False
            return result

        all_clients = session.execute(select(Client)).scalars().all()
        by_lower = {c.name.lower(): c for c in all_clients}
        by_norm = {_name_key(c.name): c for c in all_clients}

        # Load user-defined DB overrides once for the whole batch.
        db_overrides: dict[str, int] = {
            row.raw_name: row.client_id
            for row in session.execute(
                select(PodNameOverride).where(PodNameOverride.pod_kind == "growth")
            ).scalars()
        }
        by_id: dict[int, Client] = {c.id: c for c in all_clients}

        unmatched: list[str] = []
        for bq_name, pod in pairs.items():
            # DB override takes precedence over the static code dict.
            canonical = _GROWTH_POD_NAME_OVERRIDES.get(bq_name, bq_name)
            if bq_name in db_overrides:
                c = by_id.get(db_overrides[bq_name])
            else:
                c = by_lower.get(canonical.lower()) or by_norm.get(_name_key(canonical))

            # Self-heal: try substring containment before giving up. Catches
            # cases like "Workleap" ↔ "Workleap + Sharegate" automatically
            # without needing a manual override entry.
            if c is None:
                bq_lower = canonical.lower()
                bq_norm = _name_key(canonical)
                for db_name, client in by_lower.items():
                    if bq_lower in db_name or db_name in bq_lower:
                        c = client
                        logger.info("Growth Pods: fuzzy-matched '%s' → '%s'", bq_name, client.name)
                        break
                if c is None:
                    for db_norm_key, client in by_norm.items():
                        if bq_norm in db_norm_key or db_norm_key in bq_norm:
                            c = client
                            logger.info(
                                "Growth Pods: fuzzy-matched (norm) '%s' → '%s'",
                                bq_name,
                                client.name,
                            )
                            break

            if c is None:
                unmatched.append(f"{bq_name} ({pod})")
                # Persist the issue so the Data Quality page can surface it.
                existing_issue = (
                    session.execute(
                        select(PodImportIssue).where(
                            PodImportIssue.raw_name == bq_name,
                            PodImportIssue.pod_kind == "growth",
                        )
                    )
                    .scalars()
                    .first()
                )
                if existing_issue:
                    existing_issue.pod_label = pod
                    existing_issue.last_seen_at = datetime.utcnow()
                    existing_issue.resolved_at = None
                else:
                    session.add(
                        PodImportIssue(
                            raw_name=bq_name,
                            pod_kind="growth",
                            pod_label=pod,
                        )
                    )
                continue

            # Successfully matched — clear any prior unresolved issue.
            existing_issue = (
                session.execute(
                    select(PodImportIssue).where(
                        PodImportIssue.raw_name == bq_name,
                        PodImportIssue.pod_kind == "growth",
                        PodImportIssue.resolved_at.is_(None),
                    )
                )
                .scalars()
                .first()
            )
            if existing_issue:
                existing_issue.resolved_at = datetime.utcnow()

            if c.growth_pod != pod:
                c.growth_pod = pod
            result.rows_imported += 1

        if unmatched:
            msg = "Unmatched BQ clients (no entry in clients table): " + ", ".join(unmatched)
            logger.warning(msg)
            result.errors.append(msg)

        session.commit()
        result.success = True
        logger.info(
            "Growth Pods import: parsed=%d matched=%d unmatched=%d",
            result.rows_parsed,
            result.rows_imported,
            len(unmatched),
        )

    except Exception as exc:
        logger.exception("Error importing Growth Pods from BigQuery")
        session.rollback()
        result.success = False
        result.errors.append(str(exc))

    return result


# ---------------------------------------------------------------------------
# import_et_cp_pod_history
# ---------------------------------------------------------------------------

_MONTH_ABBR_TO_NUM: dict[str, int] = {
    "Jan": 1,
    "Feb": 2,
    "Mar": 3,
    "Apr": 4,
    "May": 5,
    "Jun": 6,
    "Jul": 7,
    "Aug": 8,
    "Sep": 9,
    "Oct": 10,
    "Nov": 11,
    "Dec": 12,
}


_ET_CP_TAB_RE = re.compile(
    r"ET CP (\d{4}) \[V(\d+) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})\]"
)


def import_et_cp_pod_history(session: Session) -> ImportResult:
    """Build client_pod_history from all historical ET CP version tabs.

    For each tab "ET CP 2026 [VN Month Year]", reads ONLY the Pod column
    that corresponds to the tab's own month — that is the confirmed
    historical assignment. Columns after that month are projections and
    are intentionally ignored.

    Clients not in the clients table are recorded in incomplete_clients
    so the Ops team can backfill the SOW Overview. Their pod history rows
    are written with client_id=NULL and back-filled on a later sync when
    _resolve_client() starts matching.
    """
    from app.models import IncompleteClient

    service = get_sheets_client()
    result = ImportResult(sheet="ET CP Pod History")
    _MONTH_ABBR_REV = {v: k for k, v in _MONTH_ABBR_TO_NUM.items()}

    try:
        meta = (
            service.spreadsheets()
            .get(spreadsheetId=SPREADSHEET_ID, fields="sheets.properties")
            .execute()
        )

        # Collect all matching version tabs with parsed metadata.
        # Tuple: (name, version, sheet_year, tab_year, tab_month)
        tabs: list[tuple[str, int, int, int, int]] = []
        for s in meta.get("sheets", []):
            title = s.get("properties", {}).get("title", "")
            m = _ET_CP_TAB_RE.match(title)
            if m:
                tabs.append(
                    (
                        title,
                        int(m.group(2)),  # version number
                        int(m.group(1)),  # sheet year (ET CP YYYY)
                        int(m.group(4)),  # tab year (month year in bracket)
                        _MONTH_ABBR_TO_NUM[m.group(3)],  # tab month
                    )
                )

        if not tabs:
            result.success = False
            result.errors.append("No ET CP version tabs found in spreadsheet")
            return result

        # Process in chronological order (sheet_year, version) so later tabs
        # overwrite earlier projections for the same month.
        tabs.sort(key=lambda x: (x[2], x[1]))

        all_clients = session.execute(select(Client)).scalars().all()
        client_lookup = _build_client_name_lookup(all_clients, session)

        skip_keywords = ("total", "median", "average", "production")

        for tab_name, _version, _sheet_year, year, month in tabs:
            # Per-tab counters — captured into a TabImportDetail at the end of
            # the loop so the Re-sync UI can show a dropdown per ET CP version
            # tab (mirrors the Goals vs Delivery month-tab pattern).
            tab_parsed = 0
            tab_imported = 0
            tab_skipped_reason: str | None = None
            tab_status = "imported"

            resp = (
                service.spreadsheets()
                .values()
                .get(spreadsheetId=SPREADSHEET_ID, range=f"'{tab_name}'")
                .execute()
            )
            all_rows = resp.get("values", [])
            if len(all_rows) < 10:
                continue

            # Locate header row (has both "Client" and "Pod" labels).
            header_row_idx: int | None = None
            pod_col_indices: list[int] = []
            client_col = 2

            for idx, row in enumerate(all_rows):
                has_client = any(
                    _cell(row, c).strip().lower() == "client" for c in range(min(8, len(row)))
                )
                if not has_client:
                    continue
                pod_cols = [c for c in range(len(row)) if _cell(row, c).strip().lower() == "pod"]
                if pod_cols:
                    header_row_idx = idx
                    pod_col_indices = pod_cols
                    client_col = next(
                        (
                            c
                            for c in range(min(8, len(row)))
                            if _cell(row, c).strip().lower() == "client"
                        ),
                        2,
                    )
                    break

            if header_row_idx is None:
                logger.warning("ET CP pod history: no header row in '%s' — skipping", tab_name)
                result.details.append(
                    TabImportDetail(
                        tab_name=tab_name,
                        month_year=f"{_MONTH_ABBR_REV.get(month, '???')} {year}",
                        rows_parsed=0,
                        rows_imported=0,
                        status="skipped",
                        skipped_reason="No header row found in tab",
                        preview_key=tab_name,
                    )
                )
                continue
            # Pick this tab's OWN month column by matching the month-header row
            # ABOVE the client header (e.g. "May 2026") — NOT a positional index.
            # The client block is laid out Jan→Dec (12 cols); the old positional
            # index assumed a 13-month Dec→Dec layout and so read the NEXT month's
            # pod column (e.g. May → June), mis-assigning any client that changed
            # pods between adjacent months. Mirrors _ingest_et_cp_year's logic.
            month_hdr = all_rows[header_row_idx - 1] if header_row_idx > 0 else []
            target_pod_col = next(
                (
                    c
                    for c in pod_col_indices
                    if _parse_et_cp_month_header(_cell(month_hdr, c)) == (year, month)
                ),
                None,
            )
            if target_pod_col is None:
                logger.warning(
                    "ET CP pod history: tab '%s' — no %d-%02d column in header row — skipping",
                    tab_name,
                    year,
                    month,
                )
                result.details.append(
                    TabImportDetail(
                        tab_name=tab_name,
                        month_year=f"{_MONTH_ABBR_REV.get(month, '???')} {year}",
                        rows_parsed=0,
                        rows_imported=0,
                        status="skipped",
                        skipped_reason=f"No {year}-{month:02d} column found in header row",
                        preview_key=tab_name,
                    )
                )
                continue

            for row in all_rows[header_row_idx + 1 :]:
                if not row:
                    continue
                client_name = _cell(row, client_col).strip()
                if not client_name:
                    continue
                if any(kw in client_name.lower() for kw in skip_keywords):
                    continue

                pod_raw = _cell(row, target_pod_col).strip()
                if not pod_raw:
                    continue
                normalized_pod = _normalize_editorial_pod(pod_raw)
                if not normalized_pod:
                    continue
                # Category (standard/specialized) sits two columns right of the
                # month's Pod column in the same client-block row.
                category = _normalize_category(_cell(row, target_pod_col + 2))

                result.rows_parsed += 1
                tab_parsed += 1
                c = _resolve_client(client_lookup, client_name)

                if c is not None:
                    existing = (
                        session.execute(
                            select(ClientPodHistory).where(
                                ClientPodHistory.client_name_raw == client_name,
                                ClientPodHistory.year == year,
                                ClientPodHistory.month == month,
                            )
                        )
                        .scalars()
                        .first()
                    )
                    if existing:
                        existing.client_id = c.id
                        existing.editorial_pod = normalized_pod
                        existing.category = category
                        existing.source_tab = tab_name
                    else:
                        session.add(
                            ClientPodHistory(
                                client_id=c.id,
                                client_name_raw=client_name,
                                year=year,
                                month=month,
                                editorial_pod=normalized_pod,
                                category=category,
                                source_tab=tab_name,
                            )
                        )
                    # Resolve any IncompleteClient stub for this name.
                    stub = (
                        session.execute(
                            select(IncompleteClient).where(
                                IncompleteClient.name_raw == client_name,
                                IncompleteClient.resolved_at.is_(None),
                            )
                        )
                        .scalars()
                        .first()
                    )
                    if stub:
                        stub.resolved_at = datetime.utcnow()

                else:
                    # Upsert IncompleteClient stub.
                    stub = (
                        session.execute(
                            select(IncompleteClient).where(IncompleteClient.name_raw == client_name)
                        )
                        .scalars()
                        .first()
                    )
                    if stub:
                        stub.last_seen_tab = tab_name
                        stub.last_seen_year = year
                        stub.last_seen_month = month
                        stub.resolved_at = None
                        pods = set(stub.known_pods.split(",")) if stub.known_pods else set()
                        pods.add(normalized_pod)
                        stub.known_pods = ",".join(sorted(pods))
                    else:
                        session.add(
                            IncompleteClient(
                                name_raw=client_name,
                                first_seen_tab=tab_name,
                                last_seen_tab=tab_name,
                                first_seen_year=year,
                                first_seen_month=month,
                                last_seen_year=year,
                                last_seen_month=month,
                                known_pods=normalized_pod,
                            )
                        )

                    # Write history row with null client_id as a stub.
                    existing = (
                        session.execute(
                            select(ClientPodHistory).where(
                                ClientPodHistory.client_name_raw == client_name,
                                ClientPodHistory.year == year,
                                ClientPodHistory.month == month,
                            )
                        )
                        .scalars()
                        .first()
                    )
                    if existing:
                        existing.editorial_pod = normalized_pod
                        existing.category = category
                        existing.source_tab = tab_name
                    else:
                        session.add(
                            ClientPodHistory(
                                client_id=None,
                                client_name_raw=client_name,
                                year=year,
                                month=month,
                                editorial_pod=normalized_pod,
                                category=category,
                                source_tab=tab_name,
                            )
                        )

                result.rows_imported += 1
                tab_imported += 1

            session.flush()

            # Capture per-tab summary for the resync UI dropdown.
            result.details.append(
                TabImportDetail(
                    tab_name=tab_name,
                    month_year=f"{_MONTH_ABBR_REV.get(month, '???')} {year}",
                    rows_parsed=tab_parsed,
                    rows_imported=tab_imported,
                    status=tab_status,
                    skipped_reason=tab_skipped_reason,
                    preview_key=tab_name,
                )
            )

        # Whole-year backfill: for each year, use that year's LATEST version tab
        # (the most complete snapshot) to fill per-member capacity +
        # production_history.projected_original for the whole year. Pod history
        # above stays per-tab-month; this adds the capacity/projection data the
        # SYNC button pulls for the current year, but for past years too.
        latest_by_year: dict[int, tuple[str, int]] = {}
        for t_name, t_version, t_sheet_year, _ty, _tm in tabs:
            cur = latest_by_year.get(t_sheet_year)
            if cur is None or t_version > cur[1]:
                latest_by_year[t_sheet_year] = (t_name, t_version)
        for t_sheet_year, (t_name, _v) in latest_by_year.items():
            try:
                ec = _ingest_et_cp_year(session, service, t_name, t_sheet_year)
                result.rows_imported += ec["members"] + ec["projected"]
            except Exception:
                logger.exception("ET CP year ingest failed for %s (continuing)", t_name)

        session.commit()
        result.success = True
        # Sort details chronologically — earliest tab first — mirrors Goals
        # vs Delivery's per-month ordering in the same UI.
        result.details.sort(key=lambda d: d.tab_name)
        logger.info(
            "ET CP pod history: parsed=%d imported=%d tabs=%d",
            result.rows_parsed,
            result.rows_imported,
            len(tabs),
        )

    except Exception as exc:
        logger.exception("Error importing ET CP pod history")
        session.rollback()
        result.success = False
        result.errors.append(str(exc))

    return result


# ---------------------------------------------------------------------------
# backfill_editorial_pod_from_history
# ---------------------------------------------------------------------------


def backfill_editorial_pod_from_history(session: Session) -> ImportResult:
    """For every Hub client where `clients.editorial_pod` is null, look up the
    most recent confirmed pod from `client_pod_history` (by year DESC, month
    DESC) and write it back to `clients.editorial_pod`. Idempotent: clients
    already pod-assigned are skipped.

    Run as the final step of the past-months resync so every client that ever
    appeared in an ET CP capacity-plan tab carries the latest historical pod
    forward — fixes inactive / paused clients that fall off the current ET CP
    tab but still have prior month data.
    """
    from app.models import Client, ClientPodHistory

    result = ImportResult(sheet="Backfill Editorial Pod from history")

    try:
        candidates = (
            session.execute(select(Client).where(Client.editorial_pod.is_(None))).scalars().all()
        )
        result.rows_parsed = len(candidates)

        for client in candidates:
            latest = (
                session.execute(
                    select(ClientPodHistory)
                    .where(
                        ClientPodHistory.client_id == client.id,
                        ClientPodHistory.editorial_pod.is_not(None),
                    )
                    .order_by(
                        ClientPodHistory.year.desc(),
                        ClientPodHistory.month.desc(),
                    )
                    .limit(1)
                )
                .scalars()
                .first()
            )
            if latest and latest.editorial_pod:
                client.editorial_pod = latest.editorial_pod
                result.rows_imported += 1
                # Per-client detail row for the Re-sync UI dropdown.
                # preview_key="" tells the frontend "no further preview to
                # fetch" — the row renders inline (not expandable).
                # TabRow renders month_year as the primary label and
                # tab_name as a dim suffix, so put the client name in
                # month_year and the pod assignment in tab_name.
                result.details.append(
                    TabImportDetail(
                        tab_name=f"{latest.editorial_pod} · from {latest.source_tab or 'history'}",
                        month_year=client.name,
                        rows_parsed=1,
                        rows_imported=1,
                        status="imported",
                        skipped_reason=None,
                        preview_key="",
                    )
                )
            else:
                # Client had no pod history to draw from. Record as skipped
                # so the dropdown shows both buckets clearly.
                result.details.append(
                    TabImportDetail(
                        tab_name="no history",
                        month_year=client.name,
                        rows_parsed=1,
                        rows_imported=0,
                        status="skipped",
                        skipped_reason="No pod history available",
                        preview_key="",
                    )
                )

        session.commit()
        result.success = True
        # Backfilled clients first, then skipped ones — matches the visual
        # weight the user cares about most.
        result.details.sort(key=lambda d: (d.status != "imported", d.tab_name.lower()))
        logger.info(
            "Backfill Editorial Pod: parsed=%d backfilled=%d",
            result.rows_parsed,
            result.rows_imported,
        )

    except Exception as exc:
        logger.exception("Error backfilling editorial pod from history")
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


def _detect_contract_drift(session: Session) -> list[str]:
    """Flag clients whose `clients.start_date` disagrees with the earliest
    activity month in `deliverables_monthly` by more than 3 months.

    Rationale: the Editorial SOW overview sheet overwrites Start/Term/SOW on
    each contract renewal, so Y1 history is lost from that source. The
    Delivered vs Invoiced v2 sheet (→ `deliverables_monthly`) preserves every
    month. Comparing the two exposes the renewal-overwrite case before it
    silently corrupts pacing math (e.g. "Month 8/12, 32%" when the client is
    actually in Month 20 of a 25-month relationship).

    Returns a list of human-readable warning strings. Also logs each one and
    persists the batch as a single AuditLog entry for retrospective review.
    """
    from datetime import date as _date

    warnings: list[str] = []
    clients = session.execute(select(Client)).scalars().all()
    for c in clients:
        if not c.start_date:
            continue
        first = session.execute(
            select(DeliverableMonthly.year, DeliverableMonthly.month)
            .where(
                DeliverableMonthly.client_id == c.id,
                (DeliverableMonthly.articles_sow_target > 0)
                | (DeliverableMonthly.articles_delivered > 0)
                | (DeliverableMonthly.articles_invoiced > 0),
            )
            .order_by(DeliverableMonthly.year, DeliverableMonthly.month)
            .limit(1)
        ).first()
        if not first:
            continue
        f_y, f_m = first
        first_d = _date(f_y, f_m, 1)
        drift_months = (c.start_date.year - first_d.year) * 12 + (
            c.start_date.month - first_d.month
        )
        if abs(drift_months) > 3:
            warnings.append(
                f"{c.name}: clients.start_date={c.start_date.isoformat()} but "
                f"first active month in deliverables_monthly is {first_d.isoformat()} "
                f"({drift_months:+d} months drift). Likely a renewal overwrote the "
                f"original start in the SOW overview sheet — the dashboard derives "
                f"the true start from deliverables_monthly, but someone should add "
                f"back the Y1 row so the sheet matches reality."
            )
    for w in warnings:
        logger.warning("Contract drift: %s", w)
    if warnings:
        try:
            audit = AuditLog(
                entity_type="data_integrity",
                entity_id=None,
                action="CONTRACT_DRIFT_CHECK",
                changes_json=json.dumps({"warnings": warnings}),
                performed_by="system",
            )
            session.add(audit)
            session.commit()
        except Exception:
            logger.exception("Failed to write drift warnings audit entry")
            session.rollback()
    return warnings


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

    # Cross-sheet data-integrity check — runs only when both the SOW overview
    # AND the Delivered vs Invoiced v2 sheets were freshly imported in this
    # batch, so the comparison reflects current data.
    imported_names = {r.sheet for r in results if r.success}
    if {"Editorial SOW overview", "Delivered vs Invoiced v2"}.issubset(imported_names):
        try:
            drift_warnings = _detect_contract_drift(session)
            if drift_warnings:
                # Surface the drift on the sync result so the import wizard
                # shows it alongside per-sheet errors.
                results.append(
                    ImportResult(
                        sheet="Contract drift check",
                        rows_parsed=len(drift_warnings),
                        rows_imported=0,
                        success=True,
                        errors=drift_warnings,
                    )
                )
        except Exception:
            logger.exception("Contract drift check failed")

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


def refresh_computed_kpis(session: Session) -> dict:
    """Recompute the Notion-derived KPIs (revision_rate, turnaround_time,
    second_reviews, capacity_utilization) for every (year, month) that has
    source data in `notion_articles` or `capacity_projections`, capped at 36
    months back.

    Extracted from the `/migrate/refresh-kpis` endpoint so it's callable from
    one place — the endpoint AND the sync manifest's synthetic refresh step
    both run this, instead of duplicating the month-discovery + refresh loop.
    Returns `{months_processed, scores_updated, months}`.
    """
    from datetime import date

    from sqlalchemy import distinct, extract

    from app.models import CapacityProjection
    from app.services.notion_kpi_service import refresh_notion_kpis

    months: set[tuple[int, int]] = set()

    stmt_notion = (
        select(
            distinct(extract("year", NotionArticle.created_date)).label("y"),
            extract("month", NotionArticle.created_date).label("m"),
        )
        .where(NotionArticle.created_date.isnot(None))
        .group_by("y", "m")
    )
    for y, m in session.execute(stmt_notion).all():
        if y is not None and m is not None:
            months.add((int(y), int(m)))

    stmt_cap = select(
        distinct(CapacityProjection.year).label("y"),
        CapacityProjection.month.label("m"),
    ).group_by("y", "m")
    for y, m in session.execute(stmt_cap).all():
        if y is not None and m is not None:
            months.add((int(y), int(m)))

    today = date.today()
    cutoff = today.year * 12 + today.month - 36
    months = {(y, m) for (y, m) in months if (y * 12 + m) >= cutoff}

    sorted_months = sorted(months)
    total_updated = 0
    for y, m in sorted_months:
        try:
            res = refresh_notion_kpis(session, y, m)
            total_updated += int(res.get("updated", 0))
        except Exception:
            logger.exception("refresh_notion_kpis failed for %d-%02d (continuing)", y, m)

    session.commit()
    return {
        "months_processed": len(sorted_months),
        "scores_updated": total_updated,
        "months": [f"{y}-{m:02d}" for y, m in sorted_months],
    }


# ===========================================================================
# Monthly Article Count — per-editor delivered-article log
# ---------------------------------------------------------------------------
# One tab per client (~94 tabs) in the "[Internal] Monthly Article Count/
# Revenue" sheet. We stack every client tab into article_records, exploding
# slash-pair editors so each gets +1 credit, and denormalize each article's
# pod from its resolved client's CURRENT/last editorial pod.
#
# Parsing is ported verbatim from the battle-tested standalone ETL
# (~/python/editorial/editorial_dashboard/extract.py): header aliasing,
# YYMMDD-in-copy-name date parsing with date-text / m-d-yyyy / Excel-serial
# fallbacks, and chunked batchGet + backoff retry (the fix for the historical
# preview/import API errors on this many-tab sheet).
# ===========================================================================

# Tabs that are NOT per-client article logs.
_ARTICLE_NON_CLIENT_TABS = frozenset(
    {
        "MONTHLY_ARTICLES_COUNT",
        "[Compare] MONTHLY ARTICLES COUNT",
        "TEMPLATE",
        "Word Counts November",
    }
)

# Editor cell values that mean "no editor assigned".
_ARTICLE_EDITOR_BLANKS = frozenset(
    {"", "-", "—", "N/A", "NA", "TBD", "PENDING", "ENDED", "PAUSED", "PAUSE", "EDITOR"}
)

# Per-tab header strings → canonical key (row 2 is the header row).
_ARTICLE_HDR_ALIASES = {
    "EDITOR": "EDITOR",
    "WRITER": "WRITER",
    "ARTICLE TITLE": "TITLE",
    "TITLE": "TITLE",
    "DATE SUBMITTED": "DATE",
    "SUBMISSION DATE": "DATE",
    "SUBMITTED": "DATE",
    "DUE DATE": "DATE",
    "DATE": "DATE",
    "WORD COUNT": "WORDS",
    "WORDS": "WORDS",
    "COPY NAME": "COPY",
    "RENAMED": "COPY",
    "LINK": "LINK",
    "TASK ID": "TASK_ID",
    "REVISED": "REVISED",
}

_ARTICLE_DATE_SUFFIX_RE = re.compile(r"\b(\d{6})\b")  # YYMMDD in copy name
_ARTICLE_MONTH_NAMES = {
    "JAN": 1,
    "JANUARY": 1,
    "FEB": 2,
    "FEBRUARY": 2,
    "MAR": 3,
    "MARCH": 3,
    "APR": 4,
    "APRIL": 4,
    "MAY": 5,
    "JUN": 6,
    "JUNE": 6,
    "JUL": 7,
    "JULY": 7,
    "AUG": 8,
    "AUGUST": 8,
    "SEP": 9,
    "SEPT": 9,
    "SEPTEMBER": 9,
    "OCT": 10,
    "OCTOBER": 10,
    "NOV": 11,
    "NOVEMBER": 11,
    "DEC": 12,
    "DECEMBER": 12,
}
_ARTICLE_MONTH_WORD_RE = re.compile(
    r"\b(JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|"
    r"JUL(?:Y)?|AUG(?:UST)?|SEPT?(?:EMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|"
    r"DEC(?:EMBER)?)\b",
    re.IGNORECASE,
)


def _article_retry(fn, attempts: int = 4, base_delay: float = 2.0):
    """Retry transient Sheets API errors (500/503/timeout) with backoff."""
    import time

    for i in range(attempts):
        try:
            return fn()
        except Exception:  # noqa: BLE001 — transient; re-raised on final attempt
            if i == attempts - 1:
                raise
            time.sleep(base_delay * (2**i))
    return None  # unreachable


def _article_two_digit_year(yy: int) -> int | None:
    """Bounded 2-digit-year → full year (drops typos like 290101)."""
    return 2000 + yy if 18 <= yy <= 27 else None


def _article_parse_int(v) -> int | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return int(v)
    try:
        return int(float(str(v).replace(",", "").strip()))
    except ValueError:
        return None


def _article_parse_excel_serial(text_val: str) -> tuple[int | None, int | None]:
    """Sheets sometimes returns dates as serial numbers (days since 1899-12-30)."""
    from datetime import timedelta

    try:
        n = float(str(text_val).strip())
    except (ValueError, TypeError):
        return None, None
    if not (43101 <= n <= 47848):  # 2018-01-01 → 2030-12-31
        return None, None
    try:
        dt = datetime(1899, 12, 30) + timedelta(days=n)
        return dt.year, dt.month
    except (OverflowError, ValueError):
        return None, None


def _article_parse_year_month(copy_name: str, date_text: str) -> tuple[int | None, int | None]:
    """Best-effort (year, month): copy-name YYMMDD → month-word → m/d/yyyy → serial."""
    m = _ARTICLE_DATE_SUFFIX_RE.search(str(copy_name))
    if m:
        s = m.group(1)
        yr = _article_two_digit_year(int(s[:2]))
        mm = int(s[2:4])
        if yr and 1 <= mm <= 12:
            return yr, mm
    txt = str(date_text)
    mword = _ARTICLE_MONTH_WORD_RE.search(txt)
    if mword:
        mm = _ARTICLE_MONTH_NAMES[mword.group(1).upper()]
        yr_m = re.search(r"\b(20\d{2})\b", txt)
        return (int(yr_m.group(1)), mm) if yr_m else (None, mm)
    slash = re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b", txt)
    if slash:
        return int(slash.group(3)), int(slash.group(1))
    return _article_parse_excel_serial(txt)


def _article_row_scan_year_month(row: list) -> tuple[int, int] | None:
    """Last-resort: scan every cell for a plausible YYMMDD token."""
    for cell_val in row:
        if cell_val is None:
            continue
        for m in _ARTICLE_DATE_SUFFIX_RE.finditer(str(cell_val)):
            tok = m.group(1)
            yr = _article_two_digit_year(int(tok[:2]))
            mm = int(tok[2:4])
            if yr and 1 <= mm <= 12:
                return yr, mm
    return None


def _article_build_header_map(header_row: list) -> dict[str, int]:
    out: dict[str, int] = {}
    for idx, raw in enumerate(header_row):
        key = str(raw).strip().upper()
        if key in _ARTICLE_HDR_ALIASES:
            out.setdefault(_ARTICLE_HDR_ALIASES[key], idx)
    return out


def _split_editors(editor_raw: str) -> list[str]:
    """'Shelby/Maggie' → ['Shelby', 'Maggie']. Splits on / & , and 'and'."""
    parts = re.split(r"[/&,]| and ", editor_raw, flags=re.IGNORECASE)
    return [
        p.strip() for p in parts if p.strip() and p.strip().upper() not in _ARTICLE_EDITOR_BLANKS
    ]


def _clean_editor(name: str) -> str:
    return re.sub(r"\s+", " ", str(name)).strip()


def _safe_article_date(y: int, m: int, d: int) -> date | None:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def _excel_serial_to_date(text_val: str) -> date | None:
    from datetime import timedelta

    try:
        n = float(str(text_val).strip())
    except (ValueError, TypeError):
        return None
    if not (43101 <= n <= 47848):  # 2018-01-01 → 2030-12-31
        return None
    try:
        return (datetime(1899, 12, 30) + timedelta(days=n)).date()
    except (OverflowError, ValueError):
        return None


def _article_parse_full(
    copy_name: str, date_text: str
) -> tuple[date | None, int | None, int | None]:
    """Parse (full_date, year, month). full_date is set only when the day is
    known (copy-name YYMMDD, m/d/yyyy, month-word + day + year, or Excel serial).
    year/month are the best-effort calendar fallback used when no full date."""
    # 1. Copy-name YYMMDD suffix — most reliable (year + month + day).
    m = _ARTICLE_DATE_SUFFIX_RE.search(str(copy_name))
    if m:
        s = m.group(1)
        yy, mm, dd = int(s[:2]), int(s[2:4]), int(s[4:6])
        yr = _article_two_digit_year(yy)
        if yr and 1 <= mm <= 12:
            return _safe_article_date(yr, mm, dd), yr, mm
    txt = str(date_text)
    # 2a. ISO yyyy-mm-dd — the standardized target format (sheet proposal).
    iso = re.search(r"\b(20\d{2})-(\d{1,2})-(\d{1,2})\b", txt)
    if iso:
        yr, mm, dd = int(iso.group(1)), int(iso.group(2)), int(iso.group(3))
        return _safe_article_date(yr, mm, dd), yr, mm
    # 2. m/d/yyyy or m-d-yyyy.
    slash = re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b", txt)
    if slash:
        mm, dd, yr = int(slash.group(1)), int(slash.group(2)), int(slash.group(3))
        return _safe_article_date(yr, mm, dd), yr, mm
    # 3. Month word (+ optional day) (+ optional 4-digit year).
    mword = _ARTICLE_MONTH_WORD_RE.search(txt)
    if mword:
        mm = _ARTICLE_MONTH_NAMES[mword.group(1).upper()]
        yr_match = re.search(r"\b(20\d{2})\b", txt)
        yr = int(yr_match.group(1)) if yr_match else None
        day_match = re.search(r"\b(\d{1,2})\b", txt[mword.end() :])
        dd = int(day_match.group(1)) if day_match else None
        if yr and dd:
            return _safe_article_date(yr, mm, dd), yr, mm
        return None, yr, mm
    # 4. Excel/Sheets serial number.
    d = _excel_serial_to_date(txt)
    if d:
        return d, d.year, d.month
    return None, None, None


def _build_editorial_weeks(session: Session) -> list[tuple[date, date, int, int]]:
    """Sorted (start_date, end_date, editorial_year, editorial_month) ranges."""
    rows = session.execute(select(EditorialWeek)).scalars().all()
    return sorted((w.start_date, w.end_date, w.year, w.month) for w in rows)


def _editorial_month_for(
    d: date | None, weeks: list[tuple[date, date, int, int]]
) -> tuple[int, int] | None:
    """Map a calendar date to its editorial (year, month) via the week
    distribution. Returns None when there's no covering week (e.g. the date
    predates coverage) so callers fall back to the calendar month."""
    if d is None or not weeks:
        return None
    if d < weeks[0][0] or d > weeks[-1][1]:
        return None
    for start, end, y, m in weeks:
        if start <= d <= end:
            return (y, m)
    return None


def _reconcile_article_unmapped(session: Session, unresolved: dict[str, int]) -> None:
    """Upsert this run's unresolved client tab names and self-heal the rest
    (mirrors the PodImportIssue pattern). `unresolved` maps raw name → row count."""
    existing = {
        u.raw_value: u
        for u in session.execute(
            select(ArticleUnmappedName).where(ArticleUnmappedName.kind == "client")
        )
        .scalars()
        .all()
    }
    now = datetime.utcnow()
    for raw, count in unresolved.items():
        row = existing.get(raw)
        if row is None:
            session.add(
                ArticleUnmappedName(kind="client", raw_value=raw, occurrences=count, sample_tab=raw)
            )
        else:
            row.occurrences = count
            row.last_seen_at = now
            row.resolved_at = None
    for raw, row in existing.items():
        if raw not in unresolved and row.resolved_at is None:
            row.resolved_at = now


def _parse_revisions(
    revised_raw: str | None, submit_date: date | None, weeks: list[tuple[date, date, int, int]]
) -> tuple[int, list[tuple[date, str]]]:
    """Parse the REVISED cell (often a comma-list of dates) into a revision
    count + resolved (date, editorial-month) events. The cell rarely carries a
    year, so the year is inferred from the article's submitted date (same year,
    or +1 when the revision month is earlier than the submit month → wrapped into
    the next year). count includes every date-like token; events only those we
    could place on a calendar."""
    if not revised_raw:
        return 0, []
    count = 0
    events: list[tuple[date, str]] = []
    for token in str(revised_raw).split(","):
        token = token.strip()
        if not token:
            continue
        mword = _ARTICLE_MONTH_WORD_RE.search(token)
        slash = re.search(r"\b(\d{1,2})[/-](\d{1,2})(?:[/-](20\d{2}))?\b", token)
        if mword:
            mm = _ARTICLE_MONTH_NAMES[mword.group(1).upper()]
            dmatch = re.search(r"\b(\d{1,2})\b", token[mword.end() :])
            dd = int(dmatch.group(1)) if dmatch else 1
            yr: int | None = None
        elif slash:
            mm, dd = int(slash.group(1)), int(slash.group(2))
            yr = int(slash.group(3)) if slash.group(3) else None
        else:
            continue  # not date-like
        if not (1 <= mm <= 12 and 1 <= dd <= 31):
            continue
        count += 1
        if yr is None:
            if submit_date is None:
                continue  # counted, but can't place without a year
            yr = submit_date.year + (1 if mm < submit_date.month else 0)
        rd = _safe_article_date(yr, mm, dd)
        if rd is None:
            continue
        em = _editorial_month_for(rd, weeks)
        my = f"{em[0]:04d}-{em[1]:02d}" if em else f"{yr:04d}-{mm:02d}"
        events.append((rd, my))
    return count, events


def _apply_notion_published(session: Session, records: list[dict]) -> tuple[int, int]:
    """Flag each record's is_published / published_url / notion_matched from the
    Notion Content Machine DB. Match by TASK ID (case_id) first, then a unique
    normalized-title fallback. Returns (matched, published) row counts."""
    notion = session.execute(
        select(
            NotionArticle.case_id,
            NotionArticle.title,
            NotionArticle.cms_status,
            NotionArticle.published_url,
        )
    ).all()

    def _published(cms_status, url) -> bool:
        return bool(url) or (cms_status or "").startswith("Published")

    by_id: dict[str, tuple[bool, str | None]] = {}
    title_counts: dict[str, int] = {}
    by_title_tmp: dict[str, tuple[bool, str | None]] = {}
    for case_id, title, cms_status, url in notion:
        info = (_published(cms_status, url), url)
        if case_id:
            by_id[case_id] = info
        if title:
            key = _name_key(title)
            if key:
                title_counts[key] = title_counts.get(key, 0) + 1
                by_title_tmp[key] = info
    # Keep only unambiguous titles (one Notion row).
    by_title = {k: v for k, v in by_title_tmp.items() if title_counts.get(k) == 1}

    matched = published = 0
    for r in records:
        info = None
        tid = (r.get("task_id") or "").strip()
        if tid and tid.upper().startswith("ID-") and tid in by_id:
            info = by_id[tid]
        elif r.get("article_title"):
            info = by_title.get(_name_key(r["article_title"]))
        if info is not None:
            r["notion_matched"] = True
            r["is_published"] = info[0]
            r["published_url"] = info[1]
            matched += 1
            if info[0]:
                published += 1
        else:
            r["notion_matched"] = False
            r["is_published"] = False
            r["published_url"] = None
    return matched, published


def import_monthly_article_count(session: Session) -> ImportResult:
    """Stack every client tab of the Monthly Article Count sheet into
    article_records (one row per article-editor; full rebuild each run)."""
    import hashlib

    from sqlalchemy import delete

    result = ImportResult(sheet="Monthly Article Count")
    service = get_sheets_client()

    # 1. Fuzzy client lookup + DB-stored aliases (admin-added) merged in.
    clients = session.execute(select(Client)).scalars().all()
    lookup = _build_client_name_lookup(clients)
    for a in (
        session.execute(select(ArticleNameAlias).where(ArticleNameAlias.kind == "client"))
        .scalars()
        .all()
    ):
        canon = _resolve_client(lookup, a.canonical_value)
        if canon is not None:
            lookup.setdefault(a.raw_value.strip().lower(), canon)

    # Aliases may carry a date window ('YYYY-MM', inclusive bounds, NULL =
    # open) so one raw name can map to different people over time (e.g. "Sam").
    # {raw_lower: [(valid_from, valid_to, canonical), ...]}
    def _alias_map(kind: str) -> dict[str, list[tuple[str | None, str | None, str]]]:
        out: dict[str, list[tuple[str | None, str | None, str]]] = {}
        for a in (
            session.execute(select(ArticleNameAlias).where(ArticleNameAlias.kind == kind))
            .scalars()
            .all()
        ):
            out.setdefault(a.raw_value.strip().lower(), []).append(
                (a.valid_from, a.valid_to, a.canonical_value)
            )
        return out

    def _alias_resolve(
        amap: dict[str, list[tuple[str | None, str | None, str]]],
        raw_lower: str,
        ym: str | None,
    ) -> str | None:
        """Windowed rows win when the article's month falls inside; a windowless
        row is the fallback. Undated articles only match windowless aliases."""
        rows = amap.get(raw_lower)
        if not rows:
            return None
        fallback = None
        for vfrom, vto, canon in rows:
            if vfrom is None and vto is None:
                fallback = canon
                continue
            if ym is not None and (vfrom is None or vfrom <= ym) and (vto is None or ym <= vto):
                return canon
        return fallback

    editor_alias = _alias_map("editor")
    writer_alias = _alias_map("writer")
    # Editorial week distribution — maps each article date to its editorial month.
    editorial_weeks = _build_editorial_weeks(session)

    # 2. List client tabs.
    try:
        meta = _article_retry(
            lambda: (
                service.spreadsheets()
                .get(
                    spreadsheetId=ARTICLE_COUNT_ID,
                    fields="sheets.properties(title,hidden,gridProperties(rowCount))",
                )
                .execute()
            )
        )
    except Exception as exc:  # noqa: BLE001
        result.success = False
        result.errors.append(f"Could not read Monthly Article Count metadata: {exc}")
        return result

    # Include hidden tabs: paused/ended clients are hidden in the sheet UI but
    # their article history is still wanted. Only NON_CLIENT_TABS are skipped.
    tabs = [
        s["properties"]["title"]
        for s in meta.get("sheets", [])
        if s["properties"]["title"] not in _ARTICLE_NON_CLIENT_TABS
    ]

    # 3. Chunked batchGet (25 ranges/call) + retry.
    value_ranges: list[dict] = []
    chunk = 25
    for i in range(0, len(tabs), chunk):
        chunk_tabs = tabs[i : i + chunk]
        ranges = [f"'{t}'!A1:AT" for t in chunk_tabs]
        try:
            resp = _article_retry(
                lambda r=ranges: (
                    service.spreadsheets()
                    .values()
                    .batchGet(
                        spreadsheetId=ARTICLE_COUNT_ID,
                        ranges=r,
                        valueRenderOption="FORMATTED_VALUE",
                    )
                    .execute()
                )
            )
            value_ranges.extend(resp.get("valueRanges", []))
        except Exception as exc:  # noqa: BLE001
            result.errors.append(
                f"batchGet failed for tabs {chunk_tabs[0]}…{chunk_tabs[-1]}: {exc}"
            )

    # 4. Parse rows → exploded per-editor mappings.
    records: list[dict] = []
    revision_rows: list[dict] = []
    unresolved: dict[str, int] = {}
    parsed = 0
    # Per-(client, month) editorial pod from ClientPodHistory — the pod AS-OF the
    # article's editorial month. Articles bucket by THIS, not the client's current
    # pod, so historical months attribute to the pod that actually did the work.
    # Months with no ET CP coverage (and unresolved clients) get no pod →
    # "Unassigned". No fallback by design — the gap is surfaced in Data Quality.
    pod_by_cm: dict[tuple[int, int, int], str | None] = {
        (cph.client_id, cph.year, cph.month): cph.editorial_pod
        for cph in session.execute(
            select(ClientPodHistory).where(ClientPodHistory.client_id.isnot(None))
        ).scalars()
    }
    for tab, vr in zip(tabs, value_ranges):
        values = vr.get("values", [])
        if len(values) < 2:
            continue
        # Detect the header row instead of assuming row 2: most tabs carry a
        # banner ("MONTHLY ARTICLES COUNT 🔎 [CLIENT]") on row 1 with headers on
        # row 2, but some (e.g. Felt) put headers on row 1 with no banner. Scan
        # the first few rows for the one that maps an EDITOR column.
        header_idx = None
        hmap: dict = {}
        for hi in range(min(5, len(values))):
            cand = _article_build_header_map(values[hi])
            if "EDITOR" in cand:
                header_idx, hmap = hi, cand
                break
        if header_idx is None:
            continue
        client_obj = _resolve_client(lookup, tab)
        if client_obj is not None:
            client_name, client_id = client_obj.name, client_obj.id
            # growth_pod has no per-month source (ET CP is editorial-only), so it
            # stays the client's current growth pod. editorial_pod is resolved
            # per-article below from pod_by_cm.
            gpod = _normalize_editorial_pod(client_obj.growth_pod)
        else:
            client_name, client_id, gpod = tab.strip(), None, None

        for r_idx, row in enumerate(values[header_idx + 1 :], start=header_idx + 2):
            if not row:
                continue

            def cell(canon, _row=row, _hmap=hmap):
                idx = _hmap.get(canon)
                return _row[idx] if idx is not None and idx < len(_row) else ""

            editor_raw = str(cell("EDITOR")).strip()
            if editor_raw.upper() in _ARTICLE_EDITOR_BLANKS:
                continue
            parsed += 1
            copy_name = str(cell("COPY"))
            date_text = str(cell("DATE"))
            sub_date, cal_year, cal_month = _article_parse_full(copy_name, date_text)
            if cal_year is None or cal_month is None:
                scan = _article_row_scan_year_month(row)
                if scan:
                    cal_year, cal_month = scan
            # Map to the editorial month via the week distribution; fall back to
            # the calendar month when the date predates week coverage.
            em = _editorial_month_for(sub_date, editorial_weeks)
            year, month = em if em else (cal_year, cal_month)
            month_year = f"{year:04d}-{month:02d}" if year and month else None
            # As-of-month editorial pod (no fallback — absent → None/Unassigned).
            eff_pod = (
                pod_by_cm.get((client_id, year, month)) if client_id and year and month else None
            )
            # Non-cryptographic content fingerprint (stable per physical row).
            uid = hashlib.sha256(f"{tab}|{r_idx}".encode()).hexdigest()[:16]
            editors = _split_editors(editor_raw)
            collab = len(editors) > 1
            writer_raw = str(cell("WRITER")).strip() or None
            writer_name = (
                _alias_resolve(writer_alias, writer_raw.strip().lower(), month_year)
                or _clean_editor(writer_raw)
                if writer_raw
                else None
            )
            title = str(cell("TITLE")).strip() or None
            link = str(cell("LINK")).strip() or None
            words = _article_parse_int(cell("WORDS"))
            revised = str(cell("REVISED")).strip() or None
            task_id = str(cell("TASK_ID")).strip() or None
            rev_count, rev_events = _parse_revisions(revised, sub_date, editorial_weeks)
            rev_dates_iso = [d.isoformat() for d, _ in rev_events]
            for ed in editors:
                editor_name = _alias_resolve(
                    editor_alias, ed.strip().lower(), month_year
                ) or _clean_editor(ed)
                records.append(
                    {
                        "article_uid": uid,
                        "client_name": client_name,
                        "client_id": client_id,
                        "source_tab": tab,
                        "editor_name": editor_name,
                        "editor_raw": editor_raw,
                        "collaboration": collab,
                        "writer_name": writer_name,
                        "writer_raw": writer_raw,
                        "editorial_pod": eff_pod,
                        "growth_pod": gpod,
                        "article_title": title,
                        "copy_name": copy_name or None,
                        "link": link,
                        "word_count": words,
                        "date_submitted_raw": date_text or None,
                        "submitted_date": sub_date,
                        "year": year,
                        "month": month,
                        "month_year": month_year,
                        "revised_raw": revised,
                        "revision_count": rev_count,
                        "revision_dates": rev_dates_iso or None,
                        "task_id": task_id,
                        "source_row": r_idx,
                    }
                )
                # Revision VOLUME rows — one per (editor, revision event), bucketed
                # by the revision's own editorial month. Pod is resolved as-of the
                # revision's month (rework capacity lands when it happens).
                for rd, rmy in rev_events:
                    rev_pod = (
                        pod_by_cm.get((client_id, int(rmy[:4]), int(rmy[5:7])))
                        if client_id and rmy and len(rmy) == 7
                        else None
                    )
                    revision_rows.append(
                        {
                            "article_uid": uid,
                            "client_name": client_name,
                            "editor_name": editor_name,
                            "writer_name": writer_name,
                            "editorial_pod": rev_pod,
                            "growth_pod": gpod,
                            "revision_date": rd,
                            "month_year": rmy,
                        }
                    )
                if client_id is None:
                    unresolved[client_name] = unresolved.get(client_name, 0) + 1

    # 5. Notion published match (TASK ID → unique-title fallback).
    matched, published = _apply_notion_published(session, records)

    # 6. Full rebuild — the source has no reliable row key.
    session.execute(delete(ArticleRevision))
    session.execute(delete(ArticleRecord))
    session.flush()
    if records:
        session.bulk_insert_mappings(ArticleRecord, records)
    if revision_rows:
        session.bulk_insert_mappings(ArticleRevision, revision_rows)

    # 7. Self-heal the unmapped-client audit.
    _reconcile_article_unmapped(session, unresolved)
    session.commit()

    result.rows_parsed = parsed
    result.rows_imported = len(records)
    if unresolved:
        sample = ", ".join(sorted(unresolved)[:10])
        result.errors.append(
            f"{len(unresolved)} client tab(s) unresolved to a Hub client (no pod): {sample}"
            + ("…" if len(unresolved) > 10 else "")
        )
    return result


def _preview_monthly_article_count(max_rows: int = 20) -> dict:
    """Preview the first client tab (header on row 2) + a sample of its rows."""
    service = get_sheets_client()
    meta = (
        service.spreadsheets()
        .get(
            spreadsheetId=ARTICLE_COUNT_ID,
            fields="sheets.properties(title,hidden)",
        )
        .execute()
    )
    # Count every client tab (hidden included — the importer reads them all);
    # but display the first VISIBLE tab so the sample is an active client.
    props = [s["properties"] for s in meta.get("sheets", [])]
    client_tabs = [p["title"] for p in props if p["title"] not in _ARTICLE_NON_CLIENT_TABS]
    visible_tabs = [
        p["title"]
        for p in props
        if not p.get("hidden") and p["title"] not in _ARTICLE_NON_CLIENT_TABS
    ]
    if not client_tabs:
        return {"sheet_name": "Monthly Article Count", "headers": [], "rows": [], "total_rows": 0}
    first = (visible_tabs or client_tabs)[0]
    resp = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=ARTICLE_COUNT_ID, range=f"'{first}'!1:{max_rows + 2}")
        .execute()
    )
    values = resp.get("values", [])
    header = values[1] if len(values) >= 2 else (values[0] if values else [])
    data = values[2:] if len(values) > 2 else []
    return {
        "sheet_name": f"Monthly Article Count · {first} (1 of {len(client_tabs)} client tabs)",
        "headers": [str(h) for h in header],
        "rows": [[str(c) if c is not None else "" for c in r] for r in data[:max_rows]],
        "total_rows": len(client_tabs),
    }
