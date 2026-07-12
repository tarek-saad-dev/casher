import { describe, expect, it } from 'vitest';
import {
  buildAttendanceBoardRow,
  computeAttendanceSummary,
  filterAttendanceBoardRows,
  resolveAttendanceEligibility,
  resolveIsFreelance,
  resolveScheduleForDay,
  type RawAttendanceDbRow,
} from '@/lib/hr/attendance-eligibility';

function baseRow(overrides: Partial<RawAttendanceDbRow> = {}): RawAttendanceDbRow {
  return {
    EmpID: 1,
    EmpName: 'Test Employee',
    isActive: 1,
    EmploymentType: 'full_time',
    PayrollMethod: 'hourly',
    DayOffPolicy: 'fixed_weekly',
    IsAttendanceExempt: 0,
    IsPayrollEnabled: 1,
    DefaultCheckInTime: '09:00',
    DefaultCheckOutTime: '17:00',
    ScheduleDayOfWeek: 0,
    IsWorkingDay: 1,
    ScheduleStartTime: '09:00',
    ScheduleEndTime: '17:00',
    AttendanceID: null,
    CheckInTime: null,
    CheckOutTime: null,
    Status: null,
    LateMinutes: null,
    EarlyLeaveMinutes: null,
    Notes: null,
    ...overrides,
  };
}

describe('resolveIsFreelance', () => {
  it('treats freelance employment type as freelance', () => {
    expect(resolveIsFreelance('freelance', false)).toBe(true);
  });

  it('treats IsAttendanceExempt=1 like freelance exemption', () => {
    expect(resolveIsFreelance('full_time', true)).toBe(true);
  });
});

describe('resolveScheduleForDay', () => {
  it('full_time flexible_weekly with 7 working days marks all days as working', () => {
    const schedule = resolveScheduleForDay('full_time', {
      hasScheduleRow: true,
      isWorkingDayFromSchedule: true,
      scheduleStart: '09:00',
      scheduleEnd: '17:00',
      defaultStart: '09:00',
      defaultEnd: '17:00',
    });
    expect(schedule.isScheduledWorkingDay).toBe(true);
  });

  it('full_time without schedule shows warning', () => {
    const schedule = resolveScheduleForDay('full_time', {
      hasScheduleRow: false,
      isWorkingDayFromSchedule: null,
      scheduleStart: null,
      scheduleEnd: null,
      defaultStart: '09:00',
      defaultEnd: '17:00',
    });
    expect(schedule.scheduleWarning).toBe('لا يوجد جدول عمل لهذا الموظف');
    expect(schedule.isScheduledWorkingDay).toBe(true);
  });
});

