"""
Adjudication service — runs the Gemini audit and persists results.
"""
import asyncio
import logging
import re
import uuid
from datetime import datetime, timezone
from difflib import SequenceMatcher

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.agent.adjudicator import run_adjudication_agent
from app.services import ai_model_service
from app.core.config import settings
from app.models.adjudication import (
    AdjudicationResult,
    AdjudicationStatus,
    LineItemDecision,
    LineItemStatus,
    OverrideReason,
)
from app.models.claim import Claim, ClaimStatus
from app.models.policy import NonPayableItem, PolicyRule
from app.schemas.adjudication import FinalizeRequest, LineItemOverrideRequest
from app.gcp import storage as gcs
from app.models.document import Document, DocumentType, ExtractionStatus
from app.services import citation_service
from app.services.document_service import get_claim_extracted_data, get_document_extraction

logger = logging.getLogger(__name__)


# ── Citations & policy evidence (RAG) ─────────────────────────────────────────

_EVIDENCE_PER_ITEM = 2
_MAX_EVIDENCE = 30
_EVIDENCE_PROMPT_CHARS = 600
# Claim-wide topics every adjudication touches, retrieved once in addition to per-item passages
_GENERAL_EVIDENCE_QUERIES = (
    "room rent limit per day",
    "co-payment percentage",
    "non payable consumables excluded items",
    "waiting period pre-existing disease",
    "sum insured",
)


def _without_sources(node):
    """Copy of the extracted data without citation blocks (the agent doesn't need rects)."""
    if isinstance(node, dict):
        return {k: _without_sources(v) for k, v in node.items() if k != "source"}
    if isinstance(node, list):
        return [_without_sources(v) for v in node]
    return node


async def _policy_passages(db: AsyncSession, claim_id: uuid.UUID) -> list[dict]:
    """
    Retrieval corpus: passages of the claim's uploaded policy document(s), each with a citation.
    Text-layer PDFs are split into passages; images/scanned PDFs fall back to the extracted
    coverage rows, which carry their own (page-level) citations.
    """
    docs = (
        await db.execute(
            select(Document).where(
                Document.claim_id == claim_id,
                Document.doc_type == DocumentType.POLICY_DOCUMENT,
                Document.extraction_status != ExtractionStatus.FAILED,
            )
        )
    ).scalars().all()
    passages: list[dict] = []
    for doc in docs:
        found: list[dict] = []
        if citation_service.is_pdf(doc.mime_type, doc.original_filename):
            try:
                data = await gcs.download_as_bytes(doc.gcs_object_key)
                found = await asyncio.to_thread(
                    citation_service.pdf_passages, data, document_id=str(doc.id), filename=doc.original_filename
                )
            except Exception as exc:
                logger.warning("Policy passages unavailable for document %s: %s", doc.id, exc)
        if not found:
            job = await get_document_extraction(db, doc.id)
            payload = (job.corrected_payload or job.extracted_payload) if job else None
            for row in (payload or {}).get("coverage_items") or []:
                text = "; ".join(f"{k}: {v}" for k, v in row.items() if k != "source" and v not in (None, ""))
                src = row.get("source")
                if not (isinstance(src, dict) and src.get("document_id")):
                    src = {
                        "document_id": str(doc.id), "filename": doc.original_filename,
                        "kind": "pdf" if citation_service.is_pdf(doc.mime_type, doc.original_filename) else "image",
                        "page": 1, "text": text, "rects": [], "match": "page",
                    }
                found.append({"text": text, "citation": src})
        passages.extend(found)
    return passages


def _select_evidence(passages: list[dict], line_items: list[dict]) -> tuple[list[dict], dict, dict]:
    """
    BM25-retrieve the policy passages relevant to each bill line item (plus claim-wide topics).
    Returns (evidence for the prompt, evidence_id -> citation, line_number -> evidence ids).
    """
    order: list[int] = []
    per_item: dict[int, list[int]] = {}
    for item in line_items:
        query = f"{item.get('item_name') or ''} {item.get('item_category') or ''}"
        hits = citation_service.bm25_rank(query, passages, k=_EVIDENCE_PER_ITEM)
        per_item[item.get("line_number")] = hits
        order.extend(hits)
    for query in _GENERAL_EVIDENCE_QUERIES:
        order.extend(citation_service.bm25_rank(query, passages, k=1))

    ids: dict[int, str] = {}
    for idx in order:
        if idx not in ids and len(ids) < _MAX_EVIDENCE:
            ids[idx] = f"E{len(ids) + 1}"
    prompt_evidence = [
        {
            "evidence_id": eid,
            "page": passages[idx]["citation"].get("page"),
            "text": passages[idx]["text"][:_EVIDENCE_PROMPT_CHARS],
        }
        for idx, eid in ids.items()
    ]
    by_id = {eid: passages[idx]["citation"] for idx, eid in ids.items()}
    per_item_ids = {ln: [ids[i] for i in idxs if i in ids] for ln, idxs in per_item.items()}
    return prompt_evidence, by_id, per_item_ids


