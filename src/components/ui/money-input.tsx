"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Money amount field (DRVO UI kit). Accepts Arabic-Indic (٠-٩) and Eastern
 * Arabic-Persian digits, the Arabic decimal mark (٫) and thousands marks, and
 * reports a plain number (or null when empty). Always LTR with tabular
 * figures so amounts line up; the currency label sits on the reading end.
 */
const DIGIT_MAP: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
}

/** Normalize user input to a canonical "1234.5" string (no thousands marks). */
export function normalizeMoneyText(raw: string, maxDecimals = 2): string {
  let s = ""
  for (const ch of raw) s += DIGIT_MAP[ch] ?? ch
  s = s.replace(/[٬,\s]/g, "").replace(/٫/g, ".")
  s = s.replace(/[^0-9.]/g, "")
  const firstDot = s.indexOf(".")
  if (firstDot !== -1) {
    const intPart = s.slice(0, firstDot)
    const frac = s.slice(firstDot + 1).replace(/\./g, "").slice(0, maxDecimals)
    s = maxDecimals > 0 ? `${intPart}.${frac}` : intPart
  }
  return s
}

export function parseMoney(text: string): number | null {
  if (text === "" || text === ".") return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

export interface MoneyInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "type" | "defaultValue"> {
  value: number | null
  onValueChange: (value: number | null) => void
  currency?: string
  maxDecimals?: number
  invalid?: boolean
}

const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onValueChange, currency = "ج.م", maxDecimals = 2, invalid, className, onBlur, ...props }, ref) => {
    const [text, setText] = React.useState(value == null ? "" : String(value))

    // Follow outside changes (form reset, totals) without fighting the user's typing.
    React.useEffect(() => {
      setText((current) => (parseMoney(current) === value ? current : value == null ? "" : String(value)))
    }, [value])

    return (
      <div
        className={cn(
          "flex h-9 w-full items-center rounded-md border border-input bg-background text-sm focus-within:ring-2 focus-within:ring-ring",
          invalid && "border-destructive focus-within:ring-destructive/40",
          props.disabled && "cursor-not-allowed opacity-50",
          className,
        )}
        dir="ltr"
      >
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={invalid || undefined}
          className="num h-full min-w-0 flex-1 bg-transparent px-3 text-start tabular-nums outline-none placeholder:text-muted-foreground"
          value={text}
          onChange={(e) => {
            const next = normalizeMoneyText(e.target.value, maxDecimals)
            setText(next)
            onValueChange(parseMoney(next))
          }}
          onBlur={(e) => {
            if (text.endsWith(".")) setText(text.slice(0, -1))
            onBlur?.(e)
          }}
          {...props}
        />
        {currency ? (
          <span className="select-none border-s border-border px-2.5 text-xs text-muted-foreground" dir="rtl">
            {currency}
          </span>
        ) : null}
      </div>
    )
  },
)
MoneyInput.displayName = "MoneyInput"

export { MoneyInput }
