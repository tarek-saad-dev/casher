/**
 * Booking V2 — AvailabilityComposer
 *
 * FreeMask =
 *   EffectiveWorkMask
 *   AND NOT BookingOccupancyMask
 *   AND NOT ActiveHoldOccupancyMask
 *   AND NOT QueueOccupancyMask   (B7A — required for live-engine parity)
 *
 * Conventions:
 * - EffectiveWorkMask / FreeMask: bit=1 ⇒ free / bookable
 * - Occupancy masks: bit=1 ⇒ occupied
 *
 * Duration is applied only at compose/generateStarts — projections do not store
 * service-specific slot grids.
 */

import {
  AvailabilityBitmap,
  AVAILABILITY_QUANTUM_MINUTES,
  AVAILABILITY_TIMELINE_MINUTES,
  type AvailabilityFreeRange,
} from '@/lib/booking/domain/AvailabilityBitmap';
import {
  deriveAvailabilityRevision,
  type AvailabilityRevisionParts,
} from '@/lib/booking/projection/AvailabilityRevision';

export type AvailabilityComposeInput = {
  effectiveWorkMask: AvailabilityBitmap;
  bookingOccupancyMask: AvailabilityBitmap;
  holdOccupancyMask: AvailabilityBitmap;
  /** Optional; empty mask when queue layer not loaded (future public days). */
  queueOccupancyMask?: AvailabilityBitmap;
  revisions?: AvailabilityRevisionParts;
};

export type ComposedAvailability = {
  freeMask: AvailabilityBitmap;
  freeRanges: AvailabilityFreeRange[];
  bookingOccupancyMask: AvailabilityBitmap;
  holdOccupancyMask: AvailabilityBitmap;
  queueOccupancyMask: AvailabilityBitmap;
  effectiveWorkMask: AvailabilityBitmap;
  availabilityRevision: string | null;
};

export const AvailabilityComposer = {
  /**
   * FreeMask = EffectiveWork ∧ ¬Booking ∧ ¬Hold ∧ ¬Queue
   */
  compose(input: AvailabilityComposeInput): ComposedAvailability {
    const queue = input.queueOccupancyMask ?? AvailabilityBitmap.empty();
    const freeMask = input.effectiveWorkMask
      .and(input.bookingOccupancyMask.not())
      .and(input.holdOccupancyMask.not())
      .and(queue.not());
    return {
      freeMask,
      freeRanges: freeMask.toFreeRanges(),
      bookingOccupancyMask: input.bookingOccupancyMask.clone(),
      holdOccupancyMask: input.holdOccupancyMask.clone(),
      queueOccupancyMask: queue.clone(),
      effectiveWorkMask: input.effectiveWorkMask.clone(),
      availabilityRevision: input.revisions
        ? deriveAvailabilityRevision(input.revisions)
        : null,
    };
  },

  canFitDuration(
    freeMask: AvailabilityBitmap,
    durationMinutes: number,
    opts?: { fromMin?: number; toMinExclusive?: number },
  ): boolean {
    return freeMask.findConsecutiveFree(durationMinutes, opts) != null;
  },

  /**
   * Generate candidate start minutes on `slotIntervalMinutes` grid that fit duration.
   */
  generateStarts(args: {
    freeMask: AvailabilityBitmap;
    durationMinutes: number;
    slotIntervalMinutes?: number;
    fromMin?: number;
    toMinExclusive?: number;
  }): number[] {
    const interval = args.slotIntervalMinutes ?? AVAILABILITY_QUANTUM_MINUTES;
    if (interval <= 0 || args.durationMinutes <= 0) return [];
    const from = args.fromMin ?? 0;
    const to = args.toMinExclusive ?? AVAILABILITY_TIMELINE_MINUTES;
    const starts: number[] = [];
    const alignedFrom =
      Math.ceil(from / AVAILABILITY_QUANTUM_MINUTES) * AVAILABILITY_QUANTUM_MINUTES;
    for (let m = alignedFrom; m + args.durationMinutes <= to; m += interval) {
      if (args.freeMask.hasConsecutiveFreeAt(m, args.durationMinutes)) {
        starts.push(m);
      }
    }
    return starts;
  },
};
