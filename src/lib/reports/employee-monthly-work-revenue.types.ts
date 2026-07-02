export type DailyAttendanceStatusCode =
  | 'present'
  | 'late'
  | 'early_leave'
  | 'late_and_early'
  | 'absent'
  | 'day_off'
  | 'unscheduled'
  | 'no_attendance_record'
  | 'incomplete_checkout'
  | 'future_scheduled'
  | 'excused'
  | 'pending';

export type BadgeVariant =
  | 'success'
  | 'warning'
  | 'danger'
  | 'muted'
  | 'info'
  | 'neutral';

export interface NormalizedDailyStatus {
  statusCode: DailyAttendanceStatusCode;
  statusLabelAr: string;
  badgeVariant: BadgeVariant;
}

export interface EmployeeMonthlyWorkRevenueReport {
  employee: {
    id: number;
    name: string;
    job: string | null;
    isActive: boolean;
  };
  period: {
    year: number;
    month: number;
    monthLabelAr: string;
    startDate: string;
    endDate: string;
    timezone: 'Africa/Cairo';
  };
  summary: {
    calendarDays: number;
    scheduledDays: number;
    attendanceDays: number;
    absentDays: number;
    incompleteAttendanceDays: number;
    scheduledMinutes: number;
    workedMinutes: number;
    lateMinutes: number;
    earlyLeaveMinutes: number;
    totalRevenue: number;
    averageRevenuePerAttendanceDay: number;
    totalServiceLines: number;
    totalInvoices: number;
  };
  days: EmployeeMonthlyDayRow[];
}

export interface EmployeeMonthlyDayRow {
  date: string;
  dayNameAr: string;
  dayNumber: number;
  isFutureDate: boolean;
  isScheduledWorkDay: boolean;
  isDayOff: boolean;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  scheduledMinutes: number | null;
  scheduledOvernight: boolean;
  checkIn: string | null;
  checkOut: string | null;
  checkOutLabelAr: string | null;
  workedMinutes: number | null;
  statusCode: DailyAttendanceStatusCode;
  statusLabelAr: string;
  badgeVariant: BadgeVariant;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  revenue: number;
  serviceCount: number;
  invoiceCount: number;
  notes: string | null;
}

export interface GetEmployeeMonthlyWorkRevenueParams {
  employeeId: number;
  year: number;
  month: number;
}

export function validateReportParams(
  employeeIdRaw: string | null,
  yearRaw: string | null,
  monthRaw: string | null,
): { ok: true; employeeId: number; year: number; month: number } | { ok: false; error: string } {
  if (!employeeIdRaw) {
    return { ok: false, error: 'employeeId مطلوب' };
  }

  const employeeId = parseInt(employeeIdRaw, 10);
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    return { ok: false, error: 'employeeId غير صالح' };
  }

  const year = yearRaw ? parseInt(yearRaw, 10) : NaN;
  const month = monthRaw ? parseInt(monthRaw, 10) : NaN;

  if (!Number.isFinite(year) || year < 2020 || year > 2100) {
    return { ok: false, error: 'year غير صالح' };
  }
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    return { ok: false, error: 'month يجب أن يكون بين 1 و 12' };
  }

  return { ok: true, employeeId, year, month };
}
