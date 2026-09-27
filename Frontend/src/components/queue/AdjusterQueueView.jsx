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
import { SLAUrgencyBadge } from "../common/SLAUrgencyBadge"
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card"
import { Badge } from "../ui/badge"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog"
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

  const [activeTab, setActiveTab] = useState("assigned") // "assigned" | "unassigned"
  const [claims, setClaims] = useState([])
  const [unassignedClaims, setUnassignedClaims] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [dailyDigest, setDailyDigest] = useState(null)

  // Escalate modal state
  const [escalateModalOpen, setEscalateModalOpen] = useState(false)
  const [selectedClaimForAction, setSelectedClaimForAction] = useState(null)
  const [escalationReason, setEscalationReason] = useState("")

  const loadData = async () => {
    setLoading(true)
    try {
      const isAdminOrSenior = user?.role === "admin" || user?.role === "senior_adjuster"
      const [queueData, unassignedData, digestData] = await Promise.all([
        api.queue.getQueue(),
        isAdminOrSenior ? api.queue.getUnassignedQueue().catch(() => []) : Promise.resolve([]),
        user?.id ? api.queue.getAdjusterDailyDigest(user.id).catch(() => null) : Promise.resolve(null),
      ])
      setClaims(queueData || [])
      setUnassignedClaims(unassignedData || [])
      setDailyDigest(digestData)
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

  // Urgent breach count (<30 min)
  const urgentCount = claims.filter((c) => {
    if (c.sla_breached) return true
    if (!c.sla_deadline) return false
    const diff = (new Date(c.sla_deadline).getTime() - Date.now()) / (1000 * 60)
    return diff < 30
  }).length

  const autoApprovedCount = claims.filter((c) => c.status === "auto_approved" || c.status === "approved").length

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
            <div className="text-xs text-slate-400 mt-0.5">Assigned to your bench</div>
          </div>

          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-300">
            <span>Avg. SLA Turnaround</span>
            <span className="font-bold text-[#A3FF12]">{dailyDigest?.avg_turnaround_minutes || 24} min</span>
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
            <div className="text-xs text-slate-500 mt-0.5">Confidence ≥ 92%, &lt; ₹50k</div>
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Fraud / Leakage Saved</span>
            <span className="font-bold text-emerald-600 font-mono">
              {formatCurrencyINR(dailyDigest?.total_savings_inr || 284500)}
            </span>
          </div>
        </div>

        {/* Widget 4: Quality & Compliance Score */}
        <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Adjudication Accuracy
            </span>
            <div className="p-2 rounded-xl bg-purple-50 text-purple-600">
              <Sparkles className="w-4 h-4" />
            </div>
          </div>

          <div className="my-3">
            <div className="text-3xl font-extrabold tracking-tight text-slate-900">
              {dailyDigest?.accuracy_score || 98.4}%
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Gemini 1.5 Pro verification</div>
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Adjudicated Today</span>
            <span className="font-bold text-slate-800">{dailyDigest?.claims_adjudicated || 14} claims</span>
          </div>
        </div>
      </div>

      {/* Main Queue Card with Pill Navigation & Filter */}
      <Card className="rounded-3xl border-slate-200/80 shadow-xs overflow-hidden">
        <CardHeader className="pb-3 border-b border-slate-100/80">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            
            {/* Ronas IT Segmented Pill Navigation */}
            <div className="inline-flex items-center p-1 bg-slate-100 rounded-full border border-slate-200/70">
              <button
                onClick={() => setActiveTab("assigned")}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === "assigned"
                    ? "bg-slate-950 text-white shadow-xs font-bold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                My Priority Queue ({claims.length})
              </button>
              <button
                onClick={() => setActiveTab("unassigned")}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === "unassigned"
                    ? "bg-slate-950 text-white shadow-xs font-bold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Unassigned Pool ({unassignedClaims.length})
              </button>
            </div>

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
                        {claim.policy_number && (
                          <div className="text-[10px] text-slate-400 font-mono">Pol: {claim.policy_number}</div>
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
                        <SLAUrgencyBadge
                          slaDeadline={claim.sla_deadline}
                          isBreached={claim.sla_breached}
                        />
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
                        <Badge
                          variant={
                            claim.status === "auto_approved" || claim.status === "approved"
                              ? "lime"
                              : claim.status === "escalated"
                              ? "destructive"
                              : claim.status === "queried"
                              ? "warning"
                              : "secondary"
                          }
                          className="capitalize text-[10px] font-bold"
                        >
                          {claim.status?.replace("_", " ")}
                        </Badge>
                      </td>

                      <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end space-x-1.5">
                          <Button
                            size="sm"
                            onClick={() => handleSelect(claim.id)}
                            className="rounded-full h-7.5 px-3 text-xs font-bold bg-slate-950 hover:bg-slate-800 text-white gap-1 shadow-2xs cursor-pointer"
                          >
                            <span>Adjudicate</span>
                            <ArrowRight className="w-3 h-3 text-[#A3FF12]" />
                          </Button>

                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSelectedClaimForAction(claim)
                              setEscalateModalOpen(true)
                            }}
                            className="rounded-full h-7.5 w-7.5 p-0 text-slate-400 hover:text-red-700 hover:bg-red-50"
                            title="Escalate"
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
                className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:ring-1 focus:ring-slate-900"
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
            <Button variant="outline" className="rounded-full" onClick={() => setEscalateModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-full"
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
