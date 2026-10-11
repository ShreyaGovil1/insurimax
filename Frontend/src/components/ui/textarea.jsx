import * as React from "react"
import { cn } from "../../lib/utils"
import { fieldBase } from "./styles"

const Textarea = React.forwardRef(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(fieldBase, "flex min-h-[84px] px-3 py-2.5 leading-relaxed", className)}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
