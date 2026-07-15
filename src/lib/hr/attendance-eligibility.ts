/**
 * Attendance eligibility and status resolution (Phase 4A).
 * Controls who appears on the attendance board and how KPIs are counted.
 */

import {
  calcEarlyLeaveMinutes,
  calcLateMinutes,
} from '@/lib/timeUtils';
import type { AttendanceBreakInterval } from '@/lib/hr/attendance-breaks';
import type { DayOffPolicy, EmploymentType } from '@/lib/hr/employee-hr-model';
import { normalizeEmploymentType, normalizePayrollMethod, normalizeDayOffPolicy } from '@/lib/hr/employee-hr-model';

export type AttendanceExclusionReason =
  | 'freelance_no_attendance'
  | 'part_time_day_off'
  | 'scheduled_day_off'
  | 'inactive'
  | null;

export const ATTENDANCE_DISPLAY_STATUSES = [
  'Pending',
  'Present',
  'Late',
  'Absent',
  'DayOff',
  'EarlyLeave',
  'Excused',
  'FreelanceAvailable',
  'NotRequired',
] as const;

export type AttendanceDisplayStatus = (typeof ATTENDANCE_DISPLAY_STATUSES)[number];

export interface RawAttendanceDbRow {
  EmpID: number;
  EmpName: string;
  isActive?: boolean | number | null;
  EmploymentType?: string | null;
  PayrollMethod?: string | null;
  DayOffPolicy?: string | null;
  IsAttendanceExempt?: boolean | number | null;
  IsPayrollEnabled?: boolean | number | null;
  DefaultCheckInTime?: string | null;
  DefaultCheckOutTime?: string | null;
  ScheduleDayOfWeek?: number | null;
  IsWorkingDay?: boolean | number | null;
  ScheduleStartTime?: string | null;
  ScheduleEndTime?: string | null;
  AttendanceID?: number | null;
  CheckInTime?: string | null;
  CheckOutTime?: string | null;
  Status?: string | null;
  LateMinutes?: number | null;
  EarlyLeaveMinutes?: number | null;
  Notes?: string | null;
  BreakMinutesTotal?: number | null;
  Breaks?: AttendanceBreakInterval[] | null;
}

export interface ResolvedScheduleDay {
  isScheduledWorkingDay: boolean;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  scheduleWarning: string | null;
  hasScheduleRow: boolean;
}

export interface AttendanceEligibilityResult {
  include: boolean;
  isFreelance: boolean;
  isScheduledWorkingDay: boolean;
  isAttendanceRequired: boolean;
  expectedToday: boolean;
  reason: AttendanceExclusionReason;
  displayReason: string | null;
}

export interface AttendanceBoardRow {
  EmpID: number;
  EmpName: string;
  WorkDate: string;
  DayOfWeek: number;
  EmploymentType: EmploymentType | null;
  PayrollMethod: ReturnType<typeof normalizePayrollMethod>;
  DayOffPolicy: DayOffPolicy | null;
  IsAttendanceExempt: boolean;
  IsPayrollEnabled: boolean;
  IsWorkingDay: boolean;
  isScheduledWorkingDay: boolean;
  isFreelance: boolean;
  isAttendanceRequired: boolean;
  expectedToday: boolean;
  reason: AttendanceExclusionReason;
  displayReason: string | null;
  scheduleWarning: string | null;
  ScheduledStartTime: string | null;
  ScheduledEndTime: string | null;
  DefaultCheckInTime: string | null;
  DefaultCheckOutTime: string | null;
  CheckInTime: string | null;
  CheckOutTime: string | null;
  Status: string;
  LateMinutes: number;
  EarlyLeaveMinutes: number;
  Notes: string;
  HasRecord: boolean;
  BreakMinutesTotal: number;
  Breaks: AttendanceBreakInterval[];
  employmentTypeLabel: string | null;
  payrollMethodLabel: string | null;
  dayOffPolicyLabel: string | null;
}

export interface AttendanceSummary {
  total: number;
  present: number;
  late: number;
  absent: number;
  dayOff: number;
  pending: number;
  requiredCount: number;
}

function boolish(value: boolean | number | null | undefined): boolean {
  return value === true || value === 1;
}

export function resolveIsFreelance(
  employmentType: EmploymentType | null,
  isAttendanceExempt: boolean,
): boolean {
  return employmentType === 'freelance' || isAttendanceExempt;
}

