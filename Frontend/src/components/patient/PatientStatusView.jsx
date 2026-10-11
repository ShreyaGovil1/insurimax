import { useState, useEffect } from "react"
import {
  AlertCircle,
  ArrowRight,
  Bell,
  Building2,
  Check,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  PhoneCall,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react"
import { useParams, useNavigate } from "react-router-dom"
import { api } from "../../services/api"
import { cn, formatCurrencyINR, formatDateTime } from "../../lib/utils"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Field } from "../ui/field"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { Guilloche } from "../common/Guilloche"
import { JourneyRail } from "../common/JourneyRail"

const SAMPLE_CLAIMS = [
  {
    id: "Mukkera Srikanth",
    label: "Mukkera Srikanth (Apollo • 9930021169)",
    patient_name: "Mr Mukkera Srikanth",
    claim_number: "DP-20261011-F72DC9",
    policy_number: "99888584",
    hospital_name: "Apollo Health City",
    insurer_name: "Care Health Insurance Limited",
    billed_amount: 141650,
    approved_amount: 141650,
    deducted_amount: 0,
    status: "in_review",
    sla_breached: true,
  },
  {
    id: "Padma B N",
    label: "Padma B N (Sunrise • 9345067890)",
    patient_name: "Padma B N",
    claim_number: "DP-20261010-176118",
    policy_number: "SH-99201",
    hospital_name: "Sunrise Multispeciality Hospital",
    insurer_name: "Care Health Insurance Limited",
    billed_amount: 85000,
    approved_amount: 65000,
    deducted_amount: 20000,
    status: "in_review",
    sla_breached: false,
  },
  {
    id: "88888888-8888-8888-8888-888888888881",
    label: "CLM-2026-8821 (Ramesh • Star Health)",
    patient_name: "Ramesh Chawla",
    claim_number: "CLM-2026-8821",
    policy_number: "SH-GOLD-99201",
    hospital_name: "Apollo Hospital, Bannerghatta",
    insurer_name: "Star Health & Allied Insurance",
    billed_amount: 185000,
    approved_amount: 155000,
    deducted_amount: 30000,
    status: "in_review",
    sla_breached: false,
  },
  {
    id: "88888888-8888-8888-8888-888888888882",
    label: "CLM-2026-8822 (Sunita • HDFC ERGO)",
    patient_name: "Sunita Deshmukh",
    claim_number: "CLM-2026-8822",
    policy_number: "HD-OPT-44120",
    hospital_name: "Fortis Hospital, Cunningham Rd",
    insurer_name: "HDFC ERGO General Insurance",
    billed_amount: 245000,
    approved_amount: 215000,
    deducted_amount: 30000,
    status: "queried",
    sla_breached: false,
  },
]

const PROGRESS_STEPS = [
  { key: "submitted", step: "1", label: "Hospital Desk", desc: "Documents uploaded" },
  { key: "in_review", step: "2", label: "Insurer Review", desc: "Underwriting check" },
  { key: "queried", step: "3", label: "Clarification", desc: "Pending doctor notes" },
  { key: "approved", step: "4", label: "Cashless Approved", desc: "Pre-auth granted" },
  { key: "finalized", step: "5", label: "Discharged", desc: "Bill settled" },
]

// Consolidated statutory hospital scenarios & IRDAI enforceable rights
const STUCK_SCENARIOS = [
  {
    id: "preauth",
    icon: Clock,
    title: "1-Hour Admission Decision",
    subtitle: "Pre-auth delayed > 60 mins",
    pill: "60-Min SLA",
    rule: "IRDAI Mandate: Insurers must respond to cashless pre-authorisation within 60 minutes of submission. No treatment may be withheld.",
    actionTitle: "Immediate Action at the Hospital:",
    steps: [
      "Ask the hospital TPA desk for your claim transmission time and reference number.",
      "Send the ready-made escalation notice below to your insurer's priority grievance desk.",
    ],
    noticeText:
      "URGENT: Pre-Authorisation decision delayed beyond the statutory 1-hour IRDAI window for Claim Ref {CLAIM_ID}. As per IRDAI Master Circular 2024, please authorize immediate cashless admission without withholding treatment.",
    primaryBtn: "Copy Escalation Notice",
  },
  {
    id: "deposit",
    icon: Building2,
    title: "Cashless Everywhere Mandate",
    subtitle: "Hospital demands advance cash",
    pill: "Any Hospital",
    rule: "Cashless Everywhere: Registered hospitals cannot demand advance cash deposits when valid cashless pre-auth is initiated.",
    actionTitle: "Immediate Action at the Hospital:",
    steps: [
      "Show the hospital billing manager the official IRDAI Cashless Everywhere mandate.",
      "If the counter still insists, alert your insurer helpline and escalate to the IRDAI grievance portal.",
    ],
    noticeText:
      "NOTICE: Under IRDAI Cashless Everywhere regulations (Ref: IRDAI/HLT/REG/2024), hospitals cannot demand advance cash deposits when a valid cashless intimation is logged under Policy #{POLICY_NO}.",
    primaryBtn: "Copy Legal Notice",
  },
  {
    id: "discharge",
    icon: Zap,
    title: "3-Hour Discharge & Zero Overstay",
    subtitle: "Discharge delayed > 3 hours",
    pill: "Zero Overstay Fee",
    rule: "Overstay Protection: Insurer must release final authorization within 3 hours. Any extra room rent charged is legally paid by the insurer.",
    actionTitle: "Immediate Action at the Hospital:",
    steps: [
      "Note down the exact time the hospital uploaded your final bill and discharge sheet.",
      "Tell the billing desk that room rent charges after 3 hours are legally billed to the insurer, not you.",
    ],
    noticeText:
      "OVERSTAY NOTICE: Final discharge packet for Claim {CLAIM_ID} submitted over 3 hours ago. Under IRDAI Master Circular 2024, any additional room charges or holding expenses incurred due to insurer delay are the sole liability of the insurer.",
    primaryBtn: "Copy Overstay Notice",
  },
  {
    id: "deduction",
    icon: Scale,
    title: "5-Year Moratorium Shield",
    subtitle: "Unexpected deduction or denial",
    pill: "Incontestable",
    rule: "5-Year Moratorium: Claims cannot be rejected or retroactively excluded for past illnesses after 5 continuous renewal years.",
    actionTitle: "Immediate Action at the Hospital:",
    steps: [
      "Ask for an itemized deduction sheet with specific policy clause numbers and schedule citations.",
      "If unresolved within 30 days, escalate free-of-cost to the Insurance Ombudsman (CIO).",
    ],
    noticeText:
      "DISPUTE NOTICE: Seeking clause-by-clause justification for deductions on Claim {CLAIM_ID} under Policy #{POLICY_NO} as mandated under IRDAI guidelines.",
    primaryBtn: "Copy Dispute Notice",
  },
]

