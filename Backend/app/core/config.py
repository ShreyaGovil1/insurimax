"""
Application configuration using pydantic-settings.
Values are loaded from environment variables / .env files.
"""
from functools import lru_cache
from typing import Literal

from pydantic import Field
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
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # ── Database (Cloud SQL / AlloyDB - PostgreSQL wire protocol) ────────────
    # Use Cloud SQL Auth Proxy socket path in GCP, or a direct URL locally
    DB_HOST: str = "127.0.0.1"
    DB_PORT: int = 5432
    DB_NAME: str = "insurimax"
    DB_USER: str = "postgres"
    DB_PASSWORD: str = "postgres"
    # Override the whole URL if preferred (takes precedence)
    DATABASE_URL: str | None = None

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
    CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
    ]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
