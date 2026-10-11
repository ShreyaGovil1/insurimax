import { useMemo, useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowUpDown,
  Bot,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Clock3,
  Copy,
  ExternalLink,
  Eye,
  FileEdit,
  FileText,
  Filter,
  GitCommit,
  HelpCircle,
  Layers,
  MessageSquare,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  User,
  X,
} from "lucide-react"
import { cn, formatDateTime, formatRelative, humanize } from "../../lib/utils"
import { claimStatusMeta } from "../../lib/status"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import { ClaimStatusPill } from "../common/status"
import { api } from "../../services/api"

/**
 * Format duration between two timestamps in a human friendly manner:
 * e.g., "12m", "1h 14m", "2d 5h", or "< 1m"
 */
export function formatDurationMs(ms) {
  if (ms == null || isNaN(ms) || ms < 0) return null
  if (ms < 60000) return "< 1m"
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  if (hours < 24) {
    return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`
  }
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`
}

/**
 * Resolve an actor description based on available properties and note context
 */
function resolveActor(entry) {
  if (entry.changed_by_name) {
    return {
      name: entry.changed_by_name,
      role: entry.changed_by_role ? humanize(entry.changed_by_role) : "User",
      isAi: false,
    }
  }
  const note = (entry.note || "").toLowerCase()
  const toStatus = (entry.to_status || "").toLowerCase()

  if (toStatus === "auto_approved" || note.includes("auto-approval") || note.includes("auto approved") || note.includes("ai")) {
    return { name: "InsuriMax AI Adjudication Engine", role: "Automated Rule", isAi: true }
  }
  if (note.includes("submitted to insurer") || note.includes("drafted") || toStatus === "draft") {
    return { name: "Hospital Desk / Provider", role: "Portal Action", isAi: false }
  }
  if (note.includes("queries answered") || note.includes("query answered")) {
    return { name: "Hospital Clarification Desk", role: "Response", isAi: false }
  }
  if (note.includes("suspected") || toStatus === "escalated") {
    return { name: "Medical Audit & Claims Investigator", role: "Adjuster Review", isAi: false }
  }
  if (entry.changed_by_id) {
    return { name: `Staff Member (${entry.changed_by_id.slice(0, 8)})`, role: "Staff", isAi: false }
  }
  return { name: "System Workflow", role: "Platform Event", isAi: false }
}

/**
 * Resolve transition title and visual semantic tone
 */
function resolveStepMeta(entry, index, totalSteps) {
  const from = (entry.from_status || "").toLowerCase()
  const to = (entry.to_status || "").toLowerCase()
  const note = (entry.note || "").toLowerCase()

  // Severity / tone: "vermilion" | "sand" | "leaf" | "peacock" | "neutral"
  if (to === "escalated" || note.includes("suspected") || note.includes("upcoding") || note.includes("breach")) {
    return {
      tone: "vermilion",
      title: "Escalated for Medical Audit & Review",
      icon: AlertTriangle,
      badgeVariant: "vermilion",
    }
  }
  if (to === "auto_approved") {
    return {
      tone: "leaf",
      title: "Fast-Track AI Auto-Approved",
      icon: Sparkles,
      badgeVariant: "leaf",
    }
  }
  if (to === "approved" || to === "partially_approved") {
    return {
      tone: "leaf",
      title: to === "approved" ? "Claim Approved by Adjuster" : "Partially Approved with Deductions",
      icon: CheckCircle2,
      badgeVariant: "leaf",
    }
  }
  if (to === "rejected") {
    return {
      tone: "vermilion",
      title: "Claim Rejected",
      icon: AlertCircle,
      badgeVariant: "vermilion",
    }
  }
  if (to === "queried") {
    return {
      tone: "sand",
      title: "Information Query Raised to Hospital",
      icon: HelpCircle,
      badgeVariant: "sand",
    }
  }
  if (from === "queried" && to === "in_review") {
    return {
      tone: "peacock",
      title: "Hospital Queries Answered · Review Resumed",
      icon: MessageSquare,
      badgeVariant: "peacock",
    }
  }
  if (to === "submitted") {
    return {
      tone: "peacock",
      title: "Claim Submitted to Insurer",
      icon: Send,
      badgeVariant: "peacock",
    }
  }
  if (to === "draft" || (!from && index === 0)) {
    return {
      tone: "neutral",
      title: "Claim Inception & Draft Created",
      icon: FileEdit,
      badgeVariant: "outline",
    }
  }
  if (to === "finalized") {
    return {
      tone: "dark",
      title: "Claim Adjudication Finalized",
      icon: Check,
      badgeVariant: "dark",
    }
  }
  return {
    tone: "peacock",
    title: `Transitioned to ${humanize(to)}`,
    icon: GitCommit,
    badgeVariant: "peacock",
  }
}

/**
 * Visual timeline node for a single change event
 */
function ProcessStepNode({
  step,
  index,
  total,
  isLatest,
  elapsedFromPrev,
  elapsedFromStart,
  orderAsc,
}) {
  const meta = resolveStepMeta(step, index, total)
  const actor = resolveActor(step)
  const Icon = meta.icon

  const nodeColorClass = {
    vermilion: "bg-vermilion-50 text-vermilion-700 ring-vermilion-200 border-vermilion-300",
    sand: "bg-sand-50 text-sand-700 ring-sand-200 border-sand-300",
    leaf: "bg-leaf-50 text-leaf-700 ring-leaf-200 border-leaf-300",
    peacock: "bg-peacock-50 text-peacock-700 ring-peacock-200 border-peacock-300",
    dark: "bg-peacock-900 text-white ring-peacock-700 border-peacock-800",
    neutral: "bg-ground text-ink-3 ring-line border-line-strong",
  }[meta.tone] || "bg-peacock-50 text-peacock-700 ring-peacock-200 border-peacock-300"

  const noteBoxClass = {
    vermilion: "bg-vermilion-50/60 border-vermilion-200 text-vermilion-900",
    sand: "bg-sand-50/60 border-sand-200 text-sand-900",
    leaf: "bg-leaf-50/60 border-leaf-200 text-leaf-900",
    peacock: "bg-peacock-50/50 border-peacock-200 text-peacock-950",
    dark: "bg-peacock-50 border-peacock-200 text-ink",
    neutral: "bg-ground/70 border-line text-ink-2",
  }[meta.tone] || "bg-ground/70 border-line text-ink-2"

  const stepNumber = orderAsc ? index + 1 : total - index

  return (
    <li className="relative flex gap-4 pb-8 last:pb-1 group">
      {/* Vertical timeline spine */}
      {index < total - 1 && (
        <span
          aria-hidden="true"
          className="absolute left-[19px] top-10 bottom-0 w-[2px] bg-line transition-colors group-hover:bg-peacock-300"
        />
      )}

      {/* Step circular marker */}
      <div className="relative z-10 flex shrink-0 flex-col items-center">
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-xl border font-mono text-tiny font-bold shadow-sm transition-transform duration-200 group-hover:scale-105",
            nodeColorClass
          )}
          title={`Step ${stepNumber} of ${total}`}
        >
          <Icon className="h-4 w-4" />
        </div>
        <span className="mt-1 font-mono text-[10px] font-semibold text-ink-4">
          #{stepNumber}
        </span>
      </div>

      {/* Step card content */}
      <div className="min-w-0 flex-1 rounded-xl border border-line bg-surface p-4 shadow-sm transition-all hover:border-line-strong hover:shadow-card">
        {/* Top bar: title + time + elapsed badge */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-ink">
                {meta.title}
              </span>
              {isLatest && (
                <span className="rounded-full bg-peacock-700 px-2 py-0.5 text-tiny font-semibold text-white">
                  Current Status
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-tiny text-ink-3">
              <span className="font-semibold text-ink-2">{formatDateTime(step.timestamp)}</span>
              <span>•</span>
              <span className="figures">{formatRelative(step.timestamp)}</span>
            </div>
          </div>

          {/* Time intervals */}
          <div className="flex flex-wrap items-center gap-1.5 self-start">
            {elapsedFromPrev && (
              <span
                className="inline-flex items-center gap-1 rounded-md bg-ground px-2 py-0.5 font-mono text-tiny font-medium text-ink-2 border border-line/60"
                title="Time elapsed since preceding transition"
              >
                <Clock className="h-3 w-3 text-ink-4" />
                +{elapsedFromPrev}
              </span>
            )}
            {index === 0 && orderAsc && (
              <span className="rounded-md bg-sunken px-2 py-0.5 text-tiny font-medium text-ink-3">
                Process Inception
              </span>
            )}
          </div>
        </div>

        {/* Status transition visualization */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-y border-line/60 py-2.5">
          <span className="text-tiny font-semibold uppercase tracking-wider text-ink-4">
            State change:
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {step.from_status ? (
              <>
                <Badge variant="outline" className="font-medium">
                  {humanize(step.from_status)}
                </Badge>
                <ArrowRight className="h-3.5 w-3.5 text-ink-4" />
                <Badge variant={meta.badgeVariant} className="font-semibold">
                  {humanize(step.to_status)}
                </Badge>
              </>
            ) : (
              <Badge variant={meta.badgeVariant} className="font-semibold">
                Initial: {humanize(step.to_status)}
              </Badge>
            )}
          </div>
        </div>

        {/* Audit Note & Reason Callout */}
        <div className={cn("mt-3 rounded-lg border p-3", noteBoxClass)}>
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 shrink-0">
              <Icon className="h-4 w-4 text-current opacity-80" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-tiny font-bold uppercase tracking-wider opacity-75">
                Audit Note / Reason
              </div>
              <p className="mt-0.5 text-small font-medium leading-relaxed">
                {step.note || "No audit justification provided for this transition."}
              </p>
            </div>
          </div>
        </div>

        {/* Actor attribution footer */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line/40 pt-2.5 text-tiny text-ink-3">
          <div className="flex items-center gap-1.5">
            {actor.isAi ? (
              <Bot className="h-3.5 w-3.5 text-peacock-600" />
            ) : (
              <User className="h-3.5 w-3.5 text-ink-4" />
            )}
            <span className="font-medium text-ink-2">{actor.name}</span>
            <span className="text-ink-4">({actor.role})</span>
          </div>

          {elapsedFromStart && (
            <span className="figures text-ink-4" title="Cumulative elapsed time from lifecycle start">
              T+{elapsedFromStart} cumulative
            </span>
          )}
        </div>
      </div>
    </li>
  )
}

/**
 * Dedicated single claim inspection view showing the complete change process
 */
export function SingleClaimProcessView({
  claimId,
  claimNumber,
  events = [],
  onBack,
  onSelectClaim,
}) {
  const navigate = useNavigate()
  const [orderAsc, setOrderAsc] = useState(true) // true: chronological inception -> current
  const [copied, setCopied] = useState(false)
  const [fullTrace, setFullTrace] = useState(null)
  const [traceLoading, setTraceLoading] = useState(false)

  // Sort events chronologically (oldest first)
  const sortedAscEvents = useMemo(() => {
    return [...events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
  }, [events])

  // Display events based on sort direction toggle
  const displayEvents = useMemo(() => {
    return orderAsc ? sortedAscEvents : [...sortedAscEvents].reverse()
  }, [orderAsc, sortedAscEvents])

  // Fetch enriched full trace from API if claimId is provided
  useEffect(() => {
    let active = true
    if (claimId) {
      setTraceLoading(true)
      api.compliance
        .getFullTrace(claimId)
        .then((trace) => {
          if (active) setFullTrace(trace)
        })
        .catch(() => {
          // Gracefully continue with available audit entries
        })
        .finally(() => {
          if (active) setTraceLoading(false)
        })
    }
    return () => {
      active = false
    }
  }, [claimId])

  const copyClaimNumber = () => {
    const text = claimNumber || claimId
    if (text) {
      navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // Calculate lifecycle stats
  const totalSteps = sortedAscEvents.length
  const firstEvent = sortedAscEvents[0]
  const latestEvent = sortedAscEvents[sortedAscEvents.length - 1]
  const currentStatus = latestEvent?.to_status || "unknown"

  const totalDurationMs =
    firstEvent && latestEvent
      ? new Date(latestEvent.timestamp).getTime() - new Date(firstEvent.timestamp).getTime()
      : 0
  const formattedTotalDuration = formatDurationMs(totalDurationMs) || "< 1m"

  return (
    <div className="space-y-6">
      {/* Top action / navigation header */}
      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {onBack && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onBack}
              className="gap-1.5 text-ink-2"
              title="Return to all claims overview"
            >
              <ArrowRight className="h-3.5 w-3.5 rotate-180" />
              All claims
            </Button>
          )}

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-base font-bold text-ink sm:text-lg">
                {claimNumber || (claimId ? `${claimId.slice(0, 13)}…` : "Unknown Claim")}
              </span>
              <button
                type="button"
                onClick={copyClaimNumber}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-tiny font-medium text-ink-3 hover:bg-ground hover:text-ink cursor-pointer"
                title="Copy claim identifier"
              >
                {copied ? <Check className="h-3 w-3 text-leaf-600" /> : <Copy className="h-3 w-3" />}
                <span>{copied ? "Copied" : "Copy"}</span>
              </button>
              <ClaimStatusPill status={currentStatus} />
            </div>
            <p className="mt-0.5 text-tiny text-ink-3">
              Full lifecycle change trail • {totalSteps} recorded status transition{totalSteps === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Order direction toggle */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOrderAsc((prev) => !prev)}
            className="text-tiny font-medium"
            title="Toggle chronological vs reverse chronological order"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            {orderAsc ? "Oldest first (Lifecycle)" : "Newest first"}
          </Button>

          {claimId && (
            <Button
              variant="peacock"
              size="sm"
              onClick={() => navigate(`/claims/${claimId}`)}
              className="gap-1.5"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open claim file
            </Button>
          )}
        </div>
      </div>

      {/* Metrics Bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
          <div className="text-tiny font-medium text-ink-3">Current Status</div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="text-sm font-bold text-ink">{humanize(currentStatus)}</span>
          </div>
          <div className="figures mt-0.5 text-[11px] text-ink-4">
            {latestEvent ? formatRelative(latestEvent.timestamp) : "—"}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
          <div className="text-tiny font-medium text-ink-3">Total Transitions</div>
          <div className="figures mt-1 text-base font-bold text-ink sm:text-lg">
            {totalSteps} step{totalSteps === 1 ? "" : "s"}
          </div>
          <div className="text-[11px] text-ink-4">Recorded in audit log</div>
        </div>

        <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
          <div className="text-tiny font-medium text-ink-3">Lifecycle Turnaround</div>
          <div className="figures mt-1 text-base font-bold text-peacock-700 sm:text-lg">
            {formattedTotalDuration}
          </div>
          <div className="text-[11px] text-ink-4">Inception to latest action</div>
        </div>

        <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
          <div className="text-tiny font-medium text-ink-3">Audit Verification</div>
          <div className="mt-1 flex items-center gap-1.5 text-sm font-bold text-leaf-700">
            <CheckCircle2 className="h-4 w-4" />
            <span>Immutable</span>
          </div>
          <div className="text-[11px] text-ink-4">IRDAI compliant log</div>
        </div>
      </div>

      {/* Visual Lifecycle Stepper Timeline */}
      <section
        className="overflow-hidden rounded-card border border-line bg-surface shadow-card"
        aria-label="Claim Change Process Timeline"
      >
        <div className="flex flex-col gap-1 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-body font-semibold text-ink">
              End-to-end change process
            </h3>
            <p className="text-small text-ink-3">
              Step-by-step chronology of every state shift, trigger note, and responsible party.
            </p>
          </div>
          <div className="text-tiny font-medium text-ink-3">
            Showing {displayEvents.length} transition{displayEvents.length === 1 ? "" : "s"} (
            {orderAsc ? "Chronological" : "Latest first"})
          </div>
        </div>

        <div className="p-5 sm:p-6">
          {displayEvents.length === 0 ? (
            <div className="py-8 text-center text-small text-ink-3">
              No change events found for this claim ID.
            </div>
          ) : (
            <ol className="relative" aria-label={`Timeline of claim ${claimNumber || claimId}`}>
              {displayEvents.map((event, idx) => {
                // Calculate elapsed from previous step
                let elapsedFromPrev = null
                let elapsedFromStart = null

                if (orderAsc) {
                  if (idx > 0) {
                    const prevTime = new Date(displayEvents[idx - 1].timestamp).getTime()
                    const currTime = new Date(event.timestamp).getTime()
                    elapsedFromPrev = formatDurationMs(currTime - prevTime)
                  }
                  if (idx > 0 && firstEvent) {
                    const startTime = new Date(firstEvent.timestamp).getTime()
                    const currTime = new Date(event.timestamp).getTime()
                    elapsedFromStart = formatDurationMs(currTime - startTime)
                  }
                } else {
                  // In reverse order, previous in timeline is idx + 1
                  if (idx < displayEvents.length - 1) {
                    const prevInTime = new Date(displayEvents[idx + 1].timestamp).getTime()
                    const currTime = new Date(event.timestamp).getTime()
                    elapsedFromPrev = formatDurationMs(currTime - prevInTime)
                  }
                }

                const isLatest = event === latestEvent

                return (
                  <ProcessStepNode
                    key={idx}
                    step={event}
                    index={idx}
                    total={displayEvents.length}
                    isLatest={isLatest}
                    elapsedFromPrev={elapsedFromPrev}
                    elapsedFromStart={elapsedFromStart}
                    orderAsc={orderAsc}
                  />
                )
              })}
            </ol>
          )}
        </div>

        {/* Adjudication overrides section if available from full trace */}
        {fullTrace?.adjudication_overrides?.length > 0 && (
          <div className="border-t border-line bg-ground/40 p-5">
            <div className="flex items-center gap-2 font-semibold text-ink">
              <ShieldAlert className="h-4 w-4 text-marigold-600" />
              <span>Adjudication Line Overrides ({fullTrace.adjudication_overrides.length})</span>
            </div>
            <p className="mt-0.5 text-tiny text-ink-3">
              Manual adjustor overrides recorded during adjudication on this claim.
            </p>
            <div className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
              {fullTrace.adjudication_overrides.map((ov, oIdx) => (
                <div key={oIdx} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <span className="font-semibold text-ink text-sm">{ov.item_name}</span>
                    <div className="flex items-center gap-2 text-tiny text-ink-3">
                      <span>AI: {humanize(ov.ai_status)}</span>
                      <ArrowRight className="h-3 w-3" />
                      <span className="font-semibold text-ink-2">Final: {humanize(ov.final_status)}</span>
                    </div>
                  </div>
                  <div className="rounded bg-ground px-2 py-1 text-tiny text-ink-2">
                    {ov.override_note || ov.override_reason || "Manual adjuster signoff"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * Claim Lifecycle Summary Card used in the grouped process view
 */
function ClaimSummaryCard({
  claimNumber,
  claimId,
  events,
  onInspect,
  expanded,
  onToggleExpand,
}) {
  const navigate = useNavigate()
  // Sort events chronologically to extract journey path
  const chronEvents = useMemo(() => {
    return [...events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
  }, [events])

  const firstEvent = chronEvents[0]
  const latestEvent = chronEvents[chronEvents.length - 1]
  const currentStatus = latestEvent?.to_status || "unknown"

  const durationMs =
    firstEvent && latestEvent
      ? new Date(latestEvent.timestamp).getTime() - new Date(firstEvent.timestamp).getTime()
      : 0
  const durationText = formatDurationMs(durationMs) || "< 1m"

  // Status sequence path: e.g. ["draft", "submitted", "escalated", "in_review"]
  const statusPath = useMemo(() => {
    const list = []
    chronEvents.forEach((e) => {
      if (e.from_status && list.length === 0) list.push(e.from_status)
      if (e.to_status && list[list.length - 1] !== e.to_status) {
        list.push(e.to_status)
      }
    })
    return list.length ? list : [currentStatus]
  }, [chronEvents, currentStatus])

  return (
    <div className="group rounded-card border border-line bg-surface shadow-card transition-all hover:border-peacock-300 hover:shadow-raised">
      <div className="p-5">
        {/* Top header: claim number, status, turnaround */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-base font-bold text-ink">
                {claimNumber || `${claimId?.slice(0, 13)}…`}
              </span>
              <ClaimStatusPill status={currentStatus} />
              <Badge variant="outline" className="font-mono text-tiny">
                {events.length} change{events.length === 1 ? "" : "s"}
              </Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-tiny text-ink-3">
              <span>Span: <strong className="font-medium text-ink-2">{durationText}</strong></span>
              <span>•</span>
              <span>Latest: <strong className="font-medium text-ink-2">{formatRelative(latestEvent?.timestamp)}</strong></span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="peacock"
              size="sm"
              onClick={() => onInspect({ claimId, claimNumber, events })}
              className="gap-1 text-tiny font-semibold"
            >
              <span>View full process</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>

            <button
              type="button"
              onClick={onToggleExpand}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink-3 hover:bg-ground hover:text-ink cursor-pointer"
              title={expanded ? "Collapse inline preview" : "Expand inline preview"}
            >
              <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
            </button>
          </div>
        </div>

        {/* Process journey pipeline / metro path */}
        <div className="mt-4 rounded-xl bg-ground/70 p-3">
          <div className="text-tiny font-semibold uppercase tracking-wider text-ink-4">
            Change Pipeline Progression:
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {statusPath.map((st, i) => (
              <div key={i} className="flex items-center gap-2">
                <Badge
                  variant={i === statusPath.length - 1 ? "peacock" : "outline"}
                  className={cn(
                    "font-semibold text-tiny",
                    i === statusPath.length - 1 && "ring-1 ring-peacock-600"
                  )}
                >
                  {humanize(st)}
                </Badge>
                {i < statusPath.length - 1 && (
                  <ArrowRight className="h-3 w-3 text-ink-4 shrink-0" />
                )}
              </div>
            ))}
          </div>

          {/* Latest note highlight */}
          {latestEvent?.note && (
            <div className="mt-2.5 flex items-start gap-1.5 text-tiny text-ink-2">
              <span className="font-semibold text-ink-3 shrink-0">Latest Note:</span>
              <span className="italic line-clamp-1">"{latestEvent.note}"</span>
            </div>
          )}
        </div>
      </div>

      {/* Expandable Inline Timeline Drawer */}
      {expanded && (
        <div className="border-t border-line bg-surface/50 p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-small font-semibold text-ink">
              Chronological transition log ({chronEvents.length})
            </span>
            <button
              type="button"
              onClick={() => onInspect({ claimId, claimNumber, events })}
              className="text-tiny font-semibold text-peacock-700 hover:underline cursor-pointer"
            >
              Open dedicated inspector →
            </button>
          </div>
          <ol className="space-y-3">
            {chronEvents.map((ev, i) => (
              <li key={i} className="flex items-start gap-3 rounded-lg border border-line/60 bg-ground/50 p-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-peacock-100 font-mono text-tiny font-bold text-peacock-800">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5">
                      {ev.from_status && (
                        <>
                          <span className="font-semibold text-ink-3 text-tiny">{humanize(ev.from_status)}</span>
                          <ArrowRight className="h-3 w-3 text-ink-4" />
                        </>
                      )}
                      <span className="font-bold text-ink text-tiny">{humanize(ev.to_status)}</span>
                    </div>
                    <span className="figures text-tiny text-ink-4">{formatDateTime(ev.timestamp)}</span>
                  </div>
                  <p className="mt-1 text-small text-ink-2">{ev.note || "System event"}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

/**
 * Main Audit Trail Controller supporting:
 * - Grouped Claim Process view
 * - Single Claim deep-dive process view
 * - Quick Claim Filter chips & Search
 * - Switch between Lifecycle and Flat log
 */
export function ClaimProcessAuditTrail({
  auditEntries = [],
  auditTotal = 0,
  loading = false,
  selectedClaimId,
  onSelectClaimId,
}) {
  const [searchQuery, setSearchQuery] = useState("")
  const [expandedCards, setExpandedCards] = useState({})

  // Group all auditEntries by unique claim ID or claim number
  const claimsMap = useMemo(() => {
    const map = new Map()
    auditEntries.forEach((entry) => {
      const key = entry.claim_id || entry.claim_number || "unknown"
      if (!map.has(key)) {
        map.set(key, {
          claimId: entry.claim_id,
          claimNumber: entry.claim_number,
          events: [],
        })
      }
      map.get(key).events.push(entry)
    })
    return map
  }, [auditEntries])

  // Convert to sorted list of claims (most recently active claim first)
  const uniqueClaimsList = useMemo(() => {
    const list = Array.from(claimsMap.values()).map((c) => {
      const sortedEvents = [...c.events].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      return {
        ...c,
        latestTimestamp: sortedEvents[0]?.timestamp || "",
        latestStatus: sortedEvents[0]?.to_status || "",
        events: sortedEvents,
      }
    })

    return list.sort(
      (a, b) => new Date(b.latestTimestamp).getTime() - new Date(a.latestTimestamp).getTime()
    )
  }, [claimsMap])

  // Filtered claims based on search query
  const filteredClaims = useMemo(() => {
    if (!searchQuery.trim()) return uniqueClaimsList
    const q = searchQuery.toLowerCase().trim()
    return uniqueClaimsList.filter(
      (c) =>
        (c.claimNumber && c.claimNumber.toLowerCase().includes(q)) ||
        (c.claimId && c.claimId.toLowerCase().includes(q)) ||
        c.events.some((e) => e.note && e.note.toLowerCase().includes(q))
    )
  }, [uniqueClaimsList, searchQuery])

  // If a claim is actively selected, find its data
  const activeSelectedClaim = useMemo(() => {
    if (!selectedClaimId) return null
    return (
      uniqueClaimsList.find(
        (c) => c.claimId === selectedClaimId || c.claimNumber === selectedClaimId
      ) || null
    )
  }, [selectedClaimId, uniqueClaimsList])

  const toggleCardExpanded = (key) => {
    setExpandedCards((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  // If a single claim is selected, show its full change process
  if (activeSelectedClaim) {
    return (
      <SingleClaimProcessView
        claimId={activeSelectedClaim.claimId}
        claimNumber={activeSelectedClaim.claimNumber}
        events={activeSelectedClaim.events}
        onBack={() => onSelectClaimId(null)}
        onSelectClaim={(c) => onSelectClaimId(c.claimId || c.claimNumber)}
      />
    )
  }

  return (
    <div className="space-y-5">
      {/* Search and claim count bar */}
      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-4" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by Claim ID or note (e.g. DP-20261010-176118)..."
            className="h-9 w-full rounded-lg border border-line bg-ground/50 pl-9 pr-8 text-small text-ink placeholder:text-ink-4 focus:border-peacock-500 focus:bg-surface focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-4 hover:text-ink cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <span className="text-small font-semibold text-ink-3">
          {filteredClaims.length} unique claim{filteredClaims.length === 1 ? "" : "s"} tracked
        </span>
      </div>

      {/* Quick Claim selector chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-tiny font-bold uppercase tracking-wider text-ink-4">
          Quick select claim:
        </span>
        <button
          type="button"
          onClick={() => {
            onSelectClaimId(null)
            setSearchQuery("")
          }}
          className={cn(
            "rounded-full px-2.5 py-1 text-tiny font-semibold transition-colors cursor-pointer",
            !selectedClaimId && !searchQuery
              ? "bg-peacock-700 text-white"
              : "border border-line bg-surface text-ink-2 hover:bg-ground"
          )}
        >
          All Claims ({uniqueClaimsList.length})
        </button>

        {uniqueClaimsList.map((c) => (
          <button
            key={c.claimId || c.claimNumber}
            type="button"
            onClick={() => onSelectClaimId(c.claimId || c.claimNumber)}
            className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-tiny font-mono font-medium text-ink-2 transition-colors hover:border-peacock-400 hover:text-peacock-700 cursor-pointer"
            title={`View change process for ${c.claimNumber}`}
          >
            <span>{c.claimNumber || `${c.claimId?.slice(0, 10)}…`}</span>
            <span className="rounded-full bg-ground px-1.5 py-0.2 text-[10px] font-sans font-bold text-ink-3">
              {c.events.length}
            </span>
          </button>
        ))}
      </div>

      {/* Claim Journeys List */}
      <div className="space-y-4">
        {filteredClaims.length === 0 ? (
          <div className="rounded-card border border-line bg-surface p-8 text-center text-small text-ink-3 shadow-card">
            No claims match "{searchQuery}". Try clearing your search.
          </div>
        ) : (
          filteredClaims.map((claim) => {
            const cardKey = claim.claimId || claim.claimNumber
            return (
              <ClaimSummaryCard
                key={cardKey}
                claimNumber={claim.claimNumber}
                claimId={claim.claimId}
                events={claim.events}
                onInspect={() => onSelectClaimId(claim.claimId || claim.claimNumber)}
                expanded={!!expandedCards[cardKey]}
                onToggleExpand={() => toggleCardExpanded(cardKey)}
              />
            )
          })
        )}
      </div>
    </div>
  )
}
