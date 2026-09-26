/**
 * Booking V2 — per-business-date weekly baseline as-of helpers.
 *
 * A 14-day matrix must evaluate Emp×Branch×BusinessDate against the schedule /
 * assignment effective ON THAT business date — never a single range-level
 * asOfDate (e.g. range.to) applied to every day.
 */

import { parseDayOfWeek, type DayOfWeek } from '@/lib/booking/domain/WeeklyBaseline';
import { dayOfWeekFromYmd } from '@/lib/booking/projection/resolveBookingAvailabilityV2';

export type WeeklyBaselineAsOfKey = {
  employeeId: number;
  branchId: number;
  dayOfWeek: DayOfWeek | number;
  /** MUST equal the business date being projected. */
  asOfDate: string;
};

/**
 * Build unique weekly-baseline lookup keys for a date range.
 * Each business date uses itself as asOfDate (not range.to / max).
 */
export function buildWeeklyBaselineKeysForBusinessDates(args: {
  employeeIds: number[];
  branchIds: number[];
  businessDates: string[];
}): WeeklyBaselineAsOfKey[] {
  const byKey = new Map<string, WeeklyBaselineAsOfKey>();
  for (const branchId of args.branchIds) {
    for (const employeeId of args.employeeIds) {
      for (const businessDate of args.businessDates) {
        const dayOfWeek = parseDayOfWeek(dayOfWeekFromYmd(businessDate));
        const asOfDate = businessDate;
        const key = `${employeeId}:${branchId}:${dayOfWeek}:${asOfDate}`;
        if (!byKey.has(key)) {
          byKey.set(key, { employeeId, branchId, dayOfWeek, asOfDate });
        }
      }
    }
  }
  return [...byKey.values()];
}

export function isEffectiveOnDate(args: {
  effectiveFrom: string;
  effectiveTo: string | null;
  asOfDate: string;
}): boolean {
  if (args.effectiveFrom > args.asOfDate) return false;
  if (args.effectiveTo != null && args.effectiveTo < args.asOfDate) return false;
  return true;
}

export type EffectiveDatedRow = {
  effectiveFrom: string;
  effectiveTo: string | null;
  /** Tie-break when EffectiveFrom ties (higher wins). */
  id?: number;
};

/**
 * Pick the latest row effective on asOfDate (ORDER BY EffectiveFrom DESC, id DESC).
 */
export function pickLatestEffectiveRow<T extends EffectiveDatedRow>(
  rows: T[],
  asOfDate: string,
): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (!isEffectiveOnDate({
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      asOfDate,
    })) {
      continue;
    }
    if (!best) {
      best = row;
      continue;
    }
    if (row.effectiveFrom > best.effectiveFrom) {
      best = row;
      continue;
    }
    if (
      row.effectiveFrom === best.effectiveFrom &&
      (row.id ?? 0) > (best.id ?? 0)
    ) {
      best = row;
    }
  }
  return best;
}

/**
 * @deprecated Do NOT use for multi-day ranges. Kept only to document the bug
 * that applied range.to to every Emp×Branch×DOW cell.
 */
export function collapseAsOfToRangeEnd(asOfDates: string[]): string {
  return [...asOfDates].sort().at(-1)!;
}
