"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * DRVO Button.
 *  - default  → Teal primary action (ONE per screen/context, ADR-025 §3)
 *  - brand    → Plum, for identity/navigation emphasis (rare)
 *  - danger   → solid destructive for irreversible actions (pair with a reason dialog)
 *  - destructive → soft destructive for secondary destructive actions
 * Sizes follow the density tokens: sm 32 · default 36 · lg 40 · xl 48 (touch/POS).
 * `loading` disables the button and sets aria-busy — use it on every
 * submit that writes data so rapid clicks cannot double-submit.
 */
const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover active:bg-primary-active",
        brand:
          "bg-brand text-brand-foreground shadow-xs hover:bg-brand-deep",
        outline:
          "border-border bg-card text-foreground hover:bg-muted aria-expanded:bg-muted",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary-hover aria-expanded:bg-secondary-hover",
        ghost:
          "text-foreground hover:bg-muted aria-expanded:bg-muted",
        danger:
          "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/30",
        destructive:
          "bg-destructive-soft text-destructive hover:bg-destructive/15 focus-visible:ring-destructive/25",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pe-2.5 has-data-[icon=inline-start]:ps-2.5",
        xs: "h-6 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 rounded-md px-2.5 text-[0.8125rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-4",
        xl: "h-12 gap-2 rounded-xl px-5 text-base",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-md",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /** Shows a spinner, disables the button and marks it aria-busy. */
    loading?: boolean
  }

function Button({
  className,
  variant = "default",
  size = "default",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
export type { ButtonProps }
