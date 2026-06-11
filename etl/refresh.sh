#!/usr/bin/env bash
# One-command warehouse refresh — same behavior as the Hub's SYNC button
# (current), Re-sync Past Months (past), or both (full); then rebuilds the
# BigQuery warehouse the dashboards read.
#   ./etl/refresh.sh            # publish-only (Postgres → BigQuery)
#   ./etl/refresh.sh current    # = SYNC button + publish
#   ./etl/refresh.sh past       # = Re-sync Past Months + publish
#   ./etl/refresh.sh full       # = both + publish
set -euo pipefail
cd "$(dirname "$0")/.."
SCOPE="${1:-}"
if [ -n "$SCOPE" ]; then
  docker compose exec -T backend python -m etl.warehouse.run --scope "$SCOPE"
else
  docker compose exec -T backend python -m etl.warehouse.run
fi
