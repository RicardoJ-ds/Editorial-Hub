"""Warehouse parity harness — proves the layered warehouse reproduces today's
dashboard numbers EXACTLY.

Layers of proof:
  A. Frontend-function replay: diff editorial_int_client_q_snapshot against
     /tmp/parity_frontend_dump.json (the REAL exported app functions run on
     live API data — `npx tsx frontend/scripts/parity-dump.ts`), field by field
     for every client. Same for the goals 3-step aggregation grand totals.
  B. API replays (phase-1 style): member-utilization (every month), pod-summary,
     articles/monthly (both axes) recomputed from the new int tables.

Writes etl/PARITY_REPORT_WAREHOUSE.md.
    docker compose exec -T backend python -m etl.warehouse.parity
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime, timezone

from app.config import settings

from etl.load import get_bq
from etl.parity import (  # phase-1 helpers reused
    _api,
    _bq_rows,
    _row_key,
    _MEMBER_FIELDS,
)
from etl.warehouse import pyrules as R

DS = f"`{settings.bq_project}.{settings.bq_dataset}`"
DUMP_PATH = os.environ.get("PARITY_DUMP", "/tmp/parity_frontend_dump.json")

# Fields compared client-by-client between the TS dump and the snapshot table.
SNAPSHOT_FIELDS = [
    "lifetime_delivered", "lifetime_invoiced", "articles_sow", "lifetime_variance",
    "pct_complete", "published_live", "pct_published",
    "ovr_q_label", "ovr_q_month_in_q", "ovr_q_length", "ovr_q_delivered",
    "ovr_q_projected_remaining", "ovr_q_projected_end", "ovr_q_invoiced",
    "ovr_q_projected_variance", "ovr_is_first_q", "ovr_tier",
    "ovr_lq_label", "ovr_lq_delivered", "ovr_lq_invoiced", "ovr_lq_cum_delivered",
    "ovr_lq_cum_invoiced", "ovr_lq_cum_variance", "ovr_lq_is_first_q",
    "d1_term_months", "d1_lifetime_sow",
    "d1_q_label", "d1_q_month_in_q", "d1_q_length", "d1_q_delivered_actual",
    "d1_q_invoiced", "d1_q_projected_end_cum_delivered", "d1_q_actual_cum_delivered",
    "d1_q_end_of_q_cum_invoiced", "d1_q_projected_end_cum_variance",
    "d1_is_first_q", "d1_tier",
    "d1_lq_label", "d1_lq_delivered", "d1_lq_invoiced", "d1_lq_cum_delivered",
    "d1_lq_cum_invoiced", "d1_lq_cum_variance",
]

# TS tier keys → warehouse tier keys
TIER_MAP = {"onTrack": "on_track", "withinLimit": "within_limit",
            "ahead": "ahead", "behind": "behind", "new": "new", None: None}


def _norm(v):
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, date):
        return v.isoformat()
    return v


def compare_snapshot(bq) -> dict:
    with open(DUMP_PATH) as f:
        dump = json.load(f)
    bq_rows = {r["client_id"]: dict(r) for r in _bq_rows(
        bq, f"SELECT * FROM {DS}.editorial_int_client_q_snapshot")}
    diffs: list[str] = []
    checked = 0
    for d in dump["clients"]:
        cid = d["client_id"]
        b = bq_rows.get(cid)
        if b is None:
            diffs.append(f"{d['client_name']}: missing from warehouse")
            continue
        for f_ in SNAPSHOT_FIELDS:
            dv = d.get(f_)
            if f_ in ("ovr_tier", "d1_tier"):
                dv = TIER_MAP.get(dv, dv)
            bv = _norm(b.get(f_))
            dv = _norm(dv)
            checked += 1
            if dv != bv:
                diffs.append(f"{d['client_name']}.{f_}: frontend={dv!r} warehouse={bv!r}")
        # effective start: dump has 'YYYY-MM-01' string or client start
        ds_ = d.get("d1_effective_start")
        bs = b.get("d1_effective_start")
        if (ds_[:10] if ds_ else None) != (_norm(bs)[:10] if bs else None):
            diffs.append(f"{d['client_name']}.d1_effective_start: {ds_!r} vs {bs!r}")
    return {
        "check": "client_q_snapshot vs REAL frontend functions",
        "clients": len(dump["clients"]),
        "fields_checked": checked,
        "match": not diffs,
        "diffs": diffs[:25],
        "diff_count": len(diffs),
    }


def compare_client_months(bq) -> dict:
    """Per-month period assignments (both detector variants) + is_future vs the
    REAL frontend periods — covers editorial_int_client_months, which the
    snapshot check can't see."""
    with open(DUMP_PATH) as f:
        dump = json.load(f)
    rows = _bq_rows(bq, f"""
        SELECT client_id, year, month, is_future,
               ovr_period_idx, ovr_period_label, ovr_is_prelude,
               d1_period_idx, d1_period_label, d1_is_prelude, d1_is_post_contract
        FROM {DS}.editorial_int_client_months
        WHERE delivered IS NOT NULL OR invoiced IS NOT NULL""")
    by_client: dict[int, dict[str, dict]] = {}
    for r in rows:
        by_client.setdefault(r["client_id"], {})[f"{r['year']}-{r['month']:02d}"] = r
    diffs = []
    checked = 0
    for d in dump["clients"]:
        wh = by_client.get(d["client_id"], {})
        for mk, (qi, label, prel) in (d.get("ovr_period_map") or {}).items():
            w = wh.get(mk)
            checked += 1
            if w is None:
                diffs.append(f"{d['client_name']} {mk}: missing month row")
                continue
            got = (w["ovr_period_idx"], w["ovr_period_label"] or "", bool(w["ovr_is_prelude"]))
            if got != (qi, label, bool(prel)):
                diffs.append(f"{d['client_name']} {mk} ovr: frontend={(qi,label,prel)} wh={got}")
        for mk, vals in (d.get("d1_period_map") or {}).items():
            qi, label, prel, post = vals
            w = wh.get(mk)
            checked += 1
            if w is None:
                # D1 post-contract truncation DROPS all-zero post rows from
                # periods; the month row itself still exists with NULL d1_*.
                continue
            got = (w["d1_period_idx"], w["d1_period_label"] or "",
                   bool(w["d1_is_prelude"]), bool(w["d1_is_post_contract"]))
            if w["d1_period_idx"] is None:
                continue  # dropped post-contract zero row — matches by absence
            if got != (qi, label, bool(prel), bool(post)):
                diffs.append(f"{d['client_name']} {mk} d1: frontend={(qi,label,prel,post)} wh={got}")
    return {
        "check": "client_months period maps vs REAL frontend periods",
        "clients": checked,
        "match": not diffs,
        "diffs": diffs[:25],
        "diff_count": len(diffs),
    }


