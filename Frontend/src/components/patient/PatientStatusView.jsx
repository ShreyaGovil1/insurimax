import React, { useState, useEffect } from "react"
import {
  ShieldCheck,
  Search,
  Clock,
  CheckCircle2,
  AlertCircle,
  Bell,
  Mail,
  Phone,
  ArrowRight,
  Sparkles,
  Lock,
  Calendar,
  ExternalLink,
} from "lucide-react"
import { useParams, useNavigate } from "react-router-dom"
import { api } from "../../services/api"
import { formatCurrencyINR, formatDateTime } from "../../lib/utils"
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import { Input } from "../ui/input"
import { useToast } from "../ui/toast"

const SAMPLE_CLAIM_ID = "88888888-8888-8888-8888-888888888881"

const STATUS_STEPS = [
  { key: "submitted", label: "Claim Received", desc: "Hospital submitted claim documents" },
  { key: "in_review", label: "AI & Clinical Review", desc: "Automated OCR & clause adjudication" },
  { key: "queried", label: "Hospital Clarification", desc: "Awaiting hospital billing inputs" },
  { key: "approved", label: "Adjudication Approved", desc: "Cashless authorization issued" },
  { key: "finalized", label: "Claim Settled", desc: "Discharge & payout complete" },
]

export function PatientStatusView() {
  const { toast } = useToast()
  let params = {}
  let navigate = () => {}
  try {
    params = useParams() || {}
    navigate = useNavigate()
  } catch {}

  const urlClaimId = params.claimId || ""
  const [claimIdInput, setClaimIdInput] = useState(urlClaimId || SAMPLE_CLAIM_ID)
  const [claimStatus, setClaimStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)

  // Notification subscription state
  const [subEmail, setSubEmail] = useState("")
  const [subPhone, setSubPhone] = useState("")
  const [submittingNotification, setSubmittingNotification] = useState(false)
  const [subscribed, setSubscribed] = useState(false)

  const fetchStatus = async (id) => {
    if (!id) return
    setLoading(true)
    setNotFound(false)
    try {
      const data = await api.patient.getStatus(id)
      setClaimStatus(data)
    } catch (err) {
      setNotFound(true)
      setClaimStatus(null)
      toast({
        title: "Claim Not Found",
        description: "Please check your Claim Reference ID and try again.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (urlClaimId) {
      setClaimIdInput(urlClaimId)
      fetchStatus(urlClaimId)
    } else {
      fetchStatus(SAMPLE_CLAIM_ID)
    }
  }, [urlClaimId])

  const handleSearch = (e) => {
    e.preventDefault()
    if (!claimIdInput.trim()) return
    if (navigate) navigate(`/patient/${claimIdInput.trim()}`)
    fetchStatus(claimIdInput.trim())
  }

  const handleSubscribe = async (e) => {
    e.preventDefault()
    if (!subEmail.trim() && !subPhone.trim()) {
      toast({
        title: "Input Required",
        description: "Enter at least an email or mobile number to receive updates.",
        variant: "destructive",
      })
      return
    }

    setSubmittingNotification(true)
    try {
      const targetId = claimStatus?.claim_id || claimIdInput
      await api.patient.subscribeNotifications(targetId, {
        email: subEmail.trim() || null,
        phone: subPhone.trim() || null,
      })
      setSubscribed(true)
      toast({
        title: "Alerts Activated",
        description: "You will receive instant SMS/email updates as your claim progresses.",
        variant: "success",
      })
    } catch (err) {
      toast({
        title: "Subscription Failed",
        description: err.message,
        variant: "destructive",
      })
    } finally {
      setSubmittingNotification(false)
    }
  }

  // Determine active step index based on backend status
  const getStepIndex = (status) => {
    switch (status) {
      case "submitted":
        return 0
      case "documents_pending":
      case "extraction_in_progress":
      case "adjudication_in_progress":
      case "in_review":
      case "escalated":
        return 1
      case "queried":
        return 2
      case "approved":
      case "auto_approved":
      case "partially_approved":
        return 3
      case "finalized":
        return 4
      default:
        return 1
    }
  }

  const currentStepIdx = claimStatus ? getStepIndex(claimStatus.status) : 1

  return (
    <div className="space-y-8 max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Privacy Notice Banner */}
      <div className="flex items-center justify-between p-3.5 bg-slate-900 text-white rounded-2xl shadow-xs">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-[#A3FF12]">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-bold tracking-wide flex items-center gap-1.5">
              <span>Patient Privacy Shield</span>
              <span className="text-[10px] text-slate-400 font-normal">| Zero PII Exposure</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Only tokenized claim progress and approved amounts are displayed.
            </p>
          </div>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-slate-400 font-medium">
          <Clock className="w-3.5 h-3.5 text-[#A3FF12]" />
          IRDAI 3-Hour Mandate Active
        </span>
      </div>

      {/* Search Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold border border-blue-100">
          <Sparkles className="w-3.5 h-3.5" />
          Real-Time Cashless Tracker
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
          Track Your Insurance Claim
        </h1>
        <p className="text-sm text-slate-500 max-w-lg mx-auto">
          Enter your claim reference ID provided by the hospital or TPA desk to view live status updates.
        </p>

        {/* Claim ID Search Form */}
        <form onSubmit={handleSearch} className="max-w-xl mx-auto flex items-center gap-2 pt-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              type="text"
              placeholder="e.g. 88888888-8888-8888-8888-888888888881"
              value={claimIdInput}
              onChange={(e) => setClaimIdInput(e.target.value)}
              className="pl-10 h-12 bg-white rounded-xl border-slate-200 text-sm shadow-xs focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <Button
            type="submit"
            disabled={loading}
            className="h-12 px-6 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold shadow-xs flex items-center gap-2 cursor-pointer"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <span>Track</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </form>
      </div>

      {/* Main Status Display */}
      {claimStatus && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Card: Current Status Hero */}
          <Card className="rounded-2xl border-slate-200/80 shadow-sm overflow-hidden bg-white">
            <div className="p-6 sm:p-8 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 text-white relative">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <span className="text-[11px] font-semibold text-[#A3FF12] uppercase tracking-wider">
                    Current Stage
                  </span>
                  <h2 className="text-xl sm:text-2xl font-bold mt-0.5 capitalize">
                    {claimStatus.status.replace(/_/g, " ")}
                  </h2>
                  <p className="text-xs text-slate-300 mt-1 max-w-md">
                    {claimStatus.status_message}
                  </p>
                </div>

                {claimStatus.approved_amount_inr != null && (
                  <div className="bg-white/10 backdrop-blur-md border border-white/15 p-4 rounded-xl text-right sm:min-w-[180px]">
                    <span className="text-[10px] text-slate-300 uppercase font-semibold">
                      Authorized Amount
                    </span>
                    <div className="text-2xl font-extrabold text-[#A3FF12]">
                      {formatCurrencyINR(claimStatus.approved_amount_inr)}
                    </div>
                    <span className="text-[10px] text-slate-400">Cashless approved</span>
                  </div>
                )}
              </div>

              {/* Timestamp details */}
              <div className="mt-6 pt-4 border-t border-white/10 flex flex-wrap items-center gap-6 text-xs text-slate-400">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-300" />
                  <span>Submitted: {formatDateTime(claimStatus.submitted_at)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-300" />
                  <span>Last Updated: {formatDateTime(claimStatus.last_updated)}</span>
                </div>
              </div>
            </div>

            {/* Stepper Timeline */}
            <div className="p-6 sm:p-8 bg-slate-50/50">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-6">
                Adjudication Milestones
              </h3>

              <div className="relative">
                {/* Connecting bar */}
                <div className="absolute left-4 top-4 bottom-4 w-0.5 bg-slate-200 hidden sm:block" />

                <div className="space-y-6">
                  {STATUS_STEPS.map((step, idx) => {
                    const isDone = idx < currentStepIdx
                    const isCurrent = idx === currentStepIdx
                    const isPending = idx > currentStepIdx

                    return (
                      <div key={step.key} className="flex items-start gap-4">
                        {/* Circle Indicator */}
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10 transition-colors ${
                            isDone
                              ? "bg-emerald-600 text-white"
                              : isCurrent
                              ? "bg-slate-900 text-[#A3FF12] ring-4 ring-slate-100"
                              : "bg-white border-2 border-slate-200 text-slate-400"
                          }`}
                        >
                          {isDone ? (
                            <CheckCircle2 className="w-4 h-4" />
                          ) : (
                            <span className="text-xs font-bold">{idx + 1}</span>
                          )}
                        </div>

                        {/* Text */}
                        <div className="flex-1 pt-0.5">
                          <div className="flex items-center justify-between">
                            <span
                              className={`text-xs font-bold ${
                                isCurrent
                                  ? "text-slate-900"
                                  : isDone
                                  ? "text-slate-800"
                                  : "text-slate-400"
                              }`}
                            >
                              {step.label}
                            </span>
                            {isCurrent && (
                              <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">
                                In Progress
                              </Badge>
                            )}
                            {isDone && (
                              <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1">
                                Completed
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">{step.desc}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </Card>

          {/* Card: Notification Subscription */}
          <Card className="rounded-2xl border-slate-200/80 shadow-xs bg-white">
            <CardHeader className="pb-3">
              <div className="flex items-center space-x-2">
                <Bell className="w-4 h-4 text-blue-600" />
                <CardTitle className="text-sm font-bold text-slate-900">
                  Subscribe to Status Notifications
                </CardTitle>
              </div>
              <p className="text-xs text-slate-500">
                Receive instant SMS or email notifications when the TPA approves your cashless authorization.
              </p>
            </CardHeader>
            <CardContent>
              {subscribed ? (
                <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div className="text-xs">
                    <span className="font-bold">Subscription Active!</span>
                    <p className="text-emerald-700 mt-0.5">
                      You will receive notifications at {subEmail || subPhone} when this claim updates.
                    </p>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubscribe} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input
                        type="email"
                        placeholder="Email for updates"
                        value={subEmail}
                        onChange={(e) => setSubEmail(e.target.value)}
                        className="pl-9 h-10 text-xs"
                      />
                    </div>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input
                        type="tel"
                        placeholder="Mobile (10 digits)"
                        value={subPhone}
                        onChange={(e) => setSubPhone(e.target.value)}
                        className="pl-9 h-10 text-xs"
                      />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    disabled={submittingNotification}
                    className="w-full sm:w-auto h-10 px-5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    {submittingNotification ? (
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <Bell className="w-3.5 h-3.5" />
                        <span>Enable SMS & Email Alerts</span>
                      </>
                    )}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Empty / Not Found State */}
      {notFound && (
        <Card className="p-8 text-center rounded-2xl border-slate-200">
          <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-2" />
          <h3 className="text-base font-bold text-slate-900">Claim ID Not Found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
            Could not find any claim with ID <span className="font-mono">{claimIdInput}</span>. Verify the ID or try sample claim ID below.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setClaimIdInput(SAMPLE_CLAIM_ID)
              fetchStatus(SAMPLE_CLAIM_ID)
            }}
            className="mt-4 text-xs font-semibold cursor-pointer"
          >
            Load Sample Claim ({SAMPLE_CLAIM_ID.slice(0, 13)}...)
          </Button>
        </Card>
      )}
    </div>
  )
}
