import { Sparkles } from "lucide-react"
import { cn, formatCurrencyINR, humanize } from "../../lib/utils"

const segmentTone = (category) => {
  const c = String(category).toLowerCase()
  if (/review|flag/.test(c)) return { bar: "bg-marigold-400", dot: "bg-marigold-400" }
  if (/non|exclu|reject|payable/.test(c)) return { bar: "bg-vermilion-400", dot: "bg-vermilion-400" }
  return { bar: "bg-sand-400", dot: "bg-sand-400" }
}

/** Billed → approved → deducted, with the split drawn to scale. */
export function MoneySummary({ claim, adjudication, threshold = 0.92 }) {
  const decided = Boolean(adjudication)
  const billed = Number(adjudication?.total_billed_inr ?? claim?.billed_amount ?? 0)
  const approved = Number(adjudication?.total_approved_inr ?? claim?.approved_amount ?? 0)
  const deducted = Number(adjudication?.total_deducted_inr ?? claim?.deducted_amount ?? Math.max(0, billed - approved))
  const pct = billed > 0 ? Math.round((approved / billed) * 100) : null
  const confidence = adjudication?.confidence_score
  const breakdown = Object.entries(adjudication?.deduction_breakdown || {})
    .map(([k, v]) => [k, Number(v) || 0])
    .filter(([, v]) => v > 0)
  const breakdownTotal = breakdown.reduce((a, [, v]) => a + v, 0)

  return (
    <section aria-label="Claim amounts" className="overflow-hidden rounded-card bg-surface shadow-card">
      <div className="grid grid-cols-2 lg:grid-cols-[1fr_1fr_1.35fr_1fr]">
        <Cell label="Total billed" className="border-b border-line lg:border-b-0">
          <Amount>{formatCurrencyINR(billed)}</Amount>
          <Hint>From the itemised hospital bill</Hint>
        </Cell>

        <Cell label="Approved" className="border-b border-l border-line lg:border-b-0">
          {decided ? (
            <>
              <Amount className="text-leaf-700">{formatCurrencyINR(approved)}</Amount>
              <Hint>{pct != null ? `${pct}% of the bill is admissible` : "Calculated from line items"}</Hint>
            </>
          ) : (
            <>
              <Amount className="text-ink-4">—</Amount>
              <Hint>Awaiting decision</Hint>
            </>
          )}
        </Cell>

        <Cell label="Deducted" className="lg:border-l lg:border-line">
          {decided ? (
            <>
              <Amount className={deducted > 0 ? "text-vermilion-700" : "text-ink"}>{formatCurrencyINR(deducted)}</Amount>
              {breakdown.length > 0 ? (
                <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                  {breakdown.map(([cat, amount]) => (
                    <li key={cat} className="inline-flex items-center gap-1.5 text-tiny text-ink-3">
                      <span className={cn("h-2 w-2 rounded-full", segmentTone(cat).dot)} />
                      {humanize(cat)}
                      <span className="figures font-semibold text-ink-2">{formatCurrencyINR(amount)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Hint>{deducted > 0 ? "Across reduced and excluded items" : "Nothing deducted"}</Hint>
              )}
            </>
          ) : (
            <>
              <Amount className="text-ink-4">—</Amount>
              <Hint>Shown once items are decided</Hint>
            </>
          )}
        </Cell>

        <Cell label="AI confidence" className="border-l border-line">
          {confidence != null ? (
            <>
              <div className="flex items-baseline gap-2">
                <Amount>{Math.round(confidence * 100)}%</Amount>
                <Sparkles className="h-4 w-4 text-peacock-500" aria-hidden="true" />
              </div>
              <div className="relative mt-2 h-1.5 w-full max-w-[160px] overflow-hidden rounded-full bg-sunken">
                <div
                  className={cn("h-full rounded-full", confidence >= threshold ? "bg-leaf-500" : "bg-sand-400")}
                  style={{ width: `${Math.round(confidence * 100)}%` }}
                />
                <span className="absolute inset-y-0 w-px bg-ink-3" style={{ left: `${threshold * 100}%` }} aria-hidden="true" />
              </div>
              <Hint>
                {adjudication?.auto_approved
                  ? "Eligible for auto-approval"
                  : confidence >= threshold
                    ? "Above the auto-approval bar"
                    : `Below the ${Math.round(threshold * 100)}% auto-approval bar`}
              </Hint>
            </>
          ) : (
            <>
              <Amount className="text-ink-4">—</Amount>
              <Hint>AI hasn't run on this claim</Hint>
            </>
          )}
        </Cell>
      </div>

      {decided && billed > 0 && (
        <div className="flex h-2 w-full bg-sunken" aria-hidden="true">
          <div className="h-full bg-leaf-500 transition-[width] duration-700 ease-out-strong" style={{ width: `${(approved / billed) * 100}%` }} />
          {breakdownTotal > 0
            ? breakdown.map(([cat, amount]) => (
                <div
                  key={cat}
                  className={cn("h-full border-l-2 border-surface transition-[width] duration-700 ease-out-strong", segmentTone(cat).bar)}
                  style={{ width: `${(amount / billed) * 100}%` }}
                />
              ))
            : deducted > 0 && <div className="h-full border-l-2 border-surface bg-vermilion-400" style={{ width: `${(deducted / billed) * 100}%` }} />}
        </div>
      )}
    </section>
  )
}

function Cell({ label, className, children }) {
  return (
    <div className={cn("min-w-0 p-4 sm:px-5", className)}>
      <div className="text-small font-medium text-ink-3">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  )
}

function Amount({ className, children }) {
  return <div className={cn("figures text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink", className)}>{children}</div>
}

function Hint({ children }) {
  return <div className="mt-1 text-tiny text-ink-3">{children}</div>
}
