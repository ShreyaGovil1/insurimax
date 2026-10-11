import { useEffect, useState } from "react"
import { ArrowLeft, ArrowRight, Check } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Select } from "../ui/select"
import { Textarea } from "../ui/textarea"
import { Field } from "../ui/field"
import { useToast } from "../ui/toast"
import { api } from "../../services/api"
import { cn, formatCurrencyINR } from "../../lib/utils"
import { JourneyRail } from "../common/JourneyRail"

const EMPTY = {
  patient_name: "",
  patient_phone: "",
  insurer_org_id: "",
  policy_number: "",
  uhid: "",
  billed_amount: "",
  adjuster_notes: "",
}

const NEXT_STEPS = [
  { key: "draft", label: "Draft", caption: "Now", state: "current" },
  { key: "docs", label: "Attach documents", caption: "Policy + bill", state: "todo" },
  { key: "submit", label: "Submit", caption: "3-hour SLA starts", state: "todo" },
]

export function ClaimCreateModal({ open, onOpenChange, onClaimCreated }) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [insurers, setInsurers] = useState([])
  // Second step: the hospital confirms before the draft is created
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!open) return
    api.claims
      .listInsurers()
      .then(setInsurers)
      .catch((err) => toast({ title: "Couldn't load insurers", description: err.message, variant: "destructive" }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const close = (next) => {
    if (!next) {
      setConfirming(false)
      setErrors({})
    }
    onOpenChange(next)
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: undefined }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const next = {}
    if (!formData.patient_name.trim()) next.patient_name = "Enter the patient's name as it appears on the policy."
    if (!formData.insurer_org_id) next.insurer_org_id = "Choose the insurer this claim goes to."
    setErrors(next)
    if (Object.keys(next).length) return
    setConfirming(true)
  }

  const handleConfirmCreate = async () => {
    setLoading(true)
    try {
      const payload = {
        patient_name: formData.patient_name,
        patient_phone: formData.patient_phone || null,
        insurer_org_id: formData.insurer_org_id,
        policy_number: formData.policy_number || null,
        uhid: formData.uhid || null,
        billed_amount: formData.billed_amount ? parseFloat(formData.billed_amount) : null,
        adjuster_notes: formData.adjuster_notes || null,
      }

      const res = await api.claims.create(payload)
      toast({
        title: "Draft claim created",
        description: `${res.claim_number} is saved as a draft. Attach the policy and the medical bill, then submit it to start the 3-hour SLA.`,
        variant: "success",
      })
      onClaimCreated?.(res)
      setConfirming(false)
      onOpenChange(false)
      setFormData(EMPTY)
    } catch (err) {
      toast({ title: "Couldn't create the claim", description: err.message || "Failed to create claim", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  const insurerName = insurers.find((i) => i.id === formData.insurer_org_id)?.name

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent onClose={() => close(false)} className="sm:max-w-xl">
        <DialogHeader>
          <div className="mb-3 flex items-center gap-2 text-tiny font-semibold" aria-label={`Step ${confirming ? 2 : 1} of 2`}>
            <StepDot n={1} label="Patient & policy" active={!confirming} done={confirming} />
            <span className="h-px w-6 bg-line-strong" />
            <StepDot n={2} label="Confirm" active={confirming} />
          </div>
          <DialogTitle>{confirming ? "Check the details" : "New cashless claim"}</DialogTitle>
          <DialogDescription>
            {confirming
              ? "The claim is saved as a draft. Only you can see it until you submit it."
              : "Start with the patient and policy. You'll attach documents in the next step."}
          </DialogDescription>
        </DialogHeader>

        {confirming ? (
          <div className="animate-rise space-y-5">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl bg-ground p-4 text-sm">
              <Summary label="Patient" value={formData.patient_name} wide />
              <Summary label="Insurer" value={insurerName} wide />
              <Summary label="Policy number" value={formData.policy_number} mono />
              <Summary label="UHID" value={formData.uhid} mono />
              <Summary label="Phone" value={formData.patient_phone} />
              <Summary label="Billed amount" value={formData.billed_amount ? formatCurrencyINR(Number(formData.billed_amount)) : null} />
              {formData.adjuster_notes && <Summary label="Intake notes" value={formData.adjuster_notes} wide />}
            </dl>

            <div>
              <div className="mb-3 text-small font-semibold text-ink-2">What happens next</div>
              <JourneyRail steps={NEXT_STEPS} label="Next steps for this claim" />
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={loading}>
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button type="button" variant="proceed" onClick={handleConfirmCreate} loading={loading}>
                {loading ? "Creating draft…" : "Create draft & add documents"}
                {!loading && <ArrowRight className="h-4 w-4" />}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Patient name" htmlFor="patient_name" required error={errors.patient_name} className="sm:col-span-2">
                <Input
                  id="patient_name"
                  name="patient_name"
                  value={formData.patient_name}
                  onChange={handleChange}
                  placeholder="e.g. Ramesh Chawla"
                  aria-invalid={Boolean(errors.patient_name) || undefined}
                  autoComplete="off"
                />
              </Field>
              <Field label="Insurer" htmlFor="insurer_org_id" required error={errors.insurer_org_id}>
                <Select
                  id="insurer_org_id"
                  name="insurer_org_id"
                  value={formData.insurer_org_id}
                  onChange={handleChange}
                  aria-invalid={Boolean(errors.insurer_org_id) || undefined}
                >
                  <option value="">Select insurer…</option>
                  {insurers.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Policy number" htmlFor="policy_number" optional>
                <Input id="policy_number" name="policy_number" value={formData.policy_number} onChange={handleChange} placeholder="e.g. SH-GOLD-99201" className="font-mono text-small placeholder:font-sans" />
              </Field>
              <Field label="UHID / patient ID" htmlFor="uhid" optional>
                <Input id="uhid" name="uhid" value={formData.uhid} onChange={handleChange} placeholder="e.g. APL-2026-9021" className="font-mono text-small placeholder:font-sans" />
              </Field>
              <Field label="Patient phone" htmlFor="patient_phone" optional>
                <Input id="patient_phone" name="patient_phone" type="tel" value={formData.patient_phone} onChange={handleChange} placeholder="+91 98765 43210" />
              </Field>
              <Field label="Billed amount" htmlFor="billed_amount" optional hint="You can correct this after the bill is read." className="sm:col-span-2">
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-3">₹</span>
                  <Input id="billed_amount" type="number" name="billed_amount" value={formData.billed_amount} onChange={handleChange} placeholder="1,50,000" min="0" className="figures pl-7" />
                </div>
              </Field>
              <Field label="Intake notes" htmlFor="adjuster_notes" optional className="sm:col-span-2">
                <Textarea
                  id="adjuster_notes"
                  name="adjuster_notes"
                  value={formData.adjuster_notes}
                  onChange={handleChange}
                  placeholder="Remarks for the insurer, clinical instructions or priority flags"
                  rows={2}
                />
              </Field>
            </div>

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => close(false)} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit">
                Continue
                <ArrowRight className="h-4 w-4" />
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function StepDot({ n, label, active, done }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", active ? "text-ink" : "text-ink-3")}>
      <span
        className={cn(
          "flex h-5 w-5 items-center justify-center rounded-full text-tiny",
          done ? "bg-peacock-600 text-white" : active ? "bg-marigold-400 text-ink" : "bg-sunken text-ink-3"
        )}
      >
        {done ? <Check className="h-3 w-3" strokeWidth={3} /> : n}
      </span>
      {label}
    </span>
  )
}

function Summary({ label, value, wide, mono }) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2 sm:col-span-1")}>
      <dt className="text-tiny font-medium text-ink-3">{label}</dt>
      <dd className={cn("truncate font-semibold text-ink", mono && value && "font-mono text-small", !value && "font-normal text-ink-3")}>{value || "Not provided"}</dd>
    </div>
  )
}
