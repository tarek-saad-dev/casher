/**
 * Concurrency / dual-open prevention for active-session policy.
 * Simulates two parallel check-ins (same EmpID, different branches, same WorkDate).
 * Proves: at most one ACTIVE_OPEN and second call gets ALREADY_OPEN.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const EMP_ID = 42;
const BRANCH_A = 10;
const BRANCH_B = 20;
const WORK_DATE = '2026-08-25';

type AttRow = {
  ID: number;
  BranchID: number;
  EmpID: number;
  WorkDate: string;
  CheckInTime: string | null;
  CheckOutTime: string | null;
  Status: string | null;
};

const harness = vi.hoisted(() => {
  const attendance: AttRow[] = [];
  let nextId = 1;
  let lockHeld = false;
  const waiters: Array<() => void> = [];

  function ymd(v: unknown): string {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).slice(0, 10);
  }

  function makeRequest() {
    const inputs: Record<string, unknown> = {};
    return {
      input(name: string, _t: unknown, value: unknown) {
        inputs[name] = value;
        return this;
      },
      async query(sqlText: string) {
        const sql = sqlText;
        if (/sp_getapplock/i.test(sql)) {
          if (lockHeld) {
            await new Promise<void>((resolve) => waiters.push(resolve));
          }
          lockHeld = true;
          return { recordset: [{ lockResult: 0 }] };
        }
        if (
          /CheckOutTime IS NULL/i.test(sql) &&
          /EmpID = @empId/i.test(sql) &&
          !/BranchID\s*<>/i.test(sql) &&
          !/WorkDate = @workDate/i.test(sql)
        ) {
          const empId = Number(inputs.empId);
          return {
            recordset: attendance
              .filter(
                (r) =>
                  r.EmpID === empId &&
                  r.CheckInTime != null &&
                  r.CheckOutTime == null,
              )
              .map((r) => ({
                ID: r.ID,
                EmpID: r.EmpID,
                BranchID: r.BranchID,
                WorkDate: r.WorkDate,
                CheckInTime: r.CheckInTime,
              })),
          };
        }
        if (
          /FROM dbo\.TblEmpAttendance/i.test(sql) &&
          /WorkDate = @workDate/i.test(sql) &&
          /BranchID = @branchId/i.test(sql) &&
          /SELECT/i.test(sql) &&
          !/INSERT/i.test(sql)
        ) {
          const row = attendance.find(
            (r) =>
              r.EmpID === Number(inputs.empId) &&
              r.BranchID === Number(inputs.branchId) &&
              r.WorkDate === ymd(inputs.workDate),
          );
          return {
            recordset: row
              ? [{ ID: row.ID, CheckInTime: row.CheckInTime, CheckOutTime: row.CheckOutTime }]
              : [],
          };
        }
        if (/INSERT INTO dbo\.TblEmpAttendance/i.test(sql)) {
          const row: AttRow = {
            ID: nextId++,
            BranchID: Number(inputs.branchId),
            EmpID: Number(inputs.empId),
            WorkDate: ymd(inputs.workDate),
            CheckInTime: '10:00',
            CheckOutTime: null,
            Status: 'Present',
          };
          attendance.push(row);
          return { recordset: [{ ID: row.ID }], rowsAffected: [1] };
        }
        if (/UPDATE dbo\.TblEmpAttendance/i.test(sql)) {
          return { recordset: [], rowsAffected: [1] };
        }
        if (/FROM dbo\.TblEmp\b/i.test(sql)) {
          return {
            recordset: [
              {
                EmpName: 'Emp',
                EmploymentType: 'full_time',
                DefaultCheckInTime: '10:00',
                DefaultCheckOutTime: '18:00',
                ScheduleDayOfWeek: 1,
                IsWorkingDay: true,
                ScheduleStartTime: '10:00',
                ScheduleEndTime: '18:00',
              },
            ],
          };
        }
        return { recordset: [], rowsAffected: [1] };
      },
    };
  }

  class MockTransaction {
    async begin() {}
    async commit() {
      lockHeld = false;
      const next = waiters.shift();
      if (next) next();
    }
    async rollback() {
      lockHeld = false;
      const next = waiters.shift();
      if (next) next();
    }
  }

  class MockRequest {
    private inputs: Record<string, unknown> = {};
    constructor(_tx?: unknown) {}
    input(name: string, _t: unknown, value: unknown) {
      this.inputs[name] = value;
      return this;
    }
    async query(sqlText: string) {
      const req = makeRequest();
      for (const [k, v] of Object.entries(this.inputs)) {
        req.input(k, null, v);
      }
      return req.query(sqlText);
    }
  }

  return {
    attendance,
    makeRequest,
    MockTransaction,
    MockRequest,
    pool: { request: () => makeRequest() },
    reset() {
      attendance.length = 0;
      nextId = 1;
      lockHeld = false;
      waiters.length = 0;
    },
  };
});

vi.mock('@/lib/db', () => ({
  getPool: async () => harness.pool,
  sql: {
    Int: 'Int',
    Date: 'Date',
    Time: 'Time',
    TinyInt: 'TinyInt',
    NVarChar: (n: number) => `NVarChar(${n})`,
    VarChar: (n: number) => `VarChar(${n})`,
    Transaction: harness.MockTransaction,
    Request: harness.MockRequest,
  },
}));

vi.mock('@/lib/hr/empBranchWorkDayClose.service', () => ({
  assertEmpBranchWorkDayMutable: vi.fn(async () => undefined),
}));

vi.mock('@/lib/hr/attendance/branchAttendance.service', () => ({
  assertEmployeeEligibleForBranchAttendance: vi.fn(async () => undefined),
}));

vi.mock('@/lib/hr/attendance-breaks-db', () => ({
  ensureAttendanceBreakSchema: vi.fn(async () => undefined),
  replaceAttendanceBreaks: vi.fn(async () => 0),
}));

vi.mock('@/lib/hr/attendance-break-time-db', () => ({
  ensureAttendanceBreakTimeSchema: vi.fn(async () => undefined),
  replaceAttendanceBreakTimes: vi.fn(async () => 0),
}));

vi.mock('@/lib/hr/attendance-break-schedule-sync', () => ({
  syncBlockRangesFromBreaks: vi.fn(async () => undefined),
  syncBlockRangesFromBreakTimes: vi.fn(async () => undefined),
}));

vi.mock('@/lib/hr/attendance-shift-schedule-sync', () => ({
  syncAttendanceShiftToOverrides: vi.fn(async () => undefined),
  syncAttendanceAbsenceToDayOffOverride: vi.fn(async () => undefined),
}));

vi.mock('@/lib/hr/attendance/workOnDayOff.service', () => ({
  unlockScheduleForWorkOnDayOff: vi.fn(async () => ({
    dayOffOverridesCleared: 0,
    dayOffRowsCleared: 0,
    customHours: null,
  })),
}));

vi.mock('@/lib/services/employeeAttendanceWhatsAppNotify', () => ({
  scheduleAttendanceCheckInOutWhatsApp: vi.fn(),
}));

vi.mock('@/lib/hr/attendance-eligibility', () => ({
  resolveScheduleForDay: () => ({ scheduledStart: '10:00', scheduledEnd: '18:00' }),
}));

vi.mock('@/lib/hr/employee-hr-model', () => ({
  normalizeEmploymentType: () => 'full_time',
}));

vi.mock('@/lib/timeUtils', () => ({
  calcLateMinutes: () => 0,
  calcEarlyLeaveMinutes: () => 0,
}));

import { saveAdminAttendance } from '@/modules/attendance';
import { AttendanceCommandError } from '@/modules/attendance';

describe('active-session concurrency (same WorkDate, two branches)', () => {
  beforeEach(() => {
    harness.reset();
  });

  it('one of two parallel check-ins succeeds; final ACTIVE_OPEN count <= 1', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        saveAdminAttendance({
          branchId: i % 2 === 0 ? BRANCH_A : BRANCH_B,
          userId: 1,
          empId: EMP_ID,
          workDate: WORK_DATE,
          checkInTime: '10:00',
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    for (const r of rejected) {
      expect(r.status).toBe('rejected');
      if (r.status === 'rejected') {
        expect(r.reason).toBeInstanceOf(AttendanceCommandError);
        expect((r.reason as AttendanceCommandError).code).toBe('ALREADY_OPEN');
        expect((r.reason as AttendanceCommandError).statusCode).toBe(409);
      }
    }

    const activeOpen = harness.attendance.filter(
      (r) =>
        r.EmpID === EMP_ID &&
        r.WorkDate === WORK_DATE &&
        r.CheckInTime != null &&
        r.CheckOutTime == null,
    );
    expect(activeOpen.length).toBeLessThanOrEqual(1);
  });
});
