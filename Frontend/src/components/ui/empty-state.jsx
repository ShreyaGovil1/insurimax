import { cn } from "../../lib/utils"

/** A composed empty state: says what is missing and what to do next. */
export function EmptyState({ icon: Icon, title, description, action, className, tone = "neutral" }) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      {Icon && (
        <div
          className={cn(
            "mb-4 flex h-12 w-12 items-center justify-center rounded-2xl",
            tone === "positive" ? "bg-leaf-50 text-leaf-600" : "bg-sunken text-ink-3"
          )}
        >
          <Icon className="h-6 w-6" strokeWidth={1.75} />
        </div>
      )}
      {title && <h3 className="text-body font-semibold text-ink">{title}</h3>}
      {description && <p className="mt-1 max-w-sm text-small text-ink-3">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
