/**
 * Phase 3B — Pure UI label / status helpers for workforce availability.
 * No DB. Safe for client + tests.
 */

import type { AvailabilityReasonCode } from '@/lib/availability/reasonCodes';
import type { DailyAdjustmentType } from '@/lib/availability/dailyAdjustments';
import type { AvailabilityExplainResult } from '@/lib/availability/explainAvailability';

export type WorkforceUiStatusKey =
  | 'available'
  | 'unavailable'
  | 'day_off'
  | 'absent'
  | 'day_closed'
  | 'no_schedule'
  | 'partially_available'
  | 'outside_hours'
  | 'scheduled_elsewhere';

export const WORKFORCE_UI_STATUS_AR: Record<WorkforceUiStatusKey, string> = {
  available: 'متاح',
  unavailable: 'غير متاح',
  day_off: 'إجازة',
  absent: 'غائب',
  day_closed: 'اليوم مغلق',
  no_schedule: 'بدون جدول',
  partially_available: 'متاح جزئيًا',
  outside_hours: 'خارج ساعات العمل',
  scheduled_elsewhere: 'على فرع آخر',
};

export const BASE_SCHEDULE_SOURCE_AR: Record<string, string> = {
  BRANCH_WEEKLY: 'جدول أسبوعي للفرع',
  TEMPORARY_TRANSFER: 'نقل مؤقت',
  LEGACY_WEEKLY: 'جدول أسبوعي قديم',
  FREELANCE_UNLOCK: 'فتح عمل استثنائي',
  NONE: 'لا يوجد جدول',
};

export const AVAILABILITY_LAYER_TITLE_AR: Record<string, string> = {
  EMPLOYMENT: 'بيانات الموظف ونوع التوظيف',
  BASE_SCHEDULE: 'الجدول الأساسي للفرع',
  TRANSFER_OR_FREELANCE: 'النقل وفتح العمل الاستثنائي',
  LEGACY_OVERRIDES: 'التعديلات القديمة',
  ATTENDANCE: 'الحضور الفعلي',
  DAILY_ADJUSTMENTS: 'التعديلات اليومية',
  FINAL_RESULT: 'النتيجة النهائية',
};

export const DAILY_ADJUSTMENT_TYPE_AR: Record<DailyAdjustmentType, string> = {
  CLOSE_DAY: 'إغلاق اليوم',
  REPLACE_WINDOWS: 'استبدال المواعيد',
  ADD_WINDOW: 'إضافة فترة عمل',
  BLOCK_WINDOW: 'حظر فترة',
};

export const DAILY_ADJUSTMENT_STATE_AR: Record<string, string> = {
  NONE: 'بدون تعديلات',
  CLOSED: 'مغلق',
  REPLACED: 'مستبدل',
  EXTENDED: 'مُمدَّد',
  BLOCKED: 'محظور جزئيًا',
  MIXED: 'تعديلات متعددة',
};

export const EXPLAIN_TIMELINE_STEP_AR: Record<string, string> = {
  BASE_BRANCH_WEEKLY_SELECTED: 'اختيار الجدول الأساسي',
  LEGACY_OVERRIDE_APPLIED: 'تطبيق تجاوز قديم',
  DAILY_CLOSE_APPLIED: 'تطبيق إغلاق يومي',
  DAILY_REPLACE_APPLIED: 'تطبيق استبدال المواعيد',
  DAILY_WINDOW_ADDED: 'إضافة فترة عمل',
  DAILY_BLOCK_APPLIED: 'تطبيق حظر فترة',
  ATTENDANCE_ABSENT_DENIED: 'رفض بسبب الغياب',
  FINAL_WINDOWS_NORMALIZED: 'تطبيع النوافذ النهائية',
  deny: 'سبب الرفض',
  result: 'النتيجة',
  warning: 'تحذير',
};

