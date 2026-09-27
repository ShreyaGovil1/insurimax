"""
Auth & Identity routes.

POST   /auth/login
POST   /auth/logout
POST   /auth/refresh
GET    /auth/me
POST   /auth/register-org
GET    /users/{userId}
PATCH  /users/{userId}/role
"""
import uuid

from fastapi import APIRouter, HTTPException, status
from jose import JWTError

from app.core.deps import CurrentUser, DBSession
from app.core.security import decode_token
from app.models.user import UserRole
from app.schemas.common import MessageResponse
from app.schemas.user import (
    LoginRequest,
    RefreshRequest,
    RegisterOrgRequest,
    RegisterRequest,
    RegisterResponse,
    TokenResponse,
    UserRead,
    UserUpdate,
)
from app.services import user_service

router = APIRouter(prefix="/auth", tags=["Auth & Identity"])
users_router = APIRouter(prefix="/users", tags=["Auth & Identity"])


# ── Auth endpoints ────────────────────────────────────────────────────────────

@router.post(
    "/register",
    response_model=RegisterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user account",
)
async def register(body: RegisterRequest, db: DBSession):
    """
    Create a new user account and return tokens so the user is
    immediately signed in after registration.

    - Role defaults to `adjuster`; users cannot self-assign admin/senior roles.
    - Optionally supply `org_id` to join an existing organisation.
    - To create a brand-new organisation at the same time, use
      `POST /auth/register-org` instead.
    """
    from app.schemas.user import UserCreate

    user_data = UserCreate(
        email=body.email,
        password=body.password,
        full_name=body.full_name,
        role=UserRole.ADJUSTER,   # self-registered users always start as adjuster
        org_id=body.org_id,
    )

    try:
        user = await user_service.create_user(db, user_data)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))

    tokens = user_service.generate_tokens(user)
    return RegisterResponse(
        user=UserRead.model_validate(user),
        access_token=tokens["access_token"],
        refresh_token=tokens["refresh_token"],
        token_type=tokens["token_type"],
        expires_in=tokens["expires_in"],
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: DBSession):
    """Authenticate with email + password, receive JWT tokens."""
    user = await user_service.authenticate_user(db, body.email, body.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    return user_service.generate_tokens(user)


@router.post("/logout", response_model=MessageResponse)
async def logout(current_user: CurrentUser):
    """
    Stateless JWT logout — client should discard tokens.
    For production, maintain a token denylist in Redis / Firestore.
    """
    return {"message": "Logged out successfully"}


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(body: RefreshRequest, db: DBSession):
    """Exchange a refresh token for a new access token."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired refresh token",
    )
    try:
        payload = decode_token(body.refresh_token)
        if payload.get("type") != "refresh":
            raise credentials_exception
        subject: str = payload.get("sub", "")
        if not subject:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = await user_service.get_user(db, uuid.UUID(subject))
    if not user or not user.is_active:
        raise credentials_exception

    return user_service.generate_tokens(user)


@router.get("/me", response_model=UserRead)
async def get_me(current_user: CurrentUser):
    """Return the currently authenticated user's profile."""
    return current_user


@router.post(
    "/register-org",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
async def register_org(body: RegisterOrgRequest, db: DBSession):
    """
    Onboard a new TPA / hospital organisation and its first admin user.
    Returns org details + auth tokens so the admin is immediately signed in.
    """
    try:
        org, user = await user_service.register_org_with_admin(db, body)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))

    tokens = user_service.generate_tokens(user)
    return {
        "org_id": str(org.id),
        "org_name": org.name,
        "user_id": str(user.id),
        **tokens,
    }


# ── User management endpoints ─────────────────────────────────────────────────

@users_router.get("/{user_id}", response_model=UserRead)
async def get_user(
    user_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
):
    """Fetch a user by ID. Admins can fetch any user; others can only fetch themselves."""
    if current_user.role != UserRole.ADMIN and current_user.id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    user = await user_service.get_user(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@users_router.patch("/{user_id}/role", response_model=UserRead)
async def update_user_role(
    user_id: uuid.UUID,
    body: UserUpdate,
    db: DBSession,
    current_user: CurrentUser,
):
    """Update a user's role. Admin only."""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    if body.role is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="role field is required",
        )

    user = await user_service.update_user_role(db, user_id, body.role)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user
