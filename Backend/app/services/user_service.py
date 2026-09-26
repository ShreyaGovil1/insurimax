"""
User and auth service.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, create_refresh_token, hash_password, verify_password
from app.models.user import Organization, OrgType, User, UserRole
from app.schemas.user import OrganizationCreate, RegisterOrgRequest, UserCreate


async def create_organization(db: AsyncSession, data: OrganizationCreate) -> Organization:
    org = Organization(**data.model_dump())
    db.add(org)
    await db.flush()
    return org


async def get_organization(db: AsyncSession, org_id: uuid.UUID) -> Organization | None:
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    return result.scalar_one_or_none()


async def create_user(db: AsyncSession, data: UserCreate) -> User:
    # Check uniqueness
    existing = await db.execute(select(User).where(User.email == data.email))
    if existing.scalar_one_or_none():
        raise ValueError("Email already registered")

    user = User(
        email=data.email,
        hashed_password=hash_password(data.password),
        full_name=data.full_name,
        role=data.role,
        org_id=data.org_id,
    )
    db.add(user)
    await db.flush()
    return user


async def get_user(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def authenticate_user(db: AsyncSession, email: str, password: str) -> User | None:
    user = await get_user_by_email(db, email)
    if not user:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    if not user.is_active:
        return None

    # Update last login
    user.last_login_at = datetime.now(timezone.utc)
    await db.flush()
    return user


def generate_tokens(user: User) -> dict:
    extra = {"role": user.role.value, "org_id": str(user.org_id) if user.org_id else None}
    access_token = create_access_token(str(user.id), extra=extra)
    refresh_token = create_refresh_token(str(user.id))
    from app.core.config import settings
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }


async def register_org_with_admin(
    db: AsyncSession, request: RegisterOrgRequest
) -> tuple[Organization, User]:
    org = await create_organization(db, request.org)

    # Force admin role for the initial org admin
    user_data = request.admin_user.model_copy(
        update={"org_id": org.id, "role": UserRole.ADMIN}
    )
    user = await create_user(db, user_data)
    return org, user


async def update_user_role(
    db: AsyncSession, user_id: uuid.UUID, role: UserRole
) -> User | None:
    user = await get_user(db, user_id)
    if not user:
        return None
    user.role = role
    await db.flush()
    return user
