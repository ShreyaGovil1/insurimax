import { cn } from "../../lib/utils"

/** Label + control + hint/error, so every form reads the same. */
export function Field({ label, htmlFor, hint, error, required, optional, className, children }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label htmlFor={htmlFor} className="flex items-baseline justify-between gap-2 text-small font-semibold text-ink-2">
          <span>
            {label}
            {required && <span className="ml-0.5 text-vermilion-600" aria-hidden="true">*</span>}
          </span>
          {optional && <span className="text-tiny font-medium text-ink-3">Optional</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-small text-vermilion-700" role="alert">{error}</p>
      ) : hint ? (
        <p className="text-small text-ink-3">{hint}</p>
      ) : null}
    </div>
  )
}