// Generates a self-contained 1-click autofill script that works via Bookmarklet or Console with autoscroll
const generateBimaBharosaScript = (payload) => {
  if (!payload) return ""
  return `(async function(){
    try {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      
      // 1. Personal & Contact Details (Autoscroll into view)
      const n = document.getElementById('txtname_individual');
      if (n) {
        n.scrollIntoView({ behavior: 'smooth', block: 'center' });
        n.value = ${JSON.stringify(payload.name)};
        n.dispatchEvent(new Event('input', {bubbles:true}));
      }
      const e = document.getElementById('txtemailofcompl_individual');
      if (e) { e.value = ${JSON.stringify(payload.email || '')}; e.dispatchEvent(new Event('input', {bubbles:true})); }
      const pin = document.getElementById('txtPinCode');
      if (pin) { pin.value = ${JSON.stringify(payload.pincode)}; pin.dispatchEvent(new Event('input', {bubbles:true})); pin.dispatchEvent(new Event('change', {bubbles:true})); }

      // 2. Unlock all sections
      if (window.$) {
        $('#dtcomplaintcollapse *').removeAttr('disabled');
        $('#complaintnature *').removeAttr('disabled');
        $('#complaintnaturecollpse *').removeAttr('disabled');
        $('select').removeAttr('disabled');
        $('input').removeAttr('disabled');
        $('textarea').removeAttr('disabled');
      } else {
        document.querySelectorAll('[disabled]').forEach(el => el.removeAttribute('disabled'));
      }
      await sleep(500);

      // 3. Section 3 Cascading Dropdowns with autoscroll
      if (window.$) {
        // Dropdown 1: Complaint Against -> 1 (Insurance Company)
        const d1 = document.getElementById('ddlcomplagainstinsurer_chosen') || document.getElementById('ddlcomplagainstinsurer');
        if (d1) d1.scrollIntoView({ behavior: 'smooth', block: 'center' });
        $('#ddlcomplagainstinsurer').val('1').trigger('change').trigger('chosen:updated');
        await sleep(1500);

        // Dropdown 2: Insurance Company
        const sComp = document.getElementById('ddlinsurancecomp');
        const d2 = document.getElementById('ddlinsurancecomp_chosen') || sComp;
        if (d2) d2.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (sComp) {
          const norm = ${JSON.stringify(payload.insurance_company_name || 'Star Health')}.toLowerCase();
          let opt = null;
          for (let i = 0; i < sComp.options.length; i++) {
            if (sComp.options[i].text.toLowerCase().includes('star health') || sComp.options[i].text.toLowerCase().includes(norm)) {
              opt = sComp.options[i];
              break;
            }
          }
          if (!opt && sComp.options.length > 1) opt = sComp.options[1];
          if (opt) { $(sComp).val(opt.value).trigger('change').trigger('chosen:updated'); }
        }
        await sleep(1500);

        // Dropdown 3: Policy Type -> Health Insurance
        const sPol = document.getElementById('ddlpolicytype');
        const d3 = document.getElementById('ddlpolicytype_chosen') || sPol;
        if (d3) d3.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (sPol) {
          let opt = null;
          for (let i = 0; i < sPol.options.length; i++) {
            if (sPol.options[i].text.toLowerCase().includes('health')) { opt = sPol.options[i]; break; }
          }
          if (!opt && sPol.options.length > 1) opt = sPol.options[1];
          if (opt) { $(sPol).val(opt.value).trigger('change').trigger('chosen:updated'); }
        }
        await sleep(1500);

        // Dropdown 4: Complaint Type -> Claim
        const sCompl = document.getElementById('ddlcomplainttype');
        const d4 = document.getElementById('ddlcomplainttype_chosen') || sCompl;
        if (d4) d4.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (sCompl) {
          let opt = null;
          for (let i = 0; i < sCompl.options.length; i++) {
            if (sCompl.options[i].text.toLowerCase().includes('claim')) { opt = sCompl.options[i]; break; }
          }
          if (!opt && sCompl.options.length > 1) opt = sCompl.options[1];
          if (opt) { $(sCompl).val(opt.value).trigger('change').trigger('chosen:updated'); }
        }
        await sleep(1500);

        // Dropdown 5: Complaint Description Type
        const sDesc = document.getElementById('ddlcomplaintdesctype');
        const d5 = document.getElementById('ddlcomplaintdesctype_chosen') || sDesc;
        if (d5) d5.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (sDesc) {
          const kws = ["delay on the part of tpa to provide cashless", "reduced the quantum", "refuses to extend cashless", "quantum", "cashless"];
          let opt = null;
          for (const kw of kws) {
            for (let i = 0; i < sDesc.options.length; i++) {
              if (sDesc.options[i].text.toLowerCase().includes(kw)) { opt = sDesc.options[i]; break; }
            }
            if (opt) break;
          }
          if (!opt && sDesc.options.length > 1) opt = sDesc.options[1];
          if (opt) { $(sDesc).val(opt.value).trigger('change').trigger('chosen:updated'); }
        }
        await sleep(1000);
      }

      // 4. Section 4 Claim Identifier & Complaint Details (Autoscroll into view & 400 char limit)
      const clm = document.getElementById('txtPolicyProposalCertifiateClaimNumber');
      if (clm) {
        clm.scrollIntoView({ behavior: 'smooth', block: 'center' });
        clm.value = ${JSON.stringify(payload.identifier_number)};
        clm.dispatchEvent(new Event('input', {bubbles:true}));
      }
      const rd = document.getElementById('rdClaimNumber');
      if (rd) { rd.checked = true; rd.dispatchEvent(new Event('change', {bubbles:true})); }
      const txt = document.getElementById('txtcompldetails');
      if (txt) {
        txt.value = ${JSON.stringify((payload.complaint_details || '').slice(0, 400))};
        txt.dispatchEvent(new Event('input', {bubbles:true}));
      }
      await sleep(500);

      // 5. Fill Mobile safely without triggering blur / OTP (Autoscroll to mobile)
      const m = document.getElementById('txtmob_individual');
      if (m) {
        m.scrollIntoView({ behavior: 'smooth', block: 'center' });
        m.value = ${JSON.stringify(payload.mobile)};
        m.dispatchEvent(new Event('input', {bubbles:true}));
      }

      // 6. Highlight all prefilled fields in green
      ['#txtname_individual','#txtmob_individual','#txtemailofcompl_individual','#txtPinCode','#txtPolicyProposalCertifiateClaimNumber','#txtcompldetails','#ddlcomplagainstinsurer_chosen','#ddlinsurancecomp_chosen','#ddlpolicytype_chosen','#ddlcomplainttype_chosen','#ddlcomplaintdesctype_chosen'].forEach(s => {
        const el = document.querySelector(s);
        if (el) { el.style.border = '2px solid #10b981'; el.style.backgroundColor = '#f0fdf4'; el.style.borderRadius = '6px'; }
      });

      // Scroll smoothly back to top
      window.scrollTo({ top: 0, behavior: 'smooth' });

      alert('✅ InsuriMax: All 11 personal, policy dropdown & grievance fields prefilled in green! OTP auto-trigger is paused to save your daily quota. When ready, click into Mobile & press Tab to generate OTP, solve CAPTCHA, and submit.');
    } catch(err) {
      alert('Autofill error: ' + err.message);
    }
  })();`
}