describe('filterAttendanceBoardRows', () => {
  const workDate = '2026-07-12';
  const dayOfWeek = new Date(`${workDate}T12:00:00Z`).getDay();

  it('full_time working day appears as attendance required with Pending status', () => {
    const rows = filterAttendanceBoardRows([baseRow()], workDate, dayOfWeek, {
      includeFreelance: false,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isAttendanceRequired).toBe(true);
    expect(rows[0]?.Status).toBe('Pending');
  });

  it('full_time day off does not count as absent', () => {
    const rows = filterAttendanceBoardRows(
      [baseRow({ IsWorkingDay: 0, ScheduleStartTime: null, ScheduleEndTime: null })],
      workDate,
      dayOfWeek,
      { includeFreelance: false },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.Status).toBe('DayOff');
    expect(rows[0]?.isAttendanceRequired).toBe(false);
  });

  it('part_time working day appears', () => {
    const rows = filterAttendanceBoardRows(
      [baseRow({ EmploymentType: 'part_time', DayOffPolicy: 'none' })],
      workDate,
      dayOfWeek,
      { includeFreelance: false },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isAttendanceRequired).toBe(true);
  });

  it('part_time off day does not appear by default', () => {
    const rows = filterAttendanceBoardRows(
      [
        baseRow({
          EmploymentType: 'part_time',
          DayOffPolicy: 'none',
          IsWorkingDay: 0,
          ScheduleStartTime: null,
          ScheduleEndTime: null,
        }),
      ],
      workDate,
      dayOfWeek,
      { includeFreelance: false },
    );
    expect(rows).toHaveLength(0);
  });

  it('part_time off day with attendance row still appears', () => {
    const rows = filterAttendanceBoardRows(
      [
        baseRow({
          EmploymentType: 'part_time',
          DayOffPolicy: 'none',
          IsWorkingDay: 0,
          ScheduleStartTime: null,
          ScheduleEndTime: null,
          AttendanceID: 99,
          Status: 'Present',
          CheckInTime: '10:00',
        }),
      ],
      workDate,
      dayOfWeek,
      { includeFreelance: false },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.displayReason).toBe('خارج أيام العمل');
  });

  it('freelance without attendance does not appear by default', () => {
    const rows = filterAttendanceBoardRows(
      [baseRow({ EmploymentType: 'freelance', DayOffPolicy: 'none', IsWorkingDay: 0 })],
      workDate,
      dayOfWeek,
      { includeFreelance: false },
    );
    expect(rows).toHaveLength(0);
  });

  it('freelance with attendance row appears', () => {
    const rows = filterAttendanceBoardRows(
      [
        baseRow({
          EmploymentType: 'freelance',
          DayOffPolicy: 'none',
          IsWorkingDay: 0,
          AttendanceID: 5,
          Status: 'Present',
          CheckInTime: '11:00',
        }),
      ],
      workDate,
      dayOfWeek,
      { includeFreelance: false },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.Status).toBe('Present');
    expect(rows[0]?.isFreelance).toBe(true);
  });

  it('includeFreelance=true returns freelancers without Pending/Absent', () => {
    const rows = filterAttendanceBoardRows(
      [baseRow({ EmploymentType: 'freelance', DayOffPolicy: 'none', IsWorkingDay: 0 })],
      workDate,
      dayOfWeek,
      { includeFreelance: true },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.Status).toBe('FreelanceAvailable');
    expect(rows[0]?.isAttendanceRequired).toBe(false);
  });

  it('inactive employee does not appear', () => {
    const row = buildAttendanceBoardRow(
      baseRow({ isActive: 0 }),
      workDate,
      dayOfWeek,
      { includeFreelance: false },
    );
    expect(row).toBeNull();
  });

  it('IsAttendanceExempt=1 on full_time behaves like freelance', () => {
    const rows = filterAttendanceBoardRows(
      [baseRow({ IsAttendanceExempt: 1 })],
      workDate,
      dayOfWeek,
      { includeFreelance: false },
    );
    expect(rows).toHaveLength(0);
  });
});

describe('computeAttendanceSummary', () => {
  const workDate = '2026-07-12';
  const dayOfWeek = 0;

  it('KPIs exclude freelancers without attendance', () => {
    const required = filterAttendanceBoardRows([baseRow()], workDate, dayOfWeek, {
      includeFreelance: false,
    });
    const summary = computeAttendanceSummary(required);
    expect(summary.pending).toBe(1);
    expect(summary.requiredCount).toBe(1);
  });

  it('KPIs exclude part-time off days from pending/absent', () => {
    const mixed = filterAttendanceBoardRows(
      [
        baseRow({ EmpID: 1, EmpName: 'Full' }),
        baseRow({
          EmpID: 2,
          EmpName: 'Part Off',
          EmploymentType: 'part_time',
          IsWorkingDay: 0,
          ScheduleStartTime: null,
          ScheduleEndTime: null,
        }),
        baseRow({
          EmpID: 3,
          EmpName: 'Freelance',
          EmploymentType: 'freelance',
          IsWorkingDay: 0,
        }),
      ],
      workDate,
      dayOfWeek,
      { includeFreelance: false },
    );
    const summary = computeAttendanceSummary(mixed);
    expect(summary.total).toBe(1);
    expect(summary.pending).toBe(1);
    expect(summary.absent).toBe(0);
  });

  it('day off counts in dayOff KPI but not as absent', () => {
    const rows = filterAttendanceBoardRows(
      [baseRow({ IsWorkingDay: 0, ScheduleStartTime: null, ScheduleEndTime: null })],
      workDate,
      dayOfWeek,
      { includeFreelance: false },
    );
    const summary = computeAttendanceSummary(rows);
    expect(summary.dayOff).toBe(1);
    expect(summary.absent).toBe(0);
    expect(summary.pending).toBe(0);
  });
});

describe('resolveAttendanceEligibility', () => {
  it('full_time always included when active', () => {
    const result = resolveAttendanceEligibility({
      isActive: true,
      employmentType: 'full_time',
      isFreelance: false,
      isScheduledWorkingDay: false,
      hasAttendanceRecord: false,
      includeFreelance: false,
    });
    expect(result.include).toBe(true);
    expect(result.reason).toBe('scheduled_day_off');
  });
});
