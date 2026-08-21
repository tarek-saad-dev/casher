/**
 * Apply duration/slotInterval on cached FreeMask → V2 day result.
 */

import { AvailabilityComposer } from '@/lib/booking/projection/AvailabilityComposer';
import {
  startMinToV2Slot,
  type V2EmployeeDayAvailability,
} from '@/lib/booking/projection/resolveBookingAvailabilityV2';
import type { HotAvailabilityDayPayload } from '@/lib/booking/cache/HotAvailabilityTypes';

export function composeV2DayFromHotPayload(args: {
  employeeId: number;
  branchId: number;
  businessDate: string;
  payload: HotAvailabilityDayPayload;
  durationMinutes: number;
  slotIntervalMinutes: number;
  nowMs?: number;
  minNoticeMinutes?: number;
  /** When false, return FreeMask only (matrix path). Default true. */
  includeStarts?: boolean;
}): V2EmployeeDayAvailability {
  let starts: number[] = [];
  if (args.includeStarts !== false) {
    starts = AvailabilityComposer.generateStarts({
      freeMask: args.payload.freeMask,
      durationMinutes: args.durationMinutes,
      slotIntervalMinutes: args.slotIntervalMinutes,
    });

    if (args.nowMs != null) {
      const minNotice = Math.max(0, args.minNoticeMinutes ?? 0);
      const minNoticeMs = minNotice * 60_000;
      const nowMs = args.nowMs;
      starts = starts.filter((m) => {
        const slot = startMinToV2Slot(m, args.businessDate);
        if (slot.startAtMs <= nowMs) return false;
        if (slot.startAtMs < nowMs + minNoticeMs) return false;
        return true;
      });
    }
  }

  return {
    employeeId: args.employeeId,
    branchId: args.branchId,
    businessDate: args.businessDate,
    availableStarts: starts.map((m) => startMinToV2Slot(m, args.businessDate)),
    freeRanges: args.payload.freeMask.toFreeRanges(),
    freeMaskB64: args.payload.freeMask.toBase64(),
    availabilityRevision: args.payload.availabilityRevision,
    changeMask: [],
    reusedBaseline: args.payload.reusedBaseline,
    durationMinutes: args.durationMinutes,
    slotIntervalMinutes: args.slotIntervalMinutes,
  };
}
