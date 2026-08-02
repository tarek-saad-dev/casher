import { describe, expect, it } from 'vitest';

import {
  getCairoBusinessDate,
  getCairoCalendarDate,
  getOperationalDate,
  shiftCalendarDate,
} from '@/lib/businessDate';
import {
  fmt,
  fmtEn,
  formatBarberHours,
  formatNextAvailable,
  isBeforeOperationalDate,
  mapFlowBoardBarbersForBooking,
  sanitizeDate,
  stripStaleBarberDayMeta,
} from '@/components/operations/booking-workspace/types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Cairo wall-clock instant via fixed UTC+3 offset (no DST). */
function cairoWall(isoLocal: string): Date {
  return new Date(`${isoLocal}+03:00`);
}

describe('getOperationalDate / overnight booking floor', () => {
  it('before midnight Cairo uses the calendar date as operational day', () => {
    const now = cairoWall('2026-08-01T23:30:00');
    expect(getCairoCalendarDate(now)).toBe('2026-08-01');
    expect(getOperationalDate({ now })).toBe('2026-08-01');
    expect(getCairoBusinessDate(now)).toBe('2026-08-01');
  });

  it('after midnight during open overnight shift keeps previous operational day', () => {
    const now = cairoWall('2026-08-02T00:58:00');
    expect(getCairoCalendarDate(now)).toBe('2026-08-02');
    expect(getOperationalDate({ now })).toBe('2026-08-01');
    expect(sanitizeDate(undefined, now)).toBe('2026-08-01');
    expect(sanitizeDate('2026-08-02', now)).toBe('2026-08-02');
  });

  it('previous operational date with available slots stays bookable (not past)', () => {
    const now = cairoWall('2026-08-02T01:10:00');
    expect(isBeforeOperationalDate('2026-08-01', now)).toBe(false);
    expect(sanitizeDate('2026-08-01', now)).toBe('2026-08-01');
  });

  it('previous date after the operational shift cutoff is blocked', () => {
    // 04:00 Cairo → operational rolls to calendar Aug 2; Aug 1 is now too old.
    const now = cairoWall('2026-08-02T04:00:00');
    expect(getOperationalDate({ now })).toBe('2026-08-02');
    expect(isBeforeOperationalDate('2026-08-01', now)).toBe(true);
    expect(sanitizeDate('2026-08-01', now)).toBe('2026-08-02');
  });

  it('normal future working day remains selectable', () => {
    const now = cairoWall('2026-08-02T01:00:00');
    expect(sanitizeDate('2026-08-03', now)).toBe('2026-08-03');
    expect(isBeforeOperationalDate('2026-08-03', now)).toBe(false);
  });

  it('does not allow arbitrary historical dates before operational floor', () => {
    const now = cairoWall('2026-08-02T01:00:00');
    expect(sanitizeDate('2026-07-15', now)).toBe('2026-08-01');
    expect(isBeforeOperationalDate('2026-07-31', now)).toBe(true);
  });

  it('branch-aware options honor timezone + cutoff', () => {
    const now = cairoWall('2026-08-02T03:30:00');
    expect(
      getOperationalDate({ now, timeZone: 'Africa/Cairo', cutoffHour: 4 }),
    ).toBe('2026-08-01');
    expect(
      getOperationalDate({ now, timeZone: 'Africa/Cairo', cutoffHour: 3 }),
    ).toBe('2026-08-02');
  });

  it('shiftCalendarDate supports day-off Sunday relative checks without mutating schedules', () => {
    // Kareem day off Aug 2 / Aug 9 remains a calendar fact for callers — helper only shifts dates.
    expect(shiftCalendarDate('2026-08-01', 1)).toBe('2026-08-02');
    expect(shiftCalendarDate('2026-08-02', 7)).toBe('2026-08-09');
  });
});

describe('overnight AM/PM time formatting', () => {
  it('formats 01:05 as AM / ص and 13:05 as PM / م', () => {
    expect(fmt('01:05')).toBe('1:05 ص');
    expect(fmt('01:20')).toBe('1:20 ص');
    expect(fmt('13:05')).toBe('1:05 م');
    expect(fmtEn('01:05')).toBe('1:05 AM');
    expect(fmtEn('01:20')).toBe('1:20 AM');
    expect(fmtEn('13:05')).toBe('1:05 PM');
  });

  it('formatNextAvailable keeps overnight ISO instants as ص', () => {
    // 2026-08-01 01:05 Cairo
    expect(formatNextAvailable('2026-08-01T22:05:00.000Z')).toBe('1:05 ص');
    // 2026-08-01 01:20 Cairo
    expect(formatNextAvailable('2026-08-01T22:20:00.000Z')).toBe('1:20 ص');
    // afternoon
    expect(formatNextAvailable('2026-08-01T10:05:00.000Z')).toBe('1:05 م');
  });

  it('formatNextAvailable formats bare HH:MM without flipping AM/PM', () => {
    expect(formatNextAvailable('01:05')).toBe('1:05 ص');
    expect(formatNextAvailable('13:05')).toBe('1:05 م');
  });

  it('formatBarberHours uses Arabic 12h for overnight end', () => {
    expect(formatBarberHours('13:20', '02:00')).toBe('1:20 م – 2:00 ص');
    expect(formatBarberHours('11:00', '01:30')).toBe('11:00 ص – 1:30 ص');
    expect(formatBarberHours(null, '02:00')).toBeNull();
  });
});

describe('booking barber cards follow bookingDate (not board day)', () => {
  it('maps flow-board rows and strips stale day metadata', () => {
    const mapped = mapFlowBoardBarbersForBooking([
      {
        empId: 5,
        empName: 'كريم',
        status: 'working',
        workStart: '11:00',
        workEnd: '01:30',
        nextAvailableAt: '2026-08-02T08:00:00.000Z',
      },
    ]);
    expect(mapped[0]).toMatchObject({
      empId: 5,
      workStart: '11:00',
      workEnd: '01:30',
    });
    expect(stripStaleBarberDayMeta(mapped)[0]).toMatchObject({
      empId: 5,
      empName: 'كريم',
      workStart: null,
      workEnd: null,
      nextAvailableAt: null,
      status: 'unknown',
    });
  });

  it('workspace refetches flow-board when bookingDate diverges from boardDate', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/components/operations/booking-workspace/useBookingWorkspace.ts'),
      'utf8',
    );
    expect(src).toContain('boardDate');
    expect(src).toContain('/api/operations/flow-board?date=');
    expect(src).toContain('presence=all');
    expect(src).toContain('mapFlowBoardBarbersForBooking');
    expect(src).toContain('stripStaleBarberDayMeta');
  });
});
