"""Shared Google credential helper — supports base64 env var (production) and file-based (local dev)."""

from __future__ import annotations

import base64
import json
import os

from google.oauth2 import service_account

from app.config import settings


def get_google_credentials(scopes: list[str]) -> service_account.Credentials:
    """Build Google credentials from env var or file.

    Production (Railway): reads GOOGLE_SERVICE_ACCOUNT_KEY (base64-encoded JSON).
    Local dev: falls back to sa-key.json file.
    """
    b64_key = os.environ.get("GOOGLE_SERVICE_ACCOUNT_KEY")
    if b64_key:
        info = json.loads(base64.b64decode(b64_key))
        return service_account.Credentials.from_service_account_info(info, scopes=scopes)

    sa_path = _resolve_sa_key_path()
    return service_account.Credentials.from_service_account_file(sa_path, scopes=scopes)


def _resolve_sa_key_path() -> str:
    """Find the service-account key file locally."""
    candidates = [
        settings.google_application_credentials,
        os.path.join(os.getcwd(), "sa-key.json"),
        os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            "sa-key.json",
        ),
        "/app/sa-key.json",
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    raise FileNotFoundError(f"Cannot find SA key file. Tried: {candidates}")
