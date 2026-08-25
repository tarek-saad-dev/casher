/**
 * Characterization: temporary transfer + relocateEmployeeDayBranch attendance relocation.
 * CLOSED-only (CheckIn AND CheckOut NOT NULL). Freeze before centralization.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const EMP_ID = 42;
const FROM = 10;
const TO = 20;
const THIRD = 30;
const WORK_DATE = '2026-08-24';

type AttRow = {
  ID: number;
  BranchID: number;
  EmpID: number;
  WorkDate: string;
  CheckInTime: string | null;
  CheckOutTime: string | null;
};

const harness = vi.hoisted(() => {
  const attendance: AttRow[] = [];
  const captured: { sql: string; inputs: Record<string, unknown> }[] = [];
  let nextId = 1;

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
        captured.push({ sql: sqlText, inputs: { ...inputs } });
        const sql = sqlText;

        // Temporary transfer: from→to CLOSED only
        if (
          /UPDATE dbo\.TblEmpAttendance/i.test(sql) &&
          /BranchID = @from/i.test(sql) &&
          /SET BranchID = @to/i.test(sql) &&
          /CheckInTime IS NOT NULL AND CheckOutTime IS NOT NULL/i.test(sql)
        ) {
          const empId = Number(inputs.empId);
          const day = ymd(inputs.day);
          const from = Number(inputs.from);
          const to = Number(inputs.to);
          let n = 0;
          for (const r of attendance) {
            if (
              r.EmpID === empId &&
              r.WorkDate === day &&
              r.BranchID === from &&
              r.CheckInTime &&
              r.CheckOutTime
            ) {
              r.BranchID = to;
              n += 1;
            }
          }
          return { recordset: [], rowsAffected: [n] };
        }

        // Temporary transfer: third-branch sweep toward destination
        if (
          /UPDATE dbo\.TblEmpAttendance/i.test(sql) &&
          /BranchID <> @to/i.test(sql) &&
          /CheckInTime IS NOT NULL AND CheckOutTime IS NOT NULL/i.test(sql) &&
          inputs.from == null
        ) {
          const empId = Number(inputs.empId);
          const day = ymd(inputs.day);
          const to = Number(inputs.to);
          let n = 0;
          for (const r of attendance) {
            if (
              r.EmpID === empId &&
              r.WorkDate === day &&
              r.BranchID !== to &&
              r.CheckInTime &&
              r.CheckOutTime
            ) {
              r.BranchID = to;
              n += 1;
            }
          }
          return { recordset: [], rowsAffected: [n] };
        }

        // relocateEmployeeDayBranch CLOSED from→to
        if (
          /UPDATE dbo\.TblEmpAttendance/i.test(sql) &&
          /SET BranchID = @to/i.test(sql) &&
          /BranchID = @from/i.test(sql)
        ) {
          const empId = Number(inputs.empId);
          const day = ymd(inputs.day);
          const from = Number(inputs.from);
          const to = Number(inputs.to);
          let n = 0;
          for (const r of attendance) {
            if (
              r.EmpID === empId &&
              r.WorkDate === day &&
              r.BranchID === from &&
              r.CheckInTime &&
              r.CheckOutTime
            ) {
              r.BranchID = to;
              n += 1;
            }
          }
          return { recordset: [], rowsAffected: [n] };
        }

        if (/UPDATE dbo\.TblEmpDailyPayroll/i.test(sql)) {
          return { recordset: [], rowsAffected: [0] };
        }
        if (/UPDATE dbo\.TblEmpLedgerEntry/i.test(sql)) {
          return { recordset: [], rowsAffected: [0] };
        }

        return { recordset: [], rowsAffected: [0] };
      },
    };
  }

  return {
    attendance,
    captured,
    pool: { request: () => makeRequest() },
    seed(row: Omit<AttRow, 'ID'> & { ID?: number }) {
      attendance.push({ ID: row.ID ?? nextId++, ...row });
    },
    reset() {
      attendance.length = 0;
      captured.length = 0;
      nextId = 1;
    },
  };
});

vi.mock('@/lib/db', () => ({
  getPool: async () => harness.pool,
  sql: {
    Int: 'Int',
    Date: 'Date',
    NVarChar: (n: number) => `NVarChar(${n})`,
  },
}));

// Import repo functions via dynamic path after we add them — for now characterize
// by importing the private-path wrappers once migrated. Pre-migration: test SQL
// behavior through exported relocate helpers that call attendance commands.

import {
  relocateClosedAttendanceFromBranch,
  relocateClosedAttendanceTowardDestination,
} from '@/modules/attendance';

describe('transfer/relocation attendance characterization', () => {
  beforeEach(() => {
    harness.reset();
  });

  describe('temporary transfer style (from + third-branch sweep)', () => {
    it('relocates CLOSED from→to only', async () => {
      harness.seed({
        BranchID: FROM,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
        CheckOutTime: '18:00',
      });
      harness.seed({
        BranchID: FROM,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
        CheckOutTime: null,
      });
      // OPEN row shares unique key in real DB — here we only assert CLOSED filter
      // by using separate emp for OPEN in a second scenario below
      await relocateClosedAttendanceFromBranch({
        empId: EMP_ID,
        workDate: WORK_DATE,
        fromBranchId: FROM,
        toBranchId: TO,
      });
      const closed = harness.attendance.find((r) => r.CheckOutTime === '18:00');
      expect(closed?.BranchID).toBe(TO);
    });

    it('does not relocate OPEN (check-in without check-out)', async () => {
      harness.reset();
      harness.seed({
        BranchID: FROM,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
        CheckOutTime: null,
      });
      await relocateClosedAttendanceFromBranch({
        empId: EMP_ID,
        workDate: WORK_DATE,
        fromBranchId: FROM,
        toBranchId: TO,
      });
      expect(harness.attendance[0]?.BranchID).toBe(FROM);
    });

    it('third-branch sweep moves CLOSED toward destination', async () => {
      harness.seed({
        BranchID: THIRD,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '10:00',
        CheckOutTime: '18:00',
      });
      await relocateClosedAttendanceTowardDestination({
        empId: EMP_ID,
        workDate: WORK_DATE,
        toBranchId: TO,
      });
      expect(harness.attendance[0]?.BranchID).toBe(TO);
    });

    it('SQL requires BOTH CheckInTime and CheckOutTime NOT NULL', async () => {
      await relocateClosedAttendanceFromBranch({
        empId: EMP_ID,
        workDate: WORK_DATE,
        fromBranchId: FROM,
        toBranchId: TO,
      });
      const q = harness.captured.find((c) => /UPDATE dbo\.TblEmpAttendance/i.test(c.sql));
      expect(q?.sql).toMatch(/CheckInTime IS NOT NULL AND CheckOutTime IS NOT NULL/);
    });
  });

  describe('relocateEmployeeDayBranch style (from→to CLOSED only, no third sweep)', () => {
    it('moves CLOSED from→to and reports rowsAffected', async () => {
      harness.seed({
        BranchID: FROM,
        EmpID: EMP_ID,
        WorkDate: WORK_DATE,
        CheckInTime: '09:00',
        CheckOutTime: '17:00',
      });
      const n = await relocateClosedAttendanceFromBranch({
        empId: EMP_ID,
        workDate: WORK_DATE,
        fromBranchId: FROM,
        toBranchId: TO,
      });
      expect(n).toBe(1);
      expect(harness.attendance[0]?.BranchID).toBe(TO);
    });
  });
});
