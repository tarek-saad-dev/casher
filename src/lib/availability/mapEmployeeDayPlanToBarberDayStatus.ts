/**
 * Map canonical EmployeeDayPlan → BarberDayStatus (ops UI contract).
 * Kept free of imports from availabilityEngine to avoid circular deps.
 */

import type { EmployeeDayPlan } from '@/lib/availability/resolveEmployeeDayPlan';
import type { EffectiveSchedule, ScheduleOverride } from '@/lib/scheduleOverrides';
import { selectPrimaryEffectiveWindow } from '@/lib/availability/effectiveWindows';

type BarberSchedule = {
  isWorkingDay: boolean;
  start: string | null;
  end: string | null;
  source:
    | 'TblEmpWorkSchedule'
    | 'TblEmpBranchWorkSchedule'
    | 'TblEmpTemporaryBranchTransfer'
    | 'TblEmp.Default'
    | 'freelance_attendance'
    | 'none';
};

type AttendanceInfo = {
  status: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
};

export type MappedBarberDayStatus = {
  empId: number;
  dateStr: string;
  schedule: BarberSchedule;
  effectiveSchedule: EffectiveSchedule;
  isDayOff: boolean;
  isAbsent: boolean;
  isLateStart: boolean;
  isEarlyLeave: boolean;
  isCustomHours: boolean;
  isWorkingDay: boolean;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  attendance: AttendanceInfo | null;
  appliedOverride: ScheduleOverride | null;
  dayOffReason: string | null;
  statusReasonArabic: string;
  currentAvailabilityStatus:
    | 'working'
    | 'day_off'
    | 'absent'
    | 'not_checked_in'
    | 'off'
    | 'unknown';
};

const SALON_TZ = 'Africa/Cairo';

