import { describe, expect, it } from 'vitest';
import {
  getCairoCalendarDate,
  getCairoMonthCloseAwareDate,
  getCairoMonthCloseAwareMonth,
  isInMonthCloseGraceWindow,
  shiftCalendarDate,
} from '@/lib/businessDate';

/** Build a Date that is the given Cairo wall-clock instant (approx via toLocaleString round-trip). */
function cairoWallClock(isoLocal: string): Date {
  // isoLocal: '2026-08-01T05:30:00' interpreted as Cairo by constructing from parts in UTC offset
  // Use fixed offset +03:00 (Egypt standard, no DST currently).
  return new Date(`${isoLocal}+03:00`);
}

describe('month-close grace (1st until 6 AM Cairo)', () => {
  it('shiftCalendarDate moves across month boundary', () => {
    expect(shiftCalendarDate('2026-08-01', -1)).toBe('2026-07-31');
    expect(shiftCalendarDate('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('before 6 AM on the 1st → previous day and month', () => {
    const now = cairoWallClock('2026-08-01T05:59:00');
    expect(isInMonthCloseGraceWindow(now)).toBe(true);
    expect(getCairoMonthCloseAwareDate(now)).toBe('2026-07-31');
    expect(getCairoMonthCloseAwareMonth(now)).toBe('2026-07');
  });

  it('at 6 AM on the 1st → new month', () => {
    const now = cairoWallClock('2026-08-01T06:00:00');
    expect(isInMonthCloseGraceWindow(now)).toBe(false);
    expect(getCairoMonthCloseAwareDate(now)).toBe('2026-08-01');
    expect(getCairoMonthCloseAwareMonth(now)).toBe('2026-08');
  });

  it('mid-month is unchanged', () => {
    const now = cairoWallClock('2026-08-15T02:00:00');
    expect(isInMonthCloseGraceWindow(now)).toBe(false);
    expect(getCairoMonthCloseAwareDate(now)).toBe(getCairoCalendarDate(now));
  });
});
