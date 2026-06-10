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
        from etl.run import run_ingest

        ingest_results = run_ingest(args.scope)

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
