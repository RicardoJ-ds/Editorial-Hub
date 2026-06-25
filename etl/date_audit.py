"""Cell-by-cell audit + fix of the Monthly Article Count (MAC) sheet.

Two independent jobs, both validated against the ORIGINAL cells (no DB row
alignment — that's what made the earlier pass miss compound cells like
BetterUp F202 "submitted May 10 revised Aug 2"):

  1. SUBMISSION DATE — every client tab, every data row. Classify each cell:
       blank / real-date-serial (already clean) / text→full-date (fixable) /
       text→unresolved. Fixable text is rewritten to a real ISO date and its
       ORIGINAL text is preserved in a "SUBMISSION NOTES" column (created if the
       cell carries extra info — a 2nd date, a grade like "Kacy 3/5", a keyword).
  2. LEFTOVER REVISION COLUMNS — legacy REVISED / REVISIONS / DATE REVISED beside
       the split 1ST/2ND/3RD/4TH REVISION. A column is removed ONLY when every
       date it holds is already captured (same month+day) in the split columns;
       any orphan date is reported and the column is KEPT.

Read-only by default. `--apply` writes. `--only A,B` scopes to tabs.

    docker compose exec -T backend python -m etl.date_audit             # audit
    docker compose exec -T backend python -m etl.date_audit --apply     # fix
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from collections import defaultdict
from datetime import date
from typing import Any

from app.services.migration_service import (
    _ARTICLE_MONTH_NAMES,
    _ARTICLE_MONTH_WORD_RE,
    _ARTICLE_NON_CLIENT_TABS,
    _article_build_header_map,
    _article_parse_full,
    _excel_serial_to_date,
    _parse_month_context,
    _safe_article_date,
)
from etl.sheet_standardize import col_letter, sheets

MAC_ID = "15WxjOrJtX98YvnWl71Oz0HtVhPtvefB37PbcmAc8BBc"
PRECHANGE_ID = "1Fysf2gl_aE9qiM0y2qWAt7aBeXSEk32ThSFb9jFnLHw"  # backup taken before any edits
NOTES_HDR = "SUBMISSION NOTES"

# Split revision headers (the standard) vs legacy leftovers we want to retire.
_SPLIT_REV_RE = re.compile(r"^\s*(\d+)(ST|ND|RD|TH)\s+REVISION\s*$", re.I)
_LEGACY_REV = {"REVISED", "REVISIONS", "DATE REVISED", "REVISED DATE", "REVISION", "REVISION DATE"}
# A note is worth preserving when the cell holds MORE than the submission date:
# a second date, an editor grade (n/5), or a revision/editor keyword.
_GRADE_RE = re.compile(r"\b[0-5](?:\.\d)?\s*/\s*5\b")
_KEYWORD_RE = re.compile(r"revis|re-?edit|reupload|re-?upload|pending|needed|kacy|note", re.I)
_ALL_DATELIKE_RE = re.compile(r"\b(20\d{2}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]20\d{2})\b")


def _read_unformatted(svc, sid: str, tabs: list[str]) -> dict[str, list[list]]:
    """Per-tab grid read UNFORMATTED — real dates come back as numeric serials,
    text stays text (so we can tell a clean date from a typed one)."""
    out: dict[str, list[list]] = {}
    for i in range(0, len(tabs), 20):
        chunk = tabs[i : i + 20]
        for attempt in range(4):
            try:
                resp = (
                    svc.spreadsheets()
                    .values()
                    .batchGet(
                        spreadsheetId=sid,
                        ranges=[f"'{t}'!A1:BZ" for t in chunk],
                        valueRenderOption="UNFORMATTED_VALUE",
                        dateTimeRenderOption="SERIAL_NUMBER",
                    )
                    .execute()
                )
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(2 * (2**attempt))
        for t, vr in zip(chunk, resp.get("valueRanges", [])):
            out[t] = vr.get("values", [])
        time.sleep(0.3)
    return out


def _client_tabs(svc, sid: str, only: set[str] | None) -> tuple[list[str], dict]:
    meta = svc.spreadsheets().get(spreadsheetId=sid, fields="sheets.properties").execute()
    props = {s["properties"]["title"]: s["properties"] for s in meta["sheets"]}
    skip = set(_ARTICLE_NON_CLIENT_TABS)
    tabs = [
        t
        for t in props
        if t not in skip and not t.startswith(("📋", "✅", "🔍", "🔬", "🧩", "⚙️", "📋"))
    ]
    if only:
        tabs = [t for t in tabs if t in only]
    return tabs, props


def _resolve_header(values: list[list]) -> tuple[int | None, dict, list[str]]:
    for hi in range(min(6, len(values))):
        cand = _article_build_header_map(values[hi])
        if "EDITOR" in cand:
            return hi, cand, [str(c).strip() for c in values[hi]]
    return None, {}, []


def _cellval(row: list, idx: int | None):
    if idx is None or idx >= len(row):
        return ""
    return row[idx]


def _extract_day(text: str, after: int) -> int | None:
    m = re.search(r"\b(\d{1,2})\b", text[after:])
    return int(m.group(1)) if m else None


def resolve_full_date(copy_name, date_text, group_ym):
    """Best full date for a SUBMISSION DATE cell, mirroring the importer but also
    constructing a full date from month+day+year-context (the importer only needs
    year+month, so it discards the day — here we want the calendar date).
    Returns (date|None, reason, month|None, day|None) — month/day are surfaced so
    a year-less cell can be resolved later from neighbouring clean dates."""
    raw = str(date_text).strip()
    if raw == "":
        return None, "blank", None, None
    # real-date serial → already a clean date
    d0 = _excel_serial_to_date(raw)
    if d0:
        return d0, "serial", d0.month, d0.day
    full, y, m = _article_parse_full(str(copy_name), raw)
    if full:
        return full, "parsed-full", full.month, full.day
    # month-word + day present but year-less → take year from row context
    mw = _ARTICLE_MONTH_WORD_RE.search(raw)
    if mw:
        mm = _ARTICLE_MONTH_NAMES[mw.group(1).upper()]
        # a cell that records ONLY a revision (e.g. "REVISED Dec 15, Andre 4/5")
        # holds the revised date, not the submission — never write it as submitted
        low = raw.lower()
        if "revis" in low and "submit" not in low:
            return None, "revision-only", mm, _extract_day(raw, mw.end())
        dd = _extract_day(raw, mw.end())
        yr = y if y is not None else (group_ym[0] if group_ym else None)
        if yr and dd:
            d = _safe_article_date(yr, mm, dd)
            if d and d <= date.today():
                return d, "month+day+ctx", mm, dd
        if not dd:
            return None, "month-only", mm, None
        return None, "no-year", mm, dd  # day known, year unknown → neighbour-fill
    return None, "unresolved", None, None


def _infer_year(clean_rows: list[tuple[int, date]], r_idx: int, month: int, day: int):
    """Year for a year-less (month, day) cell, taken from the nearest clean-date
    row on the SAME tab (articles in adjacent rows share the year). Tries y-1/y/y+1
    and keeps the candidate closest to the neighbour — so a Dec/Jan boundary still
    resolves. Returns a date or None when no anchor is within ~180 days."""
    if not clean_rows:
        return None
    _, ref = min(clean_rows, key=lambda rd: abs(rd[0] - r_idx))
    best = None
    for y in (ref.year - 1, ref.year, ref.year + 1):
        cand = _safe_article_date(y, month, day)
        if cand and cand <= date.today():
            if best is None or abs((cand - ref).days) < abs((best - ref).days):
                best = cand
    return best if best and abs((best - ref).days) <= 180 else None


def _note_worthy(date_text: str) -> bool:
    """True when the cell carries info beyond the one submission date we extracted
    (a 2nd date, a grade, a keyword, a parenthetical, or a 2nd month name)."""
    s = str(date_text)
    if _GRADE_RE.search(s) or _KEYWORD_RE.search(s) or "(" in s:
        return True
    if len(_ALL_DATELIKE_RE.findall(s)) >= 2:
        return True
    return len(_ARTICLE_MONTH_WORD_RE.findall(s)) >= 2


def _dates_in_cell(val, year_hint: int | None) -> set[tuple[int, int]]:
    """Set of (month, day) found in a revision cell — serial, ISO, m/d, or
    comma-list of month-words. (month,day) ignores year so leftover year-less
    tokens still match the split columns' inferred dates."""
    out: set[tuple[int, int]] = set()
    if val is None or str(val).strip() == "":
        return out
    d = _excel_serial_to_date(str(val))
    if d:
        out.add((d.month, d.day))
        return out
    s = str(val)
    for mo, dd, _yr in re.findall(r"\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b", s):
        out.add((int(mo), int(dd)))
    for m in re.finditer(r"\b(20\d{2})-(\d{1,2})-(\d{1,2})\b", s):
        out.add((int(m.group(2)), int(m.group(3))))
    for m in _ARTICLE_MONTH_WORD_RE.finditer(s):
        mm = _ARTICLE_MONTH_NAMES[m.group(1).upper()]
        dd = _extract_day(s, m.end())
        if dd:
            out.add((mm, dd))
    return out


