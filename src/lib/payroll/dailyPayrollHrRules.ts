/**
 * Daily payroll eligibility and wage calculation (Phase 4B).
 * Pure functions + SQL fragments shared by generate/validate.
 */

import {
  normalizeEmploymentType,
  normalizePayrollMethod,
  type EmploymentType,
  type PayrollMethod,
} from '@/lib/hr/employee-hr-model';

export type PayrollValidationReason =
  | 'monthly_excluded'
  | 'payroll_disabled'
  | 'inactive_employee'
  | 'freelance_no_attendance'
  | 'part_time_day_off'
  | 'no_attendance'
  | 'missing_checkin'
  | 'missing_checkout'
  | 'no_hourly_rate'
  | 'no_daily_rate'
  | 'unsupported_payroll_method'
  | 'not_scheduled_working_day';

export const PAYABLE_ATTENDANCE_STATUSES = ['Present', 'Late', 'EarlyLeave'] as const;

export const EXEMPT_ATTENDANCE_STATUSES = new Set([
  'إجازة',
  'DayOff',
  'Holiday',
  'غائب',
  'Absent',
  'Leave',
  'Excused',
  'Pending',
]);

export interface PayrollEmployeeRow {
  EmpID: number;
  EmpName: string;
  isActive?: boolean | number | null;
  IsPayrollEnabled?: boolean | number | null;
  EmploymentType?: string | null;
  PayrollMethod?: string | null;
  SalaryType?: string | null;
  ManualHourlyRate?: number | null;
  HourlyRate?: number | null;
  DailyRate?: number | null;
  BaseSalary?: number | null;
  Salary?: number | null;
}

export interface PayrollAttendanceRow {
  Status: string;
  CheckInTime?: unknown;
  CheckOutTime?: unknown;
}

export interface PayrollScheduleDay {
  hasScheduleRow: boolean;
  isWorkingDay: boolean | null;
  scheduleStart?: string | null;
  scheduleEnd?: string | null;
}

export interface PayrollValidationItem {
  empId: number;
  empName: string;
  reason: PayrollValidationReason;
}

function boolish(v: boolean | number | null | undefined): boolean {
  return v === true || v === 1;
}

function positiveNum(v: number | null | undefined): boolean {
  return v != null && Number(v) > 0;
}

export function resolveEmploymentType(row: PayrollEmployeeRow): EmploymentType {
  return normalizeEmploymentType(row.EmploymentType) ?? 'full_time';
}

export function resolvePayrollMethod(row: PayrollEmployeeRow): PayrollMethod {
  const fromColumn = normalizePayrollMethod(row.PayrollMethod);
  if (fromColumn) return fromColumn;
  if (row.SalaryType === 'monthly') return 'monthly';
  return 'hourly';
}

export function isMonthlyExcluded(row: PayrollEmployeeRow): boolean {
  return resolvePayrollMethod(row) === 'monthly';
}

export function isPayableAttendanceStatus(status: string | null | undefined): boolean {
  return !!status && (PAYABLE_ATTENDANCE_STATUSES as readonly string[]).includes(status);
}

export function resolveIsScheduledWorkingDay(
  employmentType: EmploymentType,
  schedule: PayrollScheduleDay,
  defaultStart?: string | null,
  defaultEnd?: string | null,
): boolean {
  if (employmentType === 'freelance') return false;
  if (schedule.hasScheduleRow) return boolish(schedule.isWorkingDay);
  if (employmentType === 'full_time') {
    return !!(defaultStart && defaultEnd);
  }
  return false;
}

export function scheduledHoursFromTimes(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 1440;
  const hours = (endMin - startMin) / 60;
  return hours > 0 ? hours : null;
}

export function getEffectiveHourlyRate(
  row: PayrollEmployeeRow,
  scheduledHours?: number | null,
): number | null {
  if (positiveNum(row.ManualHourlyRate)) return Number(row.ManualHourlyRate);
  if (positiveNum(row.HourlyRate)) return Number(row.HourlyRate);
  const salary = positiveNum(row.Salary)
    ? Number(row.Salary)
    : positiveNum(row.BaseSalary)
      ? Number(row.BaseSalary)
      : null;
  if (salary && scheduledHours && scheduledHours > 0) {
    return salary / scheduledHours;
  }
  return null;
}

