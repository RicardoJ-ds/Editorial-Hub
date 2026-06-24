"""Apply normalization to the ORIGINAL sheets in REPLACE mode (destructive).

Unlike `sheet_standardize.py` (additive — adds "(STANDARD)" columns next to the
raw ones on the proposal COPIES), this OVERWRITES the raw columns on the real
originals to keep ONLY the normalized values. HEADER-DRIVEN + per-tab: every tab
may differ (column order, header names, which columns exist), so each is resolved
by header independently and only the missing standard columns are inserted.

  • EDITOR / WRITER cells → canonical names (from article_records); rows the
    importer didn't parse keep their existing value (never blanked).
  • MAC: the single "REVISED" column → renamed "1ST REVISION" + two inserted
    "2ND REVISION" / "3RD REVISION" columns, filled with the parsed dates.
    Meta: the existing "REVISION 1/2/3" columns → overwritten with parsed dates.
  • A "2ND REVIEW" column is inserted after EDITOR (Sr-editor dropdown, blank).
  • Dropdowns validate against a local "📋 Roster" tab that IMPORTRANGEs the
    master Roster in the Editorial Name Mappings sheet (one-time "Allow access"
    click needed in the UI per sheet — the API can't authorize it).

The raw values are REPLACED — Google Sheets version history is the only recovery
(Ricardo's call). PREREQUISITE: re-import article_records FROM the target sheet
first so the (source_tab, source_row) keys line up. Dry-run by default.

    docker compose exec -T backend python -m etl.apply_original --target mac          # dry-run
    docker compose exec -T backend python -m etl.apply_original --target mac --apply
"""

from __future__ import annotations

import argparse
import sys
import time

from app.services.migration_service import _ARTICLE_NON_CLIENT_TABS
from etl.sheet_standardize import (
    build_rosters,
    col_letter,
    find_header,
    load_db_rows,
    read_grids,
    sheets,
)

MASTER_MAP = "1p0tFg4D8BypZlG6Rfch7KKsqaNa8xUUZRn2BFv6oLsc"  # Name Mappings sheet ("Roster" tab)
ROSTER_LOCAL = "📋 Roster"
MAC_ID = "15WxjOrJtX98YvnWl71Oz0HtVhPtvefB37PbcmAc8BBc"
META_ID = "1FgYpfZ5NRwCXe1nWtqJqlAjlmNiFhJd7oC-2MDs_TSs"
REV_TITLES = ["1ST REVISION", "2ND REVISION", "3RD REVISION"]
REVIEW_TITLE = "2ND REVIEW"


def _find_exact(hdr, *names) -> int | None:
    up = [str(h).strip().upper() for h in hdr]
    for nm in names:
        if nm.upper() in up:
            return up.index(nm.upper())
    return None


def _resolve(values) -> dict | None:
    """Header-driven column map for one tab, or None to skip (no EDITOR/WRITER)."""
    hi, hmap = find_header(values)
    if hi is None or "EDITOR" not in hmap or "WRITER" not in hmap:
        return None
    n = len(values) - (hi + 1)
    if n <= 0:
        return None
    hdr = values[hi]
    return {
        "hi": hi,
        "n": n,
        "editor": hmap["EDITOR"],
        "writer": hmap["WRITER"],
        "revised": _find_exact(hdr, "REVISED", "REVISED DATE"),
        "rev1": _find_exact(hdr, "REVISION 1", "1ST REVISION"),
        "rev2": _find_exact(hdr, "REVISION 2", "2ND REVISION"),
        "rev3": _find_exact(hdr, "REVISION 3", "3RD REVISION"),
        "review": _find_exact(hdr, "2ND REVIEW", "SECOND REVIEW"),
    }


def _plan_inserts(r) -> tuple[list[tuple[int, list[str]]], tuple[int, str] | None]:
    """Anchors for missing standard columns + an optional REVISED→1ST rename."""
    anchors: list[tuple[int, list[str]]] = []
    rename: tuple[int, str] | None = None
    if r["review"] is None:
        anchors.append((r["editor"], [REVIEW_TITLE]))
    if r["rev1"] is not None:  # already split (Meta-style) → add any missing 2nd/3rd
        miss = [REV_TITLES[i] for i, k in ((1, "rev2"), (2, "rev3")) if r[k] is None]
        if miss:
            last = max(x for x in (r["rev1"], r["rev2"], r["rev3"]) if x is not None)
            anchors.append((last, miss))
    elif r["revised"] is not None:  # MAC single REVISED → rename + add 2nd/3rd
        rename = (r["revised"], REV_TITLES[0])
        anchors.append((r["revised"], [REV_TITLES[1], REV_TITLES[2]]))
    else:  # no revision column at all → add all three (empty) so every tab is uniform
        anchor = r["review"] if r["review"] is not None else r["writer"]
        anchors.append((anchor, REV_TITLES[:]))
    return anchors, rename


