import { useEffect, useState } from "react"
import { ArrowRight, FileText, Info, ShieldAlert, Sparkles, UploadCloud, Zap, FileCheck2 } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { api } from "../../services/api"
import { formatCurrencyINR } from "../../lib/utils"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Field } from "../ui/field"
import { Badge } from "../ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { PageHeader } from "../common/PageHeader"

const QUICK_SCENARIOS = [
  {
    name: "Apollo Cardiology",
    patient: "Ramesh Chawla",
    hospital: "Apollo Hospital, Bannerghatta",
    insurer: "Star Health & Allied Insurance",
    policy: "SH-GOLD-99201",
    amount: "173500",
    tag: "High Deductions Risk",
  },
  {
    name: "Fortis Orthopedic",
    patient: "Sunita Deshmukh",
    hospital: "Fortis Hospital, Cunningham Rd",
    insurer: "HDFC ERGO General Insurance",
    policy: "HD-OPT-44120",
    amount: "245000",
    tag: "Implant GIPSA Ceiling",
  },
  {
    name: "Max Daycare Cataract",
    patient: "Anand Verma",
    hospital: "Max Super Speciality Hospital",
    insurer: "Care Health Insurance",
    policy: "CARE-ADV-88310",
    amount: "48000",
    tag: "Fast-Track Auto Approve",
  },
]

