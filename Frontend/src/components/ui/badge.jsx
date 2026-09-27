import * as React from "react"
import { cva } from "class-variance-authority"
import { cn } from "../../lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-slate-900 text-white shadow-sm hover:bg-slate-800",
        secondary:
          "border-transparent bg-slate-100 text-slate-700 hover:bg-slate-200",
        destructive:
          "border-transparent bg-red-100 text-red-700 border-red-200",
        outline: "text-slate-800 border-slate-300",
        success:
          "border-transparent bg-emerald-100 text-emerald-800 border-emerald-200",
        warning:
          "border-transparent bg-amber-100 text-amber-800 border-amber-200",
        info:
          "border-transparent bg-blue-100 text-blue-800 border-blue-200",
        purple:
          "border-transparent bg-purple-100 text-purple-800 border-purple-200",
        lime:
          "border-transparent bg-[#A3FF12] text-slate-950 font-bold shadow-xs",
        obsidian:
          "border-transparent bg-[#111111] text-white shadow-xs",
        violet:
          "border-transparent bg-[#8B5CF6]/15 text-[#7C3AED] border-[#8B5CF6]/30",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({ className, variant, ...props }) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
