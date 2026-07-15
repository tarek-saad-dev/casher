/**
 * Date-contract and flow-board normalization regressions (Phase fixes).
 * Pure / unit only — no DB writes.
 */
import { describe, expect, it } from 'vitest';
import { sqlDateToYyyyMmDd } from '@/lib/bookingDateTime';

/** Mirror of /plan nextDateStr + dayOffset (backend applies offset once). */
function resolveStoredBookingDate(date: string, dayOffset: 0 | 1): string {
  if (dayOffset !== 1) return date;
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split('T')[0];
}

/**
 * Website → /plan payload contract (Operations-aligned).
 * Board date is sent as `date`; dayOffset is applied only on the server.
 */
function buildWebsitePlanPayload(args: {
  selectedDate: string;
  time: string;
  dayOffset: 0 | 1;
}) {
  return {
    date: args.selectedDate,
    time: args.time,
    dayOffset: args.dayOffset,
  };
}

/** flow-board fix: never substitute board dateStr for a mssql Date BookingDate. */
function resolveFlowBoardBookingDate(
  bookingDate: unknown,
  boardDateStr: string,
): string {
  return bookingDate ? sqlDateToYyyyMmDd(bookingDate) : boardDateStr;
}

describe('website /plan date contract', () => {
  it('dayOffset=0 keeps board date as payload and stored date', () => {
    const payload = buildWebsitePlanPayload({
      selectedDate: '2026-07-16',
      time: '17:00',
      dayOffset: 0,
    });
    expect(payload.date).toBe('2026-07-16');
    expect(resolveStoredBookingDate(payload.date, payload.dayOffset)).toBe('2026-07-16');
  });

  it('dayOffset=1 sends board date and stores +1 day (never +2)', () => {
    const payload = buildWebsitePlanPayload({
      selectedDate: '2026-07-15',
      time: '01:00',
      dayOffset: 1,
    });
    expect(payload.date).toBe('2026-07-15');
    expect(payload.dayOffset).toBe(1);
    expect(resolveStoredBookingDate(payload.date, payload.dayOffset)).toBe('2026-07-16');
    expect(resolveStoredBookingDate(payload.date, payload.dayOffset)).not.toBe('2026-07-17');
  });

  it('rejects the old double-offset pairing (advanced date + dayOffset 1)', () => {
    // Old FE bug: actualDate advanced then dayOffset still 1 → 2026-07-17
    const wrong = resolveStoredBookingDate('2026-07-16', 1);
    expect(wrong).toBe('2026-07-17');
    const fixed = resolveStoredBookingDate('2026-07-15', 1);
    expect(fixed).toBe('2026-07-16');
  });
});

describe('flow-board BookingDate normalization', () => {
  it('uses stored Date calendar day, not board dateStr', () => {
    const stored = new Date('2026-07-16T00:00:00.000Z');
    const board = '2026-07-15';
    // Old bug: typeof Date → fall back to board → '2026-07-15'
    expect(resolveFlowBoardBookingDate(stored, board)).toBe('2026-07-16');
    expect(resolveFlowBoardBookingDate(stored, board)).not.toBe(board);
  });

  it('22:00 booking on 2026-07-16 keeps that date for overnight board merge', () => {
    const bookingDateStr = resolveFlowBoardBookingDate(
      new Date('2026-07-16T00:00:00.000Z'),
      '2026-07-15',
    );
    expect(bookingDateStr).toBe('2026-07-16');
  });

  it('string BookingDate still parses YYYY-MM-DD', () => {
    expect(resolveFlowBoardBookingDate('2026-07-16T00:00:00.000Z', '2026-07-15')).toBe(
      '2026-07-16',
    );
  });
});
