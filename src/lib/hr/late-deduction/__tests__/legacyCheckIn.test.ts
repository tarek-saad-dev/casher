import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getConfig: vi.fn(), eligible: vi.fn(), enqueue: vi.fn(),
  schedule: vi.fn(), loadSchedule: vi.fn(), getDb: vi.fn(), voidExcluded: vi.fn(),
  queries: [] as string[], args: [] as Array<[string, unknown]>,
  attendance: { CheckInTime: '12:01:00', Status: 'Present',
    ScheduledStartTime: null, ScheduledEndTime: null } as Record<string, unknown>,
}));
vi.mock('@/lib/db', () => ({
  sql: { Int: 'int', Date: 'date', VarChar: () => 'varchar' },
}));
vi.mock('../config', () => ({
  getLateDeductionConfig: m.getConfig,
  isWorkDateEligibleForLateDeduction: m.eligible,
}));
vi.mock('../enqueueFinalize', () => ({ enqueueLateDeductionFinalize: m.enqueue }));
vi.mock('../finalizeOnCheckIn', () => ({
  scheduleFinalizeLateDeductionOnCheckIn: m.schedule,
}));
vi.mock('../voidExcludedAttendance', () => ({
  voidLateDeductionForExcludedAttendance: m.voidExcluded,
}));
vi.mock('@/modules/attendance/infra/AttendanceRepository', () => ({
  getAttendanceDb: m.getDb, loadEmployeeScheduleForAdminPut: m.loadSchedule,
}));

import { enqueueLegacyEmployeeCheckInLateDeduction } from '../legacyCheckIn';

const input = { attendanceId: 44, empId: 11, branchId: 2, workDate: '2026-11-03' };
describe('late deduction: legacy employee check-in bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.queries.length = 0; m.args.length = 0;
    m.attendance = { CheckInTime: '12:01:00', Status: 'Present',
      ScheduledStartTime: null, ScheduledEndTime: null };
    m.getConfig.mockResolvedValue({ enabled: true, activatedOn: '2026-11-03' });
    m.eligible.mockReturnValue(true);
    m.enqueue.mockResolvedValue({ enqueued: true });
    m.voidExcluded.mockResolvedValue({ handled: true, voided: false });
    m.loadSchedule.mockResolvedValue({
      EmploymentType: 'full_time', ScheduleDayOfWeek: 2, IsWorkingDay: true,
      ScheduleStartTime: '12:00', ScheduleEndTime: '22:00',
      DefaultCheckInTime: '12:00', DefaultCheckOutTime: '22:00',
    });
    m.getDb.mockResolvedValue({
      request: () => ({
        input(name: string, _type: unknown, value: unknown) {
          m.args.push([name, value]);
          return this;
        },
        query: async (statement: string) => {
          m.queries.push(statement);
          return statement.startsWith('SELECT TOP 1 CheckInTime')
            ? { recordset: [m.attendance] }
            : { rowsAffected: [1], recordset: [] };
        },
      }),
    });
  });

  it('saves 1 late minute and durable enqueue using employee-specific shift', async () => {
    await enqueueLegacyEmployeeCheckInLateDeduction(input);
    expect(m.queries.some(q => q.includes('SET ScheduledStartTime'))).toBe(true);
    expect(m.args).toContainEqual(['lateMinutes', 1]);
    expect(m.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      ...input, checkInTime: '12:01', scheduledStart: '12:00', scheduledEnd: '22:00',
    }));
    expect(m.schedule).toHaveBeenCalledTimes(1);
  });

  it('does not mutate attendance when feature is off', async () => {
    m.eligible.mockReturnValue(false);
    await enqueueLegacyEmployeeCheckInLateDeduction(input);
    expect(m.getDb).not.toHaveBeenCalled();
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it('skips approved day off and voids excused statuses', async () => {
    m.loadSchedule.mockResolvedValueOnce({
      EmploymentType: 'full_time', ScheduleDayOfWeek: 2, IsWorkingDay: false,
      ScheduleStartTime: null, ScheduleEndTime: null,
      DefaultCheckInTime: '12:00', DefaultCheckOutTime: '22:00',
    });
    await enqueueLegacyEmployeeCheckInLateDeduction(input);
    expect(m.enqueue).not.toHaveBeenCalled();
    expect(m.voidExcluded).toHaveBeenCalled();
    m.voidExcluded.mockClear();
    m.attendance.Status = 'Excused';
    await enqueueLegacyEmployeeCheckInLateDeduction(input);
    expect(m.enqueue).not.toHaveBeenCalled();
    expect(m.voidExcluded).toHaveBeenCalledWith(expect.objectContaining({ status: 'Excused' }));
  });

  it('does not schedule finalize without a durable enqueue', async () => {
    m.enqueue.mockResolvedValue({ enqueued: false });
    await enqueueLegacyEmployeeCheckInLateDeduction(input);
    expect(m.schedule).not.toHaveBeenCalled();
  });
});
