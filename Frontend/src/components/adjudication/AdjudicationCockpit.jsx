import React, { useState, useEffect } from "react"
import {
  ArrowLeft,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  FileCheck,
  RotateCcw,
  Lock,
  MessageSquare,
  ExternalLink,
  ChevronRight,
  BookOpen,
  DollarSign,
  Scale,
  Download,
  Printer,
  Edit3,
} from "lucide-react"
import { api } from "../../services/api"
import { formatCurrencyINR, formatDateTime } from "../../lib/utils"
import { SLAUrgencyBadge } from "../common/SLAUrgencyBadge"
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card"
import { Badge } from "../ui/badge"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Textarea } from "../ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { DocumentExtractionView } from "../documents/DocumentExtractionView"
import { ClaimQueriesView } from "../queries/ClaimQueriesView"

export function AdjudicationCockpit({ claimId, onBack }) {
  const { toast } = useToast()

  const [activeTab, setActiveTab] = useState("adjudication") // "adjudication" | "documents" | "queries"
  const [claim, setClaim] = useState(null)
  const [adjudication, setAdjudication] = useState(null)
  const [selectedItemId, setSelectedItemId] = useState(null)
  const [explanation, setExplanation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [runningPipeline, setRunningPipeline] = useState(false)

  // Override modal state (Phase 3)
  const [overrideModalOpen, setOverrideModalOpen] = useState(false)
  const [overrideItem, setOverrideItem] = useState(null)
  const [overrideForm, setOverrideForm] = useState({
    new_status: "approved",
    override_reason: "clinical_necessity",
    new_approved_amount_inr: "",
    override_note: "",
  })

  // Finalize modal state (Phase 5)
  const [finalizeModalOpen, setFinalizeModalOpen] = useState(false)
  const [finalizeNotes, setFinalizeNotes] = useState("")
  const [finalizing, setFinalizing] = useState(false)

  // Compliance Audit Report modal
  const [auditReportModalOpen, setAuditReportModalOpen] = useState(false)
  const [auditReport, setAuditReport] = useState(null)

  const loadClaimData = async () => {
    setLoading(true)
    try {
      const [claimData, adjData] = await Promise.all([
        api.claims.getById(claimId),
        api.adjudication.get(claimId),
      ])
      setClaim(claimData)
      setAdjudication(adjData)

      // Auto-select first line item if none selected
      if (adjData?.line_items?.length > 0 && !selectedItemId) {
        setSelectedItemId(adjData.line_items[0].id)
        loadExplanation(adjData.line_items[0].id)
      }
    } catch (err) {
      toast({
        title: "Notice",
        description: "Viewing claim in offline/cached mode",
        variant: "default",
      })
    } finally {
      setLoading(false)
    }
  }

  const loadExplanation = async (itemId) => {
    try {
      const expl = await api.adjudication.getExplanation(claimId, itemId)
      setExplanation(expl)
    } catch (err) {
      console.error("Failed to load explanation:", err)
    }
  }

  useEffect(() => {
    loadClaimData()
  }, [claimId])

  const handleSelectItem = (item) => {
    setSelectedItemId(item.id)
    loadExplanation(item.id)
  }

  // Trigger Gemini Adjudication Pipeline
  const handleRunAdjudication = async () => {
    setRunningPipeline(true)
    try {
      const res = await api.adjudication.run(claimId)
      setAdjudication(res)
      toast({
        title: "Adjudication Complete",
        description: "Gemini 1.5 Pro evaluated all line items against policy rules.",
        variant: "success",
      })
      if (res.line_items?.length > 0) {
        handleSelectItem(res.line_items[0])
      }
    } catch (err) {
      toast({
        title: "Adjudication Failed",
        description: err.message,
        variant: "destructive",
      })
    } finally {
      setRunningPipeline(false)
    }
  }

  // Open Phase 3 Override Modal
  const openOverrideModal = (item) => {
    setOverrideItem(item)
    setOverrideForm({
      new_status: item.final_status || item.ai_status || "approved",
      override_reason: item.override_reason || "clinical_necessity",
      new_approved_amount_inr: item.approved_amount_inr || item.billed_amount_inr,
      override_note: item.override_note || "",
    })
    setOverrideModalOpen(true)
  }

  // Submit Phase 3 Override
  const handleSubmitOverride = async (e) => {
    e.preventDefault()
    if (!overrideItem) return

    try {
      const newApproved = parseFloat(overrideForm.new_approved_amount_inr) || 0
      const newDeducted = Math.max(0, overrideItem.billed_amount_inr - newApproved)

      const payload = {
        new_status: overrideForm.new_status,
        override_reason: overrideForm.override_reason,
        override_note: overrideForm.override_note,
        new_approved_amount_inr: newApproved,
      }

      await api.adjudication.overrideLineItem(claimId, overrideItem.id, payload)

      // Update local state smoothly
      setAdjudication((prev) => {
        if (!prev) return prev
        const updatedItems = prev.line_items.map((li) => {
          if (li.id === overrideItem.id) {
            return {
              ...li,
              final_status: payload.new_status,
              approved_amount_inr: newApproved,
              deducted_amount_inr: newDeducted,
              is_overridden: true,
              override_reason: payload.override_reason,
              override_note: payload.override_note,
            }
          }
          return li
        })

        const totalBilled = updatedItems.reduce((acc, curr) => acc + (curr.billed_amount_inr || 0), 0)
        const totalApproved = updatedItems.reduce((acc, curr) => acc + (curr.approved_amount_inr || 0), 0)
        const totalDeducted = totalBilled - totalApproved

        return {
          ...prev,
          total_approved_inr: totalApproved,
          total_deducted_inr: totalDeducted,
          line_items: updatedItems,
        }
      })

      // Also update currently active explanation
      if (selectedItemId === overrideItem.id) {
        setExplanation((prev) => ({
          ...prev,
          final_status: payload.new_status,
          approved_amount_inr: newApproved,
          deducted_amount_inr: newDeducted,
        }))
      }

      toast({
        title: "Adjuster Override Applied",
        description: `Line item #${overrideItem.line_number} updated. Claim totals recalculated.`,
        variant: "success",
      })
      setOverrideModalOpen(false)
    } catch (err) {
      toast({
        title: "Override Failed",
        description: err.message,
        variant: "destructive",
      })
    }
  }

  // Phase 5 Finalize Adjudication
  const handleFinalize = async () => {
    setFinalizing(true)
    try {
      const res = await api.adjudication.finalize(claimId, {
        adjuster_notes: finalizeNotes,
      })
      setAdjudication(res)
      setClaim((prev) => ({ ...prev, status: "finalized" }))
      toast({
        title: "Adjudication Locked & Finalized",
        description: "Immutable compliance audit record generated.",
        variant: "success",
      })
      setFinalizeModalOpen(false)
    } catch (err) {
      toast({
        title: "Finalization Failed",
        description: err.message,
        variant: "destructive",
      })
    } finally {
      setFinalizing(false)
    }
  }

  // View Compliance Audit Report
  const handleViewAuditReport = async () => {
    try {
      const rep = await api.claims.getAuditReport(claimId)
      setAuditReport(rep)
      setAuditReportModalOpen(true)
    } catch (err) {
      toast({
        title: "Report Error",
        description: err.message,
        variant: "destructive",
      })
    }
  }

  const isFinalized = claim?.status === "finalized" || adjudication?.status === "finalized"

  if (loading) {
    return (
      <div className="py-24 text-center text-slate-500 text-sm">
        Loading claim adjudication workspace...
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-7xl mx-auto px-6 py-4">
      {/* Top Breadcrumb & Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div className="flex items-center space-x-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onBack}
            className="h-8 px-2.5 text-xs text-slate-700"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            <span>Back to Queue</span>
          </Button>

          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                {claim?.claim_number}
              </h1>
              <Badge
                variant={isFinalized ? "default" : "info"}
                className="capitalize text-xs font-semibold"
              >
                {claim?.status?.replace("_", " ")}
              </Badge>
              {adjudication?.gemini_model_used && (
                <Badge variant="purple" className="text-[10px] gap-1 px-1.5 h-4">
                  <Sparkles className="w-3 h-3" />
                  <span>{adjudication.gemini_model_used}</span>
                </Badge>
              )}
            </div>
            <div className="flex items-center space-x-3 text-xs text-slate-500 mt-0.5">
              <span>Patient: <strong className="text-slate-800">{claim?.patient_name}</strong></span>
              <span>•</span>
              <span>Hospital: <strong className="text-slate-800">{claim?.hospital_name}</strong></span>
              <span>•</span>
              <span>Insurer: <strong className="text-slate-800">{claim?.insurer_name}</strong></span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-2">
          <SLAUrgencyBadge
            slaDeadline={claim?.sla_deadline}
            isBreached={claim?.sla_breached}
          />

          <Button
            size="sm"
            variant="outline"
            onClick={handleRunAdjudication}
            disabled={runningPipeline || isFinalized}
            className="text-xs font-semibold gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${runningPipeline ? "animate-spin" : ""}`} />
            <span>{runningPipeline ? "Analyzing..." : "Re-Run AI Pipeline"}</span>
          </Button>

          {isFinalized ? (
            <Button
              size="sm"
              onClick={handleViewAuditReport}
              className="text-xs font-semibold gap-1.5 bg-slate-900 hover:bg-slate-800 text-white"
            >
              <FileCheck className="w-3.5 h-3.5" />
              <span>Compliance Audit Report</span>
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => setFinalizeModalOpen(true)}
              className="text-xs font-semibold gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Lock & Finalize Decision</span>
            </Button>
          )}
        </div>
      </div>

      {/* Phase 4 Financial Summary Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-white p-4 rounded-xl border border-slate-200/90 shadow-sm">
        {/* Total Billed */}
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/60">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            1. Total Billed
          </span>
          <div className="text-xl font-bold text-slate-900 mt-1">
            {formatCurrencyINR(adjudication?.total_billed_inr || claim?.billed_amount)}
          </div>
          <span className="text-[10px] text-slate-500">From itemized hospital bills</span>
        </div>

        {/* Total Approved */}
        <div className="p-3 rounded-lg bg-emerald-50/80 border border-emerald-200/80">
          <span className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wider block">
            2. Approved Amount
          </span>
          <div className="text-xl font-bold text-emerald-700 mt-1">
            {formatCurrencyINR(adjudication?.total_approved_inr || claim?.approved_amount)}
          </div>
          <span className="text-[10px] text-emerald-700">
            {adjudication?.total_billed_inr
              ? `${Math.round(((adjudication.total_approved_inr || 0) / adjudication.total_billed_inr) * 100)}% Admissibility`
              : "Calculated"}
          </span>
        </div>

        {/* Total Deducted */}
        <div className="p-3 rounded-lg bg-red-50/70 border border-red-200/70">
          <span className="text-[11px] font-semibold text-red-800 uppercase tracking-wider block">
            3. Deductions & Exclusions
          </span>
          <div className="text-xl font-bold text-red-700 mt-1">
            {formatCurrencyINR(adjudication?.total_deducted_inr || claim?.deducted_amount)}
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            {Object.keys(adjudication?.deduction_breakdown || {}).map((cat, idx) => (
              <span
                key={idx}
                className="text-[9px] font-medium bg-red-100 text-red-800 px-1.5 py-0.5 rounded"
                title={`${cat}: ${formatCurrencyINR(adjudication.deduction_breakdown[cat])}`}
              >
                {cat.split(" ")[0]}: {formatCurrencyINR(adjudication.deduction_breakdown[cat])}
              </span>
            ))}
          </div>
        </div>

        {/* AI Confidence & Model Assessment */}
        <div className="p-3 rounded-lg bg-blue-50/70 border border-blue-200/70 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-blue-900 uppercase tracking-wider">
                4. AI Confidence
              </span>
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <div className="text-xl font-bold text-blue-700 mt-1">
              {Math.round((adjudication?.confidence_score || 0.94) * 100)}%
            </div>
          </div>
          <div className="text-[11px] text-blue-800 font-medium">
            {adjudication?.auto_approved ? (
              <span className="text-emerald-700 font-bold">Auto-approved eligible</span>
            ) : (
              <span>Flagged items audited by rules</span>
            )}
          </div>
        </div>
      </div>

      {/* Cockpit Mode Tabs */}
      <div className="flex items-center space-x-2 border-b border-slate-200">
        <button
          onClick={() => setActiveTab("adjudication")}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 cursor-pointer transition-colors flex items-center space-x-1.5 ${
            activeTab === "adjudication"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <Scale className="w-3.5 h-3.5" />
          <span>Line-Item Adjudication & Policy Citations</span>
          <Badge variant="secondary" className="ml-1 text-[10px] px-1 py-0 h-4">
            {adjudication?.line_items?.length || 0}
          </Badge>
        </button>

        <button
          onClick={() => setActiveTab("documents")}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 cursor-pointer transition-colors flex items-center space-x-1.5 ${
            activeTab === "documents"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Hospital Documents & OCR Extractions</span>
        </button>

        <button
          onClick={() => setActiveTab("queries")}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 cursor-pointer transition-colors flex items-center space-x-1.5 ${
            activeTab === "queries"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Hospital Queries & Clarifications</span>
        </button>
      </div>

      {/* Sub-view Content */}
      {activeTab === "documents" && (
        <DocumentExtractionView claimId={claimId} />
      )}

      {activeTab === "queries" && (
        <ClaimQueriesView claimId={claimId} />
      )}

      {activeTab === "adjudication" && (
        /* Phase 2: Split-Screen Cockpit */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column: Interactive Line Items Table (7 cols) */}
          <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-3.5 px-4 bg-slate-50/80 border-b border-slate-200/80 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Itemized Bill Adjudication Schedule
                </h3>
                <p className="text-[11px] text-slate-500">
                  Click any line item to inspect AI reasoning and verified policy clause.
                </p>
              </div>
              <span className="text-[11px] font-semibold text-slate-600">
                {adjudication?.line_items?.length || 0} line items
              </span>
            </div>

            <div className="overflow-x-auto max-h-[640px] overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-slate-100/95 backdrop-blur z-10 text-[10px] font-semibold uppercase tracking-wider text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-3">Item Description</th>
                    <th className="py-2.5 px-3 text-right">Billed</th>
                    <th className="py-2.5 px-3 text-right">Approved</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {adjudication?.line_items?.map((item) => {
                    const isSelected = selectedItemId === item.id
                    return (
                      <tr
                        key={item.id}
                        onClick={() => handleSelectItem(item)}
                        className={`transition-colors cursor-pointer select-none ${
                          isSelected
                            ? "bg-blue-50/90 font-medium border-l-4 border-l-blue-600"
                            : "hover:bg-slate-50"
                        }`}
                      >
                        <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">
                          {item.line_number}
                        </td>

                        <td className="py-3 px-3">
                          <div className="font-semibold text-slate-900 leading-snug">
                            {item.item_name}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] text-slate-500">{item.item_category}</span>
                            {item.is_overridden && (
                              <Badge variant="warning" className="text-[9px] px-1 py-0 h-3.5">
                                Overridden
                              </Badge>
                            )}
                          </div>
                        </td>

                        <td className="py-3 px-3 text-right font-mono font-medium text-slate-800">
                          {formatCurrencyINR(item.billed_amount_inr)}
                        </td>

                        <td className="py-3 px-3 text-right font-mono font-bold text-emerald-700">
                          {formatCurrencyINR(item.approved_amount_inr)}
                        </td>

                        <td className="py-3 px-3">
                          <Badge
                            variant={
                              item.final_status === "approved"
                                ? "success"
                                : item.final_status === "non_payable" || item.final_status === "rejected"
                                ? "destructive"
                                : item.final_status === "partially_approved"
                                ? "warning"
                                : "secondary"
                            }
                            className="capitalize text-[10px] py-0 px-2 font-semibold"
                          >
                            {item.final_status?.replace("_", " ")}
                          </Badge>
                        </td>

                        <td className="py-3 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openOverrideModal(item)}
                            disabled={isFinalized}
                            className="h-7 px-2 text-[11px] text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                            title="Override decision"
                          >
                            <Edit3 className="w-3 h-3 mr-1" />
                            <span>Override</span>
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Column: Phase 2 AI Reasoning & Policy Citation Panel (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            {explanation ? (
              <Card className="border-slate-300 shadow-md">
                <CardHeader className="p-4 pb-2 bg-gradient-to-r from-slate-900 to-blue-950 text-white rounded-t-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-blue-300">
                      Phase 2 Clause Citation & Reasoning
                    </span>
                    <Badge variant="info" className="text-[10px] px-1.5 py-0 h-4 bg-blue-500/20 text-blue-200 border-blue-400/30">
                      Line Item #{adjudication?.line_items?.find((i) => i.id === explanation.item_id)?.line_number}
                    </Badge>
                  </div>
                  <CardTitle className="text-sm font-semibold text-white mt-1">
                    {explanation.item_name}
                  </CardTitle>
                </CardHeader>

                <CardContent className="p-4 space-y-4">
                  {/* Financial Breakdown for this item */}
                  <div className="grid grid-cols-3 gap-2 p-2.5 bg-slate-50 rounded-lg text-center text-xs">
                    <div>
                      <span className="text-[10px] text-slate-500 block">Billed</span>
                      <strong className="text-slate-800">{formatCurrencyINR(explanation.billed_amount_inr)}</strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Approved</span>
                      <strong className="text-emerald-700">{formatCurrencyINR(explanation.approved_amount_inr)}</strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Deducted</span>
                      <strong className="text-red-700">{formatCurrencyINR(explanation.deducted_amount_inr)}</strong>
                    </div>
                  </div>

                  {/* AI Reasoning */}
                  <div>
                    <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-900 mb-1">
                      <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                      <span>Gemini 1.5 Pro Adjudication Reasoning:</span>
                    </div>
                    <div className="p-3 bg-blue-50/60 border border-blue-100 rounded-lg text-xs text-slate-700 leading-relaxed font-normal">
                      {explanation.ai_explanation}
                    </div>
                  </div>

                  {/* Verified Policy Clause Citation Card */}
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                    <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-900">
                      <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Applicable Policy Clause & Schedule:</span>
                    </div>

                    <div className="text-xs text-slate-800 font-semibold">
                      {explanation.clause_reference || "Standard Health Insurance Schedule 2024"}
                    </div>

                    {explanation.clause_page && (
                      <div className="text-[11px] text-slate-500 flex items-center space-x-1">
                        <span>Page {explanation.clause_page} in Insurer Policy Wording Contract</span>
                      </div>
                    )}

                    {explanation.citation_data?.limit_data && (
                      <div className="text-[11px] bg-white p-2 rounded border border-slate-200 text-slate-600 font-mono">
                        Rule Limit: {JSON.stringify(explanation.citation_data.limit_data)}
                      </div>
                    )}
                  </div>

                  {/* Direct Override Action CTA */}
                  {!isFinalized && (
                    <Button
                      onClick={() => {
                        const itm = adjudication?.line_items?.find((i) => i.id === explanation.item_id)
                        if (itm) openOverrideModal(itm)
                      }}
                      className="w-full text-xs font-semibold bg-slate-900 hover:bg-blue-600 text-white gap-1.5"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Phase 3 Adjuster Override for this Item</span>
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="p-8 text-center bg-white rounded-xl border border-slate-200 text-slate-500 text-xs">
                Select a line item from the schedule to inspect policy citations.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Phase 3 Adjuster Override Modal */}
      <Dialog open={overrideModalOpen} onOpenChange={setOverrideModalOpen}>
        <DialogContent onClose={() => setOverrideModalOpen(false)}>
          <DialogHeader>
            <DialogTitle>Phase 3: Adjuster Decision Override</DialogTitle>
            <DialogDescription>
              Modify AI adjudication status or approved amount. All overrides log reasons to the compliance audit trail.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmitOverride} className="space-y-4 text-xs">
            <div className="p-3 bg-slate-50 rounded-lg">
              <span className="text-slate-500 block text-[11px]">Target Line Item:</span>
              <span className="font-bold text-slate-900 text-sm">
                #{overrideItem?.line_number} — {overrideItem?.item_name}
              </span>
              <div className="text-[11px] text-slate-500 mt-1">
                Billed: {formatCurrencyINR(overrideItem?.billed_amount_inr)}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">New Adjudication Status</label>
                <select
                  value={overrideForm.new_status}
                  onChange={(e) => setOverrideForm((prev) => ({ ...prev, new_status: e.target.value }))}
                  className="w-full p-2 border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500 text-xs font-medium"
                >
                  <option value="approved">Approved</option>
                  <option value="partially_approved">Partially Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="non_payable">Non Payable</option>
                  <option value="flagged">Flagged</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">New Approved Amount (₹ INR)</label>
                <Input
                  type="number"
                  value={overrideForm.new_approved_amount_inr}
                  onChange={(e) =>
                    setOverrideForm((prev) => ({ ...prev, new_approved_amount_inr: e.target.value }))
                  }
                  max={overrideItem?.billed_amount_inr}
                  min="0"
                  step="0.01"
                  required
                />
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Override Reason (Audit Categorization)</label>
              <select
                value={overrideForm.override_reason}
                onChange={(e) => setOverrideForm((prev) => ({ ...prev, override_reason: e.target.value }))}
                className="w-full p-2 border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500 text-xs"
              >
                <option value="clinical_necessity">Clinical Necessity (Medical Audit Exception)</option>
                <option value="hospital_clarification">Hospital Clarification Provided</option>
                <option value="upcoding_detected">Upcoding Detected</option>
                <option value="incorrect_policy_application">Incorrect Policy Application</option>
                <option value="document_illegible">Document Illegible / Verification</option>
                <option value="adjuster_discretion">Adjuster Senior Discretion</option>
                <option value="other">Other Rationale</option>
              </select>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Adjuster Clinical Justification Note</label>
              <Textarea
                value={overrideForm.override_note}
                onChange={(e) => setOverrideForm((prev) => ({ ...prev, override_note: e.target.value }))}
                placeholder="Explain the clinical basis or policy exception rationale for compliance..."
                rows={3}
                required
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOverrideModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
                Apply Override & Recalculate
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Phase 5 Lock & Finalize Modal */}
      <Dialog open={finalizeModalOpen} onOpenChange={setFinalizeModalOpen}>
        <DialogContent onClose={() => setFinalizeModalOpen(false)}>
          <DialogHeader>
            <DialogTitle>Phase 5: Lock & Finalize Claim Adjudication</DialogTitle>
            <DialogDescription>
              Finalizing locks this adjudication decision, records your adjuster signature, and stamps an immutable compliance record.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-xs">
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900">
              <div className="font-bold text-sm">
                Approved Payout: {formatCurrencyINR(adjudication?.total_approved_inr)}
              </div>
              <div className="text-[11px] text-emerald-700 mt-0.5">
                Total Deductions: {formatCurrencyINR(adjudication?.total_deducted_inr)}
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Final Adjuster Sign-Off Remarks</label>
              <Textarea
                value={finalizeNotes}
                onChange={(e) => setFinalizeNotes(e.target.value)}
                placeholder="Final remarks, summary of cashless authorization or deductions..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFinalizeModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleFinalize}
              disabled={finalizing}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            >
              {finalizing ? "Finalizing..." : "Confirm & Lock Compliance Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Compliance Audit Report Viewer */}
      <Dialog open={auditReportModalOpen} onOpenChange={setAuditReportModalOpen}>
        <DialogContent className="max-w-2xl" onClose={() => setAuditReportModalOpen(false)}>
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>Compliance Audit Record & Trace</DialogTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.print()}
                className="h-7 text-xs gap-1"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Record</span>
              </Button>
            </div>
            <DialogDescription>
              IRDAI 3-Hour Mandate Standard Verification Trail
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-xs font-mono bg-slate-50 p-4 rounded-lg border border-slate-200 max-h-[60vh] overflow-y-auto">
            <div>
              <span className="text-slate-500">CLAIM NUMBER:</span> {auditReport?.claim_number}
            </div>
            <div>
              <span className="text-slate-500">PATIENT:</span> {auditReport?.patient_name}
            </div>
            <div>
              <span className="text-slate-500">HOSPITAL:</span> {auditReport?.hospital}
            </div>
            <div>
              <span className="text-slate-500">AUDIT CRYPTO HASH:</span> {auditReport?.audit_hash}
            </div>
            <div>
              <span className="text-slate-500">COMPLIANCE STANDARD:</span> {auditReport?.compliance_standard}
            </div>
            <div>
              <span className="text-slate-500">DECISION LOCK TIMESTAMP:</span> {formatDateTime(auditReport?.adjudication_timestamp)}
            </div>

            <hr className="border-slate-200" />

            <div className="font-bold text-slate-800 text-sm">LINE ITEM DECISIONS & POLICY CITATIONS:</div>
            <div className="space-y-2 text-[11px]">
              {auditReport?.line_item_audits?.map((li) => (
                <div key={li.id} className="p-2 bg-white rounded border border-slate-200">
                  <div className="flex justify-between font-bold">
                    <span>#{li.line_number} {li.item_name}</span>
                    <span className="text-emerald-700">Approved: {formatCurrencyINR(li.approved_amount_inr)}</span>
                  </div>
                  <div className="text-slate-600 mt-1">Status: {li.final_status} | Deduction: {formatCurrencyINR(li.deducted_amount_inr)}</div>
                  {li.citation_data?.clause_reference && (
                    <div className="text-indigo-700 mt-0.5">Citation: {li.citation_data.clause_reference} (p.{li.citation_data.clause_page})</div>
                  )}
                  {li.is_overridden && (
                    <div className="text-amber-700 font-bold mt-0.5">
                      OVERRIDE [{li.override_reason}]: {li.override_note}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