export function calculateDailyWage(
  payrollMethod: PayrollMethod,
  row: PayrollEmployeeRow,
  actualHours: number | null,
  scheduledHours?: number | null,
): number {
  if (payrollMethod === 'daily') {
    return positiveNum(row.DailyRate) ? Number(row.DailyRate) : 0;
  }
  if (payrollMethod === 'hourly') {
    const rate = getEffectiveHourlyRate(row, scheduledHours);
    if (!rate || actualHours == null || actualHours <= 0) return 0;
    return rate * actualHours;
  }
  return 0;
}

export function isFreelancePayrollEligible(
  employmentType: EmploymentType,
  attendance: PayrollAttendanceRow | null | undefined,
): boolean {
  if (employmentType !== 'freelance') return false;
  return !!attendance && isPayableAttendanceStatus(attendance.Status);
}

export function isPartTimePayrollEligible(
  employmentType: EmploymentType,
  isScheduledWorkingDay: boolean,
  attendance: PayrollAttendanceRow | null | undefined,
): boolean {
  if (employmentType !== 'part_time') return false;
  if (isScheduledWorkingDay) return true;
  return !!attendance && isPayableAttendanceStatus(attendance.Status);
}

export function shouldIncludeInPayrollValidation(
  row: PayrollEmployeeRow,
  schedule: PayrollScheduleDay,
  attendance: PayrollAttendanceRow | null | undefined,
  defaultStart?: string | null,
  defaultEnd?: string | null,
): boolean {
  if (!boolish(row.isActive ?? true)) return false;
  if (!boolish(row.IsPayrollEnabled ?? true)) return false;
  if (isMonthlyExcluded(row)) return false;
  const method = resolvePayrollMethod(row);
  if (method !== 'hourly' && method !== 'daily') return false;

  const employmentType = resolveEmploymentType(row);
  if (employmentType === 'freelance') {
    return isFreelancePayrollEligible(employmentType, attendance);
  }

  if (
    attendance &&
    EXEMPT_ATTENDANCE_STATUSES.has(attendance.Status) &&
    !isPayableAttendanceStatus(attendance.Status)
  ) {
    return false;
  }

  const isWorkingDay = resolveIsScheduledWorkingDay(
    employmentType,
    schedule,
    defaultStart,
    defaultEnd,
  );

  if (employmentType === 'part_time') {
    return isPartTimePayrollEligible(employmentType, isWorkingDay, attendance);
  }

  if (!isWorkingDay && !attendance) return false;
  if (!isWorkingDay && attendance && !isPayableAttendanceStatus(attendance.Status)) {
    return false;
  }
  return isWorkingDay || (!!attendance && isPayableAttendanceStatus(attendance.Status));
}

export function getPayrollValidationReason(
  row: PayrollEmployeeRow,
  schedule: PayrollScheduleDay,
  attendance: PayrollAttendanceRow | null | undefined,
  defaultStart?: string | null,
  defaultEnd?: string | null,
): PayrollValidationReason | null {
  if (!boolish(row.isActive ?? true)) return 'inactive_employee';
  if (!boolish(row.IsPayrollEnabled ?? true)) return 'payroll_disabled';

  const employmentType = resolveEmploymentType(row);
  const payrollMethod = resolvePayrollMethod(row);

  if (payrollMethod === 'monthly') return 'monthly_excluded';
  if (payrollMethod !== 'hourly' && payrollMethod !== 'daily') {
    return 'unsupported_payroll_method';
  }

  if (!shouldIncludeInPayrollValidation(row, schedule, attendance, defaultStart, defaultEnd)) {
    if (employmentType === 'freelance') return 'freelance_no_attendance';
    const isWorkingDay = resolveIsScheduledWorkingDay(
      employmentType,
      schedule,
      defaultStart,
      defaultEnd,
    );
    if (employmentType === 'part_time' && !isWorkingDay) return 'part_time_day_off';
    if (!isWorkingDay) return 'not_scheduled_working_day';
    return null;
  }

  if (payrollMethod === 'hourly') {
    const schedHours = scheduledHoursFromTimes(
      schedule.scheduleStart ?? defaultStart,
      schedule.scheduleEnd ?? defaultEnd,
    );
    if (!getEffectiveHourlyRate(row, schedHours)) return 'no_hourly_rate';
  }

  if (payrollMethod === 'daily' && !positiveNum(row.DailyRate)) {
    return 'no_daily_rate';
  }

  if (!attendance) return 'no_attendance';
  if (!attendance.CheckInTime) return 'missing_checkin';
  if (!attendance.CheckOutTime) return 'missing_checkout';

  return null;
}

