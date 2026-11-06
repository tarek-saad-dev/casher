import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getConfig: vi.fn(),
  eligible: vi.fn(),
  enqueue: vi.fn(),
  schedule: vi.fn(),
  voidExcluded: vi.fn(),
  loadSchedule: vi.fn(),
  getDb: vi.fn(),
  attendance: {
    CheckInTime: '12:30:00',
    Status: 'absent',
    ScheduledStartTime: '12:00',
    ScheduledEndTime: '22:00',
  } as Record<string, unknown>,
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
  getAttendanceDb: m.getDb,
  loadEmployeeScheduleForAdminPut: m.loadSchedule,
}));

import { enqueueLegacyEmployeeCheckInLateDeduction } from '../legacyCheckIn';

const input = { attendanceId: 77, empId: 9, branchId: 2, workDate: '2026-11-03' };

describe('legacy bridge voids lowercase absent/off with saved check-in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.getConfig.mockResolvedValue({ enabled: true, activatedOn: '2026-11-01' });
    m.eligible.mockReturnValue(true);
    m.voidExcluded.mockResolvedValue({ handled: true, voided: true });
    m.enqueue.mockResolvedValue({ enqueued: true });
    m.getDb.mockResolvedValue({
      request: () => ({
        input() {
          return this;
        },
        query: async () => ({ recordset: [m.attendance] }),
      }),
    });
  });

  it('voids existing debit for lowercase absent with checkInTime', async () => {
    m.attendance = {
      CheckInTime: '12:30:00',
      Status: 'absent',
      ScheduledStartTime: '12:00',
      ScheduledEndTime: '22:00',
    };
    await enqueueLegacyEmployeeCheckInLateDeduction(input);
    expect(m.voidExcluded).toHaveBeenCalledWith(
      expect.objectContaining({
        attendanceId: 77,
        empId: 9,
        branchId: 2,
        status: 'absent',
      }),
    );
    expect(m.enqueue).not.toHaveBeenCalled();
    expect(m.schedule).not.toHaveBeenCalled();
  });

  it('voids existing debit for lowercase off with checkInTime', async () => {
    m.attendance = {
      CheckInTime: '12:45:00',
      Status: 'off',
      ScheduledStartTime: '12:00',
      ScheduledEndTime: '22:00',
    };
    await enqueueLegacyEmployeeCheckInLateDeduction(input);
    expect(m.voidExcluded).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'off' }),
    );
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it('still finalizes lowercase present', async () => {
    m.attendance = {
      CheckInTime: '12:01:00',
      Status: 'present',
      ScheduledStartTime: null,
      ScheduledEndTime: null,
    };
    m.loadSchedule.mockResolvedValue({
      EmploymentType: 'full_time',
      ScheduleDayOfWeek: 2,
      IsWorkingDay: true,
      ScheduleStartTime: '12:00',
      ScheduleEndTime: '22:00',
      DefaultCheckInTime: '12:00',
      DefaultCheckOutTime: '22:00',
    });
    m.getDb.mockResolvedValue({
      request: () => ({
        input() {
          return this;
        },
        query: async (statement: string) => {
          if (statement.startsWith('SELECT TOP 1 CheckInTime')) {
            return { recordset: [m.attendance] };
          }
          return { rowsAffected: [1], recordset: [] };
        },
      }),
    });
    await enqueueLegacyEmployeeCheckInLateDeduction(input);
    expect(m.voidExcluded).not.toHaveBeenCalled();
    expect(m.enqueue).toHaveBeenCalledTimes(1);
    expect(m.schedule).toHaveBeenCalledTimes(1);
  });
});
