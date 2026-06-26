/**
 * Shared month/year helpers for monthly reports.
 * Uses calendar month boundaries (same convention as expenses/monthly API).
 */

export interface MonthDateRange {
  year: number;
  month: number;
  startDate: string;
  endDate: string;
}

export function getMonthDateRange(year: number, month: number): MonthDateRange {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { year, month, startDate, endDate };
}

export interface ParsedMonthYear {
  year: number;
  month: number;
}

export function parseMonthYearParams(
  yearParam: string | null,
  monthParam: string | null,
  now: Date = new Date()
): ParsedMonthYear {
  const year = yearParam ? parseInt(yearParam, 10) : now.getFullYear();
  const month = monthParam ? parseInt(monthParam, 10) : now.getMonth() + 1;
  return { year, month };
}

export function validateMonthYear(
  year: number,
  month: number,
  now: Date = new Date()
): string | null {
  if (isNaN(year) || year < 2020 || year > now.getFullYear() + 1) {
    return 'سنة غير صالحة';
  }
  if (isNaN(month) || month < 1 || month > 12) {
    return 'شهر غير صالح';
  }
  return null;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
