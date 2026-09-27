import React, { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
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
    hospital_name: "Apollo Hospital, Bannerghatta",
    insurer_name: "Star Health & Allied Insurance",
    policy_number: "",
    uhid: "",
    billed_amount: "",
    adjuster_notes: "",
  })

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.patient_name || !formData.hospital_name) {
      toast({
        title: "Validation Error",
        description: "Patient Name and Hospital Name are required.",
        variant: "destructive",
      })
      return
    }

    setLoading(true)
    try {
      const payload = {
        patient_name: formData.patient_name,
        patient_phone: formData.patient_phone || null,
        hospital_name: formData.hospital_name,
        insurer_name: formData.insurer_name || null,
        policy_number: formData.policy_number || null,
        uhid: formData.uhid || null,
        billed_amount: formData.billed_amount ? parseFloat(formData.billed_amount) : null,
        adjuster_notes: formData.adjuster_notes || null,
      }

      const res = await api.claims.create(payload)
      toast({
        title: "Claim Created Successfully",
        description: `Claim ${res.claim_number} logged with 3-Hour IRDAI SLA timer initiated.`,
        variant: "success",
      })
      onClaimCreated?.(res)
      onOpenChange(false)
      // Reset form
      setFormData({
        patient_name: "",
        patient_phone: "",
        hospital_name: "Apollo Hospital, Bannerghatta",
        insurer_name: "Star Health & Allied Insurance",
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
            Register new discharge claim. The 3-Hour IRDAI turnaround timer starts immediately upon submission.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-lg flex items-center space-x-2 text-xs text-blue-900">
            <Clock className="w-4 h-4 text-blue-600 shrink-0" />
            <span>
              <strong>IRDAI Cashless SLA:</strong> 3 Hours deadline will automatically attach to this claim.
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
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Hospital Name <span className="text-red-500">*</span>
              </label>
              <Input
                name="hospital_name"
                value={formData.hospital_name}
                onChange={handleChange}
                placeholder="e.g. Apollo Hospital"
                required
              />
            </div>
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
              <label className="text-xs font-semibold text-slate-700 block mb-1">Insurer Name</label>
              <Input
                name="insurer_name"
                value={formData.insurer_name}
                onChange={handleChange}
                placeholder="e.g. Star Health"
              />
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
              {loading ? "Registering Claim..." : "Create & Start SLA"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
