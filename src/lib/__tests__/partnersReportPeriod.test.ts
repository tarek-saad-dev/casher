import { describe, it, expect } from 'vitest';
import {
  PARTNERS_REPORT_MIN_DATE,
  clampPartnersReportMonth,
  getPartnersReportAllowedMonths,
  getPartnersReportAllowedYears,
  getPartnersReportCurrentMonth,
  isAtPartnersReportMinimum,
  isBeforePartnersReportMinimum,
  isPartnersReportClosingGraceDay,
  validatePartnersReportMinimumPeriod,
} from '@/lib/reports/partnersReportPeriod';

function cairoWallClock(isoLocal: string): Date {
  return new Date(`${isoLocal}+03:00`);
}

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
    const years = getPartnersReportAllowedYears(cairoWallClock('2028-01-01T12:00:00'));
    expect(years[0]).toBe(2026);
    expect(years).not.toContain(2025);
  });

  it('detects minimum month boundary for previous navigation', () => {
    expect(isAtPartnersReportMinimum(2026, 6)).toBe(true);
    expect(isAtPartnersReportMinimum(2026, 7)).toBe(false);
    expect(isAtPartnersReportMinimum(2027, 1)).toBe(false);
  });

  it('uses Cairo month; clamps when before minimum', () => {
    expect(getPartnersReportCurrentMonth(cairoWallClock('2026-04-15T12:00:00'))).toEqual({
      year: 2026,
      month: 6,
    });
    expect(getPartnersReportCurrentMonth(cairoWallClock('2026-07-15T12:00:00'))).toEqual({
      year: 2026,
      month: 7,
    });
  });

  it('on Cairo day 1 keeps previous month open for closing', () => {
    expect(isPartnersReportClosingGraceDay(cairoWallClock('2026-08-01T00:30:00'))).toBe(true);
    expect(isPartnersReportClosingGraceDay(cairoWallClock('2026-08-01T23:59:00'))).toBe(true);
    expect(isPartnersReportClosingGraceDay(cairoWallClock('2026-08-02T00:30:00'))).toBe(false);

    expect(getPartnersReportCurrentMonth(cairoWallClock('2026-08-01T01:45:00'))).toEqual({
      year: 2026,
      month: 7,
    });
    expect(getPartnersReportCurrentMonth(cairoWallClock('2026-08-01T18:00:00'))).toEqual({
      year: 2026,
      month: 7,
    });
    expect(getPartnersReportCurrentMonth(cairoWallClock('2026-08-02T00:00:00'))).toEqual({
      year: 2026,
      month: 8,
    });
  });

  it('returns API validation error for unsupported periods', () => {
    expect(validatePartnersReportMinimumPeriod(2026, 5)).toBe(
      'تقارير الشركاء متاحة بداية من يونيو 2026'
    );
    expect(validatePartnersReportMinimumPeriod(2026, 6)).toBeNull();
  });
});
