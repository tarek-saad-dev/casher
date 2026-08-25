/**
 * Characterization: Present placeholder for break attach (syncBreakFromBlockRange).
 * Freeze — Present with no punches is intentional legacy behavior.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const EMP_ID = 42;
const BRANCH_ID = 10;
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
  const captured: { sql: string; inputs: Record<string, unknown> }[] = [];

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
        if (/SELECT ID FROM dbo\.TblEmpAttendance/i.test(sqlText)) {
          const row = attendance.find(
            (r) =>
              r.EmpID === Number(inputs.empId) &&
              r.WorkDate === ymd(inputs.workDate) &&
              r.BranchID === Number(inputs.branchId),
          );
          return { recordset: row ? [{ ID: row.ID }] : [], rowsAffected: [1] };
        }
        if (/INSERT INTO dbo\.TblEmpAttendance/i.test(sqlText) && /N'Present'/i.test(sqlText)) {
          const id = nextId++;
          attendance.push({
            ID: id,
            BranchID: Number(inputs.branchId),
            EmpID: Number(inputs.empId),
            WorkDate: ymd(inputs.workDate),
            Status: 'Present',
            Notes: null,
            CheckInTime: null,
            CheckOutTime: null,
          });
          return { recordset: [{ ID: id }], rowsAffected: [1] };
        }
        return { recordset: [], rowsAffected: [0] };
      },
    };
  }

  return {
    attendance,
    captured,
    db: { request: () => makeRequest() },
    reset() {
      attendance.length = 0;
      captured.length = 0;
      nextId = 1;
    },
  };
});

import { ensurePresentAttendancePlaceholder } from '@/modules/attendance/application/ensurePresentAttendancePlaceholder';

describe('Present placeholder break characterization', () => {
  beforeEach(() => harness.reset());

  it('INSERT Present with NULL notes and no punches when missing', async () => {
    const id = await ensurePresentAttendancePlaceholder({
      db: harness.db,
      empId: EMP_ID,
      workDate: WORK_DATE,
      branchId: BRANCH_ID,
    });
    expect(id).toBe(1);
    expect(harness.attendance[0]).toEqual({
      ID: 1,
      BranchID: BRANCH_ID,
      EmpID: EMP_ID,
      WorkDate: WORK_DATE,
      Status: 'Present',
      Notes: null,
      CheckInTime: null,
      CheckOutTime: null,
    });
  });

  it('returns existing ID without second INSERT', async () => {
    harness.attendance.push({
      ID: 99,
      BranchID: BRANCH_ID,
      EmpID: EMP_ID,
      WorkDate: WORK_DATE,
      Status: 'Late',
      Notes: 'x',
      CheckInTime: '10:00',
      CheckOutTime: null,
    });
    const id = await ensurePresentAttendancePlaceholder({
      db: harness.db,
      empId: EMP_ID,
      workDate: WORK_DATE,
      branchId: BRANCH_ID,
    });
    expect(id).toBe(99);
    expect(harness.attendance).toHaveLength(1);
    expect(harness.captured.filter((c) => /INSERT/i.test(c.sql))).toHaveLength(0);
  });
});
