import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, FileText, ImageIcon, Quote, X } from "lucide-react"
import { api } from "../../services/api"
import { Badge } from "../ui/badge"
import { Button } from "../ui/button"

const MATCH_NOTES = {
  exact: null,
  fuzzy: "Closest match on the page is highlighted (the extracted text differs slightly from the printed text).",
  page: "The exact text could not be located on this page (e.g. a scanned page); showing the cited page.",
  none: "The cited text could not be located in the document.",
  image: "Image document: the text was read from this image, so there is no highlight.",
}

/**
 * Shows where a piece of extracted data came from: the cited page of the source document with
 * the exact text highlighted (PDF), or the source image itself (image uploads).
 *
 * citation = { document_id, filename, kind: "pdf" | "image", page, text, rects: [[x0,y0,x1,y1] 0-1], match }
 */
export function CitationViewer({ claimId, citation, title, onClose }) {
  // Parents render this with key={citationKey(citation)}, so a new citation starts fresh here
  const [page, setPage] = useState(citation?.page || 1)
  const [meta, setMeta] = useState({ docId: null, pageCount: null })
  const [result, setResult] = useState({ key: null, url: null, error: null })
  const highlightRef = useRef(null)

  const docId = citation?.document_id
  const isImage = citation?.kind === "image"
  const requestKey = `${docId}:${isImage ? 1 : page}`
  const loading = result.key !== requestKey
  const pageCount = meta.docId === docId ? meta.pageCount : null

  useEffect(() => {
    if (!docId || isImage) return
    api.documents
      .getPages(claimId, docId)
      .then((m) => setMeta({ docId, pageCount: m?.page_count || null }))
      .catch(() => setMeta({ docId, pageCount: null }))
  }, [claimId, docId, isImage])

  useEffect(() => {
    if (!docId) return
    let cancelled = false
    let url = null
    api.documents
      .getPageImageUrl(claimId, docId, isImage ? 1 : page)
      .then((u) => {
        url = u
        if (cancelled) URL.revokeObjectURL(u)
        else setResult({ key: requestKey, url: u, error: null })
      })
      .catch((err) => {
        if (!cancelled) setResult({ key: requestKey, url: null, error: err.message || "Could not load the document page" })
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [claimId, docId, page, isImage, requestKey])

  const imageUrl = result.url
  const error = result.error

  const rects = !isImage && page === citation?.page ? citation?.rects || [] : []

  const scrollToHighlight = () => {
    highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  if (!citation) return null
  const note = MATCH_NOTES[citation.match] ?? null

  return (
    <div className="flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-2 p-3 border-b border-slate-100 bg-slate-50/80">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{title || "Source citation"}</div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 mt-0.5 min-w-0">
            {isImage ? <ImageIcon className="w-3.5 h-3.5 shrink-0 text-blue-600" /> : <FileText className="w-3.5 h-3.5 shrink-0 text-blue-600" />}
            <span className="truncate" title={citation.filename}>{citation.filename || "Document"}</span>
            {!isImage && citation.page && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">p. {citation.page}</Badge>
            )}
          </div>
        </div>
        {onClose && (
          <Button size="sm" variant="ghost" onClick={onClose} className="h-7 w-7 p-0 shrink-0" title="Close citation">
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {citation.text && (
        <div className="flex gap-2 p-3 text-[11px] text-slate-700 bg-amber-50/60 border-b border-amber-100">
          <Quote className="w-3.5 h-3.5 shrink-0 text-amber-600 mt-0.5" />
          <span className="font-mono leading-relaxed break-words">{citation.text}</span>
        </div>
      )}

      {note && <div className="px-3 py-2 text-[11px] text-slate-500 border-b border-slate-100">{note}</div>}

      {!isImage && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-100 text-[11px] text-slate-600">
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <span>
              Page {page}
              {pageCount ? ` of ${pageCount}` : ""}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              disabled={pageCount != null && page >= pageCount}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
          {citation.page && page !== citation.page && (
            <button className="text-blue-600 hover:underline cursor-pointer" onClick={() => setPage(citation.page)}>
              Back to cited page
            </button>
          )}
        </div>
      )}

      <div className="relative overflow-auto max-h-[70vh] bg-slate-100">
        {loading && <div className="p-8 text-center text-xs text-slate-500">Loading page…</div>}
        {error && !loading && <div className="p-8 text-center text-xs text-red-600">{error}</div>}
        {imageUrl && !error && (
          <div className={`relative ${loading ? "hidden" : ""}`}>
            <img
              src={imageUrl}
              alt={`${citation.filename || "Document"} page ${page}`}
              className="w-full h-auto block select-none"
              onLoad={scrollToHighlight}
            />
            {rects.map(([x0, y0, x1, y1], i) => (
              <div
                key={i}
                ref={i === 0 ? highlightRef : undefined}
                className="absolute rounded-sm bg-yellow-300/40 ring-2 ring-amber-500/80 pointer-events-none"
                style={{
                  left: `${x0 * 100}%`,
                  top: `${y0 * 100}%`,
                  width: `${(x1 - x0) * 100}%`,
                  height: `${(y1 - y0) * 100}%`,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Small "view source" button shown next to an extracted item that has a citation. */
export function CitationButton({ citation, onClick, active = false, label = "Source" }) {
  if (!citation?.document_id) return null
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick(citation)
      }}
      title={`${citation.filename}${citation.page ? `, page ${citation.page}` : ""}`}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold cursor-pointer transition-colors ${
        active
          ? "bg-amber-100 border-amber-300 text-amber-900"
          : "bg-white border-slate-200 text-slate-600 hover:bg-amber-50 hover:border-amber-200"
      }`}
    >
      <Quote className="w-2.5 h-2.5" />
      <span>{label}{citation.kind !== "image" && citation.page ? ` p.${citation.page}` : ""}</span>
    </button>
  )
}
