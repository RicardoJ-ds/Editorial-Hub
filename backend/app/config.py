from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://editorial:changeme@localhost:5432/editorial_hub"
    google_application_credentials: str = "sa-key.json"
    bq_project: str = "graphite-data"
    bq_dataset: str = "graphite_bi_sandbox"
    cors_origins: list[str] = ["http://localhost:3000"]
    spreadsheet_id: str = ""
    master_tracker_id: str = ""
    ai_monitoring_id: str = ""
    notion_database_id: str = ""
    # Editorial + Growth team pods, one tab per month per kind. Currently
    # points at a temporary copy — swap to the original sheet ID before prod.
    # See memory/reference_team_pods_sheet.md.
    team_pods_id: str = "1N6q1ZYC4W9BYusewdwqwprUu9zSmbQp99mC3f2y3_HI"
    # "[Internal] Monthly Article Count/Revenue Sheet" — one tab per client.
    # Drives the Team KPIs → Monthly Articles tab (per-editor productivity).
    # Read by the same Hub service account that the standalone editorial
    # dashboard already uses, so no extra ACL is required.
    article_count_id: str = "1FWykZmeG2jznUYn-ng6glN4wjvc1Swb6hHmSHzGZ7dU"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
