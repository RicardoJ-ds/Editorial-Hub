"""In-process cache for the BigQuery dashboard read path.

Dashboard data only changes when the warehouse is (re)published. So we cache
every BQ query result keyed by ``(sql, params, publish_token)``:

* A SYNC / Re-sync / cron publish ends in ``@warehouse-publish``, which calls
  :func:`bump_token` — every instance picks up the new token within
  ``cache_token_poll_seconds`` and serves the fresh numbers, without hitting BQ
  or Neon on each request.
* A TTL (``bq_cache_ttl_seconds``) is a safety net for any path that mutates the
  warehouse without bumping.
* On a BQ error we serve the last-good (stale) entry if we have one rather than
  surfacing a 500.

The wrapped functions run in ``asyncio.to_thread`` worker threads and the
publish runs in a ``ThreadPoolExecutor``, so the locks here are real OS-thread
locks (``threading``), not asyncio primitives. The event loop is never blocked
because the wrapped call itself runs off-loop.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable

from app.config import settings

# (sql, param_key) -> (stored_at_monotonic, token, value)
_store: dict[tuple, tuple[float, int, list]] = {}
_store_lock = threading.RLock()

_token: int = 0
_token_checked_at: float = 0.0
_token_lock = threading.Lock()


def _read_token_from_db() -> int:
    from sqlalchemy import select

    from app.auth_deps import get_sync_session
    from app.models import CacheVersion

    with get_sync_session() as s:
        row = s.execute(select(CacheVersion.token).where(CacheVersion.id == 1)).first()
        return int(row[0]) if row and row[0] is not None else 0


def current_token() -> int:
    """The current publish token, read from Neon at most once per
    ``cache_token_poll_seconds`` per process (a single tiny indexed SELECT)."""
    global _token, _token_checked_at
    now = time.monotonic()
    with _token_lock:
        if _token_checked_at and now - _token_checked_at < settings.cache_token_poll_seconds:
            return _token
    try:
        val = _read_token_from_db()
    except Exception:
        # DB blip — keep serving against the last known token rather than error.
        with _token_lock:
            return _token
    with _token_lock:
        _token = val
        _token_checked_at = now
    return val


def bump_token(session) -> int:
    """Increment the publish token so every cache entry invalidates. Called at
    the tail of the warehouse publish. Resets the local read-through so the
    publishing process sees the new token immediately; other instances pick it
    up within ``cache_token_poll_seconds``."""
    from sqlalchemy import text

    global _token, _token_checked_at
    row = session.execute(
        text(
            "INSERT INTO cache_version (id, token, bumped_at) VALUES (1, 1, now()) "
            "ON CONFLICT (id) DO UPDATE SET token = cache_version.token + 1, bumped_at = now() "
            "RETURNING token"
        )
    ).first()
    session.commit()  # get_db()/sync sessions never auto-commit
    new = int(row[0]) if row else 0
    with _token_lock:
        _token = new
        _token_checked_at = 0.0  # force the next current_token() to re-read
    return new


def _param_key(params) -> tuple:
    """Stable, hashable representation of a BigQuery query-parameter list
    (Scalar + Array). Two calls with the same SQL + params share a cache slot;
    different RBAC scopes (allowed_names array) key to different slots."""
    out = []
    for p in params or []:
        name = getattr(p, "name", None)
        values = getattr(p, "values", None)
        if values is not None:  # ArrayQueryParameter
            out.append((name, "array", tuple(values)))
        else:  # ScalarQueryParameter
            out.append((name, getattr(p, "type_", None), getattr(p, "value", None)))
    return tuple(out)


def cached_query(sql: str, params, runner: Callable[[], list]) -> list:
    """Return ``runner()`` (one BQ query execution), cached by
    ``(sql, params, publish_token)`` with a TTL fallback. Serves the last-good
    value on a BQ error. A no-op (calls ``runner`` directly) when
    ``bq_cache_enabled`` is False — the parity harness uses that so every
    request is a fresh read."""
    if not settings.bq_cache_enabled:
        return runner()
    token = current_token()
    key = (sql, _param_key(params))
    now = time.monotonic()
    with _store_lock:
        hit = _store.get(key)
        if hit is not None and hit[1] == token and (now - hit[0]) < settings.bq_cache_ttl_seconds:
            return hit[2]
        stale = hit
    try:
        value = runner()
    except Exception:
        if stale is not None:
            return stale[2]  # serve last-good rather than 500
        raise
    with _store_lock:
        _store[key] = (now, token, value)
    return value


def clear() -> None:
    """Drop all cached entries (tests / manual flush)."""
    with _store_lock:
        _store.clear()
