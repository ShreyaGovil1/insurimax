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

def _create_token(data: dict[str, Any], expires_delta: timedelta) -> str:
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
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
