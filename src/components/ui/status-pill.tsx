import type { LucideIcon } from "lucide-react"
import {
  Ban,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Clock,
  CloudOff,
  FileText,
  Lock,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  Wallet,
  XCircle,
} from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * StatusPill — the ONLY way to show a record/financial/sync state.
 * Always renders an icon + text label (never colour alone, ADR-024/025).
 * Use the status that matches SERVER truth: never show `paid`, `posted`,
 * `synced` or `verified` for something that is only locally queued or pending.
 */
export type StatusTone = "neutral" | "brand" | "info" | "success" | "warning" | "danger"

export type StatusKey =
  | "draft"
  | "pending"
  | "pending_approval"
  | "pending_verification"
  | "not_collected"
  | "posted"
  | "paid"
  | "verified"
  | "synced"
  | "offline_queued"
  | "reversed"
  | "refunded"
  | "cancelled"
  | "failed"
  | "locked"
  | "active"
  | "inactive"

const STATUS: Record<StatusKey, { label: string; tone: StatusTone; icon: LucideIcon }> = {
  draft: { label: "مسودة", tone: "neutral", icon: FileText },
  pending: { label: "قيد الانتظار", tone: "warning", icon: Clock },
  pending_approval: { label: "بانتظار الموافقة", tone: "warning", icon: Clock },
  pending_verification: { label: "بانتظار التحقق", tone: "warning", icon: CircleDashed },
  not_collected: { label: "غير محصّل", tone: "warning", icon: Wallet },
  posted: { label: "مُرحّل", tone: "success", icon: CheckCircle2 },
  paid: { label: "مدفوع", tone: "success", icon: CheckCircle2 },
  verified: { label: "تم التحقق", tone: "success", icon: ShieldCheck },
  synced: { label: "تمت المزامنة", tone: "success", icon: CheckCircle2 },
  offline_queued: { label: "محفوظ محلياً — لم يُرسل", tone: "warning", icon: CloudOff },
  reversed: { label: "معكوس", tone: "info", icon: RotateCcw },
  refunded: { label: "مُسترد", tone: "info", icon: RotateCcw },
  cancelled: { label: "ملغي", tone: "neutral", icon: Ban },
  failed: { label: "فشل", tone: "danger", icon: XCircle },
  locked: { label: "مقفول", tone: "neutral", icon: Lock },
  active: { label: "نشط", tone: "success", icon: CircleDot },
  inactive: { label: "غير نشط", tone: "neutral", icon: CircleDot },
}

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  brand: "bg-brand-soft text-brand border-brand/20",
  info: "bg-info-soft text-info border-info/20",
  success: "bg-success-soft text-success border-success/20",
  warning: "bg-warning-soft text-warning border-warning/25",
  danger: "bg-destructive-soft text-destructive border-destructive/20",
}

interface StatusPillProps {
  status?: StatusKey
  /** Custom label / tone / icon when no predefined status fits. */
  label?: string
  tone?: StatusTone
  icon?: LucideIcon
  size?: "sm" | "md"
  className?: string
}

function StatusPill({ status, label, tone, icon, size = "sm", className }: StatusPillProps) {
  const preset = status ? STATUS[status] : undefined
  const resolvedTone = tone ?? preset?.tone ?? "neutral"
  const Icon = icon ?? preset?.icon ?? (resolvedTone === "danger" ? TriangleAlert : CircleDot)
  const text = label ?? preset?.label ?? ""

  return (
    <span
      data-slot="status-pill"
      data-tone={resolvedTone}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-full border font-semibold whitespace-nowrap",
        size === "sm" ? "h-6 px-2 text-[0.75rem]" : "h-7 px-2.5 text-xs",
        TONE_CLASS[resolvedTone],
        className
      )}
    >
      <Icon className={size === "sm" ? "size-3.5" : "size-4"} aria-hidden />
      {text}
    </span>
  )
}

export { StatusPill, STATUS as STATUS_PRESETS }
