import { useEffect, useState } from "react"
import { Building2, CheckCheck, MessageSquare, Reply, Send, ShieldCheck, Sparkles } from "lucide-react"
import { api } from "../../services/api"
import { cn, formatRelative } from "../../lib/utils"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import { Textarea } from "../ui/textarea"
import { Skeleton } from "../ui/skeleton"
import { EmptyState } from "../ui/empty-state"
import { useToast } from "../ui/toast"
import { useAuth } from "../../context/AuthContext"

const STATUS = {
  open: { label: "Waiting for hospital", variant: "sand" },
  responded: { label: "Answered", variant: "peacock" },
  resolved: { label: "Resolved", variant: "leaf" },
}

export function ClaimQueriesView({ claimId, onQueriesChange }) {
  const { toast } = useToast()
  // The insurer raises and resolves queries; only the hospital answers them.
  const { user } = useAuth()
  const isInsurer = ["admin", "adjuster"].includes(user?.role)
  const isHospital = user?.role === "hospital_desk"
  const [queries, setQueries] = useState([])
  const [loading, setLoading] = useState(true)
  const [newQueryText, setNewQueryText] = useState("")
  const [aiDrafted, setAiDrafted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Hospital response form; the first unanswered query opens ready to reply
  const [activeQueryForResponse, setActiveQueryForResponse] = useState(undefined)
  const [responseText, setResponseText] = useState("")
  const [responding, setResponding] = useState(false)
  const [resolvingId, setResolvingId] = useState(null)

  const loadQueries = async () => {
    try {
      const data = await api.queries.list(claimId)
      setQueries(data || [])
      onQueriesChange?.(data || [])
    } catch (err) {
      console.warn("Failed to load queries:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadQueries()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimId])

  const firstUnanswered = queries.find((q) => !q.response_text && q.status !== "resolved")
  const replyingTo = activeQueryForResponse === undefined ? (isHospital ? firstUnanswered?.id : null) : activeQueryForResponse

  const handleGenerateAIDraft = () => {
    setAiDrafted(true)
    setNewQueryText(
      "Query regarding itemized surgical breakdown: Please provide attending surgeon operation notes and clarify if laparoscopic equipment charges were bundled into surgeon fee or charged separately under consumables."
    )
    toast({
      title: "AI draft ready",
      description: "Drafted from the flagged line items and the policy clauses. Edit it before sending.",
      variant: "info",
    })
  }

  const handleCreateQuery = async (e) => {
    e.preventDefault()
    if (!newQueryText.trim()) return

    setSubmitting(true)
    try {
      await api.queries.create(claimId, { query_text: newQueryText, ai_drafted: aiDrafted })
      toast({ title: "Query sent to the hospital", description: "The hospital billing desk sees it on this claim.", variant: "success" })
      setNewQueryText("")
      setAiDrafted(false)
      loadQueries()
    } catch (err) {
      toast({ title: "Couldn't send the query", description: err.message, variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  const handleHospitalRespond = async (queryId) => {
    if (!responseText.trim()) return
    setResponding(true)
    try {
      await api.queries.respond(queryId, { response_text: responseText })
      toast({ title: "Reply sent", description: "Your reply has been sent to the insurer.", variant: "success" })
      setActiveQueryForResponse(null)
      setResponseText("")
      loadQueries()
    } catch (err) {
      toast({ title: "Couldn't send the reply", description: err.message, variant: "destructive" })
    } finally {
      setResponding(false)
    }
  }

  const handleResolveQuery = async (queryId) => {
    setResolvingId(queryId)
    try {
      await api.queries.resolve(queryId, {
        resolution_note: "Satisfactory clarification received from hospital desk. Adjudication resumed.",
      })
      toast({ title: "Query resolved", description: "The hospital's explanation was accepted.", variant: "success" })
      loadQueries()
    } catch (err) {
      toast({ title: "Couldn't resolve the query", description: err.message, variant: "destructive" })
    } finally {
      setResolvingId(null)
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-start">
      {/* Compose (insurer) or guidance (hospital) */}
      {isInsurer ? (
        <section className="rounded-card bg-surface p-5 shadow-card lg:sticky lg:top-20" aria-label="Ask the hospital">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-body font-semibold text-ink">Ask the hospital</h3>
              <p className="mt-0.5 text-small text-ink-3">Unbundled items, missing notes or billing clarifications.</p>
            </div>
            <Button size="sm" variant="secondary" onClick={handleGenerateAIDraft}>
              <Sparkles className="h-3.5 w-3.5 text-peacock-500" />
              Draft with AI
            </Button>
          </div>
          <form onSubmit={handleCreateQuery} className="mt-4 space-y-3">
            <Textarea
              value={newQueryText}
              onChange={(e) => setNewQueryText(e.target.value)}
              placeholder="Write your question for the hospital billing desk, or let AI draft one from the flagged items"
              rows={5}
              required
              aria-label="Question for the hospital"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-tiny text-ink-3">
                {aiDrafted ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-peacock-700">
                    <Sparkles className="h-3 w-3" />
                    Drafted by AI · review before sending
                  </span>
                ) : (
                  "The hospital sees this on the claim"
                )}
              </span>
              <Button type="submit" disabled={!newQueryText.trim()} loading={submitting}>
                {!submitting && <Send className="h-4 w-4" />}
                {submitting ? "Sending…" : "Send to hospital"}
              </Button>
            </div>
          </form>
        </section>
      ) : (
        <section className="rounded-card bg-surface p-5 shadow-card" aria-label="About queries">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-peacock-50 text-peacock-600">
              <MessageSquare className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-body font-semibold text-ink">Questions from the insurer</h3>
              <p className="mt-0.5 text-small text-ink-3">
                When the adjuster needs a clarification it appears here. A quick, specific reply keeps the claim moving.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Threads */}
      <section aria-label="Query threads" className="space-y-3">
        <div className="flex items-baseline justify-between px-1">
          <h3 className="text-body font-semibold text-ink">{isHospital ? "From the insurer" : "Conversation"}</h3>
          <span className="text-small text-ink-3">
            {queries.length} {queries.length === 1 ? "query" : "queries"}
          </span>
        </div>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-28 rounded-card" />
            <Skeleton className="h-20 rounded-card" />
          </div>
        ) : queries.length === 0 ? (
          <div className="rounded-card bg-surface shadow-card">
            <EmptyState
              icon={MessageSquare}
              title="No queries on this claim"
              description={isHospital ? "The insurer hasn't asked anything. You'll see their questions here." : "Ask the hospital when something on the bill needs explaining."}
            />
          </div>
        ) : (
          queries.map((q) => {
            const status = STATUS[q.status] || STATUS.open
            const replying = replyingTo === q.id
            return (
              <article key={q.id} className="animate-rise overflow-hidden rounded-card bg-surface shadow-card">
                <div className="space-y-2 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-peacock-700 text-white">
                        <ShieldCheck className="h-4 w-4" />
                      </span>
                      <span className="text-small font-semibold text-ink">{isHospital ? "Insurer" : "Adjuster"}</span>
                      <span className="text-tiny text-ink-3">{formatRelative(q.created_at)}</span>
                      {q.ai_drafted && (
                        <Badge variant="peacock">
                          <Sparkles />
                          AI drafted
                        </Badge>
                      )}
                    </div>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>
                  <p className="text-sm leading-relaxed text-ink">{q.query_text}</p>
                </div>

                {q.response_text ? (
                  <div className="border-t border-line bg-ground/70 p-4 sm:p-5">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-marigold-100 text-marigold-800">
                        <Building2 className="h-4 w-4" />
                      </span>
                      <span className="text-small font-semibold text-ink">{isHospital ? "Your reply" : "Hospital billing desk"}</span>
                      <span className="text-tiny text-ink-3">{formatRelative(q.responded_at)}</span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-ink">{q.response_text}</p>
                    {q.status === "resolved" && q.resolution_note && (
                      <p className="mt-3 flex items-start gap-1.5 text-small text-leaf-700">
                        <CheckCheck className="mt-0.5 h-4 w-4 shrink-0" />
                        {q.resolution_note}
                      </p>
                    )}
                    {isInsurer && q.status !== "resolved" && (
                      <div className="mt-3 flex justify-end">
                        <Button size="sm" variant="success" onClick={() => handleResolveQuery(q.id)} loading={resolvingId === q.id}>
                          {resolvingId !== q.id && <CheckCheck className="h-4 w-4" />}
                          Mark resolved & continue
                        </Button>
                      </div>
                    )}
                  </div>
                ) : !isHospital ? (
                  <div className="border-t border-line px-5 py-3 text-small text-ink-3">Waiting for the hospital's reply</div>
                ) : replying ? (
                  <div className="border-t border-marigold-100 bg-marigold-50 p-4 sm:p-5">
                    <label htmlFor={`reply-${q.id}`} className="text-small font-semibold text-ink-2">
                      Your reply to the insurer
                    </label>
                    <Textarea
                      id={`reply-${q.id}`}
                      value={responseText}
                      onChange={(e) => setResponseText(e.target.value)}
                      placeholder="Answer the question; mention any document you've attached"
                      rows={3}
                      className="mt-1.5"
                    />
                    <div className="mt-3 flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setActiveQueryForResponse(null)} disabled={responding}>
                        Cancel
                      </Button>
                      <Button size="sm" variant="proceed" onClick={() => handleHospitalRespond(q.id)} disabled={!responseText.trim()} loading={responding}>
                        {!responding && <Send className="h-3.5 w-3.5" />}
                        Send reply
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className={cn("flex justify-end border-t border-line px-4 py-3")}>
                    <Button size="sm" variant="secondary" onClick={() => setActiveQueryForResponse(q.id)}>
                      <Reply className="h-3.5 w-3.5" />
                      Reply
                    </Button>
                  </div>
                )}
              </article>
            )
          })
        )}
      </section>
    </div>
  )
}
