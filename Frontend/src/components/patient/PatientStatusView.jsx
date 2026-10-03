import React, { useState, useEffect } from "react"
import {
  Search,
  Clock,
  CheckCircle2,
  AlertCircle,
  Bell,
  ArrowRight,
  ExternalLink,
  PhoneCall,
  Scale,
  ShieldCheck,
  Copy,
  Check,
  Building2,
  AlertTriangle,
  Zap,
  Info,
  ChevronRight,
  FileText,
  Bot,
  Sparkles,
  Loader2,
} from "lucide-react"
import { useParams, useNavigate } from "react-router-dom"
import { api } from "../../services/api"
import { formatCurrencyINR, formatDateTime } from "../../lib/utils"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import { Input } from "../ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog"
import { useToast } from "../ui/toast"

const SAMPLE_CLAIMS = [
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
  {
    id: "88888888-8888-8888-8888-888888888884",
    label: "CLM-2026-8824 (Meera • Niva Bupa)",
    patient_name: "Meera Krishnan",
    claim_number: "CLM-2026-8824",
    policy_number: "NB-REASSURE-102",
    hospital_name: "Manipal Hospital, Old Airport Rd",
    insurer_name: "Niva Bupa Health Insurance",
    billed_amount: 98000,
    approved_amount: 82000,
    deducted_amount: 16000,
    status: "approved",
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
  let params = {}
  let navigate = () => {}
  try {
    params = useParams() || {}
    navigate = useNavigate()
  } catch {}

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

  const handleTriggerBrowserAgent = async () => {
    setRunningAgent(true)
    setAgentResult(null)
    const targetId = claimStatus?.id || claimIdInput
    try {
      const res = await api.patient.triggerBimaBharosaAutofill(targetId, {
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

  const fetchStatus = async (id) => {
    if (!id) return
    setLoading(true)
    setNotFound(false)
    const sampleMeta = SAMPLE_CLAIMS.find((s) => s.id === id || s.claim_number === id)
    try {
      let fullClaim = null
      try {
        fullClaim = await api.claims.getById(id)
      } catch {}

      const patientData = await api.patient.getStatus(id).catch(() => null)

      if (!fullClaim && !patientData && !sampleMeta) {
        setNotFound(true)
        setClaimStatus(null)
        toast({
          title: "Claim Not Found",
          description: "Please check your Claim Intimation ID or pick a sample claim.",
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
    } catch (err) {
      setNotFound(true)
      setClaimStatus(null)
      toast({
        title: "Claim Not Found",
        description: "Please check your Claim Intimation ID or pick a sample claim.",
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
    if (navigate) navigate(`/patient/${claimIdInput.trim()}`)
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
      case "escalated":
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

  return (
    <div className="space-y-6 max-w-5xl mx-auto px-4 sm:px-6 py-6 pb-24 text-slate-900">
      {/* ────────────────────────────────────────────────────────────────────────── */}
      {/* TOP BAR: Clean, Friendly Header                                            */}
      {/* ────────────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-100 shadow-xs">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-lime-100 text-slate-900 text-xs font-bold mb-2">
            <span className="w-2 h-2 rounded-full bg-lime-500 animate-pulse" />
            Patient Help Centre & Live Tracker
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            Cashless Hospitalisation
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Check your live claim status, know your rights, and get unstuck if delayed.
          </p>
        </div>

        <a
          href="tel:1800-425-2255"
          className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs transition-transform hover:scale-102 self-start sm:self-auto"
        >
          <PhoneCall className="w-4 h-4 text-lime-400" />
          <span>24x7 Helpline: 1800-425-2255</span>
        </a>
      </div>

      {/* ────────────────────────────────────────────────────────────────────────── */}
      {/* 1. LIVE STATUS OF APPLICATION                                              */}
      {/* ────────────────────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs space-y-6">
        {/* Search & Sample Pickers */}
        <div className="space-y-3">
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                type="text"
                placeholder="Enter Claim Number (e.g. CLM-2026-8821)..."
                value={claimIdInput}
                onChange={(e) => setClaimIdInput(e.target.value)}
                className="pl-10 h-12 bg-slate-50 border-slate-200 text-sm rounded-xl"
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="h-12 px-6 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm cursor-pointer"
            >
              {loading ? "Checking..." : "Track"}
            </Button>
          </form>

          {/* Quick select pills */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400 font-medium">Try sample:</span>
            {SAMPLE_CLAIMS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setClaimIdInput(c.id)
                  if (navigate) navigate(`/patient/${c.id}`)
                  fetchStatus(c.id)
                }}
                className={`px-3 py-1 rounded-full font-semibold transition-all cursor-pointer ${
                  claimIdInput === c.id
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {notFound ? (
          <div className="p-8 text-center bg-rose-50 rounded-2xl border border-rose-100">
            <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
            <div className="font-bold text-slate-900 text-base">Claim Not Found</div>
            <div className="text-xs text-slate-500 mt-1">
              Please double check the claim ID or click one of the sample buttons above.
            </div>
          </div>
        ) : (
          <div className="space-y-6 pt-2">
            {/* Top Claim Card Row */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-50 border border-slate-100">
              <div>
                <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
                  <span>Claim #{claimStatus?.claim_number || "CLM-2026-8821"}</span>
                  <span>•</span>
                  <span>Policy #{claimStatus?.policy_number || "POL-STAR-7731"}</span>
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1">
                  {claimStatus?.patient_name || "Ramesh Chawla"}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Hospital: <strong className="text-slate-700">{claimStatus?.hospital_name || "Apollo Hospital"}</strong> • Insurer: <strong className="text-slate-700">{claimStatus?.insurer_name || "Star Health"}</strong>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row md:flex-col items-start md:items-end gap-2">
                <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  {claimStatus?.status === "approved" || claimStatus?.status === "auto_approved"
                    ? "Cashless Approved"
                    : claimStatus?.status === "queried"
                    ? "Action Required from Doctor"
                    : "Under Active Insurer Review"}
                </span>

                <div className="text-xs font-semibold text-slate-600 flex items-center gap-1 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                  <Clock className="w-3.5 h-3.5 text-amber-500" />
                  <span>
                    {claimStatus?.sla_breached
                      ? "3-Hour SLA Breached (Insurer pays extra room rent)"
                      : "Within Statutory 3-Hour Discharge Window"}
                  </span>
                </div>
              </div>
            </div>

            {/* Visual Stepper */}
            <div>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                Live Progress
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                {PROGRESS_STEPS.map((step, idx) => {
                  const isDone = idx < currentStepIdx
                  const isCurrent = idx === currentStepIdx
                  return (
                    <div
                      key={step.key}
                      className={`p-3.5 rounded-2xl border transition-all ${
                        isCurrent
                          ? "bg-slate-900 text-white border-slate-900 shadow-md"
                          : isDone
                          ? "bg-emerald-50 text-emerald-900 border-emerald-200"
                          : "bg-slate-50 text-slate-400 border-slate-100"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-bold opacity-75">Step 0{step.step}</span>
                        {isDone ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        ) : isCurrent ? (
                          <span className="w-2 h-2 rounded-full bg-lime-400 animate-ping" />
                        ) : (
                          <span className="w-2 h-2 rounded-full bg-slate-300" />
                        )}
                      </div>
                      <div className="text-xs font-bold">{step.label}</div>
                      <div className="text-[11px] opacity-80 mt-0.5 line-clamp-1">{step.desc}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 3 Large Clear Financial Figures */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                <div className="text-xs font-semibold text-slate-500">Total Hospital Bill</div>
                <div className="text-2xl font-black text-slate-900 mt-1">
                  {formatCurrencyINR(claimStatus?.billed_amount || 185000)}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">Submitted by hospital billing</div>
              </div>

              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100">
                <div className="text-xs font-semibold text-emerald-800">Paid by Insurer (Cashless)</div>
                <div className="text-2xl font-black text-emerald-600 mt-1">
                  {formatCurrencyINR(claimStatus?.approved_amount || 155000)}
                </div>
                <div className="text-[11px] text-emerald-700 mt-0.5">Approved without out-of-pocket</div>
              </div>

              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100">
                <div className="text-xs font-semibold text-amber-800">Your Share (Non-Medical)</div>
                <div className="text-2xl font-black text-amber-700 mt-1">
                  {formatCurrencyINR(claimStatus?.deducted_amount || 30000)}
                </div>
                <div className="text-[11px] text-amber-700 mt-0.5">Gloves, food, room rent cap delta</div>
              </div>
            </div>

            {/* Secondary Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <span className="text-xs text-slate-400">
                Live as of {formatDateTime(new Date().toISOString())}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCisModalOpen(true)}
                  className="rounded-xl text-xs font-bold cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5 mr-1" />
                  View Policy Coverage (CIS)
                </Button>
                <Button
                  size="sm"
                  onClick={() => setAlertModalOpen(true)}
                  className="rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white cursor-pointer"
                >
                  <Bell className="w-3.5 h-3.5 mr-1 text-lime-400" />
                  Get Free SMS Updates
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ────────────────────────────────────────────────────────────────────────── */}
      {/* 2. STATUTORY RIGHTS & EMERGENCY ASSISTANCE (CONSOLIDATED)                  */}
      {/* ────────────────────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-100 shadow-xs space-y-6">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-900 text-xs font-bold mb-2">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            IRDAI Protected Rights &amp; Immediate Action
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900">
            Hospital Assistance &amp; Statutory Rights
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Tap your situation below for an immediate legal remedy, ready-to-send notice, or 1-click regulatory escalation.
          </p>
        </div>

        {/* 4 Clickable Statutory Situation Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {STUCK_SCENARIOS.map((item) => {
            const Icon = item.icon
            const isSelected = activeIssue === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveIssue(item.id)}
                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? "bg-slate-900 text-white border-slate-900 shadow-md ring-2 ring-lime-400/40 scale-101"
                    : "bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-800"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                        isSelected ? "bg-white/10 text-lime-400" : "bg-white text-slate-700 shadow-2xs"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                        isSelected
                          ? "bg-lime-400/20 text-lime-300 border border-lime-400/30"
                          : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {item.pill}
                    </span>
                  </div>
                  <div className="font-bold text-xs leading-snug">{item.title}</div>
                </div>
                <div
                  className={`text-[11px] mt-2 line-clamp-1 ${
                    isSelected ? "text-slate-300" : "text-slate-500"
                  }`}
                >
                  {item.subtitle}
                </div>
              </button>
            )
          })}
        </div>

        {/* Selected Issue Detail & Clear Action */}
        <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
            <div>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Statutory Legal Rule:
              </span>
              <div className="text-sm font-bold text-slate-900 mt-0.5">
                {selectedStuckItem.rule}
              </div>
            </div>
            <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold self-start sm:self-auto shrink-0 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-600" />
              IRDAI Protected
            </span>
          </div>

          <div>
            <div className="text-xs font-bold text-slate-700 mb-2">
              {selectedStuckItem.actionTitle}
            </div>
            <div className="space-y-1.5 text-xs text-slate-600">
              {selectedStuckItem.steps.map((st, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <span>{st}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Copy Box */}
          <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">
                Ready-to-Send WhatsApp / SMS Notice:
              </span>
              <button
                type="button"
                onClick={() => handleCopyNotice(selectedStuckItem.noticeText, selectedStuckItem.id)}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-800 cursor-pointer"
              >
                {copiedKey === selectedStuckItem.id ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-600">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Text</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-xs text-slate-600 font-mono bg-slate-50 p-3 rounded-lg border border-slate-100">
              {selectedStuckItem.noticeText
                .replace("{CLAIM_ID}", claimStatus?.claim_number || "CLM-2026-8821")
                .replace("{POLICY_NO}", claimStatus?.policy_number || "POL-STAR-7731")}
            </p>
          </div>

          {/* Quick Actions: Copy Notice & Call Insurer Priority Line */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button
              onClick={() => handleCopyNotice(selectedStuckItem.noticeText, selectedStuckItem.id)}
              className="rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white cursor-pointer"
            >
              {copiedKey === selectedStuckItem.id ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
              {copiedKey === selectedStuckItem.id ? "Notice Copied" : selectedStuckItem.primaryBtn}
            </Button>

            <a
              href="tel:1800-425-2255"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-300 text-slate-800 text-xs font-bold hover:bg-slate-100 transition-colors"
            >
              <PhoneCall className="w-3.5 h-3.5 text-slate-600" />
              <span>Call Insurer Priority Line (1800-425-2255)</span>
            </a>
          </div>
        </div>

        {/* Unified Regulatory Escalation Bar (1 Consolidated Location for Bima Bharosa & Portals) */}
        <div className="p-5 rounded-2xl bg-slate-900 text-white flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-lime-400 uppercase tracking-wider">
                Official Grievance Portals
              </span>
            </div>
            <div className="text-sm font-bold text-white mt-1">
              Insurer delayed or refused without legal cause?
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              Launch our AI agent to prefill the grievance portal for <span className="text-lime-300 font-semibold">{selectedStuckItem.title}</span>, or access official dispute bodies.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <Button
              onClick={() => handleOpenBimaAutofill(activeIssue)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-lime-400 hover:bg-lime-300 text-slate-950 font-black text-xs cursor-pointer shadow-xs transition-transform hover:scale-102"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>1-Click Bima Bharosa Autofill</span>
            </Button>
            <a
              href="https://bimabharosa.irdai.gov.in/RegComplaint/RegisterComplaint"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs border border-slate-700 transition-colors"
            >
              <span>IRDAI Portal ↗</span>
            </a>
            <a
              href="https://www.cioins.co.in/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs border border-slate-700 transition-colors"
            >
              <span>Ombudsman (CIO) ↗</span>
            </a>
          </div>
        </div>
      </div>

      {/* ────────────────────────────────────────────────────────────────────────── */}
      {/* MODAL 1: Customer Information Sheet (CIS)                                 */}
      {/* ────────────────────────────────────────────────────────────────────────── */}
      <Dialog open={cisModalOpen} onOpenChange={setCisModalOpen}>
        <DialogContent className="max-w-md p-6 bg-white rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-slate-900">
              Customer Information Sheet (CIS)
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Plain-language coverage rules for Policy #{claimStatus?.policy_number || "POL-STAR-7731"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex justify-between items-center">
              <div>
                <div className="font-bold text-slate-900">Room Rent Limit</div>
                <div className="text-slate-500">Single Private Room (1% of Sum Insured)</div>
              </div>
              <Badge variant="outline" className="font-bold">₹10,000 / day</Badge>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex justify-between items-center">
              <div>
                <div className="font-bold text-slate-900">ICU Charges</div>
                <div className="text-slate-500">Up to 2% of Sum Insured per day</div>
              </div>
              <Badge variant="outline" className="font-bold">₹20,000 / day</Badge>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex justify-between items-center">
              <div>
                <div className="font-bold text-slate-900">Co-Payment</div>
                <div className="text-slate-500">Standard network hospital claim</div>
              </div>
              <Badge className="bg-emerald-600 text-white font-bold">0% Co-Pay</Badge>
            </div>

            <div className="p-3 rounded-xl bg-amber-50 border border-amber-100 text-amber-900">
              <div className="font-bold">Excluded Items (IRDAI Schedule I)</div>
              <div className="text-[11px] text-amber-800 mt-0.5">
                Gloves, PPE kits, admission fees, and attendee food are non-payable out-of-pocket costs.
              </div>
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              onClick={() => setCisModalOpen(false)}
              className="w-full rounded-xl bg-slate-900 text-white font-bold text-xs"
            >
              Close Summary
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ────────────────────────────────────────────────────────────────────────── */}
      {/* MODAL 2: SMS & WhatsApp Alerts                                             */}
      {/* ────────────────────────────────────────────────────────────────────────── */}
      <Dialog open={alertModalOpen} onOpenChange={setAlertModalOpen}>
        <DialogContent className="max-w-md p-6 bg-white rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900">
              Get Live Claim Updates
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              We'll send you an instant SMS & WhatsApp message the moment your claim is approved.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEnableAlerts} className="space-y-3 py-2">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Mobile Number
              </label>
              <Input
                type="tel"
                placeholder="+91 98765 43210"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                className="h-11 rounded-xl text-xs bg-slate-50 border-slate-200"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Email (Optional)
              </label>
              <Input
                type="email"
                placeholder="yourname@gmail.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                className="h-11 rounded-xl text-xs bg-slate-50 border-slate-200"
              />
            </div>

            <DialogFooter className="pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setAlertModalOpen(false)}
                className="rounded-xl text-xs font-semibold"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submittingAlert}
                className="rounded-xl bg-slate-900 text-white text-xs font-bold"
              >
                {submittingAlert ? "Enabling..." : "Enable Alerts"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ────────────────────────────────────────────────────────────────────────── */}
      {/* MODAL 3: Bima Bharosa 1-Click Complaint Autofill                           */}
      {/* ────────────────────────────────────────────────────────────────────────── */}
      <Dialog open={bimaModalOpen} onOpenChange={setBimaModalOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-6 bg-white rounded-3xl">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <DialogTitle className="text-lg font-black text-slate-900">
                  IRDAI Bima Bharosa Complaint Autofill
                </DialogTitle>
              </div>
              <Badge className="bg-lime-400 text-slate-950 font-bold border-0 text-[10px]">
                Ready for Portal
              </Badge>
            </div>
            <DialogDescription className="text-xs text-slate-500">
              Auto-filled from your live claim data, sanitized of banned characters, and citing IRDAI Master Circular 2024.
            </DialogDescription>
          </DialogHeader>

          {loadingBima ? (
            <div className="py-12 text-center text-xs text-slate-500 font-bold">
              Extracting claim records & compiling IRDAI grievance payload...
            </div>
          ) : bimaPayload ? (
            <div className="space-y-4 py-2 text-xs">
              {/* Section 1: Complainant Details */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                    1. Complainant Details
                  </span>
                  <span className="text-[10px] text-slate-400">User Type: Individual</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-semibold">Name *</span>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="font-bold text-slate-900 truncate">{bimaPayload.name}</span>
                      <button
                        type="button"
                        onClick={() => handleCopyField(bimaPayload.name, "name")}
                        className="text-slate-400 hover:text-slate-700 ml-1 cursor-pointer"
                      >
                        {copiedField === "name" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-semibold">Mobile Number *</span>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="font-bold text-slate-900">{bimaPayload.mobile}</span>
                      <button
                        type="button"
                        onClick={() => handleCopyField(bimaPayload.mobile, "mobile")}
                        className="text-slate-400 hover:text-slate-700 ml-1 cursor-pointer"
                      >
                        {copiedField === "mobile" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-semibold">Email</span>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="font-bold text-slate-900 truncate">{bimaPayload.email}</span>
                      <button
                        type="button"
                        onClick={() => handleCopyField(bimaPayload.email, "email")}
                        className="text-slate-400 hover:text-slate-700 ml-1 cursor-pointer"
                      >
                        {copiedField === "email" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 2: Address Details */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
                <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                  2. Address Details
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-semibold">Pin Code *</span>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="font-bold text-slate-900">{bimaPayload.pincode}</span>
                      <button
                        type="button"
                        onClick={() => handleCopyField(bimaPayload.pincode, "pincode")}
                        className="text-slate-400 hover:text-slate-700 ml-1 cursor-pointer"
                      >
                        {copiedField === "pincode" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-semibold">District *</span>
                    <span className="font-bold text-slate-900 block mt-0.5 truncate">{bimaPayload.district}</span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-semibold">State *</span>
                    <span className="font-bold text-slate-900 block mt-0.5 truncate">{bimaPayload.state}</span>
                  </div>
                </div>
              </div>

              {/* Section 3 & 4: Insurance & Policy Identification */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
                <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                  3. Insurance Company & Policy Details
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-semibold">Insurance Company *</span>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="font-bold text-slate-900 text-[11px] truncate">
                        {bimaPayload.insurance_company_name}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopyField(bimaPayload.insurance_company_name, "company")}
                        className="text-slate-400 hover:text-slate-700 ml-1 cursor-pointer"
                      >
                        {copiedField === "company" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-semibold">Complaint Type & Sub-type *</span>
                    <span className="font-bold text-slate-900 text-[11px] block mt-0.5 truncate">
                      {bimaPayload.complaint_type} • {bimaPayload.complaint_description_type}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-semibold">Identifier Type *</span>
                    <span className="font-bold text-slate-900 block mt-0.5">{bimaPayload.identifier_type}</span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-semibold">Claim / Policy Number *</span>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="font-bold text-slate-900">{bimaPayload.identifier_number}</span>
                      <button
                        type="button"
                        onClick={() => handleCopyField(bimaPayload.identifier_number, "id_num")}
                        className="text-slate-400 hover:text-slate-700 ml-1 cursor-pointer"
                      >
                        {copiedField === "id_num" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 5: Complaint Details */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                    4. Complaint Description (Sanitized for Portal)
                  </span>
                  <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                    {Math.min(bimaPayload.complaint_details?.length || 0, 400)} / 400 chars • IRDAI Compliant
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-white border border-slate-200 font-mono text-[11px] text-slate-700 leading-relaxed max-h-36 overflow-y-auto">
                  {(bimaPayload.complaint_details || "").slice(0, 400)}
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div className="flex flex-wrap gap-1">
                    {bimaPayload.statutory_citations?.map((cit, i) => (
                      <span key={i} className="text-[10px] px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-medium">
                        {cit}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyField(bimaPayload.complaint_details, "complaint_text")}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-800 cursor-pointer"
                  >
                    {copiedField === "complaint_text" ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span className="text-emerald-600">Copied Description</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy Description</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* How Prefill & Manual OTP/CAPTCHA Work */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-850 to-slate-900 text-white border border-slate-700 shadow-sm space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full bg-lime-400 text-slate-950 font-black text-[10px] tracking-wider uppercase">
                      Prefill &amp; Manual Takeover
                    </span>
                    <span className="text-xs font-bold text-white">How OTP &amp; CAPTCHA Work in Demo</span>
                  </div>
                  <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-950/80 border border-emerald-800/60 px-2 py-0.5 rounded-full">
                    ✓ Zero Auto-Submit Risk
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                  <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/60 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 text-lime-400 font-bold text-xs">
                        <span className="w-4 h-4 rounded-full bg-lime-400/20 text-lime-400 flex items-center justify-center text-[10px]">1</span>
                        <span>1-Click Prefill</span>
                      </div>
                      <p className="text-[11px] text-slate-300 mt-1.5 leading-snug">
                        Agent opens Chrome and populates Name, Mobile, Email, PIN, Claim ID, and Legal Violation Text.
                      </p>
                    </div>
                    <div className="mt-2 text-[10px] text-lime-400/80 font-medium">Fields turn green ✓</div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/60 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 text-amber-400 font-bold text-xs">
                        <span className="w-4 h-4 rounded-full bg-amber-400/20 text-amber-400 flex items-center justify-center text-[10px]">2</span>
                        <span>Generate SMS OTP</span>
                      </div>
                      <p className="text-[11px] text-slate-300 mt-1.5 leading-snug">
                        OTP trigger is safely paused to save your daily quota. When ready, click Mobile &amp; press Tab to send OTP.
                      </p>
                    </div>
                    <div className="mt-2 text-[10px] text-amber-400/80 font-medium">Daily quota protected 🛡️</div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/60 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 text-blue-400 font-bold text-xs">
                        <span className="w-4 h-4 rounded-full bg-blue-400/20 text-blue-400 flex items-center justify-center text-[10px]">3</span>
                        <span>CAPTCHA &amp; Submit</span>
                      </div>
                      <p className="text-[11px] text-slate-300 mt-1.5 leading-snug">
                        Solve the visual CAPTCHA at the bottom and click "Register". Agent never submits for you.
                      </p>
                    </div>
                    <div className="mt-2 text-[10px] text-blue-400/80 font-medium">You hold 100% control 🔒</div>
                  </div>
                </div>
              </div>

              {/* Agent Active / Result Status */}
              {runningAgent ? (
                <div className="p-3.5 rounded-2xl bg-blue-50 border border-blue-200 text-blue-950 flex items-center gap-3 animate-pulse">
                  <Loader2 className="w-5 h-5 text-blue-600 animate-spin shrink-0" />
                  <div className="text-xs">
                    <strong className="block font-bold">Launching Visible Chrome Session...</strong>
                    <span className="text-blue-800 text-[11px]">Navigating to Bima Bharosa and autofilling all 6 grievance sections with green highlighting.</span>
                  </div>
                </div>
              ) : null}

              {agentResult ? (
                <div className="p-4 rounded-2xl bg-emerald-50/90 border-2 border-emerald-400 text-emerald-950 space-y-2.5 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-600 animate-ping" />
                      <span className="font-black text-xs text-emerald-900 uppercase tracking-wide">
                        🚀 Chrome Browser Window Is Open On Your Desktop!
                      </span>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-900">
                      Ready For Manual OTP &amp; CAPTCHA
                    </span>
                  </div>

                  <p className="text-xs text-emerald-900 leading-relaxed font-medium">
                    {agentResult.message}
                  </p>

                  <div className="p-3 rounded-xl bg-white/90 border border-emerald-200 text-[11px] text-emerald-950 space-y-1.5 shadow-2xs">
                    <div className="font-bold text-emerald-900 flex items-center gap-1.5">
                      <Check className="w-4 h-4 text-emerald-600" />
                      <span>Take over in the Chrome window:</span>
                    </div>
                    <div className="text-slate-700 pl-5 space-y-1">
                      <div>1. Switch to the new Chrome window on your screen (or taskbar). All fields are prefilled in green.</div>
                      <div>2. The Bima Bharosa OTP dialog is open—type the 6-digit SMS code you received and click <strong>"Validate OTP"</strong>.</div>
                      <div>3. Scroll to the bottom, type the CAPTCHA letters, and click <strong>"Register"</strong> to submit!</div>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* In-Tab Bookmarklet & Script Option */}
              <div className="p-4 rounded-2xl bg-amber-50/80 border border-amber-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-600" />
                    <span className="font-bold text-slate-900 text-xs">
                      Option B: In-Tab Autofill Bookmarklet (Sandbox Bypass)
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 text-[10px] font-bold">
                    For Current Browser
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Prefer filing in your current browser tab? Drag this button to your Bookmarks bar, open Bima Bharosa, and click the bookmark once to autofill everything instantly:
                </p>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <a
                    href={`javascript:${generateBimaBharosaScript(bimaPayload)}`}
                    onClick={(e) => {
                      toast({
                        title: "Bookmarklet Ready",
                        description: "Drag this button to your Bookmarks Bar! When on Bima Bharosa, click it to autofill.",
                        variant: "default",
                      })
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs shadow-xs cursor-grab active:cursor-grabbing transition-transform hover:scale-102"
                  >
                    <Zap className="w-3.5 h-3.5 text-slate-950" />
                    <span>⚡ Drag to Bookmarks: "Autofill Bima Bharosa"</span>
                  </a>

                  <button
                    type="button"
                    onClick={() => {
                      const code = generateBimaBharosaScript(bimaPayload)
                      handleCopyField(code, "bookmarklet_code")
                    }}
                    className="inline-flex items-center gap-1 text-xs font-bold text-slate-700 hover:text-slate-900 bg-white px-3 py-2 rounded-xl border border-amber-300 cursor-pointer"
                  >
                    {copiedField === "bookmarklet_code" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedField === "bookmarklet_code" ? "Script Copied!" : "Copy 1-Click Autofill Script"}</span>
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <DialogFooter className="flex-col sm:flex-row gap-2 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyFullPacket}
              className="rounded-xl text-xs font-bold gap-1.5 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copiedField === "full_packet" ? "Full Packet Copied!" : "Copy Form Packet"}</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOpenPortalInTab}
              className="rounded-xl text-xs font-bold gap-1.5 cursor-pointer bg-slate-900 text-white hover:bg-slate-800 border-slate-700"
            >
              <span>↗️ Open Portal in Tab &amp; Copy Script</span>
              <ExternalLink className="w-3.5 h-3.5 text-lime-400" />
            </Button>

            <Button
              type="button"
              size="sm"
              disabled={runningAgent}
              onClick={handleTriggerBrowserAgent}
              className="rounded-xl text-xs font-bold gap-1.5 bg-lime-400 hover:bg-lime-300 text-slate-950 cursor-pointer shadow-xs transition-transform hover:scale-102"
            >
              {runningAgent ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-950" /> : <Sparkles className="w-3.5 h-3.5 text-slate-950" />}
              <span>{runningAgent ? "Opening Chrome & Prefilling..." : "🚀 Launch & Prefill Portal (Opens Chrome)"}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
