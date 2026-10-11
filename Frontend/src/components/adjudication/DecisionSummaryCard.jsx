import { useState } from "react"
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, FileText, MinusCircle, Sparkles, XCircle } from "lucide-react"
import { formatCurrencyINR } from "../../lib/utils"

/**
 * Overall "why" of an adjudication: the AI's narrative plus the line items grouped by outcome.
 * Groups use each item's final_status, so they stay correct after adjuster overrides.
 */
const GROUPS = [
  {
    key: "excluded",
    label: "Excluded",
    statuses: ["non_payable", "rejected"],
    amountKey: "deducted_amount_inr",
    amountLabel: "not paid",
    icon: XCircle,
    tone: "text-red-700 bg-red-50 border-red-200",
  },
  {
    key: "reduced",
    label: "Reduced",
    statuses: ["partially_approved"],
    amountKey: "deducted_amount_inr",
    amountLabel: "deducted",
    icon: MinusCircle,
    tone: "text-amber-800 bg-amber-50 border-amber-200",
  },
  {
    key: "flagged",
    label: "Flagged for review",
    statuses: ["flagged"],
    amountKey: "billed_amount_inr",
    amountLabel: "under review",
    icon: AlertTriangle,
    tone: "text-orange-800 bg-orange-50 border-orange-200",
  },
  {
    key: "accepted",
    label: "Accepted in full",
    statuses: ["approved"],
    amountKey: "approved_amount_inr",
    amountLabel: "approved",
    icon: CheckCircle2,
    tone: "text-emerald-800 bg-emerald-50 border-emerald-200",
  },
]

const firstSentence = (text) => {
  const t = String(text || "").trim()
  const i = t.indexOf(". ")
  return i > 0 ? t.slice(0, i + 1) : t
}

export function DecisionSummaryCard({ adjudication, onSelectItem }) {
  const [open, setOpen] = useState(true)
  const [showAccepted, setShowAccepted] = useState(false)
  if (!adjudication) {
    return (
      <div className="flex items-center gap-2 bg-white rounded-3xl border border-dashed border-slate-300 px-5 py-3 text-xs text-slate-500">
        <FileText className="w-4 h-4 text-slate-400" />
        <span>
          <strong className="text-slate-700">Decision Summary</strong> will appear here once the claim has been
          adjudicated: why each line item was accepted, reduced or excluded.
        </span>
      </div>
    )
  }

  const items = adjudication.line_items || []
  const narrative = adjudication.gemini_raw_response?.decision_summary
  const overriddenCount = items.filter((i) => i.is_overridden).length
  const groups = GROUPS.map((g) => {
    const rows = items.filter((i) => g.statuses.includes(i.final_status))
    return { ...g, rows, total: rows.reduce((acc, i) => acc + (Number(i[g.amountKey]) || 0), 0) }
  })

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3 text-left hover:bg-slate-50 cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-bold text-slate-900">Decision Summary</span>
          <span className="text-[11px] text-slate-500">Why items were accepted or excluded</span>
        </div>
        <div className="flex items-center gap-2">
          {groups
            .filter((g) => g.rows.length)
            .map((g) => (
              <span key={g.key} className={`hidden sm:inline text-[10px] font-semibold px-2 py-0.5 rounded-full border ${g.tone}`}>
                {g.rows.length} {g.label.toLowerCase()}
              </span>
            ))}
          {open ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
        </div>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-slate-100">
          {/* Narrative */}
          <div className="pt-4">
            {narrative?.overview ? (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <Sparkles className="w-3 h-3 text-purple-600" />
                  {narrative.generated_by === "rules" ? "Summary (rules engine)" : "AI summary"}
                </div>
                <p className="text-xs text-slate-800 leading-relaxed">{narrative.overview}</p>
                {narrative.key_reasons?.length > 0 && (
                  <ul className="list-disc pl-5 space-y-1 text-xs text-slate-700">
                    {narrative.key_reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                No written summary for this adjudication yet. Rerun AI adjudication to generate one; the
                breakdown below is computed from the current decisions.
              </p>
            )}
            {overriddenCount > 0 && (
              <p className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                {overriddenCount} item{overriddenCount === 1 ? " was" : "s were"} changed by an adjuster after the AI run.
                The breakdown below shows the final decisions; the summary above describes the AI's original assessment.
              </p>
            )}
          </div>

          {/* Breakdown by outcome */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
            {groups
              .filter((g) => g.rows.length)
              .map((g) => {
                const Icon = g.icon
                const collapsed = g.key === "accepted" && !showAccepted
                return (
                  <div key={g.key} className={`rounded-2xl border p-3 ${g.tone}`}>
                    <div className="flex items-center justify-between gap-2 text-xs font-bold">
                      <span className="flex items-center gap-1.5">
                        <Icon className="w-3.5 h-3.5" />
                        {g.label} ({g.rows.length})
                      </span>
                      <span className="font-mono">
                        {formatCurrencyINR(g.total)} {g.amountLabel}
                      </span>
                    </div>
                    {g.key === "accepted" && (
                      <button
                        type="button"
                        onClick={() => setShowAccepted((s) => !s)}
                        className="mt-1 text-[11px] underline cursor-pointer"
                      >
                        {showAccepted ? "Hide items" : "Show items"}
                      </button>
                    )}
                    {!collapsed && (
                      <ul className="mt-2 space-y-1.5">
                        {g.rows.map((item) => (
                          <li key={item.id}>
                            <button
                              type="button"
                              onClick={() => onSelectItem?.(item)}
                              className="w-full text-left rounded-lg bg-white/70 hover:bg-white px-2.5 py-1.5 border border-white/60 cursor-pointer"
                              title="Open this line item"
                            >
                              <div className="flex items-start justify-between gap-2 text-[11px]">
                                <span className="font-semibold text-slate-900">
                                  #{item.line_number} {item.item_name}
                                  {item.is_overridden && (
                                    <span className="ml-1.5 text-[9px] font-bold uppercase px-1 rounded bg-amber-200 text-amber-900">
                                      Adjuster override
                                    </span>
                                  )}
                                </span>
                                <span className="font-mono text-slate-700 shrink-0">{formatCurrencyINR(item[g.amountKey])}</span>
                              </div>
                              {g.key !== "accepted" && (
                                <p className="mt-0.5 text-[11px] text-slate-600 leading-snug">
                                  {item.is_overridden && item.override_note ? item.override_note : firstSentence(item.ai_explanation)}
                                </p>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}
