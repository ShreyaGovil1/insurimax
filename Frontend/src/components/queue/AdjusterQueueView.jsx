import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowRight, Inbox, MessageCircleQuestion, Plus, RefreshCw, Search, ShieldAlert, SkipForward, Sparkles } from "lucide-react"
import { useNavigate, useOutletContext } from "react-router-dom"
import { api } from "../../services/api"
import { useAuth } from "../../context/AuthContext"
import { calculateSLARemaining, cn, formatCurrencyINR, formatRelative, greeting } from "../../lib/utils"
import { useNow } from "../../hooks/useNow"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { TabBar } from "../ui/tab-bar"
import { EmptyState } from "../ui/empty-state"
import { Skeleton } from "../ui/skeleton"
import { useToast } from "../ui/toast"
import { ClaimStatusPill } from "../common/status"
import { MiniJourney } from "../common/JourneyRail"
import { ClaimsTable, Panel } from "../claims/ClaimsTable"

const IN_REVIEW = ["in_review", "submitted", "adjudication_in_progress"]
const APPROVED = ["auto_approved", "approved"]
const WITH_INSURER = ["submitted", "in_review", "documents_pending", "extraction_in_progress", "adjudication_in_progress", "auto_approved", "approved", "partially_approved"]
const ADJUSTER_ACTION = ["submitted", "in_review", "documents_pending", "extraction_in_progress", "adjudication_in_progress"]

const isFlagged = (c) => Boolean(c.has_identity_mismatch || (c.flagged_items_count && c.flagged_items_count > 0))
const minutesLeft = (c) => (c.sla_deadline ? (new Date(c.sla_deadline).getTime() - Date.now()) / 60000 : Infinity)
const isUrgent = (c) => c.sla_breached || minutesLeft(c) < 30

