import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatCurrencyINR(amount) {
  if (amount === null || amount === undefined) return "₹0"
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatDateTime(isoString) {
  if (!isoString) return "—"
  try {
    const d = new Date(isoString)
    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
  } catch {
    return isoString
  }
}

export function calculateSLARemaining(slaDeadline) {
  if (!slaDeadline) return { remainingMinutes: null, isBreached: false, text: "No SLA" }
  const now = new Date()
  const deadline = new Date(slaDeadline)
  const diffMs = deadline.getTime() - now.getTime()
  const diffMinutes = Math.floor(diffMs / (1000 * 60))

  if (diffMinutes <= 0) {
    return {
      remainingMinutes: diffMinutes,
      isBreached: true,
      isUrgent: true,
      text: `Breached by ${Math.abs(diffMinutes)}m`,
    }
  }

  const hours = Math.floor(diffMinutes / 60)
  const mins = diffMinutes % 60
  const text = hours > 0 ? `${hours}h ${mins}m left` : `${mins}m left`

  return {
    remainingMinutes: diffMinutes,
    isBreached: false,
    isUrgent: diffMinutes < 30, // IRDAI high breach risk threshold
    text,
  }
}
