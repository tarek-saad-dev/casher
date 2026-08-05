/**
 * Phase 1A / 2 / 2.5 / 3A — Canonical employee day-plan reader.
 *
 * Resolver order (Phase 3A):
 * 1. Branch weekly / transfer / legacy / freelance base
 * 2. Legacy overrides + attendance/day-off
 * 3. Compatibility applyOverrides (legacy first)
 * 4. Canonical daily adjustments (authoritative for deliberate changes)
 * 5. Normalize windows / blocked intervals
 * 6. Infer isWorking / denyReasonCode
 *
 * Attendance Absent always denies and cannot be reopened by adjustments.
 */

import type { Transaction } from 'mssql';
import {
  applyOverrides,
  type EffectiveSchedule,
  type ScheduleOverride,
} from '@/lib/scheduleOverrides';
import type { WorkingWindowRow } from '@/lib/availability/loadWorkingWindowsBatch';
import {
  loadEmployeeDayPlanInputsBatch,
  type EmployeeDayPlanBatchInputs,
  type DayPlanAttendanceState,
} from '@/lib/availability/loadEmployeeDayPlanInputsBatch';
import {
  type AvailabilityReasonCode,
  inferDayDenyReason,
} from '@/lib/availability/reasonCodes';
import { salonDateTimeToMs } from '@/lib/publicBookingHelpers';
import type { FreelanceUnlockWindow } from '@/lib/hr/freelanceBookingUnlock';
import {
  type DailyAdjustmentState,
  type EmployeeDailyAdjustment,
  inferDailyAdjustmentState,
} from '@/lib/availability/dailyAdjustments';
import {
  applyDailyAdjustments,
  isFullyBlockedByIntervals,
  type AppliedBlockedInterval,
} from '@/lib/availability/applyDailyAdjustments';
import { selectPrimaryEffectiveWindow } from '@/lib/availability/effectiveWindows';

export type { DayPlanAttendanceState, EmployeeDayPlanBatchInputs };

export type DayPlanWindow = {
  start: string;
  end: string;
  endDayOffset: 0 | 1;
  startMs: number;
  endMs: number;
};

export type EmployeeDayPlan = {
  employeeId: number;
  branchId: number | null;
  businessDate: string;
  isWorking: boolean;
  effectiveWindows: DayPlanWindow[];
  baseScheduleSource:
    | 'BRANCH_WEEKLY'
    | 'LEGACY_WEEKLY'
    | 'TEMPORARY_TRANSFER'
    | 'FREELANCE_UNLOCK'
    | 'NONE';
  weeklyWindows: WorkingWindowRow | null;
  appliedOverrides: ScheduleOverride[];
  attendanceState: DayPlanAttendanceState | null;
  denyReasonCode: AvailabilityReasonCode | null;
  warnings: string[];
  /** Effective schedule after legacy overrides + daily adjustments (integrity parity). */
  effSched: EffectiveSchedule | null;
  isOvernight: boolean;
  /** Phase 3A additive */
  dailyAdjustments: EmployeeDailyAdjustment[];
  dailyAdjustmentState: DailyAdjustmentState;
};

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function nextDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function mapSource(
  weekly: WorkingWindowRow | null,
  freelance: boolean,
): EmployeeDayPlan['baseScheduleSource'] {
  if (freelance) return 'FREELANCE_UNLOCK';
  if (!weekly) return 'NONE';
  return weekly.source ?? (weekly.isWorkingDay ? 'BRANCH_WEEKLY' : 'NONE');
}

function emptyPlanFields(adjustments: EmployeeDailyAdjustment[]): Pick<
  EmployeeDayPlan,
  'dailyAdjustments' | 'dailyAdjustmentState'
> {
  return {
    dailyAdjustments: adjustments,
    dailyAdjustmentState: inferDailyAdjustmentState(adjustments),
  };
}

function buildEffSchedFromResult(args: {
  windows: DayPlanWindow[];
  blocked: AppliedBlockedInterval[];
  legacyEff: EffectiveSchedule | null;
}): EffectiveSchedule | null {
  const primary = selectPrimaryEffectiveWindow(args.windows);
  if (!primary && !args.blocked.length && !args.legacyEff) {
    return args.legacyEff;
  }
  if (!primary) {
    return {
      isWorking: false,
      start: args.legacyEff?.start ?? '00:00',
      end: args.legacyEff?.end ?? '00:00',
      blockedIntervals: args.blocked.map((b) => ({
        startMs: b.startMs,
        endMs: b.endMs,
        reason:
          b.adjustmentId != null
            ? `daily_adjustment:${b.reason ?? 'block'}`
            : (b.reason ?? 'تعديل يومي'),
      })),
      appliedOverride: args.legacyEff?.appliedOverride ?? null,
    };
  }
  return {
    isWorking: true,
    start: primary.start,
    end: primary.end,
    blockedIntervals: args.blocked.map((b) => ({
      startMs: b.startMs,
      endMs: b.endMs,
      reason:
        b.adjustmentId != null
          ? `daily_adjustment:${b.reason ?? 'block'}`
          : (b.reason ?? 'تعديل يومي'),
    })),
    appliedOverride: args.legacyEff?.appliedOverride ?? null,
  };
}

