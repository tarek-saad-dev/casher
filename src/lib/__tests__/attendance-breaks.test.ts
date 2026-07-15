import { describe, expect, it } from 'vitest';
import {
  breakIntervalMinutes,
  computeGrossHoursFromTimes,
  computeNetWorkedHours,
  formatBreakMinutesLabel,
  normalizeBreaksInput,
  sumBreakMinutes,
} from '@/lib/hr/attendance-breaks';

describe('breakIntervalMinutes', () => {
  it('computes same-day interrupt', () => {
    expect(breakIntervalMinutes('14:00', '15:30')).toBe(90);
  });

  it('supports overnight interrupt', () => {
    expect(breakIntervalMinutes('23:00', '01:00')).toBe(120);
  });

  it('returns 0 when return missing', () => {
    expect(breakIntervalMinutes('14:00', null)).toBe(0);
  });
});

describe('computeNetWorkedHours', () => {
  it('subtracts break minutes from gross span', () => {
    expect(
      computeNetWorkedHours('12:00', '00:00', [
        { LeaveAt: '16:00', ReturnAt: '17:00', Minutes: 60 },
      ]),
    ).toBe(11);
  });

  it('uses BreakMinutesTotal when provided', () => {
    expect(computeNetWorkedHours('09:00', '17:00', [], 90)).toBe(6.5);
  });

  it('never goes negative', () => {
    expect(computeNetWorkedHours('09:00', '10:00', undefined, 200)).toBe(0);
  });
});

describe('computeGrossHoursFromTimes', () => {
  it('matches overnight span', () => {
    expect(computeGrossHoursFromTimes('22:00', '06:00')).toBe(8);
  });
});

describe('normalizeBreaksInput', () => {
  it('accepts valid intervals', () => {
    const result = normalizeBreaksInput([
      { LeaveAt: '15:00', ReturnAt: '15:45' },
    ]);
    expect(result.error).toBeNull();
    expect(result.breakMinutesTotal).toBe(45);
    expect(result.breaks).toHaveLength(1);
  });

  it('rejects matching leave/return', () => {
    const result = normalizeBreaksInput([{ LeaveAt: '15:00', ReturnAt: '15:00' }]);
    expect(result.error).toBeTruthy();
  });

  it('skips empty draft rows', () => {
    const result = normalizeBreaksInput([{ LeaveAt: '', ReturnAt: '' }]);
    expect(result.error).toBeNull();
    expect(result.breaks).toHaveLength(0);
  });
});

describe('sumBreakMinutes / format', () => {
  it('sums multiple intervals', () => {
    expect(
      sumBreakMinutes([
        { LeaveAt: '13:00', ReturnAt: '13:30' },
        { LeaveAt: '18:00', ReturnAt: '19:00' },
      ]),
    ).toBe(90);
  });

  it('formats labels', () => {
    expect(formatBreakMinutesLabel(45)).toBe('45 د');
    expect(formatBreakMinutesLabel(90)).toBe('1س 30د');
    expect(formatBreakMinutesLabel(120)).toBe('2س');
  });
});
