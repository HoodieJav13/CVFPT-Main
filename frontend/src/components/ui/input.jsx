import * as React from "react"
import { cva } from "class-variance-authority"

import { cn } from "@/lib/utils"

const inputVariants = cva(
  "flex w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
  {
    variants: {
      size: {
        default: "h-9",
        touch: "h-11",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

const Input = React.forwardRef(({ className, type, size, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(inputVariants({ size }), className)}
      ref={ref}
      {...props} />
  );
})
Input.displayName = "Input"

export { Input, inputVariants }
