"""DaniQ-facing CSV reports — open-and-tick artifacts for validation.

Generates, in etl/reports/:
  month_basis_by_client.csv   per client × month: Operating Model vs log
                              (editorial month) vs log (calendar month) + verdict
  mappings_editors.csv        article-log editor → HR name, status, where to look
  mappings_writers.csv        article-log writer → full name, status, where to look
  mappings_clients.csv        Hub client → Salesforce name, status, where to look
  mappings_editors_by_month.csv   editor mapping × month: article rows that month
  mappings_writers_by_month.csv   writer mapping × month: article rows that month
  mappings_clients_by_month.csv   Hub client × month: article rows + distinct
                              articles that month (validate the tab→client mapping)
  unmapped_client_tabs.csv    article tabs with no Hub client + article-date span
                              + Salesforce contract years (explains D5)
  caret_rows.csv              the ^ / ^^ / ^^^ rows + the row above (for D3)
  pod_member_drift.csv        ET CP vs Team Pods member↔pod per month — slots
                              where the two sources disagree (move-timing)
  pod_member_drift_verdicts.csv  per-case review of the REAL transition months:
                              evidence (articles + HR dates) + verdict
  REPORT_FACTS.json           rolled-up numbers the markdown report embeds

The *_by_month CSVs are the per-month companions to the all-time mapping CSVs:
one row per (raw log name → resolved name × year × month), so DaniQ can open a
single month in the source sheet and tick the article counts against the
mapping. They're grouped over EVERY raw variant (folded variants like "Eric E."
→ "Eric Esposito" included), each paired with what it resolved to, so a wrong
fold is visible per month. Reconciliation (printed at the end) ties to the
article log itself: Σ dated monthly rows + undated rows == total log rows for
that name column. Undated rows are excluded (the known NULL-date DQ gap) — NOT
to the summary CSV, whose totals count by the resolved name, a different axis.

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


def _name_month_counts(
    session, raw_col: str, name_col: str
) -> dict[tuple[str, str], dict[tuple[int, int], dict]]:
    """{(raw_name, resolved_to): {(year, month): {"rows", "tabs"}}}.

    Grouped over EVERY raw value in the log — including folded variants ("Eric",
    "Eric E." → "Eric Esposito") that aren't top-level alias keys — paired with
    the canonical name each row resolved to, so a wrong fold is visible per
    month. Only rows with a parseable year+month (undated rows reported
    separately as the known NULL-date data-quality gap)."""
    rows = session.execute(
        text(
            f"SELECT {raw_col} AS raw, {name_col} AS resolved, year, month, source_tab, COUNT(*) c "
            f"FROM article_records "
            f"WHERE {raw_col} IS NOT NULL AND year IS NOT NULL AND month IS NOT NULL "
            f"GROUP BY 1,2,3,4,5"
        )
    )
    out: dict[tuple[str, str], dict[tuple[int, int], dict]] = defaultdict(
        lambda: defaultdict(lambda: {"rows": 0, "tabs": defaultdict(int)})
    )
    for r in rows:
        cell = out[(r.raw, r.resolved or "")][(r.year, r.month)]
        cell["rows"] += r.c
        cell["tabs"][r.source_tab] += r.c
    return out


def _undated(session, raw_col: str) -> int:
    """Log rows for this name column with no parseable submitted date."""
    return session.execute(
        text(
            f"SELECT COUNT(*) FROM article_records "
            f"WHERE {raw_col} IS NOT NULL AND (year IS NULL OR month IS NULL)"
        )
    ).scalar_one()


def _client_month_counts(session) -> dict[str, dict[tuple[int, int], dict]]:
    """{client_name: {(year, month): {"rows": int, "uids": int, "tabs": {...}}}}.

    Resolved Hub client × month — validates that each tab→client mapping
    captured the right monthly volume. `rows` = editor-credit rows, `uids` =
    distinct articles (collaborations counted once)."""
    rows = session.execute(
        text(
            "SELECT client_name AS nm, year, month, source_tab, "
            "COUNT(*) c, COUNT(DISTINCT article_uid) u "
            "FROM article_records "
            "WHERE client_name IS NOT NULL AND year IS NOT NULL AND month IS NOT NULL "
            "GROUP BY 1,2,3,4"
        )
    )
    out: dict[str, dict[tuple[int, int], dict]] = defaultdict(
        lambda: defaultdict(lambda: {"rows": 0, "uids": 0, "tabs": defaultdict(int)})
    )
    for r in rows:
        cell = out[r.nm][(r.year, r.month)]
        cell["rows"] += r.c
        cell["uids"] += r.u
        cell["tabs"][r.source_tab] += r.c
    return out


def _top_tabs(tabs: dict[str, int], n: int = 2) -> str:
    return " · ".join(t for t, _ in sorted(tabs.items(), key=lambda kv: -kv[1])[:n])


def _spans_by_raw(month_map) -> dict[str, tuple[str, str]]:
    """{raw_name: ('YYYY-MM' first, 'YYYY-MM' last)} across all resolved names."""
    spans: dict[str, tuple[tuple[int, int], tuple[int, int]]] = {}
    for (raw, _resolved), months in month_map.items():
        for ym in months:
            lo, hi = spans.get(raw, (ym, ym))
            spans[raw] = (min(lo, ym), max(hi, ym))
    return {
        raw: (f"{lo[0]}-{lo[1]:02d}", f"{hi[0]}-{hi[1]:02d}") for raw, (lo, hi) in spans.items()
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
            [
                "client",
                "year",
                "month",
                "operating_model_actual",
                "log_editorial_month",
                "log_calendar_month",
                "edit_minus_prod",
                "verdict",
            ],
            [
                [
                    r["client_name"],
                    r["year"],
                    MONTHS[r["month"]],
                    r["operating_model_actual"],
                    r["log_editorial_month"],
                    r["log_calendar_month"],
                    r["edit_minus_prod"],
                    r["verdict"],
                ]
                for r in mb
            ],
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
            {
                "month": MONTHS[m],
                "operating_model": v["prod"],
                "log_editorial": v["edit"],
                "log_calendar": v["cal"],
            }
            for (y, m), v in sorted(tot.items())
        ]
        facts["month_basis_verdicts"] = dict(sorted(verdicts.items(), key=lambda kv: -kv[1]))
        facts["miter_example"] = [
            {
                "month": MONTHS[r["month"]],
                "operating_model": r["operating_model_actual"],
                "log_editorial": r["log_editorial_month"],
                "log_calendar": r["log_calendar_month"],
            }
            for r in sorted(miter, key=lambda r: r["month"])
        ]

        # ── editor / writer origin tabs ─────────────────────────────────────
        ed_tabs = _origin_tabs(session, "editor_name")
        wr_tabs = _origin_tabs(session, "writer_name")

        # ── per-month splits (for the *_by_month mapping CSVs) ───────────────
        ed_month = _name_month_counts(session, "editor_raw", "editor_name")
        wr_month = _name_month_counts(session, "writer_raw", "writer_name")
        cl_month = _client_month_counts(session)
        ed_undated = _undated(session, "editor_raw")
        wr_undated = _undated(session, "writer_raw")

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
        caret_rows = [
            [r.source_tab, r.source_row, r.editor_raw, r.copy_name, r.article_title, r.word_count]
            for r in caret
        ]
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
            unmapped_rows.append(
                [
                    tab,
                    v["articles"],
                    first or "",
                    last or "",
                    v.get("hub_client") or "",
                    v["status"],
                    "yes" if v["sf_exists"] else "no",
                    sf_years,
                    v.get("note", ""),
                ]
            )
        _write_csv(
            "unmapped_client_tabs.csv",
            [
                "tab",
                "articles",
                "first_article_month",
                "last_article_month",
                "proposed_hub_client",
                "status",
                "in_salesforce",
                "sf_contract_years",
                "note",
            ],
            unmapped_rows,
        )
        facts["unmapped_tabs"] = [
            {
                "tab": r[0],
                "articles": r[1],
                "span": f"{r[2]}…{r[3]}",
                "proposed": r[4],
                "sf_years": r[7],
            }
            for r in unmapped_rows
        ]

        # ── pod member drift: ET CP vs Team Pods, per (month, pod) ──────────
        # ONE file, two layers: every differing slot, classified (coverage
        # window vs real transition), with evidence + verdict filled in for
        # the reviewed cases (2026-06-12 review; articles arbitrate — each
        # member's articles that month reveal which pod's clients they
        # actually worked, and client→pod agrees 100% between sources).
        from collections import defaultdict as _dd

        def _np(p):
            p = str(p or "").strip()
            return p if p.lower().startswith("pod") or not p.isdigit() else f"Pod {p}"

        def _ft(n):
            n = (n or "").strip().lower()
            return n.split()[0] if n and n not in ("-", "tbd", "?") else ""

        etcp_m: dict = _dd(set)
        for r in session.execute(
            text(
                "SELECT year, month, pod, member_breakdown, member_raw FROM editorial_member_capacity"
            )
        ):
            names = [
                b.get("name", "") for b in (r.member_breakdown or []) if isinstance(b, dict)
            ] or ([r.member_raw] if r.member_raw else [])
            for nme in names:
                t = _ft(nme)
                if t:
                    etcp_m[(r.year, r.month, _np(r.pod))].add(t)
        tp_m: dict = _dd(set)
        for r in session.execute(
            text(
                "SELECT DISTINCT year, month, pod_number, display_name FROM pod_assignment_history "
                "WHERE pod_kind='editorial' AND role IN ('pod_member','editor','senior_editor')"
            )
        ):
            t = _ft(r.display_name)
            if t:
                tp_m[(r.year, r.month, _np(r.pod_number))].add(t)

        # curated per-case review — keyed (year, month_num, member_first_token)
        VERDICTS = {
            (2025, 3, "kimberly"): (
                "joined 2025-03-17 (HR); Pod 2 ×4 articles",
                "ET CP ✓ — TP tab predates her join",
            ),
            (2025, 4, "katie"): ("joined 2025-04-14 (HR)", "ET CP ✓ — TP tab predates her join"),
            (2025, 4, "kimberly"): ("Pod 2 ×32 articles", "TP ✓ — ET CP moved her early/wrongly"),
            (2025, 5, "kimberly"): (
                "left 2025-05-09 (HR); Pod 4 ×6 articles",
                "ET CP ✓ — partial month before exit",
            ),
            (2025, 7, "lee"): ("joined 2025-07-21 (HR)", "ET CP ✓ — TP tab predates the join"),
            (2025, 7, "robert"): ("joined 2025-07-21 (HR)", "ET CP ✓ — TP tab predates the join"),
            (2025, 8, "anabelle"): (
                "Pod 2 ×17 + Pod 3 ×11 articles; left 2025-08-22",
                "ET CP ✓ — real multi-pod coverage",
            ),
            (2025, 8, "katie"): ("Pod 1 ×29, Pod 4 ×1 articles", "mostly TP ✓ — ET CP overspread"),
            (2025, 8, "maggie"): (
                "Pod 4 ×13 + Pod 3 ×12 articles",
                "ET CP ✓ — she really covered 3+4",
            ),
            (2025, 8, "haley"): ("joined 2025-08-18 (HR)", "ET CP ✓ — TP tab predates the join"),
            (2025, 8, "micki"): ("joined 2025-08-18 (HR)", "ET CP ✓ — TP tab predates the join"),
            (2025, 9, "derrik"): (
                "left 2025-09-02 (HR); his articles were Pod 3",
                "ET CP ✓ — TP stale AND wrong pod",
            ),
            (2025, 9, "chrissy"): ("no articles", "open — placeholder slot?"),
            (2025, 9, "lee"): ("Pod 3 ×46, Pod 1 ×3 articles", "ET CP ✓ — Pod 1 was minor help"),
            (2026, 1, "jimmy"): (
                "Pod 2 ×24, Pod 1 ×9 articles; Pod 5 unsupported",
                "split month — both partial",
            ),
            (2026, 1, "robert"): ("Pod 1 ×32, Pod 5 ×2 articles", "TP ✓ — Pod 5 help was real"),
            (2026, 2, "tiffany"): ("Pod 2 ×14 + Pod 4 ×10 articles", "TP ✓ — true straddle month"),
            (2026, 3, "abby"): ("left 2026-03-06 (HR)", "TP ✓ — ET CP slot not cleared"),
            (2026, 4, "jimmy"): ("Pod 1 ×30, Pod 2 ×2 articles", "ET CP ✓ — TP stale"),
            (2026, 6, "nina"): ("no articles yet (month in progress)", "open"),
            (2026, 6, "anabelle"): (
                "terminated 2025-08-22 per Rippling, yet 3 Jun-2026 articles",
                "🚩 DQ flag — freelance return or HR not updated; confirm with Dani",
            ),
        }
        _JUNK_TOKENS = {"new", "pod", "support", "hiring"}
        max_tp = max(((y, m) for (y, m, _p) in tp_m), default=(0, 0))
        min_etcp = min(((y, m) for (y, m, _p) in etcp_m), default=(9999, 99))

        drift_rows = []
        common = sorted(set(etcp_m) | set(tp_m))
        slots_compared = len(set(etcp_m) & set(tp_m))
        identical = sum(1 for k in set(etcp_m) & set(tp_m) if etcp_m[k] == tp_m[k])
        for y, m, pod in common:
            a, b = etcp_m.get((y, m, pod), set()), tp_m.get((y, m, pod), set())
            if a == b:
                continue
            only_e, only_t = sorted(a - b), sorted(b - a)
            toks = set(only_e) | set(only_t)
            if (y, m) > max_tp:
                cls = "coverage — ET CP future projection (no Team Pods tab yet)"
            elif (y, m) < min_etcp:
                cls = "coverage — before ET CP member data (articles corroborate Team Pods)"
            elif toks <= _JUNK_TOKENS or all("@" in t or t in _JUNK_TOKENS for t in toks):
                cls = "junk token / placeholder"
            else:
                cls = "transition"
            ev, vd = [], []
            for t in sorted(toks):
                hit = VERDICTS.get((y, m, t))
                if hit:
                    ev.append(f"{t}: {hit[0]}")
                    vd.append(f"{t}: {hit[1]}")
            drift_rows.append(
                [
                    y,
                    MONTHS[m],
                    pod,
                    ", ".join(only_e) or "—",
                    ", ".join(only_t) or "—",
                    ", ".join(sorted(a & b)),
                    cls,
                    " | ".join(ev),
                    " | ".join(vd),
                ]
            )
        _write_csv(
            "pod_member_drift.csv",
            [
                "year",
                "month",
                "pod",
                "only_in_ET_CP",
                "only_in_Team_Pods",
                "in_both",
                "classification",
                "evidence",
                "verdict",
            ],
            drift_rows,
        )
        facts["pod_member_drift"] = {
            "slots_compared": slots_compared,
            "identical": identical,
            "rows": len(drift_rows),
            "transition_cases_reviewed": len(VERDICTS),
        }

    # ── mapping CSVs ────────────────────────────────────────────────────────
    def _tabs_str(tabs: list[str]) -> str:
        return " · ".join(tabs) if tabs else ""

    ed_spans = _spans_by_raw(ed_month)
    ed_rows = []
    for v in sorted(ed["aliases"].values(), key=lambda v: (v["status"], -v.get("articles", 0))):
        span = ed_spans.get(v["raw"], ("", ""))
        ed_rows.append(
            [
                v["raw"],
                v.get("canonical") or "",
                v["status"],
                v.get("articles", 0),
                span[0],
                span[1],
                ", ".join(v.get("candidates", [])) if v.get("candidates") else "",
                f"Monthly Article Count → EDITOR column in: {_tabs_str(ed_tabs.get(v['raw'], []))}",
                v.get("note", ""),
            ]
        )
    _write_csv(
        "mappings_editors.csv",
        [
            "before_log_name",
            "after_hr_name",
            "status",
            "article_rows",
            "first_month",
            "last_month",
            "candidates",
            "where_to_validate",
            "note",
        ],
        ed_rows,
    )

    wr_spans = _spans_by_raw(wr_month)
    wr_rows = []
    for v in sorted(wr["aliases"].values(), key=lambda v: (v["status"], -v.get("articles", 0))):
        span = wr_spans.get(v["raw"], ("", ""))
        wr_rows.append(
            [
                v["raw"],
                v.get("canonical") or "",
                v["status"],
                v.get("articles", 0),
                span[0],
                span[1],
                ", ".join(v.get("candidates", [])) if v.get("candidates") else "",
                f"Monthly Article Count → WRITER column in: {_tabs_str(wr_tabs.get(v['raw'], []))}",
            ]
        )
    _write_csv(
        "mappings_writers.csv",
        [
            "before_log_name",
            "after_full_name",
            "status",
            "article_rows",
            "first_month",
            "last_month",
            "candidates",
            "where_to_validate",
        ],
        wr_rows,
    )

    cl_spans: dict[str, tuple[str, str]] = {}
    for client, months in cl_month.items():
        yms = sorted(months)
        cl_spans[client] = (f"{yms[0][0]}-{yms[0][1]:02d}", f"{yms[-1][0]}-{yms[-1][1]:02d}")
    cl_rows = []
    for v in cl["hub_to_salesforce"].values():
        span = cl_spans.get(v["hub_name"], ("", ""))
        cl_rows.append(
            [
                v["hub_name"],
                v.get("sf_name") or "",
                v["status"],
                span[0],
                span[1],
                "Salesforce account name; SOW Overview client list",
                v.get("note", ""),
            ]
        )
    _write_csv(
        "mappings_clients.csv",
        [
            "before_hub_name",
            "after_salesforce_name",
            "status",
            "first_article_month",
            "last_article_month",
            "where_to_validate",
            "note",
        ],
        cl_rows,
    )

    # ── per-month mapping CSVs ───────────────────────────────────────────────
    # one row per (raw name → resolved name × year × month) — the per-month
    # companions to the all-time mapping CSVs above. Grouped over EVERY raw
    # variant in the log (folded variants included), each paired with the name
    # it resolved to + the alias status, so a wrong fold shows up per month.
    # Clients are grouped by resolved Hub client and joined to the Hub→SF map.
    def _by_month_rows(month_map, status_by_raw) -> list[list]:
        out = []
        for raw, resolved in sorted(month_map):
            status = status_by_raw.get(raw, "folded_variant")
            for (y, m), cell in sorted(month_map[(raw, resolved)].items()):
                out.append(
                    [raw, resolved, status, y, MONTHS[m], cell["rows"], _top_tabs(cell["tabs"])]
                )
        return out

    ed_status = {v["raw"]: v["status"] for v in ed["aliases"].values()}
    wr_status = {v["raw"]: v["status"] for v in wr["aliases"].values()}
    ed_month_rows = _by_month_rows(ed_month, ed_status)
    wr_month_rows = _by_month_rows(wr_month, wr_status)
    _write_csv(
        "mappings_editors_by_month.csv",
        [
            "raw_log_name",
            "resolved_to",
            "status",
            "year",
            "month",
            "article_rows",
            "where_to_validate_tabs",
        ],
        ed_month_rows,
    )
    _write_csv(
        "mappings_writers_by_month.csv",
        [
            "raw_log_name",
            "resolved_to",
            "status",
            "year",
            "month",
            "article_rows",
            "where_to_validate_tabs",
        ],
        wr_month_rows,
    )

    cl_sf = {v["hub_name"]: v for v in cl["hub_to_salesforce"].values()}
    cl_month_rows = []
    for client in sorted(cl_month):
        sf = cl_sf.get(client, {})
        for (y, m), cell in sorted(cl_month[client].items()):
            cl_month_rows.append(
                [
                    client,
                    sf.get("sf_name") or "",
                    sf.get("status") or "not_in_mapping",
                    y,
                    MONTHS[m],
                    cell["uids"],
                    cell["rows"],
                    _top_tabs(cell["tabs"]),
                ]
            )
    _write_csv(
        "mappings_clients_by_month.csv",
        [
            "hub_client",
            "salesforce_name",
            "status",
            "year",
            "month",
            "distinct_articles",
            "editor_credit_rows",
            "source_tabs",
        ],
        cl_month_rows,
    )

    # reconciliation: per-month dated rows + undated gap == total log rows for
    # that column (the source of truth — NOT the summary's resolved-name count).
    def _recon(month_map, undated: int) -> dict:
        dated = sum(c["rows"] for mm in month_map.values() for c in mm.values())
        return {
            "dated_rows": dated,
            "undated_rows": undated,
            "total_log_rows": dated + undated,
            "distinct_raw_to_resolved": len(month_map),
        }

    facts["mapping_by_month"] = {
        "editors": {**_recon(ed_month, ed_undated), "csv_rows": len(ed_month_rows)},
        "writers": {**_recon(wr_month, wr_undated), "csv_rows": len(wr_month_rows)},
        "clients": {
            "csv_rows": len(cl_month_rows),
            "clients": len(cl_month),
            "dated_articles": sum(c["uids"] for mm in cl_month.values() for c in mm.values()),
        },
    }

    # impact tallies
    facts["mapping_impact"] = {
        "editors": {
            "confirmed_rows": sum(
                v.get("articles", 0) for v in ed["aliases"].values() if v["status"] == "confirmed"
            ),
            "total_rows": sum(v.get("articles", 0) for v in ed["aliases"].values()),
            "needs_decision": [
                v["raw"]
                for v in ed["aliases"].values()
                if v["status"] in ("ambiguous", "unresolved")
            ],
        },
        "writers": {
            "applied_renames": sum(
                1
                for v in wr["aliases"].values()
                if v["status"] in ("confirmed", "confirmed_first_name")
                and v.get("canonical")
                and v["canonical"] != v["raw"]
            ),
            "rows_full_named": sum(
                v.get("articles", 0)
                for v in wr["aliases"].values()
                if v["status"] in ("confirmed", "confirmed_first_name")
            ),
            "rows_first_name_only": sum(
                v.get("articles", 0)
                for v in wr["aliases"].values()
                if v["status"] == "first_name_only"
            ),
            "distinct_before": len(wr["aliases"]),
        },
        "clients": {
            "confirmed": sum(
                1 for v in cl["hub_to_salesforce"].values() if v["status"] == "confirmed"
            ),
            "needs_decision": sum(
                1 for v in cl["hub_to_salesforce"].values() if v["status"] != "confirmed"
            ),
        },
    }

    with open(os.path.join(REPORTS_DIR, "REPORT_FACTS.json"), "w") as f:
        json.dump(facts, f, indent=2)

    print("Reports written to etl/reports/:")
    for fn in sorted(os.listdir(REPORTS_DIR)):
        print(f"  {fn}")
    print("\nMonth-basis verdict tally:", facts["month_basis_verdicts"])
    bm = facts["mapping_by_month"]
    for k in ("editors", "writers"):
        r = bm[k]
        print(
            f"\nmappings_{k}_by_month.csv: {r['csv_rows']} rows · "
            f"{r['dated_rows']} dated + {r['undated_rows']} undated "
            f"= {r['total_log_rows']} log rows (undated excluded — NULL-date DQ gap)"
        )
    c = bm["clients"]
    print(
        f"mappings_clients_by_month.csv: {c['csv_rows']} rows over {c['clients']} clients "
        f"({c['dated_articles']} distinct dated articles)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
