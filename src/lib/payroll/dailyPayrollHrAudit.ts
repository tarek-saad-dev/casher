/**
 * Read-only daily payroll HR diagnostic (Phase 4B.1).
 * Builds per-employee audit rows without mutating data.
 */

import type { PayrollValidationReason } from '@/lib/payroll/dailyPayrollHrRules';
import {
  calculateDailyWage,
  getEffectiveHourlyRate,
  getPayrollValidationReason,
  resolveEmploymentType,
  resolveIsScheduledWorkingDay,
  resolvePayrollMethod,
  scheduledHoursFromTimes,
} from '@/lib/payroll/dailyPayrollHrRules';

export const READ_ONLY_GUARD = Object.freeze({
  allowWrites: false,
  allowGenerate: false,
  allowLedger: false,
});

export type AuditEligibilityStatus = 'eligible' | 'excluded' | 'error';

const ERROR_REASONS = new Set<PayrollValidationReason>([
  'no_attendance',
  'missing_checkin',
  'missing_checkout',
  'no_hourly_rate',
  'no_daily_rate',
  'unsupported_payroll_method',
]);

const EXCLUDED_REASONS = new Set<PayrollValidationReason>([
  'monthly_excluded',
  'payroll_disabled',
  'inactive_employee',
  'freelance_no_attendance',
  'part_time_day_off',
  'not_scheduled_working_day',
]);

export interface AuditEmployeeDbRow {
  EmpID: number;
  EmpName: string;
  isActive?: boolean | number | null;
  IsPayrollEnabled?: boolean | number | null;
  IsAttendanceExempt?: boolean | number | null;
  EmploymentType?: string | null;
  PayrollMethod?: string | null;
  DayOffPolicy?: string | null;
  SalaryType?: string | null;
  ManualHourlyRate?: number | null;
  HourlyRate?: number | null;
  DailyRate?: number | null;
  BaseSalary?: number | null;
  Salary?: number | null;
  DefaultCheckInTime?: string | null;
  DefaultCheckOutTime?: string | null;
  ScheduleDayOfWeek?: number | null;
  IsWorkingDay?: boolean | number | null;
  ScheduleStartTime?: string | null;
  ScheduleEndTime?: string | null;
}

export interface AuditAttendanceDbRow {
  EmpID: number;
  Status: string;
  CheckInTime?: string | null;
  CheckOutTime?: string | null;
}

export interface DailyPayrollAuditRow {
  EmpID: number;
  EmpName: string;
  EmploymentType: string;
  PayrollMethod: string;
  DayOffPolicy: string | null;
  IsPayrollEnabled: boolean;
  IsAttendanceExempt: boolean;
  scheduleWorkingDay: boolean;
  attendanceStatus: string | null;
  checkIn: string | null;
  checkOut: string | null;
  actualHours: number | null;
  ManualHourlyRate: number | null;
  HourlyRate: number | null;
  DailyRate: number | null;
  BaseSalary: number | null;
  effectiveHourlyRate: number | null;
  expectedDailyWage: number | null;
  eligibilityStatus: AuditEligibilityStatus;
  reason: PayrollValidationReason | null;
  highlights: string[];
}

export interface DailyPayrollAuditSummary {
  date: string;
  totalEmployees: number;
  eligibleCount: number;
  excludedCount: number;
  errorCount: number;
  expectedTotalDailyWage: number;
  expectedHourlyTotal: number;
  expectedDailyRateTotal: number;
  monthlyExcludedCount: number;
  freelanceExcludedCount: number;
  highlights: string[];
}

function boolish(v: boolean | number | null | undefined): boolean {
  return v === true || v === 1;
}