export function AdjusterQueueView({ onSelectClaim }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const outlet = useOutletContext() || {}
  const isHospital = user?.role === "hospital_desk"
  useNow(60000)

  const [claims, setClaims] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [statusFilter, setStatusFilter] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [skipped, setSkipped] = useState([])

  const loadData = useCallback(async () => {
    try {
      // One queue for everything: it already includes unassigned claims
      const [queueData, statsData] = await Promise.all([api.queue.getQueue(), api.queue.getStats().catch(() => null)])
      setClaims(queueData || [])
      setStats(statsData)
      setUpdatedAt(new Date().toISOString())
    } catch (err) {
      toast({ title: "Couldn't refresh the queue", description: err.message || "Failed to load claims queue", variant: "warning" })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [toast])

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 30000)
    return () => clearInterval(interval)
  }, [loadData, user])

  const refresh = () => {
    setRefreshing(true)
    loadData()
  }

  const open = (claim, tab) => {
    onSelectClaim?.(claim.id)
    navigate(tab ? `/claims/${claim.id}/${tab}` : `/claims/${claim.id}`)
  }

  const counts = useMemo(
    () => ({
      all: claims.length,
      in_review: claims.filter((c) => IN_REVIEW.includes(c.status)).length,
      auto_approved: claims.filter((c) => APPROVED.includes(c.status)).length,
      mismatch: claims.filter(isFlagged).length,
      draft: claims.filter((c) => c.status === "draft").length,
      with_insurer: claims.filter((c) => WITH_INSURER.includes(c.status)).length,
      queried: claims.filter((c) => c.status === "queried").length,
      urgent: claims.filter((c) => c.status !== "draft" && isUrgent(c)).length,
    }),
    [claims]
  )

  const filters = isHospital
    ? [
        { value: "all", label: "All", count: counts.all },
        { value: "draft", label: "Drafts", count: counts.draft },
        { value: "queried", label: "Query open", count: counts.queried, attention: counts.queried > 0 },
        { value: "with_insurer", label: "With insurer", count: counts.with_insurer },
      ]
    : [
        { value: "all", label: "All cases", count: counts.all },
        { value: "in_review", label: "In review", count: counts.in_review },
        { value: "auto_approved", label: "Auto-approved", count: counts.auto_approved },
        { value: "mismatch", label: "Flagged", count: counts.mismatch, attention: counts.mismatch > 0 },
      ]

  const filteredClaims = claims.filter((c) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      const matches =
        c.patient_name?.toLowerCase().includes(q) ||
        c.claim_number?.toLowerCase().includes(q) ||
        c.hospital_name?.toLowerCase().includes(q)
      if (!matches) return false
    }
    switch (statusFilter) {
      case "in_review":
        return IN_REVIEW.includes(c.status)
      case "auto_approved":
        return APPROVED.includes(c.status)
      case "mismatch":
        return isFlagged(c)
      case "draft":
        return c.status === "draft"
      case "queried":
        return c.status === "queried"
      case "with_insurer":
        return WITH_INSURER.includes(c.status)
      default:
        return true
    }
  })

  // The single claim to work on next: nearest deadline that is waiting on this user
  const candidates = claims.filter((c) =>
    isHospital ? c.status === "draft" || c.status === "queried" : ADJUSTER_ACTION.includes(c.status) || c.has_identity_mismatch
  )
  const remaining = candidates.filter((c) => !skipped.includes(c.id))
  const upNext = remaining[0] || null

  const firstName = user?.full_name?.split(" ")[0] || "there"
  const summary = isHospital
    ? `${counts.draft} draft${counts.draft === 1 ? "" : "s"} to finish, ${counts.queried} quer${counts.queried === 1 ? "y" : "ies"} from insurers, ${counts.with_insurer} with insurers.`
    : counts.all === 0
      ? "Your queue is clear."
      : `${counts.all} claim${counts.all === 1 ? "" : "s"} in your queue${counts.urgent ? `, ${counts.urgent} inside the last 30 minutes of SLA.` : ". Every SLA is in the safe zone."}`

  return (
    <div className="mx-auto max-w-[1360px] space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      {/* Greeting */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[30px]">
            {greeting()}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-ink-3">{loading ? "Loading your queue…" : summary}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-small text-ink-3" aria-live="polite">
            {updatedAt ? `Updated ${formatRelative(updatedAt)}` : ""}
          </span>
          <Button variant="secondary" size="sm" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Up next */}
      {loading ? (
        <Skeleton className="h-[148px] rounded-card" />
      ) : upNext ? (
        <UpNextCard
          key={upNext.id}
          claim={upNext}
          isHospital={isHospital}
          position={candidates.length - remaining.length + 1}
          total={candidates.length}
          onOpen={open}
          onSkip={remaining.length > 1 ? () => setSkipped((s) => [...s, upNext.id]) : null}
          onResetSkips={skipped.length ? () => setSkipped([]) : null}
        />
      ) : (
        <ClearCard isHospital={isHospital} onNewClaim={outlet.openCreateClaim} onResetSkips={skipped.length ? () => setSkipped([]) : null} />
      )}

      {/* Today */}
      <TodayStrip stats={stats} counts={counts} isHospital={isHospital} loading={loading} />

      {/* Queue */}
      <Panel>
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="shrink-0 text-body font-semibold text-ink">{isHospital ? "Your claims" : "Queue"}</h2>
            <TabBar variant="segmented" size="sm" tabs={filters} value={statusFilter} onChange={setStatusFilter} ariaLabel="Filter claims" />
          </div>
          <div className="relative w-full lg:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <Input
              type="search"
              placeholder="Search patient, hospital, claim no."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 pl-9"
              aria-label="Search claims"
            />
          </div>
        </div>

        <ClaimsTable
          claims={filteredClaims}
          loading={loading}
          onOpen={(c) => open(c)}
          variant="queue"
          threshold={stats?.auto_approval_confidence_threshold}
          empty={
            claims.length === 0 ? (
              <EmptyState
                icon={Inbox}
                tone="positive"
                title={isHospital ? "No claims in progress" : "Queue clear"}
                description={
                  isHospital
                    ? "Start a cashless claim for a patient being discharged. It stays a draft until you submit it."
                    : "New claims land here as hospitals submit them, sorted by the time left on their SLA."
                }
                action={
                  isHospital && outlet.openCreateClaim ? (
                    <Button variant="proceed" onClick={outlet.openCreateClaim}>
                      <Plus className="h-4 w-4" />
                      New claim
                    </Button>
                  ) : null
                }
              />
            ) : (
              <EmptyState
                icon={Search}
                title="No claims match"
                description="Try another name or claim number, or clear the filters."
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setSearchQuery("")
                      setStatusFilter("all")
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            )
          }
        />
      </Panel>
    </div>
  )
}

