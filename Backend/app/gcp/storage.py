"""
Google Cloud Storage client wrapper.
Handles document upload, signed URL generation, and deletion.
Automatically falls back to local disk storage in development when GCP credentials are not available.
"""
import asyncio
import base64
import logging
import mimetypes
import os
from pathlib import Path
import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import BinaryIO

from google.cloud import storage
from google.cloud.storage import Blob
from google.auth.credentials import AnonymousCredentials

from app.core.config import settings

logger = logging.getLogger(__name__)

LOCAL_STORAGE_DIR = Path(__file__).resolve().parent.parent.parent / "storage_local"


@lru_cache
def _get_gcs_client() -> storage.Client | None:
    """
    Cached GCS client — constructed once per process.
    Returns None if GCP credentials are not configured (enables local storage fallback).
    """
    if settings.GOOGLE_APPLICATION_CREDENTIALS and Path(settings.GOOGLE_APPLICATION_CREDENTIALS).exists():
        try:
            return storage.Client.from_service_account_json(
                settings.GOOGLE_APPLICATION_CREDENTIALS,
                project=settings.GOOGLE_CLOUD_PROJECT,
            )
        except Exception as exc:
            logger.warning("Failed to load service account JSON: %s", exc)

    # If running against local fake-gcs-server emulator
    if os.environ.get("STORAGE_EMULATOR_HOST"):
        return storage.Client(
            project=settings.GOOGLE_CLOUD_PROJECT or "test",
            credentials=AnonymousCredentials(),
        )

    # In GCP environment (Cloud Run / GCE) where metadata server exists
    if os.environ.get("K_SERVICE") or os.environ.get("K_REVISION") or settings.ENVIRONMENT == "production":
        try:
            return storage.Client(project=settings.GOOGLE_CLOUD_PROJECT)
        except Exception as exc:
            logger.warning("Cloud Run GCS client initialization error: %s", exc)

    # In local development, check if ADC credentials actually exist before attempting connection
    try:
        import google.auth
        credentials, _ = google.auth.default()
        return storage.Client(project=settings.GOOGLE_CLOUD_PROJECT, credentials=credentials)
    except Exception as exc:
        logger.info(
            "GCS credentials not present locally (%s). Using local filesystem storage at %s",
            exc,
            LOCAL_STORAGE_DIR,
        )
        return None


def _get_bucket() -> storage.Bucket | None:
    client = _get_gcs_client()
    if client is None:
        return None
    try:
        return client.bucket(settings.GCS_BUCKET_NAME)
    except Exception:
        return None


# ── Upload ────────────────────────────────────────────────────────────────────

async def upload_file(
    file_data: bytes,
    object_key: str,
    content_type: str | None = None,
) -> dict:
    """
    Upload raw bytes to GCS or local filesystem storage fallback.

    Returns:
        {"bucket": str, "object_key": str, "gcs_uri": str, "size_bytes": int}
    """
    loop = asyncio.get_event_loop()

    def _upload() -> dict:
        bucket = _get_bucket()
        if bucket is not None:
            try:
                blob: Blob = bucket.blob(object_key)
                blob.upload_from_string(
                    file_data,
                    content_type=content_type or "application/octet-stream",
                )
                return {
                    "bucket": settings.GCS_BUCKET_NAME,
                    "object_key": object_key,
                    "gcs_uri": f"gs://{settings.GCS_BUCKET_NAME}/{object_key}",
                    "size_bytes": len(file_data),
                }
            except Exception as exc:
                logger.warning("GCS upload failed (%s); falling back to local disk storage", exc)

        # Local storage fallback
        local_path = LOCAL_STORAGE_DIR / object_key
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(file_data)
        return {
            "bucket": "local-storage",
            "object_key": object_key,
            "gcs_uri": f"file://{local_path.as_posix()}",
            "size_bytes": len(file_data),
        }

    return await loop.run_in_executor(None, _upload)


