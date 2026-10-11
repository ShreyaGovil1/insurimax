import React, { useState, useEffect } from "react"
import {
  AlertTriangle,
  Clock,
  CheckCircle2,
  TrendingUp,
  Search,
  ArrowRight,
  UserCheck,
  AlertOctagon,
  Sparkles,
  Zap,
  ShieldAlert,
  ArrowUpRight,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { api } from "../../services/api"
import { useAuth } from "../../context/AuthContext"
import { formatCurrencyINR } from "../../lib/utils"
import { Select } from "../ui/select"
import { SLAUrgencyBadge } from "../common/SLAUrgencyBadge"
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card"
import { Badge } from "../ui/badge"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { useToast } from "../ui/toast"

export function AdjusterQueueView({ onSelectClaim }) {
  const { user } = useAuth()
  const { toast } = useToast()
  let navigate = () => {}
  try {
    navigate = useNavigate()
  } catch {}

  const handleSelect = (claimId) => {
    if (onSelectClaim) onSelectClaim(claimId)
    if (navigate) navigate(`/claims/${claimId}`)
  }

  const [statusFilter, setStatusFilter] = useState("all") // "all" | "in_review" | "auto_approved" | "mismatch"
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  // Real queue-scoped metrics from GET /queue/stats (null until loaded or if unavailable)
  const [stats, setStats] = useState(null)

  const loadData = async () => {
    setLoading(true)
    try {
      // One queue for everything: it already includes unassigned claims
      const [queueData, statsData] = await Promise.all([
        api.queue.getQueue(),
        api.queue.getStats().catch(() => null),
      ])
      setClaims(queueData || [])
      setStats(statsData)
    } catch (err) {
      toast({
        title: "Queue Notice",
        description: err.message || "Failed to load claims queue",
        variant: "default",
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 30000)
    return () => clearInterval(interval)
  }, [user])

  const displayedList = claims

  const inReviewCount = displayedList.filter(
    (c) => c.status === "in_review" || c.status === "submitted" || c.status === "adjudication_in_progress"
  ).length
  const autoApprovedCount = displayedList.filter(
    (c) => c.status === "auto_approved" || c.status === "approved"
  ).length
  const mismatchCount = displayedList.filter(
    (c) => c.has_identity_mismatch || (c.flagged_items_count && c.flagged_items_count > 0)
  ).length

  const filteredClaims = displayedList.filter((c) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      const matches =
        c.patient_name?.toLowerCase().includes(q) ||
        c.claim_number?.toLowerCase().includes(q) ||
        c.hospital_name?.toLowerCase().includes(q)
      if (!matches) return false
    }

    if (statusFilter === "in_review") {
      return c.status === "in_review" || c.status === "submitted" || c.status === "adjudication_in_progress"
    }
    if (statusFilter === "auto_approved") {
      return c.status === "auto_approved" || c.status === "approved"
    }
    if (statusFilter === "mismatch") {
      return Boolean(c.has_identity_mismatch || (c.flagged_items_count && c.flagged_items_count > 0))
    }

    return true
  })

  // Urgent breach count (<30 min)
  const urgentCount = claims.filter((c) => {
    if (c.sla_breached) return true
    if (!c.sla_deadline) return false
    const diff = (new Date(c.sla_deadline).getTime() - Date.now()) / (1000 * 60)
    return diff < 30
  }).length

  return (
    <div className="space-y-5 max-w-7xl mx-auto px-4 sm:px-6 py-4">
      
      {/* 4 Fintech Metric Widgets (Ronas IT style) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Widget 1: Obsidian Dark Card (Active Queue) */}
        <div className="bg-slate-950 text-white rounded-3xl p-5 border border-slate-800 shadow-sm relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Active Queue
            </span>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/10 text-[#A3FF12]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#A3FF12] animate-pulse" />
              Live Feed
            </span>
          </div>

          <div className="my-3">
            <div className="text-3xl font-extrabold tracking-tight text-white">{claims.length}</div>
            <div className="text-xs text-slate-400 mt-0.5">Active claims in your queue</div>
          </div>

          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-300">
            <span>Avg. Turnaround Today</span>
            <span className="font-bold text-[#A3FF12]">
              {stats?.avg_turnaround_minutes != null ? `${stats.avg_turnaround_minutes} min` : "None finalized yet"}
            </span>
          </div>
        </div>

        {/* Widget 2: SLA Urgency Risk (<30m) */}
        <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              SLA Critical (&lt;30m)
            </span>
            <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>

          <div className="my-3">
            <div className={`text-3xl font-extrabold tracking-tight ${urgentCount > 0 ? "text-amber-600" : "text-slate-900"}`}>
              {urgentCount}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {urgentCount > 0 ? "Requires immediate sign-off" : "All SLAs in safe zone"}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Breach Threshold</span>
            <span className="font-semibold text-slate-700">IRDAI 3h Limit</span>
          </div>
        </div>

        {/* Widget 3: AI Auto-Approved Efficiency */}
        <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Auto-Approved
            </span>
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>

          <div className="my-3">
            <div className="text-3xl font-extrabold tracking-tight text-slate-900">{autoApprovedCount}</div>
            <div className="text-xs text-slate-500 mt-0.5">
              {stats
                ? `Confidence ≥ ${Math.round(stats.auto_approval_confidence_threshold * 100)}%, ≤ ${formatCurrencyINR(stats.auto_approval_max_amount_inr)}`
                : "In the current queue"}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span title="Non-payables, sub-limit excess and exclusions found by adjudications run today">
              Deductions Found Today
            </span>
            <span className="font-bold text-emerald-600 font-mono">
              {formatCurrencyINR(stats?.deductions_identified_today_inr || 0)}
            </span>
          </div>
        </div>

        {/* Widget 4: Quality & Compliance Score */}
        <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              AI Agreement Rate
            </span>
            <div className="p-2 rounded-xl bg-purple-50 text-purple-600">
              <Sparkles className="w-4 h-4" />
            </div>
          </div>

          <div className="my-3">
            <div className="text-3xl font-extrabold tracking-tight text-slate-900">
              {stats?.ai_agreement_rate != null ? `${stats.ai_agreement_rate}%` : "—"}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {stats?.ai_line_items_reviewed
                ? `${stats.ai_line_items_reviewed - stats.ai_overrides} of ${stats.ai_line_items_reviewed} AI line decisions kept (last ${stats.ai_agreement_window_days} days)`
                : "No AI line decisions in the last 30 days"}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Finalized Today</span>
            <span className="font-bold text-slate-800">
              {stats?.finalized_today ?? 0} {stats?.finalized_today === 1 ? "claim" : "claims"}
            </span>
          </div>
        </div>
      </div>

      {/* Main Queue Card with Pill Navigation & Filter */}
      <Card className="rounded-3xl border-slate-200/80 shadow-xs overflow-hidden">
        <CardHeader className="pb-3 border-b border-slate-100/80 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            
            <h2 className="text-sm font-bold text-slate-900">
              Queue <span className="text-slate-500 font-semibold">({claims.length})</span>
            </h2>

            {/* Sleek Pill Search */}
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <Input
                placeholder="Search patient, hospital..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="rounded-full pl-8 h-8.5 text-xs border-slate-200 bg-slate-50/50 focus:bg-white"
              />
            </div>
          </div>

          {/* Status filter dropdown */}
          <div className="pt-1">
            <Select
              aria-label="Filter cases"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full sm:w-72 rounded-full h-8 text-xs font-semibold bg-slate-50 border-slate-200 cursor-pointer"
            >
              <option value="all">All Cases ({displayedList.length})</option>
              <option value="in_review">In Review / Submitted ({inReviewCount})</option>
              <option value="auto_approved">Auto-Approved ({autoApprovedCount})</option>
              <option value="mismatch">Identity Mismatch / Flagged ({mismatchCount})</option>
            </Select>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="py-16 text-center text-slate-500 text-xs">Loading real-time queue...</div>
          ) : filteredClaims.length === 0 ? (
            <div className="py-16 text-center text-slate-500 text-xs">
              No claims match your current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/70 border-b border-slate-200/60 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="py-3 px-4">Claim & Patient</th>
                    <th className="py-3 px-4">Hospital & Payer</th>
                    <th className="py-3 px-4">Billed Amount</th>
                    <th className="py-3 px-4">SLA Urgency</th>
                    <th className="py-3 px-4">AI Confidence</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredClaims.map((claim) => (
                    <tr
                      key={claim.id}
                      className="hover:bg-slate-50/80 transition-colors group cursor-pointer"
                      onClick={() => handleSelect(claim.id)}
                    >
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 text-xs group-hover:text-blue-600 transition-colors">
                          {claim.claim_number}
                        </div>
                        <div className="text-slate-600 font-medium">{claim.patient_name}</div>
                        {claim.has_identity_mismatch && (
                          <div className="inline-flex items-center gap-1 text-[9px] font-black text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full border border-rose-200 mt-1 shadow-2xs">
                            <ShieldAlert className="w-2.5 h-2.5" />
                            <span>Bill Name Mismatch</span>
                          </div>
                        )}
                        {claim.policy_number && (
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">Pol: {claim.policy_number}</div>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-800">{claim.hospital_name}</div>
                        <div className="text-[11px] text-slate-500">{claim.insurer_name}</div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 text-xs">
                          {formatCurrencyINR(claim.billed_amount)}
                        </div>
                        {claim.approved_amount !== null && claim.approved_amount !== undefined && (
                          <div className="text-[10px] text-emerald-600 font-medium">
                            Approved: {formatCurrencyINR(claim.approved_amount)}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        {claim.status === "draft" ? (
                          <span className="text-[11px] text-slate-500">Draft: starts on submission</span>
                        ) : (
                          <SLAUrgencyBadge
                            slaDeadline={claim.sla_deadline}
                            isBreached={claim.sla_breached}
                          />
                        )}
                      </td>

                      <td className="py-3 px-4">
                        {claim.ai_confidence_score ? (
                          <div className="flex items-center space-x-1.5">
                            <span className="font-bold text-slate-800">
                              {Math.round(claim.ai_confidence_score * 100)}%
                            </span>
                            {claim.ai_confidence_score >= 0.92 ? (
                              <Badge variant="lime" className="text-[9px] px-1.5 py-0 h-4">High</Badge>
                            ) : (
                              <Badge variant="warning" className="text-[9px] px-1.5 py-0 h-4">Review</Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">Pending OCR</span>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        {claim.status === "auto_approved" ? (
                          <Badge variant="lime" className="text-[10px] font-black gap-1 uppercase tracking-wider">
                            <Sparkles className="w-2.5 h-2.5" />
                            <span>Auto-Approved</span>
                          </Badge>
                        ) : claim.has_identity_mismatch ? (
                          <Badge variant="destructive" className="text-[10px] font-black gap-1 uppercase tracking-wider">
                            <AlertOctagon className="w-2.5 h-2.5" />
                            <span>Flagged Mismatch</span>
                          </Badge>
                        ) : (
                          <Badge
                            variant={
                              claim.status === "approved"
                                ? "lime"
                                : claim.status === "queried"
                                ? "warning"
                                : "secondary"
                            }
                            className="capitalize text-[10px] font-bold"
                          >
                            {claim.status?.replace("_", " ")}
                          </Badge>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end space-x-1.5">
                          <Button
                            size="sm"
                            onClick={() => handleSelect(claim.id)}
                            className="rounded-full h-7.5 px-3 text-xs font-bold bg-slate-950 hover:bg-slate-800 text-white gap-1 shadow-2xs cursor-pointer"
                          >
                            <span>Open</span>
                            <ArrowRight className="w-3 h-3 text-[#A3FF12]" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  )
}
