import { createContext, useContext, useState } from "react"
import { Code, Pencil, Table as TableIcon } from "lucide-react"
import { cn, formatCurrencyINR } from "../../lib/utils"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import { TabBar } from "../ui/tab-bar"
import { CitationButton, CitationViewer } from "./CitationViewer"
import { citationKey } from "./citations"

// Lets any table row open its source citation in the panel's viewer
const CitationContext = createContext({ active: null, onCite: null })

const DOC_TYPE_LABELS = {
  itemized_bill: "Itemised bill",
  discharge_summary: "Discharge summary",
  prescription: "Prescription",
  lab_report: "Lab report",
  consultation_notes: "Consultation notes",
  policy_document: "Policy document",
  other: "Supporting document",
}

// eslint-disable-next-line react-refresh/only-export-components
export const docTypeLabel = (t) => DOC_TYPE_LABELS[t] || (t || "").replaceAll("_", " ")

const isEmpty = (v) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)
const money = (v) => (isEmpty(v) ? null : formatCurrencyINR(Number(v)))
const date = (v) => {
  if (isEmpty(v)) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString()
}
const pct = (v) => (isEmpty(v) ? null : `${v}%`)

function SectionTitle({ children }) {
  return <h4 className="mb-3 text-small font-semibold text-ink-2">{children}</h4>
}

