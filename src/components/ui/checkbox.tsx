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
          "peer relative flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border border-zinc-600 transition-colors",
          "hover:border-zinc-500",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900",
          "disabled:cursor-not-allowed disabled:opacity-50",
          isChecked && "border-amber-500 bg-amber-500",
          isIndeterminate && "border-amber-500 bg-amber-500",
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
          <Check className="h-3 w-3 text-black" strokeWidth={3} />
        )}
        {isIndeterminate && (
          <Minus className="h-3 w-3 text-black" strokeWidth={3} />
        )}
      </label>
    )
  }
)
Checkbox.displayName = "Checkbox"

export { Checkbox }
export type { CheckboxProps }
