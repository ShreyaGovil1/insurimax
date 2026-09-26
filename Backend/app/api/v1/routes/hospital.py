"""
Hospital-facing pre-submission checker routes.

POST   /hospital/pre-check
GET    /hospital/pre-check/{checkId}
GET    /hospital/submission-templates
POST   /hospital/claims/{claimId}/submit
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from app.core.deps import CurrentUser, DBSession
from app.gcp.gemini import PRE_CHECK_SYSTEM_PROMPT, generate_json
from app.core.config import settings

router = APIRouter(prefix="/hospital", tags=["Hospital Pre-Submission"])

# In-memory store for pre-check results (replace with DB/Redis in production)
_pre_check_store: dict[str, dict] = {}


@router.post("/pre-check", status_code=status.HTTP_202_ACCEPTED)
async def run_pre_check(
    db: DBSession,
    current_user: CurrentUser,
    patient_name: str = Form(...),
    hospital_name: str = Form(...),
    insurer_name: str | None = Form(None),
    policy_number: str | None = Form(None),
    billed_amount: float | None = Form(None),
    bill_file: UploadFile | None = File(None),
    policy_file: UploadFile | None = File(None),
):
    """
    Run pre-submission audit BEFORE creating a formal claim.
    Hospital billing desk uses this to catch likely deductions upfront.
    Returns estimated approved amount and a list of issues to fix.
    """
    import json

    inline_data = []
    bill_summary = "No bill file uploaded"
    policy_summary = "No policy file uploaded"

    if bill_file:
        bill_bytes = await bill_file.read()
        inline_data.append({"mime_type": bill_file.content_type or "application/pdf", "data": bill_bytes})
        bill_summary = f"Uploaded: {bill_file.filename} ({len(bill_bytes)} bytes)"

    if policy_file:
        policy_bytes = await policy_file.read()
        inline_data.append({"mime_type": policy_file.content_type or "application/pdf", "data": policy_bytes})
        policy_summary = f"Uploaded: {policy_file.filename} ({len(policy_bytes)} bytes)"

    claim_context = {
        "patient_name": patient_name,
        "hospital_name": hospital_name,
        "insurer_name": insurer_name,
        "policy_number": policy_number,
        "total_billed_inr": billed_amount,
        "bill_document": bill_summary,
        "policy_document": policy_summary,
    }

    prompt = (
        f"{PRE_CHECK_SYSTEM_PROMPT}\n\n"
        f"## Claim Context\n{json.dumps(claim_context, indent=2)}\n\n"
        "Review the attached documents and identify likely deductions or issues."
    )

    try:
        result, _, _ = await generate_json(
            prompt=prompt,
            inline_data=inline_data if inline_data else None,
            model_name=settings.GEMINI_FLASH_MODEL,  # use Flash for pre-checks (cheaper/faster)
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Pre-check analysis failed: {exc}",
        )

    check_id = str(uuid.uuid4())
    check_result = {
        "check_id": check_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "completed",
        "claim_context": claim_context,
        **result,
    }
    _pre_check_store[check_id] = check_result

    return check_result


@router.get("/pre-check/{check_id}")
async def get_pre_check_result(
    check_id: str,
    current_user: CurrentUser,
):
    """Retrieve a previous pre-check result by ID."""
    result = _pre_check_store.get(check_id)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pre-check result not found or expired",
        )
    return result


@router.get("/submission-templates")
async def get_submission_templates(current_user: CurrentUser):
    """
    Return standardised document templates to reduce 'dark data' at submission.
    Hospitals can use these to format bills in a way Gemini OCR can reliably parse.
    """
    return {
        "templates": [
            {
                "name": "Itemized Bill Template",
                "description": "Standard itemized billing format with required columns",
                "format": "xlsx",
                "columns": [
                    "line_number",
                    "date",
                    "item_name",
                    "item_category",
                    "quantity",
                    "unit_price_inr",
                    "total_price_inr",
                    "prescribed_by",
                    "notes",
                ],
                "download_url": "/hospital/submission-templates/itemized-bill.xlsx",
            },
            {
                "name": "Prescription Format",
                "description": "Typed prescription template (reduces handwriting OCR errors)",
                "format": "pdf",
                "download_url": "/hospital/submission-templates/prescription.pdf",
            },
            {
                "name": "Discharge Summary Template",
                "description": "Structured discharge summary with all required fields",
                "format": "docx",
                "required_fields": [
                    "admission_date",
                    "discharge_date",
                    "diagnosis_primary",
                    "diagnosis_secondary",
                    "procedures_performed",
                    "attending_physician",
                    "ward_type",
                ],
                "download_url": "/hospital/submission-templates/discharge-summary.docx",
            },
        ]
    }


@router.post("/claims/{claim_id}/submit", status_code=status.HTTP_201_CREATED)
async def convert_pre_check_to_claim(
    claim_id: uuid.UUID,
    check_id: str,
    db: DBSession,
    current_user: CurrentUser,
):
    """
    Convert a pre-checked draft into a formal claim submission.
    Links the pre-check result to the claim for audit trail.
    """
    from app.services import claim_service

    check_result = _pre_check_store.get(check_id)
    if not check_result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pre-check result not found",
        )

    claim = await claim_service.get_claim(db, claim_id)
    if not claim:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Claim not found")

    # Tag the claim with the pre-check reference
    if claim.adjuster_notes:
        claim.adjuster_notes += f"\n[Pre-check: {check_id}]"
    else:
        claim.adjuster_notes = f"[Pre-check: {check_id}]"

    return {
        "message": "Pre-check linked to claim",
        "claim_id": str(claim_id),
        "pre_check_id": check_id,
        "estimated_approved_inr": check_result.get("estimated_approved_inr"),
        "submission_readiness_score": check_result.get("submission_readiness_score"),
    }
