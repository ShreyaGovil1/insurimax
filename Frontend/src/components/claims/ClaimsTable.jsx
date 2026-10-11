import { ChevronRight, ShieldAlert } from "lucide-react"
import { cn, formatCurrencyINR } from "../../lib/utils"
import { Avatar } from "../ui/avatar"
import { Skeleton } from "../ui/skeleton"
import { SLAUrgencyBadge } from "../common/SLAUrgencyBadge"
import { ClaimStatusPill } from "../common/status"
import { ConfidenceMeter } from "../common/ConfidenceMeter"
import { MiniJourney } from "../common/JourneyRail"

function SlaCell({ claim }) {
  if (claim.status === "draft") return <span className="text-small text-ink-3">Starts on submission</span>
  if (claim.status === "finalized") return <span className="text-small text-ink-3">Closed</span>
  return <SLAUrgencyBadge slaDeadline={claim.sla_deadline} isBreached={claim.sla_breached} showBar />
}

function PatientCell({ claim, onOpen }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={claim.patient_name} />
      <div className="min-w-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onOpen(claim)
          }}
          className="block max-w-full cursor-pointer truncate text-left text-sm font-semibold text-ink decoration-peacock-300 underline-offset-4 hover:underline focus-visible:underline"
        >
          {claim.patient_name}
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-tiny text-ink-3">{claim.claim_number}</span>
          {claim.has_identity_mismatch && (
            <span className="inline-flex items-center gap-1 rounded-md bg-vermilion-50 px-1.5 text-tiny font-semibold text-vermilion-700">
              <ShieldAlert className="h-3 w-3" />
              Name mismatch
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Claims as rows on wide screens and as stacked cards on phones.
 * variant "queue" shows AI confidence; "explorer" shows the approved amount.
 */
export function ClaimsTable({ claims, loading, onOpen, variant = "queue", renderActions, threshold, empty }) {
  if (loading) return <ClaimsTableSkeleton />
  if (!claims.length) return empty || null

  return (
    <>
      {/* Wide screens */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-small font-semibold text-ink-3">
              <th className="py-2.5 pl-5 pr-3 font-semibold">Patient & claim</th>
              <th className="px-3 py-2.5 font-semibold">Hospital & insurer</th>
              <th className="px-3 py-2.5 font-semibold">Stage</th>
              <th className="px-3 py-2.5 text-right font-semibold">{variant === "explorer" ? "Billed" : "Amount"}</th>
              {variant === "explorer" && <th className="px-3 py-2.5 text-right font-semibold">Approved</th>}
              <th className="px-3 py-2.5 font-semibold">SLA</th>
              {variant === "queue" && <th className="px-3 py-2.5 font-semibold">AI confidence</th>}
              <th className="px-3 py-2.5 font-semibold">Status</th>
              <th className="py-2.5 pl-3 pr-5" aria-label="Actions" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {claims.map((c, i) => (
              <tr
                key={c.id}
                onClick={() => onOpen(c)}
                className="group animate-rise cursor-pointer transition-colors duration-150 hover:bg-peacock-50/50"
                style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}
              >
                <td className="max-w-[260px] py-3 pl-5 pr-3">
                  <PatientCell claim={c} onOpen={onOpen} />
                </td>
                <td className="max-w-[240px] px-3 py-3">
                  <div className="truncate font-medium text-ink-2">{c.hospital_name}</div>
                  <div className="truncate text-small text-ink-3">{c.insurer_name || "—"}</div>
                </td>
                <td className="px-3 py-3">
                  <MiniJourney status={c.status} />
                </td>
                <td className="px-3 py-3 text-right">
                  <div className="figures font-semibold text-ink">{formatCurrencyINR(c.billed_amount)}</div>
                  {variant === "queue" && c.approved_amount != null && c.status !== "draft" && (
                    <div className={cn("figures text-small", c.approved_amount > 0 ? "text-leaf-700" : "text-ink-3")}>
                      {formatCurrencyINR(c.approved_amount)} approved
                    </div>
                  )}
                </td>
                {variant === "explorer" && (
                  <td className={cn("figures px-3 py-3 text-right font-semibold", c.approved_amount > 0 ? "text-leaf-700" : "text-ink-3")}>
                    {c.approved_amount != null ? formatCurrencyINR(c.approved_amount) : <span className="font-normal text-ink-4">—</span>}
                  </td>
                )}
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                  <SlaCell claim={c} />
                </td>
                {variant === "queue" && (
                  <td className="px-3 py-3">
                    {c.ai_confidence_score ? (
                      <div>
                        <ConfidenceMeter value={c.ai_confidence_score} threshold={threshold} />
                        {c.flagged_items_count > 0 && (
                          <div className="mt-1 text-tiny font-semibold text-marigold-700">
                            {c.flagged_items_count} item{c.flagged_items_count === 1 ? "" : "s"} to check
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-small text-ink-3">Not run yet</span>
                    )}
                  </td>
                )}
                <td className="px-3 py-3">
                  <ClaimStatusPill status={c.status} />
                </td>
                <td className="py-3 pl-3 pr-5 text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    {renderActions?.(c)}
                    <button
                      type="button"
                      onClick={() => onOpen(c)}
                      className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-ink-4 transition-[color,background-color,transform] duration-150 group-hover:translate-x-0.5 group-hover:text-peacock-600 hover:bg-peacock-50"
                      aria-label={`Open ${c.claim_number}`}
                    >
                      <ChevronRight className="h-[18px] w-[18px]" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phones */}
      <ul className="divide-y divide-line md:hidden">
        {claims.map((c) => (
          <li key={c.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onOpen(c)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(c))}
              className="flex cursor-pointer flex-col gap-3 px-4 py-4 transition-colors active:bg-ground"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={c.patient_name} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink">{c.patient_name}</div>
                    <div className="truncate text-small text-ink-3">{c.hospital_name}</div>
                  </div>
                </div>
                <div className="figures shrink-0 text-right text-sm font-semibold text-ink">{formatCurrencyINR(c.billed_amount)}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ClaimStatusPill status={c.status} />
                {c.status !== "draft" && c.status !== "finalized" && (
                  <SLAUrgencyBadge slaDeadline={c.sla_deadline} isBreached={c.sla_breached} />
                )}
                {c.has_identity_mismatch && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-vermilion-50 px-1.5 text-tiny font-semibold text-vermilion-700">
                    <ShieldAlert className="h-3 w-3" />
                    Name mismatch
                  </span>
                )}
                <span className="ml-auto font-mono text-tiny text-ink-3">{c.claim_number}</span>
              </div>
              {renderActions && <div onClick={(e) => e.stopPropagation()}>{renderActions(c)}</div>}
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

export function ClaimsTableSkeleton({ rows = 5 }) {
  return (
    <div className="divide-y divide-line" aria-busy="true" aria-label="Loading claims">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="h-9 w-9 rounded-[10px]" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="hidden h-3.5 w-36 md:block" />
          <Skeleton className="hidden h-2 w-20 md:block" />
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="hidden h-6 w-24 rounded-full md:block" />
        </div>
      ))}
    </div>
  )
}

export function Panel({ className, children }) {
  return <section className={cn("overflow-hidden rounded-card bg-surface shadow-card", className)}>{children}</section>
}
