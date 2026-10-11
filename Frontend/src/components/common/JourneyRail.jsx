import { AlertTriangle, Check } from "lucide-react"
import { cn } from "../../lib/utils"
import { ROUTE_STOPS, claimStage } from "../../lib/status"

/**
 * The claim's route, drawn like a metro line: stations already passed are filled,
 * the current one carries a marigold beacon, the rest wait on the line.
 * steps: [{ key, label, caption?, state: "done" | "current" | "todo" | "alert" }]
 */
const LIGHT = {
  track: "bg-line",
  fill: "bg-peacock-500",
  doneMarker: "bg-peacock-600 text-white",
  hollow: "bg-surface ring-line-strong",
  halo: "ring-marigold-100",
  current: "text-ink",
  done: "text-ink-2",
  todo: "text-ink-3",
  caption: "text-ink-3",
}
const DARK = {
  track: "bg-white/15",
  fill: "bg-peacock-300",
  doneMarker: "bg-peacock-300 text-peacock-900",
  hollow: "bg-peacock-800 ring-white/25",
  halo: "ring-marigold-400/25",
  current: "text-white",
  done: "text-peacock-100",
  todo: "text-peacock-200/70",
  caption: "text-peacock-200/70",
}

export function JourneyRail({ steps, className, size = "md", orientation = "horizontal", label = "Claim progress", onDark = false }) {
  const t = onDark ? DARK : LIGHT
  const n = steps.length
  const currentIdx = steps.findIndex((s) => s.state === "current" || s.state === "alert")
  const lastDone = steps.reduce((acc, s, i) => (s.state === "done" ? i : acc), -1)
  const reach = currentIdx >= 0 ? currentIdx : lastDone
  const progress = n > 1 ? Math.max(0, reach) / (n - 1) : 0
  const lg = size === "lg"

  if (orientation === "vertical") {
    return (
      <ol className={cn("relative", className)} aria-label={label}>
        {steps.map((step, i) => (
          <li key={step.key} className="relative flex gap-3.5 pb-6 last:pb-0">
            {i < n - 1 && (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-7 bottom-0 w-[3px] -translate-x-1/2 rounded-full",
                  lg ? "left-4" : "left-3",
                  i < reach ? t.fill : t.track
                )}
              />
            )}
            <Marker state={step.state} lg={lg} t={t} />
            <div className={cn("min-w-0", lg ? "pt-1" : "pt-0.5")}>
              <StepText step={step} lg={lg} t={t} />
            </div>
          </li>
        ))}
      </ol>
    )
  }

  const inset = `calc(100% / ${n * 2})`
  return (
    <ol
      className={cn("relative grid", className)}
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      aria-label={label}
    >
      <span
        aria-hidden="true"
        className={cn("absolute h-[3px] rounded-full", t.track, lg ? "top-[15px]" : "top-[11px]")}
        style={{ left: inset, right: inset }}
      />
      <span
        aria-hidden="true"
        className={cn(
          "absolute h-[3px] origin-left rounded-full transition-transform duration-700 ease-out-strong",
          t.fill,
          "animate-rail-fill",
          lg ? "top-[15px]" : "top-[11px]"
        )}
        style={{ left: inset, right: inset, transform: `scaleX(${progress})` }}
      />
      {steps.map((step) => (
        <li key={step.key} className="relative flex min-w-0 flex-col items-center px-1 text-center">
          <Marker state={step.state} lg={lg} t={t} />
          <div className={cn(lg ? "mt-3" : "mt-2")}>
            <StepText step={step} lg={lg} t={t} center />
          </div>
        </li>
      ))}
    </ol>
  )
}

function Marker({ state, lg, t }) {
  const box = lg ? "h-8 w-8" : "h-6 w-6"
  const icon = lg ? "h-4 w-4" : "h-3.5 w-3.5"
  if (state === "done") {
    return (
      <span className={cn("relative z-10 flex shrink-0 items-center justify-center rounded-full", t.doneMarker, box)}>
        <Check className={icon} strokeWidth={3} aria-hidden="true" />
      </span>
    )
  }
  if (state === "alert") {
    return (
      <span className={cn("relative z-10 flex shrink-0 items-center justify-center rounded-full bg-vermilion-600 text-white", box)}>
        <AlertTriangle className={icon} strokeWidth={2.5} aria-hidden="true" />
      </span>
    )
  }
  if (state === "current") {
    return (
      <span className={cn("relative z-10 flex shrink-0 items-center justify-center", box)}>
        <span className="absolute inset-0 rounded-full bg-marigold-400 animate-beacon" aria-hidden="true" />
        <span className={cn("relative flex items-center justify-center rounded-full bg-marigold-400 ring-4", t.halo, box)}>
          <span className={cn("rounded-full bg-ink", lg ? "h-2.5 w-2.5" : "h-2 w-2")} />
        </span>
      </span>
    )
  }
  return <span className={cn("relative z-10 shrink-0 rounded-full ring-2 ring-inset", t.hollow, box)} aria-hidden="true" />
}

function StepText({ step, lg, center, t }) {
  const tone = step.state === "current" || step.state === "alert" ? t.current : step.state === "done" ? t.done : t.todo
  return (
    <>
      <div className={cn("font-semibold leading-tight", lg ? "text-sm" : "text-small", tone)}>
        {step.label}
        <span className="sr-only">
          {step.state === "done" ? " (done)" : step.state === "current" ? " (current step)" : step.state === "alert" ? " (needs attention)" : ""}
        </span>
      </div>
      {step.caption && (
        <div className={cn("figures mt-0.5 text-tiny", t.caption, center && "hidden sm:block")}>{step.caption}</div>
      )}
    </>
  )
}

/** Four-stop route for table rows: Draft · Submitted · AI reviewed · Finalized */
export function MiniJourney({ status, className, showLabel = true }) {
  const stage = claimStage(status)
  const finished = stage === ROUTE_STOPS.length - 1
  return (
    <div className={cn("min-w-[84px]", className)}>
      <div className="flex items-center gap-1" role="img" aria-label={`Stage ${stage + 1} of ${ROUTE_STOPS.length}: ${ROUTE_STOPS[stage]}`}>
        {ROUTE_STOPS.map((stop, i) => (
          <span
            key={stop}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              i < stage || (finished && i === stage)
                ? "bg-peacock-500"
                : i === stage
                  ? "bg-marigold-400"
                  : "bg-line-strong/70"
            )}
          />
        ))}
      </div>
      {showLabel && <div className="mt-1 text-tiny font-medium text-ink-3">{ROUTE_STOPS[stage]}</div>}
    </div>
  )
}
