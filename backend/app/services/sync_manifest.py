"""Sync Manifest — the single source of truth for *what gets synced*.

Every sync trigger reads its step list from here:
  • the SYNC button (scope="current"),
  • Re-sync Past Months (scope="past"),
  • the month-rollover auto-resync + a future cron (scope="full"),
  • any manual API/agent call.

Add a new importer in ONE place — declare a `ManifestStep` with its scope —
and it automatically flows into all of the above and into the progress UIs
(which render from `GET /api/migrate/sync-plan`). No more keeping a frontend
`IMPORTABLE_EXACT` / `RESYNC_STEPS` list in sync with the backend by hand.

Scopes:
  • "current" — refreshed on every SYNC (this month's live sheets).
  • "past"    — the heavier "Re-sync Past Months" pass: re-reads closed-month
                tabs + annual config the regular SYNC freezes.
  • "full"    — current ++ past, i.e. exactly "click SYNC then Re-sync Past
                Months". Used by the month-rollover trigger and cron.

Execution reuses `migration_service.import_all` (which writes the audit-log
"synced" row) and the existing importer fns — this module declares the plan,
it does not reimplement importing.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime
from typing import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import EditorialWeek, SheetSyncHistory
from app.services.migration_service import (
    ImportResult,
    backfill_editorial_pod_from_history,
    import_all,
    import_delivery_schedules,
    import_et_cp_pod_history,
    import_goals_vs_delivery,
    import_model_assumptions,
    import_pod_history,
    import_team_pods,
    import_week_distribution,
    list_available_sheets,
    refresh_computed_kpis,
)

logger = logging.getLogger(__name__)

# Sheet whose per-month `synced_at` tells us if a past-resync has run since the
# current editorial month began (drives the month-rollover due-check).
GOALS_SHEET_NAME = "Master Tracker - Goals vs Delivery"

REFRESH_KPIS_KEY = "@refresh-kpis"
REFRESH_KPIS_LABEL = "Refresh computed KPIs"

WAREHOUSE_KEY = "@warehouse-publish"
WAREHOUSE_PAST_KEY = "@warehouse-publish-past"
WAREHOUSE_LABEL = "Publish warehouse (BigQuery)"


def _warehouse_publish_run(session: Session) -> "list[ImportResult]":
    """Rebuild the layered BigQuery warehouse (raw → int → views) from the
    just-synced Postgres state, so BQ-backed dashboards
    (settings.dashboard_source == 'bq') see fresh numbers right after any
    SYNC / Re-sync / wizard import. The etl package is mounted at /app/etl in
    dev; in environments without it the step fails loudly (not silently)."""
    try:
        from etl.load import get_bq
        from etl.warehouse.build import build_all
        from etl.warehouse.views import create_views
    except ImportError as exc:  # etl/ not present in this deployment
        return [
            ImportResult(
                sheet=WAREHOUSE_LABEL,
                rows_parsed=0,
                rows_imported=0,
                success=False,
                errors=[f"etl package unavailable: {exc}"],
            )
        ]
    counts = build_all()
    views = create_views(get_bq())
    # Invalidate the BQ dashboard read cache so BQ-served dashboards show the
    # freshly published numbers within cache_token_poll_seconds on every
    # instance (see services/bq_cache.py). A bump failure must not fail the
    # publish (which already succeeded) — the TTL is the fallback.
    try:
        from app.services.bq_cache import bump_token

        bump_token(session)
    except Exception:
        logger.warning("cache token bump failed after warehouse publish", exc_info=True)
    return [
        ImportResult(
            sheet=WAREHOUSE_LABEL,
            rows_parsed=len(counts) + len(views),
            rows_imported=sum(counts.values()),
            success=True,
        )
    ]


_MONTHS = [
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

Runner = Callable[[Session], "list[ImportResult]"]


@dataclass(frozen=True)
class ManifestStep:
    """One declared unit of sync work.

    `run` executes it and returns the ImportResults. `dynamic_prefix` marks a
    placeholder that the planner expands into one concrete step per matching
    live sheet (e.g. the versioned "ET CP 2026 [V14 …]" tab) — those have no
    `run` of their own; they're imported by sheet name via `run_step`.
    """

    key: str
    label: str
    scope: str  # "current" | "past"
    run: Runner | None = None
    dynamic_prefix: str | None = None
    description: str | None = None  # optional UI gloss (shown in the Re-sync card)


def _sheet(name: str) -> ManifestStep:
    """A current-scope step that imports a single named sheet through
    `import_all` (so it's audit-logged like every other sheet import)."""

    def run(session: Session) -> list[ImportResult]:
        return import_all(session, [name])

    return ManifestStep(
        key=name,
        label=name,
        scope="current",
        run=run,
    )


def _refresh_kpis_run(session: Session) -> list[ImportResult]:
    info = refresh_computed_kpis(session)
    return [
        ImportResult(
            sheet=REFRESH_KPIS_LABEL,
            rows_parsed=int(info.get("months_processed", 0)),
            rows_imported=int(info.get("scores_updated", 0)),
            success=True,
        )
    ]


NAME_MAP_KEY = "@name-mappings"
NAME_MAP_LABEL = "Editorial Name Mappings → BigQuery"

WRITER_DESIRED_KEY = "@writer-desired"
WRITER_DESIRED_LABEL = "Writer Desired (form) → BigQuery"


def _writer_desired_run(session: Session) -> "list[ImportResult]":
    """Publish writers' self-reported 'desired article total' (per writer ×
    month) from the Google Form responses sheet to BigQuery
    `editorial_writer_desired` — the capacity basis in the editorial-planning
    Hub's Writers model. Adopted from that Hub's manual seed script so it stays
    fresh on the daily trigger. Runs AFTER @name-mappings so the roster +
    name-map it reconciles against are already fresh. Fails loudly if the etl
    package is absent (never silently)."""
    try:
        from etl.build_writer_desired import publish_writer_desired_from_sheet
    except ImportError as exc:
        return [
            ImportResult(
                sheet=WRITER_DESIRED_LABEL,
                rows_parsed=0,
                rows_imported=0,
                success=False,
                errors=[f"etl package unavailable: {exc}"],
            )
        ]
    info = publish_writer_desired_from_sheet(session)
    return [
        ImportResult(
            sheet=WRITER_DESIRED_LABEL,
            rows_parsed=info["rows"],
            rows_imported=info["rows"],
            success=True,
        )
    ]


def _name_mappings_run(session: Session) -> "list[ImportResult]":
    """Publish the DaniQ-editable 'Editorial Name Mappings' sheet to BigQuery
    `editorial_name_map` — the source the importer + warehouse read for
    name/client normalization (Phase 1b). Runs BEFORE Monthly Article Count so
    the names it resolves are fresh. Fails loudly if the etl package is absent."""
    try:
        from etl.build_mappings import (
            publish_name_map_from_sheet,
            publish_roster_exclusions_from_sheet,
        )
    except ImportError as exc:
        return [
            ImportResult(
                sheet=NAME_MAP_LABEL,
                rows_parsed=0,
                rows_imported=0,
                success=False,
                errors=[f"etl package unavailable: {exc}"],
            )
        ]
    info = publish_name_map_from_sheet()
    # Also publish the roster Exclusions tab → editorial_roster_exclusions, which
    # the v_editorial_roster view filters out. Same sheet, same safe publish path.
    excl = publish_roster_exclusions_from_sheet()
    return [
        ImportResult(
            sheet=NAME_MAP_LABEL, rows_parsed=info["rows"], rows_imported=info["rows"], success=True
        ),
        ImportResult(
            sheet="Roster Exclusions → BigQuery",
            rows_parsed=excl["rows"],
            rows_imported=excl["rows"],
            success=True,
        ),
    ]


# ── current scope — what SYNC refreshes on every click ──────────────────────
# Mirrors what the frontend used to hardcode in IMPORTABLE_EXACT/PREFIXES, now
# owned here. The two dynamic-prefix entries expand to the live versioned tabs.
CURRENT_STEPS: list[ManifestStep] = [
    _sheet("Editorial SOW overview"),
    _sheet("Delivered vs Invoiced v2"),
    _sheet("Editorial Operating Model"),
    # NOTE: the four "AI Monitoring - *" sheets are intentionally NOT in the
    # current scope — Writer AI Monitoring scans are paused upstream, so the
    # daily cron + SYNC button no longer touch them (they were the recurring
    # "Failed to fetch" noise). They remain importable on demand from the
    # Import Wizard (`/data-management/import` → list_available_sheets +
    # IMPORT_DISPATCH, independent of this manifest). Re-add them here to put
    # them back on the automatic SYNC.
    _sheet("Master Tracker - Cumulative"),
    _sheet("Master Tracker - Goals vs Delivery"),  # current month (default mode)
    _sheet("Growth Pods"),
    ManifestStep(
        NAME_MAP_KEY,
        NAME_MAP_LABEL,
        "current",
        run=_name_mappings_run,
        description="Publish the Name Mappings sheet to BigQuery editorial_name_map",
    ),
    ManifestStep(
        WRITER_DESIRED_KEY,
        WRITER_DESIRED_LABEL,
        "current",
        run=_writer_desired_run,
        description="Publish writers' desired-article form responses to BigQuery editorial_writer_desired",
    ),
    _sheet("Monthly Article Count"),
    ManifestStep("@et-cp", "ET CP 2026 (current version)", "current", dynamic_prefix="ET CP 2026"),
    ManifestStep(
        "@kpi-scores", "Monthly KPI Scores", "current", dynamic_prefix="Monthly KPI Scores"
    ),
    ManifestStep(
        "@kpi-scores-mock",
        "Monthly KPI Scores",
        "current",
        dynamic_prefix="[Mock] Monthly KPI Scores",
    ),
    ManifestStep(REFRESH_KPIS_KEY, REFRESH_KPIS_LABEL, "current", run=_refresh_kpis_run),
    ManifestStep(
        WAREHOUSE_KEY,
        WAREHOUSE_LABEL,
        "current",
        run=_warehouse_publish_run,
        description="Rebuild the BigQuery warehouse the dashboards read",
    ),
]

# ── past scope — the "Re-sync Past Months" pass ─────────────────────────────
PAST_STEPS: list[ManifestStep] = [
    ManifestStep(
        "goals-vs-delivery",
        "Master Tracker - Goals vs Delivery",
        "past",
        run=lambda s: [import_goals_vs_delivery(s, mode="all")],
        description="Every [Month Year] Goals vs Delivery monthly tab",
    ),
    ManifestStep(
        "week-distribution",
        "Master Tracker - Week Distribution",
        "past",
        run=lambda s: [import_week_distribution(s)],
        description="<YYYY> Week Distribution — drives the 'As Of' badge",
    ),
    ManifestStep(
        "team-pods",
        "Team Pods - Editorial + Growth",
        "past",
        run=lambda s: [import_team_pods(s)],
        description="RBAC group auto-membership",
    ),
    ManifestStep(
        "et-cp-history",
        "ET CP Pod History",
        "past",
        run=lambda s: [import_et_cp_pod_history(s)],
        description="Every historical ET CP version tab — confirmed pod history",
    ),
    ManifestStep(
        "team-pods-history",
        "Team Pods History",
        "past",
        run=lambda s: [import_pod_history(s)],
        description="Every monthly Team Pods tab — member+client↔pod history (both kinds)",
    ),
    ManifestStep(
        "model-assumptions",
        "Model Assumptions",
        "past",
        run=lambda s: [import_model_assumptions(s)],
        description="Capacity model parameters (categorisation, ramp-up, capacity targets) — changes a few times a year, so past-scope only",
    ),
    ManifestStep(
        "delivery-schedules",
        "Delivery Schedules",
        "past",
        run=lambda s: [import_delivery_schedules(s)],
        description="Per-SOW-size article distribution templates (240/220/180/120/125) — changes rarely, so past-scope only",
    ),
    ManifestStep(
        "backfill-editorial-pod",
        "Backfill Editorial Pod from history",
        "past",
        run=lambda s: [backfill_editorial_pod_from_history(s)],
        description="Fills clients.editorial_pod from the most recent confirmed history",
    ),
    ManifestStep(
        WAREHOUSE_PAST_KEY,
        WAREHOUSE_LABEL,
        "past",
        run=_warehouse_publish_run,
        description="Rebuild the BigQuery warehouse the dashboards read",
    ),
]

ALL_STEPS = CURRENT_STEPS + PAST_STEPS
_FIXED_BY_KEY: dict[str, ManifestStep] = {st.key: st for st in ALL_STEPS if st.run is not None}


def steps_for_scope(scope: str) -> list[ManifestStep]:
    # The warehouse publish ALWAYS runs (~20 s, parallel loads): it refreshes
    # the processed layer in BOTH sinks — Postgres `warehouse` schema (what
    # the app can serve) and BigQuery (analytics mirror / backup for other
    # projects) — regardless of which source the dashboards read.
    if scope == "current":
        return list(CURRENT_STEPS)
    if scope == "past":
        return list(PAST_STEPS)
    if scope == "full":
        # full == click SYNC, then Re-sync Past Months (current then past).
        # Publish ONCE at the very end — drop the current-scope publish so the
        # warehouse isn't rebuilt twice in one run.
        cur = [s for s in CURRENT_STEPS if s.key != WAREHOUSE_KEY]
        return cur + PAST_STEPS
    raise ValueError(f"Unknown sync scope '{scope}' (expected current|past|full)")


def resolve_plan(scope: str, available: list[dict] | None = None) -> list[dict]:
    """Resolve a scope into the ordered, concrete step list the UI renders +
    drives. Dynamic-prefix steps expand into one entry per matching live sheet.
    `available` is the output of `list_available_sheets()`; fetched lazily only
    when an expansion is actually needed.
    """
    steps = steps_for_scope(scope)
    if any(st.dynamic_prefix for st in steps) and available is None:
        try:
            available = list_available_sheets()
        except Exception:
            logger.warning("sync-plan: could not list sheets to expand dynamic steps")
            available = []
    names = [s["name"] for s in (available or [])]

    plan: list[dict] = []
    for st in steps:
        if st.dynamic_prefix:
            for n in names:
                if n.startswith(st.dynamic_prefix):
                    plan.append(
                        {"key": n, "label": n, "scope": st.scope, "description": st.description}
                    )
        else:
            plan.append(
                {"key": st.key, "label": st.label, "scope": st.scope, "description": st.description}
            )
    return plan


def run_step(session: Session, key: str) -> list[ImportResult]:
    """Execute a single step by key. Fixed steps run their declared `run`;
    any other key is treated as a live sheet name (a dynamic-prefix expansion)
    and imported via `import_all`."""
    st = _FIXED_BY_KEY.get(key)
    if st is not None and st.run is not None:
        return st.run(session)
    return import_all(session, [key])


# ── month-rollover due-check ────────────────────────────────────────────────


def current_editorial_month(
    session: Session, today: date | None = None
) -> tuple[int, int, date] | None:
    """Latest editorial month whose Week 1 started on or before `today`.
    Returns (year, month, week1_start) or None when weeks aren't loaded or
    today precedes every known Week 1. Mirrors the frontend's
    `currentEditorialMonth` so server + client agree."""
    today = today or date.today()
    rows = (
        session.execute(select(EditorialWeek).where(EditorialWeek.week_number == 1)).scalars().all()
    )
    best: tuple[int, int, date] | None = None
    for w in rows:
        if w.start_date and w.start_date <= today:
            if best is None or w.start_date > best[2]:
                best = (w.year, w.month, w.start_date)
    return best


def monthly_resync_due(session: Session, today: date | None = None) -> dict:
    """Whether the past-months resync hasn't run since the current editorial
    month began — i.e. a new month rolled over and last month's final numbers
    haven't been pulled yet. Compares the latest Goals-tab `synced_at` against
    the current editorial month's Week-1 start."""
    today = today or date.today()
    cur = current_editorial_month(session, today)
    last_goals: datetime | None = session.execute(
        select(SheetSyncHistory.synced_at)
        .where(SheetSyncHistory.sheet_name == GOALS_SHEET_NAME)
        .order_by(SheetSyncHistory.synced_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    last_iso = last_goals.isoformat() if last_goals else None

    if cur is None:
        # Can't pin the editorial month → don't force a heavy resync.
        return {
            "due": False,
            "current_month": None,
            "month_start": None,
            "last_goals_sync": last_iso,
        }

    year, month, start = cur
    due = last_goals is None or last_goals.date() < start
    return {
        "due": due,
        "current_month": f"{_MONTHS[month - 1]} {year}",
        "month_start": start.isoformat(),
        "last_goals_sync": last_iso,
    }
