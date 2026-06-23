from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://editorial:changeme@localhost:5432/editorial_hub"
    google_application_credentials: str = "sa-key.json"
    bq_project: str = "graphite-data"
    bq_dataset: str = "graphite_bi_sandbox"
    # Where the DASHBOARD read endpoints get their data: "postgres" (the
    # original sheets→Postgres path) or "bq" (the layered BigQuery warehouse —
    # see etl/WAREHOUSE_DESIGN.md). Per-request override via the X-Data-Source
    # header (lets the parity harness diff both sources on one server).
    dashboard_source: str = "postgres"
    # Honor the per-request X-Data-Source override (parity harness only).
    # MUST stay False in production — any caller could flip the datastore.
    data_source_override_enabled: bool = False
    # ── Read-path cache (services/bq_cache.py) ──────────────────────────────
    # Serve BQ dashboard reads from an in-process cache so neither BQ nor Neon
    # is hit on every request. Entries are keyed by (sql, params, publish
    # token); the warehouse publish bumps the token so a SYNC shows fresh
    # numbers within `cache_token_poll_seconds`. TTL is a safety net.
    bq_cache_enabled: bool = True
    bq_cache_ttl_seconds: int = 600
    cache_token_poll_seconds: int = 5
    # Short-TTL cache for the per-request RBAC resolve — the dominant Neon read
    # once dashboards serve from BQ. 0 disables. Revocations propagate within
    # this window (plus the frontend's tab-focus refetch).
    rbac_cache_ttl_seconds: int = 30
    cors_origins: list[str] = ["http://localhost:3000"]
    spreadsheet_id: str = ""
    master_tracker_id: str = ""
    ai_monitoring_id: str = ""
    notion_database_id: str = ""
    # Editorial + Growth team pods, one tab per month per kind. Currently
    # points at a temporary copy — swap to the original sheet ID before prod.
    # See memory/reference_team_pods_sheet.md.
    team_pods_id: str = "10ydCI1mQ5_T6nnMJt9eNHZ32_8NJBkOceiAW6FprjxA"
    # "[Internal] Monthly Article Count/Revenue Sheet" — one tab per client.
    # Drives the Team KPIs → Monthly Articles tab (per-editor productivity).
    # Read by the same Hub service account that the standalone editorial
    # dashboard already uses, so no extra ACL is required.
    article_count_id: str = "1X_M82VzstJCulkl6l62jaubn2yI0ODBTz33iZ4XqZWU"

    # "Editorial Name Mappings" sheet (Writers/Editors/Clients tabs) — DaniQ-editable
    # source of truth for the normalization map; synced to BigQuery editorial_name_map.
    name_mappings_sheet_id: str = "1p0tFg4D8BypZlG6Rfch7KKsqaNa8xUUZRn2BFv6oLsc"

    # Daily server-side sync (sheets -> Postgres -> dual-sink warehouse).
    # OFF locally; turn ON in prod so BigQuery + dashboards stay fresh without
    # anyone pressing SYNC. Hour is UTC; scope=current auto-escalates to full
    # on editorial month rollover (same rule as the SYNC button).
    sync_cron_enabled: bool = False
    sync_cron_utc_hour: int = 9

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
