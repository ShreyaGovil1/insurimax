"""
InsuriMax — FastAPI application entry point.

Architecture:
  - Database : Cloud SQL / AlloyDB (PostgreSQL) via asyncpg + SQLAlchemy 2
  - Storage  : Google Cloud Storage (GCS) for all uploaded documents
  - AI       : Gemini 1.5 Pro via google-generativeai (local) or Vertex AI (GCP)
  - Auth     : JWT (HS256) with bcrypt password hashing
  - Hosting  : Cloud Run (stateless, NullPool connection strategy)
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger("insurimax")


# ── Lifespan: startup / shutdown hooks ────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 InsuriMax starting up — env=%s", settings.ENVIRONMENT)

    # Optional: run Alembic migrations automatically on startup
    # Uncomment for Cloud Run where you can't run migrations manually before deploy
    # from alembic.config import Config
    # from alembic import command
    # alembic_cfg = Config("alembic.ini")
    # command.upgrade(alembic_cfg, "head")

    # Warm up the DB connection pool
    try:
        from app.db.session import engine
        async with engine.connect() as conn:
            await conn.execute(__import__("sqlalchemy").text("SELECT 1"))
        logger.info("✅ Database connection verified")
    except Exception as exc:
        logger.warning("⚠️  Database not reachable at startup: %s", exc)

    yield

    logger.info("👋 InsuriMax shutting down")
    from app.db.session import engine
    await engine.dispose()


# ── App factory ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="InsuriMax API",
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


# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Global exception handlers ─────────────────────────────────────────────────

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": "An unexpected error occurred. Please try again.",
            "path": str(request.url.path),
        },
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


# ── Health & metadata endpoints ───────────────────────────────────────────────

@app.get("/", tags=["Health"])
async def root():
    return {
        "service": "InsuriMax API",
        "version": settings.APP_VERSION,
        "environment": settings.ENVIRONMENT,
        "status": "healthy",
        "docs": "/docs",
    }


@app.get("/health", tags=["Health"])
async def health_check():
    """
    Liveness probe for Cloud Run / Kubernetes.
    Checks DB connectivity; returns 200 if healthy, 503 if not.
    """
    checks: dict[str, str] = {}

    # DB check
    try:
        from app.db.session import engine
        import sqlalchemy
        async with engine.connect() as conn:
            await conn.execute(sqlalchemy.text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {exc}"

    all_ok = all(v == "ok" for v in checks.values())
    return JSONResponse(
        status_code=status.HTTP_200_OK if all_ok else status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"status": "healthy" if all_ok else "degraded", "checks": checks},
    )


@app.get("/ready", tags=["Health"])
async def readiness_check():
    """Readiness probe — used by Cloud Run to decide when to route traffic."""
    return {"ready": True}

# uv run uvicorn main:app --reload --port 8000