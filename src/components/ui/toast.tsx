"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { CheckCircle2, Info, TriangleAlert, XCircle, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * One toast system for the whole app (DRVO UI kit). Replaces the per-page
 * `addToast` copies over time. Messages are announced to screen readers;
 * errors stay until dismissed or a longer timeout, so cashiers can read them.
 *
 *   const { toast } = useToast()
 *   toast({ tone: 'success', title: 'تم حفظ الفاتورة' })
 */
export type ToastTone = "success" | "error" | "warning" | "info"

export interface ToastOptions {
  title: string
  description?: string
  tone?: ToastTone
  /** Milliseconds; defaults to 4s (8s for errors). 0 keeps it until closed. */
  duration?: number
}

interface ToastItem extends Required<Pick<ToastOptions, "title" | "tone">> {
  id: number
  description?: string
}

interface ToastApi {
  toast: (options: ToastOptions) => number
  dismiss: (id: number) => void
}

const noop: ToastApi = { toast: () => 0, dismiss: () => {} }
const ToastContext = React.createContext<ToastApi>(noop)

const TONE_STYLE: Record<ToastTone, { box: string; icon: React.ReactNode }> = {
  success: { box: "border-success/30", icon: <CheckCircle2 className="size-5 text-success" aria-hidden /> },
  error: { box: "border-destructive/40", icon: <XCircle className="size-5 text-destructive" aria-hidden /> },
  warning: { box: "border-warning/40", icon: <TriangleAlert className="size-5 text-warning" aria-hidden /> },
  info: { box: "border-info/30", icon: <Info className="size-5 text-info" aria-hidden /> },
}

const MAX_VISIBLE = 4

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([])
  const nextId = React.useRef(1)
  const timers = React.useRef(new Map<number, number>())

  const dismiss = React.useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) window.clearTimeout(timer)
    timers.current.delete(id)
  }, [])

  const toast = React.useCallback(
    ({ title, description, tone = "info", duration }: ToastOptions) => {
      const id = nextId.current++
      setItems((prev) => [...prev, { id, title, description, tone }].slice(-MAX_VISIBLE))
      const ms = duration ?? (tone === "error" ? 8000 : 4000)
      if (ms > 0) timers.current.set(id, window.setTimeout(() => dismiss(id), ms))
      return id
    },
    [dismiss],
  )

  React.useEffect(() => {
    const map = timers.current
    return () => map.forEach((t) => window.clearTimeout(t))
  }, [])

  const api = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  // Portalled to <body> so dialogs, drawers and transformed parents never hide it.
  const region = (
      <div
        aria-live="polite"
        role="status"
        dir="rtl"
        className="pointer-events-none fixed bottom-4 start-4 z-[13000] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-xl border bg-card p-3 text-sm text-foreground shadow-lg",
              TONE_STYLE[t.tone].box,
            )}
          >
            {TONE_STYLE[t.tone].icon}
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{t.title}</p>
              {t.description ? <p className="mt-0.5 text-muted-foreground">{t.description}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="rounded-md p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
            >
              <XIcon className="size-4" aria-hidden />
              <span className="sr-only">إغلاق</span>
            </button>
          </div>
        ))}
      </div>
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      {mounted ? createPortal(region, document.body) : null}
    </ToastContext.Provider>
  )
}

/** Safe outside the provider (no-op), so shared components can always call it. */
export function useToast(): ToastApi {
  return React.useContext(ToastContext)
}
