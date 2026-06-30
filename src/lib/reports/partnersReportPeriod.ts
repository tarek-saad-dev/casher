/**
 * Partners Report minimum period — reports are available from June 2026 onward.
 * Months use calendar convention: January = 1, December = 12.
 */

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
  const maxYear = now.getFullYear() + 1;
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

export function getPartnersReportCurrentMonth(
  now: Date = new Date()
): { year: number; month: number } {
  return clampPartnersReportMonth(now.getFullYear(), now.getMonth() + 1);
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