def audit_submission(grids, props, tabs) -> dict:
    """Classify every SUBMISSION DATE cell. Returns a plan of writes + lists."""
    report: dict[str, Any] = {
        "clean": 0,
        "blank": 0,
        "fixable": [],  # (tab, row, col, iso, original, note_worthy)
        "unresolved": [],  # (tab, row, col, original, reason, title, task)
        "per_tab": {},
    }
    for tab in tabs:
        values = grids.get(tab, [])
        hi, hmap, hdr = _resolve_header(values)
        if hi is None or "DATE" not in hmap:
            continue
        di, ci, ti, ki = hmap.get("DATE"), hmap.get("COPY"), hmap.get("TITLE"), hmap.get("TASK_ID")
        tcounts = {"clean": 0, "blank": 0, "fixable": 0, "unresolved": 0}
        # pass 1 — collect clean-date anchors (row → date) for neighbour year-fill
        clean_rows: list[tuple[int, date]] = []
        for r_idx, row in enumerate(values[hi + 1 :], start=hi + 2):
            if row and di is not None and di < len(row) and isinstance(row[di], (int, float)):
                d0 = _excel_serial_to_date(str(row[di]))
                if d0:
                    clean_rows.append((r_idx, d0))
        # pass 2 — classify each cell
        group_ym = None
        for r_idx, row in enumerate(values[hi + 1 :], start=hi + 2):
            if not row:
                continue
            gb = _parse_month_context(row[0] if row else "")
            if gb:
                group_ym = gb
            cell = _cellval(row, di)
            if isinstance(cell, (int, float)):  # real date serial → clean
                report["clean"] += 1
                tcounts["clean"] += 1
                continue
            raw = str(cell).strip()
            if raw == "":
                report["blank"] += 1
                tcounts["blank"] += 1
                continue
            copy_name = _cellval(row, ci)
            d, reason, mm, dd = resolve_full_date(copy_name, raw, group_ym)
            if d is None and reason == "no-year" and mm and dd:
                d = _infer_year(clean_rows, r_idx, mm, dd)
                if d:
                    reason = "neighbour-year"
            if d:
                report["fixable"].append((tab, r_idx, di, d.isoformat(), raw, _note_worthy(raw)))
                tcounts["fixable"] += 1
            else:
                report["unresolved"].append(
                    (tab, r_idx, di, raw, reason, str(_cellval(row, ti)), str(_cellval(row, ki)))
                )
                tcounts["unresolved"] += 1
        report["per_tab"][tab] = tcounts
    return report


