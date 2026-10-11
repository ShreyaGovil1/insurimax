/** Stable identity for a citation, used as the CitationViewer's React key so a new citation starts fresh. */
export const citationKey = (c) => (c ? `${c.document_id}:${c.page}:${c.text}` : "none")
