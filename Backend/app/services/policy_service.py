"""
Policy library service.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.gcp import storage as gcs
from app.gcp.gemini import generate_json
from app.models.policy import NonPayableItem, Policy, PolicyRule, PolicyVersion, RuleType
from app.schemas.policy import (
    NonPayableItemCreate,
    PolicyCreate,
    PolicyRulePatch,
    PolicyVersionCreate,
)
from app.core.config import settings


# ── Policy ────────────────────────────────────────────────────────────────────

async def create_policy(db: AsyncSession, data: PolicyCreate) -> Policy:
    policy = Policy(**data.model_dump())
    db.add(policy)
    await db.flush()
    return policy


async def get_policy(db: AsyncSession, policy_id: uuid.UUID) -> Policy | None:
    result = await db.execute(
        select(Policy)
        .where(Policy.id == policy_id)
        .options(selectinload(Policy.versions))
    )
    return result.scalar_one_or_none()


async def list_policies(
    db: AsyncSession,
    insurer_name: str | None = None,
    org_id: uuid.UUID | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Policy], int]:
    from sqlalchemy import func

    query = select(Policy).where(Policy.is_active == True)  # noqa: E712
    if insurer_name:
        query = query.where(Policy.insurer_name.ilike(f"%{insurer_name}%"))
    if org_id:
        query = query.where(Policy.org_id == org_id)

    count_res = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_res.scalar_one()

    query = query.order_by(Policy.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    return result.scalars().all(), total


# ── PolicyVersion ─────────────────────────────────────────────────────────────

async def create_policy_version(
    db: AsyncSession,
    policy_id: uuid.UUID,
    data: PolicyVersionCreate,
    file_data: bytes | None = None,
    filename: str | None = None,
    mime_type: str | None = None,
) -> PolicyVersion:
    version = PolicyVersion(
        policy_id=policy_id,
        version_number=data.version_number,
        effective_from=data.effective_from,
        effective_to=data.effective_to,
        sum_insured_inr=data.sum_insured_inr,
        is_current=data.is_current,
        extraction_status="pending",
    )

    if file_data and filename:
        object_key = gcs.build_policy_object_key(policy_id, uuid.uuid4(), filename)
        await gcs.upload_file(file_data, object_key, mime_type or "application/pdf")
        version.gcs_bucket = settings.GCS_BUCKET_NAME
        version.gcs_object_key = object_key

    db.add(version)

    if data.is_current:
        # Unset other versions' is_current
        from sqlalchemy import update
        await db.execute(
            update(PolicyVersion)
            .where(PolicyVersion.policy_id == policy_id, PolicyVersion.id != version.id)
            .values(is_current=False)
        )

    await db.flush()
    return version


async def get_policy_version(db: AsyncSession, version_id: uuid.UUID) -> PolicyVersion | None:
    result = await db.execute(
        select(PolicyVersion)
        .where(PolicyVersion.id == version_id)
        .options(selectinload(PolicyVersion.rules))
    )
    return result.scalar_one_or_none()


async def extract_policy_rules_from_document(
    db: AsyncSession, version_id: uuid.UUID
) -> PolicyVersion | None:
    """Download policy PDF from GCS and use Gemini to extract structured rules."""
    version = await get_policy_version(db, version_id)
    if not version or not version.gcs_object_key:
        return None

    file_bytes = await gcs.download_as_bytes(version.gcs_object_key)

    import json

    prompt = (
        "You are an insurance policy analysis engine. "
        "Extract all rules, clauses, sub-limits, exclusions, co-pay clauses, "
        "waiting periods, and non-payable item lists from this policy document.\n\n"
        "Return ONLY valid JSON in this schema:\n"
        '{"rules": [{"rule_type": "room_rent_cap|icu_cap|copay|deductible|waiting_period|exclusion|sub_limit|proportionate_deduction|pre_existing_disease|network_restriction|other", '
        '"clause_reference": "string|null", "clause_page": number|null, "title": "string", '
        '"description": "string|null", "limit_data": {}|null, "applies_to_categories": []|null}], '
        '"structured_summary": {}}\n\n'
        "Extract from the attached policy document now."
    )

    result, _, _ = await generate_json(
        prompt=prompt,
        inline_data=[{"mime_type": "application/pdf", "data": file_bytes}],
        model_name=settings.GEMINI_MODEL,
    )

    version.structured_rules = result.get("structured_summary")
    version.extraction_status = "completed"
    version.extracted_by_model = settings.GEMINI_MODEL

    # Persist individual rules
    rules_data = result.get("rules", [])
    for rule_data in rules_data:
        rule_type_str = rule_data.get("rule_type", "other")
        try:
            rule_type = RuleType(rule_type_str)
        except ValueError:
            rule_type = RuleType.OTHER

        rule = PolicyRule(
            policy_version_id=version.id,
            rule_type=rule_type,
            clause_reference=rule_data.get("clause_reference"),
            clause_page=rule_data.get("clause_page"),
            title=rule_data.get("title", "Unnamed rule"),
            description=rule_data.get("description"),
            limit_data=rule_data.get("limit_data"),
            applies_to_categories=rule_data.get("applies_to_categories"),
        )
        db.add(rule)

    await db.flush()
    return version


# ── PolicyRule ────────────────────────────────────────────────────────────────

async def get_policy_rules(db: AsyncSession, version_id: uuid.UUID) -> list[PolicyRule]:
    result = await db.execute(
        select(PolicyRule).where(PolicyRule.policy_version_id == version_id)
    )
    return result.scalars().all()


async def get_policy_rule(db: AsyncSession, rule_id: uuid.UUID) -> PolicyRule | None:
    result = await db.execute(select(PolicyRule).where(PolicyRule.id == rule_id))
    return result.scalar_one_or_none()


async def patch_policy_rule(
    db: AsyncSession, rule_id: uuid.UUID, patch: PolicyRulePatch
) -> PolicyRule | None:
    rule = await get_policy_rule(db, rule_id)
    if not rule:
        return None
    for field, value in patch.model_dump(exclude_none=True).items():
        setattr(rule, field, value)
    await db.flush()
    return rule


# ── NonPayableItem ────────────────────────────────────────────────────────────

async def list_non_payable_items(
    db: AsyncSession, org_id: uuid.UUID | None = None
) -> list[NonPayableItem]:
    from sqlalchemy import or_

    query = select(NonPayableItem).where(NonPayableItem.is_active == True)  # noqa: E712
    if org_id:
        query = query.where(
            or_(NonPayableItem.org_id == org_id, NonPayableItem.org_id == None)  # noqa: E711
        )
    else:
        query = query.where(NonPayableItem.org_id == None)  # noqa: E711 (IRDAI standard only)
    result = await db.execute(query)
    return result.scalars().all()


async def create_non_payable_item(
    db: AsyncSession, data: NonPayableItemCreate
) -> NonPayableItem:
    item = NonPayableItem(**data.model_dump())
    db.add(item)
    await db.flush()
    return item
