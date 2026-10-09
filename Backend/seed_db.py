"""
InsuriMax Database Seeder
Populates PostgreSQL database with realistic insurance claims, adjudication results,
policies, rules, line items, and users.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.user import User, UserRole, Organization, OrgType
from app.models.claim import Claim, ClaimStatus, ClaimStatusHistory
from app.models.adjudication import (
    AdjudicationResult,
    AdjudicationStatus,
    LineItemDecision,
    LineItemStatus,
)
from app.models.policy import (
    Policy,
    PolicyVersion,
    PolicyRule,
    RuleType,
    NonPayableItem,
)
from app.models.document import Document
from app.models.query import ClaimQuery, QueryStatus


async def seed():
    async with AsyncSessionLocal() as db:
        print("[INFO] Seeding InsuriMax Database...")

        # ── 1. Seed Organizations ─────────────────────────────────────────────
        org_tpa_id = uuid.UUID("11111111-1111-1111-1111-111111111111")
        org_apollo_id = uuid.UUID("22222222-2222-2222-2222-222222222222")
        org_fortis_id = uuid.UUID("33333333-3333-3333-3333-333333333333")

        res = await db.execute(select(Organization).where(Organization.id == org_tpa_id))
        org_tpa = res.scalar_one_or_none()
        if not org_tpa:
            org_tpa = Organization(
                id=org_tpa_id,
                name="MediAssist TPA Services",
                org_type=OrgType.TPA,
            )
            db.add(org_tpa)

        res = await db.execute(select(Organization).where(Organization.id == org_apollo_id))
        org_apollo = res.scalar_one_or_none()
        if not org_apollo:
            org_apollo = Organization(
                id=org_apollo_id,
                name="Apollo Hospital, Bannerghatta",
                org_type=OrgType.HOSPITAL,
            )
            db.add(org_apollo)

        res = await db.execute(select(Organization).where(Organization.id == org_fortis_id))
        org_fortis = res.scalar_one_or_none()
        if not org_fortis:
            org_fortis = Organization(
                id=org_fortis_id,
                name="Fortis Memorial Research Institute",
                org_type=OrgType.HOSPITAL,
            )
            db.add(org_fortis)

        await db.flush()

        # ── 2. Seed Users with All 4 Roles ───────────────────────────────────
        users_data = [
            ("adjuster@insurimax.com", "Priya Sharma", UserRole.ADJUSTER, org_tpa.id),
            ("senior.adjuster@insurimax.com", "Rajesh Patel (Lead Adjuster)", UserRole.SENIOR_ADJUSTER, org_tpa.id),
            ("admin@insurimax.com", "Vikram Seth (Operations Admin)", UserRole.ADMIN, org_tpa.id),
            ("hospital@insurimax.com", "Sunita Rao (Apollo Billing)", UserRole.HOSPITAL_DESK, org_apollo.id),
        ]

        users = {}
        for email, name, role, org_id in users_data:
            res = await db.execute(select(User).where(User.email == email))
            existing = res.scalar_one_or_none()
            if existing:
                existing.full_name = name
                existing.role = role
                existing.org_id = org_id
                existing.hashed_password = hash_password("Password@123")
                users[role] = existing
            else:
                u = User(
                    id=uuid.uuid4(),
                    email=email,
                    full_name=name,
                    role=role,
                    org_id=org_id,
                    hashed_password=hash_password("Password@123"),
                    is_active=True,
                    is_verified=True,
                )
                db.add(u)
                users[role] = u

        await db.flush()
        adjuster = users[UserRole.ADJUSTER]

        # ── 3. Seed Policies, Versions, and Rules ────────────────────────────
        star_id = uuid.UUID("44444444-4444-4444-4444-444444444444")
        hdfc_id = uuid.UUID("55555555-5555-5555-5555-555555555555")

        res = await db.execute(select(Policy).where(Policy.id == star_id))
        policy_star = res.scalar_one_or_none()
        if not policy_star:
            policy_star = Policy(
                id=star_id,
                name="Star MediClassic Gold",
                insurer_name="Star Health & Allied Insurance",
                policy_type="individual",
                description="Comprehensive individual health policy with room rent limits and pre-existing disease riders.",
                org_id=org_tpa.id,
            )
            db.add(policy_star)

        res = await db.execute(select(Policy).where(Policy.id == hdfc_id))
        policy_hdfc = res.scalar_one_or_none()
        if not policy_hdfc:
            policy_hdfc = Policy(
                id=hdfc_id,
                name="HDFC ERGO Optima Restore",
                insurer_name="HDFC ERGO General Insurance",
                policy_type="family_floater",
                description="Premium family floater with zero room rent sub-limits and restore benefit.",
                org_id=org_tpa.id,
            )
            db.add(policy_hdfc)

        await db.flush()

        ver_star_id = uuid.UUID("66666666-6666-6666-6666-666666666666")
        ver_hdfc_id = uuid.UUID("77777777-7777-7777-7777-777777777777")

        res = await db.execute(select(PolicyVersion).where(PolicyVersion.id == ver_star_id))
        ver_star = res.scalar_one_or_none()
        if not ver_star:
            ver_star = PolicyVersion(
                id=ver_star_id,
                policy_id=policy_star.id,
                version_number="v2024.1",
                sum_insured_inr=500000.0,
                is_current=True,
            )
            db.add(ver_star)

        res = await db.execute(select(PolicyVersion).where(PolicyVersion.id == ver_hdfc_id))
        ver_hdfc = res.scalar_one_or_none()
        if not ver_hdfc:
            ver_hdfc = PolicyVersion(
                id=ver_hdfc_id,
                policy_id=policy_hdfc.id,
                version_number="v2024.2",
                sum_insured_inr=1000000.0,
                is_current=True,
            )
            db.add(ver_hdfc)

        await db.flush()

        # Seed Policy Rules
        res = await db.execute(select(PolicyRule).where(PolicyRule.policy_version_id == ver_star.id))
        if not res.scalars().first():
            rule1 = PolicyRule(
                id=uuid.uuid4(),
                policy_version_id=ver_star.id,
                rule_type=RuleType.ROOM_RENT_CAP,
                clause_reference="Clause 3.1(a)",
                title="Room Rent Limit",
                description="Room Rent capped at 1% of Sum Insured per day (Rs. 5,000/day).",
                limit_data={"limit_percent": 1.0, "max_per_day_inr": 5000.0},
            )
            rule2 = PolicyRule(
                id=uuid.uuid4(),
                policy_version_id=ver_star.id,
                rule_type=RuleType.PROPORTIONATE_DEDUCTION,
                clause_reference="Clause 3.1(b)",
                title="Proportionate Associate Deductions",
                description="If room rent exceeds limit, proportionate deduction applies to associate medical fees.",
                limit_data={"applies_to": ["surgeon_fee", "anesthesia", "ot_charges"]},
            )
            rule3 = PolicyRule(
                id=uuid.uuid4(),
                policy_version_id=ver_star.id,
                rule_type=RuleType.ICU_CAP,
                clause_reference="Clause 3.2",
                title="ICU Charges Limit",
                description="ICU charges capped at 2% of Sum Insured per day (Rs. 10,000/day).",
                limit_data={"limit_percent": 2.0, "max_per_day_inr": 10000.0},
            )
            db.add_all([rule1, rule2, rule3])

        # ── 4. Seed IRDAI Non-Payable Items ──────────────────────────────────
        res = await db.execute(select(NonPayableItem))
        if not res.scalars().first():
            non_payables = [
                ("PPE Kits & Surgical Gowns", "Exclusion List I, Item 31", "infection_control", True),
                ("Patient Registration & Admission Surcharge", "Exclusion List I, Item 12", "administrative", True),
                ("Hospital Diet & Attendant Food Tray", "Exclusion List I, Item 44", "dietary", True),
                ("Gloves, Syringes & Cotton Wool Consumables", "Exclusion List I, Item 28", "consumables", True),
                ("Luxury Suite Television & Room Service", "Exclusion List I, Item 5", "amenities", True),
                ("Hand Rub & Disinfectant Solution Dispenser", "Exclusion List I, Item 33", "sanitation", True),
            ]
            for item_name, ref, cat, is_std in non_payables:
                db.add(NonPayableItem(
                    id=uuid.uuid4(),
                    name=item_name,
                    category=cat,
                    description=ref,
                    irdai_standard=is_std,
                ))

        await db.flush()

        # ── 5. Seed Real Claims ──────────────────────────────────────────────
        now = datetime.now(timezone.utc)
        claims_data = [
            {
                "id": uuid.UUID("88888888-8888-8888-8888-888888888881"),
                "claim_number": "CLM-2026-8821",
                "patient_name": "Ramesh Chawla",
                "hospital_name": "Apollo Hospital, Bannerghatta",
                "hospital_org_id": org_apollo.id,
                "insurer_name": "Star Health & Allied Insurance",
                "policy_number": "SH-GOLD-99201",
                "policy_version_id": ver_star.id,
                "billed_amount": 285400.0,
                "approved_amount": 246900.0,
                "deducted_amount": 38500.0,
                "status": ClaimStatus.IN_REVIEW,
                "assigned_adjuster_id": adjuster.id,
                "ai_confidence_score": 0.94,
                "sla_deadline": now + timedelta(minutes=21),
                "sla_breached": False,
            },
            {
                "id": uuid.UUID("88888888-8888-8888-8888-888888888882"),
                "claim_number": "CLM-2026-8822",
                "patient_name": "Sunita Sundaram",
                "hospital_name": "Fortis Memorial Research Institute",
                "hospital_org_id": org_fortis.id,
                "insurer_name": "HDFC ERGO General Insurance",
                "policy_number": "HE-OPTIMA-44321",
                "policy_version_id": ver_hdfc.id,
                "billed_amount": 45000.0,
                "approved_amount": 45000.0,
                "deducted_amount": 0.0,
                "status": ClaimStatus.AUTO_APPROVED,
                "assigned_adjuster_id": adjuster.id,
                "ai_confidence_score": 0.98,
                "sla_deadline": now + timedelta(hours=1, minutes=32),
                "sla_breached": False,
            },
            {
                "id": uuid.UUID("88888888-8888-8888-8888-888888888883"),
                "claim_number": "CLM-2026-8823",
                "patient_name": "Arjun Verma",
                "hospital_name": "Max Super Speciality Hospital",
                "hospital_org_id": None,
                "insurer_name": "Care Health Insurance",
                "policy_number": "CHI-PREMIUM-71289",
                "policy_version_id": None,
                "billed_amount": 620000.0,
                "approved_amount": 485000.0,
                "deducted_amount": 135000.0,
                "status": ClaimStatus.ESCALATED,
                "assigned_adjuster_id": adjuster.id,
                "ai_confidence_score": 0.76,
                "sla_deadline": now - timedelta(minutes=18),
                "sla_breached": True,
            },
            {
                "id": uuid.UUID("88888888-8888-8888-8888-888888888884"),
                "claim_number": "CLM-2026-8824",
                "patient_name": "Meera Krishnan",
                "hospital_name": "Manipal Hospital, Whitefield",
                "hospital_org_id": None,
                "insurer_name": "Niva Bupa Health Insurance",
                "policy_number": "NB-REASSURE-10294",
                "policy_version_id": None,
                "billed_amount": 135000.0,
                "approved_amount": 118000.0,
                "deducted_amount": 17000.0,
                "status": ClaimStatus.QUERIED,
                "assigned_adjuster_id": adjuster.id,
                "ai_confidence_score": 0.88,
                "sla_deadline": now + timedelta(hours=1, minutes=47),
                "sla_breached": False,
            },
            {
                "id": uuid.UUID("88888888-8888-8888-8888-888888888885"),
                "claim_number": "CLM-2026-8825",
                "patient_name": "Rajesh Gupta",
                "hospital_name": "Narayana Institute of Cardiac Sciences",
                "hospital_org_id": None,
                "insurer_name": "ICICI Lombard General Insurance",
                "policy_number": "IL-HEART-99210",
                "policy_version_id": None,
                "billed_amount": 180000.0,
                "approved_amount": None,
                "deducted_amount": None,
                "status": ClaimStatus.SUBMITTED,
                "assigned_adjuster_id": None,  # unassigned pool
                "ai_confidence_score": 0.91,
                "sla_deadline": now + timedelta(hours=2, minutes=20),
                "sla_breached": False,
            },
        ]

        for cd in claims_data:
            res = await db.execute(select(Claim).where(Claim.claim_number == cd["claim_number"]))
            existing = res.scalar_one_or_none()
            if not existing:
                c = Claim(
                    id=cd["id"],
                    claim_number=cd["claim_number"],
                    patient_name=cd["patient_name"],
                    hospital_name=cd["hospital_name"],
                    hospital_org_id=cd["hospital_org_id"],
                    insurer_name=cd["insurer_name"],
                    policy_number=cd["policy_number"],
                    policy_version_id=cd["policy_version_id"],
                    billed_amount=cd["billed_amount"],
                    approved_amount=cd["approved_amount"],
                    deducted_amount=cd["deducted_amount"],
                    status=cd["status"],
                    assigned_adjuster_id=cd["assigned_adjuster_id"],
                    ai_confidence_score=cd["ai_confidence_score"],
                    sla_deadline=cd["sla_deadline"],
                    sla_breached=cd["sla_breached"],
                )
                db.add(c)
                db.add(ClaimStatusHistory(
                    id=uuid.uuid4(),
                    claim_id=cd["id"],
                    to_status=cd["status"],
                    changed_by_id=adjuster.id,
                    note="Initial status assigned during registration",
                ))

        await db.flush()

        # ── 6. Seed Adjudication Result & Line Items for CLM-2026-8821 ─────────
        claim_1_id = uuid.UUID("88888888-8888-8888-8888-888888888881")
        res = await db.execute(select(AdjudicationResult).where(AdjudicationResult.claim_id == claim_1_id))
        adj_1 = res.scalar_one_or_none()
        if not adj_1:
            adj_1 = AdjudicationResult(
                id=uuid.uuid4(),
                claim_id=claim_1_id,
                status=AdjudicationStatus.COMPLETED,
                total_billed_inr=285400.0,
                total_approved_inr=246900.0,
                total_deducted_inr=38500.0,
                deduction_breakdown={
                    "room_rent_excess": 21000.0,
                    "non_payables": 8400.0,
                    "unbundled_consumables": 9100.0,
                },
                gemini_model_used="gemini-1.5-pro-002",
                confidence_score=0.94,
                auto_approved=False,
                flagged_items_count=3,
            )
            db.add(adj_1)
            await db.flush()

            line_items_data = [
                {
                    "item_name": "Laparoscopic Cholecystectomy Surgeon Fee",
                    "category": "surgeon_fee",
                    "billed": 95000.0,
                    "approved": 95000.0,
                    "deducted": 0.0,
                    "status": LineItemStatus.APPROVED,
                    "citation": {"clause": "Clause 2.1 (Surgical Packages)"},
                    "reason": "Procedure verified with OT register. Surgeon credentials verified on NPI/MCI registry. Fully admissible within GIPSA PPN package rate.",
                },
                {
                    "item_name": "Deluxe Private Room Rent (3 days @ Rs. 12,000/day)",
                    "category": "room_rent",
                    "billed": 36000.0,
                    "approved": 15000.0,
                    "deducted": 21000.0,
                    "status": LineItemStatus.FLAGGED,
                    "citation": {"clause": "Clause 3.1(a) Room Rent Limit"},
                    "reason": "Policy caps room rent at 1% of Sum Insured (Rs. 5,000/day). Patient occupied Deluxe Room billed at Rs. 12,000/day. Excess Rs. 7,000/day deducted across 3 days.",
                },
                {
                    "item_name": "PPE Kits & Infection Barrier Gowns (4 kits)",
                    "category": "consumables",
                    "billed": 8400.0,
                    "approved": 0.0,
                    "deducted": 8400.0,
                    "status": LineItemStatus.NON_PAYABLE,
                    "citation": {"clause": "IRDAI Master Non-Payable Item #31"},
                    "reason": "PPE kits and barrier gowns are standard infection control exclusions per IRDAI Guidelines 2020.",
                },
                {
                    "item_name": "Anesthesia & OT Support Team Charges",
                    "category": "anesthesia",
                    "billed": 42000.0,
                    "approved": 42000.0,
                    "deducted": 0.0,
                    "status": LineItemStatus.APPROVED,
                    "citation": {"clause": "Clause 2.2 (OT Charges)"},
                    "reason": "Anesthesiologist fee aligned with surgical difficulty score and OT duration (110 mins).",
                },
                {
                    "item_name": "Post-Op Pharmacy & Disposable Trocar Cannula",
                    "category": "pharmacy",
                    "billed": 48000.0,
                    "approved": 38900.0,
                    "deducted": 9100.0,
                    "status": LineItemStatus.FLAGGED,
                    "citation": {"clause": "IRDAI Exclusion Item #28 & Clause 4.3"},
                    "reason": "Disposable cannula billed separately despite being bundled in laparoscopic package. Gloves & cotton wool deducted.",
                },
                {
                    "item_name": "Pathology Diagnostics (LFT, CBC, Ultrasound Abdomen)",
                    "category": "diagnostics",
                    "billed": 26000.0,
                    "approved": 26000.0,
                    "deducted": 0.0,
                    "status": LineItemStatus.APPROVED,
                    "citation": {"clause": "Clause 1.4 Pre-Operative Diagnostic Investigation"},
                    "reason": "All diagnostic tests clinically indicated for acute cholecystitis prior to emergency surgery.",
                },
            ]

            for idx, li in enumerate(line_items_data):
                db.add(LineItemDecision(
                    id=uuid.uuid4(),
                    adjudication_result_id=adj_1.id,
                    line_number=idx + 1,
                    item_name=li["item_name"],
                    item_category=li["category"],
                    billed_amount_inr=li["billed"],
                    approved_amount_inr=li["approved"],
                    deducted_amount_inr=li["deducted"],
                    ai_status=li["status"],
                    final_status=li["status"],
                    citation_data=li["citation"],
                    ai_explanation=li["reason"],
                ))

        # ── 7. Seed Claim Queries for CLM-2026-8824 ──────────────────────────
        claim_4_id = uuid.UUID("88888888-8888-8888-8888-888888888884")
        res = await db.execute(select(ClaimQuery).where(ClaimQuery.claim_id == claim_4_id))
        if not res.scalars().first():
            q1 = ClaimQuery(
                id=uuid.uuid4(),
                claim_id=claim_4_id,
                query_text="Please provide day-by-day platelet count laboratory reports for Day 2 and Day 3 to substantiate high-dependency monitoring charges.",
                ai_drafted=True,
                status=QueryStatus.OPEN,
                raised_by_id=adjuster.id,
            )
            db.add(q1)

        await db.commit()
        print("[SUCCESS] InsuriMax Database seeded successfully with real claims, policies, and adjudication results!")


if __name__ == "__main__":
    asyncio.run(seed())
