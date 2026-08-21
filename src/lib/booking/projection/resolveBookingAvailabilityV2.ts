/**
 * Booking V2 B7A — unified availability resolver (read path).
 *
 * WeeklyBaseline → EffectiveDay → Booking/Hold/Queue occupancy → Composer → starts
 *
 * Duration is applied only at compose time (catalog-strict when caller passes
 * durationOverride matching public contract). Not wired as production cutover.
 */

import { AvailabilityBitmap } from '@/lib/booking/domain/AvailabilityBitmap';
import { BookingPolicy } from '@/lib/booking/domain/BookingPolicy';
import {
  applyEffectiveDayLayers,
  type EffectiveDayLayerInputs,
  type EffectiveDayChangeFlag,
} from '@/lib/booking/domain/EffectiveDay';
import type { WeeklyBaselineSourceInputs } from '@/lib/booking/domain/WeeklyBaseline';
import { AvailabilityComposer } from '@/lib/booking/projection/AvailabilityComposer';
import {
  deriveAvailabilityRevision,
  type AvailabilityRevisionParts,
} from '@/lib/booking/projection/AvailabilityRevision';
import { rebuildOccupancyDayFromIntervals } from '@/lib/booking/projection/OccupancyDayState';
import type { AbsoluteOccupancyInterval } from '@/lib/booking/projection/OccupancyTimeline';
import { parseDayOfWeek } from '@/lib/booking/domain/WeeklyBaseline';
import {
  startMinToV2Slot,
  type V2SlotStart,
} from '@/lib/booking/v2Frontend/v2SlotStart';

export type { V2SlotStart };
export { startMinToV2Slot };

export type V2EmployeeDayAvailability = {
  employeeId: number;
  branchId: number;
  businessDate: string;
  availableStarts: V2SlotStart[];
  freeRanges: Array<{ startMin: number; endMin: number }>;
  /** Optional precomputed FreeMask base64 (avoids re-encode on matrix path). */
  freeMaskB64?: string;
  availabilityRevision: string;
  changeMask: EffectiveDayChangeFlag[];
  reusedBaseline: boolean;
  durationMinutes: number;
  slotIntervalMinutes: number;
};

export type ResolveBookingAvailabilityV2Result = {
  days: V2EmployeeDayAvailability[];
  queryCount: number;
  composeMs: number;
  totalMs: number;
  dbMs: number;
};

export type ResolveBookingAvailabilityV2PreloadedDay = {
  employeeId: number;
  branchId: number;
  businessDate: string;
  weeklyBaselineInputs: WeeklyBaselineSourceInputs;
  layers: EffectiveDayLayerInputs;
  bookingIntervals: AbsoluteOccupancyInterval[];
  holdIntervals: AbsoluteOccupancyInterval[];
  queueIntervals: AbsoluteOccupancyInterval[];
  revisions?: Partial<AvailabilityRevisionParts>;
};