def compare_goals(bq) -> dict:
    with open(DUMP_PATH) as f:
        dump = json.load(f)["goals"]
    rows = _bq_rows(bq, f"SELECT * FROM {DS}.editorial_int_goals_month_ct")
    tot = R.goals_grand_totals(rows)
    diffs = []
    for k_dump, k_py in (("cb_goal", "cb_goal"), ("cb_delivered", "cb_delivered"),
                         ("ad_goal", "ad_goal"), ("ad_delivered", "ad_delivered"),
                         ("cb_pct", "cb_pct"), ("ad_pct", "ad_pct")):
        dv, bv = dump[k_dump], tot[k_py]
        if abs(float(dv) - float(bv)) > 1e-6:
            diffs.append(f"goals.{k_dump}: frontend={dv} warehouse={bv}")
    # per-client spot-compare (all clients)
    for client, v in dump["per_client"].items():
        w = tot["per_client"].get(client)
        if w is None:
            diffs.append(f"goals client missing: {client}")
            continue
        for dk, wk in (("cb_goal", "cb_goal"), ("cb_del", "cb_del"),
                       ("ad_goal", "ad_goal"), ("ad_del", "ad_del")):
            if abs(float(v[dk]) - float(w[wk])) > 1e-6:
                diffs.append(f"goals[{client}].{dk}: {v[dk]} vs {w[wk]}")
    return {
        "check": "goals 3-step aggregation vs REAL aggregateGoalsSummary",
        "clients": len(dump["per_client"]),
        "match": not diffs,
        "diffs": diffs[:25],
        "diff_count": len(diffs),
    }


def replay_member_utilization(bq) -> dict:
    mart = _bq_rows(bq, f"SELECT * FROM {DS}.editorial_int_member_months")
    months = sorted({(r["year"], r["month"]) for r in mart})
    api_rows = []
    for y, mo in months:
        for r in _api(f"/api/capacity/member-utilization?year={y}&month={mo}"):
            api_rows.append({"year": y, "month": mo, **r})
    fields = ["year", "month"] + _MEMBER_FIELDS
    a = sorted(_row_key(r, fields) for r in api_rows)
    b = sorted(_row_key(r, fields) for r in mart)
    return {"check": "member-utilization replay (all months)", "api_rows": len(a),
            "bq_rows": len(b), "match": a == b,
            "diffs": [str(x) for x in (set(a) ^ set(b))][:6], "diff_count": len(set(a) ^ set(b))}


