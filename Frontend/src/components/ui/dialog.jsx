import * as React from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { cn } from "../../lib/utils"

const DialogContext = React.createContext({ closing: false, titleId: undefined, descriptionId: undefined })

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Modal dialog: portals to <body>, closes on Escape or backdrop click, locks page scroll,
 * traps focus and hands it back on close. Becomes a bottom sheet on small screens.
 */
export function Dialog({ open, onOpenChange, children }) {
  const [mounted, setMounted] = React.useState(open)
  const [prevOpen, setPrevOpen] = React.useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setMounted(true)
  }
  const closing = mounted && !open

  const onOpenChangeRef = React.useRef(onOpenChange)
  React.useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  })

  // Unmount once the exit animation has played
  React.useEffect(() => {
    if (!closing) return
    const t = setTimeout(() => setMounted(false), 160)
    return () => clearTimeout(t)
  }, [closing])

  React.useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement
    const onKey = (e) => {
      if (e.key === "Escape") onOpenChangeRef.current?.(false)
    }
    document.addEventListener("keydown", onKey)
    const { overflow } = document.body.style
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = overflow
      if (previouslyFocused && typeof previouslyFocused.focus === "function") previouslyFocused.focus({ preventScroll: true })
    }
  }, [open])

  const titleId = React.useId()
  const descriptionId = React.useId()
  const ctx = React.useMemo(() => ({ closing, titleId, descriptionId }), [closing, titleId, descriptionId])

  if (!mounted || typeof document === "undefined") return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        className={cn("absolute inset-0 bg-peacock-950/45 backdrop-blur-[2px]", closing ? "animate-fade-out" : "animate-fade-in")}
        onClick={() => onOpenChangeRef.current?.(false)}
        aria-hidden="true"
      />
      <DialogContext.Provider value={ctx}>{children}</DialogContext.Provider>
    </div>,
    document.body
  )
}

export function DialogContent({ className, children, onClose, closeClassName }) {
  const { closing, titleId, descriptionId } = React.useContext(DialogContext)
  const panelRef = React.useRef(null)

  React.useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const target = panel.querySelector("[data-autofocus]") || panel.querySelector('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])') || panel
    target.focus({ preventScroll: true })
  }, [])

  const trapFocus = (e) => {
    if (e.key !== "Tab") return
    const items = [...panelRef.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
      onKeyDown={trapFocus}
      className={cn(
        "relative z-10 max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[20px] bg-surface p-6 shadow-dialog outline-none sm:rounded-[18px]",
        closing ? "animate-dialog-out" : "animate-dialog-in",
        className
      )}
    >
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "no-print absolute right-3.5 top-3.5 z-10 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-sunken hover:text-ink",
            closeClassName
          )}
          aria-label="Close"
        >
          <X className="h-[18px] w-[18px]" />
        </button>
      )}
      {children}
    </div>
  )
}

export function DialogHeader({ className, ...props }) {
  return <div className={cn("mb-5 flex flex-col gap-1.5 pr-8 text-left", className)} {...props} />
}

export function DialogTitle({ className, ...props }) {
  const { titleId } = React.useContext(DialogContext)
  return <h2 id={titleId} className={cn("text-lg font-semibold leading-snug text-ink", className)} {...props} />
}

export function DialogDescription({ className, ...props }) {
  const { descriptionId } = React.useContext(DialogContext)
  return <p id={descriptionId} className={cn("text-sm leading-relaxed text-ink-3", className)} {...props} />
}

export function DialogFooter({ className, ...props }) {
  return (
    <div
      className={cn("mt-6 flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-end", className)}
      {...props}
    />
  )
}
