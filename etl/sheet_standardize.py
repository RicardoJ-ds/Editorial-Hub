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

  1. STRUCTURE  insert the two (STANDARD) columns after EDITOR / WRITER on
                every client tab + TEMPLATE (skipped when already present).
  2. ROSTERS    create/refresh `📋 Rosters`: Active editors · All editors
                (incl. terminated, so history validates) · Writers. Validation
                points here (ONE_OF_RANGE) — the team maintains ONE list.
  3. FILL       EDITOR (STANDARD) = canonical name (date-windowed Sam/Lauren
                rules included). Slash collaborations are filled as
                "Name A / Name B" — strict validation flags them red on
                purpose: they're pending DaniQ's real-assignment list.
                WRITER (STANDARD) = canonical writer name.
  4. DATES      SUBMITTED normalized IN PLACE (same value, real date): only
                year-less text cells (e.g. "Aug 26") are rewritten to the
                importer-confirmed ISO date; the column gets a yyyy-mm-dd
                display format (the legacy "MMM d" format hid the year — how
                two-years-apart dates collided) + must-be-a-date validation.
  5. VALIDATE   EDITOR (STANDARD): dropdown = All editors (STRICT).
                WRITER (STANDARD): dropdown = Writers (warning-only — legacy
                first-name-only history would drown a strict rule).
  6. AUDIT      `✅ VALIDATION AUDIT` tab: per tab — header row position (the
                Felt bug class), missing required columns, rows, std-column
                fill counts, slash cells pending DaniQ, unparseable dates,
                verdict.

Run inside the backend container:
    docker compose exec -T backend python -m etl.sheet_standardize          # dry-run
    docker compose exec -T backend python -m etl.sheet_standardize --apply
