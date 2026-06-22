import ssl
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings


def _prepare_database_url(url: str) -> tuple[str, dict]:
    """Transform DATABASE_URL for asyncpg compatibility.

    - Swaps postgresql:// scheme to postgresql+asyncpg://
    - Strips libpq-only params (sslmode, channel_binding) that asyncpg rejects
    - Returns (cleaned_url, connect_args) with SSL context when needed
    """
    is_neon = "neon.tech" in url

    # Ensure asyncpg scheme
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)

    # Strip query params asyncpg doesn't understand
    parts = urlsplit(url)
    params = parse_qs(parts.query)
    params.pop("sslmode", None)
    params.pop("channel_binding", None)
    cleaned_query = urlencode({k: v[0] for k, v in params.items()})
    url = urlunsplit(parts._replace(query=cleaned_query))

    args: dict = {}
    if is_neon or "ssl=require" in url:
        args["ssl"] = ssl.create_default_context()

    return url, args


def prepare_sync_url(url: str) -> str:
    """Transform DATABASE_URL for psycopg2 (sync) compatibility.

    - Drops the `+asyncpg` driver suffix so psycopg2 is selected.
    - Translates the asyncpg-flavored `ssl=require` query param to psycopg2's
      `sslmode=require`. If both are present, `sslmode` wins and `ssl` is
      discarded. Without this translation psycopg2 raises:
      `invalid dsn: invalid connection option "ssl"`.
    - Leaves any other libpq-compatible params (sslmode, channel_binding,
      application_name, …) intact.
    """
    if "+asyncpg" in url:
        url = url.replace("+asyncpg", "")
    parts = urlsplit(url)
    params = parse_qs(parts.query)
    if "ssl" in params:
        if "sslmode" not in params:
            params["sslmode"] = params["ssl"]
        del params["ssl"]
    cleaned_query = urlencode({k: v[0] for k, v in params.items()})
    return urlunsplit(parts._replace(query=cleaned_query))


def make_sync_engine(database_url: str) -> Engine:
    """Build a psycopg2 (sync) engine that survives Neon's connection drops.

    Neon is serverless Postgres: its compute can autosuspend and its pooler
    recycles idle connections, so a cached/long-lived engine eventually hands
    out a dead connection → ``SSL connection has been closed unexpectedly`` on
    the next statement. This bit the warehouse publish, which runs LAST in a
    SYNC — minutes after its pooled connection was opened. `pool_pre_ping`
    issues a lightweight liveness check at checkout and transparently
    reconnects; `pool_recycle` retires connections before Neon's idle window
    closes them. (Local Postgres keeps idle connections forever, which is why
    the failure only shows up against Neon in prod.)
    """
    return create_engine(
        prepare_sync_url(database_url),
        echo=False,
        pool_pre_ping=True,
        pool_recycle=280,
    )


_db_url, _connect_args = _prepare_database_url(settings.database_url)
# pool_pre_ping for the same Neon-drops-idle-connections reason as the sync
# engine above (see make_sync_engine).
engine = create_async_engine(
    _db_url, echo=False, connect_args=_connect_args, pool_pre_ping=True, pool_recycle=280
)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db():
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
