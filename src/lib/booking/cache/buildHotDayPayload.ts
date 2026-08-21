/**
 * Booking V2 B8 — bridge: preloaded SoT day → hot cache payload (no duration slots).
 */

import { AvailabilityBitmap } from '@/lib/booking/domain/AvailabilityBitmap';
import { BookingPolicy } from '@/lib/booking/domain/BookingPolicy';
import { applyEffectiveDayLayers } from '@/lib/booking/domain/EffectiveDay';
import { AvailabilityComposer } from '@/lib/booking/projection/AvailabilityComposer';
import {
  deriveAvailabilityRevision,
  type AvailabilityRevisionParts,
} from '@/lib/booking/projection/AvailabilityRevision';
import { rebuildOccupancyDayFromIntervals } from '@/lib/booking/projection/OccupancyDayState';
import type { ResolveBookingAvailabilityV2PreloadedDay } from '@/lib/booking/projection/resolveBookingAvailabilityV2';
import type { HotAvailabilityDayPayload } from '@/lib/booking/cache/HotAvailabilityTypes';

/**
 * Build cacheable day masks from preloaded SoT. Duration is NOT applied.
 * Normal days with no layers → reusedBaseline (EffectiveWork = WeeklyBaseline).
 */
export function buildHotDayPayloadFromPreloaded(
  day: ResolveBookingAvailabilityV2PreloadedDay,
  revisionParts?: Partial<AvailabilityRevisionParts>,
): HotAvailabilityDayPayload {
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
    baselineFingerprint: BookingPolicy.weeklyBaselineFingerprint(
      day.weeklyBaselineInputs,
    ),
    layers: day.layers,
  });

  const bookingOccupancyMask = rebuildOccupancyDayFromIntervals({
    key: { employeeId: day.employeeId, businessDate: day.businessDate },
    source: 'booking',
    intervals: day.bookingIntervals,
  }).mask;
  const holdOccupancyMask = rebuildOccupancyDayFromIntervals({
    key: { employeeId: day.employeeId, businessDate: day.businessDate },
    source: 'hold',
    intervals: day.holdIntervals,
  }).mask;
  const queueOccupancyMask = day.queueIntervals.length
    ? rebuildOccupancyDayFromIntervals({
        key: { employeeId: day.employeeId, businessDate: day.businessDate },
        source: 'queue',
        intervals: day.queueIntervals,
      }).mask
    : AvailabilityBitmap.empty();

  const parts: AvailabilityRevisionParts = {
    effectiveWorkRevision: revisionParts?.effectiveWorkRevision ?? day.revisions?.effectiveWorkRevision ?? 0,
    bookingOccupancyRevision:
      revisionParts?.bookingOccupancyRevision ??
      day.revisions?.bookingOccupancyRevision ??
      0,
    holdOccupancyRevision:
      revisionParts?.holdOccupancyRevision ?? day.revisions?.holdOccupancyRevision ?? 0,
    queueOccupancyRevision:
      revisionParts?.queueOccupancyRevision ?? day.revisions?.queueOccupancyRevision ?? 0,
  };

  const composed = AvailabilityComposer.compose({
    effectiveWorkMask: applied.bitmap,
    bookingOccupancyMask,
    holdOccupancyMask,
    queueOccupancyMask,
    revisions: parts,
  });

  return {
    availabilityRevision: deriveAvailabilityRevision(parts),
    parts,
    effectiveWorkMask: composed.effectiveWorkMask,
    bookingOccupancyMask: composed.bookingOccupancyMask,
    holdOccupancyMask: composed.holdOccupancyMask,
    queueOccupancyMask: composed.queueOccupancyMask,
    freeMask: composed.freeMask,
    reusedBaseline: applied.reusedBaseline,
    builtAtMs: Date.now(),
  };
}

export function resolveHotCacheEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = String(env.BOOKING_V2_HOT_CACHE ?? 'off')
    .trim()
    .toLowerCase();
  return raw === 'on' || raw === '1' || raw === 'true' || raw === 'l1';
}
