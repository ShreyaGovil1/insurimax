import * as React from "react"
import { cva } from "class-variance-authority"
import { cn } from "../../lib/utils"

const alertVariants = cva(
  "relative flex w-full gap-3 rounded-xl p-4 text-sm [&>svg]:mt-0.5 [&>svg]:h-[18px] [&>svg]:w-[18px] [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-surface text-ink shadow-card [&>svg]:text-ink-3",
        info: "bg-peacock-50 text-peacock-900 [&>svg]:text-peacock-600",
        success: "bg-leaf-50 text-leaf-800 [&>svg]:text-leaf-600",
        warning: "bg-sand-50 text-sand-800 ring-1 ring-inset ring-sand-200 [&>svg]:text-sand-600",
        destructive: "bg-vermilion-50 text-vermilion-800 ring-1 ring-inset ring-vermilion-200 [&>svg]:text-vermilion-600",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
))
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h5 ref={ref} className={cn("font-semibold leading-snug", className)} {...props} />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("text-small leading-relaxed opacity-90", className)} {...props} />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
