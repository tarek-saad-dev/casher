/**
 * Characterization: finalizeIncompleteAttendanceWithDefaults attendance writes.
 * Freeze before centralization. Runtime Behavior Changes: NONE.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const BRANCH_ID = 10;
const OTHER_BRANCH = 20;
const EMP_ID = 42;
const WORK_DATE = '2026-08-24';

type AttRow = {
  ID: number;
  BranchID: number;
  EmpID: number;
  WorkDate: string;
  CheckInTime: string | null;
  CheckOutTime: string | null;
  Status: string | null;
  Notes: string | null;
  LateMinutes: number;
  EarlyLeaveMinutes: number;
  ScheduledStartTime: string | null;
  ScheduledEndTime: string | null;
};

const harness = vi.hoisted(() => {
  const attendance: AttRow[] = [];
  let nextId = 1;
  const capturedQueries: { sql: string; inputs: Record<string, unknown> }[] = [];
  let missing: Array<{
    empId: number;
    empName: string;
    reason: 'no_attendance' | 'missing_checkin' | 'missing_checkout';
  }> = [];
  let assignedEmpIds = new Set<number>([42]);
  const notifierCalls: unknown[] = [];

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
        capturedQueries.push({ sql: sqlText, inputs: { ...inputs } });
        const sql = sqlText;

        if (/FROM dbo\.TblEmp e/i.test(sql) && /DefaultCheckInTime/i.test(sql)) {
          return {
            recordset: [
              {
                EmpID: EMP_ID,
                EmpName: 'Ali',
                DefaultCheckInTime: '10:00',
                DefaultCheckOutTime: '18:00',
                ScheduleStartTime: '10:00',
                ScheduleEndTime: '18:00',
              },
            ],
            rowsAffected: [1],
          };
        }

        if (
          /FROM dbo\.TblEmpAttendance/i.test(sql) &&
          /BranchID = @branchId/i.test(sql) &&
          /SELECT/i.test(sql) &&
          /CheckInTime/i.test(sql)
        ) {
          const branchId = Number(inputs.branchId);
          const workDate = ymd(inputs.workDate);
          return {
            recordset: attendance
              .filter((r) => r.BranchID === branchId && r.WorkDate === workDate)
              .map((r) => ({
                EmpID: r.EmpID,
                ID: r.ID,
                CheckInTime: r.CheckInTime,
                CheckOutTime: r.CheckOutTime,
                ScheduledStartTime: r.ScheduledStartTime,
                ScheduledEndTime: r.ScheduledEndTime,
                Status: r.Status,
                LateMinutes: r.LateMinutes,
                EarlyLeaveMinutes: r.EarlyLeaveMinutes,
              })),
            rowsAffected: [1],
          };
        }

        if (
          /SELECT EmpID, BranchID/i.test(sql) &&
          /FROM dbo\.TblEmpAttendance/i.test(sql) &&
          !/BranchID = @branchId/i.test(sql)
        ) {
          return {
            recordset: attendance.map((r) => ({
              EmpID: r.EmpID,
              BranchID: r.BranchID,
            })),
            rowsAffected: [1],
          };
        }

        if (/FROM dbo\.TblEmpBranchAssignment/i.test(sql)) {
          return {
            recordset: [...assignedEmpIds].map((id) => ({ EmpID: id })),
            rowsAffected: [1],
          };
        }

        if (/UPDATE dbo\.TblEmpAttendance/i.test(sql) && /NightlyClose/i.test(String(inputs.notes ?? sql))) {
          const id = Number(inputs.id);
          const branchId = Number(inputs.branchId);
          const row = attendance.find((r) => r.ID === id && r.BranchID === branchId);
          if (row) {
            row.CheckInTime = '10:00';
            row.CheckOutTime = '18:00';
            row.Status = String(inputs.status ?? 'Present');
            row.Notes = row.Notes
              ? `${row.Notes} | ${String(inputs.notes)}`
              : String(inputs.notes);
          }
          return { recordset: [], rowsAffected: [row ? 1 : 0] };
        }

        if (/INSERT INTO dbo\.TblEmpAttendance/i.test(sql)) {
          attendance.push({
            ID: nextId++,
            BranchID: Number(inputs.branchId),
            EmpID: Number(inputs.empId),
            WorkDate: ymd(inputs.workDate),
            CheckInTime: '10:00',
            CheckOutTime: '18:00',
            Status: String(inputs.status ?? 'Present'),
            Notes: String(inputs.notes ?? ''),
            LateMinutes: Number(inputs.lateMinutes) || 0,
            EarlyLeaveMinutes: Number(inputs.earlyLeaveMinutes) || 0,
            ScheduledStartTime: '10:00',
            ScheduledEndTime: '18:00',
          });
          return { recordset: [], rowsAffected: [1] };
        }

        return { recordset: [], rowsAffected: [1] };
      },
    };
  }

  class FakeTransaction {
    async begin() {}
    async commit() {}
    async rollback() {}
  }

  class FakeRequest {
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
    capturedQueries,
    notifierCalls,
    FakeTransaction,
    FakeRequest,
    setMissing(m: typeof missing) {
      missing = m;
    },
    setAssigned(ids: number[]) {
      assignedEmpIds = new Set(ids);
    },
    pool: { request: () => makeRequest() },
    reset() {
      attendance.length = 0;
      nextId = 1;
      capturedQueries.length = 0;
      notifierCalls.length = 0;
      missing = [];
      assignedEmpIds = new Set([42]);
    },
    getMissing: () => missing,
  };
});

vi.mock('@/lib/db', () => {
  const sql: Record<string, unknown> = {
    Int: 'Int',
    Date: 'Date',
    Time: 'Time',
    TinyInt: 'TinyInt',
    NVarChar: (n: number) => `NVarChar(${n})`,
    Transaction: harness.FakeTransaction,
    Request: harness.FakeRequest,
  };
  return { getPool: async () => harness.pool, sql };
});

vi.mock('@/lib/payroll/dailyPayrollGenerateCore', () => ({
  validateDailyPayrollAttendance: async () => ({
    missing: harness.getMissing(),
  }),
}));

vi.mock('@/lib/booking/AvailabilityMutationNotifier', () => ({
  AvailabilityMutationNotifier: {
    employeeDayChanged: async (args: unknown) => {
      harness.notifierCalls.push(args);
    },
  },
}));

import { finalizeIncompleteAttendanceWithDefaults } from '@/lib/hr/finalize-incomplete-attendance';

describe('nightly finalizeIncompleteAttendance characterization', () => {
  beforeEach(() => {
    harness.reset();
  });

  it('uses caller workDate exactly (not TblNewDay / open BusinessDay)', async () => {
    harness.setMissing([
      { empId: EMP_ID, empName: 'Ali', reason: 'no_attendance' },
    ]);
    const result = await finalizeIncompleteAttendanceWithDefaults(WORK_DATE, {
      branchId: BRANCH_ID,
    });
    expect(result.workDate).toBe(WORK_DATE);
    expect(harness.capturedQueries.every((q) => !/TblNewDay/i.test(q.sql))).toBe(true);
  });

  it('branch-scopes UPDATE and INSERT to options.branchId', async () => {
    harness.attendance.push({
      ID: 1,
      BranchID: BRANCH_ID,
      EmpID: EMP_ID,
      WorkDate: WORK_DATE,
      CheckInTime: '10:00',
      CheckOutTime: null,
      Status: 'Present',
      Notes: null,
      LateMinutes: 0,
      EarlyLeaveMinutes: 0,
      ScheduledStartTime: '10:00',
      ScheduledEndTime: '18:00',
    });
    harness.setMissing([
      { empId: EMP_ID, empName: 'Ali', reason: 'missing_checkout' },
    ]);
    await finalizeIncompleteAttendanceWithDefaults(WORK_DATE, { branchId: BRANCH_ID });
    const upd = harness.capturedQueries.find((q) => /UPDATE dbo\.TblEmpAttendance/i.test(q.sql));
    expect(upd?.sql).toMatch(/WHERE ID = @id AND BranchID = @branchId/);
    expect(upd?.inputs.branchId).toBe(BRANCH_ID);
  });

  it('skips when attendance exists only on other branch (no invent on this branch)', async () => {
    harness.attendance.push({
      ID: 1,
      BranchID: OTHER_BRANCH,
      EmpID: EMP_ID,
      WorkDate: WORK_DATE,
      CheckInTime: '10:00',
      CheckOutTime: null,
      Status: 'Present',
      Notes: null,
      LateMinutes: 0,
      EarlyLeaveMinutes: 0,
      ScheduledStartTime: null,
      ScheduledEndTime: null,
    });
    harness.setMissing([
      { empId: EMP_ID, empName: 'Ali', reason: 'missing_checkout' },
    ]);
    const result = await finalizeIncompleteAttendanceWithDefaults(WORK_DATE, {
      branchId: BRANCH_ID,
    });
    expect(result.filled).toHaveLength(0);
    expect(harness.attendance.filter((r) => r.BranchID === BRANCH_ID)).toHaveLength(0);
  });

  it('skips Absent / DayOff / Excused without inventing punches', async () => {
    for (const status of ['Absent', 'DayOff', 'Excused'] as const) {
      harness.reset();
      harness.attendance.push({
        ID: 1,
        BranchID: BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: null,
        CheckOutTime: null,
        Status: status,
        Notes: null,
        LateMinutes: 0,
        EarlyLeaveMinutes: 0,
        ScheduledStartTime: null,
        ScheduledEndTime: null,
      });
      harness.setMissing([
        { empId: EMP_ID, empName: 'Ali', reason: 'missing_checkin' },
      ]);
      const result = await finalizeIncompleteAttendanceWithDefaults(WORK_DATE, {
        branchId: BRANCH_ID,
      });
      expect(result.filled).toHaveLength(0);
      expect(harness.attendance[0]?.CheckInTime).toBeNull();
    }
  });

  it('INSERT no_attendance only when assigned to branch and no row anywhere', async () => {
    harness.setMissing([
      { empId: EMP_ID, empName: 'Ali', reason: 'no_attendance' },
    ]);
    const result = await finalizeIncompleteAttendanceWithDefaults(WORK_DATE, {
      branchId: BRANCH_ID,
    });
    expect(result.filled).toHaveLength(1);
    expect(harness.attendance[0]).toMatchObject({
      BranchID: BRANCH_ID,
      EmpID: EMP_ID,
      WorkDate: WORK_DATE,
      CheckInTime: '10:00',
      CheckOutTime: '18:00',
    });
    expect(String(harness.attendance[0]?.Notes)).toContain('[NightlyClose] D');
  });

  it('does not INSERT no_attendance when not assigned to branch', async () => {
    harness.setAssigned([]);
    harness.setMissing([
      { empId: EMP_ID, empName: 'Ali', reason: 'no_attendance' },
    ]);
    const result = await finalizeIncompleteAttendanceWithDefaults(WORK_DATE, {
      branchId: BRANCH_ID,
    });
    expect(result.filled).toHaveLength(0);
    expect(harness.attendance).toHaveLength(0);
  });

  it('UPDATE appends NightlyClose note and fills missing checkout', async () => {
    harness.attendance.push({
      ID: 7,
      BranchID: BRANCH_ID,
      EmpID: EMP_ID,
      WorkDate: WORK_DATE,
      CheckInTime: '10:00',
      CheckOutTime: null,
      Status: 'Present',
      Notes: 'prior',
      LateMinutes: 0,
      EarlyLeaveMinutes: 0,
      ScheduledStartTime: '10:00',
      ScheduledEndTime: '18:00',
    });
    harness.setMissing([
      { empId: EMP_ID, empName: 'Ali', reason: 'missing_checkout' },
    ]);
    const result = await finalizeIncompleteAttendanceWithDefaults(WORK_DATE, {
      branchId: BRANCH_ID,
    });
    expect(result.filled).toHaveLength(1);
    expect(harness.attendance[0]?.CheckOutTime).toBe('18:00');
    expect(harness.attendance[0]?.Notes).toContain('prior');
    expect(harness.attendance[0]?.Notes).toContain('[NightlyClose]');
  });

  it('notifies AvailabilityMutationNotifier best-effort after commit', async () => {
    harness.setMissing([
      { empId: EMP_ID, empName: 'Ali', reason: 'no_attendance' },
    ]);
    await finalizeIncompleteAttendanceWithDefaults(WORK_DATE, { branchId: BRANCH_ID });
    expect(harness.notifierCalls).toEqual([
      expect.objectContaining({
        employeeId: EMP_ID,
        businessDate: WORK_DATE,
        branchId: BRANCH_ID,
        reason: 'finalize_incomplete_attendance',
      }),
    ]);
  });

  it('result statusCode/action remain D / DefaultFill', async () => {
    harness.setMissing([]);
    const result = await finalizeIncompleteAttendanceWithDefaults(WORK_DATE, {
      branchId: BRANCH_ID,
    });
    expect(result.statusCode).toBe('D');
    expect(result.action).toBe('DefaultFill');
    expect(result.status).toBe('DefaultFill');
  });
});
