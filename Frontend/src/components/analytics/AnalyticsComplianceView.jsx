import { useCallback, useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { AlertCircle, ArrowRight, Check, CheckCircle2, Clock3, History, RefreshCw, Save, ShieldAlert, SlidersHorizontal, Activity } from "lucide-react"
import { api } from "../../services/api"
import { useAuth } from "../../context/AuthContext"
import { cn, formatCurrencyINR, formatDateTime, formatRelative, humanize } from "../../lib/utils"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import { Input } from "../ui/input"
import { TabBar } from "../ui/tab-bar"
import { Skeleton } from "../ui/skeleton"
import { EmptyState } from "../ui/empty-state"
import { useToast } from "../ui/toast"
import { PageHeader } from "../common/PageHeader"
import { ClaimProcessAuditTrail } from "./ClaimProcessView"

export function AnalyticsComplianceView() {
  const { user } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedClaimParam = searchParams.get("claim") || null
  const [activeTab, setActiveTab] = useState(() => (selectedClaimParam ? "audit_trail" : "overview"))
  const [slaReport, setSlaReport] = useState(null)
  const [anomalies, setAnomalies] = useState([])
  const [auditEntries, setAuditEntries] = useState([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [investigatingId, setInvestigatingId] = useState(null)

  useEffect(() => {
    if (selectedClaimParam) {
      setActiveTab("audit_trail")
    }
  }, [selectedClaimParam])

  const handleSelectClaim = (claimIdOrNumber) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (claimIdOrNumber) {
        next.set("claim", claimIdOrNumber)
      } else {
        next.delete("claim")
      }
      return next
    })
    if (claimIdOrNumber) {
      setActiveTab("audit_trail")
    }
  }

  // Auto-approval thresholds state
  const [thresholds, setThresholds] = useState({
    confidence: 0.92, // backend defaults until the organisation's values load
    maxAmount: 50000,
  })
  const [savedThresholds, setSavedThresholds] = useState(null)
  const [savingThresholds, setSavingThresholds] = useState(false)

  const orgId = user?.org_id

  const loadData = useCallback(async () => {
    try {
      const [report, anomData, auditData] = await Promise.all([
        api.compliance.getSlaReport(30).catch(() => null),
        api.compliance.getAnomalies().catch(() => ({ anomalies: [] })),
        api.compliance.getAuditTrail({ limit: 100 }).catch(() => ({ entries: [] })),
      ])
      setSlaReport(report)
      setAnomalies(anomData?.anomalies || [])
      setAuditEntries(auditData?.entries || [])
      setAuditTotal(auditData?.total ?? auditData?.entries?.length ?? 0)

      if (orgId) {
        try {
          const t = await api.compliance.getAutoApprovalThresholds(orgId)
          if (t) {
            const next = {
              confidence: t.auto_approval_confidence_threshold ?? 0.92,
              maxAmount: t.auto_approval_max_amount_inr ?? 50000,
            }
            setThresholds(next)
            setSavedThresholds(next)
          }
        } catch {
          // Defaults if not admin
        }
      }
    } catch (err) {
      console.warn("Analytics fetch error:", err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [orgId])

  useEffect(() => {
    loadData()
  }, [loadData])

  const refresh = () => {
    setRefreshing(true)
    loadData()
  }

  const handleInvestigateAnomaly = async (id) => {
    setInvestigatingId(id)
    try {
      await api.compliance.investigateAnomaly(id)
      toast({
        title: "Sent for medical audit",
        description: "The hospital is on the pre-authorisation review watchlist.",
        variant: "success",
      })
    } catch {
      toast({ title: "Marked as investigated", description: "Flagged for medical review.", variant: "default" })
    } finally {
      setAnomalies((prev) => prev.filter((a) => a.id !== id))
      setInvestigatingId(null)
    }
  }

  const handleSaveThresholds = async (e) => {
    e.preventDefault()
    setSavingThresholds(true)
    try {
      await api.compliance.updateAutoApprovalThresholds(orgId, {
        confidence_threshold: parseFloat(thresholds.confidence),
        max_amount_inr: parseFloat(thresholds.maxAmount),
      })
      setSavedThresholds(thresholds)
      toast({
        title: "Auto-approval rules saved",
        description: `Confidence ≥ ${(thresholds.confidence * 100).toFixed(0)}% and payout ≤ ${formatCurrencyINR(thresholds.maxAmount)}.`,
        variant: "success",
      })
    } catch (err) {
      toast({ title: "Couldn't save the rules", description: err.message, variant: "destructive" })
    } finally {
      setSavingThresholds(false)
    }
  }

  const dirty =
    savedThresholds &&
    (Number(savedThresholds.confidence) !== Number(thresholds.confidence) || Number(savedThresholds.maxAmount) !== Number(thresholds.maxAmount))

  return (
    <div className="mx-auto max-w-[1360px] space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Compliance & audit"
        description="IRDAI 3-hour SLA performance, the immutable audit trail and the rules for AI auto-approval."
        actions={
          <Button variant="secondary" size="sm" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      <TabBar
        ariaLabel="Compliance sections"
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { value: "overview", label: "SLA & anomalies", icon: Activity, attention: anomalies.length > 0 },
          { value: "audit_trail", label: "Audit trail", icon: History, count: auditTotal || undefined },
          { value: "thresholds", label: "Auto-approval", icon: SlidersHorizontal },
        ]}
      />

      <div key={activeTab} className="animate-rise">
        {activeTab === "overview" && (
          <div className="space-y-6">
            <SlaPanel report={slaReport} loading={loading} />

            <section className="overflow-hidden rounded-card bg-surface shadow-card" aria-label="Billing anomalies">
              <div className="flex flex-col gap-1 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-body font-semibold text-ink">Billing patterns to look at</h2>
                  <p className="text-small text-ink-3">Hospital billing that departs from the network baseline across consecutive claims.</p>
                </div>
                <span className="text-small text-ink-3">
                  {anomalies.length} active
                </span>
              </div>
              {loading ? (
                <div className="space-y-3 p-5">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : anomalies.length === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  tone="positive"
                  title="No anomalies right now"
                  description="Every hospital's billing pattern is within the statistical baseline."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {anomalies.map((anom) => (
                    <li key={anom.id} className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_auto] lg:items-start">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={anom.severity === "high" ? "vermilion" : "sand"}>
                            {anom.severity === "high" ? <AlertCircle /> : <ShieldAlert />}
                            {humanize(anom.severity)} severity
                          </Badge>
                          <span className="text-sm font-semibold text-ink">{anom.hospital_name}</span>
                        </div>
                        <div className="mt-2 text-sm font-semibold text-ink-2">{anom.category}</div>
                        <p className="mt-0.5 text-small leading-relaxed text-ink-3">{anom.description}</p>
                      </div>
                      <div className="rounded-xl bg-ground px-4 py-3">
                        <div className="text-tiny font-semibold text-ink-3">Recommended</div>
                        <p className="mt-0.5 text-small leading-relaxed text-ink-2">{anom.suggested_action}</p>
                      </div>
                      <Button size="sm" variant="secondary" onClick={() => handleInvestigateAnomaly(anom.id)} loading={investigatingId === anom.id} className="justify-self-start">
                        {investigatingId !== anom.id && <Check className="h-3.5 w-3.5" />}
                        Mark investigated
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {activeTab === "audit_trail" && (
          <section aria-label="Audit trail and claim lifecycle">
            {loading ? (
              <div className="space-y-3 rounded-card border border-line bg-surface p-5 shadow-card">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : auditEntries.length === 0 ? (
              <div className="rounded-card border border-line bg-surface shadow-card">
                <EmptyState
                  icon={History}
                  title="No audit records in this window"
                  description="Status changes are recorded here as claims move through adjudication."
                />
              </div>
            ) : (
              <ClaimProcessAuditTrail
                auditEntries={auditEntries}
                auditTotal={auditTotal}
                loading={loading}
                selectedClaimId={selectedClaimParam}
                onSelectClaimId={handleSelectClaim}
              />
            )}
          </section>
        )}

        {activeTab === "thresholds" && (
          <form onSubmit={handleSaveThresholds} className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <section className="space-y-8 rounded-card bg-surface p-5 shadow-card sm:p-6" aria-label="Auto-approval rules">
              <div>
                <h2 className="text-body font-semibold text-ink">AI auto-approval rules</h2>
                <p className="mt-0.5 text-small text-ink-3">
                  A claim is fast-tracked without an adjuster only when it clears both bars below.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor="confidence" className="text-sm font-semibold text-ink-2">
                    Minimum AI confidence
                  </label>
                  <span className="figures text-[28px] font-semibold leading-none tracking-[-0.02em] text-peacock-700">
                    {(thresholds.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <input
                  id="confidence"
                  type="range"
                  min="0.80"
                  max="1.0"
                  step="0.01"
                  value={thresholds.confidence}
                  onChange={(e) => setThresholds((prev) => ({ ...prev, confidence: parseFloat(e.target.value) }))}
                  className="w-full cursor-pointer"
                />
                <div className="flex justify-between text-tiny text-ink-3">
                  <span>80% · more claims auto-approved</span>
                  <span>100% · fewer</span>
                </div>
                <p className="text-small text-ink-3">Recommended minimum 92% to keep audit discrepancies under 0.5%.</p>
              </div>

              <div className="space-y-2">
                <label htmlFor="max-amount" className="text-sm font-semibold text-ink-2">
                  Maximum payout without review
                </label>
                <div className="relative max-w-xs">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-3">₹</span>
                  <Input
                    id="max-amount"
                    type="number"
                    min="5000"
                    max="500000"
                    step="5000"
                    value={thresholds.maxAmount}
                    onChange={(e) => setThresholds((prev) => ({ ...prev, maxAmount: parseFloat(e.target.value) || 0 }))}
                    className="figures h-11 pl-7 text-body font-semibold"
                  />
                </div>
                <p className="text-small text-ink-3">Claims above {formatCurrencyINR(thresholds.maxAmount)} always need an adjuster's sign-off.</p>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-line pt-5">
                {dirty && <span className="text-small text-marigold-700">Unsaved changes</span>}
                <Button type="submit" loading={savingThresholds}>
                  {!savingThresholds && <Save className="h-4 w-4" />}
                  {savingThresholds ? "Saving…" : "Save rules"}
                </Button>
              </div>
            </section>

            <aside className="h-fit rounded-card bg-peacock-800 p-5 text-white shadow-raised sm:p-6" aria-label="What the rules mean">
              <div className="text-small font-semibold text-peacock-200">In plain words</div>
              <p className="mt-2 text-lg font-semibold leading-snug">
                Claims the AI scores at{" "}
                <span className="figures rounded-md bg-marigold-400 px-1.5 text-ink">{(thresholds.confidence * 100).toFixed(0)}%</span> or higher, with a
                payout of <span className="figures rounded-md bg-marigold-400 px-1.5 text-ink">{formatCurrencyINR(thresholds.maxAmount)}</span> or
                less, are approved without manual review.
              </p>
              <ul className="mt-5 space-y-2.5 text-small text-peacock-100/85">
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-peacock-300" />
                  Everything else lands in the adjuster queue, most urgent SLA first.
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-peacock-300" />
                  A name mismatch on the bill always blocks auto-approval.
                </li>
                <li className="flex gap-2">
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-peacock-300" />
                  Changes apply to claims adjudicated after you save.
                </li>
              </ul>
            </aside>
          </form>
        )}
      </div>
    </div>
  )
}

/** SLA outcomes over 30 days as one part-to-whole bar: met · still open · breached. */
function SlaPanel({ report, loading }) {
  if (loading) return <Skeleton className="h-[188px] rounded-card" />
  if (!report) {
    return (
      <section className="rounded-card bg-surface shadow-card">
        <EmptyState icon={Activity} title="SLA report unavailable" description="The 30-day SLA report couldn't be loaded. Try refreshing." />
      </section>
    )
  }

  const met = report.resolved_within_sla || 0
  const breached = report.sla_breached || 0
  const open = report.pending_within_sla || 0
  const total = met + breached + open || 1
  const segments = [
    { key: "met", label: "Decided within 3 h", value: met, bar: "bg-leaf-500", icon: CheckCircle2, iconTone: "text-leaf-600" },
    { key: "open", label: "Open, still within SLA", value: open, bar: "bg-[#A9B5B1]", icon: Clock3, iconTone: "text-ink-3" },
    { key: "breached", label: "Breached", value: breached, bar: "bg-vermilion-500", icon: AlertCircle, iconTone: "text-vermilion-600" },
  ]

  return (
    <section className="grid overflow-hidden rounded-card bg-surface shadow-card lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" aria-label="SLA performance, last 30 days">
      <div className="p-5 sm:p-6">
        <div className="text-small font-medium text-ink-3">IRDAI SLA compliance · last 30 days</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <span className="figures text-[44px] font-semibold leading-none tracking-[-0.03em] text-ink">
            {report.sla_compliance_rate != null ? `${report.sla_compliance_rate.toFixed(1)}%` : "—"}
          </span>
          <span className="text-sm text-ink-3">
            {met} of {met + breached} decided claims within 3 hours
          </span>
        </div>

        {/* Part-to-whole bar: 2px surface gaps, rounded ends, a label for every segment */}
        <div className="mt-6 flex h-4 w-full gap-[2px]" role="img" aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(", ")}>
          {segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <div
                key={s.key}
                className={cn("group relative h-full first:rounded-l-[4px] last:rounded-r-[4px]", s.bar)}
                style={{ width: `${(s.value / total) * 100}%`, minWidth: 6 }}
              >
                <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-tiny font-semibold text-white shadow-raised group-hover:block">
                  {s.label}: {s.value} ({Math.round((s.value / total) * 100)}%)
                </span>
              </div>
            ))}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          {segments.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-2 text-small text-ink-2">
              <s.icon className={cn("h-4 w-4", s.iconTone)} aria-hidden="true" />
              {s.label}
              <span className="figures font-semibold text-ink">{s.value}</span>
            </li>
          ))}
        </ul>
      </div>

      <dl className="grid grid-cols-2 border-t border-line lg:grid-cols-1 lg:border-l lg:border-t-0">
        <div className="p-5 sm:p-6">
          <dt className="text-small font-medium text-ink-3">Average turnaround</dt>
          <dd className="figures mt-1 text-[26px] font-semibold tracking-[-0.02em] text-ink">
            {report.avg_resolution_minutes != null ? `${report.avg_resolution_minutes.toFixed(1)} min` : "—"}
          </dd>
          <dd className="text-tiny text-ink-3">
            {report.finalized_claims
              ? `Submit to finalize, across ${report.finalized_claims} finalized claim${report.finalized_claims === 1 ? "" : "s"}`
              : "No claims finalized in the last 30 days"}
          </dd>
        </div>
        <div className="border-l border-line p-5 sm:p-6 lg:border-l-0 lg:border-t">
          <dt className="text-small font-medium text-ink-3">SLA breaches</dt>
          <dd className={cn("figures mt-1 text-[26px] font-semibold tracking-[-0.02em]", breached ? "text-vermilion-700" : "text-ink")}>{breached}</dd>
          <dd className="text-tiny text-ink-3">Finalized late or open past the deadline · {open} still within SLA</dd>
        </div>
      </dl>
    </section>
  )
}
