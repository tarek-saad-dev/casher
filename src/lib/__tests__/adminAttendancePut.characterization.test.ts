/**
 * Characterization tests for CURRENT production PUT /api/admin/attendance.
 *
 * Freeze observable legacy behavior so Phase B can replace internals with
 * AttendanceCommandService without accidental contract changes.
 *
 * Runtime Behavior Changes: NONE — tests only. Do not "fix" OPEN / WorkDate.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  PAYROLL_DAY_CLOSED_CODE,
  PAYROLL_DAY_CLOSED_MESSAGE,
} from '@/lib/hr/empBranchWorkDayClose.transitions';
import { EmpBranchWorkDayCloseError } from '@/lib/hr/empBranchWorkDayClose.types';

vi.mock('server-only', () => ({}));

const ALREADY_OPEN_MESSAGE =
  'الموظف لديه حضور مفتوح في فرع آخر — سجّل الانصراف أولاً';

const SESSION_BRANCH_ID = 10;
const OTHER_BRANCH_ID = 20;
const EMP_ID = 42;
const WORK_DATE = '2026-08-24';
const OLD_WORK_DATE = '2026-08-01';
const OLDER_WORK_DATE = '2026-07-15';

type AttRow = {
  ID: number;
  BranchID: number;
  EmpID: number;
  WorkDate: string;
  CheckInTime: string | null;
  CheckOutTime: string | null;
  Status: string;
  LateMinutes: number;
  EarlyLeaveMinutes: number;
};

const harness = vi.hoisted(() => {
  type Row = {
    ID: number;
    BranchID: number;
    EmpID: number;
    WorkDate: string;
    CheckInTime: string | null;
    CheckOutTime: string | null;
    Status: string;
    LateMinutes: number;
    EarlyLeaveMinutes: number;
  };

  const branchState = { branchId: 10 };
  const attendance: Row[] = [];
  let nextId = 1;
  const capturedQueries: { sql: string; inputs: Record<string, unknown> }[] = [];

  const empRecord = {
    EmpName: 'Test Emp',
    EmploymentType: 'full_time' as string,
    DefaultCheckInTime: '10:00',
    DefaultCheckOutTime: '18:00',
    ScheduleDayOfWeek: 1 as number | null,
    IsWorkingDay: true as boolean,
    ScheduleStartTime: '10:00' as string | null,
    ScheduleEndTime: '18:00' as string | null,
  };

  function pad2(n: number) {
    return String(n).padStart(2, '0');
  }

  function hhmm(v: unknown): string | null {
    if (v == null) return null;
    if (v instanceof Date) {
      return `${pad2(v.getUTCHours())}:${pad2(v.getUTCMinutes())}`;
    }
    const s = String(v);
    return s.length >= 5 ? s.slice(0, 5) : s;
  }

  function ymd(v: unknown): string {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).slice(0, 10);
  }

  function makeRequest() {
    const inputs: Record<string, unknown> = {};
    return {
      input(name: string, _type: unknown, value: unknown) {
        inputs[name] = value;
        return this;
      },
      async query(sqlText: string) {
        capturedQueries.push({ sql: sqlText, inputs: { ...inputs } });
        const sql = sqlText;

        if (/INFORMATION_SCHEMA\.TABLES/i.test(sql)) {
          return { recordset: [], rowsAffected: [1] };
        }

        if (/sp_getapplock/i.test(sql)) {
          return { recordset: [{ lockResult: 0 }], rowsAffected: [1] };
        }

        // Active-session inventory: all OPEN for EmpID (any branch / WorkDate)
        if (
          /CheckOutTime IS NULL/i.test(sql) &&
          /EmpID = @empId/i.test(sql) &&
          /FROM dbo\.TblEmpAttendance/i.test(sql) &&
          !/BranchID\s*<>/i.test(sql) &&
          !/WorkDate = @workDate/i.test(sql)
        ) {
          const empId = Number(inputs.empId);
          const rows = attendance.filter(
            (r) =>
              r.EmpID === empId &&
              r.CheckInTime != null &&
              r.CheckOutTime == null,
          );
          return {
            recordset: rows.map((row) => ({
              ID: row.ID,
              EmpID: row.EmpID,
              BranchID: row.BranchID,
              WorkDate: row.WorkDate,
              CheckInTime: row.CheckInTime,
            })),
          };
        }

        if (/CheckOutTime IS NULL/i.test(sql) && /BranchID\s*<>/i.test(sql)) {
          const empId = Number(inputs.empId);
          const branchId = Number(inputs.branchId);
          const row = attendance.find(
            (r) =>
              r.EmpID === empId &&
              r.CheckInTime != null &&
              r.CheckOutTime == null &&
              r.BranchID !== branchId,
          );
          return {
            recordset: row
              ? [{ ID: row.ID, BranchID: row.BranchID, WorkDate: row.WorkDate }]
              : [],
          };
        }

        if (/FROM dbo\.TblEmp\b/i.test(sql) && /OUTER APPLY/i.test(sql)) {
          return { recordset: [{ ...empRecord }] };
        }

        if (
          /FROM dbo\.TblEmpAttendance/i.test(sql) &&
          /WorkDate = @workDate/i.test(sql) &&
          /BranchID = @branchId/i.test(sql) &&
          /SELECT/i.test(sql) &&
          !/INSERT/i.test(sql) &&
          !/UPDATE/i.test(sql)
        ) {
          const empId = Number(inputs.empId);
          const branchId = Number(inputs.branchId);
          const workDate = ymd(inputs.workDate);
          const row = attendance.find(
            (r) =>
              r.EmpID === empId &&
              r.BranchID === branchId &&
              r.WorkDate === workDate,
          );
          if (!row) return { recordset: [] };
          return {
            recordset: [
              {
                ID: row.ID,
                CheckInTime: row.CheckInTime,
                CheckOutTime: row.CheckOutTime,
              },
            ],
          };
        }

        if (/UPDATE dbo\.TblEmpAttendance/i.test(sql)) {
          const id = Number(inputs.id);
          const branchId = Number(inputs.branchId);
          const row = attendance.find((r) => r.ID === id && r.BranchID === branchId);
          if (row) {
            row.CheckInTime = hhmm(inputs.checkInTime);
            row.CheckOutTime = hhmm(inputs.checkOutTime);
            row.Status = String(inputs.status);
            row.LateMinutes = Number(inputs.lateMinutes);
            row.EarlyLeaveMinutes = Number(inputs.earlyLeaveMinutes);
          }
          return { recordset: [], rowsAffected: [row ? 1 : 0] };
        }

        if (/INSERT INTO dbo\.TblEmpAttendance/i.test(sql)) {
          const BranchID = Number(inputs.branchId);
          const EmpID = Number(inputs.empId);
          const WorkDate = ymd(inputs.workDate);
          const dup = attendance.some(
            (r) =>
              r.BranchID === BranchID && r.EmpID === EmpID && r.WorkDate === WorkDate,
          );
          if (dup) {
            const err = new Error(
              'Violation of UNIQUE KEY constraint on (BranchID, EmpID, WorkDate)',
            ) as Error & { number: number };
            err.number = 2627;
            throw err;
          }
          const row: Row = {
            ID: nextId++,
            BranchID,
            EmpID,
            WorkDate,
            CheckInTime: hhmm(inputs.checkInTime),
            CheckOutTime: hhmm(inputs.checkOutTime),
            Status: String(inputs.status),
            LateMinutes: Number(inputs.lateMinutes ?? 0),
            EarlyLeaveMinutes: Number(inputs.earlyLeaveMinutes ?? 0),
          };
          attendance.push(row);
          return { recordset: [{ ID: row.ID }], rowsAffected: [1] };
        }

        return { recordset: [], rowsAffected: [1] };
      },
    };
  }

  return {
    branchState,
    attendance,
    capturedQueries,
    empRecord,
    getOpenBusinessDay: vi.fn(async () => ({
      id: 1,
      newDay: '1999-01-01',
      status: 1,
    })),
    resolveAttendanceWorkDate: vi.fn(async () => ({
      workDate: '1999-01-01',
      businessDayId: 1,
    })),
    assertEmployeeEligibleForBranchAttendance: vi.fn(async () => undefined),
    assertEmpBranchWorkDayMutable: vi.fn(async () => undefined),
    unlockScheduleForWorkOnDayOff: vi.fn(async () => ({})),
    replaceAttendanceBreaks: vi.fn(async () => 0),
    replaceAttendanceBreakTimes: vi.fn(async () => 0),
    syncBlockRangesFromBreaks: vi.fn(async () => ({ deactivated: 0, inserted: 0 })),
    syncBlockRangesFromBreakTimes: vi.fn(async () => ({
      deactivated: 0,
      inserted: 0,
    })),
    syncAttendanceShiftToOverrides: vi.fn(async () => ({
      deactivated: 0,
      inserted: 0,
      plan: { action: 'clear' as const },
    })),
    syncAttendanceAbsenceToDayOffOverride: vi.fn(async () => ({
      cleared: 0,
      ensured: false,
    })),
    scheduleAttendanceCheckInOutWhatsApp: vi.fn(),
    syncNonPostedPayrollHoursFromAttendance: vi.fn(async () => ({
      updated: false,
      payrollId: null,
      actualHours: null,
      dailyWage: null,
    })),
    availabilityEmployeeDayChanged: vi.fn(async () => undefined),
    requireBranchOperationAccess: vi.fn(async () => ({
      ok: true,
      branchId: branchState.branchId,
      branchCode: 'GLEEM',
      branchName: 'Gleem',
    })),
    getSession: vi.fn(async () => ({
      UserID: 1,
      UserName: 'Admin',
      UserLevel: 1,
    })),
    reset() {
      attendance.length = 0;
      capturedQueries.length = 0;
      nextId = 1;
      branchState.branchId = 10;
      empRecord.EmpName = 'Test Emp';
      empRecord.EmploymentType = 'full_time';
      empRecord.DefaultCheckInTime = '10:00';
      empRecord.DefaultCheckOutTime = '18:00';
      empRecord.ScheduleDayOfWeek = 1;
      empRecord.IsWorkingDay = true;
      empRecord.ScheduleStartTime = '10:00';
      empRecord.ScheduleEndTime = '18:00';
    },
    seed(row: Omit<Row, 'ID'> & { ID?: number }): Row {
      const full: Row = { ID: row.ID ?? nextId++, ...row };
      if (row.ID != null && row.ID >= nextId) nextId = row.ID + 1;
      attendance.push(full);
      return full;
    },
    makeFakeDb() {
      return { request: () => makeRequest() };
    },
  };
});

vi.mock('@/lib/branch', () => ({
  isActiveBranchContext: vi.fn((b: unknown) => !!b && typeof b === 'object'),
  requireBranchOperationAccess: (...args: unknown[]) =>
    harness.requireBranchOperationAccess(...args),
  getOpenBusinessDay: (...args: unknown[]) => harness.getOpenBusinessDay(...args),
}));

vi.mock('@/lib/hr/attendance/branchAttendance.service', () => ({
  assertEmployeeEligibleForBranchAttendance: (...args: unknown[]) =>
    harness.assertEmployeeEligibleForBranchAttendance(...args),
  resolveAttendanceWorkDate: (...args: unknown[]) =>
    harness.resolveAttendanceWorkDate(...args),
}));

vi.mock('@/lib/hr/empBranchWorkDayClose.service', () => ({
  assertEmpBranchWorkDayMutable: (...args: unknown[]) =>
    harness.assertEmpBranchWorkDayMutable(...args),
}));

vi.mock('@/lib/hr/attendance/workOnDayOff.service', () => ({
  unlockScheduleForWorkOnDayOff: (...args: unknown[]) =>
    harness.unlockScheduleForWorkOnDayOff(...args),
}));

vi.mock('@/lib/session', () => ({
  getSession: (...args: unknown[]) => harness.getSession(...args),
}));

vi.mock('@/lib/db', () => {
  class MockRequest {
    private inputs: Record<string, unknown> = {};
    constructor(_tx?: unknown) {}
    input(name: string, _type: unknown, value: unknown) {
      this.inputs[name] = value;
      return this;
    }
    async query(sqlText: string) {
      const req = harness.makeFakeDb().request();
      for (const [k, v] of Object.entries(this.inputs)) {
        req.input(k, null, v);
      }
      return req.query(sqlText);
    }
  }
  class MockTransaction {
    async begin() {}
    async commit() {}
    async rollback() {}
  }
  return {
    getPool: vi.fn(async () => harness.makeFakeDb()),
    sql: {
      Int: 'Int',
      Date: 'Date',
      Time: 'Time',
      NVarChar: (n: number) => `NVarChar(${n})`,
      TinyInt: 'TinyInt',
      Request: MockRequest,
      Transaction: MockTransaction,
    },
  };
});

vi.mock('@/lib/hr/attendance-breaks-db', () => ({
  ensureAttendanceBreakSchema: vi.fn(async () => undefined),
  replaceAttendanceBreaks: (...args: unknown[]) =>
    harness.replaceAttendanceBreaks(...args),
  loadBreaksByAttendanceIds: vi.fn(async () => new Map()),
}));

vi.mock('@/lib/hr/attendance-break-time-db', () => ({
  ensureAttendanceBreakTimeSchema: vi.fn(async () => undefined),
  replaceAttendanceBreakTimes: (...args: unknown[]) =>
    harness.replaceAttendanceBreakTimes(...args),
  loadBreakTimesByAttendanceIds: vi.fn(async () => new Map()),
}));

vi.mock('@/lib/hr/attendance-break-schedule-sync', () => ({
  syncBlockRangesFromBreaks: (...args: unknown[]) =>
    harness.syncBlockRangesFromBreaks(...args),
  syncBlockRangesFromBreakTimes: (...args: unknown[]) =>
    harness.syncBlockRangesFromBreakTimes(...args),
  syncBreakFromBlockRange: vi.fn(),
  removeBreakMatchingBlockRange: vi.fn(),
  removeBreakTimeMatchingBlockRange: vi.fn(),
  isSyncedBlockRangeCreatedBy: vi.fn(),
}));

vi.mock('@/lib/hr/attendance-shift-schedule-sync', () => ({
  syncAttendanceShiftToOverrides: (...args: unknown[]) =>
    harness.syncAttendanceShiftToOverrides(...args),
  syncAttendanceAbsenceToDayOffOverride: (...args: unknown[]) =>
    harness.syncAttendanceAbsenceToDayOffOverride(...args),
  ATTENDANCE_SHIFT_SOURCE: 'attendance-shift',
}));

vi.mock('@/lib/services/employeeAttendanceWhatsAppNotify', () => ({
  scheduleAttendanceCheckInOutWhatsApp: (...args: unknown[]) =>
    harness.scheduleAttendanceCheckInOutWhatsApp(...args),
}));

vi.mock('@/lib/payroll/syncPayrollHoursFromAttendance', () => ({
  syncNonPostedPayrollHoursFromAttendance: (...args: unknown[]) =>
    harness.syncNonPostedPayrollHoursFromAttendance(...args),
}));

vi.mock('@/lib/booking/AvailabilityMutationNotifier', () => ({
  AvailabilityMutationNotifier: {
    employeeDayChanged: (...args: unknown[]) =>
      harness.availabilityEmployeeDayChanged(...args),
    runWithPostCommit: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  },
}));

vi.mock('@/lib/hr/employee-hr-model', () => ({
  normalizeEmploymentType: vi.fn(() => 'full_time'),
}));

function jsonReq(body: unknown) {
  return new NextRequest('http://localhost/api/admin/attendance', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function putAttendance(body: unknown) {
  const { PUT } = await import('@/app/api/admin/attendance/route');
  const res = await PUT(jsonReq(body));
  const json = await res.json();
  return { status: res.status, json };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.reset();
});

describe('PUT /api/admin/attendance — characterization (current production)', () => {
  describe('Open attendance — other branch, same WorkDate (PRESERVE DURING PHASE B)', () => {
    it('rejects with HTTP 409 and current { error, code } Arabic ALREADY_OPEN contract', async () => {
      harness.seed({
        BranchID: OTHER_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '09:00',
        CheckOutTime: null,
        Status: 'Present',
        LateMinutes: 0,
        EarlyLeaveMinutes: 0,
      });

      const { status, json } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
      });

      expect(status).toBe(409);
      expect(json).toEqual({
        error: ALREADY_OPEN_MESSAGE,
        code: 'ALREADY_OPEN',
      });
      expect(harness.attendance.filter((r) => r.BranchID === SESSION_BRANCH_ID)).toHaveLength(
        0,
      );
    });
  });

  describe('Open attendance — other branch, OLD WorkDate (POLICY CUTOVER)', () => {
    it('stale OPEN on old WorkDate does NOT block today check-in; stale row unchanged', async () => {
      harness.seed({
        BranchID: OTHER_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: OLD_WORK_DATE,
        CheckInTime: '09:00',
        CheckOutTime: null,
        Status: 'Present',
        LateMinutes: 0,
        EarlyLeaveMinutes: 0,
      });

      const { status, json } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
      });

      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(harness.attendance).toHaveLength(2);
      const stale = harness.attendance.find((r) => r.WorkDate === OLD_WORK_DATE);
      expect(stale?.CheckOutTime).toBeNull();
      expect(stale?.BranchID).toBe(OTHER_BRANCH_ID);
      const today = harness.attendance.find((r) => r.WorkDate === WORK_DATE);
      expect(today?.BranchID).toBe(SESSION_BRANCH_ID);
      expect(today?.CheckInTime).toBe('10:00');
      expect(today?.CheckOutTime).toBeNull();
    });
  });

  describe('Closed attendance in another branch (PRESERVE DURING PHASE B)', () => {
    it('does not block current-branch check-in when the other-branch row has CheckOutTime', async () => {
      harness.seed({
        BranchID: OTHER_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '09:00',
        CheckOutTime: '17:00',
        Status: 'Present',
        LateMinutes: 0,
        EarlyLeaveMinutes: 0,
      });

      const { status, json } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
      });

      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.WorkDate).toBe(WORK_DATE);
      const current = harness.attendance.filter((r) => r.BranchID === SESSION_BRANCH_ID);
      expect(current).toHaveLength(1);
      expect(current[0].CheckInTime).toBe('10:00');
      expect(current[0].CheckOutTime).toBeNull();
    });
  });

  describe('Historical OPEN in the SAME branch (INTENTIONALLY CHANGE IN PHASE H)', () => {
    it('legacy: does not 409; check-in on a new WorkDate inserts a second OPEN row', async () => {
      const historical = harness.seed({
        BranchID: SESSION_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: OLD_WORK_DATE,
        CheckInTime: '09:00',
        CheckOutTime: null,
        Status: 'Present',
        LateMinutes: 0,
        EarlyLeaveMinutes: 0,
      });

      const { status, json } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
      });

      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.code).toBeUndefined();
      expect(harness.attendance).toHaveLength(2);

      const stillOpenHistorical = harness.attendance.find((r) => r.ID === historical.ID);
      expect(stillOpenHistorical?.CheckOutTime).toBeNull();
      expect(stillOpenHistorical?.WorkDate).toBe(OLD_WORK_DATE);

      const today = harness.attendance.find((r) => r.WorkDate === WORK_DATE);
      expect(today?.CheckInTime).toBe('10:00');
      expect(today?.CheckOutTime).toBeNull();
      expect(today?.BranchID).toBe(SESSION_BRANCH_ID);
    });
  });

  describe('Multiple OPEN historical rows (POLICY CUTOVER)', () => {
    it('other-branch stale OPEN rows do not block; today insert succeeds; stale unchanged', async () => {
      harness.seed({
        BranchID: OTHER_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: OLD_WORK_DATE,
        CheckInTime: '08:00',
        CheckOutTime: null,
        Status: 'Present',
        LateMinutes: 0,
        EarlyLeaveMinutes: 0,
      });
      harness.seed({
        BranchID: OTHER_BRANCH_ID + 1,
        EmpID: EMP_ID,
        WorkDate: OLDER_WORK_DATE,
        CheckInTime: '11:00',
        CheckOutTime: null,
        Status: 'Present',
        LateMinutes: 0,
        EarlyLeaveMinutes: 0,
      });

      const { status, json } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
      });

      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(harness.attendance).toHaveLength(3);
      expect(
        harness.attendance.filter((r) => r.WorkDate !== WORK_DATE && r.CheckOutTime == null),
      ).toHaveLength(2);
    });

    it('same-branch: multiple historical OPEN rows still do not block a new WorkDate insert', async () => {
      harness.seed({
        BranchID: SESSION_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: OLD_WORK_DATE,
        CheckInTime: '08:00',
        CheckOutTime: null,
        Status: 'Present',
        LateMinutes: 0,
        EarlyLeaveMinutes: 0,
      });
      harness.seed({
        BranchID: SESSION_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: OLDER_WORK_DATE,
        CheckInTime: '11:00',
        CheckOutTime: null,
        Status: 'Present',
        LateMinutes: 0,
        EarlyLeaveMinutes: 0,
      });

      const { status } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
      });

      expect(status).toBe(200);
      const openRows = harness.attendance.filter(
        (r) => r.CheckInTime && r.CheckOutTime == null,
      );
      expect(openRows).toHaveLength(3);
    });
  });

  describe('Branch ownership (PRESERVE DURING PHASE B)', () => {
    it('write BranchID comes from the authenticated/session branch, not the client', async () => {
      harness.branchState.branchId = SESSION_BRANCH_ID;

      const { status, json } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
      });

      expect(status).toBe(200);
      expect(json.data.EmpID).toBe(EMP_ID);
      expect(harness.attendance).toHaveLength(1);
      expect(harness.attendance[0].BranchID).toBe(SESSION_BRANCH_ID);
      expect(harness.assertEmployeeEligibleForBranchAttendance).toHaveBeenCalledWith(
        EMP_ID,
        SESSION_BRANCH_ID,
        WORK_DATE,
      );
    });

    it('body BranchID is rejected and cannot switch attendance ownership', async () => {
      const { status, json } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
        BranchID: OTHER_BRANCH_ID,
      });

      expect(status).toBe(400);
      expect(json).toEqual({ error: 'BranchID في الطلب غير مسموح' });
      expect(harness.attendance).toHaveLength(0);
      expect(harness.assertEmpBranchWorkDayMutable).not.toHaveBeenCalled();
    });

    it('body branchId (camelCase) is also rejected with the same contract', async () => {
      const { status, json } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
        branchId: OTHER_BRANCH_ID,
      });

      expect(status).toBe(400);
      expect(json).toEqual({ error: 'BranchID في الطلب غير مسموح' });
      expect(harness.attendance).toHaveLength(0);
    });
  });

  describe('WorkDate from request body (PRESERVE DURING PHASE B)', () => {
    it('uses request WorkDate and does not call getOpenBusinessDay or resolveAttendanceWorkDate', async () => {
      const { status, json } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
      });

      expect(status).toBe(200);
      expect(json.data.WorkDate).toBe(WORK_DATE);
      expect(harness.attendance[0].WorkDate).toBe(WORK_DATE);
      expect(harness.attendance[0].WorkDate).not.toBe('1999-01-01');
      expect(harness.getOpenBusinessDay).not.toHaveBeenCalled();
      expect(harness.resolveAttendanceWorkDate).not.toHaveBeenCalled();
    });
  });

  describe('Check-in / check-out persistence (PRESERVE DURING PHASE B)', () => {
    it('new check-in creates the (session BranchID, EmpID, WorkDate) row', async () => {
      const { status, json } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
      });

      expect(status).toBe(200);
      expect(json.message).toBe('تم حفظ الحضور بنجاح');
      expect(harness.attendance).toHaveLength(1);
      expect(harness.attendance[0]).toMatchObject({
        BranchID: SESSION_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
        CheckOutTime: null,
      });
    });

    it('check-out closes the expected (BranchID, EmpID, WorkDate) row', async () => {
      const existing = harness.seed({
        BranchID: SESSION_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
        CheckOutTime: null,
        Status: 'Present',
        LateMinutes: 0,
        EarlyLeaveMinutes: 0,
      });

      const { status } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
        CheckOutTime: '18:00',
      });

      expect(status).toBe(200);
      expect(harness.attendance).toHaveLength(1);
      expect(harness.attendance[0].ID).toBe(existing.ID);
      expect(harness.attendance[0].CheckInTime).toBe('10:00');
      expect(harness.attendance[0].CheckOutTime).toBe('18:00');
    });

    it('unique (BranchID, EmpID, WorkDate): re-save updates the same row instead of inserting', async () => {
      const first = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
      });
      expect(first.status).toBe(200);
      const id = harness.attendance[0].ID;

      const second = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:05',
      });

      expect(second.status).toBe(200);
      expect(harness.attendance).toHaveLength(1);
      expect(harness.attendance[0].ID).toBe(id);
      expect(harness.attendance[0].CheckInTime).toBe('10:05');
    });

    it('re-saving the same employee/day does not create an extra branch-day row', async () => {
      await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
        CheckOutTime: '18:00',
      });
      await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
        CheckOutTime: '18:30',
      });

      expect(harness.attendance).toHaveLength(1);
      expect(harness.attendance[0]).toMatchObject({
        BranchID: SESSION_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckOutTime: '18:30',
      });
    });
  });

  describe('Status behavior — client Status is recomputed except Absent/DayOff/Excused (PRESERVE DURING PHASE B)', () => {
    it('on-time check-in becomes Present; client Late is overridden', async () => {
      const { status, json } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
        Status: 'Late',
      });

      expect(status).toBe(200);
      expect(json.data.Status).toBe('Present');
      expect(json.data.LateMinutes).toBe(0);
      expect(harness.attendance[0].Status).toBe('Present');
    });

    it('late check-in becomes Late; client Present is overridden', async () => {
      const { status, json } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:20',
        Status: 'Present',
      });

      expect(status).toBe(200);
      expect(json.data.Status).toBe('Late');
      expect(json.data.LateMinutes).toBe(20);
      expect(harness.attendance[0].Status).toBe('Late');
    });

    it('on-time check-in + early check-out becomes EarlyLeave when status would otherwise be Present', async () => {
      const { status, json } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
        CheckOutTime: '17:00',
        Status: 'Present',
      });

      expect(status).toBe(200);
      expect(json.data.Status).toBe('EarlyLeave');
      expect(json.data.LateMinutes).toBe(0);
      expect(json.data.EarlyLeaveMinutes).toBe(60);
      expect(harness.attendance[0].Status).toBe('EarlyLeave');
    });

    it('late check-in + early check-out stays Late (EarlyLeave only applied when status is Present)', async () => {
      const { status, json } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:20',
        CheckOutTime: '17:00',
        Status: 'EarlyLeave',
      });

      expect(status).toBe(200);
      expect(json.data.Status).toBe('Late');
      expect(json.data.LateMinutes).toBe(20);
      expect(json.data.EarlyLeaveMinutes).toBe(60);
      expect(harness.attendance[0].Status).toBe('Late');
    });

    it('client Absent is trusted and not recomputed from punches', async () => {
      const { status, json } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:20',
        Status: 'Absent',
      });

      expect(status).toBe(200);
      expect(json.data.Status).toBe('Absent');
      expect(json.data.LateMinutes).toBe(20);
      expect(harness.attendance[0].Status).toBe('Absent');
    });

    it('client DayOff is trusted', async () => {
      const { status, json } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        Status: 'DayOff',
      });

      expect(status).toBe(200);
      expect(json.data.Status).toBe('DayOff');
      expect(harness.attendance[0].Status).toBe('DayOff');
    });

    it('client Excused is trusted', async () => {
      const { status, json } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        Status: 'Excused',
      });

      expect(status).toBe(200);
      expect(json.data.Status).toBe('Excused');
    });
  });

  describe('Existing side effects (PRESERVE DURING PHASE B)', () => {
    it('always syncs shift overrides, absence/day_off, and schedules WhatsApp on success', async () => {
      const { status } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
      });

      expect(status).toBe(200);
      expect(harness.syncAttendanceShiftToOverrides).toHaveBeenCalledTimes(1);
      expect(harness.syncAttendanceShiftToOverrides).toHaveBeenCalledWith(
        expect.anything(),
        EMP_ID,
        WORK_DATE,
        expect.objectContaining({
          checkInTime: '10:00',
          checkOutTime: null,
          status: 'Present',
        }),
      );
      expect(harness.syncAttendanceAbsenceToDayOffOverride).toHaveBeenCalledWith(
        expect.anything(),
        EMP_ID,
        WORK_DATE,
        'Present',
      );
      expect(harness.scheduleAttendanceCheckInOutWhatsApp).toHaveBeenCalledWith(
        expect.objectContaining({
          empId: EMP_ID,
          checkInTime: '10:00',
          checkOutTime: null,
        }),
      );
    });

    it('syncs breaks and block_ranges when Breaks / BreakTimes are provided', async () => {
      const { status } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
        Breaks: [{ LeaveAt: '14:00', ReturnAt: '15:00' }],
        BreakTimes: [{ LeaveAt: '16:00', ReturnAt: '16:15' }],
      });

      expect(status).toBe(200);
      expect(harness.replaceAttendanceBreaks).toHaveBeenCalled();
      expect(harness.replaceAttendanceBreakTimes).toHaveBeenCalled();
      expect(harness.syncBlockRangesFromBreaks).toHaveBeenCalledWith(
        expect.anything(),
        EMP_ID,
        WORK_DATE,
        [
          expect.objectContaining({
            LeaveAt: '14:00',
            ReturnAt: '15:00',
            Minutes: 60,
          }),
        ],
      );
      expect(harness.syncBlockRangesFromBreakTimes).toHaveBeenCalledWith(
        expect.anything(),
        EMP_ID,
        WORK_DATE,
        [
          expect.objectContaining({
            LeaveAt: '16:00',
            ReturnAt: '16:15',
            Minutes: 15,
          }),
        ],
      );
    });

    it('calls syncNonPostedPayrollHoursFromAttendance only after completed (in+out) attendance', async () => {
      const openOnly = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
      });
      expect(openOnly.status).toBe(200);
      expect(harness.syncNonPostedPayrollHoursFromAttendance).not.toHaveBeenCalled();

      const closed = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
        CheckOutTime: '18:00',
      });
      expect(closed.status).toBe(200);
      expect(harness.syncNonPostedPayrollHoursFromAttendance).toHaveBeenCalledTimes(1);
      expect(harness.syncNonPostedPayrollHoursFromAttendance).toHaveBeenCalledWith({
        empId: EMP_ID,
        workDate: WORK_DATE,
        branchId: SESSION_BRANCH_ID,
      });
    });

    it('does not call AvailabilityMutationNotifier (live PUT currently has no cache invalidation)', async () => {
      const { status } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
        CheckOutTime: '18:00',
      });

      expect(status).toBe(200);
      expect(harness.availabilityEmployeeDayChanged).not.toHaveBeenCalled();
    });

    it('unlocks day-off schedule when checking in on a non-working scheduled day', async () => {
      harness.empRecord.IsWorkingDay = false;

      const { status } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
      });

      expect(status).toBe(200);
      expect(harness.unlockScheduleForWorkOnDayOff).toHaveBeenCalledWith({
        empId: EMP_ID,
        date: WORK_DATE,
        branchId: SESSION_BRANCH_ID,
        reason: 'نزل يشتغل يوم إجازته — تسجيل حضور',
        sourceTag: 'work-on-day-off',
      });
    });
  });

  describe('Payroll-day mutation gate (PRESERVE DURING PHASE B)', () => {
    it('closed employee branch payroll day blocks via assertEmpBranchWorkDayMutable contract', async () => {
      harness.assertEmpBranchWorkDayMutable.mockRejectedValueOnce(
        new EmpBranchWorkDayCloseError(PAYROLL_DAY_CLOSED_CODE, PAYROLL_DAY_CLOSED_MESSAGE),
      );

      const { status, json } = await putAttendance({
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
      });

      expect(harness.assertEmpBranchWorkDayMutable).toHaveBeenCalledWith(
        SESSION_BRANCH_ID,
        WORK_DATE,
      );
      expect(status).toBe(409);
      expect(json).toEqual({
        error: PAYROLL_DAY_CLOSED_MESSAGE,
        code: PAYROLL_DAY_CLOSED_CODE,
      });
      expect(harness.attendance).toHaveLength(0);
      expect(harness.syncAttendanceShiftToOverrides).not.toHaveBeenCalled();
    });
  });
});
