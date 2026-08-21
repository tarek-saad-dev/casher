/**
 * Booking V2 — absolute booking interval owned by a BusinessDate.
 *
 * Primary fields: businessDate + startAtMs + endAtMs (Africa/Cairo absolute).
 * Legacy dayOffset is derived/compat only.
 */

import {
  BOOKING_TZ,
  type BusinessDateString,
  businessDateTimeToEpochMs,
  formatCairoOffsetIso,
  hhmmToMinutes,
  parseBusinessDate,
  parseHhmm,
  shiftBusinessDate,
} from '@/lib/booking/domain/BusinessDate';
import { timeInTimezone } from '@/lib/publicBookingHelpers';

export type BookingInterval = {
  /** Operational / board day that owns this appointment. */
  businessDate: BusinessDateString;
  /** Absolute start (epoch ms, Cairo wall interpreted). */
  startAtMs: number;
  /** Absolute end (epoch ms). */
  endAtMs: number;
  /** IANA timezone used to materialize absolutes. */
  timeZone: string;
  /**
   * Legacy compatibility: 0 = start calendar == businessDate,
   * 1 = start calendar == businessDate + 1 (overnight).
   */
  legacyDayOffset: 0 | 1;
  /** Wall-clock HH:MM of start in salon TZ (compat). */
  legacyStartTimeHhmm: string;
};

export function createBookingInterval(args: {
  businessDate: BusinessDateString | string;
  startAtMs: number;
  endAtMs: number;
  timeZone?: string;
}): BookingInterval {
  const businessDate = parseBusinessDate(args.businessDate);
  const timeZone = args.timeZone ?? BOOKING_TZ;
  if (!(args.endAtMs > args.startAtMs)) {
    throw new Error('INVALID_BOOKING_INTERVAL_RANGE');
  }
  const legacyStartTimeHhmm = timeInTimezone(new Date(args.startAtMs), timeZone);
  const startCalendar = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(args.startAtMs));
  const legacyDayOffset: 0 | 1 =
    startCalendar === businessDate ? 0 : startCalendar === shiftBusinessDate(businessDate, 1) ? 1 : 0;

  return {
    businessDate,
    startAtMs: args.startAtMs,
    endAtMs: args.endAtMs,
    timeZone,
    legacyDayOffset,
    legacyStartTimeHhmm,
  };
}

/**
 * Build interval from BusinessDate + clock + duration.
 * Prefer calendarDayOffset (or inferOvernight) over legacy dayOffset naming.
 */
export function bookingIntervalFromBusinessClock(args: {
  businessDate: BusinessDateString | string;
  startTimeHhmm: string;
  durationMinutes: number;
  /** Absolute calendar offset for the start clock. Prefer this over dayOffset. */
  calendarDayOffset?: 0 | 1;
  timeZone?: string;
}): BookingInterval {
  const businessDate = parseBusinessDate(args.businessDate);
  const timeZone = args.timeZone ?? BOOKING_TZ;
  const duration = Math.round(args.durationMinutes);
  if (!(duration > 0)) throw new Error('INVALID_DURATION');
  const calendarDayOffset = args.calendarDayOffset === 1 ? 1 : 0;
  const startAtMs = businessDateTimeToEpochMs({
    businessDate,
    clockTimeHhmm: args.startTimeHhmm,
    calendarDayOffset,
    timeZone,
  });
  return createBookingInterval({
    businessDate,
    startAtMs,
    endAtMs: startAtMs + duration * 60_000,
    timeZone,
  });
}

/**
 * Legacy bridge: WorkDate + time + dayOffset → absolute interval.
 * Callers should migrate to bookingIntervalFromBusinessClock.
 */
export function bookingIntervalFromLegacyDayOffset(args: {
  businessDate: BusinessDateString | string;
  timeHhmm: string;
  dayOffset: 0 | 1 | number | null | undefined;
  durationMinutes: number;
  timeZone?: string;
}): BookingInterval {
  const dayOffset: 0 | 1 = Number(args.dayOffset) === 1 ? 1 : 0;
  return bookingIntervalFromBusinessClock({
    businessDate: args.businessDate,
    startTimeHhmm: args.timeHhmm,
    durationMinutes: args.durationMinutes,
    calendarDayOffset: dayOffset,
    timeZone: args.timeZone,
  });
}

export function bookingIntervalToLegacySlot(interval: BookingInterval): {
  date: BusinessDateString;
  time: string;
  dayOffset: 0 | 1;
} {
  return {
    date: interval.businessDate,
    time: interval.legacyStartTimeHhmm,
    dayOffset: interval.legacyDayOffset,
  };
}

export function bookingIntervalToIso(interval: BookingInterval): {
  businessDate: BusinessDateString;
  startAt: string;
  endAt: string;
  timeZone: string;
  legacyDayOffset: 0 | 1;
} {
  return {
    businessDate: interval.businessDate,
    startAt: formatCairoOffsetIso(interval.startAtMs, interval.timeZone),
    endAt: formatCairoOffsetIso(interval.endAtMs, interval.timeZone),
    timeZone: interval.timeZone,
    legacyDayOffset: interval.legacyDayOffset,
  };
}

/** True when shift window end clock is at/before start clock (overnight). */
export function isOvernightClockWindow(startHhmm: string, endHhmm: string): boolean {
  return hhmmToMinutes(parseHhmm(endHhmm)) <= hhmmToMinutes(parseHhmm(startHhmm));
}
