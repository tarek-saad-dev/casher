/**
 * Booking V2 — BookingPolicy (gradual single source of booking rules).
 *
 * This module is the **declared** policy surface for V2. Implementation composes
 * existing pure engines (day-plan builder, overrides, daily adjustments,
 * emp service duration) so we do not fork rule math.
 *
 * Routes / Next.js must not import business rules directly for new code —
 * call BookingPolicy (or EffectiveWorkPlanService / BookingCommandService).
 *
 * Rule catalog covered here (evaluation / resolution):
 * - Branch hours / EmpBranchAssignment / weekly schedule (via day-plan inputs)
 * - exceptional hours & daily adjustments (CLOSE_DAY, REPLACE, ADD, BLOCK)
 * - late_start / early_leave / block_range / close_day (legacy overrides + adjustments)
 * - attendance / auto absence / present-on-day-off (day-plan inputs)
 * - freelancer / part-time unlocks
 * - service duration + employee service duration override
 * - minNotice / maxAhead
 *
 * NOT yet migrated (legacy still owns runtime): live busy/queue/hold SQL,
 * create TX, public cache, HTTP contracts.
 */

import { buildEmployeeDayPlanFromInputs } from '@/lib/availability/resolveEmployeeDayPlan';
import type { EmployeeDayPlanBatchInputs } from '@/lib/availability/loadEmployeeDayPlanInputsBatch';
import type { EmployeeDayPlan } from '@/lib/availability/resolveEmployeeDayPlan';
import {
  findWindowContainingInterval,
  isIntervalInsideAnyEffectiveWindow,
} from '@/lib/availability/effectiveWindows';
import { resolveOneServiceDuration } from '@/lib/empServiceDuration';
import {
  BOOKING_TZ,
  type BusinessDateString,
  currentBusinessDate,
  parseBusinessDate,
  shiftBusinessDate,
} from '@/lib/booking/domain/BusinessDate';
import {
  type BookingInterval,
  bookingIntervalFromBusinessClock,
} from '@/lib/booking/domain/BookingInterval';
import {
  BookingDomainError,
  type BookingDomainErrorCode,
} from '@/lib/booking/domain/BookingError';
import {
  assertSingleGlobalEmployeeResource,
  globalEmployeeResourceKey,
} from '@/lib/booking/domain/EmployeeIdentity';
import {
  bitmapFromNormalizedWeeklyPlan,
  normalizeWeeklyBaselinePlan,
  weeklyBaselineSourceFingerprint,
  type NormalizedWeeklyBaselinePlan,
  type WeeklyBaselineSourceInputs,
} from '@/lib/booking/domain/WeeklyBaseline';
import { AvailabilityBitmap } from '@/lib/booking/domain/AvailabilityBitmap';
import {
  applyEffectiveDayLayers,
  type EffectiveDayKey,
  type EffectiveDayLayerInputs,
  type EffectiveDayBuildResult,
} from '@/lib/booking/domain/EffectiveDay';

import { shiftCalendarDate } from '@/lib/businessDate';

/** Declared single-source catalog — keep in sync as more rules migrate. */
export const BOOKING_POLICY_RULE_CATALOG = [
  'branch_hours',
  'exceptional_branch_hours',
  'emp_branch_assignment',
  'weekly_employee_schedule',
  'late_start',
  'early_leave',
  'block_range',
  'close_day',
  'attendance',
  'auto_absence',
  'present_on_day_off',
  'freelancer_part_time',
  'service_duration',
  'employee_service_duration_override',
  'min_notice',
  'max_ahead',
  'global_employee_identity',
  'business_date_absolute_interval',
  'weekly_baseline_projection',
] as const;

export type BookingPolicyRuleId = (typeof BOOKING_POLICY_RULE_CATALOG)[number];

export type BookingPolicySettings = {
  minNoticeMinutes: number;
  maxBookingDaysAhead: number;
  timeZone?: string;
};

export type ServiceDurationPolicyInput = {
  serviceId: number;
  serviceDefaultMinutes: number | null;
  employeeOverrideMinutes?: number | null;
  systemDefaultMinutes?: number;
};

export type ResolveDurationResult = {
  durationMinutes: number;
  durationSource: 'EMP_SERVICE_OVERRIDE' | 'SERVICE_DEFAULT' | 'SYSTEM_DEFAULT';
  totalDurationMinutes: number;
};