function fmtTime(val: unknown): string | null {
  if (val == null || val === '') return null;
  const s = String(val);
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export function computeActualHoursFromTimes(
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
): number | null {
  const start = fmtTime(checkIn);
  const end = fmtTime(checkOut);
  if (!start || !end) return null;

  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;

  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 1440;
  const hours = (endMin - startMin) / 60;
  return hours > 0 ? Math.round(hours * 100) / 100 : 0;
}

function resolveRateSource(row: AuditEmployeeDbRow, scheduledHours: number | null): string | null {
  if (row.ManualHourlyRate != null && Number(row.ManualHourlyRate) > 0) return 'ManualHourlyRate';
  if (row.HourlyRate != null && Number(row.HourlyRate) > 0) return 'HourlyRate';
  if (scheduledHours && scheduledHours > 0) {
    if (row.Salary != null && Number(row.Salary) > 0) return 'Salary/scheduledHours';
    if (row.BaseSalary != null && Number(row.BaseSalary) > 0) return 'BaseSalary/scheduledHours';
  }
  return null;
}

function buildHighlights(
  row: AuditEmployeeDbRow,
  reason: PayrollValidationReason | null,
  eligibilityStatus: AuditEligibilityStatus,
  effectiveRate: number | null,
  scheduledHours: number | null,
): string[] {
  const highlights: string[] = [];
  const employmentType = resolveEmploymentType(row);
  const payrollMethod = resolvePayrollMethod(row);
  const rateSource = resolveRateSource(row, scheduledHours);

  if (payrollMethod === 'hourly' && eligibilityStatus !== 'excluded') {
    if (!row.ManualHourlyRate && rateSource === 'HourlyRate') {
      highlights.push('hourly_fallback:HourlyRate');
    }
    if (!row.ManualHourlyRate && rateSource && rateSource.includes('/')) {
      highlights.push('hourly_fallback:salary/scheduledHours');
    }
    if ((row.HourlyRate == null || Number(row.HourlyRate) <= 0) && row.ManualHourlyRate) {
      highlights.push('manual_rate:HourlyRate_NULL');
    }
  }

  if (payrollMethod === 'daily' && eligibilityStatus === 'error' && reason === 'no_daily_rate') {
    highlights.push('daily_missing:DailyRate');
  }

  if (reason === 'monthly_excluded') {
    highlights.push('monthly_excluded:ok');
  }
  if (reason === 'freelance_no_attendance' && employmentType === 'freelance') {
    highlights.push('freelance_no_attendance:ok');
  }
  if (reason === 'part_time_day_off' && employmentType === 'part_time') {
    highlights.push('part_time_off_day:ok');
  }

  if (payrollMethod === 'hourly' && effectiveRate == null && eligibilityStatus === 'error') {
    highlights.push('no_effective_hourly_rate');
  }

  return highlights;
}

export function classifyEligibilityStatus(
  reason: PayrollValidationReason | null,
): AuditEligibilityStatus {
  if (!reason) return 'eligible';
  if (ERROR_REASONS.has(reason)) return 'error';
  if (EXCLUDED_REASONS.has(reason)) return 'excluded';
  return 'excluded';
}

export function buildAuditRow(
  emp: AuditEmployeeDbRow,
  attendance: AuditAttendanceDbRow | null,
): DailyPayrollAuditRow {
  const hasScheduleRow = emp.ScheduleDayOfWeek != null;
  const schedule = {
    hasScheduleRow,
    isWorkingDay: hasScheduleRow ? boolish(emp.IsWorkingDay) : null,
    scheduleStart: emp.ScheduleStartTime ?? null,
    scheduleEnd: emp.ScheduleEndTime ?? null,
  };

  const defaultStart = emp.DefaultCheckInTime ?? null;
  const defaultEnd = emp.DefaultCheckOutTime ?? null;
  const employmentType = resolveEmploymentType(emp);
  const payrollMethod = resolvePayrollMethod(emp);
  const scheduleWorkingDay = resolveIsScheduledWorkingDay(
    employmentType,
    schedule,
    defaultStart,
    defaultEnd,
  );

  const checkIn = attendance ? fmtTime(attendance.CheckInTime) : null;
  const checkOut = attendance ? fmtTime(attendance.CheckOutTime) : null;
  const actualHours = computeActualHoursFromTimes(checkIn, checkOut);

  const schedHours = scheduledHoursFromTimes(
    schedule.scheduleStart ?? defaultStart,
    schedule.scheduleEnd ?? defaultEnd,
  );

  const reason = getPayrollValidationReason(
    emp,
    schedule,
    attendance
      ? { Status: attendance.Status, CheckInTime: checkIn, CheckOutTime: checkOut }
      : null,
    defaultStart,
    defaultEnd,
  );

  const eligibilityStatus = classifyEligibilityStatus(reason);

  const effectiveHourlyRate =
    payrollMethod === 'hourly' ? getEffectiveHourlyRate(emp, schedHours) : null;

  const expectedDailyWage =
    eligibilityStatus === 'eligible'
      ? calculateDailyWage(payrollMethod, emp, actualHours, schedHours)
      : null;

  const highlights = buildHighlights(
    emp,
    reason,
    eligibilityStatus,
    effectiveHourlyRate,
    schedHours,
  );

  return {
    EmpID: emp.EmpID,
    EmpName: emp.EmpName,
    EmploymentType: employmentType,
    PayrollMethod: payrollMethod,
    DayOffPolicy: emp.DayOffPolicy ?? null,
    IsPayrollEnabled: boolish(emp.IsPayrollEnabled ?? true),
    IsAttendanceExempt: boolish(emp.IsAttendanceExempt),
    scheduleWorkingDay,
    attendanceStatus: attendance?.Status ?? null,
    checkIn,
    checkOut,
    actualHours,
    ManualHourlyRate: emp.ManualHourlyRate ?? null,
    HourlyRate: emp.HourlyRate ?? null,
    DailyRate: emp.DailyRate ?? null,
    BaseSalary: emp.BaseSalary ?? null,
    effectiveHourlyRate,
    expectedDailyWage,
    eligibilityStatus,
    reason,
    highlights,
  };
}

export function buildDailyPayrollAuditReport(
  employees: AuditEmployeeDbRow[],
  attendances: AuditAttendanceDbRow[],
  workDate: string,
  empIdFilter?: number,
): { rows: DailyPayrollAuditRow[]; summary: DailyPayrollAuditSummary } {
  if (!READ_ONLY_GUARD.allowWrites) {
    // Guard flag for tests — audit path never writes
  }

  const attMap = new Map(attendances.map((a) => [a.EmpID, a]));
  let filtered = employees;
  if (empIdFilter != null) {
    filtered = employees.filter((e) => e.EmpID === empIdFilter);
  }

  const rows = filtered.map((emp) => buildAuditRow(emp, attMap.get(emp.EmpID) ?? null));

  const eligible = rows.filter((r) => r.eligibilityStatus === 'eligible');
  const excluded = rows.filter((r) => r.eligibilityStatus === 'excluded');
  const errors = rows.filter((r) => r.eligibilityStatus === 'error');

  const expectedHourlyTotal = eligible
    .filter((r) => r.PayrollMethod === 'hourly')
    .reduce((s, r) => s + (r.expectedDailyWage ?? 0), 0);

  const expectedDailyRateTotal = eligible
    .filter((r) => r.PayrollMethod === 'daily')
    .reduce((s, r) => s + (r.expectedDailyWage ?? 0), 0);

  const globalHighlights: string[] = [];
  for (const r of rows) {
    for (const h of r.highlights) {
      if (!globalHighlights.includes(h)) globalHighlights.push(h);
    }
  }

  return {
    rows,
    summary: {
      date: workDate,
      totalEmployees: rows.length,
      eligibleCount: eligible.length,
      excludedCount: excluded.length,
      errorCount: errors.length,
      expectedTotalDailyWage: eligible.reduce((s, r) => s + (r.expectedDailyWage ?? 0), 0),
      expectedHourlyTotal,
      expectedDailyRateTotal,
      monthlyExcludedCount: excluded.filter((r) => r.reason === 'monthly_excluded').length,
      freelanceExcludedCount: excluded.filter((r) => r.reason === 'freelance_no_attendance').length,
      highlights: globalHighlights,
    },
  };
}

export function formatAuditTableRow(row: DailyPayrollAuditRow): Record<string, string | number> {
  return {
    EmpID: row.EmpID,
    EmpName: row.EmpName,
    EmploymentType: row.EmploymentType,
    PayrollMethod: row.PayrollMethod,
    DayOffPolicy: row.DayOffPolicy ?? '—',
    IsPayrollEnabled: row.IsPayrollEnabled ? 'Y' : 'N',
    IsAttendanceExempt: row.IsAttendanceExempt ? 'Y' : 'N',
    SchedWorkDay: row.scheduleWorkingDay ? 'Y' : 'N',
    AttStatus: row.attendanceStatus ?? '—',
    CheckIn: row.checkIn ?? '—',
    CheckOut: row.checkOut ?? '—',
    ActualHours: row.actualHours ?? '—',
    ManualHourlyRate: row.ManualHourlyRate ?? '—',
    HourlyRate: row.HourlyRate ?? '—',
    DailyRate: row.DailyRate ?? '—',
    BaseSalary: row.BaseSalary ?? '—',
    EffHourlyRate: row.effectiveHourlyRate ?? '—',
    ExpectedDailyWage: row.expectedDailyWage ?? '—',
    Eligibility: row.eligibilityStatus,
    Reason: row.reason ?? '—',
  };
}
