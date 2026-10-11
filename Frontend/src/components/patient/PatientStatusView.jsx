import { useState, useEffect } from "react"
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Check,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  PhoneCall,
  Scale,
  Search,
  ShieldCheck,
  Zap,
} from "lucide-react"
import { useParams, useNavigate } from "react-router-dom"
import { api } from "../../services/api"
import { cn, formatCurrencyINR, formatDateTime } from "../../lib/utils"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { Guilloche } from "../common/Guilloche"
import { JourneyRail } from "../common/JourneyRail"

const BIMA_BHAROSA_URL = "https://bimabharosa.irdai.gov.in/RegComplaint/RegisterComplaint"
// IRDAI Grievance Call Centre (Bima Bharosa), toll-free
const IRDAI_HELPLINE = "155255"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Backend issue types → scenario ids used on this page
const ISSUE_FROM_BACKEND = {
  preauth_delay: "preauth",
  discharge_delay: "discharge",
  cash_deposit: "deposit",
}

const COMPLAINANT_FIELDS = ["name", "mobile", "email", "pincode", "district", "state"]

const money = (v) => (v === null || v === undefined ? "—" : formatCurrencyINR(v))

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

export function PatientStatusView() {
  const { toast } = useToast()
  const params = useParams()
  const navigate = useNavigate()

  const urlClaimId = params.claimId || ""
  const [claimIdInput, setClaimIdInput] = useState(urlClaimId)
  const [recentClaims, setRecentClaims] = useState([])
  const [claimStatus, setClaimStatus] = useState(null)
  const [loading, setLoading] = useState(Boolean(urlClaimId))
  const [notFound, setNotFound] = useState(false)

  // Stuck scenario active tab
  const [activeIssue, setActiveIssue] = useState("preauth")
  const [copiedKey, setCopiedKey] = useState("")

  // Bima Bharosa prefilled values (filed manually by the patient)
  const [bimaModalOpen, setBimaModalOpen] = useState(false)
  const [bimaPayload, setBimaPayload] = useState(null)
  const [loadingBima, setLoadingBima] = useState(false)
  const [bimaError, setBimaError] = useState("")
  const [complainant, setComplainant] = useState({})
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [copiedField, setCopiedField] = useState("")
  const [matchingClaims, setMatchingClaims] = useState([])

  useEffect(() => {
    api.patient
      .getRecentClaims(4)
      .then((rows) => setRecentClaims(rows || []))
      .catch(() => setRecentClaims([]))
  }, [])

  // Callers flip `loading` on before this runs (it is also invoked from an effect).
  const fetchStatus = async (id) => {
    try {
      const res = await api.patient.lookupEscalation(
        UUID_RE.test(id) ? { claimId: id, issueType: "auto" } : { query: id, issueType: "auto" }
      )
      const c = res.claim
      setClaimStatus(c)
      // Picking one claim from the list returns just that claim; keep the list so the patient can switch back.
      setMatchingClaims((prev) =>
        res.matching_claims?.length > 1 || !prev.some((m) => m.id === c.id) ? res.matching_claims || [] : prev
      )
      const payload = res.escalation?.bima_bharosa_payload || null
      setBimaPayload(payload)
      setComplainant(Object.fromEntries(COMPLAINANT_FIELDS.map((k) => [k, payload?.[k] || ""])))
      const issue = res.escalation?.issue_type
      if (issue) setActiveIssue(ISSUE_FROM_BACKEND[issue] || issue)
    } catch (err) {
      setNotFound(true)
      setClaimStatus(null)
      setMatchingClaims([])
      setBimaPayload(null)
      if (err.status !== 404) {
        toast({
          title: "Couldn't load the claim",
          description: err.message,
          variant: "destructive",
        })
      }
    } finally {
      setLoading(false)
    }
  }

  // Sync the search box (and clear the result) when the URL changes, e.g. back navigation.
  const [prevUrlClaimId, setPrevUrlClaimId] = useState(urlClaimId)
  if (prevUrlClaimId !== urlClaimId) {
    setPrevUrlClaimId(urlClaimId)
    setClaimIdInput(urlClaimId)
    setNotFound(false)
    setLoading(Boolean(urlClaimId))
    if (!urlClaimId) {
      setClaimStatus(null)
      setMatchingClaims([])
    }
  }

  useEffect(() => {
    // fetchStatus only sets state after its await, so this doesn't cascade renders.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (urlClaimId) fetchStatus(urlClaimId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlClaimId])

  const openClaim = (id) => {
    if (!id) return
    if (id === urlClaimId) {
      setLoading(true)
      setNotFound(false)
      fetchStatus(id)
    } else navigate(`/patient/${encodeURIComponent(id)}`)
  }

  const handleSearch = (e) => {
    e.preventDefault()
    openClaim(claimIdInput.trim())
  }

  // Complaint text depends on the selected scenario, so fetch it fresh each time.
  const handleOpenBimaPacket = async () => {
    if (!claimStatus?.id) return
    setBimaModalOpen(true)
    setLoadingBima(true)
    setBimaError("")
    try {
      setBimaPayload(await api.patient.getBimaBharosaPayload(claimStatus.id, activeIssue))
    } catch (err) {
      setBimaError(err.message || "Couldn't prepare the complaint values.")
    } finally {
      setLoadingBima(false)
    }
  }

  const handleDownloadPdf = async () => {
    if (!claimStatus?.id) return
    setDownloadingPdf(true)
    try {
      const url = await api.patient.downloadBimaBharosaPdf(claimStatus.id, { issueType: activeIssue, complainant })
      const a = document.createElement("a")
      a.href = url
      a.download = `bima-bharosa-${claimStatus.claim_number || "complaint"}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast({
        title: "Form values downloaded",
        description: "Keep the PDF open and copy each value into the Bima Bharosa form.",
        variant: "success",
      })
    } catch (err) {
      toast({
        title: "Download failed",
        description: err.message || "Couldn't generate the PDF.",
        variant: "destructive",
      })
    } finally {
      setDownloadingPdf(false)
    }
  }

  const handleCopyField = (val, fieldKey) => {
    if (!val) return
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
    const v = (x) => x || "(fill in on the portal)"
    const text = `--- IRDAI BIMA BHAROSA COMPLAINT VALUES ---
1. PERSONAL DETAILS:
   Name: ${v(complainant.name)}
   Mobile: ${v(complainant.mobile)}
   Email: ${v(complainant.email)}

2. ADDRESS DETAILS:
   PIN Code: ${v(complainant.pincode)}
   District: ${v(complainant.district)}
   State: ${v(complainant.state)}

3. INSURANCE COMPANY & POLICY DETAILS:
   Complaint Against: ${v(bimaPayload.complaint_against)}
   Insurance Company: ${v(bimaPayload.insurance_company_name)}
   Policy Type: ${v(bimaPayload.policy_type)}
   Complaint Type: ${v(bimaPayload.complaint_type)}
   Description Type: ${v(bimaPayload.complaint_description_type)}

4. POLICY IDENTIFICATION:
   Identifier Type: ${v(bimaPayload.identifier_type)}
   Identifier Number: ${v(bimaPayload.identifier_number)}

5. COMPLAINT DETAILS (max 400 chars):
${bimaPayload.complaint_details}

STATUTORY REGULATIONS CITED:
${bimaPayload.statutory_citations?.map((c) => `- ${c}`).join("\n")}
-------------------------------------------`
    navigator.clipboard.writeText(text)
    setCopiedField("full_packet")
    toast({
      title: "Complaint values copied",
      description: "All 5 Bima Bharosa sections copied as text.",
      variant: "success",
    })
    setTimeout(() => setCopiedField(""), 2500)
  }

  const fillNotice = (text) =>
    text
      .replace("{CLAIM_ID}", claimStatus?.claim_number || "(claim number)")
      .replace("{POLICY_NO}", claimStatus?.policy_number || "(policy number)")

  const handleCopyNotice = (text, key) => {
    navigator.clipboard.writeText(fillNotice(text))
    setCopiedKey(key)
    toast({
      title: "Text Copied to Clipboard",
      description: "Send this directly to the hospital TPA desk or your insurer.",
      variant: "success",
    })
    setTimeout(() => setCopiedKey(""), 3000)
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
      case "rejected":
        return 3
      case "finalized":
        return 4
      default:
        return 1
    }
  }

  const status = claimStatus?.status
  const currentStepIdx = claimStatus ? getStepIndex(status) : 1
  const selectedStuckItem = STUCK_SCENARIOS.find((s) => s.id === activeIssue) || STUCK_SCENARIOS[0]
  const statusHeadline = {
    submitted: "Received by the insurer",
    documents_pending: "Documents pending",
    queried: "Waiting on your doctor's notes",
    approved: "Cashless approved",
    auto_approved: "Cashless approved",
    partially_approved: "Partially approved",
    rejected: "Claim not approved",
    finalized: "Bill settled",
  }[status] || "Under active insurer review"
  const isRejected = status === "rejected"
  const journeySteps = PROGRESS_STEPS.map((step, idx) => ({
    key: step.key,
    label: step.label,
    caption: step.desc,
    state: idx < currentStepIdx || (status === "finalized" && idx === currentStepIdx) ? "done" : idx === currentStepIdx ? "current" : "todo",
  }))
  const formattedNotice = fillNotice(selectedStuckItem.noticeText)
  const hasDecision = claimStatus?.approved_amount !== null && claimStatus?.approved_amount !== undefined

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
              href={`tel:${IRDAI_HELPLINE}`}
              className="inline-flex shrink-0 items-center gap-2 self-start rounded-xl bg-white/10 px-4 py-2.5 text-small font-semibold ring-1 ring-inset ring-white/15 transition-colors hover:bg-white/15"
            >
              <PhoneCall className="h-4 w-4 text-marigold-300" />
              IRDAI helpline {IRDAI_HELPLINE}
            </a>
          </div>

          <form onSubmit={handleSearch} className="mt-7 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-3" />
              <Input
                type="text"
                aria-label="Patient name, phone number, or claim number"
                placeholder="Enter patient name, phone number, or claim number"
                value={claimIdInput}
                onChange={(e) => setClaimIdInput(e.target.value)}
                className="h-13 rounded-xl pl-12 text-body ring-0"
              />
            </div>
            <Button type="submit" variant="proceed" size="lg" loading={loading} className="h-13 px-6">
              {loading ? "Pulling hospital data…" : "Find my claim"}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          {recentClaims.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 text-small">
              <span className="text-peacock-200">Recent claims:</span>
              {recentClaims.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => openClaim(c.id)}
                  className={cn(
                    "cursor-pointer rounded-full px-3 py-1 font-semibold transition-colors",
                    claimStatus?.id === c.id ? "bg-white text-peacock-800" : "bg-white/10 text-peacock-100 hover:bg-white/15"
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Status */}
      {notFound ? (
        <section className="flex flex-col items-center rounded-card bg-surface px-6 py-12 text-center shadow-card">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-vermilion-50 text-vermilion-600">
            <AlertCircle className="h-6 w-6" />
          </span>
          <h2 className="text-lg font-semibold text-ink">We couldn't find hospital records for that patient or claim</h2>
          <p className="mt-1 max-w-sm text-sm text-ink-3">Check the patient name, 10-digit mobile number, or claim number.</p>
        </section>
      ) : !claimStatus ? (
        <section className="flex flex-col items-center rounded-card bg-surface px-6 py-12 text-center shadow-card">
          {loading ? (
            <Loader2 className="h-6 w-6 animate-spin text-ink-3" />
          ) : (
            <>
              <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-peacock-50 text-peacock-600">
                <Search className="h-6 w-6" />
              </span>
              <h2 className="text-lg font-semibold text-ink">Look up your claim</h2>
              <p className="mt-1 max-w-sm text-sm text-ink-3">
                Search by the patient's name, the mobile number given at the hospital, or the claim number.
              </p>
            </>
          )}
        </section>
      ) : (
        <>
          {matchingClaims.length > 1 && (
            <section className="rounded-card border border-line bg-surface p-4 sm:p-5 shadow-card animate-rise">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-small font-semibold text-peacock-700">Hospital Claims Found</div>
                  <div className="text-sm text-ink-2">
                    Found {matchingClaims.length} hospital admissions for <strong>{claimStatus.patient_name}</strong>. Select a claim:
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {matchingClaims.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => openClaim(c.id)}
                      className={cn(
                        "cursor-pointer inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-small font-semibold transition-all border",
                        c.id === claimStatus.id
                          ? "bg-peacock-700 text-white border-peacock-700 shadow-sm"
                          : "bg-surface text-ink border-line hover:bg-ground"
                      )}
                    >
                      <Building2 className="h-3.5 w-3.5" />
                      <span>{c.hospital_name}</span>
                      <span className="font-mono text-tiny opacity-75">{c.claim_number}</span>
                      <span className="figures text-tiny font-bold">{money(c.billed_amount)}</span>
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
                  <span>Claim {claimStatus.claim_number}</span>
                  {claimStatus.policy_number && <span>Policy {claimStatus.policy_number}</span>}
                </div>
                <div className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">{claimStatus.patient_name}</div>
                <div className="mt-1 text-sm text-ink-3">
                  {claimStatus.hospital_name} <span className="text-ink-4">→</span> {claimStatus.insurer_name || "Insurer not recorded"}
                </div>
              </div>
              <div className="flex flex-col items-start gap-2 md:items-end">
                <span
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 ring-inset",
                    isRejected ? "bg-vermilion-50 text-vermilion-700 ring-vermilion-100" : "bg-leaf-50 text-leaf-800 ring-leaf-100"
                  )}
                >
                  <span className="relative flex h-2 w-2">
                    <span className={cn("absolute inset-0 rounded-full animate-beacon", isRejected ? "bg-vermilion-500" : "bg-leaf-500")} />
                    <span className={cn("relative h-2 w-2 rounded-full", isRejected ? "bg-vermilion-500" : "bg-leaf-500")} />
                  </span>
                  {statusHeadline}
                </span>
                {claimStatus.sla_deadline && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 text-small font-medium",
                      claimStatus.sla_breached ? "text-vermilion-700" : "text-ink-3"
                    )}
                  >
                    <Clock className="h-4 w-4" />
                    {claimStatus.sla_breached
                      ? `Insurer missed its deadline (${formatDateTime(claimStatus.sla_deadline)})`
                      : `Insurer decision due by ${formatDateTime(claimStatus.sla_deadline)}`}
                  </span>
                )}
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
                <dd className="figures mt-1 text-[26px] font-semibold tracking-[-0.02em] text-ink">{money(claimStatus.billed_amount)}</dd>
                <dd className="text-tiny text-ink-3">Submitted by the hospital billing desk</dd>
              </div>
              <div className="border-t border-line bg-leaf-50/60 p-5 sm:border-l sm:border-t-0 sm:p-6">
                <dt className="text-small font-medium text-leaf-800">Insurer pays (cashless)</dt>
                <dd className="figures mt-1 text-[26px] font-semibold tracking-[-0.02em] text-leaf-700">{money(claimStatus.approved_amount)}</dd>
                <dd className="text-tiny text-leaf-800/80">{hasDecision ? "Paid directly to the hospital" : "Decided once the insurer finishes review"}</dd>
              </div>
              <div className="border-t border-line p-5 sm:border-l sm:border-t-0 sm:p-6">
                <dt className="text-small font-medium text-ink-3">Your share</dt>
                <dd className="figures mt-1 text-[26px] font-semibold tracking-[-0.02em] text-sand-700">{money(claimStatus.deducted_amount)}</dd>
                <dd className="text-tiny text-ink-3">Items your policy doesn't pay for</dd>
              </div>
            </dl>

            <div className="border-t border-line bg-ground/60 px-5 py-4 sm:px-7">
              <span className="text-small text-ink-3">Last updated {formatDateTime(claimStatus.updated_at)}</span>
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
                    href={`tel:${IRDAI_HELPLINE}`}
                    className="inline-flex h-10 items-center gap-2 rounded-field bg-surface px-4 text-sm font-semibold text-ink ring-1 ring-inset ring-line-strong transition-colors hover:bg-ground"
                  >
                    <PhoneCall className="h-4 w-4 text-ink-3" />
                    Call IRDAI helpline
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
                  <h3 className="mt-2 text-xl font-bold tracking-tight">Raise a complaint on Bima Bharosa</h3>
                  <p className="mt-1 max-w-2xl text-small text-peacock-100/85">
                    We've prepared the complaint values for <span className="font-semibold text-white">{claimStatus.patient_name}</span> at{" "}
                    <span className="font-semibold text-white">{claimStatus.hospital_name}</span> from hospital records. Download them as a PDF,
                    then copy each value into the Bima Bharosa form yourself.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Button variant="proceed" size="lg" loading={downloadingPdf} onClick={handleDownloadPdf} className="shadow-lg">
                    {!downloadingPdf && <Download className="h-4 w-4" />}
                    {downloadingPdf ? "Preparing PDF…" : "Download form values (PDF)"}
                  </Button>
                  <Button variant="ghost" size="lg" onClick={handleOpenBimaPacket} className="text-white hover:bg-white/10">
                    Review & edit values
                  </Button>
                  <a
                    href={BIMA_BHAROSA_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-11 items-center gap-2 rounded-field px-4 text-sm font-semibold text-white ring-1 ring-inset ring-white/20 transition-colors hover:bg-white/10"
                  >
                    <ExternalLink className="h-4 w-4 text-marigold-300" />
                    Open Bima Bharosa
                  </a>
                </div>
              </div>

              <div className="grid gap-3 rounded-xl bg-white/5 p-4 sm:grid-cols-3 ring-1 ring-inset ring-white/10 text-small">
                <div className="min-w-0">
                  <div className="text-tiny uppercase text-peacock-200">Patient & Hospital</div>
                  <div className="truncate font-semibold text-white">{claimStatus.patient_name} · {claimStatus.hospital_name}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-tiny uppercase text-peacock-200">Claim & Policy</div>
                  <div className="truncate font-mono font-medium text-white">
                    {claimStatus.claim_number}
                    {claimStatus.policy_number ? ` · ${claimStatus.policy_number}` : ""}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-tiny uppercase text-peacock-200">Amounts</div>
                  <div className="truncate font-semibold text-white">
                    Billed: {money(claimStatus.billed_amount)}
                    {claimStatus.deducted_amount ? ` · Deducted: ${money(claimStatus.deducted_amount)}` : ""}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      {/* Bima Bharosa complaint values */}
      <Dialog open={bimaModalOpen} onOpenChange={setBimaModalOpen}>
        <DialogContent onClose={() => setBimaModalOpen(false)} className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bima Bharosa complaint values</DialogTitle>
            <DialogDescription>
              Built from your claim and cleaned of characters the portal rejects. Add anything missing, then download the PDF and fill the form yourself.
            </DialogDescription>
          </DialogHeader>

          {loadingBima ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-3">
              <Loader2 className="h-4 w-4 animate-spin" />
              Collecting your claim details…
            </div>
          ) : bimaError ? (
            <div className="flex items-start gap-2 rounded-xl bg-vermilion-50 p-4 text-small text-vermilion-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {bimaError}
            </div>
          ) : bimaPayload ? (
            <div className="space-y-4 text-sm">
              <PacketSection title="1. Personal details" note="User type: individual">
                <EditField label="Name" id="bb-name" value={complainant.name} onChange={(v) => setComplainant((c) => ({ ...c, name: v }))} />
                <EditField label="Mobile number" id="bb-mobile" type="tel" placeholder="10-digit mobile" value={complainant.mobile} onChange={(v) => setComplainant((c) => ({ ...c, mobile: v }))} />
                <EditField label="Email" id="bb-email" type="email" placeholder="you@example.com" value={complainant.email} onChange={(v) => setComplainant((c) => ({ ...c, email: v }))} />
              </PacketSection>

              <PacketSection title="2. Address">
                <EditField label="PIN code" id="bb-pin" placeholder="6 digits" value={complainant.pincode} onChange={(v) => setComplainant((c) => ({ ...c, pincode: v }))} />
                <EditField label="District" id="bb-district" value={complainant.district} onChange={(v) => setComplainant((c) => ({ ...c, district: v }))} />
                <EditField label="State" id="bb-state" value={complainant.state} onChange={(v) => setComplainant((c) => ({ ...c, state: v }))} />
              </PacketSection>

              <PacketSection title="3. Insurer & policy" cols={2}>
                <CopyField label="Insurance company" value={bimaPayload.insurance_company_name} fieldKey="company" copiedField={copiedField} onCopy={handleCopyField} />
                <CopyField label="Complaint type" value={`${bimaPayload.complaint_type} · ${bimaPayload.complaint_description_type}`} />
                <CopyField label="Identifier type" value={bimaPayload.identifier_type} />
                <CopyField label="Claim number" value={bimaPayload.identifier_number} fieldKey="id_num" copiedField={copiedField} onCopy={handleCopyField} />
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
                <span className="text-small font-semibold">How to file it</span>
                <ol className="mt-3 grid gap-2 sm:grid-cols-3">
                  {[
                    ["Download", "Save the PDF of these values, or keep this window open."],
                    ["Fill the form", "Open Bima Bharosa and copy each value into the matching field."],
                    ["OTP, CAPTCHA & submit", "Verify your mobile with the OTP, type the CAPTCHA and press Register. Keep the complaint number."],
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
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="secondary" size="sm" onClick={handleCopyFullPacket} disabled={!bimaPayload || loadingBima}>
              <Copy className="h-3.5 w-3.5" />
              {copiedField === "full_packet" ? "Values copied" : "Copy all values"}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => window.open(BIMA_BHAROSA_URL, "_blank", "noopener,noreferrer")}>
              <ExternalLink className="h-3.5 w-3.5" />
              Open Bima Bharosa
            </Button>
            <Button type="button" variant="proceed" size="sm" onClick={handleDownloadPdf} loading={downloadingPdf} disabled={!bimaPayload || loadingBima}>
              {!downloadingPdf && <Download className="h-3.5 w-3.5" />}
              {downloadingPdf ? "Preparing PDF…" : "Download PDF"}
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

function EditField({ label, id, value, onChange, type = "text", placeholder }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface px-3 py-2 shadow-card">
      <label htmlFor={id} className="block text-tiny font-medium text-ink-3">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value || ""}
        placeholder={placeholder || "Fill in"}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full min-w-0 bg-transparent text-small font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink-4"
      />
    </div>
  )
}

function CopyField({ label, value, fieldKey, copiedField, onCopy }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface px-3 py-2 shadow-card">
      <span className="block text-tiny font-medium text-ink-3">{label}</span>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className={cn("truncate text-small font-semibold", value ? "text-ink" : "font-normal text-ink-4")} title={value}>
          {value || "Fill in on the portal"}
        </span>
        {onCopy && value && (
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