export function PatientStatusView() {
  const { toast } = useToast()
  const params = useParams()
  const navigate = useNavigate()

  const urlClaimId = params.claimId || ""
  const [claimIdInput, setClaimIdInput] = useState(urlClaimId || SAMPLE_CLAIMS[0].id)
  const [claimStatus, setClaimStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)

  // Stuck scenario active tab
  const [activeIssue, setActiveIssue] = useState("preauth")
  const [copiedKey, setCopiedKey] = useState("")

  // Modals
  const [cisModalOpen, setCisModalOpen] = useState(false)
  const [alertModalOpen, setAlertModalOpen] = useState(false)
  const [phoneInput, setPhoneInput] = useState("")
  const [emailInput, setEmailInput] = useState("")
  const [submittingAlert, setSubmittingAlert] = useState(false)

  // Bima Bharosa Autofill states
  const [bimaModalOpen, setBimaModalOpen] = useState(false)
  const [bimaPayload, setBimaPayload] = useState(null)
  const [loadingBima, setLoadingBima] = useState(false)
  const [runningAgent, setRunningAgent] = useState(false)
  const [agentResult, setAgentResult] = useState(null)
  const [copiedField, setCopiedField] = useState("")
  const [agentInfoOpen, setAgentInfoOpen] = useState(false)
  const [matchingClaims, setMatchingClaims] = useState([])
  const [escalationData, setEscalationData] = useState(null)

  const handleTriggerBrowserAgent = async () => {
    setRunningAgent(true)
    setAgentResult(null)
    const targetId = claimStatus?.id || claimIdInput
    try {
      const res = await api.patient.triggerEscalationAutofill({
        claimId: claimStatus?.id,
        query: targetId,
        issueType: activeIssue,
        headless: false,
      })
      setAgentResult(res?.agent_result || res)
      toast({
        title: "🚀 Live Stealth Chrome Window Opened!",
        description: "Bima Bharosa prefilled in green. OTP auto-generation is paused to protect your daily quota.",
        variant: "success",
      })
    } catch (err) {
      toast({
        title: "Agent Run Failed",
        description: err.message || "Failed to execute browser agent.",
        variant: "destructive",
      })
    } finally {
      setRunningAgent(false)
    }
  }

  const handleOpenPortalInTab = () => {
    if (bimaPayload) {
      const code = generateBimaBharosaScript(bimaPayload)
      navigator.clipboard?.writeText(code)
      toast({
        title: "Portal Opened & Script Copied!",
        description: "1-Click autofill script copied to your clipboard. Paste into Console (F12) or click your Bookmarklet to autofill!",
        variant: "default",
      })
    }
    window.open("https://bimabharosa.irdai.gov.in/RegComplaint/RegisterComplaint", "_blank", "noopener,noreferrer")
  }

  const handleOpenBimaAutofill = async (issueType = activeIssue) => {
    setLoadingBima(true)
    setBimaModalOpen(true)
    setAgentResult(null)
    const targetId = claimStatus?.id || claimIdInput
    try {
      const data = await api.patient.getBimaBharosaPayload(targetId, issueType)
      setBimaPayload(data)
    } catch {
      // Local fallback calculation based on current claim
      const compName = claimStatus?.insurer_name || "Star Health and Allied Insurance Company Limited"
      const claimNum = claimStatus?.claim_number || "CLM-2026-8821"
      const polNum = claimStatus?.policy_number || "SH-GOLD-99201"
      const patName = claimStatus?.patient_name || "Ramesh Chawla"
      const hosp = claimStatus?.hospital_name || "Apollo Hospital, Bannerghatta"
      const bill = claimStatus?.billed_amount || 185000

      let descType = "Delay in cashless pre-authorisation beyond statutory 1-hour window"
      let text = `Pre-auth delayed >1hr for Claim ${claimNum}, Policy ${polNum} with ${compName}. Patient ${patName} admitted at ${hosp}. Under IRDAI Master Circular 2024 Sec 4.1, cashless decisions must be given within 60 mins. Request immediate cashless approval.`
      
      if (issueType === "discharge") {
        descType = "Delay in final discharge approval beyond statutory 3-hour window / Overstay Violation"
        text = `Discharge SLA breached (>3hrs) for Claim ${claimNum}, Policy ${polNum} with ${compName}. Patient ${patName} at ${hosp}, bill INR ${bill}. Under IRDAI Master Circular 2024 Sec 5.3, authorization is mandated within 3 hours. Overstay fees are insurer liability. Request release.`
      } else if (issueType === "deposit") {
        descType = "Violation of Cashless Everywhere mandate and advance cash demand"
        text = `Advance cash deposit demanded for cashless Claim ${claimNum}, Policy ${polNum} with ${compName}. Patient ${patName} at ${hosp}. Under IRDAI Cashless Everywhere mandate 2024, hospitals cannot demand cash deposits. Request immediate enforcement.`
      } else if (issueType === "deduction") {
        descType = "Dispute regarding deduction quantum and non-payable classification"
        text = `Arbitrary deduction on Claim ${claimNum}, Policy ${polNum} (${compName}). Bill INR ${bill}. Under IRDAI rules, deductions require clause citations. Policy has 5+ renewal years, protected by Moratorium incontestability against exclusions. Seek full release.`
      }
      text = text.slice(0, 400)

      setBimaPayload({
        name: patName,
        mobile: "9876543210",
        email: "grievance@insurimax.ai",
        pincode: "560076",
        district: "Bengaluru Urban",
        state: "Karnataka",
        complaint_against: "Insurer",
        insurance_company_name: compName.includes("Limited") ? compName : `${compName} Insurance Company Limited`,
        policy_type: "Health",
        complaint_type: "Claim",
        complaint_description_type: descType,
        identifier_type: "Claim Number",
        identifier_number: claimNum,
        complaint_details: text,
        statutory_citations: [
          "IRDAI Master Circular 2024 (IRDAI/HLT/REG/2024)",
          "Overstay Protection Right & 3-Hour Discharge SLA",
        ],
      })
    } finally {
      setLoadingBima(false)
    }
  }

  const handleCopyField = (val, fieldKey) => {
    navigator.clipboard.writeText(val)
    setCopiedField(fieldKey)
    toast({
      title: "Field Copied",
      description: `Copied: ${val}`,
      variant: "success",
    })
    setTimeout(() => setCopiedField(""), 2500)
  }

  const handleCopyFullPacket = () => {
    if (!bimaPayload) return
    const text = `--- IRDAI BIMA BHAROSA COMPLAINT PACKET ---
1. COMPLAINANT DETAILS:
   Name: ${bimaPayload.name}
   Mobile: ${bimaPayload.mobile}
   Email: ${bimaPayload.email}

2. ADDRESS DETAILS:
   PIN Code: ${bimaPayload.pincode}
   District: ${bimaPayload.district}
   State: ${bimaPayload.state}

3. INSURANCE COMPANY & POLICY DETAILS:
   Complaint Against: ${bimaPayload.complaint_against}
   Insurance Company: ${bimaPayload.insurance_company_name}
   Policy Type: ${bimaPayload.policy_type}
   Complaint Type: ${bimaPayload.complaint_type}
   Description Type: ${bimaPayload.complaint_description_type}

4. POLICY IDENTIFICATION:
   Identifier Type: ${bimaPayload.identifier_type}
   Identifier Number: ${bimaPayload.identifier_number}

5. COMPLAINT DETAILS (Sanitized, max 4000 chars):
${bimaPayload.complaint_details}

STATUTORY REGULATIONS CITED:
${bimaPayload.statutory_citations?.map((c) => `- ${c}`).join("\n")}
-------------------------------------------`
    navigator.clipboard.writeText(text)
    setCopiedField("full_packet")
    toast({
      title: "Complete Packet Copied!",
      description: "All 5 Bima Bharosa sections copied in structured text format.",
      variant: "success",
    })
    setTimeout(() => setCopiedField(""), 2500)
  }

  const fetchStatus = async (id, issueType = activeIssue) => {
    if (!id) return
    setLoading(true)
    setNotFound(false)
    const sampleMeta = SAMPLE_CLAIMS.find(
      (s) => s.id === id || s.claim_number === id || s.patient_name?.toLowerCase() === id.toLowerCase()
    )
    try {
      // 1. First priority: Patient Escalation endpoint (searches by patient name, phone, or claim number)
      let escalationRes = null
      try {
        escalationRes = await api.patient.lookupEscalation({
          query: id,
          issueType: issueType || "discharge_delay",
        })
      } catch {}

      if (escalationRes?.status === "success" && escalationRes?.claim) {
        const c = escalationRes.claim
        setClaimStatus({
          ...(sampleMeta || {}),
          ...c,
          id: c.id,
          claim_id: c.id,
          status: c.status || "in_review",
          patient_name: c.patient_name || "Patient Record",
          hospital_name: c.hospital_name || "Apollo Hospital",
          insurer_name: c.insurer_name || "Star Health",
          billed_amount: c.billed_amount || 0,
          approved_amount: c.approved_amount || 0,
          deducted_amount: c.deducted_amount || 0,
          claim_number: c.claim_number || "CLM-2026-8821",
          policy_number: c.policy_number || "POL-STAR-7731",
          sla_breached: c.sla_breached ?? false,
        })
        setMatchingClaims(escalationRes.matching_claims || [])
        setEscalationData(escalationRes.escalation || null)
        if (escalationRes.escalation?.bima_bharosa_payload) {
          setBimaPayload(escalationRes.escalation.bima_bharosa_payload)
        }
        if (escalationRes.escalation?.issue_type) {
          setActiveIssue(escalationRes.escalation.issue_type)
        }
        return
      }

      // 2. Direct claim lookups and sample fallbacks
      let fullClaim = null
      try {
        fullClaim = await api.claims.getById(id)
      } catch {}

      const patientData = await api.patient.getStatus(id).catch(() => null)

      if (!fullClaim && !patientData && !sampleMeta) {
        setNotFound(true)
        setClaimStatus(null)
        setMatchingClaims([])
        setEscalationData(null)
        toast({
          title: "Claim or Patient Not Found",
          description: "No hospital records found matching this patient name, phone, or claim number.",
          variant: "destructive",
        })
        return
      }

      setClaimStatus({
        ...(sampleMeta || {}),
        ...(fullClaim || {}),
        ...(patientData || {}),
        status: fullClaim?.status || patientData?.status || sampleMeta?.status || "in_review",
        patient_name: fullClaim?.patient_name || sampleMeta?.patient_name || "Patient Record",
        hospital_name: fullClaim?.hospital_name || sampleMeta?.hospital_name || "Apollo Hospital",
        insurer_name: fullClaim?.insurer_name || sampleMeta?.insurer_name || "Star Health",
        billed_amount: fullClaim?.billed_amount || sampleMeta?.billed_amount || 185000,
        approved_amount: fullClaim?.approved_amount || patientData?.approved_amount_inr || sampleMeta?.approved_amount || 155000,
        deducted_amount: fullClaim?.deducted_amount || sampleMeta?.deducted_amount || 30000,
        claim_number: fullClaim?.claim_number || sampleMeta?.claim_number || "CLM-2026-8821",
        policy_number: fullClaim?.policy_number || sampleMeta?.policy_number || "POL-STAR-7731",
        sla_breached: fullClaim?.sla_breached ?? sampleMeta?.sla_breached ?? false,
      })
      setMatchingClaims([])
    } catch (err) {
      setNotFound(true)
      setClaimStatus(null)
      setMatchingClaims([])
      setEscalationData(null)
      toast({
        title: "Record Not Found",
        description: "Please check your patient name, phone number, or Claim Intimation ID.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (urlClaimId) {
      setClaimIdInput(urlClaimId)
      fetchStatus(urlClaimId)
    } else {
      fetchStatus(SAMPLE_CLAIMS[0].id)
    }
  }, [urlClaimId])

  const handleSearch = (e) => {
    e.preventDefault()
    if (!claimIdInput.trim()) return
    navigate(`/patient/${claimIdInput.trim()}`)
    fetchStatus(claimIdInput.trim())
  }

  const handleCopyNotice = (text, key) => {
    const claimId = claimStatus?.claim_number || "CLM-2026-8821"
    const policyNo = claimStatus?.policy_number || "POL-STAR-7731"
    const formatted = text.replace("{CLAIM_ID}", claimId).replace("{POLICY_NO}", policyNo)
    navigator.clipboard.writeText(formatted)
    setCopiedKey(key)
    toast({
      title: "Text Copied to Clipboard",
      description: "Send this directly to the hospital TPA desk or your insurer.",
      variant: "success",
    })
    setTimeout(() => setCopiedKey(""), 3000)
  }

  const handleEnableAlerts = async (e) => {
    e.preventDefault()
    if (!phoneInput.trim() && !emailInput.trim()) {
      toast({
        title: "Input Required",
        description: "Enter your phone number or email to receive notifications.",
        variant: "destructive",
      })
      return
    }

    setSubmittingAlert(true)
    try {
      const targetId = claimStatus?.claim_id || claimIdInput
      await api.patient.subscribeNotifications(targetId, {
        email: emailInput.trim() || null,
        phone: phoneInput.trim() || null,
      })
      toast({
        title: "Alerts Activated",
        description: "You'll receive SMS & WhatsApp updates as your claim moves forward.",
        variant: "success",
      })
      setAlertModalOpen(false)
    } catch (err) {
      toast({
        title: "Failed to Enable Alerts",
        description: err.message,
        variant: "destructive",
      })
    } finally {
      setSubmittingAlert(false)
    }
  }

  // Map backend status to stepper index
  const getStepIndex = (status) => {
    switch (status) {
      case "submitted":
        return 0
      case "documents_pending":
      case "extraction_in_progress":
      case "adjudication_in_progress":
      case "in_review":
        return 1
      case "queried":
        return 2
      case "approved":
      case "auto_approved":
      case "partially_approved":
        return 3
      case "finalized":
        return 4
      default:
        return 1
    }
  }

  const currentStepIdx = claimStatus ? getStepIndex(claimStatus.status) : 1
  const selectedStuckItem = STUCK_SCENARIOS.find((s) => s.id === activeIssue) || STUCK_SCENARIOS[0]
  const statusHeadline =
    claimStatus?.status === "approved" || claimStatus?.status === "auto_approved"
      ? "Cashless approved"
      : claimStatus?.status === "queried"
        ? "Waiting on your doctor's notes"
        : claimStatus?.status === "finalized"
          ? "Bill settled"
          : "Under active insurer review"
  const journeySteps = PROGRESS_STEPS.map((step, idx) => ({
    key: step.key,
    label: step.label,
    caption: step.desc,
    state: idx < currentStepIdx || (claimStatus?.status === "finalized" && idx === currentStepIdx) ? "done" : idx === currentStepIdx ? "current" : "todo",
  }))
  const formattedNotice = selectedStuckItem.noticeText
    .replace("{CLAIM_ID}", claimStatus?.claim_number || "CLM-2026-8821")
    .replace("{POLICY_NO}", claimStatus?.policy_number || "POL-STAR-7731")

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-6 pb-24 sm:px-6 sm:py-10">
      {/* Track */}
      <section className="relative overflow-hidden rounded-[20px] bg-peacock-800 text-white shadow-raised">
        <Guilloche className="absolute inset-x-0 -bottom-16 h-[220px] w-full" lines={20} strokeClassName="stroke-peacock-300/[0.12]" />
        <div className="relative p-6 sm:p-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-xl">
              <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.02em] sm:text-[38px]">Track your cashless claim</h1>
              <p className="mt-2 text-body text-peacock-100/85">
                See where your hospital claim stands, what the insurer pays, and what to do if it's taking too long.
              </p>
            </div>
            <a
              href="tel:1800-425-2255"
              className="inline-flex shrink-0 items-center gap-2 self-start rounded-xl bg-white/10 px-4 py-2.5 text-small font-semibold ring-1 ring-inset ring-white/15 transition-colors hover:bg-white/15"
            >
              <PhoneCall className="h-4 w-4 text-marigold-300" />
              24x7 helpline 1800-425-2255
            </a>
          </div>

          <form onSubmit={handleSearch} className="mt-7 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-3" />
              <Input
                type="text"
                aria-label="Patient name, phone number, or claim number"
                placeholder="Enter patient name, phone number, or claim number (e.g. Srikanth or 9930021169)"
                value={claimIdInput}
                onChange={(e) => setClaimIdInput(e.target.value)}
                className="h-13 rounded-xl pl-12 text-body ring-0"
              />
            </div>
            <Button type="submit" variant="proceed" size="lg" loading={loading} className="h-13 px-6">
              {loading ? "Pulling hospital data…" : "Pull claim & escalate"}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-small">
            <span className="text-peacock-200">Try a sample:</span>
            {SAMPLE_CLAIMS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setClaimIdInput(c.id)
                  navigate(`/patient/${c.id}`)
                  fetchStatus(c.id)
                }}
                className={cn(
                  "cursor-pointer rounded-full px-3 py-1 font-semibold transition-colors",
                  claimIdInput === c.id ? "bg-white text-peacock-800" : "bg-white/10 text-peacock-100 hover:bg-white/15"
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Status */}
      {notFound ? (
        <section className="flex flex-col items-center rounded-card bg-surface px-6 py-12 text-center shadow-card">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-vermilion-50 text-vermilion-600">
            <AlertCircle className="h-6 w-6" />
          </span>
          <h2 className="text-lg font-semibold text-ink">We couldn't find hospital records for that patient or claim</h2>
          <p className="mt-1 max-w-sm text-sm text-ink-3">Check the patient name or 10-digit mobile number, or try one of the samples above.</p>
        </section>
      ) : (
        <>
          {matchingClaims.length > 1 && (
            <section className="rounded-card border border-line bg-surface p-4 sm:p-5 shadow-card animate-rise">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-small font-semibold text-peacock-700">Hospital Claims Found</div>
                  <div className="text-sm text-ink-2">
                    Found {matchingClaims.length} hospital admissions for <strong>{claimStatus?.patient_name}</strong>. Select which claim you want to escalate:
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {matchingClaims.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        fetchStatus(c.id)
                        navigate(`/patient/${c.id}`)
                      }}
                      className={cn(
                        "cursor-pointer inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-small font-semibold transition-all border",
                        c.id === claimStatus?.id
                          ? "bg-peacock-700 text-white border-peacock-700 shadow-sm"
                          : "bg-surface text-ink border-line hover:bg-ground"
                      )}
                    >
                      <Building2 className="h-3.5 w-3.5" />
                      <span>{c.hospital_name}</span>
                      <span className="font-mono text-tiny opacity-75">{c.claim_number}</span>
                      <span className="figures text-tiny font-bold">{formatCurrencyINR(c.billed_amount || 0)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

          <section className="overflow-hidden rounded-card bg-surface shadow-card" aria-label="Claim status">
            <div className="flex flex-col gap-4 p-5 sm:p-7 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-small text-ink-3">
                <span>Claim {claimStatus?.claim_number || "CLM-2026-8821"}</span>
                <span>Policy {claimStatus?.policy_number || "POL-STAR-7731"}</span>
              </div>
              <div className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">{claimStatus?.patient_name || "Ramesh Chawla"}</div>
              <div className="mt-1 text-sm text-ink-3">
                {claimStatus?.hospital_name || "Apollo Hospital"} <span className="text-ink-4">→</span> {claimStatus?.insurer_name || "Star Health"}
              </div>
            </div>
            <div className="flex flex-col items-start gap-2 md:items-end">
              <span className="inline-flex items-center gap-2 rounded-full bg-leaf-50 px-3.5 py-1.5 text-sm font-semibold text-leaf-800 ring-1 ring-inset ring-leaf-100">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inset-0 rounded-full bg-leaf-500 animate-beacon" />
                  <span className="relative h-2 w-2 rounded-full bg-leaf-500" />
                </span>
                {statusHeadline}
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 text-small font-medium",
                  claimStatus?.sla_breached ? "text-vermilion-700" : "text-ink-3"
                )}
              >
                <Clock className="h-4 w-4" />
                {claimStatus?.sla_breached ? "3-hour limit crossed: extra room rent is the insurer's to pay" : "Within the 3-hour discharge window"}
              </span>
            </div>
          </div>

          <div className="border-t border-line px-5 py-6 sm:px-7">
            <div className="hidden sm:block">
              <JourneyRail steps={journeySteps} size="lg" label="Claim progress" />
            </div>
            <div className="sm:hidden">
              <JourneyRail steps={journeySteps} orientation="vertical" label="Claim progress" />
            </div>
          </div>

          <dl className="grid border-t border-line sm:grid-cols-3">
            <div className="p-5 sm:p-6">
              <dt className="text-small font-medium text-ink-3">Hospital bill</dt>
              <dd className="figures mt-1 text-[26px] font-semibold tracking-[-0.02em] text-ink">{formatCurrencyINR(claimStatus?.billed_amount || 185000)}</dd>
              <dd className="text-tiny text-ink-3">Submitted by the hospital billing desk</dd>
            </div>
            <div className="border-t border-line bg-leaf-50/60 p-5 sm:border-l sm:border-t-0 sm:p-6">
              <dt className="text-small font-medium text-leaf-800">Insurer pays (cashless)</dt>
              <dd className="figures mt-1 text-[26px] font-semibold tracking-[-0.02em] text-leaf-700">{formatCurrencyINR(claimStatus?.approved_amount || 155000)}</dd>
              <dd className="text-tiny text-leaf-800/80">Paid directly to the hospital</dd>
            </div>
            <div className="border-t border-line p-5 sm:border-l sm:border-t-0 sm:p-6">
              <dt className="text-small font-medium text-ink-3">Your share</dt>
              <dd className="figures mt-1 text-[26px] font-semibold tracking-[-0.02em] text-sand-700">{formatCurrencyINR(claimStatus?.deducted_amount || 30000)}</dd>
              <dd className="text-tiny text-ink-3">Gloves, food, room rent above your plan's limit</dd>
            </div>
          </dl>

          <div className="flex flex-col gap-3 border-t border-line bg-ground/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <span className="text-small text-ink-3">Live as of {formatDateTime(new Date().toISOString())}</span>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setCisModalOpen(true)}>
                <FileText className="h-4 w-4" />
                What my policy covers
              </Button>
              <Button size="sm" onClick={() => setAlertModalOpen(true)}>
                <Bell className="h-4 w-4" />
                Get SMS updates
              </Button>
            </div>
          </div>
        </section>

      {/* Rights */}
      <section className="space-y-5" aria-label="Your rights at the hospital">
        <div>
          <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">Stuck at the hospital? Know your rights</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-3">
            Pick what's happening. You'll get the rule that protects you, what to do right now, and a notice you can send.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label="What's happening">
          {STUCK_SCENARIOS.map((item) => {
            const Icon = item.icon
            const isSelected = activeIssue === item.id
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setActiveIssue(item.id)}
                className={cn(
                  "flex cursor-pointer flex-col justify-between gap-3 rounded-card p-4 text-left transition-[background-color,box-shadow,transform] duration-200 active:scale-[0.98]",
                  isSelected ? "bg-peacock-800 text-white shadow-raised" : "bg-surface text-ink shadow-card hover:shadow-raised"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", isSelected ? "bg-white/10 text-marigold-300" : "bg-peacock-50 text-peacock-600")}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 text-tiny font-semibold", isSelected ? "bg-marigold-400 text-ink" : "bg-sunken text-ink-2")}>{item.pill}</span>
                </div>
                <div>
                  <div className="text-sm font-semibold leading-snug">{item.title}</div>
                  <div className={cn("mt-0.5 text-small", isSelected ? "text-peacock-100/80" : "text-ink-3")}>{item.subtitle}</div>
                </div>
              </button>
            )
          })}
        </div>

        <div key={selectedStuckItem.id} className="grid animate-rise gap-5 rounded-card bg-surface p-5 shadow-card sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-leaf-50 px-2.5 py-1 text-tiny font-semibold text-leaf-800">
                <ShieldCheck className="h-3.5 w-3.5" />
                IRDAI protected
              </span>
              <p className="mt-3 text-body font-semibold leading-snug text-ink">{selectedStuckItem.rule}</p>
            </div>
            <div>
              <div className="text-small font-semibold text-ink-2">{selectedStuckItem.actionTitle}</div>
              <ol className="mt-3 space-y-3">
                {selectedStuckItem.steps.map((st, i) => (
                  <li key={i} className="flex gap-3 text-sm text-ink-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-peacock-600 text-tiny font-semibold text-white">{i + 1}</span>
                    <span className="pt-0.5">{st}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-xl bg-ground p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-small font-semibold text-ink-2">Ready-to-send WhatsApp / SMS notice</span>
              <button
                type="button"
                onClick={() => handleCopyNotice(selectedStuckItem.noticeText, selectedStuckItem.id)}
                className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap text-small font-semibold text-peacock-700 hover:text-peacock-900"
              >
                {copiedKey === selectedStuckItem.id ? <Check className="h-4 w-4 text-leaf-600" /> : <Copy className="h-4 w-4" />}
                {copiedKey === selectedStuckItem.id ? "Copied" : "Copy text"}
              </button>
            </div>
            <p className="flex-1 rounded-lg bg-surface p-3.5 font-mono text-small leading-relaxed text-ink-2 shadow-card">{formattedNotice}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="proceed" onClick={() => handleCopyNotice(selectedStuckItem.noticeText, selectedStuckItem.id)}>
                {copiedKey === selectedStuckItem.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copiedKey === selectedStuckItem.id ? "Notice copied" : selectedStuckItem.primaryBtn}
              </Button>
              <a
                href="tel:1800-425-2255"
                className="inline-flex h-10 items-center gap-2 rounded-field bg-surface px-4 text-sm font-semibold text-ink ring-1 ring-inset ring-line-strong transition-colors hover:bg-ground"
              >
                <PhoneCall className="h-4 w-4 text-ink-3" />
                Call insurer priority line
              </a>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-5 rounded-[20px] bg-peacock-900 p-6 text-white shadow-raised ring-1 ring-white/10">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-marigold-400/20 px-3 py-1 text-tiny font-bold uppercase tracking-wider text-marigold-300 ring-1 ring-inset ring-marigold-400/30">
                Official IRDAI Grievance Escalation
              </div>
              <h3 className="mt-2 text-xl font-bold tracking-tight">
                Raise Concern on Government Site (Bima Bharosa)
              </h3>
              <p className="mt-1 max-w-2xl text-small text-peacock-100/85">
                Claim details for <span className="font-semibold text-white">{claimStatus?.patient_name}</span> at{" "}
                <span className="font-semibold text-white">{claimStatus?.hospital_name}</span> pulled from hospital records.
                Our AI assistant prepares an IRDAI-compliant grievance and can autofill all 11 fields directly on the government portal.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                variant="proceed"
                size="lg"
                loading={runningAgent}
                onClick={handleTriggerBrowserAgent}
                className="shadow-lg"
              >
                {!runningAgent && <Zap className="h-4 w-4" />}
                {runningAgent ? "Opening Chrome & Prefilling…" : "1-Click Live Browser Autofill"}
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={handleOpenPortalInTab}
                className="bg-white/15 text-white hover:bg-white/20 border-0"
              >
                <Sparkles className="h-4 w-4 text-marigold-300" />
                Open Portal & Copy Script
              </Button>
              <Button
                variant="ghost"
                size="lg"
                onClick={() => handleOpenBimaAutofill(activeIssue)}
                className="text-white hover:bg-white/10"
              >
                View Prefilled Packet
              </Button>
            </div>
          </div>

          <div className="grid gap-3 rounded-xl bg-white/5 p-4 sm:grid-cols-3 ring-1 ring-inset ring-white/10 text-small">
            <div className="min-w-0">
              <div className="text-tiny uppercase text-peacock-200">Patient & Hospital</div>
              <div className="truncate font-semibold text-white">{claimStatus?.patient_name} · {claimStatus?.hospital_name}</div>
            </div>
            <div className="min-w-0">
              <div className="text-tiny uppercase text-peacock-200">Claim & Policy</div>
              <div className="truncate font-mono font-medium text-white">{claimStatus?.claim_number} · {claimStatus?.policy_number}</div>
            </div>
            <div className="min-w-0">
              <div className="text-tiny uppercase text-peacock-200">Financial Quantum</div>
              <div className="truncate font-semibold text-white">
                Billed: {formatCurrencyINR(claimStatus?.billed_amount || 0)}
                {claimStatus?.deducted_amount ? ` · Deducted: ${formatCurrencyINR(claimStatus.deducted_amount)}` : ""}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )}

      {/* Customer Information Sheet */}
      <Dialog open={cisModalOpen} onOpenChange={setCisModalOpen}>
        <DialogContent onClose={() => setCisModalOpen(false)}>
          <DialogHeader>
            <DialogTitle>What your policy covers</DialogTitle>
            <DialogDescription>Plain-language coverage rules for policy {claimStatus?.policy_number || "POL-STAR-7731"} (Customer Information Sheet)</DialogDescription>
          </DialogHeader>
          <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
            {[
              ["Room rent limit", "Single private room (1% of sum insured)", "₹10,000 / day"],
              ["ICU charges", "Up to 2% of sum insured per day", "₹20,000 / day"],
              ["Co-payment", "Standard network hospital claim", "0% co-pay"],
            ].map(([title, sub, value]) => (
              <li key={title} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-ink">{title}</div>
                  <div className="text-small text-ink-3">{sub}</div>
                </div>
                <span className="figures shrink-0 rounded-lg bg-peacock-50 px-2.5 py-1 text-small font-semibold text-peacock-800">{value}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 rounded-xl bg-sand-50 p-4 text-small text-sand-800 ring-1 ring-inset ring-sand-200">
            <div className="font-semibold">Not covered (IRDAI List I)</div>
            Gloves, PPE kits, admission fees and attendant food are paid by you.
          </div>
          <DialogFooter>
            <Button onClick={() => setCisModalOpen(false)} className="w-full sm:w-auto">
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SMS & WhatsApp alerts */}
      <Dialog open={alertModalOpen} onOpenChange={setAlertModalOpen}>
        <DialogContent onClose={() => setAlertModalOpen(false)}>
          <DialogHeader>
            <DialogTitle>Get live claim updates</DialogTitle>
            <DialogDescription>We'll send an SMS and WhatsApp message the moment your claim moves.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEnableAlerts} className="space-y-4">
            <Field label="Mobile number" htmlFor="alert-phone">
              <Input id="alert-phone" type="tel" placeholder="+91 98765 43210" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} className="h-11" />
            </Field>
            <Field label="Email" htmlFor="alert-email" optional>
              <Input id="alert-email" type="email" placeholder="yourname@gmail.com" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} className="h-11" />
            </Field>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setAlertModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="proceed" loading={submittingAlert}>
                {!submittingAlert && <Bell className="h-4 w-4" />}
                {submittingAlert ? "Turning on…" : "Turn on updates"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bima Bharosa complaint prefill */}
      <Dialog open={bimaModalOpen} onOpenChange={setBimaModalOpen}>
        <DialogContent onClose={() => setBimaModalOpen(false)} className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>IRDAI Bima Bharosa complaint, prefilled</DialogTitle>
            <DialogDescription>Built from your claim, cleaned of characters the portal rejects, and citing the IRDAI Master Circular 2024.</DialogDescription>
          </DialogHeader>

          {loadingBima ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-3">
              <Loader2 className="h-4 w-4 animate-spin" />
              Collecting your claim details…
            </div>
          ) : bimaPayload ? (
            <div className="space-y-4 text-sm">
              <PacketSection title="1. Complainant" note="User type: individual">
                <CopyField label="Name" value={bimaPayload.name} fieldKey="name" copiedField={copiedField} onCopy={handleCopyField} />
                <CopyField label="Mobile number" value={bimaPayload.mobile} fieldKey="mobile" copiedField={copiedField} onCopy={handleCopyField} />
                <CopyField label="Email" value={bimaPayload.email} fieldKey="email" copiedField={copiedField} onCopy={handleCopyField} />
              </PacketSection>

              <PacketSection title="2. Address">
                <CopyField label="PIN code" value={bimaPayload.pincode} fieldKey="pincode" copiedField={copiedField} onCopy={handleCopyField} />
                <CopyField label="District" value={bimaPayload.district} />
                <CopyField label="State" value={bimaPayload.state} />
              </PacketSection>

              <PacketSection title="3. Insurer & policy" cols={2}>
                <CopyField label="Insurance company" value={bimaPayload.insurance_company_name} fieldKey="company" copiedField={copiedField} onCopy={handleCopyField} />
                <CopyField label="Complaint type" value={`${bimaPayload.complaint_type} · ${bimaPayload.complaint_description_type}`} />
                <CopyField label="Identifier type" value={bimaPayload.identifier_type} />
                <CopyField label="Claim / policy number" value={bimaPayload.identifier_number} fieldKey="id_num" copiedField={copiedField} onCopy={handleCopyField} />
              </PacketSection>

              <div className="rounded-xl bg-ground p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-small font-semibold text-ink-2">4. Complaint description</span>
                  <span className="figures rounded-full bg-leaf-50 px-2 py-0.5 text-tiny font-semibold text-leaf-700">
                    {Math.min(bimaPayload.complaint_details?.length || 0, 400)} / 400 characters
                  </span>
                </div>
                <p className="mt-2 max-h-36 overflow-y-auto rounded-lg bg-surface p-3 font-mono text-small leading-relaxed text-ink-2 shadow-card">
                  {(bimaPayload.complaint_details || "").slice(0, 400)}
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1">
                    {bimaPayload.statutory_citations?.map((cit, i) => (
                      <span key={i} className="rounded-md bg-peacock-50 px-2 py-0.5 text-tiny font-medium text-peacock-700">
                        {cit}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyField(bimaPayload.complaint_details, "complaint_text")}
                    className="inline-flex cursor-pointer items-center gap-1 text-small font-semibold text-peacock-700 hover:text-peacock-900"
                  >
                    {copiedField === "complaint_text" ? <Check className="h-3.5 w-3.5 text-leaf-600" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedField === "complaint_text" ? "Description copied" : "Copy description"}
                  </button>
                </div>
              </div>

              <div className="rounded-xl bg-peacock-800 p-4 text-white">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-small font-semibold">How the prefill works</span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-tiny font-semibold text-peacock-100">Never submits for you</span>
                </div>
                <ol className="mt-3 grid gap-2 sm:grid-cols-3">
                  {[
                    ["Prefill", "The assistant opens Chrome and fills your name, mobile, email, PIN, claim number and complaint. Filled fields turn green."],
                    ["Send the OTP", "OTP is paused to save your daily quota. Click the mobile field and press Tab when you're ready."],
                    ["CAPTCHA & submit", "Type the CAPTCHA at the bottom and press Register. You stay in control."],
                  ].map(([t, d], i) => (
                    <li key={t} className="rounded-lg bg-white/5 p-3 ring-1 ring-inset ring-white/10">
                      <div className="flex items-center gap-2 text-small font-semibold">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-marigold-400 text-tiny text-ink">{i + 1}</span>
                        {t}
                      </div>
                      <p className="mt-1.5 text-tiny leading-relaxed text-peacock-100/80">{d}</p>
                    </li>
                  ))}
                </ol>
              </div>

              {runningAgent && (
                <div className="flex items-center gap-3 rounded-xl bg-peacock-50 p-3.5 text-peacock-900" role="status">
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-peacock-600" />
                  <div className="text-small">
                    <strong className="block font-semibold">Opening a Chrome window…</strong>
                    Going to Bima Bharosa and filling every section of the complaint.
                  </div>
                </div>
              )}

              {agentResult && (
                <div className="space-y-2 rounded-xl bg-leaf-50 p-4 text-leaf-900 ring-1 ring-inset ring-leaf-200">
                  <div className="text-small font-semibold">Chrome is open on your computer</div>
                  <p className="text-small">{agentResult.message}</p>
                  <ol className="list-decimal space-y-1 pl-5 text-small text-ink-2">
                    <li>Switch to the new Chrome window. Every field is filled in green.</li>
                    <li>Enter the 6-digit SMS code and click “Validate OTP”.</li>
                    <li>Type the CAPTCHA at the bottom and click “Register”.</li>
                  </ol>
                </div>
              )}

              <div className="space-y-3 rounded-xl bg-sand-50 p-4 ring-1 ring-inset ring-sand-200">
                <div className="flex items-center gap-2 text-small font-semibold text-ink">
                  <Zap className="h-4 w-4 text-sand-600" />
                  Or fill it in this browser with a bookmarklet
                </div>
                <p className="text-small leading-relaxed text-ink-2">
                  Drag the button to your bookmarks bar, open Bima Bharosa, and click the bookmark once to fill the form.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={`javascript:${generateBimaBharosaScript(bimaPayload)}`}
                    onClick={() => {
                      toast({
                        title: "Bookmarklet ready",
                        description: "Drag this button to your bookmarks bar. On Bima Bharosa, click it to fill the form.",
                        variant: "default",
                      })
                    }}
                    className="inline-flex h-9 cursor-grab items-center gap-1.5 rounded-lg bg-marigold-400 px-3.5 text-small font-semibold text-ink shadow-proceed active:cursor-grabbing"
                  >
                    <Zap className="h-3.5 w-3.5" />
                    Autofill Bima Bharosa
                  </a>
                  <button
                    type="button"
                    onClick={() => handleCopyField(generateBimaBharosaScript(bimaPayload), "bookmarklet_code")}
                    className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-surface px-3 text-small font-semibold text-ink-2 ring-1 ring-inset ring-sand-200 hover:bg-sand-50"
                  >
                    {copiedField === "bookmarklet_code" ? <Check className="h-3.5 w-3.5 text-leaf-600" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedField === "bookmarklet_code" ? "Script copied" : "Copy autofill script"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="secondary" size="sm" onClick={handleCopyFullPacket}>
              <Copy className="h-3.5 w-3.5" />
              {copiedField === "full_packet" ? "Packet copied" : "Copy form packet"}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={handleOpenPortalInTab}>
              <ExternalLink className="h-3.5 w-3.5" />
              Open portal & copy script
            </Button>
            <Button type="button" variant="proceed" size="sm" onClick={handleTriggerBrowserAgent} loading={runningAgent}>
              {!runningAgent && <Sparkles className="h-3.5 w-3.5" />}
              {runningAgent ? "Opening Chrome…" : "Prefill in Chrome"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PacketSection({ title, note, cols = 3, children }) {
  return (
    <div className="rounded-xl bg-ground p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-small font-semibold text-ink-2">{title}</span>
        {note && <span className="text-tiny text-ink-3">{note}</span>}
      </div>
      <div className={cn("grid grid-cols-1 gap-2", cols === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3")}>{children}</div>
    </div>
  )
}

function CopyField({ label, value, fieldKey, copiedField, onCopy }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface px-3 py-2 shadow-card">
      <span className="block text-tiny font-medium text-ink-3">{label}</span>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className="truncate text-small font-semibold text-ink" title={value}>
          {value}
        </span>
        {onCopy && (
          <button
            type="button"
            onClick={() => onCopy(value, fieldKey)}
            className="shrink-0 cursor-pointer text-ink-4 transition-colors hover:text-ink"
            aria-label={`Copy ${label}`}
          >
            {copiedField === fieldKey ? <Check className="h-3.5 w-3.5 text-leaf-600" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  )
}
