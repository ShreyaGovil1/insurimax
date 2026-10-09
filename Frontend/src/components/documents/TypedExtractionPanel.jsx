import React, { useState } from "react"
import { Code, Table as TableIcon } from "lucide-react"
import { formatCurrencyINR } from "../../lib/utils"
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"

const DOC_TYPE_LABELS = {
  itemized_bill: "Itemized Hospital Bill",
  discharge_summary: "Discharge Summary",
  prescription: "Doctor Prescription",
  lab_report: "Diagnostic / Lab Report",
  consultation_notes: "Consultation Notes",
  policy_document: "Policy Document",
  other: "Supporting Document",
}

export const docTypeLabel = (t) => DOC_TYPE_LABELS[t] || (t || "").replaceAll("_", " ")

const isEmpty = (v) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)
const money = (v) => (isEmpty(v) ? null : formatCurrencyINR(Number(v)))
const date = (v) => {
  if (isEmpty(v)) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString()
}
const pct = (v) => (isEmpty(v) ? null : `${v}%`)

function Fields({ title, rows }) {
  const visible = rows.filter(([, v]) => !isEmpty(v))
  if (visible.length === 0) return null
  return (
    <div className="p-4 border-b border-slate-100 last:border-b-0">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2.5">{title}</h4>
      <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2.5">
        {visible.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[10px] font-semibold uppercase text-slate-400">{label}</dt>
            <dd className="text-xs font-semibold text-slate-900 break-words">{String(value)}</dd>
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
    <div className="p-4 border-b border-slate-100 last:border-b-0">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2.5">{title}</h4>
      <div className="flex flex-wrap gap-1.5">
        {list.map((item, i) => (
          <Badge key={i} variant={variant} className="text-[11px] font-medium">
            {typeof item === "string" ? item : JSON.stringify(item)}
          </Badge>
        ))}
      </div>
    </div>
  )
}

function Text({ title, value }) {
  if (isEmpty(value)) return null
  return (
    <div className="p-4 border-b border-slate-100 last:border-b-0">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{title}</h4>
      <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-wrap">{value}</p>
    </div>
  )
}

function DataTable({ title, columns, rows }) {
  const list = rows || []
  if (list.length === 0) return null
  return (
    <div className="p-4 border-b border-slate-100 last:border-b-0">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2.5">{title}</h4>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-100/90 text-[10px] font-bold uppercase tracking-wider text-slate-600">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="py-2 px-3">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => {
                  const raw = row?.[c.key]
                  const v = c.format ? c.format(raw) : raw
                  return (
                    <td key={c.key} className="py-2 px-3 text-slate-800">{isEmpty(v) ? "—" : String(v)}</td>
                  )
                })}
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
              { key: "covered", label: "Covered", format: (v) => (v === true ? "✔ Covered" : v === false ? "✘ Not covered" : null) },
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

export function TypedExtractionPanel({ docType, data }) {
  const [mode, setMode] = useState("structured")
  const d = data || {}
  const notes = (d.extraction_notes || []).filter(Boolean)

  return (
    <Card className="border border-slate-200 shadow-xs">
      <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-semibold">{docTypeLabel(docType)} — Extracted Data</CardTitle>
          {typeof d.confidence_score === "number" && (
            <Badge variant="secondary" className="text-[10px]">
              {Math.round(d.confidence_score * 100)}% confidence
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant={mode === "structured" ? "default" : "outline"} className="h-7 text-xs gap-1" onClick={() => setMode("structured")}>
            <TableIcon className="w-3.5 h-3.5" /> Structured
          </Button>
          <Button size="sm" variant={mode === "json" ? "default" : "outline"} className="h-7 text-xs gap-1" onClick={() => setMode("json")}>
            <Code className="w-3.5 h-3.5" /> JSON
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {mode === "json" ? (
          <pre className="p-4 text-[11px] leading-relaxed bg-slate-950 text-slate-100 overflow-auto max-h-[480px]">
            {JSON.stringify(d, null, 2)}
          </pre>
        ) : (
          <>
            {renderSections(docType, d)}
            <Chips title="Extraction notes" items={notes} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
