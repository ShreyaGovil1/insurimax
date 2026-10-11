import { useEffect, useRef, useState } from "react"
import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Circle,
  Code,
  ExternalLink,
  Eye,
  FileImage,
  FileText,
  Loader2,
  Pencil,
  RefreshCw,
  ScanSearch,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Table as TableIcon,
  Trash2,
  UploadCloud,
  User,
  X,
  AlertTriangle,
} from "lucide-react"
import { api } from "../../services/api"
import { useAuth } from "../../context/AuthContext"
import { cn, formatCurrencyINR, formatFileSize, formatRelative, humanize } from "../../lib/utils"
import { DOC_TYPES, REQUIRED_FOR_SUBMISSION } from "../../lib/status"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import { TabBar } from "../ui/tab-bar"
import { Skeleton } from "../ui/skeleton"
import { EmptyState } from "../ui/empty-state"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { TypedExtractionPanel, effectiveDocType, docTypeLabel } from "./TypedExtractionPanel"
import { CitationButton, CitationViewer } from "./CitationViewer"
import { citationKey } from "./citations"
import { ExtractedDataEditor } from "./ExtractedDataEditor"

const CATEGORY_TONES = {
  room_rent: "bg-peacock-50 text-peacock-700",
  room: "bg-peacock-50 text-peacock-700",
  icu: "bg-vermilion-50 text-vermilion-700",
  pharmacy: "bg-leaf-50 text-leaf-700",
  medicine: "bg-leaf-50 text-leaf-700",
  procedure: "bg-sand-50 text-sand-700",
  surgery: "bg-sand-50 text-sand-700",
  surgeon_fee: "bg-sand-50 text-sand-700",
  consumables: "bg-marigold-50 text-marigold-800",
  consultation: "bg-peacock-50 text-peacock-700",
  lab: "bg-sunken text-ink-2",
  diagnostics: "bg-sunken text-ink-2",
}

