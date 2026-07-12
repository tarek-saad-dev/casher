/**
 * Schedule row builder for Employee HR model (Phase 2).
 *
 * Freelance convention: upsert 7 rows with IsWorkingDay=0 (no fixed schedule).
 * Full-time flexible_weekly: 7 working days (deferred day-off policy).
 */

import type { DayOffPolicy, EmploymentType } from '@/lib/hr/employee-hr-model';
import type { ScheduleConfigInput, ScheduleDayConfig } from '@/lib/hr/employee-hr-model';

export interface ScheduleRowWrite {
  dayOfWeek: number;
  isWorkingDay: boolean;
  startTime: string | null;
  endTime: string | null;
  breakStartTime: string | null;
  breakEndTime: string | null;
  notes: string | null;
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

function isValidDayOfWeek(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 6;
}

/**
 * Builds 7 schedule rows for TblEmpWorkSchedule upsert.
 */
export function buildScheduleRows(
  employmentType: EmploymentType,
  dayOffPolicy: DayOffPolicy,
  scheduleConfig: ScheduleConfigInput | null,
  defaultStartTime: string | null,
  defaultEndTime: string | null,
): ScheduleRowWrite[] {
  if (employmentType === 'freelance') {
    return ALL_DAYS.map((dayOfWeek) => ({
      dayOfWeek,
      isWorkingDay: false,
      startTime: null,
      endTime: null,
      breakStartTime: null,
      breakEndTime: null,
      notes: null,
    }));
  }

  if (scheduleConfig?.days && scheduleConfig.days.length === 7) {
    return scheduleConfig.days.map((d) => dayConfigToRow(d, defaultStartTime, defaultEndTime));
  }

  if (employmentType === 'full_time') {
    if (dayOffPolicy === 'fixed_weekly') {
      const dayOff = scheduleConfig?.weeklyDayOff ?? 5;
      return ALL_DAYS.map((dayOfWeek) => ({
        dayOfWeek,
        isWorkingDay: dayOfWeek !== dayOff,
        startTime: dayOfWeek !== dayOff ? defaultStartTime : null,
        endTime: dayOfWeek !== dayOff ? defaultEndTime : null,
        breakStartTime: null,
        breakEndTime: null,
        notes: dayOfWeek === dayOff ? 'إجازة أسبوعية' : null,
      }));
    }

    // flexible_weekly or none — all 7 days scheduled; day off is deferred/manual
    return ALL_DAYS.map((dayOfWeek) => ({
      dayOfWeek,
      isWorkingDay: true,
      startTime: defaultStartTime,
      endTime: defaultEndTime,
      breakStartTime: null,
      breakEndTime: null,
      notes: dayOffPolicy === 'flexible_weekly' ? 'إجازة أسبوعية مرنة' : null,
    }));
  }

  if (employmentType === 'part_time') {
    const workingSet = new Set(
      (scheduleConfig?.workingDays ?? []).filter(isValidDayOfWeek),
    );
    return ALL_DAYS.map((dayOfWeek) => ({
      dayOfWeek,
      isWorkingDay: workingSet.has(dayOfWeek),
      startTime: workingSet.has(dayOfWeek) ? defaultStartTime : null,
      endTime: workingSet.has(dayOfWeek) ? defaultEndTime : null,
      breakStartTime: null,
      breakEndTime: null,
      notes: null,
    }));
  }

  return ALL_DAYS.map((dayOfWeek) => ({
    dayOfWeek,
    isWorkingDay: false,
    startTime: null,
    endTime: null,
    breakStartTime: null,
    breakEndTime: null,
    notes: null,
  }));
}

function dayConfigToRow(
  d: ScheduleDayConfig,
  defaultStart: string | null,
  defaultEnd: string | null,
): ScheduleRowWrite {
  const working = d.isWorkingDay !== false;
  return {
    dayOfWeek: d.dayOfWeek,
    isWorkingDay: working,
    startTime: working ? (d.startTime ?? defaultStart) : null,
    endTime: working ? (d.endTime ?? defaultEnd) : null,
    breakStartTime: d.breakStartTime ?? null,
    breakEndTime: d.breakEndTime ?? null,
    notes: d.notes ?? null,
  };
}

export function countWorkingDays(rows: ScheduleRowWrite[]): number {
  return rows.filter((r) => r.isWorkingDay).length;
}
