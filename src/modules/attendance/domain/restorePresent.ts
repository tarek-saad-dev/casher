/**
 * Ops restore-present — current production semantics (Phase B5).
 * Dedicated command. No OPEN guard. DUAL_OPEN possible.
 * Cross-branch tagged schedule-control day_off Absent patch preserved.
 * Runtime Behavior Changes: NONE
 */

export const RESTORE_PRESENT_SOURCE = 'schedule-control restore-present';

export const RESTORE_PRESENT_DAY_OFF_SOURCE = 'schedule-control day_off';

export const RESTORE_PRESENT_PAST_DATE_MESSAGE =
  'تشغيل يوم الإجازة متاح لليوم أو تاريخ مستقبلي فقط';

export const RESTORE_PRESENT_INACTIVE_BRANCH_MESSAGE = 'الفرع غير نشط';

export const RESTORE_PRESENT_FAILURE_MESSAGE =
  'فشل إلغاء الغياب وتشغيل اليوم';

export type RestorePresentInput = {
  empId: number;
  date: string;
  branchId: number;
  reason?: string | null;
  /** Cairo business date (YYYY-MM-DD) — same as route's getCairoBusinessDate(). */
  todayBusiness: string;
  /** Calendar Cairo date (YYYY-MM-DD) — same as route's cairoDateStr(new Date()). */
  todayCalendar: string;
};

export type RestorePresentBarberStatus = {
  empId: number;
  isWorkingDay: boolean;
  isDayOff: boolean;
  isAbsent: boolean;
  statusReasonArabic: string;
  currentAvailabilityStatus: string;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  attendance: unknown;
};

export type RestorePresentResult = {
  ok: true;
  message: string;
  checkInTime: string | null;
  attendanceRecorded: boolean;
  branchId: number;
  dayOffOverridesCleared: number;
  dayOffRowsCleared: number;
  customHours: { start: string; end: string };
  barberStatus: RestorePresentBarberStatus;
};
