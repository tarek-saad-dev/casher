/**
 * Phase 2.5 / 3A / 3B.2 — Read-only availability explain engine.
 */

import type { Transaction } from 'mssql';
import {
  resolveEmployeeDayPlan,
  type DayPlanWindow,
  type EmployeeDayPlan,
} from '@/lib/availability/resolveEmployeeDayPlan';
import {
  findContainingWindow,
  findWindowContainingInterval,
  iterateEffectiveWindows,
  normalizeEffectiveWindows,
  selectPrimaryEffectiveWindow,
} from '@/lib/availability/effectiveWindows';
import type { AvailabilityReasonCode } from '@/lib/availability/reasonCodes';
import { applyOverrides, type ScheduleOverride } from '@/lib/scheduleOverrides';
import type { DayPlanAttendanceState } from '@/lib/availability/loadEmployeeDayPlanInputsBatch';
import type {
  DailyAdjustmentState,
  EmployeeDailyAdjustment,
} from '@/lib/availability/dailyAdjustments';
import {
  applyDailyAdjustments,
  type AppliedBlockedInterval,
} from '@/lib/availability/applyDailyAdjustments';
import { salonDateTimeToMs } from '@/lib/publicBookingHelpers';
import { SALON_TZ } from '@/lib/businessDate';
import type {
  AvailabilityLayerKey,
  AvailabilityLayerSnapshot,
  AvailabilityLayerStatus,
  BlockedIntervalView,
} from '@/lib/availability/buildAvailabilityLayers';

export type AvailabilityExplainResult =
  | 'available'
  | 'blocked'
  | 'outside_shift'
  | 'day_off'
  | 'absent'
  | 'not_configured'
  | 'freelancer_not_planned'
  | 'inactive_or_unassigned'
  | 'closed_by_adjustment'
  | 'no_usable_window';

export type AvailabilityExplanation = {
  employeeId: number;
  businessDate: string;
  branchId: number | null;
  result: AvailabilityExplainResult;
  reasonCode: AvailabilityReasonCode | null;
  scheduleSource: EmployeeDayPlan['baseScheduleSource'];
  windows: DayPlanWindow[];
  primaryWindow: DayPlanWindow | null;
  attendance: DayPlanAttendanceState | null;
  overrides: ScheduleOverride[];
  transfer: boolean;
  freelance: boolean;
  blockedIntervals: Array<{
    startMs: number;
    endMs: number;
    reason: string | null;
  }>;
  warnings: string[];
  dailyAdjustments: EmployeeDailyAdjustment[];
  dailyAdjustmentState: DailyAdjustmentState;
  evaluationTimeline: Array<{
    step: string;
    detail: string;
    atMs?: number;
  }>;
  /** Phase 3B.2 — structured layer pipeline (additive). */
  layers: ExplainLayerEntry[];
  plan: EmployeeDayPlan;
};

export type ExplainLayerEntry = {
  key: AvailabilityLayerKey;
  order: number;
  applied: boolean;
  status: AvailabilityLayerStatus;
  inputSummary: unknown;
  outputSummary: unknown;
  effectCode: string | null;
  warnings: string[];
  snapshot?: AvailabilityLayerSnapshot | null;
};

