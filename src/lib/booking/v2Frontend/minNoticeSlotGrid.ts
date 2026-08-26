/**
 * MinNotice helpers that operate on the V2 slot grid (businessDate + startMin).
 * Pure — safe for client/server bundles.
 */
import {
  isSlotStartEligibleUnderMinNotice,
  minNoticeThresholdMs,
} from '@/lib/booking/domain/minNoticeEligibility';
import {
  startMinToV2Slot,
  type V2SlotStart,
} from '@/lib/booking/v2Frontend/v2SlotStart';

export function filterStartMinsByMinNotice(args: {
  startMins: number[];
  businessDate: string;
  nowMs: number;
  minNoticeMinutes: number;
  timeZone?: string;
}): number[] {
  return args.startMins.filter((startMin) => {
    const slot = startMinToV2Slot(startMin, args.businessDate, args.timeZone);
    return isSlotStartEligibleUnderMinNotice({
      startAtMs: slot.startAtMs,
      nowMs: args.nowMs,
      minNoticeMinutes: args.minNoticeMinutes,
    });
  });
}

/**
 * firstValidSlot = ceilToSlotInterval(exactNow + MinNotice) on the salon grid.
 *
 * Example: now 21:15:08.305 + 15m → threshold 21:30:08.305 → first grid 21:45.
 * Exact: now 21:15:00.000 + 15m → threshold 21:30:00.000 → first grid 21:30.
 */
export function firstEligibleSlotOnGrid(args: {
  nowMs: number;
  minNoticeMinutes: number;
  businessDate: string;
  slotIntervalMinutes: number;
  timeZone?: string;
  maxStartMin?: number;
}): V2SlotStart | null {
  const interval = Math.max(1, Math.floor(args.slotIntervalMinutes) || 15);
  const maxStartMin = args.maxStartMin ?? 48 * 60;
  const thresholdMs = minNoticeThresholdMs(args.nowMs, args.minNoticeMinutes);

  const midnight = startMinToV2Slot(0, args.businessDate, args.timeZone);
  let approxMin = Math.floor((thresholdMs - midnight.startAtMs) / 60_000);
  if (!Number.isFinite(approxMin) || approxMin < 0) approxMin = 0;

  let startMin = Math.ceil(approxMin / interval) * interval;
  if (startMin > maxStartMin) return null;

  for (let guard = 0; guard < 512 && startMin <= maxStartMin; guard++) {
    const slot = startMinToV2Slot(startMin, args.businessDate, args.timeZone);
    if (
      isSlotStartEligibleUnderMinNotice({
        startAtMs: slot.startAtMs,
        nowMs: args.nowMs,
        minNoticeMinutes: args.minNoticeMinutes,
      })
    ) {
      return slot;
    }
    startMin += interval;
  }
  return null;
}
