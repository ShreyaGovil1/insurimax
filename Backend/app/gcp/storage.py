"""
Google Cloud Storage client wrapper.
Handles document upload, signed URL generation, and deletion.
"""
import asyncio
import mimetypes
import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import BinaryIO

from google.cloud import storage
from google.cloud.storage import Blob

from app.core.config import settings


@lru_cache
def _get_gcs_client() -> storage.Client:
    """Cached GCS client — constructed once per process."""
    if settings.GOOGLE_APPLICATION_CREDENTIALS:
        return storage.Client.from_service_account_json(
            settings.GOOGLE_APPLICATION_CREDENTIALS,
            project=settings.GOOGLE_CLOUD_PROJECT,
        )
    # In GCP (Cloud Run / GCE) this picks up the attached service account automatically
    return storage.Client(project=settings.GOOGLE_CLOUD_PROJECT)


def _get_bucket() -> storage.Bucket:
    return _get_gcs_client().bucket(settings.GCS_BUCKET_NAME)


# ── Upload ────────────────────────────────────────────────────────────────────

async def upload_file(
    file_data: bytes,
    object_key: str,
    content_type: str | None = None,
) -> dict:
    """
    Upload raw bytes to GCS.

    Returns:
        {"bucket": str, "object_key": str, "gcs_uri": str, "size_bytes": int}
    """
    loop = asyncio.get_event_loop()

    def _upload() -> dict:
        bucket = _get_bucket()
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

    return await loop.run_in_executor(None, _upload)


def build_object_key(claim_id: uuid.UUID, doc_type: str, filename: str) -> str:
    """
    Build a deterministic GCS key.
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
    """Generate a V4 signed URL for temporary read access."""
    loop = asyncio.get_event_loop()
    expiry = expiry_minutes or settings.GCS_SIGNED_URL_EXPIRY_MINUTES

    def _sign() -> str:
        bucket = _get_bucket()
        blob: Blob = bucket.blob(object_key)
        return blob.generate_signed_url(
            expiration=timedelta(minutes=expiry),
            method="GET",
            version="v4",
        )

    return await loop.run_in_executor(None, _sign)


# ── Delete ────────────────────────────────────────────────────────────────────

async def delete_object(object_key: str) -> bool:
    """Delete a GCS object. Returns True if deleted, False if not found."""
    loop = asyncio.get_event_loop()

    def _delete() -> bool:
        bucket = _get_bucket()
        blob: Blob = bucket.blob(object_key)
        if blob.exists():
            blob.delete()
            return True
        return False

    return await loop.run_in_executor(None, _delete)


# ── Download ──────────────────────────────────────────────────────────────────

async def download_as_bytes(object_key: str) -> bytes:
    """Download GCS object content as bytes (used for Gemini multimodal input)."""
    loop = asyncio.get_event_loop()

    def _download() -> bytes:
        bucket = _get_bucket()
        blob: Blob = bucket.blob(object_key)
        return blob.download_as_bytes()

    return await loop.run_in_executor(None, _download)


async def get_object_metadata(object_key: str) -> dict | None:
    """Return basic metadata for a GCS object, or None if not found."""
    loop = asyncio.get_event_loop()

    def _meta() -> dict | None:
        bucket = _get_bucket()
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

    return await loop.run_in_executor(None, _meta)