def audit_leftover_revisions(grids, props, tabs) -> dict:
    """Find legacy revision columns; check every date is captured in the split
    columns. Returns per-tab findings."""
    out = {}
    for tab in tabs:
        values = grids.get(tab, [])
        hi, hmap, hdr = _resolve_header(values)
        if hi is None:
            continue
        split_idx, legacy_idx = [], []
        for i, h in enumerate(hdr):
            hu = str(h).strip().upper()
            if _SPLIT_REV_RE.match(hu):
                split_idx.append(i)
            elif hu in _LEGACY_REV:
                legacy_idx.append((i, hu))
        if not legacy_idx:
            continue
        rows_total = 0
        orphan_rows = []  # (row, legacy_hdr, orphan (m,d) set, legacy_raw)
        for r_idx, row in enumerate(values[hi + 1 :], start=hi + 2):
            if not row:
                continue
            split_dates: set[tuple[int, int]] = set()
            for si in split_idx:
                split_dates |= _dates_in_cell(_cellval(row, si), None)
            for li, lh in legacy_idx:
                lv = _cellval(row, li)
                if str(lv).strip() == "":
                    continue
                rows_total += 1
                ldates = _dates_in_cell(lv, None)
                orphans = ldates - split_dates
                if orphans:
                    orphan_rows.append((r_idx, lh, orphans, str(lv)))
        out[tab] = {
            "split": [(col_letter(i), hdr[i]) for i in split_idx],
            "legacy": [(col_letter(i), h) for i, h in legacy_idx],
            "rows_with_legacy_data": rows_total,
            "orphan_rows": orphan_rows,
            "safe_to_delete": len(orphan_rows) == 0,
        }
    return out


def _full_dates_in_cell(val, submit_date) -> list[date]:
    """Full date objects in a revision cell. Serials/ISO/m-d-yyyy carry their year;
    year-less month-word tokens take the submission year (+1 if the result would
    predate submission, since a revision can't come before its article)."""
    if val is None or str(val).strip() == "":
        return []
    d = _excel_serial_to_date(str(val))
    if d:
        return [d]
    s = str(val)
    out: list[date] = []
    spans: list[tuple[int, int]] = []
    for m in re.finditer(r"\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b", s):
        out.append(_safe_article_date(int(m.group(3)), int(m.group(1)), int(m.group(2))))
        spans.append(m.span())
    for m in re.finditer(r"\b(20\d{2})-(\d{1,2})-(\d{1,2})\b", s):
        out.append(_safe_article_date(int(m.group(1)), int(m.group(2)), int(m.group(3))))
        spans.append(m.span())
    for m in _ARTICLE_MONTH_WORD_RE.finditer(s):
        if any(a <= m.start() < b for a, b in spans):
            continue
        mm = _ARTICLE_MONTH_NAMES[m.group(1).upper()]
        dd = _extract_day(s, m.end())
        if not dd:
            continue
        yr = submit_date.year if submit_date else None
        if not yr:
            continue
        cand = _safe_article_date(yr, mm, dd)
        if cand and submit_date and cand < submit_date:
            cand = _safe_article_date(yr + 1, mm, dd)
        if cand:
            out.append(cand)
    return [d for d in out if d]


def _residual_after_dates(val) -> str:
    """Cell text with all recognized date tokens + separators + lone day-numbers
    stripped. Non-empty ⇒ the cell carries non-date info worth preserving."""
    s = str(val)
    if _excel_serial_to_date(s):  # a pure date serial → fully a date, no residue
        return ""
    s = re.sub(r"\b\d{1,2}[/-]\d{1,2}[/-]20\d{2}\b", "", s)
    s = re.sub(r"\b20\d{2}-\d{1,2}-\d{1,2}\b", "", s)
    s = _ARTICLE_MONTH_WORD_RE.sub("", s)
    s = re.sub(r"[\s,;/&·.\-]+", " ", s)
    s = re.sub(r"\b\d{1,2}\b", "", s)  # leftover day numbers
    return s.strip()


