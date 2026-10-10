import { useAuth } from "../../context/AuthContext"
import React, { useState, useEffect } from "react"
import { Search, Filter, ArrowRight, Clock, Plus, RefreshCw, Layers, Trash2 } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { api } from "../../services/api"
import { formatCurrencyINR, formatDateTime } from "../../lib/utils"
import { SLAUrgencyBadge } from "../common/SLAUrgencyBadge"
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import { Input } from "../ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog"
import { useToast } from "../ui/toast"

const STATUS_FILTERS = [
  { key: "all", label: "All Claims" },
  { key: "submitted", label: "Submitted" },
  { key: "in_review", label: "In Review" },
  { key: "auto_approved", label: "Auto-Approved" },
  { key: "finalized", label: "Finalized" },
]

export function ClaimsExplorerView({ onSelectClaim, onNewClaim }) {
  const { user } = useAuth()
  let navigate = () => {}
  try {
    navigate = useNavigate()
  } catch {}

  const handleSelect = (claimId) => {
    if (onSelectClaim) onSelectClaim(claimId)
    if (navigate) navigate(`/claims/${claimId}`)
  }
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  const { toast } = useToast()
  const isHospital = user?.role === "hospital_desk"
  // Draft pending deletion (hospital only); drives the confirmation dialog
  const [claimToDelete, setClaimToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const handleDeleteDraft = async () => {
    if (!claimToDelete) return
    setDeleting(true)
    try {
      await api.claims.delete(claimToDelete.id)
      toast({ title: "Draft Deleted", description: `${claimToDelete.claim_number} and its documents were deleted.`, variant: "success" })
      setClaimToDelete(null)
      loadClaims()
    } catch (err) {
      toast({ title: "Delete Failed", description: err.message, variant: "destructive" })
    } finally {
      setDeleting(false)
    }
  }

  const loadClaims = async () => {
    setLoading(true)
    try {
      const filters = {}
      if (statusFilter !== "all") filters.status = statusFilter
      const res = await api.claims.list(filters)
      setClaims(res?.items || [])
    } catch (err) {
      console.warn("Failed to load claims:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadClaims()
  }, [statusFilter])

  const filtered = claims.filter((c) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      c.patient_name?.toLowerCase().includes(q) ||
      c.claim_number?.toLowerCase().includes(q) ||
      c.hospital_name?.toLowerCase().includes(q) ||
      c.insurer_name?.toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-5 max-w-7xl mx-auto px-4 sm:px-6 py-4">
      {/* Header & New Claim CTA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Claims Explorer</h1>
          <p className="text-xs text-slate-500">
            Search, filter, and audit health insurance claims across all network hospitals.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadClaims}
            className="rounded-full text-xs h-8.5 px-3.5 gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
            <span>Refresh</span>
          </Button>

          {user?.role === "hospital_desk" && (
          <Button
            size="sm"
            onClick={onNewClaim}
            className="rounded-full text-xs h-8.5 px-4 font-bold bg-slate-950 hover:bg-slate-800 text-white gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-[#A3FF12]" />
            <span>New Claim</span>
          </Button>
          )}
        </div>
      </div>

      {/* Filter Bar with Segmented Pills & Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-3 rounded-2xl sm:rounded-full border border-slate-200/80 shadow-2xs">
        
        {/* Status Pills */}
        <div className="flex items-center space-x-1 overflow-x-auto pb-1 md:pb-0">
          {(user?.role === "hospital_desk"
            ? [STATUS_FILTERS[0], { key: "draft", label: "Drafts" }, ...STATUS_FILTERS.slice(1)]
            : STATUS_FILTERS
          ).map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                statusFilter === f.key
                  ? "bg-slate-950 text-white font-bold shadow-2xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Pill Search Input */}
        <div className="relative w-full md:w-72">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
          <Input
            placeholder="Search patient, hospital, claim #..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="rounded-full pl-8 h-8 text-xs border-slate-200 bg-slate-50 focus:bg-white"
          />
        </div>
      </div>

      {/* Claims Table */}
      <Card className="rounded-3xl border-slate-200/80 shadow-xs overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="py-16 text-center text-slate-500 text-xs">Loading claims...</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-slate-500 text-xs">
              No claims found matching criteria.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50/70 border-b border-slate-200/60 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="py-3 px-4">Claim ID & Patient</th>
                    <th className="py-3 px-4">Hospital & Insurer</th>
                    <th className="py-3 px-4">Billed Amount</th>
                    <th className="py-3 px-4">Approved Amount</th>
                    <th className="py-3 px-4">SLA Deadline</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((c) => (
                    <tr
                      key={c.id}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                      onClick={() => handleSelect(c.id)}
                    >
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 text-xs group-hover:text-blue-600 transition-colors">
                          {c.claim_number}
                        </div>
                        <div className="text-slate-600 font-medium">{c.patient_name}</div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-800">{c.hospital_name}</div>
                        <div className="text-[11px] text-slate-500">{c.insurer_name}</div>
                      </td>

                      <td className="py-3 px-4 font-mono font-medium text-slate-900">
                        {formatCurrencyINR(c.billed_amount)}
                      </td>

                      <td className="py-3 px-4 font-mono font-bold text-emerald-700">
                        {c.approved_amount !== null && c.approved_amount !== undefined
                          ? formatCurrencyINR(c.approved_amount)
                          : "—"}
                      </td>

                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        {c.status === "draft" ? (
                          <span className="text-[11px] text-slate-500">Starts on submission</span>
                        ) : (
                          <SLAUrgencyBadge
                            slaDeadline={c.sla_deadline}
                            isBreached={c.sla_breached}
                          />
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <Badge
                          variant={
                            c.status === "auto_approved" || c.status === "approved"
                              ? "lime"
                              : c.status === "queried" || c.status === "draft"
                              ? "warning"
                              : "secondary"
                          }
                          className="capitalize text-[10px] font-bold"
                        >
                          {c.status?.replaceAll("_", " ")}
                        </Badge>
                      </td>

                      <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end space-x-1.5">
                          <Button
                            size="sm"
                            onClick={() => handleSelect(c.id)}
                            className="rounded-full h-7.5 px-3 text-xs font-bold bg-slate-950 hover:bg-slate-800 text-white gap-1 shadow-2xs cursor-pointer"
                          >
                            <span>Open</span>
                            <ArrowRight className="w-3 h-3 text-[#A3FF12]" />
                          </Button>
                          {isHospital && c.status === "draft" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setClaimToDelete(c)}
                              className="rounded-full h-7.5 w-7.5 p-0 text-slate-400 hover:text-red-700 hover:bg-red-50"
                              title="Delete draft"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
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

      {/* Delete draft confirmation */}
      <Dialog open={Boolean(claimToDelete)} onOpenChange={(open) => !open && setClaimToDelete(null)}>
        <DialogContent onClose={() => setClaimToDelete(null)}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-red-600" />
              <span>Delete draft {claimToDelete?.claim_number}?</span>
            </DialogTitle>
            <DialogDescription>
              The draft for {claimToDelete?.patient_name} and every document attached to it are permanently deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClaimToDelete(null)}>
              Cancel
            </Button>
            <Button onClick={handleDeleteDraft} disabled={deleting} className="bg-red-600 hover:bg-red-700 text-white gap-1.5">
              <Trash2 className="w-3.5 h-3.5" />
              <span>{deleting ? "Deleting..." : "Delete Draft"}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
