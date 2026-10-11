import { cn } from "../../lib/utils"
import { claimStatusMeta, decisionStatusMeta } from "../../lib/status"

const TONES = {
  draft: "bg-surface text-ink-3 border border-dashed border-line-strong",
  neutral: "bg-sunken text-ink-2",
  peacock: "bg-peacock-50 text-peacock-700 ring-1 ring-inset ring-peacock-100",
  sand: "bg-sand-50 text-sand-700 ring-1 ring-inset ring-sand-200",
  leaf: "bg-leaf-50 text-leaf-700 ring-1 ring-inset ring-leaf-100",
  vermilion: "bg-vermilion-50 text-vermilion-700 ring-1 ring-inset ring-vermilion-100",
  final: "bg-peacock-700 text-white",
  flag: "bg-marigold-400 text-ink",
}

function Pill({ tone, icon: Icon, label, className }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-tiny font-semibold",
        TONES[tone] || TONES.neutral,
        className
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      {label}
    </span>
  )
}

export function ClaimStatusPill({ status, className, label }) {
  const meta = claimStatusMeta(status)
  return <Pill tone={meta.tone} icon={meta.icon} label={label || meta.label} className={className} />
}

export function DecisionPill({ status, className }) {
  const meta = decisionStatusMeta(status)
  return <Pill tone={meta.tone} icon={meta.icon} label={meta.label} className={className} />
}

export function TonePill({ tone = "neutral", icon, children, className }) {
  return <Pill tone={tone} icon={icon} label={children} className={className} />
}
