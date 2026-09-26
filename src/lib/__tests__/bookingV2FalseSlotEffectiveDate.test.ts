/**
 * Characterization: 14-day V2 matrix must not inherit a later effective schedule.
 *
 * Bug (pre-fix): resolveBookingAvailabilityV2FullDb / rebuildHotPayloadsForMissKeys
 * used `asOfDate = businessDateRange.to` for every day, so a schedule that becomes
 * effective mid-range was applied to earlier business dates → FreeMask false slots
 * that `/plan` (which evaluates as-of the workDate) correctly rejects.
 */
import { describe, expect, it } from 'vitest';

import { AvailabilityBitmap, BookingPolicy } from '@/lib/booking/domain';
import type { WeeklyBaselineSourceInputs } from '@/lib/booking/domain/WeeklyBaseline';
import {
  buildWeeklyBaselineKeysForBusinessDates,
  collapseAsOfToRangeEnd,
  isEffectiveOnDate,
  pickLatestEffectiveRow,
} from '@/lib/booking/projection/weeklyBaselineAsOf';

const EMP = 5;
const BRANCH = 1;

/** Schedule rows overlapping Sep 20 → Oct 3. New longer hours from Sep 27. */
const SCHEDULE_ROWS = [
  {
    id: 10,
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-09-26',
    isWorking: true,
    start: '10:00',
    end: '18:00',
  },
  {
    id: 20,
    effectiveFrom: '2026-09-27',
    effectiveTo: null as string | null,
    isWorking: true,
    start: '10:00',
    end: '22:00', // new late evening — must NOT appear on Sep 21
  },
];

function inputsForSchedule(args: {
  asOfDate: string;
  employeeId?: number;
  branchId?: number;
  dayOfWeek?: number;
}): WeeklyBaselineSourceInputs {
  const picked = pickLatestEffectiveRow(SCHEDULE_ROWS, args.asOfDate);
  return {
    key: {
      employeeId: args.employeeId ?? EMP,
      branchId: args.branchId ?? BRANCH,
      dayOfWeek: (args.dayOfWeek ?? 1) as 0 | 1 | 2 | 3 | 4 | 5 | 6,
    },
    employeeWindows:
      picked?.isWorking && picked.start && picked.end
        ? [{ startHhmm: picked.start, endHhmm: picked.end }]
        : [],
    isEmployeeWorkingDay: !!(picked?.isWorking && picked.start && picked.end),
    branchHours: { startHhmm: '09:00', endHhmm: '23:00' },
    branchIsOpen: true,
  };
}

function freeMaskFromAsOf(asOfDate: string): AvailabilityBitmap {
  const plan = BookingPolicy.normalizeWeeklyBaseline(inputsForSchedule({ asOfDate }));
  return BookingPolicy.weeklyBaselineBitmap(plan);
}

describe('14-day effective-date weekly baseline (false-slot characterization)', () => {
  it('documents that collapsing asOf to range.to is the historical bug', () => {
    const dates = ['2026-09-21', '2026-09-28', '2026-10-03'];
    expect(collapseAsOfToRangeEnd(dates)).toBe('2026-10-03');
  });

  it('buildWeeklyBaselineKeysForBusinessDates uses EACH business date as asOfDate', () => {
    // Sep 21 and Sep 28 are both Mondays (dow=1) — must still be distinct keys.
    const keys = buildWeeklyBaselineKeysForBusinessDates({
      employeeIds: [EMP],
      branchIds: [BRANCH],
      businessDates: ['2026-09-21', '2026-09-28'],
    });
    const asOfs = keys.map((k) => k.asOfDate).sort();
    expect(asOfs).toEqual(['2026-09-21', '2026-09-28']);
    expect(keys.every((k) => k.dayOfWeek === 1)).toBe(true);
  });

  it('pickLatestEffectiveRow selects pre-change hours for Sep 21 and post-change for Sep 28', () => {
    expect(pickLatestEffectiveRow(SCHEDULE_ROWS, '2026-09-21')?.id).toBe(10);
    expect(pickLatestEffectiveRow(SCHEDULE_ROWS, '2026-09-28')?.id).toBe(20);
    expect(
      isEffectiveOnDate({
        effectiveFrom: '2026-09-27',
        effectiveTo: null,
        asOfDate: '2026-09-21',
      }),
    ).toBe(false);
  });

  it('FALSE SLOT PATH: range.to asOf incorrectly exposes 19:00 on Sep 21', () => {
    const rangeTo = '2026-10-03';
    const wrongMask = freeMaskFromAsOf(rangeTo); // bug: applied to Sep 21
    const correctMask = freeMaskFromAsOf('2026-09-21');

    // 19:00 for 30m — free under post-change schedule, NOT under pre-change.
    expect(wrongMask.hasConsecutiveFreeAt(19 * 60, 30)).toBe(true);
    expect(correctMask.hasConsecutiveFreeAt(19 * 60, 30)).toBe(false);

    // Strong /plan evaluates as-of workDate (= Sep 21) → rejects 19:00.
    // V2 matrix with range.to asOf → exposes 19:00 → deterministic disagreement.
    expect(wrongMask.hasConsecutiveFreeAt(19 * 60, 30)).not.toBe(
      correctMask.hasConsecutiveFreeAt(19 * 60, 30),
    );
  });

  it('CORRECT PATH: per-business-date asOf agrees with strong evaluator date', () => {
    const sep21 = freeMaskFromAsOf('2026-09-21');
    const sep28 = freeMaskFromAsOf('2026-09-28');
    expect(sep21.hasConsecutiveFreeAt(19 * 60, 30)).toBe(false);
    expect(sep28.hasConsecutiveFreeAt(19 * 60, 30)).toBe(true);
    expect(sep21.hasConsecutiveFreeAt(17 * 60, 30)).toBe(true);
  });

  it('does not allow same Emp×Branch×DOW to share one asOf across mid-range change', () => {
    const keys = buildWeeklyBaselineKeysForBusinessDates({
      employeeIds: [EMP],
      branchIds: [BRANCH],
      businessDates: ['2026-09-21', '2026-09-28'],
    });
    // Historical bug keyed only Emp×Branch×DOW×range.to → one entry.
    // Correct: two entries even when DOW matches.
    expect(keys).toHaveLength(2);
  });
});
