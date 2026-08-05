/**
 * Empty-slots / deny UX helpers — Phase L.
 */
import type { AvailabilityReasonCode } from '@/lib/availability/reasonCodes';
import { reasonCodeLabelAr } from '@/lib/availability/workforceUiLabels';

const RECOVERY_AR: Partial<Record<AvailabilityReasonCode, string>> = {
  EMPLOYEE_ABSENT: 'اختر موظفًا آخر أو يومًا لاحقًا',
  EMPLOYEE_OFF_DAY: 'اختر يوم عمل أو موظفًا آخر',
  FREELANCER_NOT_PLANNED: 'انتظر تسجيل حضور المستقل أو اختر موظفًا آخر',
  FREELANCER_HOURS_NOT_CONFIGURED: 'راجع إعداد ساعات المستقل مع الإدارة',
  SCHEDULE_NOT_CONFIGURED: 'تواصل مع الإدارة لضبط الجدول',
  HOLD_CONFLICT: 'أعد المحاولة بعد دقائق أو اختر موعدًا آخر',
  BOOKING_CONFLICT: 'اختر أقرب وقت متاح أو موظفًا آخر',
  QUEUE_CONFLICT: 'اختر وقتًا لاحقًا',
  NO_CONTIGUOUS_WINDOW: 'اختر خدمة أقصر أو نافذة عمل أخرى',
  OUTSIDE_WORKING_WINDOW: 'اختر وقتًا ضمن ساعات العمل',
  OUTSIDE_BRANCH_HOURS: 'اختر وقتًا ضمن ساعات الفرع',
  BRANCH_CLOSED: 'اختر يومًا آخر أو فرعًا آخر',
  TRAVEL_BUFFER: 'اختر وقتًا خارج فترة انتقال الموظف',
  MIN_NOTICE_NOT_MET: 'اختر وقتًا لاحقًا',
  MAX_ADVANCE_EXCEEDED: 'اختر يومًا أقرب',
  BOOKING_TEMPORARILY_DISABLED: 'الحجز غير متاح حاليًا — حاول لاحقًا',
  NO_EMPLOYEE_AVAILABLE: 'جرّب يومًا أو فرعًا آخر',
  SLOT_UNAVAILABLE: 'أعد تحميل المواعيد واختر وقتًا آخر',
};

export type EmptySlotsUx = {
  reasonCode: string;
  messageAr: string;
  recoverySuggestionAr: string;
};

export function buildEmptySlotsUx(reasonCode: string | null | undefined): EmptySlotsUx {
  const code = (reasonCode || 'SLOT_UNAVAILABLE') as AvailabilityReasonCode;
  const messageAr =
    reasonCodeLabelAr(code) ?? 'لا توجد مواعيد متاحة';
  const recoverySuggestionAr =
    RECOVERY_AR[code] ?? 'اختر موظفًا آخر أو يومًا مختلفًا';
  return { reasonCode: code, messageAr, recoverySuggestionAr };
}
