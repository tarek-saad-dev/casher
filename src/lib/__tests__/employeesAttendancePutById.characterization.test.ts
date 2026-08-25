/**
 * Characterization tests for CURRENT production PUT /api/employees/attendance/:id.
 *
 * Freeze observable legacy behavior before Phase B3. Do not "fix" OPEN,
 * null-clears, or differences vs Admin PUT / Employees POST.
 *
 * Runtime Behavior Changes: NONE — tests only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  PAYROLL_DAY_CLOSED_CODE,
  PAYROLL_DAY_CLOSED_MESSAGE,
} from '@/lib/hr/empBranchWorkDayClose.transitions';
import { EmpBranchWorkDayCloseError } from '@/lib/hr/empBranchWorkDayClose.types';

vi.mock('server-only', () => ({}));

const SESSION_BRANCH_ID = 10;
const OTHER_BRANCH_ID = 20;
const EMP_ID = 42;
const OTHER_EMP_ID = 99;
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
    if (s === '') return '';
    return s.length >= 5 ? s.slice(0, 5) : s;
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

        if (
          /SELECT[\s\S]*ID[\s\S]*BranchID[\s\S]*EmpID[\s\S]*WorkDate[\s\S]*FROM dbo\.TblEmpAttendance WHERE ID = @id/i.test(
            sql,
          ) ||
          /SELECT ID,\s*BranchID,\s*WorkDate FROM dbo\.TblEmpAttendance WHERE ID = @id/i.test(
            sql,
          )
        ) {
          const id = Number(inputs.id);
          const row = attendance.find((r) => r.ID === id);
          if (!row) return { recordset: [] };
          return {
            recordset: [
              {
                ID: row.ID,
                BranchID: row.BranchID,
                EmpID: row.EmpID,
                WorkDate: row.WorkDate,
                CheckInTime: row.CheckInTime,
                CheckOutTime: row.CheckOutTime,
              },
            ],
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

        if (/UPDATE dbo\.TblEmpAttendance/i.test(sql)) {
          const id = Number(inputs.id);
          const branchId = Number(inputs.branchId);
          const row = attendance.find((r) => r.ID === id && r.BranchID === branchId);
          if (!row) return { recordset: [] };

          if (Object.prototype.hasOwnProperty.call(inputs, 'checkInTime')) {
            row.CheckInTime = hhmm(inputs.checkInTime);
          }
          if (Object.prototype.hasOwnProperty.call(inputs, 'checkOutTime')) {
            row.CheckOutTime = hhmm(inputs.checkOutTime);
          }
          if (Object.prototype.hasOwnProperty.call(inputs, 'status')) {
            row.Status = inputs.status == null ? null : String(inputs.status);
          }
          if (Object.prototype.hasOwnProperty.call(inputs, 'notes')) {
            row.Notes = inputs.notes == null ? null : String(inputs.notes);
          }
          row.UpdatedAt = new Date();
          return { recordset: [toOutput(row)] };
        }

        return { recordset: [], rowsAffected: [1] };
      },
    };
  }

  return {
    branchState,
    attendance,
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

vi.mock('@/lib/branch', async () => {
  const { NextResponse } = await import('next/server');
  return {
    isActiveBranchContext: (v: unknown) =>
      !!v &&
      typeof v === 'object' &&
      !(v instanceof NextResponse) &&
      typeof (v as { branchId?: unknown }).branchId === 'number',
    requireBranchOperationAccess: (...args: unknown[]) =>
      harness.requireBranchOperationAccess(...args),
    getOpenBusinessDay: (...args: unknown[]) => harness.getOpenBusinessDay(...args),
  };
});

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
  return new NextRequest('http://localhost/api/employees/attendance/1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function putAttendance(id: string | number, body: unknown) {
  const { PUT } = await import('@/app/api/employees/attendance/[id]/route');
  const res = await PUT(jsonReq(body), {
    params: Promise.resolve({ id: String(id) }),
  });
  const json = await res.json();
  return { status: res.status, json };
}

function openCount() {
  return harness.attendance.filter((r) => r.CheckInTime != null && r.CheckOutTime == null)
    .length;
}

function seedSessionClosed(overrides: Partial<AttRow> = {}) {
  return harness.seed({
    BranchID: SESSION_BRANCH_ID,
    EmpID: EMP_ID,
    WorkDate: WORK_DATE,
    CheckInTime: '10:00',
    CheckOutTime: '18:00',
    Status: 'present',
    Notes: 'keep-me',
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.reset();
});

describe('PUT /api/employees/attendance/:id — characterization (current production)', () => {
  describe('Normal partial update', () => {
    it('updates only provided fields and returns HTTP 200 raw OUTPUT row', async () => {
      const row = seedSessionClosed();
      const { status, json } = await putAttendance(row.ID, {
        notes: 'patched',
      });

      expect(status).toBe(200);
      expect(json).toMatchObject({
        ID: row.ID,
        BranchID: SESSION_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
        CheckOutTime: '18:00',
        Status: 'present',
        Notes: 'patched',
      });
      expect(json).not.toHaveProperty('success');
      expect(json).not.toHaveProperty('message');
      expect(json).not.toHaveProperty('data');
      expect(json.UpdatedAt).toBeTruthy();
    });
  });

  describe('Checkout-only', () => {
    it('omitted CheckInTime is left unchanged', async () => {
      const row = seedSessionClosed({ CheckOutTime: null, Status: 'present' });
      const { status, json } = await putAttendance(row.ID, {
        checkOutTime: '18:00',
      });
      expect(status).toBe(200);
      expect(json.CheckInTime).toBe('10:00');
      expect(json.CheckOutTime).toBe('18:00');
      expect(harness.attendance[0].CheckInTime).toBe('10:00');
    });
  });

  describe('Partial check-in', () => {
    it('patches CheckInTime without touching CheckOutTime', async () => {
      const row = seedSessionClosed();
      const { json } = await putAttendance(row.ID, { checkInTime: '10:15' });
      expect(json.CheckInTime).toBe('10:15');
      expect(json.CheckOutTime).toBe('18:00');
    });
  });

  describe('Status-only — client value is trusted', () => {
    it('stores AttendanceTab lowercase present/late/absent/off as sent', async () => {
      const row = seedSessionClosed();
      for (const status of ['present', 'late', 'absent', 'off'] as const) {
        const res = await putAttendance(row.ID, { status });
        expect(res.status).toBe(200);
        expect(res.json.Status).toBe(status);
        expect(harness.attendance[0].Status).toBe(status);
      }
    });

    it('stores PascalCase Late / Absent / Excused / DayOff without recompute', async () => {
      const row = seedSessionClosed({ CheckInTime: '10:20' });
      const late = await putAttendance(row.ID, { status: 'Late' });
      expect(late.json.Status).toBe('Late');

      const absent = await putAttendance(row.ID, { status: 'Absent' });
      expect(absent.json.Status).toBe('Absent');

      const excused = await putAttendance(row.ID, { status: 'Excused' });
      expect(excused.json.Status).toBe('Excused');

      const dayOff = await putAttendance(row.ID, { status: 'DayOff' });
      expect(dayOff.json.Status).toBe('DayOff');
    });
  });

  describe('Omitted vs null vs empty string', () => {
    it('omitted fields are not in the UPDATE SET list', async () => {
      const row = seedSessionClosed();
      await putAttendance(row.ID, { notes: 'only-notes' });
      const update = harness.capturedQueries.find((q) =>
        /UPDATE dbo\.TblEmpAttendance/i.test(q.sql),
      );
      expect(update?.sql).toMatch(/Notes\s+= @notes/);
      expect(update?.sql).not.toMatch(/CheckInTime\s+= @checkInTime/);
      expect(update?.sql).not.toMatch(/CheckOutTime\s+= @checkOutTime/);
      expect(update?.sql).not.toMatch(/Status\s+= @status/);
      expect(update?.inputs).not.toHaveProperty('checkInTime');
    });

    it('LEGACY: null CLEARS the field (not ISNULL-keep like Employees POST)', async () => {
      const row = seedSessionClosed();
      const { json } = await putAttendance(row.ID, { checkOutTime: null });
      expect(json.CheckOutTime).toBeNull();
      expect(harness.attendance[0].CheckInTime).toBe('10:00');
      expect(harness.attendance[0].CheckOutTime).toBeNull();
    });

    it('LEGACY: empty string is written (not treated as omit)', async () => {
      const row = seedSessionClosed({ Notes: 'had-notes' });
      const { json } = await putAttendance(row.ID, { notes: '' });
      expect(json.Notes).toBe('');
      expect(harness.attendance[0].Notes).toBe('');
    });

    it('body with no patchable fields returns 400 لا توجد بيانات للتعديل', async () => {
      const row = seedSessionClosed();
      const { status, json } = await putAttendance(row.ID, {});
      expect(status).toBe(400);
      expect(json).toEqual({ error: 'لا توجد بيانات للتعديل' });
      expect(harness.attendance[0].UpdatedAt).toBeNull();
      expect(harness.assertEmpBranchWorkDayMutable).toHaveBeenCalled();
    });
  });

  describe('WorkDate / EmpID / extra fields are not writable', () => {
    it('body WorkDate does not change the row and is not used for the payroll gate', async () => {
      const row = seedSessionClosed({ WorkDate: OLD_WORK_DATE });
      const { json } = await putAttendance(row.ID, {
        workDate: WORK_DATE,
        WorkDate: WORK_DATE,
        notes: 'x',
      });
      expect(json.WorkDate).toBe(OLD_WORK_DATE);
      expect(harness.attendance[0].WorkDate).toBe(OLD_WORK_DATE);
      expect(harness.assertEmpBranchWorkDayMutable).toHaveBeenCalledWith(
        SESSION_BRANCH_ID,
        OLD_WORK_DATE,
      );
      expect(harness.getOpenBusinessDay).not.toHaveBeenCalled();
      expect(harness.resolveAttendanceWorkDate).not.toHaveBeenCalled();
    });

    it('body EmpID / Scheduled* / LateMinutes are ignored', async () => {
      const row = seedSessionClosed();
      const { json } = await putAttendance(row.ID, {
        empId: OTHER_EMP_ID,
        EmpID: OTHER_EMP_ID,
        ScheduledStartTime: '08:00',
        ScheduledEndTime: '16:00',
        LateMinutes: 99,
        EarlyLeaveMinutes: 99,
        notes: 'ok',
      });
      expect(json.EmpID).toBe(EMP_ID);
      expect(harness.attendance[0].EmpID).toBe(EMP_ID);
    });
  });

  describe('Session branch ownership', () => {
    it('write is scoped to session branch via WHERE ID AND BranchID', async () => {
      const row = seedSessionClosed();
      await putAttendance(row.ID, { notes: 'owned' });
      const update = harness.capturedQueries.find((q) =>
        /UPDATE dbo\.TblEmpAttendance/i.test(q.sql),
      );
      expect(update?.sql).toMatch(/WHERE\s+ID = @id AND BranchID = @branchId/);
      expect(update?.inputs.branchId).toBe(SESSION_BRANCH_ID);
    });

    it('body BranchID is rejected and cannot switch ownership', async () => {
      const row = seedSessionClosed();
      const { status, json } = await putAttendance(row.ID, {
        BranchID: OTHER_BRANCH_ID,
        notes: 'nope',
      });
      expect(status).toBe(400);
      expect(json).toEqual({ error: 'BranchID في الطلب غير مسموح' });
      expect(harness.attendance[0].Notes).toBe('keep-me');
      expect(harness.assertEmpBranchWorkDayMutable).not.toHaveBeenCalled();
    });

    it('body branchId (camelCase) is also rejected', async () => {
      const row = seedSessionClosed();
      const { status, json } = await putAttendance(row.ID, {
        branchId: OTHER_BRANCH_ID,
        notes: 'nope',
      });
      expect(status).toBe(400);
      expect(json).toEqual({ error: 'BranchID في الطلب غير مسموح' });
    });
  });

  describe('Cross-branch row ID (non-disclosing 404)', () => {
    it('does not update a row owned by another branch', async () => {
      const foreign = harness.seed({
        BranchID: OTHER_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '09:00',
        CheckOutTime: '17:00',
        Status: 'present',
        Notes: 'foreign',
      });
      const { status, json } = await putAttendance(foreign.ID, {
        notes: 'hijack',
        checkOutTime: '19:00',
      });
      expect(status).toBe(404);
      expect(json).toEqual({ error: 'غير موجود' });
      expect(harness.attendance[0].Notes).toBe('foreign');
      expect(harness.attendance[0].CheckOutTime).toBe('17:00');
      expect(harness.assertEmpBranchWorkDayMutable).not.toHaveBeenCalled();
      expect(harness.availabilityEmployeeDayChanged).not.toHaveBeenCalled();
    });
  });

  describe('OPEN / dual-open — active-session WorkDate policy', () => {
    it('closed row: clearing CheckOutTime creates OPEN (CheckIn kept, CheckOut null)', async () => {
      const row = seedSessionClosed();
      const { status } = await putAttendance(row.ID, { checkOutTime: null });
      expect(status).toBe(200);
      expect(harness.attendance[0].CheckInTime).toBe('10:00');
      expect(harness.attendance[0].CheckOutTime).toBeNull();
      expect(openCount()).toBe(1);
    });

    it('same WorkDate other-branch OPEN → 409 ALREADY_OPEN when becoming OPEN', async () => {
      harness.seed({
        BranchID: OTHER_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '09:00',
        CheckOutTime: null,
        Status: 'present',
        Notes: null,
      });
      const mine = seedSessionClosed();
      const { status, json } = await putAttendance(mine.ID, { checkOutTime: null });
      expect(status).toBe(409);
      expect(json).toEqual({
        error: 'الموظف لديه حضور مفتوح في فرع آخر — سجّل الانصراف أولاً',
        code: 'ALREADY_OPEN',
      });
      expect(harness.attendance.find((r) => r.ID === mine.ID)?.CheckOutTime).toBe(
        '18:00',
      );
      expect(openCount()).toBe(1);
    });

    it('LEGACY: other-branch OPEN on an old WorkDate still does not block (stale)', async () => {
      harness.seed({
        BranchID: OTHER_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: OLD_WORK_DATE,
        CheckInTime: '09:00',
        CheckOutTime: null,
        Status: 'present',
        Notes: null,
      });
      const mine = seedSessionClosed({ CheckOutTime: null });
      const { status } = await putAttendance(mine.ID, { checkInTime: '11:00' });
      expect(status).toBe(200);
      expect(openCount()).toBe(2);
    });

    it('LEGACY: same-branch historical OPEN plus this row becoming OPEN is allowed', async () => {
      harness.seed({
        BranchID: SESSION_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: OLDER_WORK_DATE,
        CheckInTime: '08:00',
        CheckOutTime: null,
        Status: 'present',
        Notes: null,
      });
      const mine = seedSessionClosed();
      const { status } = await putAttendance(mine.ID, { checkOutTime: null });
      expect(status).toBe(200);
      expect(openCount()).toBe(2);
    });

    it('checkout-only on an already-OPEN row does not consult ALREADY_OPEN', async () => {
      const row = seedSessionClosed({ CheckOutTime: null });
      harness.seed({
        BranchID: OTHER_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: OLD_WORK_DATE,
        CheckInTime: '09:00',
        CheckOutTime: null,
        Status: 'present',
        Notes: null,
      });
      const { status } = await putAttendance(row.ID, { checkOutTime: '18:00' });
      expect(status).toBe(200);
      expect(harness.attendance.find((r) => r.ID === row.ID)?.CheckOutTime).toBe(
        '18:00',
      );
    });
  });

  describe('Side effects', () => {
    it('calls AvailabilityMutationNotifier.employeeDayChanged with employees_attendance_update', async () => {
      const row = seedSessionClosed();
      const { status } = await putAttendance(row.ID, { notes: 'n' });
      expect(status).toBe(200);
      expect(harness.availabilityEmployeeDayChanged).toHaveBeenCalledTimes(1);
      expect(harness.availabilityEmployeeDayChanged).toHaveBeenCalledWith({
        employeeId: EMP_ID,
        businessDate: WORK_DATE,
        branchId: SESSION_BRANCH_ID,
        reason: 'employees_attendance_update',
      });
    });

    it('does not call eligibility, admin PUT side effects, or employees POST upsert reason', async () => {
      const row = seedSessionClosed();
      await putAttendance(row.ID, {
        checkInTime: '10:00',
        checkOutTime: '18:00',
        status: 'present',
      });
      expect(harness.assertEmployeeEligibleForBranchAttendance).not.toHaveBeenCalled();
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
      const { status, json } = await putAttendance(1, { notes: 'x' });
      expect(status).toBe(401);
      expect(json).toEqual({ error: 'غير مصرح' });
    });

    it('returns branch requireBranchOperationAccess response as-is', async () => {
      harness.requireBranchOperationAccess.mockResolvedValueOnce(
        NextResponse.json({ error: 'لا يوجد فرع تشغيلي' }, { status: 409 }),
      );
      const { status, json } = await putAttendance(1, { notes: 'x' });
      expect(status).toBe(409);
      expect(json).toEqual({ error: 'لا يوجد فرع تشغيلي' });
    });

    it('400 when :id is not a number', async () => {
      const { status, json } = await putAttendance('abc', { notes: 'x' });
      expect(status).toBe(400);
      expect(json).toEqual({ error: 'معرف غير صالح' });
    });

    it('404 when the row ID does not exist', async () => {
      const { status, json } = await putAttendance(999, { notes: 'x' });
      expect(status).toBe(404);
      expect(json).toEqual({ error: 'غير موجود' });
      expect(harness.assertEmpBranchWorkDayMutable).not.toHaveBeenCalled();
      expect(harness.availabilityEmployeeDayChanged).not.toHaveBeenCalled();
    });

    it('closed payroll day uses row WorkDate + session BranchID', async () => {
      const row = seedSessionClosed({ WorkDate: OLD_WORK_DATE });
      harness.assertEmpBranchWorkDayMutable.mockRejectedValueOnce(
        new EmpBranchWorkDayCloseError(PAYROLL_DAY_CLOSED_CODE, PAYROLL_DAY_CLOSED_MESSAGE),
      );
      const { status, json } = await putAttendance(row.ID, { notes: 'x' });
      expect(harness.assertEmpBranchWorkDayMutable).toHaveBeenCalledWith(
        SESSION_BRANCH_ID,
        OLD_WORK_DATE,
      );
      expect(status).toBe(409);
      expect(json).toEqual({
        error: PAYROLL_DAY_CLOSED_MESSAGE,
        code: PAYROLL_DAY_CLOSED_CODE,
      });
      expect(harness.attendance[0].Notes).toBe('keep-me');
      expect(harness.availabilityEmployeeDayChanged).not.toHaveBeenCalled();
    });
  });
});
