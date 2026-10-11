import { Printer } from "lucide-react"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../ui/dialog"
import { Button } from "../ui/button"
import { Skeleton } from "../ui/skeleton"
import { BrandLockup } from "../common/BrandMark"
import { Guilloche } from "../common/Guilloche"
import { DecisionStamp } from "../common/DecisionStamp"
import { DecisionPill, ClaimStatusPill } from "../common/status"
import { formatCurrencyINR, formatDateTime, humanize } from "../../lib/utils"
import { OVERRIDE_REASON_LABELS } from "./journey"

/** Printable compliance record (insurer) / settlement report (hospital) for a finalized claim. */
export function AuditReportDialog({ open, onOpenChange, report, isHospital }) {
  // The API returns { claim, adjudication, line_items, status_history }; older payloads were flat.
  const claim = report?.claim || {
    claim_number: report?.claim_number,
    patient_name: report?.patient_name,
    hospital_name: report?.hospital,
  }
  const adj = report?.adjudication || {}
  const items = report?.line_items || report?.line_item_audits || []
  const history = report?.status_history || []
  const finalizedAt = claim.finalized_at || adj.finalized_at || report?.adjudication_timestamp

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="print-area overflow-x-hidden p-0 sm:max-w-3xl"
        closeClassName="text-white/75 hover:bg-white/10 hover:text-white"
        onClose={() => onOpenChange(false)}
      >
        <div className="relative overflow-hidden bg-peacock-800 px-6 pb-6 pt-6 text-white sm:rounded-t-[18px]">
          <Guilloche className="absolute inset-x-0 -bottom-10 h-[140px] w-full" lines={16} strokeClassName="stroke-peacock-300/[0.14]" />
          <div className="relative flex flex-wrap items-start justify-between gap-4 pr-8">
            <BrandLockup onDark subtitle={isHospital ? "Settlement report" : "Compliance record"} />
            <Button size="sm" variant="on-dark" onClick={() => window.print()} className="no-print">
              <Printer className="h-4 w-4" />
              Print
            </Button>
          </div>
          <div className="relative mt-6">
            <DialogTitle className="text-[22px] text-white">
              {claim.patient_name || "Claim"} <span className="font-mono text-base font-normal text-peacock-200">· {claim.claim_number}</span>
            </DialogTitle>
            <DialogDescription className="mt-1 text-peacock-100/85">
              {claim.hospital_name}
              {claim.insurer_name ? ` → ${claim.insurer_name}` : ""} · IRDAI 3-hour cashless standard
            </DialogDescription>
          </div>
        </div>

        {!report ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="space-y-6 p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                <Fact label="Billed" value={formatCurrencyINR(adj.total_billed_inr)} />
                <Fact label="Approved" value={formatCurrencyINR(adj.total_approved_inr)} strong />
                <Fact label="Deducted" value={formatCurrencyINR(adj.total_deducted_inr)} />
                <Fact label="Submitted" value={formatDateTime(claim.submitted_at)} />
                <Fact label="Finalized" value={formatDateTime(finalizedAt)} />
                <Fact
                  label="SLA"
                  value={claim.sla_breached ? "Breached" : claim.sla_deadline ? "Met" : "—"}
                  tone={claim.sla_breached ? "text-vermilion-700" : "text-leaf-700"}
                />
                <Fact label="AI confidence" value={adj.confidence_score != null ? `${Math.round(adj.confidence_score * 100)}%` : "—"} />
                <Fact label="Auto-approved" value={adj.auto_approved ? "Yes" : "No"} />
                <div>
                  <dt className="text-tiny font-medium text-ink-3">Status</dt>
                  <dd className="mt-0.5">{claim.status ? <ClaimStatusPill status={claim.status} /> : "—"}</dd>
                </div>
              </dl>
              {finalizedAt && <DecisionStamp label="Finalized" amount={adj.total_approved_inr} date={finalizedAt} className="self-center" />}
            </div>

            {report.audit_hash && (
              <div className="rounded-lg bg-ground px-3 py-2 font-mono text-tiny text-ink-2">Audit hash · {report.audit_hash}</div>
            )}

            <section>
              <h4 className="mb-2 text-small font-semibold text-ink-2">Line-item decisions</h4>
              <div className="overflow-x-auto rounded-xl ring-1 ring-line">
                <table className="w-full border-collapse text-small">
                  <thead className="bg-ground text-left text-tiny font-semibold text-ink-3">
                    <tr>
                      <th className="px-3 py-2 text-right">#</th>
                      <th className="px-3 py-2">Item & basis</th>
                      <th className="px-3 py-2 text-right">Billed</th>
                      <th className="px-3 py-2 text-right">Approved</th>
                      <th className="px-3 py-2">Decision</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {items.map((li, i) => (
                      <tr key={li.id || i} className="align-top">
                        <td className="figures px-3 py-2.5 text-right text-ink-3">{li.line_number}</td>
                        <td className="px-3 py-2.5">
                          <div className="font-semibold text-ink">{li.item_name}</div>
                          {li.citation_data?.clause_reference && (
                            <div className="text-tiny text-ink-3">
                              {li.citation_data.clause_reference}
                              {li.citation_data.clause_page ? ` · p.${li.citation_data.clause_page}` : ""}
                            </div>
                          )}
                          {li.is_overridden && (
                            <div className="mt-1 text-tiny text-sand-700">
                              <span className="font-semibold">Override · {OVERRIDE_REASON_LABELS[li.override_reason] || humanize(li.override_reason)}:</span>{" "}
                              {li.override_note}
                            </div>
                          )}
                        </td>
                        <td className="figures px-3 py-2.5 text-right text-ink-2">{formatCurrencyINR(li.billed_amount_inr)}</td>
                        <td className="figures px-3 py-2.5 text-right font-semibold text-ink">{formatCurrencyINR(li.approved_amount_inr)}</td>
                        <td className="px-3 py-2.5">
                          <DecisionPill status={li.final_status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {history.length > 0 && (
              <section>
                <h4 className="mb-3 text-small font-semibold text-ink-2">Status history</h4>
                <ol className="relative space-y-3 border-l-2 border-line pl-5">
                  {history.map((h, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full bg-peacock-500 ring-4 ring-surface" aria-hidden="true" />
                      <div className="text-small font-semibold text-ink">
                        {h.from_status ? `${humanize(h.from_status)} → ` : ""}
                        {humanize(h.to_status)}
                      </div>
                      <div className="text-tiny text-ink-3">
                        {formatDateTime(h.created_at)}
                        {h.note ? ` · ${h.note}` : ""}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <p className="border-t border-line pt-4 text-tiny text-ink-3">
              Generated {formatDateTime(report.report_generated_at || new Date().toISOString())}. Every decision above cites the
              policy clause it relied on; overrides carry the adjuster's reason.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Fact({ label, value, strong, tone }) {
  return (
    <div className="min-w-0">
      <dt className="text-tiny font-medium text-ink-3">{label}</dt>
      <dd className={`figures mt-0.5 truncate ${strong ? "text-body font-semibold text-leaf-700" : "font-semibold text-ink"} ${tone || ""}`}>{value || "—"}</dd>
    </div>
  )
}
