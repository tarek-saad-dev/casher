import { describe, expect, it } from 'vitest';
import {
  detectCheckInPeriodMismatch,
  formatClockAr,
} from '@/lib/hr/attendance-checkin-period';

describe('detectCheckInPeriodMismatch', () => {
  it('flags AM check-in when default start is PM and suggests +12h', () => {
    const result = detectCheckInPeriodMismatch('05:00', '17:00');
    expect(result.mismatch).toBe(true);
    expect(result.suggested).toBe('17:00');
  });

  it('flags morning arrival against an afternoon shift', () => {
    const result = detectCheckInPeriodMismatch('08:30', '14:00');
    expect(result.mismatch).toBe(true);
    expect(result.suggested).toBe('20:30');
  });

  it('does not flag when both times are PM', () => {
    expect(detectCheckInPeriodMismatch('17:05', '17:00').mismatch).toBe(false);
  });

  it('does not flag when reference start is AM', () => {
    expect(detectCheckInPeriodMismatch('09:00', '09:00').mismatch).toBe(false);
    expect(detectCheckInPeriodMismatch('08:45', '09:00').mismatch).toBe(false);
  });

  it('does not flag legitimate overnight crossover (evening shift, early morning arrival)', () => {
    // Shift starts 23:00, employee clocks in 00:30 → valid next-day arrival
    expect(detectCheckInPeriodMismatch('00:30', '23:00').mismatch).toBe(false);
    expect(detectCheckInPeriodMismatch('05:30', '22:00').mismatch).toBe(false);
  });

  it('still flags a mid-morning arrival even for an evening shift', () => {
    // 09:00 is well after the 06:00 overnight window → treat as a slip
    const result = detectCheckInPeriodMismatch('09:00', '20:00');
    expect(result.mismatch).toBe(true);
    expect(result.suggested).toBe('21:00');
  });

  it('returns no mismatch when inputs are missing or unparseable', () => {
    expect(detectCheckInPeriodMismatch(null, '17:00').mismatch).toBe(false);
    expect(detectCheckInPeriodMismatch('05:00', null).mismatch).toBe(false);
    expect(detectCheckInPeriodMismatch('bad', 'bad').mismatch).toBe(false);
  });

  it('accepts Date and AM/PM string inputs', () => {
    const result = detectCheckInPeriodMismatch('05:00 AM', '05:00 PM');
    expect(result.mismatch).toBe(true);
    expect(result.suggested).toBe('17:00');
  });
});

describe('formatClockAr', () => {
  it('formats PM times with م', () => {
    expect(formatClockAr('17:00')).toBe('5:00 م');
    expect(formatClockAr('12:30')).toBe('12:30 م');
  });

  it('formats AM times with ص', () => {
    expect(formatClockAr('05:00')).toBe('5:00 ص');
    expect(formatClockAr('00:15')).toBe('12:15 ص');
  });

  it('returns dash for empty input', () => {
    expect(formatClockAr(null)).toBe('—');
  });
});