export const AVAILABILITY_REASON_AR: Partial<Record<AvailabilityReasonCode, string>> = {
  EMPLOYEE_ABSENT: 'الموظف غائب',
  EMPLOYEE_OFF_DAY: 'الموظف في إجازة',
  SCHEDULE_NOT_CONFIGURED: 'لا يوجد جدول عمل',
  FREELANCER_NOT_PLANNED: 'المستقل لم يسجّل حضوره بعد',
  FREELANCER_HOURS_NOT_CONFIGURED: 'ساعات المستقل غير مضبوطة في الملف',
  DAY_CLOSED_BY_ADJUSTMENT: 'اليوم مغلق بتعديل يومي',
  NO_USABLE_WINDOW_AFTER_ADJUSTMENTS: 'لا توجد نوافذ صالحة بعد التعديلات',
  BLOCKED_BY_DAILY_ADJUSTMENT: 'محظور بتعديل يومي',
  BLOCKED_BY_OVERRIDE: 'محظور بتجاوز جدول',
  OUTSIDE_WORKING_WINDOW: 'خارج ساعات العمل',
  OUTSIDE_BRANCH_HOURS: 'خارج ساعات تشغيل الفرع',
  EMPLOYEE_INACTIVE: 'الموظف غير نشط',
  NOT_ASSIGNED_TO_BRANCH: 'غير معيَّن على الفرع',
  NO_EMPLOYEE_AVAILABLE: 'لا يوجد موظف متاح',
  HOLD_CONFLICT: 'الفترة محجوزة مؤقتًا لعميل آخر',
  TRAVEL_BUFFER: 'فترة انتقال بين الفروع',
  BOOKING_CONFLICT: 'تعارض مع حجز قائم',
  QUEUE_CONFLICT: 'تعارض مع تذكرة طابور',
  NO_CONTIGUOUS_WINDOW: 'لا توجد فترة متصلة كافية',
  MIN_NOTICE_NOT_MET: 'أقل من الحد الأدنى للإشعار',
  MAX_ADVANCE_EXCEEDED: 'تجاوز أفق الحجز المسموح',
  BRANCH_CLOSED: 'الفرع مغلق',
  BOOKING_TEMPORARILY_DISABLED: 'الحجز متوقف مؤقتًا لهذا الفرع',
  AT_RISK: 'الحجز يحتاج إجراء',
  SLOT_UNAVAILABLE: 'الموعد غير متاح',
  SERVICE_NOT_SUPPORTED: 'الخدمة غير متاحة لهذا الموظف',
  BLOCKED_BY_BREAK: 'محظور بفترة راحة',
};

export const EXPLAIN_RESULT_AR: Record<AvailabilityExplainResult, string> = {
  available: 'متاح',
  blocked: 'محظور جزئيًا',
  outside_shift: 'خارج ساعات العمل',
  day_off: 'إجازة',
  absent: 'غائب',
  not_configured: 'بدون جدول',
  freelancer_not_planned: 'مستقل غير مجدول',
  inactive_or_unassigned: 'غير نشط / غير معيَّن',
  closed_by_adjustment: 'اليوم مغلق',
  no_usable_window: 'لا توجد نافذة صالحة',
};

export type WorkforceDayPlanLike = {
  isWorking: boolean;
  denyReasonCode: string | null;
  blockedIntervals?: Array<unknown>;
  dailyAdjustmentState?: string;
};

/** Derive UI badge from canonical day-plan fields only — no independent schedule math. */
export function inferWorkforceUiStatus(plan: WorkforceDayPlanLike): {
  key: WorkforceUiStatusKey;
  labelAr: string;
} {
  const code = plan.denyReasonCode;
  if (code === 'EMPLOYEE_ABSENT') {
    return { key: 'absent', labelAr: WORKFORCE_UI_STATUS_AR.absent };
  }
  if (code === 'DAY_CLOSED_BY_ADJUSTMENT') {
    return { key: 'day_closed', labelAr: WORKFORCE_UI_STATUS_AR.day_closed };
  }
  if (code === 'EMPLOYEE_OFF_DAY') {
    return { key: 'day_off', labelAr: WORKFORCE_UI_STATUS_AR.day_off };
  }
  if (code === 'SCHEDULE_NOT_CONFIGURED' || code === 'FREELANCER_NOT_PLANNED') {
    return { key: 'no_schedule', labelAr: WORKFORCE_UI_STATUS_AR.no_schedule };
  }
  if (code === 'OUTSIDE_WORKING_WINDOW') {
    return { key: 'outside_hours', labelAr: WORKFORCE_UI_STATUS_AR.outside_hours };
  }
  if (plan.isWorking) {
    const blocked = plan.blockedIntervals?.length ?? 0;
    if (blocked > 0) {
      return {
        key: 'partially_available',
        labelAr: WORKFORCE_UI_STATUS_AR.partially_available,
      };
    }
    return { key: 'available', labelAr: WORKFORCE_UI_STATUS_AR.available };
  }
  return { key: 'unavailable', labelAr: WORKFORCE_UI_STATUS_AR.unavailable };
}

export function reasonCodeLabelAr(code: string | null | undefined): string | null {
  if (!code) return null;
  return AVAILABILITY_REASON_AR[code as AvailabilityReasonCode] ?? code;
}

/** Format HH:mm for Arabic display (24h kept for ops clarity). */
export function formatHhmmPreview(start: string, end: string, endDayOffset: 0 | 1): string {
  const overnight = endDayOffset === 1 ? ' اليوم التالي' : '';
  return `${start} ← ${end}${overnight}`;
}

export function windowsOverlap(
  a: { start: string; end: string; endDayOffset: 0 | 1 },
  b: { start: string; end: string; endDayOffset: 0 | 1 },
): boolean {
  const toMin = (hhmm: string, day: number) => {
    const [h, m] = hhmm.split(':').map(Number);
    return day * 24 * 60 + (h || 0) * 60 + (m || 0);
  };
  const a0 = toMin(a.start, 0);
  const a1 = toMin(a.end, a.endDayOffset);
  const b0 = toMin(b.start, 0);
  const b1 = toMin(b.end, b.endDayOffset);
  return a0 < b1 && b0 < a1;
}
