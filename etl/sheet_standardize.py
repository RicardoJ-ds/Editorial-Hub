"""Standardize the Monthly Article Count COPY sheet — the live proposal demo
for DaniQ. The real team sheet is locked elsewhere; this copy (ARTICLE_COUNT_ID)
is safe to mutate and is what the Hub currently ingests.

ADDITIVE design (Ricardo, 2026-06-11): the original EDITOR / WRITER columns are
NEVER touched. Two new columns are inserted right next to them —
"EDITOR (STANDARD)" and "WRITER (STANDARD)" — holding the canonical names, so
every row shows before → after side by side. The importer ignores the new
columns (its header matcher is exact-match on known aliases) and keeps reading
the originals, so Hub numbers don't move.

Passes (dry-run by default; --apply to execute):

  1. STRUCTURE  insert the (STANDARD) columns: EDITOR (STANDARD) + 2ND REVIEW
                (STANDARD) after EDITOR, WRITER (STANDARD) after WRITER, and the
                three revision-date columns after REVISED, on every client tab +
                TEMPLATE (skipped when already present; the 3rd-revision + 2nd-
                review columns are added even to tabs structured by an earlier
                run). One generic anchor→new-columns planner so the inserts
                compose without index drift.
  2. ROSTERS    create/refresh `📋 Rosters`: A = Active editors (new entries) ·
                B = All editors (validation list — active A→Z, then terminated
                A→Z so history still validates) · C = Status · D = Hire date ·
                E = Termination date · G = Writers · H = Sr editors (2nd-review
                list, active first). Editor validation → $B (ONE_OF_RANGE),
                writer → $G, 2nd-review → $H. Editor/writer rosters come from the
                LIVE BigQuery editorial_name_map (DaniQ-editable sheet → BQ),
                incl. the "Auditioning Writer" bucket. Terminated editors who
                never appear in the article log are dropped (and stay dropped —
                see build_rosters).
  3. FILL       EDITOR (STANDARD) = canonical name (date-windowed Sam/Lauren
                rules included). Slash collaborations are filled as
                "Name A / Name B" — strict validation flags them red on
                purpose: they're pending DaniQ's real-assignment list.
                WRITER (STANDARD) = the importer's already-canonical writer name
                (same BQ map). 1ST / 2ND / 3RD REVISION (STANDARD) = the
                article's parsed revision dates, sorted ascending (1st =
                earliest). 2ND REVIEW (STANDARD) is a NEW manual column (no fill)
                — a Sr-editor dropdown DaniQ fills in. The original REVISED cell
                is never touched, so 4th+ revisions are not lost.
  4. DATES      SUBMITTED normalized IN PLACE (same value, real date): only
                year-less text cells (e.g. "Aug 26") are rewritten to the
                importer-confirmed ISO date; the column gets a yyyy-mm-dd
                display format (the legacy "MMM d" format hid the year — how
                two-years-apart dates collided) + must-be-a-date validation.
  5. VALIDATE   EDITOR (STANDARD): dropdown = All editors (STRICT).
                WRITER (STANDARD): dropdown = Writers (warning-only — legacy
                first-name-only history would drown a strict rule).
                2ND REVIEW (STANDARD): dropdown = Sr editors (STRICT, active
                first). 1ST / 2ND / 3RD REVISION: must-be-a-date STRICT (rejects
                free text / partial dates / comma-lists, blanks OK) + yyyy-mm-dd
                display.
  6. AUDIT      `✅ VALIDATION AUDIT` tab: per tab — header row position (the
                Felt bug class), missing required columns, rows, std-column
                fill counts (editor / writer / revision dates), slash cells
                pending DaniQ, unparseable dates, verdict.

Run inside the backend container:
    docker compose exec -T backend python -m etl.sheet_standardize          # dry-run
    docker compose exec -T backend python -m etl.sheet_standardize --apply
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from collections import defaultdict

from sqlalchemy import text

from app.config import settings
from app.services.google_auth import get_google_credentials
from app.services.migration_service import (
    _ARTICLE_NON_CLIENT_TABS,
    _article_build_header_map,
)
from etl.extract import get_session
from etl.load import get_bq

ROSTERS_TAB = "📋 Rosters"
AUDIT_TAB = "✅ VALIDATION AUDIT"
ED_STD = "EDITOR (STANDARD)"
WR_STD = "WRITER (STANDARD)"
REV1_STD = "1ST REVISION (STANDARD)"
REV2_STD = "2ND REVISION (STANDARD)"
REV3_STD = "3RD REVISION (STANDARD)"
REVIEW2_STD = "2ND REVIEW (STANDARD)"
# canon header keys (from _article_build_header_map) → friendly names
REQUIRED_COLS = {
    "TITLE": "ARTICLE TITLE",
    "DATE": "SUBMITTED",
    "COPY": "COPY NAME",
    "WRITER": "WRITER",
    "EDITOR": "EDITOR",
}


def sheets():
    creds = get_google_credentials(scopes=["https://www.googleapis.com/auth/spreadsheets"])
    from googleapiclient.discovery import build

    return build("sheets", "v4", credentials=creds)


def col_letter(idx: int) -> str:
    s = ""
    idx += 1
    while idx:
        idx, r = divmod(idx - 1, 26)
        s = chr(65 + r) + s
    return s


def build_rosters() -> tuple[list[dict], list[str]]:
    """(editors, writers).

    editors: one dict per editorial editor — {name, status, hire, term}.
      `status` is 'ACTIVE' / 'TERMINATED' from Rippling `v_headcount`, or '' for
      a name that only exists in the confirmed-alias canon (no headcount row).
      `hire` / `term` are ISO dates ('' when unknown). Source = every
      Editorial-department person whose title reads as an editor, UNION the
      confirmed editor-alias canonicals (so historical names still validate).
      NOTE: the title filter also catches old leadership titles like "Editorial
      Lead" — those are pruned later in main() if they never appear in the
      article log, so terminated non-editors (e.g. Andres Rojas / Jose Maria
      Sosa, Editorial Leads gone since early 2023) don't clutter the dropdown.
      Each editor dict also carries `title` + `is_senior` ("Sr. Editor" /
      "Sr. Editor II") — the latter drives the 2nd-Review dropdown.
    writers: canonical writer names from the LIVE BigQuery editorial_name_map
      (DaniQ-editable sheet → BQ), incl. the "Auditioning Writer" bucket — so her
      latest writer corrections flow into the proposal rosters."""
    from app.services.name_map_bq import canonical_values

    bq = get_bq()
    editors: dict[str, dict] = {}
    for r in bq.query(
        "SELECT employee_name, status, start_date, termination_date, title "
        "FROM `graphite-data.graphite_bi_sandbox.v_headcount` "
        "WHERE LOWER(department) LIKE 'editorial%' "
        "AND (LOWER(title) LIKE '%editor%' OR LOWER(title) LIKE '%editorial%')"
    ).result():
        if not (r.employee_name or "").strip():
            continue
        title = (r.title or "").strip()
        editors[r.employee_name] = {
            "name": r.employee_name,
            "status": r.status or "",
            "hire": r.start_date.isoformat() if r.start_date else "",
            "term": r.termination_date.isoformat() if r.termination_date else "",
            "title": title,
            # "Sr. Editor" / "Sr. Editor II" — the 2nd-review reviewers.
            "is_senior": title.lower().startswith("sr"),
        }

    def _add_alias(name: str) -> None:
        if name and name not in editors:
            editors[name] = {
                "name": name,
                "status": "",
                "hire": "",
                "term": "",
                "title": "",
                "is_senior": False,
            }

    # Historical editor canonicals from the live name map (DaniQ sheet → BQ), so
    # names that only appear in the article log still validate.
    for canon in canonical_values("editor"):
        _add_alias(canon)
    writers = canonical_values("writer")
    # Also pull the live writer roster from Slack — the source of truth (writer
    # contractors carry @*.writing.graphitehq.com emails). New writers then
    # appear in the dropdown without waiting for a manual editorial_name_map row.
    try:
        from etl.build_mappings import _fetch_slack_writers

        writers |= {w["display_name"] for w in _fetch_slack_writers() if w.get("display_name")}
    except Exception:
        pass
    return list(editors.values()), sorted(writers)


def _sr_editor_list(roster_editors: list[dict]) -> list[str]:
    """Senior-editor names for the 2nd-Review dropdown — active first (A→Z),
    then terminated (A→Z) so historical reviewers still validate. Source =
    `is_senior` ("Sr. Editor" / "Sr. Editor II") editors from build_rosters."""
    srs = [e for e in roster_editors if e.get("is_senior")]
    active = sorted((e["name"] for e in srs if e["status"] == "ACTIVE"), key=str.lower)
    rest = sorted((e["name"] for e in srs if e["status"] != "ACTIVE"), key=str.lower)
    return active + rest


def load_db_rows() -> dict[tuple[str, int], dict]:
    """(tab, sheet_row) → normalization targets. Collaborations keep ALL
    editor names so the standard cell can show 'Name A / Name B'."""
    out: dict[tuple[str, int], dict] = {}
    with get_session() as s:
        for r in s.execute(
            text(
                "SELECT source_tab, source_row, editor_raw, editor_name, "
                "writer_raw, writer_name, date_submitted_raw, submitted_date, year, month, "
                "revision_dates "
                "FROM article_records ORDER BY source_tab, source_row, editor_name"
            )
        ):
            key = (r.source_tab, r.source_row)
            rec = out.setdefault(
                key,
                {
                    "editors": [],
                    "editor_raw": r.editor_raw,
                    "writer_raw": r.writer_raw,
                    "writer_name": r.writer_name,
                    "date_raw": r.date_submitted_raw,
                    "date_iso": r.submitted_date.isoformat() if r.submitted_date else None,
                    "ym": f"{r.year:04d}-{r.month:02d}" if r.year and r.month else None,
                    # revision_dates is identical across an article's exploded
                    # per-editor rows (it's per physical row), so the first wins.
                    "revisions": sorted(r.revision_dates) if r.revision_dates else [],
                },
            )
            if r.editor_name and r.editor_name not in rec["editors"]:
                rec["editors"].append(r.editor_name)
    return out


def read_grids(svc, sid: str, tabs: list[str]) -> dict[str, list[list[str]]]:
    grids: dict[str, list[list[str]]] = {}
    for i in range(0, len(tabs), 25):
        chunk = tabs[i : i + 25]
        resp = (
            svc.spreadsheets()
            .values()
            .batchGet(
                spreadsheetId=sid,
                ranges=[f"'{t}'!A1:AZ" for t in chunk],
                valueRenderOption="FORMATTED_VALUE",
            )
            .execute()
        )
        for t, vr in zip(chunk, resp.get("valueRanges", [])):
            grids[t] = vr.get("values", [])
        time.sleep(0.4)
    return grids


def find_header(values: list[list[str]]) -> tuple[int | None, dict]:
    for hi in range(min(5, len(values))):
        cand = _article_build_header_map(values[hi])
        if "EDITOR" in cand:
            return hi, cand
    return None, {}


def _find_std(header_row: list, title: str) -> int | None:
    """Index of a single (STANDARD) column by exact title, or None. Used for the
    newer 3RD REVISION / 2ND REVIEW columns so the legacy 4-tuple stays stable."""
    for i, h in enumerate(header_row):
        if str(h).strip().upper() == title:
            return i
    return None


def std_col_positions(
    header_row: list,
) -> tuple[int | None, int | None, int | None, int | None]:
    """(editor_std, writer_std, rev1_std, rev2_std) column indices, or None."""
    ed = wr = rev1 = rev2 = None
    for i, h in enumerate(header_row):
        t = str(h).strip().upper()
        if t == ED_STD:
            ed = i
        elif t == WR_STD:
            wr = i
        elif t == REV1_STD:
            rev1 = i
        elif t == REV2_STD:
            rev2 = i
    return ed, wr, rev1, rev2


def standardize_meta(apply: bool = False) -> int:
    """Standardize the Meta Editorial Tracker (single TRACKER tab) — same
    treatment as the main sheet, adapted to Meta's layout:
      • append WRITER (STANDARD) / EDITOR (STANDARD) after their raw columns and
        1ST/2ND REVISION (STANDARD) after the last REVISION column,
      • fill them from article_records (source_tab='TRACKER'),
      • normalize the DELIVERED date in place (year-less → ISO),
      • gate with strict must-be-a-date validation on DELIVERED + the two revision
        STANDARD columns, and inline ONE_OF_LIST roster dropdowns on the name
        columns (the main sheet uses a cross-spreadsheet Rosters range, which BQ
        validation can't reference from another file — so the roster values are
        embedded directly; re-run to refresh).
    Dry-run unless apply=True (prints the plan + the computed column letters)."""
    sid = settings.meta_tracker_id
    if not sid:
        print("[meta] meta_tracker_id not set — nothing to do")
        return 1
    svc = sheets()
    TAB = "TRACKER"
    props = {
        s["properties"]["title"]: s["properties"]
        for s in svc.spreadsheets()
        .get(spreadsheetId=sid, fields="sheets.properties")
        .execute()["sheets"]
    }
    if TAB not in props:
        print(f"[meta] no {TAB} tab in the Meta sheet")
        return 1
    gid = props[TAB]["sheetId"]
    rowcount = props[TAB]["gridProperties"]["rowCount"]

    # Roster (inline ONE_OF_LIST) + DaniQ writer overrides — same sources as main.
    # Rosters from the LIVE BigQuery editorial_name_map (DaniQ sheet → BQ); the
    # WRITER (STANDARD) fill uses the importer's already-canonical writer name.
    roster_editors, writers = build_rosters()
    editor_list = sorted({e["name"] for e in roster_editors})
    writer_list = sorted(writers)
    sr_editor_list = _sr_editor_list(roster_editors)
    db = load_db_rows()

    grid = read_grids(svc, sid, [TAB]).get(TAB, [])
    header_idx = None
    cols: dict[str, int] = {}
    for hi in range(min(5, len(grid))):
        up = [str(c).strip().upper() for c in grid[hi]]
        if "VERTICAL" in up and "EDITOR" in up:
            header_idx, cols = hi, {n: i for i, n in enumerate(up) if n}
            break
    if header_idx is None:
        print("[meta] no header row with VERTICAL + EDITOR")
        return 1
    ed_std_i, wr_std_i, rev1_std_i, rev2_std_i = std_col_positions(grid[header_idx])
    rev3_std_i = _find_std(grid[header_idx], REV3_STD)
    review2_std_i = _find_std(grid[header_idx], REVIEW2_STD)

    # ── STRUCTURE: insert missing (STANDARD) columns (highest anchor first) ──
    last_rev = next(
        (cols[r] for r in ("REVISION 3", "REVISION 2", "REVISION 1") if r in cols), None
    )
    anchors: list[tuple[int, list[str]]] = []
    if "EDITOR" in cols and ed_std_i is None:
        # new tab: editor-std + 2nd-review (right after it) in one insert
        anchors.append(
            (cols["EDITOR"], [ED_STD] + ([REVIEW2_STD] if review2_std_i is None else []))
        )
    elif review2_std_i is None and ed_std_i is not None:
        # already-structured tab: 2nd-review after the existing EDITOR (STANDARD)
        anchors.append((ed_std_i, [REVIEW2_STD]))
    if "WRITER" in cols and wr_std_i is None:
        anchors.append((cols["WRITER"], [WR_STD]))
    if last_rev is not None and rev1_std_i is None:
        anchors.append((last_rev, [REV1_STD, REV2_STD, REV3_STD]))
    elif rev3_std_i is None and rev2_std_i is not None:
        # already-structured tab: 3rd-revision after the existing 2nd revision
        anchors.append((rev2_std_i, [REV3_STD]))

    def final_positions() -> dict[str, int]:
        before, prefix, out = 0, {}, {}
        for a_i, titles in sorted(anchors, key=lambda a: a[0]):
            prefix[a_i] = before
            before += len(titles)
        for a_i, titles in anchors:
            base = a_i + prefix[a_i] + 1
            for k, t in enumerate(titles):
                out[t] = base + k
        return out

    if anchors:
        insert_reqs = [
            {
                "insertDimension": {
                    "range": {
                        "sheetId": gid,
                        "dimension": "COLUMNS",
                        "startIndex": a_i + 1,
                        "endIndex": a_i + 1 + len(titles),
                    },
                    "inheritFromBefore": False,
                }
            }
            for a_i, titles in sorted(anchors, key=lambda a: a[0], reverse=True)
        ]
        pos = final_positions()
        header_writes = [
            {"range": f"'{TAB}'!{col_letter(c)}{header_idx + 1}", "values": [[t]]}
            for t, c in pos.items()
        ]
        if apply:
            svc.spreadsheets().batchUpdate(
                spreadsheetId=sid, body={"requests": insert_reqs}
            ).execute()
            svc.spreadsheets().values().batchUpdate(
                spreadsheetId=sid, body={"valueInputOption": "RAW", "data": header_writes}
            ).execute()
            grid = read_grids(svc, sid, [TAB]).get(TAB, [])
            ed_std_i, wr_std_i, rev1_std_i, rev2_std_i = std_col_positions(grid[header_idx])
            rev3_std_i = _find_std(grid[header_idx], REV3_STD)
            review2_std_i = _find_std(grid[header_idx], REVIEW2_STD)
        else:
            ed_std_i, wr_std_i = pos.get(ED_STD, ed_std_i), pos.get(WR_STD, wr_std_i)
            rev1_std_i, rev2_std_i = pos.get(REV1_STD, rev1_std_i), pos.get(REV2_STD, rev2_std_i)
            rev3_std_i = pos.get(REV3_STD, rev3_std_i)
            review2_std_i = pos.get(REVIEW2_STD, review2_std_i)
    print(
        f"[meta] structure: insert {sum(len(t) for _, t in anchors)} cols → "
        f"WR_STD={col_letter(wr_std_i) if wr_std_i is not None else '?'} "
        f"ED_STD={col_letter(ed_std_i) if ed_std_i is not None else '?'} "
        f"REV1_STD={col_letter(rev1_std_i) if rev1_std_i is not None else '?'} "
        f"REV2_STD={col_letter(rev2_std_i) if rev2_std_i is not None else '?'} "
        f"REV3_STD={col_letter(rev3_std_i) if rev3_std_i is not None else '?'} "
        f"REVIEW2_STD={col_letter(review2_std_i) if review2_std_i is not None else '?'} "
        f"DELIVERED={col_letter(cols['DELIVERED']) if 'DELIVERED' in cols else '?'}"
    )

    # ── FILL from article_records (source_tab='TRACKER') ──
    n_rows = len(grid) - (header_idx + 1)
    dt_i = cols.get("DELIVERED")
    ed_vals, wr_vals, r1_vals, r2_vals, r3_vals, dt_updates = [], [], [], [], [], []
    ed_fill = wr_fill = r1_fill = r2_fill = r3_fill = dt_fix = 0
    dt_changed = False
    for r_off in range(n_rows):
        sheet_row = header_idx + 2 + r_off
        row = grid[header_idx + 1 + r_off]
        rec = db.get((TAB, sheet_row))
        ed = wr = r1 = r2 = r3 = ""
        if rec:
            if rec["editors"]:
                ed = " / ".join(rec["editors"])
                ed_fill += 1
            if rec["writer_name"]:
                wr = rec["writer_name"]
                wr_fill += 1
            revs = rec.get("revisions") or []
            if len(revs) >= 1:
                r1, r1_fill = revs[0], r1_fill + 1
            if len(revs) >= 2:
                r2, r2_fill = revs[1], r2_fill + 1
            if len(revs) >= 3:
                r3, r3_fill = revs[2], r3_fill + 1
        ed_vals.append([ed])
        wr_vals.append([wr])
        r1_vals.append([r1])
        r2_vals.append([r2])
        r3_vals.append([r3])
        if dt_i is not None:
            cur = str(row[dt_i]) if dt_i < len(row) else ""
            new = cur
            if (
                rec
                and rec["date_raw"]
                and cur.strip() == str(rec["date_raw"]).strip()
                and rec["date_iso"]
                and cur.strip()
                and not re.search(r"\b20\d{2}\b", cur)
            ):
                new, dt_fix, dt_changed = rec["date_iso"], dt_fix + 1, True
            dt_updates.append([new])
    print(
        f"[meta] fills (of {n_rows} rows): editor {ed_fill} · writer {wr_fill} · "
        f"rev1 {r1_fill} · rev2 {r2_fill} · rev3 {r3_fill} · date-fix {dt_fix}"
    )

    first, last = header_idx + 2, header_idx + 1 + n_rows
    value_updates: list[dict] = []

    def vu(ci, vals):
        if ci is not None and ci >= 0:
            value_updates.append(
                {"range": f"'{TAB}'!{col_letter(ci)}{first}:{col_letter(ci)}{last}", "values": vals}
            )

    if ed_fill:
        vu(ed_std_i, ed_vals)
    if wr_fill:
        vu(wr_std_i, wr_vals)
    if r1_fill:
        vu(rev1_std_i, r1_vals)
    if r2_fill:
        vu(rev2_std_i, r2_vals)
    if r3_fill:
        vu(rev3_std_i, r3_vals)
    if dt_changed:
        vu(dt_i, dt_updates)

    # ── VALIDATION (inline ONE_OF_LIST roster + strict dates) ──
    val_reqs: list[dict] = []
    start, end = header_idx + 1, rowcount

    def dv(ci, rule):
        if ci is not None and ci >= 0:
            val_reqs.append(
                {
                    "setDataValidation": {
                        "range": {
                            "sheetId": gid,
                            "startRowIndex": start,
                            "endRowIndex": end,
                            "startColumnIndex": ci,
                            "endColumnIndex": ci + 1,
                        },
                        "rule": rule,
                    }
                }
            )

    def isofmt(ci):
        if ci is not None and ci >= 0:
            val_reqs.append(
                {
                    "repeatCell": {
                        "range": {
                            "sheetId": gid,
                            "startRowIndex": start,
                            "endRowIndex": end,
                            "startColumnIndex": ci,
                            "endColumnIndex": ci + 1,
                        },
                        "cell": {
                            "userEnteredFormat": {
                                "numberFormat": {"type": "DATE", "pattern": "yyyy-mm-dd"}
                            }
                        },
                        "fields": "userEnteredFormat.numberFormat",
                    }
                }
            )

    dv(
        ed_std_i,
        {
            "condition": {
                "type": "ONE_OF_LIST",
                "values": [{"userEnteredValue": n} for n in editor_list],
            },
            "strict": True,
            "showCustomUi": True,
            "inputMessage": "Pick ONE editor from the roster.",
        },
    )
    dv(
        wr_std_i,
        {
            "condition": {
                "type": "ONE_OF_LIST",
                "values": [{"userEnteredValue": n} for n in writer_list],
            },
            "strict": False,
            "showCustomUi": True,
            "inputMessage": "Pick the writer from the roster.",
        },
    )
    dv(
        review2_std_i,
        {
            "condition": {
                "type": "ONE_OF_LIST",
                "values": [{"userEnteredValue": n} for n in sr_editor_list],
            },
            "strict": True,
            "showCustomUi": True,
            "inputMessage": "Pick the Sr Editor who did the 2nd review (active first).",
        },
    )
    if dt_i is not None:
        dv(
            dt_i,
            {
                "condition": {"type": "DATE_IS_VALID"},
                "strict": True,
                "showCustomUi": False,
                "inputMessage": "One real date (e.g. 2026-04-07). No free text.",
            },
        )
        isofmt(dt_i)
    for ri in (rev1_std_i, rev2_std_i, rev3_std_i):
        dv(
            ri,
            {
                "condition": {"type": "DATE_IS_VALID"},
                "strict": True,
                "showCustomUi": False,
                "inputMessage": "One real revision date (e.g. 2026-04-07) or blank.",
            },
        )
        isofmt(ri)
    print(
        f"[meta] validation: {len(val_reqs)} requests · roster {len(editor_list)} editors / "
        f"{len(writer_list)} writers / {len(sr_editor_list)} sr editors"
    )

    if not apply:
        print("[meta] DRY-RUN — no writes. Re-run with --apply to execute.")
        return 0
    if value_updates:
        svc.spreadsheets().values().batchUpdate(
            spreadsheetId=sid, body={"valueInputOption": "USER_ENTERED", "data": value_updates}
        ).execute()
    if val_reqs:
        svc.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": val_reqs}).execute()
    print("[meta] APPLIED.")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--meta", action="store_true", help="standardize the Meta Editorial Tracker (TRACKER tab)"
    )
    ap.add_argument("--apply", action="store_true", help="execute writes (default: dry-run)")
    args = ap.parse_args(argv)
    if args.meta:
        return standardize_meta(apply=args.apply)
    svc = sheets()
    sid = settings.article_count_id

    meta = svc.spreadsheets().get(spreadsheetId=sid, fields="sheets.properties").execute()
    props = {s["properties"]["title"]: s["properties"] for s in meta["sheets"]}
    skip = set(_ARTICLE_NON_CLIENT_TABS) | {ROSTERS_TAB, AUDIT_TAB}
    tabs = [t for t in props if t not in skip]
    if "TEMPLATE" in props and "TEMPLATE" not in tabs:
        tabs.append("TEMPLATE")  # gets the columns + rules so new tabs inherit

    # Writer + editor rosters come from the LIVE BigQuery editorial_name_map
    # (DaniQ-editable sheet → BQ) via build_rosters — incl. the "Auditioning
    # Writer" bucket — so her latest corrections flow into the proposal sheet.
    # The WRITER (STANDARD) fill uses the importer's already-canonicalized
    # rec["writer_name"] (same BQ map), so no local override is needed.
    roster_editors, writers = build_rosters()
    sr_editor_list = _sr_editor_list(roster_editors)
    db = load_db_rows()

    # Durable ex-editor prune: keep a TERMINATED editor only if their first name
    # appears as an editor in the article log. Active / alias-only names always
    # stay. Drops never-logged ex-leadership (Andres Rojas, Jose Maria Sosa) for
    # good — a manual delete in the sheet would otherwise be re-added next run.
    logged_first = {
        name.split()[0].lower()
        for rec in db.values()
        for name in rec["editors"]
        if name and name.split()
    }
    dropped = [
        e["name"]
        for e in roster_editors
        if e["status"] == "TERMINATED" and e["name"].split()[0].lower() not in logged_first
    ]
    roster_editors = [
        e
        for e in roster_editors
        if e["status"] != "TERMINATED" or e["name"].split()[0].lower() in logged_first
    ]
    # Active (and alias-only / unknown-status) first, A→Z; terminated below, A→Z.
    roster_editors.sort(key=lambda e: (e["status"] == "TERMINATED", e["name"].lower()))
    active_ed = [e["name"] for e in roster_editors if e["status"] == "ACTIVE"]
    all_ed = [e["name"] for e in roster_editors]
    print(
        f"rosters: {len(active_ed)} active editors · {len(all_ed)} all editors "
        f"(dropped {len(dropped)} never-logged terminated: {', '.join(dropped) or '—'}) · "
        f"{len(writers)} writers · db rows: {len(db)} · tabs: {len(tabs)}"
    )
    grids = read_grids(svc, sid, tabs)

    # ── pass 1: STRUCTURE — insert the (STANDARD) columns where missing ─────
    insert_reqs: list[dict] = []
    header_writes: list[dict] = []
    needs_insert: list[str] = []
    for tab in tabs:
        values = grids.get(tab, [])
        header_idx, hmap = find_header(values)
        if header_idx is None:
            continue
        hdr_row = values[header_idx]
        ed_std_i, wr_std_i, rev1_std_i, rev2_std_i = std_col_positions(hdr_row)
        rev3_std_i = _find_std(hdr_row, REV3_STD)
        review2_std_i = _find_std(hdr_row, REVIEW2_STD)
        # Each anchor = (original column index, [new standard titles to insert
        # right after it]). Only anchors whose std columns are still missing.
        anchors: list[tuple[int, list[str]]] = []
        if "EDITOR" in hmap and ed_std_i is None:
            # new tab: editor-std + 2nd-review (right after it) in one insert
            anchors.append(
                (hmap["EDITOR"], [ED_STD] + ([REVIEW2_STD] if review2_std_i is None else []))
            )
        elif review2_std_i is None and ed_std_i is not None:
            # already-structured tab: 2nd-review after the existing EDITOR (STANDARD)
            anchors.append((ed_std_i, [REVIEW2_STD]))
        if "WRITER" in hmap and wr_std_i is None:
            anchors.append((hmap["WRITER"], [WR_STD]))
        if "REVISED" in hmap and rev1_std_i is None:
            anchors.append((hmap["REVISED"], [REV1_STD, REV2_STD, REV3_STD]))
        elif rev3_std_i is None and rev2_std_i is not None:
            # already-structured tab: 3rd-revision after the existing 2nd revision
            anchors.append((rev2_std_i, [REV3_STD]))
        if not anchors:
            continue  # already structured (incl. rev3 + 2nd-review present)
        needs_insert.append(tab)
        gid = props[tab]["sheetId"]
        # Insert from the highest anchor first so lower anchors stay valid inside
        # this batch; each insertDimension adds len(titles) blank columns.
        for anchor_i, titles in sorted(anchors, key=lambda a: a[0], reverse=True):
            insert_reqs.append(
                {
                    "insertDimension": {
                        "range": {
                            "sheetId": gid,
                            "dimension": "COLUMNS",
                            "startIndex": anchor_i + 1,
                            "endIndex": anchor_i + 1 + len(titles),
                        },
                        "inheritFromBefore": False,
                    }
                }
            )
        # Final positions: a column at index c shifts right by the count of
        # inserted columns whose anchor sits strictly before c. Prefix-sum the
        # inserts in anchor order, then a new title's final index =
        # anchor + (inserts before it) + 1 + its offset within the group.
        before = 0
        prefix: dict[int, int] = {}
        for anchor_i, titles in sorted(anchors, key=lambda a: a[0]):
            prefix[anchor_i] = before
            before += len(titles)
        for anchor_i, titles in anchors:
            base = anchor_i + prefix[anchor_i] + 1
            for k, title in enumerate(titles):
                header_writes.append(
                    {
                        "range": f"'{tab}'!{col_letter(base + k)}{header_idx + 1}",
                        "values": [[title]],
                    }
                )

    print(f"structure: {len(needs_insert)} tabs need (STANDARD) columns")
    if args.apply and insert_reqs:
        for i in range(0, len(insert_reqs), 100):
            svc.spreadsheets().batchUpdate(
                spreadsheetId=sid, body={"requests": insert_reqs[i : i + 100]}
            ).execute()
            time.sleep(0.6)
        svc.spreadsheets().values().batchUpdate(
            spreadsheetId=sid,
            body={"valueInputOption": "RAW", "data": header_writes},
        ).execute()
        print(f"inserted columns on {len(needs_insert)} tabs + titled headers")
        grids = read_grids(svc, sid, tabs)  # positions changed — re-read

    # ── passes 3–6: plan fills, dates, validation, audit ────────────────────
    value_updates: list[dict] = []
    validation_requests: list[dict] = []
    audit_rows: list[list] = []
    totals: dict[str, int] = defaultdict(int)

    for tab in tabs:
        values = grids.get(tab, [])
        header_idx, hmap = find_header(values)
        missing = [name for k, name in REQUIRED_COLS.items() if k not in hmap]
        n_rows = max(0, len(values) - (header_idx + 1)) if header_idx is not None else 0
        hdr_row = values[header_idx] if header_idx is not None else []
        ed_std_i, wr_std_i, rev1_std_i, rev2_std_i = std_col_positions(hdr_row)
        rev3_std_i = _find_std(hdr_row, REV3_STD)
        review2_std_i = _find_std(hdr_row, REVIEW2_STD)
        if not args.apply and header_idx is not None:
            # dry-run preview: columns not inserted yet — report would-be fills.
            # -1 sentinels keep the fill loop counting without emitting writes.
            if ed_std_i is None:
                ed_std_i = wr_std_i = -1
                if "REVISED" in hmap:
                    rev1_std_i = rev2_std_i = -1
            # 3rd-revision is added even to already-structured tabs.
            if rev3_std_i is None and (rev2_std_i is not None or "REVISED" in hmap):
                rev3_std_i = -1

        ed_fill = wr_fill = dt_fix = slash = bad_dates = rev1_fill = rev2_fill = rev3_fill = 0

        if header_idx is not None and n_rows:
            dt_i = hmap.get("DATE")
            ed_col_vals: list[list[str]] = []
            wr_col_vals: list[list[str]] = []
            rev1_col_vals: list[list[str]] = []
            rev2_col_vals: list[list[str]] = []
            rev3_col_vals: list[list[str]] = []
            dt_updates: list[list[str]] = []
            dt_changed = False
            for r_off in range(n_rows):
                sheet_row = header_idx + 2 + r_off
                row = values[header_idx + 1 + r_off]
                rec = db.get((tab, sheet_row))
                ed_val = wr_val = rev1_val = rev2_val = rev3_val = ""
                if rec:
                    if rec["editors"]:
                        ed_val = " / ".join(rec["editors"])
                        ed_fill += 1
                        if len(rec["editors"]) > 1 or (
                            rec["editor_raw"] and "/" in rec["editor_raw"]
                        ):
                            slash += 1
                    if rec["writer_name"]:
                        # the importer's already-canonical writer name (BQ map)
                        wr_val = rec["writer_name"]
                        wr_fill += 1
                    # revision dates are pre-sorted ascending in load_db_rows
                    revs = rec.get("revisions") or []
                    if len(revs) >= 1:
                        rev1_val = revs[0]
                        rev1_fill += 1
                    if len(revs) >= 2:
                        rev2_val = revs[1]
                        rev2_fill += 1
                    if len(revs) >= 3:
                        rev3_val = revs[2]
                        rev3_fill += 1
                ed_col_vals.append([ed_val])
                wr_col_vals.append([wr_val])
                rev1_col_vals.append([rev1_val])
                rev2_col_vals.append([rev2_val])
                rev3_col_vals.append([rev3_val])
                # in-place date fix: only year-less text cells with a confident parse
                if dt_i is not None:
                    cur = str(row[dt_i]) if dt_i < len(row) else ""
                    new = cur
                    if (
                        rec
                        and rec["date_raw"]
                        and cur.strip() == str(rec["date_raw"]).strip()
                        and rec["date_iso"]
                        and cur.strip()
                        and not re.search(r"\b20\d{2}\b", cur)
                    ):
                        new = rec["date_iso"]
                        dt_fix += 1
                        dt_changed = True
                    dt_updates.append([new])
                    if cur.strip() and rec and not rec["date_iso"]:
                        bad_dates += 1

            first_data = header_idx + 2
            last_data = header_idx + 1 + n_rows
            if ed_std_i is not None and ed_std_i >= 0 and ed_fill:
                value_updates.append(
                    {
                        "range": (
                            f"'{tab}'!{col_letter(ed_std_i)}{first_data}:"
                            f"{col_letter(ed_std_i)}{last_data}"
                        ),
                        "values": ed_col_vals,
                    }
                )
            if wr_std_i is not None and wr_std_i >= 0 and wr_fill:
                value_updates.append(
                    {
                        "range": (
                            f"'{tab}'!{col_letter(wr_std_i)}{first_data}:"
                            f"{col_letter(wr_std_i)}{last_data}"
                        ),
                        "values": wr_col_vals,
                    }
                )
            if rev1_std_i is not None and rev1_std_i >= 0 and rev1_fill:
                value_updates.append(
                    {
                        "range": (
                            f"'{tab}'!{col_letter(rev1_std_i)}{first_data}:"
                            f"{col_letter(rev1_std_i)}{last_data}"
                        ),
                        "values": rev1_col_vals,
                    }
                )
            if rev2_std_i is not None and rev2_std_i >= 0 and rev2_fill:
                value_updates.append(
                    {
                        "range": (
                            f"'{tab}'!{col_letter(rev2_std_i)}{first_data}:"
                            f"{col_letter(rev2_std_i)}{last_data}"
                        ),
                        "values": rev2_col_vals,
                    }
                )
            if rev3_std_i is not None and rev3_std_i >= 0 and rev3_fill:
                value_updates.append(
                    {
                        "range": (
                            f"'{tab}'!{col_letter(rev3_std_i)}{first_data}:"
                            f"{col_letter(rev3_std_i)}{last_data}"
                        ),
                        "values": rev3_col_vals,
                    }
                )
            if dt_i is not None and dt_changed:
                value_updates.append(
                    {
                        "range": (
                            f"'{tab}'!{col_letter(dt_i)}{first_data}:{col_letter(dt_i)}{last_data}"
                        ),
                        "values": dt_updates,
                    }
                )

            # validation + formats (only with real std positions)
            gid = props[tab]["sheetId"]
            start = header_idx + 1
            end = props[tab]["gridProperties"]["rowCount"]

            def dv(col_i: int, rule: dict):
                validation_requests.append(
                    {
                        "setDataValidation": {
                            "range": {
                                "sheetId": gid,
                                "startRowIndex": start,
                                "endRowIndex": end,
                                "startColumnIndex": col_i,
                                "endColumnIndex": col_i + 1,
                            },
                            "rule": rule,
                        }
                    }
                )

            if ed_std_i is not None and ed_std_i >= 0:
                dv(
                    ed_std_i,
                    {
                        "condition": {
                            "type": "ONE_OF_RANGE",
                            "values": [{"userEnteredValue": f"='{ROSTERS_TAB}'!$B$2:$B"}],
                        },
                        "strict": True,
                        "showCustomUi": True,
                        "inputMessage": "Pick ONE editor from the roster (📋 Rosters tab). "
                        "Red cells = pending real assignment (collaborations).",
                    },
                )
            if wr_std_i is not None and wr_std_i >= 0:
                dv(
                    wr_std_i,
                    {
                        "condition": {
                            "type": "ONE_OF_RANGE",
                            "values": [{"userEnteredValue": f"='{ROSTERS_TAB}'!$G$2:$G"}],
                        },
                        "strict": False,
                        "showCustomUi": True,
                        "inputMessage": "Pick the writer from the roster (📋 Rosters tab). "
                        "Missing? Add them there first.",
                    },
                )
            if review2_std_i is not None and review2_std_i >= 0:
                dv(
                    review2_std_i,
                    {
                        "condition": {
                            "type": "ONE_OF_RANGE",
                            # SR EDITORS moved to col F in the master Roster (2026-06-26);
                            # keep this in sync with apply_original.py + the live re-point.
                            "values": [{"userEnteredValue": f"='{ROSTERS_TAB}'!$F$2:$F"}],
                        },
                        "strict": True,
                        "showCustomUi": True,
                        "inputMessage": "Pick the Sr Editor who did the 2nd review "
                        "(📋 Rosters tab, column F — active first).",
                    },
                )

            def iso_date_format(col_i: int) -> None:
                # unambiguous ISO display — the legacy "MMM d" format hid the year
                validation_requests.append(
                    {
                        "repeatCell": {
                            "range": {
                                "sheetId": gid,
                                "startRowIndex": start,
                                "endRowIndex": end,
                                "startColumnIndex": col_i,
                                "endColumnIndex": col_i + 1,
                            },
                            "cell": {
                                "userEnteredFormat": {
                                    "numberFormat": {"type": "DATE", "pattern": "yyyy-mm-dd"}
                                }
                            },
                            "fields": "userEnteredFormat.numberFormat",
                        }
                    }
                )

            if dt_i is not None:
                dv(
                    dt_i,
                    {
                        "condition": {"type": "DATE_IS_VALID"},
                        "strict": True,
                        "showCustomUi": False,
                        "inputMessage": "One real date (e.g. 2026-04-07). "
                        "No free text, no multiple dates in one cell.",
                    },
                )
                iso_date_format(dt_i)
            # 1st / 2nd revision date columns: one real date each (blanks OK),
            # yyyy-mm-dd display. STRICT (reject input) — same hard gate as
            # SUBMITTED, so a user can only enter a real date or leave it blank;
            # free text / partial dates / comma-lists are refused on entry. The
            # original REVISED cell stays untouched (3rd+ revisions, raw lists
            # still live there); only these standardized split columns are gated.
            for rev_i in (rev1_std_i, rev2_std_i, rev3_std_i):
                if rev_i is not None and rev_i >= 0:
                    dv(
                        rev_i,
                        {
                            "condition": {"type": "DATE_IS_VALID"},
                            "strict": True,
                            "showCustomUi": False,
                            "inputMessage": "One real revision date (e.g. 2026-04-07) "
                            "or blank — no free text, no multiple dates in one cell. "
                            "Split from the original REVISED cell.",
                        },
                    )
                    iso_date_format(rev_i)

        hdr_note = (
            "row 2 (standard)"
            if header_idx == 1
            else f"row {header_idx + 1} ⚠ non-standard"
            if header_idx is not None
            else "NOT FOUND ⚠"
        )
        verdict = "OK"
        if header_idx is None or missing or (header_idx != 1 and n_rows > 0):
            verdict = "REVIEW — structure"
        elif slash or bad_dates:
            verdict = "REVIEW — content"
        audit_rows.append(
            [
                tab,
                hdr_note,
                ", ".join(missing) or "—",
                n_rows,
                ed_fill,
                wr_fill,
                rev1_fill,
                rev2_fill,
                slash,
                dt_fix,
                bad_dates,
                verdict,
            ]
        )
        for k, v in (
            ("ed", ed_fill),
            ("wr", wr_fill),
            ("rev1", rev1_fill),
            ("rev2", rev2_fill),
            ("rev3", rev3_fill),
            ("slash", slash),
            ("dt", dt_fix),
            ("baddate", bad_dates),
        ):
            totals[k] += v

    print(
        f"\nPLAN — std editor cells: {totals['ed']} · std writer cells: {totals['wr']} · "
        f"1st rev dates: {totals['rev1']} · 2nd rev dates: {totals['rev2']} · "
        f"3rd rev dates: {totals['rev3']} · "
        f"slash pending DaniQ: {totals['slash']} · year-less dates → ISO: {totals['dt']} · "
        f"unparseable dates: {totals['baddate']} · validation+format requests: "
        f"{len(validation_requests)} · value ranges: {len(value_updates)}"
    )
    if not args.apply:
        print("DRY RUN — pass --apply to execute.")
        return 0

    # ── rosters tab ──────────────────────────────────────────────────────────
    add_reqs = [
        {"addSheet": {"properties": {"title": t}}}
        for t in (ROSTERS_TAB, AUDIT_TAB)
        if t not in props
    ]
    if add_reqs:
        svc.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": add_reqs}).execute()
    # Layout: A active editors (quick-pick for new entries) · B all editors
    # (the validation list — active A→Z then terminated A→Z) · C/D/E status +
    # hire + termination dates aligned to B · F spacer · G writers · H sr editors
    # (2nd-review validation — active first, then terminated). Editor dropdown
    # points at $B, writer dropdown at $G, 2nd-review dropdown at $H.
    n = max(len(active_ed), len(roster_editors), len(writers), len(sr_editor_list))
    roster_rows = [
        [
            "ACTIVE EDITORS (new entries)",
            "ALL EDITORS (validation)",
            "STATUS",
            "HIRE DATE",
            "TERMINATION DATE",
            "",
            "WRITERS (validation)",
            "SR EDITORS (2nd review)",
        ]
    ]
    for i in range(n):
        ed = roster_editors[i] if i < len(roster_editors) else None
        roster_rows.append(
            [
                active_ed[i] if i < len(active_ed) else "",
                ed["name"] if ed else "",
                ed["status"] if ed else "",
                ed["hire"] if ed else "",
                ed["term"] if ed else "",
                "",
                writers[i] if i < len(writers) else "",
                sr_editor_list[i] if i < len(sr_editor_list) else "",
            ]
        )
    svc.spreadsheets().values().clear(
        spreadsheetId=sid, range=f"'{ROSTERS_TAB}'!A:H", body={}
    ).execute()
    svc.spreadsheets().values().update(
        spreadsheetId=sid,
        range=f"'{ROSTERS_TAB}'!A1",
        valueInputOption="RAW",
        body={"values": roster_rows},
    ).execute()
    print(f"rosters tab written ({n} rows)")

    # ── value fills (batched) ────────────────────────────────────────────────
    for i in range(0, len(value_updates), 30):
        svc.spreadsheets().values().batchUpdate(
            spreadsheetId=sid,
            body={"valueInputOption": "USER_ENTERED", "data": value_updates[i : i + 30]},
        ).execute()
        time.sleep(0.6)
    print(f"fills applied ({len(value_updates)} column ranges)")

    # ── validation + formats ────────────────────────────────────────────────
    for i in range(0, len(validation_requests), 200):
        svc.spreadsheets().batchUpdate(
            spreadsheetId=sid, body={"requests": validation_requests[i : i + 200]}
        ).execute()
        time.sleep(0.6)
    print(f"validation + format rules applied ({len(validation_requests)})")

    # ── audit tab ────────────────────────────────────────────────────────────
    audit_header = [
        "TAB",
        "HEADER ROW",
        "MISSING REQUIRED COLUMNS",
        "DATA ROWS",
        "EDITOR (STANDARD) FILLED",
        "WRITER (STANDARD) FILLED",
        "1ST REVISION FILLED",
        "2ND REVISION FILLED",
        "SLASH CELLS (await DaniQ)",
        "DATES → ISO",
        "UNPARSEABLE DATES",
        "VERDICT",
    ]
    svc.spreadsheets().values().clear(
        spreadsheetId=sid, range=f"'{AUDIT_TAB}'!A:L", body={}
    ).execute()
    svc.spreadsheets().values().update(
        spreadsheetId=sid,
        range=f"'{AUDIT_TAB}'!A1",
        valueInputOption="RAW",
        body={"values": [audit_header] + sorted(audit_rows, key=lambda r: (r[-1] == "OK", r[0]))},
    ).execute()
    print(f"audit tab written ({len(audit_rows)} tabs)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