export type PolicyEvaluationOk = {
  ok: true;
  interval: BookingInterval;
  workPlan: EmployeeDayPlan;
  duration: ResolveDurationResult;
  employeeResourceKey: string;
};

export type PolicyEvaluationDeny = {
  ok: false;
  code: BookingDomainErrorCode;
  message?: string;
  workPlan?: EmployeeDayPlan;
  meta?: Record<string, unknown>;
};

export type PolicyEvaluationResult = PolicyEvaluationOk | PolicyEvaluationDeny;

function mapDenyCode(plan: EmployeeDayPlan): BookingDomainErrorCode {
  switch (plan.denyReasonCode) {
    case 'BRANCH_CLOSED':
      return 'BRANCH_CLOSED';
    case 'EMPLOYEE_INACTIVE':
      return 'EMPLOYEE_INACTIVE';
    case 'NOT_ASSIGNED_TO_BRANCH':
      return 'NOT_ASSIGNED_TO_BRANCH';
    case 'SCHEDULE_NOT_CONFIGURED':
      return 'SCHEDULE_NOT_CONFIGURED';
    case 'EMPLOYEE_OFF_DAY':
      return 'EMPLOYEE_OFF_DAY';
    case 'EMPLOYEE_ABSENT':
      return 'EMPLOYEE_ABSENT';
    case 'FREELANCER_NOT_PLANNED':
    case 'FREELANCER_HOURS_NOT_CONFIGURED':
      return 'FREELANCER_NOT_PLANNED';
    case 'DAY_CLOSED_BY_ADJUSTMENT':
      return 'DAY_CLOSED';
    case 'NO_USABLE_WINDOW_AFTER_ADJUSTMENTS':
      return 'BLOCKED_BY_RANGE';
    default:
      return 'SLOT_UNAVAILABLE';
  }
}