export const PAYROLL_VALIDATION_REASON_LABELS: Record<PayrollValidationReason, string> = {
  monthly_excluded: 'شهري — لا يدخل في اليوميات',
  payroll_disabled: 'الرواتب معطلة',
  inactive_employee: 'موظف غير نشط',
  freelance_no_attendance: 'فري لانس — بدون حضور',
  part_time_day_off: 'دوام جزئي — يوم إجازة',
  no_attendance: 'لم يسجل حضور',
  missing_checkin: 'لم يسجل حضور (check-in)',
  missing_checkout: 'لم يسجل انصراف',
  no_hourly_rate: 'سعر الساعة غير محدد',
  no_daily_rate: 'اليومية الثابتة غير محددة',
  unsupported_payroll_method: 'طريقة محاسبة غير مدعومة',
  not_scheduled_working_day: 'يوم غير مجدول للعمل',
};

/** SQL: resolved payroll method with legacy SalaryType fallback */
export const SQL_RESOLVED_PAYROLL_METHOD = `
  CASE
    WHEN e.PayrollMethod IN (N'hourly', N'daily', N'monthly') THEN e.PayrollMethod
    WHEN e.SalaryType = N'monthly' THEN N'monthly'
    ELSE N'hourly'
  END
`;

export const SQL_RESOLVED_EMPLOYMENT_TYPE = `
  COALESCE(NULLIF(LTRIM(RTRIM(e.EmploymentType)), N''), N'full_time')
`;

export const SQL_SCHEDULED_HOURS_EXPR = `
  CASE
    WHEN ws.EmpID IS NOT NULL AND ws.IsWorkingDay = 1
      AND ws.StartTime IS NOT NULL AND ws.EndTime IS NOT NULL
    THEN
      CASE
        WHEN ws.EndTime > ws.StartTime
          THEN CAST(DATEDIFF(MINUTE, ws.StartTime, ws.EndTime) AS DECIMAL(10,4)) / CAST(60 AS DECIMAL(10,4))
        ELSE CAST(DATEDIFF(MINUTE, ws.StartTime, DATEADD(DAY, 1, CAST(ws.EndTime AS DATETIME))) AS DECIMAL(10,4)) / CAST(60 AS DECIMAL(10,4))
      END
    WHEN e.DefaultCheckInTime IS NOT NULL AND e.DefaultCheckOutTime IS NOT NULL
    THEN
      CASE
        WHEN e.DefaultCheckOutTime > e.DefaultCheckInTime
          THEN CAST(DATEDIFF(MINUTE, e.DefaultCheckInTime, e.DefaultCheckOutTime) AS DECIMAL(10,4)) / CAST(60 AS DECIMAL(10,4))
        ELSE CAST(DATEDIFF(MINUTE, e.DefaultCheckInTime, DATEADD(DAY, 1, CAST(e.DefaultCheckOutTime AS DATETIME))) AS DECIMAL(10,4)) / CAST(60 AS DECIMAL(10,4))
      END
    ELSE NULL
  END
`;

export const SQL_EFFECTIVE_HOURLY_RATE_EXPR = `
  COALESCE(
    NULLIF(CAST(e.ManualHourlyRate AS DECIMAL(10,4)), 0),
    NULLIF(CAST(e.HourlyRate AS DECIMAL(10,4)), 0),
    CASE
      WHEN ISNULL(e.Salary, 0) > 0 AND (${SQL_SCHEDULED_HOURS_EXPR}) > 0
        THEN CAST(e.Salary AS DECIMAL(10,4)) / (${SQL_SCHEDULED_HOURS_EXPR})
      WHEN ISNULL(e.BaseSalary, 0) > 0 AND (${SQL_SCHEDULED_HOURS_EXPR}) > 0
        THEN CAST(e.BaseSalary AS DECIMAL(10,4)) / (${SQL_SCHEDULED_HOURS_EXPR})
      ELSE NULL
    END
  )
`;

