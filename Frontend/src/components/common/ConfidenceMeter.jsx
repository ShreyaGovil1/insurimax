import { cn } from "../../lib/utils"

/** AI confidence with the auto-approval threshold marked on the bar. */
export function ConfidenceMeter({ value, threshold = 0.92, className, showLabel = true }) {
  if (value == null) return <span className="text-small text-ink-3">Not run</span>
  const pct = Math.round(value * 100)
  const high = value >= threshold
  return (
    <div className={cn("flex items-center gap-2", className)} title={`AI confidence ${pct}% (auto-approval needs ${Math.round(threshold * 100)}%)`}>
      <div className="relative h-1.5 w-14 overflow-hidden rounded-full bg-sunken">
        <div className={cn("h-full rounded-full", high ? "bg-leaf-500" : "bg-sand-400")} style={{ width: `${pct}%` }} />
        <span className="absolute inset-y-0 w-px bg-ink-3/70" style={{ left: `${threshold * 100}%` }} aria-hidden="true" />
      </div>
      {showLabel && <span className="figures text-small font-semibold text-ink">{pct}%</span>}
    </div>
  )
}