/** Pure builder — no DB. Uses preloaded batch inputs for one employee. */
export function buildEmployeeDayPlanFromInputs(args: {
  empId: number;
  branchId: number | null;
  businessDate: string;
  inputs: EmployeeDayPlanBatchInputs;
  warnings?: string[];
}): EmployeeDayPlan {
  const { empId, branchId, businessDate, inputs } = args;
  const warnings = [...(args.warnings ?? [])];
  const attendanceState = inputs.attendanceMap.get(empId) ?? null;
  const tableDayOff = inputs.dayOffEmpIds.has(empId);
  const absent = inputs.absentEmpIds.has(empId) || attendanceState?.status === 'Absent';
  const adjustments = inputs.dailyAdjustmentsMap?.get(empId) ?? [];
  let weekly: WorkingWindowRow | null = inputs.windowsMap.get(empId) ?? null;
  let freelanceApplied = false;
  const unlock: FreelanceUnlockWindow | undefined = inputs.freelanceUnlocks.get(empId);

  // Attendance Absent always denies — adjustments cannot reopen.
  if (absent) {
    return {
      employeeId: empId,
      branchId,
      businessDate,
      isWorking: false,
      effectiveWindows: [],
      baseScheduleSource: mapSource(weekly, false),
      weeklyWindows: weekly,
      appliedOverrides: inputs.overridesMap.get(empId) ?? [],
      attendanceState,
      denyReasonCode: 'EMPLOYEE_ABSENT',
      warnings,
      effSched: null,
      isOvernight: false,
      ...emptyPlanFields(adjustments),
    };
  }

  if (unlock && !weekly?.isWorkingDay) {
    if (!unlock.start || !unlock.end) {
      return {
        employeeId: empId,
        branchId,
        businessDate,
        isWorking: false,
        effectiveWindows: [],
        baseScheduleSource: 'FREELANCE_UNLOCK',
        weeklyWindows: weekly,
        appliedOverrides: inputs.overridesMap.get(empId) ?? [],
        attendanceState,
        denyReasonCode: 'FREELANCER_HOURS_NOT_CONFIGURED',
        warnings,
        effSched: null,
        isOvernight: false,
        ...emptyPlanFields(adjustments),
      };
    }
    weekly = {
      isWorkingDay: true,
      startTime: unlock.start,
      endTime: unlock.end,
      source: 'LEGACY_WEEKLY',
    };
    freelanceApplied = true;
  }

  const overrides = inputs.overridesMap.get(empId) ?? [];
  const baseScheduleSource = mapSource(weekly, freelanceApplied);

  // Legacy overrides first (compatibility).
  const base =
    weekly && (weekly.isWorkingDay || freelanceApplied) && weekly.startTime && weekly.endTime
      ? { isWorking: true, start: weekly.startTime, end: weekly.endTime }
      : { isWorking: false, start: '00:00', end: '00:00' };

  // TblEmpDayOff forces non-working base before adjustments (can reopen via ADD/REPLACE).
  const legacyBase = tableDayOff
    ? { isWorking: false, start: '00:00', end: '00:00' }
    : base;

  const legacyEff = applyOverrides(empId, businessDate, legacyBase, overrides);

  const timezone = inputs.timezone;
  let baseWindows: DayPlanWindow[] = [];
  let baseBlocked: AppliedBlockedInterval[] = [];

  if (legacyEff.isWorking && legacyEff.start && legacyEff.end) {
    const isOvernight = hhmmToMinutes(legacyEff.end) <= hhmmToMinutes(legacyEff.start);
    const startMs = salonDateTimeToMs(businessDate, legacyEff.start, timezone);
    const endMs = isOvernight
      ? salonDateTimeToMs(nextDate(businessDate), legacyEff.end, timezone)
      : salonDateTimeToMs(businessDate, legacyEff.end, timezone);
    baseWindows = [
      {
        start: legacyEff.start,
        end: legacyEff.end,
        endDayOffset: isOvernight ? 1 : 0,
        startMs,
        endMs,
      },
    ];
    baseBlocked = (legacyEff.blockedIntervals ?? []).map((iv) => ({
      startMs: iv.startMs,
      endMs: iv.endMs,
      reason: iv.reason,
    }));
  }

  const applied = applyDailyAdjustments({
    employeeId: empId,
    businessDate,
    baseWindows,
    baseBlockedIntervals: baseBlocked,
    adjustments,
    timezone,
  });
  warnings.push(...applied.warnings);

  const adjState = inferDailyAdjustmentState(adjustments);
  const hasAdj = adjustments.length > 0;

  if (!applied.effectiveWindows.length) {
    let denyReasonCode: AvailabilityReasonCode | null = null;
    if (applied.closedByAdjustment) {
      denyReasonCode = 'DAY_CLOSED_BY_ADJUSTMENT';
    } else if (
      applied.blockedByAdjustment &&
      isFullyBlockedByIntervals(baseWindows, applied.blockedIntervals)
    ) {
      denyReasonCode = 'NO_USABLE_WINDOW_AFTER_ADJUSTMENTS';
    } else if (!weekly && !hasAdj) {
      denyReasonCode = 'SCHEDULE_NOT_CONFIGURED';
    } else if (!legacyEff.isWorking || tableDayOff) {
      denyReasonCode = inferDayDenyReason({
        contextsEmpty: true,
        specificEmp: true,
        dayOff: tableDayOff || legacyEff.appliedOverride?.Type === 'day_off',
        notWorking: true,
      });
    } else {
      denyReasonCode = hasAdj
        ? 'NO_USABLE_WINDOW_AFTER_ADJUSTMENTS'
        : 'SCHEDULE_NOT_CONFIGURED';
    }

    return {
      employeeId: empId,
      branchId,
      businessDate,
      isWorking: false,
      effectiveWindows: [],
      baseScheduleSource,
      weeklyWindows: weekly,
      appliedOverrides: overrides,
      attendanceState,
      denyReasonCode,
      warnings,
      effSched: buildEffSchedFromResult({
        windows: [],
        blocked: applied.blockedIntervals,
        legacyEff,
      }),
      isOvernight: false,
      dailyAdjustments: adjustments,
      dailyAdjustmentState: adjState,
    };
  }

  if (isFullyBlockedByIntervals(applied.effectiveWindows, applied.blockedIntervals)) {
    return {
      employeeId: empId,
      branchId,
      businessDate,
      isWorking: false,
      effectiveWindows: applied.effectiveWindows,
      baseScheduleSource,
      weeklyWindows: weekly,
      appliedOverrides: overrides,
      attendanceState,
      denyReasonCode: 'NO_USABLE_WINDOW_AFTER_ADJUSTMENTS',
      warnings,
      effSched: buildEffSchedFromResult({
        windows: applied.effectiveWindows,
        blocked: applied.blockedIntervals,
        legacyEff,
      }),
      isOvernight: applied.effectiveWindows.some((w) => w.endDayOffset === 1),
      dailyAdjustments: adjustments,
      dailyAdjustmentState: adjState,
    };
  }

  const isOvernight = applied.effectiveWindows.some((w) => w.endDayOffset === 1);

  return {
    employeeId: empId,
    branchId,
    businessDate,
    isWorking: true,
    effectiveWindows: applied.effectiveWindows,
    baseScheduleSource,
    weeklyWindows: weekly,
    appliedOverrides: overrides,
    attendanceState,
    denyReasonCode: null,
    warnings,
    effSched: buildEffSchedFromResult({
      windows: applied.effectiveWindows,
      blocked: applied.blockedIntervals,
      legacyEff,
    }),
    isOvernight,
    dailyAdjustments: adjustments,
    dailyAdjustmentState: adjState,
  };
}

