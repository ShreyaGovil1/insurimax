import React, { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Select } from "../ui/select"
import { Textarea } from "../ui/textarea"
import { useToast } from "../ui/toast"
import { api } from "../../services/api"
import { Clock, ShieldAlert } from "lucide-react"

export function ClaimCreateModal({ open, onOpenChange, onClaimCreated }) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    patient_name: "",
    patient_phone: "",
    insurer_org_id: "",
    policy_number: "",
    uhid: "",
    billed_amount: "",
    adjuster_notes: "",
  })
  const [insurers, setInsurers] = useState([])
  // Second step: the hospital confirms before the draft is created
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!open) setConfirming(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    api.claims
      .listInsurers()
      .then(setInsurers)
      .catch((err) =>
        toast({ title: "Could not load insurers", description: err.message, variant: "destructive" })
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!formData.patient_name || !formData.insurer_org_id) {
      toast({
        title: "Validation Error",
        description: "Patient Name and Insurer are required.",
        variant: "destructive",
      })
      return
    }
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
        title: "Draft Claim Created",
        description: `Claim ${res.claim_number} saved as a draft. Attach the policy and the medical bill, then submit it to the insurer to start the 3-hour SLA.`,
        variant: "success",
      })
      onClaimCreated?.(res)
      setConfirming(false)
      onOpenChange(false)
      // Reset form
      setFormData({
        patient_name: "",
        patient_phone: "",
        insurer_org_id: "",
        policy_number: "",
        uhid: "",
        billed_amount: "",
        adjuster_notes: "",
      })
    } catch (err) {
      toast({
        title: "Submission Failed",
        description: err.message || "Failed to create claim",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Intake New Cashless Claim</DialogTitle>
          <DialogDescription>
            Register a new discharge claim. It is saved as a draft so you can attach its documents first.
          </DialogDescription>
        </DialogHeader>

        {confirming ? (
          <div className="space-y-4">
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start space-x-3 text-xs text-amber-900">
              <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold text-sm">Create claim for {formData.patient_name}?</div>
                <p>SLA will begin after attaching the documents and submitting to the insurer.</p>
                <p className="text-amber-800">
                  Insurer: <strong>{insurers.find((i) => i.id === formData.insurer_org_id)?.name}</strong>. The policy and
                  the medical bill must be attached before the claim can be submitted.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConfirming(false)} disabled={loading}>
                Back
              </Button>
              <Button type="button" onClick={handleConfirmCreate} disabled={loading} className="bg-blue-600 hover:bg-blue-700">
                {loading ? "Creating Claim..." : "Confirm & Create Claim"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-lg flex items-center space-x-2 text-xs text-blue-900">
            <Clock className="w-4 h-4 text-blue-600 shrink-0" />
            <span>
              <strong>IRDAI Cashless SLA:</strong> the 3-hour deadline begins after you attach the documents and submit the claim to the insurer.
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Patient Name <span className="text-red-500">*</span>
              </label>
              <Input
                name="patient_name"
                value={formData.patient_name}
                onChange={handleChange}
                placeholder="e.g. Ramesh Chawla"
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Patient Phone</label>
              <Input
                name="patient_phone"
                value={formData.patient_phone}
                onChange={handleChange}
                placeholder="+91 98765 43210"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">UHID / Patient ID</label>
              <Input
                name="uhid"
                value={formData.uhid}
                onChange={handleChange}
                placeholder="e.g. APL-2026-9021"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Insurer <span className="text-red-500">*</span>
              </label>
              <Select name="insurer_org_id" value={formData.insurer_org_id} onChange={handleChange} required>
                <option value="">Select insurer…</option>
                {insurers.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Policy Number</label>
              <Input
                name="policy_number"
                value={formData.policy_number}
                onChange={handleChange}
                placeholder="e.g. SH-GOLD-99201"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Billed Amount (₹ INR)</label>
            <Input
              type="number"
              name="billed_amount"
              value={formData.billed_amount}
              onChange={handleChange}
              placeholder="e.g. 150000"
              min="0"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Adjuster Intake Notes</label>
            <Textarea
              name="adjuster_notes"
              value={formData.adjuster_notes}
              onChange={handleChange}
              placeholder="Initial remarks, special clinical instructions or priority flags..."
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-700">
              Create Claim
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
