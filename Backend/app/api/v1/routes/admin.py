"""
Admin routes (role: admin only).

GET    /admin/stats
GET    /admin/users
POST   /admin/users
GET    /admin/users/{userId}
PATCH  /admin/users/{userId}
POST   /admin/users/{userId}/reset-password
GET    /admin/organizations
POST   /admin/organizations
PATCH  /admin/organizations/{orgId}
GET    /admin/ai-models
PUT    /admin/ai-models
"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.deps import DBSession, require_roles
from app.models.user import User, UserRole
from app.schemas.common import MessageResponse
from app.schemas.user import (
    AdminOrganizationUpdate,
    AdminPasswordReset,
    AdminStats,
    AdminUserUpdate,
    OrganizationCreate,
    OrganizationRead,
    UserCreate,
    UserListResponse,
    UserRead,
)
from app.schemas.ai_models import AIModelSettings, AIModelSettingsUpdate
from app.services import ai_model_service, user_service

AdminUser = Annotated[User, Depends(require_roles(UserRole.ADMIN))]

router = APIRouter(prefix="/admin", tags=["Admin"])


async def _get_or_404(db, user_id: uuid.UUID) -> User:
    user = await user_service.get_user(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.get("/stats", response_model=AdminStats)
async def get_stats(db: DBSession, _admin: AdminUser):
    return await user_service.get_admin_stats(db)


@router.get("/users", response_model=UserListResponse)
async def list_users(
    db: DBSession,
    _admin: AdminUser,
    search: str | None = None,
    role: UserRole | None = None,
    is_active: bool | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    items, total = await user_service.list_users(db, search, role, is_active, skip, limit)
    return {"items": items, "total": total}


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(body: UserCreate, db: DBSession, _admin: AdminUser):
    """Create a user with any role."""
    try:
        return await user_service.create_user(db, body)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


@router.get("/users/{user_id}", response_model=UserRead)
async def get_user(user_id: uuid.UUID, db: DBSession, _admin: AdminUser):
    return await _get_or_404(db, user_id)


@router.patch("/users/{user_id}", response_model=UserRead)
async def update_user(
    user_id: uuid.UUID, body: AdminUserUpdate, db: DBSession, admin: AdminUser
):
    """Update name, role, active/verified flags or organisation."""
    user = await _get_or_404(db, user_id)
    changes = body.model_dump(exclude_unset=True)

    if "role" in changes and changes["role"] is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="role cannot be null")
    if "is_active" in changes and changes["is_active"] is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="is_active cannot be null")

    if user.id == admin.id:
        if changes.get("role", user.role) != UserRole.ADMIN:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="You cannot change your own admin role")
        if changes.get("is_active", True) is False:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="You cannot deactivate your own account")

    removes_admin = user.role == UserRole.ADMIN and user.is_active and (
        changes.get("role", user.role) != UserRole.ADMIN or changes.get("is_active", True) is False
    )
    if removes_admin and await user_service.count_active_admins(db) <= 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Cannot remove the last active admin")

    return await user_service.admin_update_user(db, user, changes)


@router.post("/users/{user_id}/reset-password", response_model=MessageResponse)
async def reset_password(
    user_id: uuid.UUID, body: AdminPasswordReset, db: DBSession, _admin: AdminUser
):
    user = await _get_or_404(db, user_id)
    await user_service.reset_user_password(db, user, body.password)
    return {"message": "Password reset successfully"}


@router.get("/organizations", response_model=list[OrganizationRead])
async def list_organizations(db: DBSession, _admin: AdminUser):
    return await user_service.list_organizations(db)


@router.post(
    "/organizations",
    response_model=OrganizationRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_organization(body: OrganizationCreate, db: DBSession, _admin: AdminUser):
    return await user_service.create_organization(db, body)


@router.patch("/organizations/{org_id}", response_model=OrganizationRead)
async def update_organization(
    org_id: uuid.UUID, body: AdminOrganizationUpdate, db: DBSession, _admin: AdminUser
):
    """Change an organisation's name, type or active flag."""
    org = await user_service.get_organization(db, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    changes = body.model_dump(exclude_unset=True)
    if any(v is None for v in changes.values()):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Fields cannot be null")
    for key, value in changes.items():
        setattr(org, key, value)
    await db.flush()
    return org


# ── AI models ─────────────────────────────────────────────────────────────────

@router.get("/ai-models", response_model=AIModelSettings)
async def get_ai_models(
    db: DBSession,
    _admin: AdminUser,
    refresh: bool = Query(False, description="Re-fetch the models available on the Google account"),
):
    """The Gemini model each AI step uses, and the models an admin can choose from."""
    return await ai_model_service.get_config(db, refresh=refresh)


@router.put("/ai-models", response_model=AIModelSettings)
async def update_ai_models(body: AIModelSettingsUpdate, db: DBSession, admin: AdminUser):
    """Choose the Gemini model per AI step. A null model resets that step to its default."""
    try:
        return await ai_model_service.update_config(db, body.models, admin.id)
    except ai_model_service.InvalidModelChoice as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
