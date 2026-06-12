"""Drop the deprecated phase-1 flat BigQuery mirror (`editorial_*` tables that
are NOT part of the layered warehouse).

The warehouse read contract is `editorial_raw_*`, `editorial_int_*`, and
`v_editorial_*` ONLY — every dashboard endpoint reads those (proven by
etl.warehouse.endpoint_parity, 53/53). Everything else under the `editorial_`
prefix is the phase-1 flat mirror, superseded and unread.

IRREVERSIBLE on prod BigQuery. Dry-run by default; pass --confirm to drop.

    docker compose exec -T backend python -m etl.warehouse.drop_legacy          # list only
    docker compose exec -T backend python -m etl.warehouse.drop_legacy --confirm # drop
"""

from __future__ import annotations

import sys

from app.config import settings
from etl.load import get_bq

# Anything starting with one of these is the live warehouse — NEVER dropped.
KEEP_PREFIXES = ("editorial_raw_", "editorial_int_", "v_editorial_")


def legacy_tables(bq, ds: str) -> list[str]:
    rows = bq.query(
        f"SELECT table_name FROM `{ds}.INFORMATION_SCHEMA.TABLES` "
        f"WHERE table_name LIKE 'editorial%' ORDER BY table_name"
    ).result()
    return [r.table_name for r in rows if not r.table_name.startswith(KEEP_PREFIXES)]


def main(argv: list[str] | None = None) -> int:
    confirm = "--confirm" in (argv or sys.argv[1:])
    bq = get_bq()
    ds = f"{settings.bq_project}.{settings.bq_dataset}"
    targets = legacy_tables(bq, ds)

    if not targets:
        print("Nothing to drop — no legacy editorial_* tables found.")
        return 0

    print(f"{len(targets)} deprecated phase-1 tables in {ds}:")
    for t in targets:
        print(f"  {t}")

    if not confirm:
        print("\nDRY RUN — pass --confirm to drop. Nothing changed.")
        return 0

    # Safety belt: re-assert none of these are live warehouse objects.
    bad = [t for t in targets if t.startswith(KEEP_PREFIXES)]
    if bad:
        print(f"ABORT — refusing to drop live warehouse objects: {bad}")
        return 1

    for t in targets:
        bq.query(f"DROP TABLE IF EXISTS `{ds}.{t}`").result()
        print(f"  dropped {t}")
    print(f"\nDropped {len(targets)} legacy tables.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
