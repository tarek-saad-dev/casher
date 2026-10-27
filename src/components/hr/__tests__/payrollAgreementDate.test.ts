import { describe, expect, it } from 'vitest';
import { firstDayOfNextMonth, formatPayrollEffectiveDate } from '../payrollAgreementDate';

describe('payroll agreement effective-date safeguards', () => {
  it('never defaults a new VIP contract to an already started month', () => {
    expect(firstDayOfNextMonth('2026-10-26')).toBe('2026-11-01');
  });
  it('rolls from December into the next calendar year', () => {
    expect(firstDayOfNextMonth('2026-12-31')).toBe('2027-01-01');
  });
  it('handles February at a leap-year boundary', () => {
    expect(firstDayOfNextMonth('2024-02-29')).toBe('2024-03-01');
  });
  it('rejects invalid calendar dates instead of silently correcting them', () => {
    expect(() => firstDayOfNextMonth('2026-02-31')).toThrow();
  });
  it('formats dates with a named Arabic month, not ambiguous numeric order', () => {
    expect(formatPayrollEffectiveDate('2026-10-01')).toContain('أكتوبر');
    expect(formatPayrollEffectiveDate('2026-01-10')).toContain('يناير');
  });
  it('does not label invalid dates', () => {
    expect(formatPayrollEffectiveDate('2026-02-31')).toBe('');
  });
});
