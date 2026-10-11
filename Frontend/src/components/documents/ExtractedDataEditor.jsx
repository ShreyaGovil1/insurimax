import { useMemo, useState } from "react"
import { Calculator, Plus, Save, Trash2, X } from "lucide-react"
import { formatCurrencyINR } from "../../lib/utils"
import { Button } from "../ui/button"

/**
 * Form editor for one document's extracted data. The form is built from the shape of the data:
 * scalars become inputs, nested objects become field groups, lists of records become editable
 * tables (add / remove rows) and lists of text become editable lists. Rows keep their source
 * citation; edited and added rows are marked so reviewers can tell them apart from AI output.
 */

// Row bookkeeping (never shown as columns)
const META_KEYS = new Set(["source", "manually_edited", "manually_added"])
// Top-level fields the user shouldn't edit
const HIDDEN_KEYS = new Set(["document_type", "confidence_score"])

// Columns for lists that may be empty (so rows can still be added)
const ROW_TEMPLATES = {
  line_items: ["line_number", "item_name", "item_category", "quantity", "unit_price_inr", "total_price_inr", "date"],
  medications: ["name", "dosage", "frequency", "duration", "route"],
  medications_on_discharge: ["name", "dosage", "duration"],
  tests: ["test_name", "result", "unit", "reference_range", "flag"],
  coverage_items: ["category", "benefit", "covered", "limit_inr", "limit_description", "conditions"],
  insured_members: ["name", "relation", "date_of_birth"],
  waiting_periods: ["type", "months"],
  sub_limits: ["category", "limit_inr"],
  amounts: ["label", "amount_inr"],
  dates: ["label", "date"],
}

const NUMERIC_KEY = /(_inr$|_percent$|^quantity$|^age$|_days$|^months$|^line_number$|^limit_inr$|^amount_inr$)/
const BOOLEAN_KEYS = new Set(["handwritten", "covered"])

const humanize = (key) =>
  key
    .replace(/_inr$/, " (₹)")
    .replace(/_percent$/, " (%)")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const fieldKind = (key, value) => {
  if (typeof value === "boolean" || BOOLEAN_KEYS.has(key)) return "boolean"
  if (typeof value === "number" || NUMERIC_KEY.test(key)) return "number"
  if (/date/.test(key)) return "date"
  return "text"
}

function FieldInput({ fieldKey, value, onChange, compact = false }) {
  const kind = fieldKind(fieldKey, value)
  const base = `w-full border border-slate-300 rounded-md bg-white text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none ${
    compact ? "px-1.5 py-1 text-[11px]" : "px-2 py-1.5 text-xs"
  }`
  if (kind === "boolean") {
    return (
      <select
        className={base}
        value={value === true ? "true" : value === false ? "false" : ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "true")}
      >
        <option value="">—</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    )
  }
  if (kind === "number") {
    return (
      <input
        type="number"
        step="any"
        className={`${base} text-right font-mono`}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
    )
  }
  return (
    <input
      type="text"
      className={base}
      value={value ?? ""}
      placeholder={kind === "date" ? "YYYY-MM-DD" : ""}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
    />
  )
}

function ListEditor({ name, items, onChange }) {
  const list = items || []
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold text-slate-600">{humanize(name)}</div>
      {list.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <FieldInput fieldKey={name} value={item} onChange={(v) => onChange(list.map((x, j) => (j === i ? v : x)))} />
          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0 text-slate-400 hover:text-red-600" onClick={() => onChange(list.filter((_, j) => j !== i))} title="Remove">
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={() => onChange([...list, ""])}>
        <Plus className="w-3 h-3" /> Add
      </Button>
    </div>
  )
}