export function resolveScheduleForDay(
  employmentType: EmploymentType | null,
  row: {
    hasScheduleRow: boolean;
    isWorkingDayFromSchedule: boolean | null;
    scheduleStart: string | null;
    scheduleEnd: string | null;
    defaultStart: string | null;
    defaultEnd: string | null;
  },
): ResolvedScheduleDay {
  const {
    hasScheduleRow,
    isWorkingDayFromSchedule,
    scheduleStart,
    scheduleEnd,
    defaultStart,
    defaultEnd,
  } = row;

  if (employmentType === 'freelance') {
    return {
      isScheduledWorkingDay: false,
      scheduledStart: defaultStart,
      scheduledEnd: defaultEnd,
      scheduleWarning: null,
      hasScheduleRow,
    };
  }

  if (hasScheduleRow) {
    const working = boolish(isWorkingDayFromSchedule);
    const start = working ? scheduleStart || defaultStart : null;
    const end = working ? scheduleEnd || defaultEnd : null;
    return {
      isScheduledWorkingDay: working,
      scheduledStart: start,
      scheduledEnd: end,
      scheduleWarning:
        working && employmentType === 'full_time' && (!start || !end)
          ? 'لا يوجد وقت عمل محدد'
          : null,
      hasScheduleRow: true,
    };
  }

  if (employmentType === 'full_time') {
    const hasDefaults = !!(defaultStart && defaultEnd);
    return {
      isScheduledWorkingDay: hasDefaults,
      scheduledStart: defaultStart,
      scheduledEnd: defaultEnd,
      scheduleWarning: 'لا يوجد جدول عمل لهذا الموظف',
      hasScheduleRow: false,
    };
  }

  if (employmentType === 'part_time') {
    return {
      isScheduledWorkingDay: false,
      scheduledStart: null,
      scheduledEnd: null,
      scheduleWarning: null,
      hasScheduleRow: false,
    };
  }

  return {
    isScheduledWorkingDay: !!(defaultStart && defaultEnd),
    scheduledStart: defaultStart,
    scheduledEnd: defaultEnd,
    scheduleWarning: null,
    hasScheduleRow: false,
  };
}

export function resolveAttendanceEligibility(input: {
  isActive: boolean;
  employmentType: EmploymentType | null;
  isFreelance: boolean;
  isScheduledWorkingDay: boolean;
  hasAttendanceRecord: boolean;
  includeFreelance: boolean;
}): AttendanceEligibilityResult {
  if (!input.isActive) {
    return {
      include: false,
      isFreelance: input.isFreelance,
      isScheduledWorkingDay: input.isScheduledWorkingDay,
      isAttendanceRequired: false,
      expectedToday: false,
      reason: 'inactive',
      displayReason: null,
    };
  }

  if (input.isFreelance) {
    const include = input.hasAttendanceRecord || input.includeFreelance;
    return {
      include,
      isFreelance: true,
      isScheduledWorkingDay: false,
      isAttendanceRequired: false,
      expectedToday: false,
      reason: include && !input.hasAttendanceRecord ? 'freelance_no_attendance' : null,
      displayReason: include && !input.hasAttendanceRecord
        ? 'فري لانس — يظهر عند تسجيل حضوره فقط'
        : null,
    };
  }

  if (input.employmentType === 'part_time') {
    const include = input.isScheduledWorkingDay || input.hasAttendanceRecord;
    return {
      include,
      isFreelance: false,
      isScheduledWorkingDay: input.isScheduledWorkingDay,
      isAttendanceRequired: input.isScheduledWorkingDay,
      expectedToday: input.isScheduledWorkingDay,
      reason: !include ? 'part_time_day_off' : null,
      displayReason: !input.isScheduledWorkingDay && input.hasAttendanceRecord
        ? 'خارج أيام العمل'
        : null,
    };
  }

  // full_time (default)
  const isAttendanceRequired = input.isScheduledWorkingDay;
  return {
    include: true,
    isFreelance: false,
    isScheduledWorkingDay: input.isScheduledWorkingDay,
    isAttendanceRequired,
    expectedToday: isAttendanceRequired,
    reason: !isAttendanceRequired ? 'scheduled_day_off' : null,
    displayReason: !isAttendanceRequired ? 'إجازة' : null,
  };
}

export function resolveEffectiveAttendanceStatus(input: {
  hasAttendanceRecord: boolean;
  storedStatus: string | null;
  isAttendanceRequired: boolean;
  isFreelance: boolean;
  includeFreelance: boolean;
  isScheduledWorkingDay: boolean;
}): string {
  if (input.hasAttendanceRecord && input.storedStatus) {
    return input.storedStatus;
  }

  if (input.isFreelance && input.includeFreelance && !input.hasAttendanceRecord) {
    return 'FreelanceAvailable';
  }

  if (!input.isAttendanceRequired) {
    if (input.isFreelance) return 'NotRequired';
    if (!input.isScheduledWorkingDay) return 'DayOff';
    return 'NotRequired';
  }

  return 'Pending';
}

export function computeAttendanceSummary(rows: AttendanceBoardRow[]): AttendanceSummary {
  const requiredRows = rows.filter((r) => r.isAttendanceRequired);
  return {
    total: rows.length,
    present: requiredRows.filter((r) => r.Status === 'Present').length,
    late: requiredRows.filter((r) => r.Status === 'Late').length,
    absent: requiredRows.filter((r) => r.Status === 'Absent').length,
    dayOff: rows.filter(
      (r) => r.Status === 'DayOff' || r.Status === 'Excused',
    ).length,
    pending: requiredRows.filter((r) => r.Status === 'Pending').length,
    requiredCount: requiredRows.length,
  };
}

const EMPLOYMENT_LABELS: Record<string, string> = {
  full_time: 'دوام كامل',
  part_time: 'دوام جزئي',
  freelance: 'فري لانس',
};

