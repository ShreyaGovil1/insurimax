import React, { useState, useEffect } from "react"
import {
  Building2,
  FileCheck2,
  AlertTriangle,
  CheckCircle2,
  Upload,
  ArrowRight,
  Download,
  Sparkles,
  ShieldAlert,
} from "lucide-react"
import { api } from "../../services/api"
import { formatCurrencyINR } from "../../lib/utils"
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import { Input } from "../ui/input"
import { useToast } from "../ui/toast"

export function HospitalPreCheckView({ onClaimCreated }) {
  const { toast } = useToast()
  const [running, setRunning] = useState(false)
  const [preCheckResult, setPreCheckResult] = useState(null)
  const [templates, setTemplates] = useState([])
  const [form, setForm] = useState({
    patient_name: "Ramesh Chawla",
    hospital_name: "Apollo Hospital, Bannerghatta",
    insurer_name: "Star Health & Allied Insurance",
    policy_number: "SH-GOLD-99201",
    billed_amount: "173500",
  })

  useEffect(() => {
    api.hospital.getSubmissionTemplates().then((res) => {
      setTemplates(res?.templates || [])
    })
  }, [])

  const handleRunPreCheck = async (e) => {
    e.preventDefault()
    setRunning(true)
    try {
      const formData = new FormData()
      formData.append("patient_name", form.patient_name)
      formData.append("hospital_name", form.hospital_name)
      formData.append("insurer_name", form.insurer_name)
      formData.append("policy_number", form.policy_number)
      formData.append("billed_amount", form.billed_amount)

      const result = await api.hospital.runPreCheck(formData)
      setPreCheckResult(result)
      toast({
        title: "Pre-Submission Audit Complete",
        description: "Evaluated against IRDAI Non-Payable items and room rent caps.",
        variant: "info",
      })
    } catch (err) {
      toast({
        title: "Pre-Check Failed",
        description: err.message,
        variant: "destructive",
      })
    } finally {
      setRunning(false)
    }
  }

  const handleConvertToFormalClaim = async () => {
    try {
      const newClaim = await api.claims.create({
        patient_name: form.patient_name,
        hospital_name: form.hospital_name,
        insurer_name: form.insurer_name,
        policy_number: form.policy_number,
        billed_amount: parseFloat(form.billed_amount) || null,
        adjuster_notes: "Converted from hospital pre-submission audit check " + preCheckResult?.check_id,
      })
      toast({
        title: "Formal Claim Registered",
        description: `Claim ${newClaim.claim_number} logged! 3-Hour SLA initiated.`,
        variant: "success",
      })
      onClaimCreated?.(newClaim)
    } catch (err) {
      toast({
        title: "Submission Failed",
        description: err.message,
        variant: "destructive",
      })
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-6 py-6">
      {/* Header */}
      <div>
        <div className="flex items-center space-x-2">
          <Building2 className="w-5 h-5 text-blue-600" />
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Hospital Pre-Submission Audit Desk</h1>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Screen itemized bills and patient policies BEFORE filing. Catch deduction risks, format OCR dark data, and expedite IRDAI 30-minute approval.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Pre-Check Form (6 cols) */}
        <div className="lg:col-span-6 space-y-4">
          <Card>
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="text-sm font-semibold flex items-center space-x-2">
                <FileCheck2 className="w-4 h-4 text-blue-600" />
                <span>Simulate Claim Pre-Audit</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <form onSubmit={handleRunPreCheck} className="space-y-3 text-xs">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Patient Name</label>
                  <Input
                    value={form.patient_name}
                    onChange={(e) => setForm({ ...form, patient_name: e.target.value })}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Hospital Name</label>
                    <Input
                      value={form.hospital_name}
                      onChange={(e) => setForm({ ...form, hospital_name: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Insurer Name</label>
                    <Input
                      value={form.insurer_name}
                      onChange={(e) => setForm({ ...form, insurer_name: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Policy Number</label>
                    <Input
                      value={form.policy_number}
                      onChange={(e) => setForm({ ...form, policy_number: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Preliminary Billed Amount (₹)</label>
                    <Input
                      type="number"
                      value={form.billed_amount}
                      onChange={(e) => setForm({ ...form, billed_amount: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Upload Draft Hospital Bill (PDF/Image)</label>
                  <Input type="file" className="cursor-pointer" />
                </div>

                <div className="pt-2">
                  <Button
                    type="submit"
                    disabled={running}
                    className="w-full text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white gap-2"
                  >
                    <Sparkles className="w-4 h-4 text-blue-200" />
                    <span>{running ? "Simulating Audit with Gemini..." : "Run Pre-Submission Audit"}</span>
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Standard Submission Templates Guide */}
          <Card>
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="text-sm font-semibold">Standardized Hospital Templates</CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              {templates.map((tpl, i) => (
                <div key={i} className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{tpl.name}</span>
                    <Badge variant="outline" className="text-[10px]">{tpl.format}</Badge>
                  </div>
                  <p className="text-slate-600 text-[11px] leading-relaxed">{tpl.description}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Pre-Check Findings (6 cols) */}
        <div className="lg:col-span-6 space-y-4">
          {preCheckResult ? (
            <Card className="border-blue-200 shadow-md">
              <CardHeader className="p-4 pb-3 bg-gradient-to-r from-blue-900 to-indigo-950 text-white rounded-t-xl">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-blue-300">
                    Pre-Audit Risk Analysis
                  </span>
                  <Badge variant="info" className="text-[10px] bg-blue-400/20 text-blue-200">
                    ID: {preCheckResult.check_id}
                  </Badge>
                </div>
                <CardTitle className="text-base text-white mt-1">
                  Estimated Admissible: {formatCurrencyINR(preCheckResult.estimated_approved_amount)}
                </CardTitle>
                <div className="text-xs text-red-300 mt-0.5">
                  Anticipated Deductions: {formatCurrencyINR(preCheckResult.estimated_deductions)}
                </div>
              </CardHeader>

              <CardContent className="p-4 space-y-4 text-xs">
                {/* Detected Issues */}
                <div>
                  <h4 className="font-bold text-slate-900 mb-2 flex items-center space-x-1.5">
                    <ShieldAlert className="w-4 h-4 text-amber-600" />
                    <span>Likely Deductions Caught in Advance:</span>
                  </h4>
                  <div className="space-y-2">
                    {preCheckResult.detected_issues?.map((iss, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-red-50/70 border border-red-200 rounded-lg text-slate-800"
                      >
                        <div className="flex justify-between font-bold text-red-900">
                          <span>{iss.item}</span>
                          <span>-{formatCurrencyINR(iss.deduction_inr)}</span>
                        </div>
                        <div className="text-[11px] text-slate-600 mt-1">{iss.reason}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Suggestions to avoid rejection */}
                <div>
                  <h4 className="font-bold text-slate-900 mb-2">Billing Desk Recommendations:</h4>
                  <ul className="space-y-1.5 list-disc list-inside text-slate-700 text-[11px]">
                    {preCheckResult.suggestions?.map((sug, i) => (
                      <li key={i}>{sug}</li>
                    ))}
                  </ul>
                </div>

                {/* Convert to Claim CTA */}
                <div className="pt-3 border-t border-slate-200">
                  <Button
                    onClick={handleConvertToFormalClaim}
                    className="w-full text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                  >
                    <span>Proceed & Submit Formal Claim Now</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                  <p className="text-[10px] text-center text-slate-400 mt-2">
                    Links pre-check verification audit trail to the TPA claim dossier.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="p-12 text-center text-slate-400 text-xs">
              <FileCheck2 className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <span>Fill patient billing details on the left and run pre-check to preview deduction warnings.</span>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
