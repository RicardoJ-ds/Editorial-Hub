"""DaniQ-facing CSV reports — open-and-tick artifacts for validation.

Generates, in etl/reports/:
  month_basis_by_client.csv   per client × month: Operating Model vs log
                              (editorial month) vs log (calendar month) + verdict
  mappings_editors.csv        article-log editor → HR name, status, where to look
  mappings_writers.csv        article-log writer → full name, status, where to look
  mappings_clients.csv        Hub client → Salesforce name, status, where to look
  unmapped_client_tabs.csv    article tabs with no Hub client + article-date span
                              + Salesforce contract years (explains D5)
  caret_rows.csv              the ^ / ^^ / ^^^ rows + the row above (for D3)
  REPORT_FACTS.json           rolled-up numbers the markdown report embeds

Run inside the backend container:
    docker compose exec -T backend python -m etl.reports
"""

from __future__ import annotations

import csv
import json
import os
from collections import defaultdict

from sqlalchemy import text

from etl import transform
from etl.extract import get_session
from etl.load import get_bq
from etl.util import norm_key

REPORTS_DIR = os.path.join(os.path.dirname(__file__), "reports")
MAPPINGS_DIR = os.path.join(os.path.dirname(__file__), "mappings")
MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _write_csv(name: str, header: list[str], rows: list[list]):
    path = os.path.join(REPORTS_DIR, name)
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    return len(rows)


def _sf_contract_dates() -> dict[str, dict]:
    """Salesforce contract begin/end + active flag, keyed by alphanumeric name."""
    bq = get_bq()
    q = """
        SELECT Client_Name, Overall_contract_begin_date AS b,
               Overall_contract_end_date AS e, Current_Status AS active
        FROM `graphite-data.graphite_bi.salesforce_int_Account`
    """
    out: dict[str, dict] = {}
    for r in bq.query(q).result():
        out[norm_key(r["Client_Name"]).replace(" ", "")] = {
            "name": r["Client_Name"],
            "begin": str(r["b"]) if r["b"] else None,
            "end": str(r["e"]) if r["e"] else None,
            "active": r["active"],
        }
    return out


def _origin_tabs(session, col: str) -> dict[str, list[str]]:
    """Top source tabs per editor/writer name — 'where to look' in the sheet."""
    rows = session.execute(
        text(
            f"SELECT {col} AS nm, source_tab, COUNT(*) c FROM article_records "
            f"WHERE {col} IS NOT NULL GROUP BY 1,2"
        )
    )
    agg: dict[str, dict[str, int]] = defaultdict(dict)
    for r in rows:
        agg[r.nm][r.source_tab] = r.c
    return {
        nm: [t for t, _ in sorted(tabs.items(), key=lambda kv: -kv[1])[:3]]
        for nm, tabs in agg.items()
    }


