import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, FileText, ImageIcon, Loader2, Quote, X } from "lucide-react"
import { api } from "../../services/api"
import { cn } from "../../lib/utils"

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
    <div className="flex animate-rise flex-col overflow-hidden rounded-card bg-surface shadow-raised">
      <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="text-tiny font-semibold text-ink-3">{title || "Source citation"}</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink">
            {isImage ? <ImageIcon className="h-4 w-4 shrink-0 text-peacock-600" /> : <FileText className="h-4 w-4 shrink-0 text-peacock-600" />}
            <span className="truncate" title={citation.filename}>
              {citation.filename || "Document"}
            </span>
            {!isImage && citation.page && (
              <span className="shrink-0 rounded-md bg-sunken px-1.5 text-tiny font-semibold text-ink-2">p. {citation.page}</span>
            )}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
            title="Close citation"
            aria-label="Close citation"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {citation.text && (
        <div className="flex gap-2 border-b border-marigold-100 bg-marigold-50 px-4 py-2.5 text-small text-ink-2">
          <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-marigold-600" />
          <span className="break-words font-mono text-tiny leading-relaxed">{citation.text}</span>
        </div>
      )}

      {note && <div className="border-b border-line px-4 py-2 text-tiny text-ink-3">{note}</div>}

      {!isImage && (
        <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-tiny text-ink-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md hover:bg-sunken disabled:cursor-default disabled:opacity-35"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="figures font-semibold">
              Page {page}
              {pageCount ? ` of ${pageCount}` : ""}
            </span>
            <button
              type="button"
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md hover:bg-sunken disabled:cursor-default disabled:opacity-35"
              disabled={pageCount != null && page >= pageCount}
              onClick={() => setPage((p) => p + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          {citation.page && page !== citation.page && (
            <button className="cursor-pointer font-semibold text-peacock-600 hover:underline" onClick={() => setPage(citation.page)}>
              Back to cited page
            </button>
          )}
        </div>
      )}

      <div className="relative max-h-[70vh] overflow-auto bg-sunken">
        {loading && (
          <div className="flex items-center justify-center gap-2 p-10 text-small text-ink-3">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading page…
          </div>
        )}
        {error && !loading && <div className="p-8 text-center text-small text-vermilion-700">{error}</div>}
        {imageUrl && !error && (
          <div className={cn("relative", loading && "hidden")}>
            <img
              src={imageUrl}
              alt={`${citation.filename || "Document"} page ${page}`}
              className="block h-auto w-full select-none"
              onLoad={scrollToHighlight}
            />
            {rects.map(([x0, y0, x1, y1], i) => (
              <div
                key={i}
                ref={i === 0 ? highlightRef : undefined}
                className="pointer-events-none absolute rounded-sm bg-marigold-300/35 ring-2 ring-marigold-500/90"
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
      className={cn(
        "inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-tiny font-semibold transition-colors",
        active ? "bg-marigold-400 text-ink" : "bg-surface text-ink-2 ring-1 ring-inset ring-line-strong hover:bg-marigold-50 hover:ring-marigold-300"
      )}
    >
      <Quote className="h-3 w-3" />
      <span>
        {label}
        {citation.kind !== "image" && citation.page ? ` p.${citation.page}` : ""}
      </span>
    </button>
  )
}