export function buildDailyWageSql(actualHoursExpr: string): string {
  return `
    CASE
      WHEN (${SQL_RESOLVED_PAYROLL_METHOD}) = N'daily'
        AND ISNULL(e.DailyRate, 0) > 0
        AND a.CheckInTime IS NOT NULL AND a.CheckOutTime IS NOT NULL
      THEN CAST(e.DailyRate AS DECIMAL(12,2))
      WHEN (${SQL_RESOLVED_PAYROLL_METHOD}) = N'hourly'
        AND a.CheckInTime IS NOT NULL AND a.CheckOutTime IS NOT NULL
        AND (${SQL_EFFECTIVE_HOURLY_RATE_EXPR}) IS NOT NULL
      THEN CAST((${SQL_EFFECTIVE_HOURLY_RATE_EXPR}) AS DECIMAL(10,4)) * (${actualHoursExpr})
      ELSE 0
    END
  `;
}

export function buildHourlyRateSnapshotSql(): string {
  return `
    CASE
      WHEN (${SQL_RESOLVED_PAYROLL_METHOD}) = N'daily' THEN NULL
      ELSE (${SQL_EFFECTIVE_HOURLY_RATE_EXPR})
    END
  `;
}

/** Safe numeric → nvarchar for payroll notes (avoids float→nvarchar overflow). */
function sqlDecimalToNvarchar(expr: string, scale: number, length: number): string {
  return `CONVERT(NVARCHAR(${length}), CAST(ISNULL((${expr}), 0) AS DECIMAL(18,${scale})))`;
}

export function buildPayrollNotesSql(notesPrefix: string, actualHoursExpr: string): string {
  const prefix = notesPrefix.replace(/'/g, "''");
  const dailyRateText = sqlDecimalToNvarchar('e.DailyRate', 2, 32);
  const hourlyRateText = sqlDecimalToNvarchar(SQL_EFFECTIVE_HOURLY_RATE_EXPR, 4, 32);
  const hoursText = sqlDecimalToNvarchar(actualHoursExpr, 2, 32);
  return `
    N'${prefix}'
    + CASE WHEN (${SQL_RESOLVED_EMPLOYMENT_TYPE}) = N'freelance' THEN N'فري لانس — ' ELSE N'' END
    + CASE
        WHEN (${SQL_RESOLVED_EMPLOYMENT_TYPE}) = N'part_time'
          AND (ws.EmpID IS NULL OR ws.IsWorkingDay = 0)
        THEN N'حضور خارج أيام العمل المحددة — '
        ELSE N''
      END
    + CASE
        WHEN (${SQL_RESOLVED_PAYROLL_METHOD}) = N'daily'
        THEN N'يومية ثابتة: ' + ${dailyRateText} + N' ج.م'
        ELSE N'بالساعة: ' + ${hourlyRateText}
          + N' x ' + ${hoursText} + N'h'
      END
    + N' | ' + ISNULL(a.Status, N'')
  `;
}

export const SQL_INSERT_ELIGIBILITY_WHERE = `
  e.isActive = 1
  AND e.IsPayrollEnabled = 1
  AND (${SQL_RESOLVED_PAYROLL_METHOD}) IN (N'hourly', N'daily')
  AND a.Status IN (N'Present', N'Late', N'EarlyLeave')
  AND (
    (${SQL_RESOLVED_EMPLOYMENT_TYPE}) = N'freelance'
    OR (
      (${SQL_RESOLVED_EMPLOYMENT_TYPE}) = N'part_time'
      AND (
        (ws.EmpID IS NOT NULL AND ws.IsWorkingDay = 1)
        OR a.ID IS NOT NULL
      )
    )
    OR (
      (${SQL_RESOLVED_EMPLOYMENT_TYPE}) = N'full_time'
      AND (
        (ws.EmpID IS NOT NULL AND ws.IsWorkingDay = 1)
        OR (ws.EmpID IS NULL AND e.DefaultCheckInTime IS NOT NULL AND e.DefaultCheckOutTime IS NOT NULL)
        OR a.ID IS NOT NULL
      )
    )
  )
  AND (
    ((${SQL_RESOLVED_PAYROLL_METHOD}) = N'hourly' AND ISNULL((${SQL_EFFECTIVE_HOURLY_RATE_EXPR}), 0) > 0)
    OR ((${SQL_RESOLVED_PAYROLL_METHOD}) = N'daily' AND ISNULL(e.DailyRate, 0) > 0)
  )
`;
