import * as React from "react"
import { cn } from "../../lib/utils"

/**
 * Tabs with a sliding indicator. variant "underline" for page sections, "segmented" for filters.
 * tabs: [{ value, label, icon?, count?, attention? }]
 */
export function TabBar({ tabs, value, onChange, variant = "underline", className, ariaLabel, size = "md" }) {
  const listRef = React.useRef(null)
  const indicatorRef = React.useRef(null)
  const firstPaint = React.useRef(true)

  React.useLayoutEffect(() => {
    const list = listRef.current
    const indicator = indicatorRef.current
    if (!list || !indicator) return
    const place = () => {
      const active = list.querySelector('[aria-selected="true"]')
      if (!active) {
        indicator.style.opacity = "0"
        return
      }
      indicator.style.opacity = "1"
      indicator.style.width = `${active.offsetWidth}px`
      indicator.style.transform = `translateX(${active.offsetLeft}px)`
    }
    if (firstPaint.current) {
      indicator.style.transition = "none"
      place()
      // Re-enable motion after the first placement so the indicator never slides in from 0
      requestAnimationFrame(() => {
        if (indicatorRef.current) indicatorRef.current.style.transition = ""
      })
      firstPaint.current = false
    } else {
      place()
    }
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(place)
    ro.observe(list)
    return () => ro.disconnect()
  }, [value, tabs])

  const onKeyDown = (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
    const idx = tabs.findIndex((t) => t.value === value)
    const next = tabs[(idx + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]
    if (!next) return
    e.preventDefault()
    onChange?.(next.value)
    requestAnimationFrame(() => {
      const buttons = listRef.current ? [...listRef.current.querySelectorAll('[role="tab"]')] : []
      buttons.find((b) => b.dataset.value === String(next.value))?.focus()
    })
  }

  const segmented = variant === "segmented"

  return (
    <div className={cn(segmented ? "inline-flex max-w-full" : "w-full border-b border-line", className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className={cn(
          "scrollbar-none relative flex max-w-full items-center overflow-x-auto",
          segmented ? "gap-0.5 rounded-xl bg-sunken p-1" : "gap-6"
        )}
      >
        <span
          ref={indicatorRef}
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute left-0 transition-[transform,width] duration-300 ease-out-strong",
            segmented ? "inset-y-1 rounded-lg bg-surface shadow-card" : "bottom-0 h-[2.5px] rounded-full bg-peacock-600"
          )}
        />
        {tabs.map((tab) => {
          const active = tab.value === value
          const Icon = tab.icon
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              data-value={tab.value}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange?.(tab.value)}
              className={cn(
                "relative z-10 inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-peacock-500",
                segmented
                  ? cn("rounded-lg px-3", size === "sm" ? "h-7 text-small" : "h-8 text-small")
                  : "h-11 rounded-t-md px-0.5 text-sm",
                active ? "text-ink" : "text-ink-3 hover:text-ink-2"
              )}
            >
              {Icon && <Icon className={cn("h-4 w-4", active ? "text-peacock-600" : "text-ink-4")} />}
              <span>{tab.label}</span>
              {tab.count != null && (
                <span
                  className={cn(
                    "figures min-w-5 rounded-full px-1.5 text-center text-tiny font-semibold leading-5",
                    active ? "bg-peacock-50 text-peacock-700" : "bg-ground text-ink-3",
                    segmented && !active && "bg-surface/70"
                  )}
                >
                  {tab.count}
                </span>
              )}
              {tab.attention && (
                <span className="h-2 w-2 rounded-full bg-marigold-500 ring-2 ring-surface" aria-label="Needs attention" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
