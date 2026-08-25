/**
 * Characterization tests for CURRENT production PUT /api/admin/attendance/bulk.
 *
 * Freeze observable bulk behavior before Phase B4. Do not add OPEN checks,
 * change atomicity, or unify with saveAdminAttendance.
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

const SESSION_BRANCH_ID = 10;
const OTHER_BRANCH_ID = 20;
const EMP_A = 42;
const EMP_B = 43;
const WORK_DATE = '2026-08-24';
const OLD_WORK_DATE = '2026-08-01';
const OLDER_WORK_DATE = '2026-07-15';

class EligError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 403) {
    super(message);
    this.statusCode = statusCode;
  }
}

type AttRow = {
  ID: number;
  BranchID: number;
  EmpID: number;
  WorkDate: string;
  CheckInTime: string | null;
  CheckOutTime: string | null;
  Status: string;
  Notes: string | null;
  LateMinutes: number;
  EarlyLeaveMinutes: number;
};

const harness = vi.hoisted(() => {
  type Row = AttRow;

  const branchState = { branchId: 10 };
  const attendance: Row[] = [];
  let nextId = 1;
  const capturedQueries: { sql: string; inputs: Record<string, unknown> }[] = [];
  let snapshot: Row[] | null = null;
  const tx = { begun: false, committed: false, rolledBack: false };

  const empDefaults = new Map<
    number,
    { EmpID: number; EmpName: string; DefaultCheckInTime: string; DefaultCheckOutTime: string }
  >([
    [42, { EmpID: 42, EmpName: 'Emp A', DefaultCheckInTime: '10:00', DefaultCheckOutTime: '18:00' }],
    [43, { EmpID: 43, EmpName: 'Emp B', DefaultCheckInTime: '10:00', DefaultCheckOutTime: '18:00' }],
  ]);

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

  function cloneRows(): Row[] {
    return attendance.map((r) => ({ ...r }));
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

        if (/FROM dbo\.TblEmp\b/i.test(sql) && /EmpID IN/i.test(sql)) {
          return { recordset: [...empDefaults.values()] };
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
            (r) => r.EmpID === empId && r.BranchID === branchId && r.WorkDate === workDate,
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
            row.Notes = inputs.notes == null ? null : String(inputs.notes);
            row.LateMinutes = Number(inputs.lateMinutes ?? 0);
            row.EarlyLeaveMinutes = Number(inputs.earlyLeaveMinutes ?? 0);
          }
          return { recordset: [], rowsAffected: [row ? 1 : 0] };
        }

        if (/INSERT INTO dbo\.TblEmpAttendance/i.test(sql)) {
          const row: Row = {
            ID: nextId++,
            BranchID: Number(inputs.branchId),
            EmpID: Number(inputs.empId),
            WorkDate: ymd(inputs.workDate),
            CheckInTime: hhmm(inputs.checkInTime),
            CheckOutTime: hhmm(inputs.checkOutTime),
            Status: String(inputs.status),
            Notes: inputs.notes == null ? null : String(inputs.notes),
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
    tx,
    empDefaults,
    getOpenBusinessDay: vi.fn(async () => ({ id: 1, newDay: '1999-01-01', status: 1 })),
    resolveAttendanceWorkDate: vi.fn(async () => ({
      workDate: '1999-01-01',
      businessDayId: 1,
    })),
    assertEmployeeEligibleForBranchAttendance: vi.fn(async () => undefined),
    assertEmpBranchWorkDayMutable: vi.fn(async () => undefined),
    unlockScheduleForWorkOnDayOff: vi.fn(async () => ({})),
    getEffectiveBranchScheduleRow: vi.fn(async () => ({ isWorking: true })),
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
    syncNonPostedPayrollHoursFromAttendance: vi.fn(async () => ({ updated: false })),
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
    beginTx() {
      snapshot = cloneRows();
      tx.begun = true;
      tx.committed = false;
      tx.rolledBack = false;
    },
    commitTx() {
      snapshot = null;
      tx.committed = true;
    },
    rollbackTx() {
      if (snapshot) {
        attendance.length = 0;
        attendance.push(...snapshot);
      }
      tx.rolledBack = true;
      tx.committed = false;
    },
    reset() {
      attendance.length = 0;
      capturedQueries.length = 0;
      nextId = 1;
      snapshot = null;
      branchState.branchId = 10;
      tx.begun = false;
      tx.committed = false;
      tx.rolledBack = false;
    },
    seed(row: Omit<Row, 'ID' | 'LateMinutes' | 'EarlyLeaveMinutes' | 'Notes'> & {
      ID?: number;
      LateMinutes?: number;
      EarlyLeaveMinutes?: number;
      Notes?: string | null;
    }): Row {
      const full: Row = {
        ID: row.ID ?? nextId++,
        LateMinutes: row.LateMinutes ?? 0,
        EarlyLeaveMinutes: row.EarlyLeaveMinutes ?? 0,
        Notes: row.Notes ?? null,
        ...row,
      };
      if (row.ID != null && row.ID >= nextId) nextId = row.ID + 1;
      attendance.push(full);
      return full;
    },
    makeFakeDb() {
      return { request: () => makeRequest() };
    },
    makeRequest,
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

vi.mock('@/lib/hr/empBranchWorkSchedule', () => ({
  getEffectiveBranchScheduleRow: (...args: unknown[]) =>
    harness.getEffectiveBranchScheduleRow(...args),
  ensureEmpBranchWorkScheduleTable: vi.fn(async () => undefined),
}));

vi.mock('@/lib/session', () => ({
  getSession: (...args: unknown[]) => harness.getSession(...args),
}));

vi.mock('@/lib/db', () => {
  class MockRequest {
    private inner = harness.makeRequest();
    input(name: string, type: unknown, value: unknown) {
      this.inner.input(name, type, value);
      return this;
    }
    query(sqlText: string) {
      return this.inner.query(sqlText);
    }
  }
  class MockTransaction {
    async begin() {
      harness.beginTx();
    }
    async commit() {
      harness.commitTx();
    }
    async rollback() {
      harness.rollbackTx();
    }
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
}));

vi.mock('@/lib/hr/attendance-break-time-db', () => ({
  ensureAttendanceBreakTimeSchema: vi.fn(async () => undefined),
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
  return new NextRequest('http://localhost/api/admin/attendance/bulk', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function putBulk(body: unknown) {
  const { PUT } = await import('@/app/api/admin/attendance/bulk/route');
  const res = await PUT(jsonReq(body));
  const json = await res.json();
  return { status: res.status, json };
}

function item(empId: number, extra: Record<string, unknown> = {}) {
  return { EmpID: empId, ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.reset();
  harness.assertEmployeeEligibleForBranchAttendance.mockResolvedValue(undefined);
  harness.syncAttendanceShiftToOverrides.mockResolvedValue({
    deactivated: 0,
    inserted: 0,
  });
  harness.getEffectiveBranchScheduleRow.mockResolvedValue({ isWorking: true });
});

describe('PUT /api/admin/attendance/bulk — characterization (current production)', () => {
  describe('Successful writes', () => {
    it('writes multiple employees and returns summary (not per-row data)', async () => {
      const { status, json } = await putBulk({
        WorkDate: WORK_DATE,
        items: [
          item(EMP_A, { CheckInTime: '10:00', Status: 'Present' }),
          item(EMP_B, { CheckInTime: '10:00', CheckOutTime: '18:00', Status: 'Present' }),
        ],
      });
      expect(status).toBe(200);
      expect(json).toEqual({
        success: true,
        message: 'تم حفظ الحضور بنجاح',
        summary: { savedCount: 2, insertedCount: 2, updatedCount: 0 },
      });
      expect(json).not.toHaveProperty('data');
      expect(harness.attendance).toHaveLength(2);
      expect(harness.tx.committed).toBe(true);
      expect(harness.tx.rolledBack).toBe(false);
    });

    it('saves a single-item bulk', async () => {
      const { json } = await putBulk({
        WorkDate: WORK_DATE,
        items: [item(EMP_A, { CheckInTime: '10:00' })],
      });
      expect(json.summary).toEqual({
        savedCount: 1,
        insertedCount: 1,
        updatedCount: 0,
      });
    });

    it('updates an existing (session BranchID, EmpID, WorkDate) row (overwrite)', async () => {
      harness.seed({
        BranchID: SESSION_BRANCH_ID,
        EmpID: EMP_A,
        WorkDate: WORK_DATE,
        CheckInTime: '09:00',
        CheckOutTime: null,
        Status: 'Present',
      });
      const { json } = await putBulk({
        WorkDate: WORK_DATE,
        items: [item(EMP_A, { CheckInTime: '10:00', CheckOutTime: '18:00' })],
      });
      expect(json.summary).toEqual({
        savedCount: 1,
        insertedCount: 0,
        updatedCount: 1,
      });
      expect(harness.attendance).toHaveLength(1);
      expect(harness.attendance[0]).toMatchObject({
        CheckInTime: '10:00',
        CheckOutTime: '18:00',
      });
    });
  });

  describe('OPEN / dual-open — active-session WorkDate policy', () => {
    it('queries active-session OPEN inventory (not legacy BranchID <> only)', async () => {
      await putBulk({
        WorkDate: WORK_DATE,
        items: [item(EMP_A, { CheckInTime: '10:00' })],
      });
      expect(
        harness.capturedQueries.some(
          (q) =>
            /CheckOutTime IS NULL/i.test(q.sql) &&
            /EmpID = @empId/i.test(q.sql) &&
            /TblEmpAttendance/i.test(q.sql) &&
            !/BranchID\s*<>/i.test(q.sql),
        ),
      ).toBe(true);
      expect(
        harness.capturedQueries.some(
          (q) => /CheckOutTime IS NULL/i.test(q.sql) && /BranchID\s*<>/i.test(q.sql),
        ),
      ).toBe(false);
    });

    it('same WorkDate other-branch OPEN → ALREADY_OPEN and batch rollback', async () => {
      harness.seed({
        BranchID: OTHER_BRANCH_ID,
        EmpID: EMP_A,
        WorkDate: WORK_DATE,
        CheckInTime: '09:00',
        CheckOutTime: null,
        Status: 'Present',
      });
      const { status, json } = await putBulk({
        WorkDate: WORK_DATE,
        items: [item(EMP_A, { CheckInTime: '10:00' })],
      });
      expect(status).toBe(409);
      expect(json).toEqual({
        error: 'الموظف لديه حضور مفتوح في فرع آخر — سجّل الانصراف أولاً',
        code: 'ALREADY_OPEN',
      });
      expect(
        harness.attendance.filter((r) => r.BranchID === SESSION_BRANCH_ID),
      ).toHaveLength(0);
      expect(harness.tx.rolledBack).toBe(true);
    });

    it('LEGACY: other-branch OPEN on an old WorkDate still inserts (stale)', async () => {
      harness.seed({
        BranchID: OTHER_BRANCH_ID,
        EmpID: EMP_A,
        WorkDate: OLD_WORK_DATE,
        CheckInTime: '09:00',
        CheckOutTime: null,
        Status: 'Present',
      });
      const { status } = await putBulk({
        WorkDate: WORK_DATE,
        items: [item(EMP_A, { CheckInTime: '10:00' })],
      });
      expect(status).toBe(200);
      expect(
        harness.attendance.filter((r) => r.CheckInTime && r.CheckOutTime == null),
      ).toHaveLength(2);
    });

    it('LEGACY: same-branch historical OPEN plus new WorkDate OPEN is allowed', async () => {
      harness.seed({
        BranchID: SESSION_BRANCH_ID,
        EmpID: EMP_A,
        WorkDate: OLDER_WORK_DATE,
        CheckInTime: '08:00',
        CheckOutTime: null,
        Status: 'Present',
      });
      const { status } = await putBulk({
        WorkDate: WORK_DATE,
        items: [item(EMP_A, { CheckInTime: '10:00' })],
      });
      expect(status).toBe(200);
      expect(
        harness.attendance.filter((r) => r.CheckInTime && r.CheckOutTime == null),
      ).toHaveLength(2);
    });

    it('two employees in one bulk can both be left OPEN', async () => {
      const { status } = await putBulk({
        WorkDate: WORK_DATE,
        items: [
          item(EMP_A, { CheckInTime: '10:00' }),
          item(EMP_B, { CheckInTime: '11:00' }),
        ],
      });
      expect(status).toBe(200);
      expect(
        harness.attendance.filter((r) => r.CheckInTime && r.CheckOutTime == null),
      ).toHaveLength(2);
    });

    it('checkout overwrites CheckOutTime on the session branch-day row', async () => {
      harness.seed({
        BranchID: SESSION_BRANCH_ID,
        EmpID: EMP_A,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
        CheckOutTime: null,
        Status: 'Present',
      });
      const { json } = await putBulk({
        WorkDate: WORK_DATE,
        items: [item(EMP_A, { CheckInTime: '10:00', CheckOutTime: '18:00' })],
      });
      expect(json.summary.updatedCount).toBe(1);
      expect(harness.attendance[0].CheckOutTime).toBe('18:00');
    });
  });

  describe('Branch / WorkDate', () => {
    it('write BranchID is the session branch; item.BranchID cannot retarget', async () => {
      const { json } = await putBulk({
        WorkDate: WORK_DATE,
        items: [
          { EmpID: EMP_A, BranchID: OTHER_BRANCH_ID, CheckInTime: '10:00' },
        ],
      });
      expect(json.success).toBe(true);
      expect(harness.attendance[0].BranchID).toBe(SESSION_BRANCH_ID);
    });

    it('top-level body BranchID is rejected', async () => {
      const { status, json } = await putBulk({
        WorkDate: WORK_DATE,
        BranchID: OTHER_BRANCH_ID,
        items: [item(EMP_A, { CheckInTime: '10:00' })],
      });
      expect(status).toBe(400);
      expect(json).toEqual({ error: 'BranchID في الطلب غير مسموح' });
      expect(harness.assertEmpBranchWorkDayMutable).not.toHaveBeenCalled();
    });

    it('uses request WorkDate for every item; item.WorkDate is ignored', async () => {
      const { json } = await putBulk({
        WorkDate: WORK_DATE,
        items: [
          { EmpID: EMP_A, WorkDate: OLD_WORK_DATE, CheckInTime: '10:00' },
        ],
      });
      expect(json.success).toBe(true);
      expect(harness.attendance[0].WorkDate).toBe(WORK_DATE);
      expect(harness.getOpenBusinessDay).not.toHaveBeenCalled();
      expect(harness.resolveAttendanceWorkDate).not.toHaveBeenCalled();
    });

    it('payroll gate runs once for session branch + request WorkDate (before items)', async () => {
      await putBulk({ WorkDate: WORK_DATE, items: [] });
      expect(harness.assertEmpBranchWorkDayMutable).toHaveBeenCalledTimes(1);
      expect(harness.assertEmpBranchWorkDayMutable).toHaveBeenCalledWith(
        SESSION_BRANCH_ID,
        WORK_DATE,
      );
    });
  });

  describe('Atomicity / partial write', () => {
    it('eligibility failure on employee 2 rolls back employee 1 (no partial SQL write)', async () => {
      harness.assertEmployeeEligibleForBranchAttendance.mockImplementation(
        async (empId: unknown) => {
          if (Number(empId) === EMP_B) {
            throw new EligError('غير مؤهل للفرع', 403);
          }
        },
      );
      const { status, json } = await putBulk({
        WorkDate: WORK_DATE,
        items: [
          item(EMP_A, { CheckInTime: '10:00' }),
          item(EMP_B, { CheckInTime: '10:00' }),
        ],
      });
      expect(status).toBe(403);
      expect(json).toEqual({
        error: 'غير مؤهل للفرع (موظف 43 — Emp B)',
      });
      expect(json).not.toHaveProperty('code');
      expect(harness.attendance).toHaveLength(0);
      expect(harness.tx.rolledBack).toBe(true);
      expect(harness.tx.committed).toBe(false);
      expect(harness.scheduleAttendanceCheckInOutWhatsApp).not.toHaveBeenCalled();
    });

    it('override sync throw on employee 2 rolls back employee 1', async () => {
      harness.syncAttendanceShiftToOverrides.mockImplementation(
        async (_db: unknown, empId: unknown) => {
          if (Number(empId) === EMP_B) throw new Error('override boom');
          return { deactivated: 0, inserted: 0 };
        },
      );
      const { status, json } = await putBulk({
        WorkDate: WORK_DATE,
        items: [
          item(EMP_A, { CheckInTime: '10:00' }),
          item(EMP_B, { CheckInTime: '10:00' }),
        ],
      });
      expect(status).toBe(500);
      expect(json).toEqual({ error: 'override boom' });
      expect(harness.attendance).toHaveLength(0);
      expect(harness.tx.rolledBack).toBe(true);
      expect(harness.scheduleAttendanceCheckInOutWhatsApp).not.toHaveBeenCalled();
    });
  });

  describe('Status / punches', () => {
    it('recomputes Late from TblEmp DefaultCheckInTime (not branch work schedule JOIN)', async () => {
      const { json } = await putBulk({
        WorkDate: WORK_DATE,
        items: [item(EMP_A, { CheckInTime: '10:20', Status: 'Present' })],
      });
      expect(json.success).toBe(true);
      expect(harness.attendance[0].Status).toBe('Late');
    });

    it('trusts Absent / DayOff / Excused', async () => {
      await putBulk({
        WorkDate: WORK_DATE,
        items: [item(EMP_A, { Status: 'Absent' })],
      });
      expect(harness.attendance[0].Status).toBe('Absent');
    });

    it('rejects lowercase payroll-style present before any write', async () => {
      const { status, json } = await putBulk({
        WorkDate: WORK_DATE,
        items: [item(EMP_A, { Status: 'present', CheckInTime: '10:00' })],
      });
      expect(status).toBe(400);
      expect(json).toEqual({ error: 'حالة غير صحيحة: present' });
      expect(harness.tx.begun).toBe(false);
      expect(harness.attendance).toHaveLength(0);
    });

    it('omitted/empty CheckInTime overwrites existing punch to null (not ISNULL-keep)', async () => {
      harness.seed({
        BranchID: SESSION_BRANCH_ID,
        EmpID: EMP_A,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
        CheckOutTime: '18:00',
        Status: 'Present',
      });
      await putBulk({
        WorkDate: WORK_DATE,
        items: [item(EMP_A, { Status: 'Present' })],
      });
      expect(harness.attendance[0].CheckInTime).toBeNull();
      expect(harness.attendance[0].CheckOutTime).toBeNull();
    });
  });

  describe('Breaks and side effects', () => {
    it('replaces breaks when provided and syncs block_range inside the transaction', async () => {
      const breaks = [{ start: '12:00', end: '12:30' }];
      const { status } = await putBulk({
        WorkDate: WORK_DATE,
        items: [item(EMP_A, { CheckInTime: '10:00', Breaks: breaks })],
      });
      expect(status).toBe(200);
      expect(harness.replaceAttendanceBreaks).toHaveBeenCalled();
      expect(harness.syncBlockRangesFromBreaks).toHaveBeenCalled();
    });

    it('omitted Breaks on a punched row does not call replaceAttendanceBreaks', async () => {
      await putBulk({
        WorkDate: WORK_DATE,
        items: [item(EMP_A, { CheckInTime: '10:00' })],
      });
      expect(harness.replaceAttendanceBreaks).not.toHaveBeenCalled();
    });

    it('invalid breaks fail before the transaction (no partial write)', async () => {
      const { status, json } = await putBulk({
        WorkDate: WORK_DATE,
        items: [
          item(EMP_A, { CheckInTime: '10:00' }),
          item(EMP_B, { CheckInTime: '10:00', Breaks: 'bad' }),
        ],
      });
      expect(status).toBe(400);
      expect(String(json.error)).toMatch(/موظف 43/);
      expect(harness.tx.begun).toBe(false);
      expect(harness.attendance).toHaveLength(0);
    });

    it('after commit: WhatsApp per employee; no payroll-hours; no availability notifier', async () => {
      const { status } = await putBulk({
        WorkDate: WORK_DATE,
        items: [
          item(EMP_A, { CheckInTime: '10:00', CheckOutTime: '18:00' }),
          item(EMP_B, { CheckInTime: '10:00', CheckOutTime: '18:00' }),
        ],
      });
      expect(status).toBe(200);
      expect(harness.scheduleAttendanceCheckInOutWhatsApp).toHaveBeenCalledTimes(2);
      expect(harness.syncAttendanceShiftToOverrides).toHaveBeenCalledTimes(2);
      expect(harness.syncAttendanceAbsenceToDayOffOverride).toHaveBeenCalledTimes(2);
      expect(harness.syncNonPostedPayrollHoursFromAttendance).not.toHaveBeenCalled();
      expect(harness.availabilityEmployeeDayChanged).not.toHaveBeenCalled();
    });

    it('unlocks work-on-day-off when effective schedule is not working', async () => {
      harness.getEffectiveBranchScheduleRow.mockResolvedValue({ isWorking: false });
      await putBulk({
        WorkDate: WORK_DATE,
        items: [item(EMP_A, { CheckInTime: '10:00' })],
      });
      expect(harness.unlockScheduleForWorkOnDayOff).toHaveBeenCalledWith({
        empId: EMP_A,
        date: WORK_DATE,
        branchId: SESSION_BRANCH_ID,
        reason: 'نزل يشتغل يوم إجازته — تسجيل حضور',
        sourceTag: 'work-on-day-off',
      });
    });
  });

  describe('Error contract', () => {
    it('401 when unauthenticated', async () => {
      harness.getSession.mockResolvedValueOnce(null);
      const { status, json } = await putBulk({
        WorkDate: WORK_DATE,
        items: [item(EMP_A)],
      });
      expect(status).toBe(401);
      expect(json).toEqual({ error: 'غير مصرح' });
    });

    it('400 when items is missing', async () => {
      const { status, json } = await putBulk({ WorkDate: WORK_DATE });
      expect(status).toBe(400);
      expect(json).toEqual({ error: 'يجب إرسال مصفوفة items' });
    });

    it('409 payroll closed uses request WorkDate and writes nothing', async () => {
      harness.assertEmpBranchWorkDayMutable.mockRejectedValueOnce(
        new EmpBranchWorkDayCloseError(PAYROLL_DAY_CLOSED_CODE, PAYROLL_DAY_CLOSED_MESSAGE),
      );
      const { status, json } = await putBulk({
        WorkDate: WORK_DATE,
        items: [item(EMP_A, { CheckInTime: '10:00' })],
      });
      expect(status).toBe(409);
      expect(json).toEqual({
        error: PAYROLL_DAY_CLOSED_MESSAGE,
        code: PAYROLL_DAY_CLOSED_CODE,
      });
      expect(harness.attendance).toHaveLength(0);
    });
  });
});