def _bill_source(line_number, item_name: str | None, line_items: list[dict]) -> dict | None:
    """Citation of the extracted bill line a decision is about (by line number, else by name)."""
    for li in line_items:
        if li.get("line_number") == line_number and isinstance(li.get("source"), dict):
            return li["source"]
    best, best_ratio = None, 0.6
    for li in line_items:
        ratio = SequenceMatcher(None, (item_name or "").lower(), str(li.get("item_name") or "").lower()).ratio()
        if ratio > best_ratio and isinstance(li.get("source"), dict):
            best, best_ratio = li["source"], ratio
    return best


_PROVENANCE_KEYS = (
    "document_id", "source_document", "bill_number", "issuer_name", "bill_role",
    "bill_line_number", "itemises_summary_line", "claim_phase",
)


def _bill_line(line_number, line_items: list[dict]) -> dict:
    return next((li for li in line_items if li.get("line_number") == line_number), {})


def _undecided_lines(line_decisions: list[dict], line_items: list[dict]) -> list[dict]:
    """Bill lines the agent returned no decision for: kept for the adjuster, never silently dropped."""
    decided = {d.get("line_number") for d in line_decisions}
    missing = []
    for idx, li in enumerate(line_items):
        line_number = li.get("line_number", idx + 1)
        if line_number in decided:
            continue
        try:
            billed = float(li.get("total_price_inr") or 0)
        except (TypeError, ValueError):
            billed = 0.0
        missing.append({
            "line_number": line_number,
            "item_name": li.get("item_name") or "Unknown",
            "item_category": li.get("item_category"),
            "billed_amount_inr": billed,
            "approved_amount_inr": 0.0,
            "deducted_amount_inr": 0.0,
            "status": "flagged",
            "confidence": 0.0,
            "explanation": "The AI returned no decision for this line; it needs an adjuster's review.",
        })
    return missing


_EXCLUDED_STATUSES = ("non_payable", "rejected")


_EVIDENCE_REF = re.compile(r"(?:policy\s+evidence\s+)?\bE(\d+)\b", re.IGNORECASE)


def _readable_evidence_refs(summary: dict, evidence_by_id: dict) -> dict:
    """Evidence ids (E26) mean nothing to users: rewrite them as the policy page they point to."""
    def repl(match):
        citation = evidence_by_id.get(f"E{match.group(1)}")
        return f"policy p.{citation['page']}" if citation and citation.get("page") else match.group(0)

    return {
        **summary,
        "overview": _EVIDENCE_REF.sub(repl, summary.get("overview") or ""),
        "key_reasons": [_EVIDENCE_REF.sub(repl, r) for r in summary.get("key_reasons") or []],
    }


def _count(items: list, singular: str, plural: str) -> str:
    return f"{len(items)} {singular if len(items) == 1 else plural}"


def _inr(amount: float) -> str:
    return f"Rs. {amount:,.0f}"


