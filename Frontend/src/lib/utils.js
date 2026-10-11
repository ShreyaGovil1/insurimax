import { clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Teach tailwind-merge the theme's custom type sizes and radii so they don't evict colours
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["tiny", "small", "body"] }],
      rounded: [{ rounded: ["card", "field"] }],
      shadow: [{ shadow: ["card", "raised", "dialog", "proceed"] }],
    },
  },
})

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

/** ₹2.85L / ₹48K / ₹1.2Cr: for compact spots; tables keep full amounts. */
export function formatINRCompact(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return "₹0"
  const abs = Math.abs(n)
  const trim = (v) => String(Number(v.toFixed(v >= 10 ? 1 : 2)))
  if (abs >= 1e7) return `₹${trim(n / 1e7)}Cr`
  if (abs >= 1e5) return `₹${trim(n / 1e5)}L`
  if (abs >= 1e3) return `₹${trim(n / 1e3)}K`
  return formatCurrencyINR(n)
}

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  const first = parts[0][0] || ""
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ""
  return (first + last).toUpperCase()
}

export function greeting(date = new Date()) {
  const h = date.getHours()
  if (h < 12) return "Good morning"
  if (h < 17) return "Good afternoon"
  return "Good evening"
}

/** "just now", "12 min ago", "3 h ago", "yesterday", else a short date. */
export function formatRelative(isoString, now = Date.now()) {
  if (!isoString) return "—"
  const t = new Date(isoString).getTime()
  if (Number.isNaN(t)) return "—"
  const diffMin = Math.round((now - t) / 60000)
  if (Math.abs(diffMin) < 1) return "just now"
  if (diffMin > 0 && diffMin < 60) return `${diffMin} min ago`
  if (diffMin > 0 && diffMin < 60 * 24) return `${Math.round(diffMin / 60)} h ago`
  if (diffMin > 0 && diffMin < 60 * 48) return "yesterday"
  return new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}

export function formatTime(isoString) {
  if (!isoString) return "—"
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
}

const ACRONYMS = { icu: "ICU", ot: "OT", irdai: "IRDAI", uhid: "UHID", ppe: "PPE", ai: "AI", sla: "SLA", tpa: "TPA" }

/** snake_case → "Sentence case", keeping acronyms such as ICU and IRDAI */
export function humanize(value) {
  const s = String(value || "")
    .replaceAll("_", " ")
    .trim()
    .replace(/\b[a-z]+\b/gi, (w) => ACRONYMS[w.toLowerCase()] || w)
  return s ? s[0].toUpperCase() + s.slice(1) : ""
}

export function formatFileSize(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return null
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
