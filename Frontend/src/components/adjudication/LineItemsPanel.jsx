import { useEffect, useRef } from "react"
import { PenLine } from "lucide-react"
import { cn, formatCurrencyINR, humanize } from "../../lib/utils"
import { TabBar } from "../ui/tab-bar"
import { EmptyState } from "../ui/empty-state"
import { DecisionPill } from "../common/status"
import { OUTCOME_FILTERS } from "./journey"

const PHASE_LABELS = { pre_hospitalisation: "Pre-hospitalisation", post_hospitalisation: "Post-hospitalisation" }

/** Which uploaded bill a line came from (a claim combines several bills) and its claim phase. */
function BillSource({ item }) {
  const c = item.citation_data || {}
  const phase = PHASE_LABELS[c.claim_phase]
  if (!c.source_document && !phase) return null
  return (
    <>
      {c.source_document && (
        <span className="max-w-[260px] truncate" title={c.itemises_summary_line ? `Itemises ${c.itemises_summary_line}` : c.source_document}>
          · {c.source_document}
        </span>
      )}
      {phase && <span className="rounded-md bg-peacock-50 px-1.5 font-semibold text-peacock-700">{phase}</span>}
    </>
  )
}

/** The itemised bill as decided: pick a row to see its reasoning on the right. */
export function LineItemsPanel({ items, selectedId, onSelect, onOverride, canOverride, filter, onFilterChange, isHospital }) {
  const rowRefs = useRef({})
  const scrollerRef = useRef(null)
  const active = OUTCOME_FILTERS.find((f) => f.value === filter) || OUTCOME_FILTERS[0]
  const visible = items.filter(active.match)

  // Keep the selected row visible inside the table's own scroll area (never scroll the page)
  useEffect(() => {
    const row = rowRefs.current[selectedId]
    const box = scrollerRef.current
    if (!row || !box) return
    const header = box.querySelector("thead")?.offsetHeight || 0
    const top = row.offsetTop - header
    const bottom = row.offsetTop + row.offsetHeight
    if (top < box.scrollTop) box.scrollTo({ top, behavior: "smooth" })
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTo({ top: bottom - box.clientHeight, behavior: "smooth" })
  }, [selectedId])

  const tabs = OUTCOME_FILTERS.map((f) => {
    const count = items.filter(f.match).length
    return { value: f.value, label: f.label, count, attention: f.value === "flagged" && count > 0 }
  }).filter((t) => t.value === "all" || t.count > 0 || t.value === filter)

  const onRowKeyDown = (e, idx, item) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const next = visible[idx + (e.key === "ArrowDown" ? 1 : -1)]
      if (next) {
        onSelect(next)
        rowRefs.current[next.id]?.focus({ preventScroll: true })
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      onSelect(item)
    }
  }

  const billCount = new Set(items.map((li) => li.citation_data?.source_document).filter(Boolean)).size
  const totalBilled = items.reduce((a, li) => a + (Number(li.billed_amount_inr) || 0), 0)
  const totalApproved = items.reduce((a, li) => a + (Number(li.approved_amount_inr) || 0), 0)

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-card bg-surface shadow-card" aria-label="Line items">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3.5 sm:px-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-body font-semibold text-ink">Itemised bill</h3>
          <span className="hidden text-tiny text-ink-3 sm:inline">
            {isHospital ? "Select an item to see the insurer's reasoning" : "Select an item · ↑ ↓ to move"}
          </span>
        </div>
        <TabBar variant="segmented" size="sm" tabs={tabs} value={filter} onChange={onFilterChange} ariaLabel="Filter line items by outcome" />
      </div>

      {visible.length === 0 ? (
        <EmptyState compact title="Nothing in this group" description="Pick another outcome above to see its items." className="py-10" />
      ) : (
        <>
          {/* Phones: one card per item */}
          <ul className="divide-y divide-line md:hidden">
            {visible.map((item) => {
              const selected = selectedId === item.id
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(item)}
                    aria-pressed={selected}
                    className={cn(
                      "flex w-full cursor-pointer flex-col gap-2 px-4 py-3.5 text-left transition-colors",
                      selected ? "bg-peacock-50" : "active:bg-ground"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className={cn("text-sm font-semibold leading-snug", selected ? "text-peacock-800" : "text-ink")}>
                        <span className="mr-1.5 font-mono text-tiny font-normal text-ink-3">{item.line_number}</span>
                        {item.item_name}
                      </span>
                      <DecisionPill status={item.final_status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-tiny text-ink-3">
                      <span>{humanize(item.item_category) || "Uncategorised"}</span>
                      <BillSource item={item} />
                    </div>
                    <div className="figures flex items-center gap-3 text-small text-ink-3">
                      <span>
                        Billed <span className="font-semibold text-ink-2">{formatCurrencyINR(item.billed_amount_inr)}</span>
                      </span>
                      <span>
                        Approved <span className="font-semibold text-leaf-700">{formatCurrencyINR(item.approved_amount_inr)}</span>
                      </span>
                      {item.is_overridden && <span className="rounded-md bg-sand-100 px-1.5 font-semibold text-sand-700">Adjusted</span>}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>

          <div ref={scrollerRef} className="relative hidden max-h-[640px] overflow-auto md:block">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur">
                <tr className="border-b border-line text-left text-small font-semibold text-ink-3">
                  <th className="w-10 py-2.5 pl-4 pr-2 text-right font-semibold sm:pl-5">#</th>
                  <th className="px-3 py-2.5 font-semibold">Item</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Billed</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Approved</th>
                  <th className="px-3 py-2.5 font-semibold">Decision</th>
                  {canOverride && <th className="w-12 py-2.5 pl-2 pr-4" aria-label="Override" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((item, idx) => {
                  const selected = selectedId === item.id
                  const flagged = item.final_status === "flagged"
                  return (
                    <tr
                      key={item.id}
                      ref={(el) => {
                        rowRefs.current[item.id] = el
                      }}
                      tabIndex={0}
                      aria-selected={selected}
                      onClick={() => onSelect(item)}
                      onKeyDown={(e) => onRowKeyDown(e, idx, item)}
                      className={cn(
                        "group cursor-pointer outline-none transition-colors duration-150 focus-visible:bg-peacock-50/70",
                        selected ? "bg-peacock-50" : "hover:bg-ground/80"
                      )}
                    >
                      <td className="py-3 pl-4 pr-2 text-right align-top sm:pl-5">
                        <span className="relative inline-flex items-center gap-1.5 font-mono text-tiny text-ink-3">
                          {flagged && <span className="h-1.5 w-1.5 rounded-full bg-marigold-500" aria-hidden="true" />}
                          {item.line_number}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className={cn("font-semibold leading-snug", selected ? "text-peacock-800" : "text-ink")}>{item.item_name}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-tiny text-ink-3">
                          <span>{humanize(item.item_category) || "Uncategorised"}</span>
                          <BillSource item={item} />
                          {item.is_overridden && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-sand-100 px-1.5 font-semibold text-sand-700">
                              <PenLine className="h-3 w-3" />
                              Adjusted
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="figures whitespace-nowrap px-3 py-3 text-right align-top text-ink-2">
                        {formatCurrencyINR(item.billed_amount_inr)}
                      </td>
                      <td
                        className={cn(
                          "figures whitespace-nowrap px-3 py-3 text-right align-top font-semibold",
                          Number(item.approved_amount_inr) === 0 ? "text-ink-3" : Number(item.approved_amount_inr) < Number(item.billed_amount_inr) ? "text-sand-700" : "text-leaf-700"
                        )}
                      >
                        {formatCurrencyINR(item.approved_amount_inr)}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <DecisionPill status={item.final_status} />
                      </td>
                      {canOverride && (
                        <td className="py-2.5 pl-2 pr-4 text-right align-top" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => onOverride(item)}
                            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-ink-4 opacity-70 transition-[opacity,color,background-color] hover:bg-peacock-50 hover:text-peacock-700 group-hover:opacity-100"
                            title="Override this decision"
                            aria-label={`Override decision for line ${item.line_number}`}
                          >
                            <PenLine className="h-4 w-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line bg-ground/60 px-4 py-2.5 text-small text-ink-3 sm:px-5">
        <span>
          {items.length} line item{items.length === 1 ? "" : "s"}
          {billCount > 1 && ` from ${billCount} bills`}
        </span>
        <span className="figures">
          <span className="text-ink-2">{formatCurrencyINR(totalBilled)}</span> billed ·{" "}
          <span className="font-semibold text-leaf-700">{formatCurrencyINR(totalApproved)}</span> approved
        </span>
      </div>
    </section>
  )
}
