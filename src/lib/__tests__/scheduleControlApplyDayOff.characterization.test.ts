/**
 * Characterization: schedule-control APPLY day_off → TblEmpAttendance mutation.
 * Freeze before Phase B6. Runtime Behavior Changes: NONE — tests only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const SESSION_BRANCH_ID = 10;
const OTHER_BRANCH_ID = 20;
const EMP_ID = 42;
const WORK_DATE = '2026-08-24';
const FUTURE = '2026-08-30';

type AttRow = {
  ID: number;
  BranchID: number;
  EmpID: number;
  WorkDate: string;
  CheckInTime: string | null;
  CheckOutTime: string | null;
  Status: string | null;
  Notes: string | null;
};

const harness = vi.hoisted(() => {
  const attendance: AttRow[] = [];
  let nextId = 1;
  const capturedQueries: { sql: string; inputs: Record<string, unknown> }[] = [];
  let attendanceWriteShouldFail = false;

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

        if (/IF EXISTS/i.test(sql) && /TblEmpAttendance/i.test(sql) && /Status = 'Absent'/i.test(sql)) {
          if (attendanceWriteShouldFail) {
            throw new Error('simulated attendance write failure');
          }
          const empId = Number(inputs.empId);
          const branchId = Number(inputs.branchId);
          const workDate = ymd(inputs.workDate);
          const notes = inputs.notes == null ? null : String(inputs.notes);
          const existing = attendance.find(
            (r) =>
              r.EmpID === empId &&
              r.BranchID === branchId &&
              r.WorkDate === workDate,
          );
          if (existing) {
            existing.Status = 'Absent';
            existing.Notes = notes;
            existing.CheckInTime = null;
            existing.CheckOutTime = null;
          } else {
            attendance.push({
              ID: nextId++,
              BranchID: branchId,
              EmpID: empId,
              WorkDate: workDate,
              CheckInTime: null,
              CheckOutTime: null,
              Status: 'Absent',
              Notes: notes,
            });
          }
          return { recordset: [], rowsAffected: [1] };
        }

        if (/INSERT INTO dbo\.TblEmpScheduleOverrides/i.test(sql)) {
          return { recordset: [{ OverrideID: 501 }], rowsAffected: [1] };
        }

        if (/UPDATE dbo\.TblEmpScheduleOverrides/i.test(sql)) {
          return { recordset: [], rowsAffected: [0] };
        }

        return { recordset: [], rowsAffected: [1] };
      },
    };
  }

  return {
    attendance,
    capturedQueries,
    requireBranchOperationAccess: vi.fn(async () => ({
      ok: true,
      branchId: SESSION_BRANCH_ID,
      branchCode: 'GLEEM',
      branchName: 'Gleem',
    })),
    ensureOverridesTable: vi.fn(async () => undefined),
    getScheduleOverrides: vi.fn(async () => []),
    computePreview: vi.fn(async () => ({
      safe: true,
      oldEffectiveStart: '10:00',
      oldEffectiveEnd: '22:00',
      newEffectiveStart: null,
      newEffectiveEnd: null,
      affectedBookings: [],
      affectedQueueTickets: [],
      warnings: [],
    })),
    getBarberDayStatus: vi.fn(async () => ({
      dateStr: WORK_DATE,
      isWorkingDay: false,
      isDayOff: true,
      isAbsent: true,
      isLateStart: false,
      isEarlyLeave: false,
      isCustomHours: false,
      effectiveStart: null,
      effectiveEnd: null,
      statusReasonArabic: 'غائب',
      currentAvailabilityStatus: 'absent',
      appliedOverride: null,
      attendance: { status: 'Absent' },
    })),
    syncBreakFromBlockRange: vi.fn(async () => ({ attendanceId: 1, added: true })),
    notifyHotEffectiveDay: vi.fn(async () => undefined),
    cairoDateStr: vi.fn(() => WORK_DATE),
    setAttendanceWriteShouldFail(v: boolean) {
      attendanceWriteShouldFail = v;
    },
    reset() {
      attendance.length = 0;
      capturedQueries.length = 0;
      nextId = 1;
      attendanceWriteShouldFail = false;
    },
    seed(row: Omit<AttRow, 'ID'> & { ID?: number }) {
      const full = { ID: row.ID ?? nextId++, ...row };
      if (row.ID != null && row.ID >= nextId) nextId = row.ID + 1;
      attendance.push(full);
      return full;
    },
    makeRequest,
  };
});

vi.mock('@/lib/branch', () => ({
  isActiveBranchContext: vi.fn((b: unknown) => !!b && typeof b === 'object'),
  requireBranchOperationAccess: (...a: unknown[]) =>
    harness.requireBranchOperationAccess(...a),
}));

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => ({ request: () => harness.makeRequest() })),
  sql: {
    Int: 'Int',
    Date: 'Date',
    NVarChar: (n: number) => `NVarChar(${n})`,
  },
}));

vi.mock('@/lib/scheduleOverrides', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/scheduleOverrides')>();
  return {
    ...actual,
    ensureOverridesTable: (...a: unknown[]) => harness.ensureOverridesTable(...a),
  };
});

vi.mock('@/lib/availabilityEngine', () => ({
  cairoDateStr: (...a: unknown[]) => harness.cairoDateStr(...a),
  getBarberDayStatus: (...a: unknown[]) => harness.getBarberDayStatus(...a),
  getScheduleOverrides: (...a: unknown[]) => harness.getScheduleOverrides(...a),
}));

vi.mock('@/lib/scheduleControlPreview', () => ({
  computePreview: (...a: unknown[]) => harness.computePreview(...a),
}));

vi.mock('@/lib/hr/attendance-break-schedule-sync', () => ({
  syncBreakFromBlockRange: (...a: unknown[]) =>
    harness.syncBreakFromBlockRange(...a),
}));

vi.mock('@/lib/booking/cache/hotCacheInvalidateBestEffort', () => ({
  notifyHotEffectiveDay: (...a: unknown[]) => harness.notifyHotEffectiveDay(...a),
}));

vi.mock('@/lib/businessDate', () => ({
  SALON_TZ: 'Africa/Cairo',
  getCairoBusinessDate: () => WORK_DATE,
  getCairoTimeStr: () => '12:00',
}));

function jsonReq(body: unknown) {
  return new NextRequest('http://localhost/api/operations/schedule-control/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postApply(body: unknown) {
  const { POST } = await import(
    '@/app/api/operations/schedule-control/apply/route'
  );
  const res = await POST(jsonReq(body));
  const json = await res.json();
  return { status: res.status, json };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.reset();
  harness.requireBranchOperationAccess.mockResolvedValue({
    ok: true,
    branchId: SESSION_BRANCH_ID,
    branchCode: 'GLEEM',
    branchName: 'Gleem',
  });
  harness.computePreview.mockResolvedValue({
    safe: true,
    oldEffectiveStart: '10:00',
    oldEffectiveEnd: '22:00',
    newEffectiveStart: null,
    newEffectiveEnd: null,
    affectedBookings: [],
    affectedQueueTickets: [],
    warnings: [],
  });
  harness.getScheduleOverrides.mockResolvedValue([]);
  harness.cairoDateStr.mockReturnValue(WORK_DATE);
});

describe('POST schedule-control/apply day_off — attendance characterization', () => {
  it('inserts Absent on session branch with tagged Notes; clears punches on update', async () => {
    const { status, json } = await postApply({
      empId: EMP_ID,
      date: WORK_DATE,
      type: 'day_off',
      reason: 'إجازة',
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(harness.attendance).toHaveLength(1);
    expect(harness.attendance[0]).toMatchObject({
      BranchID: SESSION_BRANCH_ID,
      EmpID: EMP_ID,
      WorkDate: WORK_DATE,
      Status: 'Absent',
      CheckInTime: null,
      CheckOutTime: null,
      Notes: 'schedule-control day_off: إجازة',
    });
  });

  it('updates existing punched row: Status Absent + clears CheckIn/CheckOut', async () => {
    harness.seed({
      BranchID: SESSION_BRANCH_ID,
      EmpID: EMP_ID,
      WorkDate: WORK_DATE,
      CheckInTime: '10:00',
      CheckOutTime: '18:00',
      Status: 'Present',
      Notes: 'was present',
    });
    await postApply({ empId: EMP_ID, date: WORK_DATE, type: 'day_off' });
    expect(harness.attendance).toHaveLength(1);
    expect(harness.attendance[0]).toMatchObject({
      Status: 'Absent',
      CheckInTime: null,
      CheckOutTime: null,
      Notes: 'schedule-control day_off',
    });
  });

  it('applies to future WorkDate (not only today)', async () => {
    await postApply({ empId: EMP_ID, date: FUTURE, type: 'day_off' });
    expect(harness.attendance[0].WorkDate).toBe(FUTURE);
  });

  it('does not touch other-branch attendance rows', async () => {
    harness.seed({
      BranchID: OTHER_BRANCH_ID,
      EmpID: EMP_ID,
      WorkDate: WORK_DATE,
      CheckInTime: '09:00',
      CheckOutTime: null,
      Status: 'Present',
      Notes: null,
    });
    await postApply({ empId: EMP_ID, date: WORK_DATE, type: 'day_off' });
    expect(harness.attendance).toHaveLength(2);
    expect(
      harness.attendance.find((r) => r.BranchID === OTHER_BRANCH_ID),
    ).toMatchObject({ Status: 'Present', CheckInTime: '09:00' });
  });

  it('non-day_off types do not write attendance', async () => {
    await postApply({
      empId: EMP_ID,
      date: WORK_DATE,
      type: 'late_start',
      startTime: '11:00',
    });
    expect(harness.attendance).toHaveLength(0);
  });

  it('attendance write failure is swallowed — override still succeeds (best-effort)', async () => {
    harness.setAttendanceWriteShouldFail(true);
    const { status, json } = await postApply({
      empId: EMP_ID,
      date: WORK_DATE,
      type: 'day_off',
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.overrideId).toBe(501);
    expect(harness.attendance).toHaveLength(0);
  });

  it('does not run OPEN / dual-open checks', async () => {
    await postApply({ empId: EMP_ID, date: WORK_DATE, type: 'day_off' });
    expect(
      harness.capturedQueries.some(
        (q) => /CheckOutTime IS NULL/i.test(q.sql) && /BranchID\s*<>/i.test(q.sql),
      ),
    ).toBe(false);
  });
});
