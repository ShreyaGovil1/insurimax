import { useState } from "react"
import { BookOpen, ChevronLeft, ChevronRight, FileText, PenLine, Quote, Sparkles } from "lucide-react"
import { cn, formatCurrencyINR, humanize } from "../../lib/utils"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Select } from "../ui/select"
import { Textarea } from "../ui/textarea"
import { Field } from "../ui/field"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog"
import { DecisionPill } from "../common/status"
import { CitationButton } from "../documents/CitationViewer"
import { OVERRIDE_REASON_LABELS } from "./journey"

const DECISIONS = [
  { value: "approved", label: "Approve" },
  { value: "partially_approved", label: "Reduce" },
  { value: "non_payable", label: "Non-payable" },
  { value: "rejected", label: "Reject" },
  { value: "flagged", label: "Flag" },
]

/**
 * Right-hand panel: the AI's reasoning for one line item, the policy text it relied on,
 * where the item sits on the bill, and (for the insurer) the entry point to override it.
 */
export function ExplanationPanel({
  item,
  explanation,
  position,
  total,
  onPrev,
  onNext,
  canOverride,
  onStartOverride,
  activeCitation,
  onOpenCitation,
  isHospital,
}) {
  if (!item) {
    return (
      <section className="rounded-card bg-surface p-8 text-center shadow-card">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-sunken text-ink-3">
          <BookOpen className="h-5 w-5" />
        </div>
        <p className="text-sm text-ink-3">Select a line item to see why it was decided and the policy clause behind it.</p>
      </section>
    )
  }

  const expl = explanation?.item_id === item.id ? explanation : null
  const cd = item.citation_data || expl?.citation_data || {}
  const clause = expl?.clause_reference || cd.clause_reference
  const clausePage = expl?.clause_page || cd.clause_page
  const billSource = cd.source
  const policyEvidence = cd.policy_evidence || []
  const reasoning = expl?.ai_explanation || item.ai_explanation
  const isActive = (c) => activeCitation === c

  return (
    <section aria-label="Line item decision" className="overflow-hidden rounded-card bg-surface shadow-raised">
      <header className="border-b border-line px-5 pb-4 pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-small font-semibold text-ink-3">Why this decision</span>
          {total > 1 && (
            <div className="flex items-center gap-1 text-tiny font-medium text-ink-3">
              <button
                type="button"
                onClick={onPrev}
                disabled={!onPrev}
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-sunken hover:text-ink disabled:cursor-default disabled:opacity-35"
                aria-label="Previous line item"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="figures min-w-[52px] text-center">
                {position} of {total}
              </span>
              <button
                type="button"
                onClick={onNext}
                disabled={!onNext}
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-sunken hover:text-ink disabled:cursor-default disabled:opacity-35"
                aria-label="Next line item"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
        <h3 className="mt-1.5 text-lg font-semibold leading-snug text-ink">{expl?.item_name || item.item_name}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <DecisionPill status={item.final_status} />
          <span className="text-tiny text-ink-3">
            Line {item.line_number}
            {item.item_category ? ` · ${humanize(item.item_category)}` : ""}
          </span>
        </div>
      </header>

      <div key={item.id} className="animate-rise space-y-5 p-5">
        <dl className="grid grid-cols-3 overflow-hidden rounded-xl bg-ground text-center">
          <AmountCell label="Billed" value={item.billed_amount_inr} />
          <AmountCell label="Approved" value={item.approved_amount_inr} tone="text-leaf-700" />
          <AmountCell label="Deducted" value={item.deducted_amount_inr} tone={Number(item.deducted_amount_inr) > 0 ? "text-vermilion-700" : "text-ink-3"} />
        </dl>

        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-small font-semibold text-ink-2">
            <Sparkles className="h-4 w-4 text-peacock-500" />
            {isHospital ? "Insurer's AI reasoning" : "AI reasoning"}
          </div>
          <p className="text-sm leading-relaxed text-ink">{reasoning || "No reasoning was recorded for this item."}</p>
        </div>

        <div className="rounded-xl bg-peacock-50/70 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-small font-semibold text-peacock-800">
                <BookOpen className="h-4 w-4" />
                Policy basis
              </div>
              <div className="mt-1 text-sm font-semibold text-ink">{clause || "Standard health insurance schedule"}</div>
              {clausePage && <div className="text-tiny text-ink-3">Page {clausePage} of the policy wording</div>}
            </div>
          </div>
          {cd.limit_data && (
            <div className="mt-3 rounded-lg bg-surface/80 px-3 py-2 font-mono text-tiny text-ink-2">
              Rule limit: {typeof cd.limit_data === "string" ? cd.limit_data : JSON.stringify(cd.limit_data)}
            </div>
          )}
          {policyEvidence.length > 0 && (
            <div className="mt-3 space-y-2">
              {policyEvidence.map((ev) => (
                <figure
                  key={ev.evidence_id}
                  className={cn("rounded-lg bg-surface p-3 transition-shadow", isActive(ev) && "ring-2 ring-marigold-400")}
                >
                  <blockquote className="flex gap-2 text-small leading-relaxed text-ink-2">
                    <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-peacock-400" />
                    <span className="line-clamp-4">{ev.text}</span>
                  </blockquote>
                  <figcaption className="mt-2 text-right">
                    <CitationButton
                      citation={ev}
                      label="View in policy"
                      active={isActive(ev)}
                      onClick={(c) => onOpenCitation({ citation: c, title: "Policy clause relied on" })}
                    />
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl bg-ground px-4 py-3">
          <span className="flex items-center gap-2 text-small text-ink-2">
            <FileText className="h-4 w-4 text-ink-3" />
            Where it appears on the hospital bill
          </span>
          {billSource?.document_id ? (
            <CitationButton
              citation={billSource}
              label="View bill"
              active={isActive(billSource)}
              onClick={(c) => onOpenCitation({ citation: c, title: "Billed on" })}
            />
          ) : (
            <span className="text-tiny text-ink-3">Re-read the bill to link it</span>
          )}
        </div>

        {item.is_overridden && (
          <div className="rounded-xl bg-sand-50 p-4 ring-1 ring-inset ring-sand-200">
            <div className="flex items-center gap-1.5 text-small font-semibold text-sand-800">
              <PenLine className="h-4 w-4" />
              Adjusted by the adjuster · {OVERRIDE_REASON_LABELS[item.override_reason] || humanize(item.override_reason) || "Reason not given"}
            </div>
            {item.override_note && <p className="mt-1.5 text-sm leading-relaxed text-sand-800">{item.override_note}</p>}
          </div>
        )}

        {canOverride && (
          <Button variant="secondary" className="w-full" onClick={() => onStartOverride(item)}>
            <PenLine className="h-4 w-4" />
            {item.is_overridden ? "Change this override" : "Override this decision"}
          </Button>
        )}
      </div>
    </section>
  )
}

function AmountCell({ label, value, tone = "text-ink" }) {
  return (
    <div className="px-2 py-3">
      <dt className="text-tiny font-medium text-ink-3">{label}</dt>
      <dd className={cn("figures mt-0.5 text-body font-semibold", tone)}>{formatCurrencyINR(value)}</dd>
    </div>
  )
}

/**
 * Pop-up for overriding one line item's AI decision. `item` is the line being overridden;
 * the dialog is open while it is set. The last item is kept through the closing animation.
 */
export function OverrideDialog({ item, claimApprovedTotal, onCancel, onSubmit }) {
  const [shown, setShown] = useState(item)
  if (item && item !== shown) setShown(item)

  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent onClose={onCancel}>
        {shown && (
          <>
            <DialogHeader>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-peacock-50 text-peacock-600">
                <PenLine className="h-5 w-5" />
              </div>
              <DialogTitle>Override the AI decision</DialogTitle>
              <DialogDescription>
                Line {shown.line_number}: {shown.item_name}
              </DialogDescription>
            </DialogHeader>
            <OverrideForm key={shown.id} item={shown} claimApprovedTotal={claimApprovedTotal} onCancel={onCancel} onSubmit={onSubmit} />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function OverrideForm({ item, claimApprovedTotal, onCancel, onSubmit }) {
  const billed = Number(item.billed_amount_inr) || 0
  const [form, setForm] = useState(() => ({
    new_status: item.final_status || item.ai_status || "approved",
    override_reason: item.override_reason || "clinical_necessity",
    new_approved_amount_inr: String(item.approved_amount_inr ?? billed),
    override_note: item.override_note || "",
  }))
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  const amount = parseFloat(form.new_approved_amount_inr)
  const validAmount = Number.isFinite(amount) && amount >= 0 && amount <= billed
  const delta = validAmount ? amount - (Number(item.approved_amount_inr) || 0) : 0

  const chooseStatus = (value) => {
    setForm((f) => ({
      ...f,
      new_status: value,
      new_approved_amount_inr:
        value === "approved" ? String(billed) : value === "non_payable" || value === "rejected" ? "0" : f.new_approved_amount_inr,
    }))
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!validAmount) return setError(`Enter an amount between ₹0 and ${formatCurrencyINR(billed)}.`)
    if (!form.override_note.trim()) return setError("Add a short note: it goes into the compliance audit trail.")
    setError("")
    setSaving(true)
    try {
      await onSubmit(form)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <fieldset>
        <legend className="mb-1.5 text-small font-semibold text-ink-2">New decision</legend>
        <div className="flex flex-wrap gap-1.5" role="radiogroup">
          {DECISIONS.map((d) => {
            const on = form.new_status === d.value
            return (
              <button
                key={d.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => chooseStatus(d.value)}
                className={cn(
                  "h-8 cursor-pointer rounded-lg px-3 text-small font-semibold transition-[background-color,color,box-shadow] duration-150",
                  on ? "bg-peacock-600 text-white shadow-[0_1px_2px_rgb(6_41_43/0.3)]" : "bg-sunken text-ink-2 hover:bg-line"
                )}
              >
                {d.label}
              </button>
            )
          })}
        </div>
      </fieldset>

      <Field label="Approved amount" htmlFor={`amt-${item.id}`} hint={`Billed ${formatCurrencyINR(billed)}`}>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-3">₹</span>
            <Input
              id={`amt-${item.id}`}
              type="number"
              min="0"
              max={billed}
              step="0.01"
              value={form.new_approved_amount_inr}
              onChange={(e) => setForm((f) => ({ ...f, new_approved_amount_inr: e.target.value }))}
              aria-invalid={!validAmount || undefined}
              className="figures pl-7"
            />
          </div>
          <Button type="button" variant="secondary" size="md" onClick={() => setForm((f) => ({ ...f, new_approved_amount_inr: String(billed) }))}>
            Full
          </Button>
          <Button type="button" variant="secondary" size="md" onClick={() => setForm((f) => ({ ...f, new_approved_amount_inr: "0" }))}>
            ₹0
          </Button>
        </div>
      </Field>

      <Field label="Reason" htmlFor={`reason-${item.id}`}>
        <Select
          id={`reason-${item.id}`}
          value={form.override_reason}
          onChange={(e) => setForm((f) => ({ ...f, override_reason: e.target.value }))}
        >
          {Object.entries(OVERRIDE_REASON_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Note for the audit trail" htmlFor={`note-${item.id}`} required>
        <Textarea
          id={`note-${item.id}`}
          value={form.override_note}
          onChange={(e) => setForm((f) => ({ ...f, override_note: e.target.value }))}
          placeholder="The clinical basis or policy exception behind this change"
          rows={3}
        />
      </Field>

      {validAmount && delta !== 0 && claimApprovedTotal != null && (
        <div className="figures rounded-lg bg-ground px-3 py-2 text-small text-ink-2">
          Claim approval {formatCurrencyINR(claimApprovedTotal)} →{" "}
          <span className="font-semibold text-ink">{formatCurrencyINR(claimApprovedTotal + delta)}</span>{" "}
          <span className={delta > 0 ? "text-leaf-700" : "text-vermilion-700"}>
            ({delta > 0 ? "+" : "−"}
            {formatCurrencyINR(Math.abs(delta))})
          </span>
        </div>
      )}

      {error && (
        <p role="alert" className="text-small font-medium text-vermilion-700">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {saving ? "Applying…" : "Apply override"}
        </Button>
      </div>
    </form>
  )
}
