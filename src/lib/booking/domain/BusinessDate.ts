/**
 * Booking V2 — BusinessDate domain primitive.
 *
 * Operational (business) day is the booking board date. Clock times after midnight
 * that still belong to an overnight shift stay on that BusinessDate while their
 * absolute StartAt/EndAt land on the next calendar day.
 *
 * dayOffset is NOT a calculation primitive here — only a legacy compatibility detail
 * (see BookingInterval.fromLegacyDayOffset).
 */

import { salonDateTimeToMs } from '@/lib/publicBookingHelpers';
import {
  BUSINESS_DAY_CUTOFF_HOUR,
  SALON_TZ,
  getOperationalDate,
  shiftCalendarDate,
} from '@/lib/businessDate';

export const BOOKING_TZ = SALON_TZ;
export const BOOKING_BUSINESS_DAY_CUTOFF_HOUR = BUSINESS_DAY_CUTOFF_HOUR;

/** YYYY-MM-DD operational / board date. */
export type BusinessDateString = string & { readonly __brand: 'BusinessDate' };

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isBusinessDateString(value: unknown): value is BusinessDateString {
  if (typeof value !== 'string' || !YMD_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function parseBusinessDate(value: unknown): BusinessDateString {
  if (!isBusinessDateString(value)) {
    throw new Error(`INVALID_BUSINESS_DATE:${String(value)}`);
  }
  return value;
}

export function shiftBusinessDate(
  businessDate: BusinessDateString | string,
  deltaDays: number,
): BusinessDateString {
  return parseBusinessDate(shiftCalendarDate(String(businessDate), deltaDays));
}

export function isHhmm(value: unknown): value is string {
  return typeof value === 'string' && HHMM_RE.test(value);
}

export function parseHhmm(value: unknown): string {
  if (!isHhmm(value)) {
    throw new Error(`INVALID_CLOCK_TIME:${String(value)}`);
  }
  return value;
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = parseHhmm(hhmm).split(':').map(Number);
  return h * 60 + m;
}

/**
 * Absolute epoch ms for a wall-clock time belonging to a BusinessDate.
 * When `calendarDayOffset` is 1, the clock sits on the next calendar day
 * but still belongs to the same BusinessDate (overnight).
 */
export function businessDateTimeToEpochMs(args: {
  businessDate: BusinessDateString | string;
  clockTimeHhmm: string;
  /** 0 = same calendar day as BusinessDate; 1 = next calendar day (overnight). */
  calendarDayOffset?: 0 | 1;
  timeZone?: string;
}): number {
  const businessDate = parseBusinessDate(args.businessDate);
  const clock = parseHhmm(args.clockTimeHhmm);
  const offset = args.calendarDayOffset === 1 ? 1 : 0;
  const calendarDate =
    offset === 1 ? shiftBusinessDate(businessDate, 1) : businessDate;
  return salonDateTimeToMs(calendarDate, clock, args.timeZone ?? BOOKING_TZ);
}

/**
 * Format epoch ms as an ISO-8601 string with the Africa/Cairo numeric offset
 * (e.g. 2026-08-17T00:45:00+03:00).
 */
export function formatCairoOffsetIso(epochMs: number, timeZone = BOOKING_TZ): string {
  const d = new Date(epochMs);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'shortOffset',
  }).formatToParts(d);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const y = get('year');
  const mo = get('month');
  const day = get('day');
  let hour = get('hour');
  // en-GB can yield "24" for midnight in some engines — normalize to 00
  if (hour === '24') hour = '00';
  const minute = get('minute');
  const second = get('second');
  const tzRaw = get('timeZoneName') || 'GMT+0';
  const match = tzRaw.match(/GMT([+-])(\d+)(?::?(\d+))?/i);
  let offset = '+00:00';
  if (match) {
    const sign = match[1] === '-' ? '-' : '+';
    const hh = String(Number(match[2])).padStart(2, '0');
    const mm = String(Number(match[3] ?? '0')).padStart(2, '0');
    offset = `${sign}${hh}:${mm}`;
  }
  return `${y}-${mo}-${day}T${hour}:${minute}:${second}${offset}`;
}

/** Current operational BusinessDate (Cairo cutoff). */
export function currentBusinessDate(now?: Date): BusinessDateString {
  return parseBusinessDate(
    getOperationalDate({
      now,
      timeZone: BOOKING_TZ,
      cutoffHour: BOOKING_BUSINESS_DAY_CUTOFF_HOUR,
    }),
  );
}

/**
 * Infer calendarDayOffset for a clock time relative to a working window on BusinessDate.
 * If the window is overnight and the clock is at/after midnight but before window end,
 * offset is 1.
 */
export function inferCalendarDayOffsetForClock(args: {
  clockTimeHhmm: string;
  windowStartHhmm: string;
  windowEndHhmm: string;
  windowEndsNextCalendarDay: boolean;
}): 0 | 1 {
  const clock = hhmmToMinutes(args.clockTimeHhmm);
  const start = hhmmToMinutes(args.windowStartHhmm);
  const end = hhmmToMinutes(args.windowEndHhmm);
  if (!args.windowEndsNextCalendarDay) return 0;
  // Overnight: times from 00:00 up to (but typically including) end live on next calendar day.
  if (clock < start && (end === 0 || clock <= end)) return 1;
  if (clock < start) return 1;
  return 0;
}
