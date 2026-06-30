import { describe, it, expect } from 'vitest';
import {
  PARTNERS_REPORT_MIN_DATE,
  clampPartnersReportMonth,
  getPartnersReportAllowedMonths,
  getPartnersReportAllowedYears,
  getPartnersReportCurrentMonth,
  isAtPartnersReportMinimum,
  isBeforePartnersReportMinimum,
  validatePartnersReportMinimumPeriod,
} from '@/lib/reports/partnersReportPeriod';

describe('partnersReportPeriod', () => {
  it('uses calendar months with January = 1', () => {
    expect(PARTNERS_REPORT_MIN_DATE.month).toBe(6);
    expect(isBeforePartnersReportMinimum(2026, 5)).toBe(true);
    expect(isBeforePartnersReportMinimum(2026, 6)).toBe(false);
  });

  it('clamps periods before June 2026', () => {
    expect(clampPartnersReportMonth(2025, 12)).toEqual({ year: 2026, month: 6 });
    expect(clampPartnersReportMonth(2026, 1)).toEqual({ year: 2026, month: 6 });
    expect(clampPartnersReportMonth(2026, 5)).toEqual({ year: 2026, month: 6 });
    expect(clampPartnersReportMonth(2026, 7)).toEqual({ year: 2026, month: 7 });
  });

  it('limits 2026 months to June through December', () => {
    expect(getPartnersReportAllowedMonths(2026)).toEqual([6, 7, 8, 9, 10, 11, 12]);
    expect(getPartnersReportAllowedMonths(2027)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it('starts allowed years from 2026', () => {
    const years = getPartnersReportAllowedYears(new Date(2028, 0, 1));
    expect(years[0]).toBe(2026);
    expect(years).not.toContain(2025);
  });

  it('detects minimum month boundary for previous navigation', () => {
    expect(isAtPartnersReportMinimum(2026, 6)).toBe(true);
    expect(isAtPartnersReportMinimum(2026, 7)).toBe(false);
    expect(isAtPartnersReportMinimum(2027, 1)).toBe(false);
  });

  it('clamps current month when before minimum', () => {
    expect(getPartnersReportCurrentMonth(new Date(2026, 3, 15))).toEqual({
      year: 2026,
      month: 6,
    });
    expect(getPartnersReportCurrentMonth(new Date(2026, 6, 15))).toEqual({
      year: 2026,
      month: 7,
    });
  });

  it('returns API validation error for unsupported periods', () => {
    expect(validatePartnersReportMinimumPeriod(2026, 5)).toBe(
      'تقارير الشركاء متاحة بداية من يونيو 2026'
    );
    expect(validatePartnersReportMinimumPeriod(2026, 6)).toBeNull();
  });
});
