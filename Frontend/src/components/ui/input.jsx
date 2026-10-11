import * as React from "react"
import { cn } from "../../lib/utils"
import { fieldBase } from "./styles"

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        fieldBase,
        "flex h-10 px-3 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-sunken file:px-2.5 file:py-1 file:text-small file:font-semibold file:text-ink-2",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Input.displayName = "Input"

export { Input }
