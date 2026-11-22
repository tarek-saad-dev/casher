"use client"

import * as React from "react"
import { Check, Minus } from "lucide-react"

import { cn } from "@/lib/utils"

type CheckedState = boolean | "indeterminate"

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'checked'> {
  checked?: CheckedState
  onCheckedChange?: (checked: CheckedState) => void
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, onCheckedChange, ...props }, ref) => {
    const inputRef = React.useRef<HTMLInputElement>(null)

    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement)

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const isChecked = event.target.checked
      onCheckedChange?.(isChecked)
      props.onChange?.(event)
    }

    // Determine display state
    const isChecked = checked === true
    const isIndeterminate = checked === "indeterminate"

    return (
      <label
        className={cn(
          "peer relative flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border border-input bg-card transition-colors",
          "hover:border-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:cursor-not-allowed disabled:opacity-50",
          isChecked && "border-primary bg-primary",
          isIndeterminate && "border-primary bg-primary",
          className
        )}
      >
        <input
          type="checkbox"
          ref={inputRef}
          checked={isChecked}
          onChange={handleChange}
          className="sr-only"
          {...props}
        />
        {isChecked && (
          <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />
        )}
        {isIndeterminate && (
          <Minus className="h-3 w-3 text-primary-foreground" strokeWidth={3} />
        )}
      </label>
    )
  }
)
Checkbox.displayName = "Checkbox"

export { Checkbox }
export type { CheckboxProps }
