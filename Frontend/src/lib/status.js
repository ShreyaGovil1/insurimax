import {
  AlertTriangle,
  BadgeCheck,
  CircleDashed,
  CircleSlash,
  FileClock,
  Lock,
  MessageCircleQuestion,
  MinusCircle,
  ScanSearch,
  Send,
  Sparkles,
  XCircle,
  CheckCircle2,
  Eye,
} from "lucide-react"

/**
 * Display meta for every claim status the backend can return.
 * tone maps to a pill style in components/common/status.jsx.
 */
export const CLAIM_STATUS = {
  draft: { label: "Draft", tone: "draft", icon: CircleDashed },
  submitted: { label: "Submitted", tone: "neutral", icon: Send },
  documents_pending: { label: "Documents pending", tone: "sand", icon: FileClock },
  extraction_in_progress: { label: "Reading documents", tone: "peacock", icon: ScanSearch },
  adjudication_in_progress: { label: "AI adjudicating", tone: "peacock", icon: Sparkles },
  in_review: { label: "In review", tone: "peacock", icon: Eye },
  queried: { label: "Query open", tone: "sand", icon: MessageCircleQuestion },
  escalated: { label: "Escalated", tone: "sand", icon: AlertTriangle },
  auto_approved: { label: "Auto-approved", tone: "leaf", icon: Sparkles },
  approved: { label: "Approved", tone: "leaf", icon: CheckCircle2 },
  partially_approved: { label: "Partly approved", tone: "leaf", icon: MinusCircle },
  rejected: { label: "Rejected", tone: "vermilion", icon: XCircle },
  finalized: { label: "Finalized", tone: "final", icon: Lock },
  stale: { label: "Stale", tone: "neutral", icon: CircleSlash },
}

export const claimStatusMeta = (status) =>
  CLAIM_STATUS[status] || { label: String(status || "Unknown").replaceAll("_", " "), tone: "neutral", icon: CircleDashed }

/** Line-item decisions. Only "flagged" is loud: it is the adjuster's next piece of work. */
export const DECISION_STATUS = {
  approved: { label: "Approved", tone: "leaf", icon: CheckCircle2 },
  partially_approved: { label: "Reduced", tone: "sand", icon: MinusCircle },
  non_payable: { label: "Non-payable", tone: "vermilion", icon: CircleSlash },
  rejected: { label: "Rejected", tone: "vermilion", icon: XCircle },
  flagged: { label: "To check", tone: "flag", icon: AlertTriangle },
  pending: { label: "Pending", tone: "neutral", icon: CircleDashed },
}

export const decisionStatusMeta = (status) =>
  DECISION_STATUS[status] || { label: String(status || "Pending").replaceAll("_", " "), tone: "neutral", icon: BadgeCheck }

/**
 * Where a claim is on its route, from status alone (lists have no document info).
 * 0 Draft · 1 Submitted · 2 AI reviewed · 3 Finalized
 */
export const ROUTE_STOPS = ["Draft", "Submitted", "AI reviewed", "Finalized"]

export function claimStage(status) {
  switch (status) {
    case "draft":
      return 0
    case "submitted":
    case "documents_pending":
    case "extraction_in_progress":
    case "adjudication_in_progress":
      return 1
    case "finalized":
      return 3
    default:
      return 2
  }
}

export const DOC_TYPES = [
  { value: "itemized_bill", label: "Itemised bill", short: "Bill" },
  { value: "policy_document", label: "Policy document", short: "Policy" },
  { value: "discharge_summary", label: "Discharge summary", short: "Discharge" },
  { value: "prescription", label: "Prescription", short: "Prescription" },
  { value: "lab_report", label: "Lab report", short: "Lab report" },
  { value: "other", label: "Other document", short: "Other" },
]

// Must match _REQUIRED_FOR_SUBMISSION in the backend claims routes
export const REQUIRED_FOR_SUBMISSION = [
  { type: "policy_document", label: "policy document" },
  { type: "itemized_bill", label: "medical bill" },
]

export const STAFF_ROLES = ["admin", "adjuster"]
