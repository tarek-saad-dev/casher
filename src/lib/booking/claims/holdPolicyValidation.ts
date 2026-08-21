/**
 * B6.5 — Hold business-policy validation (BookingPolicy / day-plan semantics).
 * Slot claims only guard EmpID×slot collision; this guards business validity.
 */

import { createBookingInterval } from '@/lib/booking/domain/BookingInterval';
import { BOOKING_TZ } from '@/lib/booking/domain/BusinessDate';
import { BookingPolicy } from '@/lib/booking/domain/BookingPolicy';
import { loadEmployeeDayPlanInputsBatch } from '@/lib/availability/loadEmployeeDayPlanInputsBatch';
import { getGlobalTimingDefaults } from '@/lib/publicBookingHelpers';
import { validateBookingSlot } from '@/lib/bookingAvailabilityEngine';
import { logSlotClaimShadowEvent } from '@/lib/booking/claims/slotClaimShadowTelemetry';

export type HoldPolicyMode = 'off' | 'shadow' | 'enforce';

export function resolveHoldPolicyMode(
  env: NodeJS.ProcessEnv = process.env,
): HoldPolicyMode {
  const raw = String(env.BOOKING_V2_HOLD_POLICY_MODE ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'off') return 'off';
  if (raw === 'shadow') return 'shadow';
  if (raw === 'enforce' || raw === 'on' || raw === '1' || raw === 'true') {
    return 'enforce';
  }
  // Default: when slot claims are active, enforce hold policy; else off.
  const claims = String(env.BOOKING_V2_SLOT_CLAIMS_MODE ?? 'off')
    .trim()
    .toLowerCase();
  if (claims === 'shadow' || claims === 'enforce' || claims === 'on' || claims === '1') {
    return 'enforce';
  }
  return 'off';
}

export type HoldPolicyValidationResult = {
  ok: boolean;
  code: string | null;
  source: 'booking_policy' | 'validate_booking_slot' | 'skipped';
  interval: {
    businessDate: string;
    startAtMs: number;
    endAtMs: number;
    startTimeHhmm: string;
    dayOffset: 0 | 1;
    durationMinutes: number;
  } | null;
  meta?: Record<string, unknown>;
};

export class HoldPolicyDeniedError extends Error {
  readonly code: string;
  readonly meta: Record<string, unknown>;
  constructor(code: string, meta: Record<string, unknown> = {}) {
    super(code);
    this.name = 'HoldPolicyDeniedError';
    this.code = code;
    this.meta = meta;
  }
}

/**
 * Validate hold interval against BookingPolicy (+ optional live busy via validateBookingSlot).
 * Does not create holds or claims.
 */
export async function validateHoldAgainstBookingPolicy(args: {
  empId: number;
  branchId: number;
  businessDate: string;
  startAt: Date;
  endAt: Date;
  /** Prefer live busy check for create/hold parity. */
  includeBusyCheck?: boolean;
  requestId?: string | null;
  nowMs?: number;
}): Promise<HoldPolicyValidationResult> {
  const mode = resolveHoldPolicyMode();
  if (mode === 'off') {
    return { ok: true, code: null, source: 'skipped', interval: null };
  }

  const startAtMs = args.startAt.getTime();
  const endAtMs = args.endAt.getTime();
  if (!(endAtMs > startAtMs)) {
    const denied: HoldPolicyValidationResult = {
      ok: false,
      code: 'HOLD_INVALID_INTERVAL',
      source: 'booking_policy',
      interval: null,
    };
    if (mode === 'enforce') {
      throw new HoldPolicyDeniedError('HOLD_INVALID_INTERVAL');
    }
    return denied;
  }

  const settings = await getGlobalTimingDefaults();
  const timeZone = settings.timezone || BOOKING_TZ;
  let interval;
  try {
    interval = createBookingInterval({
      businessDate: args.businessDate,
      startAtMs,
      endAtMs,
      timeZone,
    });
  } catch {
    const denied: HoldPolicyValidationResult = {
      ok: false,
      code: 'HOLD_INVALID_INTERVAL',
      source: 'booking_policy',
      interval: null,
    };
    if (mode === 'enforce') {
      throw new HoldPolicyDeniedError('HOLD_INVALID_INTERVAL');
    }
    return denied;
  }

  const durationMinutes = Math.max(
    1,
    Math.round((endAtMs - startAtMs) / 60_000),
  );
  const intervalMeta = {
    businessDate: interval.businessDate,
    startAtMs,
    endAtMs,
    startTimeHhmm: interval.legacyStartTimeHhmm,
    dayOffset: interval.legacyDayOffset,
    durationMinutes,
  };

  // Primary: BookingPolicy (windows / attendance / blocks / minNotice / maxAhead).
  const inputs = await loadEmployeeDayPlanInputsBatch({
    branchId: args.branchId,
    empIds: [args.empId],
    businessDate: interval.businessDate,
  });
  const policy = BookingPolicy.evaluateSlot({
    employeeId: args.empId,
    branchId: args.branchId,
    businessDate: interval.businessDate,
    startTimeHhmm: interval.legacyStartTimeHhmm,
    calendarDayOffset: interval.legacyDayOffset,
    durationMinutes,
    inputs,
    settings: {
      minNoticeMinutes: settings.minNoticeMinutes ?? 0,
      maxBookingDaysAhead: settings.maxBookingDaysAhead ?? 30,
      timeZone,
    },
    nowMs: args.nowMs ?? Date.now(),
  });

  let ok = policy.ok;
  let code = policy.ok ? null : String(policy.code);
  let source: HoldPolicyValidationResult['source'] = 'booking_policy';

  // Secondary parity with create path: live busy/queue via engine (collision still dual-guarded by claims).
  if (ok && args.includeBusyCheck !== false) {
    const validation = await validateBookingSlot({
      date: interval.businessDate,
      time: interval.legacyStartTimeHhmm,
      dayOffset: interval.legacyDayOffset,
      serviceIds: [],
      mode: 'specific',
      empId: args.empId,
      source: 'public',
      branchId: args.branchId,
      durationOverride: durationMinutes,
      skipNextAvailableWhenOk: true,
    });
    source = 'validate_booking_slot';
    if (!validation.available) {
      ok = false;
      code = String(validation.reasonCode ?? 'SLOT_UNAVAILABLE');
    }
  }

  const result: HoldPolicyValidationResult = {
    ok,
    code,
    source,
    interval: intervalMeta,
    meta: 'meta' in policy ? policy.meta : undefined,
  };

  if (!ok) {
    logSlotClaimShadowEvent({
      operation: 'hold_policy',
      requestId: args.requestId ?? null,
      empId: args.empId,
      branchId: args.branchId,
      businessDate: interval.businessDate,
      startAtMs,
      endAtMs,
      legacyDecision: 'deny',
      claimDecision: 'n/a',
      mismatchCategory: 'none',
      reasonCode: code,
      extra: { holdPolicyMode: mode, source },
    });
    if (mode === 'enforce') {
      throw new HoldPolicyDeniedError(code ?? 'SLOT_UNAVAILABLE', {
        source,
        businessDate: interval.businessDate,
      });
    }
  }

  return result;
}
