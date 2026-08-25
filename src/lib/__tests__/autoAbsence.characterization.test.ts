/**
 * Characterization: runAutoAbsenceScan attendance mutation + scan rules.
 * Freeze before final attendance-writer centralization.
 *
 * POLICY CUTOVER: AutoAbsence is BranchID + EmpID + WorkDate scoped.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const BRANCH_ID = 10;
const OTHER_BRANCH_ID = 20;
const EMP_ID = 42;
const WORK_DATE = '2026-08-24';

type AttRow = {
  ID: number;
  BranchID: number;
  EmpID: number;
  WorkDate: string;
  Status: string | null;
  Notes: string | null;
  CheckInTime: string | null;
  CheckOutTime: string | null;
};

const harness = vi.hoisted(() => {
  const attendance: AttRow[] = [];
  let nextId = 1;
  const capturedQueries: { sql: string; inputs: Record<string, unknown> }[] = [];
  const markBookingsCalls: unknown[] = [];
  let lockResult = 0;
  let resolvePlan: () => Promise<{
    isWorking: boolean;
    denyReasonCode?: string;
    effectiveWindows?: Array<{ startMs: number }>;
  }> = async () => ({
    isWorking: true,
    effectiveWindows: [{ startMs: Date.now() - 60 * 60_000 }],
  });

  function ymd(v: unknown): string {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).slice(0, 10);
  }

  function applyAutoAbsenceMutation(inputs: Record<string, unknown>) {
    const empId = Number(inputs.empId);
    const branchId = Number(inputs.branchId);
    const workDate = ymd(inputs.date);
    // Branch-scoped: EmpID + WorkDate + BranchID
    const existing = attendance.filter(
      (r) =>
        r.EmpID === empId && r.WorkDate === workDate && r.BranchID === branchId,
    );
    if (existing.length === 0) {
      attendance.push({
        ID: nextId++,
        BranchID: branchId,
        EmpID: empId,
        WorkDate: workDate,
        Status: 'Absent',
        Notes: 'AUTO_ABSENCE after scheduled start + threshold',
        CheckInTime: null,
        CheckOutTime: null,
      });
      return;
    }
    for (const row of existing) {
      if (!['Present', 'Late', 'EarlyLeave'].includes(String(row.Status))) {
        row.Status = 'Absent';
        row.Notes = `${row.Notes ?? ''} | AUTO_ABSENCE`.slice(0, 250);
      }
    }
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
          return { recordset: [{ LockResult: lockResult }], rowsAffected: [1] };
        }

        if (/FROM dbo\.TblBranch/i.test(sql) && /AutoAbsenceMinutes/i.test(sql)) {
          return {
            recordset: [{ BranchID: BRANCH_ID, AutoAbsenceMinutes: 30 }],
            rowsAffected: [1],
          };
        }

        if (
          /COL_LENGTH\(N'dbo\.QueueBookingSettings'/i.test(sql) ||
          /ALTER TABLE dbo\.QueueBookingSettings/i.test(sql)
        ) {
          return { recordset: [], rowsAffected: [0] };
        }

        if (
          /FROM dbo\.TblEmp e/i.test(sql) &&
          /EmploymentType/i.test(sql) &&
          /NOT EXISTS/i.test(sql) &&
          /TblEmpAttendance/i.test(sql)
        ) {
          const empIdFilter = inputs.empId == null ? null : Number(inputs.empId);
          const branchId = Number(inputs.branchId ?? BRANCH_ID);
          const workDate = ymd(inputs.date ?? WORK_DATE);
          const hasBlocking = attendance.some(
            (r) =>
              r.EmpID === (empIdFilter ?? EMP_ID) &&
              r.WorkDate === workDate &&
              r.BranchID === branchId &&
              ['Present', 'Late', 'EarlyLeave', 'Absent'].includes(String(r.Status)),
          );
          if (hasBlocking) {
            return { recordset: [], rowsAffected: [0] };
          }
          if (empIdFilter != null && empIdFilter !== EMP_ID) {
            return { recordset: [], rowsAffected: [0] };
          }
          return {
            recordset: [{ EmpID: EMP_ID, EmploymentType: 'full_time' }],
            rowsAffected: [1],
          };
        }

        if (
          /IF NOT EXISTS/i.test(sql) &&
          /INSERT INTO dbo\.TblEmpAttendance/i.test(sql) &&
          /AUTO_ABSENCE after scheduled start/i.test(sql)
        ) {
          applyAutoAbsenceMutation(inputs);
          return { recordset: [], rowsAffected: [1] };
        }

        if (/INSERT INTO dbo\.TblEmpScheduleOverrides/i.test(sql)) {
          return { recordset: [], rowsAffected: [1] };
        }

        if (/FROM dbo\.Bookings/i.test(sql)) {
          return { recordset: [{ BookingID: 9001 }], rowsAffected: [1] };
        }

        return { recordset: [], rowsAffected: [1] };
      },
    };
  }

  const pool = {
    request: () => makeRequest(),
  };

  class FakeTransaction {
    async begin() {}
    async commit() {}
    async rollback() {}
  }

  return {
    attendance,
    capturedQueries,
    markBookingsCalls,
    pool,
    FakeTransaction,
    setLockResult(v: number) {
      lockResult = v;
    },
    setResolvePlan(fn: typeof resolvePlan) {
      resolvePlan = fn;
    },
    getResolvePlan: () => resolvePlan,
    reset() {
      attendance.length = 0;
      nextId = 1;
      capturedQueries.length = 0;
      markBookingsCalls.length = 0;
      lockResult = 0;
      resolvePlan = async () => ({
        isWorking: true,
        effectiveWindows: [{ startMs: Date.now() - 60 * 60_000 }],
      });
    },
  };
});

vi.mock('@/lib/db', () => {
  class Request {
    private inputs: Record<string, unknown> = {};
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_tx?: unknown) {}
    input(name: string, _t: unknown, value: unknown) {
      this.inputs[name] = value;
      return this;
    }
    async query(sqlText: string) {
      const req = harness.pool.request();
      for (const [k, v] of Object.entries(this.inputs)) {
        req.input(k, null, v);
      }
      return req.query(sqlText);
    }
  }

  const sql: Record<string, unknown> = {
    Int: 'Int',
    Date: 'Date',
    NVarChar: (n: number) => `NVarChar(${n})`,
    Transaction: harness.FakeTransaction,
    Request,
  };
  return {
    getPool: async () => harness.pool,
    sql,
  };
});

vi.mock('@/lib/businessDate', () => ({
  getCairoBusinessDate: () => WORK_DATE,
  SALON_TZ: 'Africa/Cairo',
}));

vi.mock('@/lib/availability/resolveEmployeeDayPlan', () => ({
  resolveEmployeeDayPlan: (...args: unknown[]) =>
    harness.getResolvePlan()(...(args as [])),
}));

vi.mock('@/lib/booking/affectedBookings', () => ({
  markBookingsActionRequired: async (args: unknown) => {
    harness.markBookingsCalls.push(args);
    return 1;
  },
}));

vi.mock('@/lib/availability/bookingAvailabilityMetrics', () => ({
  logBookingAvailabilityMetric: vi.fn(),
}));

vi.mock('@/lib/hr/scheduleAvailabilityInvalidation', () => ({
  invalidateEmployeeScheduleCaches: vi.fn(),
}));

import { runAutoAbsenceScan } from '@/lib/hr/attendance/autoAbsence';

describe('autoAbsence characterization (pre-centralization freeze)', () => {
  beforeEach(() => {
    harness.reset();
  });

  it('uses Cairo business date when businessDate omitted', async () => {
    const result = await runAutoAbsenceScan({ empId: EMP_ID, branchId: BRANCH_ID });
    expect(result.markedAbsent).toBe(1);
    expect(harness.attendance[0]?.WorkDate).toBe(WORK_DATE);
  });

  it('uses scan BranchID as INSERT BranchID source', async () => {
    await runAutoAbsenceScan({ empId: EMP_ID, branchId: BRANCH_ID });
    expect(harness.attendance[0]?.BranchID).toBe(BRANCH_ID);
  });

  it('skips when elapsed minutes below branch threshold (30)', async () => {
    harness.setResolvePlan(async () => ({
      isWorking: true,
      effectiveWindows: [{ startMs: Date.now() - 10 * 60_000 }],
    }));
    const result = await runAutoAbsenceScan({ empId: EMP_ID, branchId: BRANCH_ID });
    expect(result.markedAbsent).toBe(0);
    expect(harness.attendance).toHaveLength(0);
  });

  it('marks Absent with exact Notes on INSERT when no row', async () => {
    await runAutoAbsenceScan({ empId: EMP_ID, branchId: BRANCH_ID });
    expect(harness.attendance).toEqual([
      expect.objectContaining({
        EmpID: EMP_ID,
        BranchID: BRANCH_ID,
        WorkDate: WORK_DATE,
        Status: 'Absent',
        Notes: 'AUTO_ABSENCE after scheduled start + threshold',
        CheckInTime: null,
        CheckOutTime: null,
      }),
    ]);
  });

  it('does not cancel bookings; marks ACTION_REQUIRED / AT_RISK only', async () => {
    await runAutoAbsenceScan({ empId: EMP_ID, branchId: BRANCH_ID });
    expect(harness.markBookingsCalls).toEqual([
      expect.objectContaining({
        reasonCode: 'AT_RISK',
        sourceEvent: `auto_absence:${WORK_DATE}`,
        branchId: BRANCH_ID,
        empId: EMP_ID,
      }),
    ]);
    const cancelSql = harness.capturedQueries.some(
      (q) =>
        /UPDATE dbo\.Bookings/i.test(q.sql) &&
        /Status\s*=\s*N?'cancelled'/i.test(q.sql),
    );
    expect(cancelSql).toBe(false);
  });

  it('emp-scoped run skips applock; branch-wide uses scan lock resource', async () => {
    await runAutoAbsenceScan({ empId: EMP_ID, branchId: BRANCH_ID });
    expect(harness.capturedQueries.some((q) => /sp_getapplock/i.test(q.sql))).toBe(
      false,
    );

    harness.reset();
    await runAutoAbsenceScan({ branchId: BRANCH_ID });
    const lockQ = harness.capturedQueries.find((q) => /sp_getapplock/i.test(q.sql));
    expect(lockQ?.inputs.res).toBe('auto_absence_scan');
  });

  it('returns skipped when scan lock busy', async () => {
    harness.setLockResult(-1);
    const result = await runAutoAbsenceScan({ branchId: BRANCH_ID });
    expect(result).toMatchObject({
      skipped: true,
      skipReason: 'scan_in_progress',
      markedAbsent: 0,
      processed: 0,
    });
  });

  it('skips non-working day-off without marking absent', async () => {
    harness.setResolvePlan(async () => ({
      isWorking: false,
      denyReasonCode: 'DAY_OFF',
    }));
    const result = await runAutoAbsenceScan({ empId: EMP_ID, branchId: BRANCH_ID });
    expect(result.markedAbsent).toBe(0);
    expect(harness.attendance).toHaveLength(0);
  });

  describe('branch-scoped AutoAbsence (EmpID + WorkDate + BranchID)', () => {
    it('Present on OTHER branch same WorkDate: candidate NOT skipped', async () => {
      harness.attendance.push({
        ID: 1,
        BranchID: OTHER_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        Status: 'Present',
        Notes: null,
        CheckInTime: '10:00',
        CheckOutTime: null,
      });
      const result = await runAutoAbsenceScan({ empId: EMP_ID, branchId: BRANCH_ID });
      expect(result.markedAbsent).toBe(1);
      expect(harness.attendance).toHaveLength(2);
      expect(
        harness.attendance.find((r) => r.BranchID === BRANCH_ID)?.Status,
      ).toBe('Absent');
      expect(
        harness.attendance.find((r) => r.BranchID === OTHER_BRANCH_ID)?.Status,
      ).toBe('Present');
    });

    it('Absent on OTHER branch: candidate NOT skipped', async () => {
      harness.attendance.push({
        ID: 1,
        BranchID: OTHER_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        Status: 'Absent',
        Notes: 'manual',
        CheckInTime: null,
        CheckOutTime: null,
      });
      const result = await runAutoAbsenceScan({ empId: EMP_ID, branchId: BRANCH_ID });
      expect(result.markedAbsent).toBe(1);
      expect(harness.attendance.filter((r) => r.BranchID === BRANCH_ID)).toHaveLength(1);
    });

    it('Pending on other branch: mutation INSERTs Absent on scan branch (not UPDATE other)', async () => {
      harness.attendance.push({
        ID: 1,
        BranchID: OTHER_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        Status: 'Pending',
        Notes: 'x',
        CheckInTime: null,
        CheckOutTime: null,
      });
      const result = await runAutoAbsenceScan({ empId: EMP_ID, branchId: BRANCH_ID });
      expect(result.markedAbsent).toBe(1);
      expect(harness.attendance).toHaveLength(2);
      expect(harness.attendance.find((r) => r.BranchID === OTHER_BRANCH_ID)?.Status).toBe(
        'Pending',
      );
      expect(harness.attendance.find((r) => r.BranchID === BRANCH_ID)?.Status).toBe(
        'Absent',
      );
    });

    it('DayOff on other branch does not block INSERT on scan branch', async () => {
      harness.attendance.push({
        ID: 1,
        BranchID: OTHER_BRANCH_ID,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        Status: 'DayOff',
        Notes: null,
        CheckInTime: null,
        CheckOutTime: null,
      });
      await runAutoAbsenceScan({ empId: EMP_ID, branchId: BRANCH_ID });
      expect(harness.attendance).toHaveLength(2);
      expect(harness.attendance.filter((r) => r.BranchID === BRANCH_ID)).toHaveLength(1);
    });

    it('attendance on current branch: no row → INSERT Absent on scan branch', async () => {
      await runAutoAbsenceScan({ empId: EMP_ID, branchId: BRANCH_ID });
      expect(harness.attendance).toHaveLength(1);
      expect(harness.attendance[0]?.BranchID).toBe(BRANCH_ID);
    });
  });

  it('mutation SQL includes BranchID on EXISTS/UPDATE WHERE', async () => {
    await runAutoAbsenceScan({ empId: EMP_ID, branchId: BRANCH_ID });
    const mut = harness.capturedQueries.find(
      (q) =>
        /INSERT INTO dbo\.TblEmpAttendance/i.test(q.sql) &&
        /AUTO_ABSENCE after scheduled start/i.test(q.sql),
    );
    expect(mut).toBeTruthy();
    expect(mut!.sql).toMatch(
      /WHERE EmpID = @empId AND WorkDate = @date AND BranchID = @branchId/i,
    );
    expect(mut!.sql).toMatch(
      /WHERE EmpID = @empId AND WorkDate = @date AND BranchID = @branchId\s+AND Status NOT IN/i,
    );
  });
});