def _dv(gid, start, end, ci, rule):
    return {
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


def _range_rule(ref, strict, msg):
    return {
        "condition": {"type": "ONE_OF_RANGE", "values": [{"userEnteredValue": ref}]},
        "strict": strict,
        "showCustomUi": True,
        "inputMessage": msg,
    }


def _date_rule():
    return {
        "condition": {"type": "DATE_IS_VALID"},
        "strict": True,
        "showCustomUi": False,
        "inputMessage": "One real date (e.g. 2026-04-07) or blank.",
    }


def _ensure_local_roster(svc, sid, props):
    if ROSTER_LOCAL not in props:
        svc.spreadsheets().batchUpdate(
            spreadsheetId=sid,
            body={"requests": [{"addSheet": {"properties": {"title": ROSTER_LOCAL}}}]},
        ).execute()
    svc.spreadsheets().values().update(
        spreadsheetId=sid,
        range=f"'{ROSTER_LOCAL}'!A1",
        valueInputOption="USER_ENTERED",
        body={"values": [[f'=IMPORTRANGE("{MASTER_MAP}","Roster!A1:H")']]},
    ).execute()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", choices=("mac", "meta"), required=True)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only", default="", help="comma-separated tab names to scope to")
    args = ap.parse_args(argv)
    sid = MAC_ID if args.target == "mac" else META_ID
    svc = sheets()
    meta = svc.spreadsheets().get(spreadsheetId=sid, fields="sheets.properties").execute()
    props = {s["properties"]["title"]: s["properties"] for s in meta["sheets"]}
    db = load_db_rows()
    _, writers = build_rosters()

    if args.target == "meta":
        tabs = ["TRACKER"]
    else:
        skip = set(_ARTICLE_NON_CLIENT_TABS) | {ROSTER_LOCAL}
        tabs = [t for t in props if t not in skip and not t.startswith(("📋", "✅", "🔍", "🔬", "🧩", "⚙️"))]
    if args.only:
        only = {t.strip() for t in args.only.split(",") if t.strip()}
        tabs = [t for t in tabs if t in only]
    grids = read_grids(svc, sid, tabs)

    # ── PHASE A — structure (column inserts + REVISED→1ST rename + new titles) ──
    insert_reqs: list[dict] = []
    header_writes: list[dict] = []
    plans: dict[str, tuple] = {}
    for tab in tabs:
        r = _resolve(grids.get(tab, []))
        if r is None:
            continue
        anchors, rename = _plan_inserts(r)
        plans[tab] = (r, anchors, rename)
        gid = props[tab]["sheetId"]
        for a_i, titles in sorted(anchors, key=lambda a: a[0], reverse=True):
            insert_reqs.append(
                {
                    "insertDimension": {
                        "range": {
                            "sheetId": gid,
                            "dimension": "COLUMNS",
                            "startIndex": a_i + 1,
                            "endIndex": a_i + 1 + len(titles),
                        },
                        # inherit the LEFT neighbour (EDITOR/REVISED — always text),
                        # never the RIGHT one (Meta's "MOVED DOC?" is a checkbox → FALSE)
                        "inheritFromBefore": True,
                    }
                }
            )
        before, prefix = 0, {}
        for a_i, titles in sorted(anchors, key=lambda a: a[0]):
            prefix[a_i] = before
            before += len(titles)
        for a_i, titles in anchors:
            base = a_i + prefix[a_i] + 1
            for k, t in enumerate(titles):
                header_writes.append(
                    {"range": f"'{tab}'!{col_letter(base + k)}{r['hi'] + 1}", "values": [[t]]}
                )
        if rename is not None:
            c, newt = rename
            newc = c + sum(len(t) for a, t in anchors if a < c)
            header_writes.append(
                {"range": f"'{tab}'!{col_letter(newc)}{r['hi'] + 1}", "values": [[newt]]}
            )

    print(
        f"[{args.target}] {len(plans)}/{len(tabs)} tabs to standardize · {len(insert_reqs)} col-inserts"
    )
    for tab in list(plans)[:4]:
        r, anchors, rename = plans[tab]
        ops = ([f"REVISED({col_letter(rename[0])})→1ST REVISION"] if rename else []) + [
            f"insert {t} after {col_letter(a)}" for a, t in anchors
        ]
        revpos = (
            col_letter(r["revised"])
            if r["revised"] is not None
            else (col_letter(r["rev1"]) if r["rev1"] is not None else "—")
        )
        print(
            f"  · {tab}: EDITOR@{col_letter(r['editor'])} WRITER@{col_letter(r['writer'])} "
            f"rev@{revpos} review@{col_letter(r['review']) if r['review'] is not None else 'none'}"
            f" → {'; '.join(ops) or 'all present'}"
        )
    # sample raw→canonical for the first tab
    if plans:
        t0 = list(plans)[0]
        r0, g0 = plans[t0][0], grids[t0]
        shown = 0
        for off in range(r0["n"]):
            rec = db.get((t0, r0["hi"] + 2 + off))
            if rec and rec["editors"]:
                row = g0[r0["hi"] + 1 + off]
                raw_ed = row[r0["editor"]] if r0["editor"] < len(row) else ""
                raw_wr = row[r0["writer"]] if r0["writer"] < len(row) else ""
                print(
                    f"    sample [{t0} row {r0['hi'] + 2 + off}]: EDITOR '{raw_ed}'→'{' / '.join(rec['editors'])}'"
                    f" · WRITER '{raw_wr}'→'{rec['writer_name']}'"
                )
                shown += 1
            if shown >= 3:
                break

    if not args.apply:
        print(f"[{args.target}] DRY-RUN — no writes. Re-run with --apply.")
        return 0

    # ── apply PHASE A, then re-read so columns resolve by their NEW headers ──
    for i in range(0, len(insert_reqs), 100):
        svc.spreadsheets().batchUpdate(
            spreadsheetId=sid, body={"requests": insert_reqs[i : i + 100]}
        ).execute()
        time.sleep(0.5)
    if header_writes:
        svc.spreadsheets().values().batchUpdate(
            spreadsheetId=sid, body={"valueInputOption": "RAW", "data": header_writes}
        ).execute()
    _ensure_local_roster(svc, sid, props)
    grids = read_grids(svc, sid, tabs)

    # ── PHASE B — fills (preserve unparsed rows) + validation ──
    value_updates: list[dict] = []
    val_reqs: list[dict] = []
    for tab in plans:
        values = grids.get(tab, [])
        r = _resolve(values)
        if r is None:
            continue
        hi, n = r["hi"], r["n"]
        gid = props[tab]["sheetId"]
        first, last = hi + 2, hi + 1 + n
        revc = [r["rev1"], r["rev2"], r["rev3"]]

        def cur(idx, off, _v=values, _hi=hi):
            if idx is None:
                return ""
            row = _v[_hi + 1 + off]
            return row[idx] if idx < len(row) else ""

        ed_out, wr_out, c1, c2, c3 = [], [], [], [], []
        for off in range(n):
            rec = db.get((tab, hi + 2 + off))
            ed_out.append(
                [" / ".join(rec["editors"]) if rec and rec["editors"] else cur(r["editor"], off)]
            )
            wr_out.append(
                [rec["writer_name"] if rec and rec["writer_name"] else cur(r["writer"], off)]
            )
            revs = (rec.get("revisions") if rec else None) or []
            if revs:
                c1.append([revs[0]])
                c2.append([revs[1] if len(revs) > 1 else ""])
                c3.append([revs[2] if len(revs) > 2 else ""])
            else:  # keep whatever was there (raw REVISED lives on in 1ST REVISION)
                c1.append([cur(revc[0], off)])
                c2.append([cur(revc[1], off)])
                c3.append([cur(revc[2], off)])

        def vu(idx, vals):
            if idx is not None:
                value_updates.append(
                    {
                        "range": f"'{tab}'!{col_letter(idx)}{first}:{col_letter(idx)}{last}",
                        "values": vals,
                    }
                )

        vu(r["editor"], ed_out)
        vu(r["writer"], wr_out)
        vu(revc[0], c1)
        vu(revc[1], c2)
        vu(revc[2], c3)
        # a freshly-inserted 2nd-review column starts blank — clear any value the
        # insert inherited (a checkbox neighbour leaves FALSE); existing 2nd-review
        # columns (already had data) are left untouched
        _, anchors_a, _ = plans[tab]
        if any(REVIEW_TITLE in t for _, t in anchors_a) and r["review"] is not None:
            vu(r["review"], [[""] for _ in range(n)])

        start, end = hi + 1, props[tab]["gridProperties"]["rowCount"]
        val_reqs.append(
            _dv(
                gid,
                start,
                end,
                r["editor"],
                # NON-strict: editors legitimately appear as "/" collaborations and
                # legacy/inactive-client names have no canonical entry — warn, don't block
                _range_rule(f"='{ROSTER_LOCAL}'!$B$2:$B", False, "Pick an editor from the roster."),
            )
        )
        val_reqs.append(
            _dv(
                gid,
                start,
                end,
                r["writer"],
                _range_rule(
                    f"='{ROSTER_LOCAL}'!$G$2:$G", False, "Pick the writer from the roster."
                ),
            )
        )
        if r["review"] is not None:
            val_reqs.append(
                _dv(
                    gid,
                    start,
                    end,
                    r["review"],
                    _range_rule(
                        f"='{ROSTER_LOCAL}'!$H$2:$H",
                        True,
                        "Pick the Sr Editor who did the 2nd review.",
                    ),
                )
            )
        for ri in revc:
            if ri is not None:
                val_reqs.append(_dv(gid, start, end, ri, _date_rule()))

    for i in range(0, len(value_updates), 40):
        svc.spreadsheets().values().batchUpdate(
            spreadsheetId=sid,
            body={"valueInputOption": "USER_ENTERED", "data": value_updates[i : i + 40]},
        ).execute()
        time.sleep(0.5)
    for i in range(0, len(val_reqs), 100):
        svc.spreadsheets().batchUpdate(
            spreadsheetId=sid, body={"requests": val_reqs[i : i + 100]}
        ).execute()
        time.sleep(0.5)
    print(
        f"[{args.target}] APPLIED — {len(value_updates)} column-ranges written, "
        f"{len(val_reqs)} validations set, '📋 Roster' IMPORTRANGE in place "
        f"(click 'Allow access' in the sheet) · {len(writers)} writers in roster"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
