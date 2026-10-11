import * as React from "react"
import { cva } from "class-variance-authority"
import { Loader2 } from "lucide-react"
import { cn } from "../../lib/utils"

const primary =
  "bg-peacock-600 text-white shadow-[0_1px_0_0_rgb(255_255_255/0.14)_inset,0_1px_2px_rgb(6_41_43/0.3)] hover:bg-peacock-700"
const secondary = "bg-surface text-ink ring-1 ring-inset ring-line-strong hover:bg-ground hover:ring-ink-4/60"
const danger = "bg-vermilion-600 text-white shadow-[0_1px_2px_rgb(126_30_23/0.3)] hover:bg-vermilion-700"
const proceed = "bg-marigold-400 text-ink shadow-proceed hover:bg-marigold-300"

const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold select-none cursor-pointer transition-[background-color,color,box-shadow,transform,opacity] duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-peacock-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary,
        proceed,
        secondary,
        danger,
        ghost: "text-ink-2 hover:bg-sunken hover:text-ink",
        "danger-soft": "bg-surface text-vermilion-700 ring-1 ring-inset ring-vermilion-200 hover:bg-vermilion-50",
        success: "bg-leaf-600 text-white shadow-[0_1px_2px_rgb(22_79_46/0.3)] hover:bg-leaf-700",
        "on-dark": "bg-white/10 text-white ring-1 ring-inset ring-white/15 hover:bg-white/15",
        link: "h-auto px-0 text-peacock-600 underline-offset-4 hover:underline active:scale-100",
        // Aliases kept for older call sites
        default: primary,
        outline: secondary,
        destructive: danger,
        warning: proceed,
      },
      size: {
        sm: "h-8 rounded-lg px-3 text-small",
        md: "h-10 rounded-field px-4 text-sm",
        default: "h-10 rounded-field px-4 text-sm",
        lg: "h-12 rounded-xl px-5 text-body",
        icon: "h-9 w-9 rounded-field",
        "icon-sm": "h-8 w-8 rounded-lg",
      },
    },
    compoundVariants: [{ variant: "link", className: "h-auto px-0" }],
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
)

const Button = React.forwardRef(
  // eslint-disable-next-line no-unused-vars
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {children}
      </button>
    )
  }
)
Button.displayName = "Button"

// eslint-disable-next-line react-refresh/only-export-components
export { Button, buttonVariants }
