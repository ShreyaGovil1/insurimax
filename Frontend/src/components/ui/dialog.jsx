import * as React from "react"
import { X } from "lucide-react"
import { cn } from "../../lib/utils"

export function Dialog({ open, onOpenChange, children }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in-0 duration-200">
      <div 
        className="fixed inset-0" 
        onClick={() => onOpenChange?.(false)}
        aria-hidden="true" 
      />
      <div className="relative z-50 w-full max-w-lg bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-200">
        {children}
      </div>
    </div>
  )
}

export function DialogContent({ className, children, onClose }) {
  return (
    <div className={cn("p-6 relative max-h-[90vh] overflow-y-auto", className)}>
      {onClose && (
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      )}
      {children}
    </div>
  )
}

export function DialogHeader({ className, ...props }) {
  return <div className={cn("flex flex-col space-y-1.5 mb-4 text-left", className)} {...props} />
}

export function DialogTitle({ className, ...props }) {
  return <h2 className={cn("text-lg font-semibold text-slate-900 leading-none", className)} {...props} />
}

export function DialogDescription({ className, ...props }) {
  return <p className={cn("text-sm text-slate-500 mt-1", className)} {...props} />
}

export function DialogFooter({ className, ...props }) {
  return <div className={cn("flex items-center justify-end space-x-2 pt-4 border-t border-slate-100 mt-6", className)} {...props} />
}
