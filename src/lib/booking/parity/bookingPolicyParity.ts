/**
 * Booking V2 Phase B2.5 — pure parity harness.
 *
 * Compares BookingPolicy / EffectiveWorkPlan against the current engine decision
 * surface (`evaluateBookingSlotAt` + day-plan windows) and absolute interval
 * math used by `evaluatePublicBookingSelection` (absoluteBounds).
 *
 * No DB. No route/UI/create changes.
 */

import { evaluateBookingSlotAt } from '@/lib/bookingAvailabilityEngine';
import { EffectiveWorkPlanService } from '@/lib/booking/services/EffectiveWorkPlanService';
import { BookingPolicy } from '@/lib/booking/domain/BookingPolicy';
import {
  bookingIntervalFromLegacyDayOffset,
  bookingIntervalToIso,
} from '@/lib/booking/domain/BookingInterval';
import { BOOKING_TZ, businessDateTimeToEpochMs } from '@/lib/booking/domain/BusinessDate';
import { salonDateTimeToMs } from '@/lib/publicBookingHelpers';
import type { NormalizedBookingReadInputs } from '@/lib/booking/normalizedBookingReadInputs';
import { buildNormalizedBookingReadInputs } from '@/lib/booking/normalizedBookingReadInputs';

export type ParitySlotCase = {
  name: string;
  inputs: NormalizedBookingReadInputs;
  startTimeHhmm: string;
  dayOffset: 0 | 1;
};

export type ParityFieldMismatch = {
  field: string;
  policy: unknown;
  legacy: unknown;
};

export type ParityCaseResult = {
  name: string;
  matched: boolean;
  mismatches: ParityFieldMismatch[];
  policyAvailable: boolean;
  legacyAvailable: boolean;
};

function nextDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Mirrors publicBookingSelectionEvaluator.absoluteBounds (legacy path). */
export function legacyAbsoluteBounds(args: {
  workDate: string;
  time: string;
  dayOffset: 0 | 1;
  durationMinutes: number;
  timezone: string;
}): { startMs: number; endMs: number } {
  const slotDate = args.dayOffset === 1 ? nextDate(args.workDate) : args.workDate;
  const startMs = salonDateTimeToMs(slotDate, args.time, args.timezone);
  const endMs = startMs + args.durationMinutes * 60_000;
  return { startMs, endMs };
}

function mapPolicyAvailableToLegacyComparable(code: string | undefined, ok: boolean): boolean {
  return ok;
}

/**
 * Run one shadow parity comparison for EmpID + BranchID + WorkDate + duration + StartTime.
 */