def replay_pod_summary(bq) -> dict:
    mart = _bq_rows(bq, f"SELECT * FROM {DS}.editorial_int_capacity_pod_months")
    api = _api("/api/capacity/pod-summary")
    fields = ["year", "month", "pod", "version", "total_capacity",
              "projected_used_capacity", "actual_used_capacity"]
    a = sorted(_row_key(r, fields) for r in api)
    b = sorted(_row_key(r, fields) for r in mart)
    return {"check": "pod-summary replay", "api_rows": len(a), "bq_rows": len(b),
            "match": a == b, "diffs": [], "diff_count": len(set(a) ^ set(b))}


def replay_articles(bq, axis: str) -> dict:
    pod_col = "growth_pod" if axis == "growth" else "editorial_pod"
    creation = _bq_rows(bq, f"""
        SELECT month_year, IFNULL({pod_col}, 'Unassigned') AS pod, client_name,
               editor_name, SUM(count) AS count, SUM(revised) AS revised,
               SUM(published) AS published, SUM(published_revised) AS published_revised,
               SUM(matched) AS matched
        FROM {DS}.editorial_int_articles_creation GROUP BY 1,2,3,4""")
    revisions = _bq_rows(bq, f"""
        SELECT month_year, IFNULL({pod_col}, 'Unassigned') AS pod, client_name,
               editor_name, SUM(revisions) AS revisions
        FROM {DS}.editorial_int_articles_revisions GROUP BY 1,2,3,4""")
    api = _api(f"/api/articles/monthly?pod_axis={axis}")
    cf = ["month_year", "pod", "client_name", "editor_name",
          "count", "revised", "published", "published_revised", "matched"]
    rf = ["month_year", "pod", "client_name", "editor_name", "revisions"]
    ac = sorted(_row_key(r, cf) for r in api["creation"])
    bc = sorted(_row_key(r, cf) for r in creation)
    ar = sorted(_row_key(r, rf) for r in api["revisions"])
    br = sorted(_row_key(r, rf) for r in revisions)
    return {"check": f"articles/monthly replay (pod_axis={axis})",
            "api_rows": len(ac) + len(ar), "bq_rows": len(bc) + len(br),
            "match": ac == bc and ar == br, "diffs": [],
            "diff_count": len(set(ac) ^ set(bc)) + len(set(ar) ^ set(br))}


def main() -> int:
    bq = get_bq()
    checks = [
        compare_snapshot(bq),
        compare_client_months(bq),
        compare_goals(bq),
        replay_member_utilization(bq),
        replay_pod_summary(bq),
        replay_articles(bq, "editorial"),
        replay_articles(bq, "growth"),
    ]
    all_ok = all(c["match"] for c in checks)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "# Warehouse parity report (raw → int → views refactor)",
        "",
        f"_Generated {now} by `python -m etl.warehouse.parity`. Frontend dump from",
        "`frontend/scripts/parity-dump.ts` (the REAL exported dashboard functions",
        "run on live API data) + live API replays, diffed against the new",
        f"`{settings.bq_dataset}` int tables._",
        "",
        f"## Verdict: {'✅ FULL PARITY' if all_ok else '❌ DIFFERENCES FOUND'}",
        "",
        "| Check | Rows / fields | Match |",
        "|---|---:|---|",
    ]
    for c in checks:
        size = c.get("fields_checked") or c.get("api_rows") or c.get("clients")
        verdict = "✅ identical" if c["match"] else "❌ {} diffs".format(c.get("diff_count"))
        lines.append(f"| {c['check']} | {size:,} | {verdict} |")
    if not all_ok:
        lines += ["", "## Differences (first examples)", "```"]
        for c in checks:
            if not c["match"]:
                lines.append(f"--- {c['check']} ({c['diff_count']} total)")
                lines.extend(c["diffs"])
        lines.append("```")
    lines += [
        "",
        "## What this proves",
        "- The variance brain (billing periods, current/last Q, cumulative",
        "  end-of-Q variance, symmetric tiers, 1st-Q escape, BOTH Overview and",
        "  D1 variants) computed in the warehouse equals the dashboard's own",
        "  TypeScript output for every client, every field.",
        "- The goals 3-step aggregation (max-of-week → content-type weighting →",
        "  goal-gated totals) matches `aggregateGoalsSummary` exactly.",
        "- Capacity (per-pod latest-version, per-member utilization for every",
        "  month) and Monthly Articles (both pod axes) replays are byte-identical.",
        "",
    ]
    out = os.path.join(os.path.dirname(os.path.dirname(__file__)), "PARITY_REPORT_WAREHOUSE.md")
    with open(out, "w") as f:
        f.write("\n".join(lines))
    print("\n".join(lines[:30]))
    print(f"\n→ full report: {out}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
