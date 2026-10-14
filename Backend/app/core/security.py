"""
JWT creation/verification and password hashing utilities.
"""
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings

# bcrypt hard-limits input to 72 bytes. Newer versions of the bcrypt package
# raise ValueError instead of silently truncating, so we handle the slice
# ourselves — in bytes, not characters, to handle multi-byte Unicode correctly.
_BCRYPT_MAX_BYTES = 72


def _prepare_password(password: str) -> bytes:
    """Encode to UTF-8 and truncate to 72 bytes, safely handling multi-byte chars."""
    encoded = password.encode("utf-8")
    if len(encoded) > _BCRYPT_MAX_BYTES:
        encoded = encoded[:_BCRYPT_MAX_BYTES]
        # Drop any partial multi-byte sequence at the cut point
        encoded = encoded.decode("utf-8", errors="ignore").encode("utf-8")
    return encoded


# ── Password helpers ──────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    pw_bytes = _prepare_password(password)
    return bcrypt.hashpw(pw_bytes, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    pw_bytes = _prepare_password(plain)
    return bcrypt.checkpw(pw_bytes, hashed.encode("utf-8"))


# ── JWT helpers ───────────────────────────────────────────────────────────────

# Keys published in this repository (old config default, .env.example, deployment
# guide): anyone can read them, so they must never sign or verify tokens.
_PUBLISHED_SECRET_KEYS = frozenset({
    "change-me-in-production-use-a-long-random-string",
    "your-super-secret-jwt-key-change-me-in-production",
    "change-to-a-secure-random-32-char-string",
})
# deploy_cloud_run.ps1 used to default to this prefix plus Get-Random (~2^31 values).
_PUBLISHED_SECRET_KEY_PREFIXES = ("insurimax-production-secret-key-",)
_MIN_SECRET_KEY_BYTES = 32


def ensure_secret_key_is_secure() -> None:
    """Raise RuntimeError if SECRET_KEY is missing, published or too short.

    The error message never includes the key itself.
    """
    key = settings.SECRET_KEY.strip()
    if not key:
        problem = "is not set"
    elif key in _PUBLISHED_SECRET_KEYS or key.startswith(_PUBLISHED_SECRET_KEY_PREFIXES):
        problem = "is a publicly known placeholder"
    elif len(key.encode("utf-8")) < _MIN_SECRET_KEY_BYTES:
        problem = f"is shorter than {_MIN_SECRET_KEY_BYTES} bytes"
    else:
        return
    raise RuntimeError(
        f"SECRET_KEY {problem}; refusing to sign or verify JWTs with it. "
        "Set SECRET_KEY (environment or Backend/.env) to a random value, e.g. the output of: "
        "python -c \"import secrets; print(secrets.token_urlsafe(64))\""
    )


def _create_token(data: dict[str, Any], expires_delta: timedelta) -> str:
    ensure_secret_key_is_secure()
    payload = data.copy()
    payload["exp"] = datetime.now(timezone.utc) + expires_delta
    payload["iat"] = datetime.now(timezone.utc)
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_access_token(subject: str, extra: dict[str, Any] | None = None) -> str:
    data: dict[str, Any] = {"sub": subject, "type": "access"}
    if extra:
        data.update(extra)
    return _create_token(data, timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))


def create_refresh_token(subject: str) -> str:
    data: dict[str, Any] = {"sub": subject, "type": "refresh"}
    return _create_token(data, timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS))


def decode_token(token: str) -> dict[str, Any]:
    """Raises JWTError on invalid/expired tokens."""
    ensure_secret_key_is_secure()
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