def build_object_key(claim_id: uuid.UUID, doc_type: str, filename: str) -> str:
    """
    Build a deterministic object key.
    Pattern: claims/<claim_id>/<doc_type>/<uuid>_<filename>
    """
    safe_filename = filename.replace(" ", "_")
    unique_prefix = str(uuid.uuid4())[:8]
    return f"claims/{claim_id}/{doc_type}/{unique_prefix}_{safe_filename}"


def build_policy_object_key(policy_id: uuid.UUID, version_id: uuid.UUID, filename: str) -> str:
    safe_filename = filename.replace(" ", "_")
    return f"policies/{policy_id}/versions/{version_id}/{safe_filename}"


# ── Signed URL ────────────────────────────────────────────────────────────────

async def generate_signed_url(object_key: str, expiry_minutes: int | None = None) -> str:
    """Generate a V4 signed URL for temporary read access or local data URI fallback."""
    loop = asyncio.get_event_loop()
    expiry = expiry_minutes or settings.GCS_SIGNED_URL_EXPIRY_MINUTES

    def _sign() -> str:
        bucket = _get_bucket()
        if bucket is not None:
            try:
                blob: Blob = bucket.blob(object_key)
                return blob.generate_signed_url(
                    expiration=timedelta(minutes=expiry),
                    method="GET",
                    version="v4",
                )
            except Exception as exc:
                logger.warning("GCS signed URL generation failed (%s); using local data URI fallback", exc)

        local_path = LOCAL_STORAGE_DIR / object_key
        if local_path.exists():
            mime = mimetypes.guess_type(local_path.name)[0] or "application/pdf"
            b64 = base64.b64encode(local_path.read_bytes()).decode("utf-8")
            return f"data:{mime};base64,{b64}"

        return f"/local-storage/{object_key}"

    return await loop.run_in_executor(None, _sign)


# ── Delete ────────────────────────────────────────────────────────────────────

async def delete_object(object_key: str) -> bool:
    """Delete an object from GCS and/or local storage. Returns True if deleted."""
    loop = asyncio.get_event_loop()

    def _delete() -> bool:
        deleted = False
        local_path = LOCAL_STORAGE_DIR / object_key
        if local_path.exists():
            try:
                local_path.unlink()
                deleted = True
            except Exception:
                pass

        bucket = _get_bucket()
        if bucket is not None:
            try:
                blob: Blob = bucket.blob(object_key)
                if blob.exists():
                    blob.delete()
                    deleted = True
            except Exception:
                pass

        return deleted

    return await loop.run_in_executor(None, _delete)


# ── Download ──────────────────────────────────────────────────────────────────

async def download_as_bytes(object_key: str) -> bytes:
    """Download object content as bytes (used for Gemini multimodal input)."""
    loop = asyncio.get_event_loop()

    def _download() -> bytes:
        # Check local storage first if present
        local_path = LOCAL_STORAGE_DIR / object_key
        if local_path.exists():
            return local_path.read_bytes()

        bucket = _get_bucket()
        if bucket is not None:
            blob: Blob = bucket.blob(object_key)
            return blob.download_as_bytes()

        raise FileNotFoundError(f"Document object '{object_key}' not found in storage")

    return await loop.run_in_executor(None, _download)


async def get_object_metadata(object_key: str) -> dict | None:
    """Return basic metadata for an object, or None if not found."""
    loop = asyncio.get_event_loop()

    def _meta() -> dict | None:
        local_path = LOCAL_STORAGE_DIR / object_key
        if local_path.exists():
            stat = local_path.stat()
            mime = mimetypes.guess_type(local_path.name)[0] or "application/octet-stream"
            return {
                "size": stat.st_size,
                "content_type": mime,
                "updated": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
                "md5_hash": None,
            }

        bucket = _get_bucket()
        if bucket is not None:
            try:
                blob: Blob = bucket.blob(object_key)
                if not blob.exists():
                    return None
                blob.reload()
                return {
                    "size": blob.size,
                    "content_type": blob.content_type,
                    "updated": blob.updated,
                    "md5_hash": blob.md5_hash,
                }
            except Exception:
                pass

        return None

    return await loop.run_in_executor(None, _meta)
