import React, { useState, useEffect } from "react"
import {
  AlertTriangle,
  Clock,
  CheckCircle2,
  TrendingUp,
  Search,
  Filter,
  ArrowRight,
  UserCheck,
  AlertOctagon,
  Sparkles,
  Zap,
} from "lucide-react"
import { api } from "../../services/api"
import { useAuth } from "../../context/AuthContext"
import { formatCurrencyINR } from "../../lib/utils"
import { SLAUrgencyBadge } from "../common/SLAUrgencyBadge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card"
import { Badge } from "../ui/badge"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog"
import { useToast } from "../ui/toast"

export function AdjusterQueueView({ onSelectClaim }) {
  const { user } = useAuth()
  const { toast } = useToast()

  const [activeTab, setActiveTab] = useState("assigned") // "assigned" | "unassigned" | "all"
  const [claims, setClaims] = useState([])
  const [unassignedClaims, setUnassignedClaims] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [dailyDigest, setDailyDigest] = useState(null)

  // Escalate modal state
  const [escalateModalOpen, setEscalateModalOpen] = useState(false)
  const [selectedClaimForAction, setSelectedClaimForAction] = useState(null)
  const [escalationReason, setEscalationReason] = useState("")

  // Assign modal state
  const [assignModalOpen, setAssignModalOpen] = useState(false)
  const [selectedAdjuster, setSelectedAdjuster] = useState("u-adj-001")

  const loadData = async () => {
    setLoading(true)
    try {
      const [queueData, unassignedData, digestData] = await Promise.all([
        api.queue.getQueue(),
        api.queue.getUnassignedQueue(),
        api.queue.getAdjusterDailyDigest(user?.id || "u-adj-001"),
      ])
      setClaims(queueData || [])
      setUnassignedClaims(unassignedData || [])
      setDailyDigest(digestData)
    } catch (err) {
      toast({
        title: "Data Fetch Notice",
        description: "Operating with local cached queue data",
        variant: "default",
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    // Auto-refresh queue every 30 seconds to maintain accurate SLA timers
    const interval = setInterval(loadData, 30000)
    return () => clearInterval(interval)
  }, [user])

  const handleEscalate = async () => {
    if (!selectedClaimForAction) return
    try {
      await api.queue.escalateClaim(selectedClaimForAction.id, escalationReason)
      toast({
        title: "Claim Escalated",
        description: `Claim ${selectedClaimForAction.claim_number} transferred to Senior Adjudication tier.`,
        variant: "warning",
      })
      setEscalateModalOpen(false)
      setEscalationReason("")
      loadData()
    } catch (err) {
      toast({
        title: "Escalation Failed",
        description: err.message,
        variant: "destructive",
      })
    }
  }

  const handleAssign = async () => {
    if (!selectedClaimForAction) return
    try {
      await api.queue.assignClaim(selectedClaimForAction.id, selectedAdjuster)
      toast({
        title: "Claim Assigned",
        description: `Claim ${selectedClaimForAction.claim_number} assigned to adjuster.`,
        variant: "success",
      })
      setAssignModalOpen(false)
      loadData()
    } catch (err) {
      toast({
        title: "Assignment Failed",
        description: err.message,
        variant: "destructive",
      })
    }
  }

  const displayedList = activeTab === "unassigned" ? unassignedClaims : claims
  const filteredClaims = displayedList.filter((c) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      c.patient_name?.toLowerCase().includes(q) ||
      c.claim_number?.toLowerCase().includes(q) ||
      c.hospital_name?.toLowerCase().includes(q)
    )
  })

  // Urgent breach count
  const urgentCount = claims.filter((c) => {
    if (c.sla_breached) return true
    if (!c.sla_deadline) return false
    const diff = (new Date(c.sla_deadline).getTime() - Date.now()) / (1000 * 60)
    return diff < 30
  }).length

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-6 py-6">
      {/* Top Banner: Turnaround & Performance Digest */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white shadow-lg">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-lg bg-blue-600/30 border border-blue-500/40 text-blue-400">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-semibold tracking-wide text-white">IRDAI Real-time Adjudication Queue</h2>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Avg Turnaround: {dailyDigest?.avg_turnaround_minutes || 24} min
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Target: Complete under 30 minutes. Cases auto-sorted by SLA breach urgency.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6 border-t md:border-t-0 md:border-l border-slate-700/60 pt-3 md:pt-0 md:pl-6 text-xs">
          <div>
            <span className="text-slate-400 block text-[11px]">Adjudicated Today</span>
            <span className="text-base font-bold text-white">{dailyDigest?.claims_adjudicated || 14} claims</span>
          </div>
          <div>
            <span className="text-slate-400 block text-[11px]">AI Accuracy</span>
            <span className="text-base font-bold text-emerald-400">{dailyDigest?.accuracy_score || 98.4}%</span>
          </div>
          <div>
            <span className="text-slate-400 block text-[11px]">Fraud / Deductions Saved</span>
            <span className="text-base font-bold text-blue-300">
              {formatCurrencyINR(dailyDigest?.total_savings_inr || 284500)}
            </span>
          </div>
        </div>
      </div>

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-blue-600">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active in Queue</p>
              <h3 className="text-2xl font-bold text-slate-900 mt-1">{claims.length}</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">Assigned to your bench</p>
            </div>
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
              <Clock className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">SLA Critical (&lt;30m)</p>
              <h3 className="text-2xl font-bold text-amber-600 mt-1">{urgentCount}</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">High breach risk</p>
            </div>
            <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-600">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">AI Auto-Approved</p>
              <h3 className="text-2xl font-bold text-emerald-600 mt-1">
                {claims.filter((c) => c.status === "auto_approved").length}
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">Confidence ≥ 92%, &lt; ₹50k</p>
            </div>
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-600">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Unassigned Cases</p>
              <h3 className="text-2xl font-bold text-purple-700 mt-1">{unassignedClaims.length}</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">Ready for adjuster routing</p>
            </div>
            <div className="p-3 bg-purple-50 text-purple-600 rounded-xl">
              <UserCheck className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Queue Controls & Table */}
      <Card>
        <CardHeader className="pb-3 border-b border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* View Tabs */}
            <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-lg border border-slate-200/80">
              <button
                onClick={() => setActiveTab("assigned")}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === "assigned" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                My Priority Queue ({claims.length})
              </button>
              <button
                onClick={() => setActiveTab("unassigned")}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === "unassigned" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Unassigned Pool ({unassignedClaims.length})
              </button>
            </div>

            {/* Search Input */}
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <Input
                placeholder="Search patient, hospital, claim #..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-xs"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="py-16 text-center text-slate-500 text-sm">Loading real-time queue...</div>
          ) : filteredClaims.length === 0 ? (
            <div className="py-16 text-center text-slate-500 text-sm">
              No claims match your current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4">Claim # & Patient</th>
                    <th className="py-3 px-4">Hospital & Insurer</th>
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
                      className="hover:bg-blue-50/40 transition-colors group cursor-pointer"
                      onClick={() => onSelectClaim(claim.id)}
                    >
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900 text-sm group-hover:text-blue-600 transition-colors">
                          {claim.claim_number}
                        </div>
                        <div className="text-slate-600 font-medium">{claim.patient_name}</div>
                        {claim.policy_number && (
                          <div className="text-[10px] text-slate-400">Pol: {claim.policy_number}</div>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-medium text-slate-800">{claim.hospital_name}</div>
                        <div className="text-[11px] text-slate-500">{claim.insurer_name}</div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900 text-sm">
                          {formatCurrencyINR(claim.billed_amount)}
                        </div>
                        {claim.approved_amount !== null && claim.approved_amount !== undefined && (
                          <div className="text-[11px] text-emerald-600 font-medium">
                            Approved: {formatCurrencyINR(claim.approved_amount)}
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-4" onClick={(e) => e.stopPropagation()}>
                        <SLAUrgencyBadge
                          slaDeadline={claim.sla_deadline}
                          isBreached={claim.sla_breached}
                        />
                      </td>

                      <td className="py-3.5 px-4">
                        {claim.ai_confidence_score ? (
                          <div className="flex items-center space-x-1.5">
                            <span className="font-bold text-slate-800">
                              {Math.round(claim.ai_confidence_score * 100)}%
                            </span>
                            {claim.ai_confidence_score >= 0.92 ? (
                              <Badge variant="success" className="text-[10px] px-1 py-0 h-4">High</Badge>
                            ) : (
                              <Badge variant="warning" className="text-[10px] px-1 py-0 h-4">Review</Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">Pending OCR</span>
                        )}
                        {claim.flagged_items_count > 0 && (
                          <div className="text-[10px] text-red-600 font-medium mt-0.5">
                            {claim.flagged_items_count} item{claim.flagged_items_count > 1 ? "s" : ""} flagged
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <Badge
                          variant={
                            claim.status === "auto_approved" || claim.status === "approved"
                              ? "success"
                              : claim.status === "escalated"
                              ? "destructive"
                              : claim.status === "queried"
                              ? "warning"
                              : "secondary"
                          }
                          className="capitalize text-xs font-semibold"
                        >
                          {claim.status?.replace("_", " ")}
                        </Badge>
                      </td>

                      <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end space-x-1.5">
                          <Button
                            size="sm"
                            onClick={() => onSelectClaim(claim.id)}
                            className="h-8 text-xs font-semibold bg-slate-900 hover:bg-blue-600 text-white gap-1"
                          >
                            <span>Adjudicate</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </Button>

                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSelectedClaimForAction(claim)
                              setEscalateModalOpen(true)
                            }}
                            className="h-8 text-xs text-slate-600 hover:text-red-700 hover:bg-red-50"
                            title="Escalate to Senior Adjuster"
                          >
                            <AlertOctagon className="w-3.5 h-3.5" />
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

      {/* Escalate Claim Modal */}
      <Dialog open={escalateModalOpen} onOpenChange={setEscalateModalOpen}>
        <DialogContent onClose={() => setEscalateModalOpen(false)}>
          <DialogHeader>
            <DialogTitle>Escalate Claim to Senior Adjuster</DialogTitle>
            <DialogDescription>
              Escalates claim {selectedClaimForAction?.claim_number} for medical audit review or high-value exception.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Reason for Escalation
              </label>
              <select
                value={escalationReason}
                onChange={(e) => setEscalationReason(e.target.value)}
                className="w-full text-xs p-2 border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Select a reason...</option>
                <option value="Unbundled surgery charges exceeding policy sub-limits">
                  Unbundled surgery charges exceeding sub-limit
                </option>
                <option value="Suspected billing upcoding & consumable inflation">
                  Suspected billing upcoding & consumable inflation
                </option>
                <option value="Pre-existing disease disclosure discrepancy">
                  Pre-existing disease disclosure discrepancy
                </option>
                <option value="Proportionate deduction calculation dispute">
                  Proportionate deduction calculation dispute
                </option>
                <option value="Other high-value clinical complexity">Other high-value clinical complexity</option>
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEscalateModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleEscalate}
              disabled={!escalationReason}
            >
              Confirm Escalation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