export function compareBookingPolicyToLegacyEngine(caseArgs: ParitySlotCase): ParityCaseResult {
  const { inputs, startTimeHhmm, dayOffset, name } = caseArgs;
  const tz = inputs.settings.timeZone ?? BOOKING_TZ;
  const mismatches: ParityFieldMismatch[] = [];

  const workPlan = EffectiveWorkPlanService.buildFromInputs({
    employeeId: inputs.employeeId,
    branchId: inputs.branchId,
    businessDate: inputs.businessDate,
    inputs: inputs.dayPlanInputs,
  });

  const policy = BookingPolicy.evaluateSlot({
    employeeId: inputs.employeeId,
    branchId: inputs.branchId,
    businessDate: inputs.businessDate,
    startTimeHhmm,
    dayOffset,
    calendarDayOffset: dayOffset,
    durationMinutes: inputs.durationMinutes,
    inputs: inputs.dayPlanInputs,
    settings: inputs.settings,
    nowMs: inputs.nowMs,
    busyInAnyBranch: inputs.busyInAnyBranch.map((b) => ({
      branchId: b.branchId,
      startAtMs: b.startAtMs,
      endAtMs: b.endAtMs,
    })),
  });

  const legacyBounds = legacyAbsoluteBounds({
    workDate: inputs.businessDate,
    time: startTimeHhmm,
    dayOffset,
    durationMinutes: inputs.durationMinutes,
    timezone: tz,
  });
  const policyInterval = bookingIntervalFromLegacyDayOffset({
    businessDate: inputs.businessDate,
    timeHhmm: startTimeHhmm,
    dayOffset,
    durationMinutes: inputs.durationMinutes,
    timeZone: tz,
  });

  if (policyInterval.startAtMs !== legacyBounds.startMs) {
    mismatches.push({
      field: 'overnight_absolute_startMs',
      policy: policyInterval.startAtMs,
      legacy: legacyBounds.startMs,
    });
  }
  if (policyInterval.endAtMs !== legacyBounds.endMs) {
    mismatches.push({
      field: 'overnight_absolute_endMs',
      policy: policyInterval.endAtMs,
      legacy: legacyBounds.endMs,
    });
  }

  // Working windows: policy plan vs EffectiveWorkPlan (same builder — must match)
  const policyWindows = policy.ok
    ? policy.workPlan.effectiveWindows.map((w) => ({
        startMs: w.startMs,
        endMs: w.endMs,
        endDayOffset: w.endDayOffset,
      }))
    : workPlan.effectiveWindows.map((w) => ({
        startMs: w.startMs,
        endMs: w.endMs,
        endDayOffset: w.endDayOffset,
      }));
  const planWindows = workPlan.effectiveWindows.map((w) => ({
    startMs: w.startMs,
    endMs: w.endMs,
    endDayOffset: w.endDayOffset,
  }));
  if (JSON.stringify(policyWindows) !== JSON.stringify(planWindows)) {
    mismatches.push({
      field: 'working_windows',
      policy: policyWindows,
      legacy: planWindows,
    });
  }

  const busyForEngine = inputs.busyInAnyBranch.map((b) => ({
    start: new Date(b.startAtMs),
    end: new Date(b.endAtMs),
    source: b.source === 'queue' ? 'queue' : 'booking',
  }));

  const legacyEval = evaluateBookingSlotAt(
    legacyBounds.startMs,
    inputs.durationMinutes,
    busyForEngine,
    {
      effectiveWindows: workPlan.effectiveWindows,
      nowMs: inputs.nowMs,
      minNoticeMs: inputs.settings.minNoticeMinutes * 60_000,
      overrideBlock: (workPlan.effSched?.blockedIntervals ?? []).some(
        (b) => b.startMs < legacyBounds.endMs && b.endMs > legacyBounds.startMs,
      ),
    },
  );

  // When day plan denies work, engine typically has empty windows → unavailable.
  const legacyAvailable =
    workPlan.isWorking &&
    workPlan.effectiveWindows.length > 0 &&
    legacyEval.available &&
    !(workPlan.effSched?.blockedIntervals ?? []).some(
      (b) => b.startMs < legacyBounds.endMs && b.endMs > legacyBounds.startMs,
    );

  // Policy treats multi-branch busy as MULTI_BRANCH_RESOURCE_CONFLICT; engine as booking conflict.
  // Both must be unavailable when busy overlaps.
  const policyAvailable = mapPolicyAvailableToLegacyComparable(
    policy.ok ? undefined : policy.code,
    policy.ok,
  );

  if (policyAvailable !== legacyAvailable) {
    // Known semantic alias: policy may deny DAY_CLOSED / ABSENT before interval check;
    // legacy evaluateBookingSlotAt with empty windows also unavailable — already aligned.
    // If policy denies MAX_ADVANCE / MIN_NOTICE and legacy does too via options — aligned.
    mismatches.push({
      field: 'available_decision',
      policy: {
        available: policyAvailable,
        code: policy.ok ? null : policy.code,
      },
      legacy: {
        available: legacyAvailable,
        reasonCode: legacyEval.reasonCode ?? null,
        workPlanWorking: workPlan.isWorking,
        denyReasonCode: workPlan.denyReasonCode,
      },
    });
  }

  if (policy.ok && policy.duration.totalDurationMinutes !== inputs.durationMinutes) {
    mismatches.push({
      field: 'duration',
      policy: policy.duration.totalDurationMinutes,
      legacy: inputs.durationMinutes,
    });
  }

  // Absolute ISO ownership: BusinessDate stays board date when dayOffset=1
  if (dayOffset === 1) {
    const iso = bookingIntervalToIso(policyInterval);
    if (iso.businessDate !== inputs.businessDate) {
      mismatches.push({
        field: 'business_date_ownership',
        policy: iso.businessDate,
        legacy: inputs.businessDate,
      });
    }
    const expectedStart = businessDateTimeToEpochMs({
      businessDate: inputs.businessDate,
      clockTimeHhmm: startTimeHhmm,
      calendarDayOffset: 1,
      timeZone: tz,
    });
    if (policyInterval.startAtMs !== expectedStart) {
      mismatches.push({
        field: 'business_date_absolute_clock',
        policy: policyInterval.startAtMs,
        legacy: expectedStart,
      });
    }
  }

  return {
    name,
    matched: mismatches.length === 0,
    mismatches,
    policyAvailable,
    legacyAvailable,
  };
}

export function runBookingPolicyParitySuite(
  cases: ParitySlotCase[],
): {
  total: number;
  matched: number;
  mismatchCount: number;
  results: ParityCaseResult[];
} {
  const results = cases.map(compareBookingPolicyToLegacyEngine);
  const matched = results.filter((r) => r.matched).length;
  return {
    total: results.length,
    matched,
    mismatchCount: results.length - matched,
    results,
  };
}

export { buildNormalizedBookingReadInputs };
