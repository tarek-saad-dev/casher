import { describe, expect, it } from 'vitest';
import {
  calculateLateDeductionAmount,
  dailyBasePayFromHourly,
  dailyBasePayFromMonthlySalary,
  resolveLateDeductionBracket,
  thresholdsDueForLateMinutes,
  alertThresholdReached,
} from '../rules';

describe('resolveLateDeductionBracket boundaries', () => {
  it('0 minutes → none', () => {
    expect(resolveLateDeductionBracket(0)).toBe('none');
  });
  it('1 minute → quarter', () => {
    expect(resolveLateDeductionBracket(1)).toBe('quarter');
  });
  it('60 minutes → quarter', () => {
    expect(resolveLateDeductionBracket(60)).toBe('quarter');
  });
  it('61 minutes → half', () => {
    expect(resolveLateDeductionBracket(61)).toBe('half');
  });
  it('120 minutes → half', () => {
    expect(resolveLateDeductionBracket(120)).toBe('half');
  });
  it('121 minutes → manager_review', () => {
    expect(resolveLateDeductionBracket(121)).toBe('manager_review');
  });
  it('75 minutes → single half (not quarter+half)', () => {
    expect(resolveLateDeductionBracket(75)).toBe('half');
  });
});

describe('monthly salary daily base + amounts', () => {
  it('7800 monthly → daily 300; quarter 75; half 150', () => {
    const daily = dailyBasePayFromMonthlySalary(7800);
    expect(daily).toBe(300);
    expect(calculateLateDeductionAmount({ lateMinutes: 20, dailyBasePay: daily })).toEqual({
      bracket: 'quarter',
      amount: 75,
      fraction: 0.25,
    });
    expect(calculateLateDeductionAmount({ lateMinutes: 75, dailyBasePay: daily })).toEqual({
      bracket: 'half',
      amount: 150,
      fraction: 0.5,
    });
    expect(calculateLateDeductionAmount({ lateMinutes: 130, dailyBasePay: daily })).toEqual({
      bracket: 'manager_review',
      amount: null,
      fraction: null,
    });
  });
});

describe('hourly scheduled daily base', () => {
  it('10-hour shift at 40/hr → daily 400; quarter 100', () => {
    const daily = dailyBasePayFromHourly({
      hourlyRate: 40,
      scheduledStart: '10:00',
      scheduledEnd: '20:00',
    });
    expect(daily).toBe(400);
    expect(calculateLateDeductionAmount({ lateMinutes: 30, dailyBasePay: daily! }).amount).toBe(100);
  });

  it('different shift duration 6 hours at 50/hr → daily 300', () => {
    expect(
      dailyBasePayFromHourly({
        hourlyRate: 50,
        scheduledStart: '12:00',
        scheduledEnd: '18:00',
      }),
    ).toBe(300);
  });

  it('overnight schedule 22:00–06:00 = 8 hours', () => {
    expect(
      dailyBasePayFromHourly({
        hourlyRate: 25,
        scheduledStart: '22:00',
        scheduledEnd: '06:00',
      }),
    ).toBe(200);
  });

  it('missing schedule → null (review, do not invent)', () => {
    expect(
      dailyBasePayFromHourly({
        hourlyRate: 40,
        scheduledStart: null,
        scheduledEnd: '18:00',
      }),
    ).toBeNull();
  });
});

describe('progressive alert thresholds', () => {
  it('minute 1 due', () => {
    expect(alertThresholdReached(1)).toBe(1);
    expect(thresholdsDueForLateMinutes(1)).toEqual([1]);
  });
  it('minute 61 due includes 1 and 61', () => {
    expect(alertThresholdReached(61)).toBe(61);
    expect(thresholdsDueForLateMinutes(61)).toEqual([1, 61]);
  });
  it('minute 121 due includes all three', () => {
    expect(alertThresholdReached(121)).toBe(121);
    expect(thresholdsDueForLateMinutes(121)).toEqual([1, 61, 121]);
  });
  it('on time → no thresholds', () => {
    expect(alertThresholdReached(0)).toBeNull();
    expect(thresholdsDueForLateMinutes(0)).toEqual([]);
  });
});
