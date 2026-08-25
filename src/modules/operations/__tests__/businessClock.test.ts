import { describe, expect, it } from 'vitest';
import {
  getBranchLocalClockParts,
  isPastRolloverWindow,
  parseBusinessCutoffHour,
  resolveBusinessClock,
  resolveBusinessDate,
} from '@/modules/operations/clock/BusinessClock';

describe('BusinessClock', () => {
  const cairo = { timeZone: 'Africa/Cairo', businessDayCutoffTime: '04:00:00' };

  it('parses cutoff hour and falls back to 4 for invalid values', () => {
    expect(parseBusinessCutoffHour('04:00:00')).toBe(4);
    expect(parseBusinessCutoffHour('06:30:00')).toBe(6);
    expect(parseBusinessCutoffHour('nope')).toBe(4);
    expect(parseBusinessCutoffHour(undefined)).toBe(4);
  });

  it('overnight before 04:00 Cairo stays on the previous calendar day', () => {
    // 2026-07-31 01:30 Cairo = 2026-07-30 22:30 UTC (UTC+3)
    const overnight = new Date('2026-07-30T22:30:00.000Z');
    expect(resolveBusinessDate(cairo, overnight)).toBe('2026-07-30');
  });

  it('at/after 04:00 Cairo returns the calendar day', () => {
    // 2026-07-31 05:00 Cairo = 2026-07-31 02:00 UTC (UTC+3)
    const morning = new Date('2026-07-31T02:00:00.000Z');
    expect(resolveBusinessDate(cairo, morning)).toBe('2026-07-31');
  });

  it('resolveBusinessClock exposes timezone, cutoff, now, and business date together', () => {
    const morning = new Date('2026-07-31T02:00:00.000Z');
    const clock = resolveBusinessClock(cairo, morning);
    expect(clock.timeZone).toBe('Africa/Cairo');
    expect(clock.cutoffHour).toBe(4);
    expect(clock.now).toBe(morning);
    expect(clock.businessDate).toBe('2026-07-31');
  });

  it('08:00 Cairo is inside the rollover window; 02:00 is not', () => {
    // 2026-08-25 08:00 Cairo = 05:00 UTC (UTC+3)
    const atEight = new Date('2026-08-25T05:00:00.000Z');
    expect(getBranchLocalClockParts(cairo.timeZone, atEight).hour).toBe(8);
    expect(isPastRolloverWindow(cairo, atEight)).toBe(true);
    // 2026-08-25 02:00 Cairo = 2026-08-24 23:00 UTC
    const atTwo = new Date('2026-08-24T23:00:00.000Z');
    expect(getBranchLocalClockParts(cairo.timeZone, atTwo).hour).toBe(2);
    expect(isPastRolloverWindow(cairo, atTwo)).toBe(false);
  });

  it('Cairo DST: 05:00 UTC is before local 08:00 in winter (UTC+2)', () => {
    // 2026-01-15 07:00 Cairo = 05:00 UTC
    const winterSeven = new Date('2026-01-15T05:00:00.000Z');
    expect(getBranchLocalClockParts(cairo.timeZone, winterSeven).hour).toBe(7);
    expect(isPastRolloverWindow(cairo, winterSeven)).toBe(false);
    // 2026-01-15 08:00 Cairo = 06:00 UTC
    const winterEight = new Date('2026-01-15T06:00:00.000Z');
    expect(getBranchLocalClockParts(cairo.timeZone, winterEight).hour).toBe(8);
    expect(isPastRolloverWindow(cairo, winterEight)).toBe(true);
  });

  it('Cairo DST: 05:00 UTC is local 08:00 in summer (UTC+3)', () => {
    const summerEight = new Date('2026-08-25T05:00:00.000Z');
    expect(isPastRolloverWindow(cairo, summerEight)).toBe(true);
  });
});
