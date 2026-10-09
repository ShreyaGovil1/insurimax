"""
Application configuration using pydantic-settings.
Values are loaded from environment variables / .env files.
"""
import json
from functools import lru_cache
from typing import Any, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=[".env", ".env.development", ".env.production"],
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ──────────────────────────────────────────────────────────────────
    APP_NAME: str = "InsuriMax"
    APP_VERSION: str = "1.0.0"
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"
    DEBUG: bool = True

    # ── Security ─────────────────────────────────────────────────────────────
    SECRET_KEY: str = Field(default="change-me-in-production-use-a-long-random-string")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # ── Database (Cloud SQL / AlloyDB - PostgreSQL wire protocol) ────────────
    DB_HOST: str = "127.0.0.1"
    DB_PORT: int = 5432
    DB_NAME: str = "insurimax"
    DB_USER: str = "postgres"
    DB_PASSWORD: str = "postgres"
    DATABASE_URL: str | None = None
    DB_SSL: bool = True

    # ── Connection pool ────────────────────────────────────────────────────────
    # NullPool = one new TCP+SSL connection per request (good for Cloud Run,
    # terrible for local dev or any persistent server). Use a real pool instead.
    # Set DB_POOL_SIZE=0 to force NullPool (e.g. on Cloud Run).
    DB_POOL_SIZE: int = 5          # persistent connections kept alive
    DB_MAX_OVERFLOW: int = 10      # extra connections allowed under load
    DB_POOL_TIMEOUT: int = 30      # seconds to wait for a connection from pool
    DB_POOL_RECYCLE: int = 1800    # recycle connections after 30 min (avoids stale)

    @property
    def async_database_url(self) -> str:
        """
        Build the asyncpg-compatible database URL.
        asyncpg does NOT accept ?sslmode=require — SSL is handled via
        connect_args in the engine instead. Strip any sslmode param here.
        """
        if self.DATABASE_URL:
            url = self.DATABASE_URL.replace(
                "postgresql://", "postgresql+asyncpg://"
            ).replace("postgres://", "postgresql+asyncpg://")
            # Strip sslmode query param — asyncpg handles SSL via connect_args
            import re
            url = re.sub(r"[?&]sslmode=[^&]*", "", url)
            return url
        return (
            f"postgresql+asyncpg://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )

    # ── Google Cloud ──────────────────────────────────────────────────────────
    GOOGLE_CLOUD_PROJECT: str = "your-gcp-project-id"
    GOOGLE_CLOUD_LOCATION: str = "us-central1"
    GOOGLE_APPLICATION_CREDENTIALS: str | None = None  # path to service-account JSON
    GOOGLE_API_KEY: str | None = None  # fallback for local dev

    # ── GCS ───────────────────────────────────────────────────────────────────
    GCS_BUCKET_NAME: str = "insurimax-documents"
    GCS_SIGNED_URL_EXPIRY_MINUTES: int = 30

    # ── Vertex AI / Gemini ────────────────────────────────────────────────────
    GEMINI_MODEL: str = "gemini-1.5-pro-002"
    GEMINI_FLASH_MODEL: str = "gemini-1.5-flash-002"  # for lighter tasks
    VERTEX_AI_ENABLED: bool = False  # True → use Vertex AI, False → use google-generativeai

    # ── SLA ───────────────────────────────────────────────────────────────────
    SLA_HOURS: int = 3  # IRDAI 3-hour rule
    SLA_WARNING_MINUTES: int = 30  # trigger webhook warning

    # ── Auto-approval ─────────────────────────────────────────────────────────
    AUTO_APPROVAL_CONFIDENCE_THRESHOLD: float = 0.92
    AUTO_APPROVAL_MAX_AMOUNT_INR: float = 50_000.0

    # ── CORS ──────────────────────────────────────────────────────────────────
    CORS_ORIGINS: list[str] | str = [
        "http://localhost:5173",
        "http://localhost:3000",
    ]

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Any) -> list[str]:
        if isinstance(v, str):
            v_str = v.strip()
            if not v_str or v_str == "*":
                return ["*"]
            if v_str.startswith("[") and v_str.endswith("]"):
                try:
                    return json.loads(v_str)
                except Exception:
                    pass
            return [origin.strip() for origin in v_str.split(",") if origin.strip()]
        elif isinstance(v, (list, set, tuple)):
            return [str(item).strip() for item in v if item]
        return v

    # ── Observability / OpenTelemetry ─────────────────────────────────────────
    # Exporter: "gcp" (Cloud Trace), "otlp" (any OTLP collector), "console", "none"
    OTEL_EXPORTER: str = "console"
    OTEL_SERVICE_NAME: str = "insurimax-api"
    OTEL_SERVICE_VERSION: str = "1.0.0"
    # OTLP endpoint when OTEL_EXPORTER=otlp (e.g. local collector or Grafana Cloud)
    OTEL_EXPORTER_OTLP_ENDPOINT: str = "http://localhost:4317"
    # Sampling ratio 0.0-1.0 (1.0 = trace every request, 0.1 = 10%)
    OTEL_SAMPLE_RATE: float = 1.0


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