def main() -> int:
    os.makedirs(REPORTS_DIR, exist_ok=True)
    facts: dict = {}
    with open(os.path.join(MAPPINGS_DIR, "editor_aliases.json")) as f:
        ed = json.load(f)
    with open(os.path.join(MAPPINGS_DIR, "writer_aliases.json")) as f:
        wr = json.load(f)
    with open(os.path.join(MAPPINGS_DIR, "client_aliases.json")) as f:
        cl = json.load(f)

    with get_session() as session:
        # ── month basis ────────────────────────────────────────────────────
        mb = transform.build_month_basis_mart(session)
        _write_csv(
            "month_basis_by_client.csv",
            ["client", "year", "month", "operating_model_actual",
             "log_editorial_month", "log_calendar_month", "edit_minus_prod", "verdict"],
            [[r["client_name"], r["year"], MONTHS[r["month"]],
              r["operating_model_actual"], r["log_editorial_month"],
              r["log_calendar_month"], r["edit_minus_prod"], r["verdict"]] for r in mb],
        )
        # monthly totals (2026) + verdict tally + Miter worked example
        tot: dict[tuple, dict] = defaultdict(lambda: {"prod": 0, "edit": 0, "cal": 0})
        verdicts: dict[str, int] = defaultdict(int)
        miter: list[dict] = []
        for r in mb:
            verdicts[r["verdict"]] += 1
            if r["year"] == 2026:
                t = tot[(r["year"], r["month"])]
                t["prod"] += r["operating_model_actual"]
                t["edit"] += r["log_editorial_month"]
                t["cal"] += r["log_calendar_month"]
            if r["client_name"] == "Miter" and r["year"] == 2026:
                miter.append(r)
        facts["month_basis_totals_2026"] = [
            {"month": MONTHS[m], "operating_model": v["prod"],
             "log_editorial": v["edit"], "log_calendar": v["cal"]}
            for (y, m), v in sorted(tot.items())
        ]
        facts["month_basis_verdicts"] = dict(sorted(verdicts.items(), key=lambda kv: -kv[1]))
        facts["miter_example"] = [
            {"month": MONTHS[r["month"]], "operating_model": r["operating_model_actual"],
             "log_editorial": r["log_editorial_month"], "log_calendar": r["log_calendar_month"]}
            for r in sorted(miter, key=lambda r: r["month"])
        ]

        # ── editor / writer origin tabs ─────────────────────────────────────
        ed_tabs = _origin_tabs(session, "editor_name")
        wr_tabs = _origin_tabs(session, "writer_name")

        # ── caret rows (+ the row above) for D3 ─────────────────────────────
        caret = session.execute(
            text(
                """
                WITH carets AS (
                  SELECT DISTINCT source_tab, source_row FROM article_records
                  WHERE copy_name ~ '\\^' OR editor_name ~ '\\^')
                SELECT a.source_tab, a.source_row, a.editor_raw,
                       a.copy_name, a.article_title, a.word_count
                FROM article_records a
                JOIN carets c ON a.source_tab=c.source_tab
                  AND a.source_row BETWEEN c.source_row-1 AND c.source_row
                ORDER BY a.source_tab, a.source_row
                """
            )
        )
        caret_rows = [[r.source_tab, r.source_row, r.editor_raw, r.copy_name,
                       r.article_title, r.word_count] for r in caret]
        _write_csv(
            "caret_rows.csv",
            ["tab", "row", "editor", "copy_name", "title", "word_count"],
            caret_rows,
        )
        facts["caret_row_count"] = len(caret_rows)

        # ── unmapped tabs + article span + SF contract years ────────────────
        tab_span = {
            r.source_tab: (r.first, r.last, r.n)
            for r in session.execute(
                text(
                    "SELECT source_tab, MIN(month_year) first, MAX(month_year) last, "
                    "COUNT(DISTINCT article_uid) n FROM article_records GROUP BY 1"
                )
            )
        }
        sf_dates = _sf_contract_dates()
        unmapped_rows = []
        for v in sorted(cl["article_tabs_unmapped"].values(), key=lambda v: -v["articles"]):
            tab = v["tab"]
            first, last, n = tab_span.get(tab, (None, None, v["articles"]))
            sf = sf_dates.get(norm_key(tab).replace(" ", ""))
            sf_years = ""
            if sf:
                b = (sf["begin"] or "?")[:4]
                e = (sf["end"] or "?")[:4]
                sf_years = f"{b}–{e}" + (" (active)" if sf["active"] else "")
            unmapped_rows.append([
                tab, v["articles"], first or "", last or "",
                v.get("hub_client") or "", v["status"],
                "yes" if v["sf_exists"] else "no", sf_years, v.get("note", ""),
            ])
        _write_csv(
            "unmapped_client_tabs.csv",
            ["tab", "articles", "first_article_month", "last_article_month",
             "proposed_hub_client", "status", "in_salesforce", "sf_contract_years", "note"],
            unmapped_rows,
        )
        facts["unmapped_tabs"] = [
            {"tab": r[0], "articles": r[1], "span": f"{r[2]}…{r[3]}",
             "proposed": r[4], "sf_years": r[7]}
            for r in unmapped_rows
        ]

    # ── mapping CSVs ────────────────────────────────────────────────────────
    def _tabs_str(tabs: list[str]) -> str:
        return " · ".join(tabs) if tabs else ""

    ed_rows = []
    for v in sorted(ed["aliases"].values(), key=lambda v: (v["status"], -v.get("articles", 0))):
        ed_rows.append([
            v["raw"], v.get("canonical") or "", v["status"], v.get("articles", 0),
            ", ".join(v.get("candidates", [])) if v.get("candidates") else "",
            f"Monthly Article Count → EDITOR column in: {_tabs_str(ed_tabs.get(v['raw'], []))}",
            v.get("note", ""),
        ])
    _write_csv(
        "mappings_editors.csv",
        ["before_log_name", "after_hr_name", "status", "article_rows",
         "candidates", "where_to_validate", "note"],
        ed_rows,
    )

    wr_rows = []
    for v in sorted(wr["aliases"].values(), key=lambda v: (v["status"], -v.get("articles", 0))):
        wr_rows.append([
            v["raw"], v.get("canonical") or "", v["status"], v.get("articles", 0),
            ", ".join(v.get("candidates", [])) if v.get("candidates") else "",
            f"Monthly Article Count → WRITER column in: {_tabs_str(wr_tabs.get(v['raw'], []))}",
        ])
    _write_csv(
        "mappings_writers.csv",
        ["before_log_name", "after_full_name", "status", "article_rows",
         "candidates", "where_to_validate"],
        wr_rows,
    )

    cl_rows = []
    for v in cl["hub_to_salesforce"].values():
        cl_rows.append([
            v["hub_name"], v.get("sf_name") or "", v["status"],
            "Salesforce account name; SOW Overview client list", v.get("note", ""),
        ])
    _write_csv(
        "mappings_clients.csv",
        ["before_hub_name", "after_salesforce_name", "status", "where_to_validate", "note"],
        cl_rows,
    )

    # impact tallies
    facts["mapping_impact"] = {
        "editors": {
            "confirmed_rows": sum(v.get("articles", 0) for v in ed["aliases"].values()
                                  if v["status"] == "confirmed"),
            "total_rows": sum(v.get("articles", 0) for v in ed["aliases"].values()),
            "needs_decision": [v["raw"] for v in ed["aliases"].values()
                               if v["status"] in ("ambiguous", "unresolved")],
        },
        "writers": {
            "applied_renames": sum(1 for v in wr["aliases"].values()
                                   if v["status"] in ("confirmed", "confirmed_first_name")
                                   and v.get("canonical") and v["canonical"] != v["raw"]),
            "rows_full_named": sum(v.get("articles", 0) for v in wr["aliases"].values()
                                   if v["status"] in ("confirmed", "confirmed_first_name")),
            "rows_first_name_only": sum(v.get("articles", 0) for v in wr["aliases"].values()
                                        if v["status"] == "first_name_only"),
            "distinct_before": len(wr["aliases"]),
        },
        "clients": {
            "confirmed": sum(1 for v in cl["hub_to_salesforce"].values()
                             if v["status"] == "confirmed"),
            "needs_decision": sum(1 for v in cl["hub_to_salesforce"].values()
                                  if v["status"] != "confirmed"),
        },
    }

    with open(os.path.join(REPORTS_DIR, "REPORT_FACTS.json"), "w") as f:
        json.dump(facts, f, indent=2)

    print("Reports written to etl/reports/:")
    for fn in sorted(os.listdir(REPORTS_DIR)):
        print(f"  {fn}")
    print("\nMonth-basis verdict tally:", facts["month_basis_verdicts"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
