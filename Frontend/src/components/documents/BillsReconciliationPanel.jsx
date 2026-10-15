import { AlertTriangle, Layers } from "lucide-react"
import { formatCurrencyINR, humanize } from "../../lib/utils"
import { Badge } from "../ui/badge"

// How each document's charges were counted (roles from the backend's bill reconciliation)
const ROLES = {
  primary_bill: { label: "Main bill", variant: "peacock", counted: true },
  separate_bill: { label: "Separate bill", variant: "leaf", counted: true },
  itemised_breakup: { label: "Itemised breakup", variant: "sand", counted: true },
  duplicate: { label: "Duplicate copy", variant: "neutral", counted: false },
  reference_charge_sheet: { label: "Reference charge sheet", variant: "outline", counted: false },
  payment_receipt: { label: "Payment receipt", variant: "neutral", counted: false },
}

function describe(bill) {
  if (bill.role === "itemised_breakup" && bill.itemises) return `Replaces ${bill.itemises} with its itemised lines`
  if (bill.role === "duplicate") return `Same charges as ${bill.duplicate_of || "another document"}: counted once`
  if (bill.role === "reference_charge_sheet") return "Rates for reference only: not charged"
  if (bill.role === "payment_receipt") return "Proof of payment: not a charge"
  return null
}

/** Every document on the claim that lists charges, and how its charges were counted in the combined bill. */
export function BillsReconciliationPanel({ data }) {
  const bills = data?.bills || []
  const notes = data?.bill_reconciliation_notes || []
  if (bills.length < 2 && notes.length === 0) return null
  const byAi = data?.bill_reconciliation_method === "ai"

  return (
    <section className="overflow-hidden rounded-card bg-surface shadow-card" aria-label="Bills on this claim">
      <div className="flex flex-col gap-1 border-b border-line px-4 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:px-5">
        <h3 className="flex items-center gap-2 text-body font-semibold text-ink">
          <Layers className="h-4 w-4 text-ink-3" />
          Bills on this claim
        </h3>
        <span className="text-tiny text-ink-3">
          {bills.length} documents with charges · {byAi ? "relationships read by AI" : "matched by bill numbers and amounts"}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-small font-semibold text-ink-3">
              <th className="py-2.5 pl-4 pr-3 font-semibold sm:pl-5">Document</th>
              <th className="px-3 py-2.5 font-semibold">Counted as</th>
              <th className="px-3 py-2.5 text-right font-semibold">Lines</th>
              <th className="py-2.5 pl-3 pr-4 text-right font-semibold sm:pr-5">Bill total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {bills.map((bill) => {
              const role = ROLES[bill.role] || { label: humanize(bill.role), variant: "neutral", counted: true }
              const detail = describe(bill)
              return (
                <tr key={bill.document_id} className={role.counted ? undefined : "text-ink-3"}>
                  <td className="py-2.5 pl-4 pr-3 align-top sm:pl-5">
                    <div className="font-medium text-ink">{bill.source_document}</div>
                    <div className="text-tiny text-ink-3">
                      {[bill.issuer_name, bill.bill_number && `No. ${bill.bill_number}`, bill.claim_phase && humanize(bill.claim_phase)]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <Badge variant={role.variant}>{role.label}</Badge>
                    {(detail || bill.reason) && (
                      <div className="mt-1 max-w-md text-tiny text-ink-3">{[detail, bill.reason].filter(Boolean).join(". ")}</div>
                    )}
                  </td>
                  <td className="figures px-3 py-2.5 text-right align-top text-ink-2">{bill.line_item_count}</td>
                  <td className="figures whitespace-nowrap py-2.5 pl-3 pr-4 text-right align-top font-semibold sm:pr-5">
                    {formatCurrencyINR(bill.bill_total_inr)}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-ground/70">
              <td colSpan={3} className="py-3 pl-4 pr-3 text-right text-small font-semibold text-ink-3 sm:pl-5">
                Claimed (each charge once)
              </td>
              <td className="figures whitespace-nowrap py-3 pl-3 pr-4 text-right text-body font-semibold text-ink sm:pr-5">
                {formatCurrencyINR(data.total_billed_inr)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {notes.length > 0 && (
        <ul className="space-y-1.5 border-t border-line bg-sand-50/60 px-4 py-3 sm:px-5">
          {notes.map((note, i) => (
            <li key={i} className="flex gap-2 text-small text-sand-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
