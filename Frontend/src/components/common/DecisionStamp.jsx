import { cn, formatCurrencyINR } from "../../lib/utils"

/** The ink stamp a TPA desk would press on a settled file. Shown once a decision is locked. */
export function DecisionStamp({ label = "Finalized", amount, date, className, animate = false }) {
  const when = date ? new Date(date) : null
  const dateText =
    when && !Number.isNaN(when.getTime())
      ? when.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()
      : null
  return (
    <div
      className={cn(
        "pointer-events-none inline-flex select-none flex-col items-center rounded-[10px] border-[2.5px] border-peacock-600/85 px-3 py-1.5 text-peacock-700/90 mix-blend-multiply",
        animate ? "animate-stamp" : "-rotate-6",
        className
      )}
      aria-label={`${label}${amount != null ? ` ${formatCurrencyINR(amount)}` : ""}`}
      role="img"
    >
      <span className="rounded-[6px] border border-peacock-600/70 px-2.5 py-0.5 text-center">
        <span className="block text-[13px] font-bold uppercase tracking-[0.18em]">{label}</span>
        {amount != null && <span className="figures block text-[17px] font-bold leading-tight tracking-[-0.01em]">{formatCurrencyINR(amount)}</span>}
        {dateText && <span className="figures block text-[10px] font-semibold tracking-[0.12em]">{dateText}</span>}
      </span>
    </div>
  )
}