const PAYROLL_LABELS: Record<string, string> = {
  hourly: 'بالساعة',
  daily: 'يومية',
  monthly: 'شهري',
};

const DAY_OFF_LABELS: Record<string, string> = {
  fixed_weekly: 'إجازة ثابتة',
  flexible_weekly: 'إجازة مرنة',
  none: '—',
};

export function buildAttendanceBoardRow(
  row: RawAttendanceDbRow,
  workDate: string,
  dayOfWeek: number,
  options: { includeFreelance: boolean },
): AttendanceBoardRow | null {
  const employmentType = normalizeEmploymentType(row.EmploymentType) ?? 'full_time';
  const payrollMethod = normalizePayrollMethod(row.PayrollMethod);
  const dayOffPolicy = normalizeDayOffPolicy(row.DayOffPolicy);
  const isAttendanceExempt = boolish(row.IsAttendanceExempt);
  const isActive = row.isActive == null ? true : boolish(row.isActive);
  const isFreelance = resolveIsFreelance(employmentType, isAttendanceExempt);
  const hasScheduleRow = row.ScheduleDayOfWeek != null;
  const schedule = resolveScheduleForDay(employmentType, {
    hasScheduleRow,
    isWorkingDayFromSchedule: hasScheduleRow ? boolish(row.IsWorkingDay) : null,
    scheduleStart: row.ScheduleStartTime ?? null,
    scheduleEnd: row.ScheduleEndTime ?? null,
    defaultStart: row.DefaultCheckInTime ?? null,
    defaultEnd: row.DefaultCheckOutTime ?? null,
  });

  const hasAttendanceRecord = row.AttendanceID != null;
  const eligibility = resolveAttendanceEligibility({
    isActive,
    employmentType,
    isFreelance,
    isScheduledWorkingDay: schedule.isScheduledWorkingDay,
    hasAttendanceRecord,
    includeFreelance: options.includeFreelance,
  });

  if (!eligibility.include) {
    return null;
  }

  const checkIn = row.CheckInTime || null;
  const checkOut = row.CheckOutTime || null;
  const schedStart = schedule.scheduledStart;
  const schedEnd = schedule.scheduledEnd;

  const status = resolveEffectiveAttendanceStatus({
    hasAttendanceRecord,
    storedStatus: row.Status ?? null,
    isAttendanceRequired: eligibility.isAttendanceRequired,
    isFreelance,
    includeFreelance: options.includeFreelance,
    isScheduledWorkingDay: schedule.isScheduledWorkingDay,
  });

  const lateMin =
    hasAttendanceRecord && checkIn ? calcLateMinutes(checkIn, schedStart) : 0;
  const earlyMin =
    hasAttendanceRecord && checkOut ? calcEarlyLeaveMinutes(checkOut, schedEnd) : 0;

  return {
    EmpID: row.EmpID,
    EmpName: row.EmpName,
    WorkDate: workDate,
    DayOfWeek: dayOfWeek,
    EmploymentType: employmentType,
    PayrollMethod: payrollMethod,
    DayOffPolicy: dayOffPolicy,
    IsAttendanceExempt: isAttendanceExempt,
    IsPayrollEnabled: row.IsPayrollEnabled == null ? true : boolish(row.IsPayrollEnabled),
    IsWorkingDay: schedule.isScheduledWorkingDay,
    isScheduledWorkingDay: schedule.isScheduledWorkingDay,
    isFreelance,
    isAttendanceRequired: eligibility.isAttendanceRequired,
    expectedToday: eligibility.expectedToday,
    reason: eligibility.reason,
    displayReason: eligibility.displayReason,
    scheduleWarning: schedule.scheduleWarning,
    ScheduledStartTime: schedStart,
    ScheduledEndTime: schedEnd,
    DefaultCheckInTime: row.DefaultCheckInTime ?? null,
    DefaultCheckOutTime: row.DefaultCheckOutTime ?? null,
    CheckInTime: checkIn,
    CheckOutTime: checkOut,
    Status: status,
    LateMinutes: lateMin,
    EarlyLeaveMinutes: earlyMin,
    Notes: row.Notes || '',
    HasRecord: hasAttendanceRecord,
    BreakMinutesTotal: Math.max(0, Number(row.BreakMinutesTotal) || 0),
    Breaks: Array.isArray(row.Breaks) ? row.Breaks : [],
    employmentTypeLabel: EMPLOYMENT_LABELS[employmentType] ?? null,
    payrollMethodLabel: payrollMethod ? PAYROLL_LABELS[payrollMethod] ?? null : null,
    dayOffPolicyLabel:
      employmentType === 'full_time' && dayOffPolicy
        ? DAY_OFF_LABELS[dayOffPolicy] ?? null
        : null,
  };
}

export function filterAttendanceBoardRows(
  rows: RawAttendanceDbRow[],
  workDate: string,
  dayOfWeek: number,
  options: { includeFreelance: boolean },
): AttendanceBoardRow[] {
  const result: AttendanceBoardRow[] = [];
  for (const row of rows) {
    const built = buildAttendanceBoardRow(row, workDate, dayOfWeek, options);
    if (built) result.push(built);
  }
  return result;
}
