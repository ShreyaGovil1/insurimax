import { AlertCircle, Clock, Timer } from "lucide-react"
import { calculateSLARemaining, cn } from "../../lib/utils"
import { useNow } from "../../hooks/useNow"

const SLA_WINDOW_MINUTES = 180 // IRDAI 3-hour cashless discharge window

const overBy = (minutes) => {
  const m = Math.abs(minutes)
  if (m < 1) return ""
  return m >= 60 ? ` · ${Math.floor(m / 60)}h ${m % 60}m over` : ` · ${m}m over`
}

/**
 * Live SLA countdown. Ticks every 30 seconds; turns marigold under 30 minutes and
 * vermilion once breached. `showBar` adds the share of the 3-hour window that is left.
 */
export function SLAUrgencyBadge({ slaDeadline, isBreached, showBar = false, className }) {
  useNow(30000)
  const sla = calculateSLARemaining(slaDeadline)
  const breached = isBreached || sla.isBreached

  let pill
  if (breached) {
    pill = (
      <span className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full bg-vermilion-600 px-2.5 text-tiny font-semibold text-white">
        <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
        <span>
          SLA breached
          {sla.remainingMinutes != null && sla.remainingMinutes <= 0 ? overBy(sla.remainingMinutes) : ""}
        </span>
      </span>
    )
  } else if (sla.remainingMinutes == null) {
    pill = (
      <span className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full bg-sunken px-2.5 text-tiny font-semibold text-ink-3">
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{sla.text}</span>
      </span>
    )
  } else if (sla.isUrgent) {
    pill = (
      <span className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full bg-marigold-100 px-2.5 text-tiny font-semibold text-marigold-800 ring-1 ring-inset ring-marigold-200">
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="absolute inset-0 rounded-full bg-marigold-500 animate-beacon" />
          <span className="relative h-2 w-2 rounded-full bg-marigold-500" />
        </span>
        <span className="figures">{sla.text}</span>
      </span>
    )
  } else {
    pill = (
      <span className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full bg-sunken px-2.5 text-tiny font-semibold text-ink-2">
        <Timer className="h-3.5 w-3.5 text-ink-3" aria-hidden="true" />
        <span className="figures">{sla.text}</span>
      </span>
    )
  }

  if (!showBar || sla.remainingMinutes == null) return className ? <span className={className}>{pill}</span> : pill

  const left = breached ? 0 : Math.min(1, Math.max(0, sla.remainingMinutes / SLA_WINDOW_MINUTES))
  return (
    <span className={cn("inline-flex flex-col gap-1.5", className)}>
      {pill}
      <span className="block h-1 w-full min-w-[96px] overflow-hidden rounded-full bg-sunken" aria-hidden="true">
        <span
          className={cn(
            "block h-full origin-left rounded-full transition-transform duration-700",
            breached ? "bg-vermilion-500" : sla.isUrgent ? "bg-marigold-500" : "bg-peacock-400"
          )}
          style={{ transform: `scaleX(${breached ? 1 : left})` }}
        />
      </span>
    </span>
  )
}