function UpNextCard({ claim, isHospital, position, total, onOpen, onSkip, onResetSkips }) {
  const sla = calculateSLARemaining(claim.sla_deadline)
  const breached = claim.sla_breached || sla.isBreached
  const draft = claim.status === "draft"
  const queried = claim.status === "queried"

  let headline
  let action
  let tab
  if (isHospital) {
    headline = draft ? "Finish this draft and send it to the insurer" : "The insurer is waiting on your answer"
    action = draft ? "Continue draft" : "Answer query"
    tab = draft ? "documents" : "queries"
  } else if (claim.has_identity_mismatch) {
    headline = "The bill's patient name doesn't match the claimant"
    action = "Investigate"
  } else if (!claim.ai_confidence_score) {
    headline = "Run AI adjudication and review the decision"
    action = "Start review"
  } else if (claim.flagged_items_count > 0) {
    headline = `AI flagged ${claim.flagged_items_count} line item${claim.flagged_items_count === 1 ? "" : "s"} for you to check`
    action = "Start review"
  } else {
    headline = "AI decision ready: confirm and lock it"
    action = "Start review"
  }

  const minutes = sla.remainingMinutes
  const left = minutes == null ? null : Math.max(0, minutes)
  const big = breached ? `${Math.abs(minutes ?? 0)}m` : left == null ? "—" : left >= 60 ? `${Math.floor(left / 60)}h ${left % 60}m` : `${left}m`
  const fraction = breached || left == null ? 0 : Math.min(1, left / 180)

  return (
    <section className="animate-rise overflow-hidden rounded-card bg-surface shadow-raised" aria-label="Up next">
      <div className="grid md:grid-cols-[220px_1fr]">
        {/* Clock */}
        <div
          className={cn(
            "flex flex-row items-center justify-between gap-4 px-5 py-4 md:flex-col md:items-start md:justify-center md:py-6",
            breached ? "bg-vermilion-600 text-white" : sla.isUrgent ? "bg-marigold-400 text-ink" : draft ? "bg-sunken text-ink" : "bg-peacock-700 text-white"
          )}
        >
          <div>
            <div className={cn("text-small font-semibold", breached || (!sla.isUrgent && !draft) ? "text-white/80" : "text-ink-2")}>
              {draft ? "SLA not started" : breached ? "SLA breached by" : "SLA left"}
            </div>
            <div className="figures mt-0.5 text-[34px] font-semibold leading-none tracking-[-0.03em] [font-stretch:92%]">
              {draft ? "Draft" : big}
            </div>
          </div>
          {!draft && (
            <div className="w-28 md:w-full">
              <div className={cn("h-1.5 overflow-hidden rounded-full", breached || !sla.isUrgent ? "bg-white/20" : "bg-ink/15")}>
                <div
                  className={cn("h-full origin-left rounded-full", breached ? "bg-white" : sla.isUrgent ? "bg-ink" : "bg-marigold-400")}
                  style={{ transform: `scaleX(${breached ? 1 : fraction})` }}
                />
              </div>
              <div className={cn("mt-1.5 text-tiny", breached || !sla.isUrgent ? "text-white/70" : "text-ink-2")}>of the 3-hour window</div>
            </div>
          )}
        </div>

        {/* Claim */}
        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-small font-semibold text-ink-3">
              <span className="inline-flex items-center gap-1.5 text-marigold-700">
                <span className="h-1.5 w-1.5 rounded-full bg-marigold-500" />
                Up next{total > 1 ? ` · ${position} of ${total}` : ""}
              </span>
              <span className="font-mono font-normal">{claim.claim_number}</span>
              <ClaimStatusPill status={claim.status} />
            </div>
            <div className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">{claim.patient_name}</div>
            <p className="flex items-center gap-1.5 text-sm text-ink-2">
              {claim.has_identity_mismatch ? (
                <ShieldAlert className="h-4 w-4 text-vermilion-600" />
              ) : queried ? (
                <MessageCircleQuestion className="h-4 w-4 text-sand-600" />
              ) : (
                <Sparkles className="h-4 w-4 text-peacock-500" />
              )}
              {headline}
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-small text-ink-3">
              <span className="truncate">{claim.hospital_name}</span>
              <span className="figures font-semibold text-ink-2">{formatCurrencyINR(claim.billed_amount)} billed</span>
              <MiniJourney status={claim.status} className="w-32" showLabel={false} />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onSkip ? (
              <Button variant="ghost" onClick={onSkip} title="Show the next claim instead">
                <SkipForward className="h-4 w-4" />
                Skip
              </Button>
            ) : onResetSkips ? (
              <Button variant="ghost" onClick={onResetSkips}>
                Back to first
              </Button>
            ) : null}
            <Button variant="proceed" size="lg" onClick={() => onOpen(claim, tab)} className="group">
              {action}
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

function ClearCard({ isHospital, onNewClaim, onResetSkips }) {
  return (
    <section className="flex flex-col items-start gap-4 rounded-card bg-surface p-5 shadow-card sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-leaf-50 text-leaf-600">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <div className="text-body font-semibold text-ink">{isHospital ? "Nothing is waiting on you" : "Nothing needs your decision right now"}</div>
          <p className="text-small text-ink-3">
            {isHospital
              ? "Drafts you start and queries from insurers will show up here first."
              : "Claims that need a review will surface here, most urgent first."}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        {onResetSkips && (
          <Button variant="secondary" onClick={onResetSkips}>
            Show skipped claims
          </Button>
        )}
        {isHospital && onNewClaim && (
          <Button variant="proceed" onClick={onNewClaim}>
            <Plus className="h-4 w-4" />
            New claim
          </Button>
        )}
      </div>
    </section>
  )
}

function TodayStrip({ stats, counts, isHospital, loading }) {
  const items = isHospital
    ? [
        { label: "Drafts to finish", value: counts.draft, hint: "Not visible to insurers yet" },
        { label: "Queries waiting", value: counts.queried, hint: "Insurer asked for clarification", alert: counts.queried > 0 },
        { label: "With insurers", value: counts.with_insurer, hint: "SLA clock running" },
        {
          label: "Avg. turnaround today",
          value: stats?.avg_turnaround_minutes != null ? `${stats.avg_turnaround_minutes} min` : "—",
          hint: "Submission to decision",
        },
      ]
    : [
        {
          label: "Avg. turnaround today",
          value: stats?.avg_turnaround_minutes != null ? `${stats.avg_turnaround_minutes} min` : "—",
          hint: stats?.avg_turnaround_minutes != null ? "Submission to decision" : "None finalized yet",
        },
        {
          label: "Deductions found today",
          value: formatCurrencyINR(stats?.deductions_identified_today_inr || 0),
          hint: "Non-payables, sub-limit excess and exclusions",
        },
        {
          label: "AI agreement",
          value: stats?.ai_agreement_rate != null ? `${stats.ai_agreement_rate}%` : "—",
          hint: stats?.ai_line_items_reviewed
            ? `${stats.ai_line_items_reviewed - stats.ai_overrides} of ${stats.ai_line_items_reviewed} AI decisions kept · ${stats.ai_agreement_window_days} days`
            : "No AI line decisions in the last 30 days",
        },
        {
          label: "Finalized today",
          value: `${stats?.finalized_today ?? 0} ${stats?.finalized_today === 1 ? "claim" : "claims"}`,
          hint: stats
            ? `Auto-approval at ≥ ${Math.round(stats.auto_approval_confidence_threshold * 100)}% and ≤ ${formatCurrencyINR(stats.auto_approval_max_amount_inr)}`
            : "Locked decisions",
        },
      ]

  return (
    <section aria-label="Today" className="grid grid-cols-2 overflow-hidden rounded-card bg-surface shadow-card lg:grid-cols-4">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={cn(
            "p-4 sm:p-5",
            i % 2 === 1 && "border-l border-line",
            i >= 2 && "border-t border-line lg:border-t-0",
            i === 2 && "lg:border-l"
          )}
        >
          <div className="text-small font-medium text-ink-3">{item.label}</div>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-24" />
          ) : (
            <div className={cn("figures mt-1 text-[22px] font-semibold tracking-[-0.02em]", item.alert ? "text-marigold-700" : "text-ink")}>
              {item.value}
            </div>
          )}
          <div className="mt-0.5 text-tiny text-ink-3">{item.hint}</div>
        </div>
      ))}
    </section>
  )
}