export function HospitalPreCheckView({ onClaimCreated }) {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [running, setRunning] = useState(false)
  const [creating, setCreating] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [preCheckResult, setPreCheckResult] = useState(null)
  const [templates, setTemplates] = useState([])
  const [uploadedFile, setUploadedFile] = useState(null)
  const [form, setForm] = useState({
    patient_name: "Ramesh Chawla",
    hospital_name: "Apollo Hospital, Bannerghatta",
    insurer_name: "Star Health & Allied Insurance",
    policy_number: "SH-GOLD-99201",
    billed_amount: "173500",
  })

  useEffect(() => {
    api.hospital
      .getSubmissionTemplates()
      .then((res) => setTemplates(res?.templates || []))
      .catch(() => {})
  }, [])

  const applyScenario = (sc) => {
    setForm({
      patient_name: sc.patient,
      hospital_name: sc.hospital,
      insurer_name: sc.insurer,
      policy_number: sc.policy,
      billed_amount: sc.amount,
    })
    setPreCheckResult(null)
    toast({
      title: `Scenario loaded: ${sc.name}`,
      description: `Billed ${formatCurrencyINR(Number(sc.amount))}`,
      variant: "default",
    })
  }

  const handleRunPreCheck = async (e) => {
    e?.preventDefault?.()
    setRunning(true)
    try {
      const formData = new FormData()
      formData.append("patient_name", form.patient_name)
      formData.append("hospital_name", form.hospital_name)
      formData.append("insurer_name", form.insurer_name)
      formData.append("policy_number", form.policy_number)
      formData.append("billed_amount", form.billed_amount)
      if (uploadedFile) {
        formData.append("bill_file", uploadedFile)
      }

      const result = await api.hospital.runPreCheck(formData)
      setPreCheckResult(result)
      toast({
        title: "Pre-check complete",
        description: "Checked against the IRDAI non-payable list and GIPSA package ceilings.",
        variant: "info",
      })
    } catch (err) {
      toast({ title: "Pre-check failed", description: err.message, variant: "destructive" })
    } finally {
      setRunning(false)
    }
  }

  const handleConvertToFormalClaim = async () => {
    setCreating(true)
    try {
      const insurers = await api.claims.listInsurers()
      const insurer = insurers.find((i) => i.name.toLowerCase() === (form.insurer_name || "").toLowerCase())
      if (!insurer) {
        toast({
          title: "Insurer not registered",
          description: `"${form.insurer_name}" is not an insurer on the platform. Ask an admin to add it.`,
          variant: "destructive",
        })
        setConfirmOpen(false)
        return
      }
      const newClaim = await api.claims.create({
        patient_name: form.patient_name,
        insurer_org_id: insurer.id,
        policy_number: form.policy_number,
        billed_amount: parseFloat(form.billed_amount) || null,
        adjuster_notes: "Converted from hospital pre-submission audit check " + preCheckResult?.check_id,
      })
      // Carry the audited bill over so the hospital doesn't have to upload it again
      let billAttached = false
      if (uploadedFile && newClaim?.id) {
        const fd = new FormData()
        fd.append("file", uploadedFile)
        fd.append("doc_type", "itemized_bill")
        billAttached = await api.documents.upload(newClaim.id, fd).then(
          () => true,
          () => false
        )
      }
      toast({
        title: "Draft claim created",
        description: `${newClaim.claim_number} is saved as a draft${billAttached ? " with the checked bill attached" : ""}. Attach the policy and the medical bill, then submit it to start the 3-hour SLA.`,
        variant: "success",
      })
      setConfirmOpen(false)
      onClaimCreated?.(newClaim)
      if (newClaim?.id) navigate(`/claims/${newClaim.id}/documents`)
    } catch (err) {
      toast({ title: "Couldn't create the claim", description: err.message, variant: "destructive" })
    } finally {
      setCreating(false)
    }
  }

  const approvedVal = preCheckResult?.estimated_approved_amount ?? 0
  const deductionVal = preCheckResult?.estimated_deductions ?? 0
  const approvedPct = approvedVal + deductionVal > 0 ? Math.round((approvedVal / (approvedVal + deductionVal)) * 100) : 0
  const deductionPct = 100 - approvedPct
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value })

  return (
    <div className="mx-auto max-w-[1360px] space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Pre-submission check"
        description="See likely deductions against IRDAI non-payables and tariff caps before you file the claim."
      >
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-small text-ink-3">Try a scenario:</span>
          {QUICK_SCENARIOS.map((sc) => (
            <button
              key={sc.name}
              type="button"
              onClick={() => applyScenario(sc)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-small font-semibold text-ink-2 shadow-card transition-shadow hover:shadow-raised"
            >
              {sc.name}
              <span className="figures font-normal text-ink-3">₹{(Number(sc.amount) / 1000).toFixed(0)}k</span>
            </button>
          ))}
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <section className="rounded-card bg-surface p-5 shadow-card sm:p-6" aria-label="Claim details">
            <h2 className="text-body font-semibold text-ink">Claim details</h2>
            <form onSubmit={handleRunPreCheck} className="mt-4 space-y-4">
              <Field label="Patient full name" htmlFor="pc-patient" required>
                <Input id="pc-patient" value={form.patient_name} onChange={set("patient_name")} required />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Hospital" htmlFor="pc-hospital" required>
                  <Input id="pc-hospital" value={form.hospital_name} onChange={set("hospital_name")} required />
                </Field>
                <Field label="Insurer" htmlFor="pc-insurer">
                  <Input id="pc-insurer" value={form.insurer_name} onChange={set("insurer_name")} />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Policy number" htmlFor="pc-policy">
                  <Input id="pc-policy" value={form.policy_number} onChange={set("policy_number")} className="font-mono text-small" />
                </Field>
                <Field label="Billed amount" htmlFor="pc-amount" required>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-3">₹</span>
                    <Input id="pc-amount" type="number" value={form.billed_amount} onChange={set("billed_amount")} required className="figures pl-7 font-semibold" />
                  </div>
                </Field>
              </div>
              <div>
                <span className="mb-1.5 block text-small font-semibold text-ink-2">Draft bill</span>
                <label className="group flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-line-strong bg-ground/60 px-4 py-6 text-center transition-colors hover:border-peacock-300 hover:bg-peacock-50/50">
                  <UploadCloud className="h-5 w-5 text-peacock-600" />
                  <span className="text-sm font-semibold text-ink-2">{uploadedFile ? uploadedFile.name : "Drop the bill PDF or photo, or browse"}</span>
                  <span className="text-tiny text-ink-3">PDF, JPG or PNG up to 10 MB</span>
                  <input type="file" className="sr-only" onChange={(e) => setUploadedFile(e.target.files?.[0] || null)} />
                </label>
              </div>
              <Button type="submit" size="lg" className="w-full" loading={running}>
                {!running && <Sparkles className="h-4 w-4" />}
                {running ? "Checking the bill…" : "Run pre-submission check"}
              </Button>
            </form>
          </section>

          {templates.length > 0 && (
            <section className="rounded-card bg-surface p-5 shadow-card sm:p-6" aria-label="Billing templates">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-body font-semibold text-ink">Standard billing templates</h2>
                <span className="text-tiny text-ink-3">IRDAI master list</span>
              </div>
              <ul className="mt-3 divide-y divide-line">
                {templates.map((tpl, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-peacock-50 text-peacock-600">
                        <FileText className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-ink">{tpl.name}</div>
                        <div className="truncate text-small text-ink-3">{tpl.description}</div>
                      </div>
                    </div>
                    <Badge variant="outline">{tpl.format}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="lg:sticky lg:top-20">
          {preCheckResult ? (
            <section className="animate-rise overflow-hidden rounded-card bg-surface shadow-raised" aria-label="Pre-check result">
              <div className="bg-peacock-800 p-6 text-white">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-small font-semibold text-peacock-200">Estimated outcome</span>
                  <span className="rounded-full bg-white/10 px-2.5 py-0.5 font-mono text-tiny text-peacock-100">{preCheckResult.check_id}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-small text-peacock-200">Likely admissible</div>
                    <div className="figures text-[32px] font-semibold leading-tight tracking-[-0.02em] text-marigold-300">
                      {formatCurrencyINR(preCheckResult.estimated_approved_amount)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-small text-peacock-200">Deduction risk</div>
                    <div className="figures text-[24px] font-semibold leading-tight tracking-[-0.02em]">
                      −{formatCurrencyINR(preCheckResult.estimated_deductions)}
                    </div>
                  </div>
                </div>
                <div className="mt-5 flex h-2.5 w-full gap-[2px]" role="img" aria-label={`Admissible ${approvedPct}%, deductions ${deductionPct}%`}>
                  <div className="h-full rounded-l-[4px] bg-peacock-300" style={{ width: `${approvedPct}%` }} />
                  <div className="h-full rounded-r-[4px] bg-marigold-400" style={{ width: `${deductionPct}%` }} />
                </div>
                <div className="mt-2 flex justify-between text-tiny text-peacock-200">
                  <span>Admissible {approvedPct}%</span>
                  <span>Deductions {deductionPct}%</span>
                </div>
              </div>

              <div className="space-y-5 p-6">
                <div>
                  <div className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-ink">
                    <ShieldAlert className="h-4 w-4 text-sand-600" />
                    Likely deductions ({preCheckResult.detected_issues?.length || 0})
                  </div>
                  <ul className="space-y-2">
                    {preCheckResult.detected_issues?.map((iss, idx) => (
                      <li key={idx} className="rounded-xl bg-ground p-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-sm font-semibold text-ink">{iss.item}</span>
                          <span className="figures shrink-0 text-sm font-semibold text-vermilion-700">−{formatCurrencyINR(iss.deduction_inr)}</span>
                        </div>
                        <p className="mt-1 text-small leading-relaxed text-ink-3">{iss.reason}</p>
                      </li>
                    ))}
                  </ul>
                </div>

                {preCheckResult.suggestions?.length > 0 && (
                  <div className="rounded-xl bg-peacock-50 p-4">
                    <div className="mb-1.5 flex items-center gap-1.5 text-small font-semibold text-peacock-800">
                      <Info className="h-4 w-4" />
                      How to avoid them
                    </div>
                    <ul className="space-y-1.5">
                      {preCheckResult.suggestions.map((sug, i) => (
                        <li key={i} className="flex gap-2 text-small text-ink-2">
                          <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-peacock-400" />
                          {sug}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <Button variant="proceed" size="lg" className="w-full" onClick={() => setConfirmOpen(true)}>
                  Create claim from this check
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </section>
          ) : (
            <section className="flex flex-col items-center rounded-card bg-surface px-6 py-14 text-center shadow-card">
              <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-peacock-50 text-peacock-600">
                <FileCheck2 className="h-6 w-6" strokeWidth={1.75} />
              </span>
              <h3 className="text-lg font-semibold text-ink">Check a bill before you file it</h3>
              <p className="mt-1 max-w-sm text-sm text-ink-3">
                Pick a scenario or enter the bill details, then run the check to see what the insurer is likely to deduct.
              </p>
              <Button variant="secondary" className="mt-6" onClick={() => handleRunPreCheck()} loading={running}>
                {!running && <Zap className="h-4 w-4 text-peacock-500" />}
                Try with the demo bill
              </Button>
            </section>
          )}
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent onClose={() => setConfirmOpen(false)}>
          <DialogHeader>
            <DialogTitle>Create a claim for {form.patient_name || "this patient"}?</DialogTitle>
            <DialogDescription>It's saved as a draft. The 3-hour SLA starts only after you attach the documents and submit it to the insurer.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={creating}>
              Not yet
            </Button>
            <Button variant="proceed" onClick={handleConvertToFormalClaim} loading={creating}>
              {creating ? "Creating…" : "Create draft claim"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
