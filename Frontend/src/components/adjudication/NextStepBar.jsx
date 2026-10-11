import { cn } from "../../lib/utils"
import { JourneyRail } from "../common/JourneyRail"
import { DecisionStamp } from "../common/DecisionStamp"

/**
 * The claim's route plus the one thing to do next. Every state of a claim answers
 * "what now?" here, with a single marigold action.
 */
export function NextStepBar({ steps, next, stamp }) {
  return (
    <section aria-label="Claim progress and next step" className="overflow-hidden rounded-card bg-surface shadow-card">
      <div className="px-3 pb-4 pt-5 sm:px-5">
        <JourneyRail steps={steps} />
      </div>
      {next && (
        <div
          className={cn(
            "relative flex flex-col gap-3 border-t px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5",
            next.tone === "alert" ? "border-vermilion-100 bg-vermilion-50" : next.tone === "done" ? "border-line bg-peacock-50/60" : "border-marigold-100 bg-marigold-50"
          )}
        >
          <div className="flex min-w-0 items-start gap-3">
            {next.icon && (
              <span
                className={cn(
                  "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                  next.tone === "alert" ? "bg-vermilion-600 text-white" : next.tone === "done" ? "bg-peacock-600 text-white" : "bg-marigold-400 text-ink"
                )}
              >
                <next.icon className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0">
              <div className="text-tiny font-semibold text-ink-3">{next.tone === "done" ? "Status" : "Next step"}</div>
              <div className="text-body font-semibold leading-snug text-ink">{next.title}</div>
              {next.detail && <p className="mt-0.5 max-w-2xl text-small text-ink-2">{next.detail}</p>}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            {stamp && <DecisionStamp {...stamp} className="mr-2 hidden sm:inline-flex" />}
            {next.secondary}
            {next.primary}
          </div>
        </div>
      )}
    </section>
  )
}
