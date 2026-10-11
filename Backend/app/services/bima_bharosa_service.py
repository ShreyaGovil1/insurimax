"""
Bima Bharosa Grievance Preparation Service
Prepares a sanitized, citation-mapped complaint packet (and a printable PDF of it)
that the patient files manually on the IRDAI Bima Bharosa Grievance Portal
(https://bimabharosa.irdai.gov.in/RegComplaint/RegisterComplaint).
"""

import re
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

# IRDAI Bima Bharosa Canonical Company Name Mapping
IRDAI_COMPANY_NAMES = {
    "star health": "Star Health and Allied Insurance Company Limited",
    "hdfc ergo": "HDFC ERGO General Insurance Company Limited",
    "niva bupa": "Niva Bupa Health Insurance Company Limited",
    "care health": "Care Health Insurance Limited",
    "icici lombard": "ICICI Lombard General Insurance Company Limited",
    "bajaj allianz": "Bajaj Allianz General Insurance Company Limited",
    "new india": "The New India Assurance Company Limited",
    "oriental": "The Oriental Insurance Company Limited",
    "national": "National Insurance Company Limited",
    "united india": "United India Insurance Company Limited",
}

# Bima Bharosa Portal character restriction rule:
# Disallowed special characters: ~ ! @ # $ ^ & ; " ' [ ]
BANNED_CHARS_REGEX = re.compile(r"[~!@#$^&;\"'\[\]]")


class BimaBharosaComplaintPayload(BaseModel):
    # 1. Personal Details
    name: str = Field(..., max_length=300, description="Full Name of Complainant")
    # Contact/address fields are not stored on the claim, so they may be blank
    # and are completed by the patient before filing on the portal.
    mobile: str = Field("", max_length=10, description="10-digit mobile number")
    email: Optional[str] = Field(None, description="Email for grievance tracking")

    # 2. Address Details
    pincode: str = Field("", max_length=6, description="6-digit Postal PIN Code")
    district: str = Field("", description="District resolved from PIN code on the portal")
    state: str = Field("", description="State resolved from PIN code on the portal")

    # 3. Insurance Company And Policy Details
    complaint_against: str = Field(default="Insurer", description="Entity type: Insurer or Intermediary")
    insurance_company_name: str = Field(..., description="Exact registered insurer name in IRDAI registry")
    policy_type: str = Field(default="Health", description="Classification: Health / General")
    complaint_type: str = Field(default="Claim", description="Grievance classification")
    complaint_description_type: str = Field(..., description="Granular sub-category classification")

    # 4. Policy Identification
    identifier_type: str = Field(default="Claim Number", description="Policy Number / Claim Number")
    identifier_number: str = Field(..., description="Claim or Policy reference string")

    # 5. Complaint Description & Attachments
    complaint_details: str = Field(..., max_length=400, description="Sanitized description strictly capped at 400 characters")
    statutory_citations: List[str] = Field(default_factory=list, description="IRDAI regulations cited")


def sanitize_bima_bharosa_text(text: str) -> str:
    """
    Sanitize complaint text according to IRDAI Bima Bharosa input constraints:
    - Removes disallowed characters: ~ ! @ # $ ^ & ; " ' [ ]
    - Replaces with safe whitespace
    - Truncates strictly to 400 characters
    """
    cleaned = BANNED_CHARS_REGEX.sub(" ", text)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:400]


def resolve_irdai_company(name: str) -> str:
    """Normalize input insurer name to IRDAI Bima Bharosa official dropdown entry."""
    lower = name.lower()
    for key, canonical in IRDAI_COMPANY_NAMES.items():
        if key in lower:
            return canonical
    return name


