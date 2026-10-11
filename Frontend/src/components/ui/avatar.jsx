import { cn, initials } from "../../lib/utils"

const TINTS = [
  "bg-peacock-100 text-peacock-800",
  "bg-marigold-100 text-marigold-800",
  "bg-leaf-100 text-leaf-800",
  "bg-sand-100 text-sand-800",
  "bg-vermilion-100 text-vermilion-800",
  "bg-sunken text-ink-2",
]

const tintFor = (name) => {
  let h = 0
  for (const ch of String(name || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TINTS[h % TINTS.length]
}

const SIZES = {
  sm: "h-7 w-7 rounded-lg text-tiny",
  md: "h-9 w-9 rounded-[10px] text-small",
  lg: "h-12 w-12 rounded-xl text-body",
}

export function Avatar({ name, size = "md", className }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0 select-none items-center justify-center font-semibold", SIZES[size], tintFor(name), className)}
    >
      {initials(name)}
    </span>
  )
}
