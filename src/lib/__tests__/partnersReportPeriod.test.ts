import { describe, it, expect } from 'vitest';
import {
  PARTNERS_REPORT_MIN_DATE,
  clampPartnersReportMonth,
  getPartnersReportAllowedMonths,
  getPartnersReportAllowedYears,
  getPartnersReportCurrentMonth,
  isAtPartnersReportMinimum,
  isBeforePartnersReportMinimum,
  shiftPartnersReportMonthBack,
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

  it('shifts calendar month back correctly across year boundary', () => {
    expect(shiftPartnersReportMonthBack(2026, 8)).toEqual({ year: 2026, month: 7 });
    expect(shiftPartnersReportMonthBack(2027, 1)).toEqual({ year: 2026, month: 12 });
  });

  it('defaults to previous Cairo month for review/closing', () => {
    // Mid July → June (still within minimum)
    expect(getPartnersReportCurrentMonth(cairoWallClock('2026-07-15T12:00:00'))).toEqual({
      year: 2026,
      month: 6,
    });
    // Mid August → July
    expect(getPartnersReportCurrentMonth(cairoWallClock('2026-08-15T12:00:00'))).toEqual({
      year: 2026,
      month: 7,
    });
    // Day 1 August → July
    expect(getPartnersReportCurrentMonth(cairoWallClock('2026-08-01T01:45:00'))).toEqual({
      year: 2026,
      month: 7,
    });
    // January → December previous year
    expect(getPartnersReportCurrentMonth(cairoWallClock('2027-01-10T12:00:00'))).toEqual({
      year: 2026,
      month: 12,
    });
  });

  it('clamps default when previous month is before June 2026', () => {
    expect(getPartnersReportCurrentMonth(cairoWallClock('2026-06-15T12:00:00'))).toEqual({
      year: 2026,
      month: 6,
    });
    expect(getPartnersReportCurrentMonth(cairoWallClock('2026-04-15T12:00:00'))).toEqual({
      year: 2026,
      month: 6,
    });
  });

  it('returns API validation error for unsupported periods', () => {
    expect(validatePartnersReportMinimumPeriod(2026, 5)).toBe(
      'تقارير الشركاء متاحة بداية من يونيو 2026'
    );
    expect(validatePartnersReportMinimumPeriod(2026, 6)).toBeNull();
  });
});
