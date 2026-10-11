import * as React from "react"
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react"
import { cn } from "../../lib/utils"

const ToastContext = React.createContext({
  toast: () => {},
})

const TONES = {
  default: { icon: Info, chip: "bg-peacock-50 text-peacock-600", bar: "bg-peacock-400" },
  info: { icon: Info, chip: "bg-peacock-50 text-peacock-600", bar: "bg-peacock-400" },
  success: { icon: CheckCircle2, chip: "bg-leaf-50 text-leaf-600", bar: "bg-leaf-400" },
  warning: { icon: AlertTriangle, chip: "bg-sand-50 text-sand-600", bar: "bg-sand-400" },
  destructive: { icon: AlertCircle, chip: "bg-vermilion-50 text-vermilion-600", bar: "bg-vermilion-400" },
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = React.useState([])

  const removeToast = React.useCallback((id) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 180)
  }, [])

  const toast = React.useCallback(
    ({ title, description, variant = "default", duration = 4500 }) => {
      const id = Math.random().toString(36).substring(2, 9)
      // Keep the stack short: the newest four
      setToasts((prev) => [...prev.filter((t) => !t.leaving).slice(-3), { id, title, description, variant, duration }])
      if (duration > 0) setTimeout(() => removeToast(id), duration)
      return id
    },
    [removeToast]
  )

  const value = React.useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-3 bottom-3 z-[60] flex flex-col items-stretch gap-2 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[380px]"
      >
        {toasts.map((t) => {
          const tone = TONES[t.variant] || TONES.default
          const Icon = tone.icon
          return (
            <div
              key={t.id}
              className={cn(
                "pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-xl bg-surface p-3.5 pr-11 text-sm shadow-raised",
                t.leaving ? "animate-toast-out" : "animate-toast-in"
              )}
            >
              <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", tone.chip)}>
                <Icon className="h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                {t.title && <div className="font-semibold leading-snug text-ink">{t.title}</div>}
                {t.description && <div className="mt-0.5 text-small leading-relaxed text-ink-3">{t.description}</div>}
              </div>
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                className="absolute right-2.5 top-2.5 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-ink-4 transition-colors hover:bg-sunken hover:text-ink"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
              {t.duration > 0 && (
                <span
                  aria-hidden="true"
                  className={cn("absolute bottom-0 left-0 h-[3px] w-full origin-left opacity-60 animate-drain", tone.bar)}
                  style={{ animationDuration: `${t.duration}ms` }}
                />
              )}
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const context = React.useContext(ToastContext)
  if (!context) {
    throw new Error("useToast must be used within ToastProvider")
  }
  return context
}
