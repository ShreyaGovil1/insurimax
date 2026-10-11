import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertOctagon,
  ArrowLeft,
  ArrowRight,
  CheckCheck,
  FileCheck,
  FileText,
  Lock,
  MessageSquare,
  RotateCcw,
  Scale,
  Send,
  ShieldAlert,
  Sparkles,
  Timer,
  Trash2,
  Unlock,
  Hourglass,
  FilePlus2,
  ListChecks,
} from "lucide-react"
import { useParams, useNavigate } from "react-router-dom"
import { api } from "../../services/api"
import { cn, formatCurrencyINR } from "../../lib/utils"
import { STAFF_ROLES } from "../../lib/status"
import { SLAUrgencyBadge } from "../common/SLAUrgencyBadge"
import { ClaimStatusPill } from "../common/status"
import { Button } from "../ui/button"
import { Avatar } from "../ui/avatar"
import { Skeleton } from "../ui/skeleton"
import { TabBar } from "../ui/tab-bar"
import { Textarea } from "../ui/textarea"
import { Field } from "../ui/field"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useAuth } from "../../context/AuthContext"
import { DocumentExtractionView } from "../documents/DocumentExtractionView"
import { ClaimQueriesView } from "../queries/ClaimQueriesView"
import { CitationViewer } from "../documents/CitationViewer"
import { citationKey } from "../documents/citations"
import { DecisionSummaryCard } from "./DecisionSummaryCard"
import { MoneySummary } from "./MoneySummary"
import { LineItemsPanel } from "./LineItemsPanel"
import { ExplanationPanel } from "./ExplanationPanel"
import { NextStepBar } from "./NextStepBar"
import { AuditReportDialog } from "./AuditReportDialog"
import { buildJourney, decisionMinutes, missingRequiredDocs, OUTCOME_FILTERS } from "./journey"

const TABS = ["adjudication", "documents", "queries"]

const AI_STEPS = [
  "Reading the itemised bill",
  "Matching each item to the policy wording",
  "Checking IRDAI non-payables and sub-limits",
  "Writing the decision summary",
]