function Fields({ title, rows }) {
  const visible = rows.filter(([, v]) => !isEmpty(v))
  if (visible.length === 0) return null
  return (
    <div className="border-b border-line px-5 py-4 last:border-b-0">
      <SectionTitle>{title}</SectionTitle>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-tiny font-medium text-ink-3">{label}</dt>
            <dd className="break-words text-sm font-semibold text-ink">{String(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function Chips({ title, items, variant = "secondary" }) {
  const list = (items || []).filter((i) => !isEmpty(i))
  if (list.length === 0) return null
  return (
    <div className="border-b border-line px-5 py-4 last:border-b-0">
      <SectionTitle>{title}</SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        {list.map((item, i) => (
          <Badge key={i} variant={variant} className="whitespace-normal text-small font-medium leading-5">
            {typeof item === "string" ? item : (item?.name || item?.description || item?.title || JSON.stringify(item))}
          </Badge>
        ))}
      </div>
    </div>
  )
}

function Text({ title, value }) {
  if (isEmpty(value)) return null
  return (
    <div className="border-b border-line px-5 py-4 last:border-b-0">
      <SectionTitle>{title}</SectionTitle>
      <p className="max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-ink">{value}</p>
    </div>
  )
}

function DataTable({ title, columns, rows }) {
  const { active, onCite } = useContext(CitationContext)
  const list = rows || []
  if (list.length === 0) return null
  const cited = Boolean(onCite) && list.some((r) => r?.source?.document_id)
  return (
    <div className="border-b border-line px-5 py-4 last:border-b-0">
      <SectionTitle>{title}</SectionTitle>
      <div className="overflow-x-auto rounded-xl ring-1 ring-line">
        <table className="w-full text-left text-small">
          <thead className="bg-ground text-tiny font-semibold text-ink-3">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="px-3 py-2 font-semibold">{c.label}</th>
              ))}
              {cited && <th className="px-3 py-2 text-center font-semibold">Source</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.map((row, i) => (
              <tr
                key={i}
                className={
                  cited && active === row?.source
                    ? "bg-marigold-50"
                    : row?.manually_added
                    ? "bg-leaf-50/70"
                    : row?.manually_edited
                    ? "bg-sand-50/70"
                    : undefined
                }
                title={row?.manually_added ? "Added manually" : row?.manually_edited ? "Edited manually" : undefined}
              >
                {columns.map((c) => {
                  const raw = row?.[c.key]
                  const v = c.format ? c.format(raw) : raw
                  return (
                    <td key={c.key} className={cn("px-3 py-2", isEmpty(v) ? "text-ink-4" : "text-ink")}>{isEmpty(v) ? "—" : String(v)}</td>
                  )
                })}
                {cited && (
                  <td className="px-3 py-2 text-center">
                    <CitationButton citation={row?.source} active={active === row?.source} onClick={onCite} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const personRows = (p = {}) => [
  ["Name", p.name],
  ["Age", p.age],
  ["Gender", p.gender],
  ["UHID", p.uhid],
]

/** Doc type chosen at upload can be wrong; trust the shape of the extracted data when it is unambiguous. */
// eslint-disable-next-line react-refresh/only-export-components
export function effectiveDocType(declared, data) {
  if (data && (data.policy || Array.isArray(data.coverage_items))) return "policy_document"
  return declared
}

/** Layout for each document type — only fields that belong to that kind of document. */
function renderSections(docType, d) {
  const patient = d.patient || {}
  switch (docType) {
    case "itemized_bill":
      return (
        <>
          <Fields title="Patient" rows={[...personRows(patient), ["Admission", date(patient.admission_date)], ["Discharge", date(patient.discharge_date)]]} />
          <Fields title="Hospital" rows={[["Name", d.hospital?.name], ["Ward", d.hospital?.ward_type], ["Room rent / day", money(d.hospital?.room_rent_per_day_inr)], ["ICU / day", money(d.hospital?.icu_charges_per_day_inr)]]} />
          <DataTable
            title="Line items"
            columns={[
              { key: "item_name", label: "Item" },
              { key: "item_category", label: "Category" },
              { key: "quantity", label: "Qty" },
              { key: "unit_price_inr", label: "Unit price", format: money },
              { key: "total_price_inr", label: "Total", format: money },
            ]}
            rows={d.line_items || d.items}
          />
          <Fields title="Totals" rows={[["Total billed", money(d.total_billed_inr)]]} />
        </>
      )
    case "discharge_summary":
      return (
        <>
          <Fields title="Patient" rows={personRows(patient)} />
          <Fields
            title="Hospital Stay"
            rows={[
              ["Hospital", d.hospital?.name],
              ["Treating doctor", d.treating_doctor],
              ["Admission date", date(patient.admission_date)],
              ["Discharge date", date(patient.discharge_date)],
              ["Length of stay (days)", d.length_of_stay_days],
              ["Condition at discharge", d.condition_at_discharge],
            ]}
          />
          <Chips title="Diagnosis" items={patient.diagnosis} variant="info" />
          <Chips title="Procedures" items={patient.procedures} variant="purple" />
          <DataTable
            title="Medications on discharge"
            columns={[
              { key: "name", label: "Medicine" },
              { key: "dosage", label: "Dosage" },
              { key: "duration", label: "Duration" },
            ]}
            rows={d.medications_on_discharge}
          />
          <Text title="Follow-up instructions" value={d.follow_up_instructions} />
        </>
      )
    case "prescription":
      return (
        <>
          <Fields title="Patient" rows={personRows(patient)} />
          <Fields
            title="Prescriber"
            rows={[
              ["Doctor", d.doctor?.name],
              ["Registration no.", d.doctor?.registration_number],
              ["Specialization", d.doctor?.specialization],
              ["Clinic / Hospital", d.hospital?.name],
              ["Date", date(d.prescription_date)],
            ]}
          />
          <Chips title="Diagnosis" items={d.diagnosis} variant="info" />
          <DataTable
            title="Medications"
            columns={[
              { key: "name", label: "Medicine" },
              { key: "dosage", label: "Dosage" },
              { key: "frequency", label: "Frequency" },
              { key: "duration", label: "Duration" },
              { key: "route", label: "Route" },
            ]}
            rows={d.medications}
          />
          <Chips title="Tests advised" items={d.tests_advised} />
          <Text title="Advice" value={d.advice} />
        </>
      )
    case "lab_report":
      return (
        <>
          <Fields title="Patient" rows={personRows(patient)} />
          <Fields
            title="Report"
            rows={[
              ["Laboratory", d.lab?.name],
              ["Referring doctor", d.referring_doctor],
              ["Report date", date(d.report_date)],
            ]}
          />
          <DataTable
            title="Test results"
            columns={[
              { key: "test_name", label: "Test" },
              { key: "result", label: "Result" },
              { key: "unit", label: "Unit" },
              { key: "reference_range", label: "Reference range" },
              { key: "flag", label: "Flag" },
            ]}
            rows={d.tests}
          />
          <Text title="Summary" value={d.summary} />
        </>
      )
    case "consultation_notes":
      return (
        <>
          <Fields title="Patient" rows={personRows(patient)} />
          <Fields
            title="Consultation"
            rows={[
              ["Doctor", d.doctor?.name],
              ["Registration no.", d.doctor?.registration_number],
              ["Specialization", d.doctor?.specialization],
              ["Hospital", d.hospital?.name],
              ["Date", date(d.consultation_date)],
            ]}
          />
          <Chips title="Chief complaints" items={d.chief_complaints} variant="warning" />
          <Text title="Findings" value={d.findings} />
          <Chips title="Diagnosis" items={d.diagnosis} variant="info" />
          <Text title="Treatment plan" value={d.treatment_plan} />
          <Text title="Follow-up" value={d.follow_up} />
        </>
      )
    case "policy_document": {
      const p = d.policy || {}
      return (
        <>
          <Fields
            title="Policy"
            rows={[
              ["Insurer", p.insurer_name],
              ["TPA", p.tpa_name],
              ["Policy number", p.policy_number],
              ["Product", p.product_name],
              ["Policyholder", p.policyholder_name],
              ["Start date", date(p.policy_start_date)],
              ["End date", date(p.policy_end_date)],
            ]}
          />
          <Fields
            title="Coverage"
            rows={[
              ["Sum insured", money(p.sum_insured_inr)],
              ["Co-pay", pct(p.co_pay_percent)],
              ["Room rent cap / day", money(p.room_rent_cap_inr_per_day)],
              ["ICU cap / day", money(p.icu_cap_inr_per_day)],
            ]}
          />
          <DataTable
            title="Coverage — what the policy covers"
            columns={[
              { key: "category", label: "Category" },
              { key: "benefit", label: "Benefit / Item" },
              { key: "covered", label: "Covered", format: (v) => (v === true ? "Covered" : v === false ? "Not covered" : null) },
              { key: "limit_inr", label: "Limit", format: money },
              { key: "limit_description", label: "Limit details" },
              { key: "conditions", label: "Conditions" },
            ]}
            rows={d.coverage_items}
          />
          <DataTable
            title="Insured members"
            columns={[
              { key: "name", label: "Name" },
              { key: "relation", label: "Relation" },
              { key: "date_of_birth", label: "Date of birth", format: date },
            ]}
            rows={d.insured_members}
          />
          <DataTable
            title="Waiting periods"
            columns={[
              { key: "type", label: "Type" },
              { key: "months", label: "Months" },
            ]}
            rows={d.waiting_periods}
          />
          <DataTable
            title="Sub-limits"
            columns={[
              { key: "category", label: "Category" },
              { key: "limit_inr", label: "Limit", format: money },
            ]}
            rows={d.sub_limits}
          />
          <Chips title="Exclusions" items={d.exclusions} variant="destructive" />
        </>
      )
    }
    default:
      return (
        <>
          <Fields title="Document" rows={[["Title", d.document_title]]} />
          <Text title="Summary" value={d.summary} />
          <Fields title="Key fields" rows={Object.entries(d.key_fields || {})} />
          <Chips title="People" items={d.people} />
          <Chips title="Organizations" items={d.organizations} />
          <DataTable
            title="Dates"
            columns={[
              { key: "label", label: "Label" },
              { key: "date", label: "Date", format: date },
            ]}
            rows={d.dates}
          />
          <DataTable
            title="Amounts"
            columns={[
              { key: "label", label: "Label" },
              { key: "amount_inr", label: "Amount", format: money },
            ]}
            rows={d.amounts}
          />
        </>
      )
  }
}

export function TypedExtractionPanel({ docType, data, claimId, onEdit }) {
  const [mode, setMode] = useState("structured")
  const [activeCitation, setActiveCitation] = useState(null)
  const d = data || {}
  const notes = (d.extraction_notes || []).filter(Boolean)

  return (
    <section className="animate-rise overflow-hidden rounded-card bg-surface shadow-card" aria-label={`${docTypeLabel(docType)} extracted data`}>
      <div className="flex flex-col gap-3 border-b border-line px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-body font-semibold text-ink">{docTypeLabel(docType)}</h3>
          {typeof d.confidence_score === "number" && (
            <Badge variant="peacock">{Math.round(d.confidence_score * 100)}% confidence</Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onEdit && (
            <Button size="sm" variant="secondary" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
              Edit data
            </Button>
          )}
          <TabBar
            variant="segmented"
            size="sm"
            value={mode}
            onChange={setMode}
            ariaLabel="Extraction view"
            tabs={[
              { value: "structured", label: "Structured", icon: TableIcon },
              { value: "json", label: "JSON", icon: Code },
            ]}
          />
        </div>
      </div>
      <div>
        {mode === "json" ? (
          <pre className="max-h-[480px] overflow-auto bg-peacock-950 p-4 font-mono text-tiny leading-relaxed text-peacock-100">
            {JSON.stringify(d, null, 2)}
          </pre>
        ) : (
          <CitationContext.Provider value={{ active: activeCitation, onCite: claimId ? setActiveCitation : null }}>
            <div className={activeCitation ? "grid grid-cols-1 xl:grid-cols-2" : ""}>
              <div>
                {renderSections(docType, d)}
                <Chips title="Extraction notes" items={notes} />
              </div>
              {activeCitation && (
                <div className="border-t border-line bg-ground/50 p-3 xl:border-l xl:border-t-0">
                  <div className="xl:sticky xl:top-20">
                    <CitationViewer
                      key={citationKey(activeCitation)}
                      claimId={claimId}
                      citation={activeCitation}
                      title="Extracted from"
                      onClose={() => setActiveCitation(null)}
                    />
                  </div>
                </div>
              )}
            </div>
          </CitationContext.Provider>
        )}
      </div>
    </section>
  )
}
