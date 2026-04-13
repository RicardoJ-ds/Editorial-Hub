import ssl
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

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


_db_url, _connect_args = _prepare_database_url(settings.database_url)
engine = create_async_engine(_db_url, echo=False, connect_args=_connect_args)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db():
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