def audit_revision_cells(grids, props, tabs) -> dict:
    """Scan EVERY 1ST/2ND/3RD/4TH REVISION cell across all tabs for non-date
    content (e.g. '2x', 'JAD 2x', stray words) — a revision column must hold only
    dates or blanks. Returns {tab: [(row, col_idx, header, raw)]}."""
    findings: dict[str, list] = defaultdict(list)
    for tab in tabs:
        values = grids.get(tab, [])
        hi, hmap, hdr = _resolve_header(values)
        if hi is None:
            continue
        di = hmap.get("DATE")
        revcols = [
            (i, str(hdr[i]).strip())
            for i in range(len(hdr))
            if _SPLIT_REV_RE.match(str(hdr[i]).strip().upper())
        ]
        if not revcols:
            continue
        for r_idx, row in enumerate(values[hi + 1 :], start=hi + 2):
            if not row:
                continue
            submit = (
                _excel_serial_to_date(str(row[di]))
                if di is not None and di < len(row) and isinstance(row[di], (int, float))
                else None
            )
            for ci, ch in revcols:
                v = _cellval(row, ci)
                if v is None or str(v).strip() == "":
                    continue
                if isinstance(v, (int, float)):
                    if _excel_serial_to_date(str(v)):
                        continue  # real date serial → ok
                elif _full_dates_in_cell(v, submit):
                    continue  # text that parses to a date → ok
                findings[tab].append((r_idx, ci, ch, str(v)))
    return findings


def fix_revision_junk(svc, sid, grids, props, tabs, apply: bool) -> int:
    """Move non-date content out of revision columns into REVISION NOTES (labelled
    by source column), then blank the date cell. Never discards anything."""
    REV_NOTES = "REVISION NOTES"
    findings = audit_revision_cells(grids, props, tabs)
    total = sum(len(v) for v in findings.values())
    print(f"\n── REVISION-CELL JUNK ── {total} non-date cell(s) across {len(findings)} tab(s)")
    for tab, items in findings.items():
        print(f"  {tab}: {len(items)}")
        for r, ci, ch, raw in items[:8]:
            print(f"     row{r} {col_letter(ci)} [{ch}]: {raw!r}")
    if not apply:
        print("[rev-junk] DRY-RUN — no writes.")
        return 0

    struct: list[dict] = []
    vu: list[dict] = []
    for tab, items in findings.items():
        values = grids.get(tab, [])
        hi, hmap, hdr = _resolve_header(values)
        gid = props[tab]["sheetId"]
        ni = next((i for i, h in enumerate(hdr) if str(h).strip().upper() == REV_NOTES), None)
        if ni is None:
            ni = len(hdr)
            cc = props[tab]["gridProperties"]["columnCount"]
            if ni >= cc:
                struct.append(
                    {
                        "appendDimension": {
                            "sheetId": gid,
                            "dimension": "COLUMNS",
                            "length": ni - cc + 1,
                        }
                    }
                )
            struct.append(
                {
                    "updateCells": {
                        "rows": [{"values": [{"userEnteredValue": {"stringValue": REV_NOTES}}]}],
                        "fields": "userEnteredValue",
                        "start": {"sheetId": gid, "rowIndex": hi, "columnIndex": ni},
                    }
                }
            )
        byrow: dict[int, list] = defaultdict(list)
        for r, ci, ch, raw in items:
            byrow[r].append((ci, ch, raw))
        for r, cells in byrow.items():
            cur = _cellval(values[r - 1], ni) if r - 1 < len(values) else ""
            addition = "; ".join(f"{ch}: {raw}" for _, ch, raw in cells)
            newnote = f"{str(cur).strip()}; {addition}" if str(cur).strip() else addition
            vu.append({"range": f"'{tab}'!{col_letter(ni)}{r}", "values": [[newnote]]})
            for ci, _, _ in cells:
                vu.append({"range": f"'{tab}'!{col_letter(ci)}{r}", "values": [[""]]})
    if struct:
        svc.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": struct}).execute()
        time.sleep(0.5)
    for i in range(0, len(vu), 100):
        svc.spreadsheets().values().batchUpdate(
            spreadsheetId=sid,
            body={"valueInputOption": "USER_ENTERED", "data": vu[i : i + 100]},
        ).execute()
        time.sleep(0.5)
    print(f"[rev-junk] APPLIED — {total} junk cells → REVISION NOTES + blanked")
    return 0


