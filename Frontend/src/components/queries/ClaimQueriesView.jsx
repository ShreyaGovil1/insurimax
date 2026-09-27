import React, { useState, useEffect } from "react"
import {
  MessageSquare,
  Sparkles,
  Send,
  CheckCircle2,
  Clock,
  Building,
  User,
  CheckCheck,
} from "lucide-react"
import { api } from "../../services/api"
import { formatDateTime } from "../../lib/utils"
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import { Textarea } from "../ui/textarea"
import { useToast } from "../ui/toast"

export function ClaimQueriesView({ claimId }) {
  const { toast } = useToast()
  const [queries, setQueries] = useState([])
  const [loading, setLoading] = useState(true)
  const [newQueryText, setNewQueryText] = useState("")
  const [aiDrafted, setAiDrafted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Hospital response simulated modal / form
  const [activeQueryForResponse, setActiveQueryForResponse] = useState(null)
  const [responseText, setResponseText] = useState("")

  const loadQueries = async () => {
    setLoading(true)
    try {
      const data = await api.queries.list(claimId)
      setQueries(data || [])
    } catch (err) {
      console.warn("Failed to load queries:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadQueries()
  }, [claimId])

  const handleGenerateAIDraft = () => {
    setAiDrafted(true)
    setNewQueryText(
      "Query regarding itemized surgical breakdown: Please provide attending surgeon operation notes and clarify if laparoscopic equipment charges were bundled into surgeon fee or charged separately under consumables."
    )
    toast({
      title: "AI Draft Generated",
      description: "Inquiry text drafted from flagged line items and IRDAI policy clauses.",
      variant: "info",
    })
  }

  const handleCreateQuery = async (e) => {
    e.preventDefault()
    if (!newQueryText.trim()) return

    setSubmitting(true)
    try {
      await api.queries.create(claimId, {
        query_text: newQueryText,
        ai_drafted: aiDrafted,
      })
      toast({
        title: "Query Dispatched to Hospital",
        description: "Sent to hospital billing desk via portal. Awaiting response.",
        variant: "success",
      })
      setNewQueryText("")
      setAiDrafted(false)
      loadQueries()
    } catch (err) {
      toast({
        title: "Dispatch Failed",
        description: err.message,
        variant: "destructive",
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleHospitalRespond = async (queryId) => {
    if (!responseText.trim()) return
    try {
      await api.queries.respond(queryId, {
        response_text: responseText,
      })
      toast({
        title: "Hospital Response Logged",
        description: "Response received from hospital billing desk.",
        variant: "success",
      })
      setActiveQueryForResponse(null)
      setResponseText("")
      loadQueries()
    } catch (err) {
      toast({
        title: "Failed to log response",
        description: err.message,
        variant: "destructive",
      })
    }
  }

  const handleResolveQuery = async (queryId) => {
    try {
      await api.queries.resolve(queryId, {
        resolution_note: "Satisfactory clarification received from hospital desk. Adjudication resumed.",
      })
      toast({
        title: "Query Resolved",
        description: "Adjuster satisfied with hospital explanation.",
        variant: "success",
      })
      loadQueries()
    } catch (err) {
      toast({
        title: "Resolve Failed",
        description: err.message,
        variant: "destructive",
      })
    }
  }

  return (
    <div className="space-y-6">
      {/* Raise New Query */}
      <Card>
        <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center space-x-2">
              <MessageSquare className="w-4 h-4 text-blue-600" />
              <span>Raise Clarification Query to Hospital Desk</span>
            </CardTitle>
            <p className="text-xs text-slate-500">
              Inquiries regarding unbundled line items, missing discharge notes, or billing clarifications.
            </p>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={handleGenerateAIDraft}
            className="text-xs gap-1.5 border-purple-200 text-purple-700 hover:bg-purple-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Draft Query</span>
          </Button>
        </CardHeader>

        <CardContent className="p-4">
          <form onSubmit={handleCreateQuery} className="space-y-3">
            <Textarea
              value={newQueryText}
              onChange={(e) => setNewQueryText(e.target.value)}
              placeholder="Type your inquiry for the hospital billing desk, or click 'AI Draft Query' to auto-generate from flagged items..."
              rows={3}
              required
            />

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-500">
                {aiDrafted && (
                  <span className="inline-flex items-center gap-1 text-purple-700 font-medium">
                    <Sparkles className="w-3 h-3" />
                    AI Drafted Context Activated
                  </span>
                )}
              </span>

              <Button
                type="submit"
                disabled={submitting || !newQueryText.trim()}
                className="text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{submitting ? "Sending..." : "Dispatch Query to Hospital"}</span>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Query History Threads */}
      <Card>
        <CardHeader className="pb-3 border-b border-slate-100">
          <CardTitle className="text-sm font-semibold">Active & Resolved Inquiries ({queries.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {queries.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              No queries raised yet for this claim.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {queries.map((q) => (
                <div key={q.id} className="p-4 space-y-3 text-xs">
                  {/* Query Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-slate-900">Adjuster Inquiry</span>
                      {q.ai_drafted && (
                        <Badge variant="purple" className="text-[10px] py-0 px-1.5">
                          AI Drafted
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge
                        variant={
                          q.status === "resolved"
                            ? "success"
                            : q.status === "responded"
                            ? "info"
                            : "warning"
                        }
                        className="text-[10px] capitalize"
                      >
                        {q.status}
                      </Badge>
                      <span className="text-slate-400 text-[10px]">{formatDateTime(q.created_at)}</span>
                    </div>
                  </div>

                  {/* Query Content */}
                  <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-lg text-slate-800 leading-relaxed">
                    {q.query_text}
                  </div>

                  {/* Hospital Response If Available */}
                  {q.response_text ? (
                    <div className="ml-4 p-3 bg-emerald-50/80 border border-emerald-200 rounded-lg space-y-1">
                      <div className="flex items-center justify-between text-[11px] font-bold text-emerald-900">
                        <span className="flex items-center space-x-1">
                          <Building className="w-3.5 h-3.5 text-emerald-700" />
                          <span>Hospital Billing Desk Response:</span>
                        </span>
                        <span className="text-emerald-700 font-normal">{formatDateTime(q.responded_at)}</span>
                      </div>
                      <p className="text-slate-800 leading-relaxed text-xs">{q.response_text}</p>

                      {q.status !== "resolved" && (
                        <div className="pt-2 text-right">
                          <Button
                            size="sm"
                            onClick={() => handleResolveQuery(q.id)}
                            className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                          >
                            <CheckCheck className="w-3.5 h-3.5" />
                            <span>Mark Resolved & Proceed</span>
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Hospital simulation input */
                    <div className="ml-4 pt-1">
                      {activeQueryForResponse === q.id ? (
                        <div className="space-y-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                          <label className="text-xs font-semibold text-blue-900 block">
                            Simulate Hospital Desk Reply:
                          </label>
                          <Textarea
                            value={responseText}
                            onChange={(e) => setResponseText(e.target.value)}
                            placeholder="Hospital response notes..."
                            rows={2}
                          />
                          <div className="flex justify-end space-x-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setActiveQueryForResponse(null)}
                              className="h-7 text-xs"
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleHospitalRespond(q.id)}
                              className="h-7 text-xs bg-blue-600 text-white"
                            >
                              Post Hospital Response
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setActiveQueryForResponse(q.id)}
                          className="h-7 text-[11px] text-blue-600 hover:bg-blue-50"
                        >
                          Simulate Hospital Desk Reply...
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