def _ensure_decision_summary(output: dict, line_decisions: list[dict]) -> dict:
    """
    The overall "why" of the adjudication. Uses the agent's decision_summary when it wrote one;
    otherwise (agent omitted it, or the deterministic rules engine ran) builds it from the
    line-item decisions so every adjudication has a summary.
    """
    summary = output.get("decision_summary") or {}
    if isinstance(summary, dict) and str(summary.get("overview") or "").strip():
        return {"overview": summary["overview"].strip(), "key_reasons": summary.get("key_reasons") or [], "generated_by": "ai"}

    def amount(item, key):
        try:
            return float(item.get(key) or 0)
        except (TypeError, ValueError):
            return 0.0

    billed = sum(amount(i, "billed_amount_inr") for i in line_decisions)
    approved = sum(amount(i, "approved_amount_inr") for i in line_decisions)
    status_of = lambda i: str(i.get("status") or "").lower()  # noqa: E731
    accepted = [i for i in line_decisions if status_of(i) == "approved"]
    reduced = [i for i in line_decisions if status_of(i) == "partially_approved"]
    excluded = [i for i in line_decisions if status_of(i) in _EXCLUDED_STATUSES]
    flagged = [i for i in line_decisions if status_of(i) == "flagged"]

    overall = str((output.get("adjudication_summary") or {}).get("status") or "").replace("_", " ").lower()
    overview = (
        f"{len(line_decisions)} line items worth {_inr(billed)} were reviewed"
        + (f" and the claim was {overall}" if overall else "")
        + f". {_count(accepted, 'was', 'were')} accepted in full and {_inr(approved)} is payable."
    )
    if reduced:
        overview += f" {_count(reduced, 'was', 'were')} reduced (e.g. caps or proportionate deductions)."
    if excluded:
        overview += f" {_count(excluded, 'was', 'were')} excluded as not payable under the policy / IRDAI rules."
    if flagged:
        overview += f" {_count(flagged, 'needs', 'need')} an adjuster's review."

    reasons = []
    for label, items, key in (
        ("Excluded", excluded, "deducted_amount_inr"),
        ("Reduced", reduced, "deducted_amount_inr"),
        ("Flagged for review", flagged, "billed_amount_inr"),
    ):
        for item in items:
            why = str(item.get("explanation") or "").strip().split(". ")[0]
            reasons.append(f"{label}: {item.get('item_name', 'Item')} ({_inr(amount(item, key))}) - {why}")
    return {"overview": overview, "key_reasons": reasons, "generated_by": "rules"}


# ── Helper: map string status from Gemini → enum ─────────────────────────────

_STATUS_MAP: dict[str, LineItemStatus] = {
    "approved": LineItemStatus.APPROVED,
    "partially_approved": LineItemStatus.PARTIALLY_APPROVED,
    "flagged": LineItemStatus.FLAGGED,
    "non_payable": LineItemStatus.NON_PAYABLE,
    "rejected": LineItemStatus.REJECTED,
}


async def count_overridden_line_items(db: AsyncSession, claim_id: uuid.UUID) -> int:
    """Adjuster overrides on the claim's current adjudication; a re-run would discard them."""
    result = await db.execute(
        select(func.count())
        .select_from(LineItemDecision)
        .join(AdjudicationResult, AdjudicationResult.id == LineItemDecision.adjudication_result_id)
        .where(AdjudicationResult.claim_id == claim_id, LineItemDecision.is_overridden == True)  # noqa: E712
    )
    return result.scalar_one()


