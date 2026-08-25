/**
 * Characterization tests for CURRENT production POST /api/admin/attendance/work-on-day-off.
 *
 * Freeze observable punch-on-day-off behavior before Phase B5.
 * Active-session WorkDate policy: same-date other-branch OPEN → 409.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const SESSION_BRANCH_ID = 10;
const OTHER_BRANCH_ID = 20;
const EMP_ID = 42;
const WORK_DATE = '2026-08-24';
const CAIRO_TODAY = '2026-08-24';
const FIXED_CHECK_IN = '11:30';
const ALREADY_OPEN_MESSAGE =
  'الموظف لديه حضور مفتوح في فرع آخر — سجّل الانصراف أولاً';

type AttRow = {
  ID: number;
  BranchID: number;
  EmpID: number;
  WorkDate: string;
  CheckInTime: string | null;
  CheckOutTime: string | null;
  Status: string;
  Notes: string | null;
};

const harness = vi.hoisted(() => {
  const attendance: AttRow[] = [];
  let nextId = 1;
  const capturedQueries: { sql: string; inputs: Record<string, unknown> }[] = [];

  function ymd(v: unknown): string {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).slice(0, 10);
  }

  function hhmm(v: unknown): string | null {
    if (v == null) return null;
    if (v instanceof Date) {
      return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
    }
    const s = String(v);
    return s.length >= 5 ? s.slice(0, 5) : s;
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

        if (/sp_getapplock/i.test(sql)) {
          return { recordset: [{ lockResult: 0 }], rowsAffected: [1] };
        }

        // Active-session inventory: all OPEN for EmpID
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
          !/UPDATE/i.test(sql) &&
          !/IF EXISTS/i.test(sql)
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

        if (/IF EXISTS/i.test(sql) && /TblEmpAttendance/i.test(sql)) {
          const empId = Number(inputs.empId);
          const branchId = Number(inputs.branchId);
          const workDate = ymd(inputs.workDate);
          const checkIn = hhmm(inputs.checkIn);
          const status = String(inputs.status);
          const notes = inputs.notes == null ? null : String(inputs.notes);
          const existing = attendance.find(
            (r) =>
              r.EmpID === empId &&
              r.BranchID === branchId &&
              r.WorkDate === workDate,
          );
          if (existing) {
            const prevStatus = existing.Status;
            existing.Status = status;
            if (
              existing.CheckInTime == null ||
              ['Absent', 'DayOff', 'Pending'].includes(prevStatus)
            ) {
              existing.CheckInTime = checkIn;
            }
            if (['Absent', 'DayOff'].includes(prevStatus)) {
              existing.CheckOutTime = null;
            }
            existing.Notes = notes;
          } else {
            attendance.push({
              ID: nextId++,
              BranchID: branchId,
              EmpID: empId,
              WorkDate: workDate,
              CheckInTime: checkIn,
              CheckOutTime: null,
              Status: status,
              Notes: notes,
            });
          }
          return { recordset: [], rowsAffected: [1] };
        }

        return { recordset: [], rowsAffected: [1] };
      },
    };
  }

  return {
    attendance,
    capturedQueries,
    notifyHotEffectiveDay: vi.fn(async () => undefined),
    unlockScheduleForWorkOnDayOff: vi.fn(async (args: {
      empId: number;
      date: string;
      branchId: number;
      reason?: string | null;
      sourceTag?: string;
    }) => {
      void import('@/lib/booking/cache/hotCacheInvalidateBestEffort')
        .then((m) =>
          m.notifyHotEffectiveDay({
            employeeId: args.empId,
            businessDate: args.date,
            branchId: args.branchId,
            reason: 'work_on_day_off_unlock',
          }),
        )
        .catch(() => undefined);
      return {
        dayOffOverridesCleared: 1,
        dayOffRowsCleared: 0,
        customHours: { start: '10:00', end: '22:00' },
      };
    }),
    getSession: vi.fn(async () => ({
      UserID: 1,
      UserName: 'Admin',
      UserLevel: 1,
    })),
    requireBranchOperationAccess: vi.fn(async () => ({
      ok: true,
      branchId: SESSION_BRANCH_ID,
      branchCode: 'GLEEM',
      branchName: 'Gleem',
    })),
    getCairoBusinessDate: vi.fn(() => CAIRO_TODAY),
    getCairoTimeStr: vi.fn(() => FIXED_CHECK_IN),
    getBranchById: vi.fn(async (id: number) =>
      id === SESSION_BRANCH_ID
        ? {
            branchId: SESSION_BRANCH_ID,
            isActive: true,
            defaultOpenTime: '10:00',
            defaultCloseTime: '22:00',
          }
        : null,
    ),
    reset() {
      attendance.length = 0;
      capturedQueries.length = 0;
      nextId = 1;
    },
    seed(row: Omit<AttRow, 'ID'> & { ID?: number }) {
      const full: AttRow = { ID: row.ID ?? nextId++, ...row };
      if (row.ID != null && row.ID >= nextId) nextId = row.ID + 1;
      attendance.push(full);
      return full;
    },
    makeRequest,
  };
});

vi.mock('@/lib/session', () => ({
  getSession: (...a: unknown[]) => harness.getSession(...a),
}));

vi.mock('@/lib/branch', () => ({
  isActiveBranchContext: vi.fn((b: unknown) => !!b && typeof b === 'object'),
  requireBranchOperationAccess: (...a: unknown[]) =>
    harness.requireBranchOperationAccess(...a),
}));

vi.mock('@/lib/businessDate', () => ({
  SALON_TZ: 'Africa/Cairo',
  getCairoBusinessDate: () => harness.getCairoBusinessDate(),
  getCairoTimeStr: () => harness.getCairoTimeStr(),
}));

vi.mock('@/lib/availabilityEngine', () => ({
  cairoTimeStr: () => FIXED_CHECK_IN,
}));

vi.mock('@/lib/branch/repository', () => ({
  getBranchById: (...a: unknown[]) => harness.getBranchById(...(a as [number])),
}));

vi.mock('@/lib/hr/attendance/workOnDayOff.service', () => ({
  unlockScheduleForWorkOnDayOff: (...a: unknown[]) =>
    harness.unlockScheduleForWorkOnDayOff(...(a as [never])),
  executeWorkOnDayOff: vi.fn(),
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
      const req = harness.makeRequest();
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
    getPool: vi.fn(async () => ({ request: () => harness.makeRequest() })),
    sql: {
      Int: 'Int',
      Date: 'Date',
      VarChar: (n: number) => `VarChar(${n})`,
      NVarChar: (n: number) => `NVarChar(${n})`,
      Request: MockRequest,
      Transaction: MockTransaction,
    },
  };
});

vi.mock('@/lib/booking/cache/hotCacheInvalidateBestEffort', () => ({
  notifyHotEffectiveDay: (...a: unknown[]) => harness.notifyHotEffectiveDay(...a),
}));

function jsonReq(body: unknown) {
  return new NextRequest('http://localhost/api/admin/attendance/work-on-day-off', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postWorkOnDayOff(body: unknown) {
  const { POST } = await import('@/app/api/admin/attendance/work-on-day-off/route');
  const res = await POST(jsonReq(body));
  const json = await res.json();
  return { status: res.status, json };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.reset();
  harness.getSession.mockResolvedValue({
    UserID: 1,
    UserName: 'Admin',
    UserLevel: 1,
  });
  harness.requireBranchOperationAccess.mockResolvedValue({
    ok: true,
    branchId: SESSION_BRANCH_ID,
    branchCode: 'GLEEM',
    branchName: 'Gleem',
  });
  harness.getCairoBusinessDate.mockReturnValue(CAIRO_TODAY);
  harness.getCairoTimeStr.mockReturnValue(FIXED_CHECK_IN);
  harness.unlockScheduleForWorkOnDayOff.mockImplementation(async (args: {
    empId: number;
    date: string;
    branchId: number;
    reason?: string | null;
    sourceTag?: string;
  }) => {
    void import('@/lib/booking/cache/hotCacheInvalidateBestEffort')
      .then((m) =>
        m.notifyHotEffectiveDay({
          employeeId: args.empId,
          businessDate: args.date,
          branchId: args.branchId,
          reason: 'work_on_day_off_unlock',
        }),
      )
      .catch(() => undefined);
    return {
      dayOffOverridesCleared: 1,
      dayOffRowsCleared: 0,
      customHours: { start: '10:00', end: '22:00' },
    };
  });
  harness.getBranchById.mockImplementation(async (id: number) =>
    id === SESSION_BRANCH_ID
      ? {
          branchId: SESSION_BRANCH_ID,
          isActive: true,
          defaultOpenTime: '10:00',
          defaultCloseTime: '22:00',
        }
      : null,
  );
});

describe('POST /api/admin/attendance/work-on-day-off — characterization', () => {
  describe('auth / branch', () => {
    it('returns 401 when unauthenticated', async () => {
      harness.getSession.mockResolvedValueOnce(null);
      const { status, json } = await postWorkOnDayOff({ empId: EMP_ID });
      expect(status).toBe(401);
      expect(json).toEqual({ error: 'غير مصرح' });
      expect(harness.attendance).toHaveLength(0);
    });

    it('writes session BranchID (never body BranchID)', async () => {
      const { status, json } = await postWorkOnDayOff({
        empId: EMP_ID,
        date: WORK_DATE,
        BranchID: 99,
      });
      expect(status).toBe(200);
      expect(json.branchId).toBe(SESSION_BRANCH_ID);
      expect(harness.attendance[0].BranchID).toBe(SESSION_BRANCH_ID);
    });
  });

  describe('WorkDate source', () => {
    it('defaults date to getCairoBusinessDate when omitted', async () => {
      harness.getCairoBusinessDate.mockReturnValue('2026-09-01');
      const { status, json } = await postWorkOnDayOff({ empId: EMP_ID });
      expect(status).toBe(200);
      expect(harness.attendance[0].WorkDate).toBe('2026-09-01');
      expect(json.checkInTime).toBe(FIXED_CHECK_IN);
    });

    it('uses body.date when provided (YYYY-MM-DD)', async () => {
      const { status } = await postWorkOnDayOff({
        empId: EMP_ID,
        date: '2026-08-20',
      });
      expect(status).toBe(200);
      expect(harness.attendance[0].WorkDate).toBe('2026-08-20');
    });

    it('rejects invalid date format', async () => {
      const { status, json } = await postWorkOnDayOff({
        empId: EMP_ID,
        date: '24-08-2026',
      });
      expect(status).toBe(400);
      expect(json).toEqual({ error: 'date غير صالح' });
    });

    it('rejects invalid empId', async () => {
      const { status, json } = await postWorkOnDayOff({ empId: 0 });
      expect(status).toBe(400);
      expect(json).toEqual({ error: 'empId غير صالح' });
    });
  });

  describe('schedule unlock + Present punch', () => {
    it('unlocks schedule and inserts Present + CheckIn', async () => {
      const { status, json } = await postWorkOnDayOff({
        empId: EMP_ID,
        date: WORK_DATE,
        reason: 'نزل يشتغل',
      });
      expect(status).toBe(200);
      expect(json).toMatchObject({
        success: true,
        ok: true,
        message: 'تم تسجيل حضور الموظف في يوم إجازته',
        checkInTime: FIXED_CHECK_IN,
        branchId: SESSION_BRANCH_ID,
        customHours: { start: '10:00', end: '22:00' },
      });
      expect(harness.attendance).toHaveLength(1);
      expect(harness.attendance[0]).toMatchObject({
        BranchID: SESSION_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: FIXED_CHECK_IN,
        CheckOutTime: null,
        Status: 'Present',
      });
      expect(harness.attendance[0].Notes).toContain('work-on-day-off:');
      expect(harness.unlockScheduleForWorkOnDayOff).toHaveBeenCalledWith(
        expect.objectContaining({
          empId: EMP_ID,
          date: WORK_DATE,
          branchId: SESSION_BRANCH_ID,
          sourceTag: 'work-on-day-off',
        }),
      );
    });

    it('ignores body.checkInTime and uses Cairo clock', async () => {
      await postWorkOnDayOff({
        empId: EMP_ID,
        date: WORK_DATE,
        checkInTime: '08:00',
      });
      expect(harness.attendance[0].CheckInTime).toBe(FIXED_CHECK_IN);
    });

    it('updates Absent same-branch row: sets Present, fills CheckIn, clears CheckOut', async () => {
      harness.seed({
        BranchID: SESSION_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: null,
        CheckOutTime: null,
        Status: 'Absent',
        Notes: 'was absent',
      });
      await postWorkOnDayOff({ empId: EMP_ID, date: WORK_DATE });
      expect(harness.attendance).toHaveLength(1);
      expect(harness.attendance[0]).toMatchObject({
        Status: 'Present',
        CheckInTime: FIXED_CHECK_IN,
        CheckOutTime: null,
      });
    });

    it('keeps existing CheckIn when status is already Present', async () => {
      harness.seed({
        BranchID: SESSION_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '09:00',
        CheckOutTime: '18:00',
        Status: 'Present',
        Notes: null,
      });
      await postWorkOnDayOff({ empId: EMP_ID, date: WORK_DATE });
      expect(harness.attendance[0].CheckInTime).toBe('09:00');
      expect(harness.attendance[0].CheckOutTime).toBe('18:00');
      expect(harness.attendance[0].Status).toBe('Present');
    });
  });

  describe('OPEN / active-session WorkDate policy', () => {
    it('queries active-session OPEN inventory (not legacy BranchID <>)', async () => {
      await postWorkOnDayOff({ empId: EMP_ID, date: WORK_DATE });
      expect(
        harness.capturedQueries.some(
          (q) =>
            /CheckOutTime IS NULL/i.test(q.sql) &&
            /EmpID = @empId/i.test(q.sql) &&
            !/BranchID\s*<>/i.test(q.sql),
        ),
      ).toBe(true);
    });

    it('same WorkDate other-branch OPEN → 409 ALREADY_OPEN', async () => {
      harness.seed({
        BranchID: OTHER_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '09:00',
        CheckOutTime: null,
        Status: 'Present',
        Notes: null,
      });
      const { status, json } = await postWorkOnDayOff({
        empId: EMP_ID,
        date: WORK_DATE,
      });
      expect(status).toBe(409);
      expect(json).toMatchObject({
        error: ALREADY_OPEN_MESSAGE,
        code: 'ALREADY_OPEN',
      });
      expect(
        harness.attendance.filter((r) => r.BranchID === SESSION_BRANCH_ID),
      ).toHaveLength(0);
    });
  });

  describe('eligibility / side effects', () => {
    it('does not call eligibility or payroll gate (no such SQL)', async () => {
      await postWorkOnDayOff({ empId: EMP_ID, date: WORK_DATE });
      expect(
        harness.capturedQueries.some((q) =>
          /assertEmployeeEligible|EmpBranchWorkDay/i.test(q.sql),
        ),
      ).toBe(false);
    });

    it('schedules hot-cache invalidate after unlock (best-effort)', async () => {
      await postWorkOnDayOff({ empId: EMP_ID, date: WORK_DATE });
      await vi.waitFor(() => {
        expect(harness.notifyHotEffectiveDay).toHaveBeenCalledWith(
          expect.objectContaining({
            employeeId: EMP_ID,
            businessDate: WORK_DATE,
            branchId: SESSION_BRANCH_ID,
            reason: 'work_on_day_off_unlock',
          }),
        );
      });
    });
  });
});
