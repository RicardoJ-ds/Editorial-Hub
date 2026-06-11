"""ETL orchestrator — ingest (optional) → transform → load to BigQuery.

Usage (inside the backend container):
    python -m etl.run                       # publish-only: Postgres → BQ
    python -m etl.run --scope current       # SYNC-equivalent ingest, then publish
    python -m etl.run --scope full          # SYNC + Re-sync Past Months, then publish
    python -m etl.run --tables editorial_articles,editorial_clients
    python -m etl.run --skip-marts --skip-mappings

Ingest reuses the app's sync manifest steps verbatim (same code path as the
SYNC button), so sheet-parsing behavior is identical by construction. Publish
then lands every dashboard-feeding table + the capacity/articles marts + the
name-mapping review tables in `graphite_bi_sandbox.editorial_*`.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("etl.run")

MART_SCHEMAS: dict[str, list[tuple[str, str]]] = {
    "editorial_capacity_pod": [
        ("year", "INTEGER"), ("month", "INTEGER"), ("pod", "STRING"),
        ("version", "STRING"), ("total_capacity", "INTEGER"),
        ("projected_used_capacity", "INTEGER"), ("actual_used_capacity", "INTEGER"),
    ],
    "editorial_capacity_member_utilization": [
        ("year", "INTEGER"), ("month", "INTEGER"), ("pod", "STRING"),
        ("role", "STRING"), ("member", "STRING"),
        ("member_canonical", "STRING"), ("member_match_status", "STRING"),
        ("capacity", "INTEGER"), ("matched", "BOOLEAN"), ("articles", "INTEGER"),
        ("pct_allocation", "FLOAT"), ("pct_distribution", "FLOAT"),
        ("projected_used", "FLOAT"), ("actual_used", "FLOAT"),
        ("pct_util_real", "FLOAT"), ("pct_util_weighted", "FLOAT"),
        ("pod_total_capacity", "INTEGER"), ("pod_total_articles", "INTEGER"),
        ("pod_projected_raw", "INTEGER"), ("pod_actual_raw", "INTEGER"),
        ("pod_projected_weighted", "FLOAT"), ("pod_actual_weighted", "FLOAT"),
        ("pod_util_projected_weighted", "FLOAT"), ("pod_util_actual_weighted", "FLOAT"),
    ],
    "editorial_capacity_client_contributions": [
        ("year", "INTEGER"), ("month", "INTEGER"), ("pod", "STRING"),
        ("client_id", "INTEGER"), ("client_name", "STRING"), ("sf_client_name", "STRING"),
        ("category", "STRING"), ("weight", "FLOAT"),
        ("projected_raw", "INTEGER"), ("actual_raw", "INTEGER"),
        ("projected_weighted", "FLOAT"), ("actual_weighted", "FLOAT"),
    ],
    "editorial_articles_monthly": [
        ("month_year", "STRING"), ("editorial_pod", "STRING"), ("growth_pod", "STRING"),
        ("client_name", "STRING"), ("editor_name", "STRING"),
        ("count", "INTEGER"), ("revised", "INTEGER"), ("published", "INTEGER"),
        ("published_revised", "INTEGER"), ("matched", "INTEGER"),
    ],
    "editorial_revisions_monthly": [
        ("month_year", "STRING"), ("editorial_pod", "STRING"), ("growth_pod", "STRING"),
        ("client_name", "STRING"), ("editor_name", "STRING"), ("revisions", "INTEGER"),
    ],
    "editorial_month_basis": [
        ("client_name", "STRING"), ("year", "INTEGER"), ("month", "INTEGER"),
        ("operating_model_actual", "INTEGER"), ("log_editorial_month", "INTEGER"),
        ("log_calendar_month", "INTEGER"), ("edit_minus_prod", "INTEGER"),
        ("verdict", "STRING"),
    ],
}

MAPPING_SCHEMAS: dict[str, list[tuple[str, str]]] = {
    "editorial_map_editors": [
        ("raw_name", "STRING"), ("canonical_name", "STRING"), ("status", "STRING"),
        ("hr_status", "STRING"), ("article_rows", "INTEGER"),
        ("candidates", "STRING"), ("note", "STRING"),
    ],
    "editorial_map_clients": [
        ("hub_name", "STRING"), ("sf_client_name", "STRING"), ("sf_account_id", "STRING"),
        ("status", "STRING"), ("hub_status", "STRING"), ("note", "STRING"),
    ],
    "editorial_map_writers": [
        ("raw_name", "STRING"), ("canonical_name", "STRING"), ("status", "STRING"),
        ("article_rows", "INTEGER"), ("candidates", "STRING"),
    ],
}


def run_ingest(scope: str) -> list[dict]:
    """Run the app's sync-manifest steps for `scope` — the exact same importer
    code the SYNC button / Re-sync Past Months execute."""
    from sqlalchemy.orm import Session as SyncSession

    from app.services import sync_manifest
    from etl.extract import get_engine
    from etl.manifest import ingest_plan

    results = []
    plan = ingest_plan(scope)
    engine = get_engine()
    for step in plan:
        if step["key"].startswith("@warehouse"):
            # The phase-1 publisher below refreshes the flat tables itself;
            # running the warehouse publish as an "ingest step" here would
            # rebuild the layered warehouse twice for nothing.
            continue
        t0 = time.time()
        with SyncSession(engine) as session:
            try:
                rs = sync_manifest.run_step(session, step["key"])
                ok = all(r.success for r in rs)
                imported = sum(r.rows_imported or 0 for r in rs)
                errors = [e for r in rs for e in (r.errors or [])][:3]
            except Exception as exc:  # keep going — partial ingest is visible in the log
                ok, imported, errors = False, 0, [str(exc)]
        results.append(
            {
                "step": step["key"],
                "scope": step["scope"],
                "success": ok,
                "rows_imported": imported,
                "seconds": round(time.time() - t0, 1),
                "errors": errors,
            }
        )
        logger.info(
            "ingest %-45s %s rows=%s (%.1fs)",
            step["key"],
            "OK" if ok else "FAIL " + "; ".join(errors),
            imported,
            time.time() - t0,
        )
    return results


def run_publish(
    tables_filter: set[str] | None = None,
    skip_marts: bool = False,
    skip_mappings: bool = False,
) -> list[dict]:
    from app.models import CapacityProjection

    from etl import transform
    from etl.extract import fetch_model_rows, get_session
    from etl.load import get_bq, load_rows, schema_for_model, schema_from_spec
    from etl.manifest import MAPPING_TABLES, MARTS, TABLES, TRANSFORM_EXTRA_COLUMNS

    bq = get_bq()
    mappings = transform.load_mappings()
    results: list[dict] = []

    def _record(name: str, kind: str, fn):
        if tables_filter and name not in tables_filter:
            return
        t0 = time.time()
        try:
            n = fn()
            results.append({"table": name, "kind": kind, "rows": n, "success": True,
                            "seconds": round(time.time() - t0, 1)})
            logger.info("publish %-45s OK rows=%s (%.1fs)", name, n, time.time() - t0)
        except Exception as exc:
            results.append({"table": name, "kind": kind, "rows": 0, "success": False,
                            "error": str(exc), "seconds": round(time.time() - t0, 1)})
            logger.exception("publish %s FAILED", name)

    with get_session() as session:
        # 1:1 tables (+ canonical columns)
        for spec in TABLES:
            def _load(spec=spec):
                rows = fetch_model_rows(session, spec.model)
                extra = TRANSFORM_EXTRA_COLUMNS.get(spec.transform or "", [])
                if spec.transform == "client_canonicals":
                    rows = transform.add_client_canonicals(rows, mappings)
                elif spec.transform == "article_canonicals":
                    rows = transform.add_article_canonicals(rows, mappings)
                return load_rows(bq, spec.bq_name, rows, schema_for_model(spec.model, extra))
            _record(spec.bq_name, "table", _load)

        # marts
        if not skip_marts:
            builders = {
                "editorial_capacity_pod": lambda: transform.build_capacity_pod_mart(
                    fetch_model_rows(session, CapacityProjection)
                ),
                "editorial_capacity_member_utilization": lambda: transform.build_member_utilization_mart(session, mappings),
                "editorial_capacity_client_contributions": lambda: transform.build_client_contributions_mart(session, mappings),
                "editorial_articles_monthly": lambda: transform.build_articles_monthly_mart(session),
                "editorial_revisions_monthly": lambda: transform.build_revisions_monthly_mart(session),
                "editorial_month_basis": lambda: transform.build_month_basis_mart(session),
            }
            for name in MARTS:
                _record(name, "mart", lambda name=name: load_rows(
                    bq, name, builders[name](), schema_from_spec(MART_SCHEMAS[name])
                ))

        # mapping review tables
        if not skip_mappings:
            map_rows = transform.mapping_table_rows(mappings)
            for name in MAPPING_TABLES:
                _record(name, "mapping", lambda name=name: load_rows(
                    bq, name, map_rows[name], schema_from_spec(MAPPING_SCHEMAS[name])
                ))

    return results


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Editorial ETL → BigQuery")
    ap.add_argument("--scope", choices=["current", "past", "full"], default=None,
                    help="run sheet ingest first (same steps as the SYNC button / Re-sync)")
    ap.add_argument("--tables", default=None, help="CSV of BQ table names to publish (default: all)")
    ap.add_argument("--skip-marts", action="store_true")
    ap.add_argument("--skip-mappings", action="store_true")
    args = ap.parse_args(argv)

    started = datetime.now(timezone.utc).isoformat()
    ingest_results = run_ingest(args.scope) if args.scope else []
    publish_results = run_publish(
        tables_filter=set(args.tables.split(",")) if args.tables else None,
        skip_marts=args.skip_marts,
        skip_mappings=args.skip_mappings,
    )

    summary = {
        "started_at": started,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "scope": args.scope,
        "ingest": ingest_results,
        "publish": publish_results,
        "ok": all(r["success"] for r in ingest_results + publish_results),
    }
    out_path = os.path.join(os.path.dirname(__file__), "last_run.json")
    with open(out_path, "w") as f:
        json.dump(summary, f, indent=2)
    n_pub = sum(1 for r in publish_results if r["success"])
    print(f"\nETL {'OK' if summary['ok'] else 'FAILED'} — ingest steps: "
          f"{len(ingest_results)}, published: {n_pub}/{len(publish_results)} tables "
          f"(log: {out_path})")
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
