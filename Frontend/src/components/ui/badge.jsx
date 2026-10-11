import { cva } from "class-variance-authority"
import { cn } from "../../lib/utils"

const neutral = "bg-sunken text-ink-2"
const peacock = "bg-peacock-50 text-peacock-700 ring-1 ring-inset ring-peacock-100"
const leaf = "bg-leaf-50 text-leaf-700 ring-1 ring-inset ring-leaf-100"
const sand = "bg-sand-50 text-sand-700 ring-1 ring-inset ring-sand-200"
const vermilion = "bg-vermilion-50 text-vermilion-700 ring-1 ring-inset ring-vermilion-100"
const dark = "bg-peacock-800 text-white"

const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-tiny font-semibold leading-4 [&_svg]:h-3 [&_svg]:w-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        neutral,
        peacock,
        leaf,
        sand,
        vermilion,
        dark,
        flag: "bg-marigold-400 text-ink",
        outline: "text-ink-2 ring-1 ring-inset ring-line-strong",
        // Aliases kept for older call sites
        default: dark,
        secondary: neutral,
        destructive: vermilion,
        success: leaf,
        warning: sand,
        info: peacock,
        purple: peacock,
        lime: leaf,
        obsidian: dark,
        violet: peacock,
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
)

function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

// eslint-disable-next-line react-refresh/only-export-components
export { Badge, badgeVariants }
