"""
Async SQLAlchemy engine and session factory.

Pool strategy:
  - DB_POOL_SIZE > 0  → AsyncAdaptedQueuePool  (persistent server / local dev)
  - DB_POOL_SIZE = 0  → NullPool               (Cloud Run / serverless — one connection per request)

The pool eliminates the 6-7 second TCP+SSL reconnect penalty that NullPool
pays on every single request when connecting to a remote database.
"""
import logging
import ssl

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import AsyncAdaptedQueuePool, NullPool

from app.core.config import settings

logger = logging.getLogger(__name__)

# ── SSL context (required for Supabase / Cloud SQL) ───────────────────────────
_ssl_context = ssl.create_default_context()
_ssl_context.check_hostname = False
_ssl_context.verify_mode = ssl.CERT_NONE  # Supabase pooler uses self-signed cert

# ── Engine ─────────────────────────────────────────────────────────────────────
_use_null_pool = settings.DB_POOL_SIZE == 0

if _use_null_pool:
    # Serverless: create a fresh connection each request, discard after
    logger.info("DB pool: NullPool (serverless mode)")
    engine = create_async_engine(
        settings.async_database_url,
        echo=False,           # never echo in production; use middleware for query tracing
        poolclass=NullPool,
        future=True,
        connect_args={"ssl": _ssl_context},
    )
else:
    # Persistent server: keep a warm pool — eliminates per-request reconnect cost
    logger.info(
        "DB pool: AsyncAdaptedQueuePool size=%d overflow=%d recycle=%ds",
        settings.DB_POOL_SIZE,
        settings.DB_MAX_OVERFLOW,
        settings.DB_POOL_RECYCLE,
    )
    engine = create_async_engine(
        settings.async_database_url,
        echo=False,
        poolclass=AsyncAdaptedQueuePool,
        pool_size=settings.DB_POOL_SIZE,
        max_overflow=settings.DB_MAX_OVERFLOW,
        pool_timeout=settings.DB_POOL_TIMEOUT,
        pool_recycle=settings.DB_POOL_RECYCLE,
        pool_pre_ping=True,   # validates connection before handing it out (catches stale connections)
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
