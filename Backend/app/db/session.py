"""
Async SQLAlchemy engine and session factory.
Compatible with Cloud SQL (PostgreSQL) and AlloyDB via asyncpg driver.
"""
import ssl

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings

# asyncpg requires SSL to be passed as a context object via connect_args,
# not as a ?sslmode= query parameter.
_ssl_context = ssl.create_default_context()
_ssl_context.check_hostname = False
_ssl_context.verify_mode = ssl.CERT_NONE  # Supabase pooler uses self-signed cert

engine = create_async_engine(
    settings.async_database_url,
    echo=settings.DEBUG,
    poolclass=NullPool,
    future=True,
    connect_args={"ssl": _ssl_context},
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


async def get_db() -> AsyncSession:  # type: ignore[override]
    """FastAPI dependency that yields an async DB session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