async def run_adjudication(db: AsyncSession, claim_id: uuid.UUID) -> AdjudicationResult:
    """
    Main adjudication pipeline:
    1. Load extracted bill data
    2. Load policy rules
    3. Load non-payable items
    4. Send to Gemini
    5. Persist line-item decisions
    """
    # ── Load claim ────────────────────────────────────────────────────────────
    claim_result = await db.execute(
        select(Claim)
        .where(Claim.id == claim_id)
        .options(selectinload(Claim.adjudication_result))
    )
    claim = claim_result.scalar_one_or_none()
    if not claim:
        raise ValueError(f"Claim {claim_id} not found")

    # Create or reuse adjudication result row
    adj = claim.adjudication_result
    if adj is None:
        adj = AdjudicationResult(claim_id=claim_id)
        db.add(adj)
    adj.status = AdjudicationStatus.IN_PROGRESS
    await db.flush()

    # Update claim status
    claim.status = ClaimStatus.ADJUDICATION_IN_PROGRESS
    await db.flush()

    try:
        # ── Extracted bill data (all bills, reconciled) ───────────────────────
        extracted_data = await get_claim_extracted_data(db, claim_id, refresh_reconciliation=True)

        # ── Policy rules ───────────────────────────────────────────────────────
        policy_rules: list[dict] = []
        rule_id_map: dict[str, uuid.UUID] = {}

        if claim.policy_version_id:
            rules_result = await db.execute(
                select(PolicyRule).where(
                    PolicyRule.policy_version_id == claim.policy_version_id,
                    PolicyRule.is_active == True,  # noqa: E712
                )
            )
            for rule in rules_result.scalars().all():
                policy_rules.append(
                    {
                        "rule_id": str(rule.id),
                        "rule_type": rule.rule_type.value,
                        "clause_reference": rule.clause_reference,
                        "title": rule.title,
                        "description": rule.description,
                        "limit_data": rule.limit_data,
                        "applies_to_categories": rule.applies_to_categories,
                    }
                )
                rule_id_map[rule.clause_reference or rule.title] = rule.id

        # ── Non-payable items ──────────────────────────────────────────────────
        npi_result = await db.execute(
            select(NonPayableItem).where(NonPayableItem.is_active == True)  # noqa: E712
        )
        non_payable_items = [
            {"name": item.name, "category": item.category, "keywords": item.keywords}
            for item in npi_result.scalars().all()
        ]

        # ── Policy evidence (RAG over the uploaded policy document) ────────────
        bill_items = extracted_data.get("line_items") or extracted_data.get("items") or []
        passages = await _policy_passages(db, claim_id)
        policy_evidence, evidence_by_id, _ = _select_evidence(passages, bill_items)

        # ── Run the ADK adjudication agent ─────────────────────────────────────
        adjudication_model = await ai_model_service.model_for("adjudication")
        fallback_model = await ai_model_service.model_for("adjudication_fallback")
        gemini_output, prompt_tokens, completion_tokens = await run_adjudication_agent(
            extracted_data=_without_sources(extracted_data),
            policy_rules=policy_rules,
            non_payable_items=non_payable_items,
            claim_patient_name=claim.patient_name,
            claim_hospital_name=claim.hospital_name,
            policy_evidence=policy_evidence,
            models=[adjudication_model, fallback_model],
        )

        # ── Parse new 5-step adjudication output ──────────────────────────────
        summary = gemini_output.get("adjudication_summary", {})
        financial = gemini_output.get("financial_breakdown", {})
        flagged_infractions = gemini_output.get("flagged_infractions_or_reasons", [])
        required_actions = gemini_output.get("required_actions", {})
        line_decisions = gemini_output.get("line_item_decisions", [])
        line_decisions.extend(_undecided_lines(line_decisions, bill_items))
        audit_status = summary.get("status", "APPROVED")  # APPROVED | DENIED | QUERY_RAISED

        # ── Delete old line items if re-running ────────────────────────────────
        old_items_result = await db.execute(
            select(LineItemDecision).where(
                LineItemDecision.adjudication_result_id == adj.id
            )
        )
        for old in old_items_result.scalars().all():
            await db.delete(old)
        await db.flush()

        # ── Persist line items ─────────────────────────────────────────────────
        flagged_count = 0
        non_payable_count = 0
        new_line_items: list[LineItemDecision] = []

        for idx, item in enumerate(line_decisions):
            raw_status = item.get("status", "flagged").lower()
            ai_status = _STATUS_MAP.get(raw_status, LineItemStatus.FLAGGED)

            if ai_status in (LineItemStatus.FLAGGED,):
                flagged_count += 1
            if ai_status == LineItemStatus.NON_PAYABLE:
                non_payable_count += 1

            # Try to link to a policy rule
            rule_ref = item.get("policy_rule_reference")
            policy_rule_id = rule_id_map.get(rule_ref) if rule_ref else None

            # Citations: the bill line this decision is about, and only the policy passages the
            # agent says it relied on (retrieved-but-uncited passages are not shown as evidence).
            line_number = item.get("line_number", idx + 1)
            bill_line = _bill_line(line_number, bill_items)
            policy_citations = [
                {**evidence_by_id[eid], "evidence_id": eid}
                for eid in dict.fromkeys(item.get("policy_evidence_ids") or [])
                if eid in evidence_by_id
            ]

            lid = LineItemDecision(
                adjudication_result_id=adj.id,
                line_number=line_number,
                item_name=item.get("item_name", "Unknown"),
                item_category=item.get("item_category"),
                billed_amount_inr=float(item.get("billed_amount_inr", 0)),
                approved_amount_inr=float(item.get("approved_amount_inr", 0)),
                deducted_amount_inr=float(item.get("deducted_amount_inr", 0)),
                ai_status=ai_status,
                final_status=ai_status,
                ai_explanation=item.get("explanation"),
                policy_rule_id=policy_rule_id,
                citation_data={
                    "policy_rule_reference": rule_ref,
                    "confidence": item.get("confidence"),
                    "cap_analysis": item.get("cap_analysis"),
                    "source": _bill_source(line_number, item.get("item_name"), bill_items),
                    "policy_evidence": policy_citations,
                    # Which uploaded bill this line came from (claims combine several bills)
                    **{k: bill_line.get(k) for k in _PROVENANCE_KEYS},
                },
            )
            db.add(lid)
            new_line_items.append(lid)

        await db.flush()

        # ── Cross-validate Patient Identity & Bill Validity ───────────────────
        bill_patient = extracted_data.get("patient") or {}
        bill_patient_name = (bill_patient.get("name") or "").strip()
        claim_patient_name = (claim.patient_name or "").strip()

        # Exact match comparison (normalized case and spacing)
        is_exact_name_match = (
            bool(bill_patient_name)
            and bool(claim_patient_name)
            and bill_patient_name.lower() == claim_patient_name.lower()
        )

        existing_flags = list(gemini_output.get("flags") or [])
        if not is_exact_name_match and bill_patient_name:
            mismatch_flag = (
                f"CRITICAL IDENTITY MISMATCH: Patient name on hospital bill ('{bill_patient_name}') "
                f"does not match insured claimant name ('{claim_patient_name}'). "
                f"Insurance validity rules require an exact match. Auto-approval is strictly blocked."
            )
            if mismatch_flag not in existing_flags:
                existing_flags.insert(0, mismatch_flag)
            flagged_count = max(flagged_count, 1)
            # Override agent status to DENIED if it didn't already catch this
            if audit_status != "DENIED":
                audit_status = "DENIED"
                summary["status"] = "DENIED"

        gemini_output["flags"] = existing_flags

        # ── Build deduction breakdown from financial_breakdown ─────────────────
        deduction_breakdown = {
            "room_rent_excess_inr": round(float(financial.get("room_rent_deduction", 0)), 2),
            "icu_excess_inr": 0.0,
            "non_payables_inr": round(float(financial.get("consumables_deduction", 0)), 2),
            "copay_inr": round(float(financial.get("co_pay_applied_amount", 0)), 2),
            "proportional_deductions_inr": round(float(financial.get("proportional_charge_deduction", 0)), 2),
            "exclusions_inr": 0.0,
            "sub_limit_deductions_inr": 0.0,
            "other_deductions_inr": 0.0,
        }

        # ── Determine confidence score from line items ─────────────────────────
        if line_decisions:
            avg_conf = sum(
                float(li.get("confidence", 0.95)) for li in line_decisions
            ) / len(line_decisions)
        else:
            avg_conf = 0.95
        # Override confidence on identity mismatch or denial
        if not is_exact_name_match and bill_patient_name:
            avg_conf = 0.35
        elif audit_status == "DENIED":
            avg_conf = min(avg_conf, 0.5)
        elif audit_status == "QUERY_RAISED":
            avg_conf = min(avg_conf, 0.6)

        # ── Update adjudication result ─────────────────────────────────────────
        adj.status = AdjudicationStatus.COMPLETED
        # Billed = the reconciled bills (every line, each charge once), not the agent's own sum
        adj.total_billed_inr = round(
            float(extracted_data.get("total_billed_inr") or financial.get("total_billed_amount", 0)), 2
        )
        adj.total_approved_inr = round(float(financial.get("total_approved_amount", 0)), 2)
        adj.total_deducted_inr = round(float(financial.get("total_deductions", 0)), 2)
        adj.deduction_breakdown = deduction_breakdown
        adj.confidence_score = round(avg_conf, 4)
        adj.flagged_items_count = flagged_count
        adj.non_payable_items_count = non_payable_count
        adj.gemini_model_used = adjudication_model
        adj.prompt_tokens = prompt_tokens
        adj.completion_tokens = completion_tokens
        gemini_output["decision_summary"] = _readable_evidence_refs(
            _ensure_decision_summary(gemini_output, line_decisions), evidence_by_id
        )
        adj.gemini_raw_response = gemini_output

        # ── Auto-approval logic driven by 5-step status ────────────────────────
        if audit_status == "APPROVED" and is_exact_name_match:
            if (
                avg_conf >= settings.AUTO_APPROVAL_CONFIDENCE_THRESHOLD
                and (adj.total_approved_inr or 0) <= settings.AUTO_APPROVAL_MAX_AMOUNT_INR
                and flagged_count == 0
            ):
                adj.auto_approved = True
                claim.status = ClaimStatus.AUTO_APPROVED
            else:
                adj.auto_approved = False
                claim.status = ClaimStatus.IN_REVIEW
        elif audit_status == "DENIED":
            adj.auto_approved = False
            adj.total_approved_inr = 0.0
            claim.status = ClaimStatus.IN_REVIEW
        elif audit_status == "QUERY_RAISED":
            adj.auto_approved = False
            adj.total_approved_inr = 0.0
            claim.status = ClaimStatus.IN_REVIEW
        else:
            adj.auto_approved = False
            claim.status = ClaimStatus.IN_REVIEW

        # Sync amounts to claim (reconcile billed amount with audited bill total)
        claim.billed_amount = adj.total_billed_inr
        claim.approved_amount = adj.total_approved_inr
        claim.deducted_amount = adj.total_deducted_inr
        claim.ai_confidence_score = adj.confidence_score
        claim.deduction_summary = adj.deduction_breakdown

        await db.flush()

    except Exception as exc:
        adj.status = AdjudicationStatus.FAILED
        adj.error_message = str(exc)
        claim.status = ClaimStatus.IN_REVIEW
        await db.flush()
        raise

    # line_items is lazy="raise": reload with the relationship eagerly loaded so the
    # response model (AdjudicationResultRead.line_items) can serialize it.
    refreshed = await db.execute(
        select(AdjudicationResult)
        .where(AdjudicationResult.id == adj.id)
        .options(selectinload(AdjudicationResult.line_items))
        .execution_options(populate_existing=True)
    )
    return refreshed.scalar_one()