function cairoTimeStr(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SALON_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function mapBaseScheduleSource(plan: EmployeeDayPlan): BarberSchedule['source'] {
  switch (plan.baseScheduleSource) {
    case 'BRANCH_WEEKLY':
      return 'TblEmpBranchWorkSchedule';
    case 'TEMPORARY_TRANSFER':
      return 'TblEmpTemporaryBranchTransfer';
    case 'FREELANCE_UNLOCK':
      return 'freelance_attendance';
    case 'LEGACY_WEEKLY':
      return 'TblEmpWorkSchedule';
    default:
      return plan.weeklyWindows ? 'TblEmpWorkSchedule' : 'none';
  }
}

export function mapEmployeeDayPlanToBarberDayStatus(args: {
  plan: EmployeeDayPlan;
  isToday: boolean;
  attendance?: AttendanceInfo | null;
}): MappedBarberDayStatus {
  const { plan, isToday } = args;
  const weekly = plan.weeklyWindows;
  const schedule: BarberSchedule = {
    isWorkingDay: !!(weekly?.isWorkingDay || plan.baseScheduleSource === 'FREELANCE_UNLOCK'),
    start: weekly?.startTime ?? (plan.isWorking ? plan.effSched?.start ?? null : null),
    end: weekly?.endTime ?? (plan.isWorking ? plan.effSched?.end ?? null : null),
    source: mapBaseScheduleSource(plan),
  };

  if (plan.baseScheduleSource === 'FREELANCE_UNLOCK') {
    schedule.isWorkingDay = true;
    schedule.start = plan.effSched?.start ?? weekly?.startTime ?? null;
    schedule.end = plan.effSched?.end ?? weekly?.endTime ?? null;
    schedule.source = 'freelance_attendance';
  }

  const effectiveSchedule: EffectiveSchedule =
    plan.effSched ?? {
      isWorking: false,
      start: '00:00',
      end: '00:00',
      blockedIntervals: [],
      appliedOverride: null,
    };

  const appliedOverride = effectiveSchedule.appliedOverride;
  const isLateStart = appliedOverride?.Type === 'late_start';
  const isEarlyLeave = appliedOverride?.Type === 'early_leave';
  const isCustomHours = appliedOverride?.Type === 'custom_hours';
  const isDayOffOverride = appliedOverride?.Type === 'day_off';

  const isAbsent =
    plan.denyReasonCode === 'EMPLOYEE_ABSENT' ||
    plan.attendanceState?.status === 'Absent' ||
    args.attendance?.status === 'Absent';

  const isDayOff =
    (!isAbsent && plan.denyReasonCode === 'EMPLOYEE_OFF_DAY') ||
    isDayOffOverride ||
    (!plan.isWorking && !isAbsent && plan.denyReasonCode !== 'SCHEDULE_NOT_CONFIGURED');

  const isWorkingDay = plan.isWorking && !isAbsent;
  const win = selectPrimaryEffectiveWindow(plan.effectiveWindows);
  const effectiveStart = isWorkingDay ? (win?.start ?? effectiveSchedule.start ?? schedule.start) : null;
  const effectiveEnd = isWorkingDay ? (win?.end ?? effectiveSchedule.end ?? schedule.end) : null;

  const attendance: AttendanceInfo | null =
    args.attendance ??
    (plan.attendanceState
      ? {
          status: plan.attendanceState.status,
          checkInTime: plan.attendanceState.checkInTime,
          checkOutTime: plan.attendanceState.checkOutTime,
          lateMinutes: 0,
          earlyLeaveMinutes: 0,
        }
      : null);

  let dayOffReason: string | null = null;
  if (isDayOffOverride) {
    dayOffReason = appliedOverride?.Reason ?? 'إجازة (تعديل)';
  } else if (plan.denyReasonCode === 'EMPLOYEE_OFF_DAY' || (!schedule.isWorkingDay && !plan.isWorking)) {
    dayOffReason = 'إجازة أسبوعية';
  } else if (isDayOff) {
    dayOffReason = 'إجازة';
  }

  let statusReasonArabic: string;
  let currentAvailabilityStatus: MappedBarberDayStatus['currentAvailabilityStatus'];

  if (isDayOff && !isAbsent) {
    statusReasonArabic = dayOffReason ?? 'إجازة';
    currentAvailabilityStatus = 'day_off';
  } else if (isAbsent) {
    statusReasonArabic = 'غائب';
    currentAvailabilityStatus = 'absent';
  } else if (
    isToday &&
    attendance &&
    !attendance.checkInTime &&
    schedule.source !== 'freelance_attendance'
  ) {
    const nowCairoMin = hhmmToMin(cairoTimeStr(new Date()));
    const schedStartMin = effectiveStart ? hhmmToMin(effectiveStart) : null;
    if (schedStartMin !== null && nowCairoMin > schedStartMin + 15) {
      statusReasonArabic = 'لم يسجل حضوره بعد';
      currentAvailabilityStatus = 'not_checked_in';
    } else {
      statusReasonArabic = 'متاح';
      currentAvailabilityStatus = 'working';
    }
  } else if (isWorkingDay) {
    if (isLateStart) statusReasonArabic = `بداية متأخرة (${effectiveStart})`;
    else if (isEarlyLeave) statusReasonArabic = `مغادرة مبكرة (${effectiveEnd})`;
    else if (isCustomHours) statusReasonArabic = `ساعات مخصصة (${effectiveStart} - ${effectiveEnd})`;
    else if (schedule.source === 'freelance_attendance') {
      statusReasonArabic = `فري لانس حاضر (${effectiveStart} - ${effectiveEnd})`;
    } else statusReasonArabic = 'متاح';
    currentAvailabilityStatus = 'working';
  } else {
    statusReasonArabic = 'غير متاح';
    currentAvailabilityStatus = 'off';
  }

  return {
    empId: plan.employeeId,
    dateStr: plan.businessDate,
    schedule,
    effectiveSchedule,
    isDayOff: !!isDayOff && !isAbsent,
    isAbsent: !!isAbsent,
    isLateStart,
    isEarlyLeave,
    isCustomHours,
    isWorkingDay,
    effectiveStart,
    effectiveEnd,
    attendance,
    appliedOverride,
    dayOffReason,
    statusReasonArabic,
    currentAvailabilityStatus,
  };
}
