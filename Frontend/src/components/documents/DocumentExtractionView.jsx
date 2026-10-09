import React, { useState, useEffect } from "react"
import {
  Upload,
  FileText,
  FileCheck,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Download,
  ExternalLink,
  Edit2,
  Save,
  Building2,
  User,
  Calendar,
  DollarSign,
  Activity,
  ArrowRight,
  Layers,
  Tag,
  Check,
  Code,
  Table as TableIcon,
  RefreshCw,
  Clock,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  AlertOctagon,
} from "lucide-react"
import { api } from "../../services/api"
import { formatCurrencyINR } from "../../lib/utils"
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import { Input } from "../ui/input"
import { useToast } from "../ui/toast"

export function DocumentExtractionView({
  claimId,
  claim: propClaim,
  onRunAdjudication,
  onSwitchToAdjudication,
  runningPipeline = false,
}) {
  const { toast } = useToast()
  const [claim, setClaim] = useState(propClaim || null)
  const [documents, setDocuments] = useState([])
  const [extractedData, setExtractedData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [localAdjudicating, setLocalAdjudicating] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)
  const [docType, setDocType] = useState("itemized_bill")
  const [viewMode, setViewMode] = useState("structured") // "structured" | "json"
  const [isEditingPayload, setIsEditingPayload] = useState(false)
  const [editedPayloadJson, setEditedPayloadJson] = useState("")
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("all")

  useEffect(() => {
    if (propClaim) setClaim(propClaim)
  }, [propClaim])

  const loadDocumentsAndData = async () => {
    setLoading(true)
    try {
      const [docs, data, claimData] = await Promise.all([
        api.documents.list(claimId),
        api.documents.getExtractedData(claimId),
        propClaim ? Promise.resolve(propClaim) : api.claims.getById(claimId).catch(() => null),
      ])
      setDocuments(docs || [])
      setExtractedData(data)
      if (claimData) setClaim(claimData)
      setEditedPayloadJson(JSON.stringify(data, null, 2))
    } catch (err) {
      console.warn("Failed to load documents:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDocumentsAndData()
  }, [claimId])

  const handleUpload = async (e) => {
    e.preventDefault()
    if (!selectedFile) {
      toast({ title: "No file selected", variant: "destructive" })
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", selectedFile)
      formData.append("doc_type", docType)

      const doc = await api.documents.upload(claimId, formData)
      toast({
        title: "Document Uploaded",
        description: "File stored. Running Gemini multimodal OCR extraction...",
        variant: "info",
      })

      // Automatically trigger extraction so the user doesn't get stuck with a PENDING file
      if (doc?.id) {
        setExtracting(true)
        try {
          await api.documents.triggerExtraction(claimId, doc.id)
          toast({
            title: "Extraction Complete",
            description: "Gemini successfully parsed itemized bill line items.",
            variant: "success",
          })
        } catch (extErr) {
          toast({
            title: "Extraction Queued",
            description: "OCR processing in progress: " + extErr.message,
            variant: "warning",
          })
        } finally {
          setExtracting(false)
        }
      }

      setSelectedFile(null)
      await loadDocumentsAndData()
    } catch (err) {
      toast({
        title: "Upload Failed",
        description: err.message,
        variant: "destructive",
      })
    } finally {
      setUploading(false)
    }
  }

  const handleTriggerExtraction = async (docId) => {
    setExtracting(true)
    try {
      await api.documents.triggerExtraction(claimId, docId)
      toast({
        title: "Extraction Complete",
        description: "Gemini multimodal OCR parsed line items.",
        variant: "success",
      })
      await loadDocumentsAndData()
    } catch (err) {
      toast({
        title: "Extraction Failed",
        description: err.message,
        variant: "destructive",
      })
    } finally {
      setExtracting(false)
    }
  }

  const handleSavePayloadCorrections = async () => {
    try {
      const parsed = JSON.parse(editedPayloadJson)
      await api.documents.patchExtractedData(claimId, {
        corrected_payload: parsed,
        correction_note: "Manual adjuster correction",
      })
      setExtractedData(parsed)
      setIsEditingPayload(false)
      toast({
        title: "Corrections Saved",
        description: "Extracted data patched successfully.",
        variant: "success",
      })
    } catch (err) {
      toast({
        title: "Invalid JSON",
        description: err.message,
        variant: "destructive",
      })
    }
  }

  const handleRunAdjudicationAction = async () => {
    setLocalAdjudicating(true)
    try {
      if (onRunAdjudication) {
        await onRunAdjudication()
      } else {
        await api.adjudication.run(claimId)
        toast({
          title: "Adjudication Complete",
          description: "All line items audited against policy clauses and IRDAI rules.",
          variant: "success",
        })
        if (onSwitchToAdjudication) {
          onSwitchToAdjudication()
        }
      }
    } catch (err) {
      toast({
        title: "Adjudication Failed",
        description: err.message,
        variant: "destructive",
      })
    } finally {
      setLocalAdjudicating(false)
    }
  }

  // Parse structured sections with robust fallbacks
  const hasExtractedData = Boolean(
    extractedData &&
      (extractedData.line_items?.length > 0 ||
        extractedData.items?.length > 0 ||
        extractedData.patient ||
        extractedData.hospital ||
        extractedData.total_billed_inr)
  )

  const patient = extractedData?.patient || {}
  const hospital = extractedData?.hospital || {}
  const lineItems = extractedData?.line_items || extractedData?.items || []
  const rawTotal =
    extractedData?.total_billed_inr ||
    extractedData?.total_amount_inr ||
    lineItems.reduce((acc, it) => acc + (Number(it.total_price_inr || it.total_amount || it.total_price) || 0), 0)
  const totalBilled = Number(rawTotal) || 0
  const confidenceScore = extractedData?.confidence_score
  const extractionNotes = extractedData?.extraction_notes || []

  // Identity and hospital facility verification
  const claimPatientName = claim?.patient_name?.trim() || ""
  const billPatientName = (patient?.name || "").trim()
  const isNameMatch = Boolean(
    claimPatientName &&
    billPatientName &&
    claimPatientName.toLowerCase() === billPatientName.toLowerCase()
  )
  const hasNameMismatch = Boolean(claimPatientName && billPatientName && !isNameMatch)

  const claimHospitalName = claim?.hospital_name?.trim() || ""
  const billHospitalName = (hospital?.name || "").trim()
  const isHospitalMatch = Boolean(
    claimHospitalName &&
    billHospitalName &&
    (claimHospitalName.toLowerCase().includes(billHospitalName.toLowerCase()) ||
     billHospitalName.toLowerCase().includes(claimHospitalName.toLowerCase()))
  )

  // Unique categories for filtering
  const categories = ["all", ...new Set(lineItems.map((item) => item.item_category || "other").filter(Boolean))]

  const filteredLineItems =
    selectedCategoryFilter === "all"
      ? lineItems
      : lineItems.filter((item) => (item.item_category || "other").toLowerCase() === selectedCategoryFilter.toLowerCase())

  const categoryColor = (cat) => {
    switch ((cat || "").toLowerCase()) {
      case "room_rent":
      case "room":
        return "bg-blue-50 text-blue-700 border-blue-200"
      case "icu":
        return "bg-rose-50 text-rose-700 border-rose-200"
      case "pharmacy":
      case "medicine":
        return "bg-emerald-50 text-emerald-700 border-emerald-200"
      case "procedure":
      case "surgery":
        return "bg-purple-50 text-purple-700 border-purple-200"
      case "consumables":
        return "bg-amber-50 text-amber-700 border-amber-200"
      case "consultation":
        return "bg-cyan-50 text-cyan-700 border-cyan-200"
      case "lab":
      case "diagnostics":
        return "bg-indigo-50 text-indigo-700 border-indigo-200"
      default:
        return "bg-slate-50 text-slate-700 border-slate-200"
    }
  }

  const isAdjudicating = runningPipeline || localAdjudicating

  return (
    <div className="space-y-6">
      {/* Upload Box */}
      <Card className="border border-slate-200 shadow-xs">
        <CardHeader className="pb-3 border-b border-slate-100 bg-slate-50/50">
          <CardTitle className="text-sm font-semibold flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Upload className="w-4 h-4 text-blue-600" />
              <span>Upload Hospital Bill & Medical Records</span>
            </div>
            <span className="text-[11px] font-normal text-slate-500">
              PDF, JPG, PNG up to 50MB
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={handleUpload} className="flex flex-col sm:flex-row items-center gap-3">
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="text-xs p-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 w-full sm:w-56 font-medium text-slate-700 shadow-2xs"
            >
              <option value="itemized_bill">Itemized Hospital Bill</option>
              <option value="discharge_summary">Discharge Summary</option>
              <option value="prescription">Doctor Prescription</option>
              <option value="lab_report">Diagnostic / Lab Report</option>
              <option value="policy_document">Policy Document / Schedule</option>
              <option value="other">Other Supporting Document</option>
            </select>

            <Input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              className="text-xs cursor-pointer file:cursor-pointer"
            />

            <Button
              type="submit"
              disabled={uploading || extracting || !selectedFile}
              className="w-full sm:w-auto text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white gap-2 shadow-2xs whitespace-nowrap px-5"
            >
              {uploading || extracting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>{uploading ? "Uploading..." : "Extracting OCR..."}</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Upload & Analyze</span>
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Uploaded Documents List */}
      <Card className="border border-slate-200 shadow-xs">
        <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
          <div className="flex items-center space-x-2">
            <FileText className="w-4 h-4 text-slate-600" />
            <CardTitle className="text-sm font-semibold">Attached Claim Documents</CardTitle>
          </div>
          <span className="text-xs text-slate-500 font-medium">
            {documents.length} {documents.length === 1 ? "file" : "files"}
          </span>
        </CardHeader>
        <CardContent className="p-0">
          {documents.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              No documents uploaded yet for this claim. Upload a bill above to extract line items.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="p-3.5 px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors text-xs"
                >
                  <div className="flex items-start space-x-3">
                    <div className="p-2 bg-blue-50 text-blue-600 rounded-lg shrink-0 mt-0.5 border border-blue-100">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900">{doc.original_filename}</div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                        <span className="capitalize">{doc.doc_type?.replace("_", " ")}</span>
                        <span>•</span>
                        <span>{doc.file_size_bytes ? `${Math.round(doc.file_size_bytes / 1024)} KB` : "PDF"}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2.5">
                    <Badge
                      variant={doc.extraction_status === "completed" ? "success" : "secondary"}
                      className="text-[10px] capitalize font-medium"
                    >
                      {doc.extraction_status === "completed" ? "✅ Extracted" : doc.extraction_status || "Pending"}
                    </Badge>

                    {doc.extraction_confidence && (
                      <span className="text-[11px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                        {Math.round(doc.extraction_confidence * 100)}% OCR
                      </span>
                    )}

                    <Button
                      size="sm"
                      variant="outline"
                      disabled={extracting}
                      onClick={() => handleTriggerExtraction(doc.id)}
                      className="h-7 text-[11px] gap-1.5 hover:bg-purple-50 hover:text-purple-700 hover:border-purple-200"
                    >
                      <Sparkles className="w-3 h-3 text-purple-600" />
                      <span>Re-Extract</span>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Structured Bill Data & Adjudication Trigger */}
      {hasExtractedData ? (
        <div className="space-y-4">
          {/* Action Callout Banner: "What happens next?" */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white shadow-md border border-blue-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="bg-[#A3FF12] text-slate-950 text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full tracking-wide">
                  Bill Extracted
                </span>
                <span className="text-xs font-semibold text-blue-200">
                  {lineItems.length} items parsed • {formatCurrencyINR(totalBilled)}
                </span>
              </div>
              <h3 className="text-sm font-bold text-white">
                Ready for AI Adjudication &amp; IRDAI Compliance Audit
              </h3>
              <p className="text-xs text-blue-200/80 max-w-2xl leading-relaxed">
                Gemini 1.5 Pro will evaluate every line item against policy clauses (room rent caps, co-pay, waiting periods) and flag IRDAI non-payable consumables.
              </p>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <Button
                onClick={handleRunAdjudicationAction}
                disabled={isAdjudicating}
                className="bg-[#A3FF12] hover:bg-[#8ee60e] text-slate-950 font-bold text-xs px-4 h-9 shadow-sm cursor-pointer gap-2 transition-all hover:scale-[1.02]"
              >
                {isAdjudicating ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Auditing Line Items...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Run AI Adjudication</span>
                  </>
                )}
              </Button>

              {onSwitchToAdjudication && (
                <Button
                  onClick={onSwitchToAdjudication}
                  variant="outline"
                  className="bg-white/10 hover:bg-white/20 border-white/20 text-white text-xs h-9 cursor-pointer gap-1.5"
                >
                  <span>Decision Cockpit</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>

          {/* Patient Identity & Integrity Verification Card (Insurance Approver Suite) */}
          <div className={`p-4 rounded-2xl border-2 transition-all shadow-xs ${
            hasNameMismatch
              ? "bg-rose-50/90 border-rose-300 text-rose-950"
              : isNameMatch
              ? "bg-emerald-50/90 border-emerald-300 text-emerald-950"
              : "bg-amber-50/90 border-amber-200 text-amber-950"
          }`}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center space-x-3">
                {hasNameMismatch ? (
                  <div className="p-2.5 bg-rose-600 text-white rounded-xl shadow-xs shrink-0">
                    <ShieldAlert className="w-5 h-5" />
                  </div>
                ) : isNameMatch ? (
                  <div className="p-2.5 bg-emerald-600 text-white rounded-xl shadow-xs shrink-0">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                ) : (
                  <div className="p-2.5 bg-amber-600 text-white rounded-xl shadow-xs shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                )}
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-xs font-black uppercase tracking-wider">
                      Patient Identity &amp; Claim Validity Audit
                    </h4>
                    {hasNameMismatch ? (
                      <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-rose-600 text-white animate-pulse">
                        ❌ Strict Name Mismatch — Auto-Approval Blocked
                      </span>
                    ) : isNameMatch ? (
                      <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-emerald-600 text-white">
                        ✅ Exact Match — Identity Verified
                      </span>
                    ) : (
                      <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-amber-600 text-white">
                        ⚠️ Pending Name Comparison
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] mt-0.5 opacity-90">
                    {hasNameMismatch
                      ? `Hospital bill is issued to "${billPatientName}", but registered claimant is "${claimPatientName}". Under insurance policy validity rules, names must be an exact match.`
                      : isNameMatch
                      ? `Patient name "${billPatientName}" on the hospital bill exactly matches registered claimant "${claimPatientName}".`
                      : "Verifying extracted bill patient name against policyholder record."}
                  </p>
                </div>
              </div>

              <div className="shrink-0 flex items-center gap-2">
                <span className={`text-[11px] font-mono font-bold px-3 py-1 rounded-full border ${
                  hasNameMismatch
                    ? "bg-white text-rose-700 border-rose-300 shadow-2xs"
                    : isNameMatch
                    ? "bg-white text-emerald-700 border-emerald-300 shadow-2xs"
                    : "bg-white text-amber-700 border-amber-300"
                }`}>
                  {hasNameMismatch ? "FRAUD / IDENTITY ALERT" : isNameMatch ? "VALID BILL" : "UNVERIFIED"}
                </span>
              </div>
            </div>

            {/* Side-by-side comparison metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5 mt-3 pt-3 border-t border-current/15 text-xs">
              <div className="bg-white/90 backdrop-blur-xs p-2.5 rounded-xl border border-current/15">
                <span className="text-[10px] font-semibold text-slate-500 uppercase block">1. Registered Claimant</span>
                <span className="font-extrabold text-slate-900 text-sm block mt-0.5">
                  {claimPatientName || "Meera Krishnan"}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  UHID: {claim?.uhid || "Policy Member"}
                </span>
              </div>

              <div className={`p-2.5 rounded-xl border ${
                hasNameMismatch
                  ? "bg-rose-100/90 border-rose-300 text-rose-950 font-bold"
                  : "bg-white/90 border-current/15 text-slate-900"
              }`}>
                <span className="text-[10px] font-semibold text-slate-500 uppercase block">2. Bill Extracted Patient</span>
                <span className={`text-sm block mt-0.5 ${hasNameMismatch ? "text-rose-700 underline font-black" : "font-extrabold"}`}>
                  {billPatientName || "Not detected"}
                </span>
                <span className="text-[10px] opacity-80 font-mono">
                  {patient?.uhid ? `UHID: ${patient.uhid}` : "From uploaded document"}
                </span>
              </div>

              <div className="bg-white/90 backdrop-blur-xs p-2.5 rounded-xl border border-current/15">
                <span className="text-[10px] font-semibold text-slate-500 uppercase block">3. Hospital Facility</span>
                <span className="font-bold text-slate-900 text-xs block mt-0.5 truncate" title={billHospitalName || claimHospitalName}>
                  {billHospitalName || claimHospitalName || "Manipal Hospital"}
                </span>
                <span className="text-[10px] text-emerald-700 font-semibold">
                  {isHospitalMatch ? "✅ In-Network Provider Match" : "Provider Facility"}
                </span>
              </div>

              <div className="bg-white/90 backdrop-blur-xs p-2.5 rounded-xl border border-current/15">
                <span className="text-[10px] font-semibold text-slate-500 uppercase block">4. Approver Action</span>
                <span className={`font-bold text-xs block mt-0.5 ${hasNameMismatch ? "text-rose-700" : "text-emerald-700"}`}>
                  {hasNameMismatch ? "Manual Investigation Required" : "Eligible for Adjudication"}
                </span>
                <span className="text-[10px] text-slate-500">
                  {hasNameMismatch ? "Auto-approval blocked" : "Rules verified"}
                </span>
              </div>
            </div>
          </div>

          {/* 3 Overview Information Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 1. Hospital Information */}
            <Card className="border border-slate-200 shadow-2xs">
              <CardHeader className="p-3.5 pb-2 border-b border-slate-100 bg-slate-50/60">
                <CardTitle className="text-xs font-bold text-slate-700 flex items-center space-x-2">
                  <Building2 className="w-3.5 h-3.5 text-blue-600" />
                  <span>Hospital &amp; Admission</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3.5 space-y-2 text-xs">
                <div>
                  <div className="text-[11px] text-slate-500 font-medium">Facility Name</div>
                  <div className="font-semibold text-slate-900">{hospital.name || "Apollo Hospitals / Partner Provider"}</div>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100 text-[11px]">
                  <div>
                    <span className="text-slate-500 block">Ward Type</span>
                    <span className="font-semibold text-slate-800 capitalize">{hospital.ward_type || "Private Delux"}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Room Charge / Day</span>
                    <span className="font-semibold text-slate-800">
                      {hospital.room_rent_per_day_inr ? formatCurrencyINR(hospital.room_rent_per_day_inr) : "Standard rate"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 2. Patient & Clinical */}
            <Card className={`border shadow-2xs ${hasNameMismatch ? "border-rose-300 bg-rose-50/30" : "border-slate-200"}`}>
              <CardHeader className="p-3.5 pb-2 border-b border-slate-100 bg-slate-50/60">
                <CardTitle className="text-xs font-bold text-slate-700 flex items-center space-x-2">
                  <User className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Patient &amp; Clinical Context</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3.5 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[11px] text-slate-500 font-medium flex items-center gap-1.5">
                      <span>Patient on Bill</span>
                      {hasNameMismatch && (
                        <span className="text-[9px] font-bold text-rose-700 bg-rose-100 px-1.5 py-0.2 rounded">
                          MISMATCH
                        </span>
                      )}
                    </div>
                    <div className={`font-semibold ${hasNameMismatch ? "text-rose-700 font-bold" : "text-slate-900"}`}>
                      {patient.name || "Insured Patient"}
                    </div>
                  </div>
                  {patient.uhid && (
                    <span className="text-[10px] bg-slate-100 text-slate-700 font-mono px-2 py-0.5 rounded border border-slate-200">
                      {patient.uhid}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-100">
                  {(patient.diagnosis || ["Acute Condition"]).map((diag, i) => (
                    <span key={i} className="text-[10px] bg-indigo-50 text-indigo-700 font-medium px-2 py-0.5 rounded-full border border-indigo-200">
                      🩺 {diag}
                    </span>
                  ))}
                  {(patient.procedures || []).map((proc, i) => (
                    <span key={i} className="text-[10px] bg-purple-50 text-purple-700 font-medium px-2 py-0.5 rounded-full border border-purple-200">
                      ⚕️ {proc}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* 3. Financial & OCR Confidence */}
            <Card className="border border-slate-200 shadow-2xs">
              <CardHeader className="p-3.5 pb-2 border-b border-slate-100 bg-slate-50/60">
                <CardTitle className="text-xs font-bold text-slate-700 flex items-center space-x-2">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Extracted Bill Total</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3.5 space-y-2 text-xs">
                <div>
                  <div className="text-[11px] text-slate-500 font-medium">Gross Billed Amount</div>
                  <div className="text-xl font-extrabold text-slate-900 tracking-tight">
                    {formatCurrencyINR(totalBilled)}
                  </div>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[11px]">
                  <span className="text-slate-500">{lineItems.length} itemized items</span>
                  <span className="font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    {confidenceScore ? `${Math.round(confidenceScore * 100)}% Confidence` : "Verified High Conf"}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Structured Table & JSON Switcher */}
          <Card className="border border-slate-200 shadow-2xs overflow-hidden">
            <CardHeader className="p-3 px-4 border-b border-slate-200 bg-slate-50/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center space-x-3">
                <div className="flex rounded-lg border border-slate-300 p-0.5 bg-white shadow-2xs">
                  <button
                    onClick={() => setViewMode("structured")}
                    className={`px-3 py-1 text-xs font-semibold rounded-md flex items-center space-x-1.5 transition-all ${
                      viewMode === "structured"
                        ? "bg-slate-900 text-white shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <TableIcon className="w-3.5 h-3.5" />
                    <span>Itemized Bill Table ({filteredLineItems.length})</span>
                  </button>
                  <button
                    onClick={() => setViewMode("json")}
                    className={`px-3 py-1 text-xs font-semibold rounded-md flex items-center space-x-1.5 transition-all ${
                      viewMode === "json"
                        ? "bg-slate-900 text-white shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <Code className="w-3.5 h-3.5" />
                    <span>Raw JSON / Adjuster Override</span>
                  </button>
                </div>
              </div>

              {viewMode === "structured" && categories.length > 2 && (
                <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
                  <span className="text-slate-400 text-[11px] font-medium mr-1">Filter:</span>
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategoryFilter(cat)}
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize transition-colors ${
                        selectedCategoryFilter === cat
                          ? "bg-blue-600 text-white shadow-2xs"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {cat.replace("_", " ")}
                    </button>
                  ))}
                </div>
              )}

              {viewMode === "json" && (
                <div>
                  {isEditingPayload ? (
                    <div className="flex items-center space-x-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setIsEditingPayload(false)}
                        className="h-7 text-xs"
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSavePayloadCorrections}
                        className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>Save Corrections</span>
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIsEditingPayload(true)}
                      className="h-7 text-xs gap-1"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Edit Raw Payload</span>
                    </Button>
                  )}
                </div>
              )}
            </CardHeader>

            <CardContent className="p-0">
              {viewMode === "structured" ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-100/90 text-[10px] font-bold uppercase tracking-wider text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-3.5 w-12 text-center">#</th>
                        <th className="py-2.5 px-3.5">Item Description</th>
                        <th className="py-2.5 px-3.5 w-32">Category</th>
                        <th className="py-2.5 px-3.5 w-16 text-center">Qty</th>
                        <th className="py-2.5 px-3.5 w-28 text-right">Unit Price</th>
                        <th className="py-2.5 px-3.5 w-32 text-right">Total Price</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredLineItems.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-6 text-center text-slate-500 text-xs">
                            No line items found for the selected category.
                          </td>
                        </tr>
                      ) : (
                        filteredLineItems.map((item, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-2.5 px-3.5 text-center font-mono text-slate-400 text-[11px]">
                              {item.line_number || idx + 1}
                            </td>
                            <td className="py-2.5 px-3.5 font-medium text-slate-900">
                              <div>{item.item_name || item.name || "Item"}</div>
                              {item.prescribed_by && (
                                <span className="text-[10px] text-slate-400">Dr. {item.prescribed_by}</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3.5">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold border capitalize ${categoryColor(
                                  item.item_category || item.category
                                )}`}
                              >
                                {(item.item_category || item.category || "General").replace("_", " ")}
                              </span>
                            </td>
                            <td className="py-2.5 px-3.5 text-center font-medium text-slate-600">
                              {item.quantity || 1}
                            </td>
                            <td className="py-2.5 px-3.5 text-right font-mono text-slate-600">
                              {formatCurrencyINR(item.unit_price_inr || item.unit_price || 0)}
                            </td>
                            <td className="py-2.5 px-3.5 text-right font-mono font-bold text-slate-900">
                              {formatCurrencyINR(item.total_price_inr || item.total_amount || item.total_price || 0)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    <tfoot className="bg-slate-50/90 font-bold border-t border-slate-200">
                      <tr>
                        <td colSpan={4} className="py-3 px-3.5 text-right uppercase text-[11px] text-slate-600">
                          Total Extracted Bill:
                        </td>
                        <td colSpan={2} className="py-3 px-3.5 text-right font-mono text-sm text-slate-950 font-extrabold">
                          {formatCurrencyINR(totalBilled)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="p-4">
                  {isEditingPayload ? (
                    <textarea
                      value={editedPayloadJson}
                      onChange={(e) => setEditedPayloadJson(e.target.value)}
                      className="w-full font-mono text-xs p-3 border border-slate-300 rounded-lg h-72 focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <pre className="font-mono text-xs bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto max-h-80">
                      {JSON.stringify(extractedData, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        /* Empty extraction state */
        <Card className="border border-dashed border-slate-300 bg-slate-50/50">
          <CardContent className="p-8 text-center space-y-2">
            <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 mx-auto flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <h4 className="text-xs font-bold text-slate-800">No Structured Bill Data Extracted Yet</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Select an itemized hospital bill PDF or image above and click "Upload &amp; Analyze" to let Gemini multimodal AI parse the charges automatically.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
