"""
Insurimax — FastAPI application entry point.
"""
import logging
import time
from contextlib import asynccontextmanager

import sqlalchemy
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.middleware import DBQueryLoggerMiddleware, TimingMiddleware
from app.core.security import ensure_secret_key_is_secure
from app.core.telemetry import setup_telemetry

# Refuse to start the API with a missing, published or short JWT signing key.
ensure_secret_key_is_secure()

# ── Structured logging ────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)-30s | %(message)s",
    datefmt="%H:%M:%S",
)
# Quiet down noisy third-party loggers
logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
logging.getLogger("sqlalchemy.pool").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("google").setLevel(logging.WARNING)
logging.getLogger("passlib").setLevel(logging.WARNING)

logger = logging.getLogger("app")


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.db.session import engine

    logger.info("Starting up — env=%s pool_size=%d", settings.ENVIRONMENT, settings.DB_POOL_SIZE)

    # ── OpenTelemetry ─────────────────────────────────────────────────────────
    # Must be set up before any instrumented code runs
    setup_telemetry(app)

    # Register slow-query logger on the engine
    DBQueryLoggerMiddleware.setup(engine)

    # Pre-warm the connection pool so the first request isn't cold.
    # Opens DB_POOL_SIZE connections eagerly at startup instead of lazily.
    t0 = time.perf_counter()
    try:
        warm_tasks = []
        import asyncio
        async def _warm():
            async with engine.connect() as conn:
                await conn.execute(sqlalchemy.text("SELECT 1"))

        await asyncio.gather(*[_warm() for _ in range(min(settings.DB_POOL_SIZE, 3))])
        elapsed = (time.perf_counter() - t0) * 1000
        logger.info("DB pool warmed in %.0f ms", elapsed)
    except Exception as exc:
        logger.warning("DB pool warm-up failed: %s", exc)

    yield

    logger.info("Shutting down — disposing DB pool")
    await engine.dispose()


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Insurimax API",
    description=(
        "AI-powered insurance claims adjudication platform. "
        "Reduces TPA adjudication time from 3+ hours to under 30 minutes "
        "using Gemini 1.5 Pro multimodal long-context analysis."
    ),
    version=settings.APP_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# ── Middleware (order matters — first added = outermost = executes last) ──────

# 1. CORS — must wrap everything
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=False if "*" in settings.CORS_ORIGINS else True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. Request timing — logs every request with latency
app.add_middleware(TimingMiddleware)


# ── Exception handlers ────────────────────────────────────────────────────────

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", "?")
    logger.exception("[%s] Unhandled exception on %s %s", request_id, request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "An unexpected error occurred.", "request_id": request_id},
    )


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": str(exc)},
    )


# ── Routes ────────────────────────────────────────────────────────────────────
from app.api.v1.router import api_router  # noqa: E402

app.include_router(api_router)


# ── Health endpoints ──────────────────────────────────────────────────────────

@app.get("/", tags=["Health"])
async def root():
    return {
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "environment": settings.ENVIRONMENT,
        "status": "healthy",
        "docs": "/docs",
    }


@app.get("/health", tags=["Health"])
async def health_check():
    """Liveness probe — checks DB connectivity, returns pool stats."""
    from app.db.session import engine

    checks: dict = {}
    t0 = time.perf_counter()
    try:
        async with engine.connect() as conn:
            await conn.execute(sqlalchemy.text("SELECT 1"))
        checks["database"] = {"status": "ok", "latency_ms": round((time.perf_counter() - t0) * 1000, 1)}
    except Exception as exc:
        checks["database"] = {"status": "error", "detail": str(exc)}

    # Pool stats (only available with a real pool, not NullPool)
    pool = engine.pool
    if hasattr(pool, "size"):
        checks["pool"] = {
            "size": pool.size(),
            "checked_in": pool.checkedin(),
            "checked_out": pool.checkedout(),
            "overflow": pool.overflow(),
        }

    all_ok = checks["database"]["status"] == "ok"
    return JSONResponse(
        status_code=status.HTTP_200_OK if all_ok else status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"status": "healthy" if all_ok else "degraded", "checks": checks},
    )


@app.get("/ready", tags=["Health"])
async def readiness_check():
    return {"ready": True}

#uvicorn main:app --host 0.0.0.0 --port 8000