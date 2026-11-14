import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  sql: { Int: 'int', TinyInt: 'tinyint' },
  getPool: vi.fn(),
}));
import {
  resolveFinancialWorkScheduleRow,
  resolveEmployeeFinancialWorkSchedule,
  financialScheduleDayOfWeek,
} from '../financialWorkSchedule';

describe('HR financial schedule is independent of booking allocation', () => {
  it('uses business-date weekday, including yesterday at 01:00 Cairo', () => {
    expect(financialScheduleDayOfWeek('2026-11-13')).toBe(5);
    expect(financialScheduleDayOfWeek('2026-11-14')).toBe(6);
    expect(financialScheduleDayOfWeek('2026-11-31')).toBeNull();
  });
  const row = {
    EmploymentType: 'full_time',
    ScheduleDayOfWeek: 6,
    IsWorkingDay: 1,
    ScheduleStartTime: '12:00',
    ScheduleEndTime: '22:00',
    DefaultCheckInTime: '12:00',
    DefaultCheckOutTime: '22:00',
  };
  it('uses 12:00 HR start instead of a 13:00 booking window', () => {
    expect(resolveFinancialWorkScheduleRow(row)).toEqual({
      isScheduledWorkingDay: true, scheduledStart: '12:00', scheduledEnd: '22:00',
    });
  });
  it('respects HR weekly off despite employee defaults and booking slots', () => {
    expect(resolveFinancialWorkScheduleRow({ ...row, IsWorkingDay: 0 })).toEqual({
      isScheduledWorkingDay: false, scheduledStart: null, scheduledEnd: null,
    });
  });
  it('full-time HR default fallback when there is no weekly workday row', () => {
    expect(resolveFinancialWorkScheduleRow({ ...row, ScheduleDayOfWeek: null })).toEqual({
      isScheduledWorkingDay: true, scheduledStart: '12:00', scheduledEnd: '22:00',
    });
  });
  it('does not infer freelance or part-time workdays from booking hours', () => {
    for (const type of ['part_time', 'freelance']) {
      expect(resolveFinancialWorkScheduleRow({
        ...row, EmploymentType: type, ScheduleDayOfWeek: null,
      }).isScheduledWorkingDay).toBe(false);
    }
  });
  it('queries HR schedule only, scoped to the employee tenant', async () => {
    let query = '';
    const db = {
      request: () => ({
        input() { return this; },
        async query(q: string) { query = q; return { recordset: [row] }; },
      }),
    };
    const result = await resolveEmployeeFinancialWorkSchedule({
      db: db as never, empId: 11, branchId: 2, workDate: '2026-11-14',
    });
    expect(result?.scheduledStart).toBe('12:00');
    expect(query).toContain('dbo.TblEmpWorkSchedule');
    expect(query).not.toContain('TblEmpBranchWorkSchedule');
    expect(query).toContain('LegacyBranchId=@branchId');
  });
});