export function DocumentExtractionView({
  claimId,
  claim: propClaim,
  onRunAdjudication,
  onSwitchToAdjudication,
  runningPipeline = false,
  hasAdjudication = false,
  onDocumentsChange,
  onSubmitClaim,
}) {
  const { toast } = useToast()
  const { user } = useAuth()
  const role = user?.role
  const isStaff = ["admin", "adjuster"].includes(role)
  const isHospital = role === "hospital_desk"
  const [fetchedClaim, setFetchedClaim] = useState(null)
  const claim = propClaim || fetchedClaim
  // Source citation shown in the right-hand viewer (null = viewer closed)
  const [activeCitation, setActiveCitation] = useState(null)
  // Documents are the hospital's: only it adds them (until the claim is closed) and only it
  // removes them, while the claim is still a draft. The insurer reviews them read-only.
  const claimStatus = claim?.status
  const canUpload = isHospital && !["finalized", "rejected"].includes(claimStatus)
  const canDelete = isHospital && claimStatus === "draft"
  // After submission the hospital can't re-run extraction the insurer relies on (mirrors the API);
  // a document whose first extraction never completed can still be extracted.
  const canExtract = (doc) => !isHospital || claimStatus === "draft" || doc.extraction_status !== "completed"
  // Corrections are per document (keeps citations on their rows): insurer any time, hospital on drafts
  const canEditExtraction = isStaff || (isHospital && claimStatus === "draft")
  const [editingExtraction, setEditingExtraction] = useState(false)
  const [documents, setDocuments] = useState([])
  const [mergedData, setExtractedData] = useState(null)
  const [selectedDocId, setSelectedDocId] = useState(null)
  const [docData, setDocData] = useState(null)
  const [docLoading, setDocLoading] = useState(false)
  const [previewDoc, setPreviewDoc] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [docToDelete, setDocToDelete] = useState(null)
  const extractedData = selectedDocId ? docData : mergedData
  const selectedDoc = documents.find((d) => d.id === selectedDocId) || null
  // Bills use the line-item view below; every other document type gets its own layout.
  const selectedType = selectedDoc ? effectiveDocType(selectedDoc.doc_type, docData) : null
  const typedSelected = Boolean(selectedDoc && selectedType !== "itemized_bill")
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extractingId, setExtractingId] = useState(null)
  const [localAdjudicating, setLocalAdjudicating] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)
  const [docType, setDocType] = useState(null)
  const [dragActive, setDragActive] = useState(false)
  const [viewMode, setViewMode] = useState("structured") // "structured" | "json"
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("all")
  const fileInputRef = useRef(null)
  const dropzoneRef = useRef(null)

  const presentTypes = new Set(documents.map((d) => d.doc_type))
  const missingRequired = REQUIRED_FOR_SUBMISSION.filter((r) => !presentTypes.has(r.type))
  // Default the upload type to whatever is still required
  const effectiveDocTypeChoice = docType || missingRequired[0]?.type || "itemized_bill"

  const loadDocData = async (docId) => {
    setDocLoading(true)
    try {
      const res = await api.documents.getDocumentExtraction(claimId, docId)
      setDocData(res?.extracted_data || null)
      setEditingExtraction(false)
    } catch (err) {
      setDocData(null)
      toast({ title: "Could not load extraction", description: err.message, variant: "destructive" })
    } finally {
      setDocLoading(false)
    }
  }

  const handleSelectDocument = async (docId) => {
    if (selectedDocId === docId) return
    setSelectedDocId(docId)
    setSelectedCategoryFilter("all")
    setActiveCitation(null)
    await loadDocData(docId)
  }

  const handleClearSelection = () => {
    setSelectedDocId(null)
    setDocData(null)
    setEditingExtraction(false)
    setActiveCitation(null)
  }

  const handlePreview = async (doc) => {
    setPreviewDoc(doc)
    setPreviewUrl(null)
    setPreviewLoading(true)
    try {
      const res = await api.documents.getSignedUrl(claimId, doc.id)
      setPreviewUrl(res?.signed_url || null)
    } catch (err) {
      toast({ title: "Preview failed", description: err.message, variant: "destructive" })
      setPreviewDoc(null)
    } finally {
      setPreviewLoading(false)
    }
  }

  const closePreview = () => {
    setPreviewDoc(null)
    setPreviewUrl(null)
  }

  const handleDeleteDocument = async () => {
    const doc = docToDelete
    if (!doc) return
    try {
      await api.documents.delete(claimId, doc.id)
      toast({ title: "Document deleted", description: doc.original_filename, variant: "success" })
      if (selectedDocId === doc.id) handleClearSelection()
      setDocToDelete(null)
      await loadDocumentsAndData()
    } catch (err) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" })
    }
  }

  const loadDocumentsAndData = async () => {
    try {
      const [docs, data, claimData] = await Promise.all([
        api.documents.list(claimId),
        isStaff ? api.documents.getExtractedData(claimId).catch(() => null) : Promise.resolve(null),
        propClaim ? Promise.resolve(null) : api.claims.getById(claimId).catch(() => null),
      ])
      setDocuments(docs || [])
      onDocumentsChange?.(docs || [])
      setExtractedData(data)
      if (claimData) setFetchedClaim(claimData)
      if (selectedDocId) {
        if (!(docs || []).some((d) => d.id === selectedDocId)) {
          setSelectedDocId(null)
          setDocData(null)
        } else {
          await loadDocData(selectedDocId)
        }
      }
    } catch (err) {
      console.warn("Failed to load documents:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDocumentsAndData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimId])

  const pickFile = (file) => {
    if (!file) return
    setSelectedFile(file)
  }

  const handleUpload = async (e) => {
    e?.preventDefault?.()
    if (!selectedFile) {
      toast({ title: "Choose a file first", variant: "destructive" })
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", selectedFile)
      formData.append("doc_type", effectiveDocTypeChoice)

      const doc = await api.documents.upload(claimId, formData)
      setUploading(false)

      // Automatically trigger extraction so the user doesn't get stuck with a PENDING file
      if (doc?.id) {
        setExtracting(true)
        setExtractingId(doc.id)
        setDocuments((prev) => [...prev.filter((d) => d.id !== doc.id), { ...doc, extraction_status: "processing" }])
        try {
          await api.documents.triggerExtraction(claimId, doc.id)
          toast({
            title: "Document read",
            description: `${docTypeLabel(doc.doc_type)} uploaded and read by AI.`,
            variant: "success",
          })
        } catch (extErr) {
          toast({ title: "Reading queued", description: "OCR processing in progress: " + extErr.message, variant: "warning" })
        } finally {
          setExtracting(false)
          setExtractingId(null)
        }
      }

      setSelectedFile(null)
      setDocType(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
      await loadDocumentsAndData()
    } catch (err) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" })
    } finally {
      setUploading(false)
    }
  }

  const handleTriggerExtraction = async (docId) => {
    setExtracting(true)
    setExtractingId(docId)
    try {
      await api.documents.triggerExtraction(claimId, docId)
      toast({ title: "Document re-read", description: "Gemini multimodal OCR parsed the document again.", variant: "success" })
      await loadDocumentsAndData()
    } catch (err) {
      toast({ title: "Reading failed", description: err.message, variant: "destructive" })
    } finally {
      setExtracting(false)
      setExtractingId(null)
    }
  }

  const handleSaveCorrections = async (corrected) => {
    try {
      await api.documents.patchDocumentExtraction(claimId, selectedDocId, corrected)
      setDocData(corrected)
      if (isStaff) setExtractedData(await api.documents.getExtractedData(claimId).catch(() => mergedData))
      setEditingExtraction(false)
      toast({ title: "Corrections saved", description: "The extracted data was updated.", variant: "success" })
    } catch (err) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" })
    }
  }

  const handleRunAdjudicationAction = async () => {
    setLocalAdjudicating(true)
    try {
      if (onRunAdjudication) {
        await onRunAdjudication()
      } else {
        await api.adjudication.run(claimId)
        toast({ title: "Adjudication complete", description: "All line items audited against policy clauses and IRDAI rules.", variant: "success" })
        onSwitchToAdjudication?.()
      }
    } catch (err) {
      toast({ title: "Adjudication failed", description: err.message, variant: "destructive" })
    } finally {
      setLocalAdjudicating(false)
    }
  }

  const chooseTypeAndBrowse = (type) => {
    setDocType(type)
    dropzoneRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" })
    fileInputRef.current?.click()
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

  // Identity and hospital facility verification
  const claimPatientName = claim?.patient_name?.trim() || ""
  const billPatientName = (patient?.name || "").trim()
  const isNameMatch = Boolean(claimPatientName && billPatientName && claimPatientName.toLowerCase() === billPatientName.toLowerCase())
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

  const isAdjudicating = runningPipeline || localAdjudicating
  const busy = uploading || extracting
  const requiredDone = REQUIRED_FOR_SUBMISSION.length - missingRequired.length

  return (
    <div className="space-y-5">
      {/* Required documents (hospital drafts) */}
      {isHospital && claimStatus === "draft" && !loading && (
        <section className="overflow-hidden rounded-card bg-surface shadow-card" aria-label="Required documents">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-body font-semibold text-ink">
                {missingRequired.length === 0 ? "All required documents are attached" : "Required before you can submit"}
              </h3>
              <p className="text-small text-ink-3">
                {requiredDone} of {REQUIRED_FOR_SUBMISSION.length} ready · discharge summary, prescriptions and lab reports help the review
              </p>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken sm:w-48">
              <div
                className="h-full rounded-full bg-peacock-500 transition-[width] duration-500 ease-out-strong"
                style={{ width: `${(requiredDone / REQUIRED_FOR_SUBMISSION.length) * 100}%` }}
              />
            </div>
          </div>
          <ul className="grid border-t border-line sm:grid-cols-2">
            {REQUIRED_FOR_SUBMISSION.map((req, i) => {
              const doc = documents.find((d) => d.doc_type === req.type)
              const meta = DOC_TYPES.find((t) => t.value === req.type)
              return (
                <li key={req.type} className={cn("flex items-center justify-between gap-3 px-5 py-3.5", i > 0 && "border-t border-line sm:border-l sm:border-t-0")}>
                  <div className="flex min-w-0 items-center gap-3">
                    {doc ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-leaf-600" />
                    ) : (
                      <Circle className="h-5 w-5 shrink-0 text-ink-4" strokeDasharray="3 3" />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-ink">{meta?.label}</div>
                      <div className="truncate text-tiny text-ink-3">{doc ? doc.original_filename : "Not attached yet"}</div>
                    </div>
                  </div>
                  {!doc && canUpload && (
                    <Button size="sm" variant="secondary" onClick={() => chooseTypeAndBrowse(req.type)}>
                      Add
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
          {missingRequired.length === 0 && onSubmitClaim && (
            <div className="flex flex-col gap-3 border-t border-leaf-100 bg-leaf-50 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-small font-medium text-leaf-800">
                Everything the insurer needs is here. Submitting starts the 3-hour SLA.
              </p>
              <Button variant="proceed" onClick={onSubmitClaim}>
                <Send className="h-4 w-4" />
                Submit to insurer
              </Button>
            </div>
          )}
        </section>
      )}

      {/* Upload */}
      {canUpload && (
        <section className="rounded-card bg-surface p-5 shadow-card" aria-label="Upload a document">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-body font-semibold text-ink">Add a document</h3>
            <span className="text-tiny text-ink-3">PDF, JPG or PNG · up to 50 MB</span>
          </div>

          <div className="mb-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Document type">
            {DOC_TYPES.map((t) => {
              const on = effectiveDocTypeChoice === t.value
              const required = missingRequired.some((r) => r.type === t.value)
              return (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setDocType(t.value)}
                  className={cn(
                    "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-small font-semibold transition-[background-color,color,box-shadow] duration-150",
                    on ? "bg-peacock-600 text-white" : "bg-sunken text-ink-2 hover:bg-line"
                  )}
                >
                  {t.label}
                  {required && <span className={cn("h-1.5 w-1.5 rounded-full", on ? "bg-marigold-300" : "bg-marigold-500")} aria-label="required" />}
                </button>
              )
            })}
          </div>

          <form onSubmit={handleUpload}>
            <div
              ref={dropzoneRef}
              onDragOver={(e) => {
                e.preventDefault()
                setDragActive(true)
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragActive(false)
                pickFile(e.dataTransfer.files?.[0])
              }}
              className={cn(
                "relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors duration-150",
                dragActive ? "border-peacock-400 bg-peacock-50" : "border-line-strong bg-ground/60",
                busy && "pointer-events-none"
              )}
            >
              {busy ? (
                <UploadPhases phase={uploading ? "uploading" : "reading"} />
              ) : selectedFile ? (
                <div className="flex w-full max-w-md items-center gap-3 rounded-lg bg-surface px-3 py-2.5 text-left shadow-card">
                  <FileText className="h-5 w-5 shrink-0 text-peacock-600" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink">{selectedFile.name}</div>
                    <div className="text-tiny text-ink-3">
                      {formatFileSize(selectedFile.size)} · as {docTypeLabel(effectiveDocTypeChoice).toLowerCase()}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFile(null)
                      if (fileInputRef.current) fileInputRef.current.value = ""
                    }}
                    className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink"
                    aria-label="Remove file"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <>
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface text-peacock-600 shadow-card">
                    <UploadCloud className="h-5 w-5" />
                  </span>
                  <p className="text-sm text-ink-2">
                    Drop the {docTypeLabel(effectiveDocTypeChoice).toLowerCase()} here, or{" "}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="cursor-pointer font-semibold text-peacock-600 underline-offset-4 hover:underline"
                    >
                      browse
                    </button>
                  </p>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                className="sr-only"
                aria-label="Choose a document"
                onChange={(e) => pickFile(e.target.files?.[0] || null)}
              />
            </div>

            <div className="mt-3 flex justify-end">
              <Button type="submit" disabled={busy || !selectedFile} loading={busy}>
                {!busy && <Sparkles className="h-4 w-4" />}
                {uploading ? "Uploading…" : extracting ? "Reading…" : "Upload & read"}
              </Button>
            </div>
          </form>
        </section>
      )}

      {/* Documents */}
      <section className="overflow-hidden rounded-card bg-surface shadow-card" aria-label="Documents">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h3 className="text-body font-semibold text-ink">{isHospital ? "Your documents" : "Documents from the hospital"}</h3>
          <span className="text-small text-ink-3">
            {documents.length} {documents.length === 1 ? "file" : "files"}
          </span>
        </div>
        {loading ? (
          <div className="space-y-3 p-5">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-56" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
            ))}
          </div>
        ) : documents.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No documents yet"
            description={
              isHospital
                ? "Add the itemised bill and the policy document above. AI reads them and lists every charge."
                : "The hospital hasn't attached any documents to this claim yet."
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {documents.map((doc) => {
              const selected = selectedDocId === doc.id
              const reading = extractingId === doc.id || doc.extraction_status === "processing"
              const done = doc.extraction_status === "completed"
              const failed = doc.extraction_status === "failed"
              const isImage = doc.mime_type?.startsWith("image/")
              const Icon = isImage ? FileImage : FileText
              return (
                <li
                  key={doc.id}
                  className={cn(
                    "flex flex-col gap-3 px-5 py-3.5 transition-colors sm:flex-row sm:items-center sm:justify-between",
                    selected ? "bg-peacock-50/70" : "hover:bg-ground/60"
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", selected ? "bg-peacock-600 text-white" : "bg-peacock-50 text-peacock-600")}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">{doc.original_filename}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-tiny text-ink-3">
                        <span>{docTypeLabel(doc.doc_type)}</span>
                        {formatFileSize(doc.file_size_bytes) && <span>· {formatFileSize(doc.file_size_bytes)}</span>}
                        {doc.created_at && <span>· {formatRelative(doc.created_at)}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                    {reading ? (
                      <Badge variant="peacock">
                        <Loader2 className="animate-spin" />
                        Reading
                      </Badge>
                    ) : done ? (
                      <Badge variant="leaf">
                        <Check />
                        Read{doc.extraction_confidence ? ` · ${Math.round(doc.extraction_confidence * 100)}%` : ""}
                      </Badge>
                    ) : failed ? (
                      <Badge variant="vermilion">Couldn't read</Badge>
                    ) : (
                      <Badge variant="neutral">{humanize(doc.extraction_status) || "Pending"}</Badge>
                    )}

                    <Button size="sm" variant="ghost" onClick={() => handlePreview(doc)}>
                      <ScanSearch className="h-3.5 w-3.5" />
                      Preview
                    </Button>

                    <Button
                      size="sm"
                      variant={selected ? "primary" : "secondary"}
                      disabled={!done}
                      aria-pressed={selected}
                      onClick={() => handleSelectDocument(doc.id)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      View extracted data
                    </Button>

                    {canExtract(doc) && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        disabled={extracting}
                        onClick={() => handleTriggerExtraction(doc.id)}
                        title="Read this document again"
                        aria-label={`Re-read ${doc.original_filename}`}
                      >
                        <RefreshCw className={cn("h-3.5 w-3.5", reading && "animate-spin")} />
                      </Button>
                    )}

                    {canDelete && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => setDocToDelete(doc)}
                        className="hover:bg-vermilion-50 hover:text-vermilion-700"
                        title="Delete document"
                        aria-label={`Delete ${doc.original_filename}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {selectedDoc && (
        <div className="flex animate-rise flex-col gap-2 rounded-xl bg-peacock-50 px-4 py-3 text-small text-peacock-900 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2">
            {docLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            Showing what AI read from <strong className="font-semibold">{selectedDoc.original_filename}</strong>
          </span>
          <Button size="sm" variant="secondary" onClick={handleClearSelection}>
            {isStaff ? "Show all documents merged" : "Close"}
          </Button>
        </div>
      )}

      {typedSelected && docData && !docLoading && (
        <TypedExtractionPanel
          docType={selectedType}
          data={docData}
          claimId={claimId}
          onEdit={canEditExtraction ? () => setEditingExtraction(true) : undefined}
        />
      )}

      {/* Structured bill data & adjudication trigger */}
      {typedSelected && docData ? null : hasExtractedData ? (
        <div className="space-y-5">
          {isStaff && !selectedDocId && (
            <section className="relative overflow-hidden rounded-card bg-peacock-800 p-5 text-white shadow-raised">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-small">
                    <span className="rounded-full bg-marigold-400 px-2.5 py-0.5 text-tiny font-semibold text-ink">Bill read</span>
                    <span className="figures font-semibold text-peacock-100">
                      {lineItems.length} items · {formatCurrencyINR(totalBilled)}
                    </span>
                  </div>
                  <h3 className="text-body font-semibold">
                    {hasAdjudication ? "Already adjudicated: a rerun replaces the current decisions" : "Ready for AI adjudication"}
                  </h3>
                  <p className="max-w-2xl text-small text-peacock-100/80">
                    Gemini checks every line against the policy (room rent caps, co-pay, waiting periods) and flags IRDAI non-payables.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {onSwitchToAdjudication && hasAdjudication && (
                    <Button variant="on-dark" onClick={onSwitchToAdjudication}>
                      Go to decision
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  )}
                  <Button variant={hasAdjudication ? "on-dark" : "proceed"} onClick={handleRunAdjudicationAction} loading={isAdjudicating}>
                    {!isAdjudicating && <Sparkles className="h-4 w-4" />}
                    {isAdjudicating ? "Auditing line items…" : hasAdjudication ? "Rerun AI adjudication" : "Run AI adjudication"}
                  </Button>
                </div>
              </div>
            </section>
          )}

          {/* Patient identity check */}
          <section
            aria-label="Patient identity check"
            className={cn(
              "overflow-hidden rounded-card shadow-card ring-1 ring-inset",
              hasNameMismatch ? "bg-vermilion-50 ring-vermilion-200" : isNameMatch ? "bg-leaf-50 ring-leaf-100" : "bg-sand-50 ring-sand-200"
            )}
          >
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white",
                    hasNameMismatch ? "bg-vermilion-600" : isNameMatch ? "bg-leaf-600" : "bg-sand-500"
                  )}
                >
                  {hasNameMismatch ? <ShieldAlert className="h-5 w-5" /> : isNameMatch ? <ShieldCheck className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                </span>
                <div>
                  <div className={cn("text-sm font-semibold", hasNameMismatch ? "text-vermilion-800" : isNameMatch ? "text-leaf-800" : "text-sand-800")}>
                    {hasNameMismatch
                      ? "Name mismatch: auto-approval is blocked"
                      : isNameMatch
                        ? "Identity verified: the bill matches the claimant"
                        : "Identity not verified yet"}
                  </div>
                  <p className="mt-0.5 text-small text-ink-2">
                    {hasNameMismatch
                      ? `The bill is issued to "${billPatientName}", but the registered claimant is "${claimPatientName}". Policy rules require an exact match.`
                      : isNameMatch
                        ? `"${billPatientName}" on the hospital bill exactly matches the registered claimant.`
                        : "Comparing the patient name read from the bill with the policyholder record."}
                  </p>
                </div>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-px border-t border-black/5 bg-black/5 lg:grid-cols-4">
              <IdentityFact label="Registered claimant" value={claimPatientName} sub={claim?.uhid ? `UHID ${claim.uhid}` : null} />
              <IdentityFact
                label="Name on the bill"
                value={billPatientName}
                sub={patient?.uhid ? `UHID ${patient.uhid}` : null}
                emphasis={hasNameMismatch}
                empty="Not found on the bill"
              />
              <IdentityFact
                label="Hospital"
                value={billHospitalName || claimHospitalName}
                sub={isHospitalMatch ? "Matches the claim's hospital" : billHospitalName ? "Check against the claim" : null}
              />
              <IdentityFact
                label="Adjuster action"
                value={hasNameMismatch ? "Manual investigation" : isNameMatch ? "Eligible for adjudication" : "Verify before deciding"}
                sub={hasNameMismatch ? "Auto-approval blocked" : null}
              />
            </dl>
          </section>

          {/* Overview */}
          <section className="grid gap-px overflow-hidden rounded-card bg-line shadow-card md:grid-cols-3" aria-label="Bill overview">
            <OverviewCell icon={Building2} title="Hospital & admission">
              <div className="font-semibold text-ink">{hospital.name || <span className="font-normal text-ink-3">Not found on the bill</span>}</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-small">
                <div>
                  <div className="text-tiny text-ink-3">Ward</div>
                  <div className="font-semibold capitalize text-ink-2">{hospital.ward_type || "—"}</div>
                </div>
                <div>
                  <div className="text-tiny text-ink-3">Room / day</div>
                  <div className="figures font-semibold text-ink-2">{hospital.room_rent_per_day_inr ? formatCurrencyINR(hospital.room_rent_per_day_inr) : "—"}</div>
                </div>
              </div>
            </OverviewCell>
            <OverviewCell icon={User} title="Patient & clinical">
              <div className={cn("font-semibold", hasNameMismatch ? "text-vermilion-700" : "text-ink")}>
                {patient.name || <span className="font-normal text-ink-3">Not found on the bill</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(patient.diagnosis || []).map((diag, i) => (
                  <Badge key={`d${i}`} variant="peacock">
                    {diag}
                  </Badge>
                ))}
                {(patient.procedures || []).map((proc, i) => (
                  <Badge key={`p${i}`} variant="sand">
                    {proc}
                  </Badge>
                ))}
                {!patient.diagnosis?.length && !patient.procedures?.length && <span className="text-small text-ink-3">No diagnosis listed</span>}
              </div>
            </OverviewCell>
            <OverviewCell icon={FileText} title="Bill total">
              <div className="figures text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">{formatCurrencyINR(totalBilled)}</div>
              <div className="mt-1.5 text-small text-ink-3">
                {lineItems.length} items{confidenceScore ? ` · read with ${Math.round(confidenceScore * 100)}% confidence` : ""}
              </div>
            </OverviewCell>
          </section>

          {/* Line items */}
          <section className="overflow-hidden rounded-card bg-surface shadow-card" aria-label="Itemised bill">
            <div className="flex flex-col gap-3 border-b border-line px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-body font-semibold text-ink">Itemised bill</h3>
                <TabBar
                  variant="segmented"
                  size="sm"
                  value={viewMode}
                  onChange={setViewMode}
                  ariaLabel="Bill view"
                  tabs={[
                    { value: "structured", label: `Table (${filteredLineItems.length})`, icon: TableIcon },
                    { value: "json", label: "Raw JSON", icon: Code },
                  ]}
                />
              </div>
              {canEditExtraction &&
                (selectedDocId ? (
                  <Button size="sm" variant="secondary" onClick={() => setEditingExtraction(true)}>
                    <Pencil className="h-3.5 w-3.5" />
                    Edit data
                  </Button>
                ) : (
                  <span className="text-tiny text-ink-3">Open a document's extracted data to correct it</span>
                ))}
            </div>

            {viewMode === "structured" && categories.length > 2 && (
              <div className="scrollbar-none flex items-center gap-1.5 overflow-x-auto border-b border-line px-4 py-2.5 sm:px-5">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategoryFilter(cat)}
                    aria-pressed={selectedCategoryFilter === cat}
                    className={cn(
                      "shrink-0 cursor-pointer rounded-full px-2.5 py-1 text-tiny font-semibold transition-colors",
                      selectedCategoryFilter === cat ? "bg-ink text-white" : "bg-sunken text-ink-2 hover:bg-line"
                    )}
                  >
                    {cat === "all" ? "All categories" : humanize(cat)}
                  </button>
                ))}
              </div>
            )}

            {viewMode === "structured" ? (
              <div className={activeCitation ? "grid grid-cols-1 xl:grid-cols-2" : ""}>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-small font-semibold text-ink-3">
                        <th className="w-12 py-2.5 pl-5 pr-2 text-right font-semibold">#</th>
                        <th className="px-3 py-2.5 font-semibold">Item</th>
                        <th className="px-3 py-2.5 font-semibold">Category</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Unit price</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Total</th>
                        <th className="py-2.5 pl-3 pr-5 text-center font-semibold">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {filteredLineItems.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-6 text-center text-small text-ink-3">
                            No line items in this category.
                          </td>
                        </tr>
                      ) : (
                        filteredLineItems.map((item, idx) => {
                          const cat = item.item_category || item.category || "general"
                          const active = activeCitation && activeCitation === item.source
                          return (
                            <tr
                              key={idx}
                              onClick={() => item.source?.document_id && setActiveCitation(item.source)}
                              className={cn("transition-colors", item.source?.document_id && "cursor-pointer", active ? "bg-marigold-50" : "hover:bg-ground/70")}
                            >
                              <td className="py-2.5 pl-5 pr-2 text-right font-mono text-tiny text-ink-3">{item.line_number || idx + 1}</td>
                              <td className="px-3 py-2.5">
                                <div className="flex flex-wrap items-center gap-1.5 font-medium text-ink">
                                  <span>{item.item_name || item.name || "Item"}</span>
                                  {item.manually_added && <Badge variant="leaf">Added</Badge>}
                                  {item.manually_edited && <Badge variant="sand">Edited</Badge>}
                                </div>
                                {item.prescribed_by && <span className="text-tiny text-ink-3">Dr. {item.prescribed_by}</span>}
                              </td>
                              <td className="px-3 py-2.5">
                                <span className={cn("inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-tiny font-semibold", CATEGORY_TONES[cat.toLowerCase()] || "bg-sunken text-ink-2")}>
                                  {humanize(cat)}
                                </span>
                              </td>
                              <td className="figures px-3 py-2.5 text-right text-ink-2">{item.quantity || 1}</td>
                              <td className="figures whitespace-nowrap px-3 py-2.5 text-right text-ink-2">{formatCurrencyINR(item.unit_price_inr || item.unit_price || 0)}</td>
                              <td className="figures whitespace-nowrap px-3 py-2.5 text-right font-semibold text-ink">
                                {formatCurrencyINR(item.total_price_inr || item.total_amount || item.total_price || 0)}
                              </td>
                              <td className="py-2.5 pl-3 pr-5 text-center">
                                {item.source?.document_id ? (
                                  <CitationButton citation={item.source} active={activeCitation === item.source} onClick={setActiveCitation} />
                                ) : (
                                  <span className="text-tiny text-ink-4" title="Re-read this document to generate citations">
                                    —
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line bg-ground/70">
                        <td colSpan={5} className="py-3 pl-5 pr-3 text-right text-small font-semibold text-ink-3">
                          Total on the bill
                        </td>
                        <td className="figures whitespace-nowrap px-3 py-3 text-right text-body font-semibold text-ink">{formatCurrencyINR(totalBilled)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {activeCitation && (
                  <div className="border-t border-line bg-ground/50 p-3 xl:border-l xl:border-t-0">
                    <div className="xl:sticky xl:top-20">
                      <CitationViewer
                        key={citationKey(activeCitation)}
                        claimId={claimId}
                        citation={activeCitation}
                        title="Extracted from"
                        onClose={() => setActiveCitation(null)}
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4">
                <pre className="max-h-96 overflow-auto rounded-xl bg-peacock-950 p-4 font-mono text-tiny leading-relaxed text-peacock-100">
                  {JSON.stringify(extractedData, null, 2)}
                </pre>
              </div>
            )}
          </section>
        </div>
      ) : (
        !loading &&
        documents.length > 0 && (
          <section className="rounded-card border border-dashed border-line-strong bg-surface/60">
            <EmptyState
              icon={Sparkles}
              title={selectedDocId ? "Nothing was read from this document" : isStaff ? "No bill data read yet" : "Choose a document to see what AI read"}
              description={
                selectedDocId
                  ? "Try reading it again, or upload a clearer copy."
                  : isStaff
                    ? "Once the hospital's itemised bill has been read, every charge appears here with a link to where it sits on the bill."
                    : "Use View extracted data on any document that has been read."
              }
            />
          </section>
        )
      )}

      {editingExtraction && selectedDocId && docData && (
        <ExtractedDataEditor
          data={docData}
          title={`Edit extracted data: ${selectedDoc?.original_filename || "document"}`}
          onSave={handleSaveCorrections}
          onCancel={() => setEditingExtraction(false)}
        />
      )}

      {/* Preview */}
      <Dialog open={Boolean(previewDoc)} onOpenChange={(o) => !o && closePreview()}>
        <DialogContent onClose={closePreview} className="flex h-[88dvh] flex-col p-0 sm:max-w-5xl">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5 pr-14">
            <div className="min-w-0">
              <DialogTitle className="truncate text-body">{previewDoc?.original_filename}</DialogTitle>
              <DialogDescription className="text-small">{docTypeLabel(previewDoc?.doc_type)}</DialogDescription>
            </div>
            {previewUrl && !previewUrl.startsWith("data:") && (
              <a href={previewUrl} target="_blank" rel="noreferrer">
                <Button size="sm" variant="secondary">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open in new tab
                </Button>
              </a>
            )}
          </div>
          <div className="flex flex-1 items-center justify-center overflow-auto bg-sunken">
            {previewLoading && <Loader2 className="h-6 w-6 animate-spin text-ink-3" />}
            {!previewLoading && previewUrl && (previewDoc?.mime_type?.startsWith("image/") || previewUrl.startsWith("data:image")) && (
              <img src={previewUrl} alt={previewDoc?.original_filename} className="max-h-full max-w-full object-contain" />
            )}
            {!previewLoading && previewUrl && !(previewDoc?.mime_type?.startsWith("image/") || previewUrl.startsWith("data:image")) && (
              <iframe src={previewUrl} title={previewDoc?.original_filename} className="h-full w-full border-0" />
            )}
            {!previewLoading && !previewUrl && <p className="text-small text-ink-3">Preview unavailable for this document.</p>}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete document */}
      <Dialog open={Boolean(docToDelete)} onOpenChange={(o) => !o && setDocToDelete(null)}>
        <DialogContent onClose={() => setDocToDelete(null)}>
          <DialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-vermilion-50 text-vermilion-600">
              <Trash2 className="h-5 w-5" />
            </div>
            <DialogTitle>Delete this document?</DialogTitle>
            <DialogDescription>
              “{docToDelete?.original_filename}” and the data read from it are removed from the draft.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDocToDelete(null)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={handleDeleteDocument}>
              <Trash2 className="h-4 w-4" />
              Delete document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function UploadPhases({ phase }) {
  const steps = [
    { key: "uploading", label: "Uploading" },
    { key: "reading", label: "Reading with AI" },
    { key: "done", label: "Ready" },
  ]
  const at = steps.findIndex((s) => s.key === phase)
  return (
    <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
      <Loader2 className="h-6 w-6 animate-spin text-peacock-600" />
      <ol className="flex items-center gap-2 text-small font-semibold">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className={cn(i < at ? "text-peacock-600" : i === at ? "text-ink" : "text-ink-3")}>{s.label}</span>
            {i < steps.length - 1 && <span className={cn("h-px w-6", i < at ? "bg-peacock-400" : "bg-line-strong")} />}
          </li>
        ))}
      </ol>
    </div>
  )
}

function IdentityFact({ label, value, sub, emphasis, empty = "—" }) {
  return (
    <div className="min-w-0 bg-surface/85 px-4 py-3 sm:px-5">
      <dt className="text-tiny font-medium text-ink-3">{label}</dt>
      <dd className={cn("mt-0.5 truncate text-sm font-semibold", emphasis ? "text-vermilion-700 underline decoration-vermilion-300 decoration-2 underline-offset-4" : "text-ink", !value && "font-normal text-ink-3")}>
        {value || empty}
      </dd>
      {sub && <div className="mt-0.5 truncate font-mono text-tiny text-ink-3">{sub}</div>}
    </div>
  )
}

function OverviewCell({ icon: Icon, title, children }) {
  return (
    <div className="bg-surface p-4 sm:p-5">
      <div className="mb-2 flex items-center gap-2 text-small font-semibold text-ink-3">
        <Icon className="h-4 w-4 text-peacock-500" />
        {title}
      </div>
      {children}
    </div>
  )
}