export async function resolveEmployeeDayPlan(args: {
  branchId?: number | null;
  empId: number;
  businessDate: string;
  source?: 'public' | 'operations' | 'admin';
  transaction?: Transaction;
}): Promise<EmployeeDayPlan> {
  void args.source;
  const inputs = await loadEmployeeDayPlanInputsBatch({
    branchId: args.branchId ?? null,
    empIds: [args.empId],
    businessDate: args.businessDate,
    transaction: args.transaction,
  });
  return buildEmployeeDayPlanFromInputs({
    empId: args.empId,
    branchId: args.branchId ?? null,
    businessDate: args.businessDate,
    inputs,
  });
}

export async function resolveEmployeeDayPlansBatch(args: {
  branchId?: number | null;
  empIds: number[];
  businessDate: string;
  source?: 'public' | 'operations' | 'admin';
  transaction?: Transaction;
}): Promise<Map<number, EmployeeDayPlan>> {
  void args.source;
  const out = new Map<number, EmployeeDayPlan>();
  if (!args.empIds.length) return out;

  const inputs = await loadEmployeeDayPlanInputsBatch({
    branchId: args.branchId ?? null,
    empIds: args.empIds,
    businessDate: args.businessDate,
    transaction: args.transaction,
  });

  const seen = new Set<number>();
  for (const raw of args.empIds) {
    const empId = Number(raw);
    if (!Number.isInteger(empId) || empId <= 0 || seen.has(empId)) continue;
    seen.add(empId);
    out.set(
      empId,
      buildEmployeeDayPlanFromInputs({
        empId,
        branchId: args.branchId ?? null,
        businessDate: args.businessDate,
        inputs,
      }),
    );
  }
  return out;
}

export { loadEmployeeDayPlanInputsBatch } from '@/lib/availability/loadEmployeeDayPlanInputsBatch';
