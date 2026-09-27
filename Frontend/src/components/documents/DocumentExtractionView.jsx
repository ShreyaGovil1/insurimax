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
} from "lucide-react"
import { api } from "../../services/api"
import { formatCurrencyINR } from "../../lib/utils"
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import { Input } from "../ui/input"
import { useToast } from "../ui/toast"

export function DocumentExtractionView({ claimId }) {
  const { toast } = useToast()
  const [documents, setDocuments] = useState([])
  const [extractedData, setExtractedData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)
  const [docType, setDocType] = useState("itemized_bill")
  const [isEditingPayload, setIsEditingPayload] = useState(false)
  const [editedPayloadJson, setEditedPayloadJson] = useState("")

  const loadDocumentsAndData = async () => {
    setLoading(true)
    try {
      const [docs, data] = await Promise.all([
        api.documents.list(claimId),
        api.documents.getExtractedData(claimId),
      ])
      setDocuments(docs || [])
      setExtractedData(data)
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

      await api.documents.upload(claimId, formData)
      toast({
        title: "Document Uploaded",
        description: "File uploaded to storage. OCR extraction queued.",
        variant: "success",
      })
      setSelectedFile(null)
      loadDocumentsAndData()
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
    try {
      await api.documents.triggerExtraction(claimId, docId)
      toast({
        title: "Extraction Triggered",
        description: "Gemini multimodal OCR is parsing itemized fields.",
        variant: "success",
      })
      loadDocumentsAndData()
    } catch (err) {
      toast({
        title: "Extraction Failed",
        description: err.message,
        variant: "destructive",
      })
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

  return (
    <div className="space-y-6">
      {/* Upload Box */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center space-x-2">
            <Upload className="w-4 h-4 text-blue-600" />
            <span>Upload Claim Documents & Medical Records</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpload} className="flex flex-col sm:flex-row items-center gap-3">
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="text-xs p-2 border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500 w-full sm:w-56"
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
              onChange={(e) => setSelectedFile(e.target.files[0])}
              className="text-xs cursor-pointer"
            />

            <Button
              type="submit"
              disabled={uploading || !selectedFile}
              className="w-full sm:w-auto text-xs font-semibold bg-blue-600 hover:bg-blue-700 whitespace-nowrap"
            >
              {uploading ? "Uploading..." : "Upload & Analyze"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Uploaded Documents List */}
      <Card>
        <CardHeader className="pb-3 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Claim Documents & OCR Status</CardTitle>
            <span className="text-xs text-slate-500">{documents.length} files attached</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {documents.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              No documents uploaded yet for this claim.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="p-3.5 px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 transition-colors text-xs"
                >
                  <div className="flex items-start space-x-3">
                    <div className="p-2 bg-blue-50 text-blue-600 rounded-lg shrink-0 mt-0.5">
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

                  <div className="flex items-center space-x-2">
                    <Badge
                      variant={doc.extraction_status === "completed" ? "success" : "secondary"}
                      className="text-[10px] capitalize"
                    >
                      {doc.extraction_status || "completed"}
                    </Badge>

                    {doc.extraction_confidence && (
                      <span className="text-[11px] font-bold text-slate-700">
                        {Math.round(doc.extraction_confidence * 100)}% OCR Conf
                      </span>
                    )}

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleTriggerExtraction(doc.id)}
                      className="h-7 text-[11px] gap-1"
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

      {/* Extracted Structured Bill Data Viewer & Correction Editor */}
      <Card>
        <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <span>Multimodal Extracted Bill Data</span>
            </CardTitle>
            <p className="text-xs text-slate-500">
              Parsed from hospital bills. Manual adjuster adjustments override raw model extraction.
            </p>
          </div>

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
                <span>Adjust Data</span>
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-4">
          {isEditingPayload ? (
            <textarea
              value={editedPayloadJson}
              onChange={(e) => setEditedPayloadJson(e.target.value)}
              className="w-full font-mono text-xs p-3 border border-slate-300 rounded-lg h-60 focus:ring-1 focus:ring-blue-500"
            />
          ) : (
            <pre className="font-mono text-xs bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto max-h-72">
              {JSON.stringify(extractedData, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
