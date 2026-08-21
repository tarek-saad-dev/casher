/**
 * Booking V2 B5 — map absolute intervals onto a BusinessDate 48h timeline.
 * Pure helpers shared by booking / hold occupancy projections.
 */

import {
  AVAILABILITY_TIMELINE_MINUTES,
  type AvailabilityFreeRange,
} from '@/lib/booking/domain/AvailabilityBitmap';
import {
  BOOKING_TZ,
  businessDateTimeToEpochMs,
  parseBusinessDate,
  type BusinessDateString,
} from '@/lib/booking/domain/BusinessDate';

export type OccupancyDayKey = {
  employeeId: number;
  businessDate: BusinessDateString | string;
};

export type AbsoluteOccupancyInterval = {
  /** Stable id within source (bookingId / holdId). */
  id: number;
  startAtMs: number;
  endAtMs: number;
  branchId: number | null;
};

export function occupancyDayKeyString(key: OccupancyDayKey): string {
  return `emp:${key.employeeId}:bd:${String(parseBusinessDate(key.businessDate))}`;
}

export function parseOccupancyDayKey(key: OccupancyDayKey): {
  employeeId: number;
  businessDate: BusinessDateString;
} {
  const employeeId = Number(key.employeeId);
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    throw new Error(`INVALID_EMPLOYEE_ID:${String(key.employeeId)}`);
  }
  return {
    employeeId,
    businessDate: parseBusinessDate(key.businessDate),
  };
}

/** Midnight (00:00) epoch ms for the BusinessDate in salon TZ. */
export function businessDateMidnightMs(
  businessDate: BusinessDateString | string,
  timeZone = BOOKING_TZ,
): number {
  return businessDateTimeToEpochMs({
    businessDate,
    clockTimeHhmm: '00:00',
    calendarDayOffset: 0,
    timeZone,
  });
}

/**
 * Convert absolute [startAtMs, endAtMs) into continuous minutes from BusinessDate midnight.
 * Clamps to the 48h projection timeline; returns null if entirely outside.
 */
export function absoluteIntervalToTimelineMinutes(args: {
  businessDate: BusinessDateString | string;
  startAtMs: number;
  endAtMs: number;
  timeZone?: string;
}): AvailabilityFreeRange | null {
  if (!(args.endAtMs > args.startAtMs)) return null;
  const midnight = businessDateMidnightMs(args.businessDate, args.timeZone);
  let startMin = Math.floor((args.startAtMs - midnight) / 60_000);
  let endMin = Math.ceil((args.endAtMs - midnight) / 60_000);
  if (endMin <= 0 || startMin >= AVAILABILITY_TIMELINE_MINUTES) return null;
  startMin = Math.max(0, startMin);
  endMin = Math.min(AVAILABILITY_TIMELINE_MINUTES, endMin);
  if (endMin <= startMin) return null;
  return { startMin, endMin };
}

export function intervalsOverlapMs(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function segmentId(source: 'booking' | 'hold' | 'queue', id: number): string {
  return `${source}:${id}`;
}
