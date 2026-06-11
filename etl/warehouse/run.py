"""Warehouse orchestrator — [ingest] → raw → int → views.

    python -m etl.warehouse.run                    # raw+int+views from current Postgres
    python -m etl.warehouse.run --scope current    # SYNC-equivalent ingest first
    python -m etl.warehouse.run --layers int,views # selective rebuild
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
logger = logging.getLogger("etl.warehouse")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Editorial warehouse → BigQuery (raw/int/views)")
    ap.add_argument("--scope", choices=["current", "past", "full"], default=None,
                    help="run sheet ingest first (same steps as SYNC / Re-sync)")
    ap.add_argument("--layers", default="raw,int,views",
                    help="CSV of layers to build (raw,int,views)")
    args = ap.parse_args(argv)
    layers = {x.strip() for x in args.layers.split(",") if x.strip()}

    started = datetime.now(timezone.utc).isoformat()
    ingest_results = []
    if args.scope:
        from sqlalchemy.orm import Session as SyncSession

        from app.services import sync_manifest
        from etl.extract import get_engine
        from etl.manifest import ingest_plan

        # Same steps as the SYNC button / Re-sync — minus the manifest's own
        # warehouse-publish step (we build the warehouse ourselves below, so
        # running it inside ingest would rebuild everything twice).
        engine = get_engine()
        for step in ingest_plan(args.scope):
            if step["key"].startswith("@warehouse"):
                continue
            t0 = time.time()
            with SyncSession(engine) as session:
                try:
                    rs = sync_manifest.run_step(session, step["key"])
                    ok = all(r.success for r in rs)
                    imported = sum(r.rows_imported or 0 for r in rs)
                    errors = [e for r in rs for e in (r.errors or [])][:3]
                except Exception as exc:
                    ok, imported, errors = False, 0, [str(exc)]
            ingest_results.append(
                {"step": step["key"], "scope": step["scope"], "success": ok,
                 "rows_imported": imported, "seconds": round(time.time() - t0, 1),
                 "errors": errors}
            )
            logger.info("ingest %-45s %s rows=%s", step["key"],
                        "OK" if ok else "FAIL " + "; ".join(errors), imported)

    from etl.load import get_bq
    from etl.warehouse.build import build_all
    from etl.warehouse.views import create_views

    t0 = time.time()
    counts = build_all(layers={"raw", "int"} & layers)
    for table, n in counts.items():
        logger.info("built %-44s rows=%s", table, n)

    views = []
    if "views" in layers:
        views = create_views(get_bq())
        logger.info("created/replaced %d views", len(views))

    summary = {
        "started_at": started,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "scope": args.scope,
        "layers": sorted(layers),
        "ingest": ingest_results,
        "tables": counts,
        "views": views,
        "seconds": round(time.time() - t0, 1),
    }
    out = os.path.join(os.path.dirname(__file__), "last_run.json")
    with open(out, "w") as f:
        json.dump(summary, f, indent=2, default=str)
    ok = all(r["success"] for r in ingest_results) if ingest_results else True
    print(f"\nWAREHOUSE {'OK' if ok else 'FAILED'} — {len(counts)} tables, "
          f"{len(views)} views ({summary['seconds']}s). Log: {out}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
