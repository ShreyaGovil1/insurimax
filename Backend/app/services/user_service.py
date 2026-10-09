"""
User and auth service.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, create_refresh_token, hash_password, verify_password
from app.core.telemetry import add_span_attributes, get_tracer
from app.models.user import Organization, OrgType, User, UserRole
from app.schemas.user import OrganizationCreate, RegisterOrgRequest, UserCreate

_tracer = get_tracer(__name__)


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
    with _tracer.start_as_current_span("auth.authenticate_user") as span:
        span.set_attribute("user.email_domain", email.split("@")[-1])

        with _tracer.start_as_current_span("auth.db_lookup"):
            user = await get_user_by_email(db, email)

        if not user:
            span.set_attribute("auth.result", "user_not_found")
            return None

        with _tracer.start_as_current_span("auth.bcrypt_verify"):
            password_ok = verify_password(password, user.hashed_password)

        if not password_ok:
            span.set_attribute("auth.result", "wrong_password")
            return None

        if not user.is_active:
            span.set_attribute("auth.result", "inactive_user")
            return None

        span.set_attribute("auth.result", "success")
        span.set_attribute("user.role", user.role.value)

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


async def list_users(
    db: AsyncSession,
    search: str | None = None,
    role: UserRole | None = None,
    is_active: bool | None = None,
    skip: int = 0,
    limit: int = 50,
) -> tuple[list[User], int]:
    conditions = []
    if search:
        like = f"%{search.strip()}%"
        conditions.append(or_(User.email.ilike(like), User.full_name.ilike(like)))
    if role is not None:
        conditions.append(User.role == role)
    if is_active is not None:
        conditions.append(User.is_active == is_active)

    total = (
        await db.execute(select(func.count()).select_from(User).where(*conditions))
    ).scalar_one()
    result = await db.execute(
        select(User).where(*conditions).order_by(User.created_at.desc()).offset(skip).limit(limit)
    )
    return list(result.scalars().all()), total


async def admin_update_user(db: AsyncSession, user: User, changes: dict) -> User:
    for key, value in changes.items():
        setattr(user, key, value)
    await db.flush()
    return user


async def reset_user_password(db: AsyncSession, user: User, new_password: str) -> None:
    user.hashed_password = hash_password(new_password)
    await db.flush()


async def count_active_admins(db: AsyncSession) -> int:
    return (
        await db.execute(
            select(func.count()).select_from(User).where(
                User.role == UserRole.ADMIN, User.is_active.is_(True)
            )
        )
    ).scalar_one()


async def get_admin_stats(db: AsyncSession) -> dict:
    role_rows = (await db.execute(select(User.role, func.count()).group_by(User.role))).all()
    active = (
        await db.execute(select(func.count()).select_from(User).where(User.is_active.is_(True)))
    ).scalar_one()
    total = sum(c for _, c in role_rows)
    orgs = (await db.execute(select(func.count()).select_from(Organization))).scalar_one()
    by_role = {r.value: 0 for r in UserRole}
    for r, c in role_rows:
        by_role[r.value] = c
    return {
        "total_users": total,
        "active_users": active,
        "inactive_users": total - active,
        "users_by_role": by_role,
        "total_organizations": orgs,
    }


async def list_organizations(db: AsyncSession) -> list[Organization]:
    result = await db.execute(select(Organization).order_by(Organization.name))
    return list(result.scalars().all())
