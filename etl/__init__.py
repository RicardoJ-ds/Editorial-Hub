"""Editorial ETL — sheets → (proven importers) → Postgres → BigQuery.

Phase-1 architecture (strangler fig): ingestion reuses the battle-tested
importers in `app.services.migration_service` via the sync manifest — byte-for-
byte the same behavior as the dashboard's SYNC button — then this package
publishes every dashboard-feeding table to BigQuery
(`graphite_bi_sandbox.editorial_*`) with canonical-name columns added and the
processed capacity/article marts computed. The dashboard can then read BQ.

Run inside the backend container (mounted at /app/etl):
    docker compose exec -T backend python -m etl.run --scope full   # ingest + publish
    docker compose exec -T backend python -m etl.run                # publish only
    docker compose exec -T backend python -m etl.parity             # parity proof
"""