function RowsEditor({ name, rows, onChange }) {
  const list = rows || []
  const columns = useMemo(() => {
    const keys = new Set(ROW_TEMPLATES[name] || [])
    ;(rows || []).forEach((r) => Object.keys(r || {}).forEach((k) => !META_KEYS.has(k) && !isPlainObject(r[k]) && !Array.isArray(r[k]) && keys.add(k)))
    return [...keys]
  }, [name, rows])

  const updateCell = (i, key, value) => {
    onChange(
      list.map((row, j) => {
        if (j !== i) return row
        const next = { ...row, [key]: value }
        // Bills: keep the line total in step with qty x unit price unless it was entered separately
        if (name === "line_items" && (key === "quantity" || key === "unit_price_inr")) {
          const before = (Number(row.quantity) || 0) * (Number(row.unit_price_inr) || 0)
          if (row.total_price_inr == null || Math.abs((Number(row.total_price_inr) || 0) - before) < 0.01) {
            next.total_price_inr = (Number(next.quantity) || 0) * (Number(next.unit_price_inr) || 0)
          }
        }
        if (!row.manually_added) next.manually_edited = true
        return next
      })
    )
  }

  const addRow = () => {
    const row = Object.fromEntries(columns.map((c) => [c, null]))
    if (name === "line_items") {
      row.line_number = Math.max(0, ...list.map((r) => Number(r.line_number) || 0)) + 1
      row.quantity = 1
    }
    onChange([...list, { ...row, manually_added: true }])
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold text-slate-600">
          {humanize(name)} <span className="text-slate-400 font-normal">({list.length})</span>
        </div>
        <Button type="button" size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={addRow}>
          <Plus className="w-3 h-3" /> Add row
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-xs">
          <thead className="bg-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-600">
            <tr>
              {columns.map((c) => (
                <th key={c} className="py-1.5 px-2 text-left whitespace-nowrap">{humanize(c)}</th>
              ))}
              <th className="py-1.5 px-2 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="py-3 text-center text-[11px] text-slate-400">No rows. Use “Add row”.</td>
              </tr>
            )}
            {list.map((row, i) => (
              <tr key={i} className={row.manually_added ? "bg-emerald-50/60" : row.manually_edited ? "bg-amber-50/60" : ""}>
                {columns.map((c) => (
                  <td key={c} className={`py-1 px-1.5 ${c === "item_name" || c === "benefit" || c === "name" ? "min-w-[200px]" : "min-w-[90px]"}`}>
                    <FieldInput compact fieldKey={c} value={row?.[c]} onChange={(v) => updateCell(i, c, v)} />
                  </td>
                ))}
                <td className="py-1 px-1 text-center">
                  <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0 text-slate-400 hover:text-red-600" onClick={() => onChange(list.filter((_, j) => j !== i))} title="Remove row">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ObjectEditor({ value, onChange, path = [] }) {
  const obj = value || {}
  const entries = Object.entries(obj).filter(([k]) => !META_KEYS.has(k) && !(path.length === 0 && HIDDEN_KEYS.has(k)))
  const scalars = entries.filter(([, v]) => !isPlainObject(v) && !Array.isArray(v))
  const nested = entries.filter(([, v]) => isPlainObject(v) || Array.isArray(v))
  const set = (key, v) => onChange({ ...obj, [key]: v })

  return (
    <div className="space-y-4">
      {scalars.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {scalars.map(([k, v]) => (
            <label key={k} className="block">
              <span className="text-[11px] font-semibold text-slate-600">{humanize(k)}</span>
              <div className="mt-1">
                <FieldInput fieldKey={k} value={v} onChange={(nv) => set(k, nv)} />
              </div>
            </label>
          ))}
        </div>
      )}
      {nested.map(([k, v]) => {
        if (Array.isArray(v)) {
          const ofRecords = v.some(isPlainObject) || (v.length === 0 && ROW_TEMPLATES[k])
          return (
            <div key={k} className="p-3 rounded-lg border border-slate-200 bg-white">
              {ofRecords ? (
                <RowsEditor name={k} rows={v} onChange={(nv) => set(k, nv)} />
              ) : (
                <ListEditor name={k} items={v} onChange={(nv) => set(k, nv)} />
              )}
            </div>
          )
        }
        return (
          <fieldset key={k} className="p-3 rounded-lg border border-slate-200 bg-white">
            <legend className="px-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">{humanize(k)}</legend>
            <ObjectEditor value={v} onChange={(nv) => set(k, nv)} path={[...path, k]} />
          </fieldset>
        )
      })}
    </div>
  )
}

export function ExtractedDataEditor({ data, title, onSave, onCancel }) {
  const [draft, setDraft] = useState(() => structuredClone(data || {}))
  const [saving, setSaving] = useState(false)

  const lineItems = Array.isArray(draft.line_items) ? draft.line_items : null
  const lineSum = lineItems ? lineItems.reduce((acc, li) => acc + (Number(li.total_price_inr) || 0), 0) : 0

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(draft)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="relative w-full max-w-6xl max-h-[92vh] flex flex-col bg-slate-50 rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-200 bg-white">
          <div>
            <h2 className="text-sm font-bold text-slate-900">{title || "Edit extracted data"}</h2>
            <p className="text-[11px] text-slate-500">
              Correct any field, add missing items or remove wrong ones. Edited rows are marked amber, added rows green.
            </p>
          </div>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onCancel} title="Close">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <ObjectEditor value={draft} onChange={setDraft} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-slate-200 bg-white">
          {lineItems ? (
            <div className="flex items-center gap-2 text-[11px] text-slate-600">
              <span>
                Line items total <strong className="font-mono">{formatCurrencyINR(lineSum)}</strong> · Bill total{" "}
                <strong className="font-mono">{formatCurrencyINR(Number(draft.total_billed_inr) || 0)}</strong>
              </span>
              {Math.abs(lineSum - (Number(draft.total_billed_inr) || 0)) > 0.01 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] gap-1"
                  onClick={() => setDraft((d) => ({ ...d, total_billed_inr: lineSum }))}
                >
                  <Calculator className="w-3 h-3" /> Set bill total to line items sum
                </Button>
              )}
            </div>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5">
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? "Saving..." : "Save Corrections"}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
