"""
Policy Library routes.

POST   /policies
GET    /policies
GET    /policies/{policyId}
POST   /policies/{policyId}/versions
GET    /policies/{policyId}/versions/{versionId}
GET    /policies/{policyId}/versions/{versionId}/rules
PATCH  /policies/{policyId}/versions/{versionId}/rules
GET    /policies/{policyId}/versions/{versionId}/clauses/{ruleId}
POST   /policies/{policyId}/versions/{versionId}/extract-rules
GET    /non-payable-items
POST   /non-payable-items
"""
import math
import uuid

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status

from app.core.deps import AdjusterOrAbove, CurrentUser, DBSession
from app.schemas.common import MessageResponse, PaginatedResponse
from app.schemas.policy import (
    NonPayableItemCreate,
    NonPayableItemRead,
    PolicyCreate,
    PolicyRead,
    PolicyRulePatch,
    PolicyRuleRead,
    PolicyVersionCreate,
    PolicyVersionRead,
)
from app.services import policy_service

router = APIRouter(tags=["Policy Library"])


# ── Policy ────────────────────────────────────────────────────────────────────

@router.post("/policies", response_model=PolicyRead, status_code=status.HTTP_201_CREATED)
async def create_policy(body: PolicyCreate, db: DBSession, current_user: AdjusterOrAbove):
    policy = await policy_service.create_policy(db, body)
    return policy


@router.get("/policies", response_model=PaginatedResponse[PolicyRead])
async def list_policies(
    db: DBSession,
    current_user: CurrentUser,
    insurer_name: str | None = Query(None),
    org_id: uuid.UUID | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    policies, total = await policy_service.list_policies(
        db, insurer_name=insurer_name, org_id=org_id, page=page, page_size=page_size
    )
    return PaginatedResponse(
        items=policies,
        total=total,
        page=page,
        page_size=page_size,
        pages=math.ceil(total / page_size) if total else 0,
    )


@router.get("/policies/{policy_id}", response_model=PolicyRead)
async def get_policy(policy_id: uuid.UUID, db: DBSession, current_user: CurrentUser):
    policy = await policy_service.get_policy(db, policy_id)
    if not policy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Policy not found")
    return policy


# ── PolicyVersion ─────────────────────────────────────────────────────────────

@router.post(
    "/policies/{policy_id}/versions",
    response_model=PolicyVersionRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_policy_version(
    policy_id: uuid.UUID,
    db: DBSession,
    current_user: AdjusterOrAbove,
    version_number: str = Form(...),
    effective_from: str | None = Form(None),
    effective_to: str | None = Form(None),
    sum_insured_inr: float | None = Form(None),
    is_current: bool = Form(False),
    file: UploadFile | None = File(None),
):
    """
    Create a new policy version, optionally uploading the PDF.
    The PDF is stored in GCS; Gemini rule extraction runs separately via /extract-rules.
    """
    from datetime import datetime

    eff_from = datetime.fromisoformat(effective_from) if effective_from else None
    eff_to = datetime.fromisoformat(effective_to) if effective_to else None

    version_data = PolicyVersionCreate(
        version_number=version_number,
        effective_from=eff_from,
        effective_to=eff_to,
        sum_insured_inr=sum_insured_inr,
        is_current=is_current,
    )

    file_data = None
    filename = None
    mime_type = None
    if file:
        file_data = await file.read()
        filename = file.filename
        mime_type = file.content_type

    version = await policy_service.create_policy_version(
        db, policy_id, version_data, file_data, filename, mime_type
    )
    return version


@router.get(
    "/policies/{policy_id}/versions/{version_id}",
    response_model=PolicyVersionRead,
)
async def get_policy_version(
    policy_id: uuid.UUID,
    version_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
):
    version = await policy_service.get_policy_version(db, version_id)
    if not version or version.policy_id != policy_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Policy version not found"
        )
    return version


@router.post(
    "/policies/{policy_id}/versions/{version_id}/extract-rules",
    response_model=PolicyVersionRead,
    status_code=status.HTTP_202_ACCEPTED,
)
async def extract_policy_rules(
    policy_id: uuid.UUID,
    version_id: uuid.UUID,
    db: DBSession,
    current_user: AdjusterOrAbove,
):
    """
    Trigger Gemini to extract structured rules from the uploaded policy PDF.
    Populates PolicyRule rows that the adjudication engine will reference.
    """
    version = await policy_service.extract_policy_rules_from_document(db, version_id)
    if not version:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Policy version not found or no PDF uploaded",
        )
    return version


@router.get(
    "/policies/{policy_id}/versions/{version_id}/rules",
    response_model=list[PolicyRuleRead],
)
async def get_policy_rules(
    policy_id: uuid.UUID,
    version_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
):
    rules = await policy_service.get_policy_rules(db, version_id)
    return rules


@router.patch(
    "/policies/{policy_id}/versions/{version_id}/rules",
    response_model=MessageResponse,
)
async def bulk_patch_policy_rules(
    policy_id: uuid.UUID,
    version_id: uuid.UUID,
    body: list[dict],
    db: DBSession,
    current_user: AdjusterOrAbove,
):
    """Bulk update rules — pass list of {rule_id, ...fields} objects."""
    updated = 0
    for item in body:
        rule_id = item.pop("rule_id", None)
        if not rule_id:
            continue
        patch = PolicyRulePatch(**item)
        result = await policy_service.patch_policy_rule(db, uuid.UUID(str(rule_id)), patch)
        if result:
            updated += 1
    return {"message": f"{updated} rules updated"}


@router.get(
    "/policies/{policy_id}/versions/{version_id}/clauses/{rule_id}",
    response_model=PolicyRuleRead,
)
async def get_policy_clause(
    policy_id: uuid.UUID,
    version_id: uuid.UUID,
    rule_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
):
    """Fetch a single policy clause/rule — used for citation lookups in the explanation panel."""
    rule = await policy_service.get_policy_rule(db, rule_id)
    if not rule or rule.policy_version_id != version_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Policy rule/clause not found"
        )
    return rule


# ── Non-payable items ─────────────────────────────────────────────────────────

@router.get("/non-payable-items", response_model=list[NonPayableItemRead])
async def list_non_payable_items(
    db: DBSession,
    current_user: CurrentUser,
    org_id: uuid.UUID | None = Query(None),
):
    items = await policy_service.list_non_payable_items(db, org_id=org_id)
    return items


@router.post(
    "/non-payable-items",
    response_model=NonPayableItemRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_non_payable_item(
    body: NonPayableItemCreate,
    db: DBSession,
    current_user: AdjusterOrAbove,
):
    item = await policy_service.create_non_payable_item(db, body)
    return item
