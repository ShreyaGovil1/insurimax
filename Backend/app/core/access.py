"""
Claim-level data isolation.

- admin / senior_adjuster / adjuster (TPA staff) work claims from every hospital.
- hospital_desk users only ever see claims of their own hospital organization.
- everyone else (e.g. patients) has no access through the staff/hospital claim APIs.

Inaccessible claims are reported as 404 so one hospital cannot probe another's claim IDs.
"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.claim import Claim
from sqlalchemy import select

from app.models.user import Organization, OrgType, User, UserRole

STAFF_ROLES = (UserRole.ADMIN, UserRole.SENIOR_ADJUSTER, UserRole.ADJUSTER)


def can_access_claim(user: User, claim: Claim) -> bool:
    if user.role in STAFF_ROLES:
        return True
    if user.role == UserRole.HOSPITAL_DESK:
        return user.org_id is not None and claim.hospital_org_id == user.org_id
    return False


async def insurer_scope(db: AsyncSession, user: User) -> uuid.UUID | None:
    """
    Staff who belong to an INSURER organization only work that insurer's claims.
    Returns that insurer's org id, or None when the user is not insurer-scoped.
    """
    if user.role not in STAFF_ROLES or user.org_id is None:
        return None
    org_type = (
        await db.execute(select(Organization.org_type).where(Organization.id == user.org_id))
    ).scalar_one_or_none()
    return user.org_id if org_type == OrgType.INSURER else None


async def require_claim_access(db: AsyncSession, claim_id: uuid.UUID, user: User) -> Claim:
    from app.services import claim_service  # local import avoids a circular dependency

    claim = await claim_service.get_claim(db, claim_id)
    allowed = bool(claim) and can_access_claim(user, claim)
    if allowed:
        scope = await insurer_scope(db, user)
        allowed = scope is None or claim.insurer_org_id == scope
    if not allowed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")
    return claim