def fix_year_outliers(svc, sid, grids, props, tabs, apply: bool) -> int:
    """Correct SUBMISSION DATE cells that are real dates with the WRONG YEAR.
    Safe only when the year is unambiguous: (a) the cell is an isolated outlier
    whose 6 nearest clean-date neighbours UNANIMOUSLY share one year, or (b) the
    cell is future-dated (impossible) and exactly one non-future neighbour year
    exists. Month/day are kept; the original date is preserved in SUBMISSION NOTES.
    Clusters with mixed candidate years are FLAGGED, never auto-changed."""
    fixes: dict[str, list] = defaultdict(list)  # tab -> [(row, orig_iso, new_iso)]
    flagged: list = []
    for tab in tabs:
        values = grids.get(tab, [])
        hi, hmap, hdr = _resolve_header(values)
        if hi is None or hmap.get("DATE") is None:
            continue
        di = hmap["DATE"]
        clean = []
        for r_idx, row in enumerate(values[hi + 1 :], start=hi + 2):
            if row and di < len(row) and isinstance(row[di], (int, float)):
                d = _excel_serial_to_date(str(row[di]))
                if d:
                    clean.append((r_idx, d))
        if len(clean) < 7:
            continue
        for r_idx, d in clean:
            others = sorted(clean, key=lambda x: abs(x[0] - r_idx))[1:7]
            nyears = {o[1].year for o in others}
            target = None
            if len(nyears) == 1 and next(iter(nyears)) != d.year:
                target = next(iter(nyears))
            elif d > date.today():
                nonfut = {
                    y
                    for y in nyears
                    if y != d.year and (_safe_article_date(y, d.month, d.day) or d) <= date.today()
                }
                if len(nonfut) == 1:
                    target = next(iter(nonfut))
                else:
                    flagged.append((tab, r_idx, d.isoformat(), sorted(nyears)))
            if target:
                cand = _safe_article_date(target, d.month, d.day)
                if cand and cand <= date.today() and cand != d:
                    fixes[tab].append((r_idx, d.isoformat(), cand.isoformat()))
    total = sum(len(v) for v in fixes.values())
    print(f"\n── WRONG-YEAR SUBMISSION DATES ── {total} fix(es), {len(flagged)} flagged")
    for tab, items in fixes.items():
        for r, orig, new in items:
            print(f"  {tab} r{r}: {orig} -> {new}")
    for tab, r, iso, yrs in flagged:
        print(f"  FLAG {tab} r{r}: {iso}  (candidate years {yrs} — confirm)")
    if not apply:
        print("[year-fix] DRY-RUN — no writes.")
        return 0
    struct: list[dict] = []
    vu: list[dict] = []
    for tab, items in fixes.items():
        values = grids.get(tab, [])
        hi, hmap, hdr = _resolve_header(values)
        di = hmap["DATE"]
        gid = props[tab]["sheetId"]
        ni = next((i for i, h in enumerate(hdr) if str(h).strip().upper() == NOTES_HDR), None)
        if ni is None:
            ni = len(hdr)
            cc = props[tab]["gridProperties"]["columnCount"]
            if ni >= cc:
                struct.append(
                    {
                        "appendDimension": {
                            "sheetId": gid,
                            "dimension": "COLUMNS",
                            "length": ni - cc + 1,
                        }
                    }
                )
            struct.append(
                {
                    "updateCells": {
                        "rows": [{"values": [{"userEnteredValue": {"stringValue": NOTES_HDR}}]}],
                        "fields": "userEnteredValue",
                        "start": {"sheetId": gid, "rowIndex": hi, "columnIndex": ni},
                    }
                }
            )
        for r, orig, new in items:
            vu.append({"range": f"'{tab}'!{col_letter(di)}{r}", "values": [[new]]})
            cur = _cellval(values[r - 1], ni) if r - 1 < len(values) else ""
            note = f"year corrected (was {orig})"
            newnote = f"{str(cur).strip()}; {note}" if str(cur).strip() else note
            vu.append({"range": f"'{tab}'!{col_letter(ni)}{r}", "values": [[newnote]]})
    if struct:
        svc.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": struct}).execute()
        time.sleep(0.5)
    for i in range(0, len(vu), 100):
        svc.spreadsheets().values().batchUpdate(
            spreadsheetId=sid,
            body={"valueInputOption": "USER_ENTERED", "data": vu[i : i + 100]},
        ).execute()
        time.sleep(0.5)
    print(f"[year-fix] APPLIED — {total} dates corrected (original kept in SUBMISSION NOTES)")
    return 0


