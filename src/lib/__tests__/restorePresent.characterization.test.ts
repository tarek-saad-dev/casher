/**
 * Characterization tests for CURRENT production
 * POST /api/operations/schedule-control/restore-present.
 *
 * Freeze observable restore-present punch behavior before Phase B5.
 * Runtime Behavior Changes: NONE — tests only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));

const SESSION_BRANCH_ID = 10;
const OTHER_BRANCH_ID = 20;
const EMP_ID = 42;
const TODAY = '2026-08-24';
const FUTURE = '2026-08-30';
const PAST = '2026-08-01';
const FIXED_CHECK_IN = '12:15';
const DAY_OFF_SOURCE = 'schedule-control day_off';
const RESTORE_SOURCE = 'schedule-control restore-present';

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
          const dayOffTag = String(inputs.dayOffTag ?? '');

          const existing = attendance.find(
            (r) =>
              r.EmpID === empId &&
              r.BranchID === branchId &&
              r.WorkDate === workDate,
          );
          if (existing) {
            const prevStatus = existing.Status;
            existing.Status = status;
            if (existing.CheckInTime == null || prevStatus === 'Absent') {
              existing.CheckInTime = checkIn;
            }
            if (prevStatus === 'Absent') {
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

          // Cross-branch tagged Absent patch (same batch as production SQL)
          for (const r of attendance) {
            if (
              r.EmpID === empId &&
              r.WorkDate === workDate &&
              r.BranchID !== branchId &&
              r.Status === 'Absent' &&
              (r.Notes ?? '').startsWith(dayOffTag)
            ) {
              r.Status = status;
              if (r.CheckInTime == null) r.CheckInTime = checkIn;
              r.Notes = notes;
            }
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
    unlockScheduleForWorkOnDayOff: vi.fn(async () => ({
      dayOffOverridesCleared: 1,
      dayOffRowsCleared: 0,
      customHours: { start: '10:00', end: '22:00' },
    })),
    getBarberDayStatus: vi.fn(async () => ({
      isWorkingDay: true,
      isDayOff: false,
      isAbsent: false,
      statusReasonArabic: 'متاح',
      currentAvailabilityStatus: 'working',
      effectiveStart: '10:00',
      effectiveEnd: '22:00',
      attendance: { status: 'Present', checkInTime: FIXED_CHECK_IN },
    })),
    notifyHotEffectiveDay: vi.fn(async () => undefined),
    requirePageAccess: vi.fn(async () => ({
      ok: true,
      userId: 1,
      userName: 'Ops',
      userLevel: 'admin',
      roles: ['admin'],
      isSuperAdmin: false,
      activeBranchId: SESSION_BRANCH_ID,
      activeBranchCode: 'GLEEM',
    })),
    getCairoBusinessDate: vi.fn(() => TODAY),
    cairoDateStr: vi.fn(() => TODAY),
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

vi.mock('@/lib/api-auth', () => ({
  requirePageAccess: (...a: unknown[]) => harness.requirePageAccess(...a),
  isAuthResult: (v: unknown) =>
    !!v && typeof v === 'object' && (v as { ok?: boolean }).ok === true,
}));

vi.mock('@/lib/branch/repository', () => ({
  getBranchById: (...a: unknown[]) => harness.getBranchById(...(a as [number])),
}));

vi.mock('@/lib/businessDate', () => ({
  SALON_TZ: 'Africa/Cairo',
  getCairoBusinessDate: () => harness.getCairoBusinessDate(),
  getCairoTimeStr: () => harness.getCairoTimeStr(),
}));

vi.mock('@/lib/availabilityEngine', () => ({
  cairoDateStr: (...a: unknown[]) => harness.cairoDateStr(...a),
  cairoTimeStr: () => FIXED_CHECK_IN,
  getBarberDayStatus: (...a: unknown[]) => harness.getBarberDayStatus(...a),
}));

vi.mock('@/lib/hr/attendance/workOnDayOff.service', () => ({
  unlockScheduleForWorkOnDayOff: (...a: unknown[]) =>
    harness.unlockScheduleForWorkOnDayOff(...a),
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
  return new NextRequest(
    'http://localhost/api/operations/schedule-control/restore-present',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

async function postRestore(body: unknown) {
  const { POST } = await import(
    '@/app/api/operations/schedule-control/restore-present/route'
  );
  const res = await POST(jsonReq(body));
  const json = await res.json();
  return { status: res.status, json };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.reset();
  harness.requirePageAccess.mockResolvedValue({
    ok: true,
    userId: 1,
    userName: 'Ops',
    userLevel: 'admin',
    roles: ['admin'],
    isSuperAdmin: false,
    activeBranchId: SESSION_BRANCH_ID,
    activeBranchCode: 'GLEEM',
  });
  harness.getCairoBusinessDate.mockReturnValue(TODAY);
  harness.cairoDateStr.mockReturnValue(TODAY);
  harness.getCairoTimeStr.mockReturnValue(FIXED_CHECK_IN);
  harness.unlockScheduleForWorkOnDayOff.mockResolvedValue({
    dayOffOverridesCleared: 1,
    dayOffRowsCleared: 0,
    customHours: { start: '10:00', end: '22:00' },
  });
  harness.getBarberDayStatus.mockResolvedValue({
    isWorkingDay: true,
    isDayOff: false,
    isAbsent: false,
    statusReasonArabic: 'متاح',
    currentAvailabilityStatus: 'working',
    effectiveStart: '10:00',
    effectiveEnd: '22:00',
    attendance: { status: 'Present', checkInTime: FIXED_CHECK_IN },
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

describe('POST /api/operations/schedule-control/restore-present — characterization', () => {
  describe('auth / branch', () => {
    it('returns auth failure when page access denied', async () => {
      harness.requirePageAccess.mockResolvedValueOnce(
        NextResponse.json({ error: 'غير مصرح' }, { status: 401 }),
      );
      const { status, json } = await postRestore({ empId: EMP_ID, date: TODAY });
      expect(status).toBe(401);
      expect(json.error).toBe('غير مصرح');
      expect(harness.unlockScheduleForWorkOnDayOff).not.toHaveBeenCalled();
    });

    it('uses auth.activeBranchId as write BranchID', async () => {
      const { status, json } = await postRestore({ empId: EMP_ID, date: TODAY });
      expect(status).toBe(200);
      expect(json.branchId).toBe(SESSION_BRANCH_ID);
      expect(harness.unlockScheduleForWorkOnDayOff).toHaveBeenCalledWith(
        expect.objectContaining({
          empId: EMP_ID,
          date: TODAY,
          branchId: SESSION_BRANCH_ID,
          sourceTag: RESTORE_SOURCE,
        }),
      );
      expect(harness.attendance[0].BranchID).toBe(SESSION_BRANCH_ID);
    });

    it('returns 403 when branch inactive', async () => {
      harness.getBranchById.mockResolvedValueOnce(null);
      const { status, json } = await postRestore({ empId: EMP_ID, date: TODAY });
      expect(status).toBe(403);
      expect(json).toEqual({ ok: false, error: 'الفرع غير نشط' });
    });
  });

  describe('WorkDate / today gate', () => {
    it('rejects past dates', async () => {
      const { status, json } = await postRestore({ empId: EMP_ID, date: PAST });
      expect(status).toBe(400);
      expect(json).toEqual({
        ok: false,
        error: 'تشغيل يوم الإجازة متاح لليوم أو تاريخ مستقبلي فقط',
      });
      expect(harness.unlockScheduleForWorkOnDayOff).not.toHaveBeenCalled();
    });

    it('rejects invalid empId / date', async () => {
      expect((await postRestore({ empId: -1, date: TODAY })).json).toEqual({
        ok: false,
        error: 'empId غير صالح',
      });
      expect((await postRestore({ empId: EMP_ID, date: 'bad' })).json).toEqual({
        ok: false,
        error: 'date غير صالح',
      });
    });

    it('future date: unlock only — no attendance write', async () => {
      const { status, json } = await postRestore({
        empId: EMP_ID,
        date: FUTURE,
      });
      expect(status).toBe(200);
      expect(json).toMatchObject({
        ok: true,
        attendanceRecorded: false,
        checkInTime: null,
        message: 'تم تشغيل هذا اليوم للحجز — تسجيل الحضور يتم يوم العمل نفسه',
      });
      expect(harness.attendance).toHaveLength(0);
      expect(harness.unlockScheduleForWorkOnDayOff).toHaveBeenCalledTimes(1);
    });

    it('today: unlock + Present check-in', async () => {
      const { status, json } = await postRestore({
        empId: EMP_ID,
        date: TODAY,
        reason: 'رجع يشتغل',
      });
      expect(status).toBe(200);
      expect(json).toMatchObject({
        ok: true,
        attendanceRecorded: true,
        checkInTime: FIXED_CHECK_IN,
        message: 'تم إلغاء الغياب وتسجيل الحضور',
        dayOffOverridesCleared: 1,
        customHours: { start: '10:00', end: '22:00' },
      });
      expect(harness.attendance[0]).toMatchObject({
        Status: 'Present',
        CheckInTime: FIXED_CHECK_IN,
        CheckOutTime: null,
        Notes: `${RESTORE_SOURCE}: رجع يشتغل`,
      });
    });
  });

  describe('attendance upsert + tagged Absent', () => {
    it('updates same-branch Absent: Present + CheckIn + clear CheckOut', async () => {
      harness.seed({
        BranchID: SESSION_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: TODAY,
        CheckInTime: null,
        CheckOutTime: null,
        Status: 'Absent',
        Notes: 'x',
      });
      await postRestore({ empId: EMP_ID, date: TODAY });
      expect(harness.attendance[0]).toMatchObject({
        Status: 'Present',
        CheckInTime: FIXED_CHECK_IN,
        CheckOutTime: null,
      });
    });

    it('patches OTHER-branch tagged schedule-control day_off Absent', async () => {
      harness.seed({
        BranchID: OTHER_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: TODAY,
        CheckInTime: null,
        CheckOutTime: null,
        Status: 'Absent',
        Notes: `${DAY_OFF_SOURCE}: weekly`,
      });
      await postRestore({ empId: EMP_ID, date: TODAY });
      const other = harness.attendance.find((r) => r.BranchID === OTHER_BRANCH_ID)!;
      expect(other.Status).toBe('Present');
      expect(other.CheckInTime).toBe(FIXED_CHECK_IN);
      expect(other.Notes).toContain(RESTORE_SOURCE);
      // Also inserted/updated session branch
      expect(
        harness.attendance.some((r) => r.BranchID === SESSION_BRANCH_ID),
      ).toBe(true);
    });

    it('does NOT patch other-branch Absent without schedule-control day_off tag', async () => {
      harness.seed({
        BranchID: OTHER_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: TODAY,
        CheckInTime: null,
        CheckOutTime: null,
        Status: 'Absent',
        Notes: 'manual absent',
      });
      await postRestore({ empId: EMP_ID, date: TODAY });
      const other = harness.attendance.find((r) => r.BranchID === OTHER_BRANCH_ID)!;
      expect(other.Status).toBe('Absent');
      expect(other.Notes).toBe('manual absent');
    });
  });

  describe('OPEN / active-session WorkDate policy', () => {
    it('today punch queries active-session OPEN inventory', async () => {
      await postRestore({ empId: EMP_ID, date: TODAY });
      expect(
        harness.capturedQueries.some(
          (q) =>
            /CheckOutTime IS NULL/i.test(q.sql) &&
            /EmpID = @empId/i.test(q.sql) &&
            !/BranchID\s*<>/i.test(q.sql),
        ),
      ).toBe(true);
    });

    it('same WorkDate other-branch OPEN → 409 when isToday punch', async () => {
      harness.seed({
        BranchID: OTHER_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: TODAY,
        CheckInTime: '09:00',
        CheckOutTime: null,
        Status: 'Present',
        Notes: null,
      });
      const { status, json } = await postRestore({ empId: EMP_ID, date: TODAY });
      expect(status).toBe(409);
      expect(json).toMatchObject({
        ok: false,
        error: 'الموظف لديه حضور مفتوح في فرع آخر — سجّل الانصراف أولاً',
      });
      expect(
        harness.attendance.filter((r) => r.BranchID === SESSION_BRANCH_ID),
      ).toHaveLength(0);
    });

    it('future-date unlock-only skips OPEN policy (no punch)', async () => {
      harness.seed({
        BranchID: OTHER_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: FUTURE,
        CheckInTime: '09:00',
        CheckOutTime: null,
        Status: 'Present',
        Notes: null,
      });
      const { status, json } = await postRestore({
        empId: EMP_ID,
        date: FUTURE,
      });
      expect(status).toBe(200);
      expect(json.attendanceRecorded).toBe(false);
      expect(
        harness.capturedQueries.some((q) => /CheckOutTime IS NULL/i.test(q.sql)),
      ).toBe(false);
      expect(harness.attendance.filter((r) => r.BranchID === SESSION_BRANCH_ID)).toHaveLength(
        0,
      );
    });
  });

  describe('side effects', () => {
    it('returns barberStatus from getBarberDayStatus', async () => {
      const { json } = await postRestore({ empId: EMP_ID, date: TODAY });
      expect(harness.getBarberDayStatus).toHaveBeenCalledWith(EMP_ID, TODAY, {
        isToday: true,
        branchId: SESSION_BRANCH_ID,
      });
      expect(json.barberStatus).toMatchObject({
        empId: EMP_ID,
        isWorkingDay: true,
        isAbsent: false,
      });
    });

    it('invalidates hot cache after success', async () => {
      await postRestore({ empId: EMP_ID, date: TODAY });
      await vi.waitFor(() => {
        expect(harness.notifyHotEffectiveDay).toHaveBeenCalledWith(
          expect.objectContaining({
            employeeId: EMP_ID,
            businessDate: TODAY,
            branchId: SESSION_BRANCH_ID,
            reason: 'schedule_control_restore_present',
          }),
        );
      });
    });

    it('maps unexpected errors to fixed Arabic 500', async () => {
      harness.unlockScheduleForWorkOnDayOff.mockRejectedValueOnce(
        new Error('boom'),
      );
      const { status, json } = await postRestore({ empId: EMP_ID, date: TODAY });
      expect(status).toBe(500);
      expect(json).toEqual({
        ok: false,
        error: 'فشل إلغاء الغياب وتشغيل اليوم',
      });
    });
  });
});
