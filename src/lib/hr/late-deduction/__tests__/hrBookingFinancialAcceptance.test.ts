import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
  sql: { Int: 'int', TinyInt: 'tinyint' },
}));

import {
  financialScheduleDayOfWeek,
  resolveEmployeeFinancialWorkSchedule,
  resolveFinancialWorkScheduleRow,
} from '../financialWorkSchedule';
import { calcLateMinutes } from '@/lib/timeUtils';
import {
  calculateLateDeductionAmount,
  dailyBasePayFromHourly,
  dailyBasePayFromMonthlySalary,
} from '../rules';

/**
 * Acceptance matrix: payroll/late penalties use HR employee workdays,
 * not booking availability. No SQL writes and no WhatsApp delivery.
 */
describe('Cut Salon: HR hours vs booking-window financial acceptance', () => {
  const hr = {
    EmploymentType: 'full_time',
    ScheduleDayOfWeek: 6,
    IsWorkingDay: 1,
    ScheduleStartTime: '12:00',
    ScheduleEndTime: '22:00',
    DefaultCheckInTime: '11:00',
    DefaultCheckOutTime: '23:00',
  };

  it('explicit HR weekly shift overrides both employee defaults and 13:00 booking start', () => {
    const actual = resolveFinancialWorkScheduleRow(hr);
    expect(actual).toEqual({
      isScheduledWorkingDay: true,
      scheduledStart: '12:00',
      scheduledEnd: '22:00',
    });
    expect(calcLateMinutes('12:20', actual.scheduledStart)).toBe(20);
    expect(calcLateMinutes('12:20', '13:00')).toBe(0);
    expect(calculateLateDeductionAmount({
      lateMinutes: 20,
      dailyBasePay: dailyBasePayFromMonthlySalary(10400),
    })).toEqual({ bracket: 'quarter', amount: 100, fraction: 0.25 });
  });

  it.each([
    ['12:00', 0, 'none', null],
    ['12:01', 1, 'none', null],
    ['12:14', 14, 'none', null],
    ['12:15', 15, 'quarter', 100],
    ['13:00', 60, 'quarter', 100],
    ['13:01', 61, 'half', 200],
    ['14:00', 120, 'half', 200],
    ['14:01', 121, 'manager_review', null],
  ] as const)('arrival %s -> %i minutes -> %s, amount %s', (checkIn, mins, bracket, amount) => {
    const start = resolveFinancialWorkScheduleRow(hr).scheduledStart;
    const actualMinutes = calcLateMinutes(checkIn, start);
    expect(actualMinutes).toBe(mins);
    const result = calculateLateDeductionAmount({ lateMinutes: actualMinutes, dailyBasePay: 400 });
    expect(result.bracket).toBe(bracket);
    expect(result.amount).toBe(amount);
  });

  it('hourly scheduled base uses 10 HR hours, not 8 available booking hours', () => {
    const financial = resolveFinancialWorkScheduleRow(hr);
    expect(dailyBasePayFromHourly({
      hourlyRate: 40,
      scheduledStart: financial.scheduledStart,
      scheduledEnd: financial.scheduledEnd,
    })).toBe(400);
    expect(dailyBasePayFromHourly({
      hourlyRate: 40, scheduledStart: '13:00', scheduledEnd: '21:00',
    })).toBe(320);
  });

  it.each(['Absent', 'absent', 'DayOff', 'off', 'Excused'])(
    'explicit HR weekly day off is never considered a payable late workday (%s)',
    () => {
      const schedule = resolveFinancialWorkScheduleRow({ ...hr, IsWorkingDay: 0 });
      expect(schedule).toEqual({
        isScheduledWorkingDay: false, scheduledStart: null, scheduledEnd: null,
      });
    },
  );

  it('part-time requires an explicit working-day row; booking availability is insufficient', () => {
    const noWeekly = { ...hr, EmploymentType: 'part_time', ScheduleDayOfWeek: null };
    expect(resolveFinancialWorkScheduleRow(noWeekly).isScheduledWorkingDay).toBe(false);
    expect(resolveFinancialWorkScheduleRow({
      ...hr, EmploymentType: 'part_time', IsWorkingDay: 1,
    }).scheduledStart).toBe('12:00');
  });

  it('late-night HR schedule calculates next-day arrival on same business shift', () => {
    expect(financialScheduleDayOfWeek('2026-11-13')).toBe(5);
    expect(calcLateMinutes('00:20', '23:00')).toBe(80);
    expect(calculateLateDeductionAmount({ lateMinutes: 80, dailyBasePay: 400 }).amount).toBe(200);
  });

  it('invalid work dates never trigger DB schedule reads', async () => {
    const query = vi.fn();
    const db = { request: query };
    const result = await resolveEmployeeFinancialWorkSchedule({
      empId: 11, branchId: 2, workDate: '2026-02-30', db: db as never,
    });
    expect(result).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects cross-tenant or missing employees instead of falling back to booking hours', async () => {
    const sqlText: string[] = [];
    const db = { request: () => ({
      input() { return this; },
      async query(q: string) {
        sqlText.push(q);
        return { recordset: [] };
      },
    }) };
    const result = await resolveEmployeeFinancialWorkSchedule({
      empId: 999, branchId: 2, workDate: '2026-11-14', db: db as never,
    });
    expect(result).toBeNull();
    expect(sqlText[0]).toContain('e.TenantId IN');
    expect(sqlText[0]).toContain('LegacyBranchId=@branchId');
    expect(sqlText[0]).not.toContain('TblEmpBranchWorkSchedule');
  });
});