async def get_adjudication(db: AsyncSession, claim_id: uuid.UUID) -> AdjudicationResult | None:
    result = await db.execute(
        select(AdjudicationResult)
        .where(AdjudicationResult.claim_id == claim_id)
        .options(selectinload(AdjudicationResult.line_items))
    )
    return result.scalar_one_or_none()


async def get_line_item(
    db: AsyncSession, item_id: uuid.UUID
) -> LineItemDecision | None:
    result = await db.execute(
        select(LineItemDecision).where(LineItemDecision.id == item_id)
    )
    return result.scalar_one_or_none()


async def override_line_item(
    db: AsyncSession,
    item_id: uuid.UUID,
    override: LineItemOverrideRequest,
    adjuster_id: uuid.UUID,
) -> LineItemDecision | None:
    item = await get_line_item(db, item_id)
    if not item:
        return None

    item.is_overridden = True
    item.final_status = override.new_status
    item.override_reason = override.override_reason
    item.override_note = override.override_note
    item.overridden_by_id = adjuster_id
    item.overridden_at = datetime.now(timezone.utc)

    if override.new_approved_amount_inr is not None:
        item.approved_amount_inr = override.new_approved_amount_inr
        item.deducted_amount_inr = item.billed_amount_inr - override.new_approved_amount_inr

    await db.flush()

    # Recalculate adjudication totals
    adj_result = await db.execute(
        select(AdjudicationResult)
        .where(AdjudicationResult.id == item.adjudication_result_id)
        .options(selectinload(AdjudicationResult.line_items))
    )
    adj = adj_result.scalar_one_or_none()
    if adj:
        adj.total_approved_inr = sum(
            li.approved_amount_inr for li in adj.line_items
        )
        adj.total_deducted_inr = sum(
            li.deducted_amount_inr for li in adj.line_items
        )
        adj.flagged_items_count = sum(
            1 for li in adj.line_items if li.final_status == LineItemStatus.FLAGGED
        )
        adj.non_payable_items_count = sum(
            1 for li in adj.line_items if li.final_status == LineItemStatus.NON_PAYABLE
        )
        await db.flush()

    return item


async def finalize_adjudication(
    db: AsyncSession,
    claim_id: uuid.UUID,
    request: FinalizeRequest,
    finalized_by_id: uuid.UUID,
) -> AdjudicationResult | None:
    adj = await get_adjudication(db, claim_id)
    if not adj:
        return None

    adj.status = AdjudicationStatus.FINALIZED
    adj.finalized_by_id = finalized_by_id
    adj.finalized_at = datetime.now(timezone.utc)

    # Update claim
    claim_result = await db.execute(select(Claim).where(Claim.id == claim_id))
    claim = claim_result.scalar_one_or_none()
    if claim:
        claim.status = ClaimStatus.FINALIZED
        claim.finalized_at = datetime.now(timezone.utc)
        if request.adjuster_notes:
            claim.adjuster_notes = request.adjuster_notes
        claim.approved_amount = adj.total_approved_inr
        claim.deducted_amount = adj.total_deducted_inr

    await db.flush()

    # Re-fetch to ensure line_items are still eagerly loaded after flush
    refreshed = await db.execute(
        select(AdjudicationResult)
        .where(AdjudicationResult.id == adj.id)
        .options(selectinload(AdjudicationResult.line_items))
    )
    return refreshed.scalar_one()