def clean_status_cells(svc, sid, grids, props, tabs, apply: bool) -> int:
    """The remaining SUBMISSION DATE cells hold status words ('submitted', 'pool',
    'editor review', 'maybe in July?') not dates. Move the text to SUBMISSION NOTES
    and blank the date so the column is dates-or-blank only. Nothing discarded."""
    sub = audit_submission(grids, props, tabs)
    by_tab: dict[str, list] = defaultdict(list)
    for tab, r, c, raw, reason, title, task in sub["unresolved"]:
        by_tab[tab].append((r, c, raw))
    total = sum(len(v) for v in by_tab.values())
    print(f"\n── STATUS-WORD SUBMISSION CELLS ── {total} across {len(by_tab)} tab(s)")
    for tab, items in by_tab.items():
        print(f"  {tab}: {len(items)}  e.g. {items[0][2]!r}")
    if not apply:
        print("[clean-status] DRY-RUN — no writes.")
        return 0
    struct: list[dict] = []
    vu: list[dict] = []
    for tab, items in by_tab.items():
        values = grids.get(tab, [])
        hi, hmap, hdr = _resolve_header(values)
        gid = props[tab]["sheetId"]
        ni = next((i for i, h in enumerate(hdr) if str(h).strip().upper() == NOTES_HDR), None)
        if ni is None:
            ni = len(hdr)
            cc = props[tab]["gridProperties"]["columnCount"]
            if ni >= cc:  # grid is full — widen it before writing the header
                struct.append(
                    {
                        "appendDimension": {
                            "sheetId": gid,
                            "dimension": "COLUMNS",
                            "length": ni - cc + 1,
                        }
                    }
                )
            struct.append(
                {
                    "updateCells": {
                        "rows": [{"values": [{"userEnteredValue": {"stringValue": NOTES_HDR}}]}],
                        "fields": "userEnteredValue",
                        "start": {"sheetId": gid, "rowIndex": hi, "columnIndex": ni},
                    }
                }
            )
        for r, c, raw in items:
            cur = _cellval(values[r - 1], ni) if r - 1 < len(values) else ""
            newnote = f"{str(cur).strip()}; {raw}" if str(cur).strip() else raw
            vu.append({"range": f"'{tab}'!{col_letter(ni)}{r}", "values": [[newnote]]})
            vu.append({"range": f"'{tab}'!{col_letter(c)}{r}", "values": [[""]]})
    if struct:
        svc.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": struct}).execute()
        time.sleep(0.5)
    for i in range(0, len(vu), 100):
        svc.spreadsheets().values().batchUpdate(
            spreadsheetId=sid,
            body={"valueInputOption": "USER_ENTERED", "data": vu[i : i + 100]},
        ).execute()
        time.sleep(0.5)
    print(f"[clean-status] APPLIED — {total} cells → SUBMISSION NOTES + blanked")
    return 0


