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

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
