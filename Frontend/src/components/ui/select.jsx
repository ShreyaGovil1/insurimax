import * as React from "react"
import { cn } from "../../lib/utils"
import { fieldBase } from "./styles"

// Native select keeps keyboard and screen-reader behaviour; only the chrome is ours.
const Select = React.forwardRef(({ className, children, ...props }, ref) => {
  return (
    <select
      className={cn(fieldBase, "select-chevron flex h-10 cursor-pointer appearance-none pl-3 pr-9", className)}
      ref={ref}
      {...props}
    >
      {children}
    </select>
  )
})
Select.displayName = "Select"

export { Select }
