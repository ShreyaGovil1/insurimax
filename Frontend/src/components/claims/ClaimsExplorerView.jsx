import React, { useState, useEffect } from "react"
import { Search, Filter, ArrowRight, Clock, Plus, RefreshCw } from "lucide-react"
import { api } from "../../services/api"
import { formatCurrencyINR, formatDateTime } from "../../lib/utils"
import { SLAUrgencyBadge } from "../common/SLAUrgencyBadge"
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import { Input } from "../ui/input"

export function ClaimsExplorerView({ onSelectClaim, onNewClaim }) {
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")

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
    <div className="space-y-6 max-w-7xl mx-auto px-6 py-6">
      {/* Header & New Claim CTA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Claims Explorer</h1>
          <p className="text-xs text-slate-500">
            Search, filter, and audit all incoming and processed health insurance claims.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadClaims}
            className="text-xs h-8 gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </Button>

          <Button
            size="sm"
            onClick={onNewClaim}
            className="text-xs h-8 font-semibold bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Claim</span>
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-2 w-full sm:w-auto">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-xs p-2 border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500 bg-white"
            >
              <option value="all">All Claim Statuses</option>
              <option value="submitted">Submitted</option>
              <option value="in_review">In Review</option>
              <option value="auto_approved">Auto-Approved</option>
              <option value="approved">Approved</option>
              <option value="partially_approved">Partially Approved</option>
              <option value="queried">Queried</option>
              <option value="escalated">Escalated</option>
              <option value="finalized">Finalized</option>
            </select>
          </div>

          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <Input
              placeholder="Search claims by patient, hospital, insurer, ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-xs"
            />
          </div>
        </CardContent>
      </Card>

      {/* Claims Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-16 text-center text-slate-500 text-sm">Loading claims...</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-slate-500 text-sm">
              No claims found matching criteria.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
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
                      className="hover:bg-blue-50/40 transition-colors cursor-pointer group"
                      onClick={() => onSelectClaim(c.id)}
                    >
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                          {c.claim_number}
                        </div>
                        <div className="text-slate-600 font-medium">{c.patient_name}</div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-medium text-slate-800">{c.hospital_name}</div>
                        <div className="text-[11px] text-slate-500">{c.insurer_name}</div>
                      </td>

                      <td className="py-3.5 px-4 font-mono font-medium text-slate-900">
                        {formatCurrencyINR(c.billed_amount)}
                      </td>

                      <td className="py-3.5 px-4 font-mono font-bold text-emerald-700">
                        {c.approved_amount !== null && c.approved_amount !== undefined
                          ? formatCurrencyINR(c.approved_amount)
                          : "—"}
                      </td>

                      <td className="py-3.5 px-4" onClick={(e) => e.stopPropagation()}>
                        <SLAUrgencyBadge
                          slaDeadline={c.sla_deadline}
                          isBreached={c.sla_breached}
                        />
                      </td>

                      <td className="py-3.5 px-4">
                        <Badge
                          variant={
                            c.status === "auto_approved" || c.status === "approved" || c.status === "finalized"
                              ? "success"
                              : c.status === "escalated"
                              ? "destructive"
                              : c.status === "queried"
                              ? "warning"
                              : "secondary"
                          }
                          className="capitalize text-xs font-semibold"
                        >
                          {c.status?.replace("_", " ")}
                        </Badge>
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <Button
                          size="sm"
                          onClick={() => onSelectClaim(c.id)}
                          className="h-8 text-xs font-semibold bg-slate-900 hover:bg-blue-600 text-white gap-1"
                        >
                          <span>Open</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
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
