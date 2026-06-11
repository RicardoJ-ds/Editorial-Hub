"""Endpoint-level parity — every repointed dashboard endpoint, Postgres vs BQ.

Hits each endpoint TWICE on the same running server (X-Data-Source: postgres |
bq) across a realistic parameter matrix and diffs the JSON. List responses are
compared as multisets (order-insensitive — within-tie ordering is unspecified
in Postgres itself) PLUS an order check for the endpoints where on-screen order
matters (flags/rewrites/by-client/by-writer/editors).

    docker compose exec -T backend python -m etl.warehouse.endpoint_parity

Writes etl/PARITY_REPORT_ENDPOINTS.md.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

API = os.environ.get("ETL_PARITY_API", "http://localhost:8000")
EMAIL = "ricardo.jaramillo@graphitehq.com"

# (name, path, ordered_field) — ordered_field: compare the sequence of that
# field too (on-screen ordering matters there).
CASES: list[tuple[str, str, str | None]] = [
    ("clients", "/api/clients/?limit=500", None),
    ("clients+status", "/api/clients/?limit=500&status=ACTIVE", None),
    ("clients+pod", "/api/clients/?limit=500&editorial_pod=Pod%201", None),
    ("clients+search", "/api/clients/?limit=500&search=meta", None),
    ("deliverables p1", "/api/deliverables/?limit=1000&skip=0", None),
    ("goals all", "/api/goals-delivery/all", None),
    ("goals all+pod", "/api/goals-delivery/all?pod=Pod%201", None),
    ("cumulative", "/api/goals-delivery/cumulative", None),
    ("kpis range", "/api/kpis/?limit=5000&year_from=2025&month_from=8&year_to=2027&month_to=5", None),
    ("team-members", "/api/team-members/?limit=200", None),
    ("editorial-weeks", "/api/migrate/editorial-weeks", None),
    ("production-trend", "/api/dashboard/production-trend", None),
    ("client-production", "/api/dashboard/client-production", None),
    ("pacing", "/api/dashboard/pacing", None),
    ("capacity pod-summary", "/api/capacity/pod-summary", None),
    ("member-util 2026-05", "/api/capacity/member-utilization?year=2026&month=5", None),
    ("member-util 2026-03", "/api/capacity/member-utilization?year=2026&month=3", None),
    ("member-util 2025-12", "/api/capacity/member-utilization?year=2025&month=12", None),
    ("member-util-matrix", "/api/capacity/member-utilization-matrix", None),
    ("client-contrib 2026-05", "/api/capacity/client-contributions?year=2026&month=5", None),
    ("client-contrib 2026-04", "/api/capacity/client-contributions?year=2026&month=4", None),
    ("articles editorial", "/api/articles/monthly?pod_axis=editorial", None),
    ("articles growth", "/api/articles/monthly?pod_axis=growth", None),
    ("articles pod1", "/api/articles/monthly?pod_axis=editorial&pod=Pod%201", None),
    ("articles unassigned", "/api/articles/monthly?pod_axis=editorial&pod=Unassigned", None),
    ("articles window", "/api/articles/monthly?pod_axis=editorial&date_from=2026-01&date_to=2026-05", None),
    ("articles client", "/api/articles/monthly?pod_axis=editorial&clients=Miter", None),
    ("articles editors-filter", "/api/articles/monthly?pod_axis=editorial&editors=Jimmy%20Bunes,Robert%20Thorpe", None),
    ("articles editors-list", "/api/articles/editors", "name"),
    ("ai summary", "/api/ai-monitoring/summary", None),
    ("ai by-pod", "/api/ai-monitoring/by-pod", None),
    ("ai by-client", "/api/ai-monitoring/by-client?limit=20", "name"),
    ("ai by-writer", "/api/ai-monitoring/by-writer?limit=20", "name"),
    ("ai by-month", "/api/ai-monitoring/by-month", "name"),
    ("ai flags", "/api/ai-monitoring/flags?limit=50", "id"),
    ("ai rewrites", "/api/ai-monitoring/rewrites?limit=50", "id"),
    ("ai surfer", "/api/ai-monitoring/surfer-usage", "id"),
]


def fetch(path: str, source: str):
    req = urllib.request.Request(
        f"{API}{path}",
        headers={"X-User-Email": EMAIL, "X-Data-Source": source},
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read())


def canon(x):
    """Canonical hashable form of one row/value for multiset comparison."""
    return json.dumps(x, sort_keys=True, default=str)


def diff_payload(pg, bq):
    """Returns (match, detail) — multiset compare for lists, deep for dicts."""
    if isinstance(pg, list) and isinstance(bq, list):
        if len(pg) != len(bq):
            return False, [f"row count: pg={len(pg)} bq={len(bq)}"]
        a = sorted(canon(r) for r in pg)
        b = sorted(canon(r) for r in bq)
        if a == b:
            return True, []
        only_pg = [x for x in a if x not in set(b)][:3]
        only_bq = [x for x in b if x not in set(a)][:3]
        # field-level hint from the first differing pair
        hints = []
        for pa, pb in zip(only_pg, only_bq):
            da, db_ = json.loads(pa), json.loads(pb)
            if isinstance(da, dict) and isinstance(db_, dict):
                for k in sorted(set(da) | set(db_)):
                    if da.get(k) != db_.get(k):
                        hints.append(f"  field {k}: pg={da.get(k)!r} bq={db_.get(k)!r}")
        return False, [f"only_pg: {x[:220]}" for x in only_pg] + \
                      [f"only_bq: {x[:220]}" for x in only_bq] + hints[:8]
    if isinstance(pg, dict) and isinstance(bq, dict):
        diffs = []
        for k in sorted(set(pg) | set(bq)):
            m, d = diff_payload(pg.get(k), bq.get(k)) if isinstance(pg.get(k), (list, dict)) \
                else (pg.get(k) == bq.get(k), [f"{k}: pg={pg.get(k)!r} bq={bq.get(k)!r}"])
            if not m:
                diffs += [f"[{k}] {x}" for x in (d or [f"{k} differs"])]
        return not diffs, diffs[:10]
    return pg == bq, [] if pg == bq else [f"pg={pg!r} bq={bq!r}"]


def order_check(pg, bq, field):
    seq_pg = [r.get(field) for r in pg] if isinstance(pg, list) else []
    seq_bq = [r.get(field) for r in bq] if isinstance(bq, list) else []
    return seq_pg == seq_bq


def main() -> int:
    results = []
    for name, path, ordered in CASES:
        try:
            pg = fetch(path, "postgres")
            bqr = fetch(path, "bq")
            match, detail = diff_payload(pg, bqr)
            omatch = order_check(pg, bqr, ordered) if ordered and match else True
            results.append({"name": name, "path": path, "match": match,
                            "order_ok": omatch, "detail": detail})
        except Exception as exc:
            results.append({"name": name, "path": path, "match": False,
                            "order_ok": False, "detail": [f"EXCEPTION: {exc}"]})
        r = results[-1]
        flag = "OK " if r["match"] and r["order_ok"] else "DIFF"
        print(f"{flag} {name}")
    all_ok = all(r["match"] and r["order_ok"] for r in results)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "# Endpoint parity — Postgres vs BigQuery warehouse",
        "",
        f"_Generated {now}. Same server, same request, two X-Data-Source values;",
        "JSON diffed (lists as multisets; on-screen-ordered endpoints also",
        "order-checked)._",
        "",
        f"## Verdict: {'✅ ALL ENDPOINTS IDENTICAL' if all_ok else '❌ DIFFERENCES'}",
        "",
        "| Endpoint case | Result |",
        "|---|---|",
    ]
    for r in results:
        v = "✅" if r["match"] and r["order_ok"] else ("⚠️ order" if r["match"] else "❌")
        lines.append(f"| {r['name']} (`{r['path']}`) | {v} |")
    bad = [r for r in results if not (r["match"] and r["order_ok"])]
    if bad:
        lines += ["", "## Differences", "```"]
        for r in bad:
            lines.append(f"--- {r['name']}")
            lines.extend(r["detail"])
        lines.append("```")
    out = os.path.join(os.path.dirname(os.path.dirname(__file__)), "PARITY_REPORT_ENDPOINTS.md")
    with open(out, "w") as f:
        f.write("\n".join(lines))
    print(f"\n→ {out}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
