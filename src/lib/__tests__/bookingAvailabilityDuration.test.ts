import { describe, expect, it } from 'vitest';
import { evaluateBookingSlotAt } from '@/lib/bookingAvailabilityEngine';

function at(h: number, m = 0): Date {
  return new Date(`2026-07-07T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:00`);
}

describe('booking slot duration — full continuous interval', () => {
  it('30-minute service fits 30-minute window', () => {
    const start = at(13, 0);
    const result = evaluateBookingSlotAt(start.getTime(), 30, []);
    expect(result.available).toBe(true);
    expect(result.slotEndMs - start.getTime()).toBe(30 * 60_000);
  });

  it('50-minute service requires 50-minute window', () => {
    const start = at(13, 0);
    const result = evaluateBookingSlotAt(start.getTime(), 50, []);
    expect(result.slotEndMs - start.getTime()).toBe(50 * 60_000);
  });

  it('50-minute candidate rejected when booking at 30 minutes', () => {
    const start = at(13, 0);
    const result = evaluateBookingSlotAt(start.getTime(), 50, [
      { start: at(13, 30), end: at(14, 0) },
    ]);
    expect(result.available).toBe(false);
  });

  it('50-minute candidate allowed when gap ends at 50 minutes', () => {
    const start = at(13, 0);
    const result = evaluateBookingSlotAt(start.getTime(), 50, [
      { start: at(13, 50), end: at(14, 0) },
    ]);
    expect(result.available).toBe(true);
    expect(result.slotEndMs - start.getTime()).toBe(50 * 60_000);
  });

  it('50-minute overnight slot within 01:00 shift end is allowed', () => {
    const shiftStartMs = at(13, 0).getTime();
    const shiftEndMs = new Date('2026-07-08T01:00:00+03:00').getTime();
    const start = new Date('2026-07-07T23:10:00+03:00').getTime();
    const result = evaluateBookingSlotAt(start, 50, [], { shiftStartMs, shiftEndMs });
    expect(result.available).toBe(true);
    expect(result.slotEndMs - start).toBe(50 * 60_000);
    expect(result.slotEndMs).toBeLessThanOrEqual(shiftEndMs);
  });

  it('50-minute overnight slot past 01:00 shift end is rejected', () => {
    const shiftStartMs = at(13, 0).getTime();
    const shiftEndMs = new Date('2026-07-08T01:00:00+03:00').getTime();
    const start = new Date('2026-07-08T00:15:00+03:00').getTime();
    const result = evaluateBookingSlotAt(start, 50, [], { shiftStartMs, shiftEndMs });
    expect(result.available).toBe(false);
    expect(result.reasonCode).toBe('insufficient_continuous_time');
  });
});
