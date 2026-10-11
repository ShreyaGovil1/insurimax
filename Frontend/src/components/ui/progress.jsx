import { cn } from "../../lib/utils"

export function Progress({ value = 0, max = 100, className, indicatorClassName, label }) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100)

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-sunken", className)}
    >
      <div
        className={cn("h-full w-full origin-left rounded-full bg-peacock-500 transition-transform duration-500 ease-out-strong", indicatorClassName)}
        style={{ transform: `scaleX(${percentage / 100})` }}
      />
    </div>
  )
}
