import { describe, expect, it } from 'vitest';
import { buildScheduleRows, countWorkingDays } from '@/lib/hr/employee-hr-schedule';

describe('buildScheduleRows', () => {
  it('full_time fixed_weekly creates 6 working days and 1 day off', () => {
    const rows = buildScheduleRows(
      'full_time',
      'fixed_weekly',
      { weeklyDayOff: 5 },
      '09:00:00',
      '17:00:00',
    );
    expect(rows).toHaveLength(7);
    expect(countWorkingDays(rows)).toBe(6);
    expect(rows.find((r) => r.dayOfWeek === 5)?.isWorkingDay).toBe(false);
    expect(rows.find((r) => r.dayOfWeek === 5)?.notes).toBe('إجازة أسبوعية');
    expect(rows.find((r) => r.dayOfWeek === 0)?.startTime).toBe('09:00:00');
  });

  it('full_time flexible_weekly creates 7 working days (محمد case)', () => {
    const rows = buildScheduleRows(
      'full_time',
      'flexible_weekly',
      {},
      '09:00:00',
      '17:00:00',
    );
    expect(rows).toHaveLength(7);
    expect(countWorkingDays(rows)).toBe(7);
    expect(rows.every((r) => r.isWorkingDay)).toBe(true);
    expect(rows[0]?.notes).toBe('إجازة أسبوعية مرنة');
  });

  it('part_time creates only selected working days', () => {
    const rows = buildScheduleRows(
      'part_time',
      'none',
      { workingDays: [0, 2, 4] },
      '10:00:00',
      '18:00:00',
    );
    expect(rows).toHaveLength(7);
    expect(countWorkingDays(rows)).toBe(3);
    expect(rows.filter((r) => r.isWorkingDay).map((r) => r.dayOfWeek)).toEqual([0, 2, 4]);
  });

  it('freelance creates 7 non-working days (no fixed schedule)', () => {
    const rows = buildScheduleRows('freelance', 'none', null, null, null);
    expect(rows).toHaveLength(7);
    expect(countWorkingDays(rows)).toBe(0);
    expect(rows.every((r) => !r.isWorkingDay)).toBe(true);
  });
});