export function AdjudicationCockpit({ claimId: propClaimId }) {
  const { toast } = useToast()
  // Hospital and insurer are separate parties: the insurer adjudicates, the hospital drafts,
  // submits and follows the outcome read-only.
  const { user } = useAuth()
  const isInsurer = STAFF_ROLES.includes(user?.role)
  const isHospital = user?.role === "hospital_desk"
  const params = useParams()
  const navigate = useNavigate()

  const claimId = propClaimId || params.claimId

  // Tabs live in the URL (/claims/:claimId[/documents|/queries]); local state is only a
  // fallback when the cockpit is rendered outside a claim route (e.g. standalone tests).
  const [localTab, setLocalTab] = useState("adjudication")
  const routed = Boolean(params.claimId)
  const activeTab = routed ? (TABS.includes(params.tab) ? params.tab : "adjudication") : localTab
  const setActiveTab = (tab) => {
    if (!routed) setLocalTab(tab)
    else navigate(tab === "adjudication" ? `/claims/${params.claimId}` : `/claims/${params.claimId}/${tab}`)
  }

  const [claim, setClaim] = useState(null)
  const [adjudication, setAdjudication] = useState(null)
  const [docs, setDocs] = useState(null)
  const [queries, setQueries] = useState(null)
  const [selectedItemId, setSelectedItemId] = useState(null)
  // Citation open in the right-hand viewer: { citation, title } (bill line or policy passage)
  const [activeCitation, setActiveCitation] = useState(null)
  const [explanation, setExplanation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [runningPipeline, setRunningPipeline] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Rerun confirmation: a rerun replaces every line-item decision, adjuster overrides included
  const [rerunConfirm, setRerunConfirm] = useState({ open: false, showResults: false })
  const [overridingId, setOverridingId] = useState(null)
  const [outcomeFilter, setOutcomeFilter] = useState("all")
  const [finalizeModalOpen, setFinalizeModalOpen] = useState(false)
  const [finalizeNotes, setFinalizeNotes] = useState("")
  const [finalizing, setFinalizing] = useState(false)
  const [justFinalized, setJustFinalized] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [auditReportModalOpen, setAuditReportModalOpen] = useState(false)
  const [auditReport, setAuditReport] = useState(null)
  const explanationRef = useRef(null)
  const workAreaRef = useRef(null)

  const loadExplanation = async (itemId) => {
    try {
      const expl = await api.adjudication.getExplanation(claimId, itemId)
      setExplanation(expl)
    } catch (err) {
      console.error("Failed to load explanation:", err)
    }
  }

  const pickStartItem = (lineItems) => lineItems?.find((li) => li.final_status === "flagged") || lineItems?.[0] || null

  const loadClaimData = async ({ keepSelection = false } = {}) => {
    // Independent requests: a claim can exist before adjudication has been run (adjudication 404s),
    // so one failure must not discard the other result.
    const [claimRes, adjRes, docsRes, queriesRes] = await Promise.allSettled([
      api.claims.getById(claimId),
      api.adjudication.get(claimId),
      api.documents.list(claimId),
      api.queries.list(claimId),
    ])

    if (claimRes.status === "fulfilled") {
      setClaim(claimRes.value)
    } else {
      toast({
        title: "Couldn't load the claim",
        description: claimRes.reason?.message || "Viewing claim in offline/cached mode",
        variant: "destructive",
      })
    }

    if (adjRes.status === "fulfilled") {
      const adjData = adjRes.value
      setAdjudication(adjData)
      if (!keepSelection || !selectedItemId) {
        const start = pickStartItem(adjData?.line_items)
        if (start) {
          setSelectedItemId(start.id)
          loadExplanation(start.id)
        }
      }
    } else {
      // Not adjudicated yet is an expected state, not an error
      setAdjudication(null)
      if (adjRes.reason?.status !== 404) {
        toast({
          title: "Couldn't load the adjudication",
          description: adjRes.reason?.message || "Adjudication data is unavailable",
          variant: "destructive",
        })
      }
    }

    if (docsRes.status === "fulfilled") setDocs(docsRes.value || [])
    if (queriesRes.status === "fulfilled") setQueries(queriesRes.value || [])
    setLoading(false)
  }

  useEffect(() => {
    loadClaimData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimId])

  const handleSelectItem = (item) => {
    setActiveCitation(null)
    setOverridingId((id) => (id === item.id ? id : null))
    setSelectedItemId(item.id)
    loadExplanation(item.id)
    // On narrow screens the reasoning sits below the table: bring it into view
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      requestAnimationFrame(() => explanationRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }))
    }
  }

  // First run goes straight through; a rerun must be confirmed because it discards overrides
  const requestRunAdjudication = ({ showResults = false } = {}) => {
    if (adjudication) {
      setRerunConfirm({ open: true, showResults })
    } else {
      handleRunAdjudication({ showResults })
    }
  }

  // Trigger Gemini Adjudication Pipeline
  const handleRunAdjudication = async ({ confirmDiscardOverrides = false, showResults = false } = {}) => {
    setRerunConfirm({ open: false, showResults: false })
    setRunningPipeline(true)
    if (showResults) setActiveTab("adjudication")
    try {
      const res = await api.adjudication.run(claimId, { confirmDiscardOverrides })
      setAdjudication(res)
      setOutcomeFilter("all")
      setOverridingId(null)
      // Reload claim record so status, billed amount, and badges update immediately
      const updatedClaim = await api.claims.getById(claimId).catch(() => null)
      if (updatedClaim) setClaim(updatedClaim)

      const flagged = res.line_items?.filter((li) => li.final_status === "flagged").length || 0
      toast({
        title: "Adjudication complete",
        description: flagged
          ? `Every line item was checked against the policy. ${flagged} item${flagged === 1 ? " needs" : "s need"} your review.`
          : "Every line item was checked against the policy and the bill's validity was verified.",
        variant: "success",
      })
      const start = pickStartItem(res.line_items)
      if (start) handleSelectItem(start)
    } catch (err) {
      if (err.status === 409) {
        // Overrides were added since this page loaded: refresh and ask again
        await loadClaimData({ keepSelection: true })
        setRerunConfirm({ open: true, showResults })
        return
      }
      toast({ title: "Adjudication failed", description: err.message, variant: "destructive" })
    } finally {
      setRunningPipeline(false)
    }
  }

  // Hospital hands the draft to the insurer; this is what starts the SLA clock
  const requestSubmitClaim = async () => {
    // Mirror the server rule up front so the hospital learns exactly what is missing
    const fresh = await api.documents.list(claimId).catch(() => null)
    if (fresh) setDocs(fresh)
    const missing = missingRequiredDocs(fresh || docs)
    if (missing?.length) {
      toast({
        title: "Documents missing",
        description: `Attach the ${missing.map((m) => m.label).join(" and the ")} before submitting the claim to the insurer.`,
        variant: "destructive",
      })
      setActiveTab("documents")
      return
    }
    setSubmitConfirmOpen(true)
  }

  const handleSubmitClaim = async () => {
    setSubmitting(true)
    try {
      const updated = await api.claims.submit(claimId)
      setClaim(updated)
      setSubmitConfirmOpen(false)
      toast({
        title: "Claim submitted",
        description: `${updated.claim_number} is now with ${updated.insurer_name || "the insurer"}. The 3-hour IRDAI SLA has started.`,
        variant: "success",
      })
    } catch (err) {
      toast({ title: "Submission failed", description: err.message, variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  // Hospital discards a draft it no longer needs (only drafts; submitted claims are the insurer's)
  const handleDeleteClaim = async () => {
    setDeleting(true)
    try {
      await api.claims.delete(claimId)
      toast({ title: "Draft deleted", description: `${claim?.claim_number} and its documents were deleted.`, variant: "success" })
      setDeleteConfirmOpen(false)
      navigate("/claims")
    } catch (err) {
      toast({ title: "Couldn't delete the draft", description: err.message, variant: "destructive" })
    } finally {
      setDeleting(false)
    }
  }

  // Re-open/unlock finalized claim for audit
  const handleUnlockClaim = async () => {
    setUnlocking(true)
    try {
      await api.claims.updateStatus(claimId, "in_review", "Unlocked for audit review and re-adjudication")
      await loadClaimData({ keepSelection: true })
      setJustFinalized(false)
      toast({
        title: "Claim unlocked",
        description: "Status reset to In review. You can re-audit the decisions or rerun AI adjudication.",
        variant: "info",
      })
    } catch (err) {
      toast({ title: "Unlock failed", description: err.message, variant: "destructive" })
    } finally {
      setUnlocking(false)
    }
  }

  const startOverride = (item) => {
    if (item.id !== selectedItemId) handleSelectItem(item)
    setOverridingId(item.id)
  }

  // Apply an adjuster override, recalculate totals locally, then move on to the next flagged item
  const handleSubmitOverride = async (form) => {
    const target = adjudication?.line_items?.find((li) => li.id === overridingId)
    if (!target) return
    try {
      const newApproved = parseFloat(form.new_approved_amount_inr) || 0
      const newDeducted = Math.max(0, target.billed_amount_inr - newApproved)
      const payload = {
        new_status: form.new_status,
        override_reason: form.override_reason,
        override_note: form.override_note,
        new_approved_amount_inr: newApproved,
      }

      await api.adjudication.overrideLineItem(claimId, target.id, payload)

      const updatedItems = adjudication.line_items.map((li) =>
        li.id === target.id
          ? {
              ...li,
              final_status: payload.new_status,
              approved_amount_inr: newApproved,
              deducted_amount_inr: newDeducted,
              is_overridden: true,
              override_reason: payload.override_reason,
              override_note: payload.override_note,
            }
          : li
      )
      const totalBilled = updatedItems.reduce((acc, curr) => acc + (curr.billed_amount_inr || 0), 0)
      const totalApproved = updatedItems.reduce((acc, curr) => acc + (curr.approved_amount_inr || 0), 0)
      setAdjudication((prev) =>
        prev
          ? {
              ...prev,
              total_approved_inr: totalApproved,
              total_deducted_inr: totalBilled - totalApproved,
              flagged_items_count: updatedItems.filter((li) => li.final_status === "flagged").length,
              line_items: updatedItems,
            }
          : prev
      )
      setExplanation((prev) =>
        prev?.item_id === target.id ? { ...prev, final_status: payload.new_status, approved_amount_inr: newApproved, deducted_amount_inr: newDeducted } : prev
      )
      setOverridingId(null)

      const nextFlagged = updatedItems.find((li) => li.final_status === "flagged" && li.id !== target.id)
      toast({
        title: "Override applied",
        description: nextFlagged
          ? `Line ${target.line_number} updated and totals recalculated. Next: line ${nextFlagged.line_number}.`
          : `Line ${target.line_number} updated and claim totals recalculated.`,
        variant: "success",
      })
      if (nextFlagged && target.final_status === "flagged") {
        handleSelectItem(nextFlagged)
      } else if (outcomeFilter !== "all" && !OUTCOME_FILTERS.find((f) => f.value === outcomeFilter)?.match({ final_status: payload.new_status })) {
        setOutcomeFilter("all")
      }
    } catch (err) {
      toast({ title: "Override failed", description: err.message, variant: "destructive" })
    }
  }

  // Lock & finalize: records the adjuster's sign-off and the immutable compliance record
  const handleFinalize = async () => {
    setFinalizing(true)
    try {
      const res = await api.adjudication.finalize(claimId, { adjuster_notes: finalizeNotes })
      setAdjudication(res)
      setClaim((prev) => ({ ...prev, status: "finalized", finalized_at: res?.finalized_at || new Date().toISOString() }))
      setJustFinalized(true)
      toast({
        title: "Decision locked",
        description: "The compliance record has been generated.",
        variant: "success",
      })
      setFinalizeModalOpen(false)
    } catch (err) {
      toast({ title: "Couldn't finalize", description: err.message, variant: "destructive" })
    } finally {
      setFinalizing(false)
    }
  }

  const handleViewAuditReport = async () => {
    setAuditReport(null)
    setAuditReportModalOpen(true)
    try {
      const rep = await api.claims.getAuditReport(claimId)
      setAuditReport(rep)
    } catch (err) {
      setAuditReportModalOpen(false)
      toast({ title: "Couldn't load the report", description: err.message, variant: "destructive" })
    }
  }

  const lineItems = useMemo(() => adjudication?.line_items || [], [adjudication])
  const isFinalized = claim?.status === "finalized" || adjudication?.status === "finalized"
  const isDraft = claim?.status === "draft"
  const hasAdjudication = Boolean(adjudication)
  const overrideCount = lineItems.filter((li) => li.is_overridden).length
  const flaggedItems = lineItems.filter((li) => li.final_status === "flagged")
  const mismatchFlag = (adjudication?.gemini_raw_response?.flags || []).find((f) => String(f).includes("IDENTITY MISMATCH"))
  const mismatchText = mismatchFlag ? String(mismatchFlag).replace(/^IDENTITY MISMATCH:\s*/i, "") : ""
  const mismatchSentence = mismatchText ? mismatchText[0].toUpperCase() + mismatchText.slice(1) : ""
  const openQueries = (queries || []).filter((q) => q.status !== "resolved")
  const unansweredQueries = (queries || []).filter((q) => !q.response_text && q.status !== "resolved")
  const missingDocs = missingRequiredDocs(docs)

  const visibleItems = lineItems.filter((OUTCOME_FILTERS.find((f) => f.value === outcomeFilter) || OUTCOME_FILTERS[0]).match)
  const selectedItem = lineItems.find((i) => i.id === selectedItemId) || null
  const selectedIdx = visibleItems.findIndex((i) => i.id === selectedItemId)

  const reviewFlagged = () => {
    setActiveTab("adjudication")
    setOutcomeFilter("flagged")
    if (flaggedItems[0]) handleSelectItem(flaggedItems[0])
    requestAnimationFrame(() => workAreaRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }))
  }

  if (loading) return <CockpitSkeleton />

  const journey = buildJourney({ claim, adjudication, docs, hasMismatch: Boolean(mismatchFlag) })
  const insurer = claim?.insurer_name || "the insurer"
  const minutesToDecide = decisionMinutes(claim, adjudication)

  // ── What should happen next, for this role and this claim ─────────────────
  let next = null
  if (isHospital) {
    if (isDraft && missingDocs?.length !== 0) {
      next = {
        icon: FilePlus2,
        title: missingDocs ? `Attach the ${missingDocs.map((m) => m.label).join(" and the ")}` : "Attach the claim documents",
        detail: `${insurer} can't see this claim until you submit it. The policy document and the itemised bill are required.`,
        primary: (
          <Button variant="proceed" onClick={() => setActiveTab("documents")}>
            Add documents
            <ArrowRight className="h-4 w-4" />
          </Button>
        ),
      }
    } else if (isDraft) {
      next = {
        icon: Send,
        title: `Ready to submit to ${insurer}`,
        detail: "Submitting starts the 3-hour IRDAI SLA. Documents can't be deleted after this.",
        primary: (
          <Button variant="proceed" onClick={requestSubmitClaim} loading={submitting}>
            {!submitting && <Send className="h-4 w-4" />}
            Submit to insurer
          </Button>
        ),
      }
    } else if (isFinalized) {
      next = {
        tone: "done",
        icon: CheckCheck,
        title: `Decision locked: ${formatCurrencyINR(adjudication?.total_approved_inr ?? claim?.approved_amount)} approved`,
        detail: "Every deduction is explained line by line in the settlement report.",
        primary: (
          <Button onClick={handleViewAuditReport}>
            <FileCheck className="h-4 w-4" />
            View settlement report
          </Button>
        ),
      }
    } else if (unansweredQueries.length) {
      next = {
        icon: MessageSquare,
        title: `${insurer} asked ${unansweredQueries.length === 1 ? "a question" : `${unansweredQueries.length} questions`}`,
        detail: "Reply so the review can continue. The SLA clock keeps running.",
        primary: (
          <Button variant="proceed" onClick={() => setActiveTab("queries")}>
            Answer query
            <ArrowRight className="h-4 w-4" />
          </Button>
        ),
      }
    } else {
      next = {
        icon: Hourglass,
        tone: "done",
        title: `With ${insurer}`,
        detail: "The SLA clock is running. The decision appears here as soon as the adjuster locks it.",
      }
    }
  } else if (isInsurer) {
    if (isFinalized) {
      next = {
        tone: "done",
        icon: Lock,
        title: `Finalized${minutesToDecide != null ? ` in ${minutesToDecide} min` : ""}: ${formatCurrencyINR(adjudication?.total_approved_inr ?? claim?.approved_amount)} payout`,
        detail: "The decision is locked and the compliance record is ready.",
        secondary: (
          <Button variant="ghost" onClick={handleUnlockClaim} loading={unlocking}>
            {!unlocking && <Unlock className="h-4 w-4" />}
            Unlock for re-audit
          </Button>
        ),
        primary: (
          <Button onClick={handleViewAuditReport}>
            <FileCheck className="h-4 w-4" />
            Compliance record
          </Button>
        ),
      }
    } else if (!hasAdjudication) {
      next = {
        icon: Sparkles,
        title: runningPipeline ? "AI is adjudicating this claim" : "Run AI adjudication",
        detail: "Gemini reads the bill against the policy and decides every line item, with the clause behind it.",
        primary: (
          <Button variant="proceed" onClick={() => requestRunAdjudication({ showResults: true })} loading={runningPipeline}>
            {!runningPipeline && <Sparkles className="h-4 w-4" />}
            {runningPipeline ? "Analysing…" : "Run AI adjudication"}
          </Button>
        ),
      }
    } else if (mismatchFlag) {
      next = {
        tone: "alert",
        icon: ShieldAlert,
        title: "Resolve the identity mismatch",
        detail: `${mismatchSentence} Automated approval is blocked until the names match.`,
        secondary: (
          <Button variant="secondary" onClick={() => setActiveTab("queries")}>
            Raise a query
          </Button>
        ),
        primary: (
          <Button variant="proceed" onClick={() => setActiveTab("documents")}>
            Inspect the bill
            <ArrowRight className="h-4 w-4" />
          </Button>
        ),
      }
    } else if (flaggedItems.length) {
      next = {
        icon: ListChecks,
        title: `Check ${flaggedItems.length} flagged item${flaggedItems.length === 1 ? "" : "s"}`,
        detail: "The AI wasn't certain about these. Approve, reduce or exclude them, then lock the decision.",
        secondary: (
          <Button variant="ghost" onClick={() => setFinalizeModalOpen(true)}>
            Lock anyway
          </Button>
        ),
        primary: (
          <Button variant="proceed" onClick={reviewFlagged}>
            Review flagged item{flaggedItems.length === 1 ? "" : "s"}
            <ArrowRight className="h-4 w-4" />
          </Button>
        ),
      }
    } else if (unansweredQueries.length) {
      next = {
        icon: MessageSquare,
        title: "Waiting on the hospital's reply",
        detail: `${unansweredQueries.length} open quer${unansweredQueries.length === 1 ? "y" : "ies"}. You can still lock the decision if the answer won't change it.`,
        secondary: (
          <Button variant="secondary" onClick={() => setActiveTab("queries")}>
            View queries
          </Button>
        ),
        primary: (
          <Button variant="proceed" onClick={() => setFinalizeModalOpen(true)}>
            <Lock className="h-4 w-4" />
            Lock & finalize
          </Button>
        ),
      }
    } else {
      next = {
        icon: Lock,
        title: "Decision ready to lock",
        detail: `${formatCurrencyINR(adjudication.total_approved_inr)} approved of ${formatCurrencyINR(adjudication.total_billed_inr)} billed. Locking records your sign-off and the compliance record.`,
        primary: (
          <Button variant="proceed" onClick={() => setFinalizeModalOpen(true)}>
            <Lock className="h-4 w-4" />
            Lock & finalize
          </Button>
        ),
      }
    }
  }

  const goBack = () => {
    if (typeof window !== "undefined" && window.history.state?.idx > 0) navigate(-1)
    else navigate("/queue")
  }

  return (
    <div className="mx-auto max-w-[1360px] space-y-5 px-4 py-5 sm:px-6 sm:py-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <button
            type="button"
            onClick={goBack}
            className="-ml-1.5 inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-small font-semibold text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="mt-2 flex items-center gap-3.5">
            <Avatar name={claim?.patient_name} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-small text-ink-3">{claim?.claim_number}</span>
                <ClaimStatusPill status={claim?.status} />
                {adjudication?.gemini_model_used && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-peacock-50 px-2 py-0.5 text-tiny font-semibold text-peacock-700">
                    <Sparkles className="h-3 w-3" />
                    {adjudication.gemini_model_used}
                  </span>
                )}
              </div>
              <h1 className="mt-0.5 truncate text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[30px]">
                {claim?.patient_name}
              </h1>
              <p className="mt-0.5 text-sm text-ink-3">
                {claim?.hospital_name}
                <span className="mx-1.5 text-ink-4">→</span>
                {claim?.insurer_name || "Insurer not set"}
                {claim?.policy_number && (
                  <>
                    <span className="mx-1.5 text-ink-4">·</span>
                    Policy <span className="font-mono text-small">{claim.policy_number}</span>
                  </>
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-end">
          <div className="flex items-center gap-3">
            {isDraft ? (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-sunken px-3 text-small font-semibold text-ink-3">
                <Timer className="h-3.5 w-3.5" />
                SLA starts on submission
              </span>
            ) : isFinalized ? (
              minutesToDecide != null && (
                <span
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-small font-semibold",
                    claim?.sla_breached ? "bg-vermilion-50 text-vermilion-700" : "bg-leaf-50 text-leaf-700"
                  )}
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Decided in {minutesToDecide} min{claim?.sla_breached ? " · SLA missed" : " · within SLA"}
                </span>
              )
            ) : (
              <SLAUrgencyBadge slaDeadline={claim?.sla_deadline} isBreached={claim?.sla_breached} showBar className="min-w-[150px]" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isHospital && isDraft && (
              <Button size="sm" variant="danger-soft" onClick={() => setDeleteConfirmOpen(true)} disabled={deleting || submitting}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete draft
              </Button>
            )}
            {isInsurer && hasAdjudication && !isFinalized && (
              <Button size="sm" variant="secondary" onClick={() => requestRunAdjudication()} loading={runningPipeline}>
                {!runningPipeline && <RotateCcw className="h-3.5 w-3.5" />}
                {runningPipeline ? "Re-running…" : "Rerun AI"}
              </Button>
            )}
          </div>
        </div>
      </div>

      <NextStepBar
        steps={journey}
        next={next}
        stamp={
          isFinalized
            ? {
                label: "Finalized",
                amount: adjudication?.total_approved_inr ?? claim?.approved_amount,
                date: claim?.finalized_at || adjudication?.finalized_at,
                animate: justFinalized,
              }
            : null
        }
      />

      {/* Critical identity mismatch (the insurer sees it in the next-step bar instead) */}
      {mismatchFlag && !(isInsurer && !isFinalized) && (
        <div role="alert" className="flex flex-col gap-3 rounded-card bg-vermilion-50 p-4 ring-1 ring-inset ring-vermilion-200 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-vermilion-600 text-white">
              <ShieldAlert className="h-5 w-5" />
            </span>
            <div>
              <div className="text-sm font-semibold text-vermilion-800">The hospital bill's patient isn't the registered claimant</div>
              <p className="mt-0.5 max-w-3xl text-small leading-relaxed text-vermilion-800/90">{mismatchFlag}</p>
              <p className="mt-0.5 text-tiny font-medium text-vermilion-700">
                Automated approval is blocked. IRDAI adjudication standards require an exact name match.
              </p>
            </div>
          </div>
          <Button size="sm" variant="danger-soft" onClick={() => setActiveTab("documents")} className="shrink-0">
            <FileText className="h-3.5 w-3.5" />
            Inspect bill
          </Button>
        </div>
      )}

      <MoneySummary claim={claim} adjudication={adjudication} />

      {/* Work areas */}
      <div ref={workAreaRef} className="scroll-mt-16 space-y-5">
        <TabBar
          ariaLabel="Claim sections"
          value={activeTab}
          onChange={setActiveTab}
          tabs={[
            {
              value: "adjudication",
              label: isHospital ? "Outcome" : "Decision",
              icon: Scale,
              count: lineItems.length || undefined,
              attention: isInsurer && !isFinalized && flaggedItems.length > 0,
            },
            { value: "documents", label: "Documents", icon: FileText, count: docs ? docs.length : undefined, attention: isHospital && isDraft && missingDocs?.length > 0 },
            {
              value: "queries",
              label: "Queries",
              icon: MessageSquare,
              count: queries ? queries.length : undefined,
              attention: isHospital ? unansweredQueries.length > 0 : openQueries.some((q) => q.response_text),
            },
          ]}
        />

        <div key={activeTab} className="animate-rise">
          {activeTab === "documents" && (
            <DocumentExtractionView
              claimId={claimId}
              claim={claim}
              onRunAdjudication={() => requestRunAdjudication({ showResults: true })}
              onSwitchToAdjudication={() => setActiveTab("adjudication")}
              runningPipeline={runningPipeline}
              hasAdjudication={hasAdjudication}
              onDocumentsChange={setDocs}
              onSubmitClaim={isHospital && isDraft ? requestSubmitClaim : undefined}
            />
          )}

          {activeTab === "queries" && <ClaimQueriesView claimId={claimId} onQueriesChange={setQueries} />}

          {activeTab === "adjudication" && (
            <div className="space-y-5">
              {runningPipeline && <AiAtWork count={lineItems.length} />}

              {!hasAdjudication && !runningPipeline ? (
                <NoDecisionYet
                  isInsurer={isInsurer}
                  isDraft={isDraft}
                  insurer={insurer}
                  onRun={() => requestRunAdjudication({ showResults: true })}
                  onDocuments={() => setActiveTab("documents")}
                />
              ) : hasAdjudication ? (
                <>
                  {!isDraft && (
                    <DecisionSummaryCard
                      adjudication={adjudication}
                      defaultOpen={!isInsurer || flaggedItems.length === 0}
                      onSelectItem={(item) => {
                        setOutcomeFilter("all")
                        handleSelectItem(item)
                      }}
                    />
                  )}

                  <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
                    <div className="lg:col-span-7">
                      <LineItemsPanel
                        items={lineItems}
                        selectedId={selectedItemId}
                        onSelect={handleSelectItem}
                        onOverride={startOverride}
                        canOverride={isInsurer && !isFinalized}
                        filter={outcomeFilter}
                        onFilterChange={setOutcomeFilter}
                        isHospital={isHospital}
                      />
                    </div>

                    <div ref={explanationRef} className="scroll-mt-20 space-y-4 lg:sticky lg:top-20 lg:col-span-5 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pb-1">
                      <ExplanationPanel
                        item={selectedItem}
                        explanation={explanation}
                        position={selectedIdx >= 0 ? selectedIdx + 1 : null}
                        total={visibleItems.length}
                        onPrev={selectedIdx > 0 ? () => handleSelectItem(visibleItems[selectedIdx - 1]) : null}
                        onNext={selectedIdx >= 0 && selectedIdx < visibleItems.length - 1 ? () => handleSelectItem(visibleItems[selectedIdx + 1]) : null}
                        canOverride={isInsurer && !isFinalized}
                        overriding={overridingId === selectedItemId}
                        onStartOverride={startOverride}
                        onCancelOverride={() => setOverridingId(null)}
                        onSubmitOverride={handleSubmitOverride}
                        claimApprovedTotal={adjudication?.total_approved_inr}
                        activeCitation={activeCitation?.citation}
                        onOpenCitation={setActiveCitation}
                        isHospital={isHospital}
                      />

                      {activeCitation && (
                        <CitationViewer
                          key={citationKey(activeCitation.citation)}
                          claimId={claimId}
                          citation={activeCitation.citation}
                          title={activeCitation.title}
                          onClose={() => setActiveCitation(null)}
                        />
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Submit confirmation (hospital) */}
      <Dialog open={submitConfirmOpen} onOpenChange={setSubmitConfirmOpen}>
        <DialogContent onClose={() => setSubmitConfirmOpen(false)}>
          <DialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-marigold-100 text-marigold-800">
              <Send className="h-5 w-5" />
            </div>
            <DialogTitle>Submit this claim to {insurer}?</DialogTitle>
            <DialogDescription>
              The 3-hour IRDAI SLA starts now. After submitting you can still add documents and answer queries, but you can't delete documents.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 rounded-xl bg-ground p-4 text-small">
            {(docs || []).map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-ink-2">
                <CheckCheck className="h-4 w-4 text-leaf-600" />
                <span className="truncate">{d.original_filename}</span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setSubmitConfirmOpen(false)} disabled={submitting}>
              Not yet
            </Button>
            <Button variant="proceed" onClick={handleSubmitClaim} loading={submitting}>
              {!submitting && <Send className="h-4 w-4" />}
              {submitting ? "Submitting…" : "Submit & start SLA"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete draft confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent onClose={() => setDeleteConfirmOpen(false)}>
          <DialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-vermilion-50 text-vermilion-600">
              <Trash2 className="h-5 w-5" />
            </div>
            <DialogTitle>Delete draft {claim?.claim_number}?</DialogTitle>
            <DialogDescription>The draft and every document attached to it are permanently deleted. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteConfirmOpen(false)}>
              Keep draft
            </Button>
            <Button variant="danger" onClick={handleDeleteClaim} loading={deleting}>
              {!deleting && <Trash2 className="h-4 w-4" />}
              {deleting ? "Deleting…" : "Delete draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rerun confirmation */}
      <Dialog open={rerunConfirm.open} onOpenChange={(open) => setRerunConfirm((prev) => ({ ...prev, open }))}>
        <DialogContent onClose={() => setRerunConfirm({ open: false, showResults: false })}>
          <DialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-sand-100 text-sand-700">
              <AlertOctagon className="h-5 w-5" />
            </div>
            <DialogTitle>Rerun AI adjudication?</DialogTitle>
            <DialogDescription>This claim has already been adjudicated. A rerun replaces every line-item decision with a fresh AI result.</DialogDescription>
          </DialogHeader>
          {overrideCount > 0 ? (
            <div className="rounded-xl bg-vermilion-50 p-3.5 text-small text-vermilion-800 ring-1 ring-inset ring-vermilion-200">
              <strong className="font-semibold">
                {overrideCount} adjuster override{overrideCount === 1 ? "" : "s"} will be permanently discarded,
              </strong>{" "}
              along with their reasons and notes. Re-apply them after the rerun if they still hold.
            </div>
          ) : (
            <div className="rounded-xl bg-sand-50 p-3.5 text-small text-sand-800 ring-1 ring-inset ring-sand-200">
              The current decisions, amounts and AI explanations will be replaced.
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRerunConfirm({ open: false, showResults: false })}>
              Cancel
            </Button>
            <Button
              variant={overrideCount > 0 ? "danger" : "primary"}
              onClick={() => handleRunAdjudication({ confirmDiscardOverrides: true, showResults: rerunConfirm.showResults })}
            >
              <RotateCcw className="h-4 w-4" />
              {overrideCount > 0 ? "Rerun & discard overrides" : "Rerun AI adjudication"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lock & finalize */}
      <Dialog open={finalizeModalOpen} onOpenChange={setFinalizeModalOpen}>
        <DialogContent onClose={() => setFinalizeModalOpen(false)}>
          <DialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-peacock-50 text-peacock-600">
              <Lock className="h-5 w-5" />
            </div>
            <DialogTitle>Lock and finalize this decision?</DialogTitle>
            <DialogDescription>
              Finalizing locks the decision, records your sign-off and stamps an immutable compliance record.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <dl className="grid grid-cols-3 overflow-hidden rounded-xl bg-ground text-center">
              <div className="px-2 py-3">
                <dt className="text-tiny font-medium text-ink-3">Payout</dt>
                <dd className="figures mt-0.5 text-body font-semibold text-leaf-700">{formatCurrencyINR(adjudication?.total_approved_inr)}</dd>
              </div>
              <div className="border-l border-line px-2 py-3">
                <dt className="text-tiny font-medium text-ink-3">Deductions</dt>
                <dd className="figures mt-0.5 text-body font-semibold text-ink">{formatCurrencyINR(adjudication?.total_deducted_inr)}</dd>
              </div>
              <div className="border-l border-line px-2 py-3">
                <dt className="text-tiny font-medium text-ink-3">Overrides</dt>
                <dd className="figures mt-0.5 text-body font-semibold text-ink">{overrideCount}</dd>
              </div>
            </dl>

            {flaggedItems.length > 0 && (
              <p className="rounded-xl bg-marigold-50 px-3.5 py-2.5 text-small text-marigold-800 ring-1 ring-inset ring-marigold-200">
                {flaggedItems.length} item{flaggedItems.length === 1 ? " is" : "s are"} still flagged and will be locked as they stand
                (not paid). Review {flaggedItems.length === 1 ? "it" : "them"} first if that isn't intended.
              </p>
            )}

            <Field label="Sign-off remarks" htmlFor="finalize-notes" optional>
              <Textarea
                id="finalize-notes"
                value={finalizeNotes}
                onChange={(e) => setFinalizeNotes(e.target.value)}
                placeholder="Summary of the cashless authorisation or deductions"
                rows={3}
              />
            </Field>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setFinalizeModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="proceed" onClick={handleFinalize} loading={finalizing}>
              {!finalizing && <Lock className="h-4 w-4" />}
              {finalizing ? "Locking…" : "Lock & finalize"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AuditReportDialog open={auditReportModalOpen} onOpenChange={setAuditReportModalOpen} report={auditReport} isHospital={isHospital} />
    </div>
  )
}

function AiAtWork({ count }) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(s + 1, AI_STEPS.length - 1)), 1400)
    return () => clearInterval(id)
  }, [])
  return (
    <section className="overflow-hidden rounded-card bg-peacock-800 text-white shadow-raised" aria-live="polite">
      <div className="h-1 w-full overflow-hidden bg-white/10">
        <div className="h-full w-1/3 animate-indeterminate rounded-full bg-marigold-400" />
      </div>
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10">
            <Sparkles className="h-5 w-5 animate-pulse text-marigold-300" />
          </span>
          <div>
            <div className="font-semibold">AI is adjudicating{count ? ` ${count} line items` : " this claim"}</div>
            <div className="text-small text-peacock-100/80">Usually takes under a minute. You can keep working on other tabs.</div>
          </div>
        </div>
        <ol className="grid gap-1.5 text-small sm:min-w-[300px]">
          {AI_STEPS.map((label, i) => (
            <li key={label} className={cn("flex items-center gap-2 transition-colors duration-300", i < step ? "text-peacock-200" : i === step ? "text-white" : "text-white/40")}>
              <span className={cn("h-1.5 w-1.5 rounded-full", i < step ? "bg-peacock-300" : i === step ? "bg-marigold-400" : "bg-white/25")} />
              {label}
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function NoDecisionYet({ isInsurer, isDraft, insurer, onRun, onDocuments }) {
  return (
    <section className="flex flex-col items-center rounded-card bg-surface px-6 py-14 text-center shadow-card">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-peacock-50 text-peacock-600">
        <Scale className="h-6 w-6" strokeWidth={1.75} />
      </div>
      <h3 className="text-lg font-semibold text-ink">{isDraft ? "No decision before submission" : "No decision yet"}</h3>
      <p className="mt-1 max-w-md text-sm text-ink-3">
        {isInsurer
          ? "Run AI adjudication to get a decision for every line item, the policy clause behind it, and anything that needs your eye."
          : isDraft
            ? `Once you submit, ${insurer} reviews each line item. Their decision and reasoning appear here.`
            : `${insurer} is reviewing the bill. Each line item's decision and reasoning will appear here.`}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {isInsurer ? (
          <>
            <Button variant="secondary" onClick={onDocuments}>
              Check documents first
            </Button>
            <Button variant="proceed" onClick={onRun}>
              <Sparkles className="h-4 w-4" />
              Run AI adjudication
            </Button>
          </>
        ) : (
          isDraft && (
            <Button variant="proceed" onClick={onDocuments}>
              Go to documents
              <ArrowRight className="h-4 w-4" />
            </Button>
          )
        )}
      </div>
    </section>
  )
}

function CockpitSkeleton() {
  return (
    <div className="mx-auto max-w-[1360px] space-y-5 px-4 py-6 sm:px-6" aria-busy="true" aria-label="Loading claim">
      <div className="flex items-center gap-3.5">
        <Skeleton className="h-12 w-12 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-3.5 w-80" />
        </div>
      </div>
      <Skeleton className="h-36 rounded-card" />
      <Skeleton className="h-28 rounded-card" />
      <div className="grid gap-5 lg:grid-cols-12">
        <Skeleton className="h-96 rounded-card lg:col-span-7" />
        <Skeleton className="h-96 rounded-card lg:col-span-5" />
      </div>
    </div>
  )
}
