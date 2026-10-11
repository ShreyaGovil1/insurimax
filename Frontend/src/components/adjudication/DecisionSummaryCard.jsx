import { useState } from "react"
import { AlertTriangle, CheckCircle2, ChevronDown, FileText, MinusCircle, PenLine, Sparkles, XCircle } from "lucide-react"
import { cn, formatCurrencyINR } from "../../lib/utils"

/**
 * Overall "why" of an adjudication: the AI's narrative plus the line items grouped by outcome.
 * Groups use each item's final_status, so they stay correct after adjuster overrides.
 */
const GROUPS = [
  {
    key: "flagged",
    label: "Flagged for review",
    statuses: ["flagged"],
    amountKey: "billed_amount_inr",
    amountLabel: "under review",
    icon: AlertTriangle,
    box: "bg-marigold-50 ring-marigold-200",
    head: "text-marigold-800",
    chip: "bg-marigold-400 text-ink",
  },
  {
    key: "excluded",
    label: "Excluded",
    statuses: ["non_payable", "rejected"],
    amountKey: "deducted_amount_inr",
    amountLabel: "not paid",
    icon: XCircle,
    box: "bg-vermilion-50 ring-vermilion-100",
    head: "text-vermilion-700",
    chip: "bg-vermilion-50 text-vermilion-700 ring-1 ring-inset ring-vermilion-100",
  },
  {
    key: "reduced",
    label: "Reduced",
    statuses: ["partially_approved"],
    amountKey: "deducted_amount_inr",
    amountLabel: "deducted",
    icon: MinusCircle,
    box: "bg-sand-50 ring-sand-200",
    head: "text-sand-700",
    chip: "bg-sand-50 text-sand-700 ring-1 ring-inset ring-sand-200",
  },
  {
    key: "accepted",
    label: "Accepted in full",
    statuses: ["approved"],
    amountKey: "approved_amount_inr",
    amountLabel: "approved",
    icon: CheckCircle2,
    box: "bg-leaf-50 ring-leaf-100",
    head: "text-leaf-700",
    chip: "bg-leaf-50 text-leaf-700 ring-1 ring-inset ring-leaf-100",
  },
]

const firstSentence = (text) => {
  const t = String(text || "").trim()
  const i = t.indexOf(". ")
  return i > 0 ? t.slice(0, i + 1) : t
}

export function DecisionSummaryCard({ adjudication, onSelectItem, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  const [showAccepted, setShowAccepted] = useState(false)
  if (!adjudication) {
    return (
      <div className="flex items-start gap-3 rounded-card border border-dashed border-line-strong bg-surface/60 px-5 py-4 text-sm text-ink-3">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ink-4" />
        <span>
          <strong className="font-semibold text-ink-2">Decision summary</strong> will appear here once the claim has been
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
  }).filter((g) => g.rows.length)

  return (
    <section className="overflow-hidden rounded-card bg-surface shadow-card" aria-label="Decision summary">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-ground/60"
      >
        <span className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-peacock-50 text-peacock-600">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="text-body font-semibold text-ink">Decision summary</span>
          <span className="hidden text-small text-ink-3 md:inline">Why items were accepted, reduced or excluded</span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {groups.map((g) => (
            <span key={g.key} className={cn("hidden rounded-full px-2 py-0.5 text-tiny font-semibold sm:inline-flex", g.chip)}>
              {g.rows.length} {g.label.toLowerCase()}
            </span>
          ))}
          <ChevronDown className={cn("h-4 w-4 text-ink-3 transition-transform duration-200", open && "rotate-180")} />
        </span>
      </button>

      {open && (
        <div className="grid animate-rise gap-5 border-t border-line p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          {/* Narrative */}
          <div className="space-y-3">
            {narrative?.overview ? (
              <>
                <div className="text-tiny font-semibold text-ink-3">
                  {narrative.generated_by === "rules" ? "Summary from the rules engine" : "AI summary"}
                </div>
                <p className="text-sm leading-relaxed text-ink">{narrative.overview}</p>
                {narrative.key_reasons?.length > 0 && (
                  <ul className="space-y-1.5">
                    {narrative.key_reasons.map((r, i) => (
                      <li key={i} className="flex gap-2.5 text-small leading-relaxed text-ink-2">
                        <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-peacock-400" aria-hidden="true" />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-sm text-ink-3">
                No written summary for this adjudication yet. Rerun AI adjudication to generate one; the breakdown is computed
                from the current decisions.
              </p>
            )}
            {overriddenCount > 0 && (
              <p className="flex gap-2 rounded-lg bg-sand-50 px-3 py-2 text-small text-sand-800 ring-1 ring-inset ring-sand-200">
                <PenLine className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {overriddenCount} item{overriddenCount === 1 ? " was" : "s were"} changed by an adjuster after the AI run. The
                  breakdown shows the final decisions; the summary describes the AI's original assessment.
                </span>
              </p>
            )}
          </div>

          {/* Breakdown by outcome */}
          <div className="space-y-2.5">
            {groups.map((g) => {
              const Icon = g.icon
              const collapsed = g.key === "accepted" && !showAccepted
              return (
                <div key={g.key} className={cn("rounded-xl p-3 ring-1 ring-inset", g.box)}>
                  <div className="flex items-center justify-between gap-2 text-small font-semibold">
                    <span className={cn("flex items-center gap-1.5", g.head)}>
                      <Icon className="h-4 w-4" />
                      {`${g.label} (${g.rows.length})`}
                    </span>
                    <span className="figures text-ink-2">
                      {formatCurrencyINR(g.total)} {g.amountLabel}
                    </span>
                  </div>
                  {g.key === "accepted" && (
                    <button
                      type="button"
                      onClick={() => setShowAccepted((s) => !s)}
                      className="mt-1 cursor-pointer text-tiny font-semibold text-leaf-700 underline-offset-2 hover:underline"
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
                            className="w-full cursor-pointer rounded-lg bg-surface/80 px-3 py-2 text-left transition-[background-color,box-shadow] hover:bg-surface hover:shadow-card"
                            title="Open this line item"
                          >
                            <div className="flex items-start justify-between gap-2 text-small">
                              <span className="font-semibold text-ink">
                                <span className="figures mr-1 font-normal text-ink-3">#{item.line_number}</span>
                                {item.item_name}
                                {item.is_overridden && (
                                  <span className="ml-1.5 rounded bg-sand-100 px-1 text-[10px] font-bold uppercase tracking-wide text-sand-700">
                                    Adjuster override
                                  </span>
                                )}
                              </span>
                              <span className="figures shrink-0 text-ink-2">{formatCurrencyINR(item[g.amountKey])}</span>
                            </div>
                            {g.key !== "accepted" && (
                              <p className="mt-0.5 text-tiny leading-snug text-ink-3">
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
    </section>
  )
}