def generate_bima_bharosa_payload(
    claim: Dict[str, Any],
    issue_type: str = "discharge_delay",
    complainant_override: Optional[Dict[str, str]] = None,
) -> BimaBharosaComplaintPayload:
    """
    Transform an InsuriMax Claim record into a valid IRDAI Bima Bharosa Complaint payload.
    Maps granular issues (preauth delay, discharge overstay, cash demand, deductions)
    to specific statutory citations under the IRDAI Master Circular 2024.
    Strictly adheres to the portal 400-character complaint text limit.
    """
    complainant = complainant_override or {}
    patient_name = complainant.get("name") or claim.get("patient_name") or ""
    raw_mobile = complainant.get("mobile") or claim.get("patient_phone") or ""
    clean_mobile = re.sub(r"\D", "", raw_mobile)
    mobile = clean_mobile[-10:] if len(clean_mobile) >= 10 else clean_mobile
    email = complainant.get("email") or claim.get("patient_email") or ""
    pincode = re.sub(r"\D", "", complainant.get("pincode") or claim.get("pincode") or "")[:6]
    district = complainant.get("district") or claim.get("district") or ""
    state = complainant.get("state") or claim.get("state") or ""

    insurer_raw = claim.get("insurer_name") or ""
    company_name = resolve_irdai_company(insurer_raw) if insurer_raw else ""
    claim_number = claim.get("claim_number") or ""
    policy_number = claim.get("policy_number") or ""
    hospital_name = claim.get("hospital_name") or ""
    billed = claim.get("billed_amount") or 0
    approved = claim.get("approved_amount") or 0
    deducted = claim.get("deducted_amount") or 0

    citations = ["IRDAI Master Circular 2024 (IRDAI/HLT/REG/2024)"]

    if issue_type in ("preauth_delay", "preauth"):
        sub_desc = "Delay in cashless pre-authorisation beyond statutory 1-hour window"
        citations.append("Section 4.1: 1-Hour Cashless Pre-Authorisation Mandate")
        raw_text = (
            f"Pre-auth delayed >1hr for Claim {claim_number}, Policy {policy_number} with {company_name}. "
            f"Patient {patient_name} admitted at {hospital_name}. Under IRDAI Master Circular 2024 Sec 4.1, "
            f"insurers must convey cashless decisions within 60 mins. "
            f"Request immediate cashless authorization without withholding treatment."
        )

    elif issue_type in ("discharge_delay", "discharge"):
        sub_desc = "Delay in final discharge approval beyond statutory 3-hour window / Overstay Violation"
        citations.append("Section 5.3: 3-Hour Final Discharge SLA & Overstay Holding Charges Liability")
        raw_text = (
            f"Discharge SLA breached (>3hrs) for Claim {claim_number}, Policy {policy_number} with {company_name}. "
            f"Patient {patient_name} at {hospital_name}, bill INR {billed}. Under IRDAI Master Circular 2024 Sec 5.3, "
            f"final authorization is mandated within 3 hours. Overstay holding fees are the sole liability of the insurer. "
            f"Request immediate release."
        )

    elif issue_type in ("cash_deposit", "deposit"):
        sub_desc = "Violation of Cashless Everywhere mandate and coercive cash advance demand"
        citations.append("IRDAI Cashless Everywhere Initiative 2024")
        raw_text = (
            f"Coercive advance cash deposit demanded for cashless Claim {claim_number}, Policy {policy_number} with {company_name}. "
            f"Patient {patient_name} at {hospital_name}. Under IRDAI Cashless Everywhere mandate 2024, "
            f"hospitals cannot demand cash deposits when cashless coverage is active. "
            f"Request immediate IRDAI enforcement."
        )

    else:
        sub_desc = "Dispute regarding deduction quantum and non-payable classification"
        citations.append("5-Year Moratorium Incontestability Rule & IRDAI Non-Payable Schedule I")
        raw_text = (
            f"Arbitrary deduction of INR {deducted} on Claim {claim_number}, Policy {policy_number} ({company_name}). "
            f"Bill INR {billed}, approved INR {approved}. Under IRDAI rules, deductions require clause citations. "
            f"Policy has 5+ continuous renewal years, protected by Moratorium incontestability against retroactive exclusions. "
            f"Seek full release."
        )

    clean_details = sanitize_bima_bharosa_text(raw_text)

    return BimaBharosaComplaintPayload(
        name=patient_name,
        mobile=mobile[-10:],
        email=email,
        pincode=pincode,
        district=district,
        state=state,
        complaint_against="Insurer",
        insurance_company_name=company_name,
        policy_type="Health",
        complaint_type="Claim",
        complaint_description_type=sub_desc,
        identifier_type="Claim Number",
        identifier_number=claim_number,
        complaint_details=clean_details,
        statutory_citations=citations,
    )


BIMA_BHAROSA_PORTAL_URL = "https://bimabharosa.irdai.gov.in/RegComplaint/RegisterComplaint"


