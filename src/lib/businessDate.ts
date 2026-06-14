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

/**
 * Get Cairo business date as YYYY-MM-DD.
 * If Cairo hour < 4 AM, returns yesterday's Cairo calendar date.
 */
export function getCairoBusinessDate(now?: Date): string {
  const d = now ?? new Date();
  const cairoHour = getCairoHour(d);
  if (cairoHour < BUSINESS_DAY_CUTOFF_HOUR) {
    const yesterday = new Date(d.getTime() - 24 * 60 * 60 * 1000);
    return yesterday.toLocaleDateString('en-CA', { timeZone: SALON_TZ });
  }
  return d.toLocaleDateString('en-CA', { timeZone: SALON_TZ });
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
 * Get current Cairo datetime as a Date object (approximation using offset).
 * Useful for comparisons like "is it past expected end?"
 */
export function getCairoNow(): Date {
  // We return a real UTC Date — callers compare ISO timestamps.
  // For "is this ticket overdue?" we compare against real now in UTC.
  return new Date();
}
