/**
 * Normalize attendance Status values from admin (Absent/DayOff) and
 * employee AttendanceTab (absent/off/present/late) into a comparable token.
 */
export function normalizeAttendanceStatus(status: unknown): string {
  return String(status ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

const EXCLUDED_ATTENDANCE_STATUSES = new Set([
  'absent',
  'off',
  'dayoff',
  'excused',
  'leave',
  'holiday',
  'vacation',
]);

/** Statuses that must never create or keep an automatic late deduction. */
export function isLateDeductionExcludedAttendanceStatus(status: unknown): boolean {
  return EXCLUDED_ATTENDANCE_STATUSES.has(normalizeAttendanceStatus(status));
}

/** Working attendance statuses that may finalize lateness (present/late/empty). */
export function isLateDeductionEligibleAttendanceStatus(status: unknown): boolean {
  if (status == null || String(status).trim() === '') return true;
  return !isLateDeductionExcludedAttendanceStatus(status);
}