def migrate_revisions(svc, sid, grids, props, tabs, apply: bool) -> int:
    """Move every revision date from a legacy column into the split 1ST/2ND/3RD
    REVISION columns (union, chronological), preserve any non-date text to a
    REVISION NOTES column, then delete the legacy column — but ONLY after a
    re-read confirms nothing was dropped."""
    REV_NOTES = "REVISION NOTES"
    plans: dict[str, dict] = {}
    for tab in tabs:
        values = grids.get(tab, [])
        hi, hmap, hdr = _resolve_header(values)
        if hi is None:
            continue
        di = hmap.get("DATE")
        split = [i for i, h in enumerate(hdr) if _SPLIT_REV_RE.match(str(h).strip().upper())]
        legacy = [i for i, h in enumerate(hdr) if str(h).strip().upper() in _LEGACY_REV]
        if not legacy or not split:
            continue
        notes_i = next((i for i, h in enumerate(hdr) if str(h).strip().upper() == REV_NOTES), None)
        split_writes: dict[int, list] = {si: [] for si in split}
        note_writes: list[tuple[int, str]] = []  # (row, text)
        max_needed = 0
        for r_idx, row in enumerate(values[hi + 1 :], start=hi + 2):
            if not row:
                continue
            submit = (
                _excel_serial_to_date(str(row[di]))
                if di is not None and di < len(row) and isinstance(row[di], (int, float))
                else None
            )
            legacy_dates: set[date] = set()
            for li in legacy:
                lv = _cellval(row, li)
                legacy_dates |= set(_full_dates_in_cell(lv, submit))
                # preserve non-date text (notes, markers, odd codes)
                if str(lv).strip() != "" and (
                    not _full_dates_in_cell(lv, submit) or _residual_after_dates(lv)
                ):
                    note_writes.append((r_idx, str(lv)))
            existing: set[date] = set()
            for si in split:
                existing |= set(_full_dates_in_cell(_cellval(row, si), submit))
            target = sorted(existing | legacy_dates)
            max_needed = max(max_needed, len(target))
            for k, si in enumerate(split):
                split_writes[si].append([target[k].isoformat()] if k < len(target) else [""])
        if max_needed > len(split):
            print(
                f"  ⚠ {tab}: a row needs {max_needed} revision slots but only {len(split)} "
                f"split columns exist — SKIPPING (would need a {max_needed}TH REVISION column)"
            )
            continue
        plans[tab] = {
            "hi": hi,
            "gid": props[tab]["sheetId"],
            "split": split,
            "legacy": legacy,
            "notes_i": notes_i,
            "notes_new": notes_i is None and bool(note_writes),
            "notes_col": notes_i if notes_i is not None else len(hdr),
            "split_writes": split_writes,
            "note_writes": note_writes,
            "hdr_len": len(hdr),
        }

    print(f"\n── REVISION MIGRATION PLAN ── {len(plans)} tab(s)")
    for tab, p in plans.items():
        nonempty = {si: sum(1 for v in vals if v != [""]) for si, vals in p["split_writes"].items()}
        print(
            f"  {tab}: fill split {[col_letter(i) for i in p['split']]} "
            f"(non-empty rows {nonempty}) · {len(p['note_writes'])} note(s) → "
            f"{'NEW ' if p['notes_new'] else ''}{REV_NOTES} · delete legacy "
            f"{[col_letter(i) for i in p['legacy']]}"
        )
        for r, t in p["note_writes"][:4]:
            print(f"      note row {r}: {t!r}")
    if not apply:
        print("[migrate-revisions] DRY-RUN — no writes.")
        return 0

    # 1) structure: add REVISION NOTES headers where needed (widen full grids first)
    struct = []
    for tab, p in plans.items():
        if not p["notes_new"]:
            continue
        cc = props[tab]["gridProperties"]["columnCount"]
        if p["notes_col"] >= cc:
            struct.append(
                {
                    "appendDimension": {
                        "sheetId": p["gid"],
                        "dimension": "COLUMNS",
                        "length": p["notes_col"] - cc + 1,
                    }
                }
            )
        struct.append(
            {
                "updateCells": {
                    "rows": [{"values": [{"userEnteredValue": {"stringValue": REV_NOTES}}]}],
                    "fields": "userEnteredValue",
                    "start": {
                        "sheetId": p["gid"],
                        "rowIndex": p["hi"],
                        "columnIndex": p["notes_col"],
                    },
                }
            }
        )
    if struct:
        svc.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": struct}).execute()
        time.sleep(0.5)

    # 2) value writes: split columns + notes
    vu: list[dict] = []
    for tab, p in plans.items():
        first = p["hi"] + 2
        for si, vals in p["split_writes"].items():
            last = first + len(vals) - 1
            vu.append(
                {"range": f"'{tab}'!{col_letter(si)}{first}:{col_letter(si)}{last}", "values": vals}
            )
        for r, t in p["note_writes"]:
            vu.append({"range": f"'{tab}'!{col_letter(p['notes_col'])}{r}", "values": [[t]]})
    for i in range(0, len(vu), 100):
        svc.spreadsheets().values().batchUpdate(
            spreadsheetId=sid,
            body={"valueInputOption": "USER_ENTERED", "data": vu[i : i + 100]},
        ).execute()
        time.sleep(0.5)

    # 3) RE-READ + verify nothing is lost before deleting the legacy columns
    fresh = _read_unformatted(svc, sid, list(plans))
    deletes: list[dict] = []
    for tab, p in plans.items():
        values = fresh.get(tab, [])
        hi, hmap, hdr = _resolve_header(values)
        di = hmap.get("DATE")
        split = [i for i, h in enumerate(hdr) if _SPLIT_REV_RE.match(str(h).strip().upper())]
        legacy = [i for i, h in enumerate(hdr) if str(h).strip().upper() in _LEGACY_REV]
        notes_i = next((i for i, h in enumerate(hdr) if str(h).strip().upper() == REV_NOTES), None)
        ok = True
        for r_idx, row in enumerate(values[hi + 1 :], start=hi + 2):
            if not row:
                continue
            submit = (
                _excel_serial_to_date(str(row[di]))
                if di is not None and di < len(row) and isinstance(row[di], (int, float))
                else None
            )
            split_dates: set[date] = set()
            for si in split:
                split_dates |= set(_full_dates_in_cell(_cellval(row, si), submit))
            note_txt = str(_cellval(row, notes_i)) if notes_i is not None else ""
            for li in legacy:
                lv = _cellval(row, li)
                if str(lv).strip() == "":
                    continue
                for d in _full_dates_in_cell(lv, submit):
                    if d not in split_dates:
                        ok = False
                        print(f"  ✗ {tab} row {r_idx}: date {d} not in split — KEEPING column")
                resid = _residual_after_dates(lv)
                if (not _full_dates_in_cell(lv, submit) or resid) and str(lv) not in note_txt:
                    ok = False
                    print(f"  ✗ {tab} row {r_idx}: note {lv!r} not preserved — KEEPING column")
        if ok:
            for li in sorted(legacy, reverse=True):
                deletes.append(
                    {
                        "deleteDimension": {
                            "range": {
                                "sheetId": p["gid"],
                                "dimension": "COLUMNS",
                                "startIndex": li,
                                "endIndex": li + 1,
                            }
                        }
                    }
                )
            print(f"  ✓ {tab}: verified — deleting legacy {[col_letter(i) for i in legacy]}")
    if deletes:
        svc.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": deletes}).execute()
    print(f"[migrate-revisions] APPLIED — {len(vu)} writes, {len(deletes)} legacy columns removed")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--revisions", action="store_true", help="also audit leftover rev columns")
    ap.add_argument(
        "--migrate-revisions",
        action="store_true",
        help="migrate legacy revision columns into the split columns + delete them",
    )
    ap.add_argument(
        "--rev-junk",
        action="store_true",
        help="move non-date content out of revision columns into REVISION NOTES",
    )
    ap.add_argument(
        "--clean-status",
        action="store_true",
        help="move status-word submission cells into SUBMISSION NOTES + blank the date",
    )
    ap.add_argument(
        "--year-fix",
        action="store_true",
        help="correct wrong-year submission dates (isolated outliers / future-dated)",
    )
    args = ap.parse_args(argv)
    only = {t.strip() for t in args.only.split(",") if t.strip()} or None
    svc = sheets()
    tabs, props = _client_tabs(svc, MAC_ID, only)
    print(f"[date-audit] {len(tabs)} client tabs")
    grids = _read_unformatted(svc, MAC_ID, tabs)

    if args.migrate_revisions:
        return migrate_revisions(svc, MAC_ID, grids, props, tabs, args.apply)
    if args.rev_junk:
        return fix_revision_junk(svc, MAC_ID, grids, props, tabs, args.apply)
    if args.clean_status:
        return clean_status_cells(svc, MAC_ID, grids, props, tabs, args.apply)
    if args.year_fix:
        return fix_year_outliers(svc, MAC_ID, grids, props, tabs, args.apply)

    sub = audit_submission(grids, props, tabs)
    print(
        f"\n── SUBMISSION DATE ──\n  clean(serial): {sub['clean']}  blank: {sub['blank']}  "
        f"fixable(text→date): {len(sub['fixable'])}  unresolved: {len(sub['unresolved'])}"
    )
    nw = sum(1 for f in sub["fixable"] if f[5])
    print(f"  of fixable, note-worthy (extra info → SUBMISSION NOTES): {nw}")
    # show a few fixable examples
    for tab, r, c, iso, raw, note in sub["fixable"][:12]:
        flag = " [NOTE]" if note else ""
        print(f"    fix {tab}!{col_letter(c)}{r}: {raw!r} → {iso}{flag}")
    # unresolved breakdown
    by_reason: dict[str, int] = {}
    for u in sub["unresolved"]:
        by_reason[u[4]] = by_reason.get(u[4], 0) + 1
    print(f"  unresolved by reason: {by_reason}")

    if args.revisions:
        rev = audit_leftover_revisions(grids, props, tabs)
        print(f"\n── LEFTOVER REVISION COLUMNS ── {len(rev)} tab(s) carry a legacy column")
        for tab, info in rev.items():
            print(
                f"  {tab}: legacy={info['legacy']} split={[s[0] for s in info['split']]} "
                f"rows={info['rows_with_legacy_data']} "
                f"{'SAFE-DELETE' if info['safe_to_delete'] else f'ORPHANS={len(info["orphan_rows"])}'}"
            )
            for r, lh, orph, raw in info["orphan_rows"][:5]:
                print(f"      orphan row {r} [{lh}]: {raw!r} → {sorted(orph)}")

    # write a full report to scratchpad for the user-facing summary
    import json

    rep_path = "/tmp/date_audit_report.json"
    with open(rep_path, "w") as fh:
        json.dump(
            {
                "submission": {
                    k: v if k not in ("fixable", "unresolved") else v
                    for k, v in sub.items()
                    if k != "per_tab"
                },
                "per_tab": sub["per_tab"],
                "revisions": audit_leftover_revisions(grids, props, tabs) if args.revisions else {},
            },
            fh,
            default=str,
            indent=2,
        )
    print(f"\n[date-audit] full report → {rep_path}")

    if not args.apply:
        print("[date-audit] DRY-RUN — no writes. Re-run with --apply.")
        return 0

    # ── APPLY ────────────────────────────────────────────────────────────────
    return _apply(svc, grids, props, tabs, sub, args)


