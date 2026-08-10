/**
 * businessDate.ts — Shared Cairo business date helper
 *
 * Business day rule:
 *   If Cairo local hour < CUTOFF_HOUR (4 AM), the business date = yesterday.
 *   This matches salon operations where shifts can extend past midnight.
 *
 * Used by:
 *   - /queue/live (client)
 *   - /operations (client)
 *   - GET /api/queue
 *   - POST /api/queue
 *   - POST /api/queue/estimate
 *   - GET /api/operations/flow-board
 *   - Booking availability endpoints
 */

export const SALON_TZ = 'Africa/Cairo';
export const BUSINESS_DAY_CUTOFF_HOUR = 4;
/** On the 1st of each month, before this Cairo hour, keep previous calendar day (month close grace). */
export const MONTH_CLOSE_GRACE_CUTOFF_HOUR = 6;

/**
 * Get current Cairo hour (0–23).
 */
export function getCairoHour(now?: Date): number {
  const d = now ?? new Date();
  const hourStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: SALON_TZ,
    hour: '2-digit',
    hour12: false,
  }).format(d);
  return parseInt(hourStr, 10);
}

/**
 * Get Cairo calendar date as YYYY-MM-DD (plain date, no business-day shift).
 */
export function getCairoCalendarDate(now?: Date): string {
  const d = now ?? new Date();
  return d.toLocaleDateString('en-CA', { timeZone: SALON_TZ });
}

/** Shift a YYYY-MM-DD calendar date by N days (UTC date arithmetic — safe for Cairo calendar strings). */
export function shiftCalendarDate(dateStr: string, deltaDays: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return dateStr;
  const utc = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return utc.toISOString().slice(0, 10);
}

export type OperationalDateOptions = {
  now?: Date;
  /** IANA timezone. Defaults to Africa/Cairo. */
  timeZone?: string;
  /** Local hour (0–23) before which the calendar date rolls back one day. Defaults to 4. */
  cutoffHour?: number;
};

function hourInTimeZone(now: Date, timeZone: string): number {
  const hourStr = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).format(now);
  return parseInt(hourStr, 10);
}

function calendarDateInTimeZone(now: Date, timeZone: string): string {
  return now.toLocaleDateString('en-CA', { timeZone });
}

/**
 * Branch-aware operational (business) date as YYYY-MM-DD.
 * Before the cutoff hour in the branch timezone, returns the previous calendar day
 * so overnight shifts stay on the open operational day.
 */
export function getOperationalDate(options: OperationalDateOptions = {}): string {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? SALON_TZ;
  const cutoffHour = options.cutoffHour ?? BUSINESS_DAY_CUTOFF_HOUR;
  const calendar = calendarDateInTimeZone(now, timeZone);
  if (hourInTimeZone(now, timeZone) < cutoffHour) {
    return shiftCalendarDate(calendar, -1);
  }
  return calendar;
}

/**
 * Get Cairo business date as YYYY-MM-DD.
 * If Cairo hour < 4 AM, returns yesterday's Cairo calendar date.
 */
export function getCairoBusinessDate(now?: Date): string {
  return getOperationalDate({ now });
}

/**
 * True on Cairo calendar day 1 before MONTH_CLOSE_GRACE_CUTOFF_HOUR (6 AM).
 * Used so month-end closing can finish early on the 1st.
 */
export function isInMonthCloseGraceWindow(now?: Date): boolean {
  const calendar = getCairoCalendarDate(now);
  const day = Number(calendar.slice(8, 10));
  return day === 1 && getCairoHour(now) < MONTH_CLOSE_GRACE_CUTOFF_HOUR;
}

/**
 * Cairo date for employee-ledger / month-close UI:
 * On the 1st before 6:00 AM Cairo → previous calendar day (so month stays the previous one).
 * Otherwise → Cairo calendar date.
 */
export function getCairoMonthCloseAwareDate(now?: Date): string {
  const calendar = getCairoCalendarDate(now);
  if (isInMonthCloseGraceWindow(now)) {
    return shiftCalendarDate(calendar, -1);
  }
  return calendar;
}

/** YYYY-MM for ledger month filters — respects 1st-of-month until 6 AM Cairo grace. */
export function getCairoMonthCloseAwareMonth(now?: Date): string {
  return getCairoMonthCloseAwareDate(now).slice(0, 7);
}

/**
 * Check whether current Cairo time is in the after-midnight segment (00:00–04:00).
 */
export function isAfterMidnightShift(now?: Date): boolean {
  return getCairoHour(now) < BUSINESS_DAY_CUTOFF_HOUR;
}

/**
 * Get current Cairo time as HH:MM:SS string.
 */
export function getCairoTimeStr(now?: Date): string {
  const d = now ?? new Date();
  return d.toLocaleTimeString('en-GB', {
    timeZone: SALON_TZ,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Cairo wall-clock for TblinvServHead / TblCashMove invTime: "HH.mm"
 * (legacy NVARCHAR format — must not use server-local getHours()).
 */
export function getCairoInvTimeDotStr(now?: Date): string {
  return getCairoTimeStr(now).slice(0, 5).replace(':', '.');
}

/**
 * Cairo PayTime string matching existing invoice payment format:
 * "YYYY-MM-DD HH:MM:SS AM/PM"
 */
export function getCairoPayTimeStr(now?: Date): string {
  const d = now ?? new Date();
  const date = getCairoCalendarDate(d);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SALON_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return `${date} ${get('hour')}:${get('minute')}:${get('second')} ${get('dayPeriod')}`;
}

/**
 * Get current Cairo datetime as a Date object (approximation using offset).
 * Useful for comparisons like "is it past expected end?"
 */
export function getCairoNow(): Date {
  // We return a real UTC Date — callers compare ISO timestamps.
  // For "is this ticket overdue?" we compare against real now in UTC.
  return new Date();
}
