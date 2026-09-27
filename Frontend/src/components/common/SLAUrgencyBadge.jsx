import React from "react"
import { Clock, AlertTriangle, AlertCircle, CheckCircle } from "lucide-react"
import { calculateSLARemaining } from "../../lib/utils"
import { Badge } from "../ui/badge"

export function SLAUrgencyBadge({ slaDeadline, isBreached }) {
  const sla = calculateSLARemaining(slaDeadline)
  const breached = isBreached || sla.isBreached

  if (breached) {
    return (
      <Badge variant="destructive" className="gap-1 animate-pulse bg-red-100 text-red-800 border-red-300">
        <AlertCircle className="w-3.5 h-3.5 text-red-600" />
        <span>SLA Breached ({sla.text})</span>
      </Badge>
    )
  }

  if (sla.isUrgent) {
    return (
      <Badge variant="warning" className="gap-1 bg-amber-100 text-amber-900 border-amber-300">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
        <span className="font-bold">{sla.text}</span>
      </Badge>
    )
  }

  return (
    <Badge variant="secondary" className="gap-1 bg-slate-100 text-slate-700 border-slate-200">
      <Clock className="w-3.5 h-3.5 text-slate-500" />
      <span>{sla.text}</span>
    </Badge>
  )
}