"""

from __future__ import annotations

import argparse
import json
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


def build_rosters() -> tuple[list[str], list[str], list[str]]:
    """(active_editors, all_editors, writers) — canonical names only."""
    bq = get_bq()
    active, all_ed = set(), set()
    for r in bq.query(
        "SELECT employee_name, status FROM `graphite-data.graphite_bi_sandbox.v_headcount` "
        "WHERE LOWER(department) LIKE 'editorial%' "
        "AND (LOWER(title) LIKE '%editor%' OR LOWER(title) LIKE '%editorial%')"
    ).result():
        all_ed.add(r.employee_name)
        if r.status == "ACTIVE":
            active.add(r.employee_name)
    with open("/app/etl/mappings/editor_aliases.json") as f:
        ed = json.load(f)
    for v in ed["aliases"].values():
        if v["status"] == "confirmed" and v.get("canonical"):
            all_ed.add(v["canonical"])
        elif v["status"] == "confirmed_windowed":
            for w in v.get("windows", []):
                all_ed.add(w["canonical"])
    with open("/app/etl/mappings/writer_aliases.json") as f:
        wr = json.load(f)
    writers = {
        v["canonical"]
        for v in wr["aliases"].values()
        if v.get("canonical")
        and v["status"] in ("confirmed", "confirmed_first_name", "roster")
        and " " in v["canonical"]
    }
    return sorted(active), sorted(all_ed), sorted(writers)


def load_db_rows() -> dict[tuple[str, int], dict]:
    """(tab, sheet_row) → normalization targets. Collaborations keep ALL
    editor names so the standard cell can show 'Name A / Name B'."""
    out: dict[tuple[str, int], dict] = {}
    with get_session() as s:
        for r in s.execute(
            text(
                "SELECT source_tab, source_row, editor_raw, editor_name, "
                "writer_raw, writer_name, date_submitted_raw, submitted_date, year, month "
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


def std_col_positions(header_row: list) -> tuple[int | None, int | None]:
    ed = wr = None
    for i, h in enumerate(header_row):
        t = str(h).strip().upper()
        if t == ED_STD:
            ed = i
        elif t == WR_STD:
            wr = i
    return ed, wr


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="execute writes (default: dry-run)")
    args = ap.parse_args(argv)
    svc = sheets()
    sid = settings.article_count_id

    meta = svc.spreadsheets().get(spreadsheetId=sid, fields="sheets.properties").execute()
    props = {s["properties"]["title"]: s["properties"] for s in meta["sheets"]}
    skip = set(_ARTICLE_NON_CLIENT_TABS) | {ROSTERS_TAB, AUDIT_TAB}
    tabs = [t for t in props if t not in skip]
    if "TEMPLATE" in props and "TEMPLATE" not in tabs:
        tabs.append("TEMPLATE")  # gets the columns + rules so new tabs inherit

    # DaniQ's green-confirmed writer map (the ONLY source of truth for writers
    # — no BQ table exists). Overrides the importer's name on the WRITER
    # (STANDARD) column: full names where she gave one, "audition" for the
    # trial bucket, windowed for the one split (Dan).
    daniq_wr: dict = {}
    try:
        with open("/app/etl/mappings/daniq_writer_confirmations.json") as fh:
            daniq_wr = {k.lower(): v for k, v in json.load(fh).items()}
    except OSError:
        pass

    def daniq_writer(raw: str, ym: str | None) -> str | None:
        e = daniq_wr.get((raw or "").strip().lower())
        if not e:
            return None
        if "windows" in e and ym:
            for w in e["windows"]:
                if (w.get("from") is None or w["from"] <= ym) and (w.get("to") is None or ym <= w["to"]):
                    return w["value"]
        return e.get("value")

    active_ed, all_ed, writers = build_rosters()
    # add DaniQ's confirmed writer names (+ the audition bucket) to the roster
    dq_names = set()
    for e in daniq_wr.values():
        for val in [e.get("value")] + [w["value"] for w in e.get("windows", [])]:
            if val:
                dq_names.add(val)
    writers = sorted(set(writers) | dq_names)
    db = load_db_rows()
    print(
        f"rosters: {len(active_ed)} active editors · {len(all_ed)} all editors · "
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
        ed_std_i, wr_std_i = std_col_positions(hdr_row)
        if ed_std_i is not None and (wr_std_i is not None or "WRITER" not in hmap):
            continue  # already structured
        needs_insert.append(tab)
        gid = props[tab]["sheetId"]
        ed_i = hmap["EDITOR"]
        wr_i = hmap.get("WRITER")
        # higher index first so the lower one stays valid inside this batch
        for src_i in sorted([i for i in (ed_i, wr_i) if i is not None], reverse=True):
            insert_reqs.append(
                {
                    "insertDimension": {
                        "range": {
                            "sheetId": gid,
                            "dimension": "COLUMNS",
                            "startIndex": src_i + 1,
                            "endIndex": src_i + 2,
                        },
                        "inheritFromBefore": False,
                    }
                }
            )
        # header titles land AFTER the insert (positions: a column shifts +1
        # when the other insert sits at a lower index)
        if wr_i is not None:
            wr_new = wr_i + 1 + (1 if wr_i > ed_i else 0)
            header_writes.append(
                {
                    "range": f"'{tab}'!{col_letter(wr_new)}{header_idx + 1}",
                    "values": [[WR_STD]],
                }
            )
        ed_new = ed_i + 1 + (1 if wr_i is not None and ed_i > wr_i else 0)
        header_writes.append(
            {"range": f"'{tab}'!{col_letter(ed_new)}{header_idx + 1}", "values": [[ED_STD]]}
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
        ed_std_i, wr_std_i = std_col_positions(hdr_row)
        if not args.apply and header_idx is not None and ed_std_i is None:
            # dry-run preview: columns not inserted yet — report would-be fills
            ed_std_i = wr_std_i = -1

        ed_fill = wr_fill = dt_fix = slash = bad_dates = 0

        if header_idx is not None and n_rows:
            dt_i = hmap.get("DATE")
            ed_col_vals: list[list[str]] = []
            wr_col_vals: list[list[str]] = []
            dt_updates: list[list[str]] = []
            dt_changed = False
            for r_off in range(n_rows):
                sheet_row = header_idx + 2 + r_off
                row = values[header_idx + 1 + r_off]
                rec = db.get((tab, sheet_row))
                ed_val = wr_val = ""
                if rec:
                    if rec["editors"]:
                        ed_val = " / ".join(rec["editors"])
                        ed_fill += 1
                        if len(rec["editors"]) > 1 or (
                            rec["editor_raw"] and "/" in rec["editor_raw"]
                        ):
                            slash += 1
                    if rec["writer_name"]:
                        # DaniQ's confirmation wins (full name / audition);
                        # else the importer's resolved name.
                        wr_val = daniq_writer(rec["writer_raw"], rec.get("ym")) or rec["writer_name"]
                        wr_fill += 1
                ed_col_vals.append([ed_val])
                wr_col_vals.append([wr_val])
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
                            "values": [{"userEnteredValue": f"='{ROSTERS_TAB}'!$C$2:$C"}],
                        },
                        "strict": False,
                        "showCustomUi": True,
                        "inputMessage": "Pick the writer from the roster (📋 Rosters tab). "
                        "Missing? Add them there first.",
                    },
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
                # unambiguous ISO display — the legacy "MMM d" format hid the year
                validation_requests.append(
                    {
                        "repeatCell": {
                            "range": {
                                "sheetId": gid,
                                "startRowIndex": start,
                                "endRowIndex": end,
                                "startColumnIndex": dt_i,
                                "endColumnIndex": dt_i + 1,
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
                slash,
                dt_fix,
                bad_dates,
                verdict,
            ]
        )
        for k, v in (
            ("ed", ed_fill),
            ("wr", wr_fill),
            ("slash", slash),
            ("dt", dt_fix),
            ("baddate", bad_dates),
        ):
            totals[k] += v

    print(
        f"\nPLAN — std editor cells: {totals['ed']} · std writer cells: {totals['wr']} · "
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
    n = max(len(active_ed), len(all_ed), len(writers))
    roster_rows = [
        ["ACTIVE EDITORS (new entries)", "ALL EDITORS (validation)", "WRITERS (validation)"]
    ]
    for i in range(n):
        roster_rows.append(
            [
                active_ed[i] if i < len(active_ed) else "",
                all_ed[i] if i < len(all_ed) else "",
                writers[i] if i < len(writers) else "",
            ]
        )
    svc.spreadsheets().values().clear(
        spreadsheetId=sid, range=f"'{ROSTERS_TAB}'!A:C", body={}
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
        "SLASH CELLS (await DaniQ)",
        "DATES → ISO",
        "UNPARSEABLE DATES",
        "VERDICT",
    ]
    svc.spreadsheets().values().clear(
        spreadsheetId=sid, range=f"'{AUDIT_TAB}'!A:J", body={}
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
