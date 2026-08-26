/**
 * Booking V2 B9 — shared pure slot generation contract.
 *
 * FreeMask / FreeRanges + duration + slotInterval = Available Start Times
 *
 * Matches server AvailabilityComposer.generateStarts + startMinToV2Slot 100%.
 * Safe to import from Node or (bundled) browser — no server-only / DB.
 */

import {
  AvailabilityBitmap,
  AVAILABILITY_QUANTUM_MINUTES,
  type AvailabilityFreeRange,
} from '@/lib/booking/domain/AvailabilityBitmap';
import { AvailabilityComposer } from '@/lib/booking/projection/AvailabilityComposer';
import {
  startMinToV2Slot,
  type V2SlotStart,
} from '@/lib/booking/v2Frontend/v2SlotStart';
import { filterStartMinsByMinNotice } from '@/lib/booking/v2Frontend/minNoticeSlotGrid';

export type GenerateStartsFromFreeInput = {
  freeRanges?: AvailabilityFreeRange[];
  freeMaskB64?: string;
  durationMinutes: number;
  slotIntervalMinutes?: number;
  businessDate: string;
  /** When set, drop past + min-notice starts (public semantics). */
  nowMs?: number;
  minNoticeMinutes?: number;
};

export type GenerateStartsFromFreeResult = {
  starts: V2SlotStart[];
  startMins: number[];
};

function resolveFreeMask(args: GenerateStartsFromFreeInput): AvailabilityBitmap {
  if (args.freeMaskB64) {
    return AvailabilityBitmap.fromBase64(args.freeMaskB64);
  }
  if (args.freeRanges?.length) {
    return AvailabilityBitmap.fromFreeRanges(args.freeRanges);
  }
  return AvailabilityBitmap.empty();
}

/**
 * Client/server shared: FreeMask → start times for a duration.
 * Emp duration overrides are NOT applied here — caller supplies effective duration.
 */
export function generateStartsFromFree(
  args: GenerateStartsFromFreeInput,
): GenerateStartsFromFreeResult {
  const freeMask = resolveFreeMask(args);
  const slotInterval = args.slotIntervalMinutes ?? 15;
  let startMins = AvailabilityComposer.generateStarts({
    freeMask,
    durationMinutes: args.durationMinutes,
    slotIntervalMinutes: slotInterval,
  });

  if (args.nowMs != null) {
    startMins = filterStartMinsByMinNotice({
      startMins,
      businessDate: args.businessDate,
      nowMs: args.nowMs,
      minNoticeMinutes: args.minNoticeMinutes ?? 0,
    });
  }

  return {
    startMins,
    starts: startMins.map((m) => startMinToV2Slot(m, args.businessDate)),
  };
}

export const SLOT_GENERATION_CONTRACT = {
  formula: 'FreeMask/FreeRanges + duration + slotInterval = Available Start Times',
  quantumMinutes: AVAILABILITY_QUANTUM_MINUTES,
  defaultSlotIntervalMinutes: 15,
  timelineHours: 48,
} as const;
