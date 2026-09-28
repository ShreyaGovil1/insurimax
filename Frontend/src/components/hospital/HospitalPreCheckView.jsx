import React, { useState, useEffect } from "react"
import {
  Building2,
  FileCheck2,
  AlertTriangle,
  CheckCircle2,
  Upload,
  ArrowRight,
  Sparkles,
  ShieldAlert,
  Percent,
  FileText,
  FileCode,
  Zap,
  TrendingDown,
  Info,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { api } from "../../services/api"
import { formatCurrencyINR } from "../../lib/utils"
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import { Input } from "../ui/input"
import { useToast } from "../ui/toast"

const QUICK_SCENARIOS = [
  {
    name: "Apollo Cardiology",
    patient: "Ramesh Chawla",
    hospital: "Apollo Hospital, Bannerghatta",
    insurer: "Star Health & Allied Insurance",
    policy: "SH-GOLD-99201",
    amount: "173500",
    tag: "High Deductions Risk",
  },
  {
    name: "Fortis Orthopedic",
    patient: "Sunita Deshmukh",
    hospital: "Fortis Hospital, Cunningham Rd",
    insurer: "HDFC ERGO General Insurance",
    policy: "HD-OPT-44120",
    amount: "245000",
    tag: "Implant GIPSA Ceiling",
  },
  {
    name: "Max Daycare Cataract",
    patient: "Anand Verma",
    hospital: "Max Super Speciality Hospital",
    insurer: "Care Health Insurance",
    policy: "CARE-ADV-88310",
    amount: "48000",
    tag: "Fast-Track Auto Approve",
  },
]

export function HospitalPreCheckView({ onClaimCreated }) {
  const { toast } = useToast()
  let navigate = () => {}
  try {
    navigate = useNavigate()
  } catch {}
  const [running, setRunning] = useState(false)
  const [preCheckResult, setPreCheckResult] = useState(null)
  const [templates, setTemplates] = useState([])
  const [uploadedFile, setUploadedFile] = useState(null)
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

  const applyScenario = (sc) => {
    setForm({
      patient_name: sc.patient,
      hospital_name: sc.hospital,
      insurer_name: sc.insurer,
      policy_number: sc.policy,
      billed_amount: sc.amount,
    })
    setPreCheckResult(null)
    toast({
      title: `Scenario Loaded: ${sc.name}`,
      description: `Billed: ₹${Number(sc.amount).toLocaleString("en-IN")}`,
      variant: "default",
    })
  }

  const handleRunPreCheck = async (e) => {
    e?.preventDefault?.()
    setRunning(true)
    try {
      const formData = new FormData()
      formData.append("patient_name", form.patient_name)
      formData.append("hospital_name", form.hospital_name)
      formData.append("insurer_name", form.insurer_name)
      formData.append("policy_number", form.policy_number)
      formData.append("billed_amount", form.billed_amount)
      if (uploadedFile) {
        formData.append("bill_file", uploadedFile)
      }

      const result = await api.hospital.runPreCheck(formData)
      setPreCheckResult(result)
      toast({
        title: "Pre-Audit Simulation Complete",
        description: "Checked against IRDAI Non-Payable list & GIPSA package ceilings.",
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
      if (onClaimCreated) onClaimCreated(newClaim)
      if (newClaim?.id && navigate) {
        navigate(`/claims/${newClaim.id}`)
      }
    } catch (err) {
      toast({
        title: "Submission Failed",
        description: err.message,
        variant: "destructive",
      })
    }
  }

  // Calculate percentages for visual progress bar
  const billedVal = parseFloat(form.billed_amount) || 1
  const approvedVal = preCheckResult?.estimated_approved_amount ?? 148200
  const deductionVal = preCheckResult?.estimated_deductions ?? 25300
  const approvedPct = Math.min(100, Math.max(0, Math.round((approvedVal / (approvedVal + deductionVal)) * 100)))
  const deductionPct = 100 - approvedPct

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 py-4">
      
      {/* Top Header & Scenario Quick-Pills */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-1.5 rounded-full bg-slate-900 text-[#A3FF12]">
              <Building2 className="w-4 h-4" />
            </span>
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Hospital Pre-Audit Desk</h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Audit itemized charges against IRDAI Non-Payable items & tariff caps before official TPA filing.
          </p>
        </div>

        {/* 1-Click Test Scenarios */}
        <div className="flex items-center space-x-2 overflow-x-auto pb-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider hidden lg:inline">Quick Test:</span>
          {QUICK_SCENARIOS.map((sc) => (
            <button
              key={sc.name}
              type="button"
              onClick={() => applyScenario(sc)}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white hover:bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700 shadow-2xs whitespace-nowrap cursor-pointer transition-all hover:border-slate-300"
            >
              <span>{sc.name}</span>
              <span className="text-[10px] text-slate-400 font-mono">₹{(Number(sc.amount) / 1000).toFixed(0)}k</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Column: Form & Bill Dropzone (6 cols) */}
        <div className="lg:col-span-6 space-y-4">
          <Card className="rounded-3xl border-slate-200/80 shadow-xs">
            <CardHeader className="pb-3 border-b border-slate-100/80">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold flex items-center space-x-2">
                  <FileCheck2 className="w-4 h-4 text-slate-900" />
                  <span>Draft Claim Details</span>
                </CardTitle>
                <Badge variant="secondary" className="text-[10px] font-semibold">
                  Step 1 of 2
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="p-5">
              <form onSubmit={handleRunPreCheck} className="space-y-4 text-xs">
                
                {/* Patient Name */}
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Patient Full Name</label>
                  <Input
                    value={form.patient_name}
                    onChange={(e) => setForm({ ...form, patient_name: e.target.value })}
                    required
                    className="rounded-xl h-10 border-slate-200 text-xs font-medium"
                  />
                </div>

                {/* Hospital & Insurer */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Hospital Provider</label>
                    <Input
                      value={form.hospital_name}
                      onChange={(e) => setForm({ ...form, hospital_name: e.target.value })}
                      required
                      className="rounded-xl h-10 border-slate-200 text-xs"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Payer / Insurer</label>
                    <Input
                      value={form.insurer_name}
                      onChange={(e) => setForm({ ...form, insurer_name: e.target.value })}
                      className="rounded-xl h-10 border-slate-200 text-xs"
                    />
                  </div>
                </div>

                {/* Policy & Billed Amount */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Health Policy Number</label>
                    <Input
                      value={form.policy_number}
                      onChange={(e) => setForm({ ...form, policy_number: e.target.value })}
                      className="rounded-xl h-10 border-slate-200 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">Billed Amount (₹)</label>
                    <Input
                      type="number"
                      value={form.billed_amount}
                      onChange={(e) => setForm({ ...form, billed_amount: e.target.value })}
                      required
                      className="rounded-xl h-10 border-slate-200 text-xs font-semibold text-slate-900"
                    />
                  </div>
                </div>

                {/* File Dropzone */}
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Draft Hospital Bill / Breakdown</label>
                  <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-200 hover:border-slate-400 bg-slate-50/60 hover:bg-slate-50 rounded-2xl cursor-pointer transition-colors group">
                    <Upload className="w-5 h-5 text-slate-400 group-hover:text-slate-700 mb-1 transition-colors" />
                    <span className="text-xs font-semibold text-slate-700">
                      {uploadedFile ? uploadedFile.name : "Drop bill PDF / image here or Browse"}
                    </span>
                    <span className="text-[10px] text-slate-400 mt-0.5">Supports PDF, JPG, PNG up to 10MB</span>
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => setUploadedFile(e.target.files?.[0] || null)}
                    />
                  </label>
                </div>

                {/* Submit Action */}
                <div className="pt-2">
                  <Button
                    type="submit"
                    disabled={running}
                    className="w-full h-11 rounded-full text-xs font-bold bg-slate-950 hover:bg-slate-800 text-white gap-2 shadow-xs cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4 text-[#A3FF12]" />
                    <span>{running ? "Simulating Audit with Gemini 1.5 Pro..." : "Run Pre-Submission Audit"}</span>
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Clean Interactive Templates Guide */}
          <Card className="rounded-3xl border-slate-200/80 shadow-xs">
            <CardHeader className="pb-2.5">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Standardized Billing Templates
                </CardTitle>
                <span className="text-[10px] text-slate-400 font-medium">IRDAI Master List</span>
              </div>
            </CardHeader>
            <CardContent className="p-5 pt-0 space-y-2.5">
              {templates.map((tpl, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100/70 border border-slate-200/70 rounded-2xl text-xs transition-colors"
                >
                  <div className="flex items-center space-x-2.5">
                    <div className="p-2 rounded-xl bg-white border border-slate-200/80 text-slate-700">
                      <FileText className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900">{tpl.name}</div>
                      <div className="text-[11px] text-slate-500 line-clamp-1">{tpl.description}</div>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] rounded-full px-2 py-0.5 font-mono">
                    {tpl.format}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Visual Findings & Admissibility Meter (6 cols) */}
        <div className="lg:col-span-6 space-y-4">
          {preCheckResult ? (
            <Card className="rounded-3xl border-slate-200/80 shadow-sm overflow-hidden">
              
              {/* Financial Hero Header (Fintech Dark Card) */}
              <div className="p-6 bg-slate-950 text-white rounded-t-3xl relative overflow-hidden">
                <div className="relative z-10 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                      Simulation Result
                    </span>
                    <Badge variant="lime" className="text-[10px] px-2 py-0.5">
                      Check ID: {preCheckResult.check_id}
                    </Badge>
                  </div>

                  {/* Admissible Big Number */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-xs text-slate-400 block font-medium">Est. Admissible</span>
                      <span className="text-3xl font-extrabold text-[#A3FF12] tracking-tight">
                        {formatCurrencyINR(preCheckResult.estimated_approved_amount)}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-slate-400 block font-medium">Deductions Risk</span>
                      <span className="text-2xl font-bold text-purple-400 tracking-tight">
                        -{formatCurrencyINR(preCheckResult.estimated_deductions)}
                      </span>
                    </div>
                  </div>

                  {/* Split Visual Progress Bar */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex justify-between text-[11px] text-slate-400 font-semibold">
                      <span>Admissible: {approvedPct}%</span>
                      <span>Deductions: {deductionPct}%</span>
                    </div>
                    <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden flex p-0.5">
                      <div
                        style={{ width: `${approvedPct}%` }}
                        className="h-full bg-[#A3FF12] rounded-full transition-all duration-500"
                      />
                      <div
                        style={{ width: `${deductionPct}%` }}
                        className="h-full bg-[#8B5CF6] rounded-full ml-1 progress-hatched transition-all duration-500"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Deduction Analysis Cards */}
              <CardContent className="p-6 space-y-4 text-xs">
                
                {/* Detected Issues */}
                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="font-bold text-slate-900 flex items-center space-x-1.5">
                      <ShieldAlert className="w-4 h-4 text-amber-500" />
                      <span>Anticipated Deductions ({preCheckResult.detected_issues?.length || 0})</span>
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">Pre-Submission Shield</span>
                  </div>

                  <div className="space-y-2">
                    {preCheckResult.detected_issues?.map((iss, idx) => (
                      <div
                        key={idx}
                        className="p-3.5 bg-slate-50 hover:bg-slate-100/70 border border-slate-200/80 rounded-2xl transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900 text-xs">{iss.item}</span>
                          <span className="font-bold text-purple-600 font-mono">
                            -{formatCurrencyINR(iss.deduction_inr)}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{iss.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Billing Desk Advice */}
                <div className="p-4 rounded-2xl bg-blue-50/70 border border-blue-100">
                  <div className="flex items-center space-x-1.5 text-blue-900 font-bold text-xs mb-1.5">
                    <Info className="w-3.5 h-3.5 text-blue-600" />
                    <span>How to Avoid Deductions:</span>
                  </div>
                  <ul className="space-y-1 text-slate-700 text-[11px] list-disc list-inside">
                    {preCheckResult.suggestions?.map((sug, i) => (
                      <li key={i}>{sug}</li>
                    ))}
                  </ul>
                </div>

                {/* Convert to Formal Claim CTA */}
                <div className="pt-2">
                  <Button
                    onClick={handleConvertToFormalClaim}
                    className="w-full h-11 rounded-full text-xs font-bold bg-[#A3FF12] hover:bg-[#8ee408] text-slate-950 gap-2 shadow-xs cursor-pointer"
                  >
                    <span>Submit as Formal Claim (Start 3h SLA)</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            /* Empty State: Sleek Fintech Placeholder */
            <div className="fintech-card p-12 text-center text-slate-500 space-y-4">
              <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                <FileCheck2 className="w-6 h-6" />
              </div>
              <div className="space-y-1 max-w-sm mx-auto">
                <h3 className="text-sm font-bold text-slate-900">Run Pre-Audit Simulation</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Select a quick test scenario above or enter draft bill details, then click "Run Pre-Submission Audit" to see instant deduction risk analysis.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleRunPreCheck()}
                className="rounded-full text-xs font-semibold"
              >
                <Zap className="w-3.5 h-3.5 mr-1 text-blue-600" />
                <span>Simulate Demo Bill</span>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
