"""Publish writers' self-reported "desired article total" (per writer × month)
from the Google Form responses sheet to BigQuery `editorial_writer_desired`.

Ported from the planning-hub's `scripts/seed_writer_desired.mjs` so the same
table stays fresh on the Editorial Hub's daily trigger instead of a manual
`npm run seed:writer-desired`. Wired as manifest step `@writer-desired`
(current scope → runs on every SYNC + daily cron).

The output table is the capacity BASIS in the planning-hub's Writers model
(`getWriterDesired()` reads `writer_canonical, ym, desired, days, clients, ooo,
weekly_breakdown, current_assignments, submitted_at`), so the column
contract below is load-bearing — keep names/types stable or coordinate.

Name reconciliation goes through the CENTRAL `editorial_name_map` (kind=writer)
+ `v_editorial_roster` — the same source the importer/warehouse canonicalize
against — so the planning hub can retire its local alias list. The map covers
every known form spelling (linda/rich/tessina + Dan Pelberg → Daniel Pelberg,
added by DaniQ 2026-07-14); FALLBACK_ALIASES is the (currently empty) escape
hatch for any new spelling not yet added to the DaniQ-editable Writers tab.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from datetime import datetime, timezone

logger = logging.getLogger("etl.build_writer_desired")

# Google Form responses sheet (writers' "desired article total").
WRITER_DESIRED_SHEET_ID = "1SprAkqDwKryDzwbxu2u3EWifQv4LNdSnW6zV10plaSo"

# Two form generations, each with its OWN column layout. The legacy form has an
# extra "cadence" column at E, so everything from Clients onward is shifted one
# column right vs the current tab. Indices are 0-based within A2:I.
TABS: list[dict] = [
    {
        "source": "current",
        "range": "'Form Responses'!A2:I",
        # A=Timestamp B=Name C=Month("April 2026") D=Days E=Clients F=Desired
        # G=OOO H=Weekly Breakdown (SE) I=Current Assignments (SE)
        "col": {
            "timestamp": 0,
            "name": 1,
            "month": 2,
            "days": 3,
            "clients": 4,
            "desired": 5,
            "ooo": 6,
            "weekly_breakdown": 7,
            "current_assignments": 8,
        },
    },
    {
        "source": "old",
        "range": "'Responses up to April 2026'!A2:I",
        # A=Timestamp B=Name C=Month("December") D=Days E=cadence(omit)
        # F=Clients G=Desired H=OOO I=test OOO(ignore). No SE columns.
        "col": {
            "timestamp": 0,
            "name": 1,
            "month": 2,
            "days": 3,
            "clients": 5,
            "desired": 6,
            "ooo": 7,
        },
    },
]

_MONTHS = {
    m: i + 1
    for i, m in enumerate(
        [
            "january",
            "february",
            "march",
            "april",
            "may",
            "june",
            "july",
            "august",
            "september",
            "october",
            "november",
            "december",
        ]
    )
}

# Escape hatch for FORM spellings not yet in the central editorial_name_map
# (kind=writer). Prefer adding the row to the DaniQ-editable Writers tab instead
# — the map is the source of truth and covers every known spelling today (incl.
# Dan Pelberg → Daniel Pelberg, added 2026-07-14), so this stays empty.
FALLBACK_ALIASES: dict[str, str] = {}

# Output column contract (order matters for readability only). Matches the
# live `editorial_writer_desired` table the planning-hub reader depends on.
SPEC = [
    ("writer_canonical", "STRING"),  # roster-canonical (or raw if unmatched)
    ("raw_name", "STRING"),  # exact form spelling (audit)
    ("year", "INTEGER"),
    ("month", "INTEGER"),
    ("ym", "INTEGER"),
    ("desired", "INTEGER"),  # NULLABLE
    ("clients", "STRING"),
    ("days", "STRING"),
    ("ooo", "STRING"),
    ("weekly_breakdown", "STRING"),  # SE free-text (current tab only, else "")
    ("current_assignments", "STRING"),  # SE free-text (current tab only, else "")
    ("source_tab", "STRING"),  # 'current' | 'old'
    ("submitted_at", "STRING"),  # ISO timestamp (kept as STRING)
    ("matched", "BOOLEAN"),  # reconciled to a known canonical
    ("published_at", "TIMESTAMP"),  # stamped at write
]


def _norm(s: object) -> str:
    """Reconciliation key: lowercase, strip accents, collapse non-alphanumerics
    to single spaces (same rule as the mjs + roster fetch)."""
    text = unicodedata.normalize("NFKD", str(s or "").lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def _parse_month(cell: object) -> int | None:
    s = str(cell or "").lower()
    for name, num in _MONTHS.items():
        if name in s:
            return num
    return None


def _extract_year(cell: object) -> int | None:
    m = re.search(r"\b(20\d{2})\b", str(cell or ""))
    return int(m.group(1)) if m else None


def _first_int(cell: object) -> int | None:
    m = re.search(r"\d+", str(cell or ""))
    return int(m.group(0)) if m else None


def _parse_ts(cell: object) -> tuple[str | None, int | None, int | None]:
    """'DD/MM/YYYY HH:MM:SS' (day-first, UTC) → (iso, year, month).
    Missing time → 00:00:00."""
    s = str(cell or "").strip()
    m = re.match(
        r"^(\d{1,2})/(\d{1,2})/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?", s
    )
    if not m:
        return None, None, None
    dd, mm, yyyy, hh, mi, ss = m.groups()
    try:
        dt = datetime(
            int(yyyy),
            int(mm),
            int(dd),
            int(hh or 0),
            int(mi or 0),
            int(ss or 0),
            tzinfo=timezone.utc,
        )
    except ValueError:
        return None, None, None
    return dt.isoformat(), int(yyyy), int(mm)


def _resolve_ym(
    month_cell: object, ts_year: int | None, ts_month: int | None, source: str
) -> tuple[int, int, int] | None:
    """Current tab carries an explicit year; the legacy tab infers it from the
    submit timestamp and WRAPS to next year when the requested month precedes
    the submit month."""
    month = _parse_month(month_cell)
    if not month:
        return None
    year = _extract_year(month_cell) if source == "current" else None
    if year is None:
        if ts_year is None:
            return None  # cannot infer without a submit year
        year = ts_year
        if ts_month is not None and month < ts_month:
            year += 1
    return year, month, year * 100 + month


def _fetch_ranges(ranges: list[str]) -> list[dict]:
    from googleapiclient.discovery import build as gbuild

    from app.services.google_auth import get_google_credentials

    svc = gbuild(
        "sheets",
        "v4",
        credentials=get_google_credentials(
            scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"]
        ),
    )
    resp = (
        svc.spreadsheets()
        .values()
        .batchGet(
            spreadsheetId=WRITER_DESIRED_SHEET_ID, ranges=ranges, majorDimension="ROWS"
        )
        .execute()
    )
    return resp.get("valueRanges", [])


def _load_reconcilers(bq) -> tuple[dict[str, str], dict[str, str]]:
    """(roster norm→canonical, name_map norm→canonical) from the same central
    sources the rest of the ETL canonicalizes against."""
    from app.config import settings

    ds = f"{settings.bq_project}.{settings.bq_dataset}"
    loc = bq.get_dataset(ds).location
    roster: dict[str, str] = {}
    for r in bq.query(
        f"SELECT DISTINCT canonical_name FROM `{ds}.v_editorial_roster` "
        "WHERE canonical_name IS NOT NULL",
        location=loc,
    ).result():
        k = _norm(r.canonical_name)
        if k:
            roster.setdefault(k, r.canonical_name)
    name_map: dict[str, str] = {}
    for r in bq.query(
        f"SELECT raw_value, canonical_value FROM `{ds}.editorial_name_map` "
        "WHERE kind='writer' AND canonical_value IS NOT NULL",
        location=loc,
    ).result():
        k = _norm(r.raw_value)
        if k:
            name_map.setdefault(k, r.canonical_value)
    return roster, name_map


def _reconcile(
    raw_name: str, roster: dict[str, str], name_map: dict[str, str]
) -> tuple[str, bool]:
    """Form name → (writer_canonical, matched). Central map first, then the
    Dan-Pelberg fallback, then a direct roster hit; else the raw name."""
    nk = _norm(raw_name)
    target = name_map.get(nk) or FALLBACK_ALIASES.get(nk)
    if target:
        return roster.get(_norm(target), target), True
    hit = roster.get(nk)
    if hit:
        return hit, True
    return raw_name, False


def publish_writer_desired_from_sheet(
    session=None, bq=None, dry_run: bool = False
) -> dict:
    """Read the two form tabs → normalize + reconcile → CREATE-OR-REPLACE the
    BigQuery `editorial_writer_desired` table. `session` is accepted for a
    uniform manifest-step signature but is not used (this step is BQ-native).
    """
    from etl.load import get_bq, load_rows, schema_from_spec

    bq = bq or get_bq()
    roster, name_map = _load_reconcilers(bq)
    value_ranges = _fetch_ranges([t["range"] for t in TABS])

    records: list[dict] = []
    skipped_no_name = skipped_no_month = 0
    per_tab_raw: dict[str, int] = {}
    for i, tab in enumerate(TABS):
        vals = (
            (value_ranges[i] or {}).get("values", []) if i < len(value_ranges) else []
        )
        per_tab_raw[tab["source"]] = len(vals)
        col = tab["col"]

        def cell(key: str, row: list) -> object:
            idx = col.get(key)
            return row[idx] if idx is not None and idx < len(row) else ""

        for row in vals:
            raw_name = str(cell("name", row) or "").strip()
            if not raw_name:
                skipped_no_name += 1
                continue
            iso, ts_year, ts_month = _parse_ts(cell("timestamp", row))
            ym = _resolve_ym(cell("month", row), ts_year, ts_month, tab["source"])
            if not ym:
                skipped_no_month += 1
                continue
            year, month, ymv = ym
            writer_canonical, matched = _reconcile(raw_name, roster, name_map)
            records.append(
                {
                    "writer_canonical": writer_canonical,
                    "raw_name": raw_name,
                    "year": year,
                    "month": month,
                    "ym": ymv,
                    "desired": _first_int(cell("desired", row)),
                    "clients": str(cell("clients", row) or "").strip(),
                    "days": str(cell("days", row) or "").strip(),
                    "ooo": str(cell("ooo", row) or "").strip(),
                    "weekly_breakdown": str(
                        cell("weekly_breakdown", row) or ""
                    ).strip(),
                    "current_assignments": str(
                        cell("current_assignments", row) or ""
                    ).strip(),
                    "source_tab": tab["source"],
                    "submitted_at": iso,
                    "matched": matched,
                }
            )

    # Dedup on (writer_canonical, ym): keep the latest submitted_at (ISO sorts).
    by_key: dict[tuple[str, int], dict] = {}
    for rec in records:
        key = (rec["writer_canonical"], rec["ym"])
        prev = by_key.get(key)
        if prev is None or (rec["submitted_at"] or "") > (prev["submitted_at"] or ""):
            by_key[key] = rec
    deduped = sorted(by_key.values(), key=lambda r: (r["ym"], r["writer_canonical"]))

    published_at = datetime.now(timezone.utc)
    for r in deduped:
        r["published_at"] = published_at

    unmatched = sorted({r["raw_name"] for r in deduped if not r["matched"]})
    info = {
        "rows": len(deduped),
        "raw_by_tab": per_tab_raw,
        "records_pre_dedup": len(records),
        "skipped_no_name": skipped_no_name,
        "skipped_no_month": skipped_no_month,
        "ym_min": deduped[0]["ym"] if deduped else None,
        "ym_max": deduped[-1]["ym"] if deduped else None,
        "unmatched": unmatched,
    }

    if dry_run:
        logger.info("writer_desired DRY-RUN: %s", info)
        return info

    load_rows(bq, "editorial_writer_desired", deduped, schema_from_spec(SPEC))
    logger.info(
        "writer_desired: published %d rows (ym %s..%s, %d unmatched)",
        info["rows"],
        info["ym_min"],
        info["ym_max"],
        len(unmatched),
    )
    return info


if __name__ == "__main__":
    import json
    import sys

    print(
        json.dumps(
            publish_writer_desired_from_sheet(dry_run="--dry-run" in sys.argv),
            indent=2,
            default=str,
        )
    )
