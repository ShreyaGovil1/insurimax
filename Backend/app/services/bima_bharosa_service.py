"""
Bima Bharosa Grievance Preparation Service
Automates preparation, text sanitization, statutory legal citation mapping,
and field normalization for the IRDAI Bima Bharosa Grievance Portal
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
    mobile: str = Field(..., min_length=10, max_length=10, description="10-digit mobile number")
    email: Optional[str] = Field(None, description="Email for grievance tracking")

    # 2. Address Details
    pincode: str = Field(..., min_length=6, max_length=6, description="6-digit Postal PIN Code")
    district: str = Field(..., description="District auto-resolved from PIN code")
    state: str = Field(..., description="State auto-resolved from PIN code")

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
    pincode = complainant.get("pincode") or claim.get("pincode") or ""
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


def generate_bima_bharosa_script(payload: Dict[str, Any]) -> str:
    """
    Generates a self-contained 1-click autofill script that works via Bookmarklet
    or browser Developer Console with autoscroll and green field highlighting.
    """
    import json

    name_json = json.dumps(payload.get("name") or "")
    email_json = json.dumps(payload.get("email") or "")
    pincode_json = json.dumps(payload.get("pincode") or "")
    company_json = json.dumps(payload.get("insurance_company_name") or "")
    identifier_json = json.dumps(payload.get("identifier_number") or "")
    complaint_json = json.dumps((payload.get("complaint_details") or "")[:400])
    raw_mobile = payload.get("mobile") or ""
    clean_mob = re.sub(r"\D", "", raw_mobile)
    mobile_val = clean_mob[-10:] if len(clean_mob) >= 10 else clean_mob
    mobile_json = json.dumps(mobile_val)

    return f"""(async function(){{
  try {{
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    
    // 1. Personal & Contact Details (Autoscroll into view)
    const n = document.getElementById('txtname_individual');
    if (n) {{
      n.scrollIntoView({{ behavior: 'smooth', block: 'center' }});
      n.value = {name_json};
      n.dispatchEvent(new Event('input', {{bubbles:true}}));
    }}
    const e = document.getElementById('txtemailofcompl_individual');
    if (e) {{ e.value = {email_json}; e.dispatchEvent(new Event('input', {{bubbles:true}})); }}
    const pin = document.getElementById('txtPinCode');
    if (pin) {{ pin.value = {pincode_json}; pin.dispatchEvent(new Event('input', {{bubbles:true}})); pin.dispatchEvent(new Event('change', {{bubbles:true}})); }}

    // 2. Unlock all sections
    if (window.$) {{
      $('#dtcomplaintcollapse *').removeAttr('disabled');
      $('#complaintnature *').removeAttr('disabled');
      $('#complaintnaturecollpse *').removeAttr('disabled');
      $('select').removeAttr('disabled');
      $('input').removeAttr('disabled');
      $('textarea').removeAttr('disabled');
    }} else {{
      document.querySelectorAll('[disabled]').forEach(el => el.removeAttribute('disabled'));
    }}
    await sleep(500);

    // 3. Section 3 Cascading Dropdowns with autoscroll
    if (window.$) {{
      const d1 = document.getElementById('ddlcomplagainstinsurer_chosen') || document.getElementById('ddlcomplagainstinsurer');
      if (d1) d1.scrollIntoView({{ behavior: 'smooth', block: 'center' }});
      $('#ddlcomplagainstinsurer').val('1').trigger('change').trigger('chosen:updated');
      await sleep(1500);

      const sComp = document.getElementById('ddlinsurancecomp');
      const d2 = document.getElementById('ddlinsurancecomp_chosen') || sComp;
      if (d2) d2.scrollIntoView({{ behavior: 'smooth', block: 'center' }});
      if (sComp) {{
        const norm = {company_json}.toLowerCase().trim();
        let opt = null;
        if (norm) {{
          for (let i = 0; i < sComp.options.length; i++) {{
            const txt = sComp.options[i].text.toLowerCase();
            if (txt.includes(norm)) {{
              opt = sComp.options[i];
              break;
            }}
          }}
        }}
        if (!opt && sComp.options.length > 1) opt = sComp.options[1];
        if (opt) {{ $(sComp).val(opt.value).trigger('change').trigger('chosen:updated'); }}
      }}
      await sleep(1500);

      const sPol = document.getElementById('ddlpolicytype');
      const d3 = document.getElementById('ddlpolicytype_chosen') || sPol;
      if (d3) d3.scrollIntoView({{ behavior: 'smooth', block: 'center' }});
      if (sPol) {{
        let opt = null;
        for (let i = 0; i < sPol.options.length; i++) {{
          if (sPol.options[i].text.toLowerCase().includes('health')) {{ opt = sPol.options[i]; break; }}
        }}
        if (!opt && sPol.options.length > 1) opt = sPol.options[1];
        if (opt) {{ $(sPol).val(opt.value).trigger('change').trigger('chosen:updated'); }}
      }}
      await sleep(1500);

      const sCompl = document.getElementById('ddlcomplainttype');
      const d4 = document.getElementById('ddlcomplainttype_chosen') || sCompl;
      if (d4) d4.scrollIntoView({{ behavior: 'smooth', block: 'center' }});
      if (sCompl) {{
        let opt = null;
        for (let i = 0; i < sCompl.options.length; i++) {{
          if (sCompl.options[i].text.toLowerCase().includes('claim')) {{ opt = sCompl.options[i]; break; }}
        }}
        if (!opt && sCompl.options.length > 1) opt = sCompl.options[1];
        if (opt) {{ $(sCompl).val(opt.value).trigger('change').trigger('chosen:updated'); }}
      }}
      await sleep(1500);

      const sDesc = document.getElementById('ddlcomplaintdesctype');
      const d5 = document.getElementById('ddlcomplaintdesctype_chosen') || sDesc;
      if (d5) d5.scrollIntoView({{ behavior: 'smooth', block: 'center' }});
      if (sDesc) {{
        const kws = ["delay on the part of tpa to provide cashless", "reduced the quantum", "refuses to extend cashless", "quantum", "cashless"];
        let opt = null;
        for (const kw of kws) {{
          for (let i = 0; i < sDesc.options.length; i++) {{
            if (sDesc.options[i].text.toLowerCase().includes(kw)) {{ opt = sDesc.options[i]; break; }}
          }}
          if (opt) break;
        }}
        if (!opt && sDesc.options.length > 1) opt = sDesc.options[1];
        if (opt) {{ $(sDesc).val(opt.value).trigger('change').trigger('chosen:updated'); }}
      }}
      await sleep(1000);
    }}

    // 4. Section 4 Claim Identifier & Complaint Details
    const clm = document.getElementById('txtPolicyProposalCertifiateClaimNumber');
    if (clm) {{
      clm.scrollIntoView({{ behavior: 'smooth', block: 'center' }});
      clm.value = {identifier_json};
      clm.dispatchEvent(new Event('input', {{bubbles:true}}));
    }}
    const rd = document.getElementById('rdClaimNumber');
    if (rd) {{ rd.checked = true; rd.dispatchEvent(new Event('change', {{bubbles:true}})); }}
    const txt = document.getElementById('txtcompldetails');
    if (txt) {{
      txt.value = {complaint_json};
      txt.dispatchEvent(new Event('input', {{bubbles:true}}));
    }}
    await sleep(500);

    // 5. Fill Mobile safely without triggering blur / OTP
    const m = document.getElementById('txtmob_individual');
    if (m) {{
      m.scrollIntoView({{ behavior: 'smooth', block: 'center' }});
      m.value = {mobile_json};
      m.dispatchEvent(new Event('input', {{bubbles:true}}));
    }}

    // 6. Highlight all prefilled fields in green
    ['#txtname_individual','#txtmob_individual','#txtemailofcompl_individual','#txtPinCode','#txtPolicyProposalCertifiateClaimNumber','#txtcompldetails','#ddlcomplagainstinsurer_chosen','#ddlinsurancecomp_chosen','#ddlpolicytype_chosen','#ddlcomplainttype_chosen','#ddlcomplaintdesctype_chosen'].forEach(s => {{
      const el = document.querySelector(s);
      if (el) {{ el.style.border = '2px solid #10b981'; el.style.backgroundColor = '#f0fdf4'; el.style.borderRadius = '6px'; }}
    }});

    window.scrollTo({{ top: 0, behavior: 'smooth' }});
    alert('✅ InsuriMax: All 11 personal, policy dropdown & grievance fields prefilled in green! OTP auto-trigger is paused to save your daily quota. When ready, click into Mobile & press Tab to generate OTP, solve CAPTCHA, and submit.');
  }} catch(err) {{
    alert('Autofill error: ' + err.message);
  }}
}})();"""


async def run_bima_bharosa_agent(
    claim: Dict[str, Any],
    issue_type: str = "discharge_delay",
    complainant_override: Optional[Dict[str, str]] = None,
    headless: bool = False,
) -> Dict[str, Any]:
    """
    Executes the autonomous Bima Bharosa Browser Agent:
    1. Prepares and sanitizes the complaint payload
    2. Launches Playwright browser automation to Bima Bharosa
    3. Populates all fields automatically with anti-detection stealth
    """
    from app.services.bima_bharosa_browser import autofill_bima_bharosa_portal

    payload = generate_bima_bharosa_payload(claim, issue_type, complainant_override)
    payload_dict = payload.model_dump()
    payload_dict["issue_type"] = issue_type

    agent_result = await autofill_bima_bharosa_portal(payload_dict, headless=headless)
    return {
        "payload": payload_dict,
        "agent_result": agent_result,
    }
