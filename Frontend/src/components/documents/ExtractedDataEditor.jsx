import { useMemo, useState } from "react"
import { Calculator, Plus, Save, Trash2, X } from "lucide-react"
import { cn, formatCurrencyINR } from "../../lib/utils"
import { Button } from "../ui/button"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../ui/dialog"

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
  const base = cn(
    "w-full rounded-lg bg-surface text-ink ring-1 ring-inset ring-line-strong transition-shadow focus:outline-none focus:ring-2 focus:ring-peacock-500",
    compact ? "px-2 py-1 text-small" : "px-2.5 py-2 text-sm"
  )
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
        className={cn(base, "figures text-right")}
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
      <div className="text-small font-semibold text-ink-2">{humanize(name)}</div>
      {list.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <FieldInput fieldKey={name} value={item} onChange={(v) => onChange(list.map((x, j) => (j === i ? v : x)))} />
          <Button type="button" size="icon-sm" variant="ghost" className="hover:bg-vermilion-50 hover:text-vermilion-700" onClick={() => onChange(list.filter((_, j) => j !== i))} title="Remove" aria-label="Remove">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="secondary" onClick={() => onChange([...list, ""])}>
        <Plus className="h-3.5 w-3.5" /> Add
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
        <div className="text-small font-semibold text-ink-2">
          {humanize(name)} <span className="font-normal text-ink-3">({list.length})</span>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={addRow}>
          <Plus className="h-3.5 w-3.5" /> Add row
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl ring-1 ring-line">
        <table className="w-full text-small">
          <thead className="bg-ground text-tiny font-semibold text-ink-3">
            <tr>
              {columns.map((c) => (
                <th key={c} className="whitespace-nowrap px-2 py-2 text-left font-semibold">{humanize(c)}</th>
              ))}
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="py-4 text-center text-small text-ink-3">No rows yet. Use “Add row”.</td>
              </tr>
            )}
            {list.map((row, i) => (
              <tr key={i} className={row.manually_added ? "bg-leaf-50/70" : row.manually_edited ? "bg-sand-50/80" : ""}>
                {columns.map((c) => (
                  <td key={c} className={`py-1 px-1.5 ${c === "item_name" || c === "benefit" || c === "name" ? "min-w-[200px]" : "min-w-[90px]"}`}>
                    <FieldInput compact fieldKey={c} value={row?.[c]} onChange={(v) => updateCell(i, c, v)} />
                  </td>
                ))}
                <td className="py-1 px-1 text-center">
                  <Button type="button" size="icon-sm" variant="ghost" className="hover:bg-vermilion-50 hover:text-vermilion-700" onClick={() => onChange(list.filter((_, j) => j !== i))} title="Remove row" aria-label="Remove row">
                    <Trash2 className="h-3.5 w-3.5" />
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
              <span className="text-small font-semibold text-ink-2">{humanize(k)}</span>
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
            <div key={k} className="rounded-xl bg-surface p-4 shadow-card">
              {ofRecords ? (
                <RowsEditor name={k} rows={v} onChange={(nv) => set(k, nv)} />
              ) : (
                <ListEditor name={k} items={v} onChange={(nv) => set(k, nv)} />
              )}
            </div>
          )
        }
        return (
          <fieldset key={k} className="rounded-xl bg-surface p-4 shadow-card">
            <legend className="float-left mb-3 w-full text-small font-semibold text-ink">{humanize(k)}</legend>
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
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent onClose={onCancel} className="flex max-h-[92dvh] flex-col bg-ground p-0 sm:max-w-6xl">
        <div className="border-b border-line bg-surface px-5 py-4 pr-14 sm:rounded-t-[18px]">
          <DialogTitle className="text-body">{title || "Edit extracted data"}</DialogTitle>
          <DialogDescription className="text-small">
            Correct any field, add missing items or remove wrong ones. Edited rows are marked sand, added rows green.
          </DialogDescription>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <ObjectEditor value={draft} onChange={setDraft} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-5 py-3.5 sm:rounded-b-[18px]">
          {lineItems ? (
            <div className="flex flex-wrap items-center gap-2 text-small text-ink-3">
              <span className="figures">
                Line items total <strong className="font-semibold text-ink">{formatCurrencyINR(lineSum)}</strong> · Bill total{" "}
                <strong className="font-semibold text-ink">{formatCurrencyINR(Number(draft.total_billed_inr) || 0)}</strong>
              </span>
              {Math.abs(lineSum - (Number(draft.total_billed_inr) || 0)) > 0.01 && (
                <Button type="button" size="sm" variant="secondary" onClick={() => setDraft((d) => ({ ...d, total_billed_inr: lineSum }))}>
                  <Calculator className="h-3.5 w-3.5" /> Use the line items sum
                </Button>
              )}
            </div>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button variant="success" onClick={handleSave} loading={saving}>
              {!saving && <Save className="h-4 w-4" />}
              {saving ? "Saving…" : "Save corrections"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