def build_bima_bharosa_pdf(payload: Dict[str, Any], claim: Dict[str, Any]) -> bytes:
    """
    Render the prefilled complaint packet as a printable PDF the patient keeps
    beside them while filling the Bima Bharosa form manually. Fields follow the
    portal's section order; blanks are left as write-in lines.
    """
    import pymupdf as fitz

    def val(v: Any) -> str:
        return str(v).strip() if v not in (None, "") else ""

    def inr(v: Any) -> str:
        return f"INR {float(v):,.0f}" if v not in (None, "") else ""

    sections = [
        ("1. Personal details", [
            ("User type", "Individual"),
            ("Name", val(payload.get("name"))),
            ("Mobile number", val(payload.get("mobile"))),
            ("Email", val(payload.get("email"))),
        ]),
        ("2. Address details", [
            ("PIN code", val(payload.get("pincode"))),
            ("District", val(payload.get("district"))),
            ("State", val(payload.get("state"))),
        ]),
        ("3. Insurance company and policy details", [
            ("Complaint against", val(payload.get("complaint_against"))),
            ("Insurance company", val(payload.get("insurance_company_name"))),
            ("Policy type", val(payload.get("policy_type"))),
            ("Complaint type", val(payload.get("complaint_type"))),
            ("Complaint description type", val(payload.get("complaint_description_type"))),
        ]),
        ("4. Policy / claim identification", [
            ("Identifier type", val(payload.get("identifier_type"))),
            ("Claim number", val(payload.get("identifier_number"))),
            ("Policy number", val(claim.get("policy_number"))),
        ]),
        ("Claim reference (from hospital records)", [
            ("Hospital", val(claim.get("hospital_name"))),
            ("Billed amount", inr(claim.get("billed_amount"))),
            ("Approved amount", inr(claim.get("approved_amount"))),
            ("Deducted amount", inr(claim.get("deducted_amount"))),
            ("Claim status", val(claim.get("status")).replace("_", " ").title()),
        ]),
    ]

    doc = fitz.open()
    page_w, page_h = fitz.paper_size("a4")
    margin = 48
    content_w = page_w - 2 * margin
    label_w = 170
    ink = (0.1, 0.12, 0.14)
    muted = (0.42, 0.45, 0.48)
    accent = (0.04, 0.33, 0.36)
    line = (0.85, 0.86, 0.87)

    page = doc.new_page(width=page_w, height=page_h)
    y = margin

    def ensure(space: float) -> None:
        nonlocal page, y
        if y + space > page_h - margin:
            page = doc.new_page(width=page_w, height=page_h)
            y = margin

    def wrap(text: str, width: float, size: float, font: str) -> List[str]:
        lines: List[str] = []
        for para in (text or "").split("\n"):
            current = ""
            for word in para.split():
                trial = f"{current} {word}".strip()
                if current and fitz.get_text_length(trial, fontname=font, fontsize=size) > width:
                    lines.append(current)
                    current = word
                else:
                    current = trial
            lines.append(current)
        return lines or [""]

    def write(x: float, top: float, text: str, width: float, size: float, font: str = "helv", color=ink) -> float:
        """Draw wrapped text with its first baseline below `top`; returns the block height."""
        lead = size * 1.4
        lines = wrap(text, width, size, font)
        for i, ln in enumerate(lines):
            page.insert_text((x, top + size + i * lead), ln, fontname=font, fontsize=size, color=color)
        return len(lines) * lead

    def text_height(text: str, width: float, size: float, font: str = "helv") -> float:
        return len(wrap(text, width, size, font)) * size * 1.4

    page.insert_text((margin, y + 14), "IRDAI Bima Bharosa complaint - prefilled values", fontname="hebo", fontsize=15, color=ink)
    y += 24
    page.insert_text((margin, y + 10), "For your reference only. Copy these values into the form at:", fontname="helv", fontsize=9, color=muted)
    y += 14
    page.insert_text((margin, y + 10), BIMA_BHAROSA_PORTAL_URL, fontname="helv", fontsize=9, color=accent)
    y += 18
    page.draw_line((margin, y), (page_w - margin, y), color=line, width=0.8)
    y += 14

    for title, rows in sections:
        ensure(40)
        page.insert_text((margin, y + 11), title, fontname="hebo", fontsize=11, color=accent)
        y += 20
        for label, value in rows:
            shown = value or "(fill in on the portal)"
            font = "hebo" if value else "helv"
            h = text_height(shown, content_w - label_w, 10, font)
            ensure(h + 6)
            write(margin, y, label, label_w - 8, 9.5, color=muted)
            write(margin + label_w, y, shown, content_w - label_w, 10, font, ink if value else muted)
            y += h + 6
        y += 8

    details = val(payload.get("complaint_details"))
    ensure(60)
    page.insert_text((margin, y + 11), f"5. Complaint details ({len(details)}/400 characters)", fontname="hebo", fontsize=11, color=accent)
    y += 20
    h = text_height(details, content_w - 20, 10) + 16
    ensure(h)
    page.draw_rect(fitz.Rect(margin, y, page_w - margin, y + h), color=line, fill=(0.97, 0.97, 0.96), width=0.8)
    write(margin + 10, y + 6, details, content_w - 20, 10)
    y += h + 14

    citations = payload.get("statutory_citations") or []
    if citations:
        ensure(20 + 16 * len(citations))
        page.insert_text((margin, y + 11), "Regulations cited", fontname="hebo", fontsize=11, color=accent)
        y += 20
        for c in citations:
            ensure(text_height(f"- {c}", content_w, 9.5) + 4)
            y += write(margin, y, f"- {c}", content_w, 9.5) + 2
        y += 10

    steps = [
        "Open the portal link above and choose 'Register Complaint' as an individual.",
        "Copy each value from this sheet into the matching field. Fill any blank fields yourself.",
        "Enter the OTP sent to your mobile, type the CAPTCHA, and submit. Keep the complaint number you receive.",
    ]
    ensure(20 + 18 * len(steps))
    page.insert_text((margin, y + 11), "How to file", fontname="hebo", fontsize=11, color=accent)
    y += 20
    for i, st in enumerate(steps, 1):
        ensure(text_height(f"{i}. {st}", content_w, 9.5) + 4)
        y += write(margin, y, f"{i}. {st}", content_w, 9.5) + 3

    data = doc.tobytes()
    doc.close()
    return data