function dayOfWeekFromYmd(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

/**
 * Pure compose for one Emp×Branch×BusinessDate from preloaded SoT slices.
 * Used by unit tests and by the DB orchestrator after batch loads.
 */
export function composeEmployeeDayAvailabilityV2(args: {
  day: ResolveBookingAvailabilityV2PreloadedDay;
  durationMinutes: number;
  slotIntervalMinutes: number;
  nowMs?: number;
  /** Skip starts before now+minNotice (optional; shadow may disable). */
  minNoticeMinutes?: number;
  /** When false, skip start generation (matrix FreeMask path). Default true. */
  includeStarts?: boolean;
}): V2EmployeeDayAvailability {
  const { day } = args;
  const plan = BookingPolicy.normalizeWeeklyBaseline(day.weeklyBaselineInputs);
  const baselineBitmap = BookingPolicy.weeklyBaselineBitmap(plan);
  const applied = applyEffectiveDayLayers({
    key: {
      employeeId: day.employeeId,
      branchId: day.branchId,
      businessDate: day.businessDate,
    },
    baselinePlan: plan,
    baselineBitmap,
    baselineFingerprint: BookingPolicy.weeklyBaselineFingerprint(day.weeklyBaselineInputs),
    layers: day.layers,
  });
  const effectiveWorkMask = applied.bitmap;

  const bookingMask = rebuildOccupancyDayFromIntervals({
    key: { employeeId: day.employeeId, businessDate: day.businessDate },
    source: 'booking',
    intervals: day.bookingIntervals,
  }).mask;
  const holdMask = rebuildOccupancyDayFromIntervals({
    key: { employeeId: day.employeeId, businessDate: day.businessDate },
    source: 'hold',
    intervals: day.holdIntervals,
  }).mask;
  const queueMask = rebuildOccupancyDayFromIntervals({
    key: { employeeId: day.employeeId, businessDate: day.businessDate },
    source: 'queue',
    intervals: day.queueIntervals,
  }).mask;

  const revisions: AvailabilityRevisionParts = {
    effectiveWorkRevision: day.revisions?.effectiveWorkRevision ?? 1,
    bookingOccupancyRevision: day.revisions?.bookingOccupancyRevision ?? 1,
    holdOccupancyRevision: day.revisions?.holdOccupancyRevision ?? 1,
    queueOccupancyRevision: day.revisions?.queueOccupancyRevision ?? 1,
  };

  const composed = AvailabilityComposer.compose({
    effectiveWorkMask,
    bookingOccupancyMask: bookingMask,
    holdOccupancyMask: holdMask,
    queueOccupancyMask: queueMask,
    revisions,
  });

  let starts: number[] = [];
  if (args.includeStarts !== false) {
    starts = AvailabilityComposer.generateStarts({
      freeMask: composed.freeMask,
      durationMinutes: args.durationMinutes,
      slotIntervalMinutes: args.slotIntervalMinutes,
    });

    // Match bookingAvailabilityEngine evaluateBookingSlotAt:
    // - past: startAtMs <= nowMs
    // - minNotice: startAtMs < nowMs + minNoticeMs
    if (args.nowMs != null) {
      const minNotice = Math.max(0, args.minNoticeMinutes ?? 0);
      const minNoticeMs = minNotice * 60_000;
      const nowMs = args.nowMs;
      starts = starts.filter((m) => {
        const slot = startMinToV2Slot(m, day.businessDate);
        if (slot.startAtMs <= nowMs) return false;
        if (slot.startAtMs < nowMs + minNoticeMs) return false;
        return true;
      });
    }
  }

  return {
    employeeId: day.employeeId,
    branchId: day.branchId,
    businessDate: day.businessDate,
    availableStarts: starts.map((m) => startMinToV2Slot(m, day.businessDate)),
    freeRanges: composed.freeRanges,
    availabilityRevision:
      composed.availabilityRevision ?? deriveAvailabilityRevision(revisions),
    changeMask: [...applied.changeMask],
    reusedBaseline: applied.reusedBaseline,
    durationMinutes: args.durationMinutes,
    slotIntervalMinutes: args.slotIntervalMinutes,
  };
}

/**
 * Pure multi-day resolver from preloaded inputs (no DB).
 */
export function resolveBookingAvailabilityV2FromPreloaded(args: {
  days: ResolveBookingAvailabilityV2PreloadedDay[];
  durationMinutes: number;
  slotIntervalMinutes?: number;
  nowMs?: number;
  minNoticeMinutes?: number;
  includeStarts?: boolean;
}): ResolveBookingAvailabilityV2Result {
  const t0 = performance.now();
  const slotInterval = args.slotIntervalMinutes ?? 15;
  const out: V2EmployeeDayAvailability[] = [];
  const tCompose = performance.now();
  for (const day of args.days) {
    // Ensure weekly key DOW matches businessDate when caller omitted consistency.
    const dow = parseDayOfWeek(dayOfWeekFromYmd(day.businessDate));
    const weekly = {
      ...day.weeklyBaselineInputs,
      key: {
        ...day.weeklyBaselineInputs.key,
        dayOfWeek: day.weeklyBaselineInputs.key.dayOfWeek ?? dow,
      },
    };
    out.push(
      composeEmployeeDayAvailabilityV2({
        day: { ...day, weeklyBaselineInputs: weekly },
        durationMinutes: args.durationMinutes,
        slotIntervalMinutes: slotInterval,
        nowMs: args.nowMs,
        minNoticeMinutes: args.minNoticeMinutes,
        includeStarts: args.includeStarts,
      }),
    );
  }
  const composeMs = performance.now() - tCompose;
  return {
    days: out,
    queryCount: 0,
    composeMs,
    totalMs: performance.now() - t0,
    dbMs: 0,
  };
}

export { dayOfWeekFromYmd };
