import type { EmployeeMonthlyPayrollDayRow } from '@/lib/reports/employee-monthly-payroll.types';

/** Days where attendance can affect base wage — allow opening the fix modal. */
export function canEditAttendanceForWage(day: EmployeeMonthlyPayrollDayRow): boolean {
  if (day.isFutureDate) return false;
  return (
    day.isScheduledWorkDay ||
    day.checkIn != null ||
    day.isPartialDay ||
    day.statusCode === 'absent' ||
    day.statusCode === 'incomplete_checkout' ||
    day.statusCode === 'no_attendance_record'
  );
}

/** Highlight when hours/checkout look wrong for salary. */
export function needsAttendanceWageReview(day: EmployeeMonthlyPayrollDayRow): boolean {
  if (day.isFutureDate) return false;
  const incomplete = Boolean(day.checkIn && !day.checkOut) || day.statusCode === 'incomplete_checkout';
  const missingOnWorkDay =
    day.isScheduledWorkDay &&
    !day.checkIn &&
    (day.statusCode === 'absent' ||
      day.statusCode === 'no_attendance_record' ||
      day.statusCode === 'pending');
  return day.isPartialDay || incomplete || missingOnWorkDay;
}
