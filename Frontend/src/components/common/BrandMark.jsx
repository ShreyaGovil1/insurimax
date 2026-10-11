import { cn } from "../../lib/utils"

/** The mark: a route that ends in a tick — a claim travelling to its decision. */
export function BrandMark({ className, title = "InsuriMax" }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-8 w-8 shrink-0", className)} role="img" aria-label={title}>
      <rect width="32" height="32" rx="9" className="fill-marigold-400" />
      <path
        d="M7.5 17.5 L13 22.5 L24.5 9.5"
        fill="none"
        className="stroke-peacock-800"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7.5" cy="17.5" r="2.6" className="fill-peacock-800" />
      <circle cx="24.5" cy="9.5" r="2.6" className="fill-peacock-800" />
    </svg>
  )
}

export function BrandLockup({ className, onDark = false, subtitle }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark />
      <span className="flex flex-col leading-none">
        <span className={cn("text-[19px] font-semibold tracking-[-0.02em]", onDark ? "text-white" : "text-ink")}>
          InsuriMax
        </span>
        {subtitle && (
          <span className={cn("mt-1 text-tiny font-medium", onDark ? "text-peacock-200" : "text-ink-3")}>{subtitle}</span>
        )}
      </span>
    </span>
  )
}
