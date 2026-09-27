"""
User and Organization Pydantic schemas.
"""
import uuid
from datetime import datetime

from pydantic import EmailStr, Field, field_validator

from app.models.user import OrgType, UserRole
from app.schemas.common import BaseSchema


# ── Organization ─────────────────────────────────────────────────────────────

class OrganizationCreate(BaseSchema):
    name: str = Field(..., min_length=2, max_length=255)
    org_type: OrgType
    gstin: str | None = None
    address: str | None = None
    contact_email: EmailStr | None = None
    contact_phone: str | None = None


class OrganizationRead(BaseSchema):
    id: uuid.UUID
    name: str
    org_type: OrgType
    gstin: str | None
    contact_email: str | None
    is_active: bool
    created_at: datetime


class OrganizationUpdate(BaseSchema):
    name: str | None = None
    gstin: str | None = None
    address: str | None = None
    contact_email: EmailStr | None = None
    contact_phone: str | None = None
    auto_approval_confidence_threshold: float | None = Field(None, ge=0.0, le=1.0)
    auto_approval_max_amount_inr: float | None = Field(None, ge=0.0)


# ── User ──────────────────────────────────────────────────────────────────────

class UserCreate(BaseSchema):
    email: EmailStr
    password: str = Field(..., min_length=8)
    full_name: str = Field(..., min_length=2, max_length=255)
    role: UserRole = UserRole.ADJUSTER
    org_id: uuid.UUID | None = None

    @field_validator("password")
    @classmethod
    def password_fits_bcrypt(cls, v: str) -> str:
        if len(v.encode("utf-8")) > 72:
            raise ValueError(
                "Password must be 72 bytes or fewer (bcrypt limit). "
                "Shorten your password."
            )
        return v


class UserRead(BaseSchema):
    id: uuid.UUID
    email: str
    full_name: str
    role: UserRole
    org_id: uuid.UUID | None
    is_active: bool
    is_verified: bool
    last_login_at: datetime | None
    created_at: datetime


class UserUpdate(BaseSchema):
    full_name: str | None = None
    role: UserRole | None = None
    is_active: bool | None = None


# ── Auth ──────────────────────────────────────────────────────────────────────

class LoginRequest(BaseSchema):
    email: EmailStr
    password: str


class TokenResponse(BaseSchema):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds


class RefreshRequest(BaseSchema):
    refresh_token: str


class RegisterOrgRequest(BaseSchema):
    """Register an organisation AND its first admin user in one call."""
    org: OrganizationCreate
    admin_user: UserCreate


class RegisterRequest(BaseSchema):
    """Standalone user self-registration (no org creation required)."""
    email: EmailStr
    password: str = Field(..., min_length=8)
    full_name: str = Field(..., min_length=2, max_length=255)
    org_id: uuid.UUID | None = None  # optionally join an existing org

    @field_validator("password")
    @classmethod
    def password_fits_bcrypt(cls, v: str) -> str:
        if len(v.encode("utf-8")) > 72:
            raise ValueError(
                "Password must be 72 bytes or fewer (bcrypt limit). "
                "Shorten your password."
            )
        return v


class RegisterResponse(BaseSchema):
    user: UserRead
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