export const BookingPolicy = {
  ruleCatalog: BOOKING_POLICY_RULE_CATALOG,

  /**
   * Resolve duration: employee override → service default → system default.
   * Single policy entry for duration (ops + any future public override path).
   */
  resolveServiceDurations(args: {
    services: ServiceDurationPolicyInput[];
    systemDefaultMinutes?: number;
  }): ResolveDurationResult {
    if (!args.services.length) {
      throw new BookingDomainError('SERVICE_DURATION_UNRESOLVED', { reason: 'empty' });
    }
    const systemDefault = args.systemDefaultMinutes ?? 30;
    const lines = args.services.map((s) =>
      resolveOneServiceDuration({
        overrideMinutes: s.employeeOverrideMinutes,
        serviceDefaultMinutes: s.serviceDefaultMinutes,
        systemDefaultMinutes: systemDefault,
      }),
    );
    const totalDurationMinutes = lines.reduce((sum, l) => sum + l.durationMinutes, 0);
    const sources = new Set(lines.map((l) => l.durationSource));
    const durationSource =
      sources.size === 1
        ? lines[0]!.durationSource
        : lines.some((l) => l.durationSource === 'EMP_SERVICE_OVERRIDE')
          ? 'EMP_SERVICE_OVERRIDE'
          : lines[0]!.durationSource;
    return {
      durationMinutes: totalDurationMinutes,
      totalDurationMinutes,
      durationSource,
    };
  },

  /** Build canonical day plan from preloaded inputs (no DB). */
  buildWorkPlan(args: {
    employeeId: number;
    branchId: number | null;
    businessDate: BusinessDateString | string;
    inputs: EmployeeDayPlanBatchInputs;
  }): EmployeeDayPlan {
    return buildEmployeeDayPlanFromInputs({
      empId: args.employeeId,
      branchId: args.branchId,
      businessDate: String(parseBusinessDate(args.businessDate)),
      inputs: args.inputs,
    });
  },

  /**
   * Weekly baseline work plan (B3): Emp × Branch × DayOfWeek only.
   * Source of truth remains weekly schedule + regular branch hours —
   * this normalizes them; it is NOT a new SoT.
   * Excludes daily late_start / early_leave / block / close_day / absence /
   * bookings / holds / exceptional hours.
   */
  normalizeWeeklyBaseline(
    inputs: WeeklyBaselineSourceInputs,
  ): NormalizedWeeklyBaselinePlan {
    return normalizeWeeklyBaselinePlan(inputs);
  },

  /** 5-minute availability bitmap from a normalized weekly baseline plan. */
  weeklyBaselineBitmap(plan: NormalizedWeeklyBaselinePlan): AvailabilityBitmap {
    return bitmapFromNormalizedWeeklyPlan(plan);
  },

  weeklyBaselineFingerprint(inputs: WeeklyBaselineSourceInputs): string {
    return weeklyBaselineSourceFingerprint(inputs);
  },

  /**
   * B4 — Effective day mask from weekly baseline + date layers.
   * Does not include bookings/holds. Does not use final day-plan as baseline.
   */
  buildEffectiveDay(args: {
    key: EffectiveDayKey;
    weeklyBaselineInputs: WeeklyBaselineSourceInputs;
    layers: EffectiveDayLayerInputs;
  }): EffectiveDayBuildResult {
    const plan = normalizeWeeklyBaselinePlan(args.weeklyBaselineInputs);
    const baselineBitmap = bitmapFromNormalizedWeeklyPlan(plan);
    const baselineFingerprint = weeklyBaselineSourceFingerprint(
      args.weeklyBaselineInputs,
    );
    return applyEffectiveDayLayers({
      key: args.key,
      baselinePlan: plan,
      baselineBitmap,
      baselineFingerprint,
      layers: args.layers,
    });
  },

  evaluateMinNotice(args: {
    interval: BookingInterval;
    nowMs: number;
    minNoticeMinutes: number;
  }): PolicyEvaluationDeny | null {
    // Match bookingAvailabilityEngine.evaluateBookingSlotAt: past starts are never bookable.
    if (args.interval.startAtMs <= args.nowMs) {
      return {
        ok: false,
        code: 'MIN_NOTICE_NOT_MET',
        meta: {
          reason: 'past',
          startAtMs: args.interval.startAtMs,
          nowMs: args.nowMs,
        },
      };
    }
    if (args.minNoticeMinutes <= 0) return null;
    const earliest = args.nowMs + args.minNoticeMinutes * 60_000;
    if (args.interval.startAtMs < earliest) {
      return {
        ok: false,
        code: 'MIN_NOTICE_NOT_MET',
        meta: {
          minNoticeMinutes: args.minNoticeMinutes,
          startAtMs: args.interval.startAtMs,
          earliestMs: earliest,
        },
      };
    }
    return null;
  },

  evaluateMaxAhead(args: {
    businessDate: BusinessDateString | string;
    now?: Date;
    maxBookingDaysAhead: number;
    timeZone?: string;
  }): PolicyEvaluationDeny | null {
    if (args.maxBookingDaysAhead <= 0) return null;
    const today = currentBusinessDate(args.now);
    const maxDate = shiftBusinessDate(today, args.maxBookingDaysAhead);
    const target = parseBusinessDate(args.businessDate);
    if (String(target) > String(maxDate)) {
      return {
        ok: false,
        code: 'MAX_ADVANCE_EXCEEDED',
        meta: { businessDate: target, maxDate, maxBookingDaysAhead: args.maxBookingDaysAhead },
      };
    }
    // Also reject clearly past operational days relative to today
    if (String(target) < String(today)) {
      return {
        ok: false,
        code: 'SLOT_UNAVAILABLE',
        meta: { reason: 'past_business_date', businessDate: target, today },
      };
    }
    return null;
  },

  /**
   * Full policy check for a proposed slot against a preloaded work-plan input set.
   * Absolute interval is primary; dayOffset accepted only as legacy input.
   */
  evaluateSlot(args: {
    employeeId: number;
    branchId: number | null;
    businessDate: BusinessDateString | string;
    /** Preferred: absolute clock on business day (+ optional calendarDayOffset). */
    startTimeHhmm: string;
    calendarDayOffset?: 0 | 1;
    /** Legacy compat — used only when calendarDayOffset omitted. */
    dayOffset?: 0 | 1 | number | null;
    durationMinutes: number;
    inputs: EmployeeDayPlanBatchInputs;
    settings: BookingPolicySettings;
    nowMs?: number;
    /** Busy intervals for this EmpID in ANY branch (global identity). */
    busyInAnyBranch?: Array<{
      branchId: number | null;
      startAtMs: number;
      endAtMs: number;
    }>;
  }): PolicyEvaluationResult {
    const businessDate = parseBusinessDate(args.businessDate);
    const timeZone = args.settings.timeZone ?? args.inputs.timezone ?? BOOKING_TZ;

    const nowDate = args.nowMs != null ? new Date(args.nowMs) : undefined;
    const maxDeny = BookingPolicy.evaluateMaxAhead({
      businessDate,
      now: nowDate,
      maxBookingDaysAhead: args.settings.maxBookingDaysAhead,
      timeZone,
    });
    if (maxDeny) return maxDeny;

    // Prefer calendarDayOffset; fall back to legacy dayOffset for compat only.
    const calendarDayOffset: 0 | 1 =
      args.calendarDayOffset === 0 || args.calendarDayOffset === 1
        ? args.calendarDayOffset
        : Number(args.dayOffset) === 1
          ? 1
          : 0;

    let interval: BookingInterval;
    try {
      interval = bookingIntervalFromBusinessClock({
        businessDate,
        startTimeHhmm: args.startTimeHhmm,
        durationMinutes: args.durationMinutes,
        calendarDayOffset,
        timeZone,
      });
    } catch {
      return { ok: false, code: 'INVALID_BOOKING_INTERVAL' };
    }

    const noticeDeny = BookingPolicy.evaluateMinNotice({
      interval,
      nowMs: args.nowMs ?? Date.now(),
      minNoticeMinutes: args.settings.minNoticeMinutes,
    });
    if (noticeDeny) return noticeDeny;

    const workPlan = BookingPolicy.buildWorkPlan({
      employeeId: args.employeeId,
      branchId: args.branchId,
      businessDate,
      inputs: args.inputs,
    });

    if (!workPlan.isWorking || !workPlan.effectiveWindows.length) {
      return {
        ok: false,
        code: mapDenyCode(workPlan),
        workPlan,
        meta: { denyReasonCode: workPlan.denyReasonCode },
      };
    }

    const inside = isIntervalInsideAnyEffectiveWindow({
      windows: workPlan.effectiveWindows,
      startMs: interval.startAtMs,
      endMs: interval.endAtMs,
    });
    if (!inside) {
      const containing = findWindowContainingInterval({
        windows: workPlan.effectiveWindows,
        startMs: interval.startAtMs,
        endMs: interval.endAtMs,
      });
      // Distinguish block vs outside using blocked intervals on effSched
      const blocked = (workPlan.effSched?.blockedIntervals ?? []).some(
        (b) => b.startMs < interval.endAtMs && b.endMs > interval.startAtMs,
      );
      if (blocked) {
        return {
          ok: false,
          code: 'BLOCKED_BY_RANGE',
          workPlan,
          meta: { containing },
        };
      }
      return {
        ok: false,
        code: 'OUTSIDE_WORKING_WINDOW',
        workPlan,
        meta: { containing },
      };
    }

    // Still deny if overlapping a blocked sub-interval inside a window
    const blockedHit = (workPlan.effSched?.blockedIntervals ?? []).some(
      (b) => b.startMs < interval.endAtMs && b.endMs > interval.startAtMs,
    );
    if (blockedHit) {
      return { ok: false, code: 'BLOCKED_BY_RANGE', workPlan };
    }

    if (args.busyInAnyBranch?.length) {
      const collision = assertSingleGlobalEmployeeResource({
        employeeId: args.employeeId,
        overlappingIntervalsInAnyBranch: args.busyInAnyBranch,
        candidate: { startAtMs: interval.startAtMs, endAtMs: interval.endAtMs },
      });
      if (!collision.ok) {
        return {
          ok: false,
          code: 'MULTI_BRANCH_RESOURCE_CONFLICT',
          workPlan,
          meta: {
            employeeResourceKey: globalEmployeeResourceKey(args.employeeId),
            conflictBranchId: collision.conflictBranchId,
          },
        };
      }
    }

    return {
      ok: true,
      interval,
      workPlan,
      duration: {
        durationMinutes: args.durationMinutes,
        totalDurationMinutes: args.durationMinutes,
        durationSource: 'SERVICE_DEFAULT',
      },
      employeeResourceKey: globalEmployeeResourceKey(args.employeeId),
    };
  },
};

/** @deprecated internal helper export for tests — prefer BookingPolicy */
export function addDaysYmd(date: string, days: number): string {
  return shiftCalendarDate(date, days);
}