function mapResult(plan: EmployeeDayPlan): AvailabilityExplainResult {
  if (plan.isWorking && plan.effSched?.isWorking) {
    if ((plan.effSched.blockedIntervals?.length ?? 0) > 0) return 'blocked';
    return 'available';
  }
  switch (plan.denyReasonCode) {
    case 'EMPLOYEE_ABSENT':
      return 'absent';
    case 'EMPLOYEE_OFF_DAY':
      return 'day_off';
    case 'SCHEDULE_NOT_CONFIGURED':
      return 'not_configured';
    case 'FREELANCER_NOT_PLANNED':
      return 'freelancer_not_planned';
    case 'EMPLOYEE_INACTIVE':
    case 'NOT_ASSIGNED_TO_BRANCH':
      return 'inactive_or_unassigned';
    case 'OUTSIDE_WORKING_WINDOW':
      return 'outside_shift';
    case 'BLOCKED_BY_OVERRIDE':
    case 'BLOCKED_BY_DAILY_ADJUSTMENT':
      return 'blocked';
    case 'DAY_CLOSED_BY_ADJUSTMENT':
      return 'closed_by_adjustment';
    case 'NO_USABLE_WINDOW_AFTER_ADJUSTMENTS':
      return 'no_usable_window';
    default:
      return plan.baseScheduleSource === 'NONE' ? 'not_configured' : 'outside_shift';
  }
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function nextDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function toBlockedView(
  list: Array<{ startMs: number; endMs: number; reason?: string | null }>,
): BlockedIntervalView[] {
  return list.map((b) => ({
    startMs: b.startMs,
    endMs: b.endMs,
    reason: b.reason ?? null,
  }));
}

function windowsFromHhmm(
  businessDate: string,
  start: string,
  end: string,
  timezone: string,
): DayPlanWindow[] {
  const overnight = hhmmToMinutes(end) <= hhmmToMinutes(start);
  const startMs = salonDateTimeToMs(businessDate, start, timezone);
  const endMs = overnight
    ? salonDateTimeToMs(nextDate(businessDate), end, timezone)
    : salonDateTimeToMs(businessDate, end, timezone);
  if (!(endMs > startMs)) return [];
  return [
    {
      start,
      end,
      endDayOffset: overnight ? 1 : 0,
      startMs,
      endMs,
    },
  ];
}

function snapshotOf(args: {
  beforeWindows: DayPlanWindow[];
  afterWindows: DayPlanWindow[];
  beforeBlocked?: BlockedIntervalView[];
  afterBlocked?: BlockedIntervalView[];
  effectCode: string | null;
}): AvailabilityLayerSnapshot {
  return {
    beforeWindows: args.beforeWindows,
    afterWindows: args.afterWindows,
    beforeBlockedIntervals: args.beforeBlocked ?? [],
    afterBlockedIntervals: args.afterBlocked ?? [],
    availabilityBefore: args.beforeWindows.length > 0,
    availabilityAfter: args.afterWindows.length > 0,
    effectCode: args.effectCode,
  };
}

/**
 * Pure layer pipeline + before/after snapshots from an already-resolved plan.
 * Replays applyOverrides / applyDailyAdjustments — no SQL.
 */
export function buildExplainLayers(plan: EmployeeDayPlan): ExplainLayerEntry[] {
  const timezone = SALON_TZ;
  const weekly = plan.weeklyWindows;
  const absent =
    plan.denyReasonCode === 'EMPLOYEE_ABSENT' ||
    plan.attendanceState?.status === 'Absent';

  let rawBase: DayPlanWindow[] = [];
  if (weekly?.isWorkingDay && weekly.startTime && weekly.endTime) {
    rawBase = windowsFromHhmm(
      plan.businessDate,
      weekly.startTime,
      weekly.endTime,
      timezone,
    );
  }

  const overrides = plan.appliedOverrides ?? [];
  const legacyBase =
    weekly && weekly.isWorkingDay && weekly.startTime && weekly.endTime
      ? { isWorking: true, start: weekly.startTime, end: weekly.endTime }
      : { isWorking: false, start: '00:00', end: '00:00' };
  const legacyEff = applyOverrides(
    plan.employeeId,
    plan.businessDate,
    legacyBase,
    overrides,
  );

  let afterLegacyWindows: DayPlanWindow[] = [];
  let afterLegacyBlocked: AppliedBlockedInterval[] = [];
  if (legacyEff.isWorking && legacyEff.start && legacyEff.end) {
    afterLegacyWindows = windowsFromHhmm(
      plan.businessDate,
      legacyEff.start,
      legacyEff.end,
      timezone,
    );
    afterLegacyBlocked = (legacyEff.blockedIntervals ?? []).map((iv) => ({
      startMs: iv.startMs,
      endMs: iv.endMs,
      reason: iv.reason,
    }));
  }

  const afterAttendanceWindows = absent ? [] : afterLegacyWindows;
  const afterAttendanceBlocked = absent ? [] : afterLegacyBlocked;

  const appliedAdj = applyDailyAdjustments({
    employeeId: plan.employeeId,
    businessDate: plan.businessDate,
    baseWindows: afterAttendanceWindows,
    baseBlockedIntervals: afterAttendanceBlocked,
    adjustments: plan.dailyAdjustments ?? [],
    timezone,
  });

  const finalWindows = iterateEffectiveWindows(plan.effectiveWindows);
  const finalBlocked = toBlockedView(
    (plan.effSched?.blockedIntervals ?? []).map((b) => ({
      startMs: b.startMs,
      endMs: b.endMs,
      reason: b.reason ?? null,
    })),
  );

  const isTransfer = plan.baseScheduleSource === 'TEMPORARY_TRANSFER';
  const isFreelance = plan.baseScheduleSource === 'FREELANCE_UNLOCK';

  return [
    {
      key: 'EMPLOYMENT',
      order: 1,
      applied: true,
      status: 'INFORMATIONAL',
      inputSummary: { employeeId: plan.employeeId },
      outputSummary: { branchId: plan.branchId },
      effectCode: null,
      warnings: [],
      // Employment identity does not open/close windows — omit empty snapshot
      // so the UI does not show misleading "unavailable / no windows".
      snapshot: null,
    },
    {
      key: 'BASE_SCHEDULE',
      order: 2,
      applied: rawBase.length > 0,
      status: rawBase.length ? 'APPLIED' : 'NO_DATA',
      inputSummary: { weeklyWindows: weekly, source: plan.baseScheduleSource },
      outputSummary: { windows: rawBase },
      effectCode: rawBase.length ? 'BASE_WINDOWS' : 'NO_BASE',
      warnings: [],
      snapshot: snapshotOf({
        beforeWindows: [],
        afterWindows: rawBase,
        effectCode: rawBase.length
          ? 'BASE_WINDOWS'
          : weekly && weekly.isWorkingDay === false
            ? 'WEEKLY_DAY_OFF'
            : 'NO_BASE',
      }),
    },
    {
      key: 'TRANSFER_OR_FREELANCE',
      order: 3,
      applied: isTransfer || isFreelance,
      status: isTransfer || isFreelance ? 'APPLIED' : 'NO_DATA',
      inputSummary: {
        transfer: isTransfer,
        freelance: isFreelance,
        source: plan.baseScheduleSource,
      },
      outputSummary: { windows: rawBase },
      effectCode: isTransfer
        ? 'TEMPORARY_TRANSFER'
        : isFreelance
          ? 'FREELANCE_UNLOCK'
          : null,
      warnings: [],
      snapshot: snapshotOf({
        beforeWindows: rawBase,
        afterWindows: rawBase,
        effectCode: isTransfer
          ? 'TEMPORARY_TRANSFER'
          : isFreelance
            ? 'FREELANCE_UNLOCK'
            : null,
      }),
    },
    {
      key: 'LEGACY_OVERRIDES',
      order: 4,
      applied: overrides.length > 0,
      status: overrides.length
        ? (plan.dailyAdjustments?.length ? 'OVERRIDDEN' : 'APPLIED')
        : 'NO_DATA',
      inputSummary: { overrides: overrides.map((o) => o.Type), before: rawBase },
      outputSummary: { windows: afterLegacyWindows, blocked: afterLegacyBlocked },
      effectCode: overrides.length ? overrides.map((o) => o.Type).join(',') : null,
      warnings: [],
      snapshot: snapshotOf({
        beforeWindows: rawBase,
        afterWindows: afterLegacyWindows,
        beforeBlocked: [],
        afterBlocked: toBlockedView(afterLegacyBlocked),
        effectCode: overrides.length ? overrides.map((o) => o.Type).join(',') : null,
      }),
    },
    {
      key: 'ATTENDANCE',
      order: 5,
      applied: !!plan.attendanceState || absent,
      status: absent ? 'BLOCKING' : plan.attendanceState ? 'INFORMATIONAL' : 'NO_DATA',
      inputSummary: { attendance: plan.attendanceState },
      outputSummary: {
        windows: afterAttendanceWindows,
        deny: absent ? 'EMPLOYEE_ABSENT' : null,
      },
      effectCode: absent ? 'EMPLOYEE_ABSENT' : plan.attendanceState?.status ?? null,
      warnings: absent ? ['Absence cannot be reopened by daily adjustments'] : [],
      snapshot: snapshotOf({
        beforeWindows: afterLegacyWindows,
        afterWindows: afterAttendanceWindows,
        beforeBlocked: toBlockedView(afterLegacyBlocked),
        afterBlocked: toBlockedView(afterAttendanceBlocked),
        effectCode: absent ? 'EMPLOYEE_ABSENT' : null,
      }),
    },
    {
      key: 'DAILY_ADJUSTMENTS',
      order: 6,
      applied: (plan.dailyAdjustments?.length ?? 0) > 0,
      status: appliedAdj.closedByAdjustment
        ? 'BLOCKING'
        : (plan.dailyAdjustments?.length ?? 0) > 0
          ? 'APPLIED'
          : 'NO_DATA',
      inputSummary: {
        adjustments: (plan.dailyAdjustments ?? []).map((a) => a.adjustmentType),
        state: plan.dailyAdjustmentState,
      },
      outputSummary: {
        windows: appliedAdj.effectiveWindows,
        blocked: appliedAdj.blockedIntervals,
        closed: appliedAdj.closedByAdjustment,
      },
      effectCode:
        plan.dailyAdjustmentState !== 'NONE' ? plan.dailyAdjustmentState : null,
      warnings: appliedAdj.warnings,
      snapshot: snapshotOf({
        beforeWindows: afterAttendanceWindows,
        afterWindows: appliedAdj.effectiveWindows,
        beforeBlocked: toBlockedView(afterAttendanceBlocked),
        afterBlocked: toBlockedView(appliedAdj.blockedIntervals),
        effectCode:
          plan.dailyAdjustmentState !== 'NONE' ? plan.dailyAdjustmentState : null,
      }),
    },
    {
      key: 'FINAL_RESULT',
      order: 7,
      applied: true,
      status: plan.isWorking ? 'APPLIED' : plan.denyReasonCode ? 'BLOCKING' : 'NO_DATA',
      inputSummary: { fromAdjustments: appliedAdj.effectiveWindows },
      outputSummary: {
        isWorking: plan.isWorking,
        windows: finalWindows,
        denyReasonCode: plan.denyReasonCode,
        blocked: finalBlocked,
      },
      effectCode: plan.denyReasonCode ?? (plan.isWorking ? 'AVAILABLE' : 'UNAVAILABLE'),
      warnings: [...plan.warnings],
      snapshot: snapshotOf({
        beforeWindows: appliedAdj.effectiveWindows,
        afterWindows: finalWindows,
        beforeBlocked: toBlockedView(appliedAdj.blockedIntervals),
        afterBlocked: finalBlocked,
        effectCode: plan.denyReasonCode ?? (plan.isWorking ? 'AVAILABLE' : 'UNAVAILABLE'),
      }),
    },
  ];
}

function buildTimeline(plan: EmployeeDayPlan): AvailabilityExplanation['evaluationTimeline'] {
  const timeline: AvailabilityExplanation['evaluationTimeline'] = [];
  timeline.push({
    step: 'BASE_BRANCH_WEEKLY_SELECTED',
    detail: `source=${plan.baseScheduleSource} weeklyWorking=${plan.weeklyWindows?.isWorkingDay ?? false}`,
  });

  if (plan.appliedOverrides.length) {
    timeline.push({
      step: 'LEGACY_OVERRIDE_APPLIED',
      detail: plan.appliedOverrides.map((o) => o.Type).join(','),
    });
  }

  for (const adj of plan.dailyAdjustments ?? []) {
    if (adj.adjustmentType === 'CLOSE_DAY') {
      timeline.push({ step: 'DAILY_CLOSE_APPLIED', detail: `id=${adj.adjustmentId}` });
    } else if (adj.adjustmentType === 'REPLACE_WINDOWS') {
      timeline.push({
        step: 'DAILY_REPLACE_APPLIED',
        detail: `id=${adj.adjustmentId} windows=${adj.windows.length}`,
      });
    } else if (adj.adjustmentType === 'ADD_WINDOW') {
      timeline.push({
        step: 'DAILY_WINDOW_ADDED',
        detail: `id=${adj.adjustmentId} windows=${adj.windows.length}`,
      });
    } else if (adj.adjustmentType === 'BLOCK_WINDOW') {
      timeline.push({
        step: 'DAILY_BLOCK_APPLIED',
        detail: `id=${adj.adjustmentId} windows=${adj.windows.length}`,
      });
    }
  }

  if (plan.denyReasonCode === 'EMPLOYEE_ABSENT') {
    timeline.push({ step: 'ATTENDANCE_ABSENT_DENIED', detail: 'Absent' });
  }

  const windows = iterateEffectiveWindows(plan.effectiveWindows);
  timeline.push({
    step: 'FINAL_WINDOWS_NORMALIZED',
    detail: windows.length
      ? windows.map((w) => `${w.start}-${w.end}`).join(' | ')
      : '(none)',
    atMs: windows[0]?.startMs,
  });

  if (plan.denyReasonCode) {
    timeline.push({ step: 'deny', detail: plan.denyReasonCode });
  } else if (plan.isWorking) {
    timeline.push({ step: 'result', detail: 'available' });
  }

  for (const w of plan.warnings) {
    timeline.push({ step: 'warning', detail: w });
  }
  return timeline;
}

export function explainEmployeeDayPlan(plan: EmployeeDayPlan): AvailabilityExplanation {
  const windows = iterateEffectiveWindows(plan.effectiveWindows);
  const primaryWindow = selectPrimaryEffectiveWindow(windows);
  return {
    employeeId: plan.employeeId,
    businessDate: plan.businessDate,
    branchId: plan.branchId,
    result: mapResult(plan),
    reasonCode: plan.denyReasonCode,
    scheduleSource: plan.baseScheduleSource,
    windows,
    primaryWindow,
    attendance: plan.attendanceState,
    overrides: plan.appliedOverrides,
    transfer: plan.baseScheduleSource === 'TEMPORARY_TRANSFER',
    freelance: plan.baseScheduleSource === 'FREELANCE_UNLOCK',
    blockedIntervals: (plan.effSched?.blockedIntervals ?? []).map((iv) => ({
      startMs: iv.startMs,
      endMs: iv.endMs,
      reason: iv.reason ?? null,
    })),
    warnings: [...plan.warnings],
    dailyAdjustments: plan.dailyAdjustments ?? [],
    dailyAdjustmentState: plan.dailyAdjustmentState ?? 'NONE',
    evaluationTimeline: buildTimeline(plan),
    layers: buildExplainLayers(plan),
    plan,
  };
}

export async function explainAvailability(args: {
  empId: number;
  businessDate: string;
  branchId?: number | null;
  source?: 'public' | 'operations' | 'admin';
  transaction?: Transaction;
}): Promise<AvailabilityExplanation> {
  const plan = await resolveEmployeeDayPlan({
    empId: args.empId,
    businessDate: args.businessDate,
    branchId: args.branchId ?? null,
    source: args.source ?? 'operations',
    transaction: args.transaction,
  });
  return explainEmployeeDayPlan(plan);
}

export type IntervalExplainResult =
  | 'AVAILABLE'
  | 'OUTSIDE_ALL_WINDOWS'
  | 'CROSSES_WINDOW_BOUNDARY'
  | 'BLOCKED'
  | 'ABSENT'
  | 'DAY_CLOSED'
  | 'INVALID_INTERVAL';

export type AvailabilityIntervalExplanation = {
  result: IntervalExplainResult;
  reasonCode: AvailabilityReasonCode | null;
  containingWindow: DayPlanWindow | null;
  checkedWindows: DayPlanWindow[];
  intersectsBlockedInterval: boolean;
  intersectedBlock?: {
    startMs: number;
    endMs: number;
    reason?: string;
  } | null;
};

/**
 * Phase 3C — pure interval-aware explain from an already-resolved plan.
 * Spec name: explainEmployeeDayPlanInterval.
 */
export function explainEmployeeDayPlanInterval(args: {
  plan: EmployeeDayPlan;
  startMs: number;
  endMs: number;
}): AvailabilityIntervalExplanation {
  return explainAvailabilityIntervalFromPlan(args);
}

/**
 * Phase 3C — interval-aware explain (pure when plan is provided).
 * No duplicate DB resolve when `plan` is already available.
 */
export function explainAvailabilityIntervalFromPlan(args: {
  plan: EmployeeDayPlan;
  startMs: number;
  endMs: number;
}): AvailabilityIntervalExplanation {
  const { plan, startMs, endMs } = args;
  const checkedWindows = normalizeEffectiveWindows(plan.effectiveWindows);

  if (plan.denyReasonCode === 'EMPLOYEE_ABSENT') {
    return {
      containingWindow: null,
      checkedWindows,
      intersectsBlockedInterval: false,
      intersectedBlock: null,
      result: 'ABSENT',
      reasonCode: 'EMPLOYEE_ABSENT',
    };
  }
  if (
    plan.denyReasonCode === 'DAY_CLOSED_BY_ADJUSTMENT'
    || plan.dailyAdjustmentState === 'CLOSED'
  ) {
    return {
      containingWindow: null,
      checkedWindows,
      intersectsBlockedInterval: false,
      intersectedBlock: null,
      result: 'DAY_CLOSED',
      reasonCode: plan.denyReasonCode ?? 'DAY_CLOSED_BY_ADJUSTMENT',
    };
  }

  const blocked = plan.effSched?.blockedIntervals ?? [];

  if (!(endMs > startMs)) {
    return {
      containingWindow: null,
      checkedWindows,
      intersectsBlockedInterval: false,
      intersectedBlock: null,
      result: 'INVALID_INTERVAL',
      reasonCode: 'OUTSIDE_WORKING_WINDOW',
    };
  }

  const hitBlock = blocked.find((b) => startMs < b.endMs && endMs > b.startMs);
  const intersectsBlockedInterval = !!hitBlock;
  const intersectedBlock = hitBlock
    ? { startMs: hitBlock.startMs, endMs: hitBlock.endMs, reason: hitBlock.reason }
    : null;

  const containing = findWindowContainingInterval({
    windows: checkedWindows,
    startMs,
    endMs,
  });
  if (containing) {
    if (intersectsBlockedInterval) {
      const reason = hitBlock?.reason ?? '';
      let reasonCode: AvailabilityReasonCode = 'BLOCKED_BY_OVERRIDE';
      if (reason.startsWith('daily_adjustment') || reason.includes('daily')) {
        reasonCode = 'BLOCKED_BY_DAILY_ADJUSTMENT';
      } else if (reason.toLowerCase().includes('break')) {
        reasonCode = 'BLOCKED_BY_BREAK';
      }
      return {
        containingWindow: containing,
        checkedWindows,
        intersectsBlockedInterval: true,
        intersectedBlock,
        result: 'BLOCKED',
        reasonCode,
      };
    }
    return {
      containingWindow: containing,
      checkedWindows,
      intersectsBlockedInterval: false,
      intersectedBlock: null,
      result: 'AVAILABLE',
      reasonCode: null,
    };
  }

  const pointWin = findContainingWindow(checkedWindows, startMs);
  if (pointWin && endMs > pointWin.endMs) {
    return {
      containingWindow: null,
      checkedWindows,
      intersectsBlockedInterval,
      intersectedBlock,
      result: 'CROSSES_WINDOW_BOUNDARY',
      reasonCode: 'NO_CONTIGUOUS_WINDOW',
    };
  }

  return {
    containingWindow: null,
    checkedWindows,
    intersectsBlockedInterval,
    intersectedBlock,
    result: 'OUTSIDE_ALL_WINDOWS',
    reasonCode: 'OUTSIDE_WORKING_WINDOW',
  };
}

export async function explainAvailabilityInterval(args: {
  empId: number;
  branchId?: number | null;
  businessDate: string;
  startMs: number;
  endMs: number;
  transaction?: Transaction;
  /** When provided, skips resolve. */
  plan?: EmployeeDayPlan;
}): Promise<AvailabilityIntervalExplanation> {
  const plan =
    args.plan
    ?? (await resolveEmployeeDayPlan({
      empId: args.empId,
      businessDate: args.businessDate,
      branchId: args.branchId ?? null,
      source: 'operations',
      transaction: args.transaction,
    }));
  return explainAvailabilityIntervalFromPlan({
    plan,
    startMs: args.startMs,
    endMs: args.endMs,
  });
}