def _apply(svc, grids, props, tabs, sub, args) -> int:
    # group fixable by tab so we can add a NOTES column once per tab when needed
    by_tab: dict[str, list] = {}
    for f in sub["fixable"]:
        by_tab.setdefault(f[0], []).append(f)

    value_updates: list[dict] = []
    structure_reqs: list[dict] = []
    notes_col: dict[str, int] = {}  # tab → notes column index (0-based)

    for tab, fixes in by_tab.items():
        values = grids.get(tab, [])
        hi, hmap, hdr = _resolve_header(values)
        # locate or plan a SUBMISSION NOTES column
        ni = next((i for i, h in enumerate(hdr) if str(h).strip().upper() == NOTES_HDR), None)
        needs_note = any(f[5] for f in fixes)
        if ni is None and needs_note:
            ni = len(hdr)  # append at the right edge
            structure_reqs.append(
                {
                    "updateCells": {
                        "rows": [{"values": [{"userEnteredValue": {"stringValue": NOTES_HDR}}]}],
                        "fields": "userEnteredValue",
                        "start": {
                            "sheetId": props[tab]["sheetId"],
                            "rowIndex": hi,
                            "columnIndex": ni,
                        },
                    }
                }
            )
        notes_col[tab] = ni

        for tabn, r, c, iso, raw, note in fixes:
            value_updates.append({"range": f"'{tab}'!{col_letter(c)}{r}", "values": [[iso]]})
            if note and ni is not None:
                # only write a note if that NOTES cell is currently empty (don't
                # clobber a previously-recovered note)
                cur_notes = _cellval(values[r - 1] if r - 1 < len(values) else [], ni)
                if str(cur_notes).strip() == "":
                    value_updates.append(
                        {"range": f"'{tab}'!{col_letter(ni)}{r}", "values": [[raw]]}
                    )

    if structure_reqs:
        svc.spreadsheets().batchUpdate(
            spreadsheetId=MAC_ID, body={"requests": structure_reqs}
        ).execute()
        time.sleep(0.5)
    for i in range(0, len(value_updates), 200):
        svc.spreadsheets().values().batchUpdate(
            spreadsheetId=MAC_ID,
            body={"valueInputOption": "USER_ENTERED", "data": value_updates[i : i + 200]},
        ).execute()
        time.sleep(0.5)
    print(
        f"[date-audit] APPLIED — {len(value_updates)} cell writes "
        f"({sum(1 for f in sub['fixable'] if f[5])} notes preserved), "
        f"{len(structure_reqs)} NOTES columns added"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
