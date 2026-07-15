/**
 * Cairo calendar helpers for the nightly close job (01:00 Africa/Cairo).
 */

/** Vercel cron fires at 22:00 UTC ≈ 01:00 Africa/Cairo (ICU often EEST UTC+3). */
export const NIGHTLY_CLOSE_CRON_UTC = '0 22 * * *';
export const NIGHTLY_CLOSE_HOUR_CAIRO = 1;
export const NIGHTLY_CLOSE_MINUTE_CAIRO = 0;

export function shiftYmd(yyyyMmDd: string, days: number): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Work date for a job that runs just after midnight Cairo: previous calendar day. */
export function resolveNightlyCloseWorkDate(
  override?: string | null,
  now: Date = new Date(),
): string {
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) return override;
  const cairoToday = now.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  return shiftYmd(cairoToday, -1);
}

export function getCairoClockParts(now: Date = new Date()): {
  date: string;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '0';

  const date = `${get('year')}-${get('month')}-${get('day')}`;
  return {
    date,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

/** True when Cairo clock is in the 01:00 fire window (minute 0 only). */
export function isNightlyCloseFireWindow(now: Date = new Date()): boolean {
  const { hour, minute } = getCairoClockParts(now);
  return hour === NIGHTLY_CLOSE_HOUR_CAIRO && minute === NIGHTLY_CLOSE_MINUTE_CAIRO;
}
