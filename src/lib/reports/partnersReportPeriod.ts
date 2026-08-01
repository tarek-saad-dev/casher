/**
 * Partners Report minimum period — reports are available from June 2026 onward.
 * Months use calendar convention: January = 1, December = 12.
 *
 * Default "current month": on Cairo day 1 of a new month, keep the previous
 * month selected so partners can finish month-end closing.
 */

import {
  getCairoCalendarDate,
  shiftCalendarDate,
} from '@/lib/businessDate';

export const PARTNERS_REPORT_MIN_YEAR = 2026;
export const PARTNERS_REPORT_MIN_MONTH = 6;

export const PARTNERS_REPORT_MIN_DATE = {
  year: PARTNERS_REPORT_MIN_YEAR,
  month: PARTNERS_REPORT_MIN_MONTH,
} as const;

export const PARTNERS_REPORT_MIN_PERIOD_ERROR =
  'تقارير الشركاء متاحة بداية من يونيو 2026';

export const PARTNERS_REPORT_PREVIOUS_MONTH_DISABLED_TITLE =
  'لا توجد تقارير متاحة قبل يونيو 2026';

export function isBeforePartnersReportMinimum(year: number, month: number): boolean {
  if (!Number.isFinite(year) || !Number.isFinite(month)) return true;
  if (year < PARTNERS_REPORT_MIN_YEAR) return true;
  if (year === PARTNERS_REPORT_MIN_YEAR && month < PARTNERS_REPORT_MIN_MONTH) return true;
  return false;
}

export function isAtPartnersReportMinimum(year: number, month: number): boolean {
  return year === PARTNERS_REPORT_MIN_YEAR && month === PARTNERS_REPORT_MIN_MONTH;
}

export function clampPartnersReportMonth(
  year: number,
  month: number
): { year: number; month: number } {
  if (isBeforePartnersReportMinimum(year, month)) {
    return {
      year: PARTNERS_REPORT_MIN_YEAR,
      month: PARTNERS_REPORT_MIN_MONTH,
    };
  }
  return { year, month };
}

export function getPartnersReportAllowedYears(now: Date = new Date()): number[] {
  const cairoYear = Number(getCairoCalendarDate(now).slice(0, 4));
  const maxYear = (Number.isFinite(cairoYear) ? cairoYear : now.getFullYear()) + 1;
  const years: number[] = [];
  for (let y = PARTNERS_REPORT_MIN_YEAR; y <= maxYear; y += 1) {
    years.push(y);
  }
  return years;
}

export function getPartnersReportAllowedMonths(year: number): number[] {
  const startMonth = year === PARTNERS_REPORT_MIN_YEAR ? PARTNERS_REPORT_MIN_MONTH : 1;
  const months: number[] = [];
  for (let m = startMonth; m <= 12; m += 1) {
    months.push(m);
  }
  return months;
}

/** True on Cairo calendar day 1 — partners default stays on previous month for closing. */
export function isPartnersReportClosingGraceDay(now: Date = new Date()): boolean {
  const day = Number(getCairoCalendarDate(now).slice(8, 10));
  return day === 1;
}

/**
 * Default month for partners report ("الشهر الحالي").
 * Uses Cairo calendar; on the 1st, returns previous month so closing stays open.
 */
export function getPartnersReportCurrentMonth(
  now: Date = new Date()
): { year: number; month: number } {
  let calendar = getCairoCalendarDate(now);
  if (isPartnersReportClosingGraceDay(now)) {
    calendar = shiftCalendarDate(calendar, -1);
  }
  const [yearStr, monthStr] = calendar.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  return clampPartnersReportMonth(year, month);
}

export function validatePartnersReportMinimumPeriod(
  year: number,
  month: number
): string | null {
  if (isBeforePartnersReportMinimum(year, month)) {
    return PARTNERS_REPORT_MIN_PERIOD_ERROR;
  }
  return null;
}
