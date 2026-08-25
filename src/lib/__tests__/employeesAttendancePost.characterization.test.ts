/**
 * Characterization tests for CURRENT production POST /api/employees/attendance.
 *
 * Freeze observable legacy behavior before Phase B2. Do not "fix" differences
 * vs PUT /api/admin/attendance.
 *
 * Runtime Behavior Changes: NONE — tests only.
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
  Status: string | null;
  Notes: string | null;
  CreatedAt: Date;
  UpdatedAt: Date | null;
};

const harness = vi.hoisted(() => {
  type Row = AttRow;

  const branchState = { branchId: 10 };
  const attendance: Row[] = [];
  const existingEmpIds = new Set<number>([42]);
  let nextId = 1;
  const capturedQueries: { sql: string; inputs: Record<string, unknown> }[] = [];

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

  function toOutput(row: Row) {
    return {
      ID: row.ID,
      BranchID: row.BranchID,
      EmpID: row.EmpID,
      WorkDate: row.WorkDate,
      CheckInTime: row.CheckInTime,
      CheckOutTime: row.CheckOutTime,
      Status: row.Status,
      Notes: row.Notes,
      CreatedAt: row.CreatedAt,
      UpdatedAt: row.UpdatedAt,
    };
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

        if (/SELECT 1 FROM dbo\.TblEmp WHERE EmpID = @empId/i.test(sql)) {
          const empId = Number(inputs.empId);
          return {
            recordset: existingEmpIds.has(empId) ? [{ '': 1 }] : [],
          };
        }

        if (/sp_getapplock/i.test(sql)) {
          return { recordset: [{ lockResult: 0 }], rowsAffected: [1] };
        }

        // Active-session inventory: all OPEN for EmpID (any branch / WorkDate)
        if (
          /CheckOutTime IS NULL/i.test(sql) &&
          /EmpID = @empId/i.test(sql) &&
          /TblEmpAttendance/i.test(sql) &&
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
          return { recordset: row ? [{ ID: row.ID }] : [] };
        }

        if (
          /FROM dbo\.TblEmpAttendance/i.test(sql) &&
          /WorkDate = @workDate/i.test(sql) &&
          /BranchID = @branchId/i.test(sql) &&
          /SELECT/i.test(sql) &&
          !/INSERT/i.test(sql) &&
          !/UPDATE/i.test(sql) &&
          !/MERGE/i.test(sql)
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

        if (/MERGE dbo\.TblEmpAttendance/i.test(sql)) {
          const BranchID = Number(inputs.branchId);
          const EmpID = Number(inputs.empId);
          const WorkDate = ymd(inputs.workDate);
          const incomingIn = hhmm(inputs.checkInTime);
          const incomingOut = hhmm(inputs.checkOutTime);
          const incomingStatus =
            inputs.status == null ? null : String(inputs.status);
          const incomingNotes =
            inputs.notes == null ? null : String(inputs.notes);

          const existing = attendance.find(
            (r) =>
              r.BranchID === BranchID &&
              r.EmpID === EmpID &&
              r.WorkDate === WorkDate,
          );

          if (existing) {
            existing.CheckInTime = incomingIn ?? existing.CheckInTime;
            existing.CheckOutTime = incomingOut ?? existing.CheckOutTime;
            existing.Status = incomingStatus ?? existing.Status;
            existing.Notes = incomingNotes ?? existing.Notes;
            existing.UpdatedAt = new Date();
            return { recordset: [toOutput(existing)] };
          }

          const row: Row = {
            ID: nextId++,
            BranchID,
            EmpID,
            WorkDate,
            CheckInTime: incomingIn,
            CheckOutTime: incomingOut,
            Status: incomingStatus,
            Notes: incomingNotes,
            CreatedAt: new Date(),
            UpdatedAt: null,
          };
          attendance.push(row);
          return { recordset: [toOutput(row)] };
        }

        return { recordset: [], rowsAffected: [1] };
      },
    };
  }

  return {
    branchState,
    attendance,
    existingEmpIds,
    capturedQueries,
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
    })),
    syncAttendanceAbsenceToDayOffOverride: vi.fn(async () => ({
      cleared: 0,
      ensured: false,
    })),
    scheduleAttendanceCheckInOutWhatsApp: vi.fn(),
    syncNonPostedPayrollHoursFromAttendance: vi.fn(async () => ({
      updated: false,
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
      existingEmpIds.clear();
      existingEmpIds.add(42);
    },
    seed(row: Omit<Row, 'ID' | 'CreatedAt' | 'UpdatedAt'> & { ID?: number }): Row {
      const full: Row = {
        ID: row.ID ?? nextId++,
        CreatedAt: new Date(),
        UpdatedAt: null,
        ...row,
      };
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
  AttendanceDomainError: class AttendanceDomainError extends Error {
    code: string;
    statusCode: number;
    constructor(code: string, message: string, statusCode = 400) {
      super(message);
      this.code = code;
      this.statusCode = statusCode;
    }
  },
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
  replaceAttendanceBreaks: (...args: unknown[]) =>
    harness.replaceAttendanceBreaks(...args),
}));

vi.mock('@/lib/hr/attendance-break-time-db', () => ({
  replaceAttendanceBreakTimes: (...args: unknown[]) =>
    harness.replaceAttendanceBreakTimes(...args),
}));

vi.mock('@/lib/hr/attendance-break-schedule-sync', () => ({
  syncBlockRangesFromBreaks: (...args: unknown[]) =>
    harness.syncBlockRangesFromBreaks(...args),
  syncBlockRangesFromBreakTimes: (...args: unknown[]) =>
    harness.syncBlockRangesFromBreakTimes(...args),
}));

vi.mock('@/lib/hr/attendance-shift-schedule-sync', () => ({
  syncAttendanceShiftToOverrides: (...args: unknown[]) =>
    harness.syncAttendanceShiftToOverrides(...args),
  syncAttendanceAbsenceToDayOffOverride: (...args: unknown[]) =>
    harness.syncAttendanceAbsenceToDayOffOverride(...args),
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
  },
}));

function jsonReq(body: unknown) {
  return new NextRequest('http://localhost/api/employees/attendance', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postAttendance(body: unknown) {
  const { POST } = await import('@/app/api/employees/attendance/route');
  const res = await POST(jsonReq(body));
  const json = await res.json();
  return { status: res.status, json };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.reset();
});

describe('POST /api/employees/attendance — characterization (current production)', () => {
  describe('Open attendance — other branch, same WorkDate', () => {
    it('rejects with HTTP 409 { error, code: ALREADY_OPEN }', async () => {
      harness.seed({
        BranchID: OTHER_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '09:00',
        CheckOutTime: null,
        Status: 'present',
        Notes: null,
      });

      const { status, json } = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        checkInTime: '10:00',
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
    it('stale OPEN on old WorkDate does NOT block today check-in; stale unchanged', async () => {
      harness.seed({
        BranchID: OTHER_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: OLD_WORK_DATE,
        CheckInTime: '09:00',
        CheckOutTime: null,
        Status: 'present',
        Notes: null,
      });

      const { status, json } = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        checkInTime: '10:00',
      });

      expect(status).toBe(201);
      expect(json.BranchID).toBe(SESSION_BRANCH_ID);
      expect(harness.attendance).toHaveLength(2);
      const stale = harness.attendance.find((r) => r.WorkDate === OLD_WORK_DATE);
      expect(stale?.CheckOutTime).toBeNull();
      expect(stale?.BranchID).toBe(OTHER_BRANCH_ID);
      const today = harness.attendance.find((r) => r.WorkDate === WORK_DATE);
      expect(today?.CheckInTime).toBe('10:00');
      expect(today?.CheckOutTime).toBeNull();
    });
  });

  describe('Closed attendance in another branch', () => {
    it('does not block current-branch check-in when other-branch row has CheckOutTime', async () => {
      harness.seed({
        BranchID: OTHER_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '09:00',
        CheckOutTime: '17:00',
        Status: 'present',
        Notes: null,
      });

      const { status, json } = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        checkInTime: '10:00',
        status: 'present',
      });

      expect(status).toBe(201);
      expect(json.BranchID).toBe(SESSION_BRANCH_ID);
      expect(json.CheckInTime).toBe('10:00');
      expect(json.CheckOutTime).toBeNull();
    });
  });

  describe('Same-branch historical OPEN (LEGACY DIFFERENCE vs desired H, same as admin PUT today)', () => {
    it('does not 409; inserts a second OPEN row on a new WorkDate', async () => {
      const historical = harness.seed({
        BranchID: SESSION_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: OLD_WORK_DATE,
        CheckInTime: '09:00',
        CheckOutTime: null,
        Status: 'present',
        Notes: null,
      });

      const { status } = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        checkInTime: '10:00',
        status: 'present',
      });

      expect(status).toBe(201);
      expect(harness.attendance).toHaveLength(2);
      expect(harness.attendance.find((r) => r.ID === historical.ID)?.CheckOutTime).toBeNull();
      expect(
        harness.attendance.find((r) => r.WorkDate === WORK_DATE)?.CheckInTime,
      ).toBe('10:00');
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
        Status: 'present',
        Notes: null,
      });
      harness.seed({
        BranchID: OTHER_BRANCH_ID + 1,
        EmpID: EMP_ID,
        WorkDate: OLDER_WORK_DATE,
        CheckInTime: '11:00',
        CheckOutTime: null,
        Status: 'present',
        Notes: null,
      });

      const { status } = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        checkInTime: '10:00',
      });

      expect(status).toBe(201);
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
        Status: 'present',
        Notes: null,
      });
      harness.seed({
        BranchID: SESSION_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: OLDER_WORK_DATE,
        CheckInTime: '11:00',
        CheckOutTime: null,
        Status: 'present',
        Notes: null,
      });

      const { status } = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        checkInTime: '10:00',
      });

      expect(status).toBe(201);
      expect(
        harness.attendance.filter((r) => r.CheckInTime && r.CheckOutTime == null),
      ).toHaveLength(3);
    });
  });

  describe('Branch ownership', () => {
    it('write BranchID comes from the session branch', async () => {
      const { status, json } = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        checkInTime: '10:00',
      });

      expect(status).toBe(201);
      expect(json.BranchID).toBe(SESSION_BRANCH_ID);
      expect(harness.assertEmployeeEligibleForBranchAttendance).toHaveBeenCalledWith(
        EMP_ID,
        SESSION_BRANCH_ID,
        WORK_DATE,
      );
    });

    it('body BranchID is rejected and cannot switch ownership', async () => {
      const { status, json } = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        checkInTime: '10:00',
        BranchID: OTHER_BRANCH_ID,
      });

      expect(status).toBe(400);
      expect(json).toEqual({ error: 'BranchID في الطلب غير مسموح' });
      expect(harness.attendance).toHaveLength(0);
      expect(harness.assertEmpBranchWorkDayMutable).not.toHaveBeenCalled();
    });

    it('body branchId (camelCase) is also rejected', async () => {
      const { status, json } = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        checkInTime: '10:00',
        branchId: OTHER_BRANCH_ID,
      });

      expect(status).toBe(400);
      expect(json).toEqual({ error: 'BranchID في الطلب غير مسموح' });
    });
  });

  describe('WorkDate from request body (LEGACY vs comment that claims it is rejected)', () => {
    it('uses request workDate and does not call getOpenBusinessDay or resolveAttendanceWorkDate', async () => {
      const { status, json } = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        checkInTime: '10:00',
      });

      expect(status).toBe(201);
      expect(json.WorkDate).toBe(WORK_DATE);
      expect(harness.attendance[0].WorkDate).toBe(WORK_DATE);
      expect(harness.attendance[0].WorkDate).not.toBe('1999-01-01');
      expect(harness.getOpenBusinessDay).not.toHaveBeenCalled();
      expect(harness.resolveAttendanceWorkDate).not.toHaveBeenCalled();
    });
  });

  describe('MERGE persistence', () => {
    it('inserts a new (session BranchID, EmpID, WorkDate) row with HTTP 201', async () => {
      const { status, json } = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        checkInTime: '10:00',
        status: 'present',
      });

      expect(status).toBe(201);
      expect(json.UpdatedAt).toBeNull();
      expect(harness.attendance).toHaveLength(1);
      expect(harness.attendance[0]).toMatchObject({
        BranchID: SESSION_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
        CheckOutTime: null,
        Status: 'present',
      });
    });

    it('MERGE on the same branch-day updates in place (HTTP 200) and does not insert a second row', async () => {
      const first = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        checkInTime: '10:00',
        status: 'present',
      });
      expect(first.status).toBe(201);
      const id = harness.attendance[0].ID;

      const second = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        checkInTime: '10:05',
        status: 'late',
      });

      expect(second.status).toBe(200);
      expect(harness.attendance).toHaveLength(1);
      expect(harness.attendance[0].ID).toBe(id);
      expect(harness.attendance[0].CheckInTime).toBe('10:05');
      expect(harness.attendance[0].Status).toBe('late');
    });

    it('LEGACY: ISNULL MERGE preserves existing CheckInTime when checkInTime is omitted/null (checkout-only)', async () => {
      harness.seed({
        BranchID: SESSION_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
        CheckOutTime: null,
        Status: 'present',
        Notes: null,
      });

      const { status, json } = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        checkOutTime: '18:00',
      });

      expect(status).toBe(200);
      expect(json.CheckInTime).toBe('10:00');
      expect(json.CheckOutTime).toBe('18:00');
      expect(harness.attendance).toHaveLength(1);
    });
  });

  describe('Status — client value is trusted (LEGACY vs admin PUT recompute)', () => {
    it('stores lowercase payroll UI status present even with a late check-in time', async () => {
      const { json } = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        checkInTime: '10:20',
        status: 'present',
      });
      expect(json.Status).toBe('present');
      expect(harness.attendance[0].Status).toBe('present');
    });

    it('stores client Late / Absent / off / Excused without server recompute', async () => {
      const late = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        checkInTime: '10:00',
        status: 'Late',
      });
      expect(late.json.Status).toBe('Late');

      harness.reset();
      const absent = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        status: 'Absent',
      });
      expect(absent.json.Status).toBe('Absent');

      harness.reset();
      const off = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        status: 'off',
      });
      expect(off.json.Status).toBe('off');

      harness.reset();
      const excused = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        status: 'Excused',
      });
      expect(excused.json.Status).toBe('Excused');
    });

    it('omitted status is stored as null (not defaulted to Present/Pending)', async () => {
      const { json } = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        checkInTime: '10:00',
      });
      expect(json.Status).toBeNull();
    });
  });

  describe('Side effects', () => {
    it('calls AvailabilityMutationNotifier.employeeDayChanged after successful MERGE', async () => {
      const { status } = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        checkInTime: '10:00',
        checkOutTime: '18:00',
        status: 'present',
      });

      expect(status).toBe(201);
      expect(harness.availabilityEmployeeDayChanged).toHaveBeenCalledTimes(1);
      expect(harness.availabilityEmployeeDayChanged).toHaveBeenCalledWith({
        employeeId: EMP_ID,
        businessDate: WORK_DATE,
        branchId: SESSION_BRANCH_ID,
        reason: 'employees_attendance_upsert',
      });
    });

    it('does not call admin-PUT side effects (breaks, overrides, WhatsApp, payroll hours, day-off unlock)', async () => {
      const { status } = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        checkInTime: '10:00',
        checkOutTime: '18:00',
        status: 'present',
      });

      expect(status).toBe(201);
      expect(harness.replaceAttendanceBreaks).not.toHaveBeenCalled();
      expect(harness.replaceAttendanceBreakTimes).not.toHaveBeenCalled();
      expect(harness.syncBlockRangesFromBreaks).not.toHaveBeenCalled();
      expect(harness.syncAttendanceShiftToOverrides).not.toHaveBeenCalled();
      expect(harness.syncAttendanceAbsenceToDayOffOverride).not.toHaveBeenCalled();
      expect(harness.scheduleAttendanceCheckInOutWhatsApp).not.toHaveBeenCalled();
      expect(harness.syncNonPostedPayrollHoursFromAttendance).not.toHaveBeenCalled();
      expect(harness.unlockScheduleForWorkOnDayOff).not.toHaveBeenCalled();
    });
  });

  describe('Error contract', () => {
    it('401 when unauthenticated', async () => {
      harness.getSession.mockResolvedValueOnce(null);
      const { status, json } = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
      });
      expect(status).toBe(401);
      expect(json).toEqual({ error: 'غير مصرح' });
    });

    it('400 when empId/workDate missing', async () => {
      const { status, json } = await postAttendance({ checkInTime: '10:00' });
      expect(status).toBe(400);
      expect(json).toEqual({ error: 'empId و workDate مطلوبان' });
    });

    it('404 when employee row is missing', async () => {
      harness.existingEmpIds.delete(EMP_ID);
      const { status, json } = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        checkInTime: '10:00',
      });
      expect(status).toBe(404);
      expect(json).toEqual({ error: 'الموظف غير موجود' });
    });

    it('closed payroll day blocks via assertEmpBranchWorkDayMutable', async () => {
      harness.assertEmpBranchWorkDayMutable.mockRejectedValueOnce(
        new EmpBranchWorkDayCloseError(PAYROLL_DAY_CLOSED_CODE, PAYROLL_DAY_CLOSED_MESSAGE),
      );

      const { status, json } = await postAttendance({
        empId: EMP_ID,
        workDate: WORK_DATE,
        checkInTime: '10:00',
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
      expect(harness.availabilityEmployeeDayChanged).not.toHaveBeenCalled();
    });
  });
});
