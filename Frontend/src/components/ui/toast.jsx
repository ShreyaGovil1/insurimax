import * as React from "react"
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react"
import { cn } from "../../lib/utils"

const ToastContext = React.createContext({
  toast: () => {},
})

export function ToastProvider({ children }) {
  const [toasts, setToasts] = React.useState([])

  const toast = React.useCallback(({ title, description, variant = "default", duration = 4000 }) => {
    const id = Math.random().toString(36).substring(2, 9)
    setToasts((prev) => [...prev, { id, title, description, variant }])

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, duration)
    }
  }, [])

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col space-y-2 max-w-md w-full pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-start p-4 rounded-xl shadow-lg border text-sm backdrop-blur-md transition-all animate-in slide-in-from-bottom-5 duration-300",
              t.variant === "destructive" && "bg-red-50/95 border-red-200 text-red-900",
              t.variant === "success" && "bg-emerald-50/95 border-emerald-200 text-emerald-900",
              t.variant === "warning" && "bg-amber-50/95 border-amber-200 text-amber-900",
              t.variant === "default" && "bg-white/95 border-slate-200 text-slate-900"
            )}
          >
            <div className="mr-3 mt-0.5 shrink-0">
              {t.variant === "success" && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
              {t.variant === "destructive" && <AlertCircle className="w-5 h-5 text-red-600" />}
              {t.variant === "warning" && <AlertTriangle className="w-5 h-5 text-amber-600" />}
              {t.variant === "default" && <Info className="w-5 h-5 text-blue-600" />}
            </div>
            <div className="flex-1 mr-2">
              {t.title && <div className="font-semibold text-sm">{t.title}</div>}
              {t.description && <div className="text-xs opacity-90 mt-0.5 leading-relaxed">{t.description}</div>}
            </div>
            <button
              onClick={() => removeToast(t.id)}
              className="text-slate-400 hover:text-slate-600 shrink-0 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = React.useContext(ToastContext)
  if (!context) {
    throw new Error("useToast must be used within ToastProvider")
  }
  return context
}
