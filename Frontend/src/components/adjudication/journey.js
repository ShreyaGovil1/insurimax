import { formatTime } from "../../lib/utils"
import { REQUIRED_FOR_SUBMISSION } from "../../lib/status"

/** Which required documents are still missing (null while the list hasn't loaded). */
export function missingRequiredDocs(docs) {
  if (!docs) return null
  const types = new Set(docs.map((d) => d.doc_type))
  return REQUIRED_FOR_SUBMISSION.filter((r) => !types.has(r.type))
}

const shortDate = (iso) => {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay ? formatTime(iso) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })
}

/**
 * The five stations of a cashless claim and where this one stands:
 * Draft · Documents · Submitted · AI adjudication · Decision
 */
export function buildJourney({ claim, adjudication, docs, hasMismatch }) {
  const isDraft = claim?.status === "draft"
  const isFinalized = claim?.status === "finalized" || adjudication?.status === "finalized"
  const missing = missingRequiredDocs(docs)
  const docsReady = Array.isArray(missing) && missing.length === 0

  let stage
  if (isFinalized) stage = 5
  else if (!isDraft) stage = adjudication ? 4 : 3
  else stage = docsReady ? 2 : 1

  const stations = [
    { key: "draft", label: "Draft", caption: shortDate(claim?.created_at) },
    {
      key: "documents",
      label: "Documents",
      caption: docs ? `${docs.length} attached` : isDraft ? null : "Attached",
    },
    { key: "submitted", label: "Submitted", caption: isDraft ? "SLA starts here" : shortDate(claim?.submitted_at) },
    {
      key: "ai",
      label: "AI adjudication",
      caption: adjudication ? shortDate(adjudication.created_at) || "Done" : isDraft ? null : "Not run yet",
    },
    {
      key: "decision",
      label: isFinalized ? "Finalized" : "Decision",
      caption: isFinalized ? shortDate(claim?.finalized_at || adjudication?.finalized_at) : null,
    },
  ]

  return stations.map((s, i) => ({
    ...s,
    state: i < stage ? "done" : i === stage ? (s.key === "decision" && hasMismatch ? "alert" : "current") : "todo",
  }))
}

/** Minutes from submission to finalization, when both are known. */
export function decisionMinutes(claim, adjudication) {
  const start = claim?.submitted_at ? new Date(claim.submitted_at).getTime() : null
  const endIso = claim?.finalized_at || adjudication?.finalized_at
  const end = endIso ? new Date(endIso).getTime() : null
  if (!start || !end || Number.isNaN(start) || Number.isNaN(end) || end < start) return null
  return Math.round((end - start) / 60000)
}

export const OVERRIDE_REASON_LABELS = {
  clinical_necessity: "Clinical necessity",
  hospital_clarification: "Hospital clarification",
  upcoding_detected: "Upcoding detected",
  incorrect_policy_application: "Incorrect policy application",
  document_illegible: "Document illegible",
  adjuster_discretion: "Adjuster discretion",
  other: "Other",
}

/** Outcome groups for filtering line items; keyed by final_status so overrides count. */
export const OUTCOME_FILTERS = [
  { value: "all", label: "All", match: () => true },
  { value: "flagged", label: "To check", match: (li) => li.final_status === "flagged" },
  { value: "reduced", label: "Reduced", match: (li) => li.final_status === "partially_approved" },
  { value: "excluded", label: "Excluded", match: (li) => li.final_status === "non_payable" || li.final_status === "rejected" },
  { value: "approved", label: "Approved", match: (li) => li.final_status === "approved" },
]
